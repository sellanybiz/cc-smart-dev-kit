import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../../build-info/names";
import { allTasks, holdingUnder, waitsForTask } from "./queries";
import type { Result } from "./types";
/**
 * The schema this code writes. Each step is additive (`MIGRATIONS`), so `min_compatible` stays 1:
 * code from an older version folder still reads and writes the store, and a column it does not
 * know takes its default.
 */
export const WORK_SCHEMA_VERSION = 5;
export const LEGACY_LIFT_REASON = "lift legacy nested task";
export const WRITE_TIMEOUT_MS = 3000;
export const HOOK_TIMEOUT_MS = 200;
export const NEWER_STORE = `the task store was made by a newer kit version: update the kit (${COMMAND} update)`;
export interface WorkDb {
  sqlite: Database;
  writable: boolean;
  writeRefusal?: string;
  close(): void;
}
export function workDbFile(paths: { stateDir: string }): string {
  return join(paths.stateDir, "tasks", "work.db");
}
/**
 * The first schema. The `acks` table (a teammate task done on one machine) stays in it although
 * nothing in 5.x writes or reads it: a 4.x server still queries it, `min_compatible` stays 1, and
 * schema steps only add, so a store that 5.x opens must still hold the table 4.x expects.
 */
const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta VALUES ('min_compatible','1');
CREATE TABLE tasks(id TEXT PRIMARY KEY, project TEXT NOT NULL, number INTEGER NOT NULL,
 parent_id TEXT REFERENCES tasks(id), kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task','plan','phase')),
 subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('pending','in_progress','done','dropped')),
 plan TEXT, phase TEXT, crew_id TEXT, created_by TEXT, claim_pid INTEGER, claim_start TEXT, claim_session TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER, UNIQUE(project,number));
CREATE UNIQUE INDEX task_plan ON tasks(project,plan) WHERE kind='plan';
CREATE UNIQUE INDEX task_phase ON tasks(project,plan,phase) WHERE kind='phase';
CREATE INDEX task_status ON tasks(project,status);
CREATE INDEX task_parent ON tasks(parent_id);
CREATE INDEX task_crew ON tasks(project,crew_id);
CREATE TABLE task_deps(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, waits_for TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY(task_id,waits_for));
CREATE TABLE task_notes(id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), text TEXT NOT NULL, session_id TEXT, crew_id TEXT, at INTEGER NOT NULL);
CREATE TABLE acks(project TEXT NOT NULL, task_ref TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(project,task_ref));
CREATE TABLE task_events(id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, project TEXT NOT NULL, number INTEGER NOT NULL,
 at INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','changed','noted','closed','deleted')),
 changes TEXT NOT NULL, session_id TEXT, session_name TEXT, crew_id TEXT, pid INTEGER, reason TEXT);
