/**
 * The workflow's settings: what cc-smart-dev-kit may do by itself once a step is finished
 * (commit it, push the branch, open a pull request, merge it), how it merges, and the
 * switches that map onto settings which already exist.
 *
 * Two places hold the policy, and the project's wins field by field (`resolve.ts`):
 *
 * - the person's own defaults: `~/.config/cc-smart-dev-kit/workflow.json`, one object with
 *   the same fields as a project's `workflow` object;
 * - the project's committed `.claude/cc-smart-dev-kit.json` `workflow` object, so a team
 *   shares one policy and it travels with the code.
 *
 * **A switch is never stored here.** `switches.statusLine` and `switches.updateHold` are the
 * person's own settings, and `switches.sessionNames` and `switches.jobRoute` are the
 * project's `sessionNames` and `jobs.route`: the resolver reads the real setting, and a
 * `workflow set` writes it there. A second copy in this file would be a second truth, so
 * the schema does not accept one (`workflowSchema` has no `switches` field).
 *
 * **The built-in defaults are the safe ones:** nothing is committed, pushed or merged
 * without the person, and every alert is on.
 */
import { z } from "zod";

/** The four moments an alert is worth having. */
export const ALERT_EVENTS = ["needs-you", "question", "finished", "failed"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

const alertEventsSchema = z
  .array(z.enum(ALERT_EVENTS))
  .min(1)
  .refine((events) => new Set(events).size === events.length, "an event is listed twice");

export const workflowSchema = z.strictObject({
  /** Commit each finished, reviewed step without asking. */
  autoCommit: z.boolean().optional(),
  /** Push the session's own branch (never a protected one: the git guard still asks there). */
  autoPush: z.boolean().optional(),
  /** Open a pull request for the branch: `"off"`, `"draft"` or `"ready"`. */
  openPr: z.enum(["off", "draft", "ready"]).optional(),
  /** Merge into the project's integration base, after CI is green and the review is done. */
  autoMerge: z.boolean().optional(),
  /** How a merge is made. */
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  /** Delete the branch after its merge. */
  deleteBranch: z.boolean().optional(),
  /** Run the review before a push. */
  reviewBeforePush: z.boolean().optional(),
  /** Clear the worktree once its pull request merged. */
  clearWorktreeAfterMerge: z.boolean().optional(),
  alerts: z
    .strictObject({
      /** Which moments alert. Default: all four. */
      events: alertEventsSchema.optional(),
      /** A sound with the alert. Default: no sound. */
      sound: z.boolean().optional(),
      /** The plan usage, in percent, a warning starts at. Default: 85. */
      usagePercent: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
});

export type Workflow = z.infer<typeof workflowSchema>;

/** Every value a setting falls back to when neither the project nor the person sets it. */
export const workflowDefaults = {
  autoCommit: false,
  autoPush: false,
  openPr: "off",
  autoMerge: false,
  mergeMethod: "merge",
  deleteBranch: false,
  reviewBeforePush: true,
  clearWorktreeAfterMerge: false,
  alerts: {
    events: [...ALERT_EVENTS] as AlertEvent[],
    sound: false,
    usagePercent: 85,
  },
} as const;

/**
 * The switches, and where each one really lives: read and written through the setting that
 * already exists, never stored in the workflow file.
 */
export const SWITCH_NAMES = ["statusLine", "sessionNames", "jobRoute", "updateHold"] as const;
export type SwitchName = (typeof SWITCH_NAMES)[number];

/** One setting a person may name on the command line. */
export type WorkflowKey =
  | "autoCommit"
  | "autoPush"
  | "openPr"
  | "autoMerge"
  | "mergeMethod"
  | "deleteBranch"
  | "reviewBeforePush"
  | "clearWorktreeAfterMerge"
  | "alerts.events"
  | "alerts.sound"
  | "alerts.usagePercent"
  | `switches.${SwitchName}`;

/** Every policy key, in the order `workflow show` and `--help` print them. */
export const POLICY_KEYS: readonly WorkflowKey[] = [
  "autoCommit",
  "autoPush",
  "openPr",
  "autoMerge",
  "mergeMethod",
  "deleteBranch",
  "reviewBeforePush",
  "clearWorktreeAfterMerge",
  "alerts.events",
  "alerts.sound",
  "alerts.usagePercent",
];

/** Every switch key, in the order `workflow show` prints them. */
export const SWITCH_KEYS: readonly WorkflowKey[] = SWITCH_NAMES.map(
  (name) => `switches.${name}` as WorkflowKey,
);

/** Every key a person may name, policy first. */
export const WORKFLOW_KEYS: readonly WorkflowKey[] = [...POLICY_KEYS, ...SWITCH_KEYS];

/** True when the key names a switch (which is read and written where it already lives). */
export function isSwitchKey(key: string): key is `switches.${SwitchName}` {
  return SWITCH_KEYS.includes(key as WorkflowKey);
}

/** The switch's own name: `"switches.statusLine"` → `"statusLine"`. */
export function switchOf(key: `switches.${SwitchName}`): SwitchName {
  return key.slice("switches.".length) as SwitchName;
}

/** Reads one key of a workflow object as a person would write it: `undefined` when unset. */
export function workflowValue(workflow: Workflow, key: WorkflowKey): unknown {
  const [head, tail] = key.split(".");
  if (head === undefined || tail === undefined)
    return (workflow as Record<string, unknown>)[head ?? ""];
  const group = (workflow as Record<string, unknown>)[head];
  if (typeof group !== "object" || group === null) return undefined;
  return (group as Record<string, unknown>)[tail];
}

/** `workflow` with one key set. Every other field stays, also a field of the same group. */
export function setWorkflowValue(workflow: Workflow, key: WorkflowKey, value: unknown): Workflow {
  const [head, tail] = key.split(".");
  if (head === undefined) return workflow;
  if (tail === undefined) return { ...workflow, [head]: value } as Workflow;
  const group = (workflow as Record<string, unknown>)[head];
  const kept = typeof group === "object" && group !== null ? group : {};
  return { ...workflow, [head]: { ...kept, [tail]: value } } as Workflow;
}

/** `workflow` without one key. A group left empty goes too, so the file stays short. */
export function unsetWorkflowValue(workflow: Workflow, key: WorkflowKey): Workflow {
  const [head, tail] = key.split(".");
  if (head === undefined) return workflow;
  const next = { ...workflow } as Record<string, unknown>;
  if (tail === undefined) {
    delete next[head];
    return next as Workflow;
  }
  const group = next[head];
  if (typeof group !== "object" || group === null) return workflow;
  const kept = { ...(group as Record<string, unknown>) };
  delete kept[tail];
  if (Object.keys(kept).length === 0) delete next[head];
  else next[head] = kept;
  return next as Workflow;
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false; why: string };

/** The four moments, in one list a person can read: `needs-you, question, finished, failed`. */
export function listAlertEvents(events: readonly AlertEvent[]): string {
  return events.join(", ");
}

/**
 * One value as a person typed it, for the key it belongs to. Refuses anything else with the
 * reason, so a typo never writes a value of the wrong kind.
 */
export function parseWorkflowValue(key: WorkflowKey, text: string): ParsedValue {
  const value = text.trim();
  if (key === "openPr" || key === "mergeMethod") {
    const words: string[] =
      key === "openPr" ? ["off", "draft", "ready"] : ["merge", "squash", "rebase"];
    return words.includes(value)
      ? { ok: true, value }
      : { ok: false, why: `${key} is one of ${words.join(", ")}` };
  }
  if (key === "alerts.usagePercent") {
    if (!/^\d+$/.test(value))
      return { ok: false, why: "alerts.usagePercent is a whole number 1-100" };
    const percent = Number(value);
    return percent >= 1 && percent <= 100
      ? { ok: true, value: percent }
      : { ok: false, why: "alerts.usagePercent is a whole number 1-100" };
  }
  if (key === "alerts.events") {
    const named = value
      .split(/[,\s]+/)
      .map((word) => word.trim())
      .filter((word) => word !== "");
    if (named.length === 0)
      return { ok: false, why: `alerts.events is a list of ${ALERT_EVENTS.join(", ")}` };
    const unknown = named.filter((word) => !ALERT_EVENTS.includes(word as AlertEvent));
    if (unknown.length > 0) {
      return {
        ok: false,
        why: `alerts.events: unknown ${unknown.join(", ")} (one of ${ALERT_EVENTS.join(", ")})`,
      };
    }
    const events = [...new Set(named)] as AlertEvent[];
    return { ok: true, value: events };
  }
  if (value === "true" || value === "false") return { ok: true, value: value === "true" };
  return { ok: false, why: `${key} is true or false` };
}

/** A value as `workflow show` prints it. */
export function showValue(value: unknown): string {
  if (Array.isArray(value)) return listAlertEvents(value as AlertEvent[]);
  return String(value);
}
