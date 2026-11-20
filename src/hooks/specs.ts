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
 * | user-away | PreToolUse (AskUserQuestion, ExitPlanMode), PermissionRequest, UserPromptSubmit, Stop | machine-wide, and `ownHooks` cannot switch it off: while the person cannot answer, a question and Claude Code's own permission prompt are denied and parked, and a note is said once per change — at the prompt, or by one block at the stop of a session that has not heard it (`user-away.ts`) |
 *
 * Two more bundles are in `hooks.json` without a spec here (`USER_HOOKS`): they need no
 * project file — `update-check` (the background self-update and instructions copy) and
 * `playwright-output` (screenshots saved in the browser output folder).
 *
 * Every hook here is wired by the plugin, in `plugin/hooks/hooks.json`. The worktree engine
 * a project used to wire itself is retired (1.0.0): its three hook names only print the fix
 * (`src/hooks/settings-hooks.ts`).
 */

import { recordsReview } from "../workflow/reviews";
import { workflowDefaults } from "../workflow/schema";
import { afterMerge, mergesPullRequest } from "./after-merge";
import { recordAgentUsage } from "./agent-usage";
import { builderFinish, builderFinishAnswer } from "./builder-finish";
import { fableSession } from "./fable-session";
import {
  addContext,
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import { jobRoute, routeFacts } from "./job-route";
import { KEEP_GOING, keepGoing, keepGoingAnswer } from "./keep-going";
import { agentTypeOf, reviewRecord } from "./review-record";
import type { HookSpec } from "./run";
import { sessionName } from "./session-name";
import { subagentBackground } from "./subagent-background";
import { taskStart } from "./task-start";
import { tierView } from "./tier-view";
import { inAwayDomain, userAwayAnswer } from "./user-away";
import { verifyGate } from "./verify-gate";
import { worktreeLeftovers } from "./worktree-leftovers";

/** Said to the person when a guard cannot read the project's cc-smart-dev-kit.json. */
function cannotCheck(what: string, message: string): string {
  return `cc-smart-dev-kit cannot check ${what}: ${message}`;
}

/**
 * A guard's answer when its own code throws: **ask the person about the call in the
 * guard's own domain**. A crash must never let a call through — that is the whole point of
 * the answer — and a guard that cannot judge a call asks.
 *
 * `inDomain` says whether the call is one the guard judges: a call outside its domain is
 * none of its business, and the guard stays silent. With an input the frame could not read
 * (the hook input was not JSON) the guard asks in general: it cannot tell what the call is.
 * A domain check that throws itself is no reason to let the call through: the guard asks.
 *
 * The event: a guard's bundle runs on PreToolUse, where it answers; the agent guard also
 * runs on PostToolUse, to record a launch that ran. A crash there has nothing to ask about —
 * the call already ran — so it says nothing, and the frame's one line on stderr is all. An
 * event the frame could not read counts as the guard's own, PreToolUse.
 */
export function guardCrash(
  what: string,
  inDomain: (input: HookInput) => boolean,
): NonNullable<HookSpec["onCrash"]> {
  return (why: string, input: HookInput | null, event: string): HookResult => {
    if (event !== "" && event !== "PreToolUse") return SILENT;
    if (input !== null && !judgesCall(inDomain, input)) return SILENT;
    return toolDecision("ask", cannotCheck(what, why));
  };
}

/** True when the guard judges this call; true too when the check itself throws. */
function judgesCall(inDomain: (input: HookInput) => boolean, input: HookInput): boolean {
  try {
    return inDomain(input);
  } catch {
    return true;
  }
}

export const afterMergeHook: HookSpec = {
  name: "after-merge",
  events: ["PostToolUse", "PostToolUseFailure"],
  onConfigProblem: (message, input, event) => {
    const command = stringField(toolInput(input).command);
    return command !== null && mergesPullRequest(command)
      ? addContext(event, `cc-smart-dev-kit: ${message}`)
      : SILENT;
  },
  run: afterMerge,
};

/**
 * The review record: SubagentStart notes the commit a review agent (`workflow.reviewAgents`,
 * default: the plugin's own reviewer) starts on, and SubagentStop records it when the agent
 * stops on that same commit — what the merge guard reads before a merge it would make with
 * no person watching (`src/hooks/review-record.ts`, the whole story).
 *
 * A plugin-wired SubagentStop is safe for THIS hook because it never touches a worktree
 * (`.claude/rules/hooks.md`). SubagentStart cannot block a launch, and this hook adds no
 * context to either event, so its answers are silence and stderr only.
 */
export const reviewRecordHook: HookSpec = {
  name: "review-record",
  events: ["SubagentStart", "SubagentStop"],
  onConfigProblem: (message, input, event) => {
    // Which agents record is in the project's file, so with no usable file the built-in list
    // decides whether this is even about a review: one stderr line when it is, silence when
    // it is not, like `after-merge` only speaks after a merge. Said once, at the stop, where
    // the review would have been recorded.
    const agent = agentTypeOf(input);
    return event === "SubagentStop" &&
      agent !== null &&
      recordsReview(agent, workflowDefaults.reviewAgents)
      ? { stderr: `cc-smart-dev-kit review-record: ${message}` }
      : SILENT;
  },
  run: reviewRecord,
};

/**
 * The subagent's hand-back (`subagent-background.ts`): a subagent never ends its turn while
 * background work it started still runs — it waits for the work or stops it, then reports.
 * SubagentStop only, and like `review-record` it **touches no worktree**, the one kind of
 * plugin SubagentStop entry `hooks.md` allows. It reads no setting, but it is still
 * project-scoped: with no cc-smart-dev-kit.json it stays silent. A broken or too new file is
 * one stderr line, exit 0 (an informational hook never stops a subagent), and a transcript it
 * cannot read is no block at all: the hook cannot tell whose background work is running.
 */
export const subagentBackgroundHook: HookSpec = {
  name: "subagent-background",
  events: ["SubagentStop"],
  onConfigProblem: (message) => ({
    stderr: `cc-smart-dev-kit subagent-background: ${message}`,
  }),
  run: subagentBackground,
};

/**
 * The builder's hand-back (`builder-finish.ts`): a builder subagent never hands back while the
 * task its brief names (`Your task: #<n>`) still has open blocking steps — it closes or drops
 * each, then reports. SubagentStop only, and like `subagent-background` it **touches no
 * worktree**, the one kind of plugin SubagentStop entry `hooks.md` allows; the two never
 * answer the same thing (that one blocks for running background work, this one for open
 * steps). **Machine-wide**, like `keep-going`: it reads only the person's own task list, so it
 * judges the same with no cc-smart-dev-kit.json and with a broken or too new one, and honors
 * `ownHooks` where a file lists it. Anything it cannot read lets the builder finish.
 */
export const builderFinishHook: HookSpec = {
  name: "builder-finish",
  events: ["SubagentStop"],
  onConfigProblem: (_message, input, event, checkout, context) =>
    builderFinishAnswer(input, event, checkout, context.paths),
  run: builderFinish,
};

/**
 * The verification gate (`verify-gate.ts`): Stop, one **block** when this session changed
 * files and no Bash call ran the project's fast check (`checks.fast`) after the last change.
 * It names the command, and it is silent on the stop its own block caused
 * (`stop_hook_active`), on a turn that
 * still waits on background work, with no `checks.fast`, and when it cannot read the
 * transcript. Project-scoped: with no cc-smart-dev-kit.json it stays silent. A broken or too
 * new file is one stderr line — an informational hook never stops a person's work.
 */
export const verifyGateHook: HookSpec = {
  name: "verify-gate",
  events: ["Stop"],
  onConfigProblem: (message) => ({ stderr: `cc-smart-dev-kit verify-gate: ${message}` }),
  run: verifyGate,
};

/**
 * The keep-going guard (`keep-going.ts`): Stop, one **block per stalled state** when a phase of
 * a plan this Claude process works on is `in_progress`, no background work runs
 * (`background_tasks`), and the turn's last answer has no `Waiting for:` line. The same reason
 * already given, with no subagent started or resumed since, keeps it silent
 * (`stopFeedbackGiven`). It names the builder to resume with `SendMessage` (or a phase needing a
 * fresh builder), the next ready phase, and how to close or record a blocker, and warns against
 * moving a phase back to pending to end the turn. When the own plan gives no reason, it also
 * names what a lead's plans wait on (`leadPlansReason`), from the store's classifier alone:
 * `herdr wait` for plans with a running child, `herdr plans --wait` for closed plans whose pull
 * request is not merged yet, `herdr start --plan <slug>` for a child that is gone. It runs no
 * git, gh or hc. It reads no setting
 * and needs no cc-smart-dev-kit.json: the task store is the person's own, so it runs in a project
 * with no file and honors `ownHooks` where there is one. Silent outside git (the frame's
 * default), on the stop its own block caused (`stop_hook_active`), or with no readable task
 * store or caller. An unreadable transcript keeps the decision. A broken or too new file changes
 * nothing: the hook reads no setting of it, so it judges the same way
 * (`.claude/rules/hooks-guards.md` § Fail closed).
 */
export const keepGoingHook: HookSpec = {
  name: KEEP_GOING,
  events: ["Stop"],
  onConfigProblem: (_message, input, event, checkout, context) =>
    event === "Stop" ? keepGoingAnswer(input, checkout, context.paths, context.env) : SILENT,
  run: keepGoing,
};

/**
 * Each subagent's usage (`agent-usage.ts`): on its stop, one line in `agent-usage.jsonl` — the
 * time, the session, the agent and its type, and per model the replies, the four token counts
 * and the estimated USD — what `usage` shows and a portal can read. **Machine-wide**: the
 * person's spend is the machine's, not a project's, so it records with no
 * `cc-smart-dev-kit.json` and outside git, like the launch record `usage` reads. A project
 * that runs its own copy lists the name in `ownHooks`. It touches no worktree, the one kind of
 * plugin SubagentStop entry `hooks.md` allows, and it answers nothing on stdout: one stderr
 * line when its record cannot be made, exit 0.
 */
export const agentUsageHook: HookSpec = {
  name: "agent-usage",
  events: ["SubagentStop"],
  onConfigProblem: (_message, input, event, _checkout, context) =>
    recordAgentUsage(input, event, context.paths, context.nowMs),
  outsideGit: (input, event, _why, context) =>
    recordAgentUsage(input, event, context.paths, context.nowMs),
  run: ({ input, event, paths, nowMs }) => recordAgentUsage(input, event, paths, nowMs),
};

export const worktreeLeftoversHook: HookSpec = {
  name: "worktree-leftovers",
  events: ["SessionStart"],
  onConfigProblem: (message, _input, event) => addContext(event, `cc-smart-dev-kit: ${message}`),
  run: worktreeLeftovers,
};

export const sessionNameHook: HookSpec = {
  name: "session-name",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (message) => ({ stderr: `cc-smart-dev-kit session-name: ${message}` }),
  run: sessionName,
};

/**
 * While the person cannot answer (`cc-smart-dev-kit user unavailable`): the two tools that ask
 * them are denied with the step that parks the question, Claude Code's own permission prompt is
 * denied and the call parked, and one note per change is said at the prompt — or, for a session
 * the person never prompts, by one block at its stop (`user-away.ts`). A guard's own ask is
 * turned into a deny by the frame itself (`askedWhileAway`, `run.ts`), for every hook.
 *
 * **Machine-wide**, like `job-route`: the person is one for the whole machine, so the answer
 * reads the state file and never the project's, and a broken or too new project file, and a
 * folder outside git, are judged the same way. **`alwaysOn`**: `ownHooks` cannot switch it off —
 * the switch is the person's, and a project must not be able to turn it off for a session. A
 * crash asks about the calls in its domain (the two question tools), like any guard; on the other
 * three events it says one line on stderr and the session goes on.
 */
export const userAwayHook: HookSpec = {
  name: "user-away",
  events: ["PreToolUse", "PermissionRequest", "UserPromptSubmit", "Stop"],
  alwaysOn: true,
  onConfigProblem: (_message, input, event, _checkout, context) =>
    userAwayAnswer(input, event, context.env, context.paths, context.nowMs),
  outsideGit: (input, event, _why, context) =>
    userAwayAnswer(input, event, context.env, context.paths, context.nowMs),
  // The two tools that ask the person are a guard's domain: a crash asks about them, as any guard
  // does. On the other three events there is no call to ask about; the crash is one line on
  // stderr, and Claude Code's own prompt, the prompt's text, or the stop goes on as it would
  // without this hook.
  onCrash: (why, input, event, context) =>
    event === "PermissionRequest" || event === "UserPromptSubmit" || event === "Stop"
      ? { stderr: `cc-smart-dev-kit user-away: ${why}` }
      : guardCrash("whether the person is available", inAwayDomain)(why, input, event, context),
  run: ({ input, event, env, paths, nowMs }) => userAwayAnswer(input, event, env, paths, nowMs),
};

/**
 * The Fable-session note: SessionStart, PostModelSwitch and Stop. **Machine-wide** like
 * `agent-guard`: it runs with or without cc-smart-dev-kit.json, and its answer never depends on
 * the project's file — it is about the model this session runs on (§ `fable-session.ts`). Its
 * SessionStart entry carries **no matcher**, so every source is judged, a `fork` included, as
 * `update-check`'s does. It says one line to the person, once in a session, and nothing to
 * Claude: never an error and never a block, so a project that runs its own copy silences it
 * through `ownHooks` like any other plugin hook.
 *
 * **Not UserPromptSubmit** (a live bug, 2026-10-17): the model read there is the transcript's
 * last answer — the PREVIOUS turn's model — so it missed the switch to Fable and then warned
 * while the person was back on Opus. PostModelSwitch names the model the session moved TO
 * (`to_model`), and Stop judges the answer that just finished. See `fable-session.ts`.
 */
export const fableSessionHook: HookSpec = {
  name: "fable-session",
  events: ["SessionStart", "PostModelSwitch", "Stop"],
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    fableSession(input, context.env, context.paths),
  outsideGit: (input, _event, _why, context) => fableSession(input, context.env, context.paths),
  run: ({ input, env, paths }) => fableSession(input, env, paths),
};

/**
 * The tier note (`tier-view.ts`): at every SessionStart, and at a UserPromptSubmit when it
 * changed, one note to Claude of what each subagent tier (`haiku`, `sonnet`, `opus`, `fable`)
 * runs now and the effort rule that follows, read the launch judge's way. **Machine-wide**, like
 * `agent-guard`: it runs with or without cc-smart-dev-kit.json and in a folder outside git, and
 * never a question or a block. Its SessionStart entry carries **no
 * matcher**, so a start, a resume, a clear and a compaction each say it. A project that runs its
 * own copy silences it through `ownHooks`.
 */
export const tierViewHook: HookSpec = {
  name: "tier-view",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    tierView(input, context.env, context.paths),
  outsideGit: (input, _event, _why, context) => tierView(input, context.env, context.paths),
  run: ({ input, env, paths }) => tierView(input, env, paths),
};

/**
 * The job queue's door, the kit's one guard: PreToolUse on Bash and PowerShell, **machine-wide**,
 * and `alwaysOn` (`ownHooks` cannot switch it off). The route is the `switches.jobRoute` switch
 * (the project's `"jobs": { "route": true }` over the person's machine-wide default, one
 * resolver, off until one says on): a heavy command is rewritten to run through
 * `cc-smart-dev-kit job run` (or refused with that command line), a heavy run mixed with other
 * commands is refused, and a heavy PowerShell line is refused, naming the Bash tool, where Git
 * Bash lets that tool run. Off, a heavy command runs raw.
 *
 * It never asks the person. With a broken or too new `cc-smart-dev-kit.json`, outside git, or
 * after a crash, there is nothing to route: the line runs as written, and a crash is one line on
 * stderr.
 */
export const jobRouteHook: HookSpec = {
  name: "job-route",
  events: ["PreToolUse"],
  alwaysOn: true,
  onConfigProblem: () => SILENT,
  logFacts: routeFacts,
  run: jobRoute,
};

/** The hooks the plugin wires in `plugin/hooks/hooks.json`, by their bundle name. */
export const taskStartHook: HookSpec = {
  name: "task-start",
  events: ["SessionStart"],
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    taskStart(input, context.paths, context.env),
  outsideGit: (input, _event, _why, context) => taskStart(input, context.paths, context.env),
  run: ({ input, paths, env }) => taskStart(input, paths, env),
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
