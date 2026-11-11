/**
 * The builder-finish hook: a builder subagent never hands back while the task its brief names
 * (`Your task: #<n>`) still has open blocking steps. The Claude Code side — a SubagentStop
 * `{"decision":"block","reason":…}` continues the subagent with that reason, and the second
 * stop carries `stop_hook_active: true` — is the contract row `subagent-background` proved on
 * 2.1.308 (`docs/claude-code-contract.md` § Hooks).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { taskContext } from "../tasks/context";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { updateTask } from "../tasks/work/store";
import type { Result, WorkTask, WorkType } from "../tasks/work/types";
import { legacyCreateTask as createTask } from "../testing/claude-mem-db";
import { hookEnv, makeRepo, runEntry, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { briefTaskNumber, handBackReason } from "./builder-finish";
import { builderFinishHook } from "./specs";
import { firstPromptText } from "./transcript";

const SESSION = "11111111-2222-3333-4444-555555555555";
const AGENT = "0a1b2c3d4e5f60718";
const who = { sessionId: SESSION, pid: 12, procStart: "34" };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

/** A repo with the project's file. */
function repoWithConfig(): string {
  const repo = makeRepo();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
  return repo;
}

/**
 * A subagent transcript the way Claude Code writes one: the brief is the first line, a
 * `user` entry whose `message.content` is the launch prompt as a string (seen on 2.1.308 in
 * this machine's own subagent transcripts), then the agent's own turns.
 */
function transcript(brief: string | Array<{ type: string; text: string }>): string {
  const path = join(tempDir("builder-transcript"), "agent.jsonl");
  const lines = [
    {
      parentUuid: null,
      isSidechain: true,
      agentId: AGENT,
      type: "user",
      message: { role: "user", content: brief },
    },
    {
      isSidechain: true,
      agentId: AGENT,
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Your task: #999" }] },
    },
  ];
  writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  return path;
}

/** A SubagentStop input for `cwd`, with the fields a test overrides. */
function stop(cwd: string, overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: "SubagentStop",
    session_id: SESSION,
    cwd,
    agent_id: AGENT,
    agent_type: "cc-smart-dev-kit:builder",
    stop_hook_active: false,
    ...overrides,
  };
}

interface Step {
  subject: string;
  /** The step's parent, by its index in the list; the phase when left out. */
  under?: number;
  type?: WorkType;
  status?: "in_progress" | "done" | "dropped";
}

/**
 * The phase task (#1) and its steps (#2 on, in order) in the task store `env` reads, under the
 * project key the task server gives `folder` (`taskContext`).
 */
function seed(env: Record<string, string>, folder: string, steps: Step[]): void {
  const context = taskContext(folder, env);
  if (!context.ok) throw new Error(context.why);
  const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
  try {
    const phase = value(
      createTask(db, { project: context.project, subject: "G2 the phase", kind: "phase" }, who, 1),
    );
    const made: WorkTask[] = [];
    for (const step of steps) {
      const parent = step.under === undefined ? phase : made[step.under];
      made.push(
        value(
          createTask(
            db,
            {
              project: context.project,
              subject: step.subject,
              parentId: parent?.id ?? phase.id,
              ...(step.type === undefined ? {} : { type: step.type }),
            },
            who,
            2,
          ),
        ),
      );
    }
    // Closed from the deepest up, so a parent is never closed over an open child.
    for (let index = made.length - 1; index >= 0; index -= 1) {
      const status = steps[index]?.status;
      const task = made[index];
      if (status !== undefined && task !== undefined)
        value(updateTask(db, task.id, { status }, who, 3));
    }
  } finally {
    db.close();
  }
}

/** The block, written by hand: the open steps of #1, each with the call that closes it. */
const BLOCK_TWO = JSON.stringify({
  decision: "block",
  reason: [
    "Task #1 still has 2 open blocking steps. Close each one, then hand back:",
    '- #2 Write the test: finish it and close it with `task_done` (task "#2", with evidence), or drop it with `task_done` (task "#2", outcome "dropped") and a note saying why.',
    '- #3 Wire the entry: finish it and close it with `task_done` (task "#3", with evidence), or drop it with `task_done` (task "#3", outcome "dropped") and a note saying why.',
  ].join("\n"),
});

