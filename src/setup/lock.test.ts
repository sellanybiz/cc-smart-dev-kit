import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  FALLBACK_STALE_MS,
  LockBusyError,
  ownPidNamespace,
  processStartTime,
  withLock,
} from "./lock";

/** The pid of a process that has already exited. */
async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"]);
  await child.exited;
  return child.pid;
}

interface FakeLock {
  pid: number;
  startTime?: string | null;
  host?: string;
  pidns?: string | null;
  time?: number;
}

/** Writes a lock (or with `name`, a take-over claim) as another run would. */
function writeLock(stateDir: string, lock: FakeLock, name = "lock"): string {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, name);
  const time = lock.time ?? Date.now();
  writeFileSync(
    file,
    JSON.stringify({
      pid: lock.pid,
      startTime: lock.startTime === undefined ? processStartTime(lock.pid) : lock.startTime,
      host: lock.host ?? hostname(),
      ...(lock.pidns !== undefined && { pidns: lock.pidns }),
      time,
      token: "someone-else",
    }),
  );
  utimesSync(file, time / 1000, time / 1000);
  return file;
}

const longAgo = () => Date.now() - FALLBACK_STALE_MS - 60_000;

describe("withLock", () => {
  test("a second caller cannot enter while the first holds the lock", async () => {
    const stateDir = tempDir("lock");
    const order: string[] = [];
    await withLock(stateDir, async () => {
      order.push("first in");
      await expect(withLock(stateDir, () => order.push("second in"))).rejects.toThrow(
        LockBusyError,
      );
      order.push("first out");
    });
    expect(order).toEqual(["first in", "first out"]);
    // Released: the next caller gets in.
    expect(await withLock(stateDir, () => "next")).toBe("next");
    expect(existsSync(join(stateDir, "lock"))).toBe(false);
  });

  test("another process cannot enter while this one holds the lock", async () => {
    const stateDir = tempDir("lock");
    const lockModule = join(import.meta.dir, "lock.ts");
    const holder = Bun.spawn(
      [
        "bun",
        "-e",
        `const { withLock } = await import(${JSON.stringify(lockModule)});
         await withLock(${JSON.stringify(stateDir)}, async () => {
           console.log("held");
           await Bun.sleep(1500);
         });`,
      ],
      { stdout: "pipe" },
    );
    const reader = holder.stdout.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("held");
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow(LockBusyError);
    expect(await holder.exited).toBe(0);
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  test("a holder busy with 1 s of synchronous work keeps its lock against a second caller", async () => {
    const stateDir = tempDir("lock");
    const lockModule = join(import.meta.dir, "lock.ts");
    // The holder blocks its own event loop: no timer of its own could run in that time.
    const holder = Bun.spawn(
      [
        "bun",
        "-e",
        `const { writeSync } = await import("node:fs");
         const { withLock } = await import(${JSON.stringify(lockModule)});
         await withLock(${JSON.stringify(stateDir)}, () => {
           writeSync(1, "held\\n");
           const end = Date.now() + 1000;
           while (Date.now() < end) {}
         });`,
      ],
      { stdout: "pipe" },
    );
    const reader = holder.stdout.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("held");
    await Bun.sleep(300);
    // The lock is older than the fallback time here, but its holder is alive: not stale.
    await expect(withLock(stateDir, () => "entered", { fallbackStaleMs: 100 })).rejects.toThrow(
      LockBusyError,
    );
    expect(await holder.exited).toBe(0);
    expect(existsSync(join(stateDir, "lock"))).toBe(false);
  });

  test("a waiting caller gets in once the holder lets go", async () => {
    const stateDir = tempDir("lock");
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withLock(stateDir, () => held);
    const second = withLock(stateDir, () => "second", { waitMs: 5_000 });
    setTimeout(release, 200);
    await first;
    expect(await second).toBe("second");
  });

  test("a lock whose process is dead is taken over", async () => {
    const stateDir = tempDir("lock");
    writeLock(stateDir, { pid: await deadPid(), startTime: "proc:1" });
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  test("a lock whose pid now belongs to another process (another start time) is taken over", async () => {
    const stateDir = tempDir("lock");
    // The same source as this system gives (proc: or ps:), another value.
    const other = `${processStartTime(process.pid)?.split(":")[0]}:0`;
    writeLock(stateDir, { pid: process.pid, startTime: other });
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  test("a live holder is never stale by age, even long after the fallback time", async () => {
    const stateDir = tempDir("lock");
    const file = writeLock(stateDir, { pid: process.pid, time: longAgo() });
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow(
      `process ${process.pid} holds`,
    );
    // The other holder's lock is left as it was.
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe("someone-else");
  });

  test("a fresh lock of a live process is respected", async () => {
    const stateDir = tempDir("lock");
    const file = writeLock(stateDir, { pid: process.pid });
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow(
      `process ${process.pid} holds`,
    );
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe("someone-else");
  });

  test("no start time: respected while fresh, taken over after the fallback time", async () => {
    const stateDir = tempDir("lock");
    writeLock(stateDir, { pid: process.pid, startTime: null });
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow(LockBusyError);
    writeLock(stateDir, { pid: process.pid, startTime: null, time: longAgo() });
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  test("a lock from another host: respected while fresh, taken over after the fallback time", async () => {
    const stateDir = tempDir("lock");
    // A pid that is dead here says nothing about the other host.
    const pid = await deadPid();
    writeLock(stateDir, { pid, host: "other-host" });
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow(
      `process ${pid} on other-host holds`,
    );
    writeLock(stateDir, { pid, host: "other-host", time: longAgo() });
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  test("an unreadable lock: respected while fresh, taken over after the fallback time", async () => {
    const stateDir = tempDir("lock");
    mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, "lock");
    writeFileSync(file, "");
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow("another run holds");
    const old = longAgo() / 1000;
    utimesSync(file, old, old);
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  // Another user wrote it with a narrow mode: busy, never a failure of the caller.
  test.skipIf(process.getuid?.() === 0)(
    "a lock this user may not read: busy while fresh, taken over after the fallback time",
    async () => {
      const stateDir = tempDir("lock");
      const file = writeLock(stateDir, { pid: process.pid });
      chmodSync(file, 0o000);
      await expect(withLock(stateDir, () => "entered")).rejects.toThrow(
        `another run holds ${file}`,
      );
      const old = longAgo() / 1000;
      utimesSync(file, old, old);
      expect(await withLock(stateDir, () => "entered")).toBe("entered");
    },
  );

  test("the lock gets exactly the mode asked for, whatever the umask", async () => {
    const stateDir = tempDir("lock");
    const lockMode = () => statSync(join(stateDir, "lock")).mode & 0o777;
    const before = process.umask(0o077);
    try {
      expect(await withLock(stateDir, lockMode, { mode: 0o664 })).toBe(0o664);
      // Setup's own lock stays private.
      expect(await withLock(stateDir, lockMode)).toBe(0o600);
    } finally {
      process.umask(before);
    }
  });

  test.if(process.platform === "linux")(
    "a live pid from another pid namespace is judged by time: respected while fresh, then taken over",
    async () => {
      const stateDir = tempDir("lock");
      // This process's pid and start time, written in another namespace (a container on
      // this host): there, that pid is another process.
      writeLock(stateDir, { pid: process.pid, pidns: "pid:[1]" });
      await expect(withLock(stateDir, () => "entered")).rejects.toThrow(LockBusyError);
      writeLock(stateDir, { pid: process.pid, pidns: "pid:[1]", time: longAgo() });
      expect(await withLock(stateDir, () => "entered")).toBe("entered");
      // The same namespace: judged by its live pid, never by age.
      writeLock(stateDir, { pid: process.pid, pidns: ownPidNamespace(), time: longAgo() });
      await expect(withLock(stateDir, () => "entered")).rejects.toThrow(LockBusyError);
    },
  );

  test("a run that is taking over a stale lock right now is not disturbed", async () => {
    const stateDir = tempDir("lock");
    const lock = writeLock(stateDir, { pid: await deadPid(), startTime: "proc:1" });
    // A live run (this process, as far as the files say) holds the take-over claim.
    const claim = writeLock(stateDir, { pid: process.pid }, "lock.takeover");
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow(LockBusyError);
    expect(JSON.parse(readFileSync(lock, "utf8")).token).toBe("someone-else");
    expect(existsSync(claim)).toBe(true);
  });

  test("a take-over claim left by a run that died is cleared, and the stale lock taken over", async () => {
    const stateDir = tempDir("lock");
    writeLock(stateDir, { pid: await deadPid(), startTime: "proc:1" });
    const claim = writeLock(
      stateDir,
      { pid: await deadPid(), startTime: "proc:1" },
      "lock.takeover",
    );
    expect(await withLock(stateDir, () => "entered", { waitMs: 2_000 })).toBe("entered");
    expect(existsSync(claim)).toBe(false);
    expect(existsSync(join(stateDir, "lock"))).toBe(false);
  });

  test("the fallback time is 10 minutes", () => {
    expect(FALLBACK_STALE_MS).toBe(600_000);
  });

  test("the lock is released when the work throws", async () => {
    const stateDir = tempDir("lock");
    await expect(
      withLock(stateDir, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(join(stateDir, "lock"))).toBe(false);
  });
});

describe("processStartTime", () => {
  test("is the same for the same process, and null for a dead one", async () => {
    const own = processStartTime(process.pid);
    expect(own).not.toBeNull();
    if (process.platform === "linux") expect(own).toMatch(/^proc:\d+$/);
    expect(processStartTime(process.pid)).toBe(own);
    expect(processStartTime(await deadPid())).toBeNull();
  });

  test("reads from the source of an earlier value: ps for a ps value", () => {
    expect(processStartTime(process.pid, "ps:then")).toMatch(/^ps:\S/);
  });
});
