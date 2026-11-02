/**
 * The Claude sessions running on this machine, from Claude Code's own records:
 * `<config folder>/sessions/<pid>.json`, one per running session, with the folder it works
 * in (`cwd`, which follows it into a worktree), its id and its name (the one ListAgents
 * shows). Not a documented format: `docs/claude-code-contract.md` § Session records.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { readProcStat, type StatReader } from "../jobs/ancestry";

export interface SessionRecord {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  procStart?: string;
}

/** One record file's text, or null when it is not a record. */
export function parseSessionRecord(json: string): SessionRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { cwd, name, pid, sessionId, procStart } = value as Record<string, unknown>;
  if (typeof cwd !== "string" || typeof pid !== "number" || typeof sessionId !== "string") {
    return null;
  }
  return {
    pid,
    sessionId,
    cwd,
    name: typeof name === "string" ? name : sessionId.slice(0, 8),
    ...(typeof procStart === "string" ? { procStart } : {}),
  };
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // It exists, and belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The records of the running sessions. A record whose process is gone, or that was written
 * before the machine started (its pid may now be another program's), is skipped.
 *
 * On Linux, only a proved process-start mismatch skips a running record. An unproved
 * identity stays live: absence needs proof before adoption or cleanup.
 *
 * Throws when a RUNNING process's record cannot be read: then nobody can say where that
 * session works, and a caller that needs to know must not guess.
 */
export function liveSessions(
  claudeConfigDir: string,
  facts: {
    running?: (pid: number) => boolean;
    readStat?: StatReader;
    platform?: NodeJS.Platform;
  } = {},
): SessionRecord[] {
  const dir = join(claudeConfigDir, "sessions");
  if (!existsSync(dir)) return [];
  const bootedAt = Date.now() - uptime() * 1000;
  const live: SessionRecord[] = [];
  for (const file of readdirSync(dir)) {
    const pid = Number(file.replace(/\.json$/, ""));
    if (!file.endsWith(".json") || !Number.isInteger(pid) || !(facts.running ?? isRunning)(pid))
      continue;
    let text: string;
    try {
      if (statSync(join(dir, file)).mtimeMs < bootedAt) continue;
      text = readFileSync(join(dir, file), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`the record of running session ${pid} cannot be read; retry`);
    }
    const record = parseSessionRecord(text);
    if (record === null) {
      throw new Error(
        `the record of running session ${pid} in ${dir} cannot be read, so it is unknown where it works`,
      );
    }
    if ((facts.platform ?? process.platform) === "linux" && record.procStart !== undefined) {
      const stat = (facts.readStat ?? readProcStat)(pid);
      const end = stat?.lastIndexOf(")") ?? -1;
      const start =
        end < 0
          ? undefined
          : stat
              ?.slice(end + 1)
              .trim()
              .split(/\s+/)[19];
      // Only a proved mismatch establishes pid reuse. An unproved identity stays live.
      if (start !== undefined && /^\d+$/.test(start) && record.procStart !== start) continue;
    }
    live.push(record);
  }
  return live;
}
