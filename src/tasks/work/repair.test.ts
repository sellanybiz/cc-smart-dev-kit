import { Database } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { hookEnv } from "../../testing/hooks";
import { tempDir } from "../../testing/temp";
import { taskContext } from "../context";
import { createTaskOps } from "../ops";
import { LEGACY_LIFT_REASON, openWorkDb, type WorkDb, workDbFile, writeWork } from "./db";
import { openPhasesOf } from "./phases";
import * as queries from "./queries";
import { allTasks, eventsOf, taskById } from "./queries";
import { planProgress } from "./read";
import { createTask, ensurePlanTask, layPhase, takeTasks, updateTask } from "./store";
import type { Result, WorkTask } from "./types";

const who = { sessionId: "old", pid: 123, procStart: "1" };
const next = { sessionId: "next", pid: 456, procStart: "2" };
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.why);
  return r.value;
}
function fixture() {
  const paths = { stateDir: tempDir() };
  const file = workDbFile(paths);
  return { paths, file, db: openWorkDb(file, { mode: "write" }) };
}
/** The store as schema 3 left it, so the next write open runs migration step 3 (the lift). */
function asSchema3(db: WorkDb): void {
  // No creator columns, no notes index (schema 5 adds them).
  db.sqlite.run("DROP INDEX task_note_task");
  // Schema 6 added the file list and the lead columns: the older store has neither.
  db.sqlite.run("DROP TABLE task_files");
  for (const column of ["lead_session", "lead_pid", "lead_start", "lead_child", "lead_handout"])
    db.sqlite.run(`ALTER TABLE tasks DROP COLUMN ${column}`);
  for (const column of ["created_pid", "created_start"])
    db.sqlite.run(`ALTER TABLE tasks DROP COLUMN ${column}`);
  db.sqlite.run("PRAGMA user_version=3");
}
test("four legacy task levels lift to the phase, closed children add no blocker, and each move has history", () => {
  const { file, db } = fixture();
  const phase = ok(
    writeWork(db, () =>
      layPhase(db, { project: "p", plan: "one", phase: "A", subject: "Phase" }, who, 1),
    ),
  ).task;
  const tasks = ["A", "B", "C", "D"].map((subject) =>
    ok(createTask(db, { project: "p", plan: "one", subject, parentId: phase.id }, who, 2)),
  );
  const [a, b, c, d] = tasks;
  if (!a || !b || !c || !d) throw new Error("fixture");
  ok(updateTask(db, b.id, { status: "done" }, who, 3));
  for (const [parent, child] of [
    [a, b],
    [b, c],
    [c, d],
  ] as const)
    db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(parent.id, child.id);
  asSchema3(db);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(
      allTasks(repaired, "p")
        .filter((t) => t.kind === "task")
        .map((t) => t.parentId),
    ).toEqual([phase.id, phase.id, phase.id, phase.id]);
    expect(
      taskById(repaired, a.id)
        .waitsFor.map((id) => taskById(repaired, id).number)
        .sort(),
    ).toEqual([5, 6]);
    expect(
      taskById(repaired, b.id)
        .waitsFor.map((id) => taskById(repaired, id).number)
        .sort(),
    ).toEqual([5, 6]);
    expect(taskById(repaired, c.id).waitsFor).toEqual([d.id]);
    expect(
      tasks.map((t) =>
        eventsOf(repaired, t)
          .filter((e) => e.reason === LEGACY_LIFT_REASON)
          .map((e) => e.changes.parent),
      ),
    ).toEqual([
      [],
      [[`#${a.number}`, `#${phase.number}`]],
      [[`#${b.number}`, `#${phase.number}`]],
      [[`#${c.number}`, `#${phase.number}`]],
    ]);
  } finally {
    repaired.close();
  }
});
test("legacy cycle lifts its lowest numbered member deterministically and records the break", () => {
  const { file, db } = fixture();
  const a = ok(createTask(db, { project: "p", subject: "A" }, who, 1));
  const b = ok(createTask(db, { project: "p", subject: "B" }, who, 2));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(b.id, a.id);
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(a.id, b.id);
  db.close();
  const fixed = openWorkDb(file, { mode: "write" });
  try {
    expect(allTasks(fixed, "p").map((t) => t.parentId)).toEqual([null, null]);
    expect(eventsOf(fixed, a).at(-1)?.changes.parent).toEqual([`#${b.number}`, null]);
    expect(taskById(fixed, b.id).waitsFor).toEqual([]);
  } finally {
    fixed.close();
  }
});
test("failed snapshot leaves a read-only store with a fix and does not lift anything", () => {
  const { file, db } = fixture();
  const a = ok(createTask(db, { project: "p", subject: "A" }, who, 1));
  const b = ok(createTask(db, { project: "p", subject: "B" }, who, 2));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(a.id, b.id);
  db.close();
  mkdirSync(`${file}.v4.bak.tmp`);
  const refused = openWorkDb(file, { mode: "write" });
  try {
    expect(refused.writable).toBe(false);
    expect(taskById(refused, b.id).parentId).toBe(a.id);
    const result = createTask(refused, { project: "p", subject: "Cannot write" }, who, 3);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("write passed");
    expect(result.why).toContain("Fix: free disk space and check folder rights");
    expect(existsSync(`${file}.v4.bak`)).toBe(false);
  } finally {
    refused.close();
  }
});
test("snapshot includes WAL frames while a second connection prevents checkpoint", () => {
  const { paths, file, db } = fixture();
  db.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
  const observer = new Database(file);
  observer.run("BEGIN");
  observer.query("SELECT COUNT(*) FROM tasks").get();
  const a = ok(createTask(db, { project: "p", subject: "A" }, who, 1));
  const b = ok(createTask(db, { project: "p", subject: "B" }, who, 2));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(a.id, b.id);
  db.close();
  const copied = workDbFile({ stateDir: tempDir() });
  mkdirSync(copied.slice(0, copied.lastIndexOf("/")), { recursive: true });
  copyFileSync(file, copied);
  const plain = new Database(copied, { readonly: true });
  try {
    expect(plain.query("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  } finally {
    plain.close();
  }
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    const snapshot = new Database(`${file}.v4.bak`, { readonly: true });
    try {
      expect(snapshot.query("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 2 });
      expect(
        snapshot
          .query<{ parent_id: string }, [string]>("SELECT parent_id FROM tasks WHERE id=?")
          .get(b.id)?.parent_id,
      ).toBe(a.id);
    } finally {
      snapshot.close();
    }
    expect(existsSync(`${file}.v4.bak.tmp`)).toBe(false);
  } finally {
    repaired.close();
    observer.run("ROLLBACK");
    observer.close();
  }
  expect(paths.stateDir).toBeTruthy();
});
test("take only moves existing claims, ignores closed and imported source owners, and keeps active readers", () => {
  const { paths, db } = fixture();
  try {
    const plan = ok(
      ensurePlanTask(
        db,
        { project: "p", plan: "one", subject: "Plan" },
        { sessionId: null, pid: null, procStart: null },
        1,
      ),
    );
    const phase = ok(
      writeWork(db, () =>
        layPhase(db, { project: "p", plan: "one", phase: "A", subject: "Phase" }, who, 2),
      ),
    ).task;
    ok(updateTask(db, phase.id, { status: "in_progress" }, who, 3));
    const closed = ok(
      createTask(
        db,
        { project: "p", plan: "one", subject: "Closed" },
        { ...who, sessionId: "other" },
        4,
      ),
    );
    ok(updateTask(db, closed.id, { status: "done" }, who, 5));
    ok(takeTasks(db, "p", plan.id, next, 6, { from: "old", isLive: () => false }));
    expect(taskById(db, plan.id).claim).toBeNull();
    expect(taskById(db, closed.id).claim).toBeNull();
    expect(eventsOf(db, plan).at(-1)?.changes.claim).toBeUndefined();
    expect(taskById(db, phase.id).claim?.sessionId).toBe("next");
    const progress = planProgress(paths, "p", next);
    expect(progress.state === "ready" && progress.value?.task.id).toBe(phase.id);
    const phases = openPhasesOf(paths, "p", () => next);
    expect(phases.state === "ready" && phases.value.inProgress.map((t) => t.number)).toEqual([
      phase.number,
    ]);
  } finally {
    db.close();
  }
});

test("the same ops retries after a failed snapshot is fixed", () => {
  const cwd = tempDir();
  const { paths, file, db } = fixture();
  const ctx = taskContext(cwd, {});
  if (!ctx.ok) throw new Error(ctx.why);
  const a = ok(createTask(db, { project: ctx.project, subject: "A" }, who, 1));
  const b = ok(createTask(db, { project: ctx.project, subject: "B" }, who, 2));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(a.id, b.id);
  db.close();
  mkdirSync(`${file}.v4.bak.tmp`);
  const ops = createTaskOps({
    stateDir: paths.stateDir,
    caller: () => ({ ...who, cwd }),
    env: hookEnv(),
  });
  try {
    expect(ops.call("create", { subject: "First" }).ok).toBe(false);
    rmdirSync(`${file}.v4.bak.tmp`);
    expect(ops.call("create", { subject: "Next" }).ok).toBe(true);
  } finally {
    ops.close();
  }
});
test("take from another owner accepts rows already owned by the taker", () => {
  const { db } = fixture();
  try {
    const plan = ok(ensurePlanTask(db, { project: "p", plan: "mix", subject: "Plan" }, who, 1));
    ok(createTask(db, { project: "p", plan: "mix", subject: "Mine" }, next, 2));
    expect(takeTasks(db, "p", plan.id, next, 3, { from: "old", isLive: () => false }).ok).toBe(
      true,
    );
  } finally {
    db.close();
  }
});
test("mixed cycles never move a plan or phase, and cycles without nested tasks stay put", () => {
  const { file, db } = fixture();
  const phase = ok(
    writeWork(db, () =>
      layPhase(db, { project: "p", plan: "one", phase: "A", subject: "Phase" }, who, 1),
    ),
  ).task;
  const a = ok(createTask(db, { project: "p", subject: "A", parentId: phase.id }, who, 2));
  const b = ok(createTask(db, { project: "p", subject: "B" }, who, 3));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(b.id, phase.id);
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(a.id, b.id);
  const planId = phase.parentId;
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(taskById(repaired, phase.id).parentId).toBe(b.id);
    expect(taskById(repaired, planId ?? "").parentId).toBeNull();
    expect(taskById(repaired, a.id).parentId).toBeNull();
    // No task-under-task edge: this malformed phase/task cycle is outside the lift's job.
    repaired.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(phase.id, a.id);
    repaired.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(a.id, phase.id);
  } finally {
    repaired.close();
  }
  const unchanged = openWorkDb(file, { mode: "write" });
  try {
    expect(taskById(unchanged, phase.id).parentId).toBe(a.id);
    expect(taskById(unchanged, a.id).parentId).toBe(phase.id);
  } finally {
    unchanged.close();
  }
});

test("restored holds never wait through a mixed parent cycle", () => {
  const { file, db } = fixture();
  const phase = ok(
    writeWork(db, () =>
      layPhase(db, { project: "p", plan: "one", phase: "A", subject: "Phase" }, who, 1),
    ),
  ).task;
  const b = ok(createTask(db, { project: "p", subject: "B" }, who, 2));
  const a = ok(createTask(db, { project: "p", subject: "A" }, who, 3));
  for (const [id, parent] of [
    [b.id, a.id],
    [phase.id, b.id],
    [a.id, phase.id],
  ])
    db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(parent ?? null, id ?? null);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(taskById(repaired, a.id).waitsFor).toEqual([]);
    expect(updateTask(repaired, a.id, { status: "done" }, who, 4).ok).toBe(true);
    expect(updateTask(repaired, phase.id, { status: "done" }, who, 5).ok).toBe(true);
    expect(updateTask(repaired, b.id, { status: "done" }, who, 6).ok).toBe(true);
  } finally {
    repaired.close();
  }
});

test("failed serialization removes its partial temporary snapshot", () => {
  const { file, db } = fixture();
  const a = ok(createTask(db, { project: "p", subject: "A" }, who, 1));
  const b = ok(createTask(db, { project: "p", subject: "B" }, who, 2));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(a.id, b.id);
  db.close();
  const broken = spyOn(Database.prototype, "serialize").mockImplementation(() => {
    writeFileSync(`${file}.v4.bak.tmp`, "partial");
    throw new Error("snapshot failed");
  });
  try {
    const refused = openWorkDb(file, { mode: "write" });
    try {
      expect(refused.writable).toBe(false);
      expect(existsSync(`${file}.v4.bak.tmp`)).toBe(false);
    } finally {
      refused.close();
    }
  } finally {
    broken.mockRestore();
  }
});

/** Three open tasks that an older writer nested under each other: X under the phase, Y under X, Z under Y. */
function phaseChain(db: WorkDb, plan: string): WorkTask[] {
  const phase = ok(
    writeWork(db, () => layPhase(db, { project: "p", plan, phase: "A", subject: "Phase" }, who, 1)),
  ).task;
  const [x, y, z] = ["X", "Y", "Z"].map((subject) =>
    ok(createTask(db, { project: "p", plan, subject, parentId: phase.id }, who, 2)),
  );
  if (!x || !y || !z) throw new Error("fixture");
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(x.id, y.id);
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(y.id, z.id);
  return [x, y, z];
}
/**
 * A legacy parent cycle through a phase, the store as an older writer left it: B holds the phase,
 * the phase holds A, and A holds B (a task under a task is what the lift repairs). B is the lowest
 * numbered task, so the lift moves it to the top, and the phase and A end up under it: every hold
 * A had is then a hold on something above it.
 */
function phaseCycle(
  db: WorkDb,
  plan: string,
  change: { status: "done" } | { type: "non-blocking" },
): { phase: WorkTask; a: WorkTask; b: WorkTask } {
  const phase = ok(
    writeWork(db, () => layPhase(db, { project: "p", plan, phase: "A", subject: "Phase" }, who, 1)),
  ).task;
  const b = ok(createTask(db, { project: "p", subject: "B" }, who, 2));
  const a = ok(createTask(db, { project: "p", subject: "A" }, who, 3));
  ok(updateTask(db, a.id, change, who, 4));
  for (const [id, parent] of [
    [b.id, a.id],
    [phase.id, b.id],
    [a.id, phase.id],
  ] as const)
    db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(parent, id);
  return { phase, a, b };
}
/** The notes the repair wrote about the holds it did not restore, as the text each one gives. */
function skippedHolds(db: WorkDb, task: WorkTask): string[] {
  return eventsOf(db, task)
    .filter((e) => e.reason === LEGACY_LIFT_REASON && e.action === "noted")
    .map((e) => String(e.changes.note?.[1]));
}
/** Every stored hold of project `p` as `#holder -> #held`, in number order. */
function storedHolds(db: WorkDb): string[] {
  const all = allTasks(db, "p");
  const number = (id: string) => all.find((t) => t.id === id)?.number ?? 0;
  return all
    .flatMap((t) => t.waitsFor.map((id) => [t.number, number(id)] as const))
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
    .map(([holder, held]) => `#${holder} -> #${held}`);
}

test("a hold on what is now an ancestor is not restored: a closed task under a legacy cycle", () => {
  const { file, db } = fixture();
  const { phase, a, b } = phaseCycle(db, "one", { status: "done" });
  asSchema3(db);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    // B went to the top, the phase under it and A under the phase: both holds A had sit above it.
    expect(taskById(repaired, b.id).parentId).toBeNull();
    expect(taskById(repaired, phase.id).parentId).toBe(b.id);
    expect(taskById(repaired, a.id).parentId).toBe(phase.id);
    expect(taskById(repaired, a.id).waitsFor).toEqual([]);
  } finally {
    repaired.close();
  }
});

