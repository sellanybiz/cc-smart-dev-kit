/**
 * Whose a task is: the process that made it (schema 5), carried across a `/clear` (a new session
 * id, the same pid and start time), and the store move that adds the columns for it.
 */
import { expect, test } from "bun:test";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import { allTasks, claimHeldBy, ownerOf } from "./queries";
import { hasOwnTask, readWorkStore } from "./read";
import { createTask, takeTasks, updateTask } from "./store";
import type { Result, Who } from "./types";

const OLD: Who = { sessionId: "old", pid: 4101, procStart: "41010" };
/** The same Claude process after a `/clear`. */
const CLEARED: Who = { ...OLD, sessionId: "cleared" };
/** Another Claude process, and a later process that got a dead one's pid and start time. */
const OTHER: Who = { sessionId: "other", pid: 5202, procStart: "52020" };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function setup() {
  const paths = { stateDir: tempDir() };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
}

test("a task records the process that made it: pid, start time and the session id it was made under", () => {
  const { db } = setup();
  try {
    const made = value(createTask(db, { project: "p", subject: "Plan work" }, OLD, 1));
    expect(made.createdBy).toBe("old");
    expect(made.creator).toEqual({ pid: 4101, procStart: "41010", sessionId: "old" });
    // A caller with no process (a terminal without Claude identity) records none.
    const bare = value(
      createTask(
        db,
        { project: "p", subject: "By hand" },
        { sessionId: null, pid: null, procStart: null },
        2,
      ),
    );
    expect(bare.creator).toBeNull();
    // A process with a pid and no start time (off Linux) records the pid alone.
    const noStart = value(
      createTask(
        db,
        { project: "p", subject: "No start" },
        { sessionId: "s", pid: 7, procStart: null },
        3,
      ),
    );
    expect(noStart.creator).toEqual({ pid: 7, procStart: null, sessionId: "s" });
  } finally {
    db.close();
  }
});

test("ownerOf: a task its process made is its own under any session id, another process's is not", () => {
  const { db } = setup();
  try {
    const mine = value(createTask(db, { project: "p", subject: "Mine" }, OLD, 1));
    const theirs = value(createTask(db, { project: "p", subject: "Theirs" }, OTHER, 2));
    const all = allTasks(db, "p");
    const old = ownerOf(OLD);
    const cleared = ownerOf(CLEARED);
    expect([mine, theirs].map(old)).toEqual([true, false]);
    // After a /clear nothing is claimed, yet the process still owns what it made.
    expect(all.map(cleared)).toEqual([true, false]);
    expect(all.map(ownerOf(OTHER))).toEqual([false, true]);
    // A later process that got the first one's pid, with another start time, owns nothing of it.
    expect(
      all.map((t) => ownerOf({ sessionId: "later", pid: 4101, procStart: "99999" })(t)),
    ).toEqual([false, false]);
  } finally {
    db.close();
  }
});

test("ownerOf: starting one task of another session's plan does not make that session's other tasks the caller's", () => {
  const { db } = setup();
  try {
    const first = value(createTask(db, { project: "p", subject: "First" }, OTHER, 1));
    const second = value(createTask(db, { project: "p", subject: "Second" }, OTHER, 2));
    // The caller claims one of them by starting it.
    value(updateTask(db, first.id, { status: "in_progress" }, OLD, 3));
    const owns = ownerOf(OLD);
    expect(allTasks(db, "p").map((t) => [t.id, owns(t)])).toEqual([
      [first.id, true],
      [second.id, false],
    ]);
  } finally {
    db.close();
  }
});

test("ownerOf off Linux: with no start time on either side the session id must match too", () => {
  const { db } = setup();
  try {
    const noStart: Who = { sessionId: "s1", pid: 9, procStart: null };
    const made = value(createTask(db, { project: "p", subject: "Made" }, noStart, 1));
    // The same pid in a later session (a /clear) is a different caller there: nothing proves it.
    expect(ownerOf({ sessionId: "s2", pid: 9, procStart: null })(made)).toBe(false);
    expect(ownerOf(noStart)(made)).toBe(true);
    // The creator is judged by the one claim rule.
    expect(claimHeldBy(made.creator, { sessionId: "s2", pid: 9, procStart: null })).toBe(false);
  } finally {
    db.close();
  }
});

