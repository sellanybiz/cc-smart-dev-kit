/**
 * The task graph: who sits under whom (`parentId`) and who waits for whom (`waitsFor`), read
 * once from a list of tasks. `addBlockers` (`store.ts`) and the lift (`db.ts`) share its refusal
 * rules, so the lift never restores a hold the store would refuse. `queries.ts` imports this
 * file, so `isOpen` and `inProgressFirst`, which the walks need, live here.
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

export type BlockRefusal = "under" | "cycle" | "through";

/** The refusal in a few words, for the lift's history note (`addBlockers` names the tasks in full). */
export const BLOCK_REFUSAL_WORDS: Record<BlockRefusal, string> = {
  under: "it sits above this task",
  cycle: "it would make a blocker cycle",
  through: "it already waits for this task, through a parent",
};

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

  childrenOf(id: string): readonly WorkTask[] {
    return this.children.get(id) ?? [];
  }

  waitsOf(id: string): readonly string[] {
    return [...(this.byId.get(id)?.waitsFor ?? []), ...(this.added.get(id) ?? [])];
  }

  /** Records a wait the caller just stored, so the checks after it see the edge. */
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

  /** Whether `start` waits for `target`, through blockers or the tasks a parent waits for. */
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

/** Every hold of a task on one of its ancestors, which `addBlockers` refuses but an earlier lift may have stored. */
export function ancestorHolds(graph: TaskGraph): AncestorHold[] {
  const found: AncestorHold[] = [];
  for (const task of graph.byId.values()) {
    const above = graph.ancestorsOf(task);
    for (const id of graph.waitsOf(task.id)) {
      const ancestor = above.find((up) => up.id === id);
      if (ancestor) found.push({ task, ancestor });
    }
  }
  return found.sort(
    (a, b) => a.task.number - b.task.number || a.ancestor.number - b.ancestor.number,
  );
}
