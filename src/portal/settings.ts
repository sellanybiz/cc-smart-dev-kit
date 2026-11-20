/**
 * The settings the Settings page offers: each row's words (the owner's design, 2026-10-16),
 * the control it gets, the values it accepts, and where a change is written.
 *
 * One home for both sides of the page: `views.ts` draws a row from this table, and
 * `actions.ts` refuses a value outside the row's own set with the words below — a hand-made
 * POST must not write what the form itself could not send. The workflow module checks the
 * value again before it writes (`writePersonalSetting` validates the whole file), so a wrong
 * value can never reach a file even if this table is ever wrong; and a wrong key is refused
 * there too, which is why the keys here are the module's own (`WorkflowKey`).
 *
 * **Where each setting lives** (the module's own rule, `src/workflow/schema.ts`): the policy
 * is the person's, in `~/.config/cc-smart-dev-kit/workflow.json`; `switches.sessionNames` is the
 * project's `sessionNames`, so it is written into the project's committed file;
 * `switches.jobRoute` is the person's machine-wide default (the project's `jobs.route` wins
 * over it). A row whose value the project sets is never changed from this page at all: the
 * Project card on Machine is where the project's own settings are made.
 */

import {
  type ResolvedWorkflow,
  resolvedValueOf,
  type WorkflowKey,
  type WorkflowSource,
} from "./workflow-adapter";

/** One row's control. */
export type SettingKind = "boolean" | "number" | "segment";

export interface SettingChoice {
  label: string;
  value: string;
}

export interface SettingSpec {
  /** Which card the row sits in, and in what order. */
  card: "alerts" | "flow" | "switches";
  choices?: readonly SettingChoice[];
  help: string;
  /** The row's own id, from the design: `aria-labelledby` points at the label. */
  id: string;
  key: WorkflowKey;
  kind: SettingKind;
  label: string;
  /** A number row's unit, shown after its box; absent for a plain count. */
  unit?: "%";
  /** Where a change is written: the person's own defaults, or the project's committed file. */
  where: "personal" | "project";
}

/** Every row, in the design's order, with the design's words. */
export const SETTINGS: readonly SettingSpec[] = [
  {
    card: "flow",
    help: "Commit each finished, reviewed step without asking.",
    id: "set-commit",
    key: "autoCommit",
    kind: "boolean",
    label: "Auto commit",
    where: "personal",
  },
  {
    card: "flow",
    help: "Push your own branch. Never main, dev or a protected branch.",
    id: "set-push",
    key: "autoPush",
    kind: "boolean",
    label: "Auto push",
    where: "personal",
  },
  {
    card: "flow",
    choices: [
      { label: "Off", value: "off" },
      { label: "Draft", value: "draft" },
      { label: "Ready", value: "ready" },
    ],
    help: "Off: never. Draft: open it as a draft the team can look at. Ready: open it ready for review.",
    id: "set-pr",
    key: "openPr",
    kind: "segment",
    label: "Open a pull request",
    where: "personal",
  },
  {
    card: "flow",
    help: "Merge your pull request yourself once CI has passed and the review is done.",
    id: "set-merge",
    key: "autoMerge",
    kind: "boolean",
    label: "Auto merge",
    where: "personal",
  },
  {
    card: "flow",
    choices: [
      { label: "Merge", value: "merge" },
      { label: "Squash", value: "squash" },
      { label: "Rebase", value: "rebase" },
    ],
    help: "How a merged pull request lands on the branch it goes into.",
    id: "set-method",
    key: "mergeMethod",
    kind: "segment",
    label: "Merge method",
    where: "personal",
  },
  {
    card: "flow",
    help: "Remove the branch on GitHub once the pull request is merged. The worktree here stays until you clear it.",
    id: "set-del",
    key: "deleteBranch",
    kind: "boolean",
    label: "Delete the branch after merge",
    where: "personal",
  },
  {
    card: "flow",
    help: "A second read of the whole change before it leaves this computer: one premium second opinion.",
    id: "set-review",
    key: "reviewBeforePush",
    kind: "boolean",
    label: "Review before the first push",
    where: "personal",
  },
  {
    card: "flow",
    help: "Delete the worktree and its branch folder once the pull request is merged and nothing is left in it.",
    id: "set-wt",
    key: "clearWorktreeAfterMerge",
    kind: "boolean",
    label: "Clear the worktree after merge",
    where: "personal",
  },
  {
    card: "alerts",
    help: "Warn me when a usage window reaches this share of its limit.",
    id: "set-limit",
    key: "alerts.usagePercent",
    kind: "number",
    label: "Status-line usage warning at",
    unit: "%",
    where: "personal",
  },
  {
    card: "switches",
    help: "Show the slot and the model answering in Claude Code's status line.",
    id: "set-status",
    key: "switches.statusLine",
    kind: "boolean",
    label: "Status line",
    where: "personal",
  },
  {
    card: "switches",
    help: "Name each Claude session after the branch it works on, so a window is easy to find.",
    id: "set-names",
    key: "switches.sessionNames",
    kind: "boolean",
    label: "Session names",
    where: "project",
  },
  {
    card: "switches",
    help: "The type check, the build, the tests and the coverage run go through the queue: a few at a time, the rest wait for a free slot. A project can set its own.",
    id: "set-jobs",
    key: "switches.jobRoute",
    kind: "boolean",
    label: "Heavy jobs through the queue",
    where: "personal",
  },
  {
    card: "switches",
    help: "No new kit version installs until you turn this off again.",
    id: "set-upd",
    key: "switches.updateHold",
    kind: "boolean",
    label: "Hold self-updates",
    where: "personal",
  },
];

