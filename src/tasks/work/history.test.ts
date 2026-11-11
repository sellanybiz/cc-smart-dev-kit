import { expect, test } from "bun:test";
import { join } from "node:path";
import { legacyCreateTask as createTask } from "../../testing/claude-mem-db";
import { cleanGitEnv, git, tempDir } from "../../testing/temp";
import { createTaskOps } from "../ops";
import { scanProjectTasks } from "../project/files";
import { openWorkDb, workDbFile } from "./db";
import { historyText } from "./history";
import { eventsOf } from "./queries";
import { addNote, deleteTask, systemClose, updateTask } from "./store";
import type { Result, WorkEvent } from "./types";

const at = (minute: number) => Date.UTC(2026, 10, 3, 9, minute);
const lead = { sessionId: "s-1", pid: 7, procStart: "70", name: "lead-a" };
const builder = { sessionId: "s-2", pid: 8, procStart: "80", name: "builder-session" };
const kit = { sessionId: null, pid: null, procStart: null };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

/** An entry without its row id, which says nothing a reader needs. */
const entry = (event: WorkEvent) => {
  const { id: _id, ...rest } = event;
  return rest;
};

function world() {
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  const root = value(
    createTask(db, { project: "p", subject: "Ship it", description: "v1" }, lead, at(0)),
  );
  const child = value(
    createTask(db, { project: "p", subject: "Part", parentId: root.id }, builder, at(1)),
  );
  value(
    updateTask(
      db,
      root.id,
      { subject: "Ship it now", description: "v2 longer", status: "in_progress" },
      lead,
      at(2),
    ),
  );
  value(addNote(db, root.id, "Checked the build", lead, at(3)));
  value(systemClose(db, root.id, "done", "phase merged", kit, at(4)));
  return { db, root, child };
}

test("every change is recorded with its time, its values before and after, and who made it", () => {
  const { db, root, child } = world();
  const mine = { sessionId: "s-1", sessionName: "lead-a", pid: 7, reason: null };
  const theKit = { sessionId: null, sessionName: null, pid: null };
  expect(eventsOf(db, root).map(entry)).toEqual([
    {
      taskId: root.id,
      number: 1,
      at: at(0),
      action: "created",
      changes: {
        kind: [null, "task"],
        subject: [null, "Ship it"],
        description: [null, "v1"],
        status: [null, "pending"],
      },
      ...mine,
    },
    {
      taskId: root.id,
      number: 1,
      at: at(2),
      action: "changed",
      changes: {
        subject: ["Ship it", "Ship it now"],
        description: ["v1", "v2 longer"],
        status: ["pending", "in_progress"],
        claim: [null, "s-1"],
      },
      ...mine,
    },
    {
      taskId: root.id,
      number: 1,
      at: at(3),
      action: "noted",
      changes: { note: [null, "Checked the build"] },
      ...mine,
    },
    {
      taskId: root.id,
      number: 1,
      at: at(4),
      action: "closed",
      changes: { status: ["in_progress", "done"], claim: ["s-1", null] },
      ...theKit,
      reason: "phase merged",
    },
    {
      taskId: root.id,
      number: 1,
      at: at(4),
      action: "noted",
      changes: { note: [null, "Automatically done: phase merged"] },
      ...theKit,
      reason: "phase merged",
    },
  ]);
  expect(historyText(eventsOf(db, child), { full: false })).toBe(
    [
      "History (oldest first):",
      '2026-11-03T09:01:00.000Z by session "builder-session" s-2, process 8 · created: kind task; subject "Part"; status pending; parent #1',
      "2026-11-03T09:04:00.000Z by the kit (phase merged) · closed: status pending → dropped",
      '2026-11-03T09:04:00.000Z by the kit (phase merged) · noted: note "Automatically dropped: phase merged"',
    ].join("\n"),
  );
  db.close();
});

test("the history reads as a timeline, and with full it keeps every earlier description", () => {
  const { db, root } = world();
  expect(historyText(eventsOf(db, root), { full: false })).toBe(
    [
      "History (oldest first):",
      '2026-11-03T09:00:00.000Z by session "lead-a" s-1, process 7 · created: kind task; subject "Ship it"; status pending; description 2 characters',
      '2026-11-03T09:02:00.000Z by session "lead-a" s-1, process 7 · changed: subject "Ship it" → "Ship it now"; status pending → in_progress; claimed by none → s-1; description changed, 2 → 9 characters',
      '2026-11-03T09:03:00.000Z by session "lead-a" s-1, process 7 · noted: note "Checked the build"',
      "2026-11-03T09:04:00.000Z by the kit (phase merged) · closed: status in_progress → done; claimed by s-1 → none",
      '2026-11-03T09:04:00.000Z by the kit (phase merged) · noted: note "Automatically done: phase merged"',
    ].join("\n"),
  );
  const full = historyText(eventsOf(db, root), { full: true }).split("\n");
  expect(full.slice(1, 9)).toEqual([
    '2026-11-03T09:00:00.000Z by session "lead-a" s-1, process 7 · created: kind task; subject "Ship it"; status pending; description 2 characters',
    "  description after:",
    "    v1",
    '2026-11-03T09:02:00.000Z by session "lead-a" s-1, process 7 · changed: subject "Ship it" → "Ship it now"; status pending → in_progress; claimed by none → s-1; description changed, 2 → 9 characters',
    "  description before:",
    "    v1",
    "  description after:",
    "    v2 longer",
  ]);
  db.close();
});

