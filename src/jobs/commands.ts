/**
 * `anymodel job <command>`: the machine-wide queue for heavy jobs.
 *
 *   run     waits until the memory for the job is free, runs it, and passes its stdio,
 *           exit code and signals through.
 *   status  who holds what, who waits, and the free memory: here and on each shared folder.
 *   kinds   the kinds of heavy job, and what each reserves.
 *
 * How it works and why: docs/jobs.md.
 */

import { mkdirSync, readdirSync, statSync } from "node:fs";
import { availableParallelism, hostname } from "node:os";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { resolveProject } from "../project/resolve";
import { isInsideHeavyJob, readProcStat } from "./ancestry";
import { toolCallOfArgv } from "./classify";
import {
  DEFAULT_RESERVE_GB,
  DEFAULT_SLICE,
  JobsConfigError,
  type JobsMachineConfig,
  jobsPaths,
  loadJobsConfig,
} from "./config";
import {
  DEFAULT_KINDS,
  type Kinds,
  largestJobGb,
  mergeKinds,
  reservedGb,
  workerCount,
} from "./kinds";
import {
  exitCodeOf,
  realLaunchFacts,
  realScope,
  realSliceControl,
  sliceMemoryMax,
  spawnAndWait,
} from "./launch";
import { GIB, type MemoryFacts, machineBudgetGb, machineMemory, sliceBytes } from "./memory";
import {
  acquireFrom,
  describeHolder,
  formatSince,
  type HolderRecord,
  holderLines,
  type LiveReading,
  oneDecimal,
  parseHolder,
  pidsHolding,
  WaitStoppedError,
} from "./queue";
import { runJob } from "./run";
import { type LeaseStore, leaseStore, openSharedStore } from "./store";

export const USAGE = `Usage: ${COMMAND} job <command>

Commands:
  run [--kind <kind>] [--gb <n>] [--exclusive <name>] -- <command...>
                 Wait until this machine has the memory for the job, then run it.
                 Its output, exit code and signals pass through. --exclusive: at
                 most one job with that name at a time, in order. --kind, or
                 --exclusive, or both.
  status         Who holds memory, who waits, and how much is free.
  kinds          The kinds of heavy job, and what each reserves.

How it works: docs/jobs.md in the plugin's repo.`;

/** What the commands need from the outside; a test passes its own. */
export interface JobContext {
  paths: CliPaths;
  cwd: string;
  /** The bun options this process started with: `--no-env-file` must be there. */
  execArgv: readonly string[];
  memory: MemoryFacts;
  /** Lines for the person: waiting lines, notes. */
  say: (line: string) => void;
  /** `job status` and `job kinds` print here. */
  print: (line: string) => void;
  now?: () => number;
}

const PREFIX = "[anymodel job]";

/** The stores this machine uses: its own, then each shared folder, in that order. */
interface OpenedStores {
  machine: LeaseStore;
  shared: LeaseStore[];
  notes: string[];
  budget: { gb: number; why: string };
}

function machineBudget(
  config: JobsMachineConfig,
  memory: MemoryFacts,
): { gb: number; why: string } {
  if (config.budgetGb !== undefined) return { gb: config.budgetGb, why: "set in jobs.json" };
  const reserve = config.reserveGb ?? DEFAULT_RESERVE_GB;
  const total = machineMemory(memory).totalBytes;
  const gb = machineBudgetGb(total, reserve, largestJobGb(DEFAULT_KINDS));
  return {
    gb,
    why: `${Math.floor(total / GIB)} GB of memory less ${reserve} GB kept for everything else`,
  };
}

function openStores(
  ctx: JobContext,
  config: JobsMachineConfig,
  onNote: (line: string) => void,
): OpenedStores {
  const dir = config.stateDir ?? jobsPaths(ctx.paths.home).stateDir;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    throw new JobsConfigError(`The state folder ${dir} cannot be made (${code}).`);
  }
  const budget = machineBudget(config, ctx.memory);
  const uid = process.getuid?.();
  const slice = config.slice ?? DEFAULT_SLICE;
  const live = (): LiveReading | null => {
    const memory = machineMemory(ctx.memory);
    if (memory.availableBytes === null) return null;
    const used =
      uid === undefined || config.launch === "plain"
        ? null
        : sliceBytes(ctx.memory.read, uid, slice);
    return { availableBytes: memory.availableBytes, sliceBytes: used };
  };
  const machine = leaseStore({
    dir,
    label: "this machine",
    shared: false,
    capacityGb: () => machineBudget(config, ctx.memory).gb,
    live,
    onNote,
  });
  const shared: LeaseStore[] = [];
  const notes: string[] = [];
  // One order for every user: two users who list the same folders in another order could
  // otherwise each hold one and wait for the other's.
  for (const sharedDir of [...new Set(config.sharedDirs ?? [])].sort()) {
    const opened = openSharedStore(sharedDir, { onNote });
    if ("store" in opened) shared.push(opened.store);
    else notes.push(opened.note);
  }
  return { machine, shared, notes, budget };
}

/** Bun reads these from the working folder into the environment by itself. */
function envFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => /^\.env(\..+)?$/.test(name));
  } catch {
    return [];
  }
}