CREATE INDEX task_event_task ON task_events(task_id,id);
CREATE INDEX task_event_number ON task_events(project,number);
`;
/**
 * The steps after schema 1, in order: step n moves a store at n to n + 1. Never edit a step that
 * shipped; add one. Schema 2 (D76): a task's type, blocking unless set. Schema 5: the process
 * that made a task (`created_pid`, `created_start`; null on a row made before), so a task stays
 * its maker's across a `/clear`, and an index for a task's notes.
 */
const MIGRATIONS: (string | ((sqlite: Database, file: string) => void))[] = [
  "ALTER TABLE tasks ADD COLUMN blocking INTEGER NOT NULL DEFAULT 1 CHECK(blocking IN (0,1))",
  `ALTER TABLE tasks ADD COLUMN agent TEXT;
   ALTER TABLE tasks ADD COLUMN branch TEXT;
   ALTER TABLE tasks ADD COLUMN worktree TEXT;
   ALTER TABLE tasks ADD COLUMN base TEXT;`,
  repairTaskLayers,
  `ALTER TABLE tasks ADD COLUMN created_pid INTEGER;
   ALTER TABLE tasks ADD COLUMN created_start TEXT;
   CREATE INDEX IF NOT EXISTS task_note_task ON task_notes(task_id);`,
];
class BackupFailure extends Error {}
/** Lift legacy tasks under the write lock. A failed snapshot leaves the store readable. */
function repairTaskLayers(sqlite: Database, file: string): void {
  const nestedExists = sqlite
    .query(
      "SELECT 1 FROM tasks t JOIN tasks p ON p.id=t.parent_id WHERE t.kind='task' AND p.kind='task' LIMIT 1",
    )
    .get();
  if (!nestedExists) return;
  type Row = {
    id: string;
    project: string;
    number: number;
    parent_id: string | null;
    kind: string;
    blocking: number;
    status: string;
  };
  const rows = sqlite
    .query<Row, []>(
      "SELECT id,project,number,parent_id,kind,blocking,status FROM tasks ORDER BY project,number",
    )
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const originalHolds = new Map<string, string[]>();
  const reader: WorkDb = { sqlite, writable: false, close() {} };
  for (const project of new Set(rows.map((row) => row.project))) {
    const tasks = allTasks(reader, project);
    for (const task of tasks.filter(
      (task) =>
        task.kind === "task" &&
        tasks.some((child) => child.kind === "task" && child.parentId === task.id),
    ))
      originalHolds.set(
        task.id,
        holdingUnder(tasks, task.id).map((held) => held.id),
      );
  }
  let backed = false;
  const move = (row: Row, parent: Row, above: Row | null) => {
    if (!backed) {
      if (!existsSync(`${file}.v4.bak`)) {
        try {
          writeFileSync(`${file}.v4.bak.tmp`, sqlite.serialize(), { mode: 0o600 });
          renameSync(`${file}.v4.bak.tmp`, `${file}.v4.bak`);
        } catch (error) {
          let cleanup = "";
          try {
            rmSync(`${file}.v4.bak.tmp`, { force: true });
          } catch (cleanupError) {
            cleanup = ` Temporary backup cleanup also failed: ${String(cleanupError)}.`;
          }
          throw new BackupFailure(
            `task lift needs a backup: ${error instanceof Error ? error.message : String(error)}. Fix: free disk space and check folder rights for ${dirname(file)}. The next task call tries again.${cleanup}`,
          );
        }
      }
      backed = true;
    }
    const blocking = parent.blocking === 0 ? 0 : row.blocking;
    sqlite
      .query("UPDATE tasks SET parent_id=?,blocking=? WHERE id=?")
      .run(above?.id ?? null, blocking, row.id);
    sqlite
      .query(
        "INSERT INTO task_events(task_id,project,number,at,action,changes,reason) VALUES (?,?,?,?,'changed',?,?)",
      )
      .run(
        row.id,
        row.project,
        row.number,
        Date.now(),
        JSON.stringify({
          parent: [`#${parent.number}`, above === null ? null : `#${above.number}`],
          ...(blocking !== row.blocking ? { type: ["blocking", "non-blocking"] } : {}),
        }),
        LEGACY_LIFT_REASON,
      );
    row.parent_id = above?.id ?? null;
    row.blocking = blocking;
  };
  for (;;) {
    const nested = rows.find(
      (row) => row.kind === "task" && byId.get(row.parent_id ?? "")?.kind === "task",
    );
    if (!nested) {
      for (const [id, held] of originalHolds)
        for (const h of held) {
          // A legacy parent cycle had no valid completion order; never turn it into a blocker cycle.
          if (waitsForTask(allTasks(reader, byId.get(id)?.project ?? ""), h, id)) continue;
          sqlite
            .query("INSERT OR IGNORE INTO task_deps(task_id,waits_for) VALUES (?,?)")
            .run(id, h);
        }
      return;
    }
    const chain: Row[] = [];
    const positions = new Map<string, number>();
    let up: Row | undefined = nested;
    while (up) {
      const at = positions.get(up.id);
      if (at !== undefined) {
        const lowest = chain
          .slice(at)
          .filter((row) => row.kind === "task")
          .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))[0];
        if (!lowest) {
          up = undefined;
          break;
        }
        const parent = byId.get(lowest.parent_id ?? "");
        if (!parent) throw new Error("missing cycle parent");
        move(lowest, parent, null);
        break;
      }
      positions.set(up.id, chain.length);
      chain.push(up);
      up = byId.get(up.parent_id ?? "");
    }
    if (up) continue; // A cycle was broken; inspect the updated in-memory graph.
    const parent = byId.get(nested.parent_id ?? "");
    if (!parent) throw new Error("missing legacy task parent");
    move(nested, parent, byId.get(parent.parent_id ?? "") ?? null);
  }
}
// `task_events` has no foreign key on purpose: a task's history outlives the task.
export function openWorkDb(file: string, options: { mode: "write" | "hook" }): WorkDb {
  const hook = options.mode === "hook";
  const fresh = !existsSync(file);
  if (hook && fresh) throw new Error("task store does not exist");
  if (!hook) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const sqlite = new Database(file, { create: !hook, readwrite: true });
  let writeRefusal: string | undefined;
  try {
    sqlite.run(`PRAGMA busy_timeout = ${hook ? HOOK_TIMEOUT_MS : WRITE_TIMEOUT_MS}`);
    sqlite.run("PRAGMA foreign_keys = ON");
    if (!hook) {
      chmodSync(dirname(file), 0o700);
      chmodSync(file, 0o600);
      if (fresh) sqlite.run("PRAGMA journal_mode = WAL");
      sqlite.run("BEGIN IMMEDIATE");
      try {
        const version =
          sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ??
          0;
        if (version < 1) {
          sqlite.run(SCHEMA);
          sqlite.run("PRAGMA user_version = 1");
        }
        for (let at = Math.max(version, 1); at < WORK_SCHEMA_VERSION; at += 1) {
          const step = MIGRATIONS[at - 1];
          if (step === undefined) throw new Error(`no migration from task schema ${at}`);
          if (typeof step === "string") sqlite.run(step);
          else step(sqlite, file);
          sqlite.run(`PRAGMA user_version = ${at + 1}`);
        }
        const minimum = Number(
          sqlite
            .query<{ value: string }, []>("SELECT value FROM meta WHERE key='min_compatible'")
            .get()?.value ?? 1,
        );
        if (minimum <= WORK_SCHEMA_VERSION) repairTaskLayers(sqlite, file);
        sqlite.run("COMMIT");
      } catch (error) {
        sqlite.run("ROLLBACK");
        if (error instanceof BackupFailure) writeRefusal = error.message;
        else throw error;
      }
    }
    // A hook only reads: in WAL a writer's open transaction never blocks it, and it sees the last
    // committed state. It never takes the write lock, never changes data and never migrates.
    const minimum = Number(
      sqlite.query<{ value: string }, []>("SELECT value FROM meta WHERE key='min_compatible'").get()
        ?.value ?? WORK_SCHEMA_VERSION,
    );
    if (hook || writeRefusal !== undefined || minimum > WORK_SCHEMA_VERSION)
      sqlite.run("PRAGMA query_only = ON");
    return {
      sqlite,
      writable: !hook && writeRefusal === undefined && minimum <= WORK_SCHEMA_VERSION,
      ...(writeRefusal === undefined ? {} : { writeRefusal }),
      close: () => sqlite.close(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
/**
 * All writes share the compatibility check and the same short transaction. `rehearse` (a dry
 * run) makes every write and then rolls them all back, so it meets each rule a real run meets.
 */
export function writeWork<T>(
  db: WorkDb,
  body: () => T,
  options: { rehearse?: boolean } = {},
): Result<T> {
  if (!db.writable) return { ok: false, why: db.writeRefusal ?? NEWER_STORE };
  let began = false;
  try {
    db.sqlite.run("BEGIN IMMEDIATE");
    began = true;
    const min = Number(
      db.sqlite
        .query<{ value: string }, []>("SELECT value FROM meta WHERE key='min_compatible'")
        .get()?.value ?? 1,
    );
    if (min > WORK_SCHEMA_VERSION) throw new Error(NEWER_STORE);
    const value = body();
    db.sqlite.run(options.rehearse ? "ROLLBACK" : "COMMIT");
    return { ok: true, value };
  } catch (error) {
    if (began) db.sqlite.run("ROLLBACK");
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}
