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
/**
 * What a plan counts, by the plan column: its phases, or its tasks when it has no phase. Each
 * phase counts its own tasks (`layerProgress`), so nothing counts twice, and a plan a lead laid
 * as phases alone shows 5/25, never 0/0.
 */
function planCounted(all: readonly WorkTask[], plan: string | null): WorkTask[] {
  if (plan === null) return [];
  const phases = all.filter((t) => t.kind === "phase" && t.plan === plan);
  return phases.length > 0 ? phases : all.filter((t) => t.kind === "task" && t.plan === plan);
}
/**
 * What a plan or a phase counts as its progress, from the whole list (closed long ago too): a
 * plan its `planCounted`, a phase its tasks by parent. Closed is done or dropped. A task counts
 * none. The statusline, `task_list` and the portal all count so.
 */
export function layerProgress(
  all: readonly WorkTask[],
  layer: Pick<WorkTask, "id" | "kind" | "plan">,
): { closed: number; total: number } {
  const tasks =
    layer.kind === "plan"
      ? planCounted(all, layer.plan)
      : layer.kind === "phase"
        ? all.filter((t) => t.kind === "task" && t.parentId === layer.id)
        : [];
  return { closed: tasks.filter((t) => !isOpen(t)).length, total: tasks.length };
}
/** A plan row decides; legacy plans without one stay open only while blocking tasks do. */
export function planIsOpen(all: readonly WorkTask[], plan: string): boolean {
  const row = all.find((task) => task.kind === "plan" && task.plan === plan);
  return row
    ? isOpen(row)
    : all.some(
        (task) =>
          task.plan === plan && task.kind === "task" && task.type === "blocking" && isOpen(task),
      );
}
/**
 * How many phases a plan holds toward `plans.maxPhases`: every phase of it that is not dropped
 * (a done one counts, a dropped one frees its slot). The one count the cap in `layPhase`,
 * `task_list` and `doctor` all use.
 */
export function livePhaseCount(all: readonly WorkTask[], plan: string): number {
  return all.filter((t) => t.kind === "phase" && t.plan === plan && t.status !== "dropped").length;
}

/**
 * The plan a caller is building now: one of its own open plans (`owns` holds the plan's task)
 * with at least one open phase. When two qualify (a take-over made the second), the one with a
 * phase in progress, else the first by number. Another session's plan never counts. Null when
 * the caller builds none.
 */
export function activePlanOf(
  all: readonly WorkTask[],
  owns: (task: WorkTask) => boolean,
): WorkTask | null {
  const phasesOf = (plan: WorkTask) =>
    all.filter((p) => p.kind === "phase" && p.plan === plan.plan && isOpen(p));
  const candidates = all.filter(
    (t) => t.kind === "plan" && t.plan !== null && isOpen(t) && owns(t) && phasesOf(t).length > 0,
  );
  return (
    candidates.find((t) => phasesOf(t).some((p) => p.status === "in_progress")) ??
    candidates[0] ??
    null
  );
}

/** All descendants, not just direct children: completion must not strand an open grandchild. */
export function descendants(db: WorkDb, id: string): WorkTask[] {
  const task = taskById(db, id);
  return descendantsIn(allTasks(db, task.project), id);
}
/** A plan counts its `planCounted`; anything else, every descendant. */
export function countedUnder(tasks: readonly WorkTask[], id: string): WorkTask[] {
  const root = tasks.find((t) => t.id === id);
  return root?.kind === "plan" ? planCounted(tasks, root.plan) : descendantsIn(tasks, id);
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
export function openChildren(db: WorkDb, id: string): WorkTask[] {
  return descendants(db, id).filter(isOpen).sort(inProgressFirst);
}
/** Kind is the layer, including a stray nested task from an older writer. */
export function layerOf(task: WorkTask, _byId: ReadonlyMap<string, WorkTask>): WorkLayer {
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
    const linked = t.parentId ? byId.get(t.parentId) : undefined;
    const parent =
      linked ??
      (t.kind === "task" && t.plan !== null
        ? nodes.find((n) => n.kind === "plan" && n.plan === t.plan)
        : undefined);
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
 * The name each session last wrote into the project's history, by session id: what the portal
 * calls a session that runs no more. A session that never gave a name is left out.
 */
export function sessionNames(db: WorkDb, project: string): Map<string, string> {
  // One row per session, its newest named entry: SQLite gives the bare columns of the row that
  // holds the MAX(id), so a later name (a rename) wins and nothing older is read back.
  const rows = db.sqlite
    .query<{ session_id: string; session_name: string }, [string]>(
      "SELECT session_id, session_name, MAX(id) AS last FROM task_events WHERE project=? AND session_id IS NOT NULL AND session_name IS NOT NULL AND session_name <> '' GROUP BY session_id",
    )
    .all(project);
  return new Map(rows.map((row) => [row.session_id, row.session_name]));
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

/** Whether start already waits for target, through explicit blockers or parent completion holds. */
export function waitsForTask(tasks: readonly WorkTask[], start: string, target: string): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const reached = new Set<string>();
  const pending = [start];
  while (pending.length) {
    const id = pending.pop();
    if (!id || reached.has(id)) continue;
    if (id === target) return true;
    reached.add(id);
    pending.push(
      ...(byId.get(id)?.waitsFor ?? []),
      ...holdingUnder(tasks, id).map((task) => task.id),
    );
  }
  return false;
}