test("a hold on what is now an ancestor is not restored: a non-blocking task under a legacy cycle", () => {
  const { file, db } = fixture();
  const { a } = phaseCycle(db, "one", { type: "non-blocking" });
  asSchema3(db);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    // The phase does not wait for a non-blocking A, so no wait-through rule refuses these holds:
    // `addBlockers`' rule that a task is never blocked by what it sits under does.
    expect(taskById(repaired, a.id).waitsFor).toEqual([]);
  } finally {
    repaired.close();
  }
});

test("the repair restores exactly the holds addBlockers would accept", () => {
  const { file, db } = fixture();
  const chain = phaseChain(db, "one");
  const closed = phaseCycle(db, "two", { status: "done" });
  const loose = phaseCycle(db, "three", { type: "non-blocking" });
  asSchema3(db);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(chain.map((t) => t.number)).toEqual([3, 4, 5]);
    // Hand-written: X (#3) holds Y (#4) and Z (#5), Y holds Z, and the two cycles hold nothing.
    expect(storedHolds(repaired)).toEqual(["#3 -> #4", "#3 -> #5", "#4 -> #5"]);
    expect(skippedHolds(repaired, closed.a)).toHaveLength(2);
    expect(skippedHolds(repaired, loose.a)).toHaveLength(2);
    for (const task of chain) expect(skippedHolds(repaired, task)).toEqual([]);
  } finally {
    repaired.close();
  }
});

