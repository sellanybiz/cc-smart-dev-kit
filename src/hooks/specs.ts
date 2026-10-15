/**
 * Every plugin hook: what it runs, what silences it (the defer check), and how it fails
 * closed when the project's anymodel.json is broken or needs a newer plugin.
 *
 * | Hook | Event (matcher) | Fails closed by |
 * |---|---|---|
 * | worktree-create | WorktreeCreate | failing: exit 1, the reason (the update command) on stderr |
 * | worktree-remove | WorktreeRemove | keeping the worktree: exit 1, the reason on stderr |
 * | subagent-stop | SubagentStop | keeping the worktree (exit 0: a subagent must finish) |
 * | git-guard | PreToolUse (Bash, PowerShell) | asking before every command that runs git |
 * | main-folder-guard | PreToolUse (Edit, Write, NotebookEdit) | asking before every edit in the repo |
 * | message-guard | PreToolUse (SendMessage) | asking before every message |
 * | after-merge | PostToolUse, PostToolUseFailure (Bash, PowerShell) | one line after a merge |
 * | worktree-leftovers | SessionStart (startup, resume) | one line |
 * | session-name | SessionStart, UserPromptSubmit | nothing but a line on stderr |
 */

import { existsSync } from "node:fs";
import { afterMerge, mergesPullRequest } from "./after-merge";
import { isInside } from "./git";
import { DEFAULT_PROTECTED_BRANCHES, guardQuestions, runsGit } from "./git-guard";
import { addContext, type HookResult, SILENT, stringField, toolDecision, toolInput } from "./io";
import { editedFile, mainFolderGuard } from "./main-folder-guard";
import { messageGuard } from "./message-guard";
import { deferSubject, type HookSpec } from "./run";
import { sessionName } from "./session-name";
import { worktreeCreate } from "./worktree-create";
import { worktreeLeftovers } from "./worktree-leftovers";
import { subagentStop, worktreeRemove } from "./worktree-remove";

/** Said to the person when a guard cannot read the project's anymodel.json. */
function cannotCheck(what: string, message: string): string {
  return `anymodel cannot check ${what}: ${message}`;
}

export const worktreeCreateHook: HookSpec = {
  name: "worktree-create",
  events: ["WorktreeCreate"],
  deferToUserSettings: true,
  onConfigProblem: (message) => ({ exitCode: 1, stderr: `worktree not created: ${message}` }),
  outsideGit: (_input, _event, why) => ({ exitCode: 1, stderr: `worktree not created: ${why}` }),
  run: worktreeCreate,
  crashExitCode: 1,
};

export const worktreeRemoveHook: HookSpec = {
  name: "worktree-remove",
  events: ["WorktreeRemove"],
  deferToUserSettings: true,
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
  deferToUserSettings: true,
  // The plugin cleans only the worktrees its own WorktreeCreate made.
  deferOn: (input, event) => [
    { event: "WorktreeCreate", subject: null },
    { event, subject: deferSubject(input, event) },
  ],
  onConfigProblem: (message) => ({ stderr: `subagent worktree kept: ${message}` }),
  run: subagentStop,
};

export const gitGuardHook: HookSpec = {
  name: "git-guard",
  events: ["PreToolUse"],
  onConfigProblem: (message, input) => {
    const command = stringField(toolInput(input).command);
    return command !== null && runsGit(command)
      ? toolDecision("ask", cannotCheck("this git command", message))
      : SILENT;
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
  onConfigProblem: (message) =>
    toolDecision("ask", cannotCheck("whether this message stays in this repo", message)),
  run: messageGuard,
};

export const afterMergeHook: HookSpec = {
  name: "after-merge",
  events: ["PostToolUse", "PostToolUseFailure"],
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
  onConfigProblem: (message, _input, event) => addContext(event, `anymodel: ${message}`),
  run: worktreeLeftovers,
};

export const sessionNameHook: HookSpec = {
  name: "session-name",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (message) => ({ stderr: `anymodel session-name: ${message}` }),
  run: sessionName,
};

/** Every hook, by its bundle name. */
export const HOOKS: readonly HookSpec[] = [
  worktreeCreateHook,
  worktreeRemoveHook,
  subagentStopHook,
  gitGuardHook,
  mainFolderGuardHook,
  messageGuardHook,
  afterMergeHook,
  worktreeLeftoversHook,
  sessionNameHook,
];
