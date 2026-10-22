/**
 * The crew session's own hook (`crew-role.ts`): the card at a start, the ask refused, the report
 * block at a stop, the pause at a model limit, and silence everywhere else.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  readCrewEvents,
} from "../crew/store";
import { formatLimitState, type LimitState } from "../gateway/limit-state";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { crewRoleAnswer, questionStep, roleCard } from "./crew-role";
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

describe("D42: a model limit pauses the crew session", () => {
  const NOW = Date.parse("2026-10-21T22:00:00.000Z");
  const MINUTE = 60_000;

  /** The state file the router writes, in the world's home. */
  function writeState(env: Record<string, string>, state: LimitState): void {
    const file = cliPaths(env).gatewayStateFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, formatLimitState(state));
  }

  /** A breaker record for the worker slot, open now, its one target resting. */
  function breaker(): LimitState {
    return {
      breakers: {
        "cc-smart-dev-kit-worker": {
          held: 2,
          lastAt: NOW,
          since: Date.parse("2026-10-21T21:05:00.000Z"),
          targets: [{ status: 429, target: "omniroute:glm-5.3-flash", until: NOW + 60 * MINUTE }],
        },
      },
      fallbacks: {},
      limits: {},
      version: 1,
    };
  }

  /** A current plan limit for the session's own model. */
  function limit(): LimitState {
    return {
      fallbacks: {},
      limits: {
        "claude-sonnet-5-5": {
          claim: "seven_day",
          resetsAt: Date.parse("2026-10-21T22:30:00.000Z") / 1000,
          seenAt: NOW,
        },
      },
      version: 1,
    };
  }

  /** A worker-slot crew session: its model reaches the worker slot, as `crew start` records it. */
  function workerWorld(change: Partial<NewCrew> = {}) {
    return crewWorld({
      model: {
        named: "sonnet",
        resolved: "claude-sonnet-5-5",
        slot: "cc-smart-dev-kit-worker",
        tier: null,
      },
      ...change,
    });
  }

  /** A StopFailure input for the crew session. */
  function stopFailure(repo: string, change: Record<string, unknown> = {}) {
    return {
      hook_event_name: "StopFailure",
      session_id: "s",
      cwd: repo,
      error: "rate_limit",
      last_assistant_message: "You've hit your limit · resets 22:30",
      ...change,
    };
  }

  test("its slot's breaker: paused with the slot and when it opened, and one exact line", async () => {
    const world = await workerWorld();
    writeState(world.env, breaker());
    const answer = await crewRoleAnswer(
      stopFailure(world.repo),
      "StopFailure",
      world.env,
      cliPaths(world.env),
      world.repo,
      { nowMs: NOW, timeZone: "UTC" },
    );
    // Claude Code ignores a StopFailure hook's output: nothing is printed.
    expect(answer).toEqual({});
    const record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("paused");
    expect(record?.waitingFor).toEqual({
      kind: "slot",
      since: "2026-10-21T21:05:00.000Z",
      slot: "cc-smart-dev-kit-worker",
    });
    expect(record?.lastPause).toEqual({ backoffMs: 0, since: "2026-10-21T22:00:00.000Z" });
    expect(
      readCrewEvents(world.stateDir, world.repo).events.map((one) => [
        one.type,
        one.state,
        one.text,
      ]),
    ).toEqual([
      ["created", "working", null],
      ["state", "paused", "worker slot limited since 21:05; goes on by itself when it answers"],
    ]);
  });

  test("Claude's own limit next: its model and reset time", async () => {
    const world = await workerWorld();
    writeState(world.env, limit());
    expect(
      await crewRoleAnswer(
        stopFailure(world.repo),
        "StopFailure",
        world.env,
        cliPaths(world.env),
        world.repo,
        { nowMs: NOW, timeZone: "UTC" },
      ),
    ).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toEqual({
      kind: "claude-limit",
      model: "claude-sonnet-5-5",
      resetsAt: "2026-10-21T22:30:00.000Z",
    });
    expect(readCrewEvents(world.stateDir, world.repo).events.at(-1)?.text).toBe(
      "claude-sonnet-5-5 is at its limit, resets 22:30; goes on by itself when it answers once the limit lifts",
    );
  });

  test("nothing the router explains: an unknown wait, with the error in its line", async () => {
    const world = await workerWorld();
    writeState(world.env, { fallbacks: {}, limits: {}, version: 1 });
    await crewRoleAnswer(
      stopFailure(world.repo, { error: "server_error" }),
      "StopFailure",
      world.env,
      cliPaths(world.env),
      world.repo,
      { nowMs: NOW, timeZone: "UTC" },
    );
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toEqual({
      kind: "unknown",
      since: "2026-10-21T22:00:00.000Z",
    });
    expect(readCrewEvents(world.stateDir, world.repo).events.at(-1)?.text).toBe(
      "it stopped on server_error; the watch goes on with it once a model answers",
    );
  });

  test("through the frame, as Claude Code runs it: an overloaded_error pauses too, and prints nothing", async () => {
    const world = await workerWorld();
    writeState(world.env, breaker());
    const result = await runHook(
      crewRoleHook,
      stopFailure(world.repo, { error: "overloaded_error" }),
      world.env,
    );
    expect(result).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("paused");
  });

  test("a pause again within 15 minutes carries the doubled hold-off", async () => {
    const world = await workerWorld();
    writeState(world.env, breaker());
    const options = { nowMs: NOW, timeZone: "UTC" };
    await crewRoleAnswer(
      stopFailure(world.repo),
      "StopFailure",
      world.env,
      cliPaths(world.env),
      world.repo,
      options,
    );
    await crewRoleAnswer(
      stopFailure(world.repo),
      "StopFailure",
      world.env,
      cliPaths(world.env),
      world.repo,
      { nowMs: NOW + 10 * MINUTE, timeZone: "UTC" },
    );
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastPause).toEqual({
      backoffMs: 5 * MINUTE,
      since: "2026-10-21T22:10:00.000Z",
    });
  });

  test("outside a crew session: nothing moves, whatever the state file says", async () => {
    const world = await workerWorld();
    writeState(world.env, breaker());
    const plain = plainEnv();
    expect(await runHook(crewRoleHook, stopFailure(world.repo), plain)).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("working");
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toBeUndefined();
  });

  test("an error that is no limit pauses nothing", async () => {
    const world = await workerWorld();
    writeState(world.env, breaker());
    for (const error of ["authentication_failed", "billing_error", "invalid_request"]) {
      expect(await runHook(crewRoleHook, stopFailure(world.repo, { error }), world.env)).toEqual(
        {},
      );
    }
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("working");
  });

  test("a crew session whose phase ended or that waits in the queue pauses nothing", async () => {
    for (const state of ["done", "failed", "handoff", "merged", "removed", "stopped", "queued"]) {
      const world = await workerWorld({ state });
      writeState(world.env, breaker());
      expect(await runHook(crewRoleHook, stopFailure(world.repo), world.env)).toEqual({});
      expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe(state);
    }
  });

  test("a record with no slot never takes the worker's breaker for its own", async () => {
    const world = await crewWorld();
    writeState(world.env, breaker());
    await crewRoleAnswer(
      stopFailure(world.repo),
      "StopFailure",
      world.env,
      cliPaths(world.env),
      world.repo,
      { nowMs: NOW, timeZone: "UTC" },
    );
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toEqual({
      kind: "unknown",
      since: "2026-10-21T22:00:00.000Z",
    });
  });

  test("a broken record is one stderr line and no pause", async () => {
    const world = await workerWorld();
    writeState(world.env, breaker());
    writeFileSync(crewFile(world.stateDir, world.repo, CREW_ID), "{ not json");
    const result = await runHook(crewRoleHook, stopFailure(world.repo), world.env);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith(`cc-smart-dev-kit crew-role: Invalid `);
  });
});