function isFileIn(cwd: string): (path: string) => boolean {
  return (path) => {
    try {
      return statSync(path.startsWith("/") ? path : `${cwd}/${path}`).isFile();
    } catch {
      return false; // not there, or not readable: not an existing file
    }
  };
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
  // A config this run cannot use (jobs.json, anymodel.json, the state folder) ends it
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
  const gb = parsed.gb ?? (spec === null ? 0 : reservedGb(spec, call.args, isFileIn(ctx.cwd)));
  const exclusive = parsed.exclusive ?? undefined;

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
        spec,
        command: parsed.command,
        exclusive,
        gb,
        pid: process.pid,
        checkout: ctx.cwd,
        slice,
        startedAt: now(),
      },
      {
        isNested: () => nestedIn(),
        ancestorHoldsName: (name) => nestedIn(name),
        acquire: async (job, onWaiting) => {
          for (const note of opened.notes) say(note);
          // Nothing to reserve and no name to hold: no queue at all.
          if (job.gb <= 0 && job.exclusive === undefined) {
            return { gb: 0, release: () => undefined };
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
        workersFor: (size, gbEach) => workerCount(size, gbEach, availableParallelism()),
        memoryMaxFor: (size) => sliceMemoryMax(opened.budget.gb, size),
        launchFacts: () => (config.launch === "plain" ? null : realLaunchFacts(slice)),
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

/** The lines of one store for `job status`. A store it cannot read is one line saying so. */
async function storeLines(store: LeaseStore, title: string, now: number): Promise<string[]> {
  const lines: string[] = [];
  let capacity: number;
  let held: { gb: number; holder: HolderRecord | null }[];
  let waiting: (HolderRecord | null)[];
  try {
    capacity = await store.capacityGb();
    held = (await store.held()).map((unit) => ({ gb: unit.gb, holder: parseHolder(unit.text) }));
    waiting = (await store.waiting())
      .map((unit) => parseHolder(unit.text))
      .sort(
        (a, b) => (a?.since ?? Number.POSITIVE_INFINITY) - (b?.since ?? Number.POSITIVE_INFINITY),
      );
  } catch (error) {
    return [`${title}: cannot be read (${error instanceof Error ? error.message : String(error)})`];
  }
  const heldGb = held.reduce((sum, unit) => sum + unit.gb, 0);
  lines.push(`${title}: ${Math.max(0, capacity - heldGb)} of ${capacity} GB free`);
  lines.push(...holderLines(held, store.label, now));
  // integration: plainText (the record is another writer's text)
  for (const record of waiting) {
    lines.push(
      record === null
        ? `  ${store.label}: an unknown job waits`
        : `  ${store.label}: waits for ${record.gb} GB: ${record.person}: ${describeHolder(record)}, since ${formatSince(record.since, now)} (pid ${record.pid})`,
    );
  }
  if (held.length === 0 && waiting.length === 0) lines.push("  nothing held, nobody waits");
  return lines;
}

/** `job status`. */
async function jobStatus(ctx: JobContext): Promise<number> {
  const config = loadJobsConfig(jobsPaths(ctx.paths.home).configFile);
  const opened = openStores(ctx, config, ctx.print);
  const now = (ctx.now ?? Date.now)();
  const home = ctx.paths.home;
  const memory = machineMemory(ctx.memory);
  const free =
    memory.availableBytes === null
      ? "free memory cannot be read on this system (no live check)"
      : `${oneDecimal(memory.availableBytes / GIB)} GB free now`;
  const limit =
    memory.limit === null
      ? ""
      : ` (a memory limit of its group: ${tildify(memory.limit.dir, home)})`;
  ctx.print(`Memory: ${oneDecimal(memory.totalBytes / GIB)} GB${limit}, ${free}.`);
  ctx.print(`Budget for heavy jobs here: ${opened.budget.gb} GB (${opened.budget.why}).`);
  for (const line of await storeLines(
    opened.machine,
    `This machine (${tildify(opened.machine.dir, home)})`,
    now,
  )) {
    ctx.print(line);
  }
  for (const store of opened.shared) {
    for (const line of await storeLines(store, `Shared folder ${store.dir}`, now)) ctx.print(line);
  }
  for (const note of opened.notes) ctx.print(note);
  return 0;
}

/** `job kinds`. */
function jobKinds(ctx: JobContext): number {
  const project = resolveProject(ctx.cwd);
  const own = project?.config?.jobs?.kinds ?? {};
  const kinds = mergeKinds(own);
  const width = Math.max(...Object.keys(kinds).map((name) => name.length));
  for (const [name, kind] of Object.entries(kinds)) {
    const sizes = [`${kind.gb} GB`];
    if (kind.filesGb !== undefined) {
      const few = kind.maxFiles === undefined ? "" : ` up to ${kind.maxFiles}`;
      sizes.push(`${kind.filesGb} GB for${few} files`);
    }
    if (kind.workers !== undefined) {
      sizes.push(`${kind.workers.flag} at ${kind.workers.gbEach} GB a worker`);
    }
    const from = name in own ? "project" : "default";
    ctx.print(`${name.padEnd(width)}  ${sizes.join(", ")} (${from})`);
    if (kind.about !== undefined) ctx.print(`${"".padEnd(width)}  ${kind.about}`);
  }
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
