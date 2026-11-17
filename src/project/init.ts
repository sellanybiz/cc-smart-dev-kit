/**
 * `cc-smart-dev-kit project init`: the files a project opts in with.
 *
 * - `.claude/cc-smart-dev-kit.json` — the project's settings: the worktrees, the protected
 *   branches, the guards, and (optionally) the workflow policy.
 * - `.claude/settings.json` — Claude Code's `"worktree": {"baseRef": "head"}` when the
 *   project's base branch is not the repo's default branch. A new worktree is then cut from
 *   the branch the session is on rather than from `origin`'s default branch, which is what a
 *   project whose work branches from another branch needs.
 *
 * **It cleans up after the retired worktree engine.** Every project uses Claude Code's own
 * worktrees (`<repo>/.claude/worktrees/<name>` on `worktree-<name>`), which need no hook. The
 * plugin's old engine retired in `WORKTREE_ENGINE_RETIRED_IN`: a file that still holds one of
 * its fields (`RETIRED_WORKTREE_FIELDS`) no longer loads, and a settings line that still runs
 * `cc-smart-dev-kit hook worktree-create|worktree-remove|subagent-stop` fails every time it
 * runs. So the plan takes those fields out of the project's file, and those lines out of
 * `.claude/settings.json` and `.claude/settings.local.json`, shown as `-` lines before
 * anything is written. Every other key, hook and handler stays exactly as it is.
 *
 * `planProjectInit` is pure: the files as text (null: not there) and the answers go in; the
 * text each file will hold and the changes to show come back. The command asks its questions
 * first, prints the plan, and writes it with `applyProjectInit`. Nothing here commits: the
 * files belong to the project, and the person commits them.
 *
 * **Why not `writeManagedFile`:** that records a file in `<stateDir>/changed.json`, the list
 * `restore` undoes on this machine. A committed project file must never be reverted by a
 * later `restore`, so these are written with a backup and an atomic write only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describeHandler, retiredEngineHookOf } from "../hooks/settings-hooks";
import { jsonTextFor } from "../setup/json-edit";
import { detectIndent, isObject } from "../setup/managed-json";
import { parseUserJson } from "../setup/user-json";
import { atomicWrite, backupFile, fileMode, realTarget } from "../setup/write";
import { clashNote, workflowClashes } from "../workflow/clashes";
import { type Workflow, workflowDefaults } from "../workflow/schema";
import {
  CHECKS_SINCE,
  ccSmartDevKitConfigSchema,
  DEPLOY_TASKS_SINCE,
  JOB_KIND_KEYS_SINCE,
  OWN_HOOK_NAMES_SINCE,
  RETIRED_WORKTREE_FIELDS,
  retiredFieldsOf,
  TASKS_SINCE,
  WORKFLOW_FIXES_SINCE,
  WORKFLOW_ISSUES_SINCE,
  WORKFLOW_PLANS_SINCE,
  WORKTREE_AUTO_CLEAN_SINCE,
  WORKTREE_ENGINE_RETIRED_IN,
  WORKTREE_PREFIX_OPTIONAL_SINCE,
  WORKTREE_REBUILDABLE_SINCE,
} from "./config";
import { lowestAllowed } from "./version-range";

/** One question's answer, as the flags and the terminal gave it. */
export interface ProjectInitAnswers {
  /** The branch a new worktree starts from when no prefix of `bases` matches. */
  base: string;
  /** Branch-name prefix to the base that branch family's pull requests go into. */
  bases: Record<string, string>;
  /** The branches the git guard asks about before a push. */
  protectedBranches: string[];
  /**
   * The project's fast check, as `checks.fast` (`{ "fast": "bun run typecheck" }`); `null` for
   * none; left out (`undefined`) to leave the file's own value exactly as it is — the portal's
   * form does not show the field yet.
   */
  checks?: { fast: string } | null;
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
  /** The repo root: `<root>/.claude/` holds the files. */
  root: string;
  /** `.claude/cc-smart-dev-kit.json` as it is now, or null. */
  existing: string | null;
  /** `.claude/settings.json` as it is now, or null. */
  existingSettings: string | null;
  /** `.claude/settings.local.json` as it is now, or null: only an engine line is taken out of it. */
  existingLocalSettings: string | null;
  /** The repo's default branch, which `answers.base` is compared with. */
  defaultBranch: string;
  answers: ProjectInitAnswers;
  /**
   * The person's own workflow values (`workflow.json`), which the answers win over field by
   * field, as `resolveWorkflow` resolves them. Read for D16's clash warning: the policy the
   * guards will see is the person's file plus what this file writes. Left out, nothing is
   * assumed about it.
   */
  personalWorkflow?: Workflow;
}

