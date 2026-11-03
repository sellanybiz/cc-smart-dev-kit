/**
 * D76: three layers (phase › task › subtask), a blocking or non-blocking type on each, and the
 * tasks each is blocked by. Every rule here is the store's, so the tools, the command, the guards
 * and the portal all meet the same one.
 */
import { expect, test } from "bun:test";
import { tempDir } from "../../testing/temp";
import { createTaskOps } from "../ops";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./db";
import { historyText } from "./history";
import { allTasks, eventsOf, getTask, holdingUnder, layerOf, notesOf, taskById } from "./queries";
import { crewPhaseState, leadOwnState, readWorkStore, startView } from "./read";
import {
  createTask,
  ensurePhaseTask,
  ensurePlanTask,
  layPhase,
  systemClose,
  updateTask,
} from "./store";
import { projectTaskTree } from "./tree";
import type { Result, WorkTask } from "./types";

const who = { sessionId: "lead", crewId: null, pid: 1, procStart: "2" };
function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function setup() {
  const paths = { stateDir: tempDir() };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
}
function add(db: WorkDb, subject: string, more: Partial<Parameters<typeof createTask>[1]> = {}) {
  return ok(createTask(db, { project: "p", subject, ...more }, who, 1));
}
function byIdOf(db: WorkDb): Map<string, WorkTask> {
  return new Map(allTasks(db, "p").map((t) => [t.id, t]));
}

test("each task's layer comes from its parent: plan, phase, task, subtask", () => {
  const { db } = setup();
  const plan = ok(ensurePlanTask(db, { project: "p", plan: "plan", subject: "Plan" }, who, 1));
  const phase = ok(
    writeWork(db, () =>
      layPhase(db, { project: "p", plan: "plan", phase: "A", subject: "Phase A" }, who, 1),
    ),
  ).task;
  const top = add(db, "Top");
  const underPlan = add(db, "Under the plan", { parentId: plan.id });
  const inPhase = add(db, "In the phase", { parentId: phase.id });
  const sub = add(db, "Sub", { parentId: inPhase.id });
  const deeper = add(db, "Deeper");
  // An older kit nested deeper than three layers: it reads as a subtask.
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(sub.id, deeper.id);
  const byId = byIdOf(db);
  expect(
    [plan, phase, top, underPlan, inPhase, sub, deeper].map((t) =>
      layerOf(taskById(db, t.id), byId),
    ),
  ).toEqual(["plan", "phase", "task", "task", "task", "subtask", "subtask"]);
  db.close();
});

test("a subtask holds no subtasks, a task with subtasks never becomes one, plans and phases stay put", () => {
  const { db } = setup();
  const plan = ok(ensurePlanTask(db, { project: "p", plan: "plan", subject: "Plan" }, who, 1));
  const phase = ok(
    writeWork(db, () =>
      layPhase(db, { project: "p", plan: "plan", phase: "A", subject: "Phase A" }, who, 1),
    ),
  ).task;
  const task = add(db, "Task");
  const sub = add(db, "Sub", { parentId: task.id });
  const refusal =
    '#4 "Sub" is a subtask, and a subtask holds no subtasks (the layers are phase › task › subtask): put it under #3 "Task", or make it a task of its own';
  expect(createTask(db, { project: "p", subject: "Too deep", parentId: sub.id }, who, 2)).toEqual({
    ok: false,
    why: refusal,
  });
  const loose = add(db, "Loose");
  expect(updateTask(db, loose.id, { parentId: sub.id }, who, 2)).toEqual({
    ok: false,
    why: refusal,
  });
  // A task with no subtasks may become one; one with subtasks may not.
  ok(updateTask(db, loose.id, { parentId: task.id }, who, 2));
  const other = add(db, "Other");
  expect(updateTask(db, task.id, { parentId: other.id }, who, 3)).toEqual({
    ok: false,
    why: '#3 "Task" has subtasks, so it stays a task: under #6 "Other" they would be a fourth layer. Move them first, or put it at the top or under a phase',
  });
  // Under a phase or a plan it stays a task, with its subtasks under it.
  ok(updateTask(db, task.id, { parentId: phase.id }, who, 3));
  ok(updateTask(db, task.id, { parentId: plan.id }, who, 3));
  expect(updateTask(db, phase.id, { parentId: task.id }, who, 4)).toEqual({
    ok: false,
    why: '#2 "Phase A" is a phase: a phase stays under its plan',
  });
  expect(updateTask(db, plan.id, { parentId: task.id }, who, 4)).toEqual({
    ok: false,
    why: '#1 "Plan" is a plan: a plan stays at the top',
  });
  // A phase's other fields still change.
  ok(updateTask(db, phase.id, { subject: "Phase A, renamed" }, who, 4));
  db.close();
});

