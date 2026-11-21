/**
 * The task graph (`graph.ts`): the walks over parents and blockers, the three refusals in their
 * order, and the stored holds on an ancestor. The graph tests run on hand-written tasks; the last
 * tests run `addBlockers` through the store to prove its words and order did not move.
 */
import { expect, test } from "bun:test";
import { tempDir } from "../../testing/temp";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./db";
import { ancestorHolds, blockRefusal, TaskGraph } from "./graph";
import { createTask, layPhase, updateTask } from "./store";
import type { Result, WorkTask } from "./types";

/** A task as `allTasks` reads it, with only the fields a test names set. */
function task(number: number, parent: WorkTask | null, change: Partial<WorkTask> = {}): WorkTask {
  return {
    id: `w${number}`,
    number,
    project: "p",
    parentId: parent?.id ?? null,
    kind: "task",
    subject: `Task ${number}`,
    description: "",
    status: "pending",
    plan: null,
    phase: null,
    agent: null,
    branch: null,
    worktree: null,
    base: null,
    createdBy: null,
    creator: null,
    claim: null,
    createdAt: 0,
    updatedAt: 0,
    closedAt: null,
    waitsFor: [],
    type: "blocking",
    files: [],
    lead: null,
    ...change,
  };
}

test("holdingUnder: open blocking tasks at any depth, in progress first, never below a non-blocking one", () => {
  const top = task(1, null);
  const first = task(2, top);
  const closed = task(3, top, { status: "done" });
  const below = task(4, closed);
  const running = task(5, below, { status: "in_progress" });
  const loose = task(6, top, { type: "non-blocking" });
  const hidden = task(7, loose);
  const graph = new TaskGraph([top, first, closed, below, running, loose, hidden]);
  // The closed task holds nothing itself, but what an older kit left open below it still holds.
  expect(graph.holdingUnder(top.id).map((t) => t.number)).toEqual([5, 2, 4]);
  expect(graph.holdingUnder(loose.id).map((t) => t.number)).toEqual([7]);
  expect(graph.holdingUnder(hidden.id)).toEqual([]);
});

test("waitsFor follows blockers and parent holds, and an added wait is seen by the next question", () => {
  const parent = task(1, null);
  const child = task(2, parent);
  const other = task(3, null);
  const graph = new TaskGraph([parent, child, other]);
  // A parent waits for the tasks under it.
  expect(graph.waitsFor(parent.id, child.id)).toBe(true);
  expect(graph.waitsFor(child.id, parent.id)).toBe(false);
  expect(graph.waitsFor(other.id, child.id)).toBe(false);
  graph.addWait(other.id, parent.id);
  // Other waits for the parent, which waits for the child.
  expect(graph.waitsFor(other.id, child.id)).toBe(true);
  expect(graph.waitsOf(other.id)).toEqual([parent.id]);
  // The tasks the graph was read from are never changed.
  expect(other.waitsFor).toEqual([]);
});

test("blockRefusal: a task above it is refused as under", () => {
  const parent = task(1, null);
  const child = task(2, parent);
  const grandchild = task(3, child);
  const graph = new TaskGraph([parent, child, grandchild]);
  expect(blockRefusal(graph, grandchild, parent)).toBe("under");
  expect(blockRefusal(graph, grandchild, child)).toBe("under");
  // A task under it is fine: the parent waits for it anyway, and the child need not wait for it.
  expect(blockRefusal(graph, parent, grandchild)).toBeNull();
});

test("blockRefusal: itself and a chain back to it are refused as a cycle", () => {
  const a = task(1, null);
  const b = task(2, null, { waitsFor: ["w1"] });
  const c = task(3, null, { waitsFor: ["w2"] });
  const graph = new TaskGraph([a, b, c]);
  expect(blockRefusal(graph, a, a)).toBe("cycle");
  // A waits for C, which waits for B, which waits for A.
  expect(blockRefusal(graph, a, c)).toBe("cycle");
  expect(blockRefusal(graph, c, a)).toBeNull();
});

test("blockRefusal: a blocker that waits for the task through a parent is refused as through", () => {
  const parent = task(1, null);
  const child = task(2, parent, { waitsFor: ["w3"] });
  const x = task(3, null);
  const graph = new TaskGraph([parent, child, x]);
  // Parent waits for Child, and Child waits for X: X blocked by Parent could never be done.
  expect(blockRefusal(graph, x, parent)).toBe("through");
  // A non-blocking child holds nothing, so the same chain waits on nothing.
  const loose = new TaskGraph([parent, { ...child, type: "non-blocking" }, x]);
  expect(blockRefusal(loose, x, parent)).toBeNull();
});

test("blockRefusal: a block that breaks two rules says the first, under then cycle then through", () => {
  const parent = task(1, null, { waitsFor: ["w2"] });
  const child = task(2, parent);
  const graph = new TaskGraph([parent, child]);
  // Child blocked by Parent sits under it, and Parent already waits for Child by name: under wins.
  expect(blockRefusal(graph, child, parent)).toBe("under");
  // X blocked by Y: Y waits for X by name (a cycle), which is also a wait through (the walk
  // follows blockers too): the cycle is said.
  const x = task(3, null);
  const y = task(4, null, { waitsFor: ["w3"] });
  expect(blockRefusal(new TaskGraph([x, y]), x, y)).toBe("cycle");
});

