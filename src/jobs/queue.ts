/**
 * The heavy-job queue: a job reserves the gigabytes it needs before it starts, and holds
 * them until it ends. What fits runs at once; what does not fit waits. Without it, many
 * Claude sessions and their agents start type checks, test runs and builds together, the
 * machine runs out of memory, and the kernel kills what it picks: often the desktop, and
 * every session with it.
 *
 * BUDGETS: each one must fit
 *   - THIS MACHINE: its memory less what never queues (`machineBudgetGb`).
 *   - A SHARED VIEW (optional): a folder several containers or users on one host share
 *     (`config.ts` › `sharedDirs`), with one budget for all of them.
 *   A job takes this machine's budget first, then each shared one, and gives them back in
 *   reverse. It joins a shared line only once it holds this machine's share, so the
 *   budgets can never wait on each other in a circle.
 *
 * WHERE A RESERVATION LIVES: a "store" (`store.ts`): a folder of lease files.
 *
 * WHO GOES NEXT: oldest first
 *   A waiting job holds a ticket with its start time. Only the oldest live ticket may take
 *   memory, so a 14 GB build is never starved by a stream of 2 GB test runs.
 *
 * FAIR SHARE: shared stores only
 *   A person (a machine's host name) who already holds half the budget or more steps aside
 *   while another person has a job in the line. Alone, a person may use all of it, and a
 *   running job is never stopped.
 *
 * A JOB BIGGER THAN A BUDGET waits until nothing else holds that budget, then takes all
 * of it and runs alone.
 *
 * THE LIVE CHECK: this machine only, where free memory can be read
 *   The budget is a guess about what never queues. So a job also waits while the real
 *   free memory, less what admitted jobs reserved but have not used yet, is below what it
 *   needs. It never stops a job when no other heavy job runs here: what fills the memory
 *   then is not a heavy job, and waiting would never end.
 *
 * WAITING says so: once at the start, then every minute: what the job needs, the free GB
 * in each budget, and who holds the rest. There is no give-up timeout: running anyway
 * after a while is the crash again.
 *
 * What a store holds is someone else's text: read as data, and anything that does not
 * parse is named "unknown". A store that fails never makes a job wait for ever: the job
 * runs without that budget, and says so.
 */

/** A job, as the queue sees it. */
export interface QueuedJob {
  /** The command's folder: named in other jobs' waiting lines. */
  checkout: string;
  /** What it reserves. */
  gb: number;
  kind: string;
  /** The process that holds the reservation (the `job run` process). */
  pid: number;
  /** The command as a person reads it: `bunx tsc --noEmit`. */
  what: string;
}

export interface Reservation {
  readonly gb: number;
  /** Gives the memory back. Safe to call twice. */
  release(): void;
}

// ── The record each reservation and ticket carries ─────────────────────────────

export interface HolderRecord {
  checkout: string;
  /** What the holder reserves, or (a ticket) needs. */
  gb: number;
  kind: string;
  /** The machine's host name: one person, on a shared view. */
  person: string;
  pid: number;
  /** Milliseconds since 1970: when the job joined the line, or took its memory. */
  since: number;
  /** The record's version: a later plugin may write another shape. */
  v: 1;
  what: string;
}

