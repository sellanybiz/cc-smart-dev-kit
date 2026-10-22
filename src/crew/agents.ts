/**
 * Agent view (`claude agents --json --all`) as the crew session commands read it: the rows, and the one
 * that is a crew session's Claude session. The watch reads it every pass; `crew answer` reads it once, to
 * know whether a crew session the store calls stopped is in fact still alive.
 */
import { type AgentRow, type ClaudeDeps, callClaude, findClaude, parseAgents } from "./claude";
import type { CrewContext } from "./context";
import type { CrewRecord } from "./store";

/** What `claude` needs to run here. */
export function claudeDeps(ctx: CrewContext): ClaudeDeps {
  return {
    env: ctx.env,
    home: ctx.paths.home,
    platform: ctx.platform,
    runProgram: ctx.runProgram,
    which: ctx.which,
  };
}

/** The agent view of this machine, or null when it cannot be read. */
export function agentRows(ctx: CrewContext): null | AgentRow[] {
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (claude === null) return null;
  const called = callClaude(claudeDeps(ctx), claude, ["agents", "--json", "--all"], ctx.cwd);
  if (!called.ok || called.run.exitCode !== 0) return null;
  return parseAgents(called.run.stdout);
}

/** The row of agent view for the session `record`, or null when it is not listed. */
export function rowOf(rows: readonly AgentRow[], record: CrewRecord): null | AgentRow {
  if (record.shortId !== null) {
    const byShort = rows.find((row) => row.id === record.shortId);
    if (byShort !== undefined) return byShort;
  }
  if (record.sessionId !== null) {
    const bySession = rows.find((row) => row.sessionId === record.sessionId);
    if (bySession !== undefined) return bySession;
  }
  return null;
}

/**
 * True when the row says the session has a process and is not stopped or failed: a message
 * reaches it, and `claude --bg --resume` would start a copy beside it (`claude --help`: "starts
 * a copy and says so when the session is already running"). Agent view lists a session that
 * ended without a process too (no `pid`), and that one is resumed.
 */
export function isLiveRow(row: null | AgentRow): boolean {
  return row !== null && row.pid !== null && row.state !== "stopped" && row.state !== "failed";
}
