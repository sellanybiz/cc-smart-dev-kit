/**
 * The lease store (`store.ts`) on real files in a temp folder: a take is a slot or nothing,
 * stale leases (a dead pid, a reused pid, a file nobody touched) count for nothing and are
 * removed, a holder's heartbeat keeps its file, and two machines share one folder.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StartTimeReader } from "../setup/lock";
import { tempDir } from "../testing/temp";
import { holderText } from "./queue";
import { currentFileHolder, type FileHolder, leaseStore, UNSEEN_STALE_MS } from "./store";
import { startTimeReader } from "./windows";

function record(person: string, slot = true, pid = process.pid): string {
  return holderText({
    checkout: "/home/user/app",
    kind: "tsc",
    person,
    pid,
    since: Date.now(),
    slot,
    v: 1,
    what: "bunx tsc --noEmit",
  });
}

/**
 * A lease file as another process wrote it; `ageMs` sets how long ago it was touched. `gb` is
 * the number the file carries: an older plugin wrote the gigabytes it reserved there, this one
 * writes 1 for a slot and 0 for a name held alone.
 */
function plantLease(dir: string, holder: FileHolder, gb: number, ageMs = 0): string {
  mkdirSync(join(dir, "leases"), { recursive: true });
  const file = join(dir, "leases", `${crypto.randomUUID()}.json`);
  writeFileSync(
    file,
    JSON.stringify({ store: 1, gb, holder, record: record(holder.host, gb > 0) }),
  );
  const at = (Date.now() - ageMs) / 1000;
  utimesSync(file, at, at);
  return file;
}

async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"]);
  await child.exited;
  return child.pid;
}

function _leaseFiles(dir: string): string[] {
  const folder = join(dir, "leases");
  return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".json")) : [];
}

function store(dir: string, _slots = 1, self?: FileHolder, startTimeOf?: StartTimeReader) {
  return leaseStore({
    dir,
    label: "this machine",
    ...(self !== undefined && { self }),
    ...(startTimeOf !== undefined && { startTimeOf }),
  });
}

/** The reader a Windows machine's store uses, with a fake PowerShell: it answers `ticks`. */
function windowsReader(ticks: string | null): StartTimeReader {
  return startTimeReader("win32", { powershell: () => ticks, taskkill: () => 0 });
}

describe("leaseStore: stale holders are cleaned up", () => {
  const here = () => currentFileHolder();

  test("a lease whose process is dead counts for nothing, and is removed", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, { ...here(), pid: await deadPid() }, 1);
    const machine = store(dir, 1);
    expect(await machine.held()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    // And its slot is free again.
    expect(await machine.tryTake(true, record("host-a"))).not.toBeNull();
  });

  test("a lease whose pid was reused (alive, another start time) is removed", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, { ...here(), startTime: "proc:1" }, 1);
    expect(await store(dir).held()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  test("a lease of a live process stays, however old its file is", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, here(), 1, 10 * UNSEEN_STALE_MS);
    expect((await store(dir).held()).map((unit) => unit.slot)).toEqual([true]);
    expect(existsSync(file)).toBe(true);
  });

  test("a lease from a process this machine cannot see stays while it is touched, then goes", async () => {
    const dir = tempDir("store");
    const elsewhere: FileHolder = { pid: 1, startTime: "proc:5", host: "host-b", pidns: "pid:[1]" };
    const fresh = plantLease(dir, elsewhere, 1, UNSEEN_STALE_MS - 30_000);
    const old = plantLease(dir, elsewhere, 1, UNSEEN_STALE_MS + 30_000);
    // Same host name, another pid namespace (a container): judged by its touches too.
    const container = plantLease(dir, { ...here(), pidns: "pid:[2]" }, 1, UNSEEN_STALE_MS + 30_000);
    expect(await store(dir).held()).toHaveLength(1);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(container)).toBe(false);
  });

  test("a file it cannot read holds no slot, and goes once nobody touches it", async () => {
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

// Windows reads a start time with PowerShell (`windows.ts`): no `/proc`, one call a check.
describe("leaseStore: a Windows holder", () => {
  test("a lease whose pid was reused (another start time) is removed", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, { ...currentFileHolder(), startTime: "win:1000" }, 1);
    const machine = store(dir, 1, undefined, windowsReader("2000"));
    expect(await machine.held()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    // And its slot is free again.
    expect(await machine.tryTake(true, record("host-a"))).not.toBeNull();
  });

  test("a lease of a live process stays, however old its file is", async () => {
    const dir = tempDir("store");
    const file = plantLease(
      dir,
      { ...currentFileHolder(), startTime: "win:1000" },
      1,
      10 * UNSEEN_STALE_MS,
    );
    const machine = store(dir, 3, undefined, windowsReader("1000"));
    expect((await machine.held()).map((unit) => unit.slot)).toEqual([true]);
    expect(existsSync(file)).toBe(true);
  });

  // The fail-safe (`windows.ts`): a holder PowerShell cannot judge counts as ALIVE, so a
  // job waits instead of running on top of a slot someone may still hold.
  test("a holder PowerShell cannot answer for stays: the lease is not freed", async () => {
    const dir = tempDir("store");
    const file = plantLease(
      dir,
      { ...currentFileHolder(), startTime: "win:1000" },
      1,
      10 * UNSEEN_STALE_MS,
    );
    const machine = store(dir, 3, undefined, windowsReader(null));
    expect((await machine.held()).map((unit) => unit.slot)).toEqual([true]);
    expect(existsSync(file)).toBe(true);
  });
});

describe("leaseStore: exclusive names", () => {
  test("takes a name only while no lease holds it, with or without a slot", async () => {
    const dir = tempDir("store");
    const machine = store(dir, 3);
    const first = await machine.tryTake(false, record("host-a", false), "image");
    expect(first).not.toBeNull();
    expect(await machine.tryTake(true, record("host-a"), "image")).toBeNull();
    const other = await machine.tryTake(true, record("host-a"), "deploy");
    expect(other).not.toBeNull();
    first?.release();
    other?.release();
    const second = await machine.tryTake(true, record("host-a"), "image");
    expect(second).not.toBeNull();
    other?.release();
    second?.release();
  });

  test("a name held alone leaves the slots free", async () => {
    const machine = store(tempDir("store"), 1);
    const name = await machine.tryTake(false, record("host-a", false), "image");
    expect(name).not.toBeNull();
    expect(await machine.tryTake(true, record("host-a"))).not.toBeNull();
    expect((await machine.held()).map((unit) => unit.slot).sort()).toEqual([false, true]);
  });
});
