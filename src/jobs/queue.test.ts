/**
 * The queue engine (`queue.ts`): the decision, the order, the waiting lines, and what
 * happens when a store fails. What a wrong answer costs: a queue that admits too many runs
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
  durationText,
  formatSince,
  type HolderRecord,
  holderLines,
  holderText,
  type ParsedEntry,
  type ParsedHeld,
  parseHolder,
  pidsHolding,
  type QueuedJob,
  type Reservation,
  type Store,
  type StoreHeld,
  type StoreLineEntry,
  type StoreTicket,
  type StoreUnits,
  shownHolder,
  slotOfWire,
  slotsText,
  WaitStoppedError,
  wireOfSlot,
} from "./queue";

function must<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`expected ${what}, got nothing`);
  return value;
}

// ── Holder records ─────────────────────────────────────────────────────────────

describe("parseHolder", () => {
  const record: HolderRecord = {
    checkout: "/home/user/app",
    kind: "build",
    person: "host-b",
    pid: 4242,
    since: 1_760_000_000_000,
    slot: true,
    v: 1,
    what: "bun run build",
  };

  test("reads back what holderText wrote", () => {
    expect(parseHolder(holderText(record))).toEqual(record);
    const named: HolderRecord = { ...record, exclusive: "image", kind: "", slot: false };
    expect(parseHolder(holderText(named))).toEqual(named);
  });

  // Another machine wrote it: anything odd is an unknown holder, never a crash.
  test("calls malformed or foreign text unknown", () => {
    const wire = JSON.parse(holderText(record)) as Record<string, unknown>;
    for (const text of [
      "",
      "garbage",
      "null",
      "[1]",
      JSON.stringify({ ...wire, v: 2 }),
      JSON.stringify({ ...wire, pid: "4242" }),
      JSON.stringify({ ...wire, pid: 1.5 }),
      JSON.stringify({ ...wire, since: null }),
      JSON.stringify({ ...wire, person: 7 }),
      JSON.stringify({ ...wire, gb: "8" }),
      JSON.stringify({ ...wire, kind: undefined }),
    ]) {
      expect(parseHolder(text)).toBeNull();
    }
  });

  // Mixed versions: an older `job run` counted gigabytes in `gb`. Every number above 0 is one
  // slot here, and only 0 is a name held alone. An older run reading ours sees 1 GB or 0 GB.
  test("reads an older record's gigabytes as one slot, and writes 1 or 0 for the older reader", () => {
    const wire = JSON.parse(holderText(record)) as Record<string, unknown>;
    expect(wire.gb).toBe(1);
    expect("slot" in wire).toBe(false);
    expect(JSON.parse(holderText({ ...record, slot: false })).gb).toBe(0);
    for (const gb of [1, 2, 8, 14, 0.5]) {
      expect(parseHolder(JSON.stringify({ ...wire, gb }))?.slot).toBe(true);
    }
    expect(parseHolder(JSON.stringify({ ...wire, gb: 0 }))?.slot).toBe(false);
    expect(slotOfWire(wireOfSlot(true))).toBe(true);
    expect(slotOfWire(wireOfSlot(false))).toBe(false);
  });
});

// Another user or a container wrote the record: its text never drives the terminal.
describe("a holder's text, printed", () => {
  const since = 1_760_000_000_000;
  const record: HolderRecord = {
    checkout: "/home/user/app",
    kind: "build",
    person: "host-b\u001b]52;c;ZXZpbA==\u0007",
    pid: 4242,
    since,
    slot: true,
    v: 1,
    what: "bun run build\u001b[2J\r\nfake: line‮",
  };

  test("an ANSI escape, a line break and a bidi override print as one clean line", () => {
    const lines = holderLines([{ holder: record, slot: true }], "this machine", since);
    expect(lines).toEqual([
      `  this machine: a slot is held by host-b ]52;c;ZXZpbA==: build, bun run build [2J fake: line in /home/user/app, since ${formatSince(since, since)} (pid 4242)`,
    ]);
    expect(lines.join("")).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  test("a long host name and a long command are cut, with a mark", () => {
    const shown = shownHolder({ ...record, person: "h".repeat(100), what: "x".repeat(500) });
    const [person = "", what = ""] = shown.split(": ");
    expect(person).toBe(`${"h".repeat(64)}…`);
    expect(what).toHaveLength(201);
    expect(what).toEndWith("…");
  });

  test("a name held alone says so, and an unknown holder is named as one", () => {
    const named: HolderRecord = { ...record, exclusive: "image", kind: "", slot: false };
    expect(holderLines([{ holder: named, slot: false }], "this machine", since)[0]).toContain(
      "this machine: a name is held by host-b",
    );
    expect(holderLines([{ holder: null, slot: true }], "/srv/heavy-jobs", since)).toEqual([
      "  /srv/heavy-jobs: a slot is held by an unknown holder",
    ]);
  });
});

// ── The decision ───────────────────────────────────────────────────────────────

/** `count` slots held by one person. */
function heldBy(person: string, count: number, pid = 1): ParsedHeld[] {
  return Array.from({ length: count }, () => ({
    holder: {
      checkout: "/c",
      kind: "tsc",
      person,
      pid,
      since: 0,
      slot: true,
      v: 1 as const,
      what: "x",
    },
    slot: true,
  }));
}

