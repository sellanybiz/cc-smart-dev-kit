/**
 * The words every part of the task list says the same way (D75): the tools' names, the command,
 * and the sentences a guard, a role card and a brief put to a session. One home, so a crew
 * session's first-edit refusal and its brief never name two different steps.
 */
import { COMMAND } from "../build-info/names";
import { TASKS_SERVER_NAME } from "../mcp/names";

/** The task server's tools, in the order it lists them. */
export const TASK_TOOLS = [
  "task_create",
  "task_update",
  "task_done",
  "task_note",
  "task_list",
  "task_get",
  "task_search",
  "task_delete",
] as const;

export type TaskToolName = (typeof TASK_TOOLS)[number];

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
  return `Break your phase into subtasks first: one \`task_create\` per part of your brief, with its done-check in the description (they go under your phase task by themselves). A session without the task tools runs \`${TASK_COMMAND} add "<subject>" --description "<done-check>"\`.`;
}

/** The line a lead with no task of its own gets with each prompt (`lead-notes`). */
export function leadTaskReminder(): string {
  return `You have no task of your own on the kit's task list: put the person's asks and your open work there (\`task_create\`, or \`${TASK_COMMAND} add\`), and keep each one's status true as it moves.`;
}
