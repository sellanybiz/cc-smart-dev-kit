/**
 * Whether a new crew session starts now or waits in the queue: the phases it waits for, its
 * lead's caps, the machine's guards, and the free memory. `crew start` decides it once and
 * returns at once either way (D25); a queued crew session is started later by its lead's watch
 * (`crew watch`), oldest first.
 *
 * - **Its phases** (`--waits-for`): each must be `merged` in the same repository — the newest
 *   record of that phase counts, so a hand-off's next crew session or a second try is the one
 *   read. A `removed` crew session counts only when it was `merged` before its removal
 *   (`mergedBeforeRemoval`, kept by the store): `crew rm` also removes a phase whose work was
 *   never merged — a queued one, or one that failed before it committed — and that removal
 *   releases nothing, because the work a dependent builds on is not there.
 * - **Its lead's caps** (D54). The crew sessions of one lead — the session that started them,
 *   `leadSessionId` — hold a place while their session lives: `starting`, `working`, `blocked`,
 *   `paused`, `quiet` (`RUNNING_STATES`). `workflow.crew.perLead` bounds all of one lead's,
 *   in every repository on this machine; `workflow.crew.perLeadOpus` bounds those of them on
 *   the opus tier — the tier their model's name stands for, recorded at launch (`model.tier`):
 *   the opus kinds, or an override onto opus — and holds back only a new opus-tier crew session.
 *   So one lead can never take every place and starve the others: the owner runs about a dozen
 *   leads at once.
 * - **The machine's guards.** `workflow.crew.max` is a safety ceiling no lead reaches alone;
 *   `workflow.crew.maxOpus`, when the person sets it, is a machine-wide opus ceiling on top of
 *   each lead's own (D37's cap, now optional). The 5-hour usage window (D54): past
 *   `workflow.crew.usagePercent` a new opus-tier crew session waits, unless the gateway's opus
 *   slot has a chain with its fallback on (`usage-guard.ts`); a window that cannot be read never
 *   holds.
 * - **The memory** (`workflow.crew.memoryGb`): the memory free now (the job queue's own reading
 *   of the machine, `machineMemory`) must be at least that much. Where free memory cannot be
 *   read (macOS), only the caps count.
 * - **The CPU** (`workflow.crew.loadPerCore`): while the 1-minute load average is above that
 *   many for each core (`src/machine/load.ts`), a start waits — 24 crew sessions once drove a
 *   16-core machine to a load of 85 with plenty of memory free. Where the platform gives no load
 *   average (native Windows), the hold does not apply.
 *
 * The store alone decides, so a start never waits on a `claude agents` read; `crew watch` keeps
 * the states true from agent view. A crew session that finds a free place takes it, also while
 * older ones wait: their own lead's watch starts them. Two starts at once never both take the
 * last place: the decision and the new record are made under one machine-wide lock
 * (`withPlacesLock`), which the watch takes too when it starts one.
 *
 * **The same decision, asked by a lead's guard** (D59): `placeForLeadStart` answers what a
 * `crew start` from one lead would do now, from the same input `startPlanned` builds — so the
 * guard refuses a building subagent exactly while the queue would hold its phase, and never
 * carries a second copy of a cap.
 */
import { mkdirSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { GIB, type MemoryFacts, machineMemory } from "../jobs/memory";
import { oneDecimal } from "../jobs/queue";
import { type LoadFacts, type LoadReading, loadLimit, machineLoad } from "../machine/load";
import { type Checkout, loadProjectConfig } from "../project/resolve";
import { withLock } from "../setup/lock";
import type { ResolvedWorkflow } from "../workflow/resolve";
import { resolveWorkflow } from "../workflow/resolve";
import {
  type CrewRecord,
  type CrewState,
  crewRootDir,
  listAllCrew,
  resumeClaimHeld,
} from "./store";
import { crewSettingsFolder, usageFacts } from "./usage-guard";

/** The states in which a crew session holds a place on the machine: its session lives, its phase is open. */
export const RUNNING_STATES: readonly CrewState[] = [
  "starting",
  "working",
  "blocked",
  "paused",
  "quiet",
];

/**
 * The states in which a phase another crew session waits for can count as finished: **`merged` or
 * `removed` only.** A crew session that finished its phase (`done`) has not given the lead anything
 * to merge yet, and a dependent phase that branched from the lead's branch before the merge
 * would miss the work it waits for. A `removed` record counts only when the lead had merged its
 * work before the removal (`finishesWait`): a removal is no proof of a merge.
 */
export const FINISHED_STATES: readonly CrewState[] = ["merged", "removed"];

/**
 * True when `record`'s phase is finished for a crew session that waits for it: the lead merged
 * its branch, or it was removed after that merge. A `removed` crew session whose work the lead
 * never merged releases nothing — a dependent that started from it would build on work that is
 * not on the lead's branch.
 */
export function finishesWait(record: CrewRecord): boolean {
  if (!(FINISHED_STATES as readonly string[]).includes(record.state)) return false;
  return record.state === "merged" || record.mergedBeforeRemoval === true;
}

/** How long a start waits for another start's decision: a decision takes milliseconds. */
export const PLACES_LOCK_WAIT_MS = 5_000;

/** The crew sessions that hold a place now. */
export function runningCrew(records: readonly CrewRecord[]): CrewRecord[] {
  return records.filter((one) => (RUNNING_STATES as readonly string[]).includes(one.state));
}

/**
 * The crew sessions of one lead that hold a place now, in every repository on this machine
 * (D54). A record with no lead field belongs to no lead: it counts toward the machine's ceiling
 * and never against someone's cap.
 */
export function runningForLead(
  records: readonly CrewRecord[],
  leadSessionId: string,
): CrewRecord[] {
  if (leadSessionId === "") return [];
  return runningCrew(records).filter(
    (one) => typeof one.leadSessionId === "string" && one.leadSessionId === leadSessionId,
  );
}

/** One phase a crew session waits for, and where it is: its newest crew session's state, or none yet. */
export interface Wait {
  phase: string;
  state: null | string;
  /**
   * The phase's newest crew session, when it was removed before the lead merged its work: its id
   * and its name, so the lead's watch can say which one and that the wait will not lift by
   * itself. Absent in every other case.
   */
  removedUnmerged?: { id: string; name: string };
}

/**
 * The phases of `waitsFor` that are not finished in `repoRecords` (one repository's crew sessions):
 * each phase's newest record counts; a phase with no crew session yet is not finished.
 */
export function unmetWaits(
  waitsFor: readonly string[],
  repoRecords: readonly CrewRecord[],
): Wait[] {
  const unmet: Wait[] = [];
  for (const phase of waitsFor) {
    const newest = repoRecords
      .filter((one) => one.phase === phase)
      .reduce<CrewRecord | null>(
        (last, one) => (last === null || one.createdAt >= last.createdAt ? one : last),
        null,
      );
    if (newest !== null && finishesWait(newest)) continue;
    unmet.push({
      phase,
      state: newest?.state ?? null,
      ...(newest !== null && newest.state === "removed" && newest.mergedBeforeRemoval !== true
        ? { removedUnmerged: { id: newest.id, name: newest.name } }
        : {}),
    });
  }
  return unmet;
}

/**
 * What holds a start, in one word that stays the same while the numbers in `why` move (the load,
 * a count, the seconds left). A watch says a wait once for its kind, never on each pass.
 */
export type PlaceHold =
  | "phases"
  | "lead"
  | "lead-opus"
  | "machine"
  | "machine-opus"
  | "spacing"
  | "memory"
  | "load"
  | "usage";

/** What a new crew session does: start now, or wait in the queue and why (one short clause). */
export type Place = { start: true } | { start: false; hold: PlaceHold; why: string };

/** What a queued crew session with a free place waits for: only its lead's watch. */
export const PLACE_FREE = "a place is free; its lead's watch starts it";

/** The tier the caps count (D54): the tier a crew session's model name stands for. */
export const OPUS_TIER = "opus";

/** The running crew sessions on the opus tier (`model.tier`, recorded at launch). */
export function onOpusTier(records: readonly CrewRecord[]): CrewRecord[] {
  return records.filter((one) => one.model.tier === OPUS_TIER);
}

/** What the decision reads. */
export interface PlaceInput {
  /** The last launch on this machine, and the clock and gap used to judge it (D72). */
  lastLaunchMs?: null | number;
  nowMs?: number | undefined;
  startGapSeconds?: number;
  /** The crew sessions that hold a place on this machine now (`runningCrew`). */
  running: number;
  /** How many of them run on the opus tier (`onOpusTier`). */
  runningOpus: number;
  /** The running crew sessions of the new one's lead, in every repository (`runningForLead`). */
  leadRunning: number;
  /** How many of the lead's run on the opus tier. */
  leadRunningOpus: number;
  /** `workflow.crew.perLead`: one lead's crew sessions (D54). */
  perLead: number;
  /** `workflow.crew.perLeadOpus`: one lead's opus-tier ones (D54). */
  perLeadOpus: number;
  /** `workflow.crew.max`: the machine's safety ceiling (D54). */
  max: number;
  /** `workflow.crew.maxOpus`: an optional machine-wide opus ceiling; null when unset. */
  maxOpus: null | number;
  /** True when the new crew session runs on the opus tier. */
  opus: boolean;
  /**
   * True when the new crew session continues a hand-off (`continues`, D70): it takes the place
   * the session that handed off left, so the load never holds it. Every other hold still does.
   */
  continuation: boolean;
  /** The memory a crew session may use now, in GB; null where it cannot be read. */
  freeGb: null | number;
  /** `workflow.crew.memoryGb`. */
  needGb: number;
  /** The 1-minute load average and the cores now; null where the platform gives none. */
  load: LoadReading | null;
  /** `workflow.crew.loadPerCore`: a start waits while the load is above this for each core. */
  loadPerCore: number;
  /** The 5-hour usage window's share used now, in percent; null when it cannot be read (D54). */
  usagePercent: null | number;
  /** `workflow.crew.usagePercent`: past this share, a new opus crew session waits (D54). */
  usageHoldPercent: number;
  /** True when the gateway's opus slot answers from a chain with its fallback on (D54). */
  opusFallback: boolean;
  /** Its phases that are not finished yet. */
  unmet: readonly Wait[];
}

/**
 * The decision, pure, in the order the line names it: its phases first, then its lead's caps,
 * the machine's ceiling and optional opus ceiling, the memory, the load (not for a hand-off's
 * next crew session, D70), and the usage window.
 */
export function placeFor(input: PlaceInput): Place {
  if (input.unmet.length > 0) {
    const phases = input.unmet
      .map((wait) => `${wait.phase} (${wait.state ?? "not started yet"})`)
      .join(", ");
    return {
      start: false,
      hold: "phases",
      why: `waits for ${phases}; it starts when each is merged`,
    };
  }
  if (input.leadRunning >= input.perLead) {
    return {
      start: false,
      hold: "lead",
      why: `its lead has ${input.leadRunning} of ${input.perLead} crew sessions running; it starts when one of them finishes`,
    };
  }
  if (input.opus && input.leadRunningOpus >= input.perLeadOpus) {
    return {
      start: false,
      hold: "lead-opus",
      why: `its lead has ${input.leadRunningOpus} of ${input.perLeadOpus} opus crew sessions running; it starts when one of them finishes`,
    };
  }
  if (input.running >= input.max) {
    return {
      start: false,
      hold: "machine",
      why: `${input.running} of ${input.max} crew sessions running on this machine; it starts when one finishes`,
    };
  }
  if (input.opus && input.maxOpus !== null && input.runningOpus >= input.maxOpus) {
    return {
      start: false,
      hold: "machine-opus",
      why: `${input.runningOpus} of ${input.maxOpus} opus crew sessions running on this machine; it starts when one of them finishes`,
    };
  }
  if (
    input.lastLaunchMs != null &&
    input.nowMs !== undefined &&
    input.startGapSeconds !== undefined
  ) {
    const age = Math.max(0, input.nowMs - input.lastLaunchMs);
    const gap = input.startGapSeconds * 1000;
    if (age < gap) {
      return {
        start: false,
        hold: "spacing",
        why: `the last crew launch on this machine was ${Math.floor(age / 1000)} s ago; launches are ${input.startGapSeconds} s apart; it starts in ${Math.ceil((gap - age) / 1000)} s`,
      };
    }
  }
  if (input.freeGb !== null && input.freeGb < input.needGb) {
    return {
      start: false,
      hold: "memory",
      why: `${oneDecimal(Math.max(0, input.freeGb))} GB free, a crew session needs ${input.needGb} GB; it starts when memory frees`,
    };
  }
  if (input.load !== null && !input.continuation) {
    const limit = loadLimit(input.load, input.loadPerCore);
    if (input.load.oneMinute > limit) {
      return {
        start: false,
        hold: "load",
        why: `the load is ${oneDecimal(input.load.oneMinute)} on ${input.load.cores} cores, past ${oneDecimal(limit)} (${input.loadPerCore} for each core); it starts when the load falls`,
      };
    }
  }
  if (
    input.opus &&
    !input.opusFallback &&
    input.usagePercent !== null &&
    input.usagePercent > input.usageHoldPercent
  ) {
    return {
      start: false,
      hold: "usage",
      why: `the 5-hour usage window is at ${Math.round(input.usagePercent)}%, past ${input.usageHoldPercent}%; it starts when the window resets, or when the opus slot has a fallback chain`,
    };
  }
  return { start: true };
}

/**
 * The input `placeFor` reads, built from the machine's crew sessions, the caps and the usage
 * window: the one home of the shape, for `crew start`, the queued start, a lead's guard and a
 * model change (`crew model`). `opus` is true when the crew session asking runs on the opus tier;
 * the memory is read last and only when nothing else holds, so it starts null.
 */
export function placeInputOf(
  records: readonly CrewRecord[],
  leadSessionId: string,
  crew: ResolvedWorkflow["crew"],
  usage: ReturnType<typeof usageFacts>,
  more: {
    continuation: boolean;
    opus: boolean;
    unmet: readonly Wait[];
    nowMs?: number | undefined;
    ignoreGap?: boolean;
    exclude?: CrewRecord;
  },
): PlaceInput {
  const nowMs = more.nowMs ?? Date.now();
  const running = records.filter(
    (one) =>
      !(more.exclude?.id === one.id && more.exclude.repo === one.repo) &&
      ((RUNNING_STATES as readonly string[]).includes(one.state) ||
        resumeClaimHeld(one.resumeClaim, nowMs)),
  );
  const mine = running.filter((one) => leadSessionId !== "" && one.leadSessionId === leadSessionId);
  return {
    continuation: more.continuation,
    nowMs: more.nowMs,
    startGapSeconds: crew.startGapSeconds.value,
    // A launch time later than now (the clock was set back) is left out: it would hold every
    // launch until the clock caught up with it.
    lastLaunchMs:
      more.ignoreGap === true
        ? null
        : records.reduce<null | number>((last, one) => {
            const at = Date.parse(one.launchedAt ?? one.startedAt ?? "");
            return Number.isFinite(at) && at <= nowMs && (last === null || at > last) ? at : last;
          }, null),
    freeGb: null,
    leadRunning: mine.length,
    leadRunningOpus: onOpusTier(mine).length,
    // Read last, with the memory, and only when nothing else holds: a model change never reads it.
    load: null,
    loadPerCore: crew.loadPerCore.value,
    max: crew.max.value,
    maxOpus: crew.maxOpus.value,
    needGb: crew.memoryGb.value,
    opus: more.opus,
    opusFallback: usage.opusFallback,
    perLead: crew.perLead.value,
    perLeadOpus: crew.perLeadOpus.value,
    running: running.length,
    runningOpus: onOpusTier(running).length,
    unmet: more.unmet,
    usageHoldPercent: crew.usagePercent.value,
    usagePercent: usage.percent,
  };
}

/**
 * Runs `decide` holding the machine-wide places lock, `<stateDir>/crew/lock` (the stores'
 * root, `crewRootDir`; each repository's own store lock sits one folder down).
 */
export async function withPlacesLock<T>(
  stateDir: string,
  decide: () => Promise<T> | T,
): Promise<T> {
  const root = crewRootDir(stateDir);
  mkdirSync(root, { mode: 0o700, recursive: true });
  return await withLock(root, decide, { waitMs: PLACES_LOCK_WAIT_MS });
}

/**
 * The memory a new crew session may use now, in GB: the memory free now (`machineMemory`, the job
 * queue's reading of the machine, cgroup ceilings included). Heavy jobs reserve nothing any more
 * (the queue counts jobs, not gigabytes), so what they use already shows in the free number.
 * Null where free memory cannot be read.
 */
export function freeForCrewGb(memory: MemoryFacts): null | number {
  const reading = machineMemory(memory);
  return reading.availableBytes === null ? null : reading.availableBytes / GIB;
}

/** What one lead's `crew start` would do now, as its guard asks it (D59). */
export interface LeadStartInput {
  /** The project the lead works in; the person's workflow file holds the machine's caps. */
  checkout: Checkout;
  /** The lead's Claude Code session id. */
  leadSessionId: string;
  /** The CPU load now, as the machine reads it (`realLoadFacts()`). */
  load: LoadFacts;
  /** The memory free now, as the machine reads it (`realMemoryFacts()`). */
  memory: MemoryFacts;
  nowMs: number;
  /** True when the launch the guard is judging would spend the opus tier. */
  opus: boolean;
  paths: CliPaths;
}

/**
 * What a `crew start` from this lead would do now: start, or wait in the queue and why. It builds
 * the same input `startPlanned` builds — with **no phases waited for**, because `--waits-for`
 * waits for a merge and a merge is never a place — and asks `placeFor`, the one decision rule.
 * The memory and the load are read only when nothing else holds, as `crew start` reads them.
 *
 * Null when no start would queue: crew sessions are off in this project (a start is refused then,
 * never queued), or the store, the project's file or the caps cannot be read. The caller lets the
 * launch through: a guard that cannot work out the queue never blocks.
 *
 * It reads **without the places lock**: this is a question, not a start, so it writes nothing and
 * takes no place. A count that moves a moment later is corrected by the next call — the guard
 * refuses or lets a launch through, and a start that took the last place in between is exactly
 * the state the next call reads.
 */
export async function placeForLeadStart(input: LeadStartInput): Promise<null | Place> {
  let records: CrewRecord[];
  let crew: ResolvedWorkflow["crew"];
  let usage: ReturnType<typeof usageFacts>;
  try {
    records = listAllCrew(input.paths.stateDir).records;
    crew = resolveWorkflow(input.paths, loadProjectConfig(input.checkout).config).crew;
    // The project's gateway is read at the lead's own folder, the one `crew start` reads it at
    // (`crewSettingsFolder`): a lead in a linked worktree gets the answer a start would.
    usage = usageFacts(input.paths, input.nowMs, crewSettingsFolder(input.checkout));
  } catch {
    return null;
  }
  if (!crew.enabled.value) return null;
  // The guard judges a subagent launch, never a hand-off's next crew session (D70).
  const held = placeInputOf(records, input.leadSessionId, crew, usage, {
    continuation: false,
    opus: input.opus,
    unmet: [],
    ignoreGap: true,
  });
  const first = placeFor(held);
  if (!first.start) return first;
  let freeGb: null | number;
  try {
    freeGb = freeForCrewGb(input.memory);
  } catch {
    return null;
  }
  return placeFor({ ...held, freeGb, load: machineLoad(input.load) });
}
