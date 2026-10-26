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
 * **The review gate** (`REVIEW_GATE_KEYS`, what the merge guard judges with) resolves the same
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
 * A broken personal file throws `WorkflowConfigError` (the message names the file and the
 * field): the person must hear that their file is wrong. A caller that must not fail — a
 * hook — catches it and uses the project's values and the defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import type { CcSmartDevKitConfig } from "../project/config";
import {
  type Checkout,
  type CommittedConfig,
  type CommittedOptions,
  readCommittedConfig,
  readCommittedConfigAsync,
} from "../project/resolve";
import { statuslineSetting } from "../setup/statusline";
import { isHeld, updateFiles } from "../update/state";
import { describeIssues } from "../zod-issues";
import {
  type AlertEvent,
  type PersonalWorkflow,
  personalWorkflowSchema,
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
    /** The lead hears new issues and comments (1.4.0): the watch looks at GitHub now and then. */
    watch: ResolvedValue<boolean>;
    watchMinutes: ResolvedValue<number>;
    foundLabel: ResolvedValue<string>;
    fixedLabel: ResolvedValue<string>;
    readyLabel: ResolvedValue<string>;
  };
  alerts: {
    events: ResolvedValue<AlertEvent[]>;
    sound: ResolvedValue<boolean>;
    usagePercent: ResolvedValue<number>;
  };
  crew: {
    enabled: ResolvedValue<boolean>;
    /** The plugins and servers a crew session keeps (`plugin:<id>`, `server:<name>`). */
    keep: ResolvedValue<string[]>;
    idleStopMinutes: ResolvedValue<number>;
    max: ResolvedValue<number>;
    /** Null: no machine-wide opus count is set (D54). */
    maxOpus: ResolvedValue<null | number>;
    memoryGb: ResolvedValue<number>;
    loadPerCore: ResolvedValue<number>;
    perLead: ResolvedValue<number>;
    perLeadOpus: ResolvedValue<number>;
    usagePercent: ResolvedValue<number>;
    quietMinutes: ResolvedValue<number>;
    handoffPercent: ResolvedValue<number>;
    handoffTokens: ResolvedValue<number>;
    softHours: ResolvedValue<number>;
    maxHours: ResolvedValue<number>;
    /** Days a removed crew session's conversation stays in the kit's archive. */
    archiveDays: ResolvedValue<number>;
    /** Null: no tag is set, and the main checkout's folder name stands in. */
    tag: ResolvedValue<null | string>;
  };
  switches: {
    statusLine: ResolvedValue<boolean>;
    sessionNames: ResolvedValue<boolean>;
    jobRoute: ResolvedValue<boolean>;
    updateHold: ResolvedValue<boolean>;
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
 * group's fields too (`alerts`, `fixesAfterReview`, `crew`).
 */
export function mergeWorkflows(personal: Workflow, project: Workflow): Workflow {
  const merged: Workflow = { ...personal, ...project };
  const alerts = mergedGroup(personal.alerts, project.alerts);
  if (alerts !== undefined) merged.alerts = alerts;
  const fixes = mergedGroup(personal.fixesAfterReview, project.fixesAfterReview);
  if (fixes !== undefined) merged.fixesAfterReview = fixes;
  const crew = mergedGroup(personal.crew, project.crew);
  if (crew !== undefined) merged.crew = crew;
  const issues = mergedGroup(personal.issues, project.issues);
  if (issues !== undefined) merged.issues = issues;
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
    events: of("alerts.events", alerts.events ?? workflowDefaults.alerts.events),
    sound: of("alerts.sound", alerts.sound ?? workflowDefaults.alerts.sound),
    usagePercent: of(
      "alerts.usagePercent",
      alerts.usagePercent ?? workflowDefaults.alerts.usagePercent,
    ),
  };
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
    events: { value: [...workflowDefaults.alerts.events], source: "default" },
    sound: { value: workflowDefaults.alerts.sound, source: "default" },
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
 * The review gate (`REVIEW_GATE_KEYS`) as the merge guard reads it: the built-in default, the
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
  "issues.watch": (r) => r.issues.watch,
  "issues.watchMinutes": (r) => r.issues.watchMinutes,
  "issues.foundLabel": (r) => r.issues.foundLabel,
  "issues.fixedLabel": (r) => r.issues.fixedLabel,
  "issues.readyLabel": (r) => r.issues.readyLabel,
  "alerts.events": (r) => r.alerts.events,
  "alerts.sound": (r) => r.alerts.sound,
  "alerts.usagePercent": (r) => r.alerts.usagePercent,
  "crew.enabled": (r) => r.crew.enabled,
  "crew.keep": (r) => r.crew.keep,
  "crew.idleStopMinutes": (r) => r.crew.idleStopMinutes,
  "crew.max": (r) => r.crew.max,
  "crew.maxOpus": (r) => r.crew.maxOpus,
  "crew.memoryGb": (r) => r.crew.memoryGb,
  "crew.loadPerCore": (r) => r.crew.loadPerCore,
  "crew.perLead": (r) => r.crew.perLead,
  "crew.perLeadOpus": (r) => r.crew.perLeadOpus,
  "crew.usagePercent": (r) => r.crew.usagePercent,
  "crew.quietMinutes": (r) => r.crew.quietMinutes,
  "crew.handoffPercent": (r) => r.crew.handoffPercent,
  "crew.handoffTokens": (r) => r.crew.handoffTokens,
  "crew.softHours": (r) => r.crew.softHours,
  "crew.maxHours": (r) => r.crew.maxHours,
  "crew.archiveDays": (r) => r.crew.archiveDays,
  "crew.tag": (r) => r.crew.tag,
  "switches.statusLine": (r) => r.switches.statusLine,
  "switches.sessionNames": (r) => r.switches.sessionNames,
  "switches.jobRoute": (r) => r.switches.jobRoute,
  "switches.updateHold": (r) => r.switches.updateHold,
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
  const crew = merged.crew ?? {};
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
      watch: of("issues.watch", issues.watch ?? workflowDefaults.issues.watch),
      watchMinutes: of(
        "issues.watchMinutes",
        issues.watchMinutes ?? workflowDefaults.issues.watchMinutes,
      ),
      foundLabel: of("issues.foundLabel", issues.foundLabel ?? workflowDefaults.issues.foundLabel),
      fixedLabel: of("issues.fixedLabel", issues.fixedLabel ?? workflowDefaults.issues.fixedLabel),
      readyLabel: of("issues.readyLabel", issues.readyLabel ?? workflowDefaults.issues.readyLabel),
    },
    // One home with `resolveAlerts` (below): the alerts are resolved the same way here.
    alerts: alertsFrom(personal, project),
    crew: {
      enabled: of("crew.enabled", crew.enabled ?? workflowDefaults.crew.enabled),
      // A list is one value: the project's whole list wins, like `alerts.events`.
      keep: of("crew.keep", crew.keep ?? [...workflowDefaults.crew.keep]),
      idleStopMinutes: of(
        "crew.idleStopMinutes",
        crew.idleStopMinutes ?? workflowDefaults.crew.idleStopMinutes,
      ),
      max: of("crew.max", crew.max ?? workflowDefaults.crew.max),
      maxOpus: of("crew.maxOpus", crew.maxOpus ?? workflowDefaults.crew.maxOpus),
      memoryGb: of("crew.memoryGb", crew.memoryGb ?? workflowDefaults.crew.memoryGb),
      loadPerCore: of("crew.loadPerCore", crew.loadPerCore ?? workflowDefaults.crew.loadPerCore),
      perLead: of("crew.perLead", crew.perLead ?? workflowDefaults.crew.perLead),
      perLeadOpus: of("crew.perLeadOpus", crew.perLeadOpus ?? workflowDefaults.crew.perLeadOpus),
      usagePercent: of(
        "crew.usagePercent",
        crew.usagePercent ?? workflowDefaults.crew.usagePercent,
      ),
      quietMinutes: of(
        "crew.quietMinutes",
        crew.quietMinutes ?? workflowDefaults.crew.quietMinutes,
      ),
      handoffPercent: of(
        "crew.handoffPercent",
        crew.handoffPercent ?? workflowDefaults.crew.handoffPercent,
      ),
      handoffTokens: of(
        "crew.handoffTokens",
        crew.handoffTokens ?? workflowDefaults.crew.handoffTokens,
      ),
      softHours: of("crew.softHours", crew.softHours ?? workflowDefaults.crew.softHours),
      maxHours: of("crew.maxHours", crew.maxHours ?? workflowDefaults.crew.maxHours),
      archiveDays: of("crew.archiveDays", crew.archiveDays ?? workflowDefaults.crew.archiveDays),
      tag: of("crew.tag", crew.tag ?? workflowDefaults.crew.tag),
    },
    switches: {
      statusLine: statusLineIsOurs(paths) ? current(true, "personal") : current(false, "default"),
      sessionNames: projectFlag(projectConfig?.sessionNames),
      jobRoute: jobRouteFrom(personal, projectConfig),
      updateHold: isHeld(updateFiles(paths.stateDir))
        ? current(true, "personal")
        : current(false, "default"),
    },
  };
}
