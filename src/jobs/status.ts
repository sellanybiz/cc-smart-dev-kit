/**
 * The heavy-job queue as data: who holds memory, who waits, how much is free, and the CPU
 * and disk I/O weights the heavy slices carry — on this machine and on each shared folder.
 *
 * One reader, three readers of it: `job status` prints its lines, `GET /api/jobs` answers its
 * shape, and the Machine page shows the same lines the command prints. Before this module,
 * `job status` built the lines directly and the portal could only show the printed text; a
 * second parser of those lines would have drifted the moment a line changed. `commands.ts`
 * calls `readJobs` and `statusLines`; nothing parses a line.
 *
 * The shape `/api/jobs` answers (`JobsAnswer`) is this module's public one: GB numbers are
 * one-decimal, `since` is ISO 8601, and a record the store cannot read is `unknown: true` with
 * empty words rather than a guess. `statusLines` also uses the private fields here (the
 * budget's reason, the memory limit, the raw records for grouping), which no page needs.
 */

import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CliPaths, tildify } from "../cli/paths";
import {
  cpuWeightOf,
  DEFAULT_RESERVE_GB,
  DEFAULT_SLICE,
  ioWeightOf,
  type JobsMachineConfig,
  jobsPaths,
  loadJobsConfig,
} from "./config";
import { DEFAULT_KINDS, largestJobGb } from "./kinds";
import {
  GIB,
  type MemoryFacts,
  machineBudgetGb,
  machineMemory,
  sliceBytes,
  userManagerControllers,
} from "./memory";
import {
  formatSince,
  holderLines,
  type LiveReading,
  oneDecimal,
  type ParsedHeld,
  parseHolder,
  shownHolder,
} from "./queue";
import { type LeaseStore, leaseStore, openSharedStore } from "./store";

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

/** One job a store holds or has waiting, as `/api/jobs` names it. */
export interface JobHolderItem {
  /** The command as a person reads it: `bunx tsc --noEmit`. */
  command: string;
  exclusive?: string;
  /** The folder the job runs in. */
  folder: string;
  gb: number;
  /** The kind, or "" for a job with only an exclusive name. */
  kind: string;
  pid: number;
  /** When it took its memory or joined the line (ISO 8601); null for an unreadable record. */
  since: null | string;
  /** The host name of the person or machine that holds it. */
  user: string;
  /** True: the store's text was not a record this version can read. */
  unknown?: true;
}

/** One store: this machine's, or a folder shared with other users or containers. */
export interface JobStoreState {
  budgetGb: number;
  freeGb: number;
  held: JobHolderItem[];
  /** Why this store could not be read; absent when it could. */
  note?: string;
  waiting: JobHolderItem[];
  /** "machine", or the shared folder's path. */
  where: string;
}

/** One cgroup weight on the heavy slices: its value, or why it is not in force. */
export interface JobWeightState {
  /** The weight a scope launch sets, 1 to 10000; null when it sets none. */
  value: null | number;
  /** Why no weight is in force; absent when one is. */
  why?: string;
}

/** The heavy slices' CPU and disk I/O weights: what the queue protects besides memory. */
export interface JobWeightsState {
  cpu: JobWeightState;
  io: JobWeightState;
}

/** `GET /api/jobs`'s answer: the queue, as data. */
export interface JobsAnswer {
  budgetGb: number;
  /** What is really free now; null where the machine does not say (macOS). */
  freeGb: null | number;
  /** GB kept for what never queues: the desktop, the sessions, MCP, dev servers, a database. */
  keptGb: number;
  memoryGb: number;
  stores: JobStoreState[];
  /** Under load, a job's CPU and disk I/O give way: the weights, or why one is not set. */
  weights: JobWeightsState;
}

/** One store as the reader found it (the private side of `JobStoreState`). */
export interface JobStoreRead {
  budgetGb: number;
  dir: string;
  freeGb: number;
  held: ParsedHeld[];
  label: string;
  note?: string;
  waiting: ParsedHeld[];
}

/** Everything one read of the queue found (the private side of `JobsAnswer`). */
export interface JobsRead {
  budget: { gb: number; keptGb: number; why: string };
  memory: { freeGb: null | number; limitDir: null | string; platform: string; totalGb: number };
  notes: string[];
  /** The heavy-job slice the config names, for the weight lines. */
  slice: string;
  stores: JobStoreRead[];
  weights: JobWeightsState;
}

