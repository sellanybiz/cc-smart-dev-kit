/**
 * The heavy-job queue: a job takes one slot before it starts and holds it until it ends. Up to
 * `maxJobs` heavy jobs run at once on this machine; the next one waits for a slot. A job has no
 * size: one job alone may use all the memory and every core. Without the queue, many Claude
 * sessions and their agents start type checks, test runs and builds together, the machine runs
 * out of memory, and the kernel kills what it picks: often the desktop, and every session with
 * it. (The memory ceiling that keeps the desktop safe is the launch's: `launch.ts`.)
 *
 * SLOT COUNTS: each one must have room
 *   - THIS MACHINE: `maxJobs` slots (`config.ts`).
 *   - A SHARED VIEW (optional): a folder several containers or users on one host share
 *     (`config.ts` › `sharedDirs`), with one `max-jobs` number for all of them.
 *   A job takes this machine's slot first, then one in each shared folder, and gives them back
 *   in reverse. It joins a shared line only once it holds this machine's slot, so the counts
 *   can never wait on each other in a circle.
 *
 * WHERE A RESERVATION LIVES: a "store" (`store.ts`): a folder of lease files.
 *
 * TWO LANES: heavy and light (D74)
 *   A heavy run (a full type check, a full test run, a build) takes one of `maxJobs` slots. A
 *   light run (an install, a test run on up to `LIGHT_FILE_LIMIT` named files) takes one of
 *   `lightJobs` slots (`config.ts`) instead, this machine's only: a shared folder counts heavy
 *   runs alone. The lanes never wait for each other, so a small run never sits behind a full
 *   one, and a burst of installs never takes the heavy slots.
 *
 * FREE MEMORY: a job waits while this machine has less than `startFreeGb` free (`config.ts`),
 *   but only while another job of the queue runs here: its end frees memory. With no job
 *   running, waiting could last for ever (the memory belongs to what never queues), so the
 *   job starts, under its kill mark and the heavy slice (`launch.ts`).
 *
 * WHO GOES NEXT: oldest first
 *   A waiting job holds a ticket with its start time. Only the oldest live ticket may take a
 *   slot, so no job is starved by a stream of newer ones.
 *
 * FAIR SHARE: shared stores only
 *   A person (a machine's host name) who already holds half the folder's slots or more steps
 *   aside while another person has a job in the line. Alone, a person may use all of them,
 *   and a running job is never stopped.
 *
 * EXCLUSIVE NAMES (`job run --exclusive <name>`)
 *   At most one job with that name holds a lease at a time: on this machine always, and in
 *   a shared folder whose `exclusive` file lists the name. Its ticket waits in the same
 *   line, oldest first, among the jobs with that name. A name can come with a slot (a kind)
 *   or alone: a name-only job takes no slot, and never waits behind jobs that only wait for
 *   a slot. A ticket that waits for a name someone holds does not hold up jobs that need only
 *   a slot: it cannot run anyway, and it is still the oldest once the name is free.
 *
 * WAITING says so: once at the start, then every minute: what the job needs, the free slots
 * in each store, and who holds them. There is no give-up timeout: running anyway after a
 * while is the crash again.
 *
 * What a store holds is someone else's text: read as data, and anything that does not
 * parse is named "unknown". A store that fails never makes a job wait for ever: the job
 * runs without that store, and says so.
 *
 * MIXED VERSIONS: an older `job run` counted gigabytes, and wrote them in the `gb` field of
 * its records. This plugin counts every live lease as one slot, whatever its record says
 * (`slotOfWire`), and writes 1 in that field for a job that holds a slot and 0 for one that
 * holds a name only (`wireOfSlot`), so an older `job run` still reads the record, as a 1 GB
 * holder. A plugin from 1.8.0 also writes the job's `lane`. A record without one (an older
 * plugin's) is read from its `gb`: a heavy slot or a name (`laneOf`). An older plugin reads a
 * light run's record as a heavy slot: it waits more, never less.
 */

import { oneLine } from "../gateway/plain-text";
import { DEFAULT_LIGHT_JOBS } from "./config";

/** Which slots a job takes: a heavy one, a light one, or none (a name only). */
export type JobLane = "heavy" | "light" | "none";

