import { COMMAND } from "../../build-info/names";
import type { WorkflowSource } from "../../workflow/resolve";
import { TASK_TOOL } from "../words";
import { type WorkDb, writeWork } from "./db";
import {
  allTasks,
  claimHeldBy,
  descendants,
  holdingUnder,
  livePhaseCount,
  openBlockers,
  openChildren,
  planIsOpen,
  taskById,
  waitsForTask,
} from "./queries";
import {
  DESCRIPTION_LIMIT,
  NOTE_LIMIT,
  SUBJECT_LIMIT,
  type Who,
  type WorkEventAction,
  type WorkKind,
  type WorkStatus,
  type WorkTask,
  type WorkType,
} from "./types";

/** How much of a note its history entry keeps: the note itself is in `task_notes`. */
const NOTE_PREVIEW = 120;

/** The fields a history entry compares, as a person reads them: other tasks by their number. */
function shape(db: WorkDb, task: WorkTask): Record<string, unknown> {
  const numberOf = (id: string) => `#${taskById(db, id).number}`;
  return {
    subject: task.subject,
    description: task.description,
    status: task.status,
    type: task.type,
    plan: task.plan,
    parent: task.parentId === null ? null : numberOf(task.parentId),
    agent: task.agent,
    branch: task.branch,
    worktree: task.worktree,
    base: task.base,
    claim: task.claim === null ? null : (task.claim.sessionId ?? `process ${task.claim.pid}`),
    waitsFor: task.waitsFor.map(numberOf).sort(),
  };
}

/** Each field whose value differs, with its value before and after. */
function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Bun.deepEquals(before[key], after[key]))
      changes[key] = [before[key] ?? null, after[key] ?? null];
  }
  return changes;
}

/**
 * A value that says nothing on its own, left out of a created or deleted entry: an empty one, or
 * the default type (every task is blocking unless it says otherwise).
 */
function empty(key: string, value: unknown): boolean {
  return (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (key === "type" && value === "blocking")
  );
}

/**
 * One history entry, in the caller's transaction (`writeWork`), so a change and its entry land
 * together or not at all. Every write path in this file records one.
 */
function recordEvent(
  db: WorkDb,
  task: WorkTask,
  action: WorkEventAction,
  changes: Record<string, [unknown, unknown]>,
  who: Who,
  now: number,
  reason: string | null,
): void {
  db.sqlite
    .query(
      "INSERT INTO task_events(task_id,project,number,at,action,changes,session_id,session_name,pid,reason) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      task.id,
      task.project,
      task.number,
      now,
      action,
      JSON.stringify(changes),
      who.sessionId,
      who.name ?? null,
      who.pid,
      reason,
    );
}

/** A change's entry: "closed" when it moved the task to done or dropped, "changed" otherwise. */
function recordChange(
  db: WorkDb,
  before: Record<string, unknown>,
  task: WorkTask,
  who: Who,
  now: number,
  reason: string | null,
): void {
  const changes = diff(before, shape(db, task));
  if (Object.keys(changes).length === 0) return;
  const closed =
    changes.status !== undefined && (task.status === "done" || task.status === "dropped");
  recordEvent(db, task, closed ? "closed" : "changed", changes, who, now, reason);
}
export interface CreateTask {
  agent?: string | undefined;
  branch?: string | undefined;
  worktree?: string | undefined;
  base?: string | undefined;

  project: string;
  subject: string;
  description?: string;
  parentId?: string | null;
  kind?: WorkKind;
  status?: WorkStatus;
  plan?: string | null;
  phase?: string | null;
  /** `WorkType`; blocking unless set. */
  type?: WorkType;
  /** The ids of the tasks it is blocked by. */
  blockedBy?: string[];
}
export interface UpdateTask {
  agent?: string | undefined;
  branch?: string | undefined;
  worktree?: string | undefined;
  base?: string | undefined;

