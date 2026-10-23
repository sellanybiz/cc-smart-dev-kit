/**
 * A Claude Code session's to-do list: where Claude Code keeps it, what the kit reads out of
 * one, and the one cache a hook keeps between two calls.
 *
 * **Where it is.** `<config dir>/tasks/<list id>/`, one `*.json` file per task, a `.lock`
 * beside them, and — once a task has been removed — a `.highwatermark`. A file holds
 * `{id, subject, description, activeForm, status, blocks, blockedBy}`; `status` is `pending`,
 * `in_progress` or `completed`; a removed task's file is gone. `activeForm` is written only
 * when the call gave one. The list id is the session's id, or `CLAUDE_CODE_TASK_LIST_ID` when
 * the session sets it (Claude Code's way to share one list across sessions). All of it is
 * proved live on 2.1.309, and a subagent's own TaskCreate writes into **its parent session's**
 * folder (`docs/claude-code-contract.md` § The to-do list).
 *
 * **Why one reader.** Three parts ask the same three questions — is there a list at all, what
 * is on it, and what is still open — and each needs the same answer, so they share this
 * module: `crew-role` (a crew session's first edit waits for its list), `crew report` (a
 * `done` report waits for the list to be finished) and `lead-notes` (a lead with no list is
 * reminded, never blocked).
 *
 * **The cache.** A hook runs once per call, and re-reading the folder on every edit of a long
 * phase is the same work for the same answer. The first `crew-role` answer that sees a task
 * file records the list id it saw (`taskGateFile`), in the crew session's own store folder
 * beside its brief: the files there are the crew session's own, named through the store's one
 * checked-id helper. A cache that cannot be written is only a slower next call.
 *
 * Nothing here writes into Claude Code's folder: the list is Claude's, and the kit reads it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crewFilesDir, writeStoreFile } from "./store";

/** The variable that gives a session's list a name of its own (`CLAUDE_CODE_TASK_LIST_ID`). */
export const TASK_LIST_ENV = "CLAUDE_CODE_TASK_LIST_ID";

/** The statuses a task is still open in; a task in any other is finished, or not ours to hold. */
export const OPEN_TASK_STATUSES = ["pending", "in_progress"] as const;

/** One task, as far as the kit reads it: what to name it by, and where it stands. */
export interface SessionTask {
  /** The task's number as Claude Code names it (`id` in its file, else the file's own name). */
  id: string;
  subject: string;
  status: string;
}

/**
 * What one read of a session's task folder found.
 *
 * - `none`: there is no such folder, so no list was ever made (or its last task took it away).
 * - `unreadable`: the folder is there and cannot be read. Nothing can be said about the list.
 * - `read`: the folder's task files. `files` counts them all, `tasks` the ones that read as a
 *   task: a file that is not JSON, or names no status, is counted and skipped, because the kit
 *   cannot say what it holds.
 */
export type SessionTasks =
  | { state: "none" }
  | { state: "unreadable" }
  | { files: number; state: "read"; tasks: SessionTask[] };

/** The folder Claude Code keeps a session's tasks in: `<config dir>/tasks/<list id>`. */
export function sessionTasksDir(claudeConfigDir: string, listId: string): string {
  return join(claudeConfigDir, "tasks", listId);
}

/**
 * The name of the list a session works on: `CLAUDE_CODE_TASK_LIST_ID` when the session's
 * environment sets it (Claude Code then keeps that one folder for every session that names
 * it), else the session's own id. "" when neither is known, and then no list can be found.
 */
export function taskListId(
  env: Record<string, string | undefined>,
  sessionId: null | string,
): string {
  const named = env[TASK_LIST_ENV]?.trim() ?? "";
  return named === "" ? (sessionId?.trim() ?? "") : named;
}

/** `a` before `b` by their numbers when both are numbers, else by their own text. */
function byNumber(a: SessionTask, b: SessionTask): number {
  const one = Number(a.id);
  const other = Number(b.id);
  if (Number.isInteger(one) && Number.isInteger(other)) return one - other;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One task file, or null when it does not read as a task. */
function taskOf(file: string, name: string): SessionTask | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Read while Claude Code was writing it, or not a task file: the next read says.
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  const status = typeof fields.status === "string" ? fields.status : "";
  if (status === "") return null;
  return {
    id: typeof fields.id === "string" && fields.id !== "" ? fields.id : name.replace(/\.json$/, ""),
    status,
    subject: typeof fields.subject === "string" ? fields.subject : "",
  };
}

/** A session's task folder, read: the folder that is not there is `none`, one it cannot read `unreadable`. */
export function readSessionTasks(claudeConfigDir: string, listId: string): SessionTasks {
  if (listId === "") return { state: "none" };
  const folder = sessionTasksDir(claudeConfigDir, listId);
  let names: string[];
  try {
    names = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
  } catch (error) {
    // No folder is no list. Anything else — a permission, a file where the folder belongs —
    // is a list the kit cannot read, and no caller may read that as an empty one.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "none" };
    return { state: "unreadable" };
  }
  const tasks: SessionTask[] = [];
  for (const name of names) {
    const task = taskOf(join(folder, name), name);
    if (task !== null) tasks.push(task);
  }
  return { files: names.length, state: "read", tasks: tasks.sort(byNumber) };
}

/**
 * The tasks still open: `pending` or `in_progress`. A word a newer Claude Code writes is not
 * one the kit knows, so it holds nothing: a check that cannot be made lets the report through.
 */
export function openTasks(tasks: readonly SessionTask[]): SessionTask[] {
  return tasks.filter((task) => (OPEN_TASK_STATUSES as readonly string[]).includes(task.status));
}

/** What a hook remembers about a list it has already seen. */
export interface TaskGate {
  /** The list id the task file was found under; a changed id is a list not seen yet. */
  listId: string;
}

/** The cache's file: the crew session's own store folder, beside its brief and settings. */
export function taskGateFile(stateDir: string, repo: string, id: string): string {
  return join(crewFilesDir(stateDir, repo, id), "task-gate.json");
}

/**
 * The gate recorded for crew session `id`, or null when there is none it can read. An id the
 * store refuses is no gate either: this runs before every edit, and a throw here would reach the
 * frame as the hook's own crash.
 */
export function readTaskGate(stateDir: string, repo: string, id: string): TaskGate | null {
  let text: string;
  try {
    text = readFileSync(taskGateFile(stateDir, repo, id), "utf8");
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const listId = (value as Record<string, unknown>).listId;
  return typeof listId === "string" && listId !== "" ? { listId } : null;
}

/** Records that crew session `id`'s list was seen. A write that fails throws: the caller decides. */
export function writeTaskGate(stateDir: string, repo: string, id: string, gate: TaskGate): void {
  writeStoreFile(taskGateFile(stateDir, repo, id), `${JSON.stringify({ version: 1, ...gate })}\n`);
}