/**
 * The lane of a job, a record, a lease or a ticket: its own `lane`, or, for a record an older
 * plugin wrote (no lane), `slot`: a heavy slot or a name. The one reader of both fields.
 */
export function laneOf(value: { lane?: JobLane; slot: boolean }): JobLane {
  return value.lane ?? (value.slot ? "heavy" : "none");
}

/** A job, as the queue sees it. */
export interface QueuedJob {
  /** The command's folder: named in other jobs' waiting lines. */
  checkout: string;
  /** `--exclusive <name>`: at most one job with this name runs at a time. */
  exclusive?: string | undefined;
  /** The kind, or "" for a job with a name only (`--exclusive` without `--kind`). */
  kind: string;
  /**
   * A job inside another heavy job that still needs its name: it takes the name as soon as
   * nobody holds it, without a place in the line. In the line it could wait behind a job
   * that waits for a slot its own parent holds, and neither would ever move.
   */
  nested?: boolean;
  /** The process that holds the reservation (the `job run` process). */
  pid: number;
  /** Which slots it takes. Left out: `slot` says, a heavy slot or a name (`laneOf`). */
  lane?: JobLane;
  /** Does it take a slot of either lane? False for a job that holds a name only. */
  slot: boolean;
  /** The command as a person reads it: `bunx tsc --noEmit`. */
  what: string;
}

export interface Reservation {
  /**
   * When this job's first waiting line was printed, or null when it never waited: what
   * `job run` reads to say how long the job waited, and that it waited at all.
   */
  readonly waitedSince: number | null;
  /** Gives the slot back. Safe to call twice. */
  release(): void;
}

// ── The record each reservation and ticket carries ─────────────────────────────

/**
 * The `gb` number in a record or a lease file is the wire's old name for what a job holds.
 * An older `job run` counted gigabytes there. This plugin writes 1 for a job that holds a slot
 * and 0 for one that holds a name only, and reads any number above 0 as one slot.
 */
export function wireOfSlot(slot: boolean): number {
  return slot ? 1 : 0;
}

/** Does a record's old `gb` number mean a held slot? Any number above 0 does, as one slot. */
export function slotOfWire(gb: number): boolean {
  return gb > 0;
}

export interface HolderRecord {
  checkout: string;
  /** The `--exclusive` name, in a store that keeps that name to one job. */
  exclusive?: string;
  kind: string;
  /** The machine's host name: one person, on a shared view. */
  person: string;
  pid: number;
  /** Milliseconds since 1970: when the job joined the line, or took its slot. */
  since: number;
  /** Which slots it holds or waits for. Left out in an older plugin's record (`laneOf`). */
  lane?: JobLane;
  /** Does the holder hold (or a ticket wait for) a slot of either lane? False: a name only. */
  slot: boolean;
  /** The record's version: a later plugin may write another shape. */
  v: 1;
  what: string;
}

export function holderText(record: HolderRecord): string {
  const { slot, ...rest } = record;
  return JSON.stringify({ ...rest, gb: wireOfSlot(slot) });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The record in a store's text, or null when it is not a version-1 record. */
export function parseHolder(text: string): HolderRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null; // not JSON: an unknown holder
  }
  if (!isObject(value) || value.v !== 1) return null;
  const { checkout, exclusive, kind, person, pid, since, what } = value;
  const gb = typeof value.slot === "boolean" ? wireOfSlot(value.slot) : value.gb;
  const lane = value.lane;
  if (lane !== undefined && lane !== "heavy" && lane !== "light" && lane !== "none") return null;
  if (
    (exclusive !== undefined && typeof exclusive !== "string") ||
    typeof checkout !== "string" ||
    typeof kind !== "string" ||
    typeof person !== "string" ||
    typeof what !== "string" ||
    typeof gb !== "number" ||
    !Number.isFinite(gb) ||
    typeof pid !== "number" ||
    !Number.isInteger(pid) ||
    typeof since !== "number" ||
    !Number.isFinite(since)
  ) {
    return null;
  }
  return {
    checkout,
    ...(exclusive !== undefined && { exclusive }),
    kind,
    person,
    pid,
    since,
    ...(lane === undefined ? {} : { lane }),
    slot: lane === undefined ? slotOfWire(gb) : lane !== "none",
    v: 1,
    what,
  };
}

