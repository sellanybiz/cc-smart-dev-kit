/**
 * The deploy task files on disk: `<tasks.dir>/<env>/<id>-<slug>.md`, and the closed ones in
 * `<tasks.dir>/<env>/archive/`. This file scans, creates, updates, closes and reopens them. Git
 * facts live in `branch.ts`, the release gate in `release.ts`, the findings in `check.ts`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWrite } from "../../setup/write";
import {
  DEPLOY_ENVS,
  type DeployEnv,
  type DeployTask,
  type DeployTaskFields,
  deployIdOfFileName,
  deployTaskSchema,
  parseDeployTask,
  renderDeployTask,
  taskInstant,
} from "./format";

export const DEFAULT_TASKS_DIR = ".claude/tasks";
export interface DeployTaskSettings {
  dir?: string;
  staleDays?: number;
}
export function deployTasksDir(checkoutRoot: string, settings: DeployTaskSettings): string {
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
const ARCHIVE = "archive";
/** The folder of an environment's open tasks. */
export function envFolder(dir: string, env: DeployEnv): string {
  return join(dir, env);
}
/** True when a task file sits in an `archive/` folder: the home of closed tasks. */
export function isArchived(file: string): boolean {
  return basename(dirname(file)) === ARCHIVE;
}
/** The folder of an environment's closed tasks. */
export function archiveFolder(dir: string, env: DeployEnv): string {
  return join(dir, env, ARCHIVE);
}

export interface BrokenTaskFile {
  file: string;
  why: string;
}
/** One id that two differently named files claim: ambiguous, so no write may pick one. */
export interface DuplicateTaskId {
  id: string;
  files: string[];
}
export interface TaskScan {
  /** Every readable task. A duplicate id keeps all its files: each is listed, none is chosen. */
  tasks: DeployTask[];
  broken: BrokenTaskFile[];
  duplicates: DuplicateTaskId[];
}

/**
 * Reads every task file under the env folders (and their `archive/` when asked). A file whose
 * env, folder and id prefix disagree is broken. A close writes the closed copy into `archive/`
 * before it removes the open one, so a crash between the two leaves two copies of one id with
 * one file name: the archived copy is kept and the other is reported. One id under two
 * different file names is a `duplicate`: both stay listed and `findDeployTask` refuses the id.
 */
export function scanDeployTasks(dir: string, options: { archive: boolean }): TaskScan {
  const found: DeployTask[] = [];
  const broken: BrokenTaskFile[] = [];
  for (const env of DEPLOY_ENVS) {
    for (const folder of options.archive
      ? [envFolder(dir, env), archiveFolder(dir, env)]
      : [envFolder(dir, env)]) {
      if (!existsSync(folder)) continue;
      for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (!entry.isFile() || !isTaskFile(entry.name)) continue;
        const file = join(folder, entry.name);
        const result = parseDeployTask(readFileSync(file, "utf8"), file, env);
        if (result.ok) found.push(result.task);
        else broken.push({ file, why: result.why });
      }
    }
  }
  const byId = new Map<string, DeployTask[]>();
  for (const task of found) byId.set(task.id, [...(byId.get(task.id) ?? []), task]);
  const tasks: DeployTask[] = [];
  const duplicates: DuplicateTaskId[] = [];
  for (const copies of byId.values()) {
    const first = copies[0];
    if (!first) continue;
    if (new Set(copies.map((task) => basename(task.file))).size > 1) {
      duplicates.push({ id: first.id, files: copies.map((task) => task.file) });
      tasks.push(...copies);
      continue;
    }
    const kept = copies.find((task) => isArchived(task.file)) ?? first;
    tasks.push(kept);
    for (const task of copies)
      if (task !== kept)
        broken.push({
          file: task.file,
          why: `a second copy of ${task.id}: the one in archive/ is kept; remove this file`,
        });
  }
  return { tasks, broken, duplicates };
}

/**
 * The files of the 4.x layout: `*.md` directly in the tasks folder. They are not read since 5.0.0;
 * a surface counts and names them so the person recreates or deletes each.
 */
