/**
 * The gateway's request history (D51): one row per routed `/v1/messages` request, in
 * `bun:sqlite` (Bun's built-in SQLite: no dependency), in the router's state folder.
 *
 * **Never the conversation.** A row holds the time, the Claude Code session id when the
 * request carried one, the model asked, the slot, the profile the request's path named
 * (`…/p/<profile>`, owner D29), the target that answered, the status, the
 * latency, the next target on a fallback, whether the breaker held it, the four token counts
 * an answer's `usage` reported, and an estimated USD cost. Never a prompt, a system text, a
 * tool, an answer or a key. The safety checks auto mode sends are counted by day in
 * `safety-checks.json` instead (`cc-smart-dev-kit usage`), and `count_tokens` and every other
 * path make no row: the history is the model calls.
 *
 * **Written in the background and batched**, never on an answer's path: `record` only puts
 * the row in a buffer, and one transaction writes the buffer after a short wait or when it
 * is full. A write error is one log line, never a failed request. The database is in WAL
 * mode, so the portal reads it while the router writes it.
 *
 * **Every row is kept 90 days by default** (`HISTORY_RETENTION_DAYS`);
 * `history.retentionDays` in `gateway.json` changes it, and 0 turns the log off (no row is
 * written; old rows stay until the person removes the file or turns it on again). A daily
 * purge deletes older rows, and `auto_vacuum = INCREMENTAL` gives the space back.
 *
 * Why its own file and not a JSON state file: a year of rows is millions of them, and
 * `bun:sqlite` is already there. The design: `docs/gateway.md` § The request history.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { setFileMode } from "../setup/file-mode";
import type { CheckTokens } from "./safety-checks";

/** How many days a row is kept unless `history.retentionDays` says otherwise. */
export const HISTORY_RETENTION_DAYS = 90;

/** The largest `history.retentionDays` a config may hold: ten years, a typo caught. */
export const HISTORY_MAX_RETENTION_DAYS = 3650;

/** How long rows wait for company before one transaction writes them, in milliseconds. */
export const HISTORY_FLUSH_MS = 250;

/** How many rows one transaction writes at most (and when a full buffer goes at once). */
export const HISTORY_BATCH_MAX = 200;

/** How often the purge runs: once a day. */
export const HISTORY_PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

/** How long a writer that failed to open or write waits before trying again. */
const HISTORY_RETRY_MS = 60 * 1000;

/**
 * The database's schema version (`PRAGMA user_version`); raise it when a column changes.
 * 2 since 1.2.0: `profile`, the profile a request came through (owner D29); a database from
 * version 1 keeps every row, and its rows read as the machine's default (`profile` null).
 */
export const HISTORY_SCHEMA_VERSION = 2;

/** What a request did, as one row: metadata only, never a word of the conversation. */
export interface HistoryRow {
  /** When the request came in: milliseconds since the epoch. */
  at: number;
  /** Whether the breaker held it; null where the breaker did not apply. */
  breaker: null | "held" | "not-held";
  /** The estimated USD cost, and whether it is an estimate (Claude's list price). */
  cost: null | { estimated: boolean; usd: number };
  /** The model Claude Code asked for, as it sent the name. */
  model: string;
  /** Milliseconds until the answer's headers (the log line's latency). */
  ms: number;
  /**
   * The target a fallback reached, as the log names it (the one that answered, or the last
   * one tried); null when the request never left its first target.
   */
  nextTarget: null | string;
  /**
   * The profile the request's path named (`…/p/<profile>`, owner D29), as the path spelled
   * it; null for the machine's default (no prefix). A name no profile matched is kept too:
   * the row says where the request came from, and its target says what answered.
   */
  profile: null | string;
  /** The Claude Code session id the request carried (`x-claude-code-session-id`); null when none. */
  session: null | string;
  /** The slot that took it; null when no slot did (Anthropic as sent). */
  slot: null | string;
  /** The status Claude Code got. */
  status: number;
  /** The target that answered, as the log names it. */
  target: string;
  /** The four token counts the answer's `usage` reported; null when it reported none. */
  tokens: null | CheckTokens;
}

/** What the router calls with each finished request; the writer batches the rows. */
export interface HistoryRecorder {
  /** False when `history.retentionDays` is 0: the router skips the row and the usage read. */
  enabled(): boolean;
  record(row: HistoryRow): void;
}

