/**
 * The queue engine (`queue.ts`): the decision, the order, the waiting lines, and what
 * happens when a store fails. What a wrong answer costs: a queue that admits too much runs
 * the machine out of memory; one that never admits a job hangs a push hook for ever.
 *
 * The engine runs against fake stores and a fake clock: the stores are storage, the rules
 * live in `queue.ts`. The real store (`store.ts`) has its own tests.
 */
import { describe, expect, test } from "bun:test";
import {
  acquireFrom,
  type DecideInput,
  decide,
  formatSince,
  type HolderRecord,
  holderText,
  type LiveReading,
  liveCheckFits,
  type ParsedEntry,
  parseHolder,
  pidsHolding,
  type QueuedJob,
  type Reservation,
  type Store,
  type StoreHeld,
  type StoreLineEntry,
  type StoreTicket,
  type StoreUnits,
  WaitStoppedError,
} from "./queue";

const GIB = 1024 ** 3;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what}, got nothing`);
  return value;
}

// ── Holder records ─────────────────────────────────────────────────────────────

describe("parseHolder", () => {
  const record: HolderRecord = {
    checkout: "/home/user/app",
    gb: 14,
    kind: "build",
    person: "host-b",
    pid: 4242,
    since: 1_760_000_000_000,
    v: 1,
    what: "bun run build",
  };

  test("reads back what holderText wrote", () => {
    expect(parseHolder(holderText(record))).toEqual(record);
  });

  // Another machine wrote it: anything odd is an unknown holder, never a crash.
  test("calls malformed or foreign text unknown", () => {
    for (const text of [
      "",
      "garbage",
      "null",
      "[1]",
      JSON.stringify({ ...record, v: 2 }),
      JSON.stringify({ ...record, pid: "4242" }),
      JSON.stringify({ ...record, pid: 1.5 }),
      JSON.stringify({ ...record, since: null }),
      JSON.stringify({ ...record, person: 7 }),
      JSON.stringify({ ...record, gb: "8" }),
      JSON.stringify({ ...record, kind: undefined }),
    ]) {
      expect(parseHolder(text)).toBeNull();
    }
  });
});

// ── The decision ───────────────────────────────────────────────────────────────

function heldBy(person: string, gb: number, pid = 1) {
  return Array.from({ length: gb }, () => ({
    gb: 1,
    holder: {
      checkout: "/c",
      gb: 1,
      kind: "tsc",
      person,
      pid,
      since: 0,
      v: 1 as const,
      what: "x",
    },
  }));
}

function entry(
  tie: string,
  since: number,
  person: string | null,
  mine = false,
  wants: { gb?: number; exclusive?: string } = {},
): ParsedEntry {
  return { exclusive: wants.exclusive ?? null, gb: wants.gb ?? 8, mine, person, since, tie };
}

const alone = [entry("m", 1, "host-a", true)];

const base: DecideInput = {
  capacityGb: 30,
  exclusive: null,
  gb: 8,
  held: [],
  line: alone,
  live: null,
  person: "host-a",
  shared: false,
};

describe("decide", () => {
  test("takes what the job needs when it is first and it fits", () => {
    expect(decide({ ...base, held: heldBy("host-a", 20) })).toEqual({ take: 8 });
  });

  test("waits when the free GB is too few", () => {
    expect(decide({ ...base, held: heldBy("host-a", 23) })).toEqual({
      wait: { freeGb: 7, kind: "no-room" },
    });
  });

  test("waits without a ticket of its own in the line", () => {
    expect(decide({ ...base, line: [entry("x", 1, "host-a")] })).toEqual({
      wait: { kind: "no-ticket" },
    });
  });

  test("waits behind an older ticket, and ties go to the lower tie-breaker", () => {
    const line = [entry("c", 100, "host-a", true), entry("e", 90, "host-a")];
    expect(decide({ ...base, line })).toEqual({ wait: { kind: "behind" } });
    const tie = [entry("c", 100, "host-a", true), entry("a", 100, "host-a")];
    expect(decide({ ...base, line: tie })).toEqual({ wait: { kind: "behind" } });
    const after = [entry("c", 100, "host-a", true), entry("e", 100, "host-a")];
    expect(decide({ ...base, line: after })).toEqual({ take: 8 });
  });

  // A ticket that does not parse must never hold the line up.
  test("lets an unreadable ticket hold nobody up", () => {
    const line = [entry("c", 100, "host-a", true), entry("a", Number.POSITIVE_INFINITY, null)];
    expect(decide({ ...base, line })).toEqual({ take: 8 });
  });

  test("makes a person at half the shared budget step aside while another person waits", () => {
    const held = heldBy("host-a", 15);
    const line = [entry("a", 100, "host-a", true), entry("b", 200, "host-b")];
    expect(decide({ ...base, held, line, shared: true })).toEqual({
      wait: { capacityGb: 30, heldGb: 15, kind: "fair-share" },
    });
    // host-b's newer ticket goes ahead of host-a's older one.
    const bFirst = [entry("a", 100, "host-a"), entry("b", 200, "host-b", true)];
    expect(decide({ ...base, held, line: bFirst, person: "host-b", shared: true })).toEqual({
      take: 8,
    });
  });

  test("lets a person under half, or alone, use all of the shared budget", () => {
    const line = [entry("a", 100, "host-a", true), entry("b", 200, "host-b")];
    expect(decide({ ...base, held: heldBy("host-a", 14), line, shared: true })).toEqual({
      take: 8,
    });
    const own = [entry("a", 100, "host-a", true), entry("b", 200, "host-a")];
    expect(decide({ ...base, held: heldBy("host-a", 20), line: own, shared: true })).toEqual({
      take: 8,
    });
  });

  test("applies no fair share to a store only this machine uses", () => {
    const line = [entry("a", 100, "host-a", true), entry("b", 200, "host-b")];
    expect(decide({ ...base, held: heldBy("host-a", 20), line })).toEqual({ take: 8 });
  });

  test("runs a job bigger than the budget alone, taking all of it", () => {
    expect(decide({ ...base, capacityGb: 14, gb: 20 })).toEqual({ take: 14 });
    expect(decide({ ...base, capacityGb: 14, gb: 20, held: heldBy("x", 1) })).toEqual({
      wait: { capacityGb: 14, kind: "alone" },
    });
  });

  test("waits while the machine's real free memory is short, on top of the budget", () => {
    const live: LiveReading = { availableBytes: 10 * GIB, sliceBytes: 2 * GIB };
    // 6 GB reserved, 2 GB of it used: 4 GB still to come out of the 10 free.
    expect(decide({ ...base, held: heldBy("host-a", 6), live })).toEqual({
      wait: { availableGb: 10, kind: "live", notYetUsedGb: 4 },
    });
    expect(
      decide({ ...base, held: heldBy("host-a", 6), live: { ...live, sliceBytes: 4 * GIB } }),
    ).toEqual({ take: 8 });
  });
});

describe("decide: exclusive names", () => {
  const holdsName = (name: string) => [
    { gb: 0, holder: { ...must(heldBy("host-a", 1)[0], "a unit").holder, exclusive: name } },
  ];
  const named = (tie: string, since: number, mine: boolean, gb: number, name?: string) =>
    entry(tie, since, "host-a", mine, { gb, ...(name !== undefined && { exclusive: name }) });

  test("waits while a lease holds its name, with room to spare", () => {
    expect(decide({ ...base, exclusive: "image", held: holdsName("image") })).toEqual({
      wait: { kind: "exclusive", name: "image" },
    });
    // Another name is no matter.
    expect(decide({ ...base, exclusive: "image", held: holdsName("deploy") })).toEqual({
      take: 8,
    });
  });

  test("waits behind an older ticket with its name, even one that needs no memory", () => {
    const line = [named("a", 1, false, 0, "image"), named("m", 2, true, 8, "image")];
    expect(decide({ ...base, exclusive: "image", line })).toEqual({ wait: { kind: "behind" } });
  });

  test("a name-only job (0 GB) never waits behind jobs that wait for memory", () => {
    const line = [named("a", 1, false, 14), named("m", 2, true, 0, "image")];
    expect(
      decide({ ...base, exclusive: "image", gb: 0, held: heldBy("host-a", 30), line }),
    ).toEqual({ take: 0 });
  });

  test("an older ticket waiting for a held name holds up nobody's memory", () => {
    const line = [named("a", 1, false, 14, "image"), named("m", 2, true, 8)];
    expect(decide({ ...base, held: holdsName("image"), line })).toEqual({ take: 8 });
    // Once the name is free, it is first again.
    expect(decide({ ...base, line })).toEqual({ wait: { kind: "behind" } });
  });
});

describe("liveCheckFits", () => {
  test("counts reserved-but-unused memory against the free memory", () => {
    const fits = (heldGbHere: number, availableGb: number, sliceGb: number | null) =>
      liveCheckFits({
        heldGbHere,
        availableBytes: availableGb * GIB,
        needGb: 8,
        sliceBytes: sliceGb === null ? null : sliceGb * GIB,
      });
    expect(fits(8, 16, 0)).toBe(true);
    expect(fits(8, 15, 0)).toBe(false);
    // The jobs use more than they reserved: nothing more is still to come.
    expect(fits(8, 8, 12)).toBe(true);
  });

  // Used and not yet used cannot be told apart: counting the reservation again would count
  // what the jobs already use twice (it is already gone from the free memory).
  test("without a reading of the group, it is the plain free memory", () => {
    const fits = (availableGb: number) =>
      liveCheckFits({
        heldGbHere: 8,
        availableBytes: availableGb * GIB,
        needGb: 8,
        sliceBytes: null,
      });
    expect(fits(8)).toBe(true);
    expect(fits(7.9)).toBe(false);
  });

  // Otherwise a full browser could make a type check wait for ever.
  test("never stops a job when no other heavy job holds memory here", () => {
    expect(liveCheckFits({ heldGbHere: 0, availableBytes: 0, needGb: 14, sliceBytes: null })).toBe(
      true,
    );
  });
});

// ── The engine, on fake stores ─────────────────────────────────────────────────

/**
 * Storage only, the way the real store behaves: tickets with their record, units held with
 * their record, a take that is all or nothing. Every rule is the engine's.
 */
class FakeStore implements Store {
  readonly label: string;
  readonly shared: boolean;
  readonly live?: (() => LiveReading | null) | undefined;
  capacity: number;
  maxHeld = 0;
  /** The most leases with one exclusive name at once. */
  maxSameName = 0;
  private readonly units = new Map<number, StoreHeld & { exclusive?: string }>();
  private readonly tickets = new Map<string, string>();
  private readonly names: ReadonlySet<string> | null;
  private next = 0;

  constructor(options: {
    capacity: number;
    label: string;
    live?: (() => LiveReading | null) | undefined;
    shared?: boolean;
    /** The exclusive names it keeps; default (this machine): every name. */
    names?: readonly string[];
  }) {
    this.capacity = options.capacity;
    this.label = options.label;
    this.shared = options.shared ?? false;
    this.live = options.live;
    this.names = options.names === undefined ? null : new Set(options.names);
  }

  keepsExclusive(name: string): Promise<boolean> {
    return Promise.resolve(this.names === null || this.names.has(name));
  }

  heldGb(): number {
    return [...this.units.values()].reduce((sum, unit) => sum + unit.gb, 0);
  }

  liveTickets(): number {
    return this.tickets.size;
  }

  capacityGb(): Promise<number> {
    return Promise.resolve(this.capacity);
  }

  private tie(): string {
    return String(this.next++).padStart(6, "0");
  }

  enqueue(recordText: string): Promise<StoreTicket | null> {
    const tie = this.tie();
    this.tickets.set(tie, recordText);
    return Promise.resolve({
      line: () =>
        Promise.resolve(
          [...this.tickets].map(
            ([other, text]): StoreLineEntry => ({ mine: other === tie, tie: other, text }),
          ),
        ),
      release: () => {
        this.tickets.delete(tie);
      },
    });
  }

  held(): Promise<readonly StoreHeld[]> {
    return Promise.resolve([...this.units.values()].map(({ gb, text }) => ({ gb, text })));
  }

  /** A live ticket outside the engine, with whatever text its holder wrote. */
  foreignTicket(text: string): void {
    this.tickets.set(this.tie(), text);
  }

  /** A holder outside the engine: another program, or a record nobody can read. */
  hold(gb: number, text: string): () => void {
    const id = this.next++;
    this.units.set(id, { gb, text });
    return () => this.units.delete(id);
  }

  tryTake(gb: number, recordText: string, exclusive?: string): Promise<StoreUnits | null> {
    const sameName = () =>
      [...this.units.values()].filter((unit) => unit.exclusive === exclusive).length;
    if (exclusive !== undefined && sameName() > 0) return Promise.resolve(null);
    if (gb > 0 && this.capacity - this.heldGb() < gb) return Promise.resolve(null);
    const id = this.next++;
    this.units.set(id, { gb, text: recordText, ...(exclusive !== undefined && { exclusive }) });
    this.maxHeld = Math.max(this.maxHeld, this.heldGb());
    if (exclusive !== undefined) this.maxSameName = Math.max(this.maxSameName, sameName());
    return Promise.resolve({
      gb,
      release: () => {
        this.units.delete(id);
      },
    });
  }
}

/** A clock that moves only when a waiter sleeps, and a sleep that yields to the others. */
function fakeTime() {
  let now = new Date(2026, 9, 12, 12, 0).getTime();
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      await new Promise((done) => setImmediate(done));
    },
  };
}

async function settle(rounds = 40): Promise<void> {
  for (let round = 0; round < rounds; round++) await new Promise((done) => setImmediate(done));
}

function job(gb: number, what = `job ${gb} GB`, pid = 100): QueuedJob {
  return { checkout: "/work/app", gb, kind: "tsc", pid, what };
}

/** Starts an acquire and tracks whether it has been admitted. */
function start(
  stores: readonly Store[],
  heavy: QueuedJob,
  time: ReturnType<typeof fakeTime>,
  person = "host-a",
  lines: string[] = [],
) {
  const state: { reservation: Reservation | null } = { reservation: null };
  void acquireFrom(stores, heavy, {
    now: time.now,
    onWaiting: (line) => lines.push(line),
    person,
    sleep: time.sleep,
  }).then((reservation) => {
    state.reservation = reservation;
  });
  return state;
}

describe("acquireFrom: the waiting order", () => {
  // The failure this prevents: a build that never runs while test runs keep arriving.
  test("does not starve a 14 GB job behind a stream of 2 GB jobs: oldest first", async () => {
    const time = fakeTime();
    const store = new FakeStore({ capacity: 16, label: "this machine" });
    const first = start([store], job(2), time);
    await settle();
    const second = start([store], job(2), time);
    await settle();
    expect(first.reservation?.gb).toBe(2);
    expect(second.reservation?.gb).toBe(2);

    const big = start([store], job(14, "build"), time);
    await settle();
    expect(big.reservation).toBeNull(); // 12 free, it needs 14

    // Small jobs keep arriving; 12 GB is free, but the build is first in line.
    const stream = [
      start([store], job(2), time),
      start([store], job(2), time),
      start([store], job(2), time),
    ];
    await settle(200);
    expect(stream.map((each) => each.reservation)).toEqual([null, null, null]);

    first.reservation?.release();
    second.reservation?.release();
    await settle(200);
    expect(big.reservation?.gb).toBe(14);
    // 2 GB left: one small job gets in beside the build; the next two wait for it.
    expect(stream.filter((each) => each.reservation !== null)).toHaveLength(1);
    expect(store.heldGb()).toBe(16);

    big.reservation?.release();
    await settle(200);
    expect(stream.every((each) => each.reservation !== null)).toBe(true);
  });

  test("runs a job bigger than the budget alone, once nothing else holds any", async () => {
    const time = fakeTime();
    const store = new FakeStore({ capacity: 14, label: "this machine" });
    const small = start([store], job(2), time);
    await settle();
    const huge = start([store], job(20, "image build"), time);
    await settle(100);
    expect(huge.reservation).toBeNull();

    small.reservation?.release();
    await settle(100);
    expect(store.heldGb()).toBe(14);
    expect(huge.reservation?.gb).toBe(20);

    const after = start([store], job(2), time);
    await settle(100);
    expect(after.reservation).toBeNull();
    huge.reservation?.release();
    await settle(100);
    expect(after.reservation?.gb).toBe(2);
  });

  test("never waits when nothing else holds memory here, however full the machine looks", async () => {
    const time = fakeTime();
    const store = new FakeStore({
      capacity: 32,
      label: "this machine",
      live: () => ({ availableBytes: 0.5 * GIB, sliceBytes: null }),
    });
    const lone = start([store], job(8), time);
    await settle();
    expect(lone.reservation?.gb).toBe(8);
    // A second one does wait: another heavy job runs here, and the free memory is short.
    const next = start([store], job(8), time);
    await settle(100);
    expect(next.reservation).toBeNull();
    lone.reservation?.release();
    await settle(100);
    expect(next.reservation?.gb).toBe(8);
  });

  test("gives the other person's newer job a shared budget first when one person holds half", async () => {
    const time = fakeTime();
    const host = new FakeStore({ capacity: 30, label: "/srv/shared", shared: true });
    const aBig = start([host], job(14), time, "host-a");
    const aSmall = start([host], job(2), time, "host-a");
    await settle();
    expect(host.heldGb()).toBe(16); // alone, host-a used more than half

    // 14 GB free: host-a's next job needs 16, so it waits, first in line.
    const aNext = start([host], job(16), time, "host-a");
    await settle(100);
    expect(aNext.reservation).toBeNull();

    // host-b's newer 8 GB job fits, and host-a, at half the budget, steps aside for it.
    const b = start([host], job(8), time, "host-b");
    await settle(200);
    expect(b.reservation?.gb).toBe(8);
    expect(aNext.reservation).toBeNull();

    // Running jobs are never stopped; once there is room, host-a's turn comes.
    b.reservation?.release();
    aSmall.reservation?.release();
    await settle(200);
    expect(aNext.reservation?.gb).toBe(16);
    expect(host.heldGb()).toBe(30);
    aBig.reservation?.release();
  });

  // Foreign or half-written text in a live ticket must never stop the line for good.
  test("is not held up by a live ticket whose text does not parse", async () => {
    const time = fakeTime();
    const store = new FakeStore({ capacity: 16, label: "this machine" });
    store.foreignTicket("garbage");
    store.foreignTicket(JSON.stringify({ since: 0, v: 9 }));
    const lone = start([store], job(8), time);
    await settle(50);
    expect(lone.reservation?.gb).toBe(8);
  });

  test("gives the budgets back in reverse, and only once", async () => {
    const time = fakeTime();
    const order: string[] = [];
    const tracked = (label: string) => {
      const store = new FakeStore({ capacity: 10, label });
      const take = store.tryTake.bind(store);
      store.tryTake = async (gb, text) => {
        const units = await take(gb, text);
        return units === null
          ? null
          : {
              gb,
              release: () => {
                order.push(label);
                units.release();
              },
            };
      };
      return store;
    };
    const machine = tracked("this machine");
    const host = tracked("/srv/shared");
    const one = start([machine, host], job(4), time);
    await settle();
    one.reservation?.release();
    one.reservation?.release();
    expect(order).toEqual(["/srv/shared", "this machine"]);
    expect(machine.heldGb() + host.heldGb()).toBe(0);
    expect(machine.liveTickets() + host.liveTickets()).toBe(0);
  });

  test("stops a wait on a signal: the ticket and what it took are given back", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ capacity: 10, label: "this machine" });
    const host = new FakeStore({ capacity: 10, label: "/srv/shared", shared: true });
    const blocker = host.hold(10, "");
    const stop = new AbortController();
    let failure: unknown = null;
    void acquireFrom([machine, host], job(4), {
      now: time.now,
      onWaiting: () => undefined,
      person: "host-a",
      sleep: time.sleep,
      signal: stop.signal,
    }).catch((error: unknown) => {
      failure = error;
    });
    await settle(50);
    // It holds this machine's 4 GB, and waits in the shared line.
    expect(machine.heldGb()).toBe(4);
    expect(host.liveTickets()).toBe(1);
    stop.abort();
    await settle(50);
    expect(failure).toBeInstanceOf(WaitStoppedError);
    expect(machine.heldGb()).toBe(0);
    expect(host.liveTickets()).toBe(0);
    blocker();
  });
});

/** A small deterministic random sequence (mulberry32), so a failing run repeats. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("acquireFrom: two budgets", () => {
  // Three containers, each with its own budget, sharing one budget smaller than their sum.
  // Every job takes its machine first, then the shared one. A circle (one job holding its
  // machine and waiting for the shared budget, while the shared line's next job waits for
  // that machine) would stop them all.
  test("never deadlocks, and never gives out more than a budget holds", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = seeded(seed);
      const time = fakeTime();
      const host = new FakeStore({ capacity: 12, label: "/srv/shared", shared: true });
      const machines = ["host-a", "host-b", "host-c"].map((person) => ({
        person,
        store: new FakeStore({ capacity: 10, label: "this machine" }),
      }));
      let finished = 0;
      const total = 30;
      const runs: Promise<void>[] = [];
      for (let index = 0; index < total; index++) {
        const machine = must(machines[Math.floor(random() * machines.length)], "a machine");
        const gb = must([2, 4, 6, 8][Math.floor(random() * 4)], "a size");
        const holdFor = 1 + Math.floor(random() * 20);
        runs.push(
          (async () => {
            await time.sleep(Math.floor(random() * 5) * 500);
            const reservation = await acquireFrom(
              [machine.store, host],
              job(gb, `run ${index}`, index),
              {
                now: time.now,
                onWaiting: () => undefined,
                person: machine.person,
                sleep: time.sleep,
              },
            );
            for (let tick = 0; tick < holdFor; tick++) await time.sleep(500);
            reservation.release();
            finished++;
          })(),
        );
      }
      await settle(20_000);
      expect(finished).toBe(total);
      expect(host.maxHeld).toBeLessThanOrEqual(12);
      for (const { store } of machines) expect(store.maxHeld).toBeLessThanOrEqual(10);
      expect(host.heldGb() + machines.reduce((sum, { store }) => sum + store.heldGb(), 0)).toBe(0);
      await Promise.all(runs);
    }
  });

  test("joins a shared line only once it holds its own machine's share", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ capacity: 10, label: "this machine" });
    const host = new FakeStore({ capacity: 30, label: "/srv/shared", shared: true });
    const blocker = machine.hold(8, "");
    const waiting = start([machine, host], job(4), time);
    await settle(100);
    expect(waiting.reservation).toBeNull();
    expect(host.liveTickets()).toBe(0);
    blocker();
    await settle(100);
    expect(waiting.reservation?.gb).toBe(4);
    expect(host.heldGb()).toBe(4);
  });
});

describe("acquireFrom: waiting lines", () => {
  test("says what it needs, the free GB per budget, and who holds the rest; then once a minute", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ capacity: 32, label: "this machine" });
    const host = new FakeStore({ capacity: 30, label: "/srv/shared", shared: true });
    const since = new Date(2026, 9, 12, 11, 44).getTime();
    machine.hold(
      28,
      holderText({
        checkout: "/home/user/app",
        gb: 28,
        kind: "build",
        person: "host-a",
        pid: 77,
        since,
        v: 1,
        what: "bun run build",
      }),
    );
    machine.hold(2, "not a record");
    const lines: string[] = [];
    const reportedAt: number[] = [];
    let admitted = false;
    void acquireFrom([machine, host], job(8, "bunx tsc --noEmit"), {
      now: time.now,
      onWaiting: (line) => {
        lines.push(line);
        if (line.startsWith("Heavy job waits")) reportedAt.push(time.now());
      },
      person: "host-a",
      sleep: time.sleep,
    }).then(() => {
      admitted = true;
    });
    await settle(20);

    expect(admitted).toBe(false);
    expect(lines[0]).toBe(
      "Heavy job waits for memory: bunx tsc --noEmit needs 8 GB. this machine: 2 of 32 GB free; /srv/shared: 30 of 30 GB free. Why: only 2 GB of this machine's budget is free.",
    );
    // The fake clock starts at 12:00 the same day: the holder's start reads as a time.
    expect(lines.slice(1, 3)).toEqual([
      "  this machine: 28 GB held by host-a: build, bun run build in /home/user/app, since 11:44 (pid 77)",
      "  this machine: 2 GB held by an unknown holder",
    ]);
    // About 20 polls of half a second so far: still one report.
    expect(reportedAt).toHaveLength(1);
    while (reportedAt.length < 3) await settle(1);
    // Then one a minute, not one a poll.
    const [first, second, third] = reportedAt;
    expect(must(second, "a second report") - must(first, "a first report")).toBe(60_000);
    expect(must(third, "a third report") - must(second, "a second report")).toBe(60_000);
    expect(lines.filter((line) => line.startsWith("Heavy job waits"))[1]).toContain(
      "(waiting 1 min)",
    );
  });

  test("formats a holder's start as a time today, and with the date on another day", () => {
    const now = new Date(2026, 9, 12, 15, 0).getTime();
    expect(formatSince(new Date(2026, 9, 12, 9, 5).getTime(), now)).toBe("09:05");
    expect(formatSince(new Date(2026, 9, 11, 23, 59).getTime(), now)).toBe("2026-10-11 23:59");
  });
});

describe("acquireFrom: a store that fails", () => {
  test("runs the job without that budget instead of crashing, and says so", async () => {
    const time = fakeTime();
    const broken = new FakeStore({ capacity: 10, label: "/srv/shared", shared: true });
    broken.held = () => Promise.reject(new Error("EIO"));
    const machine = new FakeStore({ capacity: 10, label: "this machine" });
    const notes: string[] = [];
    const reservation = await acquireFrom([machine, broken], job(4), {
      now: time.now,
      onNote: (line) => notes.push(line),
      onWaiting: () => undefined,
      person: "host-a",
      sleep: time.sleep,
    });
    expect(reservation.gb).toBe(4);
    expect(machine.heldGb()).toBe(4);
    expect(notes).toEqual([
      "The heavy-job queue for /srv/shared failed (EIO): this job runs without that budget.",
    ]);
    expect(broken.liveTickets()).toBe(0);
  });

  // The waiting report reads every store. A shared one it cannot read must not end the wait
  // on this machine's own budget: the job would run on a full machine.
  test("a shared store that cannot be read never drops this machine's budget: the job keeps waiting", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ capacity: 10, label: "this machine" });
    const broken = new FakeStore({ capacity: 30, label: "/srv/shared", shared: true });
    broken.held = () => Promise.reject(new Error("EIO"));
    const blocker = machine.hold(10, "not a record");
    const lines: string[] = [];
    const notes: string[] = [];
    let admitted: Reservation | null = null;
    void acquireFrom([machine, broken], job(4), {
      now: time.now,
      onNote: (line) => notes.push(line),
      onWaiting: (line) => lines.push(line),
      person: "host-a",
      sleep: time.sleep,
    }).then((reservation) => {
      admitted = reservation;
    });
    await settle(100);
    expect(admitted).toBeNull();
    expect(lines[0]).toBe(
      "Heavy job waits for memory: job 4 GB needs 4 GB. this machine: 0 of 10 GB free; /srv/shared: cannot be read. Why: only 0 GB of this machine's budget is free.",
    );
    expect(notes).toEqual([]);
    blocker();
    await settle(100);
    expect((admitted as Reservation | null)?.gb).toBe(4);
    expect(machine.heldGb()).toBe(4);
    expect(notes).toEqual([
      "The heavy-job queue for /srv/shared failed (EIO): this job runs without that budget.",
    ]);
  });
});

describe("acquireFrom: exclusive names", () => {
  const named = (gb: number, what: string, extra: Partial<QueuedJob> = {}): QueuedJob => ({
    ...job(gb, what),
    exclusive: "image",
    ...extra,
  });

  test("one job per name at a time, in the order they came; memory-only jobs pass", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ capacity: 32, label: "this machine" });
    const first = start([machine], named(0, "first"), time);
    await settle();
    const second = start([machine], named(0, "second"), time);
    const third = start([machine], named(4, "third"), time);
    const memoryOnly = start([machine], job(8), time);
    await settle(100);
    expect(first.reservation).not.toBeNull();
    expect(second.reservation).toBeNull();
    expect(third.reservation).toBeNull();
    expect(memoryOnly.reservation?.gb).toBe(8);
    first.reservation?.release();
    await settle(100);
    expect(second.reservation).not.toBeNull();
    expect(third.reservation).toBeNull();
    second.reservation?.release();
    await settle(100);
    expect(third.reservation?.gb).toBe(4);
    expect(machine.maxSameName).toBe(1);
  });

  test("in a shared folder only when it lists the name", async () => {
    for (const [names, secondWaits] of [
      [[], false],
      [["image"], true],
    ] as const) {
      const time = fakeTime();
      const host = new FakeStore({ capacity: 30, label: "/srv/shared", names, shared: true });
      const machineA = new FakeStore({ capacity: 10, label: "this machine" });
      const machineB = new FakeStore({ capacity: 10, label: "this machine" });
      const first = start([machineA, host], named(4, "a"), time, "host-a");
      await settle(100);
      const second = start([machineB, host], named(4, "b"), time, "host-b");
      await settle(100);
      expect(first.reservation?.gb).toBe(4);
      expect(second.reservation === null).toBe(secondWaits);
    }
  });

  // Its parent holds memory an older ticket with the name waits for: in the line, the
  // nested job would wait behind that ticket, and the parent for the nested job.
  test("a nested job takes a free name at once, without a place in the line", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ capacity: 10, label: "this machine" });
    const parent = machine.hold(10, "the parent job");
    const older = start([machine], named(8, "older"), time);
    await settle(50);
    expect(older.reservation).toBeNull();
    const nested = start([machine], named(0, "nested", { nested: true }), time);
    await settle(50);
    expect(nested.reservation).not.toBeNull();
    expect(machine.liveTickets()).toBe(1);
    nested.reservation?.release();
    parent();
    await settle(100);
    expect(older.reservation?.gb).toBe(8);
  });
});

describe("pidsHolding", () => {
  const record = (person: string, pid: number) =>
    holderText({ checkout: "/c", gb: 1, kind: "tsc", person, pid, since: 1, v: 1, what: "x" });

  test("returns this machine's holders, and from a shared store only this person's", async () => {
    const machine = new FakeStore({ capacity: 10, label: "this machine" });
    const host = new FakeStore({ capacity: 30, label: "/srv/shared", shared: true });
    machine.hold(1, record("host-a", 11));
    machine.hold(1, "junk");
    host.hold(1, record("host-a", 12));
    host.hold(1, record("host-b", 13)); // another process table: never an ancestor here
    expect([...(await pidsHolding([machine, host], "host-a"))].sort()).toEqual([11, 12]);
  });

  // The nesting check runs before every job: a store that fails must not crash it.
  test("skips a store that fails, and still names this machine's holders", async () => {
    const machine = new FakeStore({ capacity: 10, label: "this machine" });
    const host = new FakeStore({ capacity: 30, label: "/srv/shared", shared: true });
    machine.hold(1, record("host-a", 11));
    host.held = () => Promise.reject(new Error("EACCES"));
    expect([...(await pidsHolding([machine, host], "host-a"))]).toEqual([11]);
  });
});
