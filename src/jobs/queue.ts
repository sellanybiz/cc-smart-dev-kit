/** One machine-wide heavy slot, with oldest-first tickets. */
import { oneLine } from "../gateway/plain-text";
import { HEAVY_SLOTS } from "./config";

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
  /** Does it take a heavy slot? False for a job that holds a name only. */
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
  /** The machine's host name: the host that started the job. */
  person: string;
  pid: number;
  /** Milliseconds since 1970: when the job joined the line, or took its slot. */
  since: number;
  /** Does the holder hold (or a ticket wait for) a heavy slot? False: a name only. */
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
    slot: slotOfWire(gb),
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
  /** Joins the line. Null when that cannot happen right now (try again next round). */
  enqueue(recordText: string): Promise<StoreTicket | null>;
  /** Leases held right now. */
  held(): Promise<readonly StoreHeld[]>;
  readonly label: string;
  capacity?: () => number;
  /** The slot and optional name are checked under the store lock. */
  tryTake(slot: boolean, recordText: string, exclusive?: string): Promise<StoreUnits | null>;
}

export interface ParsedHeld {
  /** A lease whose text does not parse is "unknown" and still holds its slot. */
  holder: HolderRecord | null;
  slot: boolean;
}

export interface ParsedEntry {
  /** The exclusive name the ticket waits for, or null. */
  exclusive: string | null;
  mine: boolean;
  person: string | null;
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
  | { capacity: number; kind: "no-room" }
  | { kind: "exclusive"; name: string }
  | { kind: "behind" }
  | { kind: "no-ticket" };
export type Decision = { take: true } | { wait: WaitReason };
export interface DecideInput {
  capacity?: number;
  exclusive: string | null;
  held: readonly ParsedHeld[];
  line: readonly ParsedEntry[];
  slot: boolean;
}
/** The names held right now: a ticket for one of them cannot run, so it holds nobody up. */
function heldNamesOf(input: DecideInput): ReadonlySet<string | undefined> {
  return new Set(input.held.map((unit) => unit.holder?.exclusive));
}

/** Is `entry` an older ticket for the name this job waits for (`--exclusive`)? */
function isOlderForName(entry: ParsedEntry, me: ParsedEntry, input: DecideInput): boolean {
  return (
    !entry.mine &&
    isBefore(entry, me) &&
    entry.exclusive !== null &&
    entry.exclusive === input.exclusive
  );
}

/**
 * Does `entry` keep this job waiting? An older ticket does when it is for the same name, or
 * when both take a slot and its own name (if any) is not one somebody holds. One rule: `decide`
 * waits on it, and the place in line (`jobsAhead`) counts it.
 */
function isInTheWay(
  entry: ParsedEntry,
  me: ParsedEntry,
  input: DecideInput,
  heldNames: ReadonlySet<string | undefined>,
): boolean {
  return (
    isOlderForName(entry, me, input) ||
    (!entry.mine &&
      isBefore(entry, me) &&
      input.slot &&
      entry.slot &&
      !(entry.exclusive !== null && heldNames.has(entry.exclusive)))
  );
}

/** Oldest runnable ticket first. A named job cannot block unrelated names. */
export function decide(input: DecideInput): Decision {
  const me = input.line.find((entry) => entry.mine);
  if (me === undefined) return { wait: { kind: "no-ticket" } };
  const heldNames = heldNamesOf(input);
  if (input.exclusive !== null && heldNames.has(input.exclusive))
    return { wait: { kind: "exclusive", name: input.exclusive } };
  if (input.line.some((entry) => isInTheWay(entry, me, input, heldNames)))
    return { wait: { kind: "behind" } };
  if (input.slot && slotsUsed(input.held) >= (input.capacity ?? HEAVY_SLOTS))
    return { wait: { kind: "no-room", capacity: input.capacity ?? HEAVY_SLOTS } };
  return { take: true };
}

/**
 * How many jobs are ahead of this one in the line, for the reason it waits. A wait for a held
 * name counts only the older jobs that wait for that same name; any other wait counts the jobs
 * `decide` waits on (`isInTheWay`), not every ticket. The holder is not counted: it is not in
 * the line. No ticket, no place: 0.
 */
export function jobsAhead(input: DecideInput, reason: WaitReason): number {
  const me = input.line.find((entry) => entry.mine);
  if (me === undefined || reason.kind === "no-ticket") return 0;
  if (reason.kind === "exclusive") {
    return input.line.filter((entry) => isOlderForName(entry, me, input)).length;
  }
  const heldNames = heldNamesOf(input);
  return input.line.filter((entry) => isInTheWay(entry, me, input, heldNames)).length;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11 → "11th", 21 → "21st". */
function ordinal(count: number): string {
  const teen = count % 100 >= 11 && count % 100 <= 13;
  const suffix = teen ? undefined : ["th", "st", "nd", "rd"][count % 10];
  return `${String(count)}${suffix ?? "th"}`;
}

/**
 * The place in line, for the waiting line: "Place: 3rd in line, 2 jobs ahead." Empty when no job
 * is ahead: the only one in the way is the holder, and the reason already says the slot is taken.
 */
export function placeText(ahead: number): string {
  if (ahead === 0) return "";
  return `Place: ${ordinal(ahead + 1)} in line, ${String(ahead)} ${ahead === 1 ? "job" : "jobs"} ahead.`;
}

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

function reasonText(reason: WaitReason): string {
  switch (reason.kind) {
    case "behind":
      return "an older job is first in line";
    case "exclusive":
      return `another job holds --exclusive ${reason.name}`;
    case "no-room":
      return reason.capacity === 1
        ? "this machine's only slot is taken"
        : `all ${reason.capacity} heavy slots are taken`;
    case "no-ticket":
      return "the line cannot be joined right now";
  }
}
export function holderLines(held: readonly ParsedHeld[], store: string, now: number): string[] {
  return held.map(({ holder, slot }) =>
    holder === null
      ? `  ${store}: an unknown holder holds the slot`
      : `  ${store}: ${slot ? "a heavy slot" : "a name"} is held by ${shownHolder(holder)}, since ${formatSince(holder.since, now)} (pid ${holder.pid})`,
  );
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

/**
 * The other thing the first waiting line carries: a wait may be long, and a call that runs the
 * job in the foreground ends at its timeout. Once per job, like `pipeHint`. The route also gives
 * a rewritten call the Bash tool's longest timeout (`job-route.ts`), but even that is a limit.
 */
function backgroundHint(): string {
  return "A long wait: run it in the background (run_in_background) so the call does not time out.";
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

/** Acquire a machine slot and optional exclusive name. Errors fail closed. */
export async function acquireFrom(
  stores: readonly Store[],
  job: QueuedJob,
  options: EngineOptions,
): Promise<Reservation> {
  if (stores.length !== 1) throw new Error("the heavy-job queue needs exactly one machine store");
  const store = stores[0];
  if (store === undefined) throw new Error("missing machine store");
  if (!job.slot && job.exclusive === undefined)
    return { release: () => undefined, waitedSince: null };
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? Bun.sleep;
  let ticket: StoreTicket | null = null;
  let waitedSince: number | null = null;
  let lastLine = Number.NEGATIVE_INFINITY;
  const text = (since: number) =>
    holderText({
      checkout: job.checkout,
      ...(job.exclusive === undefined ? {} : { exclusive: job.exclusive }),
      kind: job.kind,
      person: options.person,
      pid: job.pid,
      since,
      slot: job.slot,
      v: 1,
      what: job.what,
    });
  try {
    for (;;) {
      if (options.signal?.aborted) throw new WaitStoppedError("the wait was stopped");
      if (!job.nested) ticket ??= await store.enqueue(text(now()));
      const line = job.nested
        ? [parseEntry({ mine: true, tie: "", text: text(0) })]
        : ticket === null
          ? []
          : (await ticket.line()).map(parseEntry);
      const held = (await store.held()).map((unit) => ({
        holder: parseHolder(unit.text),
        slot: unit.slot,
      }));
      const input: DecideInput = {
        capacity: store.capacity?.() ?? HEAVY_SLOTS,
        exclusive: job.exclusive ?? null,
        held,
        line,
        slot: job.slot,
      };
      const decision = decide(input);
      let reason: WaitReason;
      if ("take" in decision) {
        const units = await store.tryTake(job.slot, text(now()), job.exclusive);
        if (units !== null) return { release: once(() => units.release()), waitedSince };
        reason = { kind: "no-room", capacity: store.capacity?.() ?? HEAVY_SLOTS };
      } else reason = decision.wait;
      const at = now();
      if (at - lastLine >= (options.waitingLineEveryMs ?? WAITING_LINE_EVERY_MS)) {
        const first = waitedSince === null;
        waitedSince ??= at;
        lastLine = at;
        const place = placeText(jobsAhead(input, reason));
        options.onWaiting(
          `Heavy job waits for ${job.slot ? "a free slot" : "its exclusive name"}: ${job.what}. Why: ${reasonText(reason)}.${place === "" ? "" : ` ${place}`}`,
        );
        if (first) {
          options.onWaiting(pipeHint());
          options.onWaiting(backgroundHint());
        }
        for (const line of holderLines(held, store.label, at)) options.onWaiting(line);
      }
      await sleep(options.pollMs ?? POLL_MS);
    }
  } finally {
    ticket?.release();
  }
}

/** Pids with local leases, optionally restricted to an exclusive name. */
export async function pidsHolding(
  stores: readonly Store[],
  _person: string,
  exclusive?: string,
): Promise<ReadonlySet<number>> {
  const pids = new Set<number>();
  for (const store of stores)
    for (const unit of await store.held()) {
      const holder = parseHolder(unit.text);
      if (holder !== null && (exclusive === undefined || holder.exclusive === exclusive))
        pids.add(holder.pid);
    }
  return pids;
}
