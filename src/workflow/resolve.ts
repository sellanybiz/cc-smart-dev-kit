/**
 * The workflow's values: the person's own defaults, the project's over them, and the
 * built-in safe default under both — each value with where it came from.
 *
 * The order, field by field:
 *
 * 1. **the project** — `workflow` in `.claude/cc-smart-dev-kit.json`, committed with the code,
 *    so a team shares one policy;
 * 2. **the person** — `~/.config/cc-smart-dev-kit/workflow.json`, this machine's defaults;
 * 3. **the built-in default** — the safe one (nothing is committed, pushed or merged by
 *    itself), from `schema.ts`.
 *
 * **The review gate** (`REVIEW_GATE_KEYS`, what merge-check judges with) resolves the same
 * way, with one change of source: the project's part is the file as committed on a branch
 * (`resolveGate`), never a checkout's working copy, which a session can edit.
 *
 * A **switch** is different on purpose: it names a setting that already exists — the status
 * line in Claude Code's `settings.json` (setup's `--statusline`), the project's
 * `sessionNames`, its `jobs.route`, and the update hold file (`update --hold`). The value
 * resolved here is that setting's value right now, read where it lives; nothing is stored in
 * the workflow file (`schema.ts`), with one exception. So `switches.sessionNames` reads as
 * `project`, `switches.statusLine` and `switches.updateHold` as `personal`, and a switch that
 * is off with nothing set behind it as `default`.
 *
 * **`switches.jobRoute` has two homes, and the project's wins** (`jobRouteFrom`, the one place
 * that decides it): the project's `jobs.route` when it sets one (`project`), else the person's
 * machine-wide default `switches.jobRoute` in the workflow file (`personal`), else off
 * (`default`). The `job-route` hook reads it through `resolveJobRoute`, never its own reader.
 *
 * **`switches.leadHint` lives in the person's file alone** (`leadHintFrom`): their value
 * (`personal`), else on (`default`). The `fable-session` hook reads it through
 * `resolveLeadHint`, which never throws.
 *
 * **Two plan settings have one home each.** `plans.runMode` lives in the person's file alone
 * (`personal`, else `default`). `plans.mergeFiles` lives in the project's file alone, and what the
 * task store and herdr act on is read as committed on `origin/<base>` (`resolveMergeFiles`),
 * never from a working copy.
 *
 * A broken personal file throws `WorkflowConfigError` (the message names the file and the
 * field): the person must hear that their file is wrong. A caller that must not fail — a
 * hook — catches it and uses the project's values and the defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { runGit } from "../hooks/git";
import type { CcSmartDevKitConfig } from "../project/config";
import {
  type Checkout,
  type CommittedConfig,
  type CommittedOptions,
  RESOLVE_GIT_TIMEOUT_MS,
  readCommittedConfig,
  readCommittedConfigAsync,
} from "../project/resolve";
import { statuslineSetting } from "../setup/statusline";
import { isHeld, updateFiles } from "../update/state";
import { describeIssues } from "../zod-issues";
import {
  type PersonalWorkflow,
  personalWorkflowSchema,
  type RunMode,
  type Workflow,
  type WorkflowKey,
  workflowDefaults,
  workflowValue,
} from "./schema";

/** Where a value came from. */
export type WorkflowSource = "project" | "personal" | "default";

export interface ResolvedValue<T> {
  value: T;
  source: WorkflowSource;
}

export interface ResolvedWorkflow {
  autoCommit: ResolvedValue<boolean>;
  autoPush: ResolvedValue<boolean>;
  openPr: ResolvedValue<"off" | "draft" | "ready">;
  autoMerge: ResolvedValue<boolean>;
  mergeMethod: ResolvedValue<"merge" | "squash" | "rebase">;
  deleteBranch: ResolvedValue<boolean>;
  reviewBeforePush: ResolvedValue<boolean>;
  reviewAgents: ResolvedValue<string[]>;
  fixesAfterReview: {
    lines: ResolvedValue<number>;
    files: ResolvedValue<number>;
    percent: ResolvedValue<number>;
  };
  clearWorktreeAfterMerge: ResolvedValue<boolean>;
  /** GitHub Issues (D67): the two switches and the three labels the kit uses. */
  issues: {
    enabled: ResolvedValue<boolean>;
    allowPublic: ResolvedValue<boolean>;
    foundLabel: ResolvedValue<string>;
    fixedLabel: ResolvedValue<string>;
    readyLabel: ResolvedValue<string>;
  };
  alerts: {
    usagePercent: ResolvedValue<number>;
  };
  /**
   * How the kit's plans are shaped: the most phases one plan may hold, how queued plans run
   * (`runMode`, the person's alone) and the paths the plans' overlap check leaves out.
   * **`mergeFiles` here is whatever project file was passed in, the working copy for a caller
   * that passed one.** What the store and herdr act on is `resolveMergeFiles`: the list as
   * committed on `origin/<base>`.
   */
  plans: {
    maxPhases: ResolvedValue<number>;
    mergeFiles: ResolvedValue<string[]>;
    runMode: ResolvedValue<RunMode>;
  };
  switches: {
    statusLine: ResolvedValue<boolean>;
    sessionNames: ResolvedValue<boolean>;
    jobRoute: ResolvedValue<boolean>;
    updateHold: ResolvedValue<boolean>;
    leadHint: ResolvedValue<boolean>;
  };
}

