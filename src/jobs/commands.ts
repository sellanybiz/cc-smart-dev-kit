/** The heavy-job command: run, status, kinds, and the git hooks' question (`hook`). */
import { readdirSync } from "node:fs";
import { hostname } from "node:os";
import type { ZodNumber } from "zod";
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { resolveProject } from "../project/resolve";
import { shellWord } from "../shell/quote";
import { isInsideHeavyJob, readProcStat } from "./ancestry";
import { runWeight } from "./classify";
import {
  DEFAULT_LIMIT_PERCENT,
  HEAVY_SLOTS,
  heavyLimitLine,
  heavySlotsSchema,
  LIMIT_PERCENT_MAX,
  LIMIT_PERCENT_MIN,
  limitPercentSchema,
  limitsLine,
  MAX_HEAVY_SLOTS,
  readHeavyLimit,
  readLimitSettings,
  setHeavyLimit,
  setLimitPercent,
} from "./config";
import { projectKinds, runHookCommand } from "./hook-command";
import { type Kinds, mergeKinds } from "./kinds";
import { exitCodeOf, spawnAndWait } from "./launch";
import { startLimits } from "./limits";
import { acquireFrom, pidsHolding, WaitStoppedError } from "./queue";
import { type JobDeps, runJob } from "./run";
import { type JobContext, openStores, readJobs, statusLines } from "./status";
import { diskWeightSource } from "./weight-source";

export type { JobContext } from "./status";

export const USAGE = `Usage: ${COMMAND} job <command>

Commands:
  run [--kind <kind>] [--exclusive <name>] [--hook] -- <command...>
                 Wait for a free heavy slot on this machine, then run the command.
                 Named-file and print-only runs skip the queue.
                 Output, exit code and signals pass through.
                 --hook: for the kit's git hooks. The slot is taken without reading
                 the command's words, and when the queue cannot be used the command
                 runs at once: a broken kit never blocks a commit.
  status         Limit, its source, the CPU and memory caps, running jobs and waiting jobs.
  set max <n>    Set the machine limit (${HEAVY_SLOTS}..${MAX_HEAVY_SLOTS}); default ${HEAVY_SLOTS}.
  set cpu <n>    Cap the heavy jobs' CPU at <n>% of the machine's CPUs, together
                 (${LIMIT_PERCENT_MIN}..${LIMIT_PERCENT_MAX}); default ${DEFAULT_LIMIT_PERCENT}. Linux with a systemd user manager.
  set memory <n> Cap the heavy jobs' memory at <n>% of the machine's memory, together
                 (${LIMIT_PERCENT_MIN}..${LIMIT_PERCENT_MAX}); default ${DEFAULT_LIMIT_PERCENT}. Linux with a systemd user manager.
  kinds          The kinds of heavy job.
  hook <name>    For the kit's git hooks: prints "direct" or "queue <kind>" for git
                 hook <name> in this repo. Always ends with 0.

How it works: docs/jobs.md in the plugin's repo.`;

const PREFIX = "[cc-smart-dev-kit job]";

/** Bun reads these from the working folder into the environment by itself. */
function envFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => /^\.env(\..+)?$/.test(name));
  } catch {
    return [];
  }
}

/**
 * True when the judge (`runWeight`) proves the command light: it only prints, or names only
 * files that exist, in the folder it runs in. The words are read as the line a shell would run
 * (`shellWord` quotes what needs it), so a command given through `sh -c '…'`, a wrapper or a
 * `cd` is read as the route reads it. Only a positive finding lowers a run to light: a heavy
 * run, and a command the judge cannot read (`none`), keep their slot.
 */
function isLightRun(command: readonly string[], kinds: Kinds, cwd: string): boolean {
  const line = command.map(shellWord).join(" ");
  return runWeight(line, kinds, diskWeightSource(cwd)).weight === "light";
}

interface RunArgs {
  kind: string | null;
  exclusive: string | null;
  /** `--hook`: a git hook the kit's hooks folder already judged heavy (`job hook`). */
  hook: boolean;
  command: [string, ...string[]];
}

/**
 * The command of a `job run --hook` line whose options could not be read: the words after the
 * first `--`, when `--hook` is before it. A hook line runs even then, so a CLI that reads the
 * options another way never blocks a commit.
 */
function hookCommandOf(args: readonly string[]): [string, ...string[]] | null {
  const end = args.indexOf("--");
  if (end < 0 || !args.slice(0, end).includes("--hook")) return null;
  const [program, ...rest] = args.slice(end + 1);
  return program === undefined || program === "" ? null : [program, ...rest];
}

