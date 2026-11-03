import { type WorkDb, writeWork } from "./db";
import {
  allTasks,
  descendants,
  holdingUnder,
  isOpen,
  layerOf,
  openBlockers,
  openSubtasks,
  taskById,
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
    parent: task.parentId === null ? null : numberOf(task.parentId),
    crew: task.crewId,
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
      "INSERT INTO task_events(task_id,project,number,at,action,changes,session_id,session_name,crew_id,pid,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
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
      who.crewId,
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
  project: string;
  subject: string;
  description?: string;
  parentId?: string | null;
  kind?: WorkKind;
  status?: WorkStatus;
  plan?: string | null;
  phase?: string | null;
  crewId?: string | null;
  /** `WorkType`; blocking unless set. */
  type?: WorkType;
  /** The ids of the tasks it is blocked by. */
  blockedBy?: string[];
}
export interface UpdateTask {
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
/**
 * Where a task may sit: never under itself or its own subtasks, never in another project, and
 * within the three layers (D76). Nothing goes under a subtask, and a task that has subtasks never
 * becomes a subtask itself, which would put them a fourth layer down. A plan and a phase stay where
 * the kit put them: a plan at the top, a phase under its plan. `moving` is null for a new task.
 * A task that stays where it is meets none of it: a store an older kit nested deeper keeps
 * every task workable where it sits, and only a move is held to the layers.
 */
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
  if (!parent) return;
  if (parent === moving?.id) throw new Error("a task cannot be its own parent");
  const target = taskById(db, parent);
  if (target.project !== project) throw new Error("parent belongs to another project");
  if (moving && descendants(db, moving.id).some((t) => t.id === parent))
    throw new Error("parent would make a cycle");
  if (kind !== "task" || target.kind !== "task") return;
  const tasks = allTasks(db, project);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (layerOf(target, byId) === "subtask") {
    const above = target.parentId === null ? undefined : byId.get(target.parentId);
    throw new Error(
      `${label(target)} is a subtask, and a subtask holds no subtasks (the layers are phase › task › subtask): put it under ${above ? label(above) : "a task"}, or make it a task of its own`,
    );
  }
  if (moving !== null && tasks.some((t) => t.parentId === moving.id))
    throw new Error(
      `${label(moving)} has subtasks, so it stays a task: under ${label(target)} they would be a fourth layer. Move them first, or put it at the top or under a phase`,
    );
}
/** Done needs every task that holds it closed (`holdingUnder`): a non-blocking one holds nothing. */
function doneValid(db: WorkDb, task: WorkTask): void {
  const open = holdingUnder(allTasks(db, task.project), task.id);
  if (open.length)
    throw new Error(`open subtasks: ${open.map((t) => `#${t.number} ${t.subject}`).join(", ")}`);
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
 * waits for its blocking subtasks to be done, so a subtask blocked by its parent (or by a task
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
          `${label(task)} cannot be blocked by ${label(other)}: it sits under it, and a parent waits for its subtasks`,
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
    // A wait through a parent: a task waits for its blockers, and a parent for the subtasks that
    // hold it (`holdingUnder`). When the blocker already waits for this task that way, at any
    // depth and in either order the blocks were added, neither could ever be done.
    const tasks = [...byId.values()];
    const reached = new Set<string>();
    const waits = [ref];
    while (waits.length) {
      const id = waits.pop();
      if (!id || reached.has(id)) continue;
      if (id === task.id)
        throw new Error(
          `${label(task)} cannot be blocked by ${label(other)}: ${label(other)} already waits for it, through what it is blocked by and the subtasks a parent waits for, so neither could ever be done`,
        );
      reached.add(id);
      waits.push(...(byId.get(id)?.waitsFor ?? []), ...holdingUnder(tasks, id).map((t) => t.id));
    }
    db.sqlite.query("INSERT OR IGNORE INTO task_deps VALUES (?,?)").run(task.id, ref);
  }
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
      "INSERT INTO tasks(id,project,number,parent_id,kind,subject,description,status,plan,phase,crew_id,created_by,claim_pid,claim_start,claim_session,created_at,updated_at,closed_at,blocking) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
      input.plan ?? null,
      input.phase ?? null,
      input.crewId ?? who.crewId,
      who.sessionId,
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
      "UPDATE tasks SET subject=?,description=?,status=?,parent_id=?,claim_pid=?,claim_start=?,claim_session=?,updated_at=?,closed_at=?,blocking=? WHERE id=?",
    )
    .run(
      change.subject === undefined ? task.subject : subjectOf(change.subject),
      descriptionOf(change.description ?? task.description),
      status,
      parent,
      claim?.pid ?? null,
      claim?.procStart ?? null,
      claim?.sessionId ?? null,
      now,
      status === "done" || status === "dropped" ? (task.closedAt ?? now) : null,
      (change.type ?? task.type) === "non-blocking" ? 0 : 1,
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
    .query<{ id: number }, [string, string, string | null, string | null, number]>(
      "INSERT INTO task_notes(task_id,text,session_id,crew_id,at) VALUES (?,?,?,?,?) RETURNING id",
    )
    .get(id, text, who.sessionId, who.crewId, now);
  db.sqlite.query("UPDATE tasks SET updated_at=? WHERE id=?").run(now, id);
  const preview = text.length > NOTE_PREVIEW ? `${text.slice(0, NOTE_PREVIEW)}…` : text;
  recordEvent(db, task, "noted", { note: [null, preview] }, who, now, reason);
  return {
    id: row?.id ?? 0,
    taskId: id,
    text,
    sessionId: who.sessionId,
    crewId: who.crewId,
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
      throw new Error("task has subtasks");
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
 * subtasks, each with an automatic note and a history entry that give the reason. Closed as done
 * (a merge), it drops only the open tasks that hold it (`holdingUnder`): non-blocking work stays
 * open for whoever picks it up. Dropped (a removal), it drops every open task under it, except
 * under a phase the steps its lead laid out (no crew id): those go back to pending.
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
    status === "done" ? holdingUnder(allTasks(db, task.project), id) : openSubtasks(db, id);
  // A removed crew session's phase keeps the steps its lead laid out (they have no crew id): the
  // plan still needs them, so each goes back to pending for the phase's next crew session.
  const laidOut = (t: WorkTask) =>
    status === "dropped" && task.kind === "phase" && t.crewId === null;
  for (const child of open) {
    const before = shape(db, child);
    if (laidOut(child)) {
      if (child.status === "pending" && child.claim === null) continue;
      db.sqlite
        .query(
          "UPDATE tasks SET status='pending',updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?",
        )
        .run(now, child.id);
      recordChange(db, before, taskById(db, child.id), who, now, reason);
      insertNote(
        db,
        child.id,
        `Back to pending: ${reason}. The phase's next crew session takes it.`,
        who,
        now,
        reason,
      );
      continue;
    }
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
export interface LaidPhase extends PlanTask {
  phase: string;
  description?: string;
  type?: WorkType;
  blockedBy?: string[];
}
/**
 * A phase a lead lays out ahead of its crew (D76), inside a transaction the caller holds: the
 * plan's phase task, made once under the plan task. `crew start` for the same plan and phase
 * adopts it later (`ensurePhaseTask` finds it by both), so a phase has one task. `made` is false
 * when the phase was there already; it is returned as it is.
 */
export function layPhase(
  db: WorkDb,
  input: LaidPhase,
  who: Who,
  now: number,
): { task: WorkTask; made: boolean } {
  const there = allTasks(db, input.project).find(
    (t) => t.kind === "phase" && t.plan === input.plan && t.phase === input.phase,
  );
  if (there) return { task: there, made: false };
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
export interface PhaseTask extends PlanTask {
  phase: string;
  description: string;
  crewId: string;
  waitsForPhases: string[];
  /** Why the kit points the phase at this crew session (its start), for the history. */
  reason?: string;
}
export function ensurePhaseTask(db: WorkDb, input: PhaseTask, who: Who, now: number) {
  return writeWork(db, () => {
    const parent = planTask(
      db,
      { project: input.project, plan: input.plan, subject: input.plan },
      who,
      now,
    );
    const reason = input.reason ?? "crew start";
    const { reason: _reason, ...fields } = input;
    const task =
      allTasks(db, input.project).find(
        (t) => t.kind === "phase" && t.plan === input.plan && t.phase === input.phase,
      ) ?? insertTask(db, { ...fields, kind: "phase", parentId: parent.id }, who, now, reason);
    const before = shape(db, task);
    if (!isOpen(task) && task.crewId !== input.crewId) {
      // Started again after its crew session was removed or merged: open for the new session.
      // The old session's closed subtasks stay as its record and stop counting (`countsToward`).
      db.sqlite.query("UPDATE tasks SET status='pending',closed_at=NULL WHERE id=?").run(task.id);
      // The steps its lead laid out (no crew id) that the old session closed are its record too:
      // they take its crew id, so they stop counting. Those still open are the new session's work.
      if (task.crewId !== null)
        for (const sub of descendants(db, task.id).filter((t) => t.crewId === null && !isOpen(t))) {
          const old = shape(db, sub);
          db.sqlite.query("UPDATE tasks SET crew_id=? WHERE id=?").run(task.crewId, sub.id);
          recordChange(db, old, taskById(db, sub.id), who, now, reason);
        }
    } else if (task.crewId !== null && task.crewId !== input.crewId) {
      // A continuation: its predecessor's subtasks are its own now, so they count on. Their
      // `updated_at` stays: their work did not change, and the history entry says who took them.
      for (const sub of descendants(db, task.id).filter((t) => t.crewId === task.crewId)) {
        const old = shape(db, sub);
        db.sqlite.query("UPDATE tasks SET crew_id=? WHERE id=?").run(input.crewId, sub.id);
        recordChange(db, old, taskById(db, sub.id), who, now, reason);
      }
    }
    db.sqlite
      .query("UPDATE tasks SET crew_id=?,updated_at=? WHERE id=?")
      .run(input.crewId, now, task.id);
    const refs = input.waitsForPhases.map((phase) => {
      const found = allTasks(db, input.project).find(
        (t) => t.kind === "phase" && t.plan === input.plan && t.phase === phase,
      );
      if (!found) throw new Error(`phase not found: ${phase}`);
      return found.id;
    });
    dependencies(db, task, { add: refs });
    const after = taskById(db, task.id);
    recordChange(db, before, after, who, now, reason);
    return after;
  });
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
