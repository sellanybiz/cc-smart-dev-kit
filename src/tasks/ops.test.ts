import { expect, test } from "bun:test";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { folderProject } from "./context";
import { createTaskOps } from "./ops";
import { scanProjectTasks } from "./project/files";
import { openWorkDb, workDbFile } from "./work/db";
import { openPhasesOf } from "./work/phases";

test("a close the store refuses keeps no note, so a retry saves each note once", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  const ops = createTaskOps({
    stateDir,
    cwd: () => cwd,
    caller: () => ({ sessionId: "s", pid: process.pid, procStart: null, cwd }),
  });
  const written = () => {
    const db = openWorkDb(workDbFile({ stateDir }), { mode: "hook" });
    try {
      return {
        notes: db.sqlite
          .query<{ text: string }, []>("SELECT text FROM task_notes ORDER BY id")
          .all()
          .map((row) => row.text),
        history: db.sqlite
          .query<{ action: string }, []>("SELECT action FROM task_events ORDER BY id")
          .all()
          .map((row) => row.action),
      };
    } finally {
      db.close();
    }
  };
  try {
    expect(ops.call("create", { subject: "Parent" }).ok).toBe(true);
    expect(ops.call("create", { subject: "Child", parent: "#1" }).ok).toBe(true);
    expect(ops.call("done", { task: "#1", note: "Tried", evidence: "Checked" })).toEqual({
      ok: false,
      why: "open subtasks: #2 Child",
    });
    expect(written()).toEqual({ notes: [], history: ["created", "created"] });
    expect(ops.call("done", { task: "#2" }).ok).toBe(true);
    expect(ops.call("done", { task: "#1", note: "Tried", evidence: "Checked" }).ok).toBe(true);
    expect(written()).toEqual({
      notes: ["Tried", "Checked"],
      history: ["created", "created", "closed", "noted", "noted", "closed"],
    });
  } finally {
    ops.close();
  }
});

