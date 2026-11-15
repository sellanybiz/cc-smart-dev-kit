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
import { createTaskOps } from "../tasks/ops";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "../tasks/work/db";
import { callerOf } from "../tasks/work/identity";
import { allTasks } from "../tasks/work/queries";
import { createTask, layPhase, updateTask } from "../tasks/work/store";
import type { Who, WorkTask } from "../tasks/work/types";
import { hookEnv, makeRepo, runHook, writeClaudeFile, writeSessionRecord } from "../testing/hooks";
import { sessionProcessIdentity } from "../testing/session-record";
import { tempDir } from "../testing/temp";
import {
  keepGoingAnswer,
  keepGoingReason,
  keepGoingWouldBlockAt,
  waitsOnSomething,
} from "./keep-going";
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
    "Phase #2 G1 the guard is still in progress, and no subagent runs. Start a fresh builder on it, start #3 G2 the portal view now (dispatch its builder), close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
});
const BLOCK_NO_NEXT = JSON.stringify({
  decision: "block",
  reason:
    "Phase #2 G1 the guard is still in progress, and no subagent runs. Start a fresh builder on it, close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
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

/** A phase laid by `by` (the session under test unless told): its plan is `by`'s own. */
function phase(
  w: World,
  plan: string,
  id: string,
  subject: string,
  blockedBy: string[] = [],
  by: Who = ME,
) {
  const task = writeWork(
    w.db,
    () =>
      layPhase(w.db, { project: projectKey(w.repo), plan, phase: id, subject, blockedBy }, by, 1)
        .task,
  );
  if (!task.ok) throw new Error(task.why);
  return task.value;
}

function start(w: World, task: WorkTask, who: Who): void {
  const done = updateTask(w.db, task.id, { status: "in_progress" }, who, 2);
  if (!done.ok) throw new Error(done.why);
}

/** One step under a phase: a phase with no task is not ready, as the store refuses to start it. */
function addStep(w: World, parent: WorkTask): void {
  const step = createTask(
    w.db,
    { project: projectKey(w.repo), subject: "Step", parentId: parent.id, plan: parent.plan },
    { sessionId: null, pid: null, procStart: null },
    1,
  );
  if (!step.ok) throw new Error(step.why);
}

/** Plan `plan-a`: #1 the plan, #2 G1 in progress by this process, #3 G2 ready, #4 G3 blocked by #3. */
function busyPlan(w: World): { g1: WorkTask; g2: WorkTask } {
  const g1 = phase(w, "plan-a", "G1", "G1 the guard");
  const g2 = phase(w, "plan-a", "G2", "G2 the portal view");
  phase(w, "plan-a", "G3", "G3 the docs", [g2.id]);
  addStep(w, g2);
  start(w, g1, ME);
  return { g1, g2 };
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
  test.each([8, 10])("caps %i phases and their recovery actions", (count) => {
    const phases = Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      subject: "Phase",
      plan: "plan",
      agent: `builder-${index + 1}`,
    }));
    const text = keepGoingReason(phases, []);
    expect(text).toStartWith(`${count} phases are still in progress`);
    expect(text).toContain(
      "#1 Phase, #2 Phase, #3 Phase, #4 Phase, #5 Phase, #6 Phase, #7 Phase, #8 Phase",
    );
    expect(text).toContain("resume the builder for #8 (`builder-8`) with `SendMessage`");
    expect(text).not.toContain("builder-9");
    expect(text.includes("+2 more: task_list")).toBe(count === 10);
    expect(text).toContain("`task_done`");
    expect(text).toContain("`task_note`");
  });
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

  test("a pending phase with no task is not named as ready: the store refuses to start it", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    phase(w, "plan-a", "G2", "G2 the empty phase");
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
          "2 phases are still in progress, and no subagent runs: #2 G1 the guard, #3 G2 the portal view. Start fresh builders on #2, #3, close #2, #3 with `task_done`, or record each blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
      }),
    });
  });

  test("a claim on a task under a phase counts that phase, but never starts the other session's next phase", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard", [], OTHER);
    const g2 = phase(w, "plan-a", "G2", "G2 their view", [], OTHER);
    addStep(w, g2);
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

describe("keep-going: stalled state", () => {
  const reason =
    "Phase #2 G1 the guard is still in progress, and no subagent runs. Start a fresh builder on it, start #3 G2 the portal view now (dispatch its builder), close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.";

  test.each([
    [
      "string feedback",
      { type: "user", isMeta: true, message: { content: `Stop hook feedback:\n${reason}` } },
      {},
    ],
    [
      "array feedback with other hooks",
      {
        type: "user",
        message: {
          content: [{ type: "text", text: `Stop hook feedback:\nOther reminder\n${reason}` }],
        },
      },
      {},
    ],
    [
      "sidechain feedback",
      { type: "user", isSidechain: true, message: { content: `Stop hook feedback:\n${reason}` } },
      { stdout: BLOCK_WITH_NEXT },
    ],
    [
      "different reason",
      {
        type: "user",
        message: { content: "Stop hook feedback:\nPhase #9 Other is still in progress." },
      },
      { stdout: BLOCK_WITH_NEXT },
    ],
    [
      "ordinary prose",
      { type: "assistant", message: { content: reason } },
      { stdout: BLOCK_WITH_NEXT },
    ],
    [
      "an answer that quotes the whole feedback",
      {
        type: "assistant",
        message: { content: [{ type: "text", text: `Stop hook feedback:\n${reason}` }] },
      },
      { stdout: BLOCK_WITH_NEXT },
    ],
  ])("%s", async (_name, entry, expected) => {
    const w = world();
    busyPlan(w);
    w.db.close();
    const file = join(tempDir("keep-going-feedback"), "session.jsonl");
    writeFileSync(file, `broken first line\n${JSON.stringify(entry)}\n{`);
    const input = stop(w.repo, { transcript_path: file });
    expect(await runHook(keepGoingHook, input, w.env)).toEqual(expected);
    expect(keepGoingWouldBlockAt(input, w.env)).toBe("stdout" in expected);
  });

  /** A main-session answer that calls `name`, as Claude Code records a tool call. */
  function callOf(name: string): Record<string, unknown> {
    return {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "toolu_1", name, input: {} }] },
    };
  }
  const feedback = {
    type: "user",
    isMeta: true,
    message: { content: `Stop hook feedback:\n${reason}` },
  };

  test.each([
    ["an Agent launch after the reminder blocks again", [feedback, callOf("Agent")], true],
    ["a builder resumed after the reminder blocks again", [feedback, callOf("SendMessage")], true],
    ["an old Task launch after the reminder blocks again", [feedback, callOf("Task")], true],
    ["a workflow run after the reminder blocks again", [feedback, callOf("Workflow")], true],
    ["other tool calls after the reminder stay silent", [feedback, callOf("Bash")], false],
    [
      "the same reminder given again after new work stays silent",
      [feedback, callOf("Agent"), feedback],
      false,
    ],
    ["a launch before the reminder stays silent", [callOf("Agent"), feedback], false],
    [
      "a launch inside a subagent's own conversation stays silent",
      [feedback, { ...callOf("Agent"), isSidechain: true }],
      false,
    ],
  ])("%s", async (_name, entries, blocks) => {
    const w = world();
    busyPlan(w);
    w.db.close();
    const file = join(tempDir("keep-going-reset"), "session.jsonl");
    writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    expect(await runHook(keepGoingHook, stop(w.repo, { transcript_path: file }), w.env)).toEqual(
      blocks ? { stdout: BLOCK_WITH_NEXT } : {},
    );
  });

  test("a blank agent names no builder: start a fresh one", async () => {
    const w = world();
    const { g1 } = busyPlan(w);
    const changed = updateTask(w.db, g1.id, { agent: "  " }, ME, 3);
    if (!changed.ok) throw new Error(changed.why);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({
      stdout: BLOCK_WITH_NEXT,
    });
  });

  test.each([
    [
      "another agent",
      { agent: "d4e5f6" },
      "Phase #2 G1 the guard is still in progress, and no subagent runs. Resume its builder (`d4e5f6`) with `SendMessage` (or start a fresh one), start #3 G2 the portal view now (dispatch its builder), close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
    ],
    [
      "changed phase",
      { subject: "G1 the reader" },
      "Phase #2 G1 the reader is still in progress, and no subagent runs. Start a fresh builder on it, start #3 G2 the portal view now (dispatch its builder), close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
    ],
  ])("same prior feedback but %s blocks again", async (_name, patch, expectedReason) => {
    const w = world();
    const { g1 } = busyPlan(w);
    const changed = updateTask(w.db, g1.id, patch, ME, 3);
    if (!changed.ok) throw new Error(changed.why);
    w.db.close();
    const file = join(tempDir("changed-feedback"), "session.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify({ type: "user", isMeta: true, message: { content: `Stop hook feedback:\n${reason}` } })}\n`,
    );
    expect(await runHook(keepGoingHook, stop(w.repo, { transcript_path: file }), w.env)).toEqual({
      stdout: JSON.stringify({ decision: "block", reason: expectedReason }),
    });
  });

  test("a changed next ready phase earns another reminder", async () => {
    const w = world();
    const { g2 } = busyPlan(w);
    const changed = updateTask(w.db, g2.id, { subject: "G2 the reader" }, ME, 3);
    if (!changed.ok) throw new Error(changed.why);
    w.db.close();
    const file = join(tempDir("changed-ready"), "session.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify({ type: "user", message: { content: `Stop hook feedback:\n${reason}` } })}\n`,
    );
    expect(await runHook(keepGoingHook, stop(w.repo, { transcript_path: file }), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason:
          "Phase #2 G1 the guard is still in progress, and no subagent runs. Start a fresh builder on it, start #3 G2 the reader now (dispatch its builder), close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
      }),
    });
  });

  test("an unreadable transcript keeps today's decision", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    expect(
      await runHook(
        keepGoingHook,
        stop(w.repo, { transcript_path: join(tempDir("missing-transcript"), "absent") }),
        w.env,
      ),
    ).toEqual({ stdout: BLOCK_WITH_NEXT });
  });

  test("a recorded agent is named for resumption", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    start(w, g1, ME);
    const changed = updateTask(w.db, g1.id, { agent: "a1b2c3" }, ME, 3);
    if (!changed.ok) throw new Error(changed.why);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason:
          "Phase #2 G1 the guard is still in progress, and no subagent runs. Resume its builder (`a1b2c3`) with `SendMessage` (or start a fresh one), close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
      }),
    });
  });

  test("mixed phases name which builder to resume and which to start", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    const g2 = phase(w, "plan-a", "G2", "G2 the portal view");
    start(w, g1, ME);
    start(w, g2, OTHER);
    const changed = updateTask(w.db, g1.id, { agent: "a1b2c3" }, ME, 3);
    if (!changed.ok) throw new Error(changed.why);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason:
          "2 phases are still in progress, and no subagent runs: #2 G1 the guard, #3 G2 the portal view. Resume the builder for #2 (`a1b2c3`) with `SendMessage` (or start a fresh one), start a fresh builder on #3, close #2, #3 with `task_done`, or record each blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
      }),
    });
  });
});

