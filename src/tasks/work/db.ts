import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../../build-info/names";
import type { Result } from "./types";
export const WORK_SCHEMA_VERSION = 1;
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
`;
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
/** All writes share the compatibility check and the same short transaction. */
export function writeWork<T>(db: WorkDb, body: () => T): Result<T> {
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
    db.sqlite.run("COMMIT");
    return { ok: true, value };
  } catch (error) {
    if (began) db.sqlite.run("ROLLBACK");
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}