/** What the plan does to one of the project's Claude Code settings files. */
export interface SettingsFilePlan {
  file: string;
  /** What the file will hold; the file's own text when nothing changes. */
  text: string;
  /** True when the plan changes the file. */
  changed: boolean;
  /** The lines added, as the person reads them (`worktree.baseRef: "head"`). */
  adds: string[];
  /** The retired engine's lines taken out (`hooks.WorktreeCreate: <command>`). */
  removes: string[];
  /**
   * Both, as every screen shows them: each removed line as `- <line>`, then each added one as
   * `+ <line>`. One home for the shape: `project init` prints these, and the portal's preview
   * box draws them (in the page and in the browser, from the plan's JSON).
   */
  lines: string[];
}

export interface ProjectInitPlan {
  file: string;
  /** What the project's file will hold. */
  text: string;
  /** True when it differs from the file now. */
  changed: boolean;
  /** The changes, one line each: `+ <key>: <value>`, `~ <key>: <old> -> <new>`, `- <key>: <value>`. */
  diff: string[];
  /** `.claude/settings.json`: Claude Code's `worktree.baseRef` merged in, the engine's lines out. */
  settings: SettingsFilePlan;
  /** `.claude/settings.local.json`: the engine's lines out, nothing ever added. */
  localSettings: SettingsFilePlan;
  /** What to know, printed with the plan. */
  notes: string[];
}

/** The order the file's own keys are written in, so a diff stays small. */
const FILE_ORDER = [
  "requires",
  "worktrees",
  "protectedBranches",
  "checks",
  "sessionNames",
  "instructions",
  "autoMode",
  "jobs",
  "ownHooks",
  "workflow",
];

/** The order inside `worktrees`: the fields this command writes. Every other key stays after them. */
const WORKTREE_ORDER = ["base", "guardMainFolder", "bases"];

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
    // The one reader of a person-edited JSON file: an editor's byte order mark is skipped, so
    // a project file saved that way is read here as every guard reads it (F5-2).
    raw = parseUserJson(text);
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
export function raisedRequires(existing: unknown, floor: string, floorVersion: string): string {
  if (typeof existing === "string") {
    const lowest = lowestAllowed(existing);
    if (lowest !== null && Bun.semver.order(lowest, floorVersion) >= 0) return existing;
  }
  return floor;
}

/**
 * True when the file's own `requires` is a range read here whose lowest version is below
 * `floorVersion`: an older plugin in that range still refuses a file with the fields the floor
 * names. A missing `requires`, or a range in a form not read here, is not "too low" — the
 * caller decides what those mean. The one test `workflow set` and `doctor` share.
 */
export function requiresTooLow(existing: unknown, floorVersion: string): boolean {
  if (typeof existing !== "string") return false;
  const lowest = lowestAllowed(existing);
  return lowest !== null && Bun.semver.order(lowest, floorVersion) < 0;
}

/**
 * The oldest plugin that reads every field the file holds: the range and the version it
 * names, for `raisedRequires`.
 *
 * A file that sets several fields needs the newest among them. The version tables in
 * `config.ts` name those releases. Ignored settings do not raise the floor.
 * An older plugin reads the file strictly, does not know the field or the name, and refuses
 * the file — so every guard in that project fails closed until the plugin is updated; the
 * floor makes it say "update" instead.
 */