function entry(
  tie: string,
  since: number,
  person: string | null,
  mine = false,
  wants: { exclusive?: string; slot?: boolean } = {},
): ParsedEntry {
  return {
    exclusive: wants.exclusive ?? null,
    mine,
    person,
    since,
    slot: wants.slot ?? true,
    tie,
  };
}

const alone = [entry("m", 1, "host-a", true)];

/** A machine of three slots: the default. */
const base: DecideInput = {
  capacity: 3,
  exclusive: null,
  held: [],
  line: alone,
  person: "host-a",
  shared: false,
  slot: true,
};

describe("decide", () => {
  test("takes a slot when the job is first and one is free", () => {
    expect(decide({ ...base, held: heldBy("host-a", 2) })).toEqual({ take: true });
    expect(decide(base)).toEqual({ take: true });
  });

  test("waits when every slot is taken, however small the job", () => {
    expect(decide({ ...base, held: heldBy("host-a", 3) })).toEqual({
      wait: { capacity: 3, kind: "no-room" },
    });
    // maxJobs 1: one at a time.
    expect(decide({ ...base, capacity: 1, held: heldBy("host-a", 1) })).toEqual({
      wait: { capacity: 1, kind: "no-room" },
    });
    expect(decide({ ...base, capacity: 1 })).toEqual({ take: true });
  });

  test("counts a lease of any size as one slot, and a name held alone as none", () => {
    const [one = never()] = heldBy("host-a", 1);
    // A name held alone leaves every slot free.
    const nameOnly: ParsedHeld = {
      holder: { ...one.holder, slot: false },
      slot: false,
    } as ParsedHeld;
    expect(decide({ ...base, capacity: 1, held: [nameOnly] })).toEqual({ take: true });
    expect(decide({ ...base, capacity: 2, held: [one, one] })).toEqual({
      wait: { capacity: 2, kind: "no-room" },
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
    expect(decide({ ...base, line: after })).toEqual({ take: true });
  });

  // A ticket that does not parse must never hold the line up.
  test("lets an unreadable ticket hold nobody up", () => {
    const line = [entry("c", 100, "host-a", true), entry("a", Number.POSITIVE_INFINITY, null)];
    expect(decide({ ...base, line })).toEqual({ take: true });
  });

  describe("fair share on a shared folder of four slots", () => {
    const shared = { ...base, capacity: 4, shared: true };
    const line = [entry("a", 100, "host-a", true), entry("b", 200, "host-b")];

    test("a person at half the slots steps aside while another person waits", () => {
      expect(decide({ ...shared, held: heldBy("host-a", 2), line })).toEqual({
        wait: { capacity: 4, held: 2, kind: "fair-share" },
      });
      // host-b's newer ticket goes ahead of host-a's older one.
      const bFirst = [entry("a", 100, "host-a"), entry("b", 200, "host-b", true)];
      expect(
        decide({ ...shared, held: heldBy("host-a", 2), line: bFirst, person: "host-b" }),
      ).toEqual({ take: true });
    });

    test("a person under half, or alone, may use all of the slots", () => {
      expect(decide({ ...shared, held: heldBy("host-a", 1), line })).toEqual({ take: true });
      const own = [entry("a", 100, "host-a", true), entry("b", 200, "host-a")];
      expect(decide({ ...shared, held: heldBy("host-a", 3), line: own })).toEqual({ take: true });
    });

    test("half of an odd number of slots rounds up: two of three is half or more", () => {
      const three = { ...shared, capacity: 3 };
      expect(decide({ ...three, held: heldBy("host-a", 2), line })).toEqual({
        wait: { capacity: 3, held: 2, kind: "fair-share" },
      });
      expect(decide({ ...three, held: heldBy("host-a", 1), line })).toEqual({ take: true });
    });

    test("a store only this machine uses has no fair share", () => {
      expect(decide({ ...base, capacity: 4, held: heldBy("host-a", 3), line })).toEqual({
        take: true,
      });
    });
  });
});

describe("decide: exclusive names", () => {
  const holdsName = (name: string): ParsedHeld[] => {
    const [one = never()] = heldBy("host-a", 1);
    return [{ holder: { ...one.holder, exclusive: name, slot: false }, slot: false } as ParsedHeld];
  };
  const named = (tie: string, since: number, mine: boolean, slot: boolean, name?: string) =>
    entry(tie, since, "host-a", mine, { slot, ...(name !== undefined && { exclusive: name }) });

  test("waits while a lease holds its name, with a slot to spare", () => {
    expect(decide({ ...base, exclusive: "image", held: holdsName("image") })).toEqual({
      wait: { kind: "exclusive", name: "image" },
    });
    // Another name is no matter.
    expect(decide({ ...base, exclusive: "image", held: holdsName("deploy") })).toEqual({
      take: true,
    });
  });

  test("waits behind an older ticket with its name, even one that needs no slot", () => {
    const line = [named("a", 1, false, false, "image"), named("m", 2, true, true, "image")];
    expect(decide({ ...base, exclusive: "image", line })).toEqual({ wait: { kind: "behind" } });
  });

  test("a name-only job takes no slot, and never waits behind jobs that wait for one", () => {
    const line = [named("a", 1, false, true), named("m", 2, true, false, "image")];
    expect(
      decide({
        ...base,
        exclusive: "image",
        held: heldBy("host-a", 3),
        line,
        slot: false,
      }),
    ).toEqual({ take: true });
  });

  test("an older ticket waiting for a held name holds up nobody's slot", () => {
    const line = [named("a", 1, false, true, "image"), named("m", 2, true, true)];
    expect(decide({ ...base, held: holdsName("image"), line })).toEqual({ take: true });
    // Once the name is free, it is first again.
    expect(decide({ ...base, line })).toEqual({ wait: { kind: "behind" } });
  });
});

function never(): never {
  throw new Error("expected a value");
}

// ── The engine, on fake stores ─────────────────────────────────────────────────

/**
 * Storage only, the way the real store behaves: tickets with their record, units held with
 * their record, a take that is all or nothing. Every rule is the engine's.
 */
class FakeStore implements Store {
  readonly label: string;
  readonly shared: boolean;
  slots: number;
  maxHeld = 0;
  /** The most leases with one exclusive name at once. */
  maxSameName = 0;
  private readonly units = new Map<number, StoreHeld & { exclusive?: string }>();
  private readonly tickets = new Map<string, string>();
  private readonly names: ReadonlySet<string> | null;
  private next = 0;

  constructor(options: {
    label: string;
    shared?: boolean;
    slots: number;
    /** The exclusive names it keeps; default (this machine): every name. */
    names?: readonly string[];
  }) {
    this.slots = options.slots;
    this.label = options.label;
    this.shared = options.shared ?? false;
    this.names = options.names === undefined ? null : new Set(options.names);
  }

  keepsExclusive(name: string): Promise<boolean> {
    return Promise.resolve(this.names === null || this.names.has(name));
  }

  /** How many slots are in use now. */
  slotsHeld(): number {
    return [...this.units.values()].filter((unit) => unit.slot).length;
  }

  /** How many leases, slots and names alike. */
  leases(): number {
    return this.units.size;
  }

  liveTickets(): number {
    return this.tickets.size;
  }

  capacity(): Promise<number> {
    return Promise.resolve(this.slots);
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
    return Promise.resolve([...this.units.values()].map(({ slot, text }) => ({ slot, text })));
  }

  /** A live ticket outside the engine, with whatever text its holder wrote. */
  foreignTicket(text: string): void {
    this.tickets.set(this.tie(), text);
  }

  /** A holder outside the engine: another program, or a record nobody can read. */
  hold(text: string, slot = true): () => void {
    const id = this.next++;
    this.units.set(id, { slot, text });
    return () => this.units.delete(id);
  }

  tryTake(slot: boolean, recordText: string, exclusive?: string): Promise<StoreUnits | null> {
    const sameName = () =>
      [...this.units.values()].filter((unit) => unit.exclusive === exclusive).length;
    if (exclusive !== undefined && sameName() > 0) return Promise.resolve(null);
    if (slot && this.slotsHeld() >= this.slots) return Promise.resolve(null);
    const id = this.next++;
    this.units.set(id, { slot, text: recordText, ...(exclusive !== undefined && { exclusive }) });
    this.maxHeld = Math.max(this.maxHeld, this.slotsHeld());
    if (exclusive !== undefined) this.maxSameName = Math.max(this.maxSameName, sameName());
    return Promise.resolve({
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

function job(what = "bunx tsc --noEmit", pid = 100): QueuedJob {
  return { checkout: "/work/app", kind: "tsc", pid, slot: true, what };
}

/** Starts an acquire and tracks whether it has been admitted. */
function start(
  stores: readonly Store[],
  heavy: QueuedJob,
  time: Pick<ReturnType<typeof fakeTime>, "now" | "sleep">,
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

describe("acquireFrom: the slots", () => {
  test("three jobs run at once by default, the fourth waits for a slot", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 3 });
    const lines: string[] = [];
    const running = [1, 2, 3].map((pid) => start([store], job(`job ${pid}`, pid), time));
    await settle();
    expect(running.every((each) => each.reservation !== null)).toBe(true);
    expect(store.slotsHeld()).toBe(3);

    const fourth = start([store], job("job 4", 4), time, "host-a", lines);
    await settle(100);
    expect(fourth.reservation).toBeNull();
    expect(store.slotsHeld()).toBe(3);
    expect(lines[0]).toBe(
      "Heavy job waits for a free slot: job 4. this machine: 0 of 3 slots free. Why: all 3 of this machine's slots are taken.",
    );

    must(running[1]?.reservation, "a reservation").release();
    await settle(100);
    expect(fourth.reservation).not.toBeNull();
    expect(store.slotsHeld()).toBe(3);
  });

  test("with one slot, jobs run one at a time", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 1 });
    const first = start([store], job("first", 1), time);
    await settle();
    const second = start([store], job("second", 2), time);
    await settle(100);
    expect(first.reservation).not.toBeNull();
    expect(second.reservation).toBeNull();
    must(first.reservation, "a reservation").release();
    await settle(100);
    expect(second.reservation).not.toBeNull();
    expect(store.maxHeld).toBe(1);
  });

  test("a job needs only one slot: a lone job on a big machine waits for nothing", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 3 });
    const lone = start([store], job(), time);
    await settle();
    expect(lone.reservation).not.toBeNull();
    // Never waited: no wait to report.
    expect(lone.reservation?.waitedSince).toBeNull();
  });

  test("a job with no slot and no name takes nothing and joins no line", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 1 });
    const blocker = store.hold("held");
    const printOnly = start([store], { ...job(), slot: false }, time);
    await settle();
    expect(printOnly.reservation).not.toBeNull();
    expect(store.liveTickets()).toBe(0);
    expect(store.leases()).toBe(1);
    blocker();
  });
});