test("a task an older kit nested past three layers still changes and closes where it sits", () => {
  const { db } = setup();
  const top = add(db, "Top");
  const middle = add(db, "Middle", { parentId: top.id });
  const deep = add(db, "Deep");
  const deeper = add(db, "Deeper");
  // 1.10.x let a chain go four deep: Top › Middle › Deep › Deeper.
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(middle.id, deep.id);
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(deep.id, deeper.id);
  // Each keeps its place: the layer rule is for a move, never for the task left where it is.
  ok(updateTask(db, deeper.id, { subject: "Deeper, renamed", status: "in_progress" }, who, 2));
  ok(updateTask(db, deeper.id, { status: "done" }, who, 3));
  ok(updateTask(db, deep.id, { status: "done" }, who, 4));
  ok(updateTask(db, middle.id, { type: "non-blocking" }, who, 5));
  // A move is held to the layers: under a subtask is refused.
  expect(updateTask(db, add(db, "Loose").id, { parentId: deep.id }, who, 6)).toEqual({
    ok: false,
    why: '#3 "Deep" is a subtask, and a subtask holds no subtasks (the layers are phase › task › subtask): put it under #2 "Middle", or make it a task of its own',
  });
  db.close();
});

test("only blocking work holds its parent: a non-blocking task and what is under it do not", () => {
  const { db } = setup();
  const parent = add(db, "Phase", { kind: "phase", plan: "plan", phase: "A" });
  const blocking = add(db, "Blocking", { parentId: parent.id });
  const noted = add(db, "Noted", { parentId: parent.id, type: "non-blocking" });
  // A blocking subtask under the non-blocking task holds only that task, not the phase.
  const step = add(db, "Step", { parentId: noted.id });
  expect(updateTask(db, parent.id, { status: "done" }, who, 2)).toEqual({
    ok: false,
    why: "open subtasks: #2 Blocking",
  });
  ok(updateTask(db, blocking.id, { status: "done" }, who, 3));
  ok(updateTask(db, parent.id, { status: "done" }, who, 4));
  // The non-blocking task stays open under its done parent.
  expect(getTask(db, "p", noted.id)?.status).toBe("pending");
  expect(updateTask(db, noted.id, { status: "done" }, who, 5)).toEqual({
    ok: false,
    why: "open subtasks: #4 Step",
  });
  // A task that becomes non-blocking stops holding; back to blocking, it holds again.
  const second = add(db, "Second");
  const late = add(db, "Late", { parentId: second.id });
  ok(updateTask(db, late.id, { type: "non-blocking" }, who, 6));
  expect(holdingUnder(allTasks(db, "p"), second.id)).toEqual([]);
  ok(updateTask(db, late.id, { type: "blocking" }, who, 7));
  expect(holdingUnder(allTasks(db, "p"), second.id).map((t) => t.number)).toEqual([6]);
  expect(step.number).toBe(4);
  db.close();
});

test("an open task under a closed blocking one still holds, in progress first", () => {
  const { db } = setup();
  const top = add(db, "Top", { kind: "phase", plan: "plan", phase: "A" });
  const closed = add(db, "Closed", { parentId: top.id });
  const a = add(db, "A", { parentId: top.id });
  const b = add(db, "B", { parentId: top.id, status: "in_progress" });
  const left = add(db, "Left");
  ok(updateTask(db, closed.id, { status: "done" }, who, 2));
  // An older kit or a system close can leave one open under a closed task.
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(closed.id, left.id);
  expect(holdingUnder(allTasks(db, "p"), top.id).map((t) => t.subject)).toEqual(["B", "A", "Left"]);
  expect([a.number, b.number]).toEqual([3, 4]);
  db.close();
});

