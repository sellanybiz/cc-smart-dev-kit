import { existsSync } from "node:fs";
import { openWorkDb, type WorkDb, workDbFile } from "./db";
import { claimLive } from "./identity";
import {
  allTasks,
  claimState,
  countedUnder,
  holdingUnder,
  isBlocked,
  isOpen,
  subtreeProgress,
} from "./queries";
import type { Who, WorkTask } from "./types";
export type ReadState<T> =
  | { state: "ready"; value: T }
  | { state: "none" }
  | { state: "unreadable"; why: string };
type Paths = { stateDir: string };
/**
 * Every read a hook, the board or the portal makes: never creates or migrates the store (a
 * missing one is `none`), never takes the write lock, and says a store it cannot read rather
 * than answer with an empty list.
 */
export function readWorkStore<T>(paths: Paths, body: (db: WorkDb) => T): ReadState<T> {
  let db: WorkDb | undefined;
  try {
    const file = workDbFile(paths);
    if (!existsSync(file)) return { state: "none" };
    db = openWorkDb(file, { mode: "hook" });
    return { state: "ready", value: body(db) };
  } catch (error) {
    return { state: "unreadable", why: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}
export function crewPhaseState(paths: Paths, project: string, crewId: string) {
  return readWorkStore(paths, (db) => {
    const tasks = allTasks(db, project);
    const phase = tasks.find((t) => t.kind === "phase" && t.crewId === crewId) ?? null;
    return {
      phase,
      // What holds the hand-back (D76): non-blocking work is noted, never waited for.
      openSubtasks: phase ? holdingUnder(tasks, phase.id) : [],
      // Only what counts: an earlier crew session's closed subtasks never meet this one's gates.
      total: phase ? countedUnder(tasks, phase.id).length : 0,
    };
  });
}
/** The phase the task sits in (itself when it is one), or null: a task there is its crew's work. */
function phaseOf(task: WorkTask, byId: ReadonlyMap<string, WorkTask>): WorkTask | null {
  const seen = new Set<string>();
  for (let t: WorkTask | undefined = task; t && !seen.has(t.id); t = byId.get(t.parentId ?? "")) {
    if (t.kind === "phase") return t;
    seen.add(t.id);
  }
  return null;
}
function inPhase(task: WorkTask, byId: ReadonlyMap<string, WorkTask>): boolean {
  return phaseOf(task, byId) !== null;
}
/**
 * A lead's own tasks: those its sessions made, in its plan when one is given, outside every phase.
 * A task it laid out inside a phase (D76) is that phase's work: the crew session that takes the
 * phase works it, and it never holds the lead.
 */
function own(db: WorkDb, project: string, sessionIds: string[], plan?: string) {
  const all = allTasks(db, project);
  const byId = new Map(all.map((t) => [t.id, t]));
  return all.filter(
    (t) =>
      t.kind === "task" &&
      t.createdBy !== null &&
      sessionIds.includes(t.createdBy) &&
      (!plan || t.plan === plan) &&
      !inPhase(t, byId),
  );
}
export function leadOwnState(paths: Paths, project: string, plan: string, sessionIds: string[]) {
  return readWorkStore(paths, (db) => {
    const tasks = own(db, project, sessionIds, plan);
    return {
      // Only blocking work holds a lead's stop (D76).
      inProgress: tasks.filter((t) => t.status === "in_progress" && t.type === "blocking"),
      total: tasks.length,
    };
  });
}
/**
 * What a session start shows: the project's open work outside every open crew phase (a phase
 * and its subtasks are the crew session's own, on the board), this process's claimed tasks first,
 * then those in progress, then the most recently touched. A task untouched since `staleBefore`
 * is left out and counted, unless it is this process's own: an old list must not bury the
 * work in hand.
 */
export function startView(
  paths: Paths,
  project: string,
  who: Who,
  options: { limit: number; staleBefore?: number },
) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const byId = new Map(all.map((t) => [t.id, t]));
    // An open phase's work is its crew session's; what a merge left open under a closed phase
    // (non-blocking work, D76) is anyone's now, so it shows.
    const open = all
      .filter((t) => {
        const phase = phaseOf(t, byId);
        return isOpen(t) && (phase === null || !isOpen(phase));
      })
      .map((t) => ({ task: t, claim: claimState(t, claimLive, who) }));
    const shown = open.filter(
      ({ task, claim }) =>
        claim === "mine" ||
        options.staleBefore === undefined ||
        task.updatedAt >= options.staleBefore,
    );
    shown.sort(
      (a, b) =>
        Number(b.claim === "mine") - Number(a.claim === "mine") ||
        Number(b.task.status === "in_progress") - Number(a.task.status === "in_progress") ||
        b.task.updatedAt - a.task.updatedAt ||
        a.task.number - b.task.number,
    );
    const limit = Math.max(0, Math.floor(options.limit));
    return {
      tasks: shown.slice(0, limit).map(({ task, claim }) => ({
        id: task.id,
        number: task.number,
        subject: task.subject,
        status: task.status,
        claim,
        type: task.type,
        blocked: isBlocked(task, byId),
      })),
      more: Math.max(0, shown.length - limit),
      stale: open.length - shown.length,
    };
  });
}
/** The board's one read: each crew session's phase progress, keyed `<project>:<crew id>`. */
export function phaseProgressByCrew(paths: Paths, projects: Iterable<string>) {
  return readWorkStore(paths, (db) => {
    const progress = new Map<string, { closed: number; total: number }>();
    for (const project of new Set(projects)) {
      const tasks = allTasks(db, project);
      for (const phase of tasks)
        if (phase.kind === "phase" && phase.crewId !== null)
          progress.set(`${project}:${phase.crewId}`, subtreeProgress(tasks, phase.id));
    }
    return progress;
  });
}
/**
 * One query for the status line: the claimed task (or crew phase) and its subtree's counts, by
 * `subtreeProgress`'s rule (closed is done or dropped; `countsToward` says what counts). `pass`
 * is the crew id of the nearest crew phase, handed down; `above` is the one a row is judged by.
 */
