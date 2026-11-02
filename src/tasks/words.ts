/**
 * The words every part of the task list says the same way (D75): the tools' names, the command,
 * and the sentences a guard, a role card and a brief put to a session. One home, so a crew
 * session's first-edit refusal and its brief never name two different steps.
 */
import { COMMAND } from "../build-info/names";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";

/**
 * The task server's tools, by the operation each one runs (`src/tasks/schemas.ts` names the
 * operations; the server registers one tool per key, in this order).
 */
export const TASK_TOOL = {
  create: "task_create",
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
 * The first step of a crew session, before its first edit: its phase broken into subtasks. The
 * crew-role card and refusal and the crew brief all say it from here.
 */
export function crewTaskStep(): string {
  return `Break your phase into subtasks first: one \`${TASK_TOOL.create}\` per part of your brief, with its done-check in the description (they go under your phase task by themselves). A session without the task tools runs \`${TASK_COMMAND} add "<subject>" --description "<done-check>"\`.`;
}

/**
 * How a session closes the task a Stop block names, spelled out so any model can follow it:
 * a kit task (`#12`) by `task_done` or the command, a task on Claude Code's own list (read only
 * before setup denies its tools, `src/tasks/guard-view.ts`) by `TaskUpdate`.
 */
export function taskCloseStep(ref: string): string {
  return ref.startsWith("#")
    ? `\`${TASK_TOOL.done}\` with task "${ref}", or \`${TASK_COMMAND} done ${ref}\``
    : `\`${RETIRED_TASK_CLOSER}\` with status "completed"`;
}

/** The line a lead with no task of its own gets with each prompt (`lead-notes`). */
export function leadTaskReminder(): string {
  return `You have no task of your own on the kit's task list: put the person's asks and your open work there (\`${TASK_TOOL.create}\`, or \`${TASK_COMMAND} add\`), and keep each one's status true as it moves.`;
}