test("work hierarchy, dependencies, notes, claims and paging", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  let session = "first";
  // A process start time, as on Linux: it names the process, so `/clear` keeps its claims.
  const ops = createTaskOps({
    stateDir,
    cwd: () => cwd,
    caller: () => ({ sessionId: session, pid: process.pid, procStart: "4242", cwd }),
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
    // A subtask blocked by its own parent could never start (D76); the other way is fine.
    expect(ops.call("update", { task: "#2", blocked_by_add: ["#1"] })).toEqual({
      ok: false,
      why: '#2 "Child" cannot be blocked by #1 "Parent": it sits under it, and a parent waits for its subtasks',
    });
    expect(ops.call("update", { task: "#1", blocked_by_add: ["#2"] }).ok).toBe(true);
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
    expect(ops.call("create", { subject: "Invalid", blocked_by: ["#99"] }).ok).toBe(false);
    expect(ops.call("create", { subject: "Next" })).toEqual({ ok: true, text: '#3 "Next"' });
    expect(ops.call("delete", { task: "#3" }).ok).toBe(true);
    expect(ops.call("note", { task: "#1", text: "x".repeat(64001) }).ok).toBe(false);
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

test("subagent phase bindings survive updates and appear in the plan ledger", () => {
  const cwd = tempDir();
  const state = tempDir();
  const ops = createTaskOps({ stateDir: state, cwd: () => cwd, caller: () => null });
  try {
    expect(
      ops.call("create", {
        subject: "Build",
        plan: "upgrade",
        phase: "T",
        agent: "builder-t",
        branch: "task-ledger",
        worktree: "/tmp/task-ledger",
        base: "abc123",
      }).ok,
    ).toBe(true);
    expect(ops.call("create", { subject: "Test", parent: "#2" }).ok).toBe(true);
    expect(ops.call("done", { task: "#3" }).ok).toBe(true);
    expect(
      ops.call("update", {
        task: "#2",
        agent: "builder-next",
        branch: "task-next",
        worktree: "/tmp/task-next",
        base: "def456",
      }).ok,
    ).toBe(true);
    const got = ops.call("get", { task: "#2" });
    expect(got.ok && got.text).toContain(
      "Agent: builder-next\nBranch: task-next\nWorktree: /tmp/task-next\nBase: def456",
    );
    expect(ops.call("list", { scope: "plan" })).toMatchObject({
      ok: true,
      text: "#1 [pending · plan] upgrade · 1/2\n  #2 [pending · phase T] Build · 1/1 · agent builder-next · branch task-next",
    });
    expect(ops.call("update", { task: "#2", worktree: "relative" }).ok).toBe(false);
    expect(ops.call("done", { task: "#2" }).ok).toBe(true);
    expect(ops.call("done", { task: "#1" }).ok).toBe(true);
    const resumed = createTaskOps({
      stateDir: state,
      cwd: () => cwd,
      caller: () => ({ sessionId: "after-clear", pid: null, procStart: null, cwd }),
    });
    try {
      expect(resumed.call("list", { scope: "plan" })).toMatchObject({
        ok: true,
        text: "#1 [done · plan] upgrade · 2/2\n  #2 [done · phase T] Build · 1/1 · agent builder-next · branch task-next",
      });
    } finally {
      resumed.close();
    }
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

test("another session's plan is never stamped on a session's own task; the plan read still finds it", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  const x = { sessionId: "session-x", pid: 4101, procStart: "41010", cwd };
  const y = { sessionId: "session-y", pid: 5202, procStart: "52020", cwd };
  const opsX = createTaskOps({ stateDir, cwd: () => cwd, caller: () => x });
  const opsY = createTaskOps({ stateDir, cwd: () => cwd, caller: () => y });
  const planOf = (number: number) => {
    const db = openWorkDb(workDbFile({ stateDir }), { mode: "hook" });
    try {
      return db.sqlite
        .query<{ plan: string | null }, [number]>("SELECT plan FROM tasks WHERE number=?")
        .get(number)?.plan;
    } finally {
      db.close();
    }
  };
  try {
    expect(opsX.call("create", { subject: "Auth", plan: "auth" }).ok).toBe(true);
    expect(opsX.call("create", { subject: "Guard", plan: "auth", phase: "G1" }).ok).toBe(true);
    expect(opsX.call("update", { task: "#2", status: "in_progress" }).ok).toBe(true);
    expect(opsY.call("create", { subject: "Fix a typo", status: "in_progress" })).toEqual({
      ok: true,
      text: '#3 "Fix a typo"',
    });
    expect(planOf(3)).toBeNull();
    expect(openPhasesOf({ stateDir }, folderProject(cwd), () => y)).toEqual({
      state: "ready",
      value: { inProgress: [], ready: [] },
    });
    // Y has no plan of its own, so its phase needs the plan named.
    expect(opsY.call("create", { subject: "Theirs", phase: "G2" })).toEqual({
      ok: false,
      why: "A phase belongs to a plan: give plan (its slug)",
    });
    // X's own work still takes its plan, and so does its phase with the plan left out.
    expect(opsX.call("create", { subject: "Own step", status: "in_progress" }).ok).toBe(true);
    expect(planOf(4)).toBe("auth");
    expect(opsX.call("create", { subject: "Docs", phase: "G2" })).toEqual({
      ok: true,
      text: '#5 "Docs" · phase G2 of plan auth',
    });
    // Reading the ledger may fall back to the project's newest plan.
    expect(opsY.call("list", { scope: "plan" })).toMatchObject({
      ok: true,
      text: "#1 [pending · plan] Auth · 0/2\n  #2 [in progress · phase G1] Guard · 0/0 · agent none · branch none\n  #5 [pending · phase G2] Docs · 0/0 · agent none · branch none",
    });
  } finally {
    opsX.close();
    opsY.close();
  }
});

test("a caller with no session id owns no task the terminal made", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  const terminal = createTaskOps({ stateDir, cwd: () => cwd, caller: () => null });
  const nameless = createTaskOps({
    stateDir,
    cwd: () => cwd,
    caller: () => ({ sessionId: null, pid: 7301, procStart: "73010", cwd }),
  });
  try {
    expect(terminal.call("create", { subject: "Solo", plan: "solo" }).ok).toBe(true);
    expect(terminal.call("create", { subject: "Step", parent: "#1" }).ok).toBe(true);
    expect(nameless.call("create", { subject: "Own", status: "in_progress" })).toEqual({
      ok: true,
      text: '#3 "Own"',
    });
    // Neither the terminal's tasks nor their plan count as its own.
    expect(nameless.call("list", {})).toMatchObject({
      ok: true,
      text: "#3 [in progress] Own",
      data: { work: [{ number: 3, plan: null }] },
    });
    // The terminal owns every task made without a session id, that one too.
    expect(terminal.call("list", {})).toMatchObject({
      ok: true,
      text: "#1 [pending · plan] Solo · 0/1\n  #2 [pending] Step\n#3 [in progress] Own",
    });
  } finally {
    terminal.close();
    nameless.close();
  }
});
