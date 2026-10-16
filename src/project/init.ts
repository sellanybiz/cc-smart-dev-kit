/**
 * `cc-smart-dev-kit project init`: the two files a project opts in with.
 *
 * - `.claude/cc-smart-dev-kit.json` — the project's settings: the worktrees, the protected
 *   branches, the guards, and (optionally) the workflow policy.
 * - `.claude/settings.json` — the lines the worktree engine needs, merged with whatever the
 *   file already wires (`withProjectHooks`, the one home for those lines). A project that runs
 *   an engine of its own (`"worktrees.engine": "own"`) gets none.
 *
 * `planProjectInit` is pure: the two files as text (null: not there) and the answers go in;
 * the text each file will hold, the changes to show, and the hook lines come back. The
 * command asks its questions first, prints the plan, and writes it with `applyProjectInit`.
 * Nothing here commits: both files belong to the project, and the person commits them.
 *
 * **Why not `writeManagedFile`:** that records a file in `<stateDir>/changed.json`, the list
 * `restore` undoes on this machine. A committed project file must never be reverted by a
 * later `restore`, so these two are written with a backup and an atomic write only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { withoutProjectHooks, withProjectHooks } from "../hooks/project-wiring";
import { detectIndent, isObject } from "../setup/managed-json";
import { atomicWrite, backupFile, fileMode, realTarget } from "../setup/write";
import type { Workflow } from "../workflow/schema";

/** One question's answer, as the flags and the terminal gave it. */
export interface ProjectInitAnswers {
  /** The branch a new worktree starts from when no prefix of `bases` matches. */
  base: string;
  /** The folder-name prefix of a worktree beside the repo. */
  prefix: string;
  /** The command run inside a new worktree, in argv form; null: none. */
  setup: string[] | null;
  /** Branch-name prefix to the base a new worktree for such a branch starts from. */
  bases: Record<string, string>;
  /** The branches the git guard asks about before a push. */
  protectedBranches: string[];
  guards: {
    /** Refuse an edit in the main checkout itself. */
    guardMainFolder: boolean;
    /** Each session names itself after its task. */
    sessionNames: boolean;
    /** Send a heavy command through the job queue. */
    jobRoute: boolean;
  };
  /** Who makes this project's worktrees. */
  engine: "plugin" | "own";
  /** The policy written into the project's file; `{}` leaves the field out. */
  workflow: Workflow;
}

export interface ProjectInitInput {
  /** The repo root: `<root>/.claude/` holds both files. */
  root: string;
  /** `.claude/cc-smart-dev-kit.json` as it is now, or null. */
  existing: string | null;
  /** `.claude/settings.json` as it is now, or null. */
  existingSettings: string | null;
  answers: ProjectInitAnswers;
}

export interface ProjectInitPlan {
  file: string;
  /** What the project's file will hold. */
  text: string;
  /** True when it differs from the file now. */
  changed: boolean;
  /** The changes, one line each: `+ <key>: <value>`, `~ <key>: <old> -> <new>`, `- <key>`. */
  diff: string[];
  settingsFile: string;
  /** What the settings file will hold (the engine's lines merged in). */
  settingsText: string;
  /** True when a line is added to the settings file, or taken out of it. */
  settingsChanged: boolean;
  /** The lines added, as the person reads them. Empty for an engine of the project's own. */
  hookLines: string[];
  /**
   * The lines taken out, as the person reads them. Empty for the plugin's own engine; for
   * `"own"` it is the plugin's hook lines an earlier `project init` left behind, which would
   * answer every worktree request beside the project's own engine.
   */
  removedLines: string[];
  /** What to know, printed with the plan. */
  notes: string[];
}

/** The order the file's own keys are written in, so a diff stays small. */
const FILE_ORDER = [
  "requires",
  "worktrees",
  "protectedBranches",
  "sessionNames",
  "instructions",
  "autoMode",
  "jobs",
  "ownHooks",
  "workflow",
];

