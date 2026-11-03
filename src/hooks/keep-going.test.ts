/**
 * The keep-going guard: the main session does not end a turn while a phase of its plan is in
 * progress, nothing runs that will wake it, and no `Waiting for:` line says what it waits on.
 * The Stop input's fields it reads (`stop_hook_active`, `last_assistant_message`,
 * `background_tasks`) and a Stop block continuing the turn are in
 * `docs/claude-code-contract.md` § Hooks.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { projectKey } from "../tasks/context";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "../tasks/work/db";
import { createTask, layPhase, updateTask } from "../tasks/work/store";
import type { Who, WorkTask } from "../tasks/work/types";
import { hookEnv, makeRepo, runHook, writeClaudeFile, writeSessionRecord } from "../testing/hooks";
import { sessionProcessIdentity } from "../testing/session-record";
import { tempDir } from "../testing/temp";
import { keepGoingWouldBlockAt, waitsOnSomething } from "./keep-going";
import { keepGoingHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";

/**
 * The Claude process this test's hook sees as its caller: the test's own parent, the process
 * `callerOf` finds among the hook's ancestors (as `guards.test.ts` does).
 */
const ME: Who = {
  sessionId: SESSION,
  pid: process.ppid,
  procStart: sessionProcessIdentity(process.ppid).procStart ?? null,
};
const OTHER: Who = { sessionId: "other", pid: 999_999, procStart: "1" };

/** The two reasons, written by hand. */
const BLOCK_WITH_NEXT = JSON.stringify({
  decision: "block",
  reason:
    "Phase #2 G1 the guard is still in progress, and no subagent runs. Start #3 G2 the portal view now (dispatch its builder), close #2 with `task_done`, or end the turn with a `Waiting for: <what>` line.",
});
const BLOCK_NO_NEXT = JSON.stringify({
  decision: "block",
  reason:
    "Phase #2 G1 the guard is still in progress, and no subagent runs. Close #2 with `task_done`, or record its blocker with `task_note` and end the turn with a `Waiting for: <what>` line.",
});

interface World {
  repo: string;
  env: Record<string, string>;
  db: WorkDb;
}

/** A repo, a hook environment whose live session is this test's caller, and an open store. */
function world(): World {
  const repo = makeRepo();
  const env = hookEnv();
  writeSessionRecord(env, { sessionId: SESSION, cwd: repo, name: "main", pid: process.ppid });
  const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
  return { repo, env, db };
}

function phase(w: World, plan: string, id: string, subject: string, blockedBy: string[] = []) {
  const task = writeWork(
    w.db,
    () =>
      layPhase(
        w.db,
        { project: projectKey(w.repo), plan, phase: id, subject, blockedBy },
        { sessionId: null, pid: null, procStart: null },
        1,
      ).task,
  );
  if (!task.ok) throw new Error(task.why);
  return task.value;
}

function start(w: World, task: WorkTask, who: Who): void {
  const done = updateTask(w.db, task.id, { status: "in_progress" }, who, 2);
  if (!done.ok) throw new Error(done.why);
}

/** Plan `plan-a`: #1 the plan, #2 G1 in progress by this process, #3 G2 ready, #4 G3 blocked by #3. */
function busyPlan(w: World): void {
  const g1 = phase(w, "plan-a", "G1", "G1 the guard");
  const g2 = phase(w, "plan-a", "G2", "G2 the portal view");
  phase(w, "plan-a", "G3", "G3 the docs", [g2.id]);
  start(w, g1, ME);
}

function stop(repo: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: "Stop",
    session_id: SESSION,
    cwd: repo,
    stop_hook_active: false,
    last_assistant_message: "The reader is in. Next I build the hook.",
    ...extra,
  };
}

