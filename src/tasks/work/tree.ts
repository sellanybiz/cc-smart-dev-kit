/**
 * A project's work tasks as one tree, for a person's view (the portal's Tasks card, D75): the
 * plan tasks, their phase tasks and every subtask, the open ones and those closed within a
 * recent window. Read-only, through the hook reader's mode: it never creates or migrates the
 * store, and a store it cannot read is said, never shown as an empty list.
 */
import { allTasks, countsToward, isOpen, listTasks } from "./queries";
import { type ReadState, readWorkStore } from "./read";
import type { WorkKind, WorkStatus, WorkTree } from "./types";

/** At most this many tasks in one answer: the rest are counted, not sent. */
export const TREE_TASK_LIMIT = 300;

export interface TaskTreeNode {
  id: string;
  /** `#12`: the project's own number for it. */
  ref: string;
  subject: string;
  status: WorkStatus;
  kind: WorkKind;
  plan: string | null;
  phase: string | null;
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

/**
 * `subtreeProgress`'s rule over a tree already built: `above` is the crew id of the nearest crew
 * phase above `task` (`countsToward`).
 */
function subtreeCount(task: WorkTree, above: string | null = null): Counted {
  const phaseCrew = task.kind === "phase" ? task.crewId : above;
  let closed = 0;
  let total = 0;
  for (const child of task.children) {
    const below = subtreeCount(child, phaseCrew);
    const own = countsToward(child, phaseCrew) ? 1 : 0;
    total += own + below.total;
    closed += (isOpen(child) ? 0 : own) + below.closed;
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
function shapeTrees(roots: readonly WorkTree[], keep: (task: WorkTree) => boolean): TaskTree {
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
      id: task.id,
      ref: `#${task.number}`,
      subject: task.subject,
      status: task.status,
      kind: task.kind,
      plan: task.plan,
      phase: task.phase,
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
    shapeTrees(listTasks(db, { project, openOnly: false }), (task) => recent(task, since)),
  );
}

/**
 * One crew session's phase task and every task under it, closed ones too (its page shows how
 * the phase went); null when the store has no phase task for it (a session from before 1.10.0).
 */
export function crewPhaseTree(
  paths: { stateDir: string },
  project: string,
  crewId: string,
): ReadState<{ phase: TaskTreeNode | null; more: number }> {
  return readWorkStore(paths, (db) => {
    const phase = allTasks(db, project).find((t) => t.kind === "phase" && t.crewId === crewId);
    if (phase === undefined) return { phase: null, more: 0 };
    const tree = shapeTrees(
      listTasks(db, { project, root: phase.id, openOnly: false }),
      () => true,
    );
    return { phase: tree.roots[0] ?? null, more: tree.more };
  });
}
