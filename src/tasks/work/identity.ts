import { cliPaths } from "../../cli/paths";
import { crewIdOf, realProcessFacts } from "../../crew/session";
import { liveSessions } from "../../hooks/sessions";
import {
  ancestorPids,
  type ParentReader,
  readProcStat,
  type StatReader,
} from "../../jobs/ancestry";
import type { Who } from "./types";
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
  const records = liveSessions(config, {
    readStat,
    platform,
    ...(facts.running ? { running: facts.running } : {}),
  });
  const previous = cached.get(cacheKey);
  const live = previous
    ? records.find((r) => r.pid === previous.pid && (r.procStart ?? null) === previous.procStart)
    : null;
  let record = live;
  if (!record) {
    const parent = facts.ppid ?? process.ppid;
    const grandparent =
      platform === "linux" ? null : (facts.parentOf ?? realProcessFacts(platform).parentOf)(parent);
    const pids =
      platform === "linux"
        ? ancestorPids(pid, readStat)
        : [parent, ...(grandparent ? [grandparent] : [])];
    record = pids.map((p) => records.find((r) => r.pid === p)).find((r) => r !== undefined);
  }
  if (record) {
    cached.set(cacheKey, { pid: record.pid, procStart: record.procStart ?? null });
    return {
      sessionId: record.sessionId,
      crewId: crewIdOf(env),
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
        crewId: crewIdOf(env),
        pid: null,
        procStart: null,
        cwd: facts.cwd ?? process.cwd(),
        name: null,
      }
    : null;
}