/** The card headings, in the design's words, in the design's order. */
export const SETTINGS_CARDS: readonly { card: SettingSpec["card"]; title: string }[] = [
  { card: "flow", title: "Work flow" },
  { card: "alerts", title: "Status line" },
  { card: "switches", title: "Switches" },
];

/** One row as the page draws it: the table's words, the value now, and where it came from. */
export interface SettingsRow extends SettingSpec {
  /** True: no control on this page changes it; the page shows why, and the link. */
  readOnly: boolean;
  source: WorkflowSource;
  value: unknown;
  /** Why it cannot be changed here, in words; null when it can. */
  why: null | string;
}

/**
 * Every row, with its value and whether this page may change it. A row the project sets is
 * read-only here — the project's choice wins (`resolveWorkflow`), and the Project card on
 * Machine is where it is changed. A project-owned setting with no project file yet is
 * read-only too: there is nothing to write it into.
 */
export function settingsRows(
  resolved: ResolvedWorkflow,
  options: { projectFile: boolean },
): SettingsRow[] {
  return SETTINGS.map((spec) => {
    const { source, value } = resolvedValueOf(resolved, spec.key);
    if (source === "project") {
      return { ...spec, readOnly: true, source, value, why: "this project sets it" };
    }
    if (spec.where === "project" && !options.projectFile) {
      return {
        ...spec,
        readOnly: true,
        source,
        value,
        why: "this project has no .claude/cc-smart-dev-kit.json yet",
      };
    }
    return { ...spec, readOnly: false, source, value, why: null };
  });
}

/** The row one key names, or undefined when this page shows no such row. */
export function settingSpec(key: unknown): SettingSpec | undefined {
  return typeof key === "string" ? SETTINGS.find((one) => one.key === key) : undefined;
}

/** What one POST may carry, or why it is refused — in the words the command line uses. */
export type ParsedSetting = { ok: true; value: unknown } | { ok: false; why: string };

/**
 * One value from a POST body, checked against the row it belongs to. A value outside the
 * row's own set is refused with the words the command line refuses it in
 * (`parseWorkflowValue`, `switchValue`), before anything is read or written.
 */
export function parseSettingValue(spec: SettingSpec, value: unknown): ParsedSetting {
  const key = spec.key;
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { ok: false, why: `${key} is true or false` };
    case "segment": {
      const words = (spec.choices ?? []).map((choice) => choice.value);
      return typeof value === "string" && words.includes(value)
        ? { ok: true, value }
        : { ok: false, why: `${key} is one of ${words.join(", ")}` };
    }
    case "number": {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
        return { ok: false, why: `${key} is a whole number 1-100` };
      }
      return { ok: true, value };
    }
  }
}