/** A `workflow.json` that exists but cannot be used. The message names the file and the field. */
export class WorkflowConfigError extends Error {
  override name = "WorkflowConfigError";
}

/** The person's own defaults: `~/.config/cc-smart-dev-kit/workflow.json`. */
export function personalWorkflowFile(paths: CliPaths): string {
  return paths.workflowConfigFile;
}

/** Reads the person's workflow file: `{}` when it does not exist, throws when it is broken. */
export function loadWorkflow(file: string): PersonalWorkflow {
  if (!existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkflowConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  const parsed = personalWorkflowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkflowConfigError(`Invalid ${file}: ${describeIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}

/**
 * The person's own workflow values, or `{}` when the file is not there or cannot be read.
 * For a caller that judges the policy but must not fail on a broken file — D16's clash
 * warning, in `project init`'s plan and the portal's preview. A broken file is `workflow
 * show`'s and the guards' own question, in their own words; a plan must still be shown.
 */
export function personalWorkflowOrDefault(paths: CliPaths): PersonalWorkflow {
  try {
    return loadWorkflow(personalWorkflowFile(paths));
  } catch {
    return {};
  }
}

/** One group of both objects, the project's fields over the person's. */
function mergedGroup<T extends object>(personal: T | undefined, project: T | undefined) {
  if (personal === undefined) return project;
  if (project === undefined) return personal;
  return { ...personal, ...project };
}

/**
 * The project's workflow object and the person's, the project's over it, field by field — a
 * group's fields too (`alerts`, `fixesAfterReview`).
 */
export function mergeWorkflows(personal: Workflow, project: Workflow): Workflow {
  const merged: Workflow = { ...personal, ...project };
  const alerts = mergedGroup(personal.alerts, project.alerts);
  if (alerts !== undefined) merged.alerts = alerts;
  const fixes = mergedGroup(personal.fixesAfterReview, project.fixesAfterReview);
  if (fixes !== undefined) merged.fixesAfterReview = fixes;
  const issues = mergedGroup(personal.issues, project.issues);
  if (issues !== undefined) merged.issues = issues;
  const plans = mergedGroup(personal.plans, project.plans);
  if (plans !== undefined) merged.plans = plans;
  return merged;
}

/** Where the merged value of one key came from. */
function sourceOf(personal: Workflow, project: Workflow, key: WorkflowKey): WorkflowSource {
  if (workflowValue(project, key) !== undefined) return "project";
  return workflowValue(personal, key) !== undefined ? "personal" : "default";
}

/**
 * The alerts of two workflow objects: the project's over the person's, field by field.
 *
 * Exported for the one caller that must not fail when the person's file cannot be read
 * (`alerts.ts`): it passes `{}` for the personal object, so the project's values still win
 * and only the person's own are lost.
 */
export function alertsFrom(personal: Workflow, project: Workflow): ResolvedWorkflow["alerts"] {
  const merged = mergeWorkflows(personal, project);
  const alerts = merged.alerts ?? {};
  const of = <T>(key: WorkflowKey, value: T): ResolvedValue<T> => ({
    value,
    source: sourceOf(personal, project, key),
  });
  return {
    usagePercent: of(
      "alerts.usagePercent",
      alerts.usagePercent ?? workflowDefaults.alerts.usagePercent,
    ),
  };
}

/**
 * The plan settings of two workflow objects. The cap: the project's over the person's, over the
 * default. `runMode` is the person's alone (`personal`, else `default`), and `mergeFiles` the
 * project's alone (`project`, else `default`): a project file cannot hold the first
 * (`checkPersonalOnlyFields`), and the person's file cannot hold the second (`schema.ts`).
 */
function plansFrom(personal: PersonalWorkflow, project: Workflow): ResolvedWorkflow["plans"] {
  const plans = mergeWorkflows(personal, project).plans ?? {};
  const mergeFiles = project.plans?.mergeFiles;
  const runMode = personal.plans?.runMode;
  return {
    maxPhases: {
      value: plans.maxPhases ?? workflowDefaults.plans.maxPhases,
      source: sourceOf(personal, project, "plans.maxPhases"),
    },
    mergeFiles:
      mergeFiles === undefined
        ? current([...workflowDefaults.plans.mergeFiles], "default")
        : current(mergeFiles, "project"),
    runMode:
      runMode === undefined
        ? current(workflowDefaults.plans.runMode, "default")
        : current(runMode, "personal"),
  };
}

/**
 * The **plan settings** on their own, resolved: what the task store reads when a phase is laid
 * (`src/tasks/ops.ts`). The same resolution as `resolveWorkflow`, without the switches (which
 * read the status line and the update hold). Throws `WorkflowConfigError` for a broken personal
 * file, naming it and the field.
 */
export function resolvePlans(
  paths: CliPaths,
  projectConfig: CcSmartDevKitConfig | null,
): ResolvedWorkflow["plans"] {
  return plansFrom(loadWorkflow(personalWorkflowFile(paths)), projectConfig?.workflow ?? {});
}

/**
 * The **alerts** on their own, resolved: what a hook and the status line read
 * (`src/workflow/alerts.ts`). It is the same resolution as `resolveWorkflow` — the project
 * over the person over the built-in default — without the switches, which a hook has no use
 * for. Throws `WorkflowConfigError` for a broken personal file, like `resolveWorkflow`.
 */
export function resolveAlerts(
  paths: CliPaths,
  projectConfig: CcSmartDevKitConfig | null,
): ResolvedWorkflow["alerts"] {
  const personal = loadWorkflow(personalWorkflowFile(paths));
  return alertsFrom(personal, projectConfig?.workflow ?? {});
}

/** Every alert setting at its built-in default: what a hook falls back to, never throwing. */
export function defaultAlerts(): ResolvedWorkflow["alerts"] {
  return {
    usagePercent: { value: workflowDefaults.alerts.usagePercent, source: "default" },
  };
}

/** A `statusLine` someone else set: not cc-smart-dev-kit's, so the switch reads as off. */
function statusLineIsOurs(paths: CliPaths): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(paths.settingsFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return false;
    const statusLine = (parsed as { statusLine?: unknown }).statusLine;
    return Bun.deepEquals(statusLine, statuslineSetting(paths), true);
  } catch {
    // No settings file, or one Claude Code cannot read either: cc-smart-dev-kit's status line is not on.
    return false;
  }
}

/** A setting that lives elsewhere, as the resolver reports it: its value now, and where it lives. */
function current<T>(value: T, source: WorkflowSource): ResolvedValue<T> {
  return { value, source };
}

/** The project's value of a boolean field that lives in `.claude/cc-smart-dev-kit.json`. */
function projectFlag(value: boolean | undefined): ResolvedValue<boolean> {
  return value === undefined ? current(false, "default") : current(value, "project");
}

/**
 * `switches.jobRoute`: the project's `jobs.route` when it sets one, else the person's
 * machine-wide default, else off. The project wins field by field, as every other workflow
 * setting does; the one place that decides it.
 */
export function jobRouteFrom(
  personal: PersonalWorkflow,
  projectConfig: CcSmartDevKitConfig | null,
): ResolvedValue<boolean> {
  const project = projectConfig?.jobs?.route;
  if (project !== undefined) return current(project, "project");
  const own = personal.switches?.jobRoute;
  return own === undefined ? current(false, "default") : current(own, "personal");
}

/**
 * `switches.jobRoute` on its own, for the `job-route` hook: it runs on every Bash call, so it
 * reads the person's workflow file and the project's config, not the status line or the update
 * hold the whole resolution also looks at. A personal file that cannot be used is the case the
 * resolver's header names for a hook: the project's value and the default still stand.
 */
export function resolveJobRoute(
  paths: CliPaths,
  projectConfig: CcSmartDevKitConfig | null,
): ResolvedValue<boolean> {
  return jobRouteFrom(personalWorkflowOrDefault(paths), projectConfig);
}

/** Whether the lead-model hint is on when nothing turns it off: on. */
export const LEAD_HINT_DEFAULT = true;

/**
 * `switches.leadHint`: the person's own value in their workflow file, else on. A machine-wide
 * switch — the hint is about the session's model, not the project — so no project file sets it.
 */
export function leadHintFrom(personal: PersonalWorkflow): ResolvedValue<boolean> {
  const own = personal.switches?.leadHint;
  return own === undefined ? current(LEAD_HINT_DEFAULT, "default") : current(own, "personal");
}

/**
 * `switches.leadHint` on its own, for the `fable-session` hook. It never throws: a personal
 * file that cannot be used is the case the resolver's header names for a hook, and the default
 * (on) stands.
 */
export function resolveLeadHint(paths: CliPaths): ResolvedValue<boolean> {
  return leadHintFrom(personalWorkflowOrDefault(paths));
}

/**
 * Where a value came from, as a person reads it: `project, committed on origin/dev` when the
 * project's part was read from a branch's committed file (`resolveGate`), else the bare source.
 */
export function sourceLabel(value: ResolvedValue<unknown>, branch: string | null): string {
  return value.source === "project" && branch !== null
    ? `project, committed on origin/${branch}`
    : value.source;
}

/**
 * The review gate (`REVIEW_GATE_KEYS`) as merge-check reads it: the built-in default, the
 * person's own file, and the project's file **as committed on `origin/<branch>`**, never the
 * working copy of a checkout. A session can edit its own worktree's file; it cannot change
 * what a branch it has not pushed to says.
 */
export interface Gate {
  /** The branch whose committed file holds the project's part; null when none was named. */
  branch: string | null;
  /** That committed file; null when no branch was named. */
  config: CcSmartDevKitConfig | null;
  /** Every value, resolved over that committed file. */
  resolved: ResolvedWorkflow;
}

/** The gate, or why it cannot be read (the caller asks the person). */
export type GateRead = { ok: true; gate: Gate } | { ok: false; why: string };

/**
 * The gate for `branch`. With `branch` null (the project names no `worktrees.base`), only the
 * default and the person's file count. A ref or a file that is not there, or a committed file
 * that cannot be used, is `ok: false` with the reason; a broken personal file throws
 * `WorkflowConfigError`, as `resolveWorkflow` does.
 */
export function resolveGate(
  paths: CliPaths,
  checkout: Checkout,
  branch: string | null,
  options: CommittedOptions = {},
): GateRead {
  if (branch === null) {
    return { ok: true, gate: { branch, config: null, resolved: resolveWorkflow(paths, null) } };
  }
  let committed: CommittedConfig;
  try {
    committed = readCommittedConfig(checkout, branch, options);
  } catch (error) {
    // A committed file too new or broken, or no git at all: the gate is unknown, never guessed.
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  return gateOfCommitted(paths, branch, committed);
}

/**
 * `resolveGate`, without blocking the caller: the same gate from the same committed file,
 * read with `Bun.spawn` (`readCommittedConfigAsync`). The portal's merge verdicts run inside
 * the server's own process (`.claude/rules/portal.md`); a hook or a command keeps the
 * blocking read above.
 */
export async function resolveGateAsync(
  paths: CliPaths,
  checkout: Checkout,
  branch: string | null,
  options: CommittedOptions = {},
): Promise<GateRead> {
  if (branch === null) {
    return { ok: true, gate: { branch, config: null, resolved: resolveWorkflow(paths, null) } };
  }
  let committed: CommittedConfig;
  try {
    committed = await readCommittedConfigAsync(checkout, branch, options);
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  return gateOfCommitted(paths, branch, committed);
}

/** The gate a committed read gives, or why it cannot judge. One home for both readers. */
function gateOfCommitted(
  paths: CliPaths,
  branch: string | null,
  committed: CommittedConfig,
): GateRead {
  if (!committed.found) return { ok: false, why: committed.why };
  const resolved = resolveWorkflow(paths, committed.config);
  return { ok: true, gate: { branch, config: committed.config, resolved } };
}

/** The merge files the store and herdr act on, and why a list may be empty or cut. */
export interface MergeFiles {
  /** Normalised, `/`-separated, a folder ending in `/`. Empty when none could be read. */
  files: string[];
  /** Why the list is empty or short of an entry, for the caller to show; null when it is whole. */
  reason: string | null;
}

/**
 * `plans.mergeFiles` **as committed on `origin/<base>`**: the one list the plans' overlap check
 * leaves out. Read as the review gate is (`readCommittedConfig`), never from a working copy a
 * session can edit, so a session cannot widen it. It needs no person's file: the key is a
 * project fact, so unlike `resolveGate` this does not read the person's workflow file.
 *
 * `base` is the project's integration base (`worktrees.base`). With none, or when the ref, the
 * file or git cannot be read, the list is empty and `reason` says why, and the caller shows it.
 * Nothing falls back to the working copy.
 *
 * An entry written without a trailing `/` that names a folder in the committed tree is left out
 * and named in `reason`, with the fix: `docs` would match only a file called `docs`, so the check
 * would quietly leave out nothing. The tree is asked with git, so parsing stays pure
 * (`normalizeMergeFile`). A path that is not in the tree stays: a build output may not be committed.
 */
export function resolveMergeFiles(
  checkout: Checkout,
  base: string | null,
  options: CommittedOptions = {},
): MergeFiles {
  if (base === null) {
    return {
      files: [],
      reason:
        "this project names no worktrees.base, so there is no committed copy of plans.mergeFiles to read",
    };
  }
  let committed: CommittedConfig;
  try {
    committed = readCommittedConfig(checkout, base, options);
  } catch (error) {
    return { files: [], reason: error instanceof Error ? error.message : String(error) };
  }
  if (!committed.found) return { files: [], reason: committed.why };
  return settleMergeFiles(
    checkout,
    base,
    committed.config.workflow?.plans?.mergeFiles ?? [],
    options,
  );
}

/**
 * The list `listed` (already read from the committed file on `origin/<base>`) as the plan tools
 * use it: a bare entry that names a folder on the committed tree is left out, named in `reason`.
 * The second half of `resolveMergeFiles`, apart so that a caller that has the committed file
 * already (`workflow show`, through the gate's read) asks git about the tree only and never reads
 * the file a second time.
 */
export function settleMergeFiles(
  checkout: Checkout,
  base: string,
  listed: readonly string[],
  options: CommittedOptions = {},
): MergeFiles {
  const files: string[] = [];
  const folders: string[] = [];
  for (const path of listed) {
    if (!path.endsWith("/") && isFolderOnBase(checkout, base, path, options)) folders.push(path);
    else files.push(path);
  }
  if (folders.length === 0) return { files, reason: null };
  const hints = folders.map((path) => `${path} is a folder: write it ${path}/`);
  return {
    files,
    reason: `plans.mergeFiles on origin/${base} leaves out ${folders.join(", ")} until fixed (${hints.join("; ")})`,
  };
}

/** True when `path` is a folder (a tree) in the commit `origin/<base>` points at. */
function isFolderOnBase(
  checkout: Checkout,
  base: string,
  path: string,
  options: CommittedOptions,
): boolean {
  const kind = runGit(
    checkout.root,
    ["cat-file", "-t", `refs/remotes/origin/${base}:${path}`],
    options.env ?? process.env,
    options.timeoutMs ?? RESOLVE_GIT_TIMEOUT_MS,
  );
  return kind.ok && kind.out === "tree";
}

/** Where each key's value sits in a resolved workflow: one entry per key, so none is missed. */
const RESOLVED: {
  readonly [K in WorkflowKey]: (resolved: ResolvedWorkflow) => ResolvedValue<unknown>;
} = {
  autoCommit: (r) => r.autoCommit,
  autoPush: (r) => r.autoPush,
  openPr: (r) => r.openPr,
  autoMerge: (r) => r.autoMerge,
  mergeMethod: (r) => r.mergeMethod,
  deleteBranch: (r) => r.deleteBranch,
  reviewBeforePush: (r) => r.reviewBeforePush,
  reviewAgents: (r) => r.reviewAgents,
  "fixesAfterReview.lines": (r) => r.fixesAfterReview.lines,
  "fixesAfterReview.files": (r) => r.fixesAfterReview.files,
  "fixesAfterReview.percent": (r) => r.fixesAfterReview.percent,
  clearWorktreeAfterMerge: (r) => r.clearWorktreeAfterMerge,
  "issues.enabled": (r) => r.issues.enabled,
  "issues.allowPublic": (r) => r.issues.allowPublic,
  "issues.foundLabel": (r) => r.issues.foundLabel,
  "issues.fixedLabel": (r) => r.issues.fixedLabel,
  "issues.readyLabel": (r) => r.issues.readyLabel,
  "alerts.usagePercent": (r) => r.alerts.usagePercent,
  "plans.maxPhases": (r) => r.plans.maxPhases,
  "plans.runMode": (r) => r.plans.runMode,
  "plans.mergeFiles": (r) => r.plans.mergeFiles,
  "switches.statusLine": (r) => r.switches.statusLine,
  "switches.sessionNames": (r) => r.switches.sessionNames,
  "switches.jobRoute": (r) => r.switches.jobRoute,
  "switches.updateHold": (r) => r.switches.updateHold,
  "switches.leadHint": (r) => r.switches.leadHint,
};

/**
 * The value and source the resolver holds for one key. The one map from a key to its value:
 * `workflow show` and the portal's Settings page both read through it.
 */
export function resolvedValueOf(
  resolved: ResolvedWorkflow,
  key: WorkflowKey,
): ResolvedValue<unknown> {
  return RESOLVED[key](resolved);
}

/**
 * Every workflow value, resolved. Reads the person's file and the three settings a switch
 * maps onto; throws `WorkflowConfigError` when the person's file is broken.
 */
export function resolveWorkflow(
  paths: CliPaths,
  projectConfig: CcSmartDevKitConfig | null,
): ResolvedWorkflow {
  const personal = loadWorkflow(personalWorkflowFile(paths));
  const project = projectConfig?.workflow ?? {};
  const merged = mergeWorkflows(personal, project);
  const of = <T>(key: WorkflowKey, value: T): ResolvedValue<T> => ({
    value,
    source: sourceOf(personal, project, key),
  });
  const fixes = merged.fixesAfterReview ?? {};
  const issues = merged.issues ?? {};
  return {
    autoCommit: of("autoCommit", merged.autoCommit ?? workflowDefaults.autoCommit),
    autoPush: of("autoPush", merged.autoPush ?? workflowDefaults.autoPush),
    openPr: of("openPr", merged.openPr ?? workflowDefaults.openPr),
    autoMerge: of("autoMerge", merged.autoMerge ?? workflowDefaults.autoMerge),
    mergeMethod: of("mergeMethod", merged.mergeMethod ?? workflowDefaults.mergeMethod),
    deleteBranch: of("deleteBranch", merged.deleteBranch ?? workflowDefaults.deleteBranch),
    reviewBeforePush: of(
      "reviewBeforePush",
      merged.reviewBeforePush ?? workflowDefaults.reviewBeforePush,
    ),
    reviewAgents: of("reviewAgents", merged.reviewAgents ?? [...workflowDefaults.reviewAgents]),
    fixesAfterReview: {
      lines: of("fixesAfterReview.lines", fixes.lines ?? workflowDefaults.fixesAfterReview.lines),
      files: of("fixesAfterReview.files", fixes.files ?? workflowDefaults.fixesAfterReview.files),
      percent: of(
        "fixesAfterReview.percent",
        fixes.percent ?? workflowDefaults.fixesAfterReview.percent,
      ),
    },
    clearWorktreeAfterMerge: of(
      "clearWorktreeAfterMerge",
      merged.clearWorktreeAfterMerge ?? workflowDefaults.clearWorktreeAfterMerge,
    ),
    issues: {
      enabled: of("issues.enabled", issues.enabled ?? workflowDefaults.issues.enabled),
      allowPublic: of(
        "issues.allowPublic",
        issues.allowPublic ?? workflowDefaults.issues.allowPublic,
      ),
      foundLabel: of("issues.foundLabel", issues.foundLabel ?? workflowDefaults.issues.foundLabel),
      fixedLabel: of("issues.fixedLabel", issues.fixedLabel ?? workflowDefaults.issues.fixedLabel),
      readyLabel: of("issues.readyLabel", issues.readyLabel ?? workflowDefaults.issues.readyLabel),
    },
    // One home with `resolveAlerts` (below): the alerts are resolved the same way here.
    alerts: alertsFrom(personal, project),
    plans: plansFrom(personal, project),
    switches: {
      statusLine: statusLineIsOurs(paths) ? current(true, "personal") : current(false, "default"),
      sessionNames: projectFlag(projectConfig?.sessionNames),
      jobRoute: jobRouteFrom(personal, projectConfig),
      updateHold: isHeld(updateFiles(paths.stateDir))
        ? current(true, "personal")
        : current(false, "default"),
      leadHint: leadHintFrom(personal),
    },
  };
}