/** The longest a holder's host name, and what it runs, print: one line each, never a screen. */
const HOLDER_NAME_MAX = 64;
const HOLDER_WHAT_MAX = 200;

/**
 * Who holds or waits, for a person: "<host>: <what it runs>". The record is another
 * writer's text (another user, a container on the same host), so each part prints as one
 * plain line (`oneLine`: every control character a space, cut to a bounded length): an
 * escape sequence in it never reaches the terminal.
 */
export function shownHolder(record: HolderRecord): string {
  const person = oneLine(record.person, HOLDER_NAME_MAX, { mark: "…" });
  return `${person}: ${oneLine(describeHolder(record), HOLDER_WHAT_MAX, { mark: "…" })}`;
}

/** What a record runs, for a person: "build, next build" or "exclusive image, docker build ." */
export function describeHolder(record: HolderRecord): string {
  const labels = [
    ...(record.kind === "" ? [] : [record.kind]),
    ...(record.exclusive === undefined ? [] : [`exclusive ${record.exclusive}`]),
  ];
  return [...labels, `${record.what} in ${record.checkout}`].join(", ");
}

// ── What a store offers (the lease folder, or a test's fake) ───────────────────

/** A lease held right now, and its holder's text (untrusted). */
export interface StoreHeld {
  /** Does it hold a slot? False: a name only. */
  readonly slot: boolean;
  readonly text: string;
}

/** A live ticket in a store's line. `tie` breaks ties between equal start times. */
export interface StoreLineEntry {
  readonly mine: boolean;
  readonly tie: string;
  readonly text: string;
}

export interface StoreTicket {
  /** Every live ticket. */
  line(): Promise<readonly StoreLineEntry[]>;
  release(): void;
}

export interface StoreUnits {
  release(): void;
}

export interface Store {
  /** How many heavy slots this store gives out, read again for every decision. */
  capacity(): Promise<number>;
  /** How many light slots this store gives out. A shared folder gives none (`laneIn`). */
  lightCapacity(): Promise<number>;
  /** This machine's free memory now, and what a job needs to start. Shared folders: none. */
  memoryAdmission?(): MemoryAdmission;
  /** Joins the line. Null when that cannot happen right now (try again next round). */
  enqueue(recordText: string): Promise<StoreTicket | null>;
  /** Leases held right now. */
  held(): Promise<readonly StoreHeld[]>;
  /** Does this store keep `name` to one job at a time? This machine: always. */
  keepsExclusive(name: string): Promise<boolean>;
  /** "this machine", or a shared folder: how waiting lines name it. */
  readonly label: string;
  /** Used by several machines or users: fair share applies, and its pids may be foreign. */
  readonly shared: boolean;
  /**
   * A slot of `lane` (or nothing but a name, for "none"), and with `exclusive`, only while no
   * lease holds that name. Null when that is not so right now. Checked under the store's
   * lock: the counts the decision read may be stale by now. The rest of the decision (the
   * line, fair share, free memory) is not checked again.
   */
  tryTake(lane: JobLane, recordText: string, exclusive?: string): Promise<StoreUnits | null>;
}

/** Free memory, for the admission rule: `freeGb` is null where it cannot be read. */
export interface MemoryAdmission {
  freeGb: number | null;
  startFreeGb: number;
}

/**
 * The lane a job takes in one store: its own, except that a light run takes no slot in a
 * shared folder. Light slots are this machine's only; a shared folder counts heavy runs.
 */
export function laneIn(store: { shared: boolean }, lane: JobLane): JobLane {
  return store.shared && lane === "light" ? "none" : lane;
}

// ── The decision: pure, so every rule above is tested without a store ─────────

export interface ParsedHeld {
  /** A lease whose text does not parse is "unknown" and still holds its slot. */
  holder: HolderRecord | null;
  /** Its lane. Left out: `laneOf` reads the holder's, or `slot`. */
  lane?: JobLane;
  slot: boolean;
}

