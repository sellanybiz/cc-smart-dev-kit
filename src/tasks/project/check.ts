import { existsSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { COMMAND } from "../../build-info/names";
import { isTaskFile, type ProjectTaskSettings, scanProjectTasks } from "./files";
export const DEFAULT_STALE_DAYS = 30;
/** One day, the unit of `tasks.staleDays` and every task age. */
export const DAY_MS = 86_400_000;
export interface ProjectTaskFinding {
  kind:
    | "stale"
    | "missed-release"
    | "broken-ref"
    | "duplicate-title"
    | "broken-file"
    | "legacy-notes";
  id?: string;
  file: string;
  text: string;
}
function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export function checkProjectTasks(options: {
  checkoutRoot: string;
  dir: string;
  settings: Pick<ProjectTaskSettings, "staleDays">;
  now: Date;
  shippedIds: ReadonlySet<string>;
  legacyFolders: readonly string[];
}): ProjectTaskFinding[] {
  const { checkoutRoot, dir, settings, now, shippedIds, legacyFolders } = options;
  const { tasks, broken } = scanProjectTasks(dir, { archive: true });
  const findings: ProjectTaskFinding[] = broken.map((item) => ({
    kind: "broken-file",
    file: item.file,
    text: item.why,
  }));
  const titles = new Map<string, string>();
  const root = realpathSync(checkoutRoot);
  for (const task of tasks) {
    if (task.status !== "open") continue;
    const common = { id: task.id, file: task.file };
    if (
      (now.getTime() - Date.parse(task.created)) / DAY_MS >
      (settings.staleDays ?? DEFAULT_STALE_DAYS)
    )
      findings.push({ ...common, kind: "stale", text: `Open since ${task.created}` });
    if (task.when === "next-release" && shippedIds.has(task.id))
      findings.push({
        ...common,
        kind: "missed-release",
        text: "Next-release task was shipped without being closed",
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
    const title = task.title.toLowerCase();
    const previous = titles.get(title);
    if (previous)
      findings.push({
        ...common,
        kind: "duplicate-title",
        text: `Title duplicates ${previous}: ${task.title}`,
      });
    else titles.set(title, task.id);
  }
  for (const folder of legacyFolders) {
    const absolute = resolve(checkoutRoot, folder);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { withFileTypes: true }))
      if (entry.isFile() && isTaskFile(entry.name))
        findings.push({
          kind: "legacy-notes",
          file: resolve(absolute, entry.name),
          text: `Old note remains. Import with ${COMMAND} task import notes ${folder} --kind <kind>`,
        });
  }
  return findings;
}
