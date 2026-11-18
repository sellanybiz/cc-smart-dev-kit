/** The heavy-job command: run, status and kinds. */
import { readdirSync } from "node:fs";
import { hostname } from "node:os";
import { COMMAND } from "../build-info";
import { resolveProject } from "../project/resolve";
import { shellWord } from "../setup/launcher";
import { isInsideHeavyJob, readProcStat } from "./ancestry";
import { runWeight } from "./classify";
import {
  HEAVY_SLOTS,
  heavyLimitLine,
  heavySlotsSchema,
  MAX_HEAVY_SLOTS,
  readHeavyLimit,
  setHeavyLimit,
} from "./config";
import { type Kinds, mergeKinds } from "./kinds";
import { exitCodeOf, spawnAndWait } from "./launch";
import { acquireFrom, pidsHolding, WaitStoppedError } from "./queue";
import { runJob } from "./run";
import { type JobContext, openStores, readJobs, statusLines } from "./status";
import { diskWeightSource } from "./weight-source";

export type { JobContext } from "./status";

export const USAGE = `Usage: ${COMMAND} job <command>

Commands:
  run [--kind <kind>] [--exclusive <name>] -- <command...>
                 Wait for a free heavy slot on this machine, then run the command.
                 Named-file and print-only runs skip the queue.
                 Output, exit code and signals pass through.
  status         Limit, its source, running jobs and waiting jobs.
  set max <n>    Set the machine limit (${HEAVY_SLOTS}..${MAX_HEAVY_SLOTS}); default ${HEAVY_SLOTS}.
  kinds          The kinds of heavy job.

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

function projectKinds(cwd: string): Kinds {
  const project = resolveProject(cwd);
  return mergeKinds(project?.config?.jobs?.kinds);
}

interface RunArgs {
  kind: string | null;
  exclusive: string | null;
  command: [string, ...string[]];
}

/** An `--exclusive` name: a word, as a person types it in a script. */
const EXCLUSIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function parseRunArgs(args: readonly string[]): RunArgs | { error: string } {
  let kind: string | null = null;
  let exclusive: string | null = null;
  let index = 0;
  while (index < args.length && args[index] !== "--") {
    const arg = args[index] ?? "";
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
  return { kind, exclusive, command: [program, ...rest] };
}

/** `job run`: returns the exit code to end with. */
async function jobRun(args: readonly string[], ctx: JobContext): Promise<number> {
  const parsed = parseRunArgs(args);
  if ("error" in parsed) {
    ctx.say(`${PREFIX} ${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  // Bun loads .env files from the working folder into its own environment, and the job
  // would get them. A job must get exactly the environment it was given.
  const envFiles = envFilesIn(ctx.cwd);
  if (!ctx.execArgv.includes("--no-env-file") && envFiles.length > 0) {
    ctx.say(
      `${PREFIX} this folder has ${envFiles.join(", ")}, and bun was started without --no-env-file: ` +
        `the job would get their values. Run "${COMMAND} setup" to update the launcher, then try again.`,
    );
    return 2;
  }
  const say = (line: string) => ctx.say(`${PREFIX} ${line}`);
  let kinds: Kinds;
  try {
    kinds = projectKinds(ctx.cwd);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const spec = parsed.kind === null ? null : kinds[parsed.kind];
  if (spec === undefined) {
    ctx.say(`${PREFIX} unknown kind "${parsed.kind}": one of ${Object.keys(kinds).join(", ")}`);
    return 2;
  }
  const slot = spec !== null && !isLightRun(parsed.command, kinds, ctx.cwd);
  const exclusive = parsed.exclusive ?? undefined;
  // A narrow run never opens or reads the lease store.
  if (!slot && exclusive === undefined)
    return spawnAndWait(parsed.command, process, say).then((end) => end.code);
  let stores: ReturnType<typeof openStores>["machine"][];
  try {
    stores = [openStores(ctx).machine];
  } catch (error) {
    say(error instanceof Error ? error.message : String(error));
    return 2;
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
        run: (argv) => {
          started = true;
          return spawnAndWait(argv, process, say);
        },
        say,
        stopped: () => stop.signal.aborted,
      },
    );
    // Once the job ran, its code is the answer; a signal before that ends as a shell would.
    return started || caught === null ? code : exitCodeOf(null, caught);
  } catch (error) {
    if (error instanceof WaitStoppedError) return exitCodeOf(null, caught ?? "SIGTERM");
    throw error;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    process.off("exit", releaseOnExit);
  }
}

/** `job status`: the queue's own lines, from the one reader (`status.ts`). */
async function jobStatus(ctx: JobContext): Promise<number> {
  const now = (ctx.now ?? Date.now)();
  for (const line of statusLines(await readJobs(ctx), ctx.paths.home, now)) ctx.print(line);
  return 0;
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
    case "set": {
      const [key, value, ...extra] = rest;
      const parsed = heavySlotsSchema.safeParse(Number(value));
      if (key !== "max" || value === undefined || extra.length > 0 || !parsed.success) {
        ctx.say(USAGE);
        return 2;
      }
      try {
        await setHeavyLimit(ctx.paths, parsed.data);
        ctx.print(heavyLimitLine(readHeavyLimit(ctx.paths.home)));
        return 0;
      } catch (error) {
        ctx.say(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }
    case "status":
      return jobStatus(ctx);
    case "kinds":
      return jobKinds(ctx);
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
