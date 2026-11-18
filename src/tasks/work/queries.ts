import type { WorkDb } from "./db";
import type {
  ClaimProcess,
  Who,
  WorkClaim,
  WorkEvent,
  WorkEventAction,
  WorkKind,
  WorkLayer,
  WorkLead,
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
  /** Absent in a store a hook reads before a writer moved it to schema 5. */
  created_pid?: number | null;
  created_start?: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  /** Absent in a store a hook reads before a writer moved it to schema 2. */
  blocking?: number;
  /** Absent in a store a hook reads before a writer moved it to schema 6. */
  lead_session?: string | null;
  lead_pid?: number | null;
  lead_start?: string | null;
}
/** False in a store a hook reads before a writer moved it to schema 6: no file list is stored yet. */
function hasFilesTable(db: WorkDb): boolean {
  return (
    db.sqlite
      .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_files'")
      .get() !== null
  );
}
/** A project's stored file lists by plan task id. */
function storedFiles(db: WorkDb, project: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  if (!hasFilesTable(db)) return files;
  for (const row of db.sqlite
    .query<{ task_id: string; path: string }, [string]>(
      "SELECT f.task_id,f.path FROM task_files f JOIN tasks t ON t.id=f.task_id WHERE t.project=? ORDER BY f.path",
    )
    .all(project)) {
    const paths = files.get(row.task_id) ?? [];
    paths.push(row.path);
    files.set(row.task_id, paths);
  }
  return files;
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
  const files = storedFiles(db, project);
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
      creator:
        row.created_pid == null
          ? null
          : {
              pid: row.created_pid,
              procStart: row.created_start ?? null,
              sessionId: row.created_by,
            },
      claim:
        row.claim_pid === null
          ? null
          : { pid: row.claim_pid, procStart: row.claim_start, sessionId: row.claim_session },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      waitsFor: dependencies.get(row.id) ?? [],
      type: row.blocking === 0 ? "non-blocking" : "blocking",
      files: files.get(row.id) ?? [],
      lead:
        row.lead_session == null && row.lead_pid == null
          ? null
          : {
              sessionId: row.lead_session ?? null,
              pid: row.lead_pid ?? null,
              procStart: row.lead_start ?? null,
            },
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

/** Whether a phase of the plan is `in_progress`: work running now, whatever the plan task says. */
function hasRunningPhase(all: readonly WorkTask[], plan: WorkTask): boolean {
  return all.some((p) => p.kind === "phase" && p.plan === plan.plan && p.status === "in_progress");
}

/**
 * Whether a plan is in flight: it is open, and its task is `in_progress` (the store sets that
 * when the plan's first phase or task starts) or, for a plan started under 4.8.0 that never set
 * its task, one of its phases is `in_progress`.
 */
export function isInFlight(all: readonly WorkTask[], plan: WorkTask): boolean {
  return (
    plan.kind === "plan" &&
    isOpen(plan) &&
    (plan.status === "in_progress" || hasRunningPhase(all, plan))
  );
}

/**
 * The plan a caller has in flight: one of its own plans (`owns` holds the plan's task) that
 * `isInFlight`. A session runs one plan at a time, so there is normally one. When two qualify (a
 * take-over made the second), the one with a phase in progress, else the first by number.
 * Another session's plan never counts. Null when the caller runs none.
 */
export function inFlightPlanOf(
  all: readonly WorkTask[],
  owns: (task: WorkTask) => boolean,
): WorkTask | null {
  const candidates = all.filter(
    (t) => t.kind === "plan" && t.plan !== null && owns(t) && isInFlight(all, t),
  );
  return candidates.find((t) => hasRunningPhase(all, t)) ?? candidates[0] ?? null;
}

/**
 * The plan a call that names none belongs to, for a caller's own plans. In order:
 * 1. the plan in flight (`inFlightPlanOf`);
 * 2. the plan being finished: an own open plan whose phases are all closed, at least one done
 *    (its final review and fix pass), the newest such plan; a plan started under 4.8.0 is in
 *    this state while its task is still pending;
 * 3. the next plan in the queue: the lowest-numbered own open plan with an open phase;
 * 4. the newest own open plan, `fallback` (the plan of the caller's latest own task), as before.
 * Only the first counts for the one-plan-in-flight refusal.
 */
export function defaultPlanOf(
  all: readonly WorkTask[],
  owns: (task: WorkTask) => boolean,
  inFlight: WorkTask | null,
  fallback: string | null,
): string | null {
  if (inFlight?.plan) return inFlight.plan;
  const ownOpen = all.filter((t) => t.kind === "plan" && t.plan !== null && isOpen(t) && owns(t));
  const finishing = ownOpen
    .filter((t) => {
      const phases = all.filter((p) => p.kind === "phase" && p.plan === t.plan);
      return phases.some((p) => p.status === "done") && phases.every((p) => !isOpen(p));
    })
    .at(-1);
  if (finishing?.plan) return finishing.plan;
  const next = ownOpen.find((t) =>
    all.some((p) => p.kind === "phase" && p.plan === t.plan && isOpen(p)),
  );
  if (next?.plan) return next.plan;
  return fallback !== null && planIsOpen(all, fallback) ? fallback : null;
}

/**
 * Whose task this is, for one caller: one it made under its current session id, one its process
 * claims, or one its process made (`creator`, under any session id: `/clear` gives the process a
 * new id, and a plan it laid before keeps its own). The same test as a claim (`claimHeldBy`), so
 * a task another process made is never the caller's by a claim on a sibling. The one rule the
 * task tools, `task_list` and the status line judge ownership by.
 */
export function ownerOf(who: Who): (task: WorkTask) => boolean {
  return (t) =>
    (who.sessionId !== null && t.createdBy === who.sessionId) ||
    claimHeldBy(t.claim, who) ||
    claimHeldBy(t.creator, who);
}

/**
 * True when `who` is the lead a plan is reserved for: the same rule as an owner (`ownerOf`), so a
 * `/clear` keeps the lead. The session id matches, or the process does (`claimHeldBy`).
 */
export function isLead(lead: WorkLead | null, who: Who | null | undefined): boolean {
  if (lead === null || !who) return false;
  if (who.sessionId !== null && lead.sessionId === who.sessionId) return true;
  return (
    lead.pid !== null &&
    claimHeldBy({ pid: lead.pid, procStart: lead.procStart, sessionId: lead.sessionId }, who)
  );
}

/**
 * One entry of a plan's file list, as stored: repo-relative, `/`-separated, a folder ending in
 * `/`. A leading `./`, a doubled or inner `/./` and a Windows `\` are tidied. Throws, naming the
 * fix, for an absolute path, a `..` segment and the repository root (`""`, `.`, `/`): a plan
 * that lists the root would overlap every other plan.
 */
export function normalizePlanFile(raw: string): string {
  const text = raw.trim().replaceAll("\\", "/");
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text))
    throw new Error(`file "${raw}" is an absolute path: write it relative to the repository root`);
  const segments = text.split("/");
  const parts: string[] = [];
  for (const part of segments) {
    if (part === "..")
      throw new Error(`file "${raw}" goes up with "..": list the path from the repository root`);
    if (part !== "" && part !== ".") parts.push(part);
  }
  if (parts.length === 0)
    throw new Error(
      `file "${raw}" is the repository root: list the files or folders the plan changes`,
    );
  const last = segments.at(-1);
  return parts.join("/") + (last === "" || last === "." ? "/" : "");
}

