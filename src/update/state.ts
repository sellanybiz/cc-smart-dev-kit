/**
 * The background self-update's files, all in the state folder (`<stateDir>`, by default
 * `~/.claude/cc-smart-dev-kit/`):
 *
 *   update-hold         while it exists, the SessionStart hook checks nothing
 *   update-check.json   the last check: when, its result, and the detail
 *   update-reported     the failure a session was already told about (its time, or its streak start)
 *   update-major.json   a new major version the background check found and holds (`HeldMajor`)
 *   update.log          one line per step of each check, newest last, kept small
 *   update/lock         held by the one check or update that runs (`withLock`)
 *   sessions/<pid>.json the plugin version each running Claude session loaded
 *
 * None of them is a user's file: they are cc-smart-dev-kit's own state, like the lock and the
 * records, so they are written directly (atomically where a reader may look).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { lockIsHeld, processStartTime } from "../setup/lock";
import { atomicWrite } from "../setup/write";

/** At most one check an hour per config folder. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The log is cut back to its newer half once it is bigger than this. */
export const LOG_MAX_BYTES = 256 * 1024;

export interface UpdateFiles {
  hold: string;
  check: string;
  reported: string;
  /** The held major version (`HeldMajor`): written by the background check, cleared by `update`. */
  major: string;
  log: string;
  /** Pass to `withLock` as its folder: the lock file is `<lockDir>/lock`. */
  lockDir: string;
  sessions: string;
}

export function updateFiles(stateDir: string): UpdateFiles {
  return {
    hold: join(stateDir, "update-hold"),
    check: join(stateDir, "update-check.json"),
    reported: join(stateDir, "update-reported"),
    major: join(stateDir, "update-major.json"),
    log: join(stateDir, "update.log"),
    lockDir: join(stateDir, "update"),
    sessions: join(stateDir, "sessions"),
  };
}

/** What the last check found. */
export type CheckResult =
  /** Started; a check that crashed stays like this until the next one. */
  | "checking"
  | "up-to-date"
  /** A newer version was installed. */
  | "updated"
  /**
   * Nothing to do here (no install, no marketplace, updates switched off, Claude Code
   * busy with the same marketplace): not a failure.
   */
  | "skipped"
  /**
   * The marketplace could not be read, for less than `UNREACHABLE_FAILS_AFTER_HOURS` in a
   * row (a laptop offline for a day, say): information, not a failure. After that it is
   * recorded as `failed`.
   */
  | "unreachable"
  | "failed";

export interface LastCheck {
  /** When the check started, ISO 8601 in UTC. */
  at: string;
  result: CheckResult;
  /** In words: the version found, or why it failed. Never a URL with credentials. */
  detail: string;
  /**
   * When a streak of the same trouble began (the first such check's `at`): while the
   * marketplace cannot be read, check after check (`unreachableCheck`), or while an update
   * fails with the same words (`failedCheck`). A session start tells a streak once. Absent
   * once a check gets past it.
   */
  since?: string;
}

const RESULTS: readonly CheckResult[] = [
  "checking",
  "up-to-date",
  "updated",
  "skipped",
  "unreachable",
  "failed",
];

/** An unreadable marketplace counts as a failure only after this long in a row. */
export const UNREACHABLE_FAILS_AFTER_HOURS = 24;
const UNREACHABLE_FAILS_AFTER_MS = UNREACHABLE_FAILS_AFTER_HOURS * 60 * 60 * 1000;

/** The words every record of an unreadable marketplace starts with. */
const UNREACHABLE_WORDS = "cannot read the marketplace";

/**
 * When the unreadable-marketplace streak that `check` belongs to began; null when it belongs
 * to none. Only such a streak carries on into the next unreadable check: a failed update's own
 * streak (`failedCheck`) must never make a marketplace count as unreadable for longer.
 */
export function unreachableSince(check: LastCheck | null): null | string {
  if (check?.since === undefined) return null;
  const inStreak =
    check.result === "unreachable" ||
    check.result === "checking" ||
    (check.result === "failed" && check.detail.startsWith(UNREACHABLE_WORDS));
  return inStreak ? check.since : null;
}

/**
 * The record of a check that could not read the marketplace. `previous` is the record
 * before it (a `checking` one carries the streak on). It stays `unreachable` (information)
 * until the marketplace has been unreadable for 24 h in a row, then becomes `failed`.
 */
