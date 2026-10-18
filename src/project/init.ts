/**
 * `cc-smart-dev-kit project init`: the two files a project opts in with.
 *
 * - `.claude/cc-smart-dev-kit.json` — the project's settings: the worktrees, the protected
 *   branches, the guards, and (optionally) the workflow policy.
 * - `.claude/settings.json` — Claude Code's `"worktree": {"baseRef": "head"}` when the
 *   project's base branch is not the repo's default branch. A new worktree is then cut from
 *   the branch the session is on rather than from `origin`'s default branch, which is what a
 *   project whose work branches from another branch needs.
 *
 * Every project uses Claude Code's own worktrees (`<repo>/.claude/worktrees/<name>` on
 * `worktree-<name>`), so no WorktreeCreate or WorktreeRemove hook is written. The plugin's
 * old engine's fields (`worktrees.prefix`, `worktrees.setup`, `worktrees.engine`) are
 * deprecated: a file that already has them keeps them; this command neither asks for them
 * nor writes them.
 *
 * `planProjectInit` is pure: the two files as text (null: not there) and the answers go in;
 * the text each file will hold and the changes to show come back. The command asks its
 * questions first, prints the plan, and writes it with `applyProjectInit`. Nothing here
 * commits: both files belong to the project, and the person commits them.
 *
 * **Why not `writeManagedFile`:** that records a file in `<stateDir>/changed.json`, the list
 * `restore` undoes on this machine. A committed project file must never be reverted by a
 * later `restore`, so these two are written with a backup and an atomic write only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { detectIndent, isObject } from "../setup/managed-json";
import { atomicWrite, backupFile, fileMode, realTarget } from "../setup/write";
import type { Workflow } from "../workflow/schema";
import { WORKTREE_PREFIX_OPTIONAL_SINCE } from "./config";

/** One question's answer, as the flags and the terminal gave it. */
export interface ProjectInitAnswers {
  /** The branch a new worktree starts from when no prefix of `bases` matches. */
  base: string;
  /** Branch-name prefix to the base that branch family's pull requests go into. */
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
  /** The repo's default branch, which `answers.base` is compared with. */
  defaultBranch: string;
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
  /** What the settings file will hold (Claude Code's `worktree.baseRef` merged in). */
  settingsText: string;
  /** True when a line is added to the settings file. */
  settingsChanged: boolean;
  /** The settings lines added, as the person reads them. */
  settingsAdds: string[];
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

/**
 * The order inside `worktrees`: the fields this command writes, and the deprecated engine's
 * fields a file may keep, so a file that does not change is not rewritten. Every project's
 * own extra keys stay after them.
 */
const WORKTREE_ORDER = ["base", "prefix", "setup", "guardMainFolder", "bases", "engine"];

/**
 * The deprecated engine fields a file may still carry. `project init` leaves them exactly as
 * they are: a project wired to the engine keeps working until the engine retires, and
 * `doctor` names the steps to move.
 */
const DEPRECATED_WORKTREE_FIELDS = ["prefix", "setup", "engine"] as const;

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
 * The `requires` the file gets: the floor, raised from an older range. A file that already
 * needs a newer plugin keeps its own range — never lowered. `floorVersion` is the version
 * `floor` names, for that comparison.
 */
function raisedRequires(existing: unknown, floor: string, floorVersion: string): string {
  if (typeof existing === "string") {
    const floorMatch = /^>=\s*(\d+)\.(\d+)(?:\.(\d+))?/.exec(existing);
    if (floorMatch !== null) {
      const existingFloor = `${floorMatch[1]}.${floorMatch[2]}.${floorMatch[3] ?? "0"}`;
      if (Bun.semver.order(existingFloor, floorVersion) >= 0) return existing;
    }
  }
  return floor;
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

/**
 * The settings file with Claude Code's `worktree.baseRef: "head"`, which cuts a new worktree
 * from the branch the session is on. Added only when the project needs it; every other key,
 * and every other `worktree` key, stays exactly as it is.
 */
function withBaseRef(
  settings: Record<string, unknown>,
  head: boolean,
): { settings: Record<string, unknown>; added: string[] } {
  const now = isObject(settings.worktree) ? settings.worktree : null;
  if (!head || now?.baseRef === "head") return { settings, added: [] };
  const worktree: Record<string, unknown> = { ...(now ?? {}), baseRef: "head" };
  return { settings: { ...settings, worktree }, added: ['worktree.baseRef: "head"'] };
}

/** The project's two files, as the answers would leave them. */
export function planProjectInit(input: ProjectInitInput): ProjectInitPlan {
  const { root, existing, existingSettings, defaultBranch, answers } = input;
  const file = join(root, ".claude", "cc-smart-dev-kit.json");
  const settingsFile = join(root, ".claude", "settings.json");
  const before = parseObject(existing, file);
  const beforeWorktrees = isObject(before.worktrees) ? before.worktrees : {};
  const beforeJobs = isObject(before.jobs) ? before.jobs : {};

  // The fields every project has; a deprecated engine field the file already carries stays
  // exactly as it is, so a project wired to the engine keeps working until it retires.
  const worktrees: Record<string, unknown> = { ...beforeWorktrees };
  worktrees.base = answers.base;
  if (answers.guards.guardMainFolder) worktrees.guardMainFolder = true;
  else delete worktrees.guardMainFolder;
  if (Object.keys(answers.bases).length > 0) worktrees.bases = answers.bases;
  else delete worktrees.bases;

  const next: Record<string, unknown> = { ...before };
  // A file this command writes without `worktrees.prefix` needs at least the plugin version
  // that made it optional; a file that keeps a prefix needs only this plugin's own minor.
  next.requires =
    worktrees.prefix === undefined
      ? raisedRequires(
          before.requires,
          `>=${WORKTREE_PREFIX_OPTIONAL_SINCE}`,
          WORKTREE_PREFIX_OPTIONAL_SINCE,
        )
      : raisedRequires(before.requires, requiresFor(VERSION), VERSION);
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

  // Claude Code cuts a new worktree from origin's default branch. A project whose base branch
  // is another one sets `baseRef: "head"`, so a worktree starts from the branch the session
  // is on; with the default branch as its base it needs nothing.
  const settingsNow = parseObject(existingSettings, settingsFile);
  const merged = withBaseRef(settingsNow, answers.base !== defaultBranch);
  const settingsChanged = merged.added.length > 0;
  // Nothing changed: the file's own text, so `settingsText` is what the file would hold (a
  // caller that writes it anyway writes what is already there).
  const settingsText =
    !settingsChanged && existingSettings !== null
      ? existingSettings
      : `${JSON.stringify(merged.settings, null, detectIndent(existingSettings ?? ""))}\n`;

  const notes: string[] = [];
  if (answers.base !== defaultBranch) {
    notes.push(
      `base ${answers.base} is not the repo's default branch ${defaultBranch}: .claude/settings.json gets "worktree": {"baseRef": "head"}, so a new worktree starts from the branch the session is on`,
    );
  }
  const deprecated = DEPRECATED_WORKTREE_FIELDS.filter((field) =>
    Object.hasOwn(beforeWorktrees, field),
  );
  if (deprecated.length > 0) {
    notes.push(
      `the project's file still sets ${deprecated.map((field) => `worktrees.${field}`).join(", ")}: the worktree engine is deprecated and retires in the next minor version; \`cc-smart-dev-kit doctor\` names the steps to move`,
    );
  }
  return {
    file,
    text,
    changed: text !== existing,
    diff: diffOf(before, after),
    settingsFile,
    settingsText,
    settingsChanged,
    settingsAdds: merged.added,
    notes,
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
