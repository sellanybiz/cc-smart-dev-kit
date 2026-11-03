import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { claudeMemDb, mistakenImport } from "../../testing/claude-mem-db";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import { type ImportResult, importClaudeMem } from "./import-claude-mem";
import { allTasks, eventsOf, getTask, notesOf } from "./queries";
import { startView } from "./read";
import { addNote, createTask, updateTask } from "./store";
import type { Result } from "./types";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const who = { sessionId: "session", pid: 12, procStart: "34" };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function statuses(db: ReturnType<typeof openWorkDb>, count: number): string[] {
  return Array.from({ length: count }, (_, i) => getTask(db, "p", `#${i + 1}`)?.status ?? "-");
}

test("claude-mem's own lists stay out, and a second run drops what an earlier import took from them", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const file = claudeMemDb([
    ["my-focus", { task: "Focus area: Billing", status: "suggested" }, NOW - DAY],
    ["owner-goals", { task: "Ask: Ship faster", status: "todo" }, NOW - DAY],
    ["owner-goals/2026-10-01", { task: "Ask: An older ask" }, NOW - DAY],
    ["my-rules", { task: "Rule: tests first" }, NOW - DAY],
    ["agent-lifecycle", { task: "Explore: find the config", status: "done" }, NOW - DAY],
    // Only `owner-goals` has month lists: a person's list under another own name is work.
    ["my-focus/notes", { task: "Write it up", status: "todo" }, NOW - DAY],
    ["release-work", { task: "Ship it", status: "todo" }, NOW - DAY],
  ]);
  mistakenImport(db, "p", NOW - DAY);
  // A session's own task under the same name is work: it stays.
  value(createTask(db, { project: "p", subject: "my-focus" }, who, NOW - DAY));
  const args = { claudeMemDb: file, workDb: db, project: "p", claudeMemProject: "home", now: NOW };
  const skipped = [
    "my-focus",
    "owner-goals",
    "owner-goals/2026-10-01",
    "my-rules",
    "agent-lifecycle",
  ];
  const expected: ImportResult = {
    imported: [
      {
        subject: "my-focus/notes",
        description: "",
        status: "pending",
        list: "my-focus/notes",
        parent: null,
      },
      {
        subject: "Write it up",
        description: "",
        status: "pending",
        list: "my-focus/notes",
        parent: "my-focus/notes",
      },
      {
        subject: "release-work",
        description: "",
        status: "pending",
        list: "release-work",
        parent: null,
      },
      {
        subject: "Ship it",
        description: "",
        status: "pending",
        list: "release-work",
        parent: "release-work",
      },
    ],
    dropped: [{ list: "my-focus", number: 1, tasks: 2, touched: [] }],
    kept: [],
    skipped,
    open: 7,
  };

  expect(value(importClaudeMem({ ...args, dryRun: true }))).toEqual(expected);
  expect(statuses(db, 4)).toEqual(["pending", "pending", "pending", "-"]);

  expect(value(importClaudeMem({ ...args, dryRun: false }))).toEqual(expected);
  expect(statuses(db, 7)).toEqual([
    "dropped",
    "dropped",
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  const listTask = getTask(db, "p", "#1");
  if (!listTask) throw new Error("no list task");
  expect(notesOf(db, listTask).map((note) => note.text)).toEqual([
    "Automatically dropped: claude-mem's own list, not work: an earlier import took it by mistake",
  ]);

  expect(value(importClaudeMem({ ...args, dryRun: false }))).toEqual({
    imported: [],
    dropped: [],
    kept: [],
    skipped,
    open: 7,
  });
  db.close();
});

test("the repair takes every own list an earlier import made, keeps what a session touched, and runs without claude-mem", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const at = NOW - DAY;
  mistakenImport(db, "p", at, "owner-goals/2026-09-01"); // #1, #2
  mistakenImport(db, "p", at, "agent-lifecycle"); // #3, #4
  const rules = mistakenImport(db, "p", at, "my-rules"); // #5, #6
  value(addNote(db, rules.item.id, "my own note on it", who, at));
  const goals = mistakenImport(db, "p", at, "owner-goals"); // #7, #8
  value(createTask(db, { project: "p", subject: "My own step", parentId: goals.list.id }, who, at)); // #9
  const closed = mistakenImport(db, "p", at, "my-focus"); // #10, #11
  value(updateTask(db, closed.item.id, { status: "done" }, who, at));
  value(updateTask(db, closed.list.id, { status: "done" }, who, at));
  const mine = value(createTask(db, { project: "p", subject: "Session work" }, who, at)); // #12
  const moved = mistakenImport(db, "p", at, "my-focus"); // #13, #14
  // Moved under a session's task while 1.10.x let a task with subtasks become a subtask.
  db.sqlite.query("UPDATE tasks SET parent_id=? WHERE id=?").run(mine.id, moved.list.id);
  const args = {
    // claude-mem uninstalled: its database is gone, and the repair still runs.
    claudeMemDb: join(tempDir(), "claude-mem.db"),
    workDb: db,
    project: "p",
    claudeMemProject: "home",
    now: NOW,
  };
  const expected: ImportResult = {
    imported: [],
    dropped: [
      { list: "owner-goals/2026-09-01", number: 1, tasks: 2, touched: [] },
      { list: "agent-lifecycle", number: 3, tasks: 2, touched: [] },
    ],
    kept: [
      { list: "my-rules", number: 5, tasks: 2, touched: [6] },
      { list: "owner-goals", number: 7, tasks: 3, touched: [9] },
    ],
    skipped: [],
    open: 0,
  };
  const before = statuses(db, 14);
  expect(value(importClaudeMem({ ...args, dryRun: true }))).toEqual(expected);
  expect(statuses(db, 14)).toEqual(before);

  expect(value(importClaudeMem({ ...args, dryRun: false }))).toEqual(expected);
  expect(statuses(db, 14)).toEqual([
    "dropped",
    "dropped",
    "dropped",
    "dropped",
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
    "done",
    "done",
    "pending",
    "pending",
    "pending",
  ]);
  db.close();
});

