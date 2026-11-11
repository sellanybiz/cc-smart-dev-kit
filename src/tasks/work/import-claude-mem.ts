import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { type WorkDb, writeWork } from "./db";
import { allTasks, eventsOf, isOpen, openSubtasks } from "./queries";
import { applySystemClose, type CreateTask, insertTask } from "./store";
import { type Result, SUBJECT_LIMIT, type Who, type WorkTask } from "./types";

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
/** A list an earlier import took from claude-mem's own data. */
export interface MistakenList {
  list: string;
  /** Its task's `#n`. */
  number: number;
  /** The open tasks in it: the list's own task and every open one under it. */
  tasks: number;
  /** The open ones a session made or changed, which may be someone's work: empty to drop it. */
  touched: number[];
}
export interface ImportResult {
  imported: ImportedTask[];
  /** Dropped now, with every open task under it. */
  dropped: MistakenList[];
  /** Left open, because a session made or changed a task in it. */
  kept: MistakenList[];
  /** claude-mem's own lists in this project, left out (`claudeMemOwnList`). */
  skipped: string[];
  /** How many open lists claude-mem holds for the project, its own among them. */
  open: number;
}
/**
 * claude-mem's own lists, the ones its My Work view keeps out of work (claude-mem 15.5.0):
 * `my-focus`, `my-rules` and `agent-lifecycle` by their exact names, and `owner-goals` with an
 * `owner-goals/<start>` list for each past month. They are claude-mem's data, not anyone's work.
 */
export const CLAUDE_MEM_OWN_LISTS = ["my-focus", "my-rules", "agent-lifecycle", "owner-goals"];
const OWNER_GOALS = "owner-goals";
export function claudeMemOwnList(name: string): boolean {
  return CLAUDE_MEM_OWN_LISTS.includes(name) || name.startsWith(`${OWNER_GOALS}/`);
}
/** The statuses claude-mem reads as closed, for an item and for a list. */
const CLOSED = new Set(["done", "dropped", "completed", "failed"]);
type Fields = Record<string, unknown>;
/**
 * When claude-mem first and last wrote an entry; null without its column. Its rows are read in
 * its own order, which is the order of their times, so the first row seen is the earliest.
 */
