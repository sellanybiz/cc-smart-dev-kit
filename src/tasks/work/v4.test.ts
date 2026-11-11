import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tempDir } from "../../testing/temp";
import { createTaskOps } from "../ops";
import { openWorkDb, workDbFile, writeWork } from "./db";
import { claimLive } from "./identity";
import { allTasks, eventsOf, taskById } from "./queries";
import { planProgress } from "./read";
import { addNote, createTask, ensurePlanTask, layPhase, takeTasks, updateTask } from "./store";
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
test("reverse-numbered legacy nesting retains holds and non-blocking inheritance", () => {
  const { file, db } = fixture();
  const leaf = ok(createTask(db, { project: "p", subject: "Leaf" }, who, 1));
  const middle = ok(createTask(db, { project: "p", subject: "Middle" }, who, 2));
  const root = ok(createTask(db, { project: "p", subject: "Root", type: "non-blocking" }, who, 3));
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(root.id, middle.id);
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(middle.id, leaf.id);
  db.close();
  const repaired = openWorkDb(file, { mode: "write" });
  try {
    expect(allTasks(repaired, "p").map((t) => [t.parentId, t.type])).toEqual([
      [null, "non-blocking"],
      [null, "non-blocking"],
      [null, "non-blocking"],
    ]);
    expect(taskById(repaired, middle.id).waitsFor).toEqual([leaf.id]);
    expect(taskById(repaired, root.id).waitsFor).toContain(middle.id);
  } finally {
    repaired.close();
  }
});
test("plan progress counts detached membership and ignores parked-plan edits", () => {
  const stateDir = tempDir();
  const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
  try {
    ok(ensurePlanTask(db, { project: "p", plan: "first", subject: "First" }, who, 1));
    const old = ok(
      createTask(
        db,
        { project: "p", plan: "first", subject: "Parked", status: "in_progress" },
        who,
        2,
      ),
    );
    const phase = ok(
      writeWork(db, () =>
        layPhase(db, { project: "p", plan: "second", phase: "A", subject: "Current" }, who, 3),
      ),
    ).task;
    const done = ok(
      createTask(db, { project: "p", plan: "second", subject: "Detached done" }, who, 4),
    );
    ok(updateTask(db, done.id, { status: "done" }, who, 5));
    ok(createTask(db, { project: "p", plan: "second", subject: "Detached open" }, who, 6));
    ok(updateTask(db, phase.id, { status: "in_progress" }, who, 7));
    ok(addNote(db, old.id, "Editing a parked plan", who, 99));
    const progress = planProgress({ stateDir }, "p", who);
    if (progress.state !== "ready") throw new Error(progress.state);
    expect(progress.value?.task.id).toBe(phase.id);
    expect(progress.value?.plan?.plan).toBe("second");
    expect([progress.value?.closed, progress.value?.total]).toEqual([1, 2]);
  } finally {
    db.close();
  }
});
test("forced, dead and session-only take-over preserve identity checks", () => {
  const { db } = fixture();
  try {
    const task = ok(
      createTask(db, { project: "p", subject: "Work", status: "in_progress" }, who, 1),
    );
    expect(
      takeTasks(db, "p", task.id, { sessionId: null, pid: null, procStart: null }, 2, {
        force: true,
        isLive: () => true,
      }).ok,
    ).toBe(false);
    expect(
      takeTasks(db, "p", task.id, next, 2, { from: "wrong", force: true, isLive: () => true }).ok,
    ).toBe(false);
    ok(takeTasks(db, "p", task.id, next, 3, { force: true, isLive: () => true }));
    expect(eventsOf(db, task).at(-1)?.reason).toBe("forced take-over");
    ok(
      takeTasks(db, "p", task.id, { sessionId: "only-id", pid: null, procStart: null }, 4, {
        isLive: () => false,
      }),
    );
    expect(taskById(db, task.id).claim).toBeNull();
    expect(taskById(db, task.id).createdBy).toBe("only-id");
    expect(
      claimLive(
        { pid: 123, procStart: "old", sessionId: "old" },
        { platform: "linux", readStat: () => null },
      ),
    ).toBe(false);
    expect(
      claimLive(
        { pid: 123, procStart: null, sessionId: "old" },
        { platform: "darwin", running: () => true },
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});
test("named plan list shows all own plans and a slug narrows it", () => {
  const cwd = tempDir();
  const ops = createTaskOps({ stateDir: tempDir(), caller: () => ({ ...who, cwd }) });
  try {
    expect(ops.call("create", { subject: "First", plan: "one" }).ok).toBe(true);
    expect(ops.call("create", { subject: "Second", plan: "two" }).ok).toBe(true);
    expect(ops.call("list", { scope: "plan" })).toMatchObject({
      ok: true,
      text: "#1 [pending · plan] First\n#2 [pending · plan] Second",
    });
    expect(ops.call("list", { scope: "plan", plan: "one" })).toMatchObject({
      ok: true,
      text: "#1 [pending · plan] First",
    });
    expect(ops.call("take", { task: "one" })).toMatchObject({
      ok: true,
      text: "1 task(s) taken by session old",
    });
  } finally {
    ops.close();
  }
});
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
    expect(
      taskById(repaired, parent.id)
        .waitsFor.map((id) => taskById(repaired, id).number)
        .sort(),
    ).toEqual([2, 3]);
    expect(eventsOf(repaired, child).at(-1)?.changes.parent).toEqual([`#${parent.number}`, null]);
    expect(existsSync(`${file}.v4.bak`)).toBe(true);
    const snapshot = new Database(`${file}.v4.bak`, { readonly: true });
    try {
      expect(
        snapshot
          .query<{ parent_id: string }, [string]>("SELECT parent_id FROM tasks WHERE id=?")
          .get(child.id)?.parent_id,
      ).toBe(parent.id);
    } finally {
      snapshot.close();
    }
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