export function requiresFloor(file: Record<string, unknown>): {
  floor: string;
  version: string;
} {
  const workflow = isObject(file.workflow) ? file.workflow : {};
  const worktrees = isObject(file.worktrees) ? file.worktrees : {};
  const needs: string[] = [];
  if (Object.hasOwn(file, "checks")) needs.push(CHECKS_SINCE);
  if (Object.hasOwn(file, "tasks")) needs.push(TASKS_SINCE);
  if (isObject(file.tasks) && Object.hasOwn(file.tasks, "envs")) needs.push(DEPLOY_TASKS_SINCE);
  if (Object.hasOwn(workflow, "issues")) needs.push(WORKFLOW_ISSUES_SINCE);
  const ownHooks = Array.isArray(file.ownHooks) ? file.ownHooks : [];
  for (const [name, since] of Object.entries(OWN_HOOK_NAMES_SINCE)) {
    if (ownHooks.includes(name)) needs.push(since);
  }
  if (Object.hasOwn(workflow, "fixesAfterReview")) {
    needs.push(WORKFLOW_FIXES_SINCE);
  }
  if (Object.hasOwn(workflow, "plans")) needs.push(WORKFLOW_PLANS_SINCE);
  if (Object.hasOwn(worktrees, "autoClean")) needs.push(WORKTREE_AUTO_CLEAN_SINCE);
  if (Object.hasOwn(worktrees, "rebuildable")) needs.push(WORKTREE_REBUILDABLE_SINCE);
  const jobs = isObject(file.jobs) ? file.jobs : {};
  const kinds = isObject(jobs.kinds) ? Object.values(jobs.kinds) : [];
  for (const [key, since] of Object.entries(JOB_KIND_KEYS_SINCE)) {
    if (kinds.some((kind) => isObject(kind) && Object.hasOwn(kind, key))) needs.push(since);
  }
  if (needs.length === 0) {
    return {
      floor: `>=${WORKTREE_PREFIX_OPTIONAL_SINCE}`,
      version: WORKTREE_PREFIX_OPTIONAL_SINCE,
    };
  }
  const version = needs.reduce((newest, one) => (Bun.semver.order(one, newest) > 0 ? one : newest));
  return { floor: requiresFor(version), version };
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

/**
 * The settings file without a handler that runs a retired engine hook (`retiredEngineHookOf`).
 * Only those handlers go: every other handler in the same group, every other group in the same
 * event, and every other event stay exactly as they are. A group, an event list or the
 * `hooks` object that held nothing but engine lines goes with its last one, so no empty
 * `"hooks": {}` is left behind. Each removed handler is one line, `hooks.<Event>: <command>`.
 */
function withoutEngineHooks(settings: Record<string, unknown>): {
  settings: Record<string, unknown>;
  removed: string[];
} {
  if (!isObject(settings.hooks)) return { settings, removed: [] };
  const removed: string[] = [];
  const hooks: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    let touched = false;
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const handlers = group.hooks.filter((handler: unknown) => {
        const command = describeHandler(handler);
        if (retiredEngineHookOf(command) === null) return true;
        removed.push(`hooks.${event}: ${command}`);
        return false;
      });
      if (handlers.length === group.hooks.length) {
        kept.push(group);
        continue;
      }
      touched = true;
      if (handlers.length > 0) kept.push({ ...group, hooks: handlers });
    }
    if (!touched) hooks[event] = groups;
    else if (kept.length > 0) hooks[event] = kept;
  }
  if (removed.length === 0) return { settings, removed };
  const next: Record<string, unknown> = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return { settings: next, removed };
}

/**
 * One settings file as the plan leaves it: the engine's lines out, then (for
 * `.claude/settings.json` only) the `baseRef` line in. Unchanged, `text` is the file's own.
 */
function settingsPlan(file: string, existing: string | null, head: boolean): SettingsFilePlan {
  const cleaned = withoutEngineHooks(parseObject(existing, file));
  const merged = withBaseRef(cleaned.settings, head);
  const changed = cleaned.removed.length > 0 || merged.added.length > 0;
  return {
    file,
    // Nothing changed: the file's own text, so `text` is what the file would hold (a caller
    // that writes it anyway writes what is already there).
    text:
      !changed && existing !== null
        ? existing
        : jsonTextFor(existing, merged.settings, detectIndent(existing ?? "")),
    changed,
    adds: merged.added,
    removes: cleaned.removed,
    lines: [
      ...cleaned.removed.map((line) => `- ${line}`),
      ...merged.added.map((line) => `+ ${line}`),
    ],
  };
}

