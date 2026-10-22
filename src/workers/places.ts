/**
 * Whether a new worker starts now or waits in the queue: the phases it waits for, the two caps
 * of running workers on this machine (D37), and the free memory. `worker start` decides it once and
 * returns at once either way (D25); a queued worker is started later by its lead's watch
 * (`worker watch`, a later phase), oldest first.
 *
 * - **Its phases** (`--waits-for`): each must be `done` or `merged` in the same repository — the
 *   newest record of that phase counts, so a hand-off's next worker or a second try is the one
 *   read. `removed` counts as finished too: `worker rm` refuses a branch the lead has not merged.
 * - **Two caps** (D37). `workflow.workers.max` counts every worker of every repository on this
 *   machine (the store of each, `listAllWorkers`) whose session holds a place: `starting`,
 *   `working`, `blocked`, `paused`, `quiet`. `workflow.workers.maxOpus` counts those of them on
 *   the opus tier — the tier their model's name stands for, recorded at launch (`model.tier`):
 *   the opus kinds, or an override onto opus — and holds back only a new opus-tier worker. The
 *   store alone decides, so a start never waits on a `claude agents` read; `worker watch` keeps
 *   the states true from agent view. A worker that finds a free place takes it, also while older
 *   ones wait: their own lead's watch starts them.
 * - **The memory** (`workflow.workers.memoryGb`): the memory free now, less what heavy jobs
 *   reserved and have not used yet (the job queue's own reading, `notYetUsedGb`), must be at least
 *   that much. Where free memory cannot be read (macOS), only the cap counts.
 *
 * Two starts at once never both take the last place: the decision and the new record are made
 * under one machine-wide lock (`withPlacesLock`), which the watch takes too when it starts one.
 */
import { mkdirSync } from "node:fs";
import { DEFAULT_SLICE, jobsPaths, loadJobsConfig } from "../jobs/config";
import { GIB, type MemoryFacts, machineMemory, sliceBytes } from "../jobs/memory";
import { notYetUsedGb, oneDecimal } from "../jobs/queue";
import { leaseStore } from "../jobs/store";
import { withLock } from "../setup/lock";
import { type WorkerRecord, type WorkerState, workersRootDir } from "./store";

/** The states in which a worker holds a place on the machine: its session lives, its phase is open. */
export const RUNNING_STATES: readonly WorkerState[] = [
  "starting",
  "working",
  "blocked",
  "paused",
  "quiet",
];

/**
 * The states in which a phase another worker waits for counts as finished: **`merged` or
 * `removed` only.** A worker that finished its phase (`done`) has not given the lead anything
 * to merge yet, and a dependent phase that branched from the lead's branch before the merge
 * would miss the work it waits for. So a phase counts as finished when the lead merged it (or
 * the worker was removed, which only happens after the merge).
 */
export const FINISHED_STATES: readonly WorkerState[] = ["merged", "removed"];

/** How long a start waits for another start's decision: a decision takes milliseconds. */
export const PLACES_LOCK_WAIT_MS = 5_000;

/** The workers that hold a place now. */
export function runningWorkers(records: readonly WorkerRecord[]): WorkerRecord[] {
  return records.filter((one) => (RUNNING_STATES as readonly string[]).includes(one.state));
}

/** One phase a worker waits for, and where it is: its newest worker's state, or none yet. */
export interface Wait {
  phase: string;
  state: null | string;
}

/**
 * The phases of `waitsFor` that are not finished in `repoRecords` (one repository's workers):
 * each phase's newest record counts; a phase with no worker yet is not finished.
 */
export function unmetWaits(
  waitsFor: readonly string[],
  repoRecords: readonly WorkerRecord[],
): Wait[] {
  const unmet: Wait[] = [];
  for (const phase of waitsFor) {
    const newest = repoRecords
      .filter((one) => one.phase === phase)
      .reduce<WorkerRecord | null>(
        (last, one) => (last === null || one.createdAt >= last.createdAt ? one : last),
        null,
      );
    if (newest !== null && (FINISHED_STATES as readonly string[]).includes(newest.state)) continue;
    unmet.push({ phase, state: newest?.state ?? null });
  }
  return unmet;
}

