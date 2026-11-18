import { expect, test } from "bun:test";
import { tempDir } from "../testing/temp";
import {
  acquireFrom,
  type DecideInput,
  decide,
  holderText,
  inLineOrder,
  jobsAhead,
  type ParsedEntry,
  type ParsedHeld,
  parseHolder,
  placeText,
  type QueuedJob,
  type WaitReason,
  WaitStoppedError,
} from "./queue";
import { type LeaseStore, leaseStore } from "./store";

const entry = (mine: boolean, since: number): ParsedEntry => ({
  mine,
  since,
  tie: String(since),
  exclusive: null,
  slot: true,
  person: "host",
});
const job: QueuedJob = {
  checkout: "/repo",
  kind: "build",
  pid: process.pid,
  slot: true,
  what: "build",
};

test("the machine has exactly one heavy slot", () => {
  expect(
    decide({
      exclusive: null,
      slot: true,
      held: [{ holder: null, slot: true }],
      line: [entry(true, 0)],
    }),
  ).toEqual({ wait: { kind: "no-room", capacity: 1 } });
});
test("oldest ticket wins, with stable tie breaking", () => {
  expect(
    decide({ exclusive: null, slot: true, held: [], line: [entry(false, 1), entry(true, 2)] }),
  ).toEqual({ wait: { kind: "behind" } });
  expect(
    decide({ exclusive: null, slot: true, held: [], line: [entry(true, 1), entry(false, 2)] }),
  ).toEqual({ take: true });
});
test("holder records round trip and invalid input is unknown", () => {
  const holder = {
    checkout: "/repo",
    kind: "build",
    person: "host",
    pid: 1,
    since: 1,
    slot: true,
    v: 1 as const,
    what: "build",
  };
  expect(parseHolder(holderText(holder))).toEqual(holder);
  expect(parseHolder("{")).toBeNull();
});
test("takes one lease, waits, then releases idempotently", async () => {
  const store = leaseStore({ dir: tempDir("jobs-queue"), label: "machine" });
  const first = await acquireFrom([store], job, { person: "host", onWaiting: () => {} });
  let slept = false;
  const lines: string[] = [];
  const second = await acquireFrom([store], job, {
    person: "host",
    onWaiting: (line) => lines.push(line),
    sleep: async () => {
      slept = true;
      first.release();
    },
  });
  expect(slept).toBe(true);
  expect(lines[0]).toContain("only slot is taken");
  expect(await store.held()).toHaveLength(1);
  second.release();
  second.release();
  expect(await store.held()).toEqual([]);
  expect(await store.waiting()).toEqual([]);
});
// ── The place in line, and the hint at the background ───────────────────────────

const BACKGROUND_HINT =
  "A long wait: run it in the background (run_in_background) so the call does not time out.";

/** A held lease whose record names `exclusive` (a name held, with or without a slot). */
const holding = (exclusive: string | null, slot: boolean): ParsedHeld => ({
  slot,
  holder: {
    checkout: "/repo",
    ...(exclusive === null ? {} : { exclusive }),
    kind: "build",
    person: "host",
    pid: 1,
    since: 0,
    slot,
    v: 1,
    what: "build",
  },
});

/** The reason `decide` gives, and the jobs ahead of this one that keep it waiting. */
function placeOf(input: DecideInput): { ahead: number; reason: WaitReason } {
  const decision = decide(input);
  if (!("wait" in decision)) throw new Error("this job takes the slot: nothing to wait for");
  return { ahead: jobsAhead(input, decision.wait), reason: decision.wait };
}

