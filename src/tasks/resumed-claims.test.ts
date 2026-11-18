/**
 * A reopened session (`claude --resume`) keeps its session id in a new process, so the claims on
 * its running work name a process that is gone (`docs/claude-code-contract.md`). These tests cover
 * what the caller then sees (`planProgress`, `taskSegment`, `claimState`) and the write that
 * moves the claims to the new process (`reclaimResumed`, run by `createTaskOps`). The old
 * process here has a pid no machine runs, so `claimLive` finds its claims dead on every platform.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { cliPaths } from "../cli/paths";
import { taskSegment } from "../cli/statusline";
import { hookEnv, makeRepo } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { folderProject } from "./context";
import { createTaskOps, type TaskAnswer } from "./ops";
import { openWorkDb, workDbFile, writeWork } from "./work/db";
import { claimLive } from "./work/identity";
import { allTasks, claimState, eventsOf, ownerOf, resumedClaim } from "./work/queries";
import { planProgress } from "./work/read";
import { createTask, ensurePlanTask, layPhase, reclaimResumed, updateTask } from "./work/store";
import type { Result, Who } from "./work/types";

const OLD: Who = { sessionId: "resumed", pid: 999999991, procStart: "111" };
const RESUMED: Who = { sessionId: "resumed", pid: 999999992, procStart: "222" };
const OTHER: Who = { sessionId: "someone-else", pid: 999999993, procStart: "333" };
const PROJECT = "p";

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function said(answer: TaskAnswer): string {
  if (!answer.ok) throw new Error(answer.why);
  return answer.text;
}

/** A store where the old process runs a phase of a plan, in progress, with its claim. */
function runningPhase() {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  ok(ensurePlanTask(db, { project: PROJECT, plan: "big", subject: "Big plan" }, OLD, 1));
  const phase = ok(
    writeWork(db, () =>
      layPhase(db, { project: PROJECT, plan: "big", phase: "A", subject: "First phase" }, OLD, 2),
    ),
  ).task;
  ok(updateTask(db, phase.id, { status: "in_progress" }, OLD, 3));
  return { paths, db, phase };
}

test("a resumed caller sees its plan: planProgress and the status line rows", () => {
  const { paths, db, phase } = runningPhase();
  try {
    const progress = planProgress(paths, PROJECT, RESUMED);
    if (progress.state !== "ready") throw new Error(progress.state);
    expect(progress.value?.task.id).toBe(phase.id);
    expect(taskSegment(paths, PROJECT, RESUMED)).toBe(
      "Plan · Big plan\nPhases 0/1 · First phase\nTasks 0/0",
    );
    // Another session's caller, in another process, sees nothing of it.
    expect(planProgress(paths, PROJECT, OTHER)).toEqual({ state: "ready", value: null });
    expect(taskSegment(paths, PROJECT, OTHER)).toBeNull();
  } finally {
    db.close();
  }
});

test("claimState: mine for the resumed caller, free for another session id, and a live claim stays another's", () => {
  const { db, phase } = runningPhase();
  try {
    const task = allTasks(db, PROJECT).find((t) => t.id === phase.id);
    if (task === undefined) throw new Error("no phase");
    expect(claimState(task, claimLive, RESUMED)).toBe("mine");
    expect(claimState(task, claimLive, OTHER)).toBe("free");
    expect(claimState(task, claimLive, undefined)).toBe("free");
    // The same session id in a second, live process: it is that process's work, never the caller's.
    expect(claimState(task, () => true, RESUMED)).toBe("another session");
    expect(resumedClaim(task.claim, RESUMED, () => true)).toBe(false);
    // A caller with no process or no session id has no resumed claim either.
    expect(resumedClaim(task.claim, { ...RESUMED, pid: null }, claimLive)).toBe(false);
    expect(resumedClaim(task.claim, { ...RESUMED, sessionId: null }, claimLive)).toBe(false);
  } finally {
    db.close();
  }
});

test("reclaimResumed moves the dead process's claims to the caller and records it in the history", () => {
  const { db, phase } = runningPhase();
  try {
    const step = ok(
      createTask(
        db,
        { project: PROJECT, plan: "big", subject: "A step", parentId: phase.id },
        OLD,
        4,
      ),
    );
    ok(updateTask(db, step.id, { status: "in_progress" }, OLD, 5));
    expect(ok(reclaimResumed(db, RESUMED, 10, claimLive))).toBe(2);
    for (const id of [phase.id, step.id]) {
      const task = allTasks(db, PROJECT).find((t) => t.id === id);
      expect(task?.claim).toEqual({
        pid: RESUMED.pid as number,
        procStart: "222",
        sessionId: "resumed",
      });
      const event = eventsOf(db, id).at(-1);
      expect(event?.action).toBe("changed");
      expect(event?.changes).toEqual({
        claim: [`process ${OLD.pid}`, `process ${RESUMED.pid}`],
      });
      expect(event?.reason).toBe("claim moved to the resumed session's process");
      expect(event?.pid).toBe(RESUMED.pid as number);
    }
    // Nothing is left to move: the second call writes no history.
    const events = eventsOf(db, phase.id).length;
    expect(ok(reclaimResumed(db, RESUMED, 11, claimLive))).toBe(0);
    expect(eventsOf(db, phase.id).length).toBe(events);
  } finally {
    db.close();
  }
});

