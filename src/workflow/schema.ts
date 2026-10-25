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
 * without the person, every alert is on, and no crew session starts.
 *
 * **A group** (`alerts`, `crew`, `fixesAfterReview`) is merged field by field like the rest,
 * and its fields are named with a dot (`crew.enabled`).
 */
import { z } from "zod";
import { isNameTag, TAG_RULE } from "../crew/names";

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

/**
 * The fewest minutes between two looks at GitHub (`issues.watchMinutes`). One look is two
 * requests, so 2 minutes is at most 60 requests an hour for a repository, against the 5 000 an
 * authenticated account has; a look that finds nothing new is a `304`, which is free against that
 * limit (`.claude/research/2026-10-25-gi4-conditional.md`). A lower floor would only raise the
 * chance of a secondary limit. At most a day, so a typo cannot silence the watch for good.
 */
export const WATCH_MINUTES_FLOOR = 2;
const WATCH_MINUTES: NumberRule = { kind: "whole", max: 24 * 60, min: WATCH_MINUTES_FLOOR };

/** The schema for a number of `rule`. */
function numberSchema(rule: NumberRule): z.ZodNumber {
  if (rule.kind === "positive") return z.number().positive();
  const whole = z.number().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}

/** Every number setting, and what it takes. */
const NUMBER_RULES = {
  "alerts.usagePercent": PERCENT,
  "crew.idleStopMinutes": AT_LEAST_ONE,
  "crew.max": AT_LEAST_ONE,
  "crew.maxOpus": AT_LEAST_ONE,
  "crew.memoryGb": ABOVE_ZERO,
  "crew.loadPerCore": ABOVE_ZERO,
  "crew.perLead": AT_LEAST_ONE,
  "crew.perLeadOpus": AT_LEAST_ONE,
  "crew.usagePercent": PERCENT,
  "crew.quietMinutes": AT_LEAST_ONE,
  "crew.handoffPercent": PERCENT,
  "crew.handoffTokens": AT_LEAST_ONE,
  "crew.softHours": ABOVE_ZERO,
  "crew.maxHours": ABOVE_ZERO,
  "crew.archiveDays": AT_LEAST_ONE,
  "issues.watchMinutes": WATCH_MINUTES,
  "fixesAfterReview.lines": AT_LEAST_ZERO,
  "fixesAfterReview.files": AT_LEAST_ZERO,
  "fixesAfterReview.percent": AT_LEAST_ZERO,
} as const satisfies Partial<Record<WorkflowKey, NumberRule>>;

type NumberKey = keyof typeof NUMBER_RULES;

/** The optional schema of one number setting. */
function numberField(key: NumberKey) {
  return numberSchema(NUMBER_RULES[key]).optional();
}

/**
 * What a GitHub label name takes here: 1-50 characters (GitHub's own limit), one line, no
 * comma (`gh issue create --label` splits on it). One home: the schema checks a file with it,
 * and `parseWorkflowValue` a value a person types, in the same words.
 */
export const LABEL_RULE =
  "a label name of 1-50 characters on one line, with no comma, not starting with -";

/**
 * True when `name` is a label name the kit may ask GitHub for (`LABEL_RULE`). A leading `-`
 * is refused: a command line could read the name as an option.
 */
export function isLabelName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 50 &&
    !name.startsWith("-") &&
    !/[\p{Cc}\p{Cf},]/u.test(name) &&
    name.trim() === name
  );
}

const labelSchema = z.string().refine(isLabelName, LABEL_RULE);

/** The three labels GitHub Issues uses, by the name each has in `workflow.issues`. */
export interface IssueLabels {
  fixedLabel: string;
  foundLabel: string;
  readyLabel: string;
}

/**
 * Why the three labels cannot work together, or null when they differ (compared lower-cased:
 * GitHub treats a label name that way). The ready label is a person's choice — a phase starts
 * from an issue that carries it, added by someone with write access — so neither of the kit's
 * own labels may be the same word: the kit adds `foundLabel` to every issue it files and
 * `fixedLabel` at a merge, through the person's own `gh` login, and would then make an issue
 * ready by itself. The found and fixed labels differ too, or "fixed" could not be told from
 * "found". One home: the schema checks a file with it, and `issue file` and the fixed mark check
 * the resolved values (the person's file and the project's can each hold one of a pair).
 */
export function labelsClash(labels: IssueLabels): string | null {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (same(labels.foundLabel, labels.readyLabel)) {
    return `issues.foundLabel and issues.readyLabel are both ${labels.foundLabel}: the ready label is only a person's to add, so the kit's found label must be another word`;
  }
  if (same(labels.fixedLabel, labels.readyLabel)) {
    return `issues.fixedLabel and issues.readyLabel are both ${labels.fixedLabel}: the ready label is only a person's to add, so the kit's fixed label must be another word`;
  }
  if (same(labels.foundLabel, labels.fixedLabel)) {
    return `issues.foundLabel and issues.fixedLabel are both ${labels.foundLabel}: an issue could not be told found from fixed`;
  }
  return null;
}

