import type { WorkDb } from "./db";
import type {
  Who,
  WorkClaim,
  WorkEvent,
  WorkEventAction,
  WorkKind,
  WorkLayer,
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
  agent?: string | null;
  branch?: string | null;
  worktree?: string | null;
  base?: string | null;
  created_by: string | null;
  claim_pid: number | null;
  claim_start: string | null;
  claim_session: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  /** Absent in a store a hook reads before a writer moved it to schema 2. */
  blocking?: number;
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
      agent: row.agent ?? null,
      branch: row.branch ?? null,
      worktree: row.worktree ?? null,
      base: row.base ?? null,
      createdBy: row.created_by,
      claim:
        row.claim_pid === null
          ? null
          : { pid: row.claim_pid, procStart: row.claim_start, sessionId: row.claim_session },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      waitsFor: dependencies.get(row.id) ?? [],
      type: row.blocking === 0 ? "non-blocking" : "blocking",
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
/** Every descendant counts toward progress. */
export function countedUnder(tasks: readonly WorkTask[], id: string): WorkTask[] {
  return descendantsIn(tasks, id);
}
/** Closed (done or dropped), of all descendants. */
export function subtreeProgress(
  tasks: readonly WorkTask[],
  id: string,
): { closed: number; total: number } {
  const under = countedUnder(tasks, id);
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
/** In progress first, then by number: the order every list of open tasks is said in. */
function inProgressFirst(a: WorkTask, b: WorkTask): number {
  return (
    Number(b.status === "in_progress") - Number(a.status === "in_progress") || a.number - b.number
  );
}
export function openSubtasks(db: WorkDb, id: string): WorkTask[] {
  return descendants(db, id).filter(isOpen).sort(inProgressFirst);
}
/**
 * A task's layer (D76), from its parent alone: a task under a task is a subtask; one at the top,
 * under a plan or under a phase is a task. A task an older kit nested deeper reads as a subtask.
 */
export function layerOf(task: WorkTask, byId: ReadonlyMap<string, WorkTask>): WorkLayer {
  return task.kind;
}
/** The open tasks a task is blocked by, in number order: it cannot start or be done while one is. */
export function openBlockers(task: WorkTask, byId: ReadonlyMap<string, WorkTask>): WorkTask[] {
  return task.waitsFor
    .map((id) => byId.get(id))
    .filter((t): t is WorkTask => t !== undefined && isOpen(t))
    .sort((a, b) => a.number - b.number);
}
/** Open, and blocked by a task still open. */
export function isBlocked(task: WorkTask, byId: ReadonlyMap<string, WorkTask>): boolean {
  return isOpen(task) && openBlockers(task, byId).length > 0;
}
/**
 * The open tasks under a task that hold it (D76), in progress first: each open blocking task
 * reached through blocking tasks only. A non-blocking task holds nothing, and what is under it
 * holds only it. Below a closed blocking task the walk goes on, so a task an older kit or a
 * system close left open there still holds.
 */
export function holdingUnder(tasks: readonly WorkTask[], id: string): WorkTask[] {
  const children = new Map<string, WorkTask[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const siblings = children.get(t.parentId);
    if (siblings) siblings.push(t);
    else children.set(t.parentId, [t]);
  }
  const seen = new Set([id]);
  const result: WorkTask[] = [];
  const walk = (parent: string) => {
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.id) || child.type === "non-blocking") continue;
      seen.add(child.id);
      if (isOpen(child)) result.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return result.sort(inProgressFirst);
}
export interface ListOptions {
  project: string;
  root?: string;
  plan?: string;
  /** The caller whose claims count as "mine" (`claimHeldBy`). */
  claimedBy?: Who;
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
        (!options.claimedBy || claimHeldBy(t.claim, options.claimedBy)) &&
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
      "SELECT id, task_id AS taskId,text,session_id AS sessionId,at FROM task_notes WHERE task_id=? ORDER BY id",
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
      pid: row.pid,
      reason: row.reason,
    }));
}
/**
 * The history of a task no longer in the store, by its `#n` or id: a deleted task keeps its
 * entries, the last one its last version. Empty when no task ever had it, or the task is there.
 */
export function deletedHistory(db: WorkDb, project: string, ref: string): WorkEvent[] {
  const number = /^#?\d+$/.test(ref) ? Number(ref.replace(/^#/, "")) : null;
  const row = db.sqlite
    .query<{ task_id: string }, [string, number | null, string]>(
      "SELECT task_id FROM task_events WHERE project=? AND (number=? OR task_id=?) ORDER BY id DESC LIMIT 1",
    )
    .get(project, number, ref);
  if (!row) return [];
  const events = eventsOf(db, row.task_id);
  return events.at(-1)?.action === "deleted" ? events : [];
}
/**
 * True when `who` holds the claim: the one test of a claim against a caller, everywhere.
 *
 * A claim belongs to the Claude process, not its session id: the same pid, and on Linux the same
 * process start time, so `/clear` and a resume keep the process's own tasks its own. Off Linux
 * there is no start time (`callerOf`), and a later process may get a dead claimer's pid. So when
 * either side has no start time, the claim's session id must also be the caller's.
 */
export function claimHeldBy(claim: WorkClaim | null, who: Who | null | undefined): boolean {
  if (!claim || !who || who.pid === null || claim.pid !== who.pid) return false;
  if (claim.procStart !== null && who.procStart !== null) return claim.procStart === who.procStart;
  return who.sessionId !== null && claim.sessionId === who.sessionId;
}
export function claimState(
  task: WorkTask,
  isLive: (claim: WorkClaim) => boolean,
  who?: Who,
): "mine" | "another session" | "free" {
  if (!task.claim || !isLive(task.claim)) return "free";
  return claimHeldBy(task.claim, who) ? "mine" : "another session";
}
