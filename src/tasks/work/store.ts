import { type WorkDb, writeWork } from "./db";
import { allTasks, descendants, openSubtasks, taskById } from "./queries";
import {
  DESCRIPTION_LIMIT,
  NOTE_LIMIT,
  SUBJECT_LIMIT,
  type Who,
  type WorkKind,
  type WorkStatus,
  type WorkTask,
} from "./types";
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
/** Internal operations run only within writeWork, also used by the atomic importer. */
export function insertTask(db: WorkDb, input: CreateTask, who: Who, now: number): WorkTask {
  const subject = subjectOf(input.subject);
  const description = descriptionOf(input.description ?? "");
  parentValid(db, input.project, null, input.parentId ?? null);
  const id = newId();
  const number =
    db.sqlite
      .query<{ n: number }, [string]>(
        "SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE project=?",
      )
      .get(input.project)?.n ?? 1;
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
  return taskById(db, id);
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
  return writeWork(db, () => {
    const task = taskById(db, id);
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
    return taskById(db, id);
  });
}
export function insertNote(db: WorkDb, id: string, text: string, who: Who, now: number) {
  taskById(db, id);
  if (!text.trim() || text.length > NOTE_LIMIT)
    throw new Error(`note must be 1–${NOTE_LIMIT} characters`);
  const row = db.sqlite
    .query<{ id: number }, [string, string, string | null, string | null, number]>(
      "INSERT INTO task_notes(task_id,text,session_id,crew_id,at) VALUES (?,?,?,?,?) RETURNING id",
    )
    .get(id, text, who.sessionId, who.crewId, now);
  db.sqlite.query("UPDATE tasks SET updated_at=? WHERE id=?").run(now, id);
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
export function deleteTask(db: WorkDb, id: string) {
  return writeWork(db, () => {
    taskById(db, id);
    if (db.sqlite.query("SELECT 1 FROM tasks WHERE parent_id=?").get(id))
      throw new Error("task has subtasks");
    if (db.sqlite.query("SELECT 1 FROM task_notes WHERE task_id=?").get(id))
      throw new Error("task has notes");
    db.sqlite.query("DELETE FROM tasks WHERE id=?").run(id);
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
  return writeWork(db, () => {
    const task = taskById(db, id);
    for (const child of openSubtasks(db, id)) {
      db.sqlite
        .query(
          "UPDATE tasks SET status='dropped',closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?",
        )
        .run(now, now, child.id);
      insertNote(db, child.id, `Automatically dropped: ${reason}`, who, now);
    }
    db.sqlite
      .query(
        "UPDATE tasks SET status=?,closed_at=?,updated_at=?,claim_pid=NULL,claim_start=NULL,claim_session=NULL WHERE id=?",
      )
      .run(status, now, now, task.id);
    insertNote(db, id, `Automatically ${status}: ${reason}`, who, now);
    return taskById(db, id);
  });
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
}
export function ensurePhaseTask(db: WorkDb, input: PhaseTask, who: Who, now: number) {
  return writeWork(db, () => {
    const parent = planTask(
      db,
      { project: input.project, plan: input.plan, subject: input.plan },
      who,
      now,
    );
    const task =
      allTasks(db, input.project).find(
        (t) => t.kind === "phase" && t.plan === input.plan && t.phase === input.phase,
      ) ?? insertTask(db, { ...input, kind: "phase", parentId: parent.id }, who, now);
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
    return taskById(db, task.id);
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