test("claude-mem's lists fold as claude-mem folds them", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const long = "step ".repeat(50);
  const file = claudeMemDb([
    ["Plan", { status: "doing" }, 5 * DAY, "Home"],
    // An entry with an empty item name is the list's own record.
    ["Plan", { task: "", note: "the list's own note" }, 6 * DAY, "Home"],
    // Written in this order, timed the other way: claude-mem reads `todo`, then `done`.
    ["Plan", { task: "Step", status: "done" }, 9 * DAY, "Home"],
    ["Plan", { task: "Step", status: "todo" }, 8 * DAY, "Home"],
    ["Plan", { task: "Finished", status: "completed" }, 7 * DAY, "Home"],
    ["Plan", { task: "Broke", status: "failed" }, 7 * DAY, "Home"],
    ["Plan", { task: long, status: "todo" }, 7 * DAY, "Home"],
    ["Done list", { status: "completed" }, 7 * DAY, "Home"],
    ["Elsewhere", { task: "Not ours", status: "todo" }, 7 * DAY, "other"],
  ]);
  const result = value(
    importClaudeMem({
      claudeMemDb: file,
      workDb: db,
      project: "p",
      claudeMemProject: "home",
      dryRun: false,
      now: NOW,
    }),
  );
  const cut = `${"step ".repeat(39)}step…`;
  expect(result).toEqual({
    imported: [
      {
        subject: "Plan",
        description: "note: the list's own note",
        status: "pending",
        list: "Plan",
        parent: null,
      },
      {
        subject: cut,
        description: `name: ${"step ".repeat(49)}step`,
        status: "pending",
        list: "Plan",
        parent: "Plan",
      },
    ],
    dropped: [],
    kept: [],
    skipped: [],
    open: 1,
  });
  expect(cut).toHaveLength(200);
  expect(allTasks(db, "p").map((task) => [task.subject, task.createdAt, task.updatedAt])).toEqual([
    ["Plan", 5 * DAY, 9 * DAY],
    [cut, 7 * DAY, 7 * DAY],
  ]);
  db.close();
});

test("a dry run meets every rule the real run meets, and changes nothing", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const file = claudeMemDb([
    ["release-work", { task: "Ship it", status: "todo" }, NOW - DAY],
    ["   ", { task: "No list name", status: "todo" }, NOW - DAY],
  ]);
  const args = { claudeMemDb: file, workDb: db, project: "p", claudeMemProject: "home", now: NOW };
  const refused = {
    ok: false,
    why: `claude-mem's list "   ": subject must be 1–200 characters`,
  } as const;
  expect(importClaudeMem({ ...args, dryRun: true })).toEqual(refused);
  expect(importClaudeMem({ ...args, dryRun: false })).toEqual(refused);
  expect(allTasks(db, "p")).toEqual([]);
  db.close();
});

