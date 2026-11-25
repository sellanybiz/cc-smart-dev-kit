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
 * **A switch is not stored here, with one exception.** `switches.statusLine` and
 * `switches.updateHold` are the person's own settings, and `switches.sessionNames` is the
 * project's `sessionNames`: the resolver reads the real setting, and a `workflow set` writes it
 * there. A second copy in this file would be a second truth, so `workflowSchema` (also the
 * project's `workflow` object) has no `switches` field. The exceptions are the switches that
 * have no other home (`PERSONAL_FILE_SWITCH_NAMES`). `switches.jobRoute`: the project's
 * `jobs.route` is its own choice, and the person's file holds the machine-wide default under it
 * (`personalWorkflowSchema`, the only schema with a `switches` field). They are two settings of
 * one switch, not two copies: the project's wins field by field, as every other workflow setting
 * does (`resolve.ts`). `switches.leadHint` lives in the person's file alone.
 *
 * **The built-in defaults are the safe ones:** nothing is committed, pushed or merged
 * without the person, and the status-line usage warning starts at 85 percent.
 *
 * **A group** (`alerts`, `fixesAfterReview`, `plans`, `slopAudit`) is merged field by field like the rest,
 * and its fields are named with a dot (`alerts.usagePercent`).
 */
import { z } from "zod";
import { normalizeRepoPath, type RepoPathProblem } from "./repo-path";

/**
 * What a number setting takes: a whole number from `min` (up to `max`, when there is one), or
 * any number above 0. One home: the schema checks a file with it, and `parseWorkflowValue` a
 * value a person types, in the same words.
 */
type NumberRule = { kind: "whole"; max?: number; min: number };

const PERCENT: NumberRule = { kind: "whole", max: 100, min: 1 };
const AT_LEAST_ZERO: NumberRule = { kind: "whole", min: 0 };
/** How many phases one plan may hold: at least one, at most fifty. */
const PHASE_COUNT: NumberRule = { kind: "whole", max: 50, min: 1 };

/** The schema for a number of `rule`. */
function numberSchema(rule: NumberRule): z.ZodNumber {
  const whole = z.number().int().min(rule.min);
  return rule.max === undefined ? whole : whole.max(rule.max);
}

/** Every number setting, and what it takes. */
const NUMBER_RULES = {
  "alerts.usagePercent": PERCENT,
  "fixesAfterReview.lines": AT_LEAST_ZERO,
  "fixesAfterReview.files": AT_LEAST_ZERO,
  "fixesAfterReview.percent": AT_LEAST_ZERO,
  "plans.maxPhases": PHASE_COUNT,
  "slopAudit.everyPlans": AT_LEAST_ZERO,
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
 * GitHub treats a label name that way). The ready label is a person's choice — it marks an
 * issue someone with write access chose, whose text the kit then never rewrites — so neither of
 * the kit's own labels may be the same word: the kit adds `foundLabel` to every issue it files and
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

/** What `plans.runMode` takes: how queued plans are run when two or more are laid. */
export const RUN_MODES = ["ask", "solo", "lead-children", "coordinator"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** A merge file as written, normalised, or why it cannot stand. */
export type MergeFilePath = { ok: true; path: string } | { ok: false; why: string };

/**
 * One path of `plans.mergeFiles` (the paths every plan touches and each merge settles: a version
 * manifest, a changelog, a lockfile, build output), normalised by the one path rule
 * (`normalizeRepoPath`, which a plan's file list uses too) and worded for a person who typed it.
 * Pure: whether a path without a trailing `/` names a folder needs the repository, so
 * `resolvePlanFiles` (`resolve.ts`) checks that, on the committed tree. One home: the schema
 * checks a file with it, and `parseWorkflowValue` a value a person types.
 */
export function normalizeMergeFile(raw: string): MergeFilePath {
  const parsed = normalizeRepoPath(raw);
  if (parsed.ok) return parsed;
  const shown = JSON.stringify(raw);
  const why: Record<RepoPathProblem, string> = {
    control: `${shown} holds a control character`,
    pattern: `${shown} holds a pattern character (* or ?): name the path itself, and a whole folder with a trailing / (like plugin/dist/)`,
    root: `${shown} is the root: name the files or folders under it`,
    absolute: `${shown} is absolute: write it relative to the repository root`,
    up: `${shown} leaves the repository: no .. segments`,
  };
  return { ok: false, why: why[parsed.problem] };
}

/** The words of the one rule behind `normalizeMergeFile`, for a value a person types. */
export const MERGE_FILES_RULE =
  "plans.mergeFiles is a list of paths inside the repository, written with / (a folder ends in /), with no absolute path, no .. and not the root";

/**
 * The list in a file: each path normalised (`normalizeMergeFile`), a path named twice kept once.
 * A bad entry is an issue that names it, so the file is refused with the entry in the message.
 */
const mergeFilesSchema = z.array(z.string()).transform((paths, context) => {
  const normalised: string[] = [];
  for (const [index, raw] of paths.entries()) {
    const parsed = normalizeMergeFile(raw);
    if (!parsed.ok) {
      context.issues.push({ code: "custom", input: raw, message: parsed.why, path: [index] });
      return z.NEVER;
    }
    if (!normalised.includes(parsed.path)) normalised.push(parsed.path);
  }
  return normalised;
});

/**
 * One folder of `plans.appendOnly` (a folder where plans add new files, like a migrations
 * folder), normalised by the same path rule as a merge file (`normalizeMergeFile`) and ending in
 * `/`. A bare name is refused, not guessed: a folder written without its `/` would exempt nothing,
 * and a file named here would exempt a path that is not a folder. One home: the schema checks a
 * file with it, and `parseWorkflowValue` a value a person types.
 */
export function normalizeAppendOnlyFolder(raw: string): MergeFilePath {
  const parsed = normalizeMergeFile(raw);
  if (!parsed.ok || parsed.path.endsWith("/")) return parsed;
  return {
    ok: false,
    why: `${JSON.stringify(raw)} is not a folder: plans.appendOnly names folders, each ending in /`,
  };
}

/** The words of the one rule behind `normalizeAppendOnlyFolder`, for a value a person types. */
export const APPEND_ONLY_RULE =
  "plans.appendOnly is a list of folders inside the repository, each written with / and ending in /, with no absolute path, no .. and not the root";

/**
 * The list `plans.appendOnly` holds: each folder normalised (`normalizeAppendOnlyFolder`), named
 * once. Inside one, two plans overlap only when they list the same file (`filesOverlap`).
 */
const appendOnlySchema = z.array(z.string()).transform((paths, context) => {
  const folders: string[] = [];
  for (const [index, raw] of paths.entries()) {
    const parsed = normalizeAppendOnlyFolder(raw);
    if (!parsed.ok) {
      context.issues.push({ code: "custom", input: raw, message: parsed.why, path: [index] });
      return z.NEVER;
    }
    if (!folders.includes(parsed.path)) folders.push(parsed.path);
  }
  return folders;
});

/**
 * The names 6.1.0 replaced: each old workflow key and the key that says what it does (a setting
 * that lets a step happen without a question, not one that makes it happen). One home. Both files
 * read an old name as its new one (`withCurrentNames`), `workflow set`, `unset` and `propose`
 * take either (`currentKeyName`), and every write uses the new one. `doctor` names a file that
 * still holds an old key (`oldNamesIn`). `openPr` keeps its name: it is a choice of three.
 */
export const WORKFLOW_KEY_ALIASES = {
  autoCommit: "allowCommit",
  autoPush: "allowPush",
  autoMerge: "allowMerge",
} as const;

type OldWorkflowKey = keyof typeof WORKFLOW_KEY_ALIASES;
type CurrentKeyName = (typeof WORKFLOW_KEY_ALIASES)[OldWorkflowKey];

/** True when `name` is one of the old names (`WORKFLOW_KEY_ALIASES`). */
function isOldKeyName(name: string): name is OldWorkflowKey {
  return Object.hasOwn(WORKFLOW_KEY_ALIASES, name);
}

/** A setting name as a person typed it, as the current one: `autoPush` is `allowPush`. */
export function currentKeyName(name: string): string {
  return isOldKeyName(name) ? WORKFLOW_KEY_ALIASES[name] : name;
}

/** The old names a current key goes by (`allowPush`: `autoPush`); none for most keys. */
export function oldNamesOf(key: string): OldWorkflowKey[] {
  return (Object.keys(WORKFLOW_KEY_ALIASES) as OldWorkflowKey[]).filter(
    (old) => WORKFLOW_KEY_ALIASES[old] === key,
  );
}

/**
 * The old names a raw workflow object still holds, each with the key that replaced it and whether
 * the object holds that new key too (then the new one wins and the old one only needs removing).
 * What `doctor` says about a file.
 */
export function oldNamesIn(
  raw: Record<string, unknown>,
): { old: OldWorkflowKey; current: CurrentKeyName; both: boolean }[] {
  return (Object.keys(WORKFLOW_KEY_ALIASES) as OldWorkflowKey[])
    .filter((old) => Object.hasOwn(raw, old))
    .map((old) => ({
      old,
      current: WORKFLOW_KEY_ALIASES[old],
      both: Object.hasOwn(raw, WORKFLOW_KEY_ALIASES[old]),
    }));
}

/**
 * A raw workflow object with each old key moved to its new name, so the strict schema below
 * reads a file written before 6.1.0 as it reads a new one. When the object holds both names the
 * new one wins and the old one is dropped. Anything that is not a plain object passes through
 * for the schema to refuse in its own words.
 */
export function withCurrentNames(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const moved: Record<string, unknown> = { ...raw };
  for (const old of Object.keys(WORKFLOW_KEY_ALIASES) as OldWorkflowKey[]) {
    if (!Object.hasOwn(moved, old)) continue;
    const current = WORKFLOW_KEY_ALIASES[old];
    if (!Object.hasOwn(moved, current)) moved[current] = moved[old];
    delete moved[old];
  }
  return moved;
}

/**
 * `withCurrentNames` for a parse: a value moved from an old name is checked here, against the
 * new name's own rule, so a wrong one is refused under the name the file holds
 * (`autoPush: … (autoPush is the old name of allowPush)`), not under a name the person never
 * wrote. The bad value is left out, so the object is not refused a second time.
 */
function readWithCurrentNames(raw: unknown, context: z.core.$RefinementCtx): unknown {
  const moved = withCurrentNames(raw);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return moved;
  const current = moved as Record<string, unknown>;
  for (const old of oldNamesIn(raw as Record<string, unknown>)) {
    if (old.both) continue;
    const checked = workflowObjectSchema.shape[old.current].safeParse(current[old.current]);
    if (checked.success) continue;
    const reason = checked.error.issues.map((issue) => issue.message).join(", ");
    context.issues.push({
      code: "custom",
      input: current[old.current],
      message: `${reason} (${old.old} is the old name of ${old.current})`,
      path: [old.old],
    });
    delete current[old.current];
  }
  return current;
}

const workflowObjectSchema = z.strictObject({
  /** Let a finished, reviewed step be committed without asking. */
  allowCommit: z.boolean().optional(),
  /** Let the session push its own branch without asking. */
  allowPush: z.boolean().optional(),
  /** Open a pull request for the branch: `"off"`, `"draft"` or `"ready"`. */
  openPr: z.enum(["off", "draft", "ready"]).optional(),
  /** Let a session merge into the integration base or the default branch, after CI is green and the review is recorded (`workflow merge-check`). */
  allowMerge: z.boolean().optional(),
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
   * committed file. `readCover` (`review-cover.ts`) judges with it; merge-check from D17b.
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
   * How the kit's plans are shaped (`docs/design/tasks.md`). `runMode` is the person's own, so
   * it lives in `personalWorkflowSchema` alone, and a project file that sets it is refused
   * (`checkPersonalOnlyFields` in `src/project/config.ts`).
   */
  plans: z
    .strictObject({
      /** The most phases one plan may hold. Default: 10. */
      maxPhases: numberField("plans.maxPhases"),
      /**
       * Paths every plan touches and each merge settles, which the plans' overlap check leaves
       * out. A project fact, so it lives in the project's file alone, and it counts only as
       * **committed on `origin/<base>`** (`resolvePlanFiles`), never a working copy. Default: none.
       */
      mergeFiles: mergeFilesSchema.optional(),
      /**
       * Folders where plans add new files: inside one, two plans overlap only when they list the
       * same file, and no folder entry holds it (`filesOverlap`). A project fact like
       * `mergeFiles`, counted only as **committed on `origin/<base>`** (`resolvePlanFiles`).
       * Default: none.
       */
      appendOnly: appendOnlySchema.optional(),
    })
    .optional(),
  /**
   * GitHub Issues (decision D67): the kit files follow-ups and findings as issues in the
   * project's own repository (`cc-smart-dev-kit issue file`, `src/issues/`). On by default since
   * 5.0.0 (D7 of the deploy-tasks plan): the owner chose it, for projects that have a kit config.
   * `allowPublic` stays off, so a public repository still needs its own yes. Read as the other
   * outward switches are, from the person's file and the project's file **as committed on
   * `origin/<base>`** (`resolveGate`), never a working copy a session can edit.
   */
  issues: z
    .strictObject({
      /** The kit may file issues here. Default: true. */
      enabled: z.boolean().optional(),
      /** It may file them in a public repository, where everyone reads them. Default: false. */
      allowPublic: z.boolean().optional(),
      /** Accepted and ignored since 2.0: the issue feed and the lead's watch are gone. */
      watch: z.unknown().optional(),
      /** Accepted and ignored since 2.0: the issue feed and the lead's watch are gone. */
      watchMinutes: z.unknown().optional(),
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
      /** Retired notification keys load but never reach runtime settings. */
      events: z.unknown().optional(),
      sound: z.unknown().optional(),
      /** The plan usage, in percent, a warning starts at. Default: 85. */
      usagePercent: numberField("alerts.usagePercent"),
    })
    .transform(({ events: _events, sound: _sound, ...usage }) => usage)
    .optional(),
  /**
   * How often the kit offers a slop audit (`workflow slop`, `slop.ts`): after this many plans
   * closed since the last audit. `0` turns the count off; a plan that left a bypassed home or a
   * drifted copy still makes one due.
   */
  slopAudit: z
    .strictObject({
      /** Plans closed between two slop audits. Default: 5. */
      everyPlans: numberField("slopAudit.everyPlans"),
    })
    .optional(),
  /** 2.0 removed the crew; an old file's `crew` keys load and are ignored. */
  crew: z.unknown().optional(),
});

/**
 * The `workflow` object of a project's file, and the base of the person's: the strict object
 * above, read after `withCurrentNames`, so an old key name loads as its new one in both files.
 */
export const workflowSchema = z.preprocess(readWithCurrentNames, workflowObjectSchema);

export type Workflow = z.infer<typeof workflowSchema>;

/**
 * The switches the person's own file holds: `jobRoute`, a default the project's file may set in
 * its own place and then win (`jobs.route`), and `leadHint`, the person's alone. One home for
 * the names, so the writer and the schema below read the same list.
 */
export const PERSONAL_FILE_SWITCH_NAMES = [
  "jobRoute",
  "leadHint",
] as const satisfies readonly SwitchName[];

/**
 * The person's own file: the workflow fields of a project's `workflow` object, and the
 * `switches` group a project's object does not have. `jobRoute`: heavy commands go through the
 * job queue in every project that does not say otherwise in its `jobs.route` (default: off).
 * `leadHint`: the `fable-session` hook tells the person once a session when the lead is not
 * Claude Opus (default: on); a person who leads on a backend on purpose turns it off.
 */
export const personalWorkflowSchema = z.preprocess(
  readWithCurrentNames,
  workflowObjectSchema.extend({
    /**
     * The person's `plans`: the cap, and `runMode`, how queued plans run (`ask` by default: one
     * question when two or more are laid). Never `mergeFiles` or `appendOnly`, which are project
     * facts. `runMode` is the person's alone: a committed value would spend every teammate's usage.
     */
    plans: z
      .strictObject({
        maxPhases: numberField("plans.maxPhases"),
        runMode: z.enum(RUN_MODES).optional(),
      })
      .optional(),
    switches: z
      .strictObject({ jobRoute: z.boolean().optional(), leadHint: z.boolean().optional() })
      .optional(),
  }),
);

/** The person's own workflow file, read: a `Workflow` and the `switches` group. */
export type PersonalWorkflow = z.infer<typeof personalWorkflowSchema>;

/** Every value a setting falls back to when neither the project nor the person sets it. */
export const workflowDefaults = {
  allowCommit: false,
  allowPush: false,
  openPr: "off",
  allowMerge: false,
  mergeMethod: "merge",
  deleteBranch: false,
  reviewBeforePush: true,
  reviewAgents: ["cc-smart-dev-kit:senior-engineer"],
  // The limits from the measured fix rounds (R5): 10% is covered, 105% and 160% ask.
  fixesAfterReview: {
    lines: 200,
    files: 10,
    percent: 20,
  },
  clearWorktreeAfterMerge: true,
  // The switch is on by default, the owner's choice (D7 of the deploy-tasks plan); a public
  // repository stays behind its own yes, so `allowPublic` is off (D67).
  issues: {
    enabled: true,
    allowPublic: false,
    foundLabel: "kit:found",
    fixedLabel: "fixed-unreleased",
    readyLabel: "kit:ready",
  },
  alerts: {
    usagePercent: 85,
  },
  slopAudit: {
    everyPlans: 5,
  },
  plans: {
    maxPhases: 10,
    mergeFiles: [],
    appendOnly: [],
    runMode: "ask",
  },
} as const;

/**
 * The switches, and where each one really lives: read and written through the setting that
 * already exists, never stored in the workflow file.
 */
export const SWITCH_NAMES = [
  "statusLine",
  "sessionNames",
  "jobRoute",
  "updateHold",
  "leadHint",
] as const;
export type SwitchName = (typeof SWITCH_NAMES)[number];

/** One setting a person may name on the command line. */
export type WorkflowKey =
  | "allowCommit"
  | "allowPush"
  | "openPr"
  | "allowMerge"
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
  | "issues.foundLabel"
  | "issues.fixedLabel"
  | "issues.readyLabel"
  | "alerts.usagePercent"
  | "slopAudit.everyPlans"
  | "plans.maxPhases"
  | "plans.runMode"
  | "plans.mergeFiles"
  | "plans.appendOnly"
  | `switches.${SwitchName}`;

/** Every policy key, in the order `workflow show` and `--help` print them. */
export const POLICY_KEYS: readonly WorkflowKey[] = [
  "allowCommit",
  "allowPush",
  "openPr",
  "allowMerge",
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
  "issues.foundLabel",
  "issues.fixedLabel",
  "issues.readyLabel",
  "alerts.usagePercent",
  "slopAudit.everyPlans",
  "plans.maxPhases",
  "plans.runMode",
  "plans.mergeFiles",
  "plans.appendOnly",
];

/**
 * The settings merge-check judges a merge with: the **review gate**. The guard reads them
 * from the person's own file and from the project's file as committed on the pull request's
 * base, never a checkout's working copy (`resolveGate` in `resolve.ts`). `workflow set`,
 * `unset` and `propose` work on them inside Claude Code like on any setting (6.0.0): a change to
 * the project's part counts only once it is committed to the base.
 */
export const REVIEW_GATE_KEYS: readonly WorkflowKey[] = [
  "allowMerge",
  "reviewBeforePush",
  "reviewAgents",
  "fixesAfterReview.lines",
  "fixesAfterReview.files",
  "fixesAfterReview.percent",
];

/**
 * The settings that let text leave the machine for GitHub (`issues.enabled`, `issues.allowPublic`).
 * `issues.enabled` is on by default, the owner's choice; these keys are still the person's to
 * change. `workflow set` and `unset` refuse them inside Claude Code (`commands.ts`), as they do a
 * review-gate key: a session must not change its own way out. `propose` stays open: its pull
 * request is reviewed and merged by a person.
 */
export const OUTBOUND_KEYS: readonly WorkflowKey[] = ["issues.enabled", "issues.allowPublic"];

/**
 * The settings that decide what text from GitHub reaches a session (`issues.readyLabel`: which
 * issues count as chosen, D67). `workflow set` and `unset` refuse them inside Claude Code, like
 * `OUTBOUND_KEYS`: a session must never pick which issues are ready. They are read from the
 * person's file and the project's file as committed on the base, never from a working copy.
 * `propose` stays open: a person reviews its pull request.
 */
export const INBOUND_KEYS: readonly WorkflowKey[] = ["issues.readyLabel"];

/**
 * The settings that bound a session's own work (`plans.maxPhases`, `plans.runMode`,
 * `plans.mergeFiles`, `plans.appendOnly`). `workflow set` and `unset` refuse them inside Claude
 * Code, like `OUTBOUND_KEYS`, each for its own reason (`planKeyRefusal` in `commands.ts`): the
 * task store holds a session to the cap, so a session that could raise it would lift its own
 * limit; the run mode decides how many sessions spend the person's usage; and the merge files and
 * the append-only folders narrow the plans' overlap check, so a session that could widen them
 * would lift its own check. Only the person changes them. `propose` stays open for the project
 * settings: a person reviews its pull request. The cap and the run mode are read from the working
 * copy and the person's file; `plans.mergeFiles` and `plans.appendOnly` only as committed on
 * `origin/<base>` (`resolvePlanFiles`).
 */
export const PLAN_KEYS: readonly WorkflowKey[] = [
  "plans.maxPhases",
  "plans.runMode",
  "plans.mergeFiles",
  "plans.appendOnly",
];

/**
 * The settings only the person's own file holds. A project's file refuses them: `plans.runMode`
 * would spend every teammate's usage. One home for the names behind `isProjectKey`, the project
 * file's refusal (`checkPersonalOnlyFields` in `src/project/config.ts`) and `workflow set
 * --project`'s.
 */
export const PERSONAL_ONLY_KEYS: readonly WorkflowKey[] = ["plans.runMode"];

/**
 * The settings only the project's file holds. `plans.mergeFiles` and `plans.appendOnly` are
 * project facts, read as committed on `origin/<base>`: a value in the person's own file would
 * never count.
 */
export const PROJECT_ONLY_KEYS: readonly WorkflowKey[] = ["plans.mergeFiles", "plans.appendOnly"];

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
 * The switches the project's own file holds (`sessionNames`, `jobs.route`). The others — the
 * status line, the update hold, the lead hint — are the person's, per machine: `workflow set --project`
 * refuses them (`write.ts`), and so has nothing for a pull request to change. `jobRoute` is both:
 * the person's file holds its machine-wide default too (`PERSONAL_FILE_SWITCH_NAMES`).
 */
export const PROJECT_SWITCH_NAMES: readonly SwitchName[] = ["sessionNames", "jobRoute"];

/**
 * True when the project's own file can hold the key: every policy key but the person's own
 * (`PERSONAL_ONLY_KEYS`), and the project's two switches. The one answer behind
 * `workflow set --project`'s and `workflow propose`'s refusals and the portal's list of what a
 * project's card may change; `propose.test.ts` holds it equal to what the writer accepts.
 */
export function isProjectKey(key: WorkflowKey): boolean {
  if (PERSONAL_ONLY_KEYS.includes(key)) return false;
  return !isSwitchKey(key) || PROJECT_SWITCH_NAMES.includes(switchOf(key));
}

/**
 * Why each key the project's file cannot hold (`isProjectKey` false) is the person's own: one
 * entry for each, so `workflow set --project` (`write.ts`) and the project file's refusal
 * (`checkPersonalOnlyFields` in `src/project/config.ts`) say the same true thing. `workflow.test.ts`
 * holds the keys of this table equal to the keys `isProjectKey` refuses.
 */
export const PERSONAL_ONLY_REASONS: Readonly<Partial<Record<WorkflowKey, string>>> = {
  "plans.runMode": "a committed value would spend every teammate's usage",
  "switches.statusLine": "the status line is per person, per machine",
  "switches.updateHold": "the update hold is per person, per machine",
  "switches.leadHint": "the lead-model hint is per person, per machine",
};

/** True when the person's own file holds the key (a switch with a machine-wide default). */
export function isPersonalFileSwitch(key: string): key is `switches.${SwitchName}` {
  return (
    isSwitchKey(key) &&
    (PERSONAL_FILE_SWITCH_NAMES as readonly SwitchName[]).includes(switchOf(key))
  );
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

/** What a number setting takes, in words: `alerts.usagePercent is a whole number, 1-100`. */
function numberRuleText(key: NumberKey): string {
  const rule: NumberRule = NUMBER_RULES[key];
  return rule.max === undefined
    ? `${key} is a whole number, ${rule.min} or more`
    : `${key} is a whole number ${rule.min}-${rule.max}`;
}

/** A number setting as a person typed it: digits (and a decimal point where one may be). */
function parseNumber(key: NumberKey, value: string): ParsedValue {
  const rule: NumberRule = NUMBER_RULES[key];
  const shape = /^\d+$/;
  const number = Number(value);
  return shape.test(value) && numberSchema(rule).safeParse(number).success
    ? { ok: true, value: number }
    : { ok: false, why: numberRuleText(key) };
}

/**
 * A list of paths as a person typed it (`plans.mergeFiles`, `plans.appendOnly`): split at commas
 * and line breaks, each normalised by the key's own rule, named once. `rule` is the key's words.
 */
function parsePathList(
  value: string,
  rule: string,
  normalize: (raw: string) => MergeFilePath,
): ParsedValue {
  const named = value
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter((word) => word !== "");
  if (named.length === 0) return { ok: false, why: rule };
  const paths: string[] = [];
  for (const raw of named) {
    const parsed = normalize(raw);
    if (!parsed.ok) return { ok: false, why: `${rule}; ${parsed.why}` };
    if (!paths.includes(parsed.path)) paths.push(parsed.path);
  }
  return { ok: true, value: paths };
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
  if (key === "plans.runMode") {
    return (RUN_MODES as readonly string[]).includes(value)
      ? { ok: true, value }
      : { ok: false, why: `${key} is one of ${RUN_MODES.join(", ")}` };
  }
  if (key === "plans.mergeFiles") return parsePathList(value, MERGE_FILES_RULE, normalizeMergeFile);
  if (key === "plans.appendOnly")
    return parsePathList(value, APPEND_ONLY_RULE, normalizeAppendOnlyFolder);
  if (key === "reviewAgents") {
    const named = value
      .split(/[,\s]+/)
      .map((word) => word.trim())
      .filter((word) => word !== "");
    if (named.length === 0) {
      return {
        ok: false,
        why: "reviewAgents is a list of agent types, like cc-smart-dev-kit:senior-engineer",
      };
    }
    return { ok: true, value: [...new Set(named)] };
  }
  if (value === "true" || value === "false") return { ok: true, value: value === "true" };
  return { ok: false, why: `${key} is true or false` };
}

/**
 * A value as `workflow show` prints it: a list as words, a number, a boolean or a word.
 */
export function showValue(_key: WorkflowKey, value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "(nothing)" : value.join(", ");
  return String(value);
}
