import { cliPaths } from "../../cli/paths";
import {
  isRunning,
  processStart,
  sessionIdentityProved,
  sessionRecordOf,
} from "../../hooks/sessions";
import {
  ancestorPids,
  type ParentReader,
  readProcStat,
  type StatReader,
} from "../../jobs/ancestry";
import { type RunningProgram, runningPrograms } from "../../worktrees/machine-facts";
import type { ClaimProcess, Who, WorkClaim } from "./types";

/**
 * The parent of a process off Linux, from one listing of the running processes, made on the
 * first question (`runningPrograms`); a listing that fails answers null for every pid. Linux
 * reads `/proc` instead (`ancestorPids`).
 */
function listedParentOf(platform: NodeJS.Platform): ParentReader {
  let listed: Map<number, RunningProgram> | null = null;
  return (pid) => {
    if (listed === null) {
      const found = runningPrograms(platform);
      listed = new Map(found === "unknown" ? [] : found.map((one) => [one.pid, one]));
    }
    return listed.get(pid)?.parentPid ?? null;
  };
}

export interface ClaimFacts {
  platform?: NodeJS.Platform;
  readStat?: StatReader;
  running?: (pid: number) => boolean;
}

/**
 * Whether a claim's Claude process still runs: the one test the server, the command and the
 * hooks use. On Linux the process's start time must match, so a reused pid is not the claimer;
 * elsewhere the pid alone answers, the same evidence `callerOf` had when the claim was made.
 */
export function claimLive(claim: WorkClaim, facts: ClaimFacts = {}): boolean {
  const platform = facts.platform ?? process.platform;
  if (platform !== "linux") return (facts.running ?? isRunning)(claim.pid);
  return (
    claim.procStart !== null &&
    sessionIdentityProved(
      {
        pid: claim.pid,
        procStart: claim.procStart,
        sessionId: claim.sessionId ?? "",
        cwd: "",
        name: "",
      },
      { platform, ...(facts.readStat ? { readStat: facts.readStat } : {}) },
    )
  );
}
/**
 * Whether a claim's Claude process is proved to have ended: its pid no longer runs, or on Linux
 * the pid now has another start time (a reused pid). A running pid whose start time cannot be
 * compared (none on the claim, or `/proc` unreadable) is not gone: only a proved end lets a
 * resumed session move the claim (`resumedClaim`), so two live processes of one conversation
 * never pass a claim back and forth.
 */
export function claimGone(claim: WorkClaim, facts: ClaimFacts = {}): boolean {
  if (!(facts.running ?? isRunning)(claim.pid)) return true;
  const platform = facts.platform ?? process.platform;
  if (platform !== "linux" || claim.procStart === null) return false;
  const start = processStart(claim.pid, {
    platform,
    ...(facts.readStat ? { readStat: facts.readStat } : {}),
  });
  return start !== undefined && start !== claim.procStart;
}
/** The machine's own answers to both questions about a claim's process. */
export const CLAIM_PROCESS: ClaimProcess = {
  live: (claim) => claimLive(claim),
  gone: (claim) => claimGone(claim),
};
export interface CallerFacts {
  claudeConfigDir?: string;
  env?: Record<string, string | undefined>;
  pid?: number;
  ppid?: number;
  cwd?: string;
  platform?: NodeJS.Platform;
  readStat?: StatReader;
  parentOf?: ParentReader;
  running?: (pid: number) => boolean;
}
/** Keep only process identity in the cache; a session record is never cached. */
const cached = new Map<string, { pid: number; procStart: string | null }>();
export function callerOf(
  facts: CallerFacts = {},
): (Who & { cwd: string; name: string | null }) | null {
  const env = facts.env ?? process.env;
  const platform = facts.platform ?? process.platform;
  const pid = facts.pid ?? process.pid;
  const readStat = facts.readStat ?? readProcStat;
  const config = facts.claudeConfigDir ?? cliPaths(env).claudeConfigDir;
  const cacheKey = `${config}:${pid}:${platform}`;
  // Only the caller's own record is read, never every running session's: an unrelated session's
  // record, unreadable at this moment, must not blank the caller's rows. The caller's own
  // unreadable record still throws.
  const recordOf = (p: number) =>
    sessionRecordOf(config, p, {
      readStat,
      platform,
      ...(facts.running ? { running: facts.running } : {}),
    });
  const previous = cached.get(cacheKey);
  const remembered = previous ? recordOf(previous.pid) : null;
  let record =
    remembered !== null && (remembered.procStart ?? null) === previous?.procStart
      ? remembered
      : null;
  if (!record) {
    const parent = facts.ppid ?? process.ppid;
    const grandparent =
      platform === "linux" ? null : (facts.parentOf ?? listedParentOf(platform))(parent);
    const pids =
      platform === "linux"
        ? ancestorPids(pid, readStat)
        : [parent, ...(grandparent ? [grandparent] : [])];
    for (const p of pids) {
      record = recordOf(p);
      if (record !== null) break;
    }
  }
  if (record) {
    cached.set(cacheKey, { pid: record.pid, procStart: record.procStart ?? null });
    return {
      sessionId: record.sessionId,
      pid: record.pid,
      procStart: record.procStart ?? null,
      cwd: record.cwd,
      name: record.name,
    };
  }
  cached.delete(cacheKey);
  const sessionId = env.CLAUDE_CODE_SESSION_ID?.trim();
  return sessionId
    ? {
        sessionId,
        pid: null,
        procStart: null,
        cwd: facts.cwd ?? process.cwd(),
        name: null,
      }
    : null;
}
