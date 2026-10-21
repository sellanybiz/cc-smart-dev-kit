/**
 * The worker store: what the kit knows of each lead and worker session, per repository.
 *
 *   <stateDir>/workers/<repo key>/workers/<worker id>.json   one record per worker
 *   <stateDir>/workers/<repo key>/leads/<session id>.json    one record per lead
 *   <stateDir>/workers/<repo key>/reports/<worker id>.json   a worker's hand-back report
 *   <stateDir>/workers/<repo key>/events.jsonl               every change, one line each, append-only
 *   <stateDir>/workers/<repo key>/lock                       held for a moment by each write
 *
 * The key is the review record's (`repoKey` in `src/workflow/reviews.ts`, a hash of the main
 * checkout's folder), so every worktree of a repository shares one store, as it shares one review
 * record. The store is the kit's own state, not a person's file: folders 0700, files 0600, every
 * record written whole through the kit's atomic write (`atomicWrite`), so a reader sees the old
 * record or the new one, never half of one.
 *
 * **The store is the truth about who is a worker.** A name only shows a role (`names.ts`); a
 * session is ever stopped or removed by the kit only when this store records it (D35).
 *
 * **Every write holds the store's own lock** (`withLock` on the repository's folder, a short
 * wait): two leads, or a lead and a worker reporting at once, both land, and no
 * read-modify-write drops the other's change. A state change and its event are written under
 * the same hold, so the events log never misses a change and never runs ahead of a record.
 *
 * **Older and newer kits share it.** A daemon's spare process or a session started before an
 * update runs older code. Every record, event and report carries the schema `version` it was
 * written with (`WORKER_STORE_VERSION`). A reader keeps every field it does not know, reads a
 * state, kind, event type or report status it does not know as itself, and an update by an older
 * kit keeps what a newer one wrote — and the newer version number. A record that lacks a field
 * this kit needs is broken: a single read throws (`WorkerStoreError`, naming the file and the
 * field), and a list names it under `broken` and goes on.
 *
 * Contracts only: no command and no hook reads this yet (the launcher, `worker watch` and the
 * worker hooks are later phases).
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { WorkerKind } from "../models/launch-policy";
import { withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";
import { COMMIT_SHA, repoKey } from "../workflow/reviews";
import { describeIssues } from "../zod-issues";

/** The schema version this kit writes. A record may carry a higher one: read it all the same. */
export const WORKER_STORE_VERSION = 1;

/** How long a write waits for the store's lock: a write takes milliseconds. */
export const STORE_LOCK_WAIT_MS = 3_000;

/**
 * The states a worker is in, in the order a worker usually goes through them:
 *
 * - `queued` — recorded, waiting for a free place (the cap, free memory) or for its phases;
 * - `starting` — its worktree and session are being made;
 * - `working` — its session is running a turn;
 * - `blocked` — it waits on the lead or the person (a question, a permission);
 * - `paused` — it waits for a usage limit to reset;
 * - `quiet` — agent view says working, but its transcript has not moved for a while (an alert);
 * - `done` / `failed` — its turn ended with that report;
 * - `stopped` — its session was stopped (`claude stop`); the conversation stays on disk;
 * - `handoff` — it handed off to a next worker, and ended;
 * - `merged` — the lead merged its branch;
 * - `removed` — its session, worktree and branch are gone.
 */
export const WORKER_STATES = [
  "queued",
  "starting",
  "working",
  "blocked",
  "paused",
  "quiet",
  "done",
  "failed",
  "stopped",
  "handoff",
  "merged",
  "removed",
] as const;

export type WorkerState = (typeof WORKER_STATES)[number];

/** One of `T`, or a word a newer kit wrote, read as itself. */
export type KnownOr<T extends string> = T | (string & {});

/** True when this kit knows `state`; a newer kit's state is read as itself, and is not. */
export function isKnownState(state: string): state is WorkerState {
  return (WORKER_STATES as readonly string[]).includes(state);
}

/** What one line of the events log says happened. */
export const WORKER_EVENT_TYPES = ["created", "state", "step", "report"] as const;
export type WorkerEventType = (typeof WORKER_EVENT_TYPES)[number];