test("a task blocked by an open task neither starts nor is done; a closed blocker lets it go", () => {
  const { db } = setup();
  const first = add(db, "First");
  const second = add(db, "Second", { blockedBy: [first.id] });
  const blocked =
    '#2 "Second" is blocked by #1 "First" (pending): finish or drop it first, or remove the block';
  expect(updateTask(db, second.id, { status: "in_progress" }, who, 2)).toEqual({
    ok: false,
    why: blocked,
  });
  expect(updateTask(db, second.id, { status: "done" }, who, 2)).toEqual({
    ok: false,
    why: blocked,
  });
  // A blocked task can still be dropped, or changed in other ways.
  ok(updateTask(db, second.id, { subject: "Second step" }, who, 2));
  ok(updateTask(db, first.id, { status: "in_progress" }, who, 3));
  expect(updateTask(db, second.id, { status: "in_progress" }, who, 3)).toEqual({
    ok: false,
    why: '#2 "Second step" is blocked by #1 "First" (in progress): finish or drop it first, or remove the block',
  });
  ok(updateTask(db, first.id, { status: "done" }, who, 4));
  ok(updateTask(db, second.id, { status: "in_progress" }, who, 5));
  // Two blockers are named in number order; one call can lift a block and start.
  const a = add(db, "A");
  const b = add(db, "B");
  const c = add(db, "C", { blockedBy: [b.id, a.id] });
  expect(updateTask(db, c.id, { status: "in_progress" }, who, 6)).toEqual({
    ok: false,
    why: '#5 "C" is blocked by #3 "A" (pending), #4 "B" (pending): finish or drop them first, or remove the block',
  });
  ok(updateTask(db, a.id, { status: "dropped" }, who, 7));
  ok(updateTask(db, c.id, { status: "in_progress", waitsFor: { remove: [b.id] } }, who, 8));
  // A new task that starts blocked is refused, and leaves nothing behind.
  expect(
    createTask(
      db,
      { project: "p", subject: "Eager", status: "in_progress", blockedBy: [b.id] },
      who,
      9,
    ),
  ).toEqual({
    ok: false,
    why: '#6 "Eager" is blocked by #4 "B" (pending): finish or drop it first, or remove the block',
  });
  expect(allTasks(db, "p").map((t) => t.subject)).toEqual(["First", "Second step", "A", "B", "C"]);
  // A cycle is refused; so is a blocker above the task.
  expect(updateTask(db, b.id, { waitsFor: { add: [c.id] } }, who, 10).ok).toBe(true);
  expect(updateTask(db, c.id, { waitsFor: { add: [b.id] } }, who, 10)).toEqual({
    ok: false,
    why: "blocked-by would make a cycle",
  });
  db.close();
});

test("a merge keeps open non-blocking work; a removal drops the crew's own and hands back the lead's", () => {
  const { db } = setup();
  const merged = add(db, "Merged", { kind: "phase", plan: "plan", phase: "A" });
  add(db, "Must", { parentId: merged.id });
  add(db, "Later", { parentId: merged.id, type: "non-blocking" });
  ok(systemClose(db, merged.id, "done", "merged", who, 2));
  expect(allTasks(db, "p").map((t) => [t.subject, t.status])).toEqual([
    ["Merged", "done"],
    ["Must", "dropped"],
    ["Later", "pending"],
  ]);
  const removed = add(db, "Removed", { kind: "phase", plan: "plan", phase: "B", crewId: "crew-b" });
  // Laid out by the lead (no crew id): one the crew session had started, one it never touched.
  const started = add(db, "Laid, started", { parentId: removed.id, status: "in_progress" });
  const untouched = add(db, "Laid, untouched", { parentId: removed.id, type: "non-blocking" });
  // The crew session's own work, a non-blocking one too: a removal drops it all.
  add(db, "Its own", { parentId: removed.id, crewId: "crew-b" });
  add(db, "Its own aside", { parentId: removed.id, crewId: "crew-b", type: "non-blocking" });
  ok(systemClose(db, removed.id, "dropped", "removed", who, 3));
  expect(
    allTasks(db, "p")
      .slice(3)
      .map((t) => [t.subject, t.status, t.claim === null]),
  ).toEqual([
    ["Removed", "dropped", true],
    ["Laid, started", "pending", true],
    ["Laid, untouched", "pending", true],
    ["Its own", "dropped", true],
    ["Its own aside", "dropped", true],
  ]);
  expect(notesOf(db, started.id).map((n) => n.text)).toEqual([
    "Back to pending: removed. The phase's next crew session takes it.",
  ]);
  expect(notesOf(db, untouched.id)).toEqual([]);
  db.close();
});

