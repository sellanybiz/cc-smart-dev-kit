/**
 * The Tasks tab's rules (D76), apart from what draws them: which tasks a filter shows, what the
 * counts count, and how the filters live in the page's address (`/tasks?project=…&status=…`).
 * How the tree is grouped, folded and paged is `task-groups.ts`.
 */

import type { ProjectTaskFiles, ProjectWorkTasks, WorkTaskNode } from "@/api/types";

/**
 * Which tasks by their state: open (the default), in progress, blocked (open and waiting for
 * an open task), closed (done or dropped, in the server's recent window), or all of them.
 */
export type TaskStatusFilter = "all" | "blocked" | "closed" | "in_progress" | "open";

export const STATUS_FILTERS: readonly { value: TaskStatusFilter; label: string; words: string }[] =
  [
    { value: "open", label: "Open", words: "Open tasks" },
    { value: "in_progress", label: "In progress", words: "Tasks in progress" },
    { value: "blocked", label: "Blocked", words: "Blocked tasks: waiting for an open task" },
    { value: "closed", label: "Closed", words: "Closed tasks: done or dropped, recently" },
    { value: "all", label: "All", words: "Every task: open, and closed recently" },
  ];

/** The session filter's value for the tasks no session is recorded for. */
export const NO_SESSION = "none";
/** The plan filter's value for the tasks in no plan. */
export const NO_PLAN = "none";

export interface TaskFilter {
  status: TaskStatusFilter;
  /** Only non-blocking tasks: noted work that holds nothing. */
  nonBlocking: boolean;
  /** Words to find in a task's subject or its `#n`; empty finds every task. */
  q: string;
  /** One session's id, `NO_SESSION`, or null for every session. */
  session: null | string;
  /** One plan's slug, `NO_PLAN`, or null for every plan. */
  plan: null | string;
  /** Only the sessions running now. */
  live: boolean;
}

/** What the tab shows: the filter, one project or (null) every project, the tab, the open task. */
export interface TaskView extends TaskFilter {
  project: null | string;
  /** The work on this machine, or the files each repository holds. */
  tab: "files" | "work";
  /** The id of the task the side panel shows; null when it is closed. */
  task: null | string;
}

/** The tab as it opens: open work, nothing else narrowed. */
export const DEFAULT_FILTER: TaskFilter = {
  status: "open",
  nonBlocking: false,
  q: "",
  session: null,
  plan: null,
  live: false,
};

export const SHOW_ALL: TaskFilter = { ...DEFAULT_FILTER, status: "all" };

export const DEFAULT_VIEW: TaskView = { ...DEFAULT_FILTER, project: null, tab: "work", task: null };

/** The tab on one project: the project page's link. */
export function tasksHref(projectId: string): string {
  return `/tasks?project=${encodeURIComponent(projectId)}`;
}

function statusOf(query: URLSearchParams): TaskStatusFilter {
  const word = query.get("status");
  const known = STATUS_FILTERS.find((one) => one.value === word);
  if (known !== undefined) return known.value;
  // The words of the page before 4.0, so an old link opens what it showed then.
  if (query.get("blocked") === "1") return "blocked";
  if (query.get("show") === "recent") return "all";
  return "open";
}

/** A word of the address, trimmed; empty is none. */
function wordOf(query: URLSearchParams, name: string): null | string {
  const value = query.get(name)?.trim() ?? "";
  return value === "" ? null : value;
}

/** The view an address asks for; a word the page does not know reads as the default. */
export function taskViewOf(query: URLSearchParams): TaskView {
  return {
    status: statusOf(query),
    nonBlocking: query.get("type") === "non-blocking",
    q: query.get("q") ?? "",
    session: wordOf(query, "session"),
    plan: wordOf(query, "plan"),
    live: query.get("live") === "1",
    project: wordOf(query, "project"),
    tab: query.get("tab") === "files" ? "files" : "work",
    task: wordOf(query, "task"),
  };
}

