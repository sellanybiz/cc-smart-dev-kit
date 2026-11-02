/**
 * `cc-smart-dev-kit job <command>`: the machine-wide queue for heavy jobs.
 *
 *   run     waits until a slot is free, runs the job, and passes its stdio, exit code and
 *           signals through.
 *   status  how many slots are in use, who holds them, who waits: here and on each shared
 *           folder; the memory ceiling and the weights.
 *   kinds   the kinds of heavy job.
 *   set     the person's own settings: how many jobs run at once, the weights.
 *
 * How it works and why: docs/jobs.md.
 */

import { readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { COMMAND } from "../build-info";
import { resolveProject } from "../project/resolve";
import { isInsideHeavyJob, readProcStat } from "./ancestry";
import { toolCallOfArgv } from "./classify";
import {
  cpuWeightOf,
  DEFAULT_SLICE,
  ioWeightOf,
  type JobsMachineConfig,
  jobsPaths,
  loadJobsConfig,
} from "./config";
import { isPrintOnly, type Kinds, mergeKinds, namesOnlyFiles } from "./kinds";
import {
  exitCodeOf,
  realLaunchFacts,
  realScope,
  realSliceControl,
  sliceMemoryMax,
  spawnAndWait,
} from "./launch";
import { acquireFrom, pidsHolding, WaitStoppedError } from "./queue";
import { runJob } from "./run";
import { JOB_SETTINGS, setJobsSetting } from "./set";
import { type JobContext, type OpenedStores, openStores, readJobs, statusLines } from "./status";

export type { JobContext } from "./status";

export const USAGE = `Usage: ${COMMAND} job <command>

Commands:
  run [--kind <kind>] [--exclusive <name>] -- <command...>
                 Wait until this machine has a free slot for the job, then run
                 it. Up to max-jobs heavy jobs run at once. Its output, exit code
                 and signals pass through. --exclusive: at most one job with that
                 name at a time, in order. --kind, or --exclusive, or both.
                 (--gb <n> is accepted and ignored: the queue counts jobs now.)
  status         How many slots are in use, who holds them, who waits, the memory
                 ceiling, and the CPU and disk I/O weights of the heavy slices.
  kinds          The kinds of heavy job.
  set <setting> <value>
                 Your own settings, written to jobs.json: ${Object.keys(JOB_SETTINGS).join(", ")}.
                 max-jobs is how many heavy jobs run at once (default 3).
                 CPU weight is idle (the default), off, or 1 to 10000.
                 I/O weight is off (the default), or 1 to 10000.

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

/** True when `word` names a file (not a folder) from `cwd`; anything that cannot be read is no file. */
function isFileIn(cwd: string, word: string): boolean {
  try {
    return statSync(resolve(cwd, word)).isFile();
  } catch {
    return false;
  }
}

function projectKinds(cwd: string): Kinds {
  const project = resolveProject(cwd);
  return mergeKinds(project?.config?.jobs?.kinds);
}

interface RunArgs {
  kind: string | null;
  gb: number | null;
  exclusive: string | null;
  command: [string, ...string[]];
}

/** An `--exclusive` name: a word, as a person types it in a script. */
const EXCLUSIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function parseRunArgs(args: readonly string[]): RunArgs | { error: string } {
  let kind: string | null = null;
  let gb: number | null = null;
  let exclusive: string | null = null;
  let index = 0;
  while (index < args.length && args[index] !== "--") {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) return { error: "put -- before the command" };
    const [name, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    if (name !== "--kind" && name !== "--gb" && name !== "--exclusive") {
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
    } else {
      if (!/^\d+$/.test(value)) return { error: "--gb takes a whole number of GB" };
      gb = Number(value);
    }
  }
  if (kind === null && exclusive === null) {
    return { error: "--kind <kind> or --exclusive <name> is required" };
  }
  if (args[index] !== "--") return { error: "put -- before the command" };
  const [program, ...rest] = args.slice(index + 1);
  if (program === undefined || program === "") return { error: "no command after --" };
  return { kind, gb, exclusive, command: [program, ...rest] };
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
  // A config this run cannot use (jobs.json, cc-smart-dev-kit.json, the state folder) ends it
  // before anything starts, as a wrong command line does: exit 2, never the job's code.
  let config: JobsMachineConfig;
  let kinds: Kinds;
  let opened: OpenedStores;
  try {
    config = loadJobsConfig(jobsPaths(ctx.paths.home).configFile);
    kinds = projectKinds(ctx.cwd);
    opened = openStores(ctx, config, say);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const spec = parsed.kind === null ? null : kinds[parsed.kind];
  if (spec === undefined) {
    ctx.say(`${PREFIX} unknown kind "${parsed.kind}": one of ${Object.keys(kinds).join(", ")}`);
    return 2;
  }
  const stores = [opened.machine, ...opened.shared];
  const now = ctx.now ?? Date.now;
  const slice = config.slice ?? DEFAULT_SLICE;
  const call = toolCallOfArgv(parsed.command);
  // A job with a kind takes a heavy slot. It takes none when it only prints (`tsc
  // --version`), and a light one when its kind is `light` (an install) or, for a kind with
  // `noSlotForFiles`, when it names only a few existing files (`vitest run src/a.test.ts`).
  // A job with a name alone takes none: it holds its name, and nothing else.
  const lane =
    spec === null || isPrintOnly(spec, call.args)
      ? "none"
      : spec.light === true || namesOnlyFiles(spec, call.args, (word) => isFileIn(ctx.cwd, word))
        ? "light"
        : "heavy";
  const slot = lane !== "none";
  const exclusive = parsed.exclusive ?? undefined;
  if (parsed.gb !== null) {
    say(`--gb is ignored: the queue counts jobs now, not gigabytes (see "${COMMAND} job status")`);
  }

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
        lane,
        pid: process.pid,
        checkout: ctx.cwd,
        memoryMax: sliceMemoryMax(opened.ceilingGb),
        slice,
        cpuWeight: cpuWeightOf(config),
        ioWeight: ioWeightOf(config),
        startedAt: now(),
      },
      {
        isNested: () => nestedIn(),
        ancestorHoldsName: (name) => nestedIn(name),
        acquire: async (job, onWaiting) => {
          for (const note of opened.notes) say(note);
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
        launchFacts: () => (config.launch === "plain" ? null : realLaunchFacts(slice)),
        now,
        slice: realSliceControl(ctx.memory.read),
        run: (argv, scopeUnit) => {
          started = true;
          const scope = scopeUnit === null ? null : realScope(slice, scopeUnit, ctx.memory.read);
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

/** `job set <setting> <value>`: one machine-wide setting, written to `jobs.json`. */
async function jobSet(args: readonly string[], ctx: JobContext): Promise<number> {
  const [name, value, ...extra] = args;
  if (name === undefined || value === undefined || extra.length > 0) {
    ctx.say(`${PREFIX} set needs a setting and one value\n\n${USAGE}`);
    return 2;
  }
  const result = await setJobsSetting(ctx.paths, name, value);
  if (!result.ok) {
    ctx.say(`${PREFIX} ${result.error}`);
    return result.code;
  }
  for (const line of result.lines) ctx.print(line);
  return 0;
}

export async function runJobCommand(args: readonly string[], ctx: JobContext): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "run":
      return jobRun(rest, ctx);
    case "status":
      return jobStatus(ctx);
    case "kinds":
      return jobKinds(ctx);
    case "set":
      return jobSet(rest, ctx);
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
