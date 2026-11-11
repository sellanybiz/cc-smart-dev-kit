/**
 * Test fixtures for `task import claude-mem`: a claude-mem database with its real
 * `work_state_entries` columns, and the tasks 1.10.0's import wrote for one of claude-mem's own
 * lists before the import learned to leave such lists out.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { type WorkDb, writeWork } from "../tasks/work/db";
import { taskById } from "../tasks/work/queries";
import { type CreateTask, insertTask } from "../tasks/work/store";
import type { Who, WorkTask } from "../tasks/work/types";
import { tempDir } from "./temp";

/**
 * A claude-mem 15.5.0 database in a temp folder, one row per entry in the order given (so its
 * `id`), under project `home` unless a row names its own.
 */
export function claudeMemDb(
  rows: [list: string, fields: object, at: number, project?: string][],
  folder: string = tempDir(),
): string {
  const file = join(folder, "claude-mem.db");
  const db = new Database(file);
  db.run(
    "CREATE TABLE work_state_entries(id INTEGER PRIMARY KEY, project TEXT NOT NULL, list_name TEXT NOT NULL, fields TEXT NOT NULL, created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL, synced_at INTEGER, origin_device_id TEXT, origin_local_id TEXT, sync_rev TEXT NOT NULL DEFAULT '1')",
  );
  const insert = db.query(
    "INSERT INTO work_state_entries(project,list_name,fields,created_at,created_at_epoch) VALUES (?,?,?,?,?)",
  );
  for (const [list, fields, at, project = "home"] of rows)
    insert.run(project, list, JSON.stringify(fields), new Date(at).toISOString(), at);
  db.close();
  return file;
}

/** What 1.10.0's import wrote for one of claude-mem's own lists: the list's task and one item. */
export function mistakenImport(
  db: WorkDb,
  project: string,
  at: number,
  list = "my-focus",
): { list: WorkTask; item: WorkTask } {
  const kit = { sessionId: null, crewId: null, pid: null, procStart: null };
  const reason = "imported from claude-mem's work state";
  const made = writeWork(db, () => {
    const task = insertTask(db, { project, subject: list }, kit, at, reason);
    const item = insertTask(db, { project, subject: `${list}: an item` }, kit, at, reason);
    db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(task.id, item.id);
    db.sqlite
      .query(
        "UPDATE task_events SET changes=json_set(changes, '$.parent', json(?)) WHERE task_id=? AND action='created'",
      )
      .run(JSON.stringify([null, `#${task.number}`]), item.id);
    return { list: task, item: taskById(db, item.id) };
  });
  if (!made.ok) throw new Error(made.why);
  return made.value;
}

/** Explicit old-writer fixture: new writers never make this graph, read-only guards must tolerate it. */
export function legacyCreateTask(db: WorkDb, input: CreateTask, who: Who, now: number) {
  return writeWork(db, () => {
    const task = insertTask(
      db,
      {
        ...input,
        parentId: null,
        plan: null,
        kind: input.kind === "phase" ? "task" : (input.kind ?? "task"),
      },
      who,
      now,
    );
    db.sqlite
      .query("UPDATE tasks SET parent_id=?,kind=?,plan=? WHERE id=?")
      .run(input.parentId ?? null, input.kind ?? "task", input.plan ?? null, task.id);
    if (input.plan)
      db.sqlite
        .query(
          "UPDATE task_events SET changes=json_set(changes, '$.plan', json(?)) WHERE task_id=? AND action='created'",
        )
        .run(JSON.stringify([null, input.plan]), task.id);
    if (input.parentId) {
      const parent = taskById(db, input.parentId);
      db.sqlite
        .query(
          "UPDATE task_events SET changes=json_set(changes, '$.parent', json(?)) WHERE task_id=? AND action='created'",
        )
        .run(JSON.stringify([null, `#${parent.number}`]), task.id);
    }
    return taskById(db, task.id);
  });
}