interface Dates {
  first: number | null;
  last: number | null;
}
interface ClaudeMemList {
  state: Fields;
  dates: Dates;
  items: Map<string, { fields: Fields; dates: Dates }>;
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
/** A name longer than a subject may be is cut, and kept whole at the top of the description. */
function named(name: string, text: string): { subject: string; description: string } {
  const subject = name.trim();
  if (subject.length <= SUBJECT_LIMIT) return { subject, description: text };
  // Whole characters only: a cut through an emoji would leave half of it.
  let cut = "";
  for (const character of subject) {
    if (cut.length + character.length > SUBJECT_LIMIT - 1) break;
    cut += character;
  }
  return {
    subject: `${cut.trimEnd()}…`,
    description: [`name: ${subject}`, text].filter(Boolean).join("\n"),
  };
}
const importer: Who = { sessionId: null, pid: null, procStart: null };
/** What each imported task's history says made it. */
const IMPORTED = "imported from claude-mem's work state";
/** Why a second run drops what an earlier import took from claude-mem's own lists. */
const NOT_WORK = "claude-mem's own list, not work: an earlier import took it by mistake";
/** True while only the import ever wrote the task: no session made, changed or noted it. */
function importOnly(db: WorkDb, task: WorkTask): boolean {
  return eventsOf(db, task).every(
    (event) => event.reason === IMPORTED || event.reason === "lift legacy nested task",
  );
}
/**
 * The import's tasks from claude-mem's own lists: an open top-level task named for one, whose
 * history starts with the import. A task a session made under the same name is not one.
 */
function takenByMistake(db: WorkDb, project: string): MistakenList[] {
  return allTasks(db, project)
    .filter(
      (task) =>
        task.parentId === null &&
        isOpen(task) &&
        claudeMemOwnList(task.subject) &&
        eventsOf(db, task)[0]?.reason === IMPORTED,
    )
    .map((task) => {
      const nested = openSubtasks(db, task.id);
      const lifted = allTasks(db, project).filter(
        (t) =>
          isOpen(t) &&
          eventsOf(db, t).some(
            (e) =>
              e.reason === "lift legacy nested task" && e.changes.parent?.[0] === `#${task.number}`,
          ),
      );
      const open = [task, ...new Map([...nested, ...lifted].map((t) => [t.id, t])).values()];
      return {
        list: task.subject,
        number: task.number,
        tasks: open.length,
        touched: open.filter((t) => !importOnly(db, t)).map((t) => t.number),
      };
    });
}
/**
 * claude-mem's lists for one project, folded as claude-mem folds them (15.5.0): its row order,
 * its case-blind project match, and an entry with no item name as the list's own record. No
 * file (claude-mem uninstalled) and no work-state table (a claude-mem that never kept one) are
 * no lists: the repair of an earlier import still runs.
 */
function readLists(file: string, project: string): Map<string, ClaudeMemList> {
  const lists = new Map<string, ClaudeMemList>();
  if (!existsSync(file)) return lists;
  const source = new Database(file, { readonly: true });
  try {
    const columns = source
      .query<{ name: string }, []>("PRAGMA table_info(work_state_entries)")
      .all()
      .map((r) => r.name);
    if (columns.length === 0) return lists;
    if (!["id", "project", "list_name", "fields"].every((c) => columns.includes(c)))
      throw new Error(`work_state_entries has unsupported columns: ${columns.join(", ")}`);
    // claude-mem's own time of each entry, so an old item reads as old (`tasks.staleDays`).
    const at = columns.includes("created_at_epoch") ? "created_at_epoch" : "NULL";
    // claude-mem breaks a tie on its own device id first, which only it knows: '' stands in.
    const synced = ["created_at_epoch", "origin_device_id", "origin_local_id"].every((c) =>
      columns.includes(c),
    );
    const order = synced
      ? "created_at_epoch, COALESCE(origin_device_id, ''), COALESCE(CAST(origin_local_id AS INTEGER), id)"
      : "id";
    for (const row of source
      .query<{ list_name: string; fields: string; at: number | null }, [string]>(
        `SELECT list_name,fields,${at} AS at FROM work_state_entries WHERE project=? COLLATE NOCASE ORDER BY ${order}`,
      )
      .all(project)) {
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
      if (typeof patch.task === "string" && patch.task.trim() !== "") {
        let item = list.items.get(patch.task);
        if (!item) {
          item = { fields: {}, dates: { first: null, last: null } };
          list.items.set(patch.task, item);
        }
        merge(item.fields, patch);
        seen(item.dates, row.at);
      } else merge(list.state, patch);
    }
    return lists;
  } finally {
    source.close();
  }
}
export function importClaudeMem(options: ImportOptions): Result<ImportResult> {
  let lists: Map<string, ClaudeMemList>;
  try {
    lists = readLists(options.claudeMemDb, options.claudeMemProject);
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  const db = options.workDb;
  const insert = (input: CreateTask, list: string, dates: Dates) => {
    let task: WorkTask;
    try {
      task = insertTask(db, input, importer, options.now, IMPORTED);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new Error(`claude-mem's list "${list}": ${why}`);
    }
    if (dates.first !== null && dates.last !== null)
      db.sqlite
        .query("UPDATE tasks SET created_at=?,updated_at=? WHERE id=?")
        .run(dates.first, dates.last, task.id);
    return task;
  };
  const perform = (): ImportResult => {
    const mistaken = takenByMistake(db, options.project);
    const dropped = mistaken.filter((list) => list.touched.length === 0);
    for (const list of dropped) {
      const task = allTasks(db, options.project).find((t) => t.number === list.number);
      if (task) {
        const lifted = allTasks(db, options.project).filter(
          (t) =>
            isOpen(t) &&
            eventsOf(db, t).some(
              (e) =>
                e.reason === "lift legacy nested task" &&
                e.changes.parent?.[0] === `#${task.number}`,
            ),
        );
        for (const child of lifted)
          applySystemClose(db, child.id, "dropped", NOT_WORK, importer, options.now);
        applySystemClose(db, task.id, "dropped", NOT_WORK, importer, options.now);
      }
    }
    const imported: ImportedTask[] = [];
    const skipped: string[] = [];
    let open = 0;
    for (const [name, list] of lists) {
      if (CLOSED.has(String(list.state.status))) continue;
      open += 1;
      if (claudeMemOwnList(name)) {
        skipped.push(name);
        continue;
      }
      const marker = `imported:claude-mem:${options.claudeMemProject}:${name}`;
      // The project matches in any case, as the read does; the list name exactly.
      const seenBefore = db.sqlite
        .query<{ key: string }, [string]>("SELECT key FROM meta WHERE key=? COLLATE NOCASE")
        .all(marker)
        .some((row) => row.key.endsWith(`:${name}`));
      if (seenBefore) continue;
      const task: ImportedTask = {
        ...named(name, description(list.state)),
        status: "pending",
        list: name,
        parent: null,
      };
      const slug = `import-${crypto.randomUUID()}`;
      const plan = insert(
        { project: options.project, ...task, kind: "plan", plan: slug },
        name,
        list.dates,
      );
      const parent = insert(
        {
          project: options.project,
          subject: "Imported items",
          kind: "phase",
          phase: "A",
          plan: slug,
          parentId: plan.id,
        },
        name,
        list.dates,
      );
      imported.push(task);
      for (const [itemName, { fields, dates }] of list.items) {
        if (CLOSED.has(String(fields.status))) continue;
        const item: ImportedTask = {
          ...named(itemName, description(fields)),
          status: fields.status === "doing" ? "in_progress" : "pending",
          list: name,
          parent: task.subject,
        };
        insert({ project: options.project, ...item, plan: slug, parentId: parent.id }, name, dates);
        imported.push(item);
      }
      db.sqlite.query("INSERT INTO meta VALUES (?,?)").run(marker, String(options.now));
    }
    return {
      imported,
      dropped,
      kept: mistaken.filter((list) => list.touched.length > 0),
      skipped,
      open,
    };
  };
  // A dry run makes every write and rolls them back: it meets each rule the real run meets.
  return writeWork(db, perform, { rehearse: options.dryRun });
}
