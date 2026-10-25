/**
 * Every hook: what it runs, what silences it (the defer check), and how it fails closed when
 * the project's cc-smart-dev-kit.json is broken or needs a newer plugin.
 *
 * The plugin wires these in `plugin/hooks/hooks.json` (`HOOKS`):
 *
 * | Hook | Event (matcher) | Fails closed by |
 * |---|---|---|
 * | git-guard | PreToolUse (Bash, PowerShell) | asking before every command that runs git |
 * | main-folder-guard | PreToolUse (Edit, Write, NotebookEdit) | asking before every edit in the repo |
 * | message-guard | PreToolUse (SendMessage) | asking before every message |
 * | agent-guard | PreToolUse (Agent, Task, Workflow) | machine-wide: it judges the same way without cc-smart-dev-kit.json (`agent-guard.ts`) |
 * | fable-session | SessionStart, PostModelSwitch, Stop | machine-wide: it says the same line without cc-smart-dev-kit.json (`fable-session.ts`) |
 * | merge-guard | PreToolUse (Bash, PowerShell) | asking before every command that merges a pull request (`merge-guard.ts`) |
 * | session-escape-guard | PreToolUse (Bash, PowerShell, Edit, Write, NotebookEdit) | machine-wide, and `ownHooks` cannot switch it off: it judges the same without cc-smart-dev-kit.json (`session-escape-guard.ts`) |
 * | job-route | PreToolUse (Bash, PowerShell) | machine-wide, and `ownHooks` cannot switch it off: a launch, a crew start and a poll are judged the same without cc-smart-dev-kit.json; routing a heavy command reads `jobs.route` and is Bash-only (`bash-judge.ts`, `job-route.ts`) |
 * | after-merge | PostToolUse, PostToolUseFailure (Bash, PowerShell) | one line after a merge |
 * | review-record | SubagentStart, SubagentStop | one line when the review could not be recorded |
 * | subagent-background | SubagentStop | one block when a subagent ends with its own background work running |
 * | verify-gate | Stop | one block when the session changed files and the project's fast check did not run after the last change |
 * | agent-usage | SubagentStop | machine-wide: each subagent's cost on record (`agent-usage.ts`) |
 * | worktree-leftovers | SessionStart (startup, resume) | one line |
 * | session-name | SessionStart, UserPromptSubmit | nothing but a line on stderr |
 * | crew-role | SessionStart (startup, resume, compact), UserPromptSubmit, PreToolUse (AskUserQuestion, ExitPlanMode; Edit, Write, NotebookEdit), Stop, StopFailure | machine-wide: the card and the folder check at a start, the person's own prompt recorded and answered, the ask refused, the first edit held until the task list exists, the report block, the pause at a limit (`crew-role.ts`) |
 * | lead-notes | SessionStart, UserPromptSubmit | machine-wide: the lead's missed crew news, once, its task-list reminder at each prompt, and the crew rule at a session start (`lead-notes.ts`) |
 *
 * Three more bundles are in `hooks.json` without a spec here (`USER_HOOKS`): they are about
 * the person, not a project, so they never enter the frame and need no `cc-smart-dev-kit.json`
 * to act (the notifier and the limit alert read a project's `workflow.alerts` settings when
 * one has them: `src/workflow/alerts.ts`) —
 * `stop-failure` (the usage-limit alert), `update-check` (the background self-update and the
 * instructions copy), `notify` (the alerts: desktop, SSH terminal, Warp; `notify.ts`) and
 * `playwright-output` (a caller-named screenshot goes into the browser's output folder,
 * `playwright-output.ts`).
 *
 * Every hook here is wired by the plugin, in `plugin/hooks/hooks.json`. The worktree engine
 * a project used to wire itself is retired (1.0.0): its three hook names only print the fix
 * (`src/hooks/settings-hooks.ts`).
 *
 * Four guards — `git-guard`, `merge-guard`, `agent-guard` and `message-guard` — also carry a
 * **crew part** (`HookSpec.crewLimits`): a crew session never pushes, never runs a git command
 * that would throw work away without reading the step that replaces it, opens no pull request
 * and merges none, is never asked about a launch (each question is a denial naming the step
 * that reaches its lead), and its peer messages carry the `crew tell` tag (D24, D36, D47). The
 * frame runs that part **before `ownHooks` and before the project's file is read**, so a
 * project with no `cc-smart-dev-kit.json`, and one whose `ownHooks` lists its own copy of the
 * guard, cannot lose it. Each part is the guard's own detector (`crewGitAnswer`,
 * `crewPullRequestAnswer`, `crewAgentAnswer`, `crewMessageAnswer`), never a copy.
 */

