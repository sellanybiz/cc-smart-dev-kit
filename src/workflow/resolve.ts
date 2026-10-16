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
 * A **switch** is different on purpose: it names a setting that already exists — the status
 * line in Claude Code's `settings.json` (setup's `--statusline`), the project's
 * `sessionNames`, its `jobs.route`, and the update hold file (`update --hold`). The value
 * resolved here is that setting's value right now, read where it lives; nothing is stored in
 * the workflow file (`schema.ts`). So `switches.sessionNames` and `switches.jobRoute` read
 * as `project`, `switches.statusLine` and `switches.updateHold` as `personal`, and a switch
 * that is off with nothing set behind it as `default`.
 *
 * A broken personal file throws `WorkflowConfigError` (the message names the file and the
 * field): the person must hear that their file is wrong. A caller that must not fail — a
 * hook — catches it and uses the project's values and the defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { statuslineSetting } from "../cli/setup";
import type { CcSmartDevKitConfig } from "../project/config";
import { isHeld, updateFiles } from "../update/state";
import {
  type AlertEvent,
  type Workflow,
  type WorkflowKey,
  workflowDefaults,
  workflowSchema,
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
  clearWorktreeAfterMerge: ResolvedValue<boolean>;
  alerts: {
    events: ResolvedValue<AlertEvent[]>;
    sound: ResolvedValue<boolean>;
    usagePercent: ResolvedValue<number>;
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

/** Reads one workflow object: `{}` when the file does not exist, throws when it is broken. */
export function loadWorkflow(file: string): Workflow {
  if (!existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkflowConfigError(`Invalid ${file}: not valid JSON (${reason})`);
  }
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
      return issue.code === "unrecognized_keys"
        ? `${issue.keys.join(", ")}: unknown field`
        : `${field}: ${issue.message}`;
    });
    throw new WorkflowConfigError(`Invalid ${file}: ${issues.join("; ")}`);
  }
  return parsed.data;
}

/** The project's workflow object and the person's, the project's over it, field by field. */
export function mergeWorkflows(personal: Workflow, project: Workflow): Workflow {
  const merged: Workflow = { ...personal, ...project };
  const alerts = { ...personal.alerts, ...project.alerts };
  if (Object.keys(alerts).length > 0) merged.alerts = alerts;
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
    clearWorktreeAfterMerge: of(
      "clearWorktreeAfterMerge",
      merged.clearWorktreeAfterMerge ?? workflowDefaults.clearWorktreeAfterMerge,
    ),
    // One home with `resolveAlerts` (below): the alerts are resolved the same way here.
    alerts: alertsFrom(personal, project),
    switches: {
      statusLine: statusLineIsOurs(paths) ? current(true, "personal") : current(false, "default"),
      sessionNames: projectFlag(projectConfig?.sessionNames),
      jobRoute: projectFlag(projectConfig?.jobs?.route),
      updateHold: isHeld(updateFiles(paths.stateDir))
        ? current(true, "personal")
        : current(false, "default"),
    },
  };
}
