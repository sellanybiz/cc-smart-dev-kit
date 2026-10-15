/**
 * Every hook: what it runs, who wires it, what silences it (the defer check, for the hooks
 * the plugin wires), and how it fails closed when the project's anymodel.json is broken,
 * needs a newer plugin, or lacks what the hook needs.
 *
 * The plugin wires these in `plugin/hooks/hooks.json` (`HOOKS`):
 *
 * | Hook | Event (matcher) | Fails closed by |
 * |---|---|---|
 * | git-guard | PreToolUse (Bash, PowerShell) | asking before every command that runs git |
 * | main-folder-guard | PreToolUse (Edit, Write, NotebookEdit) | asking before every edit in the repo |
 * | message-guard | PreToolUse (SendMessage) | asking before every message |
 * | agent-guard | PreToolUse (Agent, Task, Workflow) | machine-wide: it judges the same way without anymodel.json (`agent-guard.ts`) |
 * | job-route | PreToolUse (Bash) | asking about a heavy command, classified with the default kinds |
 * | after-merge | PostToolUse, PostToolUseFailure (Bash, PowerShell) | one line after a merge |
 * | worktree-leftovers | SessionStart (startup, resume) | one line |
 * | session-name | SessionStart, UserPromptSubmit | nothing but a line on stderr |
 *
 * Three more bundles are in `hooks.json` without a spec here (`USER_HOOKS`): they are about
 * the person, not a project, so they never enter the frame and read no `anymodel.json` —
 * `stop-failure` (the usage-limit alert), `update-check` (the background self-update and the
 * instructions copy) and `notify` (desktop notifications, silent inside Warp).
 * A project wires these itself, as `anymodel hook <name>` (`PROJECT_HOOKS`): the worktree
 * engine. A plugin WorktreeCreate would replace Claude Code's own worktrees in every
 * project, so the engine is opt-in (`docs/design.md` § The worktree engine). Each needs
 * `worktrees` in anymodel.json, and fails closed without it:
 *
 * | Hook | Event | Fails closed by |
 * |---|---|---|
 * | worktree-create | WorktreeCreate | failing: exit 1, the reason on stderr |
 * | worktree-remove | WorktreeRemove | keeping the worktree: exit 1, the reason on stderr |
 * | subagent-stop | SubagentStop | keeping the worktree (exit 0: a subagent must finish) |
 */

import { existsSync } from "node:fs";
import { classifyHeavyCommand } from "../jobs/classify";
import { mergeKinds } from "../jobs/kinds";
import type { AnymodelConfig } from "../project/config";
import { afterMerge, mergesPullRequest } from "./after-merge";
import { agentGuard, guardFacts } from "./agent-guard";
import { isInside } from "./git";
import { DEFAULT_PROTECTED_BRANCHES, guardQuestions, runsGit } from "./git-guard";
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
import { editedFile, mainFolderGuard } from "./main-folder-guard";
import { messageGuard } from "./message-guard";
import type { HookSpec } from "./run";
import { sessionName } from "./session-name";
import { programsOf } from "./shell-command";
import { worktreeCreate } from "./worktree-create";
import { worktreeLeftovers } from "./worktree-leftovers";
import { subagentStop, worktreeRemove } from "./worktree-remove";

/** Said to the person when a guard cannot read the project's anymodel.json. */
function cannotCheck(what: string, message: string): string {
  return `anymodel cannot check ${what}: ${message}`;
}

/**
 * The worktree engine's need: `worktrees` in anymodel.json. A project that wires the hooks
 * without it gets this reason, never a worktree of some other shape.
 */
export function needsWorktrees(config: AnymodelConfig | null): string | null {
  if (config?.worktrees !== undefined) return null;
  const lacks =
    config === null
      ? "has no .claude/anymodel.json"
      : 'its .claude/anymodel.json has no "worktrees"';
  return (
    `this project wires the anymodel worktree hooks (anymodel hook ...), but ${lacks}. ` +
    'Add "worktrees" to .claude/anymodel.json, or take the three anymodel hook lines out of ' +
    ".claude/settings.json (the anymodel README, § Worktrees)"
  );
}

