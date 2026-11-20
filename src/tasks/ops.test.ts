import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { hookEnv, makeRepo } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { folderProject } from "./context";
import { scanDeployTasks } from "./deploy/files";
import { createTaskOps } from "./ops";
import { openWorkDb, workDbFile } from "./work/db";
import { openPhasesOf } from "./work/phases";

function legacyParent(stateDir: string, number: number, parent: number) {
  const raw = new Database(workDbFile({ stateDir }));
  try {
    raw
      .query("UPDATE tasks SET parent_id=(SELECT id FROM tasks WHERE number=?) WHERE number=?")
      .run(parent, number);
  } finally {
    raw.close();
  }
}

for (const status of ["done", "dropped"] as const) {
  test(`a ${status} latest plan leaves new work loose`, () => {
    const cwd = tempDir();
    const stateDir = tempDir();
    const ops = createTaskOps({
      env: hookEnv(),
      stateDir,
      cwd: () => cwd,
      caller: () => ({ sessionId: "s", pid: null, procStart: null, cwd }),
    });
    try {
      expect(ops.call("create", { subject: "Older", plan: "older" }).ok).toBe(true);
      expect(ops.call("create", { subject: "Latest", plan: "latest" }).ok).toBe(true);
      expect(ops.call("update", { task: "#2", status }).ok).toBe(true);
      expect(ops.call("create", { subject: "Loose" }).ok).toBe(true);
      const db = openWorkDb(workDbFile({ stateDir }), { mode: "hook" });
      try {
        expect(db.sqlite.query("SELECT plan FROM tasks WHERE number=3").get()).toEqual({
          plan: null,
        });
      } finally {
        db.close();
      }
      expect(ops.call("create", { subject: "Phase", phase: "A" })).toEqual({
        ok: false,
        why: "A phase belongs to a plan: give plan (its slug)",
      });
      const ledger = ops.call("list", { scope: "plan", open_only: false });
      if (!ledger.ok) throw new Error(ledger.why);
      expect(ledger.text).toContain("Latest");
    } finally {
      ops.close();
    }
  });
}

for (const blocking of [true, false]) {
  test(`a missing plan row with blocking=${blocking}: a plain task stays loose, and a phase's default plan holds only while a blocking task does`, () => {
    const cwd = tempDir();
    const stateDir = tempDir();
    const ops = createTaskOps({
      env: hookEnv(),
      stateDir,
      cwd: () => cwd,
      caller: () => ({ sessionId: "s", pid: null, procStart: null, cwd }),
    });
    try {
      expect(ops.call("create", { subject: "Plan", plan: "legacy" }).ok).toBe(true);
      expect(
        ops.call("create", {
          subject: "Existing",
          parent: "#1",
          type: blocking ? "blocking" : "non-blocking",
        }).ok,
      ).toBe(true);
      const raw = new Database(workDbFile({ stateDir }));
      try {
        raw.query("DELETE FROM tasks WHERE kind='plan'").run();
      } finally {
        raw.close();
      }
      expect(ops.call("create", { subject: "New" }).ok).toBe(true);
      const db = openWorkDb(workDbFile({ stateDir }), { mode: "hook" });
      try {
        expect(db.sqlite.query("SELECT plan FROM tasks WHERE number=3").get()).toEqual({
          plan: null,
        });
      } finally {
        db.close();
      }
      expect(ops.call("create", { subject: "Area", phase: "A" })).toEqual(
        blocking
          ? { ok: true, text: '#5 "Area" · phase A of plan legacy' }
          : { ok: false, why: "A phase belongs to a plan: give plan (its slug)" },
      );
    } finally {
      ops.close();
    }
  });
}