/** The lane a held lease counts in: its own, its holder's, or a heavy slot (an unknown one). */
export function heldLane(unit: ParsedHeld): JobLane {
  return unit.lane ?? laneOf(unit.holder ?? unit);
}

/** How many of `held` hold a slot of `lane`. */
export function laneUsed(held: readonly ParsedHeld[], lane: JobLane): number {
  return held.filter((unit) => heldLane(unit) === lane).length;
}

export interface ParsedEntry {
  /** The exclusive name the ticket waits for, or null. */
  exclusive: string | null;
  mine: boolean;
  person: string | null;
  /** Which slots it waits for. A ticket whose text does not parse needs nothing. */
  lane?: JobLane;
  slot: boolean;
  /** A ticket whose text does not parse sorts last: it never holds anyone up. */
  since: number;
  tie: string;
}

export function parseEntry(entry: StoreLineEntry): ParsedEntry {
  const record = parseHolder(entry.text);
  return {
    exclusive: record?.exclusive ?? null,
    mine: entry.mine,
    person: record?.person ?? null,
    lane: record === null ? "none" : laneOf(record),
    slot: record?.slot ?? false,
    since: record?.since ?? Number.POSITIVE_INFINITY,
    tie: entry.tie,
  };
}

function isBefore(a: ParsedEntry, b: ParsedEntry): boolean {
  return a.since < b.since || (a.since === b.since && a.tie < b.tie);
}

/** How many of `held` hold a slot. */
export function slotsUsed(held: readonly { slot: boolean }[]): number {
  return held.filter((unit) => unit.slot).length;
}

export type WaitReason =
  | { capacity: number; held: number; kind: "fair-share" }
  | { capacity: number; kind: "no-room" }
  | { kind: "exclusive"; name: string }
  | { freeGb: number; kind: "memory"; startFreeGb: number }
  | { kind: "behind" }
  | { kind: "no-ticket" };

export type Decision = { take: true } | { wait: WaitReason };

export interface DecideInput {
  /** How many heavy slots the store gives out. */
  capacity: number;
  /** How many light slots it gives out. Default: `DEFAULT_LIGHT_JOBS`. */
  lightCapacity?: number;
  /** Free memory, and what a job needs to start. Left out or unreadable: no memory rule. */
  freeGb?: number | null;
  startFreeGb?: number;
  /** The exclusive name this job needs in this store, or null. */
  exclusive: string | null;
  held: readonly ParsedHeld[];
  line: readonly ParsedEntry[];
  /** The person waiting: this machine's host name. */
  person: string;
  shared: boolean;
  /** Which slots this job needs in this store (`laneIn`). Left out: `slot` says (`laneOf`). */
  lane?: JobLane;
  /** Does this job need a slot? False: a name only. */
  slot: boolean;
}

function slotsHeldBy(held: readonly ParsedHeld[], person: string): number {
  return slotsUsed(held.filter((unit) => unit.holder?.person === person));
}

/** May this job take its slot (or its name) now? Every rule of the header, in one place. */
export function decide(input: DecideInput): Decision {
  const lane = laneOf(input);
  const capacity = lane === "light" ? (input.lightCapacity ?? DEFAULT_LIGHT_JOBS) : input.capacity;
  const laneHeld = input.held.filter((unit) => heldLane(unit) === lane);
  const heldNames = new Set(input.held.map((unit) => unit.holder?.exclusive));
  const { line } = input;
  // Fair share: a person at half the slots or more steps aside while someone else waits.
  const steppedAside = (person: string | null): boolean =>
    input.shared &&
    person !== null &&
    slotsHeldBy(laneHeld, person) * 2 >= capacity &&
    line.some(
      (entry) => laneOf(entry) === lane && entry.person !== null && entry.person !== person,
    );
  const me = line.find((entry) => entry.mine);
  if (me === undefined) return { wait: { kind: "no-ticket" } };
  if (input.exclusive !== null && heldNames.has(input.exclusive)) {
    return { wait: { kind: "exclusive", name: input.exclusive } };
  }
  if (lane !== "none" && steppedAside(input.person)) {
    return {
      wait: {
        capacity,
        held: slotsHeldBy(laneHeld, input.person),
        kind: "fair-share",
      },
    };
  }
  // An older ticket goes first when it wants what this job wants: the same name, or a slot
  // both need. One that waits for a name someone holds cannot run anyway: it holds up
  // nobody's slot.
  const ahead = line.some((entry) => {
    if (entry.mine || !isBefore(entry, me)) return false;
    if (entry.exclusive !== null && entry.exclusive === input.exclusive) return true;
    return (
      lane !== "none" &&
      laneOf(entry) === lane &&
      !steppedAside(entry.person) &&
      !(entry.exclusive !== null && heldNames.has(entry.exclusive))
    );
  });
  if (ahead) return { wait: { kind: "behind" } };
  if (lane === "none") return { take: true };
  if (laneHeld.length >= capacity) {
    return { wait: { capacity, kind: "no-room" } };
  }
  // Free memory holds a job only while another one runs here: its end frees memory.
  const { freeGb, startFreeGb = 0 } = input;
  if (freeGb != null && freeGb < startFreeGb && slotsUsed(input.held) > 0) {
    return { wait: { freeGb, kind: "memory", startFreeGb } };
  }
  return { take: true };
}

