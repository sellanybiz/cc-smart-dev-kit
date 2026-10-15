/**
 * The lock one worktree creation holds: a file in the repo's common git dir (`.git`), taken
 * with O_EXCL before `git worktree add` and held through the project's setup.
 *
 * Two sessions asking for the same branch at once would both find no worktree of it, both
 * run `git worktree add` for the same folder, and the slower one would fail with git's own
 * words after half the work (and a folder the other one is setting up). The lock turns that
 * into one clear refusal.
 *
 * It holds the pid, the start time of that process and the session id, so a lock whose
 * process is gone (a crash, a killed session) is taken over instead of blocking every later
 * create. `src/setup/lock.ts` holds the same kind of lock for a whole `anymodel setup` run.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { processStartTime } from "../setup/lock";

/** The lock file for one branch: the name is a hash, so a `/` in a branch cannot escape. */
export function createLockFile(commonDir: string, branch: string): string {
  const key = createHash("sha256").update(branch).digest("hex").slice(0, 16);
  return join(commonDir, `anymodel-create-${key}.lock`);
}

/** What the lock file says: who holds it. */
interface Held {
  pid: number;
  /** When that process started, as `processStartTime` writes it (null when unknown). */
  startTime: string | null;
  session: string | null;
  startedAt: string;
  token: string;
}

/** A create cannot start: another process is making the worktree for that branch right now. */
export class CreateBusyError extends Error {
  override name = "CreateBusyError";
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists, but it belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What `file` holds, or null when it cannot be read (being written, or not ours). */
function readHeld(file: string): Held | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Held>;
    return typeof parsed.pid === "number" && typeof parsed.token === "string"
      ? {
          pid: parsed.pid,
          startTime: typeof parsed.startTime === "string" ? parsed.startTime : null,
          session: typeof parsed.session === "string" ? parsed.session : null,
          startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "unknown",
          token: parsed.token,
        }
      : null;
  } catch {
    return null;
  }
}

/** True when the holder is gone: its pid is dead, or that pid now belongs to another process. */
function stale(held: Held): boolean {
  if (!isAlive(held.pid)) return true;
  if (held.startTime === null) return false;
  const now = processStartTime(held.pid, held.startTime);
  return now !== null && now !== held.startTime;
}

/** Why the lock cannot be taken, with the file to remove when its holder is gone for good. */
function busy(file: string, held: Held | null): string {
  const who =
    held === null
      ? "another anymodel process"
      : `another anymodel process (pid ${held.pid}, session ${held.session ?? "unknown"}, started ${held.startedAt})`;
  return `${who} is making the worktree for this branch right now. Wait for it, then ask again; if that process is gone, remove ${file}.`;
}

function take(file: string, mine: Held): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, JSON.stringify(mine));
      } finally {
        closeSync(fd);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const held = readHeld(file);
    if (held !== null && stale(held)) {
      // Gone for good: take its place. Another process may have removed it first.
      try {
        unlinkSync(file);
      } catch {
        // It is gone: the next attempt creates it.
      }
      continue;
    }
    throw new CreateBusyError(busy(file, held));
  }
  throw new CreateBusyError(busy(file, readHeld(file)));
}

/**
 * Runs `fn` holding the create lock for `branch` of the repo `commonDir` (its `.git`).
 * Throws CreateBusyError while another live process holds it.
 */
export function withCreateLock<T>(
  commonDir: string,
  branch: string,
  session: string | null,
  fn: () => T,
): T {
  const file = createLockFile(commonDir, branch);
  const mine: Held = {
    pid: process.pid,
    startTime: processStartTime(process.pid),
    session,
    startedAt: new Date().toISOString(),
    token: crypto.randomUUID(),
  };
  take(file, mine);
  try {
    return fn();
  } finally {
    // Remove the lock only while it is still ours.
    if (readHeld(file)?.token === mine.token) unlinkSync(file);
  }
}