test("a phase started again takes the steps left open, and the old session's closed ones stop counting", () => {
  const { db, paths } = setup();
  const start = (crewId: string, now: number) =>
    ok(
      ensurePhaseTask(
        db,
        {
          project: "p",
          plan: "plan",
          phase: "A",
          subject: "A",
          description: "",
          crewId,
          waitsForPhases: [],
        },
        who,
        now,
      ),
    );
  const phase = ok(
    writeWork(db, () =>
      layPhase(db, { project: "p", plan: "plan", phase: "A", subject: "Phase A" }, who, 1),
    ),
  ).task;
  const finished = add(db, "Finished", { parentId: phase.id });
  const left = add(db, "Left", { parentId: phase.id });
  start("crew-1", 2);
  ok(updateTask(db, finished.id, { status: "done" }, who, 3));
  ok(systemClose(db, phase.id, "dropped", "removed", who, 4));
  start("crew-2", 5);
  db.close();
  // "Left" is crew-2's work; "Finished" is crew-1's record now (its crew id), so it does not count.
  const state = crewPhaseState(paths, "p", "crew-2");
  expect(
    state.state === "ready"
      ? [state.value.total, state.value.openSubtasks.map((t) => t.subject)]
      : null,
  ).toEqual([1, ["Left"]]);
  const db2 = openWorkDb(workDbFile(paths), { mode: "write" });
  expect([taskById(db2, finished.id).crewId, taskById(db2, left.id).crewId]).toEqual([
    "crew-1",
    null,
  ]);
  db2.close();
});

test("a phase a lead lays out is the one crew start takes over, its tasks with it", () => {
  const { db, paths } = setup();
  const laid = ok(
    writeWork(db, () =>
      layPhase(
        db,
        { project: "p", plan: "plan", phase: "A", subject: "Phase A", description: "the brief" },
        who,
        1,
      ),
    ),
  );
  expect(laid.made).toBe(true);
  const again = ok(
    writeWork(db, () =>
      layPhase(db, { project: "p", plan: "plan", phase: "A", subject: "Other name" }, who, 2),
    ),
  );
  expect([again.made, again.task.id, again.task.subject]).toEqual([false, laid.task.id, "Phase A"]);
  const step = add(db, "Step", { parentId: laid.task.id, plan: "plan" });
  add(db, "Nice to have", { parentId: laid.task.id, plan: "plan", type: "non-blocking" });
  const took = ok(
    ensurePhaseTask(
      db,
      {
        project: "p",
        plan: "plan",
        phase: "A",
        subject: "A",
        description: "",
        crewId: "crew-a",
        waitsForPhases: [],
      },
      who,
      3,
    ),
  );
  expect([took.id, took.crewId]).toEqual([laid.task.id, "crew-a"]);
  expect(
    allTasks(db, "p")
      .filter((t) => t.kind !== "task")
      .map((t) => t.kind),
  ).toEqual(["plan", "phase"]);
  db.close();
  // The crew session's hand-back waits for the blocking step only, and its card lists the other
  // one aside. The lead laid both out, so they are its own for the reminder, and hold no stop.
  const crew = crewPhaseState(paths, "p", "crew-a");
  expect(
    crew.state === "ready"
      ? [crew.value.openSubtasks.map((t) => t.id), crew.value.aside.map((t) => t.subject)]
      : null,
  ).toEqual([[step.id], ["Nice to have"]]);
  const lead = leadOwnState(paths, "p", "plan", ["lead"]);
  expect(lead).toEqual({ state: "ready", value: { inProgress: [], total: 2 } });
});

test("a lead's stop is held by its own blocking work in progress, not non-blocking work", () => {
  const { db, paths } = setup();
  add(db, "Mine", { plan: "plan", status: "in_progress" });
  add(db, "Aside", { plan: "plan", status: "in_progress", type: "non-blocking" });
  // Inside an open phase a step is its crew session's to work; under a closed one it is anyone's.
  const running = add(db, "Running", { kind: "phase", plan: "plan", phase: "A" });
  add(db, "Its step", { parentId: running.id, plan: "plan", status: "in_progress" });
  const closed = add(db, "Closed", { kind: "phase", plan: "plan", phase: "B" });
  ok(updateTask(db, closed.id, { status: "dropped" }, who, 2));
  add(db, "Picked up", { parentId: closed.id, plan: "plan", status: "in_progress" });
  db.close();
  const lead = leadOwnState(paths, "p", "plan", ["lead"]);
  expect(lead.state === "ready" ? lead.value.inProgress.map((t) => t.subject) : null).toEqual([
    "Mine",
    "Picked up",
  ]);
  // Every task its sessions made in the plan is its own for the reminder; a phase is not a task.
  expect(lead.state === "ready" ? lead.value.total : null).toBe(4);
});