describe("acquireFrom: the waiting order", () => {
  // The failure this prevents: a job that never runs while newer ones keep arriving.
  test("oldest first: a newer job that looks more often does not jump the line", async () => {
    const time = fakeTime();
    // The older job sleeps through four extra turns of the others each time, so after a slot
    // opens the newer ones look first. Without the line, one of them would take it.
    const slow = {
      now: time.now,
      sleep: async (ms: number) => {
        await time.sleep(ms);
        await settle(4);
      },
    };
    const store = new FakeStore({ label: "this machine", slots: 1 });
    const holder = start([store], job("holder", 1), time);
    await settle();
    const older = start([store], job("older", 2), slow);
    await settle();
    const newerOnes = [3, 4].map((pid) => start([store], job(`newer ${pid}`, pid), time));
    await settle(100);
    must(holder.reservation, "a reservation").release();
    await settle(200);
    expect(older.reservation).not.toBeNull();
    expect(newerOnes.map((each) => each.reservation)).toEqual([null, null]);

    must(older.reservation, "a reservation").release();
    await settle(200);
    expect(newerOnes.map((each) => each.reservation !== null)).toEqual([true, false]);
    must(newerOnes[0]?.reservation, "a reservation").release();
    await settle(200);
    expect(newerOnes[1]?.reservation).not.toBeNull();
  });

  // Fair share: host-a alone may use the whole folder, and steps aside only for someone waiting.
  test("on a shared folder, a person at half the slots lets another person's newer job go first", async () => {
    const time = fakeTime();
    const host = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 4 });
    const a = [1, 2, 3, 4].map((pid) => start([host], job(`a${pid}`, pid), time, "host-a"));
    await settle();
    expect(host.slotsHeld()).toBe(4); // alone, host-a used every slot

    const aNext = start([host], job("a5", 5), time, "host-a");
    await settle(100);
    const b = start([host], job("b1", 6), time, "host-b");
    await settle(100);
    expect(aNext.reservation).toBeNull();
    expect(b.reservation).toBeNull();

    // One slot opens: host-a holds three of four, so its older job steps aside for host-b's.
    must(a[0]?.reservation, "a reservation").release();
    await settle(200);
    expect(b.reservation).not.toBeNull();
    expect(aNext.reservation).toBeNull();

    // Running jobs are never stopped; once host-a is under half, its turn comes.
    must(a[1]?.reservation, "a reservation").release();
    must(a[2]?.reservation, "a reservation").release();
    await settle(200);
    expect(aNext.reservation).not.toBeNull();
    expect(host.slotsHeld()).toBe(3);
  });

  // Foreign or half-written text in a live ticket must never stop the line for good.
  test("is not held up by a live ticket whose text does not parse", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 3 });
    store.foreignTicket("garbage");
    store.foreignTicket(JSON.stringify({ since: 0, v: 9 }));
    const lone = start([store], job(), time);
    await settle(50);
    expect(lone.reservation).not.toBeNull();
  });

  test("gives the slots back in reverse, and only once", async () => {
    const time = fakeTime();
    const order: string[] = [];
    const tracked = (label: string) => {
      const store = new FakeStore({ label, slots: 3 });
      const take = store.tryTake.bind(store);
      store.tryTake = async (slot, text) => {
        const units = await take(slot, text);
        return units === null
          ? null
          : {
              release: () => {
                order.push(label);
                units.release();
              },
            };
      };
      return store;
    };
    const machine = tracked("this machine");
    const host = tracked("/srv/heavy-jobs");
    const one = start([machine, host], job(), time);
    await settle();
    one.reservation?.release();
    one.reservation?.release();
    expect(order).toEqual(["/srv/heavy-jobs", "this machine"]);
    expect(machine.slotsHeld() + host.slotsHeld()).toBe(0);
    expect(machine.liveTickets() + host.liveTickets()).toBe(0);
  });

  test("stops a wait on a signal: the ticket and what it took are given back", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ label: "this machine", slots: 3 });
    const host = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 1 });
    const blocker = host.hold("");
    const stop = new AbortController();
    let failure: unknown = null;
    void acquireFrom([machine, host], job(), {
      now: time.now,
      onWaiting: () => undefined,
      person: "host-a",
      sleep: time.sleep,
      signal: stop.signal,
    }).catch((error: unknown) => {
      failure = error;
    });
    await settle(50);
    // It holds a slot of this machine, and waits in the shared line.
    expect(machine.slotsHeld()).toBe(1);
    expect(host.liveTickets()).toBe(1);
    stop.abort();
    await settle(50);
    expect(failure).toBeInstanceOf(WaitStoppedError);
    expect(machine.slotsHeld()).toBe(0);
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

