/**
 * The Claude sessions running on this machine, from Claude Code's own records:
 * `<config folder>/sessions/<pid>.json`, one per running session, with the folder it works
 * in (`cwd`, which follows it into a worktree), its id and its name (the one ListAgents
 * shows). Not a documented format: `docs/claude-code-contract.md` § Session records.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";

export interface SessionRecord {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
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
  const { cwd, name, pid, sessionId } = value as Record<string, unknown>;
  if (typeof cwd !== "string" || typeof pid !== "number" || typeof sessionId !== "string") {
    return null;
  }
  return { pid, sessionId, cwd, name: typeof name === "string" ? name : sessionId.slice(0, 8) };
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
 * Throws when a RUNNING process's record cannot be read: then nobody can say where that
 * session works, and a caller that needs to know must not guess.
 */
export function liveSessions(claudeConfigDir: string): SessionRecord[] {
  const dir = join(claudeConfigDir, "sessions");
  if (!existsSync(dir)) return [];
  const bootedAt = Date.now() - uptime() * 1000;
  const live: SessionRecord[] = [];
  for (const file of readdirSync(dir)) {
    const pid = Number(file.replace(/\.json$/, ""));
    if (!file.endsWith(".json") || !Number.isInteger(pid) || !isRunning(pid)) continue;
    let text: string;
    try {
      if (statSync(join(dir, file)).mtimeMs < bootedAt) continue;
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      // Removed by its session between the listing and the read: it has ended.
      continue;
    }
    const record = parseSessionRecord(text);
    if (record === null) {
      throw new Error(
        `the record of running session ${pid} in ${dir} cannot be read, so it is unknown where it works`,
      );
    }
    live.push(record);
  }
  return live;
}
