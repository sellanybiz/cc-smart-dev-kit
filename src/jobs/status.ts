/**
 * The heavy-job queue as data: how many slots are in use, who holds them, who waits, the
 * memory ceiling and the CPU and disk I/O weights the heavy slices carry — on this machine and
 * on each shared folder — and whether heavy commands go through the queue in the folder asked
 * about (the resolved job route: the project's `jobs.route`, else the person's
 * `switches.jobRoute`, else off; one resolver, `resolveJobRoute`).
 *
 * One reader, three readers of it: `job status` prints its lines, `GET /api/jobs` answers its
 * shape, and the Machine page shows the same facts the command prints. Before this module,
 * `job status` built the lines directly and the portal could only show the printed text; a
 * second parser of those lines would have drifted the moment a line changed. `commands.ts`
 * calls `readJobs` and `statusLines`; nothing parses a line.
 *
 * The shape `/api/jobs` answers (`JobsAnswer`) is this module's public one: `since` is ISO
 * 8601, and a record the store cannot read is `unknown: true` with empty words rather than a
 * guess. `statusLines` also uses the private fields here (the ceiling's reason, the memory
 * limit, the raw records for the lines), which no page needs.
 */

import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { resolveProject } from "../project/resolve";
import { resolveJobRoute, type WorkflowSource } from "../workflow/resolve";
import {
  cpuWeightOf,
  DEFAULT_LIGHT_JOBS,
  DEFAULT_RESERVE_GB,
  DEFAULT_SLICE,
  DEFAULT_START_FREE_GB,
  FALLBACK_CPU_WEIGHT,
  ioWeightOf,
  type JobsMachineConfig,
  jobsPaths,
  loadJobsConfig,
  maxJobsOf,
} from "./config";
import { idleMarkerState, idleUnsupportedPath, readSystemdVersion } from "./launch";
import {
  GIB,
  type MemoryFacts,
  machineMemory,
  memoryCeilingGb,
  userManagerControllers,
} from "./memory";
import {
  formatSince,
  heldLane,
  holderLines,
  type JobLane,
  laneUsed,
  type MemoryAdmission,
  oneDecimal,
  type ParsedHeld,
  parseHolder,
  shownHolder,
  slotsText,
} from "./queue";
import { type LeaseStore, leaseStore, openSharedStore } from "./store";

/** What the commands need from the outside; a test passes its own. */
export interface JobContext {
  paths: CliPaths;
  cwd: string;
  /** The bun options this process started with: `--no-env-file` must be there. */
  execArgv: readonly string[];
  memory: MemoryFacts;
  /** The user whose systemd manager is asked about its controllers. Default: this process's user. */
  uid?: number | undefined;
  /** Lines for the person: waiting lines, notes. */
  say: (line: string) => void;
  /** `job status` and `job kinds` print here. */
  print: (line: string) => void;
  now?: () => number;
  /** The launcher's version-aware marker reader; injected to keep status tests pure. */
  idleUnsupported?: () => boolean;
}

/** One job a store holds or has waiting, as `/api/jobs` names it. */
export interface JobHolderItem {
  /** The command as a person reads it: `bunx tsc --noEmit`. */
  command: string;
  exclusive?: string;
  /** The folder the job runs in. */
  folder: string;
  /** The kind, or "" for a job with only an exclusive name. */
  kind: string;
  pid: number;
  /** When it took its slot or joined the line (ISO 8601); null for an unreadable record. */
  since: null | string;
  /** Which slots it holds or waits for (D74): a heavy one, a light one, or none (a name only). */
  lane: JobLane;
  /** Does it hold (or wait for) a slot? False: a name only (`--exclusive` without a kind). */
  slot: boolean;
  /** The host name of the person or machine that holds it. */
  user: string;
  /** True: the store's text was not a record this version can read. */
  unknown?: true;
}

/** One store: this machine's, or a folder shared with other users or containers. */
export interface JobStoreState {
  held: JobHolderItem[];
  /** Why this store could not be read; absent when it could. */
  note?: string;
  /** How many heavy jobs run at once here: `maxJobs`, or the shared folder's `max-jobs`. */
  slots: number;
  /** How many of those slots are in use now. */
  used: number;
  waiting: JobHolderItem[];
  /** "machine", or the shared folder's path. */
  where: string;
}