  subject?: string;
  description?: string;
  status?: WorkStatus;
  parentId?: string | null;
  type?: WorkType;
  /** The tasks it is blocked by (`task_deps`), by id. */
  waitsFor?: { add?: string[]; remove?: string[] };
  claim?: boolean;
}
function label(task: WorkTask): string {
  return `#${task.number} "${task.subject}"`;
}
function subjectOf(subject: string): string {
  const text = subject.trim();
  if (!text || text.length > SUBJECT_LIMIT)
    throw new Error(`subject must be 1–${SUBJECT_LIMIT} characters`);
  return text;
}
function descriptionOf(text: string): string {
  if (text.length > DESCRIPTION_LIMIT)
    throw new Error(`description must be at most ${DESCRIPTION_LIMIT} characters`);
  return text;
}
function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  return `w${Array.from(crypto.getRandomValues(new Uint8Array(10)), (v) => alphabet[v & 31]).join("")}`;
}
/** Validate a new placement. Legacy tasks left where they sit remain editable. */
function placeValid(
  db: WorkDb,
  project: string,
  moving: WorkTask | null,
  parent: string | null,
  kind: WorkKind,
): void {
  if (moving !== null && parent === moving.parentId) return;
  if (moving !== null && moving.kind !== "task")
    throw new Error(
      `${label(moving)} is a ${moving.kind}: ${moving.kind === "plan" ? "a plan stays at the top" : "a phase stays under its plan"}`,
    );
  if (!parent) {
    if (kind === "phase") throw new Error("a phase belongs under its plan");
    return;
  }
  if (parent === moving?.id) throw new Error("a task cannot be its own parent");
  const target = taskById(db, parent);
  if (target.project !== project) throw new Error("parent belongs to another project");
  if (moving && descendants(db, moving.id).some((t) => t.id === parent))
    throw new Error("parent would make a cycle");
  if (kind === "task" && target.kind === "plan" && moving !== null)
    throw new Error(
      `a task waits under a plan only where it is made: create it with parent set to the plan (${TASK_TOOL.create}); an existing task moves under a phase`,
    );
  if (kind === "task" && target.kind !== "phase" && target.kind !== "plan")
    throw new Error(
      "a task belongs under a phase, under its plan while it waits for a phase, or at the top; a task holds no tasks",
    );
  if (kind === "phase" && target.kind !== "plan") throw new Error("a phase belongs under its plan");
  if (kind === "plan") throw new Error("a plan belongs at the top");
}
/** Done needs every task that holds it closed (`holdingUnder`): a non-blocking one holds nothing. */
function doneValid(db: WorkDb, task: WorkTask): void {
  const open = holdingUnder(allTasks(db, task.project), task.id);
  if (open.length)
    throw new Error(`open tasks: ${open.map((t) => `#${t.number} ${t.subject}`).join(", ")}`);
}
/** A task blocked by an open task neither starts nor is done (D76); a closed blocker lets it go. */
function unblockedValid(db: WorkDb, task: WorkTask): void {
  const open = openBlockers(task, new Map(allTasks(db, task.project).map((t) => [t.id, t])));
  if (open.length)
    throw new Error(
      `${label(task)} is blocked by ${open.map((t) => `${label(t)} (${t.status.replaceAll("_", " ")})`).join(", ")}: finish or drop ${open.length > 1 ? "them" : "it"} first, or remove the block`,
    );
}
/**
 * Adds blockers to a task: each in its project, never a cycle (a task waiting on itself), never
 * a task above it, and never a task that already waits for this one through a parent. A parent
 * waits for its blocking tasks to be done, so a task blocked by its parent (or by a task
 * that waits for that parent) could never start, and neither could ever be done.
 */
function addBlockers(db: WorkDb, task: WorkTask, refs: readonly string[]): void {
  for (const ref of refs) {
    const other = taskById(db, ref);
    if (other.project !== task.project) throw new Error("dependency belongs to another project");
    const byId = new Map(allTasks(db, task.project).map((t) => [t.id, t]));
    for (let up = byId.get(task.parentId ?? ""); up; up = byId.get(up.parentId ?? ""))
      if (up.id === other.id)
        throw new Error(
          `${label(task)} cannot be blocked by ${label(other)}: it sits under it, and a parent waits for its tasks`,
        );
    const seen = new Set<string>();
    const pending = [ref];
    while (pending.length) {
      const id = pending.pop();
      if (!id || seen.has(id)) continue;
      if (id === task.id) throw new Error("blocked-by would make a cycle");
      seen.add(id);
      pending.push(...(byId.get(id)?.waitsFor ?? []));
    }
    // A wait through a parent: a task waits for its blockers, and a parent for the tasks that
    // hold it (`holdingUnder`). When the blocker already waits for this task that way, at any
    // depth and in either order the blocks were added, neither could ever be done.
    const tasks = [...byId.values()];
    if (waitsForTask(tasks, ref, task.id))
      throw new Error(
        `${label(task)} cannot be blocked by ${label(other)}: ${label(other)} already waits for it, through what it is blocked by and the tasks a parent waits for, so neither could ever be done`,
      );
    db.sqlite.query("INSERT OR IGNORE INTO task_deps VALUES (?,?)").run(task.id, ref);
  }
}
function openPlanValid(tasks: readonly WorkTask[], plan: string): void {
  if (!planIsOpen(tasks, plan))
    throw new Error(
      `Plan "${plan}" is closed: reopen it with task_update, or create a loose task (no plan).`,
    );
}
/**
 * Internal operations run only within writeWork, also used by the atomic importer. `reason`
 * says why the kit made the task itself (an import), for its history.
 */
export function insertTask(
  db: WorkDb,
  input: CreateTask,
  who: Who,
  now: number,
  reason: string | null = null,
): WorkTask {
  const subject = subjectOf(input.subject);
  const description = descriptionOf(input.description ?? "");
  placeValid(db, input.project, null, input.parentId ?? null, input.kind ?? "task");
  const parentPlan = input.parentId ? taskById(db, input.parentId).plan : null;
  const plan = input.plan ?? parentPlan;
  if ((input.kind ?? "task") !== "plan" && plan !== null)
    openPlanValid(allTasks(db, input.project), plan);
  if (parentPlan !== null && parentPlan !== plan) throw new Error("parent belongs to another plan");
  const id = newId();
  // Never a deleted task's number: its history still answers to it (`task_get #n`).
  const number =
    db.sqlite
      .query<{ n: number }, [string, string]>(
        "SELECT MAX(n)+1 AS n FROM (SELECT COALESCE(MAX(number),0) AS n FROM tasks WHERE project=? UNION ALL SELECT COALESCE(MAX(number),0) FROM task_events WHERE project=?)",
      )
      .get(input.project, input.project)?.n ?? 1;
  const status = input.status ?? "pending";
  const claimed = status === "in_progress" && who.pid !== null;
  db.sqlite
    .query(
      "INSERT INTO tasks(id,project,number,parent_id,kind,subject,description,status,plan,phase,agent,branch,worktree,base,created_by,created_pid,created_start,claim_pid,claim_start,claim_session,created_at,updated_at,closed_at,blocking) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      input.project,
      number,
      input.parentId ?? null,
      input.kind ?? "task",
      subject,
      description,
      status,
      plan,
      input.phase ?? null,
      input.agent ?? null,
      input.branch ?? null,
      input.worktree ?? null,
      input.base ?? null,
      who.sessionId,
      who.pid,
      who.pid === null ? null : who.procStart,
      claimed ? who.pid : null,
      claimed ? who.procStart : null,
      claimed ? who.sessionId : null,
      now,
      now,
      status === "done" || status === "dropped" ? now : null,
      input.type === "non-blocking" ? 0 : 1,
    );
  addBlockers(db, taskById(db, id), input.blockedBy ?? []);
  const task = taskById(db, id);
  if (status === "in_progress") unblockedValid(db, task);
  const initial: Record<string, unknown> = {
    kind: task.kind,
    plan: task.plan,
    phase: task.phase,
    ...shape(db, task),
  };
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(initial))
    if (!empty(key, value)) changes[key] = [null, value];
  recordEvent(db, task, "created", changes, who, now, reason);
  return task;
}
export function createTask(db: WorkDb, input: CreateTask, who: Who, now: number) {
  return writeWork(db, () => insertTask(db, input, who, now));
}
function dependencies(
  db: WorkDb,
  task: WorkTask,
  change: NonNullable<UpdateTask["waitsFor"]>,
): void {
  for (const ref of change.remove ?? [])
    db.sqlite.query("DELETE FROM task_deps WHERE task_id=? AND waits_for=?").run(task.id, ref);
  addBlockers(db, task, change.add ?? []);
}
export function updateTask(db: WorkDb, id: string, change: UpdateTask, who: Who, now: number) {
  return writeWork(db, () => applyUpdate(db, id, change, who, now));
}
/**
 * `updateTask` inside a transaction the caller holds, so other writes land with it or not at
 * all: `task_done`'s notes roll back when the store refuses the close.
 */