/** A plan's file list as given: each entry normalised (`normalizePlanFile`), once each, in path order. */
export function normalizePlanFiles(raw: readonly string[]): string[] {
  return [...new Set(raw.map(normalizePlanFile))].sort();
}

/** Two paths of two plans' file lists that touch: `path` from the first list, `other` from the second. */
export interface FileOverlap {
  path: string;
  other: string;
}

/**
 * Where two plans' file lists touch (D2): two paths touch when they are equal, or one is a
 * folder (ends in `/`) that holds the other. `ignore` is `plans.mergeFiles`: a path equal to an
 * ignored entry, or inside an ignored folder, takes no part. `caseFold` compares without case
 * (`core.ignorecase`), the ignore list included. Lists are as stored (`normalizePlanFile`).
 */
export function filesOverlap(
  a: readonly string[],
  b: readonly string[],
  options: { ignore?: readonly string[]; caseFold?: boolean } = {},
): FileOverlap[] {
  const fold = (path: string) => (options.caseFold ? path.toLowerCase() : path);
  const holds = (folder: string, path: string) => folder.endsWith("/") && path.startsWith(folder);
  const ignore = (options.ignore ?? []).map(fold);
  const taken = (path: string) => ignore.some((one) => one === path || holds(one, path));
  const found: FileOverlap[] = [];
  for (const path of a) {
    const x = fold(path);
    if (taken(x)) continue;
    for (const other of b) {
      const y = fold(other);
      if (taken(y)) continue;
      if (x === y || holds(x, y) || holds(y, x)) found.push({ path, other });
    }
  }
  return found;
}