describe("acquireFrom: two counts of slots", () => {
  // Three containers, each with its own slots, sharing one count smaller than their sum.
  // Every job takes its machine first, then the shared one. A circle (one job holding its
  // machine and waiting for the shared line, while the shared line's next job waits for
  // that machine) would stop them all.
  test("never deadlocks, and never gives out more slots than a count holds", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = seeded(seed);
      const time = fakeTime();
      const host = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 3 });
      const machines = ["host-a", "host-b", "host-c"].map((person) => ({
        person,
        store: new FakeStore({ label: "this machine", slots: 2 }),
      }));
      let finished = 0;
      const total = 30;
      const runs: Promise<void>[] = [];
      for (let index = 0; index < total; index++) {
        const machine = must(machines[Math.floor(random() * machines.length)], "a machine");
        const holdFor = 1 + Math.floor(random() * 20);
        runs.push(
          (async () => {
            await time.sleep(Math.floor(random() * 5) * 500);
            const reservation = await acquireFrom(
              [machine.store, host],
              job(`run ${index}`, index),
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
      expect(host.maxHeld).toBeLessThanOrEqual(3);
      expect(host.maxHeld).toBeGreaterThan(0);
      for (const { store } of machines) expect(store.maxHeld).toBeLessThanOrEqual(2);
      expect(
        host.slotsHeld() + machines.reduce((sum, { store }) => sum + store.slotsHeld(), 0),
      ).toBe(0);
      await Promise.all(runs);
    }
  });

  test("joins a shared line only once it holds a slot of its own machine", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ label: "this machine", slots: 1 });
    const host = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 3 });
    const blocker = machine.hold("");
    const waiting = start([machine, host], job(), time);
    await settle(100);
    expect(waiting.reservation).toBeNull();
    expect(host.liveTickets()).toBe(0);
    blocker();
    await settle(100);
    expect(waiting.reservation).not.toBeNull();
    expect(host.slotsHeld()).toBe(1);
  });
});

