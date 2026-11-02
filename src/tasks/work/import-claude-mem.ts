import { Database } from "bun:sqlite";
import { type WorkDb, writeWork } from "./db";
import { allTasks, eventsOf, isOpen, openSubtasks } from "./queries";
import { applySystemClose, type CreateTask, insertTask } from "./store";
import type { Result, Who } from "./types";

interface ImportOptions {
  claudeMemDb: string;
  workDb: WorkDb;
  project: string;
  claudeMemProject: string;
  dryRun: boolean;
  now: number;
}
export interface ImportedTask {
  subject: string;
  description: string;
  status: "pending" | "in_progress";
  list: string;
  parent: string | null;
}
/** A list an earlier import took from claude-mem's own data, dropped now with what is under it. */
export interface DroppedList {
  list: string;
  /** Its task's `#n`. */
  number: number;
  /** The open tasks dropped: the list's own task and every open one under it. */
  tasks: number;
}
export interface ImportResult {
  imported: ImportedTask[];
  dropped: DroppedList[];
  /** claude-mem's own lists in this project, left out (`claudeMemOwnList`). */
  skipped: string[];
}
/**
 * claude-mem's own lists: its My Work view keeps focus areas, rules and owner goals in work
 * state too (claude-mem 15.5.0: `my-focus`, `my-rules`, `owner-goals`, and `owner-goals/<start>`
 * for each past month). They are claude-mem's data, not anyone's work, so the import leaves them.
 */
export const CLAUDE_MEM_OWN_LISTS = ["my-focus", "my-rules", "owner-goals"] as const;
export function claudeMemOwnList(name: string): boolean {
  return CLAUDE_MEM_OWN_LISTS.some((own) => name === own || name.startsWith(`${own}/`));
}
type Fields = Record<string, unknown>;
/** When claude-mem first and last wrote an entry for a list or an item; null without its column. */
interface Dates {
  first: number | null;
  last: number | null;
}
function merge(target: Fields, patch: Fields) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "task") continue;
    if (value === null) delete target[key];
    else target[key] = value;
  }
}
function seen(dates: Dates, at: number | null) {
  if (at === null) return;
  dates.first ??= at;
  dates.last = at;
}
function description(fields: Fields): string {
  return Object.entries(fields)
    .filter(([key]) => key !== "status")
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}
const importer: Who = { sessionId: null, crewId: null, pid: null, procStart: null };
/** What each imported task's history says made it. */
const IMPORTED = "imported from claude-mem's work state";
/** Why a second run drops what an earlier import took from claude-mem's own lists. */
const NOT_WORK = "claude-mem's own list, not work: an earlier import took it by mistake";
/**
 * The import's tasks from claude-mem's own lists: an open top-level task named for one, whose
 * history starts with the import. A task a session made under the same name stays.
 */
function takenByMistake(db: WorkDb, project: string) {
  return allTasks(db, project).filter(
    (task) =>
      task.parentId === null &&
      isOpen(task) &&
      claudeMemOwnList(task.subject) &&
      eventsOf(db, task)[0]?.reason === IMPORTED,
  );
}
export function importClaudeMem(options: ImportOptions): Result<ImportResult> {
  let source: Database | undefined;
  try {
    source = new Database(options.claudeMemDb, { readonly: true });
    const columns = source
      .query<{ name: string }, []>("PRAGMA table_info(work_state_entries)")
      .all()
      .map((r) => r.name);
    if (!["id", "project", "list_name", "fields"].every((c) => columns.includes(c)))
      throw new Error(`work_state_entries has unsupported columns: ${columns.join(", ")}`);
    // claude-mem's own time of each entry, so an old item reads as old (`tasks.staleDays`).
    const at = columns.includes("created_at_epoch") ? "created_at_epoch" : "NULL";
    const lists = new Map<
      string,
      { state: Fields; dates: Dates; items: Map<string, { fields: Fields; dates: Dates }> }
    >();
    for (const row of source
      .query<{ list_name: string; fields: string; at: number | null }, [string]>(
        `SELECT list_name,fields,${at} AS at FROM work_state_entries WHERE project=? ORDER BY id`,
      )
      .all(options.claudeMemProject)) {
      const fields: unknown = JSON.parse(row.fields);
      if (!fields || typeof fields !== "object" || Array.isArray(fields))
        throw new Error(`invalid fields in list: ${row.list_name}`);
      const patch = fields as Fields;
      let list = lists.get(row.list_name);
      if (!list) {
        list = { state: {}, dates: { first: null, last: null }, items: new Map() };
        lists.set(row.list_name, list);
      }
      seen(list.dates, row.at);
      if (typeof patch.task === "string") {
        let item = list.items.get(patch.task);
        if (!item) {
          item = { fields: {}, dates: { first: null, last: null } };
          list.items.set(patch.task, item);
        }
        merge(item.fields, patch);
        seen(item.dates, row.at);
      } else merge(list.state, patch);
    }
    const perform = (): ImportResult => {
      const db = options.workDb;
      const insert = (input: CreateTask, dates: Dates) => {
        const task = insertTask(db, input, importer, options.now, IMPORTED);
        if (dates.first !== null && dates.last !== null)
          db.sqlite
            .query("UPDATE tasks SET created_at=?,updated_at=? WHERE id=?")
            .run(dates.first, dates.last, task.id);
        return task;
      };
      const dropped = takenByMistake(db, options.project).map((task) => {
        const list = {
          list: task.subject,
          number: task.number,
          tasks: 1 + openSubtasks(db, task.id).length,
        };
        if (!options.dryRun)
          applySystemClose(db, task.id, "dropped", NOT_WORK, importer, options.now);
        return list;
      });
      const imported: ImportedTask[] = [];
      const skipped: string[] = [];
      for (const [name, list] of lists) {
        const marker = `imported:claude-mem:${options.claudeMemProject}:${name}`;
        if (list.state.status === "done") continue;
        if (claudeMemOwnList(name)) {
          skipped.push(name);
          continue;
        }
        if (db.sqlite.query("SELECT 1 FROM meta WHERE key=?").get(marker)) continue;
        const task: ImportedTask = {
          subject: name,
          description: description(list.state),
          status: "pending",
          list: name,
          parent: null,
        };
        const parent = options.dryRun
          ? null
          : insert({ project: options.project, ...task }, list.dates);
        imported.push(task);
        for (const [subject, { fields, dates }] of list.items) {
          if (fields.status === "done" || fields.status === "dropped") continue;
          const item: ImportedTask = {
            subject,
            description: description(fields),
            status: fields.status === "doing" ? "in_progress" : "pending",
            list: name,
            parent: name,
          };
          imported.push(item);
          if (!options.dryRun)
            insert({ project: options.project, ...item, parentId: parent?.id ?? null }, dates);
        }
        if (!options.dryRun)
          db.sqlite.query("INSERT INTO meta VALUES (?,?)").run(marker, String(options.now));
      }
      return { imported, dropped, skipped };
    };
    return options.dryRun ? { ok: true, value: perform() } : writeWork(options.workDb, perform);
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  } finally {
    source?.close();
  }
}