describe("the hook", () => {
  test("open blocking steps: one block naming each, in progress first, at any depth", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [
      { subject: "Write the test", status: "in_progress" },
      { subject: "Wire the entry", under: 0 },
      { subject: "Already done", status: "done" },
    ]);
    const result = await runHook(
      builderFinishHook,
      stop(repo, { agent_transcript_path: transcript("Your task: #1\n\nRead it with task_get.") }),
      env,
    );
    expect(result).toEqual({ stdout: BLOCK_TWO });
    // Never `additionalContext`: the block's reason is the whole message.
    expect(result.stdout).not.toContain("additionalContext");
  });

  test("every step done or dropped: the hand-back goes through", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [
      { subject: "Write the test", status: "done" },
      { subject: "Not needed", status: "dropped" },
    ]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({});
  });

  test("a non-blocking open step holds nothing, nor does a blocking one under it", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [
      { subject: "Later, maybe", type: "non-blocking" },
      { subject: "Its own part", under: 0 },
      { subject: "Write the test", status: "done" },
    ]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({});
  });

  test("no `Your task:` line in the brief: nothing to check", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [{ subject: "Write the test" }]);
    for (const brief of [
      "Build the phase. Task #1 is the plan.",
      "Your task: build the phase (#1).",
      "Note: Your task: #1",
    ]) {
      expect(
        await runHook(
          builderFinishHook,
          stop(repo, { agent_transcript_path: transcript(brief) }),
          env,
        ),
      ).toEqual({});
    }
  });

  test("the rules-maintainer is judged exactly as a builder is", async () => {
    // The build skill sends instruction-file phases to it, with the same `Your task:` line.
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [
      { subject: "Write the test", status: "in_progress" },
      { subject: "Wire the entry", under: 0 },
      { subject: "Already done", status: "done" },
    ]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, {
          agent_type: "cc-smart-dev-kit:rules-maintainer",
          agent_transcript_path: transcript("Your task: #1"),
        }),
        env,
      ),
    ).toEqual({ stdout: BLOCK_TWO });
  });

  test("another agent type: none of its business", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [{ subject: "Write the test" }]);
    for (const agent of [
      "cc-smart-dev-kit:senior-engineer",
      "general-purpose",
      "builder-helper",
      "rules-maintainer-helper",
    ]) {
      expect(
        await runHook(
          builderFinishHook,
          stop(repo, { agent_type: agent, agent_transcript_path: transcript("Your task: #1") }),
          env,
        ),
      ).toEqual({});
    }
    // No type at all is the same.
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_type: undefined, agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({});
  });

  test("never twice: the stop a block caused (stop_hook_active) is silent", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [{ subject: "Write the test" }]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { stop_hook_active: true, agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({});
  });

  test("a task that is not there, and a task list that was never made: silent", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    // No store at all yet.
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({});
    seed(env, repo, [{ subject: "Write the test" }]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: transcript("Your task: #42") }),
        env,
      ),
    ).toEqual({});
  });

  test("from the builder's own linked worktree, it finds the main checkout's tasks", async () => {
    const repo = repoWithConfig();
    const worktree = join(repo, ".claude", "worktrees", `agent-${AGENT}`);
    git(repo, "worktree", "add", "-q", "-b", `worktree-agent-${AGENT}`, worktree);
    const env = hookEnv();
    // The task server writes under the main checkout's key; the agent stops in its worktree.
    seed(env, repo, [
      { subject: "Write the test", status: "in_progress" },
      { subject: "Wire the entry", under: 0 },
    ]);
    expect(
      await runHook(
        builderFinishHook,
        stop(worktree, { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({ stdout: BLOCK_TWO });
  });

  test("no project file: machine-wide, it judges the same (the task list is the person's)", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    seed(env, repo, [
      { subject: "Write the test", status: "in_progress" },
      { subject: "Wire the entry", under: 0 },
    ]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({ stdout: BLOCK_TWO });
  });

  test("the brief as text blocks counts the same as a string", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    seed(env, repo, [{ subject: "Write the test" }]);
    const result = await runHook(
      builderFinishHook,
      stop(repo, {
        agent_transcript_path: transcript([
          { type: "text", text: "Read it first.\nYour task: #1" },
        ]),
      }),
      env,
    );
    expect(JSON.parse(result.stdout ?? "{}").decision).toBe("block");
  });

  test("fails open: no transcript, a transcript that is not there, a store it cannot read", async () => {
    const repo = repoWithConfig();
    const env = hookEnv();
    expect(await runHook(builderFinishHook, stop(repo), env)).toEqual({});
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: join(tempDir("gone"), "agent.jsonl") }),
        env,
      ),
    ).toEqual({});
    const store = workDbFile(cliPaths(env));
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, "not a database at all, not even close to one\n".repeat(20));
    const result = await runHook(
      builderFinishHook,
      stop(repo, { agent_transcript_path: transcript("Your task: #1") }),
      env,
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit builder-finish: the task list cannot be read (",
    );
  });

  test("ownHooks lists it: the project's own copy runs alone", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["builder-finish"] });
    const env = hookEnv();
    seed(env, repo, [{ subject: "Write the test" }]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({});
  });

  test("a broken project file: it judges the same, and any other agent stays silent", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "cc-smart-dev-kit.json"), "{ not json");
    const env = hookEnv();
    seed(env, repo, [
      { subject: "Write the test", status: "in_progress" },
      { subject: "Wire the entry", under: 0 },
    ]);
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({ stdout: BLOCK_TWO });
    expect(
      await runHook(
        builderFinishHook,
        stop(repo, {
          agent_type: "general-purpose",
          agent_transcript_path: transcript("Your task: #1"),
        }),
        env,
      ),
    ).toEqual({});
  });

  test("outside git: silent", async () => {
    const env = hookEnv();
    expect(
      await runHook(
        builderFinishHook,
        stop(tempDir("no-git"), { agent_transcript_path: transcript("Your task: #1") }),
        env,
      ),
    ).toEqual({});
  });
});