test("a deleted task keeps its history, with its last version", () => {
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  const oops = value(createTask(db, { project: "p", subject: "Oops" }, lead, at(5)));
  value(deleteTask(db, oops.id, lead, at(6)));
  expect(historyText(eventsOf(db, oops.id), { full: false })).toBe(
    [
      "History (oldest first):",
      '2026-11-03T09:05:00.000Z by session "lead-a" s-1, process 7 · created: kind task; subject "Oops"; status pending',
      '2026-11-03T09:06:00.000Z by session "lead-a" s-1, process 7 · deleted; its last version: subject "Oops"; status pending',
    ].join("\n"),
  );
  db.close();
});

test("a change that changes nothing adds no entry", () => {
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  const task = value(createTask(db, { project: "p", subject: "Same" }, lead, at(0)));
  value(updateTask(db, task.id, { subject: "Same" }, lead, at(1)));
  expect(eventsOf(db, task).map((event) => event.action)).toEqual(["created"]);
  db.close();
});

test("task_get prints a work task's history with the caller's session name", () => {
  const cwd = tempDir();
  const ops = createTaskOps({
    stateDir: tempDir(),
    cwd: () => cwd,
    caller: () => ({
      sessionId: "s-9",
      pid: 42,
      procStart: null,
      cwd,
      name: "lead-b",
    }),
    now: () => at(0),
  });
  try {
    expect(ops.call("create", { subject: "Ship", description: "Do it" }).ok).toBe(true);
    expect(ops.call("get", { task: "#1" })).toEqual({
      ok: true,
      text: [
        '#1 "Ship" [task · pending]',
        "",
        "Do it",
        "",
        "History (oldest first):",
        '2026-11-03T09:00:00.000Z by session "lead-b" s-9, process 42 · created: kind task; subject "Ship"; status pending; description 5 characters',
      ].join("\n"),
    });
    const full = ops.call("get", { task: "#1", history: true });
    expect(full.ok && full.text.endsWith("  description after:\n    Do it")).toBe(true);

    // A deleted task's number is never given again, and its history still answers to it.
    expect(ops.call("create", { subject: "Oops" }).ok).toBe(true);
    expect(ops.call("delete", { task: "#2" }).ok).toBe(true);
    expect(ops.call("create", { subject: "Next" })).toEqual({ ok: true, text: '#3 "Next"' });
    expect(ops.call("get", { task: "#2" })).toEqual({
      ok: true,
      text: [
        '#2 "Oops" [deleted]',
        "",
        "History (oldest first):",
        '2026-11-03T09:00:00.000Z by session "lead-b" s-9, process 42 · created: kind task; subject "Oops"; status pending',
        '2026-11-03T09:00:00.000Z by session "lead-b" s-9, process 42 · deleted; its last version: subject "Oops"; status pending',
      ].join("\n"),
    });
    expect(ops.call("get", { task: "#9" })).toEqual({ ok: false, why: "Task not found: #9" });
  } finally {
    ops.close();
  }
});

test("a project task's history is its file's git log, across its move into the archive", () => {
  const cwd = tempDir();
  const env = cleanGitEnv();
  git(cwd, "init", "-b", "main");
  const ops = createTaskOps({ stateDir: tempDir(), cwd: () => cwd, caller: () => null, env });
  try {
    expect(ops.call("create", { subject: "Migrate the table", kind: "database" }).ok).toBe(true);
    const task = scanProjectTasks(join(cwd, ".claude/tasks"), { archive: false }).tasks[0];
    if (!task) throw new Error("missing task");
    const before = ops.call("get", { task: task.id });
    expect(before.ok && before.text.endsWith("\n\nHistory: not committed yet.")).toBe(true);
    git(cwd, "add", ".claude/tasks");
    git(cwd, "commit", "-m", "Add the task");
    expect(ops.call("done", { task: task.id, evidence: "Applied" }).ok).toBe(true);
    git(cwd, "add", "-A", ".claude/tasks");
    git(cwd, "commit", "-m", "Close the task");
    const after = ops.call("get", { task: task.id });
    if (!after.ok) throw new Error(after.why);
    const history = after.text.slice(after.text.indexOf("History (git, oldest first):"));
    expect(
      history.split("\n").map((line) => line.replace(/^\S+ (\S+) [0-9a-f]+ /, "<date> $1 <hash> ")),
    ).toEqual([
      "History (git, oldest first):",
      "<date> Test <hash> Add the task",
      "<date> Test <hash> Close the task",
    ]);
  } finally {
    ops.close();
  }
});
