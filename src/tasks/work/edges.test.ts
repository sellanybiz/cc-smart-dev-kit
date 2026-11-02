import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import { callerOf } from "./identity";
import { getTask, listTasks, notesOf, openSubtasks, searchTasks } from "./queries";
import { crewPhaseState, hasOwnTask, leadOwnState, startView } from "./read";
import {
  addNote,
  createTask,
  deleteTask,
  ensurePhaseTask,
  ensurePlanTask,
  systemClose,
  updateTask,
} from "./store";
import type { Result } from "./types";

const who = { sessionId: "lead", crewId: null, pid: 1, procStart: "2" };
function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function setup() {
  const paths = { stateDir: tempDir() };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
}
test("all mutation limits, foreign projects, dependency removal and transaction rollback", () => {
  const { db } = setup();
  const root = ok(createTask(db, { project: "p", subject: "Root" }, who, 1));
  const child = ok(createTask(db, { project: "p", subject: "Child", parentId: root.id }, who, 2));
  const other = ok(createTask(db, { project: "other", subject: "Other" }, who, 3));
  expect(other.number).toBe(1);
  expect(updateTask(db, root.id, { parentId: root.id }, who, 4).ok).toBe(false);
  expect(updateTask(db, root.id, { parentId: other.id }, who, 4).ok).toBe(false);
  expect(updateTask(db, root.id, { waitsFor: { add: [other.id] } }, who, 4).ok).toBe(false);
  expect(updateTask(db, root.id, { waitsFor: { add: [root.id] } }, who, 4).ok).toBe(false);
  ok(updateTask(db, child.id, { waitsFor: { add: [root.id] } }, who, 5));
  expect(
    updateTask(db, child.id, { subject: "", waitsFor: { remove: [root.id] } }, who, 6).ok,
  ).toBe(false);
  expect(getTask(db, "p", child.id)?.waitsFor).toEqual([root.id]);
  ok(updateTask(db, child.id, { waitsFor: { remove: [root.id] } }, who, 7));
  expect(getTask(db, "p", child.id)?.waitsFor).toEqual([]);
  expect(updateTask(db, child.id, { description: "x".repeat(200001) }, who, 8).ok).toBe(false);
  expect(deleteTask(db, root.id).ok).toBe(false);
  ok(deleteTask(db, child.id));
  expect(getTask(db, "p", child.id)).toBeNull();
  ok(updateTask(db, root.id, { status: "done" }, who, 10));
  expect(getTask(db, "p", root.id)?.closedAt).toBe(10);
  ok(updateTask(db, root.id, { status: "in_progress" }, who, 11));
  expect(getTask(db, "p", root.id)?.closedAt).toBeNull();
  ok(updateTask(db, root.id, { claim: false }, who, 12));
  expect(getTask(db, "p", root.id)?.claim).toBeNull();
  ok(addNote(db, root.id, "x".repeat(64000), who, 13));
  expect(notesOf(db, root).length).toBe(1);
  const max = ok(
    createTask(
      db,
      { project: "p", subject: "x".repeat(200), description: "x".repeat(200000) },
      who,
      14,
    ),
  );
  expect(max.description.length).toBe(200000);
  db.close();
});
test("deep descendants, ordering, exact hook views, filters, caps, and case-insensitive search", () => {
  const { db, paths } = setup();
  const plan = ok(ensurePlanTask(db, { project: "p", plan: "plan", subject: "Plan" }, who, 1));
  const phase = ok(
    ensurePhaseTask(
      db,
      {
        project: "p",
        plan: "plan",
        phase: "a",
        subject: "Phase",
        description: "",
        crewId: "crew",
        waitsForPhases: [],
      },
      who,
      2,
    ),
  );
  const a = ok(
    createTask(db, { project: "p", subject: "Alpha", parentId: phase.id, plan: "plan" }, who, 3),
  );
  const b = ok(
    createTask(
      db,
      {
        project: "p",
        subject: "Beta",
        parentId: a.id,
        plan: "plan",
        status: "in_progress",
        crewId: "crew",
      },
      who,
      4,
    ),
  );
  expect(openSubtasks(db, phase.id).map((t) => t.subject)).toEqual(["Beta", "Alpha"]);
  expect(updateTask(db, plan.id, { status: "done" }, who, 5)).toEqual({
    ok: false,
    why: "open subtasks: #4 Beta, #2 Phase, #3 Alpha",
  });
  expect(searchTasks(db, "p", "ALPHA").map((t) => t.subject)).toEqual(["Alpha"]);
  expect(listTasks(db, { project: "p", root: a.id, openOnly: true })[0]?.children[0]?.id).toBe(
    b.id,
  );
  // "Mine" is the Claude process (pid and its start time), so `/clear` keeps the list.
  expect(
    listTasks(db, { project: "p", claimedBy: { pid: 1, procStart: "2" }, openOnly: true }).map(
      (t) => t.subject,
    ),
  ).toEqual(["Beta"]);
  expect(
    listTasks(db, { project: "p", claimedBy: { pid: 1, procStart: "reused" }, openOnly: true }),
  ).toEqual([]);
  expect(
    listTasks(db, { project: "p", crewId: "crew", openOnly: true }).map((t) => t.subject),
  ).toEqual(["Phase", "Beta"]);
  const state = crewPhaseState(paths, "p", "crew");
  expect(state.state).toBe("ready");
  if (state.state === "ready") {
    expect(state.value.total).toBe(2);
    expect(state.value.openSubtasks.map((t) => t.subject)).toEqual(["Beta", "Alpha"]);
  }
  const lead = leadOwnState(paths, "p", "plan", ["lead"]);
  if (lead.state !== "ready") throw Error("not ready");
  expect(lead.value.total).toBe(2);
  expect(lead.value.inProgress.map((t) => t.subject)).toEqual(["Beta"]);
  const view = startView(paths, "p", who, { limit: 1 });
  expect(view).toEqual({
    state: "ready",
    value: {
      tasks: [{ id: b.id, number: 4, subject: "Beta", status: "in_progress", claim: "free" }],
      more: 3,
    },
  });
  ok(systemClose(db, phase.id, "dropped", "removed", who, 20));
  expect(notesOf(db, b.id)[0]?.text).toBe("Automatically dropped: removed");
  expect(hasOwnTask(paths, "p", ["lead"])).toEqual({ state: "ready", value: false });
  db.close();
});
test("hook failures return unreadable, query-only blocks writes, schema versions persist", () => {
  const paths = { stateDir: tempDir() };
  mkdirSync(join(paths.stateDir, "tasks"));
  writeFileSync(workDbFile(paths), "garbage");
  expect(startView(paths, "p", who, { limit: 8 }).state).toBe("unreadable");
  const fresh = setup();
  expect(fresh.db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
  expect(fresh.db.sqlite.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  fresh.db.close();
  const hook = openWorkDb(workDbFile(fresh.paths), { mode: "hook" });
  expect(() => hook.sqlite.run("DELETE FROM tasks")).toThrow();
  hook.close();
});
test("portable ancestry, missing caller, and pid reuse", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "sessions"));
  writeFileSync(
    join(dir, "sessions", "9.json"),
    JSON.stringify({ pid: 9, sessionId: "s", cwd: dir, name: "N" }),
  );
  const facts = {
    claudeConfigDir: dir,
    pid: 20,
    ppid: 10,
    platform: "darwin" as const,
    parentOf: () => 9,
    running: () => true,
    env: { CC_SMART_DEV_KIT_CREW: "crew" },
  };
  expect(callerOf(facts)).toEqual({
    pid: 9,
    procStart: null,
    sessionId: "s",
    cwd: dir,
    name: "N",
    crewId: "crew",
  });
  expect(callerOf({ ...facts, running: () => false, env: {} })).toBeNull();
});
