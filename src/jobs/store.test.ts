/**
 * The lease store (`store.ts`) on real files in a temp folder: a take is a slot or nothing,
 * stale leases (a dead pid, a reused pid, a file nobody touched) count for nothing and are
 * removed, a holder's heartbeat keeps its file, and two machines share one folder.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, win32 } from "node:path";
import { processStartTime, type StartTimeReader } from "../setup/lock";
import { tempDir } from "../testing/temp";
import { acquireFrom, holderText, type Reservation } from "./queue";
import {
  currentFileHolder,
  type FileHolder,
  leaseStore,
  mountTypeOf,
  networkFileSystem,
  openSharedStore,
  type SharedFolderFacts,
  tempFileBeside,
  UNSEEN_STALE_MS,
} from "./store";
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

function leaseFiles(dir: string): string[] {
  const folder = join(dir, "leases");
  return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".json")) : [];
}

function store(dir: string, slots = 3, self?: FileHolder, startTimeOf?: StartTimeReader) {
  return leaseStore({
    dir,
    label: "this machine",
    shared: false,
    capacity: () => slots,
    ...(self !== undefined && { self }),
    ...(startTimeOf !== undefined && { startTimeOf }),
  });
}

/** The reader a Windows machine's store uses, with a fake PowerShell: it answers `ticks`. */
function windowsReader(ticks: string | null): StartTimeReader {
  return startTimeReader("win32", { powershell: () => ticks, taskkill: () => 0 });
}

describe("leaseStore: taking slots", () => {
  test("takes a slot while one is free, and gives it back", async () => {
    const dir = tempDir("store");
    const machine = store(dir, 2);
    const first = await machine.tryTake(true, record("host-a"));
    const second = await machine.tryTake(true, record("host-a"));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await machine.tryTake(true, record("host-a"))).toBeNull();
    expect(leaseFiles(dir)).toHaveLength(2);
    expect((await machine.held()).map((unit) => unit.slot)).toEqual([true, true]);
    first?.release();
    first?.release();
    expect(leaseFiles(dir)).toHaveLength(1);
    // The slot is free again.
    const third = await machine.tryTake(true, record("host-a"));
    expect(third).not.toBeNull();
    second?.release();
    third?.release();
    expect(leaseFiles(dir)).toEqual([]);
    expect(await machine.held()).toEqual([]);
  });

  test("one slot means one job at a time", async () => {
    const machine = store(tempDir("store"), 1);
    const only = await machine.tryTake(true, record("host-a"));
    expect(only).not.toBeNull();
    expect(await machine.tryTake(true, record("host-a"))).toBeNull();
    only?.release();
    expect(await machine.tryTake(true, record("host-a"))).not.toBeNull();
  });

  // Mixed versions: an older `job run` wrote the GB it reserved in a lease's `gb`. This
  // plugin counts every live lease as one slot, whatever that number says.
  test("counts a lease an older plugin wrote as one slot, whatever GB it reserved", async () => {
    const dir = tempDir("store");
    plantLease(dir, currentFileHolder(), 14);
    plantLease(dir, currentFileHolder(), 2);
    const machine = store(dir, 3);
    expect((await machine.held()).map((unit) => unit.slot)).toEqual([true, true]);
    // Two slots in use of three: one more fits, and then the machine is full.
    const third = await machine.tryTake(true, record("host-a"));
    expect(third).not.toBeNull();
    expect(await machine.tryTake(true, record("host-a"))).toBeNull();
  });

  test("a lease that holds a name alone (0) uses no slot", async () => {
    const dir = tempDir("store");
    plantLease(dir, currentFileHolder(), 0);
    const machine = store(dir, 1);
    expect((await machine.held()).map((unit) => unit.slot)).toEqual([false]);
    expect(await machine.tryTake(true, record("host-a"))).not.toBeNull();
  });

  // An older `job run` reads `gb` as the GB a lease reserves: 1 for a slot, 0 for a name.
  test("writes 1 in a lease's old gb field for a slot and 0 for a name, and no other new field", async () => {
    const dir = tempDir("store");
    const machine = store(dir, 3);
    const slot = await machine.tryTake(true, record("host-a"));
    const name = await machine.tryTake(false, record("host-a", false), "image");
    const written = leaseFiles(dir).map(
      (file) =>
        JSON.parse(readFileSync(join(dir, "leases", file), "utf8")) as Record<string, unknown>,
    );
    expect(written.map((one) => one.gb).sort()).toEqual([0, 1]);
    for (const one of written) {
      expect(Object.keys(one).sort()).toEqual(
        ["gb", "holder", "record", "store", ...("exclusive" in one ? ["exclusive"] : [])].sort(),
      );
    }
    slot?.release();
    name?.release();
  });

  test("lists the line with its own ticket marked, and drops it on release", async () => {
    const dir = tempDir("store");
    const machine = store(dir);
    const mine = await machine.enqueue(record("host-a"));
    const other = await store(dir).enqueue(record("host-a", false));
    const line = (await mine?.line()) ?? [];
    expect(line.map((entry) => entry.mine).sort()).toEqual([false, true]);
    expect(line.map((entry) => JSON.parse(entry.text).gb).sort()).toEqual([0, 1]);
    expect((await machine.waiting()).map((unit) => unit.slot).sort()).toEqual([false, true]);
    mine?.release();
    other?.release();
    expect(readdirSync(join(dir, "tickets"))).toEqual([]);
  });
});

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

