import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { readMcpRecords } from "../mcp/records";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";
import { taskContext } from "../tasks/context";
import { DAY_MS, DEFAULT_STALE_DAYS } from "../tasks/project/check";
import { TASK_TOOL } from "../tasks/words";
import { callerOf } from "../tasks/work/identity";
import { startView } from "../tasks/work/read";
import { addContext, type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { Env } from "./run";

/** Context lost at a start, clear or compaction is rebuilt with at most eight task lines. */
export const START_TASK_LIMIT = 8;

export function taskStart(
  input: HookInput,
  paths: CliPaths,
  env: Env,
  now: () => number = Date.now,
): HookResult {
  const cwd = stringField(input.cwd);
  if (cwd === null) return SILENT;
  const context = taskContext(cwd, env);
  if (!context.ok) return { stderr: `${COMMAND} task-start: ${context.why}` };
  const who = callerOf({ env, cwd, claudeConfigDir: paths.claudeConfigDir }) ?? {
    sessionId: stringField(input.session_id),
    crewId: null,
    pid: null,
    procStart: null,
  };
  // The project's own `tasks.staleDays` where its file reads; the default where it does not.
  const staleDays = context.projectTasks.ok ? context.projectTasks.staleDays : DEFAULT_STALE_DAYS;
  const view = startView(paths, context.project, who, {
    limit: START_TASK_LIMIT,
    staleBefore: now() - staleDays * DAY_MS,
  });
  if (view.state === "unreadable") return { stderr: `${COMMAND} task-start: ${view.why}` };
  const lines: string[] = [];
  if (view.state === "ready" && view.value.tasks.length > 0) {
    lines.push("Open tasks here (the kit's task list):");
    for (const task of view.value.tasks) {
      const status = [
        task.status === "in_progress" ? "in progress" : task.status,
        ...(task.type === "non-blocking" ? ["non-blocking"] : []),
        ...(task.blocked ? ["blocked"] : []),
      ].join(" · ");
      lines.push(
        `#${task.number} [${status}] ${task.subject}${task.claim === "another session" ? " (another session)" : ""}`,
      );
    }
    if (view.value.more > 0) lines.push(`+${view.value.more} more: ${TASK_TOOL.list}`);
  }
  if (view.state === "ready" && view.value.stale > 0) {
    lines.push(
      `${view.value.stale} open ${view.value.stale === 1 ? "task" : "tasks"} untouched for ${staleDays} days or more, not shown: ${TASK_TOOL.list} with scope "project", then finish or drop them.`,
    );
  }
  const record = readMcpRecords(paths.stateDir)[TASKS_SERVER_NAME];
  if (record === undefined || record.pending === true) {
    lines.push(`The kit's task list is not set up on this machine yet: run \`${COMMAND} setup\`.`);
  }
  return lines.length === 0 ? SILENT : addContext("SessionStart", lines.join("\n"));
}
