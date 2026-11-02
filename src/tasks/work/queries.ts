import type { WorkDb } from "./db";
import type {
  Who,
  WorkClaim,
  WorkEvent,
  WorkEventAction,
  WorkKind,
  WorkNote,
  WorkStatus,
  WorkTask,
  WorkTree,
} from "./types";

interface TaskRow {
  id: string;
  number: number;
  project: string;
  parent_id: string | null;
  kind: WorkKind;
  subject: string;
  description: string;
  status: WorkStatus;
  plan: string | null;
  phase: string | null;
  crew_id: string | null;
  created_by: string | null;
  claim_pid: number | null;
  claim_start: string | null;
  claim_session: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}
export function allTasks(db: WorkDb, project: string): WorkTask[] {
  const dependencies = new Map<string, string[]>();
  for (const row of db.sqlite
    .query<{ task_id: string; waits_for: string }, [string]>(
      "SELECT d.task_id,d.waits_for FROM task_deps d JOIN tasks t ON t.id=d.task_id WHERE t.project=? ORDER BY d.waits_for",
    )
    .all(project)) {
    const refs = dependencies.get(row.task_id) ?? [];
    refs.push(row.waits_for);
    dependencies.set(row.task_id, refs);
  }
  return db.sqlite
    .query<TaskRow, [string]>("SELECT * FROM tasks WHERE project=? ORDER BY number")
    .all(project)
    .map((row) => ({
      id: row.id,
      number: row.number,
      project: row.project,
      parentId: row.parent_id,
      kind: row.kind,
      subject: row.subject,
      description: row.description,
      status: row.status,
      plan: row.plan,
      phase: row.phase,
      crewId: row.crew_id,
      createdBy: row.created_by,
      claim:
        row.claim_pid === null
          ? null
          : { pid: row.claim_pid, procStart: row.claim_start, sessionId: row.claim_session },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      waitsFor: dependencies.get(row.id) ?? [],
    }));
}
export function getTask(db: WorkDb, project: string, ref: string): WorkTask | null {
  const number = /^#?\d+$/.test(ref) ? Number(ref.replace(/^#/, "")) : null;
  return (
    allTasks(db, project).find((t) => (number === null ? t.id === ref : t.number === number)) ??
    null
  );
}
export function taskById(db: WorkDb, id: string): WorkTask {
  const row = db.sqlite
    .query<{ project: string }, [string]>("SELECT project FROM tasks WHERE id=?")
    .get(id);
  if (!row) throw new Error("task not found");
  const task = getTask(db, row.project, id);
  if (!task) throw new Error("task not found");
  return task;
}
export function isOpen(task: WorkTask): boolean {
  return task.status === "pending" || task.status === "in_progress";
}
/** All descendants, not just direct children: completion must not strand an open grandchild. */
export function descendants(db: WorkDb, id: string): WorkTask[] {
  const task = taskById(db, id);
  return descendantsIn(allTasks(db, task.project), id);
}
/**
 * How far a task is: the tasks under it, at every depth, that are closed (done or dropped), of
 * all of them. The one rule the status line, the board, `task_list` and the portal count by: a
 * parent may be done once each is done or dropped, so a dropped one is finished with too.
 */
