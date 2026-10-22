/**
 * The crew session's own hook (`crew-role.ts`): the card at a start, the ask refused, the report
 * block at a stop, and silence everywhere else.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { CREW_ENV } from "../crew/session";
import {
  appendCrewEvent,
  type CrewRecord,
  createCrew,
  crewBriefFile,
  crewFile,
  type NewCrew,
  readCrew,
} from "../crew/store";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { questionStep, roleCard } from "./crew-role";
import type { HookResult } from "./io";
import { addContext, toolDecision } from "./io";
import { crewRoleHook } from "./specs";

const CREW_ID = "W2-x-1a2b3c";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const T0 = Date.parse("2026-10-21T10:00:00.000Z");

/** A crew record as `crew start` writes one, with `change` over it. */
function newCrew(repo: string, change: Partial<NewCrew> = {}): NewCrew {
  return {
    base: { ref: "main", sha: SHA },
    baseRef: "main",
    branch: "crew/W2-hooks",
    effort: "high",
    files: ["src/hooks/a.ts", "src/hooks/b.ts"],
    id: CREW_ID,
    kind: "build",
    lastLine: null,
    leadName: "LEAD app plan",
    leadSessionId: "c00f9bb5-1111-2222-3333-444444444444",
    memoryMb: null,
    model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
    name: "C app W2 hooks",
    permissionMode: "auto",
    phase: "W2",
    plan: "plan",
    pr: null,
    questions: [],
    repo,
    reportPath: null,
    sessionId: null,
    shortId: null,
    slug: "hooks",
    startedAt: null,
    state: "working",
    waitsFor: [],
    worktree: join(repo, ".claude", "worktrees", "crew-W2-hooks"),
    ...change,
  };
}

/** A crew session in a fresh clone, with the environment its session runs with. */
async function crewWorld(change: Partial<NewCrew> = {}): Promise<{
  env: Record<string, string>;
  record: CrewRecord;
  repo: string;
  stateDir: string;
}> {
  const { repo } = makeClone();
  const env = { ...hookEnv(), [CREW_ENV]: CREW_ID };
  const stateDir = cliPaths(env).stateDir;
  const record = await createCrew(stateDir, newCrew(repo, change), T0);
  return { env, record, repo, stateDir };
}

/** The environment of a plain session: no crew id. */
function plainEnv(): Record<string, string> {
  return hookEnv();
}

/** A step for the crew session, so the newest step/report event is a `step`. */
async function step(stateDir: string, repo: string): Promise<void> {
  await appendCrewEvent(
    stateDir,
    repo,
    {
      crew: CREW_ID,
      lead: "c00f9bb5-1111-2222-3333-444444444444",
      name: "C app W2 hooks",
      sha: SHA,
      state: "working",
      text: "tests-green",
      type: "step",
    },
    T0,
  );
}

/** The hand-back report event of the crew session. */
async function report(stateDir: string, repo: string): Promise<void> {
  await appendCrewEvent(
    stateDir,
    repo,
    {
      crew: CREW_ID,
      lead: "c00f9bb5-1111-2222-3333-444444444444",
      name: "C app W2 hooks",
      state: "done",
      text: "done",
      type: "report",
    },
    T0,
  );
}

/** The exact Stop answer: one block, with the report step as its reason. */
function blockAnswer(): HookResult {
  return {
    stdout: JSON.stringify({
      decision: "block",
      reason:
        "No report has been handed back for this phase. Hand it back with `cc-smart-dev-kit crew report --status done` (or `--status failed` and why), then end the turn.",
    }),
  };
}