import { crewIdOf } from "../crew/session";
import { programsOf } from "../shell/command";
import { recordsReview } from "../workflow/reviews";
import { workflowDefaults } from "../workflow/schema";
import { afterMerge, mergesPullRequest, requestsPullRequestChange } from "./after-merge";
import {
  AGENT_TOOLS,
  agentGuard,
  crewAgentAnswer,
  guardFacts,
  WORKFLOW_TOOLS,
} from "./agent-guard";
import { recordAgentUsage } from "./agent-usage";
import { CREW_ASK_TOOLS, CREW_EDIT_TOOLS, crewRoleAnswer } from "./crew-role";
import { fableSession } from "./fable-session";
import { isInside } from "./git";
import {
  crewGitAnswer,
  DEFAULT_PROTECTED_BRANCHES,
  guardVerdict,
  pushRulesFor,
  runsGit,
} from "./git-guard";
import {
  addContext,
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import {
  jobRoute,
  jobRouteConfigAnswer,
  jobRouteDomain,
  jobRouteOutsideGit,
  routeFacts,
} from "./job-route";
import { leadNotesAnswer } from "./lead-notes";
import { editedFile, mainFolderGuard } from "./main-folder-guard";
import { crewPullRequestAnswer, mergeGuard } from "./merge-guard";
import { crewMessageAnswer, messageGuard } from "./message-guard";
import { autoPushQuestion } from "./push-policy";
import { agentTypeOf, reviewRecord } from "./review-record";
import type { HookSpec } from "./run";
import { inEscapeDomain, sessionEscapeGuard } from "./session-escape-guard";
import { sessionName } from "./session-name";
import { subagentBackground } from "./subagent-background";
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

/** The tool the call is for, or "" when the input names none. */
function toolOf(input: HookInput | null): string {
  return input === null ? "" : (stringField(input.tool_name) ?? "");
}

/** The command of the call, or "" when the input names none. */
function commandOf(input: HookInput | null): string {
  return input === null ? "" : (stringField(toolInput(input).command) ?? "");
}

export const gitGuardHook: HookSpec = {
  name: "git-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input, _event, _checkout, context) => {
    // A crew session is never asked: nobody is at the machine, and its answer does not depend
    // on the project's file — with the crew rule on, no project value is read. The crew part
    // has already denied what the file could never allow, and everything else goes through,
    // so a broken file cannot stall the session at its checkpoint commit.
    if (crewIdOf(context.env) !== null) return SILENT;
    const command = stringField(toolInput(input).command);
    return command !== null && runsGit(command)
      ? toolDecision("ask", cannotCheck("this git command", message))
      : SILENT;
  },
  // A crash must not let a git command through: the guard asks about the command it was
  // asked to judge.
  onCrash: guardCrash("this git command", (input) => {
    const command = commandOf(input);
    return command !== "" && runsGit(command);
  }),
  // For the hook log: the programs of the command line, read the way the guard reads it, so
  // `doctor --live` can prove the guard parsed the call (not only that the hook ran).
  logFacts: (input) => {
    const command = stringField(toolInput(input).command);
    return command === null ? {} : { programs: programsOf(command) };
  },
  // A crew session's push is denied, and so is every work-destroying ask, with the step that
  // replaces it — whatever the project's file says, and with no file (`crewGitAnswer`: the
  // same detector as `run`, with only the crew rule on).
  crewLimits: (input, _checkout, { env }) =>
    crewGitAnswer(input, env, stringField(input.cwd) ?? ""),
  run: (context): HookResult => {
    const { project, input, cwd, env } = context;
    const config = project.config;
    if (config === null) return SILENT;
    const command = stringField(toolInput(input).command);
    if (command === null) return SILENT;
    const verdict = guardVerdict(command, cwd, {
      protectedBranches: config.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
      pushRules: pushRulesFor(env, () => autoPushQuestion(context)),
      sharedStash: config.worktrees !== undefined,
      env,
    });
    // A crew session's push, and every command that would destroy work, is denied (D24);
    // everything else is a question.
    if (verdict.refuse.length > 0) return toolDecision("deny", verdict.refuse.join("\n"));
    return verdict.ask.length === 0 ? SILENT : toolDecision("ask", verdict.ask.join("\n"));
  },
};