test("a hold already stored stays, and is not reported as skipped", () => {
  const { file, db } = fixture();
  const { phase, a, b } = phaseCycle(db, "one", { status: "done" });
  // An earlier release restored A's hold on the phase; the lift never deletes a stored hold.
  db.sqlite.query("INSERT INTO task_deps(task_id,waits_for) VALUES (?,?)").run(a.id, phase.id);
  asSchema3(db);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(taskById(repaired, a.id).waitsFor).toEqual([phase.id]);
    expect(skippedHolds(repaired, a)).toEqual([
      `hold on #${b.number} not restored: it sits above this task`,
    ]);
  } finally {
    repaired.close();
  }
});

test("each hold the repair skips writes one history row, with the lift's reason and the refused task", () => {
  const { file, db } = fixture();
  const { phase, a, b } = phaseCycle(db, "one", { status: "done" });
  asSchema3(db);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    const rows = eventsOf(repaired, a).filter((e) => e.reason === LEGACY_LIFT_REASON);
    expect(rows.map((e) => e.action)).toEqual(["noted", "noted"]);
    // The holds come in number order: the phase, then B.
    expect(rows.map((e) => e.changes.note)).toEqual([
      [null, `hold on #${phase.number} not restored: it sits above this task`],
      [null, `hold on #${b.number} not restored: it sits above this task`],
    ]);
    // Only A had holds, so only A has rows of this kind.
    expect(skippedHolds(repaired, b)).toEqual([]);
    expect(skippedHolds(repaired, phase)).toEqual([]);
  } finally {
    repaired.close();
  }
});

test("the repair loads each project's tasks once, however many holds it restores", () => {
  const { file, db } = fixture();
  for (const project of ["p", "q"]) {
    let parent = ok(createTask(db, { project, subject: "Top" }, who, 1));
    // Four levels: six holds to restore in each project.
    for (const subject of ["Two", "Three", "Four"]) {
      const next = ok(createTask(db, { project, subject }, who, 2));
      db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(parent.id, next.id);
      parent = next;
    }
  }
  asSchema3(db);
  db.close();
  const loads = spyOn(queries, "allTasks");
  let calls = 0;
  try {
    openWorkDb(file, { mode: "write" }).close();
    calls = loads.mock.calls.length;
  } finally {
    loads.mockRestore();
  }
  expect(calls).toBe(2);
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(allTasks(repaired, "p").flatMap((t) => t.waitsFor)).toHaveLength(6);
    expect(allTasks(repaired, "q").flatMap((t) => t.waitsFor)).toHaveLength(6);
  } finally {
    repaired.close();
  }
});