/** What a new worker does: start now, or wait in the queue and why (one short clause). */
export type Place = { start: true } | { start: false; why: string };

/** The tier the opus cap counts (D37): the tier a worker's model name stands for. */
export const OPUS_TIER = "opus";

/** The running workers on the opus tier (`model.tier`, recorded at launch). */
export function onOpusTier(records: readonly WorkerRecord[]): WorkerRecord[] {
  return records.filter((one) => one.model.tier === OPUS_TIER);
}

/** What the decision reads. */
export interface PlaceInput {
  /** The workers that hold a place on this machine now (`runningWorkers`). */
  running: number;
  /** How many of them run on the opus tier (`onOpusTier`). */
  runningOpus: number;
  /** `workflow.workers.max`: every worker on this machine (D37). */
  max: number;
  /** `workflow.workers.maxOpus`: the opus-tier ones among them (D37). */
  maxOpus: number;
  /** True when the new worker runs on the opus tier. */
  opus: boolean;
  /** The memory a worker may use now, in GB; null where it cannot be read. */
  freeGb: null | number;
  /** `workflow.workers.memoryGb`. */
  needGb: number;
  /** Its phases that are not finished yet. */
  unmet: readonly Wait[];
}

/** The decision: its phases first, then the cap of all workers, the opus cap, the memory. Pure. */
export function placeFor(input: PlaceInput): Place {
  if (input.unmet.length > 0) {
    const phases = input.unmet
      .map((wait) => `${wait.phase} (${wait.state ?? "not started yet"})`)
      .join(", ");
    return { start: false, why: `waits for ${phases}; it starts when each is merged` };
  }
  if (input.running >= input.max) {
    return {
      start: false,
      why: `${input.running} of ${input.max} running; it starts when one finishes`,
    };
  }
  if (input.opus && input.runningOpus >= input.maxOpus) {
    return {
      start: false,
      why: `${input.runningOpus} of ${input.maxOpus} opus workers running; it starts when one of them finishes`,
    };
  }
  if (input.freeGb !== null && input.freeGb < input.needGb) {
    return {
      start: false,
      why: `${oneDecimal(Math.max(0, input.freeGb))} GB free, a worker needs ${input.needGb} GB; it starts when memory frees`,
    };
  }
  return { start: true };
}

/**
 * Runs `decide` holding the machine-wide places lock, `<stateDir>/workers/lock` (the stores'
 * root, `workersRootDir`; each repository's own store lock sits one folder down).
 */
export async function withPlacesLock<T>(
  stateDir: string,
  decide: () => Promise<T> | T,
): Promise<T> {
  const root = workersRootDir(stateDir);
  mkdirSync(root, { mode: 0o700, recursive: true });
  return await withLock(root, decide, { waitMs: PLACES_LOCK_WAIT_MS });
}

/**
 * The memory a new worker may use now, in GB: the memory free now (`machineMemory`, the job
 * queue's reading, cgroup ceilings included) less what heavy jobs on this machine reserved and
 * have not used yet (`notYetUsedGb`). Null where free memory cannot be read. A `jobs.json` that
 * cannot be used counts no reservation: the plain free memory decides.
 */
export async function freeForWorkersGb(home: string, memory: MemoryFacts): Promise<null | number> {
  const reading = machineMemory(memory);
  if (reading.availableBytes === null) return null;
  const freeGb = reading.availableBytes / GIB;
  let config: ReturnType<typeof loadJobsConfig>;
  try {
    config = loadJobsConfig(jobsPaths(home).configFile);
  } catch {
    // `job status` names a broken jobs.json; here the reservations are only unknown.
    return freeGb;
  }
  const store = leaseStore({
    capacityGb: () => 0,
    dir: config.stateDir ?? jobsPaths(home).stateDir,
    label: "this machine",
    shared: false,
  });
  const heldGb = (await store.held()).reduce((sum, one) => sum + one.gb, 0);
  const uid = process.getuid?.();
  const slice =
    uid === undefined || config.launch === "plain"
      ? null
      : sliceBytes(memory.read, uid, config.slice ?? DEFAULT_SLICE);
  return freeGb - notYetUsedGb(heldGb, slice);
}