describe("keep-going: the block", () => {
  test("a phase in progress and nothing running: one block naming the next ready phase", async () => {
    const w = world();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", {});
    busyPlan(w);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({ stdout: BLOCK_WITH_NEXT });
  });

  test("an empty background list is no background work", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo, { background_tasks: [] }), w.env)).toEqual({
      stdout: BLOCK_WITH_NEXT,
    });
  });

  test("no phase ready: close it, or record its blocker", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    phase(w, "plan-a", "G2", "G2 the portal view", [g1.id]);
    start(w, g1, ME);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({ stdout: BLOCK_NO_NEXT });
  });

  test("two phases in progress: both named", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    const g2 = phase(w, "plan-a", "G2", "G2 the portal view");
    start(w, g1, ME);
    start(w, g2, OTHER);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason:
          "Phases #2 G1 the guard, #3 G2 the portal view are still in progress, and no subagent runs. Close #2, #3 with `task_done`, or record each blocker with `task_note` and end the turn with a `Waiting for: <what>` line.",
      }),
    });
  });

  test("a claim on a task under a phase makes the plan this session's", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    start(w, g1, OTHER);
    const step = createTask(
      w.db,
      { project: projectKey(w.repo), subject: "Step", parentId: g1.id, plan: "plan-a" },
      ME,
      3,
    );
    if (!step.ok) throw new Error(step.why);
    start(w, step.value, ME);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({ stdout: BLOCK_NO_NEXT });
  });

  test("with no project file at all: the store is the person's own, so it still blocks", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({ stdout: BLOCK_WITH_NEXT });
  });

  test("no last message in the input: the transcript's last answer is read", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    const file = join(tempDir("keep-going-transcript"), "session.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done for now." }] } })}\n`,
    );
    const input = stop(w.repo, { transcript_path: file });
    delete input.last_assistant_message;
    expect(await runHook(keepGoingHook, input, w.env)).toEqual({ stdout: BLOCK_WITH_NEXT });
  });
});

describe("keep-going: silent", () => {
  test("background work runs: Claude Code wakes the session when it lands", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    const input = stop(w.repo, {
      background_tasks: [{ id: "a1b2c3", type: "agent", status: "running", description: "G2" }],
    });
    expect(await runHook(keepGoingHook, input, w.env)).toEqual({});
  });

  test.each([
    "Builders are out.\nWaiting for: the G2 builder",
    "**Waiting for:** the person's answer",
    "- waiting for: CI on the pull request",
  ])("a `Waiting for:` line says the wait: %j", async (said) => {
    const w = world();
    busyPlan(w);
    w.db.close();
    expect(
      await runHook(keepGoingHook, stop(w.repo, { last_assistant_message: said }), w.env),
    ).toEqual({});
  });

  test("a `Waiting for:` line in the transcript's last answer", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    const file = join(tempDir("keep-going-transcript"), "session.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Waiting for: the person" }] } })}\n`,
    );
    const input = stop(w.repo, { transcript_path: file });
    delete input.last_assistant_message;
    expect(await runHook(keepGoingHook, input, w.env)).toEqual({});
  });

  test("the stop its own block caused never blocks again", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo, { stop_hook_active: true }), w.env)).toEqual(
      {},
    );
  });

  test("no phase in progress", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    phase(w, "plan-a", "G2", "G2 the portal view");
    const step = createTask(
      w.db,
      { project: projectKey(w.repo), subject: "Step", parentId: g1.id, plan: "plan-a" },
      ME,
      3,
    );
    if (!step.ok) throw new Error(step.why);
    start(w, step.value, ME);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("a phase in progress in another session's plan only", async () => {
    const w = world();
    const g1 = phase(w, "plan-b", "G1", "G1 their guard");
    phase(w, "plan-b", "G2", "G2 their view");
    start(w, g1, OTHER);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("no session record: the caller is unknown, so nothing is its own", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
    const g1 = writeWork(
      db,
      () =>
        layPhase(
          db,
          { project: projectKey(repo), plan: "plan-a", phase: "G1", subject: "G1 the guard" },
          ME,
          1,
        ).task,
    );
    if (!g1.ok) throw new Error(g1.why);
    const started = updateTask(db, g1.value.id, { status: "in_progress" }, ME, 2);
    if (!started.ok) throw new Error(started.why);
    db.close();
    expect(await runHook(keepGoingHook, stop(repo), env)).toEqual({});
  });

  test("no last message and no transcript: it cannot tell, so it lets the turn end", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    const input = stop(w.repo);
    delete input.last_assistant_message;
    expect(await runHook(keepGoingHook, input, w.env)).toEqual({});
  });

  test("no task store: nothing to read", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    writeSessionRecord(env, { sessionId: SESSION, cwd: repo, name: "main", pid: process.ppid });
    expect(await runHook(keepGoingHook, stop(repo), env)).toEqual({});
  });

  test("a store that cannot be read: one stderr line, no block", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    writeSessionRecord(env, { sessionId: SESSION, cwd: repo, name: "main", pid: process.ppid });
    const file = workDbFile(cliPaths(env));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "not a database");
    expect(await runHook(keepGoingHook, stop(repo), env)).toEqual({
      stderr: "cc-smart-dev-kit keep-going: file is not a database",
    });
  });

  test("a broken project file: one stderr line, no block", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { worktree: {} });
    const result = await runHook(keepGoingHook, stop(w.repo), w.env);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit keep-going: ");
  });

  test("the project runs its own copy: ownHooks silences it", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { ownHooks: ["keep-going"] });
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("outside git", async () => {
    const env = hookEnv();
    expect(await runHook(keepGoingHook, stop(tempDir("not-git")), env)).toEqual({});
  });

  test("another event", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    expect(
      await runHook(keepGoingHook, { ...stop(w.repo), hook_event_name: "SubagentStop" }, w.env),
    ).toEqual({});
  });
});

describe("waitsOnSomething", () => {
  test.each([
    ["Waiting for: the builders", true],
    ["Done.\n  Waiting for: CI", true],
    ["> Waiting for: the person", true],
    ["I am waiting for: nothing", false],
    ["Waiting for the builders", false],
    ["", false],
  ])("%j → %j", (said, expected) => {
    expect(waitsOnSomething(said)).toBe(expected);
  });
});

describe("keepGoingWouldBlockAt: what the notifier asks", () => {
  test("true where the hook blocks, false where it is silent or switched off", () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    expect(keepGoingWouldBlockAt(stop(w.repo), w.env)).toBe(true);
    expect(keepGoingWouldBlockAt(stop(w.repo, { stop_hook_active: true }), w.env)).toBe(false);
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { ownHooks: ["keep-going"] });
    expect(keepGoingWouldBlockAt(stop(w.repo), w.env)).toBe(false);
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { worktree: {} });
    expect(keepGoingWouldBlockAt(stop(w.repo), w.env)).toBe(false);
  });
});