// ── Waiting lines ──────────────────────────────────────────────────────────────

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local time a person reads: "11:44" today, "2026-10-11 11:44" on another day. */
export function formatSince(since: number, now: number): string {
  const at = new Date(since);
  const today = new Date(now);
  const time = `${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return sameDay
    ? time
    : `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())} ${time}`;
}

export function oneDecimal(gb: number): string {
  return String(Math.round(gb * 10) / 10);
}

/** How long something took, as a person reads it: `40 s`, `18 min`, `1 h 12 min`. */
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** "1 slot", "3 slots". */
export function slotsText(count: number): string {
  return `${String(count)} ${count === 1 ? "slot" : "slots"}`;
}

function reasonText(reason: WaitReason, store: string, lane: JobLane): string {
  const slot = lane === "light" ? "light slot" : "slot";
  switch (reason.kind) {
    case "memory":
      return `${store} has ${oneDecimal(reason.freeGb)} GB of memory free, and a job starts at ${oneDecimal(reason.startFreeGb)} GB while another one runs`;
    case "behind":
      return `an older job is first in ${store}'s line`;
    case "exclusive":
      return `another job with --exclusive ${reason.name} holds ${store}'s turn for that name`;
    case "fair-share":
      return `this machine already holds ${slotsText(reason.held)} of ${store}'s ${reason.capacity} while another person waits`;
    case "no-room":
      return reason.capacity === 1
        ? `${store}'s only ${slot} is taken`
        : `all ${String(reason.capacity)} of ${store}'s ${slot}s are taken`;
    case "no-ticket":
      return `${store}'s line cannot be joined right now`;
  }
}

/** One line per lease: who holds it, and whether it is a heavy slot, a light slot or only a name. */
export function holderLines(held: readonly ParsedHeld[], store: string, now: number): string[] {
  return held.map((unit) => {
    const { holder } = unit;
    const what = { heavy: "a heavy slot", light: "a light slot", none: "a name" }[heldLane(unit)];
    return holder === null
      ? `  ${store}: ${what} is held by an unknown holder`
      : `  ${store}: ${what} is held by ${shownHolder(holder)}, since ${formatSince(holder.since, now)} (pid ${holder.pid})`;
  });
}

// ── The engine ─────────────────────────────────────────────────────────────────

/** How often a waiting job looks again. */
const POLL_MS = 500;
/** How often a waiting job says it still waits. */
const WAITING_LINE_EVERY_MS = 60_000;

/**
 * What the end line leads with: `run.ts` builds that line from this, and the first waiting
 * line's hint points at it by this name. One home for the wording, so a rename cannot leave
 * the hint naming a line that no longer exists.
 */
export const ENDED_LINE_LEAD = "Heavy job ended";

/**
 * What the first waiting line carries besides the wait. A job whose output goes down a
 * pipe (`| tail`) reports the pipe's own status, so the person is told where the job's own
 * status shows up. Once per job, never again on the minute lines after it — and never for
 * a job that does not wait: those get no hint and no end line.
 */
