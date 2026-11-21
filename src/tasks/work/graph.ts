/**
 * The task graph: who sits under whom (`parentId`) and who waits for whom (`waitsFor`), read
 * once from a list of tasks. Two callers share its rules: `addBlockers` in `store.ts`, which
 * refuses a block that could never be done, and the lift in `db.ts`, which restores an older
 * kit's holds and must refuse the same ones. The graph is pure: no store, no I/O.
 *
 * It sits below `queries.ts` (which wraps `holdingUnder` and `waitsFor` for its callers), so the
 * two helpers the walks need, `isOpen` and `inProgressFirst`, live here and `queries.ts`
 * re-exports `isOpen`.
 */
import type { WorkTask } from "./types";

export function isOpen(task: WorkTask): boolean {
  return task.status === "pending" || task.status === "in_progress";
}
/** In progress first, then by number: the order every list of open tasks is said in. */
export function inProgressFirst(a: WorkTask, b: WorkTask): number {
  return (
    Number(b.status === "in_progress") - Number(a.status === "in_progress") || a.number - b.number
  );
}

/** Why a block is refused: the task sits under the blocker, it makes a cycle, or it waits through a parent. */
export type BlockRefusal = "under" | "cycle" | "through";

/**
 * The refusal in a few words, for a history note. The refusals `addBlockers` says in full are
 * worded in `store.ts`, with the tasks named.
 */
export const BLOCK_REFUSAL_WORDS: Record<BlockRefusal, string> = {
  under: "it sits above this task",
  cycle: "it would make a blocker cycle",
  through: "it already waits for this task, through a parent",
};

/** A stored block of a task on one of its own ancestors: neither can ever be done. */
export interface AncestorHold {
  task: WorkTask;
  ancestor: WorkTask;
}

export class TaskGraph {
  readonly byId: ReadonlyMap<string, WorkTask>;
  private readonly children = new Map<string, WorkTask[]>();
  /** The waits added since the graph was read (`addWait`), by task id: the tasks are never changed. */
  private readonly added = new Map<string, string[]>();

  constructor(tasks: readonly WorkTask[]) {
    this.byId = new Map(tasks.map((task) => [task.id, task]));
    for (const task of tasks) {
      if (!task.parentId) continue;
      const siblings = this.children.get(task.parentId);
      if (siblings) siblings.push(task);
      else this.children.set(task.parentId, [task]);
    }
  }

  /** The tasks directly under `id`, in the order the graph was read. */
  childrenOf(id: string): readonly WorkTask[] {
    return this.children.get(id) ?? [];
  }

  /** The tasks `id` waits for: the stored ones, then those added with `addWait`. */
  waitsOf(id: string): readonly string[] {
    return [...(this.byId.get(id)?.waitsFor ?? []), ...(this.added.get(id) ?? [])];
  }

  /** Records that `id` now waits for `ref`, so the checks after it see the new edge. */
  addWait(id: string, ref: string): void {
    const waits = this.added.get(id);
    if (waits) waits.push(ref);
    else this.added.set(id, [ref]);
  }

  /** The tasks above `task`, nearest first. A parent cycle in an old store ends the walk. */
  ancestorsOf(task: WorkTask): WorkTask[] {
    const up: WorkTask[] = [];
    const seen = new Set([task.id]);
    for (
      let parent = this.byId.get(task.parentId ?? "");
      parent && !seen.has(parent.id);
      parent = this.byId.get(parent.parentId ?? "")
    ) {
      seen.add(parent.id);
      up.push(parent);
    }
    return up;
  }

  /**
   * The open tasks under a task that hold it (D76), in progress first: each open blocking task
   * reached through blocking tasks only. A non-blocking task holds nothing, and what is under it
   * holds only it. Below a closed blocking task the walk goes on, so a task an older kit or a
   * system close left open there still holds.
   */
  holdingUnder(id: string): WorkTask[] {
    const seen = new Set([id]);
    const result: WorkTask[] = [];
    const walk = (parent: string) => {
      for (const child of this.childrenOf(parent)) {
        if (seen.has(child.id) || child.type === "non-blocking") continue;
        seen.add(child.id);
        if (isOpen(child)) result.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return result.sort(inProgressFirst);
  }

  /** Whether `start` already waits for `target`, through explicit blockers or parent completion holds. */
  waitsFor(start: string, target: string): boolean {
    const reached = new Set<string>();
    const pending = [start];
    while (pending.length) {
      const id = pending.pop();
      if (!id || reached.has(id)) continue;
      if (id === target) return true;
      reached.add(id);
      pending.push(...this.waitsOf(id), ...this.holdingUnder(id).map((held) => held.id));
    }
    return false;
  }
}

/**
 * Why `task` may not be blocked by `other`, or null when it may. A task is never blocked by a
 * task above it (a parent waits for its tasks), never by itself or through a chain of blockers
 * that leads back to it, and never by a task that already waits for it through a parent. One
 * block can break two of these, and the first in this order is the one said.
 */
export function blockRefusal(
  graph: TaskGraph,
  task: WorkTask,
  other: WorkTask,
): BlockRefusal | null {
  if (graph.ancestorsOf(task).some((up) => up.id === other.id)) return "under";
  const seen = new Set<string>();
  const pending = [other.id];
  while (pending.length) {
    const id = pending.pop();
    if (!id || seen.has(id)) continue;
    if (id === task.id) return "cycle";
    seen.add(id);
    pending.push(...graph.waitsOf(id));
  }
  // A task waits for its blockers, and a parent for the tasks that hold it (`holdingUnder`). When
  // the blocker already waits for this task that way, at any depth and in either order the
  // blocks were added, neither could ever be done.
  return graph.waitsFor(other.id, task.id) ? "through" : null;
}

/**
 * Every hold of a task on one of its own ancestors, in task number order. `addBlockers` refuses
 * these today, but a store an earlier release lifted may still hold some.
 */
export function ancestorHolds(graph: TaskGraph): AncestorHold[] {
  const found: AncestorHold[] = [];
  for (const task of graph.byId.values()) {
    const above = graph.ancestorsOf(task);
    for (const id of new Set(graph.waitsOf(task.id))) {
      const ancestor = above.find((up) => up.id === id);
      if (ancestor) found.push({ task, ancestor });
    }
  }
  return found.sort(
    (a, b) => a.task.number - b.task.number || a.ancestor.number - b.ancestor.number,
  );
}
