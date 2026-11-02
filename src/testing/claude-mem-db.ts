/**
 * Test fixtures for `task import claude-mem`: a claude-mem database with its real
 * `work_state_entries` columns, and the tasks 1.10.0's import wrote for claude-mem's own
 * `my-focus` list before the import learned to leave such lists out.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { type WorkDb, writeWork } from "../tasks/work/db";
import { insertTask } from "../tasks/work/store";
import { tempDir } from "./temp";

/** A claude-mem 15.5.0 database in a temp folder, one row per entry, all under project `home`. */
export function claudeMemDb(
  rows: [list: string, fields: object, at: number][],
  folder: string = tempDir(),
): string {
  const file = join(folder, "claude-mem.db");
  const db = new Database(file);
  db.run(
    "CREATE TABLE work_state_entries(id INTEGER PRIMARY KEY, project TEXT NOT NULL, list_name TEXT NOT NULL, fields TEXT NOT NULL, created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL, synced_at INTEGER, origin_device_id TEXT, origin_local_id TEXT, sync_rev TEXT NOT NULL DEFAULT '1')",
  );
  const insert = db.query(
    "INSERT INTO work_state_entries(project,list_name,fields,created_at,created_at_epoch) VALUES ('home',?,?,?,?)",
  );
  for (const [list, fields, at] of rows)
    insert.run(list, JSON.stringify(fields), new Date(at).toISOString(), at);
  db.close();
  return file;
}

/** What 1.10.0's import wrote for claude-mem's `my-focus` list: its task (#1) and one item. */
export function mistakenImport(db: WorkDb, project: string, at: number): void {
  const kit = { sessionId: null, crewId: null, pid: null, procStart: null };
  const reason = "imported from claude-mem's work state";
  const made = writeWork(db, () => {
    const list = insertTask(db, { project, subject: "my-focus" }, kit, at, reason);
    insertTask(db, { project, subject: "Focus area: Billing", parentId: list.id }, kit, at, reason);
    return list;
  });
  if (!made.ok) throw new Error(made.why);
}
