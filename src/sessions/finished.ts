/**
 * Finished background sessions: one reader for the command and the portal, never an automatic
 * removal. Beside them, what removed crew sessions left in `/resume` (`readCrewLeftovers`, AR1).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CliPaths } from "../cli/paths";
import {
  ARCHIVED_STATES,
  archiveDaysOf,
  conversationOf,
  type PrunedArchive,
  pruneCrewArchives,
  sessionsNeverTaken,
} from "../crew/archive";
import { type ClaudeDeps, callClaude, findClaude, realRunProgram } from "../crew/claude";
import type { Env } from "../crew/context";
import { CREW_ROLE, LEAD_ROLE } from "../crew/names";
import { type CrewRecord, listAllCrew, listAllLeads } from "../crew/store";
import { liveSessions } from "../hooks/sessions";
import { isSessionId } from "./saved-sessions";

/** A finished session is offered only after a full day in a terminal state. */
export const FINISHED_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

// 2.1.310 agents --json --all has startedAt, but no end time. jobs/<id>/state.json
// has lastTerminalAt and updatedAt (ISO times). Never use the launch time as its age.
const agentSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}$/),
  sessionId: z.string().min(1),
  name: z.string().nullable().optional(),
  cwd: z.string().min(1),
  kind: z.string(),
  state: z.string(),
  status: z.string().nullable().optional(),
  waitingFor: z.string().nullable().optional(),
});
export type SessionAgentRow = z.infer<typeof agentSchema>;
const terminalSchema = z.object({
  sessionId: z.string(),
  state: z.enum(["done", "stopped"]),
  updatedAt: z.iso.datetime(),
  lastTerminalAt: z.iso.datetime(),
});

export interface FinishedSession {
  id: string;
  sessionId: string;
  name: string;
  folder: string;
  state: "done" | "stopped";
  finishedAt: number;
  ageMs: number;
}
export interface FinishedSessionsResult {
  sessions: FinishedSession[];
  error: string | null;
}

/** Pure selection. Unknown kinds, active/waiting states, roles and timestamps stay out. */
export function finishedSessions(
  rows: readonly SessionAgentRow[],
  excluded: ReadonlySet<string>,
  terminalAt: (row: SessionAgentRow) => number | null,
  now: number,
): FinishedSession[] {
  const sessions: FinishedSession[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      row.kind !== "background" ||
      (row.state !== "done" && row.state !== "stopped") ||
      row.status === "waiting" ||
      row.status === "blocked" ||
      row.status === "working" ||
      row.waitingFor ||
      excluded.has(row.sessionId) ||
      excluded.has(row.id) ||
      (row.name != null &&
        [LEAD_ROLE, CREW_ROLE].includes(row.name.trim().split(/\s+/)[0] ?? "")) ||
      seen.has(row.sessionId)
    )
      continue;
    const at = terminalAt(row);
    if (at === null || !Number.isFinite(at) || now - at <= FINISHED_SESSION_AGE_MS) continue;
    seen.add(row.sessionId);
    sessions.push({
      id: row.id,
      sessionId: row.sessionId,
      name: row.name ?? row.id,
      folder: row.cwd,
      state: row.state,
      finishedAt: at,
      ageMs: now - at,
    });
  }
  return sessions.sort((a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id));
}

/** The agent view preserves only fields this reader needs. A bad row is never a candidate. */
export function sessionAgentRows(output: string): SessionAgentRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((row) => {
    const value = agentSchema.safeParse(row);
    return value.success ? [value.data] : [];
  });
}

/** A matched terminal record is the evidence of when this session finished. */
export function sessionTerminalAt(paths: CliPaths, row: SessionAgentRow): number | null {
  if (!/^[0-9a-f]{8}$/.test(row.id)) return null;
  try {
    const parsed = terminalSchema.safeParse(
      JSON.parse(readFileSync(join(paths.claudeConfigDir, "jobs", row.id, "state.json"), "utf8")),
    );
    if (
      !parsed.success ||
      parsed.data.sessionId !== row.sessionId ||
      parsed.data.state !== row.state
    )
      return null;
    return Math.max(Date.parse(parsed.data.lastTerminalAt), Date.parse(parsed.data.updatedAt));
  } catch {
    return null;
  } // Missing or unreadable end time is not proof of a day finished.
}

export interface FinishedSessionsDeps {
  now: number;
  agents: () => SessionAgentRow[] | null;
}