/** One cgroup weight on the heavy slices: its value, or why it is not in force. */
export interface JobWeightState {
  /** The weight a scope launch sets, 1 to 10000; null when it sets none. */
  value: null | number | "idle";
  /** Why no weight is in force; absent when one is. */
  why?: string;
}

/** The heavy slices' CPU and disk I/O weights: what the queue asks of the machine besides slots. */
export interface JobWeightsState {
  cpu: JobWeightState;
  io: JobWeightState;
}

/** The memory ceiling of all heavy jobs together: its size, or why none is in force. */
export interface JobCeilingState {
  /** The ceiling in GB a scope launch sets on the heavy slice; null when it sets none. */
  gb: null | number;
  /** Where the number comes from, or why no ceiling is in force. */
  why: string;
}

/**
 * Whether a heavy Bash command goes through the queue in the folder asked about, and where that
 * comes from: the project's `jobs.route` (`project`), the person's `switches.jobRoute`
 * (`personal`), or neither (`default`: off). The same answer the `job-route` hook gets.
 */
export interface JobRouteState {
  on: boolean;
  /**
   * The project the answer is for; null outside one (the portal runs in the home folder): then
   * it is what a project that sets no `jobs.route` gets.
   */
  project: null | string;
  source: WorkflowSource;
}

/** `GET /api/jobs`'s answer: the queue, as data. */
export interface JobsAnswer {
  /** This machine's free memory now (null: unreadable here), and what a job needs to start. */
  admission: MemoryAdmission;
  ceiling: JobCeilingState;
  /** This machine's light slots (D74): how many, and how many are in use. */
  lightJobs: { slots: number; used: number };
  memoryGb: number;
  /** The resolved job route for the folder the reader runs in. */
  route: JobRouteState;
  stores: JobStoreState[];
  /** The CPU and disk I/O weights, or why one is not set. */
  weights: JobWeightsState;
}

/** One store as the reader found it (the private side of `JobStoreState`). */
export interface JobStoreRead {
  dir: string;
  held: ParsedHeld[];
  label: string;
  note?: string;
  slots: number;
  waiting: ParsedHeld[];
}

/** Everything one read of the queue found (the private side of `JobsAnswer`). */
export interface JobsRead {
  /** Valid idle-refusal marker, only when idle CPU priority is requested and available. */
  idleRefusalFile?: string;
  ceiling: JobCeilingState;
  /** This machine's `maxJobs`, and whether `jobs.json` sets it. */
  maxJobs: { set: boolean; slots: number };
  /** This machine's light slots: from `jobs.json` or the default, and the leases that use one. */
  lightJobs: { slots: number; used: number };
  /** The free-memory rule a job starts under (`queue.ts` › FREE MEMORY). */
  admission: MemoryAdmission;
  memory: { limitDir: null | string; platform: string; totalGb: number };
  notes: string[];
  route: JobRouteState;
  /** The heavy-job slice the config names, for the ceiling and weight lines. */
  slice: string;
  stores: JobStoreRead[];
  weights: JobWeightsState;
}

/** The stores this machine uses: its own, then each shared folder, in that order. */
export interface OpenedStores {
  /** The memory ceiling for the heavy slice, in GB (set only where a scope launch runs). */
  ceilingGb: number;
  machine: LeaseStore;
  notes: string[];
  shared: LeaseStore[];
}

/** The memory ceiling this machine's config asks for, and how it is worked out. */
function machineCeiling(
  config: JobsMachineConfig,
  memory: MemoryFacts,
): { gb: number; why: string } {
  if (config.budgetGb !== undefined) return { gb: config.budgetGb, why: "set in jobs.json" };
  const reserve = config.reserveGb ?? DEFAULT_RESERVE_GB;
  const total = machineMemory(memory).totalBytes;
  return {
    gb: memoryCeilingGb(total, reserve),
    why: `${Math.floor(total / GIB)} GB of memory less ${reserve} GB kept for everything else`,
  };
}

/** The reason no scope launch (so no ceiling and no weight) happens here, or null when one does. */
function noScopeWhy(
  platform: string,
  config: JobsMachineConfig,
  controllers: string[] | null,
): string | null {
  if (platform === "win32") {
    return "Windows has no memory group, so a heavy job runs as a plain child, and the queue is what keeps heavy jobs apart.";
  }
  if (platform !== "linux") return "only a Linux systemd user manager has a memory ceiling.";
  if (config.launch === "plain") return "jobs.json sets launch: plain.";
  if (controllers === null) return "no systemd user manager answers here.";
  return null;
}