describe("leaseStore: the heartbeat", () => {
  test("touches the holder's own files, and writes one again when a reader removed it", async () => {
    const dir = tempDir("store");
    const machine = leaseStore({
      dir,
      label: "this machine",
      shared: false,
      capacity: () => 3,
      heartbeatMs: 20,
    });
    const units = await machine.tryTake(true, record("host-a"));
    const [name] = leaseFiles(dir);
    const file = join(dir, "leases", name ?? "");
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(file, old, old);
    await Bun.sleep(80);
    expect(Date.now() - statSync(file).mtimeMs).toBeLessThan(10_000);
    unlinkSync(file);
    await Bun.sleep(80);
    expect((await machine.held()).map((unit) => unit.slot)).toEqual([true]);
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

  test("one count of slots for both: what host-a holds, host-b waits for", async () => {
    const dir = tempDir("shared");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
    const shared = (host: string) =>
      leaseStore({
        dir,
        label: dir,
        shared: true,
        capacity: () => 2,
        self: holderOn(host, `pid:[${host}]`),
      });
    const a = shared("host-a");
    const b = shared("host-b");
    const options = (person: string) => ({
      onWaiting: () => undefined,
      person,
      pollMs: 10,
    });
    const job = () => ({
      checkout: "/w",
      kind: "build",
      pid: process.pid,
      slot: true,
      what: "x",
    });
    const first = await acquireFrom([a], job(), options("host-a"));
    const firstToo = await acquireFrom([a], job(), options("host-a"));
    // host-b sees host-a's two slots, through its own view of the folder.
    expect((await b.held()).map((unit) => JSON.parse(unit.text).person)).toEqual([
      "host-a",
      "host-a",
    ]);
    let second: Reservation | null = null;
    void acquireFrom([b], job(), options("host-b")).then((reservation) => {
      second = reservation;
    });
    await Bun.sleep(150);
    expect(second).toBeNull();
    first.release();
    for (let i = 0; i < 100 && second === null; i++) await Bun.sleep(10);
    expect(second).not.toBeNull();
    (second as Reservation | null)?.release();
    firstToo.release();
  });
});

describe("leaseStore: other users' files", () => {
  test("writes lease and ticket files every user can read, whatever the umask", async () => {
    const dir = tempDir("store");
    const before = process.umask(0o077);
    try {
      const machine = store(dir);
      const units = await machine.tryTake(true, record("host-a"));
      const ticket = await machine.enqueue(record("host-a"));
      const [lease] = leaseFiles(dir);
      const [waiting] = readdirSync(join(dir, "tickets"));
      expect(statSync(join(dir, "leases", lease ?? "")).mode & 0o777).toBe(0o644);
      expect(statSync(join(dir, "tickets", waiting ?? "")).mode & 0o777).toBe(0o644);
      units?.release();
      ticket?.release();
    } finally {
      process.umask(before);
    }
  });

  test("takes a slot under a lock every user can read, whatever the umask", async () => {
    const dir = tempDir("store");
    let lockMode: number | null = null;
    const before = process.umask(0o077);
    try {
      const machine = leaseStore({
        dir,
        label: "this machine",
        shared: false,
        // Read under the folder's lock: the lock file is there.
        capacity: () => {
          lockMode = statSync(join(dir, "lock")).mode & 0o777;
          return 3;
        },
      });
      (await machine.tryTake(true, record("host-a")))?.release();
    } finally {
      process.umask(before);
    }
    expect(lockMode as number | null).toBe(0o664);
  });

  test.skipIf(process.getuid?.() === 0)(
    "a lock it may not read means busy (try again), never a failed store",
    async () => {
      const dir = tempDir("store");
      const lock = join(dir, "lock");
      writeFileSync(lock, "{}");
      chmodSync(lock, 0o000);
      expect(await store(dir).tryTake(true, record("host-a"))).toBeNull();
      expect(leaseFiles(dir)).toEqual([]);
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "a lease it may not read counts nothing, says so once, and goes once nobody touches it",
    async () => {
      const dir = tempDir("store");
      const fresh = plantLease(dir, currentFileHolder(), 1);
      const old = plantLease(dir, currentFileHolder(), 1, UNSEEN_STALE_MS + 30_000);
      chmodSync(fresh, 0o000);
      chmodSync(old, 0o000);
      const notes: string[] = [];
      const machine = leaseStore({
        dir,
        label: "this machine",
        shared: false,
        capacity: () => 3,
        onNote: (line) => notes.push(line),
      });
      expect(await machine.held()).toEqual([]);
      expect(await machine.held()).toEqual([]);
      expect(notes).toEqual([
        `${fresh} cannot be read (EACCES): it does not count as a slot until its writer stops touching it.`,
      ]);
      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(old)).toBe(false);
    },
  );
});

describe("leaseStore: a look", () => {
  test("removes a temp file a crashed writer left once it is a minute old, never a fresh one", async () => {
    const dir = tempDir("store");
    mkdirSync(join(dir, "leases"));
    const left = join(dir, "leases", ".left.tmp");
    const writing = join(dir, "leases", ".writing.tmp");
    writeFileSync(left, "{");
    writeFileSync(writing, "{");
    const old = (Date.now() - 61_000) / 1000;
    utimesSync(left, old, old);
    await store(dir).held();
    expect(existsSync(left)).toBe(false);
    expect(existsSync(writing)).toBe(true);
  });

  test("CM-2: a lease on a Windows path is written through a temp file beside it", () => {
    // The file path a Windows run has: `join` there writes `\`, so a file's folder is not
    // "everything before the last /". Taking it that way left a Windows lease no folder at
    // all (the write failed with ENOENT), and the queue then ran the job unqueued
    // (`docs/windows-jobs.md`: the queue applies in full there).
    const file = win32.join(
      "C:\\Users\\user",
      ".local",
      "share",
      "cc-smart-dev-kit",
      "jobs",
      "leases",
      "0f8f-1234.json",
    );
    expect(file).toBe(
      "C:\\Users\\user\\.local\\share\\cc-smart-dev-kit\\jobs\\leases\\0f8f-1234.json",
    );
    expect(tempFileBeside(file, "0f8f-1234", "win32")).toBe(
      "C:\\Users\\user\\.local\\share\\cc-smart-dev-kit\\jobs\\leases\\.0f8f-1234.tmp",
    );
  });

  // On macOS each read starts `ps`: one per file every half second adds up.
  test("reads each pid's start time once per look, however many files it holds", async () => {
    const dir = tempDir("store");
    for (let index = 0; index < 3; index++) plantLease(dir, currentFileHolder(), 1);
    const reads: number[] = [];
    const machine = leaseStore({
      dir,
      label: "this machine",
      shared: false,
      capacity: () => 3,
      startTimeOf: (pid, like) => {
        reads.push(pid);
        return processStartTime(pid, like);
      },
    });
    expect(await machine.held()).toHaveLength(3);
    expect(reads).toEqual([process.pid]);
    await machine.held();
    expect(reads).toEqual([process.pid, process.pid]);
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

  test("this machine keeps every name; a shared folder only the names its exclusive file lists", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "max-jobs"), "3\n");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
    expect(await store(tempDir("store")).keepsExclusive("image")).toBe(true);
    const opened = openSharedStore(dir);
    if (!("store" in opened)) throw new Error(opened.note);
    expect(await opened.store.keepsExclusive("image")).toBe(false);
    writeFileSync(join(dir, "exclusive"), "# one name a line\nimage\n\n  deploy  # the release\n");
    expect(await opened.store.keepsExclusive("image")).toBe(true);
    expect(await opened.store.keepsExclusive("deploy")).toBe(true);
    expect(await opened.store.keepsExclusive("build")).toBe(false);
  });
});

describe("network file systems", () => {
  const facts = (type: number | null, mountinfo: string | null = null): SharedFolderFacts => ({
    platform: "linux",
    fsType: () => type,
    mountinfo: () => mountinfo,
  });
  const fuseMount = (point: string, type: string) =>
    `36 25 0:45 / ${point} rw,nosuid - ${type} remote:/x rw\n24 1 8:1 / / rw - ext4 /dev/sda1 rw`;

  test("names NFS, SMB and 9p by the kernel's magic number", () => {
    expect(networkFileSystem("/srv/x", facts(0x6969))).toBe("NFS");
    expect(networkFileSystem("/srv/x", facts(0xfe534d42))).toBe("SMB2");
    expect(networkFileSystem("/srv/x", facts(0x01021997))).toBe("9p");
    // ext4, tmpfs: local.
    expect(networkFileSystem("/srv/x", facts(0xef53))).toBeNull();
    expect(networkFileSystem("/srv/x", facts(0x01021994))).toBeNull();
    // Not Linux: the numbers mean other things there; no check.
    expect(networkFileSystem("/srv/x", { ...facts(0x6969), platform: "darwin" })).toBeNull();
  });

  test("names a FUSE mount by its subtype: sshfs reaches another machine, a local one does not", () => {
    const fuse = 0x65735546;
    expect(networkFileSystem("/srv/x", facts(fuse, fuseMount("/srv", "fuse.sshfs")))).toBe(
      "fuse.sshfs",
    );
    expect(networkFileSystem("/srv/x", facts(fuse, fuseMount("/srv", "fuse.gocryptfs")))).toBe(
      null,
    );
  });

  test("finds the mount that holds a path: the longest mount point, spaces unescaped", () => {
    const info = [
      "24 1 8:1 / / rw - ext4 /dev/sda1 rw",
      "36 24 0:45 / /srv/heavy\\040jobs rw - fuse.sshfs host:/x rw",
      "37 24 0:46 / /srv/heavy rw - nfs4 host:/y rw",
    ].join("\n");
    expect(mountTypeOf("/srv/heavy jobs/leases", info)).toBe("fuse.sshfs");
    expect(mountTypeOf("/srv/heavy", info)).toBe("nfs4");
    expect(mountTypeOf("/srv/heavyweight", info)).toBe("ext4");
  });

  test("leaves out a shared folder on one, and says why", () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "max-jobs"), "3\n");
    expect(openSharedStore(dir, { facts: facts(0x6969) })).toEqual({
      note: `The shared folder ${dir} is left out: it is on a network file system (NFS). A shared folder is for one host: containers or users on this machine, through a bind mount.`,
    });
  });
});

