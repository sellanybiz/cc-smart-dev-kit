import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { LockBusyError, REFRESH_LOCK_MS, STALE_LOCK_MS, withLock } from "./lock";

/** The pid of a process that has already exited. */
async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"]);
  await child.exited;
  return child.pid;
}

function writeLock(stateDir: string, info: { pid: number; time: number }): string {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, "lock");
  writeFileSync(file, JSON.stringify({ ...info, token: "someone-else" }));
  return file;
}

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
    writeLock(stateDir, { pid: await deadPid(), time: Date.now() });
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  test("a lock older than 2 minutes is taken over, even with a live pid", async () => {
    const stateDir = tempDir("lock");
    const old = Date.now() - STALE_LOCK_MS - 1_000;
    const file = writeLock(stateDir, { pid: process.pid, time: old });
    utimesSync(file, old / 1000, old / 1000);
    expect(await withLock(stateDir, () => "entered")).toBe("entered");
  });

  test("a fresh lock of a live process is respected", async () => {
    const stateDir = tempDir("lock");
    const file = writeLock(stateDir, { pid: process.pid, time: Date.now() });
    await expect(withLock(stateDir, () => "entered")).rejects.toThrow(
      `process ${process.pid} holds`,
    );
    // The other holder's lock is left as it was.
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe("someone-else");
  });

  test("a holder that works longer than the stale time keeps its lock: it refreshes it", async () => {
    const stateDir = tempDir("lock");
    const timing = { staleMs: 300, refreshMs: 50 };
    let second: unknown = "not tried";
    await withLock(
      stateDir,
      async () => {
        await Bun.sleep(600); // twice the stale time
        try {
          await withLock(stateDir, () => "entered", timing);
          second = "entered";
        } catch (error) {
          second = error;
        }
      },
      timing,
    );
    expect(second).toBeInstanceOf(LockBusyError);
    // After the holder finished, the refresh stopped and the lock is gone for good.
    await Bun.sleep(150);
    expect(existsSync(join(stateDir, "lock"))).toBe(false);
  });

  test("the defaults: 2 minutes stale, 30 seconds refresh", () => {
    expect(STALE_LOCK_MS).toBe(120_000);
    expect(REFRESH_LOCK_MS).toBe(30_000);
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