/** The ceiling as the machine would carry it, and why it would not. */
function ceilingState(
  config: JobsMachineConfig,
  platform: string,
  controllers: string[] | null,
  ceiling: { gb: number; why: string },
): JobCeilingState {
  const why = noScopeWhy(platform, config, controllers);
  if (why !== null) return { gb: null, why };
  if (controllers !== null && !controllers.includes("memory")) {
    return {
      gb: null,
      why: "the user manager was not given the memory controller. An administrator adds memory to Delegate= for user@.service, then restarts the user manager.",
    };
  }
  return { gb: ceiling.gb, why: ceiling.why };
}

/** One weight as the machine would carry it, and why it would not. */
function weightState(
  controller: "cpu" | "io",
  value: number | "idle" | "off",
  config: JobsMachineConfig,
  platform: string,
  controllers: string[] | null,
): JobWeightState {
  if (value === 0 || value === "off") {
    // Off is the default. Only a Linux slice carries a weight at all: elsewhere there is nothing
    // to ask for, so the line says so instead of offering a command that would change nothing.
    if (platform !== "linux") {
      return { value: null, why: "only a Linux systemd user manager has weights." };
    }
    return {
      value: null,
      why: `a job runs at systemd's own weight (100). ${COMMAND} job set ${controller}-weight <1-10000> asks for another.`,
    };
  }
  const why = noScopeWhy(platform, config, controllers);
  if (why !== null) return { value: null, why };
  if (controllers !== null && !controllers.includes(controller)) {
    return {
      value: null,
      why: `the user manager was not given the ${controller} controller. An administrator adds ${controller} to Delegate= for user@.service, then restarts the user manager.`,
    };
  }
  return { value };
}

/** What the user manager was given, read once: null when it cannot be read here. */
function managerControllers(ctx: JobContext): string[] | null {
  const uid = ctx.uid ?? process.getuid?.();
  return ctx.memory.platform === "linux" && uid !== undefined
    ? userManagerControllers(ctx.memory.read, uid)
    : null;
}

/**
 * The weights a scope launch puts on the slice chain, read from the machine: the user
 * manager's `cgroup.controllers` says whether the controller a weight needs was delegated.
 * A weight whose controller is missing is skipped at launch — systemd records the property
 * and writes nothing to the cgroup — so it is not reported as in force here.
 */
function weightsState(
  config: JobsMachineConfig,
  platform: string,
  controllers: string[] | null,
): JobWeightsState {
  return {
    cpu: weightState("cpu", cpuWeightOf(config), config, platform, controllers),
    io: weightState("io", ioWeightOf(config), config, platform, controllers),
  };
}

/**
 * The job route for the folder `ctx.cwd`: the project's file there over the person's own file.
 * A project file that cannot be used is a note, and the answer is then the person's default (the
 * hook itself asks before a heavy command there).
 */
