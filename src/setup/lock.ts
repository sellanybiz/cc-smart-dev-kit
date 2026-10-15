import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./write";

/** A lock older than this is stale, even when its process still seems alive (pid reuse). */
export const STALE_LOCK_MS = 2 * 60 * 1000;

const LOCK_FILE = "lock";

interface LockInfo {
  pid: number;
  time: number;
  token: string;
}

/** Another cc-agentic run holds the lock. */
export class LockBusyError extends Error {
  override name = "LockBusyError";
}

/** How often the holder writes a new time into its lock, so a long run never looks stale. */
export const REFRESH_LOCK_MS = 30 * 1000;

export interface LockOptions {
  /** How long to keep trying while another run holds the lock. 0 = fail at once. */
  waitMs?: number;
  /** A lock whose time is older than this is stale. Default: 2 minutes. */
  staleMs?: number;
  /** How often the holder refreshes its lock's time. Default: 30 seconds. */
  refreshMs?: number;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(file: string): LockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LockInfo>;
    if (typeof parsed.pid !== "number" || typeof parsed.time !== "number") return null;
    return { pid: parsed.pid, time: parsed.time, token: String(parsed.token ?? "") };
  } catch {
    // Unreadable or half-written: judged by the file's age alone.
    return null;
  }
}

function isStale(file: string, info: LockInfo | null, staleMs: number): boolean {
  let age: number;
  try {
    age = Date.now() - (info?.time ?? statSync(file).mtimeMs);
  } catch {
    return false; // gone already: the next attempt simply creates it
  }
  if (age > staleMs) return true;
  return info !== null && !isAlive(info.pid);
}

function tryCreate(file: string, info: LockInfo): boolean {
  let fd: number;
  try {
    fd = openSync(file, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Moves a stale lock out of the way. The rename is atomic, so only one run wins it.
 * If the file we moved is not the stale one we judged (another run took over in between),
 * we put it back without overwriting anything and report busy.
 */
function takeOverStale(file: string, judged: LockInfo | null): void {
  const aside = `${file}.stale-${process.pid}-${crypto.randomUUID()}`;
  try {
    renameSync(file, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const moved = readLock(aside);
  const sameLock = judged === null ? moved === null : moved?.token === judged.token;
  if (!sameLock) {
    try {
      linkSync(aside, file);
    } catch {
      // Someone holds a new lock already; theirs stays.
    }
  }
  unlinkSync(aside);
}

/** Writes a new time into our lock (atomic rename), only while the lock is still ours. */
function refreshLock(file: string, mine: LockInfo): void {
  try {
    if (readLock(file)?.token !== mine.token) return;
    mine.time = Date.now();
    atomicWrite(file, JSON.stringify(mine), 0o600);
  } catch (error) {
    // A missed refresh is not fatal: the next one tries again, and staleness needs 2 minutes.
    console.error(`cc-agentic: could not refresh the lock ${file}: ${String(error)}`);
  }
}

/**
 * Runs `fn` while holding an exclusive lock file in `stateDir` (created with O_EXCL).
 * A lock whose process is dead, or whose time is older than 2 minutes, is stale and taken
 * over. While `fn` runs, the holder writes a new time every 30 seconds, so a long run
 * keeps its lock; a holder that stopped (hung, killed) stops refreshing and goes stale.
 */
export async function withLock<T>(
  stateDir: string,
  fn: () => T | Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, LOCK_FILE);
  const mine: LockInfo = { pid: process.pid, time: Date.now(), token: crypto.randomUUID() };
  const deadline = Date.now() + (options.waitMs ?? 0);
  const staleMs = options.staleMs ?? STALE_LOCK_MS;
  const refreshMs = options.refreshMs ?? REFRESH_LOCK_MS;

  for (;;) {
    mine.time = Date.now();
    if (tryCreate(file, mine)) break;
    const held = readLock(file);
    if (isStale(file, held, staleMs)) {
      takeOverStale(file, held);
      continue;
    }
    if (Date.now() >= deadline) {
      const who = held ? `process ${held.pid}` : "another run";
      throw new LockBusyError(
        `cc-agentic is busy: ${who} holds ${file}. Wait for it to finish, then try again.`,
      );
    }
    await Bun.sleep(100);
  }

  const refresh = setInterval(() => refreshLock(file, mine), refreshMs);
  try {
    return await fn();
  } finally {
    clearInterval(refresh);
    // Remove the lock only while it is still ours.
    if (existsSync(file) && readLock(file)?.token === mine.token) unlinkSync(file);
  }
}
