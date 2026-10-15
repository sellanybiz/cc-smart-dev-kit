/**
 * The background self-update's files, all in the state folder (`<stateDir>`, by default
 * `~/.claude/anymodel/`):
 *
 *   update-hold         while it exists, the SessionStart hook checks nothing
 *   update-check.json   the last check: when, its result, and the detail
 *   update-reported     the time of the failed check a session was already told about
 *   update.log          one line per step of each check, newest last, kept small
 *   update/lock         held by the one check or update that runs (`withLock`)
 *   sessions/<pid>.json the plugin version each running Claude session loaded
 *
 * None of them is a user's file: they are anymodel's own state, like the lock and the
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
import { processStartTime } from "../setup/lock";
import { atomicWrite } from "../setup/write";

/** At most one check an hour per config folder. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The log is cut back to its newer half once it is bigger than this. */
export const LOG_MAX_BYTES = 256 * 1024;

export interface UpdateFiles {
  hold: string;
  check: string;
  reported: string;
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
  /** Nothing to check here (no install, no marketplace): not a failure. */
  | "skipped"
  | "failed";

export interface LastCheck {
  /** When the check started, ISO 8601 in UTC. */
  at: string;
  result: CheckResult;
  /** In words: the version found, or why it failed. Never a URL with credentials. */
  detail: string;
}

const RESULTS: readonly CheckResult[] = ["checking", "up-to-date", "updated", "skipped", "failed"];

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
    return { at: parsed.at, detail: parsed.detail, result: parsed.result as CheckResult };
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

/** Holds background updates; false when they were held already. */
export function hold(files: UpdateFiles, nowMs: number): boolean {
  if (isHeld(files)) return false;
  ensureDir(join(files.hold, ".."));
  atomicWrite(files.hold, `${isoSeconds(nowMs)}\n`, 0o600);
  return true;
}

/** Resumes background updates; false when they were not held. */
export function resume(files: UpdateFiles): boolean {
  if (!isHeld(files)) return false;
  rmSync(files.hold, { force: true });
  return true;
}

/** A time as ISO 8601 in UTC, to the second: `2026-10-15T10:00:00Z`. */
export function isoSeconds(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** Appends one line to the update log; cuts it back to its newer half when it grew too big. */
export function appendLog(files: UpdateFiles, line: string, nowMs: number): void {
  ensureDir(join(files.log, ".."));
  try {
    if (statSync(files.log).size > LOG_MAX_BYTES) {
      const text = readFileSync(files.log, "utf8");
      const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
      writeFileSync(files.log, keep.slice(keep.indexOf("\n") + 1), { mode: 0o600 });
    }
  } catch {
    // No log yet.
  }
  appendFileSync(files.log, `${isoSeconds(nowMs)} ${line}\n`, { mode: 0o600 });
}

/** True when the failed check at `at` was already shown to a session. */
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