/** The writer: `record`, `flush`, `close`; `pending` and `retentionDays` say what it holds. */
export interface HistoryWriter extends HistoryRecorder {
  close(): void;
  flush(): void;
  pending(): number;
  retentionDays(): number;
}

export interface HistoryWriterOptions {
  /** The database file: `routerPaths().historyDbFile`. */
  file: string;
  /** The log's own line for a write error; one line per distinct error. */
  log: (line: string) => void;
  /** Read for each row, so `history.retentionDays` takes effect without a restart; 0 stops. */
  retentionDays: () => number;
  /** Tests only: how long rows wait for company. */
  flushAfterMs?: number;
  /** Tests only: the clock. */
  now?: () => number;
}

/** The row as the table holds it. */
interface StoredRow {
  at: number;
  breaker: null | string;
  cache_read_tokens: null | number;
  cache_write_tokens: null | number;
  cost_estimated: number;
  cost_usd: null | number;
  id: number;
  input_tokens: null | number;
  model: string;
  ms: number;
  next_target: null | string;
  output_tokens: null | number;
  profile: null | string;
  session: null | string;
  slot: null | string;
  status: number;
  target: string;
}

const CREATE_REQUESTS = `
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    session TEXT,
    model TEXT NOT NULL,
    slot TEXT,
    profile TEXT,
    target TEXT NOT NULL,
    status INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    next_target TEXT,
    breaker TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    cost_usd REAL,
    cost_estimated INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS requests_at ON requests(at);
  CREATE INDEX IF NOT EXISTS requests_session_at ON requests(session, at);
`;

/**
 * Open the database, making it when it is not there: WAL (the portal reads while the router
 * writes), incremental auto-vacuum (a purge gives its space back), and the schema at this
 * version. A file from a newer version is refused, never written over.
 */
function openDatabase(file: string): Database {
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  const db = new Database(file, { create: true });
  // Before any table: a new database takes the mode at once; one made without it needs the
  // one VACUUM below (the file is then rebuilt with the mode). Both are one-time.
  db.run("PRAGMA auto_vacuum = INCREMENTAL");
  const auto = db.query("PRAGMA auto_vacuum").get() as null | { auto_vacuum: number };
  if (auto?.auto_vacuum !== 2) db.run("VACUUM");
  const mode = db.query("PRAGMA journal_mode = WAL").get() as null | { journal_mode: string };
  if (mode?.journal_mode.toLowerCase() !== "wal") {
    // Not fatal: the log still works, and a read while a write runs may wait.
    db.run("PRAGMA busy_timeout = 5000");
  } else {
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA busy_timeout = 5000");
  }
  const version = db.query("PRAGMA user_version").get() as null | { user_version: number };
  if ((version?.user_version ?? 0) > HISTORY_SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `${file} was written by a newer cc-smart-dev-kit (schema ${String(version?.user_version)}, this one reads ${String(HISTORY_SCHEMA_VERSION)})`,
    );
  }
  db.run(CREATE_REQUESTS);
  // A database from before profiles (schema 1) keeps every row: the column is added beside
  // them, and those rows read as the machine's default (`profile` null). `CREATE TABLE IF NOT
  // EXISTS` never changes an existing table, so the added column is checked for by name.
  const columns = db.query("PRAGMA table_info(requests)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "profile")) {
    db.run("ALTER TABLE requests ADD COLUMN profile TEXT");
  }
  if ((version?.user_version ?? 0) < HISTORY_SCHEMA_VERSION) {
    db.run(`PRAGMA user_version = ${String(HISTORY_SCHEMA_VERSION)}`);
  }
  // The row holds a session id and model names: owner-only, like every state file. The
  // folder is already 0700; this keeps the file 600 too (on Windows the profile's ACL is).
  setFileMode(file, 0o600);
  return db;
}

/** True when the file exists: a reader never makes one, and the log may never have run. */
export function historyDbExists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The bytes the history takes on disk: the database and its write-ahead log. 0 when none. */
export function historyDbBytes(file: string): number {
  let bytes = 0;
  for (const path of [file, `${file}-wal`]) {
    try {
      bytes += statSync(path).size;
    } catch {
      // Not there (yet): nothing of it on disk.
    }
  }
  return bytes;
}

/** The retention in words, for `doctor` and `gateway status`: "90 days" or "off". */
export function retentionWords(days: number): string {
  if (days <= 0) return "off (history.retentionDays: 0)";
  return days === 1 ? "1 day" : `${String(days)} days`;
}

