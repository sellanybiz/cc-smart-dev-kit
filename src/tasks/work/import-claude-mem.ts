import { Database } from "bun:sqlite";
import { type WorkDb, writeWork } from "./db";
import { type CreateTask, insertTask } from "./store";
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
type Fields = Record<string, unknown>;
function merge(target: Fields, patch: Fields) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "task") continue;
    if (value === null) delete target[key];
    else target[key] = value;
  }
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
export function importClaudeMem(options: ImportOptions): Result<ImportedTask[]> {
  let source: Database | undefined;
  try {
    source = new Database(options.claudeMemDb, { readonly: true });
    const columns = source
      .query<{ name: string }, []>("PRAGMA table_info(work_state_entries)")
      .all()
      .map((r) => r.name);
    if (!["id", "project", "list_name", "fields"].every((c) => columns.includes(c)))
      throw new Error(`work_state_entries has unsupported columns: ${columns.join(", ")}`);
    const lists = new Map<string, { state: Fields; items: Map<string, Fields> }>();
    for (const row of source
      .query<{ list_name: string; fields: string }, [string]>(
        "SELECT list_name,fields FROM work_state_entries WHERE project=? ORDER BY id",
      )
      .all(options.claudeMemProject)) {
      const fields: unknown = JSON.parse(row.fields);
      if (!fields || typeof fields !== "object" || Array.isArray(fields))
        throw new Error(`invalid fields in list: ${row.list_name}`);
      const patch = fields as Fields;
      let list = lists.get(row.list_name);
      if (!list) {
        list = { state: {}, items: new Map() };
        lists.set(row.list_name, list);
      }
      if (typeof patch.task === "string") {
        let item = list.items.get(patch.task);
        if (!item) {
          item = {};
          list.items.set(patch.task, item);
        }
        merge(item, patch);
      } else merge(list.state, patch);
    }
    const perform = () => {
      const imported: ImportedTask[] = [];
      for (const [name, list] of lists) {
        const marker = `imported:claude-mem:${options.claudeMemProject}:${name}`;
        if (
          list.state.status === "done" ||
          options.workDb.sqlite.query("SELECT 1 FROM meta WHERE key=?").get(marker)
        )
          continue;
        const task: ImportedTask = {
          subject: name,
          description: description(list.state),
          status: "pending",
          list: name,
          parent: null,
        };
        const parent = options.dryRun
          ? null
          : insertTask(
              options.workDb,
              { project: options.project, ...task },
              importer,
              options.now,
              IMPORTED,
            );
        imported.push(task);
        for (const [subject, fields] of list.items) {
          if (fields.status === "done" || fields.status === "dropped") continue;
          const item: ImportedTask = {
            subject,
            description: description(fields),
            status: fields.status === "doing" ? "in_progress" : "pending",
            list: name,
            parent: name,
          };
          imported.push(item);
          if (!options.dryRun) {
            const input: CreateTask = {
              project: options.project,
              ...item,
              parentId: parent?.id ?? null,
            };
            insertTask(options.workDb, input, importer, options.now, IMPORTED);
          }
        }
        if (!options.dryRun)
          options.workDb.sqlite
            .query("INSERT INTO meta VALUES (?,?)")
            .run(marker, String(options.now));
      }
      return imported;
    };
    return options.dryRun ? { ok: true, value: perform() } : writeWork(options.workDb, perform);
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  } finally {
    source?.close();
  }
}