/** The order inside `worktrees`. */
const WORKTREE_ORDER = ["base", "prefix", "setup", "guardMainFolder", "bases", "engine"];

/** The known keys first, in their order; a key this command does not know keeps its place after them. */
function orderKeys(
  data: Record<string, unknown>,
  order: readonly string[],
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of order) {
    if (Object.hasOwn(data, key)) ordered[key] = data[key];
  }
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = value;
  }
  return ordered;
}

/** One file as an object: `{}` when there is none, a clear error when it cannot be read. */
function parseObject(text: string | null, file: string): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} is not valid JSON (${reason}). Fix it by hand, then run again.`);
  }
  if (!isObject(raw)) throw new Error(`${file} must hold a JSON object.`);
  return raw;
}

/** `">=0.4"` for this plugin's version: the fields this command writes arrived with it. */
export function requiresFor(version: string): string {
  const [major, minor] = version.split(".");
  return `>=${major ?? "0"}.${minor ?? "0"}`;
}

/**
 * The `requires` the file gets: this plugin's own minor, raised from an older one. A file
 * that already needs a newer plugin keeps its own range — never lowered.
 */
function raisedRequires(existing: unknown): string {
  const ours = requiresFor(VERSION);
  if (typeof existing === "string") {
    const floor = /^>=\s*(\d+)\.(\d+)/.exec(existing);
    if (floor !== null && Bun.semver.order(`${floor[1]}.${floor[2]}.0`, VERSION) >= 0) {
      return existing;
    }
  }
  return ours;
}

/** Every leaf of a JSON object, by its dotted path: what the diff compares. */
function leaves(value: unknown, prefix: string, found: Map<string, unknown>): void {
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0 && prefix !== "") found.set(prefix, value);
    for (const [key, child] of entries) {
      leaves(child, prefix === "" ? key : `${prefix}.${key}`, found);
    }
    return;
  }
  if (prefix !== "") found.set(prefix, value);
}

/** A value as a diff line shows it. */
function shownLeaf(value: unknown): string {
  return JSON.stringify(value);
}

/** The changes between two files, one line each, sorted by key. */
function diffOf(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const was = new Map<string, unknown>();
  const is = new Map<string, unknown>();
  leaves(before, "", was);
  leaves(after, "", is);
  const keys = [...new Set([...was.keys(), ...is.keys()])].sort();
  const lines: string[] = [];
  for (const key of keys) {
    const had = was.get(key);
    const has = is.get(key);
    if (!was.has(key)) lines.push(`+ ${key}: ${shownLeaf(has)}`);
    else if (!is.has(key)) lines.push(`- ${key}: ${shownLeaf(had)}`);
    else if (!Bun.deepEquals(had, has, true)) {
      lines.push(`~ ${key}: ${shownLeaf(had)} -> ${shownLeaf(has)}`);
    }
  }
  return lines;
}

/** The project's two files, as the answers would leave them. */
export function planProjectInit(input: ProjectInitInput): ProjectInitPlan {
  const { root, existing, existingSettings, answers } = input;
  const file = join(root, ".claude", "cc-smart-dev-kit.json");
  const settingsFile = join(root, ".claude", "settings.json");
  const before = parseObject(existing, file);
  const beforeWorktrees = isObject(before.worktrees) ? before.worktrees : {};
  const beforeJobs = isObject(before.jobs) ? before.jobs : {};

  const worktrees: Record<string, unknown> = { ...beforeWorktrees };
  worktrees.base = answers.base;
  worktrees.prefix = answers.prefix;
  if (answers.setup === null) delete worktrees.setup;
  else worktrees.setup = answers.setup;
  if (answers.guards.guardMainFolder) worktrees.guardMainFolder = true;
  else delete worktrees.guardMainFolder;
  if (Object.keys(answers.bases).length > 0) worktrees.bases = answers.bases;
  else delete worktrees.bases;
  worktrees.engine = answers.engine;

  const next: Record<string, unknown> = { ...before };
  next.requires = raisedRequires(before.requires);
  next.worktrees = orderKeys(worktrees, WORKTREE_ORDER);
  if (answers.protectedBranches.length > 0) next.protectedBranches = answers.protectedBranches;
  else delete next.protectedBranches;
  if (answers.guards.sessionNames) next.sessionNames = true;
  else delete next.sessionNames;
  const jobs: Record<string, unknown> = { ...beforeJobs };
  if (answers.guards.jobRoute) jobs.route = true;
  else delete jobs.route;
  if (Object.keys(jobs).length > 0) next.jobs = jobs;
  else delete next.jobs;
  if (Object.keys(answers.workflow).length > 0) next.workflow = answers.workflow;
  else delete next.workflow;
  const after = orderKeys(next, FILE_ORDER);
  const text = `${JSON.stringify(after, null, detectIndent(existing ?? ""))}\n`;

  const settingsNow = parseObject(existingSettings, settingsFile);
  // The plugin's engine wires its three hook lines; an engine of the project's own takes
  // exactly those back out, so the two can never answer the same request (`doctor` flags that
  // as two engines on one request).
  const merged =
    answers.engine === "plugin"
      ? { ...withProjectHooks(settingsNow), removed: [] as string[] }
      : { ...withoutProjectHooks(settingsNow), added: [] as string[] };
  const settingsChanges = merged.added.length > 0 || merged.removed.length > 0;
  // Nothing changed: the file's own text, so `settingsText` is what the file would hold (a
  // caller that writes it anyway writes what is already there).
  const settingsText =
    !settingsChanges && existingSettings !== null
      ? existingSettings
      : `${JSON.stringify(merged.settings, null, detectIndent(existingSettings ?? ""))}\n`;

  const notes: string[] = [];
  if (answers.engine === "own") {
    notes.push(
      merged.removed.length > 0
        ? 'engine "own": the cc-smart-dev-kit hook lines are taken out of .claude/settings.json — your own engine makes this project\'s worktrees, and with both wired two engines answer each worktree request'
        : 'engine "own": no cc-smart-dev-kit hook lines are added to .claude/settings.json — your own engine makes this project\'s worktrees; `cc-smart-dev-kit doctor` expects none',
    );
  }
  if (answers.setup === null) {
    notes.push("no setup command: a new worktree gets no dependencies installed");
  }
  return {
    file,
    text,
    changed: text !== existing,
    diff: diffOf(before, after),
    settingsFile,
    settingsText,
    settingsChanged: settingsChanges,
    hookLines: merged.added,
    notes,
    removedLines: merged.removed,
  };
}

/** One file `applyProjectInit` wrote. */
export interface ProjectInitWrite {
  file: string;
  /** True when the file was not there before. */
  created: boolean;
  /** The backup made before the write; null on a dry run, which writes nothing. */
  backup: string | null;
}

/**
 * Writes the plan: a backup first (in `<stateDir>/backups/`, the one place backups go), then
 * an atomic write. A file that is already what the plan says is left alone — no backup, no
 * write. `dryRun` writes nothing at all.
 */
export function applyProjectInit(
  plan: ProjectInitPlan,
  options: { stateDir: string; dryRun?: boolean },
): ProjectInitWrite[] {
  const wanted: Array<[string, string]> = [];
  if (plan.changed) wanted.push([plan.file, plan.text]);
  if (plan.settingsChanged) wanted.push([plan.settingsFile, plan.settingsText]);
  return wanted.map(([file, text]) => {
    const created = !existsSync(file);
    if (options.dryRun === true) return { file, created, backup: null };
    const backup = backupFile(options.stateDir, file);
    // `realTarget`: a `.claude/settings.json` linked into a dotfiles repo stays a link, and
    // its target gets the change — an atomic write straight at the link would replace it with
    // a plain file.
    atomicWrite(realTarget(file), text, fileMode(file) ?? 0o644);
    return { file, created, backup };
  });
}