test("a task made before schema 5 has no creator and is still its session's own", () => {
  const { db } = setup();
  try {
    const made = value(createTask(db, { project: "p", subject: "Old row" }, OLD, 1));
    db.sqlite.query("UPDATE tasks SET created_pid=NULL,created_start=NULL WHERE id=?").run(made.id);
    const rows = allTasks(db, "p");
    expect(rows.map((t) => t.creator)).toEqual([null]);
    expect(rows.map(ownerOf(OLD))).toEqual([true]);
    // After a /clear nothing proves it is the process's, so it is not.
    expect(rows.map(ownerOf(CLEARED))).toEqual([false]);
  } finally {
    db.close();
  }
});

test("take rewrites the creator process with the creator session", () => {
  const { db } = setup();
  try {
    const made = value(createTask(db, { project: "p", subject: "Handed over" }, OTHER, 1));
    value(takeTasks(db, "p", made.id, OLD, 2, { from: "other", isLive: () => false }));
    const rows = allTasks(db, "p");
    expect(rows.map((t) => t.createdBy)).toEqual(["old"]);
    expect(rows.map((t) => t.creator)).toEqual([
      { pid: 4101, procStart: "41010", sessionId: "old" },
    ]);
    expect(rows.map(ownerOf(CLEARED))).toEqual([true]);
    expect(rows.map(ownerOf(OTHER))).toEqual([false]);
  } finally {
    db.close();
  }
});

test("hasOwnTask follows the same rule: a /clear still has the process's open task", () => {
  const { db, paths } = setup();
  value(createTask(db, { project: "p", subject: "Work" }, OLD, 1));
  db.close();
  expect(hasOwnTask(paths, "p", CLEARED)).toEqual({ state: "ready", value: true });
  expect(hasOwnTask(paths, "p", OTHER)).toEqual({ state: "ready", value: false });
});

test("schema 4 moves to 5: the columns and the notes index appear, an old row keeps working with no creator", () => {
  const { db, paths } = setup();
  const made = value(createTask(db, { project: "p", subject: "Before" }, OLD, 1));
  // The store as 4.9.0 left it: no creator columns, no notes index, schema 4.
  db.sqlite.run("DROP INDEX task_note_task");
  for (const column of ["created_pid", "created_start"])
    db.sqlite.run(`ALTER TABLE tasks DROP COLUMN ${column}`);
  db.sqlite.run("PRAGMA user_version = 4");
  db.close();
  // A hook reads it as it is, without moving it: no creator, no error.
  expect(
    readWorkStore(paths, (hook) => allTasks(hook, "p").map((t) => [t.subject, t.creator])),
  ).toEqual({
    state: "ready",
    value: [["Before", null]],
  });
  const moved = openWorkDb(workDbFile(paths), { mode: "write" });
  try {
    expect(moved.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 5 });
    expect(
      moved.sqlite
        .query<{ name: string }, []>("PRAGMA table_info(tasks)")
        .all()
        .map((c) => c.name)
        .filter((name) => name.startsWith("created_")),
    ).toEqual(["created_by", "created_at", "created_pid", "created_start"]);
    expect(
      moved.sqlite
        .query<{ name: string; tbl_name: string }, []>(
          "SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND name='task_note_task'",
        )
        .all(),
    ).toEqual([{ name: "task_note_task", tbl_name: "task_notes" }]);
    expect(moved.sqlite.query("SELECT value FROM meta WHERE key='min_compatible'").get()).toEqual({
      value: "1",
    });
    // The old row has a null creator and still works; a new one records its process.
    expect(allTasks(moved, "p").map((t) => [t.id, t.creator])).toEqual([[made.id, null]]);
    value(updateTask(moved, made.id, { status: "in_progress" }, OLD, 2));
    const fresh = value(createTask(moved, { project: "p", subject: "After" }, OLD, 3));
    expect(fresh.creator).toEqual({ pid: 4101, procStart: "41010", sessionId: "old" });
  } finally {
    moved.close();
  }
});