/** The row inserted, in the table's column order. */
const INSERT_ROW = `INSERT INTO requests
  (at, session, model, slot, profile, target, status, ms, next_target, breaker,
   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_estimated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertValues(row: HistoryRow): (null | number | string)[] {
  return [
    row.at,
    row.session,
    row.model,
    row.slot,
    row.profile,
    row.target,
    row.status,
    row.ms,
    row.nextTarget,
    row.breaker,
    row.tokens?.input ?? null,
    row.tokens?.output ?? null,
    row.tokens?.cacheRead ?? null,
    row.tokens?.cacheWrite ?? null,
    row.cost?.usd ?? null,
    row.cost?.estimated === true ? 1 : 0,
  ];
}

/**
 * The history writer the router uses. Rows go into a buffer on `record` (no file, no wait)
 * and one transaction writes them after `HISTORY_FLUSH_MS` or at `HISTORY_BATCH_MAX`. The
 * database opens on the first row that is actually written, so a log that is off never makes
 * a file. Every failure is one log line and a dropped batch: a history that cannot be
 * written never fails a request, and never grows the router's memory without bound.
 */
export function createHistoryWriter(options: HistoryWriterOptions): HistoryWriter {
  const flushAfterMs = options.flushAfterMs ?? HISTORY_FLUSH_MS;
  const now = options.now ?? (() => Date.now());
  let buffer: HistoryRow[] = [];
  let db: Database | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  /** The last failure's words, and when to try again: one line per distinct error. */
  let lastError = "";
  let retryAt = 0;
  let lastPurgeAt = 0;

  const fail = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastError) options.log(`ERROR cannot write the request history: ${message}`);
    lastError = message;
    retryAt = now() + HISTORY_RETRY_MS;
    // Keep no more than one batch: a broken database must not grow memory for a day.
    buffer = buffer.slice(-HISTORY_BATCH_MAX);
  };

  /** Deletes the rows past the retention, and gives their space back; at most once a day. */
  const purge = (database: Database, retentionDays: number): void => {
    const at = now();
    if (at - lastPurgeAt < HISTORY_PURGE_EVERY_MS) return;
    lastPurgeAt = at;
    if (retentionDays <= 0) return;
    const cutoff = at - retentionDays * 24 * 60 * 60 * 1000;
    database.run("DELETE FROM requests WHERE at < ?", [cutoff]);
    // Only the pages the delete freed: the rest of the file stays as it is.
    database.run("PRAGMA incremental_vacuum");
  };

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (closed || buffer.length === 0) return;
    const rows = buffer;
    buffer = [];
    if (now() < retryAt) {
      // A recent failure: keep the rows for the next try, still bounded.
      buffer = rows.slice(-HISTORY_BATCH_MAX);
      return;
    }
    try {
      if (db === null) db = openDatabase(options.file);
      const insert = db.prepare(INSERT_ROW);
      const write = db.transaction((batch: HistoryRow[]) => {
        for (const row of batch) insert.run(...insertValues(row));
      });
      write(rows);
      lastError = "";
      purge(db, options.retentionDays());
    } catch (error) {
      fail(error);
    }
  };

  const schedule = (): void => {
    if (timer !== null || closed) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushAfterMs);
    // A pending timer never holds the process open; SIGTERM flushes and closes (`router.ts`).
    timer.unref?.();
  };

  return {
    close() {
      flush();
      if (db !== null) {
        db.close();
        db = null;
      }
      closed = true;
    },
    enabled: () => !closed && options.retentionDays() > 0,
    flush,
    pending: () => buffer.length,
    record(row) {
      if (closed) return;
      const days = options.retentionDays();
      if (days <= 0) return;
      buffer.push(row);
      if (buffer.length >= HISTORY_BATCH_MAX) flush();
      else schedule();
    },
    retentionDays: () => options.retentionDays(),
  };
}

/**
 * A writer for a machine with no history path (a test, an injected router): every call is a
 * no-op. The router gets one when `gateway.json`'s retention is 0.
 */
export function noHistoryWriter(): HistoryWriter {
  return {
    close: () => {},
    enabled: () => false,
    flush: () => {},
    pending: () => 0,
    record: () => {},
    retentionDays: () => 0,
  };
}

/** The columns a read returns, in one place (the read side maps them, `history-read.ts`). */
export const HISTORY_COLUMNS =
  "id, at, session, model, slot, profile, target, status, ms, next_target, breaker, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_estimated";

export type { StoredRow };
