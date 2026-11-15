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
): WorkTask {
  return ok(
    writeWork(
      db,
      () =>
        layPhase(db, { project: "p", plan, phase: id, subject, blockedBy }, { ...me, pid: null }, 1)
          .task,
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
  const g1 = phase(db, "plan-b", "G1", "Their guard");
  phase(db, "plan-b", "G2", "Their view");
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

test("a plan in flight is this process's own, and a queued plan's laid phases are never named ready", () => {
  const { paths, db } = setup();
  const a1 = phase(db, "plan-a", "A1", "First");
  const a2 = phase(db, "plan-a", "A2", "Second");
  const b1 = phase(db, "plan-b", "B1", "Queued first");
  phase(db, "plan-b", "B2", "Queued second");
  for (const [parent, plan] of [
    [a1, "plan-a"],
    [a2, "plan-a"],
    [b1, "plan-b"],
  ] as const)
    ok(createTask(db, { project: "p", subject: "Step", parentId: parent.id, plan }, me, 3));
  const planA = allTasks(db, "p").find((t) => t.kind === "plan" && t.plan === "plan-a");
  if (planA === undefined) throw new Error("no plan task");
  // Between waves: plan-a is in flight (its task runs) and no phase does, so the guard is silent.
  start(db, planA, me);
  expect(openPhasesOf(paths, "p", () => me)).toEqual({
    state: "ready",
    value: { inProgress: [], ready: [] },
  });
  // A wave: plan-a's first phase runs. Its next phase is ready; plan-b, laid and queued, is not.
  start(db, a1, me);
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
  const g1 = phase(db, "plan-a", "G1", "Guard");
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
