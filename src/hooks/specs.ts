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
 * | after-merge | PostToolUse, PostToolUseFailure (Bash, PowerShell) | one line after a merge |
 * | worktree-leftovers | SessionStart (startup, resume) | one line |
 * | session-name | SessionStart, UserPromptSubmit | nothing but a line on stderr |
 *
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
import type { AnymodelConfig } from "../project/config";
import { afterMerge, mergesPullRequest } from "./after-merge";
import { isInside } from "./git";
import { DEFAULT_PROTECTED_BRANCHES, guardQuestions, runsGit } from "./git-guard";
import { addContext, type HookResult, SILENT, stringField, toolDecision, toolInput } from "./io";
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

/** The hooks the plugin wires in `plugin/hooks/hooks.json`, by their bundle name. */
export const HOOKS: readonly HookSpec[] = [
  gitGuardHook,
  mainFolderGuardHook,
  messageGuardHook,
  afterMergeHook,
  worktreeLeftoversHook,
  sessionNameHook,
];

/** The hooks a project wires itself, as `anymodel hook <name>`: the worktree engine. */
export const PROJECT_HOOKS: readonly HookSpec[] = [
  worktreeCreateHook,
  worktreeRemoveHook,
  subagentStopHook,
];
