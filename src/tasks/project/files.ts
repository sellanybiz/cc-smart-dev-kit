import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWrite } from "../../setup/write";
import {
  type ProjectTask,
  type ProjectTaskFields,
  parseProjectTask,
  projectTaskSchema,
  renderProjectTask,
} from "./format";

export const DEFAULT_TASKS_DIR = ".claude/tasks";
export interface ProjectTaskSettings {
  dir?: string;
  staleDays?: number;
}
export function projectTasksDir(checkoutRoot: string, settings: ProjectTaskSettings): string {
  const dir = settings.dir ?? DEFAULT_TASKS_DIR;
  const target = resolve(checkoutRoot, dir);
  const rel = relative(checkoutRoot, target);
  if (isAbsolute(dir) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Task folder must be inside the checkout");
  return target;
}
export function isTaskFile(name: string): boolean {
  return !name.startsWith(".") && name !== "README.md" && name.endsWith(".md");
}
export function scanProjectTasks(
  dir: string,
  options: { archive: boolean },
): { tasks: ProjectTask[]; broken: { file: string; why: string }[] } {
  const tasks: ProjectTask[] = [];
  const broken: { file: string; why: string }[] = [];
  for (const folder of options.archive ? [dir, join(dir, "archive")] : [dir]) {
    if (!existsSync(folder)) continue;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isFile() || !isTaskFile(entry.name)) continue;
      const file = join(folder, entry.name);
      const result = parseProjectTask(readFileSync(file, "utf8"), file);
      if (result.ok) tasks.push(result.task);
      else broken.push({ file, why: result.why });
    }
  }
  // A close writes the closed copy into archive/ before it removes the open one, so a crash between
  // the two leaves two copies of one id. The archived copy is kept, the other is reported.
  const archive = join(dir, "archive");
  const kept = new Map<string, ProjectTask>();
  for (const task of tasks) {
    const seen = kept.get(task.id);
    if (seen === undefined) {
      kept.set(task.id, task);
      continue;
    }
    const [keep, drop] = dirname(seen.file) === archive ? [seen, task] : [task, seen];
    kept.set(task.id, keep);
    broken.push({
      file: drop.file,
      why: `a second copy of ${task.id}: the one in archive/ is kept; remove this file`,
    });
  }
  return { tasks: [...kept.values()], broken };
}
export type ProjectTaskInput = Pick<ProjectTaskFields, "title" | "kind"> &
  Partial<Omit<ProjectTaskFields, "id" | "title" | "kind">> & { body?: string };
export type ProjectTaskPatch = Partial<
  Pick<
    ProjectTaskFields,
    "title" | "kind" | "when" | "weight" | "flags" | "from" | "refs" | "evidence"
  >
> & { body?: string };
export interface TaskSources {
  now: Date;
  random: () => number;
}
export function taskDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const ID_ATTEMPTS = 100;
export function planProjectTask(
  dir: string,
  input: ProjectTaskInput,
  sources: TaskSources,
  used: Set<string>,
): ProjectTask {
  let id = "";
  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
    id = "T-";
    for (let index = 0; index < 6; index++) {
      const n = sources.random();
      if (!Number.isFinite(n) || n < 0 || n >= 1)
        throw new Error("random must return a number in [0, 1)");
      id += BASE32[Math.floor(n * BASE32.length)];
    }
    if (!used.has(id)) break;
    id = "";
  }
  if (!id) throw new Error("Could not allocate a unique project task id");
  const { body = "", ...fields } = input;
  const validated = projectTaskSchema.parse({
    ...fields,
    id,
    status: "open",
    created: fields.created ?? taskDate(sources.now),
  });
  const slug =
    validated.title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50)
      .replace(/-$/, "") || "task";
  used.add(id);
  return { ...validated, body, file: join(dir, `${id}-${slug}.md`) };
}
export function existingTaskIds(dir: string): Set<string> {
  const ids = new Set(scanProjectTasks(dir, { archive: true }).tasks.map((task) => task.id));
  for (const folder of [dir, join(dir, "archive")])
    if (existsSync(folder))
      for (const name of readdirSync(folder)) {
        const id = /^(T-[a-z2-7]{6})(?:-|\.md$)/.exec(name)?.[1];
        if (id) ids.add(id);
      }
  return ids;
}
function save(task: ProjectTask): ProjectTask {
  atomicWrite(task.file, renderProjectTask(task), 0o644);
  return task;
}
export function createProjectTask(
  dir: string,
  input: ProjectTaskInput,
  sources: TaskSources,
): ProjectTask {
  const task = planProjectTask(dir, input, sources, existingTaskIds(dir));
  mkdirSync(dir, { recursive: true });
  return save(task);
}
function find(dir: string, id: string): ProjectTask {
  const matches = scanProjectTasks(dir, { archive: true }).tasks.filter((task) => task.id === id);
  const match = matches[0];
  if (matches.length !== 1 || !match)
    throw new Error(
      matches.length ? `Duplicate project task id: ${id}` : `Project task not found: ${id}`,
    );
  return match;
}
export function updateProjectTask(
  dir: string,
  id: string,
  patch: ProjectTaskPatch,
  _now: Date,
): ProjectTask {
  const task = find(dir, id);
  const merged = { ...task, ...patch };
  const { body, file, ...fields } = merged;
  return save({ ...projectTaskSchema.parse(fields), body, file });
}
function withNote(task: ProjectTask, text: string, now: Date): ProjectTask {
  // Indent subsequent lines so one note stays one Markdown list entry.
  const line = `- ${taskDate(now)} ${text.replace(/\r?\n/g, "\n  ")}\n`;
  const heading = /^## Log\s*$/m.exec(task.body);
  if (!heading)
    return {
      ...task,
      body: `${task.body}${task.body.endsWith("\n") || !task.body ? "" : "\n"}\n## Log\n${line}`,
    };
  const start = heading.index + heading[0].length;
  const next = /^## /m.exec(task.body.slice(start));
  const end = next ? start + next.index : task.body.length;
  const before = task.body.slice(0, end);
  return {
    ...task,
    body: `${before}${before.endsWith("\n") ? "" : "\n"}${line}${task.body.slice(end)}`,
  };
}
export function addProjectNote(dir: string, id: string, text: string, now: Date): ProjectTask {
  return save(withNote(find(dir, id), text, now));
}
export function closeProjectTask(
  dir: string,
  id: string,
  options: { status: "done" | "dropped"; evidence?: string; note?: string },
  now: Date,
): ProjectTask {
  const task = find(dir, id);
  const closed = withNote(
    {
      ...task,
      status: options.status,
      closed: taskDate(now),
      ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    },
    options.note ?? `${options.status}${options.evidence ? `: ${options.evidence}` : ""}`,
    now,
  );
  const archive = join(dir, "archive");
  mkdirSync(archive, { recursive: true });
  const destination = join(archive, basename(task.file));
  if (destination !== task.file && existsSync(destination))
    throw new Error(`Archive task already exists: ${destination}`);
  // The closed copy goes into archive/ first; only then is the open file removed. A crash between
  // the two leaves two copies, which the scan resolves to the archived one (never a lost task).
  const saved = save({ ...closed, file: destination });
  if (destination !== task.file) rmSync(task.file, { force: true });
  return saved;
}