/**
 * The merge guard: PreToolUse on Bash and PowerShell, before a command that merges, opens or readies a pull
 * request. It lets the merge through without a question only when the project's `autoMerge`
 * allows it, the required checks are green, and the head commit's review is recorded;
 * everything else is a question for the person (§ `merge-guard.ts`, `src/workflow/`).
 */
export const mergeGuardHook: HookSpec = {
  name: "merge-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input, _event, _checkout, context) => {
    // A crew session is never asked (D36). Its crew part has already refused every merge and
    // opening it can read; a line left over may run (a `--disable-auto`, which merges
    // nothing), and no merge this guard would stop can be silent there. So a broken or too
    // new file gives a crew session silence, never a question nobody answers.
    if (crewIdOf(context.env) !== null) return SILENT;
    const command = stringField(toolInput(input).command);
    return command !== null && requestsPullRequestChange(command)
      ? toolDecision("ask", cannotCheck("whether this merge may happen by itself", message))
      : SILENT;
  },
  // For the hook log: the programs of the command line, read the way the guard reads it, so
  // `doctor --live` can prove the guard parsed the call.
  logFacts: (input) => {
    const command = stringField(toolInput(input).command);
    return command === null ? {} : { programs: programsOf(command) };
  },
  // A crash must not let a merge through: the guard asks about the command it was asked to
  // judge.
  onCrash: guardCrash("whether this merge may happen by itself", (input) => {
    const command = commandOf(input);
    return command !== "" && requestsPullRequestChange(command);
  }),
  // A crew session opens no pull request and merges none, whatever the project's file says, and
  // with no file (`crewPullRequestAnswer`: the same reader as `run`, aliases included).
  crewLimits: (input, _checkout, { env }) =>
    crewPullRequestAnswer(input, env, stringField(input.cwd) ?? ""),
  run: mergeGuard,
};

export const mainFolderGuardHook: HookSpec = {
  name: "main-folder-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input, _event, checkout) => {
    const file = typeof input.cwd === "string" ? editedFile(input, input.cwd) : null;
    const repo = checkout.mainCheckout ?? checkout.root;
    return file !== null && isInside(file, repo)
      ? toolDecision("ask", cannotCheck("whether this edit belongs in a worktree", message))
      : SILENT;
  },
  // A crash must not let an edit through: the guard asks about the edit it was asked to
  // judge.
  onCrash: guardCrash("whether this edit belongs in a worktree", (input) =>
    ["Edit", "Write", "NotebookEdit"].includes(toolOf(input)),
  ),
  run: mainFolderGuard,
};

