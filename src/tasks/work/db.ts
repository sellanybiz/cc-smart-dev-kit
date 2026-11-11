import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../../build-info/names";
import type { Result } from "./types";
/**
 * The schema this code writes. Each step is additive (`MIGRATIONS`), so `min_compatible` stays 1:
 * code from an older version folder still reads and writes the store, and a column it does not
 * know takes its default.
 */
export const WORK_SCHEMA_VERSION = 4;
export const WRITE_TIMEOUT_MS = 3000;
export const HOOK_TIMEOUT_MS = 200;
export const NEWER_STORE = `the task store was made by a newer kit version: update the kit (${COMMAND} update)`;
export interface WorkDb {
  sqlite: Database;
  writable: boolean;
  close(): void;
}
export function workDbFile(paths: { stateDir: string }): string {
  return join(paths.stateDir, "tasks", "work.db");
}
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
 * shipped; add one. Schema 2 (D76): a task's type, blocking unless set.
 */
const MIGRATIONS: (string | ((sqlite: Database, file: string) => void))[] = [
  "ALTER TABLE tasks ADD COLUMN blocking INTEGER NOT NULL DEFAULT 1 CHECK(blocking IN (0,1))",
  `ALTER TABLE tasks ADD COLUMN agent TEXT;
   ALTER TABLE tasks ADD COLUMN branch TEXT;
   ALTER TABLE tasks ADD COLUMN worktree TEXT;
   ALTER TABLE tasks ADD COLUMN base TEXT;`,
  repairTaskLayers,
];
/** Lift legacy nested tasks while the write lock protects both the snapshot and the move. */
function repairTaskLayers(sqlite: Database, file: string): void {
  type Nested = {
    id: string;
    project: string;
    number: number;
    parent_id: string;
    parent_number: number;
    above: string | null;
    blocking: number;
    parent_blocking: number;
    status: string;
  };
  let backed = false;
  for (;;) {
    const rows = sqlite
      .query<Nested, []>(
        `SELECT t.id,t.project,t.number,t.parent_id,p.number AS parent_number,p.parent_id AS above,t.blocking,p.blocking AS parent_blocking,t.status FROM tasks t JOIN tasks p ON p.id=t.parent_id WHERE t.kind='task' AND p.kind='task'`,
      )
      .all();
    if (!rows.length) return;
    if (!backed) {
      if (!existsSync(`${file}.v4.bak`))
        writeFileSync(`${file}.v4.bak`, sqlite.serialize(), { mode: 0o600 });
      backed = true;
    }
    for (const row of rows) {
      // Re-read after each move: an ancestor may have moved earlier in this pass.
      const parent = sqlite
        .query<{ parent_id: string | null; blocking: number }, [string]>(
          "SELECT parent_id,blocking FROM tasks WHERE id=?",
        )
        .get(row.parent_id);
      if (!parent) throw new Error("missing legacy task parent");
      const above =
        parent.parent_id === null
          ? null
          : sqlite
              .query<{ number: number }, [string]>("SELECT number FROM tasks WHERE id=?")
              .get(parent.parent_id)?.number;
      sqlite
        .query("UPDATE tasks SET parent_id=?,blocking=? WHERE id=?")
        .run(parent.parent_id, parent.blocking === 0 ? 0 : row.blocking, row.id);
      if (row.blocking !== 0 && (row.status === "pending" || row.status === "in_progress"))
        sqlite
          .query("INSERT OR IGNORE INTO task_deps(task_id,waits_for) VALUES (?,?)")
          .run(row.parent_id, row.id);
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
            parent: [`#${row.parent_number}`, above == null ? null : `#${above}`],
            ...(parent.blocking === 0 && row.blocking !== 0
              ? { type: ["blocking", "non-blocking"] }
              : {}),
          }),
          "lift legacy nested task",
        );
    }
  }
}
// `task_events` has no foreign key on purpose: a task's history outlives the task.
export function openWorkDb(file: string, options: { mode: "write" | "hook" }): WorkDb {
  const hook = options.mode === "hook";
  const fresh = !existsSync(file);
  if (hook && fresh) throw new Error("task store does not exist");
  if (!hook) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const sqlite = new Database(file, { create: !hook, readwrite: true });
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
        repairTaskLayers(sqlite, file);
        sqlite.run("COMMIT");
      } catch (error) {
        sqlite.run("ROLLBACK");
        throw error;
      }
    }
    // A hook only reads: in WAL a writer's open transaction never blocks it, and it sees the last
    // committed state. It never takes the write lock, never changes data and never migrates.
    const minimum = Number(
      sqlite.query<{ value: string }, []>("SELECT value FROM meta WHERE key='min_compatible'").get()
        ?.value ?? WORK_SCHEMA_VERSION,
    );
    if (hook || minimum > WORK_SCHEMA_VERSION) sqlite.run("PRAGMA query_only = ON");
    return {
      sqlite,
      writable: !hook && minimum <= WORK_SCHEMA_VERSION,
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
  if (!db.writable) return { ok: false, why: NEWER_STORE };
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