export function unreachableCheck(
  previous: LastCheck | null,
  at: string,
  nowMs: number,
  detail: string,
): LastCheck {
  const since = unreachableSince(previous) ?? at;
  const failed = nowMs - Date.parse(since) >= UNREACHABLE_FAILS_AFTER_MS;
  return {
    at,
    detail: `${UNREACHABLE_WORDS}${failed ? ` since ${since}` : ""} (${detail})`,
    result: failed ? "failed" : "unreachable",
    since,
  };
}

/**
 * The record of an update that failed (`claude plugin update` failed, or a companion plugin
 * stopped it). The same words as the record before it keep that failure's first time
 * (`since`), so a session start tells it once, not after every hourly check; other words
 * start a new streak, which is told again.
 */
export function failedCheck(previous: LastCheck | null, at: string, detail: string): LastCheck {
  const same = previous?.result === "failed" && previous.detail === detail;
  return { at, detail, result: "failed", since: same ? (previous.since ?? previous.at) : at };
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** The last check, or null when there is none or the file cannot be read. */
export function readLastCheck(files: UpdateFiles): LastCheck | null {
  try {
    const parsed = JSON.parse(readFileSync(files.check, "utf8")) as Partial<LastCheck> | null;
    if (
      typeof parsed?.at !== "string" ||
      Number.isNaN(Date.parse(parsed.at)) ||
      !RESULTS.includes(parsed.result as CheckResult) ||
      typeof parsed.detail !== "string"
    ) {
      return null;
    }
    const check: LastCheck = {
      at: parsed.at,
      detail: parsed.detail,
      result: parsed.result as CheckResult,
    };
    if (typeof parsed.since === "string" && !Number.isNaN(Date.parse(parsed.since))) {
      check.since = parsed.since;
    }
    return check;
  } catch {
    return null;
  }
}

export function writeLastCheck(files: UpdateFiles, check: LastCheck): void {
  ensureDir(join(files.check, ".."));
  atomicWrite(files.check, `${JSON.stringify(check, null, 2)}\n`, 0o600);
}

/**
 * True when a check is due: there was none, or the last one started an hour or more ago.
 * A last check in the future (the clock was moved back) is due too: else it would wait
 * until the clock caught up.
 */
export function isDue(last: LastCheck | null, nowMs: number): boolean {
  if (last === null) return true;
  const at = Date.parse(last.at);
  return nowMs - at >= CHECK_INTERVAL_MS || at > nowMs + 60_000;
}

export function isHeld(files: UpdateFiles): boolean {
  return existsSync(files.hold);
}

/** Since when updates are held, as written in the hold file; null when they are not. */
export function heldSince(files: UpdateFiles): null | string {
  try {
    const text = readFileSync(files.hold, "utf8").trim();
    return text === "" ? "an unknown time" : text;
  } catch {
    return null;
  }
}

/**
 * Holds background updates; false when they were held already. One atomic write and no
 * lock: a check that runs now keeps the update lock until it ends, and the next check
 * reads the hold.
 */
export function hold(files: UpdateFiles, nowMs: number): boolean {
  if (isHeld(files)) return false;
  ensureDir(join(files.hold, ".."));
  atomicWrite(files.hold, `${isoSeconds(nowMs)}\n`, 0o600);
  return true;
}

/** Resumes background updates; false when they were not held. No lock, as `hold`. */
export function resume(files: UpdateFiles): boolean {
  if (!isHeld(files)) return false;
  rmSync(files.hold, { force: true });
  return true;
}

/** True while a check or an update holds the update lock (a stale lock does not count). */
export function checkRunning(files: UpdateFiles): boolean {
  return lockIsHeld(files.lockDir);
}

/** A time as ISO 8601 in UTC, to the second: `2026-10-15T10:00:00Z`. */
export function isoSeconds(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/**
 * Appends one timestamped line to a log file in the state folder; cuts the file back to its
 * newer half when it grew past `LOG_MAX_BYTES`. The one size rule of the plain-text logs.
 */
export function appendLogLine(logFile: string, line: string, nowMs: number): void {
  ensureDir(join(logFile, ".."));
  try {
    if (statSync(logFile).size > LOG_MAX_BYTES) {
      const text = readFileSync(logFile, "utf8");
      const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
      writeFileSync(logFile, keep.slice(keep.indexOf("\n") + 1), { mode: 0o600 });
    }
  } catch {
    // No log yet.
  }
  appendFileSync(logFile, `${isoSeconds(nowMs)} ${line}\n`, { mode: 0o600 });
}

/** Appends one line to the update log (`appendLogLine`). */
export function appendLog(files: UpdateFiles, line: string, nowMs: number): void {
  appendLogLine(files.log, line, nowMs);
}

/** True when the failure keyed `at` (its time, or its streak's `since`) was already told. */
export function wasReported(files: UpdateFiles, at: string): boolean {
  try {
    return readFileSync(files.reported, "utf8").trim() === at;
  } catch {
    return false;
  }
}

export function markReported(files: UpdateFiles, at: string): void {
  ensureDir(join(files.reported, ".."));
  atomicWrite(files.reported, `${at}\n`, 0o600);
}

/**
 * A new major version the background check found and did not install (D33): it waits for the
 * person's `update`. Its own file, not a result in `update-check.json`, so an older version's
 * hook still reads that record (`readLastCheck` refuses a result it does not know).
 */
export interface HeldMajor {
  /** The major version found in the marketplace copy. */
  version: string;
  /** The version installed when it was found (null: not recorded). */
  from: null | string;
  /** When it was first found, ISO 8601 in UTC. */
  at: string;
  /** Why it is a major step, in a few words, from the new version's own notes; [] when it has none. */
  notes: string[];
}

/** The held major version, or null when there is none or the file cannot be read. */
export function readHeldMajor(files: UpdateFiles): HeldMajor | null {
  try {
    const parsed = JSON.parse(readFileSync(files.major, "utf8")) as Partial<HeldMajor> | null;
    if (
      typeof parsed?.version !== "string" ||
      typeof parsed.at !== "string" ||
      (parsed.from !== null && typeof parsed.from !== "string") ||
      !Array.isArray(parsed.notes) ||
      !parsed.notes.every((note) => typeof note === "string")
    ) {
      return null;
    }
    return { at: parsed.at, from: parsed.from, notes: parsed.notes, version: parsed.version };
  } catch {
    return null;
  }
}

export function writeHeldMajor(files: UpdateFiles, held: HeldMajor): void {
  ensureDir(join(files.major, ".."));
  atomicWrite(files.major, `${JSON.stringify(held, null, 2)}\n`, 0o600);
}

/** Forgets the held major version: it was installed, or it is no longer the newest. */
export function clearHeldMajor(files: UpdateFiles): void {
  rmSync(files.major, { force: true });
}

/** A running Claude session, as the SessionStart hook recorded it. */
export interface SessionRecord {
  pid: number;
  /** When that process started (`processStartTime`), so a reused pid is not taken for it. */
  start: string;
  /** The plugin version the session loaded. */
  version: string;
}

function readSession(file: string): SessionRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SessionRecord> | null;
    if (
      typeof parsed?.pid !== "number" ||
      typeof parsed.start !== "string" ||
      typeof parsed.version !== "string"
    ) {
      return null;
    }
    return { pid: parsed.pid, start: parsed.start, version: parsed.version };
  } catch {
    return null;
  }
}

