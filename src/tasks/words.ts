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

/**
 * How a session closes the task a Stop block names, spelled out so any model can follow it:
 * a kit task (`#12`) by `task_done` or the command, a task on Claude Code's own list (read only
 * before setup denies its tools) by `TaskUpdate`.
 */
export function taskCloseStep(ref: string): string {
  return ref.startsWith("#")
    ? `\`${TASK_TOOL.done}\` with task "${ref}" and evidence (what you ran or checked, and its result), or \`${TASK_COMMAND} done ${ref} --evidence <text>\``
    : `\`${RETIRED_TASK_CLOSER}\` with status "completed"`;
}

/** How a session drops a task that no longer applies, by `taskCloseStep`'s two lists. */
export function taskDropStep(ref: string): string {
  return ref.startsWith("#")
    ? `\`${TASK_TOOL.done}\` with task "${ref}", outcome "dropped" and a note that gives the reason, or \`${TASK_COMMAND} drop ${ref} --note <reason>\``
    : `\`${RETIRED_TASK_CLOSER}\` with status "deleted"`;
}