export function applyUpdate(
  db: WorkDb,
  id: string,
  change: UpdateTask,
  who: Who,
  now: number,
): WorkTask {
  const task = taskById(db, id);
  const before = shape(db, task);
  const status = change.status ?? task.status;
  const parent = change.parentId === undefined ? task.parentId : change.parentId;
  placeValid(db, task.project, task, parent, task.kind);
  // Moving to the top keeps plan membership; a new phase supplies its own plan.
  let plan = task.plan;
  if (parent !== task.parentId && parent !== null) {
    plan = taskById(db, parent).plan;
    if (plan !== null) openPlanValid(allTasks(db, task.project), plan);
    // A task waiting under its plan goes to one of that plan's phases, never another plan's.
    if (task.parentId !== null && taskById(db, task.parentId).kind === "plan" && plan !== task.plan)
      throw new Error(
        `${label(task)} waits in plan "${task.plan ?? ""}": move it under a phase of that plan`,
      );
  }
  // The blockers change first, so one call can lift a block and start the task.
  if (change.waitsFor) dependencies(db, task, change.waitsFor);
  // Only the move to done is judged: a done task's other fields still change.
  if (status === "done" && task.status !== "done") doneValid(db, task);
  if ((status === "in_progress" || status === "done") && status !== task.status)
    unblockedValid(db, taskById(db, id));
  const claiming =
    status === "in_progress" && (change.status === "in_progress" || change.claim === true);
  const claim =
    change.claim === false || status !== "in_progress"
      ? null
      : claiming
        ? who.pid === null
          ? null
          : { pid: who.pid, procStart: who.procStart, sessionId: who.sessionId }
        : task.claim;
  db.sqlite
    .query(
      "UPDATE tasks SET subject=?,description=?,status=?,parent_id=?,plan=?,claim_pid=?,claim_start=?,claim_session=?,updated_at=?,closed_at=?,blocking=?,agent=?,branch=?,worktree=?,base=? WHERE id=?",
    )
    .run(
      change.subject === undefined ? task.subject : subjectOf(change.subject),
      descriptionOf(change.description ?? task.description),
      status,
      parent,
      plan,
      claim?.pid ?? null,
      claim?.procStart ?? null,
      claim?.sessionId ?? null,
      now,
      status === "done" || status === "dropped" ? (task.closedAt ?? now) : null,
      (change.type ?? task.type) === "non-blocking" ? 0 : 1,
      change.agent ?? task.agent,
      change.branch ?? task.branch,
      change.worktree ?? task.worktree,
      change.base ?? task.base,
      id,
    );
  const changed = taskById(db, id);
  recordChange(db, before, changed, who, now, null);
  return changed;
}
/** Saves a note. `reason` says why the kit wrote it itself (a system close), for the history. */
export function insertNote(
  db: WorkDb,
  id: string,
  text: string,
  who: Who,
  now: number,
  reason: string | null = null,
) {
  const task = taskById(db, id);
  if (!text.trim() || text.length > NOTE_LIMIT)
    throw new Error(`note must be 1–${NOTE_LIMIT} characters`);
  const row = db.sqlite
    .query<{ id: number }, [string, string, string | null, number]>(
      "INSERT INTO task_notes(task_id,text,session_id,at) VALUES (?,?,?,?) RETURNING id",
    )
    .get(id, text, who.sessionId, now);
  db.sqlite.query("UPDATE tasks SET updated_at=? WHERE id=?").run(now, id);
  const preview = text.length > NOTE_PREVIEW ? `${text.slice(0, NOTE_PREVIEW)}…` : text;
  recordEvent(db, task, "noted", { note: [null, preview] }, who, now, reason);
  return {
    id: row?.id ?? 0,
    taskId: id,
    text,
    sessionId: who.sessionId,
    at: now,
  };
}
export function addNote(db: WorkDb, id: string, text: string, who: Who, now: number) {
  return writeWork(db, () => insertNote(db, id, text, who, now));
}
/** Deletes a mistaken task. Its history stays, and its last entry keeps the task as it was. */
export function deleteTask(db: WorkDb, id: string, who: Who, now: number) {
  return writeWork(db, () => {
    const task = taskById(db, id);
    if (db.sqlite.query("SELECT 1 FROM tasks WHERE parent_id=?").get(id))
      throw new Error("task has tasks");
    if (db.sqlite.query("SELECT 1 FROM task_notes WHERE task_id=?").get(id))
      throw new Error("task has notes");
    const last: Record<string, [unknown, unknown]> = {};
    for (const [key, value] of Object.entries(shape(db, task)))
      if (!empty(key, value)) last[key] = [value, null];
    db.sqlite.query("DELETE FROM tasks WHERE id=?").run(id);
    recordEvent(db, task, "deleted", last, who, now, null);
    return true;
  });
}
export function systemClose(
  db: WorkDb,
  id: string,
  status: "done" | "dropped",
  reason: string,
  who: Who,
  now: number,
) {
  return writeWork(db, () => applySystemClose(db, id, status, reason, who, now));
}
/**
 * `systemClose` inside a transaction the caller holds: the kit closes a task and drops its open
 * tasks, each with an automatic note and a history entry that give the reason. Closed as done
 * (a merge), it drops only the open tasks that hold it (`holdingUnder`): non-blocking work stays
 * open for whoever picks it up. Dropped, it drops every open task under it.
 */