function routeState(ctx: JobContext, notes: string[]): JobRouteState {
  let project: ReturnType<typeof resolveProject> = null;
  try {
    project = resolveProject(ctx.cwd);
  } catch (error) {
    notes.push(
      `The job route here is not known: the project's file does not load, so the job-route hook asks before a heavy command there. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const route = resolveJobRoute(ctx.paths, project?.config ?? null);
  return { on: route.value, project: project?.root ?? null, source: route.source };
}

/** Opens this machine's store and every shared folder it is configured with. */
/** This machine's free memory now, and the free GB a job needs to start (`startFreeGb`). */
export function memoryAdmissionOf(config: JobsMachineConfig, memory: MemoryFacts): MemoryAdmission {
  const available = machineMemory(memory).availableBytes;
  return {
    freeGb: available === null ? null : available / GIB,
    startFreeGb: config.startFreeGb ?? DEFAULT_START_FREE_GB,
  };
}

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
  const machine = leaseStore({
    capacity: () => maxJobsOf(config),
    lightCapacity: () => config.lightJobs ?? DEFAULT_LIGHT_JOBS,
    memoryAdmission: () => memoryAdmissionOf(config, ctx.memory),
    dir,
    label: "this machine",
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
  return { ceilingGb: machineCeiling(config, ctx.memory).gb, machine, notes, shared };
}

/** The words for a record the store holds: a job, or an unknown holder. */
function itemOf(entry: ParsedHeld): JobHolderItem {
  const record = entry.holder;
  if (record === null) {
    return {
      command: "",
      folder: "",
      kind: "",
      lane: heldLane(entry),
      pid: 0,
      since: null,
      slot: entry.slot,
      unknown: true,
      user: "",
    };
  }
  return {
    command: record.what,
    ...(record.exclusive === undefined ? {} : { exclusive: record.exclusive }),
    folder: record.checkout,
    kind: record.kind,
    lane: heldLane(entry),
    pid: record.pid,
    since: new Date(record.since).toISOString(),
    slot: entry.slot,
    user: record.person,
  };
}

/**
 * Oldest first, an unreadable record last: the order a person reads who holds the slots, and the
 * order the waiting line goes in. The folder lists files in no order of its own.
 */
function bySince(a: ParsedHeld, b: ParsedHeld): number {
  const first = a.holder?.since ?? Number.POSITIVE_INFINITY;
  const second = b.holder?.since ?? Number.POSITIVE_INFINITY;
  return first < second ? -1 : first > second ? 1 : 0;
}

/** One store's records, read; a store that cannot be read is a note, never a crash. */
async function readStore(store: LeaseStore): Promise<JobStoreRead> {
  const base: JobStoreRead = {
    dir: store.dir,
    held: [],
    label: store.label,
    slots: 0,
    waiting: [],
  };
  let slots: number;
  let held: ParsedHeld[];
  let waiting: ParsedHeld[];
  try {
    slots = await store.capacity();
    held = (await store.held())
      .map((unit) => ({ holder: parseHolder(unit.text), slot: unit.slot }))
      .sort(bySince);
    waiting = (await store.waiting())
      .map((unit) => ({ holder: parseHolder(unit.text), slot: unit.slot }))
      .sort(bySince);
  } catch (error) {
    return {
      ...base,
      note: `cannot be read (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  return { ...base, held, slots, waiting };
}

/**
 * Reads the queue: memory, the ceiling, and every store's held and waiting jobs. Never throws
 * for a store that cannot be read (one note each); a broken `jobs.json` still throws, as the
 * command does, because nothing there can be judged.
 */
export async function readJobs(ctx: JobContext): Promise<JobsRead> {
  const config = loadJobsConfig(jobsPaths(ctx.paths.home).configFile);
  const notes: string[] = [];
  const opened = openStores(ctx, config, (line) => notes.push(line));
  const memory = machineMemory(ctx.memory);
  const machine = await readStore(opened.machine);
  const stores: JobStoreRead[] = [machine];
  for (const store of opened.shared) stores.push(await readStore(store));
  const controllers = managerControllers(ctx);
  const route = routeState(ctx, notes);
  const weights = weightsState(config, ctx.memory.platform, controllers);
  const stateDir = jobsPaths(ctx.paths.home).stateDir;
  // A read only: a stale marker is left for the next launch to remove (`idleMarkerState`).
  const idleUnsupported =
    ctx.idleUnsupported ??
    (() => idleMarkerState(idleUnsupportedPath(stateDir), readSystemdVersion) === "valid");
  return {
    ...(weights.cpu.value === "idle" && idleUnsupported?.()
      ? { idleRefusalFile: idleUnsupportedPath(stateDir) }
      : {}),
    ceiling: ceilingState(
      config,
      ctx.memory.platform,
      controllers,
      machineCeiling(config, ctx.memory),
    ),
    maxJobs: { set: config.maxJobs !== undefined, slots: maxJobsOf(config) },
    lightJobs: {
      slots: config.lightJobs ?? DEFAULT_LIGHT_JOBS,
      used: laneUsed(machine.held, "light"),
    },
    admission: memoryAdmissionOf(config, ctx.memory),
    memory: {
      limitDir: memory.limit?.dir ?? null,
      platform: ctx.memory.platform,
      totalGb: memory.totalBytes / GIB,
    },
    notes: [...notes, ...opened.notes],
    route,
    slice: config.slice ?? DEFAULT_SLICE,
    stores,
    weights,
  };
}

/** What `GET /api/jobs` answers, and the `jobs` event carries: the shape, never the words. */
export function jobsAnswer(read: JobsRead): JobsAnswer {
  return {
    ceiling: read.ceiling,
    memoryGb: round(read.memory.totalGb),
    lightJobs: read.lightJobs,
    admission: read.admission,
    route: read.route,
    stores: read.stores.map((store) => ({
      held: store.held.map(itemOf),
      ...(store.note === undefined ? {} : { note: store.note }),
      slots: store.slots,
      used: laneUsed(store.held, "heavy"),
      waiting: store.waiting.map(itemOf),
      where: store.label === "this machine" ? "machine" : store.dir,
    })),
    weights: read.weights,
  };
}

/** `job status`'s free-memory line: what a job needs to start, and what is free now. */
function admissionLine(admission: MemoryAdmission): string {
  const free =
    admission.freeGb === null
      ? "free memory cannot be read here, so it holds no job"
      : `${oneDecimal(admission.freeGb)} GB is free now`;
  return `A job starts with ${oneDecimal(admission.startFreeGb)} GB of memory free, or when no other job runs; ${free}. Change it with: ${COMMAND} job set start-free-gb <n>`;
}

/** One decimal, as a number (the JSON carries a number, not a string). */
function round(gb: number): number {
  return Math.round(gb * 10) / 10;
}

/**
 * `job status`'s two priority lines: the weight a scope launch sets on the slice chain, or
 * why no weight is in force there. Weights, never quotas: an idle machine still gives a
 * job every core.
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
        : state.value === "idle"
          ? read.idleRefusalFile !== undefined
            ? `${name}: this systemd refuses idle; jobs use weight ${FALLBACK_CPU_WEIGHT} instead. Remove ${read.idleRefusalFile} to try idle again.`
            : `${name}: idle (the default): a heavy job gets the CPU only when nothing else wants it. ${COMMAND} job set cpu-weight off turns it off.`
          : `${name}: weight ${String(state.value)} on ${read.slice} and the slices above it (systemd's default is 100; under load a heavy job gives way to the rest of the machine).`,
    );
  }
  return lines;
}

/** The line that says how the heavy jobs together are held to the memory kept for the rest. */
function ceilingLine(read: JobsRead): string {
  const { gb, why } = read.ceiling;
  return gb === null
    ? `Memory ceiling for heavy jobs: none: ${why}`
    : `Memory ceiling for all heavy jobs together: ${gb} GB (${why}), on ${read.slice}. A job over it is stopped, and the memory kept for everything else stays free.`;
}

/** Where a resolved route comes from, as a person reads it. */
const ROUTE_SOURCE: Readonly<Record<WorkflowSource, string>> = {
  default: "the default",
  personal: "your own switches.jobRoute",
  project: "the project's jobs.route",
};

/** The line that says whether heavy commands go through the queue here, and why. */
export function routeLine(route: JobRouteState, home: string): string {
  const where =
    route.project === null
      ? "Job route for a project that sets none"
      : `Job route in ${tildify(route.project, home)}`;
  const state = route.on
    ? "on: a heavy Bash command waits for a slot in this queue"
    : "off: a heavy command runs raw, outside the queue";
  const turnOn =
    !route.on && route.source !== "project"
      ? ` Turn it on for every project with: ${COMMAND} workflow set switches.jobRoute true`
      : "";
  return `${where}: ${state} (${ROUTE_SOURCE[route.source]}).${turnOn}`;
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
  lines.push(`Memory: ${String(Math.round(read.memory.totalGb * 10) / 10)} GB${limit}.`);
  lines.push(ceilingLine(read));
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
    lines.push(`${title}: ${laneUsed(store.held, "heavy")} of ${slotsText(store.slots)} in use`);
    lines.push(...holderLines(store.held, store.label, now));
    for (const record of store.waiting) {
      lines.push(
        record.holder === null
          ? `  ${store.label}: an unknown job waits`
          : `  ${store.label}: waits for ${record.slot ? "a slot" : "its turn"}: ${shownHolder(record.holder)}, since ${formatSince(record.holder.since, now)} (pid ${record.holder.pid})`,
      );
    }
    if (store.held.length === 0 && store.waiting.length === 0) {
      lines.push("  nothing held, nobody waits");
    }
  }
  lines.push(
    `Heavy jobs at once on this machine: ${read.maxJobs.slots} (${read.maxJobs.set ? "set in jobs.json" : "the default"}). Change it with: ${COMMAND} job set max-jobs <n>`,
  );
  lines.push(
    `Light jobs at once on this machine: ${read.lightJobs.slots}, ${read.lightJobs.used} in use. Change it with: ${COMMAND} job set light-jobs <n>`,
  );
  lines.push(admissionLine(read.admission));
  lines.push(routeLine(read.route, home));
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