test("blockRefusal sees a wait added after the graph was read", () => {
  const a = task(1, null);
  const b = task(2, null);
  const graph = new TaskGraph([a, b]);
  expect(blockRefusal(graph, b, a)).toBeNull();
  graph.addWait(b.id, a.id);
  expect(blockRefusal(graph, a, b)).toBe("cycle");
});

test("ancestorHolds: every stored hold on something above, in number order, and no other", () => {
  const top = task(1, null);
  const middle = task(2, top, { waitsFor: ["w1"] });
  const leaf = task(3, middle, { waitsFor: ["w2", "w1", "w5"] });
  const beside = task(4, top, { waitsFor: ["w3"] });
  const stray = task(5, null);
  const graph = new TaskGraph([stray, leaf, beside, top, middle]);
  expect(ancestorHolds(graph).map(({ task, ancestor }) => [task.number, ancestor.number])).toEqual([
    [2, 1],
    [3, 1],
    [3, 2],
  ]);
  expect(ancestorHolds(new TaskGraph([top, beside]))).toEqual([]);
});

test("a parent cycle in an old store ends every upward walk", () => {
  const a = task(1, null, { parentId: "w2", waitsFor: ["w2"] });
  const b = task(2, null, { parentId: "w1" });
  const graph = new TaskGraph([a, b]);
  expect(graph.ancestorsOf(a).map((t) => t.number)).toEqual([2]);
  expect(blockRefusal(graph, a, b)).toBe("under");
  expect(ancestorHolds(graph).map(({ task, ancestor }) => [task.number, ancestor.number])).toEqual([
    [1, 2],
  ]);
});

const who = { sessionId: "s", pid: 1, procStart: "1" };
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.why);
  return r.value;
}
function store() {
  return openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
}
/** A phase of `plan` (and the plan with it): the parent a task can sit under. */
function phase(db: WorkDb, plan: string, subject: string): WorkTask {
  return ok(writeWork(db, () => layPhase(db, { project: "p", plan, phase: "A", subject }, who, 1)))
    .task;
}
/** A task as its refusals name it: `#2 "Child"`. */
function named(t: WorkTask): string {
  return `#${t.number} "${t.subject}"`;
}
function holdCount(db: WorkDb): number {
  return db.sqlite.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM task_deps").get()?.n ?? -1;
}

test("addBlockers refuses an unknown task and another project's task before any rule", () => {
  const db = store();
  try {
    const child = ok(createTask(db, { project: "p", subject: "Child" }, who, 1));
    const elsewhere = ok(createTask(db, { project: "q", subject: "Other" }, who, 2));
    const block = (ref: string) => updateTask(db, child.id, { waitsFor: { add: [ref] } }, who, 3);
    expect(block("wnosuchtask")).toEqual({ ok: false, why: "task not found" });
    expect(block(elsewhere.id)).toEqual({
      ok: false,
      why: "dependency belongs to another project",
    });
    expect(holdCount(db)).toBe(0);
  } finally {
    db.close();
  }
});

test("addBlockers refuses under, then cycle, then through, in the same words", () => {
  const db = store();
  try {
    const parent = phase(db, "one", "Parent");
    const child = ok(
      createTask(db, { project: "p", plan: "one", subject: "Child", parentId: parent.id }, who, 2),
    );
    const block = (id: string, ref: string) =>
      updateTask(db, id, { waitsFor: { add: [ref] } }, who, 3);
    const under = `${named(child)} cannot be blocked by ${named(parent)}: it sits under it, and a parent waits for its tasks`;
    expect(block(child.id, parent.id)).toEqual({ ok: false, why: under });
    // The parent now waits for the child by name, so the same block breaks a second rule: under is said.
    ok(block(parent.id, child.id));
    expect(block(child.id, parent.id)).toEqual({ ok: false, why: under });
    // The cycle: a task waiting for itself, or for one that waits for it.
    expect(block(parent.id, parent.id)).toEqual({
      ok: false,
      why: "blocked-by would make a cycle",
    });
    const x = ok(createTask(db, { project: "p", subject: "X" }, who, 4));
    ok(block(x.id, parent.id));
    expect(block(parent.id, x.id)).toEqual({ ok: false, why: "blocked-by would make a cycle" });
    // Through: Y waits for a parent that waits for the task under it, and not by name.
    const top = phase(db, "two", "Top");
    const inner = ok(
      createTask(db, { project: "p", plan: "two", subject: "Inner", parentId: top.id }, who, 6),
    );
    const y = ok(createTask(db, { project: "p", subject: "Y" }, who, 7));
    ok(block(y.id, top.id));
    expect(block(inner.id, y.id)).toEqual({
      ok: false,
      why: `${named(inner)} cannot be blocked by ${named(y)}: ${named(y)} already waits for it, through what it is blocked by and the tasks a parent waits for, so neither could ever be done`,
    });
  } finally {
    db.close();
  }
});

test("a call with two refs that refuses the second leaves the first undone", () => {
  const db = store();
  try {
    const a = ok(createTask(db, { project: "p", subject: "A" }, who, 1));
    const b = ok(createTask(db, { project: "p", subject: "B" }, who, 2));
    expect(updateTask(db, a.id, { waitsFor: { add: [b.id, a.id] } }, who, 3)).toEqual({
      ok: false,
      why: "blocked-by would make a cycle",
    });
    expect(holdCount(db)).toBe(0);
    expect(updateTask(db, a.id, { waitsFor: { add: [b.id] } }, who, 4).ok).toBe(true);
    expect(holdCount(db)).toBe(1);
  } finally {
    db.close();
  }
});
