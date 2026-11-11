import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { tempDir } from "../../testing/temp";
import { LEGACY_LIFT_REASON, openWorkDb, workDbFile, writeWork } from "./db";
import { openPhasesOf } from "./phases";
import { allTasks, eventsOf, taskById } from "./queries";
import { planProgress } from "./read";
import { createTask, ensurePlanTask, layPhase, takeTasks, updateTask } from "./store";
import type { Result } from "./types";

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
  db.sqlite.run("PRAGMA user_version=3");
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(
      allTasks(repaired, "p")
        .filter((t) => t.kind === "task")
        .map((t) => t.parentId),
    ).toEqual([phase.id, phase.id, phase.id, phase.id]);
    expect(taskById(repaired, a.id).waitsFor).toEqual([]);
    expect(taskById(repaired, b.id).waitsFor).toEqual([c.id]);
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