function pipeHint(): string {
  return `A pipe (| tail) hides this job's exit status: the "${ENDED_LINE_LEAD}" line carries it.`;
}

/** Thrown when `signal` stops a wait; everything taken so far is given back first. */
export class WaitStoppedError extends Error {
  override name = "WaitStoppedError";
}

export interface EngineOptions {
  /** One line of a waiting report: at the start of a wait, then every minute. */
  onWaiting: (line: string) => void;
  /** A remark about the queue itself (a store that failed). Default: `onWaiting`. */
  onNote?: (line: string) => void;
  /** The person waiting: this machine's host name. */
  person: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  waitingLineEveryMs?: number;
  /** Stops the wait (a signal arrived): tickets and units are given back, then it throws. */
  signal?: AbortSignal;
}

function once(release: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    release();
  };
}

const NOTHING_HELD: StoreUnits = { release: () => undefined };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a job waits for in one store, as the first words of its waiting line say it. */
function needsText(job: QueuedJob, lane: JobLane): string {
  if (lane === "none") return `its turn for --exclusive ${job.exclusive ?? ""}`;
  const slot = lane === "light" ? "a free light slot" : "a free slot";
  return job.exclusive === undefined
    ? slot
    : `${slot} and the turn for --exclusive ${job.exclusive}`;
}

/**
 * Takes the job's slot from every store in turn: the order given is the order taken, and
 * every process gives the same order (this machine, then each shared folder). Given back in
 * reverse.
 */