export function statusTask(paths: Paths, project: string, who: Who) {
  return readWorkStore(paths, (db) =>
    db.sqlite
      .query<
        {
          number: number;
          subject: string;
          closed: number;
          total: number;
        },
        [string, string | null, string | null, number | null, string | null]
      >(`
    WITH RECURSIVE chosen AS (
      SELECT id, number, subject, CASE WHEN kind = 'phase' THEN crew_id END AS pass
      FROM tasks WHERE project = ? AND
        ((? IS NOT NULL AND kind = 'phase' AND crew_id = ?) OR
         (kind = 'task' AND status = 'in_progress' AND claim_pid = ? AND claim_start = ?))
      ORDER BY CASE WHEN kind = 'phase' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
    ), tree AS (
      SELECT t.id, t.status, t.crew_id, c.pass AS above,
        CASE WHEN t.kind = 'phase' THEN t.crew_id ELSE c.pass END AS pass
        FROM tasks t JOIN chosen c ON t.parent_id = c.id
      UNION ALL SELECT t.id, t.status, t.crew_id, p.pass,
        CASE WHEN t.kind = 'phase' THEN t.crew_id ELSE p.pass END
        FROM tasks t JOIN tree p ON t.parent_id = p.id
    ), counted AS (
      SELECT status FROM tree WHERE above IS NULL OR status NOT IN ('done', 'dropped')
        OR crew_id IS NULL OR crew_id = above
    ) SELECT number, subject,
      (SELECT COUNT(*) FROM counted WHERE status IN ('done', 'dropped')) AS closed,
      (SELECT COUNT(*) FROM counted) AS total FROM chosen
  `)
      .get(project, who.crewId, who.crewId, who.pid, who.procStart),
  );
}

export function hasOwnTask(paths: Paths, project: string, sessionIds: string[]) {
  return readWorkStore(paths, (db) => own(db, project, sessionIds).some(isOpen));
}
