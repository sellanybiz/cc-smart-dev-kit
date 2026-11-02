import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { atomicWrite } from "../../setup/write";
import {
  existingTaskIds,
  isTaskFile,
  planProjectTask,
  scanProjectTasks,
  type TaskSources,
} from "./files";
import { type ProjectTask, type ProjectTaskKind, renderProjectTask } from "./format";
export interface ImportNotesResult {
  tasks: ProjectTask[];
  skipped: { file: string; reason: string }[];
  noDate: string[];
}
export function importNotes(
  options: TaskSources & {
    folder: string;
    dir: string;
    kind: ProjectTaskKind;
    dryRun: boolean;
    since?: string;
  },
): ImportNotesResult {
  const { folder, dir, kind, dryRun, since } = options;
  if (
    since !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(since) ||
      Number.isNaN(Date.parse(since)) ||
      new Date(since).toISOString().slice(0, 10) !== since)
  )
    throw new Error("since must be a calendar date (YYYY-MM-DD)");
  const known = new Set(scanProjectTasks(dir, { archive: true }).tasks.map((task) => task.from));
  const used = existingTaskIds(dir);
  const result: ImportNotesResult = { tasks: [], skipped: [], noDate: [] };
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isFile() || !isTaskFile(entry.name) || entry.name === "TEMPLATE.md") continue;
    const file = join(folder, entry.name);
    const from = `imported from ${file}`;
    if (known.has(from)) continue;
    const created = /^(\d{4}-\d{2}-\d{2})/.exec(entry.name)?.[1];
    if (since && created && created < since) {
      result.skipped.push({ file, reason: `older than ${since}` });
      continue;
    }
    if (!created) result.noDate.push(file);
    const body = readFileSync(file, "utf8");
    const title =
      /^# (.+)\r?$/m.exec(body)?.[1]?.trim() || basename(file, ".md").replace(/[-_]+/g, " ");
    const task = planProjectTask(
      dir,
      { title, kind, from, body, ...(created ? { created } : {}) },
      options,
      used,
    );
    if (!dryRun) {
      mkdirSync(dir, { recursive: true });
      atomicWrite(task.file, renderProjectTask(task), 0o644);
    }
    result.tasks.push(task);
    known.add(from);
  }
  return result;
}
