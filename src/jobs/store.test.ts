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

function store(dir: string, capacity = 10, self?: FileHolder, startTimeOf?: StartTimeReader) {
  return leaseStore({
    dir,
    label: "this machine",
    shared: false,
    capacityGb: () => capacity,
    ...(self !== undefined && { self }),
    ...(startTimeOf !== undefined && { startTimeOf }),
  });
}

/** The reader a Windows machine's store uses, with a fake PowerShell: it answers `ticks`. */
function windowsReader(ticks: string | null): StartTimeReader {
  return startTimeReader("win32", { powershell: () => ticks, taskkill: () => 0 });
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

// Windows reads a start time with PowerShell (`windows.ts`): no `/proc`, one call a check.
describe("leaseStore: a Windows holder", () => {
  test("a lease whose pid was reused (another start time) is removed", async () => {
    const dir = tempDir("store");
    const file = plantLease(dir, { ...currentFileHolder(), startTime: "win:1000" }, 8);
    const machine = store(dir, 10, undefined, windowsReader("2000"));
    expect(await machine.held()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    // And its memory is free again: all 10 GB can be taken.
    expect((await machine.tryTake(10, record("host-a", 10)))?.gb).toBe(10);
  });

  test("a lease of a live process stays, however old its file is", async () => {
    const dir = tempDir("store");
    const file = plantLease(
      dir,
      { ...currentFileHolder(), startTime: "win:1000" },
      8,
      10 * UNSEEN_STALE_MS,
    );
    const machine = store(dir, 10, undefined, windowsReader("1000"));
    expect((await machine.held()).map((unit) => unit.gb)).toEqual([8]);
    expect(existsSync(file)).toBe(true);
  });

  // The fail-safe (`windows.ts`): a holder PowerShell cannot judge counts as ALIVE, so a
  // job waits instead of running on top of memory someone may still hold.
  test("a holder PowerShell cannot answer for stays: the lease is not freed", async () => {
    const dir = tempDir("store");
    const file = plantLease(
      dir,
      { ...currentFileHolder(), startTime: "win:1000" },
      8,
      10 * UNSEEN_STALE_MS,
    );
    const machine = store(dir, 10, undefined, windowsReader(null));
    expect((await machine.held()).map((unit) => unit.gb)).toEqual([8]);
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
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
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

describe("leaseStore: other users' files", () => {
  test("writes lease and ticket files every user can read, whatever the umask", async () => {
    const dir = tempDir("store");
    const before = process.umask(0o077);
    try {
      const machine = store(dir);
      const units = await machine.tryTake(2, record("host-a", 2));
      const ticket = await machine.enqueue(record("host-a", 2));
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

  test("takes memory under a lock every user can read, whatever the umask", async () => {
    const dir = tempDir("store");
    let lockMode: number | null = null;
    const before = process.umask(0o077);
    try {
      const machine = leaseStore({
        dir,
        label: "this machine",
        shared: false,
        // Read under the folder's lock: the lock file is there.
        capacityGb: () => {
          lockMode = statSync(join(dir, "lock")).mode & 0o777;
          return 10;
        },
      });
      (await machine.tryTake(2, record("host-a", 2)))?.release();
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
      expect(await store(dir).tryTake(2, record("host-a", 2))).toBeNull();
      expect(leaseFiles(dir)).toEqual([]);
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "a lease it may not read counts nothing, says so once, and goes once nobody touches it",
    async () => {
      const dir = tempDir("store");
      const fresh = plantLease(dir, currentFileHolder(), 4);
      const old = plantLease(dir, currentFileHolder(), 6, UNSEEN_STALE_MS + 30_000);
      chmodSync(fresh, 0o000);
      chmodSync(old, 0o000);
      const notes: string[] = [];
      const machine = leaseStore({
        dir,
        label: "this machine",
        shared: false,
        capacityGb: () => 10,
        onNote: (line) => notes.push(line),
      });
      expect(await machine.held()).toEqual([]);
      expect(await machine.held()).toEqual([]);
      expect(notes).toEqual([
        `${fresh} cannot be read (EACCES): its GB do not count until its writer stops touching it.`,
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
    for (const gb of [1, 2, 3]) plantLease(dir, currentFileHolder(), gb);
    const reads: number[] = [];
    const machine = leaseStore({
      dir,
      label: "this machine",
      shared: false,
      capacityGb: () => 10,
      startTimeOf: (pid, like) => {
        reads.push(pid);
        return processStartTime(pid, like);
      },
    });
    expect((await machine.held()).map((unit) => unit.gb).sort()).toEqual([1, 2, 3]);
    expect(reads).toEqual([process.pid]);
    await machine.held();
    expect(reads).toEqual([process.pid, process.pid]);
  });
});

describe("leaseStore: exclusive names", () => {
  test("takes a name only while no lease holds it, with or without memory", async () => {
    const dir = tempDir("store");
    const machine = store(dir, 10);
    const first = await machine.tryTake(0, record("host-a", 0), "image");
    expect(first?.gb).toBe(0);
    expect(await machine.tryTake(4, record("host-a", 4), "image")).toBeNull();
    const other = await machine.tryTake(4, record("host-a", 4), "deploy");
    expect(other?.gb).toBe(4);
    first?.release();
    const second = await machine.tryTake(4, record("host-a", 4), "image");
    expect(second?.gb).toBe(4);
    other?.release();
    second?.release();
  });

  test("this machine keeps every name; a shared folder only the names its exclusive file lists", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "budget"), "30\n");
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
    writeFileSync(join(dir, "budget"), "30\n");
    expect(openSharedStore(dir, { facts: facts(0x6969) })).toEqual({
      note: `The shared folder ${dir} is left out: it is on a network file system (NFS). A shared folder is for one host: containers or users on this machine, through a bind mount.`,
    });
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

  // The machine's own setup prepares the folder: the plugin makes nothing in it.
  test("leaves out a folder without its leases/ or tickets/, names the missing one, and makes none", () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "budget"), "30\n");
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: ${join(dir, "leases")} is missing.`,
    });
    mkdirSync(join(dir, "leases"));
    expect(openSharedStore(dir)).toEqual({
      note: `The shared folder ${dir} is left out: ${join(dir, "tickets")} is missing.`,
    });
    expect(readdirSync(dir).sort()).toEqual(["budget", "leases"]);
  });

  test("a shared store never makes a folder: a take after its leases/ went away fails", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "budget"), "30\n");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
    const opened = openSharedStore(dir);
    if (!("store" in opened)) throw new Error(opened.note);
    rmSync(join(dir, "leases"), { recursive: true });
    await expect(opened.store.tryTake(2, record("host-a", 2))).rejects.toThrow("ENOENT");
    expect(existsSync(join(dir, "leases"))).toBe(false);
  });

  test.skipIf(process.getuid?.() === 0)(
    "leaves out a folder where a file cannot be written, and says why",
    () => {
      const dir = tempDir("shared");
      writeFileSync(join(dir, "budget"), "30\n");
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

  test("uses a working folder, and reads its budget for every decision", async () => {
    const dir = tempDir("shared");
    writeFileSync(join(dir, "budget"), "30\n");
    mkdirSync(join(dir, "leases"));
    mkdirSync(join(dir, "tickets"));
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