export const worktreeCreateHook: HookSpec = {
  name: "worktree-create",
  events: ["WorktreeCreate"],
  wiring: "project",
  needs: needsWorktrees,
  onConfigProblem: (message) => ({ exitCode: 1, stderr: `worktree not created: ${message}` }),
  outsideGit: (_input, _event, why) => ({ exitCode: 1, stderr: `worktree not created: ${why}` }),
  run: worktreeCreate,
  crashExitCode: 1,
};

export const worktreeRemoveHook: HookSpec = {
  name: "worktree-remove",
  events: ["WorktreeRemove"],
  wiring: "project",
  needs: needsWorktrees,
  onConfigProblem: (message) => ({ exitCode: 1, stderr: `worktree kept: ${message}` }),
  // Claude Code starts the hook inside the worktree; when that folder is gone, so is the worktree.
  outsideGit: (input, _event, why) => {
    const path = stringField(input.worktree_path);
    return path !== null && !existsSync(path)
      ? SILENT
      : { exitCode: 1, stderr: `worktree kept: ${why}` };
  },
  run: worktreeRemove,
  crashExitCode: 1,
};

export const subagentStopHook: HookSpec = {
  name: "subagent-stop",
  events: ["SubagentStop"],
  wiring: "project",
  needs: needsWorktrees,
  onConfigProblem: (message) => ({ stderr: `subagent worktree kept: ${message}` }),
  run: subagentStop,
};

export const gitGuardHook: HookSpec = {
  name: "git-guard",
  events: ["PreToolUse"],
  wiring: "plugin",
  onConfigProblem: (message, input) => {
    const command = stringField(toolInput(input).command);
    return command !== null && runsGit(command)
      ? toolDecision("ask", cannotCheck("this git command", message))
      : SILENT;
  },
  // For the hook log: the programs of the command line, read the way the guard reads it, so
  // `doctor --live` can prove the guard parsed the call (not only that the hook ran).
  logFacts: (input) => {
    const command = stringField(toolInput(input).command);
    return command === null ? {} : { programs: programsOf(command) };
  },
  run: ({ project, input, cwd, env }): HookResult => {
    const config = project.config;
    if (config === null) return SILENT;
    const command = stringField(toolInput(input).command);
    if (command === null) return SILENT;
    const questions = guardQuestions(command, cwd, {
      protectedBranches: config.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
      sharedStash: config.worktrees !== undefined,
      env,
    });
    return questions.length === 0 ? SILENT : toolDecision("ask", questions.join("\n"));
  },
};

export const mainFolderGuardHook: HookSpec = {
  name: "main-folder-guard",
  events: ["PreToolUse"],
  wiring: "plugin",
  onConfigProblem: (message, input, _event, checkout) => {
    const file = typeof input.cwd === "string" ? editedFile(input, input.cwd) : null;
    const repo = checkout.mainCheckout ?? checkout.root;
    return file !== null && isInside(file, repo)
      ? toolDecision("ask", cannotCheck("whether this edit belongs in a worktree", message))
      : SILENT;
  },
  run: mainFolderGuard,
};

export const messageGuardHook: HookSpec = {
  name: "message-guard",
  events: ["PreToolUse"],
  wiring: "plugin",
  onConfigProblem: (message) =>
    toolDecision("ask", cannotCheck("whether this message stays in this repo", message)),
  run: messageGuard,
};

export const afterMergeHook: HookSpec = {
  name: "after-merge",
  events: ["PostToolUse", "PostToolUseFailure"],
  wiring: "plugin",
  onConfigProblem: (message, input, event) => {
    const command = stringField(toolInput(input).command);
    return command !== null && mergesPullRequest(command)
      ? addContext(event, `anymodel: ${message}`)
      : SILENT;
  },
  run: afterMerge,
};

export const worktreeLeftoversHook: HookSpec = {
  name: "worktree-leftovers",
  events: ["SessionStart"],
  wiring: "plugin",
  onConfigProblem: (message, _input, event) => addContext(event, `anymodel: ${message}`),
  run: worktreeLeftovers,
};