for (const fromPlan of [false, true]) {
  test(`moving ${fromPlan ? "another plan's" : "loose"} task checks the destination plan`, () => {
    const cwd = tempDir();
    const stateDir = tempDir();
    const ops = createTaskOps({
      env: hookEnv(),
      stateDir,
      cwd: () => cwd,
      caller: () => ({ sessionId: "s", pid: null, procStart: null, cwd }),
    });
    const row = () => {
      const db = openWorkDb(workDbFile({ stateDir }), { mode: "hook" });
      try {
        return db.sqlite
          .query("SELECT parent_id,plan,subject,updated_at FROM tasks WHERE subject='Move me'")
          .get();
      } finally {
        db.close();
      }
    };
    try {
      expect(ops.call("create", { subject: "Phase", plan: "closed", phase: "A" }).ok).toBe(true);
      expect(ops.call("done", { task: "#2" }).ok).toBe(true);
      expect(ops.call("done", { task: "#1" }).ok).toBe(true);
      expect(ops.call("update", { task: "#2", subject: "Closed phase, renamed" }).ok).toBe(true);
      if (fromPlan) expect(ops.call("create", { subject: "Other", plan: "other" }).ok).toBe(true);
      expect(ops.call("create", { subject: "Move me" }).ok).toBe(true);
      const ref = fromPlan ? "#4" : "#3";
      const before = row();
      expect(ops.call("update", { task: ref, parent: "#2", subject: "Must roll back" })).toEqual({
        ok: false,
        why: 'Plan "closed" is closed: reopen it with task_update, or create a loose task (no plan).',
      });
      expect(row()).toEqual(before);
      expect(ops.call("update", { task: "#1", status: "pending" }).ok).toBe(true);
      expect(ops.call("update", { task: ref, parent: "#2" }).ok).toBe(true);
      expect(row()).toMatchObject({ plan: "closed" });
      // An open step stays in its phase; closed with its proof, it moves to the top and keeps its plan.
      expect(ops.call("update", { task: ref, parent: null }).ok).toBe(false);
      expect(ops.call("done", { task: ref, evidence: "checked it: ok" }).ok).toBe(true);
      expect(ops.call("update", { task: ref, parent: null }).ok).toBe(true);
      expect(row()).toMatchObject({ plan: "closed", parent_id: null });
    } finally {
      ops.close();
    }
  });
}

test("named phases and explicit parents refuse a closed plan", () => {
  const cwd = tempDir();
  const ops = createTaskOps({
    env: hookEnv(),
    stateDir: tempDir(),
    cwd: () => cwd,
    caller: () => ({ sessionId: "s", pid: null, procStart: null, cwd }),
  });
  try {
    expect(ops.call("create", { subject: "Phase", plan: "closed", phase: "A" }).ok).toBe(true);
    expect(ops.call("done", { task: "#2" }).ok).toBe(true);
    expect(ops.call("done", { task: "#1" }).ok).toBe(true);
    const refusal = {
      ok: false as const,
      why: 'Plan "closed" is closed: reopen it with task_update, or create a loose task (no plan).',
    };
    expect(ops.call("create", { subject: "New", parent: "#2" })).toEqual(refusal);
    expect(ops.call("create", { subject: "New", parent: "#2", plan: "closed" })).toEqual(refusal);
    expect(ops.call("create", { subject: "Phase B", phase: "B", plan: "closed" })).toEqual(refusal);
    expect(ops.call("create", { subject: "Phase A", phase: "A", plan: "closed" })).toEqual(refusal);
    expect(ops.call("update", { task: "#1", status: "pending" }).ok).toBe(true);
    expect(ops.call("create", { subject: "Allowed", parent: "#2" }).ok).toBe(true);
  } finally {
    ops.close();
  }
});