export function oldTaskFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isTaskFile(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

export type DeployTaskInput = Pick<DeployTaskFields, "title" | "env" | "deploy" | "type"> &
  Partial<Pick<DeployTaskFields, "twin" | "flags" | "from" | "refs">> & { body?: string };
export type DeployTaskPatch = Partial<
  Pick<DeployTaskFields, "title" | "deploy" | "type" | "flags" | "from" | "refs">
> & { body?: string };
export interface TaskSources {
  now: Date;
  /** Tests only: runs after an id is chosen and before its file is claimed, to play another creator. */
  beforeClaim?: (task: DeployTask) => void;
}

/** `<env>-<YYYYMMDD>-<HHMMSS>` in UTC from `now`, with `-2`, `-3` while `used` holds it. */
export function newDeployId(env: DeployEnv, now: Date, used: ReadonlySet<string>): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  const base = `${env}-${stamp}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The ids already taken in one environment: the front matter's ids (open and archived), plus the
 * id each file name starts with. The front matter is the authority for an id; the file names only
 * reserve one, so a file that does not parse still keeps its id from being reused.
 */
export function takenDeployIds(dir: string, env: DeployEnv): Set<string> {
  const ids = new Set(
    scanDeployTasks(dir, { archive: true })
      .tasks.filter((task) => task.env === env)
      .map((task) => task.id),
  );
  for (const folder of [envFolder(dir, env), archiveFolder(dir, env)])
    if (existsSync(folder))
      for (const name of readdirSync(folder)) {
        const id = deployIdOfFileName(name);
        if (id) ids.add(id);
      }
  return ids;
}

function slugOf(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50)
      .replace(/-$/, "") || "task"
  );
}

export function planDeployTask(
  dir: string,
  input: DeployTaskInput,
  sources: TaskSources,
  used: Set<string>,
): DeployTask {
  const id = newDeployId(input.env, sources.now, used);
  const { body = "", ...fields } = input;
  const validated = deployTaskSchema.parse({
    ...fields,
    id,
    status: "open",
    created: taskInstant(sources.now),
  });
  used.add(id);
  return {
    ...validated,
    body,
    file: join(envFolder(dir, validated.env), `${id}-${slugOf(validated.title)}.md`),
  };
}

function save(task: DeployTask): DeployTask {
  atomicWrite(task.file, renderDeployTask(task), 0o644);
  return task;
}

/** How many times a create picks a new id after losing a race for one. */
const CLAIM_ATTEMPTS = 5;

/**
 * Claims a new task's file: an exclusive create, so a name another creator already took is never
 * written over. The name holds the slug, so two creators with different titles in one second pick
 * the same id under different names and both exclusive creates succeed; the id is then checked
 * too, and the later claim backs off. False means the id was lost: the caller picks the next one.
 */
function claim(dir: string, task: DeployTask, sources: TaskSources): boolean {
  sources.beforeClaim?.(task);
  try {
    writeFileSync(task.file, renderDeployTask(task), { flag: "wx", mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  const own = basename(task.file);
  const rival = [envFolder(dir, task.env), archiveFolder(dir, task.env)]
    .filter((folder) => existsSync(folder))
    .flatMap((folder) => readdirSync(folder))
    .some((name) => name !== own && deployIdOfFileName(name) === task.id);
  if (rival) rmSync(task.file, { force: true });
  return !rival;
}

export function createDeployTask(
  dir: string,
  input: DeployTaskInput,
  sources: TaskSources,
): DeployTask {
  mkdirSync(envFolder(dir, input.env), { recursive: true });
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const task = planDeployTask(dir, input, sources, takenDeployIds(dir, input.env));
    if (claim(dir, task, sources)) return task;
  }
  throw new Error("Could not allocate a unique deploy task id");
}

/**
 * A step owed on both environments: a staging task and a prod task, each naming the other in
 * `twin` (D13). Both ids are made before either file is written, so each can name the other.
 * Refused when `envs` (the project's `tasks.envs`) lacks either environment.
 */
export function createDeployPair(
  dir: string,
  input: Omit<DeployTaskInput, "env" | "twin">,
  sources: TaskSources,
  envs: readonly DeployEnv[],
): { staging: DeployTask; prod: DeployTask } {
  for (const env of DEPLOY_ENVS)
    if (!envs.includes(env))
      throw new Error(
        `A staging and prod pair needs both environments; this project lists only: ${envs.join(", ")}`,
      );
  mkdirSync(envFolder(dir, "staging"), { recursive: true });
  mkdirSync(envFolder(dir, "prod"), { recursive: true });
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const staging = planDeployTask(
      dir,
      { ...input, env: "staging" },
      sources,
      takenDeployIds(dir, "staging"),
    );
    const prod = planDeployTask(
      dir,
      { ...input, env: "prod" },
      sources,
      takenDeployIds(dir, "prod"),
    );
    staging.twin = prod.id;
    prod.twin = staging.id;
    if (!claim(dir, staging, sources)) continue;
    let claimed = false;
    try {
      claimed = claim(dir, prod, sources);
    } finally {
      // A lost race or a failed write leaves no half pair behind.
      if (!claimed) rmSync(staging.file, { force: true });
    }
    if (claimed) return { staging, prod };
  }
  throw new Error("Could not allocate unique ids for a staging and prod pair");
}

/**
 * The one task with `id`. Refuses an id that is not there, and an id two differently named
 * files claim: neither can be chosen, and the fix is to rename one id (never "delete a file").
 */
export function findDeployTask(dir: string, id: string): DeployTask {
  const scan = scanDeployTasks(dir, { archive: true });
  const clash = scan.duplicates.find((duplicate) => duplicate.id === id);
  if (clash)
    throw new Error(
      `Deploy task id ${id} is ambiguous: ${clash.files.join(" and ")} both claim it. Rename the id inside one of them`,
    );
  const match = scan.tasks.find((task) => task.id === id);
  if (!match) throw new Error(`Deploy task not found: ${id}`);
  return match;
}

export function updateDeployTask(
  dir: string,
  id: string,
  patch: DeployTaskPatch,
  _now: Date,
): DeployTask {
  const task = findDeployTask(dir, id);
  const merged = { ...task, ...patch };
  const { body, file, ...fields } = merged;
  return save({ ...deployTaskSchema.parse(fields), body, file });
}

function withNote(task: DeployTask, text: string, now: Date): DeployTask {
  // Indent subsequent lines so one note stays one Markdown list entry.
  const line = `- ${taskInstant(now).slice(0, 10)} ${text.replace(/\r?\n/g, "\n  ")}\n`;
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
export function addDeployNote(dir: string, id: string, text: string, now: Date): DeployTask {
  return save(withNote(findDeployTask(dir, id), text, now));
}

/**
 * Closes an open task and moves it to `archive/`. `done` needs evidence and `dropped` needs a
 * note that gives the reason, for every deploy task; a closed task is not closed again.
 */
export function closeDeployTask(
  dir: string,
  id: string,
  options: { status: "done" | "dropped"; evidence?: string; note?: string },
  now: Date,
): DeployTask {
  const task = findDeployTask(dir, id);
  if (task.status !== "open")
    throw new Error(`${id} is already ${task.status}: reopen it first to close it again`);
  if (options.status === "done" && !options.evidence?.trim())
    throw new Error(`${id} needs evidence to be done: what you ran or checked, and its result`);
  if (options.status === "dropped" && !options.note?.trim())
    throw new Error(`${id} needs a note to be dropped: the reason it no longer applies`);
  const closed = withNote(
    {
      ...task,
      status: options.status,
      closed: taskInstant(now),
      ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    },
    options.note ?? `${options.status}: ${options.evidence ?? ""}`,
    now,
  );
  const archive = archiveFolder(dir, task.env);
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

/**
 * Puts a closed task back to open, for a deploy that was rolled back: the file moves from
 * `archive/` to its env folder, `closed` and `evidence` are cleared, and a log line says so.
 * The order keeps a crash from ever leaving the task closed: the archived file is first rewritten
 * in place as open (one atomic write), then the copy in the env folder is written, then the
 * archived one is removed. A crash after the first step leaves an open task in `archive/`, a crash
 * after the second leaves two copies, and the scan keeps the archived one for both; running reopen
 * again finishes the move. A task that is open and already in its env folder is refused.
 */
export function reopenDeployTask(dir: string, id: string, now: Date, note?: string): DeployTask {
  const task = findDeployTask(dir, id);
  const archived = isArchived(task.file);
  if (task.status === "open" && !archived) throw new Error(`${id} is already open`);
  let reopened: DeployTask = task;
  if (task.status !== "open") {
    const { closed: _closed, evidence: _evidence, ...rest } = task;
    reopened = save(
      withNote({ ...rest, status: "open" }, note?.trim() ? `reopened: ${note}` : "reopened", now),
    );
  }
  const destination = join(envFolder(dir, task.env), basename(task.file));
  const saved = save({ ...reopened, file: destination });
  if (destination !== task.file) rmSync(task.file, { force: true });
  return saved;
}