/** One plan's stored file list, in path order; empty before schema 6 (no table yet). */
export function planFiles(db: WorkDb, plan: string | WorkTask): string[] {
  if (!hasFilesTable(db)) return [];
  return db.sqlite
    .query<{ path: string }, [string]>("SELECT path FROM task_files WHERE task_id=? ORDER BY path")
    .all(typeof plan === "string" ? plan : plan.id)
    .map((row) => row.path);
}

/** A plan nothing else may overlap (D4): why it is held, whose it is, and the files it holds. */
export interface HeldPlan {
  plan: WorkTask;
  /**
   * `reserved`: a lead holds it and has not released it (a closed plan too, until its pull
   * request settles). `in-flight`: a session runs it without a reservation.
   */
  why: "reserved" | "in-flight";
  /** The caller leads it or owns it. */
  mine: boolean;
  /** Its stored list plus what the caller read of its branch (`extraFiles`), each once. */
  files: string[];
}

/** `heldPlans`, over a project's tasks already read. */
export function heldPlansIn(
  all: readonly WorkTask[],
  who: Who,
  extraFiles: Readonly<Record<string, readonly string[]>> = {},
): HeldPlan[] {
  const owns = ownerOf(who);
  return all
    .filter((t) => t.kind === "plan" && (t.lead !== null || isInFlight(all, t)))
    .map((plan) => ({
      plan,
      why: plan.lead !== null ? ("reserved" as const) : ("in-flight" as const),
      mine: isLead(plan.lead, who) || owns(plan),
      files: [...new Set([...plan.files, ...(extraFiles[plan.id] ?? [])])],
    }));
}

/**
 * The held plans of a project (D4): every plan with a lead whose release has not happened (a
 * child's, or a lead's own), and every open plan in flight, any session's: that covers a solo
 * session that started a plan without reserving it. A held plan's files are its stored list plus
 * `extraFiles[plan task id]`, the branch diff the caller read before the transaction (so no git
 * runs under the write lock). `who` says which of them are the caller's.
 */
export function heldPlans(
  db: WorkDb,
  project: string,
  who: Who,
  extraFiles: Readonly<Record<string, readonly string[]>> = {},
): HeldPlan[] {
  return heldPlansIn(allTasks(db, project), who, extraFiles);
}

/**
 * Whether a plan is the caller's: its plan task is owned (`owns`). A task of the plan that the
 * caller owns (a step it claims in another session's plan) never makes the plan its own. A
 * legacy plan with no plan task has no row to judge, so any own task in it counts.
 */
export function ownsPlan(
  all: readonly WorkTask[],
  owns: (task: WorkTask) => boolean,
  plan: string,
): boolean {
  const row = all.find((t) => t.kind === "plan" && t.plan === plan);
  return row === undefined ? all.some((t) => t.plan === plan && owns(t)) : owns(row);
}

/** A note that starts so says why a plan was parked (`task_update` with the plan pending). */
export const PARK_NOTE_PREFIX = "parked:";

/** How a plan stands in the queue, as `task_list` and the status line say it. */
export type PlanQueueState = "in flight" | "finishing" | "parked" | "queued";