describe("acquireFrom: waiting lines", () => {
  test("says what it needs, the free slots per store, and who holds them; then once a minute", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ label: "this machine", slots: 3 });
    const host = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 4 });
    const since = new Date(2026, 9, 12, 11, 44).getTime();
    const record = (pid: number) =>
      holderText({
        checkout: "/home/user/app",
        kind: "build",
        person: "host-a",
        pid,
        since,
        slot: true,
        v: 1,
        what: "bun run build",
      });
    machine.hold(record(77));
    machine.hold(record(78));
    machine.hold("not a record");
    const lines: string[] = [];
    const reportedAt: number[] = [];
    let admitted = false;
    void acquireFrom([machine, host], job("bunx tsc --noEmit"), {
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
      "Heavy job waits for a free slot: bunx tsc --noEmit. this machine: 0 of 3 slots free; /srv/heavy-jobs: 4 of 4 slots free. Why: all 3 of this machine's slots are taken.",
    );
    // The hint rides with the first waiting line, and only with it: a piped job's status
    // is the pipe's, so the person is told where the job's own status shows up.
    expect(lines[1]).toBe(
      'A pipe (| tail) hides this job\'s exit status: the "Heavy job ended" line carries it.',
    );
    // The fake clock starts at 12:00 the same day: the holder's start reads as a time.
    expect(lines.slice(2, 5)).toEqual([
      "  this machine: a slot is held by host-a: build, bun run build in /home/user/app, since 11:44 (pid 77)",
      "  this machine: a slot is held by host-a: build, bun run build in /home/user/app, since 11:44 (pid 78)",
      "  this machine: a slot is held by an unknown holder",
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

  test("says the one slot of a one-slot machine in the singular", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 1 });
    const blocker = store.hold("");
    const lines: string[] = [];
    start([store], job("bun test"), time, "host-a", lines);
    await settle(20);
    expect(lines[0]).toBe(
      "Heavy job waits for a free slot: bun test. this machine: 0 of 1 slot free. Why: this machine's only slot is taken.",
    );
    expect(slotsText(1)).toBe("1 slot");
    expect(slotsText(3)).toBe("3 slots");
    blocker();
  });

  test("a job that waits for an older one says so", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 1 });
    const blocker = store.hold("");
    start([store], job("older", 1), time);
    await settle(10);
    const lines: string[] = [];
    start([store], job("newer", 2), time, "host-a", lines);
    await settle(10);
    expect(lines[0]).toBe(
      "Heavy job waits for a free slot: newer. this machine: 0 of 1 slot free. Why: an older job is first in this machine's line.",
    );
    blocker();
  });

  test("says the pipe hint once, with the first waiting line", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 1 });
    const blocker = store.hold("");
    const lines: string[] = [];
    const waiting = start([store], job(), time, "host-a", lines);
    await settle(20);
    // Every minute after the first, so the hint's once-per-job promise is proved, not assumed.
    while (lines.filter((line) => line.startsWith("Heavy job waits")).length < 3) await settle(1);
    expect(waiting.reservation).toBeNull();
    expect(lines.filter((line) => line.startsWith("Heavy job waits")).length).toBeGreaterThan(1);
    expect(lines.filter((line) => line.includes("A pipe (| tail)"))).toHaveLength(1);
    expect(lines[1]).toBe(
      'A pipe (| tail) hides this job\'s exit status: the "Heavy job ended" line carries it.',
    );
    blocker();
  });

  test("the reservation says when the job's first waiting line was printed", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 1 });
    const blocker = store.hold("");
    const beganAt = time.now();
    const waiting = start([store], job(), time);
    await settle();
    blocker();
    await settle(10);
    expect(waiting.reservation).not.toBeNull();
    // The first report is the job's first look, before it sleeps: the wait began there.
    expect(waiting.reservation?.waitedSince).toBe(beganAt);
  });

  test("a job that never waited reports no wait at all", async () => {
    const time = fakeTime();
    const store = new FakeStore({ label: "this machine", slots: 3 });
    const free = start([store], job(), time);
    await settle();
    expect(free.reservation).not.toBeNull();
    // Nothing was said, so there is no wait to report: the wrapper prints no lines.
    expect(free.reservation?.waitedSince).toBeNull();
  });

  test("formats how long something took in seconds, minutes and hours", () => {
    expect(durationText(0)).toBe("0 s");
    expect(durationText(30_000)).toBe("30 s");
    expect(durationText(59_400)).toBe("59 s");
    expect(durationText(60_000)).toBe("1 min");
    expect(durationText(18 * 60_000)).toBe("18 min");
    expect(durationText(90_000)).toBe("2 min");
    expect(durationText(60 * 60_000)).toBe("1 h");
    expect(durationText(72 * 60_000)).toBe("1 h 12 min");
    expect(durationText(-5_000)).toBe("0 s");
  });

  test("formats a holder's start as a time today, and with the date on another day", () => {
    const now = new Date(2026, 9, 12, 15, 0).getTime();
    expect(formatSince(new Date(2026, 9, 12, 9, 5).getTime(), now)).toBe("09:05");
    expect(formatSince(new Date(2026, 9, 11, 23, 59).getTime(), now)).toBe("2026-10-11 23:59");
  });
});

