import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { crewTaskView, leadTaskView } from "./guard-view";
import { openWorkDb, workDbFile } from "./work/db";
import { createTask, ensurePhaseTask, updateTask } from "./work/store";
import type { Result } from "./work/types";

const lead = { sessionId: "lead-1", crewId: null, pid: 7, procStart: "70" };
const crew = { sessionId: "crew-1", crewId: "crew-a", pid: 8, procStart: "80" };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

function world() {
  const stateDir = tempDir();
  const claudeConfigDir = tempDir();
  return { stateDir, claudeConfigDir, settingsFile: join(claudeConfigDir, "settings.json") };
}

/** Claude Code's own list: one JSON file per task under `<config>/tasks/<list id>/`. */
function claudeList(
  configDir: string,
  listId: string,
  tasks: { status: string; subject: string }[],
) {
  const folder = join(configDir, "tasks", listId);
  mkdirSync(folder, { recursive: true });
  for (const [index, task] of tasks.entries()) {
    const id = String(index + 1);
    writeFileSync(join(folder, `${id}.json`), JSON.stringify({ id, ...task }));
  }
}

function phase(stateDir: string, crewId: string) {
  const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
  const task = value(
    ensurePhaseTask(
      db,
      {
        project: "p",
        plan: "plan",
        phase: "a",
        subject: "Phase A",
        description: "",
        crewId,
        waitsForPhases: [],
      },
      lead,
      1,
    ),
  );
  return { db, task };
}

test("a crew with no phase task and no Claude Code list: nothing listed, nothing open", () => {
  const w = world();
  expect(crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "crew-1" })).toEqual({
    phase: null,
    listed: false,
    open: [],
    unreadable: [],
  });
});

test("the phase task's subtasks, in progress first, then Claude Code's open tasks", () => {
  const w = world();
  const { db, task } = phase(w.stateDir, "crew-a");
  value(createTask(db, { project: "p", subject: "Write the test", parentId: task.id }, crew, 2));
  const second = value(
    createTask(db, { project: "p", subject: "Make it pass", parentId: task.id }, crew, 3),
  );
  const third = value(
    createTask(db, { project: "p", subject: "Done one", parentId: task.id }, crew, 4),
  );
  value(updateTask(db, second.id, { status: "in_progress" }, crew, 5));
  value(updateTask(db, third.id, { status: "done" }, crew, 6));
  db.close();
  claudeList(w.claudeConfigDir, "crew-1", [
    { status: "completed", subject: "Old finished" },
    { status: "pending", subject: "Old open" },
  ]);
  const view = crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "crew-1" });
  expect(view.phase?.subject).toBe("Phase A");
  expect(view.listed).toBe(true);
  // #1 is the plan task and #2 the phase task, which `ensurePhaseTask` makes first.
  expect(view.open).toEqual([
    { ref: "#4", subject: "Make it pass", status: "in_progress" },
    { ref: "#3", subject: "Write the test", status: "pending" },
    { ref: "Claude Code task 2", subject: "Old open", status: "pending" },
  ]);
  expect(view.unreadable).toEqual([]);
});

test("a phase task with no subtask is not a list; a continuation's new crew id finds the same phase", () => {
  const w = world();
  const { db, task } = phase(w.stateDir, "crew-a");
  db.close();
  expect(crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "x" }).listed).toBe(false);
  const again = phase(w.stateDir, "crew-b");
  expect(again.task.id).toBe(task.id);
  value(createTask(again.db, { project: "p", subject: "Step", parentId: task.id }, crew, 2));
  again.db.close();
  expect(crewTaskView({ ...w, project: "p", crewId: "crew-b", listId: "x" }).listed).toBe(true);
  expect(crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "x" }).phase).toBeNull();
});

test("Claude Code's list alone still counts, for a session that used it before setup ran", () => {
  const w = world();
  claudeList(w.claudeConfigDir, "crew-1", [{ status: "in_progress", subject: "Legacy" }]);
  const view = crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "crew-1" });
  expect(view.listed).toBe(true);
  expect(view.open).toEqual([
    { ref: "Claude Code task 1", subject: "Legacy", status: "in_progress" },
  ]);
});

