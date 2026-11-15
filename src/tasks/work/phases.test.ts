import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tempDir } from "../../testing/temp";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./db";
import { openPhasesOf } from "./phases";
import { allTasks } from "./queries";
import { createTask, layPhase, updateTask } from "./store";
import type { Result, Who, WorkTask } from "./types";

const me: Who = { sessionId: "main", pid: 41, procStart: "4100" };
const other: Who = { sessionId: "other", pid: 52, procStart: "5200" };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

function setup() {
  const paths = { stateDir: tempDir("phases") };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
}

function phase(
  db: WorkDb,
  plan: string,
  id: string,
  subject: string,
  blockedBy: string[] = [],
  by: Who = { ...me, pid: null },
): WorkTask {
  return ok(
    writeWork(
      db,
      () => layPhase(db, { project: "p", plan, phase: id, subject, blockedBy }, by, 1).task,
    ),
  );
}

function start(db: WorkDb, task: WorkTask, who: Who): void {
  ok(updateTask(db, task.id, { status: "in_progress" }, who, 2));
}

test("a plan this process holds a claim in: its phase in progress, and its next ready phase", () => {
  const { paths, db } = setup();
  const g1 = phase(db, "plan-a", "G1", "Guard");
  const g2 = phase(db, "plan-a", "G2", "Portal view");
  phase(db, "plan-a", "G3", "Docs", [g2.id]);
  ok(createTask(db, { project: "p", subject: "Step", parentId: g2.id, plan: "plan-a" }, me, 3));
  start(db, g1, me);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: {
      inProgress: [{ number: g1.number, subject: "Guard", plan: "plan-a", agent: null }],
      ready: [{ number: g2.number, subject: "Portal view", plan: "plan-a", agent: null }],
    },
  });
});

test("a pending phase with no live task is not ready: the store would refuse to start it", () => {
  const { paths, db } = setup();
  const g1 = phase(db, "plan-a", "G1", "Guard");
  phase(db, "plan-a", "G2", "Empty");
  const g3 = phase(db, "plan-a", "G3", "Only a dropped step");
  const dropped = ok(
    createTask(db, { project: "p", subject: "Gone", parentId: g3.id, plan: "plan-a" }, me, 3),
  );
  ok(updateTask(db, dropped.id, { status: "dropped" }, me, 4));
  start(db, g1, me);
  db.close();
  const read = openPhasesOf(paths, "p", () => me);
  expect(read).toEqual({
    state: "ready",
    value: {
      inProgress: [{ number: g1.number, subject: "Guard", plan: "plan-a", agent: null }],
      ready: [],
    },
  });
});

test("a claim on a task under a phase makes its plan this process's own", () => {
  const { paths, db } = setup();
  const g1 = phase(db, "plan-a", "G1", "Guard");
  start(db, g1, other);
  const step = ok(
    createTask(db, { project: "p", subject: "Step", parentId: g1.id, plan: "plan-a" }, me, 3),
  );
  start(db, step, me);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: {
      inProgress: [{ number: g1.number, subject: "Guard", plan: "plan-a", agent: null }],
      ready: [],
    },
  });
});

test("another session's plan is not this process's: nothing in progress for it", () => {
  const { paths, db } = setup();
  const g1 = phase(db, "plan-b", "G1", "Their guard", [], other);
  phase(db, "plan-b", "G2", "Their view", [], other);
  start(db, g1, other);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: { inProgress: [], ready: [] },
  });
});

test("only the plans of the phases in progress offer a ready phase; a blocked one is not ready", () => {
  const { paths, db } = setup();
  const a1 = phase(db, "plan-a", "A1", "First");
  phase(db, "plan-a", "A2", "Second", [a1.id]);
  start(db, a1, me);
  // A second plan this process holds a claim in, with no phase in progress: its ready phase is
  // not named for plan-a's.
  const b1 = phase(db, "plan-b", "B1", "Other plan");
  phase(db, "plan-b", "B2", "Other plan's next");
  const step = ok(
    createTask(db, { project: "p", subject: "Step", parentId: b1.id, plan: "plan-b" }, me, 3),
  );
  start(db, step, me);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: {
      inProgress: [{ number: a1.number, subject: "First", plan: "plan-a", agent: null }],
      ready: [],
    },
  });
});

