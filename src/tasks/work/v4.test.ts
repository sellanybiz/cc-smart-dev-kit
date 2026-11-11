import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile, writeWork } from "./db";
import { allTasks, eventsOf, taskById } from "./queries";
import { createTask, ensurePlanTask, layPhase, takeTasks } from "./store";
import type { Result } from "./types";

const who = { sessionId: "old", pid: 123, procStart: "1" };
const next = { sessionId: "new", pid: 456, procStart: "2" };
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.why);
  return r.value;
}
function fixture() {
  const file = workDbFile({ stateDir: tempDir() });
  return { file, db: openWorkDb(file, { mode: "write" }) };
}
test("tasks cannot hold tasks", () => {
  const { db } = fixture();
  try {
    const parent = ok(createTask(db, { project: "p", subject: "Parent" }, who, 1));
    expect(createTask(db, { project: "p", subject: "Child", parentId: parent.id }, who, 2).ok).toBe(
      false,
    );
  } finally {
    db.close();
  }
});
test("every write open lifts old nested tasks, preserves holds and takes a WAL backup", () => {
  const { file, db } = fixture();
  const parent = ok(
    createTask(db, { project: "p", subject: "Parent", type: "non-blocking" }, who, 1),
  );
  const child = ok(createTask(db, { project: "p", subject: "Child" }, who, 2));
  const grandchild = ok(createTask(db, { project: "p", subject: "Grandchild" }, who, 3));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(parent.id, child.id);
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(child.id, grandchild.id);
  db.sqlite.run("PRAGMA user_version=3");
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(allTasks(repaired, "p").map((t) => t.parentId)).toEqual([null, null, null]);
    expect(taskById(repaired, child.id).type).toBe("non-blocking");
    expect(taskById(repaired, parent.id).waitsFor).toEqual([child.id]);
    expect(eventsOf(repaired, child).at(-1)?.changes.parent).toEqual([`#${parent.number}`, null]);
    expect(existsSync(`${file}.v4.bak`)).toBe(true);
    repaired.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(parent.id, child.id);
  } finally {
    repaired.close();
  }
  const again = openWorkDb(file, { mode: "write" });
  try {
    expect(taskById(again, child.id).parentId).toBeNull();
  } finally {
    again.close();
  }
});
test("take is atomic, refuses live claims and cross-project ids, and transfers by plan column", () => {
  const { db } = fixture();
  try {
    const plan = ok(ensurePlanTask(db, { project: "p", plan: "one", subject: "One" }, who, 1));
    const phase = ok(
      writeWork(db, () =>
        layPhase(db, { project: "p", plan: "one", phase: "A", subject: "A" }, who, 2),
      ),
    ).task;
    const task = ok(
      createTask(
        db,
        { project: "p", plan: "one", subject: "Detached", status: "in_progress" },
        who,
        3,
      ),
    );
    expect(takeTasks(db, "p", plan.id, next, 4, { isLive: () => true }).ok).toBe(false);
    expect(taskById(db, phase.id).createdBy).toBe("old");
    expect(takeTasks(db, "other", plan.id, next, 4, { isLive: () => false }).ok).toBe(false);
    ok(takeTasks(db, "p", plan.id, next, 5, { isLive: () => false }));
    expect(allTasks(db, "p").map((t) => t.createdBy)).toEqual(["new", "new", "new"]);
    expect(taskById(db, task.id).claim?.pid).toBe(456);
    expect(eventsOf(db, task).at(-1)?.changes.createdBy).toEqual(["old", "new"]);
  } finally {
    db.close();
  }
});