/** The schema for the crew sessions' tag: already clean, as the names need it (`isNameTag`). */
const tagSchema = z.string().refine(isNameTag, TAG_RULE);

/**
 * One entry of `workflow.crew.keep`: a plugin a crew session keeps on, or an MCP server it keeps
 * beside the ones its kind needs. A plugin is named by its Claude Code id (`name@marketplace`),
 * a server by its name.
 */
export type CrewKeepEntry = { id: string; kind: "plugin" } | { kind: "server"; name: string };

/** The two shapes an entry takes, in the words a refusal says it. */
export const CREW_KEEP_RULE = '"plugin:<id>" or "server:<name>"';

/** One `workflow.crew.keep` entry, read; null when it is neither shape. */
export function parseCrewKeep(entry: string): CrewKeepEntry | null {
  if (entry.startsWith("plugin:")) {
    const id = entry.slice("plugin:".length);
    // `name@marketplace`, both non-empty: what `claude plugin list` names a plugin by.
    return /^[^\s@]+@[^\s@]+$/.test(id) ? { id, kind: "plugin" } : null;
  }
  if (entry.startsWith("server:")) {
    const name = entry.slice("server:".length);
    return /^[a-z0-9][a-z0-9-]*$/.test(name) ? { kind: "server", name } : null;
  }
  return null;
}