describe("its readers", () => {
  test.each([8, 10])("caps %i blocking steps", (count) => {
    const steps = Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      subject: "Step",
    }));
    const text = handBackReason(20, steps);
    expect(text.split("\n")[0]).toBe(
      `Task #20 still has ${count} open blocking steps. Close each one, then hand back:`,
    );
    expect(text.split("\n").filter((line) => line.startsWith("- #"))).toHaveLength(8);
    expect(text).toContain(
      '- #8 Step: finish it and close it with `task_done` (task "#8", with evidence), or drop it with `task_done` (task "#8", outcome "dropped") and a note saying why.',
    );
    expect(text.includes("+2 more: task_list")).toBe(count === 10);
    expect(text).not.toContain("- #9");
  });
  test("briefTaskNumber: the exact line, the first one", () => {
    expect(briefTaskNumber("Your task: #85\n\nCaller's rulings")).toBe(85);
    expect(briefTaskNumber("Intro\nYour task: #7  \r\nYour task: #8")).toBe(7);
    expect(briefTaskNumber("Your task: #85 and more")).toBeNull();
    expect(briefTaskNumber("your task: #85")).toBeNull();
    expect(briefTaskNumber("Your task: 85")).toBeNull();
  });

  test("firstPromptText: the first user entry's text, never a later one", () => {
    expect(firstPromptText(transcript("Your task: #3"))).toBe("Your task: #3");
    const path = join(tempDir("builder-transcript"), "agent.jsonl");
    writeFileSync(
      path,
      [
        "not json",
        JSON.stringify({ type: "summary", summary: "Your task: #1" }),
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "text", text: "A" }, { type: "image" }, { type: "text", text: "B" }],
          },
        }),
        JSON.stringify({ type: "user", message: { content: "Your task: #2" } }),
      ].join("\n"),
    );
    expect(firstPromptText(path)).toBe("A\nB");
    expect(firstPromptText(join(tempDir("gone"), "agent.jsonl"))).toBeNull();
  });
});

describe("the entry, run as Claude Code runs it", () => {
  test("input that is not JSON: one stderr line, exit 0, nothing on stdout", () => {
    const run = runEntry("builder-finish", "not json", hookEnv());
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("cc-smart-dev-kit builder-finish: the hook input is not JSON\n");
  });
});
