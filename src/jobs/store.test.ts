/**
 * The lease store (`store.ts`) on real files in a temp folder: takes are all or nothing,
 * stale leases (a dead pid, a reused pid, a file nobody touched) count for nothing and are
 * removed, a holder's heartbeat keeps its file, and two machines share one folder.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { acquireFrom, holderText, type Reservation } from "./queue";
import {
  currentFileHolder,
  type FileHolder,
  leaseStore,
  openSharedStore,
  UNSEEN_STALE_MS,
} from "./store";

function record(person: string, gb: number, pid = process.pid): string {
  return holderText({
    checkout: "/home/user/app",
    gb,
    kind: "tsc",
    person,
    pid,
    since: Date.now(),
    v: 1,
    what: "bunx tsc --noEmit",
  });
}

/** A lease file as another process wrote it; `ageMs` sets how long ago it was touched. */
function plantLease(dir: string, holder: FileHolder, gb: number, ageMs = 0): string {
  mkdirSync(join(dir, "leases"), { recursive: true });
  const file = join(dir, "leases", `${crypto.randomUUID()}.json`);
  writeFileSync(file, JSON.stringify({ store: 1, gb, holder, record: record(holder.host, gb) }));
  const at = (Date.now() - ageMs) / 1000;
  utimesSync(file, at, at);
  return file;
}

async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"]);
  await child.exited;
  return child.pid;
}

function leaseFiles(dir: string): string[] {
  const folder = join(dir, "leases");
  return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".json")) : [];
}

function store(dir: string, capacity = 10, self?: FileHolder) {
  return leaseStore({
    dir,
    label: "this machine",
    shared: false,
    capacityGb: () => capacity,
    ...(self !== undefined && { self }),
  });
}

describe("leaseStore: taking memory", () => {
  test("takes all the GB or none, and gives them back", async () => {
    const dir = tempDir("store");
    const machine = store(dir, 10);
    const first = await machine.tryTake(6, record("host-a", 6));
    expect(first?.gb).toBe(6);
    expect(await machine.tryTake(5, record("host-a", 5))).toBeNull();
    expect(leaseFiles(dir)).toHaveLength(1);
    const second = await machine.tryTake(4, record("host-a", 4));
    expect(second?.gb).toBe(4);
    expect((await machine.held()).map((unit) => unit.gb).sort()).toEqual([4, 6]);
    first?.release();
    first?.release();
    second?.release();
    expect(leaseFiles(dir)).toEqual([]);
    expect(await machine.held()).toEqual([]);
  });

  test("lists the line with its own ticket marked, and drops it on release", async () => {
    const dir = tempDir("store");
    const machine = store(dir);
    const mine = await machine.enqueue(record("host-a", 2));
    const other = await store(dir).enqueue(record("host-a", 8));
    const line = (await mine?.line()) ?? [];
    expect(line.map((entry) => entry.mine).sort()).toEqual([false, true]);
    expect(line.map((entry) => JSON.parse(entry.text).gb).sort()).toEqual([2, 8]);
    expect((await machine.waiting()).map((unit) => unit.gb).sort()).toEqual([2, 8]);
    mine?.release();
    other?.release();
    expect(readdirSync(join(dir, "tickets"))).toEqual([]);
  });
});

describe("leaseStore: stale holders are cleaned up", () => {
  const here = () => currentFileHolder();

  test("a lease whose process is dead counts for nothing, and is removed", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, { ...here(), pid: await deadPid() }, 8);
    const machine = store(dir, 10);
    expect(await machine.held()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    // And its memory is free again: all 10 GB can be taken.
    expect((await machine.tryTake(10, record("host-a", 10)))?.gb).toBe(10);
  });

  test("a lease whose pid was reused (alive, another start time) is removed", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, { ...here(), startTime: "proc:1" }, 8);
    expect(await store(dir).held()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  test("a lease of a live process stays, however old its file is", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, here(), 8, 10 * UNSEEN_STALE_MS);
    expect((await store(dir).held()).map((unit) => unit.gb)).toEqual([8]);
    expect(existsSync(file)).toBe(true);
  });

  test("a lease from a process this machine cannot see stays while it is touched, then goes", async () => {
    const dir = tempDir("store");
    const elsewhere: FileHolder = { pid: 1, startTime: "proc:5", host: "host-b", pidns: "pid:[1]" };
    const fresh = plantLease(dir, elsewhere, 4, UNSEEN_STALE_MS - 30_000);
    const old = plantLease(dir, elsewhere, 6, UNSEEN_STALE_MS + 30_000);
    // Same host name, another pid namespace (a container): judged by its touches too.
    const container = plantLease(dir, { ...here(), pidns: "pid:[2]" }, 2, UNSEEN_STALE_MS + 30_000);
    expect((await store(dir).held()).map((unit) => unit.gb)).toEqual([4]);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(container)).toBe(false);
  });

  test("a file it cannot read holds no GB, and goes once nobody touches it", async () => {
    const dir = tempDir("store");
    mkdirSync(join(dir, "leases"));
    const newer = join(dir, "leases", "newer.json");
    const broken = join(dir, "leases", "broken.json");
    writeFileSync(newer, JSON.stringify({ store: 2 }));
    writeFileSync(broken, "{");
    const old = (Date.now() - UNSEEN_STALE_MS - 30_000) / 1000;
    utimesSync(broken, old, old);
    expect(await store(dir).held()).toEqual([]);
    expect(existsSync(newer)).toBe(true);
    expect(existsSync(broken)).toBe(false);
  });
});