export function applySystemClose(
  db: WorkDb,
  id: string,
  status: "done" | "dropped",
  reason: string,
  who: Who,
  now: number,
): WorkTask {
  const task = taskById(db, id);
  const open =
    status === "done" ? holdingUnder(allTasks(db, task.project), id) : openChildren(db, id);
  for (const child of open) {
    const before = shape(db, child);
    db.sqlite
      .query(
        "UPDATE tasks SET status='dropped',closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?",
      )
      .run(now, now, child.id);
    recordChange(db, before, taskById(db, child.id), who, now, reason);
    insertNote(db, child.id, `Automatically dropped: ${reason}`, who, now, reason);
  }
  const before = shape(db, task);
  db.sqlite
    .query(
      "UPDATE tasks SET status=?,closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?",
    )
    .run(status, now, now, task.id);
  recordChange(db, before, taskById(db, id), who, now, reason);
  insertNote(db, id, `Automatically ${status}: ${reason}`, who, now, reason);
  return taskById(db, id);
}
export interface PlanTask {
  project: string;
  plan: string;
  subject: string;
}
/** The plan's task, made once: inside a transaction the caller holds. */
export function planTask(db: WorkDb, input: PlanTask, who: Who, now: number): WorkTask {
  return (
    allTasks(db, input.project).find((t) => t.kind === "plan" && t.plan === input.plan) ??
    insertTask(db, { ...input, kind: "plan" }, who, now)
  );
}
/** `plans.maxPhases` as the caller resolved it, and where the resolver found it. */
export interface PhaseCap {
  max: number;
  source: WorkflowSource;
}
/** Where a cap came from, in the words a refusal says it: one entry per source the resolver has. */
const CAP_ORIGIN: Record<WorkflowSource, string> = {
  project: "this project's workflow settings",
  personal: "your own workflow settings",
  default: "the built-in default",
};
export interface LaidPhase extends PlanTask {
  /**
   * The most phases the plan may hold: a new phase beyond it is refused. `ops.ts` always passes
   * it, resolved from the workflow settings; a caller that lays phases with no setting to read
   * (the store's own tests) leaves it out and no cap applies.
   */
  cap?: PhaseCap;
  agent?: string | undefined;
  branch?: string | undefined;
  worktree?: string | undefined;
  base?: string | undefined;