export const sessionNameHook: HookSpec = {
  name: "session-name",
  events: ["SessionStart", "UserPromptSubmit"],
  wiring: "plugin",
  onConfigProblem: (message) => ({ stderr: `anymodel session-name: ${message}` }),
  run: sessionName,
};

/**
 * The Agent guard: PreToolUse on the Agent tool (and the older name `Task`). **Machine-wide**:
 * it runs with or without anymodel.json (like `update-check`), and its answer never depends on
 * the project's file — it judges the model and effort a launch names (§ `agent-guard.ts`). A
 * project that runs its own Agent guard lists `"agent-guard"` in `ownHooks`, and this one
 * stays silent there. `onConfigProblem` and `outsideGit` judge the same way: a broken or too
 * new anymodel.json, or a folder that is not in git, does not change which model a launch runs
 * on.
 */
export const agentGuardHook: HookSpec = {
  name: "agent-guard",
  events: ["PreToolUse"],
  wiring: "plugin",
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    agentGuard(input, context.env, context.paths, cwdOf(input)),
  outsideGit: (input, _event, _why, context) =>
    agentGuard(input, context.env, context.paths, cwdOf(input)),
  logFacts: guardFacts,
  run: ({ input, env, paths, cwd }) => agentGuard(input, env, paths, cwd),
};

/**
 * The job queue's door: PreToolUse on Bash, for a project that turned it on
 * (`"jobs": { "route": true }`). A heavy command is rewritten to run through
 * `anymodel job run` (or refused with that command line, `job-route.ts`). Off by default,
 * and silent when it is off: this is the one guard that changes the call rather than
 * asking about it.
 */
export const jobRouteHook: HookSpec = {
  name: "job-route",
  events: ["PreToolUse"],
  wiring: "plugin",
  onConfigProblem: (message, input) => {
    // Broken file: whether this project routes heavy commands cannot be read. The guard asks
    // about the commands in its domain, the way the other guards do, and about no others.
    const command = stringField(toolInput(input).command);
    return command === null || classifyHeavyCommand(command, mergeKinds(undefined)) === null
      ? SILENT
      : toolDecision(
          "ask",
          cannotCheck("whether this project routes heavy commands through its job queue", message),
        );
  },
  logFacts: routeFacts,
  run: jobRoute,
};

/** The input's `cwd` for the guard's record; empty when it names none. */
function cwdOf(input: HookInput): string {
  return stringField(input.cwd) ?? "";
}

/** The hooks the plugin wires in `plugin/hooks/hooks.json`, by their bundle name. */
export const HOOKS: readonly HookSpec[] = [
  gitGuardHook,
  mainFolderGuardHook,
  messageGuardHook,
  agentGuardHook,
  jobRouteHook,
  afterMergeHook,
  worktreeLeftoversHook,
  sessionNameHook,
];

/**
 * The plugin's other bundles in `plugin/hooks/hooks.json`, by name: hooks about the person,
 * not a project, so no `HookSpec` here — they never enter the frame (`run.ts`) and read no
 * `anymodel.json` (`ownHooks` lists only `HOOKS`). Each has its own entry and its own logic:
 * `stop-failure` (the usage-limit alert, `src/hooks/stop-failure.ts`) and `update-check`
 * (the background self-update, `src/update/`).
 */
export const USER_HOOKS: readonly string[] = ["stop-failure", "update-check", "notify"];

/**
 * Every hook that answers about the **machine**, not a project: the `USER_HOOKS` bundles
 * (they never read anymodel.json at all) and `agent-guard`, a plugin hook whose answer does
 * not depend on the project's file either. `doctor`'s project checks never warn about a
 * project hook that runs beside one of these: it is the person's own business, not a second
 * copy of a project piece, and `USER_HOOKS` cannot be listed in `ownHooks` in any case.
 */
export const MACHINE_WIDE_HOOKS: readonly string[] = [...USER_HOOKS, "agent-guard"];

/** The hooks a project wires itself, as `anymodel hook <name>`: the worktree engine. */
export const PROJECT_HOOKS: readonly HookSpec[] = [
  worktreeCreateHook,
  worktreeRemoveHook,
  subagentStopHook,
];
