import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { processStartTime } from "../setup/lock";

/** One deadline for explicit removal, including waiting for another clean. */
export const REMOVAL_TIMEOUT_MS = 10 * 60_000;

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

/** /proc comm may contain spaces and parentheses; fields resume after its last `)`. */
export function parentPidFromStat(stat: string): number | null {
  const end = stat.lastIndexOf(")");
  if (end < 0) return null;
  const fields = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const raw = fields[1];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function parentOf(pid: number): number | null {
  try {
    return parentPidFromStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    // An exited or unreadable process gives no ownership proof.
    return null;
  }
}

/** Call only in the initial Linux pid namespace, and only for explicit removal. */
export function ownsClaudeLock(
  lock: ClaudeLock,
  callerPid: number,
  parent: (pid: number) => number | null,
  startTime: typeof processStartTime,
): boolean {
  if (lock.start === null || !/^\d+$/.test(lock.start)) return false;
  const seen = new Set<number>();
  let pid: number | null = callerPid;
  while (pid !== null && !seen.has(pid)) {
    seen.add(pid);
    if (pid === lock.pid) {
      const expected = `proc:${lock.start}`;
      return startTime(pid, expected) === expected;
    }
    pid = parent(pid);
  }
  return false;
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