export const messageGuardHook: HookSpec = {
  name: "message-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message) =>
    toolDecision("ask", cannotCheck("whether this message may go to that session", message)),
  // A crash must not let a message through: the guard asks about the message it was asked
  // to judge.
  onCrash: guardCrash(
    "whether this message may go to that session",
    (input) => toolOf(input) === "SendMessage",
  ),
  // The D47 crew rule, whatever the project's file says, and with no file: a peer message
  // carries the `crew tell` tag, and a message to its own lead goes through `crew report`.
  crewLimits: (input, checkout, { env, paths }) =>
    crewMessageAnswer(input, env, checkout.mainCheckout ?? checkout.root, paths.stateDir),
  run: messageGuard,
};

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
 * The verification gate (`verify-gate.ts`): Stop, one **block** when this session changed
 * files and no Bash call ran the project's fast check (`checks.fast`) after the last change.
 * It names the command, and it is silent on the stop its own block caused
 * (`stop_hook_active`), in a crew session (its report gate is `crew-role`), on a turn that
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
 * Each subagent's usage (`agent-usage.ts`): on its stop, one line in `agent-usage.jsonl` — the
 * time, the session, the agent and its type, and per model the replies, the four token counts
 * and the estimated USD — what `usage` shows and a portal can read. **Machine-wide**: the
 * person's spend is the machine's, not a project's, so it records with no
 * `cc-smart-dev-kit.json` and outside git, like the Agent guard's launch record. A project
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
 * The crew session's own hook (`crew-role.ts`): the role card at a start, a resume or a compaction,
 * with the session's own `cwd` checked against its worktree — a `starting` record becomes `working`
 * inside it, and an open one is `failed` with the reason outside it (H101; `updateCrewIfState`
 * reads the state again under the store's lock);
 * `AskUserQuestion` and `ExitPlanMode` denied with the report step (D36); an edit denied with the
 * task-list step until the session's list has one (D23, its own cache in
 * `src/crew/tasks.ts`); the person's own prompt
 * recorded as one `person` event with one line of context (D55); the last line recorded at
 * a stop, and one block when the turn ended on a step with no report; the crew session marked
 * `paused` when a model limit ended its turn (D42). **Machine-wide**: it is silent
 * unless `CC_SMART_DEV_KIT_CREW` names a crew session, and its answer never depends on the project's
 * file — the two PreToolUse answers read no project file, and the edit gate the store only for
 * its own cache, so a broken or too new file, and a folder outside git, are judged the same way. It is in `PLUGIN_HOOK_NAMES`, so a project that runs its own
 * copy silences it through `ownHooks`. A crash asks about the calls in its domain (the two tools
 * that ask the person, and the three edits that wait for the task list),
 * and is silent outside a crew session: a plain session must never be asked because of this hook.
 * A StopFailure pauses the record and answers nothing: Claude Code ignores that hook's output, so
 * the pause is fail-open like the Stop block.
 */
export const crewRoleHook: HookSpec = {
  name: "crew-role",
  events: ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop", "StopFailure"],
  onConfigProblem: (_message, input, event, checkout, context) =>
    crewRoleAnswer(
      input,
      event,
      context.env,
      context.paths,
      checkout.mainCheckout ?? checkout.root,
    ),
  outsideGit: (input, event, _why, context) =>
    crewRoleAnswer(input, event, context.env, context.paths, null),
  onCrash: (why, input, event, context) => {
    if (crewIdOf(context.env) === null) return SILENT;
    if (event !== "" && event !== "PreToolUse") return SILENT;
    const tool = input === null ? null : stringField(input.tool_name);
    const edits = tool !== null && (CREW_EDIT_TOOLS as readonly string[]).includes(tool);
    if (
      input !== null &&
      !edits &&
      (tool === null || !(CREW_ASK_TOOLS as readonly string[]).includes(tool))
    ) {
      return SILENT;
    }
    return toolDecision(
      "ask",
      cannotCheck(
        edits
          ? "whether this crew session keeps its task list"
          : "whether this crew session asks the person itself",
        why,
      ),
    );
  },
  run: ({ input, event, project, env, paths }) =>
    crewRoleAnswer(input, event, env, paths, project.mainCheckout ?? project.root),
};

/**
 * The lead's notes (`lead-notes.ts`): on a turn a registered lead starts, one line about what
 * changed among its crew sessions since its last turn — the store's events from a per-lead cursor,
 * rendered by the watch's own `eventLine`, said once. **Machine-wide**: it is silent unless the
 * input's `session_id` is a lead recorded in this repository, and it reads no project file. At a
 * SessionStart — a start, a resume, a compaction — it adds one line first: the lead's
 * crew sessions build the work (D61). At a prompt it also adds one reminder line while the lead's
 * own task folder holds no task file (D23); never a block. A crash is one line on stderr and
 * exit 0: a note never stops a lead's turn.
 */
export const leadNotesHook: HookSpec = {
  name: "lead-notes",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (_message, input, event, checkout, context) =>
    leadNotesAnswer(
      input,
      event,
      context.paths,
      checkout.mainCheckout ?? checkout.root,
      context.env,
    ),
  outsideGit: () => SILENT,
  run: ({ input, event, project, paths, env }) =>
    leadNotesAnswer(input, event, paths, project.mainCheckout ?? project.root, env),
};