/** The address for a view: the defaults left out, every other word of the address kept. */
export function queryOfView(view: TaskView, base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  const put = (name: string, value: null | string) => {
    if (value === null || value === "") next.delete(name);
    else next.set(name, value);
  };
  // The old words go: `status` says it now.
  next.delete("show");
  next.delete("blocked");
  put("project", view.project);
  put("tab", view.tab === "files" ? "files" : null);
  put("status", view.status === "open" ? null : view.status);
  put("type", view.nonBlocking ? "non-blocking" : null);
  put("session", view.session);
  put("plan", view.plan);
  put("live", view.live ? "1" : null);
  put("q", view.q);
  put("task", view.task);
  return next;
}

export function isClosed(status: WorkTaskNode["status"]): boolean {
  return status === "done" || status === "dropped";
}

/** The four fields the main session binds a phase to (G3), in the order its ledger shows them. */
export const LEDGER_KEYS = ["agent", "branch", "worktree", "base"] as const;

/** One field of a phase's ledger: the word, what the line shows, and the whole value. */
export interface LedgerField {
  key: (typeof LEDGER_KEYS)[number];
  label: string;
  shown: string;
  full: string;
}

/** A path's last folder, a trailing separator left out: `/a/b/wt/` and `C:\a\wt` are `wt`. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

/** A commit as git shortens it: a long hex sha to its first seven; anything else as written. */
export function shortSha(base: string): string {
  return /^[0-9a-f]{8,}$/i.test(base) ? base.slice(0, 7) : base;
}

/** The ledger fields a task has set, in `LEDGER_KEYS` order; none set is an empty list. */
export function ledgerOf(task: WorkTaskNode): LedgerField[] {
  return LEDGER_KEYS.flatMap((key) => {
    const full = task[key];
    if (full === null || full === "") return [];
    const shown = key === "worktree" ? folderName(full) : key === "base" ? shortSha(full) : full;
    return [{ full, key, label: key, shown }];
  });
}

/** True when the filter narrows the work beyond what the status shows by default. */
export function narrowsWork(filter: TaskFilter): boolean {
  return (
    filter.status !== "open" ||
    filter.nonBlocking ||
    filter.q.trim() !== "" ||
    filter.session !== null ||
    filter.plan !== null ||
    filter.live
  );
}

/** What the filter asks for, in words: "blocked, non-blocking, matching “store”". */
export function narrowWords(filter: TaskFilter): string {
  const status = {
    all: null,
    blocked: "blocked",
    closed: "closed",
    in_progress: "in-progress",
    open: null,
  }[filter.status];
  const q = filter.q.trim();
  return [
    status,
    filter.nonBlocking ? "non-blocking" : null,
    filter.live ? "running-session" : null,
    q === "" ? null : `matching “${q}”`,
  ]
    .filter((word) => word !== null)
    .join(", ");
}

export function isDefaultFilter(filter: TaskFilter): boolean {
  return !narrowsWork(filter);
}

/** True when the task's own state is what the status filter asks for. */
function statusMatches(task: WorkTaskNode, status: TaskStatusFilter): boolean {
  switch (status) {
    case "open":
      return !isClosed(task.status);
    case "in_progress":
      return task.status === "in_progress";
    case "blocked":
      return task.blocked;
    case "closed":
      return isClosed(task.status);
    case "all":
      return true;
  }
}

/** True when the task's subject holds the words, any case, or they are its number (`#12`, `12`). */
export function textMatches(task: WorkTaskNode, q: string): boolean {
  const words = q.trim().toLowerCase();
  if (words === "") return true;
  return (
    task.subject.toLowerCase().includes(words) || task.ref === words || task.ref === `#${words}`
  );
}

/**
 * True when the task itself is what the filter asks for. The session, plan and running filters
 * pick whole groups of the tree (`task-groups.ts`), not single rows.
 */
export function matchesFilter(task: WorkTaskNode, filter: TaskFilter): boolean {
  if (!statusMatches(task, filter.status)) return false;
  if (filter.nonBlocking && task.type !== "non-blocking") return false;
  return textMatches(task, filter.q);
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
 * blocked task keeps its phase and plan), and nothing else.
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

/** The open project files whose title or id holds the words, any case. */
export function filesMatching<T extends { id: string; title: string }>(
  tasks: readonly T[],
  q: string,
): T[] {
  const words = q.trim().toLowerCase();
  if (words === "") return [...tasks];
  return tasks.filter(
    (task) => task.title.toLowerCase().includes(words) || task.id.toLowerCase().includes(words),
  );
}
