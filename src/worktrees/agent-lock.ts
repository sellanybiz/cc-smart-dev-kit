import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { ancestorsBy, type ParentReader, parentPidFromStat, readProcStat } from "../jobs/ancestry";
import type { processStartTime } from "../setup/lock";

export interface ClaudeLock {
  kind: "agent" | "session";
  name: string;
  pid: number;
  start: string | null;
}

/** Claude Code's lock grammar, including locks whose start lookup timed out. */
export function parseClaudeLock(reason: string): ClaudeLock | null {
  const match = /^claude (agent|session) (.{1,255}) \(pid (\d{1,10})(?: start (.{1,255}))?\)$/.exec(
    reason,
  );
  if (match === null) return null;
  const pid = Number(match[3]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const kind = match[1];
  const name = match[2];
  if ((kind !== "agent" && kind !== "session") || name === undefined) return null;
  return { kind, name, pid, start: match[4] ?? null };
}

export const parentOf: ParentReader = (pid) => {
  const stat = readProcStat(pid);
  return stat === null ? null : parentPidFromStat(stat);
};

/** Call only in the initial Linux pid namespace, and only for explicit removal. */
export function ownsClaudeLock(
  lock: ClaudeLock,
  callerPid: number,
  parent: ParentReader,
  startTime: typeof processStartTime,
): boolean {
  if (lock.start === null || !/^\d+$/.test(lock.start)) return false;
  if (![callerPid, ...ancestorsBy(callerPid, parent)].includes(lock.pid)) return false;
  const expected = `proc:${lock.start}`;
  return startTime(lock.pid, expected) === expected;
}

/**
 * Claude Code writes finished at completion and clears it before revival. Only that marker
 * and its worktree path are used; task text and other fields never leave this reader.
 */
export function agentFinished(
  agentId: string,
  worktreePath: string,
  claudeConfigDir?: string,
): boolean {
  if (claudeConfigDir === undefined || !/^[A-Za-z0-9_-]+$/.test(agentId)) return false;
  try {
    const target = realpathSync(worktreePath);
    const projects = join(claudeConfigDir, "projects");
    let found = false;
    for (const project of readdirSync(projects, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const folder = join(projects, project.name);
      for (const session of readdirSync(folder, { withFileTypes: true })) {
        if (!session.isDirectory()) continue;
        const file = join(folder, session.name, "subagents", `agent-${agentId}.meta.json`);
        let text: string;
        try {
          text = readFileSync(file, "utf8");
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
          return false;
        }
        const parsed: unknown = JSON.parse(text);
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          !("finished" in parsed) ||
          parsed.finished !== true ||
          !("worktreePath" in parsed) ||
          typeof parsed.worktreePath !== "string" ||
          realpathSync(parsed.worktreePath) !== target
        )
          return false;
        found = true;
      }
    }
    return found;
  } catch {
    // Missing, unreadable, malformed or ambiguous evidence never releases a builder.
    return false;
  }
}
