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
 * without the person, every alert is on, and no worker session starts.
 *
 * **A group** (`alerts`, `workers`, `fixesAfterReview`) is merged field by field like the rest,
 * and its fields are named with a dot (`workers.enabled`).
 */
import { z } from "zod";
import { isNameTag, TAG_RULE } from "../workers/names";

/** The four moments an alert is worth having. */
export const ALERT_EVENTS = ["needs-you", "question", "finished", "failed"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

const alertEventsSchema = z
  .array(z.enum(ALERT_EVENTS))
  .min(1)
  .refine((events) => new Set(events).size === events.length, "an event is listed twice");

/**
 * What a number setting takes: a whole number from `min` (up to `max`, when there is one), or
 * any number above 0. One home: the schema checks a file with it, and `parseWorkflowValue` a
 * value a person types, in the same words.
 */
type NumberRule = { kind: "whole"; max?: number; min: number } | { kind: "positive" };

const PERCENT: NumberRule = { kind: "whole", max: 100, min: 1 };
const AT_LEAST_ONE: NumberRule = { kind: "whole", min: 1 };
const AT_LEAST_ZERO: NumberRule = { kind: "whole", min: 0 };
const ABOVE_ZERO: NumberRule = { kind: "positive" };

/** The schema for a number of `rule`. */
function numberSchema(rule: NumberRule): z.ZodNumber {
  if (rule.kind === "positive") return z.number().positive();
  const whole = z.number().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}

/** Every number setting, and what it takes. */
const NUMBER_RULES = {
  "alerts.usagePercent": PERCENT,
  "workers.idleStopMinutes": AT_LEAST_ONE,
  "workers.max": AT_LEAST_ONE,
  "workers.memoryGb": ABOVE_ZERO,
  "workers.quietMinutes": AT_LEAST_ONE,
  "workers.handoffPercent": PERCENT,
  "workers.softHours": ABOVE_ZERO,
  "workers.maxHours": ABOVE_ZERO,
  "fixesAfterReview.lines": AT_LEAST_ZERO,
  "fixesAfterReview.files": AT_LEAST_ZERO,
  "fixesAfterReview.percent": AT_LEAST_ZERO,
} as const satisfies Partial<Record<WorkflowKey, NumberRule>>;

type NumberKey = keyof typeof NUMBER_RULES;

/** The optional schema of one number setting. */
function numberField(key: NumberKey) {
  return numberSchema(NUMBER_RULES[key]).optional();
}

/** The schema for the workers' tag: already clean, as the names need it (`isNameTag`). */
const tagSchema = z.string().refine(isNameTag, TAG_RULE);

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
  /**
   * The subagent types whose return records a review (`review-record`): the plugin's own
   * reviewer, plus any agent a project runs as its reviewer, by its exact name. Default:
   * just the plugin's.
   */
  reviewAgents: z
    .array(z.string().min(1))
    .min(1)
    .refine((agents) => new Set(agents).size === agents.length, "an agent is listed twice")
    .optional(),
  /**
   * How much a branch may change after its review and still count as reviewed (decision D17).
   * The change since the reviewed commit, the base's own changes taken out, is covered while its
   * lines stay within `lines` or `percent`% of the reviewed change's lines, whichever is more,
   * and its files within `files` or `percent`% of the reviewed files, whichever is more.
   * `0`/`0`/`0` means the exact reviewed commit only. A review-gate group: read from the base's
   * committed file. `readCover` (`review-cover.ts`) judges with it; the merge guard from D17b.
   */
  fixesAfterReview: z
    .strictObject({
      /** Lines changed after the review (added and removed). Default: 200. */
      lines: numberField("fixesAfterReview.lines"),
      /** Files changed after the review. Default: 10. */
      files: numberField("fixesAfterReview.files"),
      /** The same two counts, in percent of the reviewed change's own. Default: 20. */
      percent: numberField("fixesAfterReview.percent"),
    })
    .optional(),
  /** Clear the worktree once its pull request merged. */
  clearWorktreeAfterMerge: z.boolean().optional(),
  alerts: z
    .strictObject({
      /** Which moments alert. Default: all four. */
      events: alertEventsSchema.optional(),
      /** A sound with the alert. Default: no sound. */
      sound: z.boolean().optional(),
      /** The plan usage, in percent, a warning starts at. Default: 85. */
      usagePercent: numberField("alerts.usagePercent"),
    })
    .optional(),
  /**
   * Lead and worker sessions (decisions D34, D35): the switch, the limits a lead keeps its
   * workers to, and the tag in their names. In the person's file it is every project's default;
   * a project's file wins field by field. Nothing reads it for a decision yet.
   */
  workers: z
    .strictObject({
      /** Workers may start here: off, a lead uses subagents only. Default: false. */
      enabled: z.boolean().optional(),
      /** Minutes a blocked worker waits before its session is stopped; an answer brings it back. Default: 10. */
      idleStopMinutes: numberField("workers.idleStopMinutes"),
      /** At most this many workers run on this machine at once, across leads. Default: 4. */
      max: numberField("workers.max"),
      /** The free memory, in GB, a new worker needs; below it, the worker waits in the queue. Default: 2. */
      memoryGb: numberField("workers.memoryGb"),
      /** Minutes a working worker's transcript may stay still before it counts as quiet (an alert only). Default: 20. */
      quietMinutes: numberField("workers.quietMinutes"),
      /** The share of its context, in percent, at which a worker hands off to a next one. Default: 70. */
      handoffPercent: numberField("workers.handoffPercent"),
      /** Hours after which the lead gets a note about a worker still running. Default: 2. */
      softHours: numberField("workers.softHours"),
      /** Hours after which a worker hands off. Default: 4. */
      maxHours: numberField("workers.maxHours"),
      /** The tag in every lead's and worker's name (D26). Default: the main checkout's folder name. */
      tag: tagSchema.optional(),
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
  reviewAgents: ["cc-smart-dev-kit:reviewer"],
  // The lead's limits from the measured fix rounds (R5): 10% is covered, 105% and 160% ask.
  fixesAfterReview: {
    lines: 200,
    files: 10,
    percent: 20,
  },
  clearWorktreeAfterMerge: false,
  alerts: {
    events: [...ALERT_EVENTS] as AlertEvent[],
    sound: false,
    usagePercent: 85,
  },
  // Off by default (D34). The cap, the memory and the times are the plan's starting values,
  // approved with it; the first long worker run (P14) tunes them.
  workers: {
    enabled: false,
    idleStopMinutes: 10,
    max: 4,
    memoryGb: 2,
    quietMinutes: 20,
    handoffPercent: 70,
    softHours: 2,
    maxHours: 4,
    /** Null: the main checkout's folder name stands in (`workerTag` in `src/workers/names.ts`). */
    tag: null,
  },
} as const;

/** What `workflow show` prints for `workers.tag` while nobody sets it. */
export const WORKERS_TAG_UNSET = "the main checkout's folder name";

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
  | "reviewAgents"
  | "fixesAfterReview.lines"
  | "fixesAfterReview.files"
  | "fixesAfterReview.percent"
  | "clearWorktreeAfterMerge"
  | "alerts.events"
  | "alerts.sound"
  | "alerts.usagePercent"
  | "workers.enabled"
  | "workers.idleStopMinutes"
  | "workers.max"
  | "workers.memoryGb"
  | "workers.quietMinutes"
  | "workers.handoffPercent"
  | "workers.softHours"
  | "workers.maxHours"
  | "workers.tag"
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
  "reviewAgents",
  "fixesAfterReview.lines",
  "fixesAfterReview.files",
  "fixesAfterReview.percent",
  "clearWorktreeAfterMerge",
  "alerts.events",
  "alerts.sound",
  "alerts.usagePercent",
  "workers.enabled",
  "workers.idleStopMinutes",
  "workers.max",
  "workers.memoryGb",
  "workers.quietMinutes",
  "workers.handoffPercent",
  "workers.softHours",
  "workers.maxHours",
  "workers.tag",
];

/**
 * The settings the merge guard judges a merge with: the **review gate**. The guard reads them
 * from the person's own file and from the project's file as committed on the pull request's
 * base, never a checkout's working copy (`resolveGate` in `resolve.ts`), and `workflow set`
 * and `unset` refuse them inside Claude Code (`commands.ts`): only the person changes the gate.
 */
export const REVIEW_GATE_KEYS: readonly WorkflowKey[] = [
  "autoMerge",
  "reviewBeforePush",
  "reviewAgents",
  "fixesAfterReview.lines",
  "fixesAfterReview.files",
  "fixesAfterReview.percent",
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

/** True when the key names a number setting (`NUMBER_RULES`). */
function isNumberKey(key: string): key is NumberKey {
  return Object.hasOwn(NUMBER_RULES, key);
}

/** What a number setting takes, in words: `workers.max is a whole number, 1 or more`. */
function numberRuleText(key: NumberKey): string {
  const rule: NumberRule = NUMBER_RULES[key];
  if (rule.kind === "positive") return `${key} is a number above 0`;
  return rule.max === undefined
    ? `${key} is a whole number, ${rule.min} or more`
    : `${key} is a whole number ${rule.min}-${rule.max}`;
}

/** A number setting as a person typed it: digits (and a decimal point where one may be). */
function parseNumber(key: NumberKey, value: string): ParsedValue {
  const rule: NumberRule = NUMBER_RULES[key];
  const shape = rule.kind === "whole" ? /^\d+$/ : /^\d+(?:\.\d+)?$/;
  const number = Number(value);
  return shape.test(value) && numberSchema(rule).safeParse(number).success
    ? { ok: true, value: number }
    : { ok: false, why: numberRuleText(key) };
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
  if (isNumberKey(key)) return parseNumber(key, value);
  if (key === "workers.tag") {
    return isNameTag(value) ? { ok: true, value } : { ok: false, why: `${key} is ${TAG_RULE}` };
  }
  if (key === "reviewAgents") {
    const named = value
      .split(/[,\s]+/)
      .map((word) => word.trim())
      .filter((word) => word !== "");
    if (named.length === 0) {
      return {
        ok: false,
        why: "reviewAgents is a list of agent types, like cc-smart-dev-kit:reviewer",
      };
    }
    return { ok: true, value: [...new Set(named)] };
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

/**
 * A value as `workflow show` prints it: a list as words, a number, a boolean, a word — and an
 * unset `workers.tag` as what stands in for it.
 */
export function showValue(key: WorkflowKey, value: unknown): string {
  if (key === "workers.tag" && value === null) return `(${WORKERS_TAG_UNSET})`;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
