import {
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

/**
 * When a lock cannot be judged by its process, it is stale after this long: the start
 * time cannot be read, the lock was written on another host (a home folder shared between
 * machines) or in another pid namespace (a container), or the file cannot be read at all.
 */
export const FALLBACK_STALE_MS = 10 * 60 * 1000;

const LOCK_FILE = "lock";
/** The claim a run holds while it removes a stale lock, so two runs never both remove one. */
const TAKEOVER_SUFFIX = ".takeover";

/** A process that holds something: a lock, or a job's lease (`src/jobs/`). */
export interface ProcessHolder {
  pid: number;
  /** When the holder process started (`proc:<ticks>` or `ps:<date>`), or null when unknown. */
  startTime: string | null;
  host: string;
  /**
   * The holder's pid namespace (`/proc/self/ns/pid`, Linux), or null when not known (not
   * Linux, or a lock an older plugin wrote). Two containers on one host may share a host
   * name, and each has its own pids: a pid from another namespace says nothing here.
   */
  pidns?: string | null;
}

interface LockInfo extends ProcessHolder {
  /** When the lock was made (ms). Used only when the holder cannot be judged. */
  time: number;
  token: string;
}

/** A lock file as it is now: its content (null when unreadable) and its identity. */
interface Held {
  info: LockInfo | null;
  ino: number;
  mtimeMs: number;
  size: number;
}

/** Another cc-smart-dev-kit run holds the lock. */
export class LockBusyError extends Error {
  override name = "LockBusyError";
}

export interface LockOptions {
  /** How long to keep trying while another run holds the lock. 0 = fail at once. */
  waitMs?: number;
  /** When a lock cannot be judged by its process: stale after this. Default: 10 minutes. */
  fallbackStaleMs?: number;
  /**
   * The mode of the lock file and its take-over claim. Default 0600: setup's lock is
   * private. A folder several users share (the heavy-job queue) passes 0664, so every user
   * can read who holds it and judge it. Set with fchmod, so the umask never narrows it.
   */
  mode?: number;
}

/** Field 22 of /proc/<pid>/stat: the start time in clock ticks after boot (Linux). */
function procStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 2 (the command name, in parentheses) may hold spaces: count from the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const start = fields[22 - 3];
    return start && /^\d+$/.test(start) ? start : null;
  } catch {
    return null; // no /proc (macOS), or the process is gone
  }
}

/** `ps -o lstart=`: the start date of the process, where there is no /proc (macOS). */
function psStartTime(pid: number): string | null {
  try {
    const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, LC_ALL: "C" },
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = result.stdout.toString().trim();
    return result.exitCode === 0 && text !== "" ? text : null;
  } catch {
    return null; // no ps on PATH
  }
}

/**
 * When process `pid` started, as text: the same for the same process, different when the
 * pid was reused. Null when neither /proc nor ps can tell. With `like` (an earlier value)
 * it reads from the same source, so the two values compare.
 */
export function processStartTime(pid: number, like?: string): string | null {
  if (like === undefined || like.startsWith("proc:")) {
    const proc = procStartTime(pid);
    if (proc !== null) return `proc:${proc}`;
  }
  if (like === undefined || like.startsWith("ps:")) {
    const ps = psStartTime(pid);
    if (ps !== null) return `ps:${ps}`;
  }
  return null;
}

/** Reads a start time the way `processStartTime` does; one look may pass a cached reader. */
export type StartTimeReader = (pid: number, like?: string) => string | null;

/** This process's pid namespace (`/proc/self/ns/pid`), or null where there is none. */
export function ownPidNamespace(): string | null {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null; // not Linux
  }
}

let ownPidns: string | null | undefined;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseLock(text: string): LockInfo | null {
  try {
    const parsed = JSON.parse(text) as Partial<LockInfo>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.time !== "number" ||
      typeof parsed.token !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      startTime: typeof parsed.startTime === "string" ? parsed.startTime : null,
      host: typeof parsed.host === "string" ? parsed.host : "",
      pidns: typeof parsed.pidns === "string" ? parsed.pidns : null,
      time: parsed.time,
      token: parsed.token,
    };
  } catch {
    return null; // unreadable, or still being written
  }
}

/**
 * The lock file as it is now, or null when it is gone. A lock this user may not read
 * (another user wrote it with a narrow mode) is held all the same: busy, with no content,
 * judged by its age.
 */