/**
 * The Agent guard: PreToolUse on the Agent tool (and the older name `Task`), and PostToolUse
 * for the record. **Machine-wide**: it runs with or without cc-smart-dev-kit.json (like
 * `update-check`), and its answer never depends on the project's file — it judges the model
 * and effort a launch names (§ `agent-guard.ts`) — save its D59 queue rule, which needs the
 * project's caps and this repository's store, so `run` is handed the frame's checkout for it. A
 * project that runs its own Agent guard
 * lists `"agent-guard"` in `ownHooks`, and this one stays silent there. `onConfigProblem` and
 * `outsideGit` judge the model and effort alone: a broken or too new cc-smart-dev-kit.json, or a
 * folder that is not in git, does not change which model a launch runs on, and with no caps to
 * read a lead's building launch is never held.
 *
 * PostToolUse is the **record**: a launch the guard asked about on PreToolUse, and the person
 * allowed, ran, and is recorded there (`RAN_EVENT` in `agent-guard.ts`). Claude Code runs
 * PostToolUse only for a call that ran, so a launch the person refused is never recorded. It
 * is wired `--missing=quiet`: a launch that could not be recorded is one line on stderr, and
 * the record is never a question.
 */
export const agentGuardHook: HookSpec = {
  name: "agent-guard",
  events: ["PreToolUse", "PostToolUse"],
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    agentGuard(input, context.env, context.paths, cwdOf(input)),
  outsideGit: (input, _event, _why, context) =>
    agentGuard(input, context.env, context.paths, cwdOf(input)),
  // A crew session is a background session nobody watches: the guard judges it as unattended,
  // so every launch it would ask the person about is refused with the step that reaches the
  // lead — whatever `ownHooks` says and before the file (`crewAgentAnswer` judges, records
  // nothing).
  crewLimits: (input, _checkout, { env, paths }) =>
    crewAgentAnswer(input, env, paths, cwdOf(input)),
  // A crash must not let a launch through unchecked: the guard asks about the launch it was
  // asked to judge. On PostToolUse (the record) it says nothing: the launch already ran.
  onCrash: guardCrash("the model this launch runs on", (input) =>
    ([...AGENT_TOOLS, ...WORKFLOW_TOOLS] as readonly string[]).includes(toolOf(input)),
  ),
  logFacts: guardFacts,
  // The frame's own checkout finds the repository's lead record, so a recorded lead's building
  // launch can be held by the crew queue (D59); the paths without one judge model and effort.
  run: ({ input, env, paths, cwd, nowMs, project }) =>
    agentGuard(input, env, paths, cwd, nowMs, project),
};

/**
 * The session-escape guard: PreToolUse on the shell tools and the three edit tools. It denies
 * the ways a session gets around the limits the person set for it (`workflow review-done`; a
 * kit command run with CLAUDECODE removed) and asks before a command that reaches the portal
 * or an edit of the kit's own settings (§ `session-escape-guard.ts`).
 *
 * **Machine-wide**, like `agent-guard`: its answer never depends on the project's file, so a
 * broken or too new file, and a folder outside git, are judged the same way. And **`alwaysOn`**:
 * `ownHooks` cannot switch it off (it does not even accept the name), because the project's
 * file is one of the things this guard guards. A crash asks about the calls in its domain.
 *
 * A crew session is never asked (D36): each ask is a denial naming the step that reaches its
 * lead, and the crew flag is passed into every path this guard answers through (`run`,
 * `onConfigProblem`, `outsideGit`) — `alwaysOn` already makes them all reach a crew session,
 * so no crew part is needed and no call is judged twice.
 */