test("once setup denies TaskUpdate, a task left on Claude Code's list holds no one", () => {
  const w = world();
  claudeList(w.claudeConfigDir, "crew-1", [{ status: "in_progress", subject: "Legacy" }]);
  claudeList(w.claudeConfigDir, "lead-1", [{ status: "in_progress", subject: "Legacy step" }]);
  // Another deny of the person's own changes nothing: the list can still be closed.
  writeFileSync(w.settingsFile, JSON.stringify({ permissions: { deny: ["WebFetch"] } }));
  expect(crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "crew-1" }).open).toEqual([
    { ref: "Claude Code task 1", subject: "Legacy", status: "in_progress" },
  ]);
  // Setup's entries, behind a byte order mark an editor added.
  writeFileSync(
    w.settingsFile,
    `﻿${JSON.stringify({ permissions: { deny: ["WebFetch", "TaskCreate", "TaskUpdate"] } })}`,
  );
  expect(crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "crew-1" })).toEqual({
    phase: null,
    listed: false,
    open: [],
    unreadable: [],
  });
  expect(
    leadTaskView({ ...w, project: "p", plan: "plan", sessionIds: ["lead-1"], listId: "lead-1" }),
  ).toEqual({ hasOwn: false, inProgress: [], unreadable: [] });
  // A settings file that is not JSON shows no deny: the list is read as before setup.
  writeFileSync(w.settingsFile, "{not json");
  expect(crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "crew-1" }).listed).toBe(
    true,
  );
});

test("what cannot be read is named, never read as an empty list", () => {
  const w = world();
  mkdirSync(join(w.stateDir, "tasks"), { recursive: true });
  writeFileSync(workDbFile(w), "not a database");
  const folder = join(w.claudeConfigDir, "tasks", "crew-1");
  mkdirSync(folder, { recursive: true });
  chmodSync(folder, 0o000);
  try {
    const view = crewTaskView({ ...w, project: "p", crewId: "crew-a", listId: "crew-1" });
    expect(view.listed).toBe(false);
    expect(view.open).toEqual([]);
    expect(view.unreadable).toHaveLength(2);
    expect(view.unreadable[0]).toStartWith("the kit's task store cannot be read: ");
    expect(view.unreadable[1]).toBe(`Claude Code's task list in ${folder} cannot be read`);
  } finally {
    chmodSync(folder, 0o700);
  }
});

test("a lead's own tasks in progress, from its sessions and its plan, beside its Claude Code list", () => {
  const w = world();
  const db = openWorkDb(workDbFile(w), { mode: "write" });
  value(
    createTask(
      db,
      { project: "p", subject: "Merge the wave", plan: "plan", status: "in_progress" },
      lead,
      1,
    ),
  );
  value(createTask(db, { project: "p", subject: "Pending one", plan: "plan" }, lead, 2));
  value(
    createTask(
      db,
      { project: "p", subject: "Another plan", plan: "other", status: "in_progress" },
      lead,
      3,
    ),
  );
  value(
    createTask(
      db,
      { project: "p", subject: "Someone else", plan: "plan", status: "in_progress" },
      { ...lead, sessionId: "stranger" },
      4,
    ),
  );
  db.close();
  claudeList(w.claudeConfigDir, "lead-2", [{ status: "in_progress", subject: "Legacy step" }]);
  const view = leadTaskView({
    ...w,
    project: "p",
    plan: "plan",
    sessionIds: ["lead-1", "lead-2"],
    listId: "lead-2",
  });
  expect(view).toEqual({
    hasOwn: true,
    inProgress: [
      { ref: "#1", subject: "Merge the wave", status: "in_progress" },
      { ref: "Claude Code task 1", subject: "Legacy step", status: "in_progress" },
    ],
    unreadable: [],
  });
  expect(
    leadTaskView({ ...w, project: "p", plan: "plan", sessionIds: ["new"], listId: "new" }),
  ).toEqual({ hasOwn: false, inProgress: [], unreadable: [] });
});