const SESSION_FILE = /^\d+\.json$/;

/** True while the recorded process runs: the same pid with the same start time. */
function isRunning(session: SessionRecord): boolean {
  return processStartTime(session.pid, session.start) === session.start;
}

/**
 * Records that the Claude session in process `pid` loaded `version`, and forgets every
 * session whose process is gone. Does nothing when the start time cannot be read.
 */
export function registerSession(files: UpdateFiles, pid: number, version: string): void {
  const start = processStartTime(pid);
  if (start === null) return;
  ensureDir(files.sessions);
  // Only `<pid>.json`: a temp file of another hook's atomic write is not a record.
  for (const name of readdirSync(files.sessions).filter((entry) => SESSION_FILE.test(entry))) {
    const file = join(files.sessions, name);
    const session = readSession(file);
    if (session === null || !isRunning(session)) rmSync(file, { force: true });
  }
  const record: SessionRecord = { pid, start, version };
  atomicWrite(join(files.sessions, `${pid}.json`), `${JSON.stringify(record)}\n`, 0o600);
}

/** The recorded sessions whose process still runs. */
export function runningSessions(files: UpdateFiles): SessionRecord[] {
  let names: string[];
  try {
    names = readdirSync(files.sessions);
  } catch {
    return [];
  }
  return names
    .filter((name) => SESSION_FILE.test(name))
    .map((name) => readSession(join(files.sessions, name)))
    .filter((session): session is SessionRecord => session !== null && isRunning(session));
}