describe("a session that is not a crew session hears nothing", () => {
  test("SessionStart, Stop and the ask: all silent without CC_SMART_DEV_KIT_CREW", async () => {
    const repo = makeClone().repo;
    const env = plainEnv();
    const start = await runHook(
      crewRoleHook,
      { hook_event_name: "SessionStart", session_id: "s", cwd: repo, source: "startup" },
      env,
    );
    expect(start).toEqual({});
    const stop = await runHook(
      crewRoleHook,
      {
        hook_event_name: "Stop",
        session_id: "s",
        cwd: repo,
        last_assistant_message: "done",
      },
      env,
    );
    expect(stop).toEqual({});
    const ask = await runHook(
      crewRoleHook,
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        cwd: repo,
        tool_name: "AskUserQuestion",
        tool_input: {},
      },
      env,
    );
    expect(ask).toEqual({});
  });
});

describe("SessionStart: the role card", () => {
  test("the exact card, built from the record and the brief's path", async () => {
    const world = await crewWorld();
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    const result = await runHook(
      crewRoleHook,
      {
        hook_event_name: "SessionStart",
        session_id: "s",
        cwd: world.repo,
        source: "startup",
      },
      world.env,
    );
    const card = [
      "You are the crew session `C app W2 hooks`, phase `W2` of `plan`, for the lead `LEAD app plan`.",
      `Your brief, which is your task: ${brief}`,
      "The files this phase owns: `src/hooks/a.ts`, `src/hooks/b.ts`. Say in your report why you changed any other file.",
      "Hand the phase back with `cc-smart-dev-kit crew report --status done` (or `--status failed` and why), then end the turn.",
      'Ask your lead, never the person: `cc-smart-dev-kit crew report --question "<q>" --option "<a>" --option "<b>" --recommend <n>`',
      'Tell another crew session only a contract change or a contract question: `cc-smart-dev-kit crew tell <name…> --kind contract|question "<text>"`',
      "Git: commit on your branch `crew/W2-hooks`; never push, never open a pull request, never merge — the lead handles git.",
    ].join("\n");
    expect(result).toEqual(addContext("SessionStart", card));
    // The card is one home with the lines it names.
    expect(roleCard(world.record, brief)).toBe(card);
    expect(questionStep()).toBe(
      'cc-smart-dev-kit crew report --question "<q>" --option "<a>" --option "<b>" --recommend <n>',
    );
  });

  test("a resume and a compaction say it again; a clear does not", async () => {
    const world = await crewWorld();
    const answer = async (source: string) =>
      await runHook(
        crewRoleHook,
        { hook_event_name: "SessionStart", session_id: "s", cwd: world.repo, source },
        world.env,
      );
    for (const source of ["resume", "compact"]) {
      const said: string = JSON.parse((await answer(source)).stdout ?? "{}").hookSpecificOutput
        .additionalContext;
      expect(said).toStartWith("You are the crew session `C app W2 hooks`,");
    }
    expect(await answer("clear")).toEqual({});
  });

  test("a record the store does not have: one stderr line, never a card", async () => {
    const { repo } = makeClone();
    const env = { ...hookEnv(), [CREW_ENV]: CREW_ID };
    const result = await runHook(
      crewRoleHook,
      { hook_event_name: "SessionStart", session_id: "s", cwd: repo, source: "startup" },
      env,
    );
    expect(result).toEqual({
      stderr: `cc-smart-dev-kit crew-role: no crew session "${CREW_ID}" is recorded for ${repo}`,
    });
  });
});

