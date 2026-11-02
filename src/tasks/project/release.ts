import { tasksOn } from "./branch";
import type { ProjectTask } from "./format";
export function releaseList(
  tasks: readonly ProjectTask[],
  options: { shippedIds: ReadonlySet<string> },
) {
  const groups: Record<"blocks-release" | "after-deploy" | "owner" | "none", ProjectTask[]> = {
    "blocks-release": [],
    "after-deploy": [],
    owner: [],
    none: [],
  };
  const nextRelease: ProjectTask[] = [];
  const missed: ProjectTask[] = [];
  for (const task of tasks) {
    if (task.status !== "open") continue;
    if (task.kind === "production" || task.kind === "database")
      groups[task.weight ?? "none"].push(task);
    if (task.when === "next-release") {
      nextRelease.push(task);
      if (options.shippedIds.has(task.id)) missed.push(task);
    }
  }
  return { groups, nextRelease, missed };
}
export function shippedIdsOn(repo: string, dir: string, releaseBranch: string): Set<string> {
  return new Set(tasksOn(repo, dir, releaseBranch).map((task) => task.id));
}