/** Read-only machine-wide view. A damaged crew/lead store fails closed, including for the portal. */
export function readFinishedSessions(
  paths: CliPaths,
  deps: FinishedSessionsDeps,
): FinishedSessionsResult {
  try {
    const crew = listAllCrew(paths.stateDir);
    const leads = listAllLeads(paths.stateDir);
    if (crew.broken.length || leads.broken.length)
      return {
        sessions: [],
        error:
          "Could not read every crew and lead record; repair the crew store before removing sessions.",
      };
    const excluded = new Set<string>();
    for (const record of crew.records) {
      if (record.sessionId !== null) excluded.add(record.sessionId);
      if (record.shortId !== null) excluded.add(record.shortId);
      excluded.add(record.leadSessionId);
    }
    for (const lead of leads.records) excluded.add(lead.sessionId);
    const rows = deps.agents();
    if (rows === null)
      return {
        sessions: [],
        error: "Could not read Claude Code's agent list; check claude agents --json --all.",
      };
    return {
      sessions: finishedSessions(rows, excluded, (row) => sessionTerminalAt(paths, row), deps.now),
      error: null,
    };
  } catch (error) {
    return {
      sessions: [],
      error: `Could not read finished sessions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** A removed crew session whose conversation is still in Claude Code's projects folder. */
export interface LeftConversation {
  record: CrewRecord;
  /** Its files there: the transcript, its subagents' and its tool results. */
  files: number;
  projectDir: string;
}

/**
 * What the crew sessions the kit removed left in `/resume` (AR1), and the archives past their
 * days: what `sessions --finished` lists and `--remove` moves. Machine-wide, like the list of
 * finished sessions.
 */
export interface CrewLeftovers {
  conversations: LeftConversation[];
  /** The empty project folders of removed crew sessions' worktrees. */
  emptyFolders: string[];
  /** A removed crew session's conversation that stays, and why. */
  kept: Array<{ record: CrewRecord; why: string }>;
  /** The archives past their `crew.archiveDays`. */
  expired: PrunedArchive[];
  error: string | null;
}

/** Whether `folder` is a folder with nothing in it. */
function emptyFolder(folder: string): boolean {
  try {
    return statSync(folder).isDirectory() && readdirSync(folder).length === 0;
  } catch {
    return false;
  }
}

/**
 * Reads what removed crew sessions left: only records the store marks removed or discarded,
 * never a lead's session, one a record still on the board names, or one a running Claude holds;
 * a conversation written after its record was removed was resumed by the person since, and is
 * theirs. A store or a session record it cannot read fails closed: nothing is listed, so
 * nothing moves.
 */
export function readCrewLeftovers(paths: CliPaths, deps: { env: Env; now: number }): CrewLeftovers {
  const none = (error: string): CrewLeftovers => ({
    conversations: [],
    emptyFolders: [],
    error,
    expired: [],
    kept: [],
  });
  try {
    const crew = listAllCrew(paths.stateDir);
    if (crew.broken.length > 0)
      return none("Could not read every crew record; repair the crew store before moving them.");
    const neverTaken = sessionsNeverTaken(paths.stateDir, null);
    const running = new Set(liveSessions(paths.claudeConfigDir).map((one) => one.sessionId));
    const out = none("");
    out.error = null;
    for (const record of crew.records) {
      if (!ARCHIVED_STATES.includes(record.state) || record.sessionId === null) continue;
      if (!isSessionId(record.sessionId) || neverTaken.has(record.sessionId)) continue;
      const found = conversationOf(paths.projectsDir, record.worktree, record.sessionId);
      if (found.files.length === 0) {
        if (emptyFolder(found.projectDir) && !out.emptyFolders.includes(found.projectDir))
          out.emptyFolders.push(found.projectDir);
        continue;
      }
      if (running.has(record.sessionId)) {
        out.kept.push({ record, why: "a running Claude session holds it" });
        continue;
      }
      const removedAt = Date.parse(record.updatedAt);
      const newest = Math.max(
        ...found.files.map((file) => statSync(join(found.projectDir, file)).mtimeMs),
      );
      if (newest > removedAt) {
        out.kept.push({ record, why: "it was written after its crew session was removed" });
        continue;
      }
      out.conversations.push({
        files: found.files.length,
        projectDir: found.projectDir,
        record,
      });
    }
    out.expired = pruneCrewArchives(
      paths.stateDir,
      archiveDaysOf(paths, deps.env),
      deps.now,
      true,
    ).pruned;
    return out;
  } catch (error) {
    return none(
      `Could not read what removed crew sessions left: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Reuses the cross-platform Claude runner (including native Windows .cmd quoting). */
export function readSessionAgents(context: ClaudeDeps, cwd: string): SessionAgentRow[] | null {
  const binary = findClaude(context);
  if (binary === null) return null;
  const called = callClaude(context, binary, ["agents", "--json", "--all"], cwd);
  return called.ok && called.run.exitCode === 0 && !called.run.timedOut
    ? sessionAgentRows(called.run.stdout)
    : null;
}

export function sessionsClaudeDeps(
  paths: CliPaths,
  platform: NodeJS.Platform,
  which: ClaudeDeps["which"],
): ClaudeDeps {
  return { env: process.env, home: paths.home, platform, which, runProgram: realRunProgram };
}
