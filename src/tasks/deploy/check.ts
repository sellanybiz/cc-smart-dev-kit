import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { DEPLOY_TASKS_SINCE } from "../../project/config";
import { TASK_COMMAND } from "../words";
import { type DeployTaskSettings, isArchived, oldTaskFiles, scanDeployTasks } from "./files";
import { DEPLOY_STEPS, DEPLOY_TYPES, type DeployTask } from "./format";

export const DEFAULT_STALE_DAYS = 30;
/** One day, the unit of `tasks.staleDays` and every task age. */
export const DAY_MS = 86_400_000;
/** The most old file names `old-files` lists before it counts the rest. */
const OLD_FILES_LISTED = 10;
export interface DeployTaskFinding {
  kind:
    | "stale"
    | "broken-ref"
    | "duplicate-title"
    | "broken-file"
    | "duplicate-id"
    | "twin-missing"
    | "open-in-archive"
    | "old-files";
  id?: string;
  file: string;
  text: string;
}
/** True when `task` names a twin that no task, live or archived, has as its id. */
export function twinIsMissing(task: DeployTask, known: ReadonlySet<string>): boolean {
  return task.twin !== undefined && !known.has(task.twin);
}
/**
 * The way out of a missing twin: `task check` and the gates print this one sentence. A pair is
 * always two new tasks, so the second way out drops the old task first. `place` says which file:
 * its path in a line that has no file of its own, "this file" where the line ends with the path.
 */
export function twinMissingFix(task: DeployTask, place: string = task.file): string {
  return `remove the \`twin\` line from ${place}, or drop ${task.id} (only the person drops a blocking one) and make a new pair with \`${TASK_COMMAND} add "<title>" --kind staging --pair --deploy <${DEPLOY_STEPS.join("|")}> --type <${DEPLOY_TYPES.join("|")}>\``;
}
function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export function checkDeployTasks(options: {
  checkoutRoot: string;
  dir: string;
  settings: Pick<DeployTaskSettings, "staleDays">;
  now: Date;
}): DeployTaskFinding[] {
  const { checkoutRoot, dir, settings, now } = options;
  const { tasks, broken, duplicates } = scanDeployTasks(dir, { archive: true });
  const findings: DeployTaskFinding[] = [
    ...broken.map((item) => ({ kind: "broken-file" as const, file: item.file, text: item.why })),
    ...duplicates.map((item) => ({
      kind: "duplicate-id" as const,
      id: item.id,
      file: item.files[0] ?? dir,
      text: `Id ${item.id} is claimed by ${item.files.join(" and ")}: rename the id inside one of them`,
    })),
  ];
  const known = new Set(tasks.map((task) => task.id));
  const titles = new Map<string, string>();
  const root = realpathSync(checkoutRoot);
  for (const task of tasks) {
    if (task.status !== "open") continue;
    const common = { id: task.id, file: task.file };
    // A reopen that stopped after its first step leaves an open task in archive/ (`reopenDeployTask`).
    if (isArchived(task.file))
      findings.push({
        ...common,
        kind: "open-in-archive",
        text: `${task.id} is open but sits in archive/: run \`${TASK_COMMAND} reopen ${task.id}\` again`,
      });
    if (
      (now.getTime() - Date.parse(task.created)) / DAY_MS >
      (settings.staleDays ?? DEFAULT_STALE_DAYS)
    )
      findings.push({ ...common, kind: "stale", text: `Open since ${task.created}` });
    if (twinIsMissing(task, known))
      findings.push({
        ...common,
        kind: "twin-missing",
        text: `Its twin ${task.twin} is not a task: ${twinMissingFix(task, "this file")}`,
      });
    for (const ref of task.refs ?? []) {
      const target = resolve(checkoutRoot, ref);
      if (
        isAbsolute(ref) ||
        !inside(resolve(checkoutRoot), target) ||
        !existsSync(target) ||
        !inside(root, realpathSync(target))
      )
        findings.push({
          ...common,
          kind: "broken-ref",
          text: `Reference does not exist inside the checkout: ${ref}`,
        });
    }
    // A pair shares one title across its two environments, so a title repeats only within one.
    const title = `${task.env}:${task.title.toLowerCase()}`;
    const previous = titles.get(title);
    if (previous)
      findings.push({
        ...common,
        kind: "duplicate-title",
        text: `Title duplicates ${previous}: ${task.title}`,
      });
    else titles.set(title, task.id);
  }
  const old = oldTaskFiles(dir);
  if (old.length > 0) {
    const names = old.map((file) => basename(file));
    const shown = names.slice(0, OLD_FILES_LISTED).join(", ");
    findings.push({
      kind: "old-files",
      file: dir,
      text: `${old.length} old task file(s) are not read since ${DEPLOY_TASKS_SINCE}: recreate each as a deploy task, or delete it (${shown}${names.length > OLD_FILES_LISTED ? `, and ${names.length - OLD_FILES_LISTED} more` : ""})`,
    });
  }
  return findings;
}