/** The schema for one entry: refused with its shape, so a typo never waits for the next start. */
const crewKeepSchema = z
  .string()
  .refine((entry) => parseCrewKeep(entry) !== null, `an entry is ${CREW_KEEP_RULE}`);

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
  /**
   * GitHub Issues, opt-in (decision D67): the kit files follow-ups and findings as issues in the
   * project's own repository (`cc-smart-dev-kit issue file`, `src/issues/`). Off by default, like
   * `autoPush` and `openPr`: an issue leaves the machine. Read as the other outward switches are,
   * from the person's file and the project's file **as committed on `origin/<base>`**
   * (`resolveGate`), never a working copy a session can edit.
   */
  issues: z
    .strictObject({
      /** The kit may file issues here. Default: false. */
      enabled: z.boolean().optional(),
      /** It may file them in a public repository, where everyone reads them. Default: false. */
      allowPublic: z.boolean().optional(),
      /**
       * The lead's watch looks at the project's issues and comments now and then and prints a
       * line for each new one (1.4.0, `src/issues/feed.ts`). A second switch, off by default even
       * with `enabled` on: it needs `enabled`, and reads only. Default: false.
       */
      watch: z.boolean().optional(),
      /** Minutes between two looks, 2 or more (`WATCH_MINUTES_FLOOR`). Default: 5. */
      watchMinutes: numberField("issues.watchMinutes"),
      /** The label on every issue the kit files. Default: kit:found. */
      foundLabel: labelSchema.optional(),
      /** The label of an issue whose fix is merged and not yet released. Default: fixed-unreleased. */
      fixedLabel: labelSchema.optional(),
      /** The label of an issue the kit may pick up and build. Default: kit:ready. */
      readyLabel: labelSchema.optional(),
    })
    .superRefine((issues, context) => {
      // A label this object does not set stands as its default, so a file cannot name the
      // default of another label (`labelsClash`).
      const clash = labelsClash({
        fixedLabel: issues.fixedLabel ?? workflowDefaults.issues.fixedLabel,
        foundLabel: issues.foundLabel ?? workflowDefaults.issues.foundLabel,
        readyLabel: issues.readyLabel ?? workflowDefaults.issues.readyLabel,
      });
      if (clash !== null) context.addIssue({ code: "custom", message: clash });
    })
    .optional(),
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
   * Lead and crew sessions (decisions D34, D35, D54): the switch, one lead's caps, the machine's
   * guards a start waits at, and the tag in their names. In the person's file it is every
   * project's default; a project's file wins field by field. `crew lead` and `crew start` read
   * `enabled`, `perLead`, `perLeadOpus`, `max`, `maxOpus`, `memoryGb`, `loadPerCore`, `usagePercent` and `tag`
   * (`src/crew/`); the rest is for the parts after them.
   */
  crew: z
    .strictObject({
      /** Crew sessions may start here: off, a lead uses subagents only. Default: false. */
      enabled: z.boolean().optional(),
      /**
       * What a crew session keeps beside the kit itself: a plugin (`plugin:<id>`) a phase needs,
       * or an MCP server (`server:<name>`, one the kit registers). Every other plugin is turned
       * off for the session and every other MCP server is not loaded, so its context goes to the
       * phase instead of to the machine's other tools. A plugin named here must be enabled on the
       * machine. Default: nothing.
       */
      keep: z.array(crewKeepSchema).optional(),
      /** Minutes a blocked crew session waits before its session is stopped; an answer brings it back. Default: 10. */
      idleStopMinutes: numberField("crew.idleStopMinutes"),
      /** The machine's safety ceiling: at most this many crew sessions run here at once, across leads (D54). Default: 24. */
      max: numberField("crew.max"),
      /**
       * An optional machine-wide opus ceiling inside `max` (D37). Unset: no machine-wide
       * count, and each lead's `perLeadOpus` alone bounds the opus tier. Default: unset.
       */
      maxOpus: numberField("crew.maxOpus"),
      /** The free memory, in GB, a new crew session needs; below it, the crew session waits in the queue. Default: 2. */
      memoryGb: numberField("crew.memoryGb"),
      /**
       * A new crew session waits while the 1-minute load average is above this many per core
       * (the cores times this number). Where the platform gives no load average (native
       * Windows), the hold does not apply. Default: 3.
       */
      loadPerCore: numberField("crew.loadPerCore"),
      /** At most this many crew sessions run for one lead at once, in every repository (D54). Default: 4. */
      perLead: numberField("crew.perLead"),
      /** At most this many of one lead's crew sessions on the opus tier (D54). Default: 2. */
      perLeadOpus: numberField("crew.perLeadOpus"),
      /**
       * Past this share of the 5-hour usage window, a new opus-tier crew session waits,
       * unless the gateway's opus slot has a chain with its fallback on (D54). The window
       * is the one the status line reads; with no reading, the guard does not hold.
       * Default: 85.
       */
      usagePercent: numberField("crew.usagePercent"),
      /** Minutes a working crew session's transcript may stay still before it counts as quiet (an alert only). Default: 20. */
      quietMinutes: numberField("crew.quietMinutes"),
      /**
       * The share of its context window, in percent, at which a crew session hands off to a
       * next one. It hands off at this share or at `handoffTokens`, whichever comes first.
       * Default: 70.
       */
      handoffPercent: numberField("crew.handoffPercent"),
      /**
       * The tokens of context at which a crew session hands off, whatever its window: a 1M
       * window hands off here, a 200k window at `handoffPercent` first. It needs no window, so
       * a model the kit cannot size still hands off at it. Default: 400000.
       */
      handoffTokens: numberField("crew.handoffTokens"),
      /** Hours after which the lead gets a note about a crew session still running. Default: 2. */
      softHours: numberField("crew.softHours"),
      /** Hours after which a crew session hands off. Default: 4. */
      maxHours: numberField("crew.maxHours"),
      /**
       * Days a removed crew session's conversation stays in the kit's archive, out of `/resume`,
       * before it is deleted (`src/crew/archive.ts`). Default: 7.
       */
      archiveDays: numberField("crew.archiveDays"),
      /** The tag in every lead's and crew session's name (D26). Default: the main checkout's folder name. */
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
  // Off by default (D67): an issue is public text in a repository, so each switch is the person's.
  issues: {
    enabled: false,
    allowPublic: false,
    watch: false,
    watchMinutes: 5,
    foundLabel: "kit:found",
    fixedLabel: "fixed-unreleased",
    readyLabel: "kit:ready",
  },
  alerts: {
    events: [...ALERT_EVENTS] as AlertEvent[],
    sound: false,
    usagePercent: 85,
  },
  // Off by default (D34). The caps are D54's: each lead keeps its own four crew sessions, two
  // on the opus tier, and the machine's ceiling is a safety net no lead reaches alone.
  crew: {
    enabled: false,
    keep: [],
    idleStopMinutes: 10,
    max: 24,
    /** Null: no machine-wide opus count; one set is the person's own ceiling. */
    maxOpus: null,
    memoryGb: 2,
    /** A start waits past a 1-minute load of 3 per core: busy but not drowning, queued work still finishes (seen: load 85 on 16 cores, 5 per core, with 24 sessions). */
    loadPerCore: 3,
    perLead: 4,
    perLeadOpus: 2,
    usagePercent: 85,
    quietMinutes: 20,
    handoffPercent: 70,
    handoffTokens: 400_000,
    softHours: 2,
    maxHours: 4,
    archiveDays: 7,
    /** Null: the main checkout's folder name stands in (`crewTag` in `src/crew/names.ts`). */
    tag: null,
  },
} as const;

/** What `workflow show` prints for `crew.tag` while nobody sets it. */
export const CREW_TAG_UNSET = "the main checkout's folder name";

/** What `workflow show` prints for `crew.maxOpus` while nobody sets it (D54: no machine count). */
export const CREW_MAX_OPUS_UNSET = "no machine-wide opus count";

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
  | "issues.enabled"
  | "issues.allowPublic"
  | "issues.watch"
  | "issues.watchMinutes"
  | "issues.foundLabel"
  | "issues.fixedLabel"
  | "issues.readyLabel"
  | "alerts.events"
  | "alerts.sound"
  | "alerts.usagePercent"
  | "crew.enabled"
  | "crew.keep"
  | "crew.idleStopMinutes"
  | "crew.max"
  | "crew.maxOpus"
  | "crew.memoryGb"
  | "crew.loadPerCore"
  | "crew.perLead"
  | "crew.perLeadOpus"
  | "crew.usagePercent"
  | "crew.quietMinutes"
  | "crew.handoffPercent"
  | "crew.handoffTokens"
  | "crew.softHours"
  | "crew.maxHours"
  | "crew.archiveDays"
  | "crew.tag"
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
  "issues.enabled",
  "issues.allowPublic",
  "issues.watch",
  "issues.watchMinutes",
  "issues.foundLabel",
  "issues.fixedLabel",
  "issues.readyLabel",
  "alerts.events",
  "alerts.sound",
  "alerts.usagePercent",
  "crew.enabled",
  "crew.keep",
  "crew.idleStopMinutes",
  "crew.max",
  "crew.maxOpus",
  "crew.memoryGb",
  "crew.loadPerCore",
  "crew.perLead",
  "crew.perLeadOpus",
  "crew.usagePercent",
  "crew.quietMinutes",
  "crew.handoffPercent",
  "crew.handoffTokens",
  "crew.softHours",
  "crew.maxHours",
  "crew.archiveDays",
  "crew.tag",
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

/**
 * The settings that let text leave the machine for GitHub (`issues.enabled`, `issues.allowPublic`).
 * `workflow set` and `unset` refuse them inside Claude Code (`commands.ts`), as they do a
 * review-gate key: a session must not turn on its own way out. `propose` stays open: its pull
 * request is reviewed and merged by a person.
 */
export const OUTBOUND_KEYS: readonly WorkflowKey[] = ["issues.enabled", "issues.allowPublic"];

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

/**
 * The switches the project's own file holds (`sessionNames`, `jobs.route`). The other two — the
 * status line and the update hold — are the person's, per machine: `workflow set --project`
 * refuses them (`write.ts`), and so has nothing for a pull request to change.
 */
export const PROJECT_SWITCH_NAMES: readonly SwitchName[] = ["sessionNames", "jobRoute"];

/**
 * True when the project's own file can hold the key: every policy key, and the project's two
 * switches. The one answer behind `workflow propose`'s refusal and the portal's list of what a
 * project's card may change; `propose.test.ts` holds it equal to what the writer accepts.
 */
export function isProjectKey(key: WorkflowKey): boolean {
  return !isSwitchKey(key) || PROJECT_SWITCH_NAMES.includes(switchOf(key));
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

/** What a number setting takes, in words: `crew.max is a whole number, 1 or more`. */
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
  if (key === "issues.foundLabel" || key === "issues.fixedLabel" || key === "issues.readyLabel") {
    return isLabelName(value) ? { ok: true, value } : { ok: false, why: `${key} is ${LABEL_RULE}` };
  }
  if (key === "crew.tag") {
    return isNameTag(value) ? { ok: true, value } : { ok: false, why: `${key} is ${TAG_RULE}` };
  }
  if (key === "crew.keep") {
    const named = value
      .split(/[,\s]+/)
      .map((word) => word.trim())
      .filter((word) => word !== "");
    if (named.length === 0) return { ok: false, why: `crew.keep is a list of ${CREW_KEEP_RULE}` };
    const unknown = named.filter((entry) => parseCrewKeep(entry) === null);
    if (unknown.length > 0) {
      return {
        ok: false,
        why: `crew.keep: unknown ${unknown.join(", ")} (an entry is ${CREW_KEEP_RULE})`,
      };
    }
    return { ok: true, value: [...new Set(named)] };
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
 * unset `crew.tag` as what stands in for it.
 */
export function showValue(key: WorkflowKey, value: unknown): string {
  if (key === "crew.tag" && value === null) return `(${CREW_TAG_UNSET})`;
  if (key === "crew.maxOpus" && value === null) return `(${CREW_MAX_OPUS_UNSET})`;
  if (Array.isArray(value)) return value.length === 0 ? "(nothing)" : value.join(", ");
  return String(value);
}
