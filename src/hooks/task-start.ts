import { COMMAND, PLUGIN } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { readMcpRecords } from "../mcp/records";
import { TASKS_SERVER_NAME } from "../mcp/task-server-name";
import { taskContext } from "../tasks/context";
import { DAY_MS, DEFAULT_STALE_DAYS } from "../tasks/deploy/check";
import { oldTaskFiles, scanDeployTasks } from "../tasks/deploy/files";
import { DEPLOY_ENVS_RISK_FIRST, type DeployEnv } from "../tasks/deploy/format";
import { TASK_TOOL } from "../tasks/words";
import { callerOf } from "../tasks/work/identity";
import { startView } from "../tasks/work/read";
import { addContext, type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { Env } from "./run";

/** Context lost at a start, clear or compaction is rebuilt with at most eight task lines. */
export const START_TASK_LIMIT = 8;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The one line about deploy tasks, or null when none is open, unreadable, a duplicate id or old.
 * It reads only the top level of each environment folder (never `archive/`) and the top level of
 * the tasks folder: a few small files, inside the hook's budget. An environment the project does
 * not deploy to (`tasks.envs`) is left out unless it holds an open task. Old files are counted
 * only for a project that opted in (`countOldFiles`): any Markdown file in an unrelated repo's
 * `.claude/tasks/` is none of the kit's business.
 */
export function deployTaskLine(
  dir: string,
  envs: readonly DeployEnv[],
  options: { countOldFiles: boolean },
): string | null {
  const scan = scanDeployTasks(dir, { archive: false });
  // A duplicate id lists every file that claims it: count each id once.
  const open = new Map(scan.tasks.filter((task) => task.status === "open").map((t) => [t.id, t]));
  const old = options.countOldFiles ? oldTaskFiles(dir).length : 0;
  if (open.size === 0 && scan.broken.length === 0 && scan.duplicates.length === 0 && old === 0)
    return null;
  const parts = DEPLOY_ENVS_RISK_FIRST.flatMap((env) => {
    const mine = [...open.values()].filter((task) => task.env === env);
    if (mine.length === 0 && !envs.includes(env)) return [];
    const blocking = mine.filter((task) => task.deploy === "before" && task.type === "blocking");
    return [
      `${env} ${mine.length}${blocking.length > 0 ? ` (${blocking.length} blocking before the deploy)` : ""}`,
    ];
  });
  const notes = [
    scan.broken.length > 0 ? `${scan.broken.length} unreadable` : null,
    scan.duplicates.length > 0
      ? plural(scan.duplicates.length, "duplicate id", "duplicate ids")
      : null,
    old > 0 ? `${plural(old, "old file", "old files")} not read` : null,
  ].filter((note): note is string => note !== null);
  return `Deploy tasks open: ${[parts.join(", "), ...notes].join("; ")} — /${PLUGIN}:tasks`;
}

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
  // An unreadable store is told on stderr, and the deploy line below is still built: it reads
  // the project's own files, not the store.
  const notes: string[] = [];
  if (view.state === "unreadable") notes.push(view.why);
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
  if (context.projectTasks.ok) {
    try {
      const line = deployTaskLine(context.projectTasks.dir, context.projectTasks.envs, {
        countOldFiles: context.projectConfig.ok && context.projectConfig.config !== null,
      });
      if (line !== null) lines.push(line);
    } catch (error) {
      // One bad file must not hide the work list: the line is left out and says why on stderr.
      notes.push(
        `deploy tasks not read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const record = readMcpRecords(paths.stateDir)[TASKS_SERVER_NAME];
  // A store that cannot be read is already reported: "not set up" would be a second, wrong, reason.
  if (view.state !== "unreadable" && (record === undefined || record.pending === true)) {
    lines.push(`The kit's task list is not set up on this machine yet: run \`${COMMAND} setup\`.`);
  }
  const result = lines.length === 0 ? SILENT : addContext("SessionStart", lines.join("\n"));
  // One short line, whatever went wrong (the frame's contract for stderr).
  return notes.length === 0
    ? result
    : { ...result, stderr: `${COMMAND} task-start: ${notes.join("; ").replace(/\s*\n\s*/g, " ")}` };
}