/** An `--exclusive` name: a word, as a person types it in a script. */
const EXCLUSIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function parseRunArgs(args: readonly string[]): RunArgs | { error: string } {
  let kind: string | null = null;
  let exclusive: string | null = null;
  let hook = false;
  let index = 0;
  while (index < args.length && args[index] !== "--") {
    const arg = args[index] ?? "";
    if (arg === "--hook") {
      hook = true;
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) return { error: "put -- before the command" };
    const [name, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    if (name !== "--kind" && name !== "--exclusive") {
      return { error: `unknown option: ${arg}` };
    }
    const value = inline ?? args[index + 1];
    if (value === undefined || value === "--") return { error: `${name} needs a value` };
    index += inline === undefined ? 2 : 1;
    if (name === "--kind") kind = value;
    else if (name === "--exclusive") {
      if (!EXCLUSIVE_NAME.test(value)) {
        return {
          error: "--exclusive takes a name: letters, digits, . _ : -, at most 64 characters",
        };
      }
      exclusive = value;
    }
  }
  if (kind === null && exclusive === null) {
    return { error: "--kind <kind> or --exclusive <name> is required" };
  }
  if (args[index] !== "--") return { error: "put -- before the command" };
  const [program, ...rest] = args.slice(index + 1);
  if (program === undefined || program === "") return { error: "no command after --" };
  return { kind, exclusive, hook, command: [program, ...rest] };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The limits for one queued job: this machine's facts, the settings as they are NOW (a limit
 * set while jobs wait applies to the next launch), and the queue's `maxConcurrent`, which says
 * whether the memory cap is shared. Never throws (`startLimits`).
 */
export function limitsFor(ctx: JobContext): JobDeps["limits"] {
  return (job) => {
    let slots = HEAVY_SLOTS;
    try {
      slots = readHeavyLimit(ctx.paths.home).slots;
    } catch {
      // The queue itself refuses a bad `maxConcurrent`; the memory line only needs a number.
    }
    return startLimits(ctx.limits, readLimitSettings(ctx.paths.home), job, slots);
  };
}

/** A hook the queue cannot take: one line on stderr, then the hook runs as git would run it. */
async function runHookDirect(
  command: readonly [string, ...string[]],
  reason: string,
  say: (line: string) => void,
): Promise<number> {
  say(`${reason}; the git hook runs without the queue.`);
  return (await spawnAndWait(command, process, say)).code;
}

/** `job run`: returns the exit code to end with. */
async function jobRun(args: readonly string[], ctx: JobContext): Promise<number> {
  const say = (line: string) => ctx.say(`${PREFIX} ${line}`);
  const parsed = parseRunArgs(args);
  if ("error" in parsed) {
    const hookCommand = hookCommandOf(args);
    if (hookCommand !== null) return runHookDirect(hookCommand, parsed.error, say);
    ctx.say(`${PREFIX} ${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  // Before the job starts, a hook never fails on the kit: it runs at once instead.
  const cannotQueue = (reason: string): Promise<number> | number => {
    if (parsed.hook) return runHookDirect(parsed.command, reason, say);
    say(reason);
    return 2;
  };
  // Bun loads .env files from the working folder into its own environment, and the job
  // would get them. A job must get exactly the environment it was given.
  const envFiles = envFilesIn(ctx.cwd);
  if (!ctx.execArgv.includes("--no-env-file") && envFiles.length > 0) {
    return cannotQueue(
      `this folder has ${envFiles.join(", ")}, and bun was started without --no-env-file: ` +
        `the job would get their values. Run "${COMMAND} setup" to update the launcher, then try again.`,
    );
  }
  let kinds: Kinds;
  try {
    kinds = projectKinds(ctx.cwd);
  } catch (error) {
    return cannotQueue(messageOf(error));
  }
  const spec = parsed.kind === null ? null : kinds[parsed.kind];
  if (spec === undefined) {
    return cannotQueue(`unknown kind "${parsed.kind}": one of ${Object.keys(kinds).join(", ")}`);
  }
  // A hook's words are git's (a message file, refs), not the tool's: `job hook` already judged
  // the hook's body heavy, so its slot is never lowered by reading them.
  const slot = spec !== null && (parsed.hook || !isLightRun(parsed.command, kinds, ctx.cwd));
  const exclusive = parsed.exclusive ?? undefined;
  // A narrow run never opens or reads the lease store.
  if (!slot && exclusive === undefined)
    return spawnAndWait(parsed.command, process, say).then((end) => end.code);
  let stores: ReturnType<typeof openStores>["machine"][];
  try {
    stores = [openStores(ctx).machine];
  } catch (error) {
    return cannotQueue(messageOf(error));
  }
  const now = ctx.now ?? Date.now;

  // A signal while it waits: give back what it holds, and end as a shell would.
  const stop = new AbortController();
  let caught: NodeJS.Signals | null = null;
  const onSignal = (signal: NodeJS.Signals) => () => {
    caught ??= signal;
    stop.abort();
  };
  const handlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map(
    (signal) => [signal, onSignal(signal)] as const,
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  let held: { release(): void } | null = null;
  let started = false;
  const releaseOnExit = () => held?.release();
  process.once("exit", releaseOnExit);
  let failedBeforeStart = "";

  try {
    const nestedIn = (exclusiveName?: string) =>
      isInsideHeavyJob({
        platform: process.platform,
        pid: process.pid,
        readStat: readProcStat,
        holderPids: () => pidsHolding(stores, hostname(), exclusiveName),
      });
    const code = await runJob(
      {
        kind: parsed.kind ?? "",
        command: parsed.command,
        exclusive,
        slot,
        pid: process.pid,
        checkout: ctx.cwd,
      },
      {
        isNested: () => nestedIn(),
        ancestorHoldsName: (name) => nestedIn(name),
        acquire: async (job, onWaiting) => {
          // No slot to take and no name to hold: no queue at all.
          if (!job.slot && job.exclusive === undefined) {
            return { release: () => undefined, waitedSince: null };
          }
          const reservation = await acquireFrom(stores, job, {
            onWaiting,
            person: hostname(),
            signal: stop.signal,
            now,
          });
          held = reservation;
          return reservation;
        },
        now,
        limits: limitsFor(ctx),
        run: (argv, scope) => {
          started = true;
          return spawnAndWait(argv, process, say, { scope });
        },
        say,
        stopped: () => stop.signal.aborted,
      },
    );
    // Once the job ran, its code is the answer; a signal before that ends as a shell would.
    return started || caught === null ? code : exitCodeOf(null, caught);
  } catch (error) {
    if (error instanceof WaitStoppedError) return exitCodeOf(null, caught ?? "SIGTERM");
    if (!parsed.hook || started) throw error;
    // The queue broke before the hook started (a store it cannot read or write): give back
    // what it holds, and run the hook below, once the signal handlers are gone.
    releaseOnExit();
    failedBeforeStart = messageOf(error);
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    process.off("exit", releaseOnExit);
  }
  return runHookDirect(parsed.command, failedBeforeStart, say);
}

/** `job status`: the queue's own lines, from the one reader (`status.ts`). */
async function jobStatus(ctx: JobContext): Promise<number> {
  const now = (ctx.now ?? Date.now)();
  for (const line of statusLines(await readJobs(ctx), ctx.paths.home, now)) ctx.print(line);
  return 0;
}

/** What each `job set <key> <n>` checks, writes and prints. */
interface SetKey {
  schema: ZodNumber;
  write: (paths: CliPaths, n: number) => Promise<void>;
  /** The line printed once it is written: the setting as the status says it. */
  line: (home: string) => string;
}
const SET_KEYS: Record<"max" | "cpu" | "memory", SetKey> = {
  max: {
    schema: heavySlotsSchema,
    write: setHeavyLimit,
    line: (home) => heavyLimitLine(readHeavyLimit(home)),
  },
  cpu: {
    schema: limitPercentSchema,
    write: (paths, n) => setLimitPercent(paths, "cpuPercent", n),
    line: (home) => limitsLine(readLimitSettings(home)),
  },
  memory: {
    schema: limitPercentSchema,
    write: (paths, n) => setLimitPercent(paths, "memoryPercent", n),
    line: (home) => limitsLine(readLimitSettings(home)),
  },
};

/** `job set max|cpu|memory <n>`: one machine setting, under the same lock. */
async function jobSet(args: readonly string[], ctx: JobContext): Promise<number> {
  const [key, value, ...extra] = args;
  const target = key === "max" || key === "cpu" || key === "memory" ? SET_KEYS[key] : null;
  const parsed = target?.schema.safeParse(Number(value));
  if (target === null || value === undefined || extra.length > 0 || !parsed?.success) {
    ctx.say(USAGE);
    return 2;
  }
  try {
    await target.write(ctx.paths, parsed.data);
    ctx.print(target.line(ctx.paths.home));
    return 0;
  } catch (error) {
    ctx.say(messageOf(error));
    return 1;
  }
}

/** `job kinds`. */
function jobKinds(ctx: JobContext): number {
  const project = resolveProject(ctx.cwd);
  const own = project?.config?.jobs?.kinds ?? {};
  const kinds = mergeKinds(own);
  const width = Math.max(...Object.keys(kinds).map((name) => name.length));
  for (const [name, kind] of Object.entries(kinds)) {
    const from = name in own ? "project" : "default";
    ctx.print(`${name.padEnd(width)}  (${from})`);
    if (kind.about !== undefined) ctx.print(`${"".padEnd(width)}  ${kind.about}`);
  }
  return 0;
}

export async function runJobCommand(args: readonly string[], ctx: JobContext): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "run":
      return jobRun(rest, ctx);
    case "set":
      return jobSet(rest, ctx);
    case "status":
      return jobStatus(ctx);
    case "kinds":
      return jobKinds(ctx);
    case "hook":
      return runHookCommand(rest, ctx);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      ctx.print(USAGE);
      return command === undefined ? 2 : 0;
    default:
      ctx.say(`Unknown job command: ${command}\n\n${USAGE}`);
      return 2;
  }
}