export function subtreeProgress(
  tasks: readonly WorkTask[],
  id: string,
): { closed: number; total: number } {
  const under = descendantsIn(tasks, id);
  return { closed: under.filter((t) => !isOpen(t)).length, total: under.length };
}
/** `descendants`, over a project's tasks already read. */
function descendantsIn(tasks: readonly WorkTask[], id: string): WorkTask[] {
  const ids = new Set([id]);
  const result: WorkTask[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const t of tasks)
      if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id);
        result.push(t);
        added = true;
      }
  }
  return result;
}
export function openSubtasks(db: WorkDb, id: string): WorkTask[] {
  return descendants(db, id)
    .filter(isOpen)
    .sort(
      (a, b) =>
        Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
        a.number - b.number,
    );
}
export interface ListOptions {
  project: string;
  root?: string;
  plan?: string;
  crewId?: string;
  /** The Claude process whose claims count as "mine" (never a session id: `/clear` keeps them). */
  claimedBy?: { pid: number; procStart: string | null };
  openOnly: boolean;
}
export function listTasks(db: WorkDb, options: ListOptions): WorkTree[] {
  const all = allTasks(db, options.project);
  const root = options.root ? getTask(db, options.project, options.root) : null;
  const allowed = root ? new Set([root.id, ...descendants(db, root.id).map((t) => t.id)]) : null;
  const nodes = all
    .filter(
      (t) =>
        (!allowed || allowed.has(t.id)) &&
        (!options.root || root !== null) &&
        (!options.plan || t.plan === options.plan) &&
        (!options.crewId || t.crewId === options.crewId) &&
        (!options.claimedBy ||
          (t.claim?.pid === options.claimedBy.pid &&
            t.claim.procStart === options.claimedBy.procStart)) &&
        (!options.openOnly || isOpen(t)),
    )
    .map((t) => ({ ...t, children: [] as WorkTree[] }));
  const byId = new Map(nodes.map((t) => [t.id, t]));
  const roots: WorkTree[] = [];
  for (const t of nodes) {
    const parent = t.parentId ? byId.get(t.parentId) : null;
    if (parent) parent.children.push(t);
    else roots.push(t);
  }
  return roots;
}
export function searchTasks(db: WorkDb, project: string, text: string): WorkTask[] {
  const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const ids = new Set(
    db.sqlite
      .query<{ id: string }, [string, string, string, string]>(
        "SELECT DISTINCT t.id FROM tasks t LEFT JOIN task_notes n ON n.task_id=t.id WHERE t.project=? AND (t.subject LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR n.text LIKE ? ESCAPE '\\')",
      )
      .all(project, pattern, pattern, pattern)
      .map((r) => r.id),
  );
  return allTasks(db, project).filter((t) => ids.has(t.id));
}
export function notesOf(db: WorkDb, task: string | WorkTask): WorkNote[] {
  return db.sqlite
    .query<WorkNote, [string]>(
      "SELECT id, task_id AS taskId,text,session_id AS sessionId,crew_id AS crewId,at FROM task_notes WHERE task_id=? ORDER BY id",
    )
    .all(typeof task === "string" ? task : task.id);
}
interface EventRow {
  id: number;
  task_id: string;
  number: number;
  at: number;
  action: WorkEventAction;
  changes: string;
  session_id: string | null;
  session_name: string | null;
  crew_id: string | null;
  pid: number | null;
  reason: string | null;
}
/** A task's history, oldest first: what each change did, when, and who made it. */
export function eventsOf(db: WorkDb, task: string | WorkTask): WorkEvent[] {
  return db.sqlite
    .query<EventRow, [string]>("SELECT * FROM task_events WHERE task_id=? ORDER BY id")
    .all(typeof task === "string" ? task : task.id)
    .map((row) => ({
      id: row.id,
      taskId: row.task_id,
      number: row.number,
      at: row.at,
      action: row.action,
      changes: JSON.parse(row.changes) as WorkEvent["changes"],
      sessionId: row.session_id,
      sessionName: row.session_name,
      crewId: row.crew_id,
      pid: row.pid,
      reason: row.reason,
    }));
}
export function claimState(
  task: WorkTask,
  isLive: (claim: WorkClaim) => boolean,
  who?: Who,
): "mine" | "another session" | "free" {
  if (!task.claim || !isLive(task.claim)) return "free";
  // The claim belongs to the Claude process, not its session id: `/clear` and a resume keep the
  // process, so its own tasks stay its own. The session id on the claim is provenance only.
  return who?.pid === task.claim.pid && who.procStart === task.claim.procStart
    ? "mine"
    : "another session";
}