describe("openSharedStore", () => {
  test("leaves out a missing folder, and says so", () => {
    const dir = join(tempDir("shared"), "missing");
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is missing: this job runs without its slots.`,
    });
  });

  test("leaves out a folder whose max-jobs is missing or not a whole number of jobs, and says why", () => {
    const dir = tempDir("shared");
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: ${join(dir, "max-jobs")} cannot be read (ENOENT).`,
    });
    for (const text of ["lots\n", "0\n", "2.5\n", "-1\n", "\n"]) {
      writeFileSync(join(dir, "max-jobs"), text);
      expect(openSharedStore(dir)).toEqual({
        note: `The shared folder ${dir} is left out: ${join(dir, "max-jobs")} does not hold a whole number of jobs, 1 or more.`,
      });
    }
  });

  // Mixed versions: a folder an older plugin prepared has only `budget` (GB). The queue counts
  // jobs now, so the folder is left out, once, and the note names the fix.
  test("leaves out a folder that has only the old budget file, and names the fix", () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "budget"), "30\n");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: it has only the old budget file (GB), and the queue counts jobs now: write the number of heavy jobs at once, for every user of the folder, into ${join(dir, "max-jobs")} (a whole number, for example 3).`,
    });
  });

  test("a folder with both files is read by max-jobs, and the budget file is left alone", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "budget"), "30\n");
    writeFileSync(join(dir, "max-jobs"), "2\n");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
    const opened = openSharedStore(dir);
    if (!("store" in opened)) throw new Error(opened.note);
    expect(await opened.store.capacity()).toBe(2);
    expect(readFileSync(join(dir, "budget"), "utf8")).toBe("30\n");
  });

  // The machine's own setup prepares the folder: the plugin makes nothing in it.
  test("leaves out a folder without its leases/ or tickets/, names the missing one, and makes none", () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "max-jobs"), "3\n");
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: ${join(dir, "leases")} is missing.`,
    });
    mkdirSync(join(dir, "leases"));
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: ${join(dir, "tickets")} is missing.`,
    });
    expect(readdirSync(dir).sort()).toEqual(["leases", "max-jobs"]);
  });

  test("a shared store never makes a folder: a take after its leases/ went away fails", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "max-jobs"), "3\n");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
    const opened = openSharedStore(dir);
    if (!("store" in opened)) throw new Error(opened.note);
    rmSync(join(dir, "leases"), { recursive: true });
    await expect(opened.store.tryTake(true, record("host-a"))).rejects.toThrow("ENOENT");
    expect(existsSync(join(dir, "leases"))).toBe(false);
  });

  test.skipIf(process.getuid?.() === 0)(
    "leaves out a folder where a file cannot be written, and says why",
    () => {
      const dir = tempDir("shared");
      writeFileSync(join(dir, "max-jobs"), "3\n");
      mkdirSync(join(dir, "leases"), { mode: 0o500 });
      mkdirSync(join(dir, "tickets"));
      try {
        expect(openSharedStore(dir)).toEqual({
          note: `The shared folder ${dir} is left out: ${join(dir, "leases")} cannot be written (EACCES).`,
        });
      } finally {
        chmodSync(join(dir, "leases"), 0o700);
      }
    },
  );

  test("uses a working folder, and reads its max-jobs for every decision", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "max-jobs"), "3\n");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
    const opened = openSharedStore(dir);
    if (!("store" in opened)) throw new Error(opened.note);
    expect(opened.store.shared).toBe(true);
    expect(opened.store.label).toBe(dir);
    expect(await opened.store.capacity()).toBe(3);
    writeFileSync(join(dir, "max-jobs"), "5\n");
    expect(await opened.store.capacity()).toBe(5);
    writeFileSync(join(dir, "max-jobs"), "x\n");
    await expect(opened.store.capacity()).rejects.toThrow(
      "does not hold a whole number of jobs, 1 or more",
    );
    expect(readdirSync(join(dir, "leases"))).toEqual([]);
  });
});