test("an imported task keeps claude-mem's dates, so an old one counts as stale", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const file = claudeMemDb([
    ["old-list", { note: "kept" }, 10 * DAY],
    ["old-list", { task: "Old step", status: "todo" }, 20 * DAY],
    ["new-list", { task: "New step", status: "todo" }, NOW - DAY],
  ]);
  value(
    importClaudeMem({
      claudeMemDb: file,
      workDb: db,
      project: "p",
      claudeMemProject: "home",
      dryRun: false,
      now: NOW,
    }),
  );
  const dates = (ref: string) => {
    const task = getTask(db, "p", ref);
    return [task?.subject, task?.createdAt, task?.updatedAt];
  };
  expect(["#1", "#2", "#3", "#4"].map(dates)).toEqual([
    ["old-list", 10 * DAY, 20 * DAY],
    ["Old step", 20 * DAY, 20 * DAY],
    ["new-list", NOW - DAY, NOW - DAY],
    ["New step", NOW - DAY, NOW - DAY],
  ]);
  // The history still says when the kit imported it.
  const old = getTask(db, "p", "#1");
  if (!old) throw new Error("no task");
  expect(eventsOf(db, old)[0]?.at).toBe(NOW);
  db.close();

  const view = startView(paths, "p", who, { limit: 8, staleBefore: NOW - 30 * DAY });
  if (view.state !== "ready") throw new Error(view.state);
  expect(view.value.tasks.map((task) => task.subject)).toEqual(["new-list", "New step"]);
  expect(view.value.stale).toBe(2);
});

test("a list is imported once, whatever the case of the project name claude-mem matched it under", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const run = (file: string, claudeMemProject: string) =>
    value(
      importClaudeMem({
        claudeMemDb: file,
        workDb: db,
        project: "p",
        claudeMemProject,
        dryRun: false,
        now: NOW,
      }),
    );
  const first = claudeMemDb([["Plan", { task: "Step", status: "todo" }, NOW - DAY]]);
  expect(run(first, "home").imported.map((task) => task.subject)).toEqual(["Plan", "Step"]);
  // The read matches `HOME` to `home`, so `Plan` is the same list; `plan` is another one.
  const second = claudeMemDb([
    ["Plan", { task: "Step", status: "todo" }, NOW - DAY],
    ["plan", { task: "Other step", status: "todo" }, NOW - DAY],
  ]);
  expect(run(second, "HOME").imported.map((task) => task.subject)).toEqual(["plan", "Other step"]);
  expect(run(second, "Home").imported).toEqual([]);
  db.close();
});

test("a long name is cut on whole characters, never through an emoji", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const name = `${"a".repeat(198)}😀${"b".repeat(10)}`;
  const file = claudeMemDb([["Plan", { task: name, status: "todo" }, NOW - DAY]]);
  const result = value(
    importClaudeMem({
      claudeMemDb: file,
      workDb: db,
      project: "p",
      claudeMemProject: "home",
      dryRun: false,
      now: NOW,
    }),
  );
  expect(result.imported[1]).toEqual({
    subject: `${"a".repeat(198)}…`,
    description: `name: ${name}`,
    status: "pending",
    list: "Plan",
    parent: "Plan",
  });
  db.close();
});

test("a claude-mem database with no work-state table has no lists, and the repair still runs", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  mistakenImport(db, "p", NOW - DAY); // #1, #2
  const file = join(tempDir(), "claude-mem.db");
  new Database(file).close();
  const result = value(
    importClaudeMem({
      claudeMemDb: file,
      workDb: db,
      project: "p",
      claudeMemProject: "home",
      dryRun: false,
      now: NOW,
    }),
  );
  expect(result).toEqual({
    imported: [],
    dropped: [{ list: "my-focus", number: 1, tasks: 2, touched: [] }],
    kept: [],
    skipped: [],
    open: 0,
  });
  expect(statuses(db, 2)).toEqual(["dropped", "dropped"]);
  db.close();
});
