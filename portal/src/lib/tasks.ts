/**
 * The Tasks tab's rules (D76), apart from what draws them: which tasks a filter shows, what the
 * counts count, and how the filters live in the page's address (`/tasks?project=…&show=recent`).
 */

import type { ProjectTaskFiles, ProjectWorkTasks, WorkTaskNode } from "@/api/types";

/** Open work only (the default), or what closed in the server's recent window too. */
export type TaskShow = "open" | "recent";

export interface TaskFilter {
  show: TaskShow;
  /** Only tasks that wait for an open task. */
  blocked: boolean;
  /** Only non-blocking tasks: noted work that holds nothing. */
  nonBlocking: boolean;
}

/** What the tab shows: the filter, and one project or (null) every project. */
export interface TaskView extends TaskFilter {
  project: null | string;
}

/** The tab as it opens: open work, nothing else narrowed. */
export const DEFAULT_FILTER: TaskFilter = { show: "open", blocked: false, nonBlocking: false };

/** Everything the server sent: the crew page's phase tree shows its whole phase. */
export const SHOW_ALL: TaskFilter = { show: "recent", blocked: false, nonBlocking: false };

/** The tab on one project: the project page's link. */
export function tasksHref(projectId: string): string {
  return `/tasks?project=${encodeURIComponent(projectId)}`;
}

/** The view an address asks for; a word the page does not know reads as the default. */
export function taskViewOf(query: URLSearchParams): TaskView {
  const project = query.get("project")?.trim() ?? "";
  return {
    show: query.get("show") === "recent" ? "recent" : "open",
    blocked: query.get("blocked") === "1",
    nonBlocking: query.get("type") === "non-blocking",
    project: project === "" ? null : project,
  };
}

/** The address for a view: the defaults left out, every other word of the address kept. */
export function queryOfView(view: TaskView, base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  const put = (name: string, value: null | string) => {
    if (value === null) next.delete(name);
    else next.set(name, value);
  };
  put("project", view.project);
  put("show", view.show === "recent" ? "recent" : null);
  put("blocked", view.blocked ? "1" : null);
  put("type", view.nonBlocking ? "non-blocking" : null);
  return next;
}

export function isClosed(status: WorkTaskNode["status"]): boolean {
  return status === "done" || status === "dropped";
}

/** True when the filter narrows the work tasks beyond open or recent. */
export function narrowsWork(filter: TaskFilter): boolean {
  return filter.blocked || filter.nonBlocking;
}

/** The filter's narrowing in words: "blocked", "non-blocking", or "blocked, non-blocking". */
export function narrowWords(filter: TaskFilter): string {
  return [filter.blocked ? "blocked" : null, filter.nonBlocking ? "non-blocking" : null]
    .filter((word) => word !== null)
    .join(", ");
}

export function isDefaultFilter(filter: TaskFilter): boolean {
  return filter.show === DEFAULT_FILTER.show && !narrowsWork(filter);
}

/** True when the task itself is what the filter asks for. */
export function matchesFilter(task: WorkTaskNode, filter: TaskFilter): boolean {
  if (filter.show === "open" && isClosed(task.status)) return false;
  if (filter.blocked && !task.blocked) return false;
  if (filter.nonBlocking && task.type !== "non-blocking") return false;
  return true;
}

/** One task the tree draws: whether it is what was asked for, or there for what is under it. */
export interface ShownTask {
  task: WorkTaskNode;
  /** False: the filter did not ask for it, and it is shown as the place of what is under it. */
  match: boolean;
  children: ShownTask[];
}

/**
 * The tree a filter shows: each task it asks for, with the tasks above it as their place (a
 * blocked subtask keeps its task, phase and plan), and nothing else.
 */
export function filterTasks(tasks: readonly WorkTaskNode[], filter: TaskFilter): ShownTask[] {
  const shown: ShownTask[] = [];
  for (const task of tasks) {
    const children = filterTasks(task.children, filter);
    const match = matchesFilter(task, filter);
    if (match || children.length > 0) shown.push({ task, match, children });
  }
  return shown;
}

/** How many of the shown tasks the filter asked for. */
export function matchCount(shown: readonly ShownTask[]): number {
  return shown.reduce((sum, one) => sum + (one.match ? 1 : 0) + matchCount(one.children), 0);
}

/** The work a project has open, counted at every layer. */
export interface WorkCounts {
  open: number;
  inProgress: number;
  /** Open and waiting for an open task. */
  blocked: number;
  /** Open and non-blocking. */
  nonBlocking: number;
}

export const NO_WORK: WorkCounts = { open: 0, inProgress: 0, blocked: 0, nonBlocking: 0 };

export function addCounts(a: WorkCounts, b: WorkCounts): WorkCounts {
  return {
    open: a.open + b.open,
    inProgress: a.inProgress + b.inProgress,
    blocked: a.blocked + b.blocked,
    nonBlocking: a.nonBlocking + b.nonBlocking,
  };
}

export function countTasks(tasks: readonly WorkTaskNode[]): WorkCounts {
  let counts = NO_WORK;
  for (const task of tasks) {
    const open = !isClosed(task.status);
    counts = addCounts(counts, {
      open: open ? 1 : 0,
      inProgress: task.status === "in_progress" ? 1 : 0,
      blocked: open && task.blocked ? 1 : 0,
      nonBlocking: open && task.type === "non-blocking" ? 1 : 0,
    });
    counts = addCounts(counts, countTasks(task.children));
  }
  return counts;
}

/** A project's open work, or none when its store has nothing or cannot be read. */
export function workCountsOf(work: ProjectWorkTasks): WorkCounts {
  return work.state === "ready" ? countTasks(work.tasks) : NO_WORK;
}

/** A project's open task files, and how many of them block the release. */
export function fileCountsOf(files: ProjectTaskFiles): { open: number; blocksRelease: number } {
  if (files.state !== "ready") return { open: 0, blocksRelease: 0 };
  return {
    open: files.tasks.length,
    blocksRelease: files.tasks.filter((task) => task.weight === "blocks-release").length,
  };
}