  phase: string;
  description?: string;
  type?: WorkType;
  blockedBy?: string[];
}
/**
 * Refuses a phase beyond the cap: a new phase, or a dropped one coming back, when the plan
 * already holds `plans.maxPhases` live phases. The words give the count, where the cap comes
 * from and the ways forward. Only the person raises the cap (`PLAN_KEYS`), so a session is
 * pointed to a task, never to the setting.
 */
export function refuseOverCap(tasks: readonly WorkTask[], plan: string, cap: PhaseCap): void {
  const count = livePhaseCount(tasks, plan);
  if (count < cap.max) return;
  throw new Error(
    `Plan "${plan}" already holds ${count} phases, the most plans.maxPhases allows (${cap.max}, from ${CAP_ORIGIN[cap.source]}). Do not add a phase: add the work as a task under the phase that owns its files (${TASK_TOOL.create} with that phase as parent), or queue it as a task under the next plan (${TASK_TOOL.create} with parent set to that plan's #n; make the plan first with ${TASK_TOOL.create}, plan and a subject). Only the person raises the cap: ask them to run \`${COMMAND} workflow set plans.maxPhases <n>\` in their own terminal (add --project to set it for this project).`,
  );
}
/** The plan phase, made once under its plan task, inside the caller's transaction. */
export function layPhase(
  db: WorkDb,
  input: LaidPhase,
  who: Who,
  now: number,
): { task: WorkTask; made: boolean } {
  const tasks = allTasks(db, input.project);
  // A new slug can start a plan; an existing closed plan must be reopened first.
  if (tasks.some((task) => task.plan === input.plan)) openPlanValid(tasks, input.plan);
  const there = tasks.find(
    (t) => t.kind === "phase" && t.plan === input.plan && t.phase === input.phase,
  );
  if (there) return { task: there, made: false };
  if (input.cap !== undefined) refuseOverCap(tasks, input.plan, input.cap);
  const parent = planTask(
    db,
    { project: input.project, plan: input.plan, subject: input.plan },
    who,
    now,
  );
  const task = insertTask(
    db,
    {
      project: input.project,
      subject: input.subject,
      kind: "phase",
      parentId: parent.id,
      plan: input.plan,
      phase: input.phase,
      agent: input.agent,
      branch: input.branch,
      worktree: input.worktree,
      base: input.base,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.blockedBy === undefined ? {} : { blockedBy: input.blockedBy }),
    },
    who,
    now,
  );
  return { task, made: true };
}
export function ensurePlanTask(db: WorkDb, input: PlanTask, who: Who, now: number) {
  return writeWork(db, () => planTask(db, input, who, now));
}
export function ack(db: WorkDb, project: string, taskRef: string, now: number) {
  return writeWork(db, () => {
    db.sqlite
      .query(
        "INSERT INTO acks VALUES (?,?,?) ON CONFLICT(project,task_ref) DO UPDATE SET at=excluded.at",
      )
      .run(project, taskRef, now);
    return true;
  });
}

