/**
 * Every hook: what it runs, what silences it (the defer check), and how it fails closed when
 * the project's cc-smart-dev-kit.json is broken or needs a newer plugin.
 *
 * The plugin wires these in `plugin/hooks/hooks.json` (`HOOKS`):
 *
 * | Hook | Event (matcher) | Fails closed by |
 * |---|---|---|
 * | fable-session | SessionStart, PostModelSwitch, Stop | machine-wide: it says the same line without cc-smart-dev-kit.json (`fable-session.ts`) |
 * | tier-view | SessionStart, UserPromptSubmit | machine-wide: the note of what each subagent tier runs now says the same without cc-smart-dev-kit.json (`tier-view.ts`) |
 * | job-route | PreToolUse (Bash, PowerShell) | silent: with a broken or too new file, outside git or after a crash the line runs as written; routing a heavy command reads `jobs.route` and is Bash-only (`job-route.ts`) |
 * | after-merge | PostToolUse, PostToolUseFailure (Bash, PowerShell) | one line after a merge |
 * | review-record | SubagentStart, SubagentStop | one line when the review could not be recorded |
 * | subagent-background | SubagentStop | one block when a subagent ends with its own background work running |
 * | builder-finish | SubagentStop | machine-wide: it reads no project setting, so a broken file judges the same; one block when a builder hands back while its brief's task (`Your task: #<n>`) has open blocking steps (`builder-finish.ts`) |
 * | verify-gate | Stop | one block when the session changed files and the project's fast check did not run after the last change |
 * | keep-going | Stop | machine-wide: it reads no project setting, so a broken file judges the same; one block per stalled state when a phase of this session's plan is in progress, nothing runs and no `Waiting for:` line says the wait; names the builder to resume (`keep-going.ts`) |
 * | agent-usage | SubagentStop | machine-wide: each subagent's cost on record (`agent-usage.ts`) |
 * | worktree-leftovers | SessionStart (startup, resume) | one line |
 * | session-name | SessionStart, UserPromptSubmit | nothing but a line on stderr |
 * | user-away | PreToolUse (AskUserQuestion, ExitPlanMode), UserPromptSubmit, Stop | machine-wide, and `ownHooks` cannot switch it off: while the person cannot answer, a question is refused with the step to take the recommended option and record a decision, nothing is parked, and a note is said once per change — at the prompt, or by one block at the stop of a session that has not heard it (`user-away.ts`) |
 *
 * Two more bundles are in `hooks.json` without a spec here (`USER_HOOKS`): they need no
 * project file — `update-check` (the background self-update and instructions copy) and
 * `playwright-output` (screenshots saved in the browser output folder).
 *
 * Every hook here is wired by the plugin, in `plugin/hooks/hooks.json`. The worktree engine
 * a project used to wire itself is retired (1.0.0): its three hook names only print the fix
 * (`src/hooks/settings-hooks.ts`).
 */

import type { HookSpec } from "./run";
import { afterMergeHook } from "./specs/after-merge";
import { agentUsageHook } from "./specs/agent-usage";
import { builderFinishHook } from "./specs/builder-finish";
import { fableSessionHook } from "./specs/fable-session";
import { jobRouteHook } from "./specs/job-route";
import { keepGoingHook } from "./specs/keep-going";
import { reviewRecordHook } from "./specs/review-record";
import { sessionNameHook } from "./specs/session-name";
import { subagentBackgroundHook } from "./specs/subagent-background";
import { taskStartHook } from "./specs/task-start";
import { tierViewHook } from "./specs/tier-view";
import { userAwayHook } from "./specs/user-away";
import { verifyGateHook } from "./specs/verify-gate";
import { worktreeLeftoversHook } from "./specs/worktree-leftovers";

// Each spec lives in `src/hooks/specs/<name>.ts`, so a bundle can import its own spec and
// nothing else; this file is for the lists and for the code and tests that want them all.
// An entry in `src/entries/` never imports this file: that would load every hook into it.
export { guardCrash } from "./guard-crash";
export {
  afterMergeHook,
  agentUsageHook,
  builderFinishHook,
  fableSessionHook,
  jobRouteHook,
  keepGoingHook,
  reviewRecordHook,
  sessionNameHook,
  subagentBackgroundHook,
  taskStartHook,
  tierViewHook,
  userAwayHook,
  verifyGateHook,
  worktreeLeftoversHook,
};

export const HOOKS: readonly HookSpec[] = [
  taskStartHook,
  fableSessionHook,
  tierViewHook,
  jobRouteHook,
  afterMergeHook,
  reviewRecordHook,
  subagentBackgroundHook,
  builderFinishHook,
  verifyGateHook,
  keepGoingHook,
  agentUsageHook,
  worktreeLeftoversHook,
  sessionNameHook,
  userAwayHook,
];

/**
 * The PreToolUse hooks that are **not** guards: `playwright-output` only rewrites the name of
 * a file the browser saves, and `job-route` only queues or refuses a heavy command, so a machine
 * with no bun gets no rewrite, never a question.
 */
export const NON_GUARD_PRE_TOOL_USE: ReadonlySet<string> = new Set([
  "playwright-output",
  "job-route",
]);

/**
 * The bundles whose `hooks.json` entry runs the shim with `--missing=ask`: the guards, which
 * fail closed when no bun is found. Every other hook is quiet (`--missing=quiet`), one line
 * on stderr — the notifier runs on PreToolUse too, and is not a guard.
 */
export const GUARD_BUNDLES: ReadonlySet<string> = new Set(
  HOOKS.filter(
    (spec) => spec.events.includes("PreToolUse") && !NON_GUARD_PRE_TOOL_USE.has(spec.name),
  ).map((spec) => spec.name),
);

/**
 * The plugin's other bundles in `plugin/hooks/hooks.json`, by name: hooks about the person,
 * not a project, so no `HookSpec` here — they never enter the frame (`run.ts`) and read no
 * `cc-smart-dev-kit.json` (`ownHooks` lists only `HOOKS`). Each has its own entry and its own logic:
 * `update-check` (the background self-update) and `playwright-output` (screenshots).
 */
export const USER_HOOKS: readonly string[] = ["update-check", "playwright-output"];

/**
 * Every hook that answers about the **machine**, not a project: the `USER_HOOKS` bundles
 * (no project file is needed for them to act) and the plugin hooks whose answer does not
 * depend on the project's file either — `fable-session` (the model this session runs on),
 * `task-start` (the session's own task list),
 * `keep-going` (whether the session's own plan has a phase in progress), `builder-finish`
 * (whether a builder's task still has open steps), `tier-view` (what each
 * subagent tier runs), `user-away` (whether the person can answer) and
 * `agent-usage` (each subagent's cost on record: the person's spend, not a project's policy). `doctor`'s project checks never warn
 * about a project hook that runs beside one of these: it is the person's own business, not a
 * second copy of a project piece, and `USER_HOOKS` cannot be listed in `ownHooks` in any case.
 */
export const MACHINE_WIDE_HOOKS: readonly string[] = [
  ...USER_HOOKS,
  "task-start",
  "keep-going",
  "builder-finish",
  "fable-session",
  "tier-view",
  "agent-usage",
  "user-away",
];