/** The project's files, as the answers would leave them. */
export function planProjectInit(input: ProjectInitInput): ProjectInitPlan {
  const { root, existing, existingSettings, existingLocalSettings, defaultBranch, answers } = input;
  const file = join(root, ".claude", "cc-smart-dev-kit.json");
  const before = parseObject(existing, file);
  const beforeWorktrees = isObject(before.worktrees) ? before.worktrees : {};
  const beforeJobs = isObject(before.jobs) ? before.jobs : {};

  // The fields every project has; a retired engine field goes, so the file loads again.
  const worktrees: Record<string, unknown> = { ...beforeWorktrees };
  for (const field of RETIRED_WORKTREE_FIELDS) delete worktrees[field];
  worktrees.base = answers.base;
  if (answers.guards.guardMainFolder) worktrees.guardMainFolder = true;
  else delete worktrees.guardMainFolder;
  if (Object.keys(answers.bases).length > 0) worktrees.bases = answers.bases;
  else delete worktrees.bases;

  const next: Record<string, unknown> = { ...before };
  next.worktrees = orderKeys(worktrees, WORKTREE_ORDER);
  if (answers.protectedBranches.length > 0) next.protectedBranches = answers.protectedBranches;
  else delete next.protectedBranches;
  // `undefined` is a caller that does not know the field (the portal's form): the file's own
  // `checks` stays exactly as it is. `null` is the `none` answer: the field goes.
  if (answers.checks !== undefined) {
    if (answers.checks === null) delete next.checks;
    else next.checks = { fast: answers.checks.fast };
  }
  if (answers.guards.sessionNames) next.sessionNames = true;
  else delete next.sessionNames;
  const jobs: Record<string, unknown> = { ...beforeJobs };
  if (answers.guards.jobRoute) jobs.route = true;
  else delete jobs.route;
  if (Object.keys(jobs).length > 0) next.jobs = jobs;
  else delete next.jobs;
  // Retired keys are not answers, but an unrelated init must not erase the raw old values.
  const beforeWorkflow = isObject(before.workflow) ? before.workflow : {};
  const beforeAlerts = isObject(beforeWorkflow.alerts) ? beforeWorkflow.alerts : {};
  const retiredAlerts: Record<string, unknown> = {};
  for (const key of ["events", "sound"]) {
    if (Object.hasOwn(beforeAlerts, key)) retiredAlerts[key] = beforeAlerts[key];
  }
  const workflow = { ...answers.workflow };
  if (Object.keys(retiredAlerts).length > 0) {
    workflow.alerts = { ...retiredAlerts, ...workflow.alerts };
  }
  if (Object.keys(workflow).length > 0) next.workflow = workflow;
  else delete next.workflow;
  // The floor depends on the fields the file ends up with: a file that sets
  // a newer setting needs the plugin that brought it, or every older plugin refuses the
  // whole file (it does not know the field) and every guard in that project fails closed.
  const floor = requiresFloor(next);
  next.requires = raisedRequires(before.requires, floor.floor, floor.version);
  const after = orderKeys(next, FILE_ORDER);
  // The file the plan would write is checked against the plugin's own schema BEFORE anything
  // is written: a plan this command made from a wrong answer — or one that keeps a key no
  // version of cc-smart-dev-kit knows — would leave a project every reader refuses. The
  // schema is the one the readers use, so the two can never disagree.
  const valid = ccSmartDevKitConfigSchema.safeParse(after);
  if (!valid.success) {
    throw new Error(
      `${file} would not be a valid project file (${z.prettifyError(valid.error)}). ` +
        `Change the answer, then run again.`,
    );
  }
  const text = jsonTextFor(existing, after, detectIndent(existing ?? ""));

  // Claude Code cuts a new worktree from origin's default branch. A project whose base branch
  // is another one sets `baseRef: "head"`, so a worktree starts from the branch the session
  // is on; with the default branch as its base it needs nothing.
  const settings = settingsPlan(
    join(root, ".claude", "settings.json"),
    existingSettings,
    answers.base !== defaultBranch,
  );
  const localSettings = settingsPlan(
    join(root, ".claude", "settings.local.json"),
    existingLocalSettings,
    false,
  );

  const notes: string[] = [];
  if (answers.base !== defaultBranch) {
    notes.push(
      `base ${answers.base} is not the repo's default branch ${defaultBranch}: .claude/settings.json gets "worktree": {"baseRef": "head"}, so a new worktree starts from the branch the session is on`,
    );
  }
  const retired = retiredFieldsOf(before);
  const engineLines = settings.removes.length + localSettings.removes.length;
  if (retired.length > 0 || engineLines > 0) {
    const what = [
      ...(retired.length > 0 ? [retired.map((field) => `worktrees.${field}`).join(", ")] : []),
      ...(engineLines > 0 ? [`its hook line${engineLines === 1 ? "" : "s"}`] : []),
    ].join(" and ");
    notes.push(
      `the plugin's worktree engine was retired in ${WORKTREE_ENGINE_RETIRED_IN}: ${what} ${retired.length + engineLines === 1 ? "goes" : "go"}, because Claude Code's own worktrees need none`,
    );
  }
  // D16: the file this command is about to write must not leave settings that cannot work
  // together, shown before anything is written. The values are the policy the guards will
  // see: the person's own file, over the built-in defaults, and this file's answers over
  // both — the same order `resolveWorkflow` merges them in. The base is the one being written.
  const personal = input.personalWorkflow ?? {};
  for (const clash of workflowClashes({
    autoMerge: answers.workflow.autoMerge ?? personal.autoMerge ?? workflowDefaults.autoMerge,
    autoPush: answers.workflow.autoPush ?? personal.autoPush ?? workflowDefaults.autoPush,
    base: answers.base,
    openPr: answers.workflow.openPr ?? personal.openPr ?? workflowDefaults.openPr,
  })) {
    notes.push(clashNote(clash));
  }
  return {
    file,
    text,
    changed: text !== existing,
    diff: diffOf(before, after),
    settings,
    localSettings,
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
  for (const settings of [plan.settings, plan.localSettings]) {
    if (settings.changed) wanted.push([settings.file, settings.text]);
  }
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