test("a block that would wait on itself through a parent is refused, at any depth, in either order", () => {
  const { db } = setup();
  const parent = add(db, "Parent");
  const child = add(db, "Child", { parentId: parent.id });
  const x = add(db, "X");
  // Child waits for X; X blocked by Parent would wait for Child, as Parent waits for its subtask.
  ok(updateTask(db, child.id, { waitsFor: { add: [x.id] } }, who, 2));
  expect(updateTask(db, x.id, { waitsFor: { add: [parent.id] } }, who, 3)).toEqual({
    ok: false,
    why: '#3 "X" cannot be blocked by #1 "Parent": #1 "Parent" already waits for it, through what it is blocked by and the subtasks a parent waits for, so neither could ever be done',
  });
  // The other order: X waits for Parent first, then Child blocked by X.
  ok(updateTask(db, child.id, { waitsFor: { remove: [x.id] } }, who, 4));
  ok(updateTask(db, x.id, { waitsFor: { add: [parent.id] } }, who, 5));
  expect(updateTask(db, child.id, { waitsFor: { add: [x.id] } }, who, 6)).toEqual({
    ok: false,
    why: '#2 "Child" cannot be blocked by #3 "X": #3 "X" already waits for it, through what it is blocked by and the subtasks a parent waits for, so neither could ever be done',
  });
  // A non-blocking child holds nothing, so the same chain waits on nothing: it is let through.
  ok(updateTask(db, child.id, { type: "non-blocking" }, who, 7));
  ok(updateTask(db, child.id, { waitsFor: { add: [x.id] } }, who, 8));
  db.close();
});

test("a done task's other fields still change while a task under it is open; done again is judged", () => {
  const { db } = setup();
  const done = add(db, "Done");
  ok(updateTask(db, done.id, { status: "done" }, who, 2));
  // A step added after it closed: open and blocking, under a done task.
  add(db, "Late", { parentId: done.id });
  ok(updateTask(db, done.id, { subject: "Done, renamed", type: "non-blocking" }, who, 3));
  ok(updateTask(db, done.id, { status: "in_progress" }, who, 4));
  expect(updateTask(db, done.id, { status: "done" }, who, 5)).toEqual({
    ok: false,
    why: "open subtasks: #2 Late",
  });
  db.close();
});

