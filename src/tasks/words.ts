/**
 * The words every part of the task list says the same way (D75): the tools' names, the command,
 * and the steps a session follows.
 */
import { COMMAND } from "../build-info/names";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";

/**
 * The task server's tools, by the operation each one runs (`src/tasks/schemas.ts` names the
 * operations; the server registers one tool per key, in this order).
 */
export const TASK_TOOL = {
  create: "task_create",
  take: "task_take",
  update: "task_update",
  done: "task_done",
  note: "task_note",
  list: "task_list",
  get: "task_get",
  search: "task_search",
  delete: "task_delete",
} as const;

export type TaskToolName = (typeof TASK_TOOL)[keyof typeof TASK_TOOL];

/**
 * Claude Code's own task tools, which setup denies (D75): only the lists. Background jobs still
 * need `TaskStop` and `TaskOutput`, so those stay.
 */
export const RETIRED_TASK_TOOLS = [
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TodoWrite",
] as const;

/** The retired tool that closes a task on Claude Code's list: once denied, nothing can. */
export const RETIRED_TASK_CLOSER: (typeof RETIRED_TASK_TOOLS)[number] = "TaskUpdate";

/** A task tool's full name, as Claude Code names it in a session: `mcp__<server>__<tool>`. */
export function taskToolId(tool: TaskToolName): string {
  return `mcp__${TASKS_SERVER_NAME}__${tool}`;
}

/**
 * The permission rule that allows every task tool with no prompt. An allow rule takes a glob
 * only after a literal `mcp__<server>__` prefix (code.claude.com/docs/en/permissions, "Allow
 * rules accept tool-name globs only after a literal `mcp__<server>__` prefix").
 */
export const TASK_TOOLS_ALLOW_RULE = `mcp__${TASKS_SERVER_NAME}__*`;

/** The command a person or a session without the tools runs: `cc-smart-dev-kit task`. */
export const TASK_COMMAND = `${COMMAND} task`;

/** The longest phase id (`K`, `W1a`, `D17b`, `E1a-E1b`): short enough for a branch and a list. */
export const MAX_PHASE = 8;

/**
 * The phase id's rule, in the words a refusal says it (`isPhaseId` in `ops.ts` checks it), and
 * the words the tool schema describes a phase with.
 */
export const PHASE_RULE = `1-${MAX_PHASE} characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"`;

/**
 * What a plan's file list is, said once for the tool schemas, the command's help and the
 * server's instructions: the list the store checks before it reserves a plan for a child.
 */
export const PLAN_FILES_WORDS =
  "Plan task only: the repo-relative paths the plan changes, with / separators; a folder ends in /. Two plans overlap when a path is equal or inside the other's folder (inside a plans.appendOnly folder, only the same file); a plan that overlaps a reserved or running plan is not handed out. The list replaces the stored one; an empty list clears it.";

/**
 * What a plan's `stacked_on` is, said once for the tool schemas and the command's help: the
 * plan it is built on, which the overlap check then skips once proved (`isStackedPair`).
 */
export const STACKED_ON_WORDS =
  "Plan task only: the slug of your own plan this plan is built on. The overlap check skips that one plan, both ways, while it holds its files (open, or done and reserved until its pull request merges), one lead leads both, and this plan is built on its work: that plan records its branch and base, its branch has commits past the default branch and past that base, and this plan's start (its herdr start base, or its base with its own branch recorded) holds some of them and is on this plan's own branch; every other plan still blocks. Never itself, a missing plan, another lead's plan or a loop; null clears it.";