export async function acquireFrom(
  stores: readonly Store[],
  job: QueuedJob,
  options: EngineOptions,
): Promise<Reservation> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const pollMs = options.pollMs ?? POLL_MS;
  const lineEveryMs = options.waitingLineEveryMs ?? WAITING_LINE_EVERY_MS;
  const note = options.onNote ?? options.onWaiting;
  const recordText = (since: number, exclusive: string | null, lane: JobLane) =>
    holderText({
      checkout: job.checkout,
      ...(exclusive !== null && { exclusive }),
      kind: job.kind,
      lane,
      person: options.person,
      pid: job.pid,
      since,
      slot: lane !== "none",
      v: 1,
      what: job.what,
    });

  const taken: StoreUnits[] = [];
  const release = once(() => {
    for (const units of [...taken].reverse()) units.release();
  });
  let waitStartedAt: number | null = null;
  let lastLineAt = Number.NEGATIVE_INFINITY;

  const report = async (store: Store, lane: JobLane, reason: WaitReason) => {
    const at = now();
    if (at - lastLineAt < lineEveryMs) return;
    // The job's first line: the hint rides with it, and never again.
    const first = waitStartedAt === null;
    waitStartedAt ??= at;
    lastLineAt = at;
    const waitedMs = at - waitStartedAt;
    const waited = first ? "" : ` (waiting ${durationText(waitedMs)})`;
    const counts: string[] = [];
    const holders: string[] = [];
    // The report only describes. A store it cannot read is named so, and never stops the
    // wait: a throw here would leave the store being waited on, this machine's too.
    for (const each of stores) {
      try {
        // The counts of the lane the job waits in: a light run reads the light slots.
        const light = laneIn(each, laneOf(job)) === "light";
        const capacity = await (light ? each.lightCapacity() : each.capacity());
        const held = (await each.held()).map((unit) => ({
          holder: parseHolder(unit.text),
          slot: unit.slot,
        }));
        const free = Math.max(0, capacity - laneUsed(held, light ? "light" : "heavy"));
        counts.push(
          `${each.label}: ${free} of ${light ? `${capacity} light` : slotsText(capacity)} free`,
        );
        holders.push(...holderLines(held, each.label, at));
      } catch {
        counts.push(`${each.label}: cannot be read`);
      }
    }
    const title = laneOf(job) === "light" ? "Light job" : "Heavy job";
    options.onWaiting(
      `${title} waits for ${needsText(job, lane)}: ${job.what}${waited}. ${counts.join("; ")}. Why: ${reasonText(reason, store.label, lane)}.`,
    );
    if (first) options.onWaiting(pipeHint());
    for (const line of holders) options.onWaiting(line);
  };

  const stopIfAsked = () => {
    if (options.signal?.aborted === true) throw new WaitStoppedError("the wait was stopped");
  };

  const takeFrom = async (store: Store): Promise<StoreUnits> => {
    let ticket: StoreTicket | null = null;
    try {
      const exclusive =
        job.exclusive !== undefined && (await store.keepsExclusive(job.exclusive))
          ? job.exclusive
          : null;
      const lane = laneIn(store, laneOf(job));
      // Nothing to take here: no slot, and no name this store keeps.
      if (lane === "none" && exclusive === null) return NOTHING_HELD;
      for (;;) {
        stopIfAsked();
        let reason: WaitReason;
        // A nested job holds no place in the line (QueuedJob.nested): only itself.
        if (job.nested !== true) {
          ticket ??= await store.enqueue(recordText(now(), exclusive, lane));
        }
        if (ticket === null && job.nested !== true) {
          reason = { kind: "no-ticket" };
        } else {
          const line =
            ticket === null
              ? [
                  {
                    exclusive,
                    lane,
                    mine: true,
                    person: options.person,
                    since: 0,
                    slot: lane !== "none",
                    tie: "",
                  },
                ]
              : (await ticket.line()).map(parseEntry);
          const me = line.find((entry) => entry.mine);
          // An older ticket that needs only a slot of this job's lane, and no fair share to
          // skip anyone: the store need not be read.
          const plainlyBehind =
            !store.shared &&
            me !== undefined &&
            lane !== "none" &&
            line.some(
              (entry) =>
                !entry.mine &&
                isBefore(entry, me) &&
                laneOf(entry) === lane &&
                entry.exclusive === null,
            );
          let decision: Decision;
          let capacity = 0;
          if (plainlyBehind) {
            decision = { wait: { kind: "behind" } };
          } else {
            const held = (await store.held()).map((unit) => ({
              holder: parseHolder(unit.text),
              slot: unit.slot,
            }));
            const heavyCapacity = await store.capacity();
            const lightCapacity = await store.lightCapacity();
            capacity = lane === "light" ? lightCapacity : heavyCapacity;
            decision = decide({
              capacity: heavyCapacity,
              exclusive,
              held,
              lane,
              lightCapacity,
              line,
              person: options.person,
              shared: store.shared,
              slot: lane !== "none",
              ...store.memoryAdmission?.(),
            });
          }
          if ("take" in decision) {
            const units = await store.tryTake(
              lane,
              recordText(now(), exclusive, lane),
              exclusive ?? undefined,
            );
            if (units !== null) return units;
            // Someone took the last slot between the look and the take: look again.
            reason = { capacity, kind: "no-room" };
          } else {
            reason = decision.wait;
          }
        }
        await report(store, lane, reason);
        await sleep(pollMs);
      }
    } catch (error) {
      if (error instanceof WaitStoppedError) throw error;
      // A store that fails must not stop the job: it runs without that store.
      note(
        `The heavy-job queue for ${store.label} failed (${messageOf(error)}): this job runs without it.`,
      );
      return NOTHING_HELD;
    } finally {
      ticket?.release();
    }
  };

  try {
    for (const store of stores) taken.push(await takeFrom(store));
  } catch (error) {
    release();
    throw error;
  }
  return { release, waitedSince: waitStartedAt };
}

/**
 * The pids in the reservations `held` returns. From a shared store, only those `person`
 * wrote: another machine's pids belong to another process table. With `exclusive`, only
 * the holders of that name.
 */
export async function pidsHolding(
  stores: readonly Store[],
  person: string,
  exclusive?: string,
): Promise<ReadonlySet<number>> {
  const pids = new Set<number>();
  for (const store of stores) {
    let held: readonly StoreHeld[];
    try {
      held = await store.held();
    } catch {
      // A store that fails names no holder. Nothing is lost: every job takes this
      // machine's store first, so its pid is there too.
      continue;
    }
    for (const unit of held) {
      const record = parseHolder(unit.text);
      if (record === null) continue;
      if (store.shared && record.person !== person) continue;
      if (exclusive !== undefined && record.exclusive !== exclusive) continue;
      pids.add(record.pid);
    }
  }
  return pids;
}