describe("leaseStore: the heartbeat", () => {
  test("touches the holder's own files, and writes one again when a reader removed it", async () => {
    const dir = tempDir("store");
    const machine = leaseStore({
      dir,
      label: "this machine",
      shared: false,
      capacityGb: () => 10,
      heartbeatMs: 20,
    });
    const units = await machine.tryTake(3, record("host-a", 3));
    const [name] = leaseFiles(dir);
    const file = join(dir, "leases", name ?? "");
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(file, old, old);
    await Bun.sleep(80);
    expect(Date.now() - statSync(file).mtimeMs).toBeLessThan(10_000);
    unlinkSync(file);
    await Bun.sleep(80);
    expect((await machine.held()).map((unit) => unit.gb)).toEqual([3]);
    units?.release();
    await Bun.sleep(80);
    expect(leaseFiles(dir)).toEqual([]);
  });
});

describe("a shared view: two machines, one folder", () => {
  const holderOn = (host: string, pidns: string): FileHolder => ({
    pid: process.pid,
    startTime: null,
    host,
    pidns,
  });

  test("one budget for both: what host-a holds, host-b waits for", async () => {
    const dir = tempDir("shared");
    const shared = (host: string) =>
      leaseStore({
        dir,
        label: dir,
        shared: true,
        capacityGb: () => 30,
        self: holderOn(host, `pid:[${host}]`),
      });
    const a = shared("host-a");
    const b = shared("host-b");
    const options = (person: string) => ({
      onWaiting: () => undefined,
      person,
      pollMs: 10,
    });
    const job = (gb: number) => ({
      checkout: "/w",
      gb,
      kind: "build",
      pid: process.pid,
      what: "x",
    });
    const first = await acquireFrom([a], job(20), options("host-a"));
    // host-b sees host-a's 20 GB, through its own view of the folder.
    expect((await b.held()).map((unit) => JSON.parse(unit.text).person)).toEqual(["host-a"]);
    let second: Reservation | null = null;
    void acquireFrom([b], job(14), options("host-b")).then((reservation) => {
      second = reservation;
    });
    await Bun.sleep(150);
    expect(second).toBeNull();
    first.release();
    for (let i = 0; i < 100 && second === null; i++) await Bun.sleep(10);
    expect((second as Reservation | null)?.gb).toBe(14);
    (second as Reservation | null)?.release();
  });
});

describe("openSharedStore", () => {
  test("leaves out a missing folder, and says so", () => {
    const dir = join(tempDir("shared"), "missing");
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is missing: this job runs without its budget.`,
    });
  });

  test("leaves out a folder whose budget is missing or not a whole number, and says why", () => {
    const dir = tempDir("shared");
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: ${join(dir, "budget")} cannot be read (ENOENT).`,
    });
    writeFileSync(join(dir, "budget"), "lots\n");
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: ${join(dir, "budget")} does not hold a whole number of GB.`,
    });
  });

  test.skipIf(process.getuid?.() === 0)(
    "leaves out a folder where a file cannot be written, and says why",
    () => {
      const dir = tempDir("shared");
      writeFileSync(join(dir, "budget"), "30\n");
      chmodSync(dir, 0o500);
      try {
        expect(openSharedStore(dir)).toEqual({
          note: `The shared folder ${dir} is left out: ${join(dir, "leases")} cannot be written (EACCES).`,
        });
      } finally {
        chmodSync(dir, 0o700);
      }
    },
  );

  test("uses a working folder, and reads its budget for every decision", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "budget"), "30\n");
    const opened = openSharedStore(dir);
    if (!("store" in opened)) throw new Error(opened.note);
    expect(opened.store.shared).toBe(true);
    expect(opened.store.label).toBe(dir);
    expect(await opened.store.capacityGb()).toBe(30);
    writeFileSync(join(dir, "budget"), "40\n");
    expect(await opened.store.capacityGb()).toBe(40);
    writeFileSync(join(dir, "budget"), "x\n");
    await expect(opened.store.capacityGb()).rejects.toThrow("does not hold a whole number of GB");
    expect(readdirSync(join(dir, "leases"))).toEqual([]);
  });
});