test("the place: the first in line has nobody ahead, only the holder", () => {
  expect(
    placeOf({ exclusive: null, slot: true, held: [holding(null, true)], line: [entry(true, 1)] }),
  ).toEqual({ ahead: 0, reason: { kind: "no-room", capacity: 1 } });
});
test("the place: the 2nd and the 3rd in line count the jobs older than them", () => {
  const held = [holding(null, true)];
  const second = placeOf({
    exclusive: null,
    slot: true,
    held,
    line: [entry(false, 1), entry(true, 2), entry(false, 3)],
  });
  expect(second).toEqual({ ahead: 1, reason: { kind: "behind" } });
  const third = placeOf({
    exclusive: null,
    slot: true,
    held,
    line: [entry(false, 1), entry(false, 2), entry(true, 3), entry(false, 4)],
  });
  expect(third).toEqual({ ahead: 2, reason: { kind: "behind" } });
});
test("the place: a job that does not keep this one waiting is not counted", () => {
  const held = [holding("db", false)];
  const sameNameElsewhere = { ...entry(false, 1), slot: false, exclusive: "docs" };
  const nameOnly = { ...entry(false, 2), slot: false };
  const waitsForHeldName = { ...entry(false, 3), exclusive: "db" };
  // Only the older job that takes a slot counts: a name-only ticket takes none, and a ticket
  // for a name someone holds cannot run before this job either.
  const real = entry(false, 0);
  expect(
    placeOf({
      exclusive: null,
      slot: true,
      held,
      line: [real, sameNameElsewhere, nameOnly, waitsForHeldName, entry(true, 4)],
    }).ahead,
  ).toBe(1);
});
test("the place: several slots count the jobs that block this one, not every ticket", () => {
  // Capacity 2, one slot taken: the older ticket is first for the free slot, and this one is
  // behind it. The ticket without a slot (a name only) is not in the way.
  const input: DecideInput = {
    capacity: 2,
    exclusive: null,
    slot: true,
    held: [holding(null, true)],
    line: [entry(false, 1), { ...entry(false, 2), slot: false }, entry(true, 3)],
  };
  expect(placeOf(input)).toEqual({ ahead: 1, reason: { kind: "behind" } });
  // Nobody older: this job takes the free slot, nothing waits.
  expect(decide({ ...input, line: [entry(true, 1)] })).toEqual({ take: true });
});
test("the place: an exclusive-name wait counts only the jobs that wait for that name", () => {
  const me = { ...entry(true, 4), slot: false, exclusive: "db" };
  const input: DecideInput = {
    exclusive: "db",
    slot: false,
    held: [holding("db", false)],
    line: [
      { ...entry(false, 1), slot: false, exclusive: "db" },
      // A job for a slot, and one for another name: neither is in this job's way.
      entry(false, 2),
      { ...entry(false, 3), slot: false, exclusive: "docs" },
      me,
    ],
  };
  expect(placeOf(input)).toEqual({ ahead: 1, reason: { kind: "exclusive", name: "db" } });
});
test("the line order: oldest first, an equal start by token, an unreadable record last", () => {
  const at = (since: number, tie: string) => ({ since, tie });
  expect(inLineOrder(at(1, "b"), at(2, "a"))).toBe(-1);
  expect(inLineOrder(at(2, "a"), at(1, "b"))).toBe(1);
  expect(inLineOrder(at(1, "a"), at(1, "b"))).toBe(-1);
  expect(inLineOrder(at(1, "b"), at(1, "a"))).toBe(1);
  expect(inLineOrder(at(1, "a"), at(1, "a"))).toBe(0);
  expect(inLineOrder(at(Number.POSITIVE_INFINITY, "a"), at(5, "z"))).toBe(1);
  expect(inLineOrder(at(Number.POSITIVE_INFINITY, "a"), at(Number.POSITIVE_INFINITY, "b"))).toBe(
    -1,
  );
  // `decide` serves in the same order: the older ticket is the one in the way.
  const older = { ...entry(false, 1), tie: "b" };
  const newer = { ...entry(true, 1), tie: "c" };
  expect(decide({ exclusive: null, slot: true, held: [], line: [newer, older] })).toEqual({
    wait: { kind: "behind" },
  });
});
test("the place: no ticket, nothing ahead to count", () => {
  const input: DecideInput = { exclusive: null, slot: true, held: [], line: [] };
  expect(jobsAhead(input, { kind: "no-ticket" })).toBe(0);
});
test("the place is said in ordinals: 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 103rd", () => {
  expect(placeText(0)).toBe("");
  expect(placeText(1)).toBe("Place: 2nd in line, 1 job ahead.");
  expect(placeText(2)).toBe("Place: 3rd in line, 2 jobs ahead.");
  expect(placeText(3)).toBe("Place: 4th in line, 3 jobs ahead.");
  expect(placeText(10)).toBe("Place: 11th in line, 10 jobs ahead.");
  expect(placeText(11)).toBe("Place: 12th in line, 11 jobs ahead.");
  expect(placeText(12)).toBe("Place: 13th in line, 12 jobs ahead.");
  expect(placeText(20)).toBe("Place: 21st in line, 20 jobs ahead.");
  expect(placeText(21)).toBe("Place: 22nd in line, 21 jobs ahead.");
  expect(placeText(102)).toBe("Place: 103rd in line, 102 jobs ahead.");
});

