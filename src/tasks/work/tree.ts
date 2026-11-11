/**
 * A project's work tasks as one tree, for a person's view (the portal's Tasks tab, D75, D76): the
 * plan tasks, their phase tasks and every task under them, each with its layer, type and
 * blockers, the open ones and those closed within a recent window. Read-only, through the hook
 * reader's mode: it never creates or migrates the store, and a store it cannot read is said,
 * never shown as an empty list.
 */
import { claimLive } from "./identity";
import { allTasks, eventsOf, isBlocked, isOpen, layerOf, listTasks, notesOf } from "./queries";
import { type ReadState, readWorkStore } from "./read";
import type { WorkKind, WorkLayer, WorkStatus, WorkTask, WorkTree, WorkType } from "./types";

/** At most this many tasks in one answer: the rest are counted, not sent. */
export const TREE_TASK_LIMIT = 300;

export interface TaskTreeNode {
  session: string | null;
  parentId: string | null;
  claim: "live" | "dead" | "none";
  notes: number;
  events: number;
  id: string;
  /** `#12`: the project's own number for it. */
  ref: string;
  subject: string;
  status: WorkStatus;
  kind: WorkKind;
  /** Plan, phase, task or subtask (D76). */
  layer: WorkLayer;
  /** Blocking holds its parent while open; non-blocking holds nothing (D76). */
  type: WorkType;
  /** The tasks it is blocked by, in number order, closed ones too: an open one blocks it. */
  blockedBy: { ref: string; subject: string; status: WorkStatus }[];
  /** Open, and one of `blockedBy` is still open. */
  blocked: boolean;
  plan: string | null;
  phase: string | null;
  agent: string | null;
  branch: string | null;
  worktree: string | null;
  base: string | null;
  /** Its whole subtree: how many tasks are closed (done or dropped), of how many. */
  closed: number;
  total: number;
  /** Milliseconds since the epoch. */
  updatedAt: number;
  children: TaskTreeNode[];
}

export interface TaskTree {
  roots: TaskTreeNode[];
  /** Tasks left out past `TREE_TASK_LIMIT`. */
  more: number;
}

interface Counted {
  closed: number;
  total: number;
}

/** Count every descendant, including non-blocking work. */
function subtreeCount(task: WorkTree): Counted {
  let closed = 0;
  let total = 0;
  for (const child of task.children) {
    const below = subtreeCount(child);
    total += 1 + below.total;
    closed += (isOpen(child) ? 0 : 1) + below.closed;
  }
  return { closed, total };
}

/** True when the task or anything under it is open, or changed within the window. */
function recent(task: WorkTree, since: number): boolean {
  return (
    isOpen(task) || task.updatedAt >= since || task.children.some((child) => recent(child, since))
  );
}

/** The task and every task under it that `keep` would show. */
function keptCount(task: WorkTree, keep: (task: WorkTree) => boolean): number {
  if (!keep(task)) return 0;
  return 1 + task.children.reduce((sum, child) => sum + keptCount(child, keep), 0);
}

/**
 * Trees into nodes: each task `keep` says yes to, at most `TREE_TASK_LIMIT` of them in all, the
 * rest counted in `more`. Open work first, newest change first: what a person looks for is at
 * the top of each level.
 */
function shapeTrees(
  roots: readonly WorkTree[],
  all: readonly WorkTask[],
  keep: (task: WorkTree) => boolean,
  counts: ReadonlyMap<string, { notes: number; events: number }>,
): TaskTree {
  // A blocker may sit outside the shown tree (closed long ago, or in another phase).
  const byId = new Map(all.map((t) => [t.id, t]));
  let sent = 0;
  let more = 0;
  const byOpenThenNewest = (a: WorkTree, b: WorkTree) =>
    Number(isOpen(b)) - Number(isOpen(a)) || b.updatedAt - a.updatedAt;
  const shape = (task: WorkTree): TaskTreeNode | null => {
    if (!keep(task)) return null;
    if (sent >= TREE_TASK_LIMIT) {
      more += keptCount(task, keep);
      return null;
    }
    sent += 1;
    const count = subtreeCount(task);
    return {
      session: task.createdBy,
      parentId: task.parentId,
      claim: task.claim === null ? "none" : claimLive(task.claim) ? "live" : "dead",
      notes: counts.get(task.id)?.notes ?? 0,
      events: counts.get(task.id)?.events ?? 0,
      id: task.id,
      ref: `#${task.number}`,
      subject: task.subject,
      status: task.status,
      kind: task.kind,
      layer: layerOf(task, byId),
      type: task.type,
      blockedBy: task.waitsFor
        .map((id) => byId.get(id))
        .filter((t) => t !== undefined)
        .sort((a, b) => a.number - b.number)
        .map((t) => ({ ref: `#${t.number}`, subject: t.subject, status: t.status })),
      blocked: isBlocked(task, byId),
      plan: task.plan,
      phase: task.phase,
      agent: task.agent,
      branch: task.branch,
      worktree: task.worktree,
      base: task.base,
      closed: count.closed,
      total: count.total,
      updatedAt: task.updatedAt,
      children: [...task.children]
        .sort(byOpenThenNewest)
        .map(shape)
        .filter((node) => node !== null),
    };
  };
  return {
    roots: [...roots]
      .sort(byOpenThenNewest)
      .map(shape)
      .filter((node) => node !== null),
    more,
  };
}

/** A project's whole tree: its open work, and what closed within `recentMs` of `now`. */
export function projectTaskTree(
  paths: { stateDir: string },
  project: string,
  options: { now: number; recentMs: number },
): ReadState<TaskTree> {
  const since = options.now - options.recentMs;
  return readWorkStore(paths, (db) =>
    shapeTrees(
      listTasks(db, { project, openOnly: false }),
      allTasks(db, project),
      (task) => recent(task, since),
      new Map(
        allTasks(db, project).map((t) => [
          t.id,
          { notes: notesOf(db, t).length, events: eventsOf(db, t).length },
        ]),
      ),
    ),
  );
}