describe("acquireFrom: a store that fails", () => {
  test("runs the job without that store instead of crashing, and says so", async () => {
    const time = fakeTime();
    const broken = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 3 });
    broken.held = () => Promise.reject(new Error("EIO"));
    const machine = new FakeStore({ label: "this machine", slots: 3 });
    const notes: string[] = [];
    const reservation = await acquireFrom([machine, broken], job(), {
      now: time.now,
      onNote: (line) => notes.push(line),
      onWaiting: () => undefined,
      person: "host-a",
      sleep: time.sleep,
    });
    expect(reservation.waitedSince).toBeNull();
    expect(machine.slotsHeld()).toBe(1);
    expect(notes).toEqual([
      "The heavy-job queue for /srv/heavy-jobs failed (EIO): this job runs without it.",
    ]);
    expect(broken.liveTickets()).toBe(0);
  });

  // The waiting report reads every store. A shared one it cannot read must not end the wait
  // on this machine's own slots: the job would run on a full machine.
  test("a shared store that cannot be read never drops this machine's slots: the job keeps waiting", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ label: "this machine", slots: 1 });
    const broken = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 3 });
    broken.held = () => Promise.reject(new Error("EIO"));
    const blocker = machine.hold("not a record");
    const lines: string[] = [];
    const notes: string[] = [];
    let admitted: Reservation | null = null;
    void acquireFrom([machine, broken], job("bun test"), {
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
      "Heavy job waits for a free slot: bun test. this machine: 0 of 1 slot free; /srv/heavy-jobs: cannot be read. Why: this machine's only slot is taken.",
    );
    expect(notes).toEqual([]);
    blocker();
    await settle(100);
    expect(admitted).not.toBeNull();
    expect(machine.slotsHeld()).toBe(1);
    expect(notes).toEqual([
      "The heavy-job queue for /srv/heavy-jobs failed (EIO): this job runs without it.",
    ]);
  });
});