test("a plan in flight is this process's own: its next phase is ready, a claimed queued plan's pending phases are not", () => {
  const { paths, db } = setup();
  const a1 = phase(db, "plan-a", "A1", "First");
  const a2 = phase(db, "plan-a", "A2", "Second");
  const b1 = phase(db, "plan-b", "B1", "Queued first");
  const b2 = phase(db, "plan-b", "B2", "Queued second");
  const stepOf = (parent: WorkTask, plan: string) =>
    ok(createTask(db, { project: "p", subject: "Step", parentId: parent.id, plan }, me, 3));
  stepOf(a1, "plan-a");
  stepOf(a2, "plan-a");
  stepOf(b1, "plan-b");
  const b2Step = stepOf(b2, "plan-b");
  const planA = allTasks(db, "p").find((t) => t.kind === "plan" && t.plan === "plan-a");
  if (planA === undefined) throw new Error("no plan task");
  // Between waves: plan-a is in flight (its task runs) and no phase does: both of its phases are
  // ready, and plan-b's (not in flight) are not.
  start(db, planA, me);
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: {
      inProgress: [],
      ready: [
        { number: a1.number, subject: "First", plan: "plan-a", agent: null },
        { number: a2.number, subject: "Second", plan: "plan-a", agent: null },
      ],
    },
  });
  // A wave: plan-a's first phase runs. Plan-b is laid and queued, but this process holds a claim
  // in it (a step started there), which makes the plan its own: without the busy filter its
  // pending phases would be named ready, though no phase of plan-b runs.
  start(db, a1, me);
  start(db, b2Step, me);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: {
      inProgress: [{ number: a1.number, subject: "First", plan: "plan-a", agent: null }],
      ready: [{ number: a2.number, subject: "Second", plan: "plan-a", agent: null }],
    },
  });
});

test("a caller with no process has no claims: nothing is its own", () => {
  const { paths, db } = setup();
  // Another session made the plan, and this process started its phase: the claim names a
  // process, and a caller with none cannot hold it.
  const g1 = phase(db, "plan-a", "G1", "Guard", [], other);
  start(db, g1, me);
  db.close();
  expect(
    openPhasesOf(paths, "p", () => ({ sessionId: "main", pid: null, procStart: null })),
  ).toEqual({
    state: "ready",
    value: { inProgress: [], ready: [] },
  });
});

test("no phase in progress: the caller is never looked up", () => {
  const { paths, db } = setup();
  const g1 = phase(db, "plan-a", "G1", "Guard");
  const step = ok(
    createTask(db, { project: "p", subject: "Step", parentId: g1.id, plan: "plan-a" }, me, 3),
  );
  start(db, step, me);
  db.close();
  let asked = 0;
  const caller = () => {
    asked += 1;
    return me;
  };
  expect(openPhasesOf(paths, "p", caller)).toEqual({
    state: "ready",
    value: { inProgress: [], ready: [] },
  });
  expect(asked).toBe(0);
  expect(openPhasesOf({ stateDir: tempDir("empty") }, "p", caller)).toEqual({ state: "none" });
  expect(asked).toBe(0);
  // With a phase in progress it is asked once.
  const writer = openWorkDb(workDbFile(paths), { mode: "write" });
  start(writer, g1, me);
  writer.close();
  expect(openPhasesOf(paths, "p", caller).state).toBe("ready");
  expect(asked).toBe(1);
});

test("off Linux (no start time) a reused pid is not the claimer: the session must match too", () => {
  const { paths, db } = setup();
  const claimer: Who = { sessionId: "main", pid: 41, procStart: null };
  const g1 = phase(db, "plan-a", "G1", "Guard");
  start(db, g1, claimer);
  db.close();
  expect(openPhasesOf(paths, "p", () => ({ ...claimer, sessionId: "later" }))).toEqual({
    state: "ready",
    value: { inProgress: [], ready: [] },
  });
  expect(openPhasesOf(paths, "p", () => ({ ...claimer, sessionId: null }))).toEqual({
    state: "ready",
    value: { inProgress: [], ready: [] },
  });
  expect(openPhasesOf(paths, "p", () => claimer)).toEqual({
    state: "ready",
    value: {
      inProgress: [{ number: g1.number, subject: "Guard", plan: "plan-a", agent: null }],
      ready: [],
    },
  });
});