test("a close the store refuses keeps no note, so a retry saves each note once", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  const ops = createTaskOps({
    env: hookEnv(),
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
    expect(ops.call("create", { subject: "Child" }).ok).toBe(true);
    legacyParent(stateDir, 2, 1);
    expect(ops.call("done", { task: "#1", note: "Tried", evidence: "Checked" })).toEqual({
      ok: false,
      why: "open tasks: #2 Child",
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
    env: hookEnv(),
    stateDir,
    cwd: () => cwd,
    caller: () => ({ sessionId: session, pid: process.pid, procStart: "4242", cwd }),
  });
  try {
    expect(ops.call("create", { subject: "Parent" }).ok).toBe(true);
    expect(
      ops.call("create", {
        subject: "Child",
        description: "x".repeat(21000),
        status: "in_progress",
      }),
    ).toEqual({ ok: true, text: '#2 "Child"' });
    legacyParent(stateDir, 2, 1);
    expect(ops.call("done", { task: "#1" })).toEqual({ ok: false, why: "open tasks: #2 Child" });
    expect(ops.call("update", { task: "#1", parent: "#2" })).toEqual({
      ok: false,
      why: "parent would make a cycle",
    });
    // A task blocked by its own parent could never start (D76); the other way is fine.
    expect(ops.call("update", { task: "#2", blocked_by_add: ["#1"] })).toEqual({
      ok: false,
      why: '#2 "Child" cannot be blocked by #1 "Parent": it sits under it, and a parent waits for its tasks',
    });
    expect(ops.call("update", { task: "#1", blocked_by_add: ["#2"] }).ok).toBe(true);
    session = "after-clear";
    // The process is the same, so the session it was before (which made #1 and #2) is its own.
    expect(ops.call("list", {})).toMatchObject({
      ok: true,
      text: "#1 [pending · blocked by #2] Parent · 0/1\n  #2 [in progress] Child",
    });
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

test("deploy tasks update, log, archive, search and protect tracked files", () => {
  const cwd = tempDir();
  git(cwd, "init", "-b", "main");
  const ops = createTaskOps({
    stateDir: tempDir(),
    cwd: () => cwd,
    caller: () => null,
    env: hookEnv(),
  });
  const dir = join(cwd, ".claude/tasks");
  try {
    const created = ops.call("create", {
      subject: "Prepare database",
      kind: "prod",
      description: "Apply carefully",
      deploy: "before",
      type: "blocking",
    });
    expect(created.ok && created.text.includes('"Prepare database"')).toBe(true);
    const task = scanDeployTasks(dir, { archive: false }).tasks[0];
    if (!task) throw new Error("missing task");
    expect(task.from).toBe("branch main");
    expect(ops.call("update", { task: task.id, description: "Changed body" }).ok).toBe(true);
    expect(ops.call("update", { task: task.id, status: "done" }).ok).toBe(false);
    expect(ops.call("note", { task: task.id, text: "Reviewed" }).ok).toBe(true);
    expect(ops.call("get", { task: task.id })).toMatchObject({ ok: true });
    expect(ops.call("search", { text: "changed BODY" })).toMatchObject({
      ok: true,
      text: `${task.id} [before · blocking] Prepare database`,
    });
    git(cwd, "add", ".claude/tasks");
    expect(ops.call("delete", { task: task.id })).toEqual({
      ok: false,
      why: "Tracked deploy task: it is part of a commit, so close it with task_done instead",
    });
    expect(ops.call("done", { task: task.id })).toMatchObject({ ok: false });
    expect(ops.call("done", { task: task.id, evidence: "Applied" }).ok).toBe(true);
    expect(scanDeployTasks(dir, { archive: true }).tasks[0]?.status).toBe("done");
    expect(
      ops.call("create", {
        subject: "Mistake",
        kind: "staging",
        deploy: "after",
        type: "non-blocking",
      }).ok,
    ).toBe(true);
    const mistake = scanDeployTasks(dir, { archive: false }).tasks[0];
    if (!mistake) throw new Error("missing mistake");
    expect(ops.call("delete", { task: mistake.id }).ok).toBe(true);
    // A deploy task needs its deploy step and its type.
    expect(ops.call("create", { subject: "No step", kind: "prod" })).toMatchObject({ ok: false });
  } finally {
    ops.close();
  }
});

test("subagent phase bindings survive updates and appear in the plan ledger", () => {
  const cwd = makeRepo();
  // The builder's real branch: one commit past the base the phase records, so its close is a hand-back.
  const base = git(cwd, "rev-parse", "HEAD").trim();
  git(cwd, "switch", "-q", "-c", "task-next");
  git(cwd, "commit", "-q", "--allow-empty", "-m", "work");
  git(cwd, "switch", "-q", "main");
  const state = tempDir();
  const env = hookEnv();
  const ops = createTaskOps({ stateDir: state, cwd: () => cwd, caller: () => null, env });
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
    expect(ops.call("done", { task: "#3", evidence: "ran it: passes" }).ok).toBe(true);
    expect(
      ops.call("update", {
        task: "#2",
        agent: "builder-next",
        branch: "task-next",
        worktree: "/tmp/task-next",
        base,
      }).ok,
    ).toBe(true);
    const got = ops.call("get", { task: "#2" });
    expect(got.ok && got.text).toContain(
      `Agent: builder-next\nBranch: task-next\nWorktree: /tmp/task-next\nBase: ${base}`,
    );
    expect(ops.call("list", { scope: "plan" })).toMatchObject({
      ok: true,
      text: "#1 [queued · plan] upgrade · 0/1 · Phases 1/10\n  #2 [pending · phase T] Build · 1/1 · agent builder-next · branch task-next",
    });
    expect(ops.call("update", { task: "#2", worktree: "relative" }).ok).toBe(false);
    expect(ops.call("done", { task: "#2" }).ok).toBe(true);
    expect(ops.call("done", { task: "#1" }).ok).toBe(true);
    const resumed = createTaskOps({
      stateDir: state,
      cwd: () => cwd,
      caller: () => ({ sessionId: "after-clear", pid: null, procStart: null, cwd }),
      env,
    });
    try {
      expect(resumed.call("list", { scope: "plan" })).toMatchObject({
        ok: true,
        text: "#1 [done · plan] upgrade · 1/1 · Phases 1/10\n  #2 [done · phase T] Build · 1/1 · agent builder-next · branch task-next",
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
  const ops = createTaskOps({
    stateDir: tempDir(),
    caller: () => null,
    cwd: () => cwd,
    env: hookEnv(),
  });
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
  const env = hookEnv();
  const opsX = createTaskOps({ stateDir, cwd: () => cwd, caller: () => x, env });
  const opsY = createTaskOps({ stateDir, cwd: () => cwd, caller: () => y, env });
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
    expect(opsX.call("create", { subject: "Step", parent: "#2" }).ok).toBe(true);
    expect(opsX.call("update", { task: "#2", status: "in_progress" }).ok).toBe(true);
    expect(opsY.call("create", { subject: "Fix a typo", status: "in_progress" })).toEqual({
      ok: true,
      text: '#4 "Fix a typo"',
    });
    expect(planOf(4)).toBeNull();
    expect(openPhasesOf({ stateDir }, folderProject(cwd), () => y)).toEqual({
      state: "ready",
      value: { inProgress: [], ready: [] },
    });
    // Y has no plan of its own, so its phase needs the plan named.
    expect(opsY.call("create", { subject: "Theirs", phase: "G2" })).toEqual({
      ok: false,
      why: "A phase belongs to a plan: give plan (its slug)",
    });
    // X's plain task is loose too (a plain task never joins a plan); its phase with the plan
    // left out takes X's own plan.
    expect(opsX.call("create", { subject: "Own step", status: "in_progress" }).ok).toBe(true);
    expect(planOf(5)).toBeNull();
    expect(opsX.call("create", { subject: "Docs", phase: "G2" })).toEqual({
      ok: true,
      text: '#6 "Docs" · phase G2 of plan auth',
    });
    // Reading the ledger may fall back to the project's newest plan.
    expect(opsY.call("list", { scope: "plan" })).toMatchObject({
      ok: true,
      text: "#1 [in flight · plan] Auth · 0/2 · Phases 2/10\n  #2 [in progress · phase G1] Guard · 0/1 · agent none · branch none\n  #6 [pending · phase G2] Docs · 0/0 · agent none · branch none",
    });
  } finally {
    opsX.close();
    opsY.close();
  }
});

test("a caller with no session id owns no task the terminal made", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  const terminal = createTaskOps({
    stateDir,
    cwd: () => cwd,
    caller: () => null,
    env: hookEnv(),
  });
  const nameless = createTaskOps({
    env: hookEnv(),
    stateDir,
    cwd: () => cwd,
    caller: () => ({ sessionId: null, pid: 7301, procStart: "73010", cwd }),
  });
  try {
    expect(terminal.call("create", { subject: "Solo", plan: "solo" }).ok).toBe(true);
    expect(terminal.call("create", { subject: "Step" }).ok).toBe(true);
    legacyParent(stateDir, 2, 1);
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
      text: "#1 [pending · plan] Solo\n  #2 [pending] Step\n#3 [in progress] Own",
    });
  } finally {
    terminal.close();
    nameless.close();
  }
});

/** Two callers on one store and one folder: the session `s`, and another one. */
function twoCallers() {
  const cwd = tempDir();
  const stateDir = tempDir();
  const open = (sessionId: string) =>
    createTaskOps({
      env: hookEnv(),
      stateDir,
      cwd: () => cwd,
      caller: () => ({ sessionId, pid: null, procStart: null, cwd }),
    });
  return { mine: open("s"), theirs: open("other") };
}

/**
 * Plan `p` (#1), a loose blocker (#2), two phases blocked by it (#3 "Phase x", #4 "Phase y"), a
 * second blocker (#5) and a loose task held by both (#6), and a step in each phase (#7, #8).
 */
function freedWork(ops: ReturnType<typeof createTaskOps>) {
  const calls: Record<string, unknown>[] = [
    { subject: "Plan", plan: "p" },
    { subject: "Blocker" },
    { subject: "Phase x", plan: "p", phase: "X", blocked_by: ["#2"] },
    { subject: "Phase y", plan: "p", phase: "Y", blocked_by: ["#2"] },
    { subject: "Other blocker" },
    { subject: "Held", blocked_by: ["#2", "#5"] },
    { subject: "Step x", parent: "#3" },
    { subject: "Step y", parent: "#4" },
  ];
  for (const input of calls) {
    const answer = ops.call("create", input);
    if (!answer.ok) throw new Error(answer.why);
  }
}

test("closing a blocker names the phases it freed, in number order, and not a task with another open blocker", () => {
  const { mine, theirs } = twoCallers();
  try {
    freedWork(mine);
    expect(mine.call("done", { task: "#2" })).toEqual({
      ok: true,
      text: '#2 "Blocker" · done · now ready: #3 Phase x, #4 Phase y: start them together',
    });
  } finally {
    mine.close();
    theirs.close();
  }
});

test("task_update to done or dropped names the freed work the same way", () => {
  for (const status of ["done", "dropped"] as const) {
    const { mine, theirs } = twoCallers();
    try {
      freedWork(mine);
      expect(mine.call("update", { task: "#2", status })).toEqual({
        ok: true,
        text: `#2 "Blocker" · ${status} · now ready: #3 Phase x, #4 Phase y: start them together`,
      });
    } finally {
      mine.close();
      theirs.close();
    }
  }
});

test("the last open blocker closing frees the held task, alone: start it, not them", () => {
  const { mine, theirs } = twoCallers();
  try {
    freedWork(mine);
    expect(mine.call("done", { task: "#2" }).ok).toBe(true);
    expect(mine.call("done", { task: "#5" })).toEqual({
      ok: true,
      text: '#5 "Other blocker" · done · now ready: #6 Held: start it',
    });
  } finally {
    mine.close();
    theirs.close();
  }
});

test("another session's task that the close freed is not named", () => {
  const { mine, theirs } = twoCallers();
  try {
    expect(mine.call("create", { subject: "Blocker" }).ok).toBe(true);
    expect(theirs.call("create", { subject: "Theirs", blocked_by: ["#1"] }).ok).toBe(true);
    expect(mine.call("done", { task: "#1" })).toEqual({ ok: true, text: '#1 "Blocker" · done' });
  } finally {
    mine.close();
    theirs.close();
  }
});

test("a freed phase with no live task and a dropped task are not named", () => {
  const { mine, theirs } = twoCallers();
  try {
    expect(mine.call("create", { subject: "Plan", plan: "p" }).ok).toBe(true);
    expect(mine.call("create", { subject: "Blocker" }).ok).toBe(true);
    expect(
      mine.call("create", { subject: "Empty", plan: "p", phase: "E", blocked_by: ["#2"] }).ok,
    ).toBe(true);
    expect(mine.call("create", { subject: "Freed", blocked_by: ["#2"] }).ok).toBe(true);
    expect(mine.call("create", { subject: "Dropped", blocked_by: ["#2"] }).ok).toBe(true);
    expect(mine.call("update", { task: "#5", status: "dropped" }).ok).toBe(true);
    expect(mine.call("done", { task: "#2" })).toEqual({
      ok: true,
      text: '#2 "Blocker" · done · now ready: #4 Freed: start it',
    });
  } finally {
    mine.close();
    theirs.close();
  }
});

test("a close that frees nothing keeps its old text", () => {
  const { mine, theirs } = twoCallers();
  try {
    expect(mine.call("create", { subject: "Plain" }).ok).toBe(true);
    expect(mine.call("done", { task: "#1" })).toEqual({ ok: true, text: '#1 "Plain" · done' });
    expect(mine.call("create", { subject: "Next" }).ok).toBe(true);
    expect(mine.call("update", { task: "#2", status: "dropped" })).toEqual({
      ok: true,
      text: '#2 "Next" · dropped',
    });
  } finally {
    mine.close();
    theirs.close();
  }
});

test("a step claimed in another session's plan does not make that plan this session's default", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  // Two Claude processes, so a claim names a process.
  const open = (sessionId: string, pid: number) =>
    createTaskOps({
      env: hookEnv(),
      stateDir,
      cwd: () => cwd,
      caller: () => ({ sessionId, pid, procStart: `${pid}0`, cwd }),
    });
  const theirs = open("x", 301);
  const mine = open("y", 302);
  try {
    for (const input of [
      { subject: "Auth", plan: "auth" },
      { subject: "G1", plan: "auth", phase: "G1" },
      { subject: "Step one", parent: "#2" },
      { subject: "G2", plan: "auth", phase: "G2" },
      { subject: "Step two", parent: "#4" },
    ])
      expect(theirs.call("create", input).ok).toBe(true);
    expect(theirs.call("update", { task: "#2", status: "in_progress" }).ok).toBe(true);
    // This session, with no plan, starts their step: it claims it, and owns that one task.
    expect(mine.call("update", { task: "#3", status: "in_progress" }).ok).toBe(true);
    expect(mine.call("create", { subject: "Mine", phase: "Y1" })).toEqual({
      ok: false,
      why: "A phase belongs to a plan: give plan (its slug)",
    });
  } finally {
    mine.close();
    theirs.close();
  }
});

/** Plan a (#1, in flight through its phase #2), plan b (#4, queued, its phase #5), a loose task (#7). */
function twoPlans(ops: ReturnType<typeof createTaskOps>, flying: boolean, running: boolean) {
  const calls: Record<string, unknown>[] = [
    { subject: "Plan a", plan: "a" },
    { subject: "A1", plan: "a", phase: "A1" },
    { subject: "Step a", parent: "#2" },
    { subject: "Plan b", plan: "b" },
    { subject: "B1", plan: "b", phase: "B1" },
    { subject: "Step b", parent: "#5" },
    { subject: "Fix caching", ...(running ? { status: "in_progress" } : {}) },
  ];
  for (const input of calls) {
    const answer = ops.call("create", input);
    if (!answer.ok) throw new Error(answer.why);
  }
  if (flying) {
    const started = ops.call("update", { task: "#2", status: "in_progress" });
    if (!started.ok) throw new Error(started.why);
  }
}

test("moving a running task into a queued plan while another plan is in flight is refused like a start", () => {
  const { mine, theirs } = twoCallers();
  try {
    twoPlans(mine, true, true);
    const moved = mine.call("update", { task: "#7", parent: "#5" });
    expect(moved.ok).toBe(false);
    expect(moved.ok ? "" : moved.why).toStartWith(
      'Plan "a" (#1) is in flight: your session runs one plan at a time. Do not start work in plan "b" yet.',
    );
  } finally {
    mine.close();
    theirs.close();
  }
});

test("moving a pending task into a queued plan while another plan is in flight is allowed", () => {
  const { mine, theirs } = twoCallers();
  try {
    twoPlans(mine, true, false);
    expect(mine.call("update", { task: "#7", parent: "#5" }).ok).toBe(true);
  } finally {
    mine.close();
    theirs.close();
  }
});

test("moving a running task into a plan with none in flight puts that plan in flight", () => {
  const { mine, theirs } = twoCallers();
  try {
    twoPlans(mine, false, true);
    expect(mine.call("update", { task: "#7", parent: "#5" }).ok).toBe(true);
    const listed = mine.call("list", { scope: "plan" });
    if (!listed.ok) throw new Error(listed.why);
    expect(listed.text).toContain("#4 [in flight · plan] Plan b");
    expect(listed.text).toContain("#1 [queued · plan] Plan a");
  } finally {
    mine.close();
    theirs.close();
  }
});

test("a take records the maker moving: the history shows the session and the process", () => {
  const cwd = tempDir();
  const stateDir = tempDir();
  const open = (sessionId: string, pid: number) =>
    createTaskOps({
      env: hookEnv(),
      stateDir,
      cwd: () => cwd,
      caller: () => ({ sessionId, pid, procStart: `${pid}0`, cwd }),
    });
  const first = open("a", 100);
  const second = open("b", 200);
  try {
    expect(first.call("create", { subject: "Work" }).ok).toBe(true);
    expect(second.call("take", { task: "#1" }).ok).toBe(true);
    const shown = second.call("get", { task: "#1" });
    if (!shown.ok) throw new Error(shown.why);
    expect(shown.text).toContain(
      "changed: made by session a → b; made by process 100 → process 200",
    );
  } finally {
    first.close();
    second.close();
  }
});

/**
 * Plan a (#1) and plan b (#7), a loose blocker (#2) holding a phase of a (#3), a phase of b (#8)
 * and a loose task (#10); a running phase of a (#5) puts a in flight when `flying`.
 */
function blockerAcrossPlans(ops: ReturnType<typeof createTaskOps>, flying: boolean) {
  const calls: Record<string, unknown>[] = [
    { subject: "Plan a", plan: "a" },
    { subject: "Blocker" },
    { subject: "A1", plan: "a", phase: "A1", blocked_by: ["#2"] },
    { subject: "Step a1", parent: "#3" },
    { subject: "A0", plan: "a", phase: "A0" },
    { subject: "Step a0", parent: "#5" },
    { subject: "Plan b", plan: "b" },
    { subject: "B1", plan: "b", phase: "B1", blocked_by: ["#2"] },
    { subject: "Step b1", parent: "#8" },
    { subject: "Loose", blocked_by: ["#2"] },
  ];
  for (const input of calls) {
    const answer = ops.call("create", input);
    if (!answer.ok) throw new Error(answer.why);
  }
  if (flying) expect(ops.call("update", { task: "#5", status: "in_progress" }).ok).toBe(true);
}

test("a close names only work the store would let start: another plan's phase is left out while a plan is in flight", () => {
  const { mine, theirs } = twoCallers();
  try {
    blockerAcrossPlans(mine, true);
    expect(mine.call("done", { task: "#2" })).toEqual({
      ok: true,
      text: '#2 "Blocker" · done · now ready: #3 A1, #10 Loose: start them together',
    });
  } finally {
    mine.close();
    theirs.close();
  }
});

test("with no plan in flight a freed phase of a queued plan is named: starting it puts that plan in flight", () => {
  const { mine, theirs } = twoCallers();
  try {
    blockerAcrossPlans(mine, false);
    expect(mine.call("done", { task: "#2" })).toEqual({
      ok: true,
      text: '#2 "Blocker" · done · now ready: #3 A1, #8 B1, #10 Loose: start them together',
    });
  } finally {
    mine.close();
    theirs.close();
  }
});

test("a close that frees more than the hooks' list limit caps the answer", () => {
  const { mine, theirs } = twoCallers();
  try {
    expect(mine.call("create", { subject: "Blocker" }).ok).toBe(true);
    for (let index = 1; index <= 9; index += 1)
      expect(mine.call("create", { subject: `T${index}`, blocked_by: ["#1"] }).ok).toBe(true);
    expect(mine.call("done", { task: "#1" })).toEqual({
      ok: true,
      text: '#1 "Blocker" · done · now ready: #2 T1, #3 T2, #4 T3, #5 T4, #6 T5, #7 T6, #8 T7, #9 T8, +1 more: task_list: start them together',
    });
  } finally {
    mine.close();
    theirs.close();
  }
});