export const sessionEscapeGuardHook: HookSpec = {
  name: "session-escape-guard",
  events: ["PreToolUse"],
  alwaysOn: true,
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    sessionEscapeGuard(input, context.paths, process.platform, crewIdOf(context.env) !== null),
  outsideGit: (input, _event, _why, context) =>
    sessionEscapeGuard(input, context.paths, process.platform, crewIdOf(context.env) !== null),
  onCrash: guardCrash(
    "whether this call goes around the limits set for the session",
    inEscapeDomain,
  ),
  run: ({ input, paths, env }) =>
    sessionEscapeGuard(input, paths, process.platform, crewIdOf(env) !== null),
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
 * The job queue's door and the kit's one Bash judge: PreToolUse on Bash, **machine-wide**, and
 * `alwaysOn` (`ownHooks` cannot switch it off). Two parts, and only one reads the project:
 *
 * - **The launch judge** (`bash-judge.ts`) ignores the project's file, broken or not, and runs
 *   outside git: a raw `claude --bg` asks the person (and is refused in `claude -p`) showing the
 *   `crew start` line, `claude -p` is judged by the launch policy every Agent launch meets, a crew
 *   session's `crew start` is denied, and a polling loop over `crew list|status` or
 *   `claude agents --json` is denied. It is always on because it limits what the session itself
 *   may launch: a session must not switch it off by editing a file it owns.
 * - **The route** is the project's opt-in (`"jobs": { "route": true }`, the `switches.jobRoute`
 *   switch): a heavy command is rewritten to run through `cc-smart-dev-kit job run` (or refused
 *   with that command line). Off, a heavy command runs raw. In a session recorded as a lead, a CI
 *   watch, a queued job and the full check are moved to the background instead.
 *
 * It is the one guard that changes the call rather than asking about it.
 */
export const jobRouteHook: HookSpec = {
  name: "job-route",
  events: ["PreToolUse"],
  alwaysOn: true,
  onConfigProblem: (message, input, _event, _checkout, context) =>
    jobRouteConfigAnswer(message, input, context),
  outsideGit: (input, _event, _why, context) => jobRouteOutsideGit(input, context),
  logFacts: routeFacts,
  // A crash must not let a launch or a poll through unjudged, nor a heavy command run raw: the
  // guard asks about the calls in that domain, the same one its answers cover.
  onCrash: guardCrash("whether this launch or heavy command may run", jobRouteDomain),
  run: jobRoute,
};

/** The input's `cwd` for the guard's record; empty when it names none. */
function cwdOf(input: HookInput): string {
  return stringField(input.cwd) ?? "";
}

/** The hooks the plugin wires in `plugin/hooks/hooks.json`, by their bundle name. */
export const HOOKS: readonly HookSpec[] = [
  gitGuardHook,
  mergeGuardHook,
  mainFolderGuardHook,
  messageGuardHook,
  agentGuardHook,
  sessionEscapeGuardHook,
  fableSessionHook,
  jobRouteHook,
  afterMergeHook,
  reviewRecordHook,
  subagentBackgroundHook,
  verifyGateHook,
  agentUsageHook,
  worktreeLeftoversHook,
  sessionNameHook,
  crewRoleHook,
  leadNotesHook,
];

/**
 * The PreToolUse hooks that are **not** guards: `playwright-output` only rewrites the name of
 * a file the browser saves, so a machine with no bun gets no rewrite, never a question.
 */
export const NON_GUARD_PRE_TOOL_USE: ReadonlySet<string> = new Set(["playwright-output"]);

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
 * `stop-failure` (the usage-limit alert, `src/hooks/stop-failure.ts`), `update-check`
 * (the background self-update, `src/update/`) and `notify` (the alerts, `src/hooks/notify.ts`).
 */
export const USER_HOOKS: readonly string[] = [
  "stop-failure",
  "update-check",
  "notify",
  "playwright-output",
];

/**
 * Every hook that answers about the **machine**, not a project: the `USER_HOOKS` bundles
 * (no project file is needed for them to act) and the plugin hooks whose answer does not
 * depend on the project's file either — `agent-guard` (the model a launch runs on),
 * `fable-session` (the model this session runs on), `session-escape-guard` (whether a call
 * goes around the limits set for the session), `crew-role` (a crew session's own card, ask and
 * report), `lead-notes` (a lead's missed crew news and task-list reminder) and `agent-usage` (each subagent's cost on
 * record: the person's spend, not a project's policy). `doctor`'s project checks never warn
 * about a project hook that runs beside one of these: it is the person's own business, not a
 * second copy of a project piece, and `USER_HOOKS` cannot be listed in `ownHooks` in any case.
 */
export const MACHINE_WIDE_HOOKS: readonly string[] = [
  ...USER_HOOKS,
  "agent-guard",
  "fable-session",
  "session-escape-guard",
  "crew-role",
  "lead-notes",
  "agent-usage",
];