/** One transaction checks and transfers the complete selection, including detached plan tasks. */
export function takeTasks(
  db: WorkDb,
  project: string,
  id: string,
  who: Who,
  now: number,
  options: {
    from?: string;
    force?: boolean;
    isLive: (claim: import("./types").WorkClaim) => boolean;
  },
) {
  return writeWork(db, () => {
    if (!who.sessionId) throw new Error("take needs a resolvable calling session");
    const target = taskById(db, id);
    if (target.project !== project) throw new Error("task belongs to another project");
    if (target.kind === "phase") throw new Error("take a plan or one task, not a phase");
    const rows =
      target.kind === "plan"
        ? allTasks(db, project).filter((t) => t.plan === target.plan)
        : [target];
    for (const task of rows) {
      if (
        options.from !== undefined &&
        (task.status === "pending" || task.status === "in_progress") &&
        task.createdBy !== null &&
        task.createdBy !== who.sessionId &&
        task.createdBy !== options.from
      )
        throw new Error(
          `${label(task)} belongs to session ${task.createdBy ?? "unknown"}, not ${options.from}`,
        );
      if (
        task.claim &&
        options.isLive(task.claim) &&
        !options.force &&
        !claimHeldBy(task.claim, who)
      )
        throw new Error(
          `${label(task)} is live in session ${task.claim.sessionId ?? task.createdBy ?? "unknown"}; use force to take it`,
        );
    }
    for (const task of rows) {
      db.sqlite
        .query(
          "UPDATE tasks SET created_by=?,created_pid=?,created_start=?,claim_pid=CASE WHEN claim_pid IS NULL THEN NULL ELSE ? END,claim_start=CASE WHEN claim_pid IS NULL THEN NULL ELSE ? END,claim_session=CASE WHEN claim_pid IS NULL THEN NULL ELSE ? END,updated_at=? WHERE id=?",
        )
        .run(
          who.sessionId,
          who.pid,
          who.pid === null ? null : who.procStart,
          who.pid,
          who.pid === null ? null : who.procStart,
          who.pid === null ? null : who.sessionId,
          now,
          task.id,
        );
      recordEvent(
        db,
        task,
        "changed",
        {
          createdBy: [task.createdBy, who.sessionId],
          // The maker process moves too: the history shows who it was, and who it is now.
          creator: [
            task.creator === null ? null : `process ${task.creator.pid}`,
            who.pid === null ? null : `process ${who.pid}`,
          ],
          ...(task.claim === null
            ? {}
            : {
                claim: [
                  task.claim,
                  who.pid === null
                    ? null
                    : { pid: who.pid, procStart: who.procStart, sessionId: who.sessionId },
                ],
              }),
        },
        who,
        now,
        options.force ? "forced take-over" : "take-over",
      );
    }
    return rows.map((t) => taskById(db, t.id));
  });
}