/**
 * An open plan's place in the queue, for a plan that is not in flight (`isInFlight` says so
 * first). Parked: it holds a note that starts `PARK_NOTE_PREFIX` (checked first, so a plan
 * parked with every phase closed still reads parked), or it has an open phase and a done one.
 * Finishing: pending, every phase closed and one done (a plan started under 4.8.0 at its final
 * review and fix pass). Queued: laid out, never started. `parkNote` says whether the plan task
 * holds such a note.
 */
export function planQueueState(
  all: readonly WorkTask[],
  plan: WorkTask,
  parkNote: boolean,
): PlanQueueState {
  if (isInFlight(all, plan)) return "in flight";
  const phases = all.filter((t) => t.kind === "phase" && t.plan === plan.plan);
  const started = phases.some((t) => t.status === "done");
  if (parkNote) return "parked";
  if (started && phases.every((t) => !isOpen(t))) return "finishing";
  return started ? "parked" : "queued";
}

/**
 * How many of a caller's other open plans wait behind `current`, by their queue state: what the
 * status line adds to its plan row. `parkNote` says whether a plan task holds a `parked:` note.
 */
export function waitingPlans(
  all: readonly WorkTask[],
  owns: (task: WorkTask) => boolean,
  current: string,
  parkNote: (plan: WorkTask) => boolean,
): { queued: number; parked: number } {
  const waiting = { queued: 0, parked: 0 };
  for (const t of all) {
    if (t.kind !== "plan" || t.plan === null || t.plan === current || !isOpen(t) || !owns(t))
      continue;
    const state = planQueueState(all, t, parkNote(t));
    if (state === "queued" || state === "parked") waiting[state] += 1;
  }
  return waiting;
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
 * Whether a task could start now: it is pending and no open task blocks it, and a phase also
 * holds at least one live (not dropped) task, since the store refuses to start an empty phase
 * (`refuseEmptyPhase`). The one test the keep-going guard's ready phases and the close answer's
 * freed work share.
 */
export function isStartable(
  all: readonly WorkTask[],
  byId: ReadonlyMap<string, WorkTask>,
  task: WorkTask,
): boolean {
  return (
    task.status === "pending" &&
    !isBlocked(task, byId) &&
    (task.kind !== "phase" || all.some((t) => t.parentId === task.id && t.status !== "dropped"))
  );
}
/**
 * The work a close just freed, in number order: the caller's own tasks and phases that had the
 * closed task as a blocker and could start now (`isStartable`). `all` is read after the close,
 * so the closed task no longer blocks.
 */
export function freedBy(
  all: readonly WorkTask[],
  closed: WorkTask,
  owns: (task: WorkTask) => boolean,
): WorkTask[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  return all.filter((t) => t.waitsFor.includes(closed.id) && owns(t) && isStartable(all, byId, t));
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
/**
 * True when the claim is a dead process's claim that the caller's own session left behind: a
 * reopened session (`claude --resume`) keeps its session id in a new process, so its running
 * work names a process that is gone (`docs/claude-code-contract.md`). All must hold: the caller
 * has a process and a session id, the claim carries that session id, the caller's process does
 * not hold it (`claimHeldBy`) and its process is proved gone (`isGone`: `claimGone`). A claim of
 * a process that may still run (two processes opened the same conversation) is never the
 * caller's.
 */
export function resumedClaim(
  claim: WorkClaim | null,
  who: Who | null | undefined,
  isGone: (claim: WorkClaim) => boolean,
): boolean {
  return (
    claim !== null &&
    who !== null &&
    who !== undefined &&
    who.pid !== null &&
    who.sessionId !== null &&
    claim.sessionId === who.sessionId &&
    !claimHeldBy(claim, who) &&
    isGone(claim)
  );
}

/** Whether the claim is the caller's running work: its process holds it, or it is a resumed claim. */
export function claimIsMine(
  claim: WorkClaim | null,
  who: Who | null | undefined,
  isGone: (claim: WorkClaim) => boolean,
): boolean {
  return claimHeldBy(claim, who) || resumedClaim(claim, who, isGone);
}

export function claimState(
  task: WorkTask,
  process: ClaimProcess,
  who?: Who,
): "mine" | "another session" | "free" {
  if (!task.claim) return "free";
  if (!process.live(task.claim))
    return resumedClaim(task.claim, who, process.gone) ? "mine" : "free";
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