test("reclaimResumed never takes a live claim, another session's claim, or a processless caller's", () => {
  const { db, phase } = runningPhase();
  try {
    const claimOf = () => allTasks(db, PROJECT).find((t) => t.id === phase.id)?.claim;
    const before = claimOf();
    expect(ok(reclaimResumed(db, RESUMED, 10, () => true))).toBe(0);
    expect(ok(reclaimResumed(db, OTHER, 10, claimLive))).toBe(0);
    expect(ok(reclaimResumed(db, { ...RESUMED, pid: null }, 10, claimLive))).toBe(0);
    expect(ok(reclaimResumed(db, { ...RESUMED, sessionId: null }, 10, claimLive))).toBe(0);
    expect(claimOf()).toEqual(before);
    expect(
      eventsOf(db, phase.id).every(
        (e) => e.reason !== "claim moved to the resumed session's process",
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});

/** A temp repo and store, with the task operations for any caller and a reader of the rows. */
function opsWorld() {
  const repo = makeRepo();
  const env = hookEnv();
  const paths = cliPaths(env);
  const project = folderProject(repo);
  /** The operations for a caller; a function names it at each call, so a test can switch it. */
  const opsFor = (who: Who | (() => Who)) =>
    createTaskOps({
      stateDir: paths.stateDir,
      env,
      cwd: () => repo,
      caller: () => ({ ...(typeof who === "function" ? who() : who), cwd: repo }),
    });
  const tasks = () => {
    const db = openWorkDb(workDbFile(paths), { mode: "hook" });
    try {
      return allTasks(db, project);
    } finally {
      db.close();
    }
  };
  /** Plan #1, phase #2 (in progress, claimed by `who`) and a step #3, all made by `who`. */
  const startPhase = (who: Who) => {
    const ops = opsFor(who);
    try {
      said(ops.call("create", { subject: "Plan", plan: "big" }));
      said(ops.call("create", { subject: "Area", plan: "big", phase: "A" }));
      said(ops.call("create", { subject: "Step", parent: "#2" }));
      said(ops.call("update", { task: "#2", status: "in_progress" }));
    } finally {
      ops.close();
    }
  };
  return { paths, project, opsFor, tasks, startPhase, stateDir: paths.stateDir };
}

test("the next task call by the resumed session moves its claims, whatever the call", () => {
  const { paths, project, opsFor, tasks, startPhase } = opsWorld();
  const claimOfPhase = () => tasks().find((t) => t.number === 2)?.claim;
  startPhase(OLD);
  expect(claimOfPhase()?.pid).toBe(OLD.pid as number);
  // Another session's call leaves the claim where it is.
  const other = opsFor(OTHER);
  try {
    said(other.call("list", { scope: "project" }));
  } finally {
    other.close();
  }
  expect(claimOfPhase()?.pid).toBe(OLD.pid as number);
  // The reopened session's first call, a read, moves it: the status line reads the store alone.
  const resumed = opsFor(RESUMED);
  try {
    said(resumed.call("list", { scope: "project" }));
    expect(claimOfPhase()).toEqual({
      pid: RESUMED.pid as number,
      procStart: "222",
      sessionId: "resumed",
    });
    expect(taskSegment(paths, project, RESUMED)).toContain("Phases 0/1 · Area");
  } finally {
    resumed.close();
  }
});

// `/clear` keeps the process and gives the session a new id.
const P: Who = { sessionId: "before-clear", pid: 999999994, procStart: "444" };
const AFTER_CLEAR: Who = { ...P, sessionId: "after-clear" };
const Q: Who = { sessionId: "after-clear", pid: 999999995, procStart: "555" };
const Q_BEFORE: Who = { sessionId: "before-clear", pid: 999999996, procStart: "666" };

test("a /clear moves the process's claims and made-by rows to the new session id, so a later resume finds them", () => {
  const { paths, project, opsFor, tasks, startPhase } = opsWorld();
  startPhase(P);
  // A closed task #4 the process made keeps its old session id: closed work needs no owner.
  const before = opsFor(P);
  try {
    said(before.call("create", { subject: "Loose" }));
    said(before.call("done", { task: "#4", outcome: "dropped", note: "not needed" }));
  } finally {
    before.close();
  }
  const open = () => tasks().filter((t) => t.number !== 4);
  const closedMadeBy = () => tasks().find((t) => t.number === 4)?.createdBy;
  expect(open().map((t) => t.createdBy)).toEqual(["before-clear", "before-clear", "before-clear"]);
  expect(tasks().find((t) => t.number === 2)?.claim?.sessionId).toBe("before-clear");
  const afterClear = opsFor(AFTER_CLEAR);
  try {
    said(afterClear.call("list", { scope: "project" }));
  } finally {
    afterClear.close();
  }
  // The claim and the three rows the process made say the new session id; the process is the same.
  expect(open().map((t) => t.createdBy)).toEqual(["after-clear", "after-clear", "after-clear"]);
  expect(closedMadeBy()).toBe("before-clear");
  expect(open().map((t) => t.creator?.sessionId)).toEqual([
    "after-clear",
    "after-clear",
    "after-clear",
  ]);
  expect(tasks().find((t) => t.number === 2)?.claim).toEqual({
    pid: P.pid as number,
    procStart: "444",
    sessionId: "after-clear",
  });
  // The process is gone, and the session is reopened as Q under the id it had after the clear.
  expect(taskSegment(paths, project, Q)).toContain("Phases 0/1 · Area");
  expect(taskSegment(paths, project, Q_BEFORE)).toBeNull();
  const owns = (who: Who) => open().filter(ownerOf(who)).length;
  expect(owns(Q)).toBe(3);
  expect(owns(Q_BEFORE)).toBe(0);
  // A caller under the old id finds nothing to move; the resumed one moves the claim.
  const old = opsFor(Q_BEFORE);
  try {
    said(old.call("list", { scope: "project" }));
  } finally {
    old.close();
  }
  expect(tasks().find((t) => t.number === 2)?.claim?.pid).toBe(P.pid as number);
  const resumed = opsFor(Q);
  try {
    said(resumed.call("list", { scope: "project" }));
  } finally {
    resumed.close();
  }
  expect(tasks().find((t) => t.number === 2)?.claim?.pid).toBe(Q.pid as number);
});

test("a read answers when the claims cannot be moved, with one line saying so; a write fails", () => {
  const { stateDir, opsFor, startPhase } = opsWorld();
  startPhase(OLD);
  const holder = new Database(workDbFile({ stateDir }));
  let caller: Who = OTHER;
  const resumed = opsFor(() => caller);
  try {
    // The store is open already (another session's call, which moves nothing). Now the resumed
    // session calls while another connection holds the write lock: moving the claim must wait,
    // then give up.
    said(resumed.call("list", { scope: "project" }));
    caller = RESUMED;
    holder.run("BEGIN IMMEDIATE");
    const read = resumed.call("list", { scope: "project" });
    if (!read.ok) throw new Error(read.why);
    const lines = read.text.split("\n");
    expect(lines[0]).toContain("#1");
    expect(lines.at(-1)).toMatch(
      /^claims of this session not moved: .*locked.*; the next call retries$/,
    );
    const write = resumed.call("note", { task: "#2", text: "a note" });
    expect(write.ok).toBe(false);
    // The move's own failure, not the note's later write: the write stops before it changes anything.
    if (!write.ok) expect(write.why).toMatch(/^claims of this session not moved: .*locked/);
    // The lock is gone: the next call moves the claim and prints no line.
    holder.run("ROLLBACK");
    const retried = resumed.call("list", { scope: "project" });
    if (!retried.ok) throw new Error(retried.why);
    expect(retried.text).not.toContain("not moved");
  } finally {
    holder.close();
    resumed.close();
  }
}, 20_000);

test("reclaimResumed re-stamps the caller's work in every project, not only the one it calls in", () => {
  const db = openWorkDb(workDbFile({ stateDir: tempDir() }), { mode: "write" });
  try {
    // Process P claims one task in each of two repos, then a `/clear` gives it a new session id.
    const ids = ["p", "q"].map((project) => {
      const task = ok(createTask(db, { project, subject: `Work in ${project}` }, P, 1));
      ok(updateTask(db, task.id, { status: "in_progress" }, P, 2));
      return { project, id: task.id };
    });
    // Another session's open task in a third repo is never read or changed.
    const other = ok(createTask(db, { project: "r", subject: "Not ours" }, OTHER, 3));
    expect(ok(reclaimResumed(db, AFTER_CLEAR, 10, claimLive))).toBe(2);
    for (const { project, id } of ids) {
      const task = allTasks(db, project).find((t) => t.id === id);
      expect(task?.claim?.sessionId).toBe("after-clear");
      expect(task?.createdBy).toBe("after-clear");
    }
    expect(allTasks(db, "r").find((t) => t.id === other.id)?.createdBy).toBe("someone-else");
  } finally {
    db.close();
  }
});
