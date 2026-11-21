/**
 * The workflow's merge, without a parser: where a value came from, the project's fields over the
 * person's, and the two switches a hook decides from values it already holds. Nothing here
 * imports zod, so the `job-route` hook loads it without the schemas (`resolve.ts` keeps the file
 * reading and the defaults, and re-exports all of this). The order of the sources is the one
 * `resolve.ts` describes.
 */
import type { CcSmartDevKitConfig } from "../project/config";
import type { PersonalWorkflow, Workflow } from "./schema";

/** Where a value came from. */
export type WorkflowSource = "project" | "personal" | "default";

export interface ResolvedValue<T> {
  value: T;
  source: WorkflowSource;
}

/** A setting that lives elsewhere, as the resolver reports it: its value now, and where it lives. */
export function current<T>(value: T, source: WorkflowSource): ResolvedValue<T> {
  return { value, source };
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

/** Whether the lead-model hint is on when nothing turns it off: on. */
const LEAD_HINT_DEFAULT = true;

/**
 * `switches.leadHint`: the person's own value in their workflow file, else on. A machine-wide
 * switch — the hint is about the session's model, not the project — so no project file sets it.
 */
export function leadHintFrom(personal: PersonalWorkflow): ResolvedValue<boolean> {
  const own = personal.switches?.leadHint;
  return own === undefined ? current(LEAD_HINT_DEFAULT, "default") : current(own, "personal");
}