function readHeld(file: string): Held | null {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let info: LockInfo | null;
  try {
    info = parseLock(readFileSync(file, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code !== "EACCES" && code !== "EPERM") throw error;
    info = null;
  }
  return { info, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
}

/** The same lock: the same token, or (both unreadable) the same file, unchanged. */
function sameHeld(a: Held, b: Held): boolean {
  if (a.info && b.info) return a.info.token === b.info.token;
  if (a.info || b.info) return false;
  return a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * True when `holder` is gone: its pid is dead, or alive with another start time (the pid
 * was reused). A live holder is never gone, however long it runs. When it cannot be judged
 * (null: unreadable; another host; another pid namespace; no start time), it is gone once
 * `lastSeenMs` is more than `fallbackStaleMs` ago.
 */
export function holderIsGone(
  holder: ProcessHolder | null,
  lastSeenMs: number,
  fallbackStaleMs: number,
  startTimeOf: StartTimeReader = processStartTime,
): boolean {
  const oldEnough = Date.now() - lastSeenMs > fallbackStaleMs;
  if (holder === null || holder.host !== hostname()) return oldEnough;
  // A pid from another pid namespace (a container on this host) is not one of ours. A
  // holder that did not say (null: an older plugin, or not Linux) is judged by its pid.
  ownPidns ??= ownPidNamespace();
  const theirs = holder.pidns ?? null;
  if (theirs !== null && ownPidns !== null && theirs !== ownPidns) return oldEnough;
  if (!isAlive(holder.pid)) return true;
  if (holder.startTime === null) return oldEnough;
  const now = startTimeOf(holder.pid, holder.startTime);
  if (now === null) return oldEnough;
  return now !== holder.startTime;
}

/** A lock is stale only when its holder is gone (`holderIsGone`). */
function isStale(held: Held, fallbackStaleMs: number): boolean {
  return holderIsGone(held.info, held.info?.time ?? held.mtimeMs, fallbackStaleMs);
}

/**
 * Creates `file` with O_EXCL (only one process can), holding `info`, with exactly `mode`
 * (fchmod: the umask may have narrowed the mode `open` gave it). False when it exists.
 */
function tryCreate(file: string, info: LockInfo, mode: number): boolean {
  let fd: number;
  try {
    fd = openSync(file, "wx", mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    fchmodSync(fd, mode);
    writeSync(fd, JSON.stringify(info));
  } finally {
    closeSync(fd);
  }
  return true;
}

let ownStartTime: string | null | undefined;

/** This process, as a holder: its pid, its start time, the host name, its pid namespace. */
export function currentHolder(): ProcessHolder & { pidns: string | null } {
  ownStartTime ??= processStartTime(process.pid);
  ownPidns ??= ownPidNamespace();
  return { pid: process.pid, startTime: ownStartTime, host: hostname(), pidns: ownPidns };
}

function newLockInfo(): LockInfo {
  return { ...currentHolder(), time: Date.now(), token: crypto.randomUUID() };
}

/**
 * Removes the stale lock `judged`. Returns true when this run removed it or it is gone,
 * false when another run is removing it right now.
 *
 * The run first takes a claim file (O_EXCL). Under the claim, no other run removes the
 * lock, and nobody can create a new one while it exists. So when the lock still is the
 * one we judged, we remove exactly that one, never a live lock that took its place.
 */
function takeOverStale(file: string, judged: Held, fallbackStaleMs: number, mode: number): boolean {
  const claim = `${file}${TAKEOVER_SUFFIX}`;
  const me = newLockInfo();
  if (!tryCreate(claim, me, mode)) {
    // Another run holds the claim. The claim is stale only when that run died during its
    // take-over; then we remove the claim, and a later attempt tries again.
    const other = readHeld(claim);
    if (other && isStale(other, fallbackStaleMs)) {
      const again = readHeld(claim);
      if (again && sameHeld(again, other)) unlinkSync(claim);
    }
    return false;
  }
  try {
    const now = readHeld(file);
    if (now && sameHeld(now, judged)) unlinkSync(file);
    return true;
  } finally {
    if (readHeld(claim)?.info?.token === me.token) unlinkSync(claim);
  }
}

/**
 * True while a live run holds the lock in `stateDir`; a stale lock (`isStale`) and no lock
 * are false. It only looks: it never takes, waits for or removes the lock.
 */
export function lockIsHeld(stateDir: string, fallbackStaleMs = FALLBACK_STALE_MS): boolean {
  try {
    const held = readHeld(join(stateDir, LOCK_FILE));
    return held !== null && !isStale(held, fallbackStaleMs);
  } catch {
    return false;
  }
}

/**
 * Runs `fn` while holding an exclusive lock file in `stateDir` (created with O_EXCL).
 * The lock holds the pid, the start time of that process, the host name and the pid
 * namespace. It is taken over only when its holder is gone (isStale), so a long run keeps
 * it, also one that is busy with synchronous work. A waiting run tries until `waitMs`,
 * then says who holds it.
 */
export async function withLock<T>(
  stateDir: string,
  fn: () => T | Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, LOCK_FILE);
  const mine = newLockInfo();
  const deadline = Date.now() + (options.waitMs ?? 0);
  const fallbackStaleMs = options.fallbackStaleMs ?? FALLBACK_STALE_MS;
  const mode = options.mode ?? 0o600;

  for (;;) {
    mine.time = Date.now();
    if (tryCreate(file, mine, mode)) break;
    const held = readHeld(file);
    if (held === null) continue; // released just now: try again at once
    if (isStale(held, fallbackStaleMs) && takeOverStale(file, held, fallbackStaleMs, mode)) {
      continue;
    }
    if (Date.now() >= deadline) {
      const info = held.info;
      const where = info && info.host !== hostname() ? ` on ${info.host || "another host"}` : "";
      const who = info ? `process ${info.pid}${where}` : "another run";
      throw new LockBusyError(
        `cc-smart-dev-kit is busy: ${who} holds ${file}. Wait for it to finish, then try again.`,
      );
    }
    await Bun.sleep(100);
  }

  try {
    return await fn();
  } finally {
    // Remove the lock only while it is still ours.
    if (readHeld(file)?.info?.token === mine.token) unlinkSync(file);
  }
}
