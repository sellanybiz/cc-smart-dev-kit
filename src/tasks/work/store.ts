import { type WorkDb, writeWork } from "./db";
import { allTasks, descendants, isOpen, openSubtasks, taskById } from "./queries";
import {
  DESCRIPTION_LIMIT,
  NOTE_LIMIT,
  SUBJECT_LIMIT,
  type Who,
  type WorkEventAction,
  type WorkKind,
  type WorkStatus,
  type WorkTask,
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

/** A value that says nothing on its own: left out of a created or deleted entry. */
function empty(value: unknown): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
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
}
export interface UpdateTask {
  subject?: string;
  description?: string;
  status?: WorkStatus;
  parentId?: string | null;
  waitsFor?: { add?: string[]; remove?: string[] };
  claim?: boolean;
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
function parentValid(db: WorkDb, project: string, id: string | null, parent: string | null): void {
  if (!parent) return;
  if (parent === id) throw new Error("a task cannot be its own parent");
  const target = taskById(db, parent);
  if (target.project !== project) throw new Error("parent belongs to another project");
  if (id && descendants(db, id).some((t) => t.id === parent))
    throw new Error("parent would make a cycle");
}
function doneValid(db: WorkDb, id: string): void {
  const open = openSubtasks(db, id);
  if (open.length)
    throw new Error(`open subtasks: ${open.map((t) => `#${t.number} ${t.subject}`).join(", ")}`);
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
  parentValid(db, input.project, null, input.parentId ?? null);
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
      "INSERT INTO tasks(id,project,number,parent_id,kind,subject,description,status,plan,phase,crew_id,created_by,claim_pid,claim_start,claim_session,created_at,updated_at,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
    );
  const task = taskById(db, id);
  const initial: Record<string, unknown> = {
    kind: task.kind,
    plan: task.plan,
    phase: task.phase,
    ...shape(db, task),
  };
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(initial))
    if (!empty(value)) changes[key] = [null, value];
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
  for (const ref of change.add ?? []) {
    const other = taskById(db, ref);
    if (other.project !== task.project) throw new Error("dependency belongs to another project");
    const tasks = allTasks(db, task.project);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const seen = new Set<string>();
    const pending = [ref];
    while (pending.length) {
      const id = pending.pop();
      if (!id || seen.has(id)) continue;
      if (id === task.id) throw new Error("waits-for would make a cycle");
      seen.add(id);
      pending.push(...(byId.get(id)?.waitsFor ?? []));
    }
    db.sqlite.query("INSERT OR IGNORE INTO task_deps VALUES (?,?)").run(task.id, ref);
  }
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
  if (status === "done") doneValid(db, id);
  const parent = change.parentId === undefined ? task.parentId : change.parentId;
  parentValid(db, task.project, id, parent);
  if (change.waitsFor) dependencies(db, task, change.waitsFor);
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
      "UPDATE tasks SET subject=?,description=?,status=?,parent_id=?,claim_pid=?,claim_start=?,claim_session=?,updated_at=?,closed_at=? WHERE id=?",
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
      if (!empty(value)) last[key] = [value, null];
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
 * subtasks, each with an automatic note and a history entry that give the reason.
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
  for (const child of openSubtasks(db, id)) {
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
function planTask(db: WorkDb, input: PlanTask, who: Who, now: number): WorkTask {
  return (
    allTasks(db, input.project).find((t) => t.kind === "plan" && t.plan === input.plan) ??
    insertTask(db, { ...input, kind: "plan" }, who, now)
  );
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