/** The stores this machine uses: its own, then each shared folder, in that order. */
export interface OpenedStores {
  budget: { gb: number; why: string };
  machine: LeaseStore;
  notes: string[];
  shared: LeaseStore[];
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

/** One weight as the machine would carry it, and why it would not. */
function weightState(
  controller: "cpu" | "io",
  value: number,
  config: JobsMachineConfig,
  platform: string,
  controllers: string[] | null,
): JobWeightState {
  if (value === 0) return { value: null, why: "jobs.json turns it off." };
  if (platform !== "linux") {
    return { value: null, why: "only a Linux systemd user manager has weights." };
  }
  if (config.launch === "plain") {
    return { value: null, why: "jobs.json sets launch: plain." };
  }
  if (controllers === null) return { value: null, why: "no systemd user manager answers here." };
  if (!controllers.includes(controller)) {
    return {
      value: null,
      why: `the user manager was not given the ${controller} controller. An administrator adds ${controller} to Delegate= for user@.service, then restarts the user manager.`,
    };
  }
  return { value };
}

/**
 * The weights a scope launch puts on the slice chain, read from the machine: the user
 * manager's `cgroup.controllers` says whether the controller a weight needs was delegated.
 * A weight whose controller is missing is skipped at launch — systemd records the property
 * and writes nothing to the cgroup — so it is not reported as in force here.
 */
function weightsState(config: JobsMachineConfig, ctx: JobContext): JobWeightsState {
  const uid = process.getuid?.();
  const controllers =
    ctx.memory.platform === "linux" && uid !== undefined
      ? userManagerControllers(ctx.memory.read, uid)
      : null;
  return {
    cpu: weightState("cpu", cpuWeightOf(config), config, ctx.memory.platform, controllers),
    io: weightState("io", ioWeightOf(config), config, ctx.memory.platform, controllers),
  };
}

/** Opens this machine's store and every shared folder it is configured with. */
export function openStores(
  ctx: JobContext,
  config: JobsMachineConfig,
  onNote: (line: string) => void,
): OpenedStores {
  const dir = config.stateDir ?? jobsPaths(ctx.paths.home).stateDir;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    throw new Error(`The state folder ${dir} cannot be made (${code}).`);
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
    capacityGb: () => machineBudget(config, ctx.memory).gb,
    dir,
    label: "this machine",
    live,
    onNote,
    shared: false,
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
  return { budget, machine, notes, shared };
}

/** The words for a record the store holds: a job, or an unknown holder. */
function itemOf(entry: ParsedHeld): JobHolderItem {
  const record = entry.holder;
  if (record === null) {
    return {
      command: "",
      folder: "",
      gb: entry.gb,
      kind: "",
      pid: 0,
      since: null,
      unknown: true,
      user: "",
    };
  }
  return {
    command: record.what,
    ...(record.exclusive === undefined ? {} : { exclusive: record.exclusive }),
    folder: record.checkout,
    gb: entry.gb,
    kind: record.kind,
    pid: record.pid,
    since: new Date(record.since).toISOString(),
    user: record.person,
  };
}

/** One store's records, read; a store that cannot be read is a note, never a crash. */
async function readStore(store: LeaseStore): Promise<JobStoreRead> {
  const base: JobStoreRead = {
    budgetGb: 0,
    dir: store.dir,
    freeGb: 0,
    held: [],
    label: store.label,
    waiting: [],
  };
  let capacity: number;
  let held: ParsedHeld[];
  let waiting: ParsedHeld[];
  try {
    capacity = await store.capacityGb();
    held = (await store.held()).map((unit) => ({ gb: unit.gb, holder: parseHolder(unit.text) }));
    waiting = (await store.waiting())
      .map((unit) => ({ gb: unit.gb, holder: parseHolder(unit.text) }))
      .sort(
        (a, b) =>
          (a.holder?.since ?? Number.POSITIVE_INFINITY) -
          (b.holder?.since ?? Number.POSITIVE_INFINITY),
      );
  } catch (error) {
    return {
      ...base,
      note: `cannot be read (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  const heldGb = held.reduce((sum, unit) => sum + unit.gb, 0);
  return {
    ...base,
    budgetGb: capacity,
    freeGb: Math.max(0, capacity - heldGb),
    held,
    waiting,
  };
}

/**
 * Reads the queue: memory, budget, and every store's held and waiting jobs. Never throws for a
 * store that cannot be read (one note each); a broken `jobs.json` still throws, as the command
 * does, because nothing there can be judged.
 */
export async function readJobs(ctx: JobContext): Promise<JobsRead> {
  const config = loadJobsConfig(jobsPaths(ctx.paths.home).configFile);
  const notes: string[] = [];
  const opened = openStores(ctx, config, (line) => notes.push(line));
  const memory = machineMemory(ctx.memory);
  const stores: JobStoreRead[] = [];
  for (const store of [opened.machine, ...opened.shared]) stores.push(await readStore(store));
  return {
    budget: {
      gb: opened.budget.gb,
      keptGb: config.reserveGb ?? DEFAULT_RESERVE_GB,
      why: opened.budget.why,
    },
    memory: {
      freeGb: memory.availableBytes === null ? null : memory.availableBytes / GIB,
      limitDir: memory.limit?.dir ?? null,
      platform: ctx.memory.platform,
      totalGb: memory.totalBytes / GIB,
    },
    notes: [...notes, ...opened.notes],
    slice: config.slice ?? DEFAULT_SLICE,
    stores,
    weights: weightsState(config, ctx),
  };
}

/** What `GET /api/jobs` answers, and the `jobs` event carries: the shape, never the words. */
export function jobsAnswer(read: JobsRead): JobsAnswer {
  return {
    budgetGb: read.budget.gb,
    freeGb: read.memory.freeGb === null ? null : round(read.memory.freeGb),
    keptGb: read.budget.keptGb,
    memoryGb: round(read.memory.totalGb),
    stores: read.stores.map((store) => ({
      budgetGb: store.budgetGb,
      freeGb: store.freeGb,
      held: store.held.map(itemOf),
      ...(store.note === undefined ? {} : { note: store.note }),
      waiting: store.waiting.map(itemOf),
      where: store.label === "this machine" ? "machine" : store.dir,
    })),
    weights: read.weights,
  };
}

/** One decimal, as a number (the JSON carries a number, not a string). */
function round(gb: number): number {
  return Math.round(gb * 10) / 10;
}

/** What `job status` says where no memory group can be made (Windows). */
const WINDOWS_NO_CEILING =
  "No memory ceiling on this system: Windows has no memory group, so a heavy job runs as a plain child, and the queue is what keeps heavy jobs apart.";

/**
 * `job status`'s two priority lines: the weight a scope launch sets on the slice chain, or
 * why no weight is in force there. Weights, never quotas: an idle machine still gives a
 * job every core; under load the desktop, the sessions and the person's own work go first.
 */
function weightLines(read: JobsRead): string[] {
  const lines: string[] = [];
  for (const [name, state] of [
    ["CPU priority", read.weights.cpu],
    ["Disk I/O priority", read.weights.io],
  ] as const) {
    lines.push(
      state.value === null
        ? `${name}: not set: ${state.why ?? "no weight is in force."}`
        : `${name}: weight ${String(state.value)} on ${read.slice} and the slices above it (systemd's default is 100; the desktop and the sessions go first under load).`,
    );
  }
  return lines;
}

/**
 * `job status`'s lines, from the read: one home, so the command and the Machine page say the
 * same thing about the same machine.
 */
export function statusLines(read: JobsRead, home: string, now: number): string[] {
  const lines: string[] = [];
  const limit =
    read.memory.limitDir === null
      ? ""
      : ` (a memory limit of its group: ${tildify(read.memory.limitDir, home)})`;
  const free =
    read.memory.freeGb === null
      ? "free memory cannot be read on this system (no live check)"
      : `${oneDecimal(read.memory.freeGb)} GB free now`;
  lines.push(`Memory: ${oneDecimal(read.memory.totalGb)} GB${limit}, ${free}.`);
  lines.push(`Budget for heavy jobs here: ${read.budget.gb} GB (${read.budget.why}).`);
  if (read.memory.platform === "win32") lines.push(WINDOWS_NO_CEILING);
  lines.push(...weightLines(read));
  for (const store of read.stores) {
    const title =
      store.label === "this machine"
        ? `This machine (${tildify(store.dir, home)})`
        : `Shared folder ${store.dir}`;
    if (store.note !== undefined) {
      lines.push(`${title}: ${store.note}`);
      continue;
    }
    lines.push(`${title}: ${store.freeGb} of ${store.budgetGb} GB free`);
    lines.push(...holderLines(store.held, store.label, now));
    for (const record of store.waiting) {
      lines.push(
        record.holder === null
          ? `  ${store.label}: an unknown job waits`
          : `  ${store.label}: waits for ${record.holder.gb} GB: ${shownHolder(record.holder)}, since ${formatSince(record.holder.since, now)} (pid ${record.holder.pid})`,
      );
    }
    if (store.held.length === 0 && store.waiting.length === 0) {
      lines.push("  nothing held, nobody waits");
    }
  }
  lines.push(...read.notes);
  return lines;
}

/**
 * A cheap reading of the queue's folders: each lease and ticket file's name, size and mtime.
 * The live stream polls it and builds `readJobs` only when it changes, so an idle queue costs
 * a folder listing, not a memory read and a process scan. Never throws.
 */
export function jobsFingerprint(home: string): string {
  let dirs: string[];
  try {
    const config = loadJobsConfig(jobsPaths(home).configFile);
    dirs = [config.stateDir ?? jobsPaths(home).stateDir, ...(config.sharedDirs ?? [])];
  } catch {
    dirs = [jobsPaths(home).stateDir];
  }
  const parts: string[] = [];
  for (const dir of dirs) {
    for (const sub of ["leases", "tickets"]) {
      const folder = join(dir, sub);
      let names: string[];
      try {
        names = readdirSync(folder).sort();
      } catch {
        parts.push(`${folder}:-`);
        continue;
      }
      for (const name of names) {
        try {
          const stat = statSync(join(folder, name));
          parts.push(`${folder}/${name}:${stat.size}:${stat.mtimeMs}`);
        } catch {
          parts.push(`${folder}/${name}:gone`);
        }
      }
    }
  }
  return parts.join("|");
}