test("no store is none, and a store that cannot be read says so", () => {
  expect(openPhasesOf({ stateDir: tempDir("empty") }, "p", () => me)).toEqual({ state: "none" });
  const paths = { stateDir: tempDir("broken") };
  const file = workDbFile(paths);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "not a database");
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "unreadable",
    why: "file is not a database",
  });
});

/** Plan `plan-a` with two ready phases (a step each) and its plan task started by `who`, if any. */
function readyPlan(db: WorkDb, who: Who | null) {
  // The plan is made by the session that starts it, or this one when it is parked.
  const maker: Who = who ?? { ...me, pid: null };
  const a1 = phase(db, "plan-a", "A1", "First", [], maker);
  const a2 = phase(db, "plan-a", "A2", "Second", [], maker);
  for (const parent of [a1, a2])
    ok(
      createTask(db, { project: "p", subject: "Step", parentId: parent.id, plan: "plan-a" }, me, 3),
    );
  const planA = allTasks(db, "p").find((t) => t.kind === "plan" && t.plan === "plan-a");
  if (planA === undefined) throw new Error("no plan task");
  if (who !== null) start(db, planA, who);
  return { a1, a2 };
}

test("the plan in flight with no phase running: every ready phase, in number order, and the caller is asked once", () => {
  const { paths, db } = setup();
  const { a1, a2 } = readyPlan(db, me);
  db.close();
  let asked = 0;
  const caller = () => {
    asked += 1;
    return me;
  };
  expect(openPhasesOf(paths, "p", caller)).toEqual({
    state: "ready",
    value: {
      inProgress: [],
      ready: [
        { number: a1.number, subject: "First", plan: "plan-a", agent: null },
        { number: a2.number, subject: "Second", plan: "plan-a", agent: null },
      ],
    },
  });
  expect(asked).toBe(1);
});

test("a parked plan (its task pending) offers no ready phase, and the caller is never asked", () => {
  const { paths, db } = setup();
  readyPlan(db, null);
  db.close();
  let asked = 0;
  expect(
    openPhasesOf(paths, "p", () => {
      asked += 1;
      return me;
    }),
  ).toEqual({ state: "ready", value: { inProgress: [], ready: [] } });
  expect(asked).toBe(0);
});

test("another session's plan in flight, numbered first, does not hide this process's own plan in flight", () => {
  const { paths, db } = setup();
  readyPlan(db, other);
  const b1 = phase(db, "plan-b", "B1", "Mine first");
  ok(createTask(db, { project: "p", subject: "Step", parentId: b1.id, plan: "plan-b" }, me, 3));
  const planB = allTasks(db, "p").find((t) => t.kind === "plan" && t.plan === "plan-b");
  if (planB === undefined) throw new Error("no plan task");
  start(db, planB, me);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: {
      inProgress: [],
      ready: [{ number: b1.number, subject: "Mine first", plan: "plan-b", agent: null }],
    },
  });
});

test("a step claimed in another session's plan does not make its next phase this process's to start", () => {
  const { paths, db } = setup();
  const g1 = phase(db, "plan-a", "G1", "Their running phase", [], other);
  const g2 = phase(db, "plan-a", "G2", "Their next phase", [], other);
  const stepOf = (parent: WorkTask) =>
    ok(
      createTask(
        db,
        { project: "p", subject: "Step", parentId: parent.id, plan: "plan-a" },
        other,
        3,
      ),
    );
  const taken = stepOf(g1);
  stepOf(g2); // their next phase is ready: it has a step
  const planA = allTasks(db, "p").find((t) => t.kind === "plan" && t.plan === "plan-a");
  if (planA === undefined) throw new Error("no plan task");
  start(db, planA, other);
  start(db, g1, other);
  // This process starts one step of their phase: the phase counts as in progress for it, but
  // the plan and its next phase stay the other session's.
  start(db, taken, me);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: {
      inProgress: [
        { number: g1.number, subject: "Their running phase", plan: "plan-a", agent: null },
      ],
      ready: [],
    },
  });
});

test("another session's plan in flight offers this process no ready phase", () => {
  const { paths, db } = setup();
  readyPlan(db, other);
  db.close();
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: { inProgress: [], ready: [] },
  });
});