describe("acquireFrom: exclusive names", () => {
  const named = (what: string, extra: Partial<QueuedJob> = {}): QueuedJob => ({
    ...job(what),
    exclusive: "image",
    ...extra,
  });
  /** A job that holds the name and no slot. */
  const nameOnly = (what: string, extra: Partial<QueuedJob> = {}) =>
    named(what, { kind: "", slot: false, ...extra });

  test("one job per name at a time, in the order they came; slot-only jobs pass", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ label: "this machine", slots: 3 });
    const first = start([machine], nameOnly("first"), time);
    await settle();
    const second = start([machine], nameOnly("second"), time);
    const third = start([machine], named("third"), time);
    const slotOnly = start([machine], job(), time);
    await settle(100);
    expect(first.reservation).not.toBeNull();
    expect(second.reservation).toBeNull();
    expect(third.reservation).toBeNull();
    expect(slotOnly.reservation).not.toBeNull();
    first.reservation?.release();
    await settle(100);
    expect(second.reservation).not.toBeNull();
    expect(third.reservation).toBeNull();
    second.reservation?.release();
    await settle(100);
    expect(third.reservation).not.toBeNull();
    expect(machine.maxSameName).toBe(1);
  });

  test("a name held alone does not use a slot", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ label: "this machine", slots: 1 });
    const nameHolder = start([machine], nameOnly("name"), time);
    await settle();
    const slotJob = start([machine], job(), time);
    await settle(50);
    expect(nameHolder.reservation).not.toBeNull();
    expect(machine.slotsHeld()).toBe(1);
    expect(slotJob.reservation).not.toBeNull();
  });

  test("in a shared folder only when it lists the name", async () => {
    for (const [names, secondWaits] of [
      [[], false],
      [["image"], true],
    ] as const) {
      const time = fakeTime();
      const host = new FakeStore({ label: "/srv/heavy-jobs", names, shared: true, slots: 3 });
      const machineA = new FakeStore({ label: "this machine", slots: 3 });
      const machineB = new FakeStore({ label: "this machine", slots: 3 });
      const first = start([machineA, host], named("a"), time, "host-a");
      await settle(100);
      const second = start([machineB, host], named("b"), time, "host-b");
      await settle(100);
      expect(first.reservation).not.toBeNull();
      expect(second.reservation === null).toBe(secondWaits);
    }
  });

  // Its parent holds a slot an older ticket with the name waits for: in the line, the nested
  // job would wait behind that ticket, and the parent for the nested job.
  test("a nested job takes a free name at once, without a place in the line", async () => {
    const time = fakeTime();
    const machine = new FakeStore({ label: "this machine", slots: 1 });
    const parent = machine.hold("the parent job");
    const older = start([machine], named("older"), time);
    await settle(50);
    expect(older.reservation).toBeNull();
    const nested = start([machine], nameOnly("nested", { nested: true }), time);
    await settle(50);
    expect(nested.reservation).not.toBeNull();
    expect(machine.liveTickets()).toBe(1);
    nested.reservation?.release();
    parent();
    await settle(100);
    expect(older.reservation).not.toBeNull();
  });
});

describe("pidsHolding", () => {
  const record = (person: string, pid: number) =>
    holderText({ checkout: "/c", kind: "tsc", person, pid, since: 1, slot: true, v: 1, what: "x" });

  test("returns this machine's holders, and from a shared store only this person's", async () => {
    const machine = new FakeStore({ label: "this machine", slots: 3 });
    const host = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 3 });
    machine.hold(record("host-a", 11));
    machine.hold("junk");
    host.hold(record("host-a", 12));
    host.hold(record("host-b", 13)); // another process table: never an ancestor here
    expect([...(await pidsHolding([machine, host], "host-a"))].sort()).toEqual([11, 12]);
  });

  // The nesting check runs before every job: a store that fails must not crash it.
  test("skips a store that fails, and still names this machine's holders", async () => {
    const machine = new FakeStore({ label: "this machine", slots: 3 });
    const host = new FakeStore({ label: "/srv/heavy-jobs", shared: true, slots: 3 });
    machine.hold(record("host-a", 11));
    host.held = () => Promise.reject(new Error("EACCES"));
    expect([...(await pidsHolding([machine, host], "host-a"))]).toEqual([11]);
  });
});