test("a schema 1 store reads as all blocking, takes the column on its first write, and old code still writes", () => {
  const { db, paths } = setup();
  add(db, "Before");
  // The store as 1.10.x left it: no type column, schema 1.
  db.sqlite.run("ALTER TABLE tasks DROP COLUMN blocking");
  db.sqlite.run("PRAGMA user_version = 1");
  db.close();
  expect(
    readWorkStore(paths, (hook) => allTasks(hook, "p").map((t) => [t.subject, t.type])),
  ).toEqual({ state: "ready", value: [["Before", "blocking"]] });
  const moved = openWorkDb(workDbFile(paths), { mode: "write" });
  expect(moved.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
  // Code from an older version folder inserts without the column: the task is blocking.
  moved.sqlite
    .query(
      "INSERT INTO tasks(id,project,number,kind,subject,status,created_at,updated_at) VALUES ('wold','p',2,'task','Old code','pending',1,1)",
    )
    .run();
  expect(allTasks(moved, "p").map((t) => [t.subject, t.type])).toEqual([
    ["Before", "blocking"],
    ["Old code", "blocking"],
  ]);
  moved.close();
});

test("the history says a type only when it is not the default, and every change of it", () => {
  const { db } = setup();
  const plain = add(db, "Plain");
  const noted = add(db, "Noted", { type: "non-blocking" });
  expect(eventsOf(db, plain)[0]?.changes).toEqual({
    subject: [null, "Plain"],
    status: [null, "pending"],
    kind: [null, "task"],
  });
  expect(eventsOf(db, noted)[0]?.changes.type).toEqual([null, "non-blocking"]);
  ok(updateTask(db, plain.id, { type: "non-blocking" }, who, 2));
  ok(updateTask(db, plain.id, { waitsFor: { add: [noted.id] } }, who, 3));
  const lines = historyText(eventsOf(db, plain), { full: false }).split("\n");
  // Each line without its time: the created line names no type, since blocking is the default.
  expect(lines.slice(1).map((line) => line.replace(/^\S+ /, ""))).toEqual([
    'by session lead, process 1 · created: kind task; subject "Plain"; status pending',
    "by session lead, process 1 · changed: type blocking → non-blocking",
    "by session lead, process 1 · changed: blocked by none → #2",
  ]);
  db.close();
});

test("the portal's tree says each task's layer, type and blockers", () => {
  const { db, paths } = setup();
  const phase = add(db, "Phase", { kind: "phase", plan: "plan", phase: "A" });
  const task = add(db, "Task", { parentId: phase.id });
  const first = add(db, "First", { parentId: task.id });
  add(db, "Second", { parentId: task.id, type: "non-blocking", blockedBy: [first.id] });
  // A closed task waits for nothing: its blocker stays listed, but it is not blocked.
  const given = add(db, "Given up", { parentId: task.id, blockedBy: [first.id] });
  ok(updateTask(db, given.id, { status: "dropped" }, who, 5));
  db.close();
  const tree = projectTaskTree(paths, "p", { now: 10, recentMs: 10 });
  if (tree.state !== "ready") throw new Error(tree.state);
  const shape = (node: (typeof tree.value.roots)[number]): unknown => ({
    ref: node.ref,
    layer: node.layer,
    type: node.type,
    blockedBy: node.blockedBy,
    blocked: node.blocked,
    children: node.children.map(shape),
  });
  expect(tree.value.roots.map(shape)).toEqual([
    {
      ref: "#1",
      layer: "phase",
      type: "blocking",
      blockedBy: [],
      blocked: false,
      children: [
        {
          ref: "#2",
          layer: "task",
          type: "blocking",
          blockedBy: [],
          blocked: false,
          children: [
            {
              ref: "#3",
              layer: "subtask",
              type: "blocking",
              blockedBy: [],
              blocked: false,
              children: [],
            },
            {
              ref: "#4",
              layer: "subtask",
              type: "non-blocking",
              blockedBy: [{ ref: "#3", subject: "First", status: "pending" }],
              blocked: true,
              children: [],
            },
            {
              ref: "#5",
              layer: "subtask",
              type: "blocking",
              blockedBy: [{ ref: "#3", subject: "First", status: "pending" }],
              blocked: false,
              children: [],
            },
          ],
        },
      ],
    },
  ]);
});

test("a session start marks non-blocking and blocked work", () => {
  const { db, paths } = setup();
  const first = add(db, "First");
  add(db, "Second", { blockedBy: [first.id], type: "non-blocking" });
  db.close();
  const view = startView(paths, "p", who, { limit: 8 });
  expect(
    view.state === "ready" ? view.value.tasks.map((t) => [t.subject, t.type, t.blocked]) : null,
  ).toEqual([
    ["First", "blocking", false],
    ["Second", "non-blocking", true],
  ]);
});

test("a session start leaves out an open phase's work, and shows what a merge left open", () => {
  const { db, paths } = setup();
  const running = add(db, "Running", { kind: "phase", plan: "plan", phase: "A" });
  add(db, "Its work", { parentId: running.id });
  const merged = add(db, "Merged", { kind: "phase", plan: "plan", phase: "B" });
  add(db, "Must", { parentId: merged.id });
  const later = add(db, "Later", { parentId: merged.id, type: "non-blocking" });
  add(db, "Its step", { parentId: later.id, type: "non-blocking" });
  ok(systemClose(db, merged.id, "done", "merged", who, 2));
  db.close();
  // The running phase is its crew session's; the merged phase's leftover work is anyone's now.
  const view = startView(paths, "p", who, { limit: 8 });
  expect(view.state === "ready" ? view.value.tasks.map((t) => t.subject).sort() : null).toEqual([
    "Its step",
    "Later",
  ]);
});

test("the tools lay out a plan and its phases, and say type and blockers", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  let crewId: string | null = null;
  const ops = createTaskOps({
    stateDir,
    cwd: () => cwd,
    caller: () => ({ sessionId: "lead", crewId, pid: 1, procStart: "2", cwd }),
  });
  try {
    expect(ops.call("create", { subject: "Build A", phase: "A" })).toEqual({
      ok: false,
      why: "A phase belongs to a plan: give plan (its slug, as `crew lead --plan` names it)",
    });
    expect(ops.call("create", { subject: "The plan", plan: "my-plan" })).toEqual({
      ok: true,
      text: '#1 "The plan" · plan my-plan',
    });
    expect(ops.call("create", { subject: "Build A", phase: "A", plan: "my-plan" })).toEqual({
      ok: true,
      text: '#2 "Build A" · phase A of plan my-plan',
    });
    expect(ops.call("create", { subject: "Build A again", phase: "A", plan: "my-plan" })).toEqual({
      ok: true,
      text: '#2 "Build A" · phase A of plan my-plan · it was there already',
    });
    // A call that finds what is there says so, and names what it did not use.
    expect(
      ops.call("create", {
        subject: "Build A",
        phase: "A",
        plan: "my-plan",
        description: "new brief",
        type: "non-blocking",
      }),
    ).toEqual({
      ok: true,
      text: '#2 "Build A" · phase A of plan my-plan · it was there already: its description, type stay as they were (task_update changes them)',
    });
    expect(ops.call("create", { subject: "Renamed", plan: "my-plan" })).toEqual({
      ok: true,
      text: '#1 "The plan" · plan my-plan · it was there already',
    });
    // The id `crew start` takes a phase over by: one it would refuse is refused here too.
    expect(ops.call("create", { subject: "Build C", phase: "Phase 1", plan: "my-plan" })).toEqual({
      ok: false,
      why: 'The phase "Phase 1" is not one: a phase is 1-8 characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"',
    });
    expect(
      ops.call("create", { subject: "Build B", phase: "B", plan: "my-plan", parent: "#1" }),
    ).toEqual({
      ok: false,
      why: "A plan stays at the top and a phase under its plan: leave out parent",
    });
    // What a plan or a phase cannot hold is refused, never dropped without a word.
    expect(
      ops.call("create", {
        subject: "Build B",
        phase: "B",
        plan: "my-plan",
        status: "in_progress",
      }),
    ).toEqual({ ok: false, why: "A plan or a phase starts pending: leave out status" });
    for (const extra of [{ blocked_by: ["#2"] }, { type: "non-blocking" }, { description: "x" }])
      expect(ops.call("create", { subject: "Other plan", plan: "other", ...extra })).toEqual({
        ok: false,
        why: "A plan's own task takes a subject only: give phase to lay out a phase, with its description, type and blockers",
      });
    expect(ops.call("create", { subject: "Step", parent: "#2" })).toEqual({
      ok: true,
      text: '#3 "Step" under #2',
    });
    expect(
      ops.call("create", {
        subject: "Polish",
        parent: "#2",
        type: "non-blocking",
        blocked_by: ["#3"],
      }),
    ).toEqual({ ok: true, text: '#4 "Polish" under #2 · non-blocking · blocked by #3' });
    expect(ops.call("list", { scope: "all" })).toMatchObject({
      ok: true,
      text: [
        "#1 [pending · plan] The plan · 0/3",
        "  #2 [pending · phase A] Build A · 0/2",
        "    #3 [pending] Step",
        "    #4 [pending · non-blocking · blocked by #3] Polish",
      ].join("\n"),
    });
    const got = ops.call("get", { task: "#4" });
    expect(got.ok ? got.text.split("\n").slice(0, 2) : got).toEqual([
      // Under a phase it is a task: phase › task › subtask.
      '#4 "Polish" [task · pending · non-blocking · blocked by #3]',
      'Blocked by: #3 "Step" (pending)',
    ]);
    expect(ops.call("update", { task: "#4", type: "blocking", blocked_by_remove: ["#3"] })).toEqual(
      {
        ok: true,
        text: '#4 "Polish" · pending',
      },
    );
    crewId = "crew-a";
    expect(ops.call("create", { subject: "Build C", phase: "C", plan: "my-plan" })).toEqual({
      ok: false,
      why: "A crew session works inside its own phase: its lead lays out the plan's phases",
    });
  } finally {
    ops.close();
  }
});