/** How a worker's hand-back ends. */
export const REPORT_STATUSES = ["done", "blocked", "failed", "handoff"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** A store file or record that cannot be used: the message names the file, or what is wrong. */
export class WorkerStoreError extends Error {
  override name = "WorkerStoreError";
}

/**
 * An id that is a plain file name: a worker's id or a lead's session id. A letter or a digit
 * first, so never `.` or `..`, and never a temp file of an atomic write (which starts with `.`).
 */
const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A record's file name, from its id. */
const RECORD_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

/** The id, checked to be a plain file name before it is ever part of a path. */
function fileId(id: string, what: string): string {
  if (!FILE_ID.test(id)) {
    throw new WorkerStoreError(`"${id}" is not a ${what} the store can name a file after`);
  }
  return id;
}

/** One repository's store: `<stateDir>/workers/<repo key>`. */
export function workerStoreDir(stateDir: string, repo: string): string {
  return join(stateDir, "workers", repoKey(repo));
}

/** One worker's record. */
export function workerFile(stateDir: string, repo: string, id: string): string {
  return join(workerStoreDir(stateDir, repo), "workers", `${fileId(id, "worker id")}.json`);
}

/** One lead's record, by its session id. */
export function leadFile(stateDir: string, repo: string, sessionId: string): string {
  return join(workerStoreDir(stateDir, repo), "leads", `${fileId(sessionId, "session id")}.json`);
}

/** One worker's hand-back report. */
export function workerReportFile(stateDir: string, repo: string, id: string): string {
  return join(workerStoreDir(stateDir, repo), "reports", `${fileId(id, "worker id")}.json`);
}

/** The repository's events log. */
export function workerEventsFile(stateDir: string, repo: string): string {
  return join(workerStoreDir(stateDir, repo), "events.jsonl");
}

const text = z.string().min(1);
const version = z.number().int().min(1);
const sha = z.string().regex(COMMIT_SHA, "a full commit sha");
const count = z.number().int().min(0);
/** A word of a known list, or a newer kit's word, read as itself. */
const word = <T extends string>() => text.transform((value): KnownOr<T> => value);

/** The fields of a worker record. */
const workerFields = z.object({
  /** The schema version it was written with. */
  version,
  /** The kit's own id for the worker: a plain file name, known before any session exists. */
  id: z.string().regex(FILE_ID, "a plain file name"),
  /** Its session's name (`workerName`). */
  name: text,
  /** Its session's id; null until the session exists. */
  sessionId: text.nullable(),
  /** The first 8 characters of the session id, as `claude agents` shows it; null until then. */
  shortId: text.nullable(),
  /** The lead that started it: its session id and its name. */
  leadSessionId: text,
  leadName: text,
  /** The repository: its main checkout's folder (the store's key). */
  repo: text,
  /** The plan file the phase belongs to. */
  plan: text,
  /** The phase and the slug its name and branch carry. */
  phase: text,
  slug: text,
  /** Its kind (`WORKER_KINDS`): the model and effort it runs on. */
  kind: word<WorkerKind>(),
  /** The model as the launch named it, the gateway slot that answers it (null: Claude), and the model that does. */
  model: z.looseObject({ named: text, slot: text.nullable(), resolved: text }),
  /** The effort it runs at. */
  effort: text,
  /** Its permission mode (`auto` by default). */
  permissionMode: text,
  /** Its worktree's folder and branch. */
  worktree: text,
  branch: text,
  /** The branch it started from and that branch's commit then; null until it starts. */
  base: z.looseObject({ ref: text, sha }).nullable(),
  /** The files its brief names. */
  files: z.array(text),
  /** Where it is now (`WORKER_STATES`). */
  state: word<WorkerState>(),
  /** The last line its session wrote at the end of a turn; null before the first. */
  lastLine: z.string().nullable(),
  /** Its hand-back report's file; null before it reports. */
  reportPath: text.nullable(),
  /** Its pull request's number; null while it has none. */
  pr: z.number().int().positive().nullable(),
  /** The memory its session's process holds, in MB, when last read; null before that. */
  memoryMb: z.number().min(0).nullable(),
  /** When it was recorded, and last changed (ISO 8601). */
  createdAt: text,
  updatedAt: text,
});

/** A worker record, as written and read (a newer kit's fields kept). */
export const workerRecordSchema = workerFields.loose();
export type WorkerRecord = z.infer<typeof workerFields>;

/** What a caller gives for a new worker: the store adds the version and the times. */
export type NewWorker = Omit<WorkerRecord, "createdAt" | "updatedAt" | "version">;

/** What an update may change: everything but who the worker is and when it was recorded. */
export type WorkerChange = Partial<Omit<WorkerRecord, "createdAt" | "id" | "repo" | "version">>;

/** The fields of a lead record. */
const leadFields = z.object({
  version,
  /** The lead's session id: the record's key. */
  sessionId: z.string().regex(FILE_ID, "a plain file name"),
  /** Its name (`leadName`). */
  name: text,
  /** The repository, by its main checkout's folder. */
  repo: text,
  /** The plan it leads. */
  plan: text,
  /** The folder the lead works in. */
  cwd: text,
  createdAt: text,
  updatedAt: text,
});

export const leadRecordSchema = leadFields.loose();
export type LeadRecord = z.infer<typeof leadFields>;
export type NewLead = Omit<LeadRecord, "createdAt" | "updatedAt" | "version">;

/** The fields of one line of the events log. */
const eventFields = z.object({
  version,
  /** When it happened (ISO 8601). */
  at: text,
  /** What happened (`WORKER_EVENT_TYPES`). */
  type: word<WorkerEventType>(),
  /** The worker it is about: its id, and its name, so a line prints with no lookup. */
  worker: z.string().regex(FILE_ID, "a plain file name"),
  name: text,
  /** The lead's session id, so a lead reads only its own workers' lines; null when none. */
  lead: text.nullable(),
  /** The worker's state after it. */
  state: word<WorkerState>(),
  /** One short line: the step, the report's status, why it failed; null when there is none. */
  text: z.string().nullable(),
});

export const workerEventSchema = eventFields.loose();
export type WorkerEvent = z.infer<typeof eventFields>;
export type NewWorkerEvent = Omit<WorkerEvent, "at" | "version">;

/** One test command a worker ran, and its counts. */
const testRun = z.looseObject({ command: text, passed: count, failed: count, ok: z.boolean() });

/** The fields of a hand-back report: what a worker hands the lead when its phase ends. */
const reportFields = z.object({
  version,
  /** How the phase ended (`REPORT_STATUSES`). */
  status: word<ReportStatus>(),
  phase: text,
  /** The worker's branch and its head, and the base it started from. */
  branch: z.looseObject({ name: text, sha }),
  base: z.looseObject({ ref: text, sha }),
  /** Its pull request's number; null when there is none. */
  pr: z.number().int().positive().nullable(),
  /** The diff against the base, counted. */
  changed: z.looseObject({ files: count, insertions: count, deletions: count }),
  /** Files it changed that its brief did not name. */
  outsideBrief: z.array(text),
  /** The done-check commands, and the whole suite once (null when it never ran). */
  tests: z.looseObject({ targeted: z.array(testRun), full: testRun.nullable() }),
  /** The other checks (type check, lint, the neutrality and duplicate checks). */
  checks: z.array(z.looseObject({ name: text, ok: z.boolean(), note: z.string().nullable() })),
  /** The one review: who ran it, on which model and effort, the commit it read, each finding and its fix. */
  review: z
    .looseObject({
      agent: text,
      model: text,
      effort: text,
      sha,
      findings: z.array(z.looseObject({ finding: text, fix: text })),
    })
    .nullable(),
  /** The docs it changed. */
  docs: z.array(text),
  /** What only the lead may do: text for the lead's own files, a decision. */
  needsLead: z.array(text),
  /** What is still open. */
  open: z.array(text),
  /** The question it is blocked on; null unless it is blocked. */
  question: text.nullable(),
});

/** A blocked report must say what it waits on: the lead cannot answer a question it never saw. */
export const handBackReportSchema = reportFields.loose().superRefine((report, context) => {
  if (report.status === "blocked" && report.question === null) {
    context.addIssue({
      code: "custom",
      message: "a blocked report names the question it waits on",
      path: ["question"],
    });
  }
});
export type HandBackReport = z.infer<typeof reportFields>;

/** What a list could read, and every file it could not, with why. */
export interface Listed<T> {
  broken: Array<{ file: string; why: string }>;
  records: T[];
}

/** An ISO 8601 time from milliseconds. */
function iso(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** True when `error` says the file is not there. */
function notThere(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** What went wrong, in words. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `value` checked against `schema`, or the error that names `file` and each field. */
function checked<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new WorkerStoreError(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}

/** The record in `file`: null when there is none; throws `WorkerStoreError` when it is broken. */
function readRecord<T>(schema: z.ZodType<T>, file: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (notThere(error)) return null;
    throw new WorkerStoreError(`Cannot read ${file}: ${reasonOf(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new WorkerStoreError(`Invalid ${file}: not valid JSON (${reasonOf(error)})`);
  }
  return checked(schema, value, file);
}

/** Every record in `folder`, oldest first (`createdAt`, then the file name); the broken ones named. */
function listRecords<T extends { createdAt: string }>(
  schema: z.ZodType<T>,
  folder: string,
): Listed<T> {
  const listed: Listed<T> = { broken: [], records: [] };
  if (!existsSync(folder)) return listed;
  const found: Array<{ file: string; record: T }> = [];
  for (const name of readdirSync(folder).sort()) {
    if (!RECORD_FILE.test(name)) continue;
    const file = join(folder, name);
    try {
      const record = readRecord(schema, file);
      if (record !== null) found.push({ file, record });
    } catch (error) {
      listed.broken.push({ file, why: reasonOf(error) });
    }
  }
  found.sort(
    (a, b) => a.record.createdAt.localeCompare(b.record.createdAt) || a.file.localeCompare(b.file),
  );
  listed.records = found.map((one) => one.record);
  return listed;
}

/** Writes `value` whole: its folder 0700, the file 0600, through the kit's atomic write. */
function writeRecord(file: string, value: unknown): void {
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

/** Appends one event line (0600 when it makes the file). Call it under the store's lock. */
function appendEvent(stateDir: string, repo: string, event: WorkerEvent): void {
  const file = workerEventsFile(stateDir, repo);
  const line = checked(workerEventSchema, event, file);
  mkdirSync(dirname(file), { mode: 0o700, recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

/** Runs `write` holding the repository's store lock (its folder made 0700 first). */
async function underStoreLock<T>(stateDir: string, repo: string, write: () => T): Promise<T> {
  const folder = workerStoreDir(stateDir, repo);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  return await withLock(folder, write, { waitMs: STORE_LOCK_WAIT_MS });
}

/** The worker `id` of `repo`: null when none is recorded; throws when its record is broken. */
export function readWorker(stateDir: string, repo: string, id: string): WorkerRecord | null {
  return readRecord(workerRecordSchema, workerFile(stateDir, repo, id));
}

/** Every worker of `repo`, oldest first. Never throws for a broken record: it is named. */
export function listWorkers(stateDir: string, repo: string): Listed<WorkerRecord> {
  return listRecords(workerRecordSchema, join(workerStoreDir(stateDir, repo), "workers"));
}

/** Every worker on this machine, of every repository, oldest first: what a machine-wide cap counts. */
export function listAllWorkers(stateDir: string): Listed<WorkerRecord> {
  const root = join(stateDir, "workers");
  const all: Listed<WorkerRecord> = { broken: [], records: [] };
  if (!existsSync(root)) return all;
  for (const key of readdirSync(root).sort()) {
    const one = listRecords(workerRecordSchema, join(root, key, "workers"));
    all.broken.push(...one.broken);
    all.records.push(...one.records);
  }
  all.records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return all;
}

/**
 * Records a new worker, and its `created` event. Refuses an id already recorded for the
 * repository (the first record stays), and a record the schema refuses (nothing is written).
 */
export async function createWorker(
  stateDir: string,
  worker: NewWorker,
  atMs: number,
): Promise<WorkerRecord> {
  const file = workerFile(stateDir, worker.repo, worker.id);
  const at = iso(atMs);
  const record = checked(
    workerRecordSchema,
    { version: WORKER_STORE_VERSION, ...worker, createdAt: at, updatedAt: at },
    file,
  );
  return await underStoreLock(stateDir, worker.repo, () => {
    if (existsSync(file)) {
      throw new WorkerStoreError(
        `a worker "${worker.id}" is already recorded for ${worker.repo} (${file})`,
      );
    }
    writeRecord(file, record);
    appendEvent(stateDir, worker.repo, {
      at,
      lead: record.leadSessionId,
      name: record.name,
      state: record.state,
      text: null,
      type: "created",
      version: WORKER_STORE_VERSION,
      worker: record.id,
    });
    return record;
  });
}

/**
 * Changes worker `id` of `repo`: `change` over its record, `updatedAt` now. Every field this kit
 * does not know is kept, and so is a higher schema version. A changed state is one `state` event,
 * with `text` as its line; any other change is no event. Throws when the worker is not recorded,
 * its record is broken, or the result breaks the schema (then nothing is written).
 */
export async function updateWorker(
  stateDir: string,
  repo: string,
  id: string,
  change: WorkerChange,
  atMs: number,
  text: null | string = null,
): Promise<WorkerRecord> {
  const file = workerFile(stateDir, repo, id);
  return await underStoreLock(stateDir, repo, () => {
    const before = readRecord(workerRecordSchema, file);
    if (before === null) {
      throw new WorkerStoreError(`no worker "${id}" is recorded for ${repo} (${file})`);
    }
    const at = iso(atMs);
    const after = checked(
      workerRecordSchema,
      {
        ...before,
        ...change,
        // Who the worker is never moves: its file is named after its id, its folder after its repo.
        createdAt: before.createdAt,
        id: before.id,
        repo: before.repo,
        updatedAt: at,
        version: Math.max(before.version, WORKER_STORE_VERSION),
      },
      file,
    );
    writeRecord(file, after);
    if (after.state !== before.state) {
      appendEvent(stateDir, repo, {
        at,
        lead: after.leadSessionId,
        name: after.name,
        state: after.state,
        text,
        type: "state",
        version: WORKER_STORE_VERSION,
        worker: after.id,
      });
    }
    return after;
  });
}

/** The lead with session id `sessionId` of `repo`: null when none is recorded. */
export function readLead(stateDir: string, repo: string, sessionId: string): LeadRecord | null {
  return readRecord(leadRecordSchema, leadFile(stateDir, repo, sessionId));
}

/** Every lead of `repo`, oldest first. Never throws for a broken record: it is named. */
export function listLeads(stateDir: string, repo: string): Listed<LeadRecord> {
  return listRecords(leadRecordSchema, join(workerStoreDir(stateDir, repo), "leads"));
}

/**
 * Records a lead, or records it again: a lead already there keeps when it was first recorded and
 * every field this kit does not know; the rest is `lead`.
 */
export async function writeLead(
  stateDir: string,
  lead: NewLead,
  atMs: number,
): Promise<LeadRecord> {
  const file = leadFile(stateDir, lead.repo, lead.sessionId);
  return await underStoreLock(stateDir, lead.repo, () => {
    const before = readRecord(leadRecordSchema, file);
    const at = iso(atMs);
    const record = checked(
      leadRecordSchema,
      {
        ...before,
        ...lead,
        createdAt: before?.createdAt ?? at,
        updatedAt: at,
        version: Math.max(before?.version ?? 0, WORKER_STORE_VERSION),
      },
      file,
    );
    writeRecord(file, record);
    return record;
  });
}

/** Appends one line to the events log of `repo` (a step, a report), under the store's lock. */
export async function appendWorkerEvent(
  stateDir: string,
  repo: string,
  event: NewWorkerEvent,
  atMs: number,
): Promise<WorkerEvent> {
  const line: WorkerEvent = { version: WORKER_STORE_VERSION, at: iso(atMs), ...event };
  await underStoreLock(stateDir, repo, () => appendEvent(stateDir, repo, line));
  return line;
}

/** What one read of the events log found, and where the next read goes on from. */
export interface EventsRead {
  events: WorkerEvent[];
  /** The byte after the last whole line read: pass it to the next read. */
  offset: number;
  /** Whole lines that could not be read (not JSON, or missing a field this kit needs). */
  skipped: number;
}

/**
 * The events of `repo` from byte `offset` on, whole lines only: a line a writer has not finished
 * is left for the next read. A file shorter than `offset` was replaced, so it is read from its
 * start. No log yet: nothing, at offset 0.
 */
export function readWorkerEvents(stateDir: string, repo: string, offset = 0): EventsRead {
  const file = workerEventsFile(stateDir, repo);
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (error) {
    if (notThere(error)) return { events: [], offset: 0, skipped: 0 };
    throw new WorkerStoreError(`Cannot read ${file}: ${reasonOf(error)}`);
  }
  try {
    const size = fstatSync(fd).size;
    const from = offset >= 0 && offset <= size ? offset : 0;
    const bytes = Buffer.alloc(size - from);
    let filled = 0;
    while (filled < bytes.length) {
      const read = readSync(fd, bytes, filled, bytes.length - filled, from + filled);
      if (read === 0) break;
      filled += read;
    }
    const whole = bytes.subarray(0, filled).lastIndexOf(0x0a) + 1;
    const read: EventsRead = { events: [], offset: from + whole, skipped: 0 };
    for (const line of bytes.subarray(0, whole).toString("utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed = workerEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) read.events.push(parsed.data);
        else read.skipped += 1;
      } catch {
        // Not JSON: a line the log cannot use is counted, and the reader goes on.
        read.skipped += 1;
      }
    }
    return read;
  } finally {
    closeSync(fd);
  }
}

/** Writes worker `id`'s hand-back report whole; returns its file. Refuses one the schema refuses. */
export async function writeReport(
  stateDir: string,
  repo: string,
  id: string,
  report: HandBackReport,
): Promise<string> {
  const file = workerReportFile(stateDir, repo, id);
  const value = checked(handBackReportSchema, report, file);
  await underStoreLock(stateDir, repo, () => writeRecord(file, value));
  return file;
}

/** The report in `file`: null when there is none; throws `WorkerStoreError` when it is broken. */
export function readReport(file: string): HandBackReport | null {
  return readRecord(handBackReportSchema, file);
}