/** The reason's closing words when no phase runs, written by hand. */
const READY_TAIL = "end the turn with a `Waiting for: <what>` line.";

/**
 * Plan `plan-a`, laid as #1 (its task), then `count` phases each holding a step: #2, #3, ... The
 * plan is made by `who` and its task started by it (in flight); for null it is this session's,
 * and its task stays pending (parked).
 */
function readyWave(w: World, count: number, who: Who | null): WorkTask[] {
  const phases = Array.from({ length: count }, (_, index) => {
    const made = phase(w, "plan-a", `R${index + 1}`, `Ready ${index + 1}`, [], who ?? ME);
    addStep(w, made);
    return made;
  });
  const row = allTasks(w.db, projectKey(w.repo)).find((t) => t.kind === "plan");
  if (row === undefined) throw new Error("no plan task");
  if (who !== null) start(w, row, who);
  return phases;
}

describe("keep-going: ready phases", () => {
  test("the plan in flight, no phase running, two ready: one block naming both", async () => {
    const w = world();
    readyWave(w, 2, ME);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason: `2 phases are ready to start, and no subagent runs: #2 Ready 1, #4 Ready 2. Start them together now (dispatch one builder for each), or record why they wait with \`task_note\` and ${READY_TAIL}`,
      }),
    });
  });

  test("one ready phase: the same block, in the singular", async () => {
    const w = world();
    readyWave(w, 1, ME);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason: `Phase #2 Ready 1 is ready to start, and no subagent runs. Start it now (dispatch its builder), or record why it waits with \`task_note\` and ${READY_TAIL}`,
      }),
    });
  });

  test("the plan parked (its task pending): no block", async () => {
    const w = world();
    readyWave(w, 2, null);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("ready phases of a plan that is not in flight: no block", async () => {
    const w = world();
    // A queued plan this process holds a claim in (a step started), its plan task never started.
    const first = phase(w, "plan-a", "Q1", "Queued one");
    phase(w, "plan-a", "Q2", "Queued two");
    addStep(w, first);
    const step = createTask(
      w.db,
      { project: projectKey(w.repo), subject: "Step", parentId: first.id, plan: "plan-a" },
      ME,
      3,
    );
    if (!step.ok) throw new Error(step.why);
    start(w, step.value, ME);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("another session's plan in flight: no block", async () => {
    const w = world();
    readyWave(w, 2, OTHER);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("a subagent running: no block", async () => {
    const w = world();
    readyWave(w, 2, ME);
    w.db.close();
    expect(
      await runHook(keepGoingHook, stop(w.repo, { background_tasks: [{ id: "a1" }] }), w.env),
    ).toEqual({});
  });

  test("a Waiting for: line: no block", async () => {
    const w = world();
    readyWave(w, 2, ME);
    w.db.close();
    expect(
      await runHook(
        keepGoingHook,
        stop(w.repo, { last_assistant_message: "Waiting for: the person's yes on the plan." }),
        w.env,
      ),
    ).toEqual({});
  });

  test("a blocked phase and an empty phase are not named", async () => {
    const w = world();
    const [first] = readyWave(w, 2, ME);
    if (first === undefined) throw new Error("no phase");
    phase(w, "plan-a", "B1", "Blocked", [first.id]);
    phase(w, "plan-a", "E1", "Empty");
    w.db.close();
    const answer = await runHook(keepGoingHook, stop(w.repo), w.env);
    expect(answer.stdout).toContain(
      "2 phases are ready to start, and no subagent runs: #2 Ready 1, #4 Ready 2.",
    );
    expect(answer.stdout).not.toContain("Blocked");
    expect(answer.stdout).not.toContain("Empty");
  });

  test("a phase in progress and three ready: all three named, together", async () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "Running");
    start(w, g1, ME);
    for (const [index, name] of ["Alpha", "Beta", "Gamma"].entries()) {
      addStep(w, phase(w, "plan-a", `R${index}`, name));
    }
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason:
          "Phase #2 Running is still in progress, and no subagent runs. Start a fresh builder on it, start #3 Alpha, #5 Beta, #7 Gamma together now (dispatch their builders), close #2 with `task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>` line. Never move a phase back to pending only to end the turn.",
      }),
    });
  });

  test("ten ready phases: the first eight named, the rest counted", () => {
    const ready = Array.from({ length: 10 }, (_, index) => ({
      number: index + 2,
      subject: "Phase",
      plan: "plan",
      agent: null,
    }));
    expect(keepGoingReason([], ready)).toBe(
      `10 phases are ready to start, and no subagent runs: #2 Phase, #3 Phase, #4 Phase, #5 Phase, #6 Phase, #7 Phase, #8 Phase, #9 Phase, +2 more: task_list. Start them together now (dispatch one builder for each), or record why they wait with \`task_note\` and ${READY_TAIL}`,
    );
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
    const g1 = phase(w, "plan-b", "G1", "G1 their guard", [], OTHER);
    phase(w, "plan-b", "G2", "G2 their view", [], OTHER);
    start(w, g1, OTHER);
    w.db.close();
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("another session's plan in the same project is never stamped on this session's task", async () => {
    const w = world();
    w.db.close();
    const ops = (who: Who) =>
      createTaskOps({
        stateDir: cliPaths(w.env).stateDir,
        env: w.env,
        cwd: () => w.repo,
        caller: () => ({ ...who, cwd: w.repo }),
      });
    const theirs = ops(OTHER);
    const mine = ops(ME);
    try {
      expect(theirs.call("create", { subject: "Auth", plan: "auth" }).ok).toBe(true);
      expect(theirs.call("create", { subject: "G1 the guard", plan: "auth", phase: "G1" }).ok).toBe(
        true,
      );
      expect(theirs.call("create", { subject: "Step", parent: "#2" }).ok).toBe(true);
      expect(theirs.call("update", { task: "#2", status: "in_progress" }).ok).toBe(true);
      expect(mine.call("create", { subject: "Fix a typo", status: "in_progress" }).ok).toBe(true);
    } finally {
      theirs.close();
      mine.close();
    }
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({});
  });

  test("no phase in progress: the caller is never looked up", () => {
    const w = world();
    const g1 = phase(w, "plan-a", "G1", "G1 the guard");
    w.db.close();
    let asked = 0;
    const findCaller: typeof callerOf = (facts) => {
      asked += 1;
      return callerOf(facts);
    };
    const project = { root: w.repo, mainCheckout: null };
    expect(keepGoingAnswer(stop(w.repo), project, cliPaths(w.env), w.env, findCaller)).toEqual({});
    expect(asked).toBe(0);
    const db = openWorkDb(workDbFile(cliPaths(w.env)), { mode: "write" });
    start({ ...w, db }, g1, ME);
    db.close();
    expect(keepGoingAnswer(stop(w.repo), project, cliPaths(w.env), w.env, findCaller)).toEqual({
      stdout: BLOCK_NO_NEXT,
    });
    expect(asked).toBe(1);
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

  test("a broken project file: it reads no setting of it, so it judges the same", async () => {
    const w = world();
    busyPlan(w);
    w.db.close();
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { worktree: {} });
    expect(await runHook(keepGoingHook, stop(w.repo), w.env)).toEqual({ stdout: BLOCK_WITH_NEXT });
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
    ["## Waiting for: the G2 builder", true],
    ["1. Waiting for: CI", true],
    ["2) Waiting for: CI", true],
    ["### **Waiting for:** the person", true],
    ["I am waiting for: nothing", false],
    ["## Status: Waiting for: nothing", false],
    ["1. The builder is Waiting for: CI", false],
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
    // A broken file judges the same as the hook does: it reads no setting of it.
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { worktree: {} });
    expect(keepGoingWouldBlockAt(stop(w.repo), w.env)).toBe(true);
  });
});
