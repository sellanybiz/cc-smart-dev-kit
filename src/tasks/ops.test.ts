import { expect, test } from "bun:test";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { taskContext } from "./context";
import { createTaskOps } from "./ops";
import { scanProjectTasks } from "./project/files";
import { openWorkDb, workDbFile } from "./work/db";
import { ensurePhaseTask } from "./work/store";

test("work hierarchy, dependencies, notes, claims and paging", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  let session = "first";
  const ops = createTaskOps({
    stateDir,
    cwd: () => cwd,
    caller: () => ({ sessionId: session, crewId: null, pid: process.pid, procStart: null, cwd }),
  });
  try {
    expect(ops.call("create", { subject: "Parent" }).ok).toBe(true);
    expect(
      ops.call("create", {
        subject: "Child",
        parent: "#1",
        description: "x".repeat(21000),
        status: "in_progress",
      }),
    ).toEqual({ ok: true, text: '#2 "Child" under #1' });
    expect(ops.call("done", { task: "#1" })).toEqual({ ok: false, why: "open subtasks: #2 Child" });
    expect(ops.call("update", { task: "#1", parent: "#2" })).toEqual({
      ok: false,
      why: "parent would make a cycle",
    });
    expect(ops.call("update", { task: "#2", waits_for_add: ["#1"] }).ok).toBe(true);
    expect(ops.call("update", { task: "#1", waits_for_add: ["#2"] })).toEqual({
      ok: false,
      why: "waits-for would make a cycle",
    });
    session = "after-clear";
    expect(ops.call("list", {})).toMatchObject({ ok: true, text: "#2 [in progress] Child" });
    const page = ops.call("get", { task: "#2" });
    expect(page.ok && page.text.endsWith("… more: offset 20000")).toBe(true);
    expect(ops.call("note", { task: "#2", text: "Proof saved" }).ok).toBe(true);
    expect(ops.call("search", { text: "Proof saved" })).toMatchObject({
      ok: true,
      text: "#2 [in progress] Child",
    });
    expect(ops.call("delete", { task: "#2" })).toEqual({
      ok: false,
      why: "task has notes; drop it instead",
    });
    expect(ops.call("done", { task: "#2", outcome: "dropped" }).ok).toBe(true);
    expect(ops.call("done", { task: "#1", evidence: "Checked" }).ok).toBe(true);
    expect(ops.call("create", { subject: "Invalid", waits_for: ["#99"] }).ok).toBe(false);
    expect(ops.call("create", { subject: "Next" })).toEqual({ ok: true, text: '#3 "Next"' });
    expect(ops.call("delete", { task: "#3" }).ok).toBe(true);
    expect(ops.call("note", { task: "#1", text: "x".repeat(64001) }).ok).toBe(false);
  } finally {
    ops.close();
  }
});

test("crew caller defaults to its phase parent and follows its current checkout", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  const ctx = taskContext(cwd);
  if (!ctx.ok) throw new Error(ctx.why);
  const who = { sessionId: "crew-session", crewId: "crew-one", pid: null, procStart: null };
  const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
  expect(
    ensurePhaseTask(
      db,
      {
        project: ctx.project,
        plan: "my-plan",
        subject: "Build",
        phase: "one",
        description: "Check it",
        crewId: "crew-one",
        waitsForPhases: [],
      },
      who,
      1,
    ).ok,
  ).toBe(true);
  db.close();
  const ops = createTaskOps({ stateDir, caller: () => ({ ...who, cwd }) });
  try {
    expect(ops.call("create", { subject: "Check" })).toEqual({
      ok: true,
      text: '#3 "Check" under #2',
    });
    expect(ops.call("list", { scope: "plan" })).toMatchObject({
      ok: true,
      // Progress counts the whole subtree, the status line's and the board's rule.
      text: "#1 [pending] my-plan · 0/2\n  #2 [pending] Build · 0/1\n    #3 [pending] Check",
    });
  } finally {
    ops.close();
  }
});

test("project tasks update, log, ack locally, archive, search and protect tracked files", () => {
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  const ops = createTaskOps({
    stateDir: tempDir(),
    cwd: () => cwd,
    caller: () => null,
    env: cleanGitEnv(),
  });
  const dir = join(cwd, ".claude/tasks");
  try {
    const created = ops.call("create", {
      subject: "Prepare database",
      kind: "database",
      description: "Apply carefully",
      when: "next-release",
      weight: "blocks-release",
    });
    expect(created.ok && created.text.includes('"Prepare database"')).toBe(true);
    const task = scanProjectTasks(dir, { archive: false }).tasks[0];
    if (!task) throw new Error("missing task");
    expect(task.from).toBe("branch main");
    expect(ops.call("update", { task: task.id, description: "Changed body" }).ok).toBe(true);
    expect(ops.call("update", { task: task.id, status: "done" }).ok).toBe(false);
    expect(ops.call("note", { task: task.id, text: "Reviewed" }).ok).toBe(true);
    expect(ops.call("get", { task: task.id })).toMatchObject({ ok: true });
    expect(ops.call("search", { text: "changed BODY" })).toMatchObject({
      ok: true,
      text: `${task.id} [database · next-release · blocks-release] Prepare database`,
    });
    git(cwd, "add", ".claude/tasks");
    expect(ops.call("delete", { task: task.id })).toEqual({
      ok: false,
      why: "Tracked project task: drop it with task_done outcome dropped",
    });
    expect(ops.call("done", { task: task.id, evidence: "Applied" }).ok).toBe(true);
    expect(scanProjectTasks(dir, { archive: true }).tasks[0]?.status).toBe("done");
    expect(ops.call("create", { subject: "Set up locally", kind: "teammate" }).ok).toBe(true);
    const teammate = scanProjectTasks(dir, { archive: false }).tasks[0];
    if (!teammate) throw new Error("missing teammate task");
    expect(ops.call("done", { task: teammate.id })).toEqual({
      ok: true,
      text: `${teammate.id} "Set up locally" · done on this machine`,
    });
    expect(ops.call("list", { scope: "project" })).toMatchObject({ ok: true, text: "No tasks." });
    expect(scanProjectTasks(dir, { archive: false }).tasks[0]?.status).toBe("open");
    expect(ops.call("done", { task: teammate.id, for_everyone: true }).ok).toBe(true);
    expect(ops.call("create", { subject: "Mistake", kind: "follow-up" }).ok).toBe(true);
    const mistake = scanProjectTasks(dir, { archive: false }).tasks[0];
    if (!mistake) throw new Error("missing mistake");
    expect(ops.call("delete", { task: mistake.id }).ok).toBe(true);
  } finally {
    ops.close();
  }
});

test("work tasks share create, list and close operations", () => {
  const cwd = tempDir();
  const ops = createTaskOps({ stateDir: tempDir(), caller: () => null, cwd: () => cwd });
  try {
    expect(ops.call("create", { subject: "Check the change" })).toEqual({
      ok: true,
      text: '#1 "Check the change"',
    });
    expect(ops.call("list", {})).toMatchObject({ ok: true, text: "#1 [pending] Check the change" });
    expect(ops.call("done", { task: "#1" })).toEqual({
      ok: true,
      text: '#1 "Check the change" · done',
    });
    expect(ops.call("list", {})).toMatchObject({ ok: true, text: "No tasks." });
  } finally {
    ops.close();
  }
});