export function holderText(record: HolderRecord): string {
  return JSON.stringify(record);
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
  const { checkout, gb, kind, person, pid, since, what } = value;
  if (
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
  return { checkout, gb, kind, person, pid, since, v: 1, what };
}

// ── What a store offers (the lease folder, or a test's fake) ───────────────────

/** Memory held right now, and its holder's text (untrusted). */
export interface StoreHeld {
  readonly gb: number;
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
  readonly gb: number;
  release(): void;
}

/** Live readings for the live check. */
export interface LiveReading {
  availableBytes: number;
  /** What the heavy jobs' memory group uses now; null when it cannot be read. */
  sliceBytes: number | null;
}

export interface Store {
  /** Every GB this store can give out, read again for every decision. */
  capacityGb(): Promise<number>;
  /** Joins the line. Null when that cannot happen right now (try again next round). */
  enqueue(recordText: string): Promise<StoreTicket | null>;
  /** Memory held right now. */
  held(): Promise<readonly StoreHeld[]>;
  /** "this machine", or a shared folder: how waiting lines name it. */
  readonly label: string;
  /** Live readings of this machine's memory, or none. */
  readonly live?: (() => LiveReading | null) | undefined;
  /** Used by several machines or users: fair share applies, and its pids may be foreign. */
  readonly shared: boolean;
  /** All `gb` or nothing. Null when it is not all free right now. */
  tryTake(gb: number, recordText: string): Promise<StoreUnits | null>;
}

// ── The decision: pure, so every rule above is tested without a store ─────────

const GIB = 1024 ** 3;

/**
 * Does a job needing `needGb` fit the machine's real memory? `heldGbHere` is what jobs
 * admitted here reserved; what they have not used yet is that less the heavy jobs'
 * group's memory now (or all of it, when the group cannot be read). With nothing admitted
 * here it always fits (THE LIVE CHECK above).
 */
export function liveCheckFits(input: {
  heldGbHere: number;
  availableBytes: number;
  needGb: number;
  sliceBytes: number | null;
}): boolean {
  if (input.heldGbHere <= 0) return true;
  const usedGb = input.sliceBytes === null ? 0 : input.sliceBytes / GIB;
  const notYetUsedGb = Math.max(0, input.heldGbHere - usedGb);
  return input.availableBytes / GIB - notYetUsedGb >= input.needGb;
}

export interface ParsedHeld {
  gb: number;
  holder: HolderRecord | null;
}

export interface ParsedEntry {
  mine: boolean;
  person: string | null;
  /** A ticket whose text does not parse sorts last: it never holds anyone up. */
  since: number;
  tie: string;
}

export function parseEntry(entry: StoreLineEntry): ParsedEntry {
  const record = parseHolder(entry.text);
  return {
    mine: entry.mine,
    person: record?.person ?? null,
    since: record?.since ?? Number.POSITIVE_INFINITY,
    tie: entry.tie,
  };
}

function isBefore(a: ParsedEntry, b: ParsedEntry): boolean {
  return a.since < b.since || (a.since === b.since && a.tie < b.tie);
}

export type WaitReason =
  | { availableGb: number; kind: "live"; notYetUsedGb: number }
  | { capacityGb: number; heldGb: number; kind: "fair-share" }
  | { capacityGb: number; kind: "alone" }
  | { freeGb: number; kind: "no-room" }
  | { kind: "behind" }
  | { kind: "no-ticket" };

export type Decision = { take: number } | { wait: WaitReason };

export interface DecideInput {
  capacityGb: number;
  gb: number;
  held: readonly ParsedHeld[];
  line: readonly ParsedEntry[];
  live: LiveReading | null;
  /** The person waiting: this machine's host name. */
  person: string;
  shared: boolean;
}

function gbHeldBy(held: readonly ParsedHeld[], person: string): number {
  return held.reduce((sum, unit) => sum + (unit.holder?.person === person ? unit.gb : 0), 0);
}

/** May this job take memory now, and how much? Every rule of the header, in one place. */
export function decide(input: DecideInput): Decision {
  const heldGb = input.held.reduce((sum, unit) => sum + unit.gb, 0);
  const { line } = input;
  // Fair share: a person at half the budget or more steps aside while someone else waits.
  const steppedAside = (person: string | null): boolean =>
    input.shared &&
    person !== null &&
    gbHeldBy(input.held, person) * 2 >= input.capacityGb &&
    line.some((entry) => entry.person !== null && entry.person !== person);
  const me = line.find((entry) => entry.mine);
  if (me === undefined) return { wait: { kind: "no-ticket" } };
  if (steppedAside(input.person)) {
    return {
      wait: {
        capacityGb: input.capacityGb,
        heldGb: gbHeldBy(input.held, input.person),
        kind: "fair-share",
      },
    };
  }
  const ahead = line.some(
    (entry) => !entry.mine && isBefore(entry, me) && !steppedAside(entry.person),
  );
  if (ahead) return { wait: { kind: "behind" } };

  if (input.gb > input.capacityGb) {
    // Bigger than the whole budget: alone, or not at all. Alone, the live check passes.
    return heldGb > 0
      ? { wait: { capacityGb: input.capacityGb, kind: "alone" } }
      : { take: input.capacityGb };
  }
  const freeGb = input.capacityGb - heldGb;
  if (freeGb < input.gb) return { wait: { freeGb: Math.max(0, freeGb), kind: "no-room" } };
  if (
    input.live !== null &&
    !liveCheckFits({
      heldGbHere: heldGb,
      availableBytes: input.live.availableBytes,
      needGb: input.gb,
      sliceBytes: input.live.sliceBytes,
    })
  ) {
    const usedGb = input.live.sliceBytes === null ? 0 : input.live.sliceBytes / GIB;
    return {
      wait: {
        availableGb: input.live.availableBytes / GIB,
        kind: "live",
        notYetUsedGb: Math.max(0, heldGb - usedGb),
      },
    };
  }
  return { take: input.gb };
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

function reasonText(reason: WaitReason, store: string): string {
  switch (reason.kind) {
    case "alone":
      return `it needs more than ${store}'s whole budget of ${reason.capacityGb} GB, so it runs alone once nothing else holds any`;
    case "behind":
      return `an older job is first in ${store}'s line`;
    case "fair-share":
      return `this machine already holds ${reason.heldGb} of ${store}'s ${reason.capacityGb} GB while another person waits`;
    case "live":
      return `${store} has ${oneDecimal(reason.availableGb)} GB really free, and running jobs will still grow into ${oneDecimal(reason.notYetUsedGb)} GB of it`;
    case "no-room":
      return `only ${reason.freeGb} GB of ${store}'s budget is free`;
    case "no-ticket":
      return `${store}'s line cannot be joined right now`;
  }
}

/** One line per holder, its units added up; unreadable holders together as "unknown". */
export function holderLines(held: readonly ParsedHeld[], store: string, now: number): string[] {
  const groups = new Map<string, { gb: number; record: HolderRecord | null }>();
  for (const unit of held) {
    const key =
      unit.holder === null
        ? "unknown"
        : `${unit.holder.person}\0${unit.holder.pid}\0${unit.holder.since}`;
    const group = groups.get(key) ?? { gb: 0, record: unit.holder };
    group.gb += unit.gb;
    groups.set(key, group);
  }
  return [...groups.values()].map(({ gb, record }) =>
    record === null
      ? `  ${store}: ${gb} GB held by an unknown holder`
      : `  ${store}: ${gb} GB held by ${record.person}: ${record.kind}, ${record.what} in ${record.checkout}, since ${formatSince(record.since, now)} (pid ${record.pid})`,
  );
}

// ── The engine ─────────────────────────────────────────────────────────────────

/** How often a waiting job looks again. */
const POLL_MS = 500;
/** How often a waiting job says it still waits. */
const WAITING_LINE_EVERY_MS = 60_000;

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

const NOTHING_HELD: StoreUnits = { gb: 0, release: () => undefined };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Takes `job.gb` from every store in turn: the order given is the order taken, and every
 * process gives the same order (this machine, then each shared folder). Given back in
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
  const recordText = (since: number) =>
    holderText({
      checkout: job.checkout,
      gb: job.gb,
      kind: job.kind,
      person: options.person,
      pid: job.pid,
      since,
      v: 1,
      what: job.what,
    });

  const taken: StoreUnits[] = [];
  const release = once(() => {
    for (const units of [...taken].reverse()) units.release();
  });
  let waitStartedAt: number | null = null;
  let lastLineAt = Number.NEGATIVE_INFINITY;

  const report = async (store: Store, reason: WaitReason) => {
    const at = now();
    if (at - lastLineAt < lineEveryMs) return;
    waitStartedAt ??= at;
    lastLineAt = at;
    const waited = Math.round((at - waitStartedAt) / 60_000);
    const budgets: string[] = [];
    const holders: string[] = [];
    for (const each of stores) {
      const capacity = await each.capacityGb();
      const held = (await each.held()).map((unit) => ({
        gb: unit.gb,
        holder: parseHolder(unit.text),
      }));
      const free = Math.max(0, capacity - held.reduce((sum, unit) => sum + unit.gb, 0));
      budgets.push(`${each.label}: ${free} of ${capacity} GB free`);
      holders.push(...holderLines(held, each.label, at));
    }
    options.onWaiting(
      `Heavy job waits for memory: ${job.what} needs ${job.gb} GB${waited > 0 ? ` (waiting ${waited} min)` : ""}. ${budgets.join("; ")}. Why: ${reasonText(reason, store.label)}.`,
    );
    for (const line of holders) options.onWaiting(line);
  };

  const stopIfAsked = () => {
    if (options.signal?.aborted === true) throw new WaitStoppedError("the wait was stopped");
  };

  const takeFrom = async (store: Store): Promise<StoreUnits> => {
    let ticket: StoreTicket | null = null;
    try {
      for (;;) {
        stopIfAsked();
        ticket ??= await store.enqueue(recordText(now()));
        let reason: WaitReason;
        if (ticket === null) {
          reason = { kind: "no-ticket" };
        } else {
          const line = (await ticket.line()).map(parseEntry);
          const me = line.find((entry) => entry.mine);
          // Not first, and no fair share to skip anyone: the store need not be read.
          const plainlyBehind =
            !store.shared &&
            me !== undefined &&
            line.some((entry) => !entry.mine && isBefore(entry, me));
          let decision: Decision;
          if (plainlyBehind) {
            decision = { wait: { kind: "behind" } };
          } else {
            const held = (await store.held()).map((unit) => ({
              gb: unit.gb,
              holder: parseHolder(unit.text),
            }));
            decision = decide({
              capacityGb: await store.capacityGb(),
              gb: job.gb,
              held,
              line,
              live: store.live?.() ?? null,
              person: options.person,
              shared: store.shared,
            });
          }
          if ("take" in decision) {
            const units = await store.tryTake(decision.take, recordText(now()));
            if (units !== null) return units;
            // Someone took part of it between the look and the take: look again.
            reason = { freeGb: 0, kind: "no-room" };
          } else {
            reason = decision.wait;
          }
        }
        await report(store, reason);
        await sleep(pollMs);
      }
    } catch (error) {
      if (error instanceof WaitStoppedError) throw error;
      // A store that fails must not stop the job: it runs without that budget.
      note(
        `The heavy-job queue for ${store.label} failed (${messageOf(error)}): this job runs without that budget.`,
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
  return { gb: job.gb, release };
}

/**
 * The pids in the reservations `held` returns. From a shared store, only those `person`
 * wrote: another machine's pids belong to another process table.
 */
export async function pidsHolding(
  stores: readonly Store[],
  person: string,
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
      pids.add(record.pid);
    }
  }
  return pids;
}