describe("PreToolUse: a crew session never asks the person", () => {
  test.each(["AskUserQuestion", "ExitPlanMode"])(
    "%s is denied with the report step",
    async (tool) => {
      const { repo } = makeClone();
      const env = { ...hookEnv(), [CREW_ENV]: CREW_ID };
      const result = await runHook(
        crewRoleHook,
        {
          hook_event_name: "PreToolUse",
          session_id: "s",
          cwd: repo,
          tool_name: tool,
          tool_input: {},
        },
        env,
      );
      expect(result).toEqual(
        toolDecision(
          "deny",
          'cc-smart-dev-kit crew report --question "<q>" --option "<a>" --option "<b>" --recommend <n>',
        ),
      );
    },
  );

  test("another tool is not judged", async () => {
    const { repo } = makeClone();
    const env = { ...hookEnv(), [CREW_ENV]: CREW_ID };
    const result = await runHook(
      crewRoleHook,
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "ls" },
      },
      env,
    );
    expect(result).toEqual({});
  });

  test("a broken project file changes nothing: the deny reads no store and no config", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktree: {} });
    const env = { ...hookEnv(), [CREW_ENV]: CREW_ID };
    const result = await runHook(
      crewRoleHook,
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        cwd: repo,
        tool_name: "AskUserQuestion",
        tool_input: {},
      },
      env,
    );
    expect(result).toEqual(
      toolDecision(
        "deny",
        'cc-smart-dev-kit crew report --question "<q>" --option "<a>" --option "<b>" --recommend <n>',
      ),
    );
  });

  test("outside git it is denied the same way", async () => {
    const env = { ...hookEnv(), [CREW_ENV]: CREW_ID };
    const result = await runHook(
      crewRoleHook,
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        cwd: tempDir("outside"),
        tool_name: "ExitPlanMode",
        tool_input: {},
      },
      env,
    );
    expect(result).toEqual(
      toolDecision(
        "deny",
        'cc-smart-dev-kit crew report --question "<q>" --option "<a>" --option "<b>" --recommend <n>',
      ),
    );
  });
});

describe("Stop: the last line, one block, never context", () => {
  /** A Stop input for the crew session. */
  function stopInput(repo: string, change: Record<string, unknown> = {}) {
    return {
      hook_event_name: "Stop",
      session_id: "s",
      cwd: repo,
      last_assistant_message: "Fixed the guard. It now denies the ask.",
      ...change,
    };
  }

  test("after a step: the turn is blocked once, with the report step, and the last line is kept", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    const result = await runHook(crewRoleHook, stopInput(world.repo), world.env);
    expect(result).toEqual(blockAnswer());
    // Never `additionalContext`: a Stop hook that gives context starves hand-backs (L1a.1).
    expect(result.stdout).not.toContain("additionalContext");
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastLine).toBe(
      "Fixed the guard. It now denies the ask.",
    );
  });

  test("once: a stop that answers the block (stop_hook_active) is silent", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    const result = await runHook(
      crewRoleHook,
      stopInput(world.repo, { stop_hook_active: true }),
      world.env,
    );
    expect(result).toEqual({});
  });

  test("while background tasks run the turn is not over: silent, and no last line", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    const result = await runHook(
      crewRoleHook,
      stopInput(world.repo, { background_tasks: [{ task_id: "t1" }] }),
      world.env,
    );
    expect(result).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastLine).toBeNull();
  });

  test("no block after a report", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    await report(world.stateDir, world.repo);
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual({});
  });

  test("a step after the report is the newest word again: it blocks", async () => {
    const world = await crewWorld();
    await report(world.stateDir, world.repo);
    await step(world.stateDir, world.repo);
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual(blockAnswer());
  });

  test("a session that recorded nothing yet is not blocked", async () => {
    const world = await crewWorld();
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual({});
  });

  test("the last line is masked and clipped", async () => {
    const world = await crewWorld();
    const token = "token: abcdefghijklmnop";
    await runHook(
      crewRoleHook,
      stopInput(world.repo, { last_assistant_message: token }),
      world.env,
    );
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastLine).toBe("token: ****mnop");
    // 5 × "lorem ipsum dolor sit amet " is 135 characters; the line keeps its first 120 and a mark.
    const long = "lorem ipsum dolor sit amet ".repeat(5);
    await runHook(crewRoleHook, stopInput(world.repo, { last_assistant_message: long }), world.env);
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastLine).toBe(
      `${"lorem ipsum dolor sit amet ".repeat(4)}lorem ipsum …`,
    );
  });

  test("a broken record: one stderr line and no block", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    writeFileSync(crewFile(world.stateDir, world.repo, CREW_ID), "{ not json");
    const result = await runHook(crewRoleHook, stopInput(world.repo), world.env);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith(`cc-smart-dev-kit crew-role: Invalid `);
  });
});