/** Waits in the line for `store` until `stop` is aborted; resolves when the wait ends. */
function waiter(store: LeaseStore, lines: string[], at: number, stop: AbortController) {
  return acquireFrom([store], job, {
    person: "host",
    now: () => at,
    onWaiting: (line) => lines.push(line),
    pollMs: 1,
    signal: stop.signal,
    sleep: (ms) => Bun.sleep(ms),
  }).catch((error: unknown) => {
    if (!(error instanceof WaitStoppedError)) throw error;
  });
}

test("the first waiting line names the place: the 1st job says only that the slot is taken", async () => {
  const store = leaseStore({ dir: tempDir("jobs-place"), label: "machine" });
  const holder = await acquireFrom([store], job, { person: "host", onWaiting: () => {} });
  const stopB = new AbortController();
  const stopC = new AbortController();
  const linesB: string[] = [];
  const linesC: string[] = [];
  const b = waiter(store, linesB, 1000, stopB);
  try {
    while ((await store.waiting()).length < 1) await Bun.sleep(1);
    const c = waiter(store, linesC, 2000, stopC);
    while (linesC.length < 1 || linesB.length < 1) await Bun.sleep(1);
    stopB.abort();
    stopC.abort();
    await Promise.all([b, c]);
    expect(linesB[0]).toBe(
      "Heavy job waits for a free slot: build. Why: this machine's only slot is taken.",
    );
    expect(linesC[0]).toBe(
      "Heavy job waits for a free slot: build. Why: an older job is first in line. Place: 2nd in line, 1 job ahead.",
    );
  } finally {
    stopB.abort();
    stopC.abort();
    await b;
    holder.release();
  }
});
test("the first waiting line says once that a long wait should run in the background", async () => {
  const store = leaseStore({ dir: tempDir("jobs-hint"), label: "machine" });
  const first = await acquireFrom([store], job, { person: "host", onWaiting: () => {} });
  let rounds = 0;
  const lines: string[] = [];
  const second = await acquireFrom([store], job, {
    person: "host",
    onWaiting: (line) => lines.push(line),
    waitingLineEveryMs: 0,
    sleep: async () => {
      rounds++;
      if (rounds === 3) first.release();
    },
  });
  second.release();
  // Three waiting lines, and the hint after the first one only.
  expect(lines.filter((line) => line.startsWith("Heavy job waits"))).toHaveLength(3);
  expect(lines.filter((line) => line === BACKGROUND_HINT)).toHaveLength(1);
  expect(lines.indexOf(BACKGROUND_HINT)).toBe(2);
});
test("a stopped wait releases its ticket, not another job's slot", async () => {
  const store = leaseStore({ dir: tempDir("jobs-stop"), label: "machine" });
  const first = await acquireFrom([store], job, { person: "host", onWaiting: () => {} });
  const stop = new AbortController();
  try {
    await expect(
      acquireFrom([store], job, {
        person: "host",
        signal: stop.signal,
        onWaiting: () => {},
        sleep: async () => stop.abort(),
      }),
    ).rejects.toBeInstanceOf(WaitStoppedError);
    expect(await store.waiting()).toEqual([]);
    expect(await store.held()).toHaveLength(1);
  } finally {
    first.release();
  }
});
test("store errors fail closed", async () => {
  const store = leaseStore({ dir: tempDir("jobs-error"), label: "machine" });
  store.held = async () => {
    throw new Error("unreadable");
  };
  await expect(acquireFrom([store], job, { person: "host", onWaiting: () => {} })).rejects.toThrow(
    "unreadable",
  );
  expect(await store.waiting()).toEqual([]);
});
