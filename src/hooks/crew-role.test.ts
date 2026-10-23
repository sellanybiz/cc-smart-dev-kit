/**
 * The crew session's own hook (`crew-role.ts`): the card at a start, the session's own folder
 * checked against its worktree (H101), the ask refused, the report block at a stop, the pause at
 * a model limit, and silence everywhere else.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { firstPrompt } from "../crew/brief";
import { CREW_ENV } from "../crew/session";
import {
  answerCrewQuestion,
  appendCrewEvent,
  type CrewRecord,
  createCrew,
  crewBriefFile,
  crewEventsFile,
  crewFile,
  type NewCrew,
  readCrew,
  readCrewEvents,
  readStopState,
  writeStopState,
} from "../crew/store";
import { resumeText } from "../crew/wait";
import { formatLimitState, type LimitState } from "../gateway/limit-state";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import {
  crewRoleAnswer,
  questionStep,
  reportStep,
  roleCard,
  wrongFolderCard,
  wrongFolderReason,
} from "./crew-role";
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
  const env = { ...hookEnv(), [CREW_ENV]: change.id ?? CREW_ID };
  const stateDir = cliPaths(env).stateDir;
  const record = await createCrew(stateDir, newCrew(repo, change), T0);
  return { env, record, repo, stateDir };
}

/**
 * The real worktree of the record `newCrew` makes: `git worktree add` on its branch, at HEAD.
 * Its session starts in it, so its SessionStart input's `cwd` is this folder.
 */
function makeWorktree(repo: string): string {
  const worktree = join(repo, ".claude", "worktrees", "crew-W2-hooks");
  git(repo, "worktree", "add", "-q", "-b", "crew/W2-hooks", worktree, "HEAD");
  return worktree;
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
    // A crew session starts in its worktree: its SessionStart input's `cwd` is that folder.
    const worktree = makeWorktree(world.repo);
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    const result = await runHook(
      crewRoleHook,
      {
        hook_event_name: "SessionStart",
        session_id: "s",
        cwd: worktree,
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
    const worktree = makeWorktree(world.repo);
    const answer = async (source: string) =>
      await runHook(
        crewRoleHook,
        { hook_event_name: "SessionStart", session_id: "s", cwd: worktree, source },
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

describe("H101: the session checks its own folder against its worktree", () => {
  test("in its worktree, a starting record becomes working, and the card is the normal one", async () => {
    const world = await crewWorld({ startedAt: "2026-10-21T09:00:00.000Z", state: "starting" });
    const worktree = makeWorktree(world.repo);
    const result = await runHook(
      crewRoleHook,
      { hook_event_name: "SessionStart", session_id: "s", cwd: worktree, source: "startup" },
      world.env,
    );
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    expect(result).toEqual(addContext("SessionStart", roleCard(world.record, brief)));
    const record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("working");
    // The launch's own start time stays: the launcher recorded when the session started.
    expect(record?.startedAt).toBe("2026-10-21T09:00:00.000Z");
    // One state event: the lead's watch says the session reached its worktree.
    expect(
      readCrewEvents(world.stateDir, world.repo).events.map((one) => [
        one.type,
        one.state,
        one.text,
      ]),
    ).toEqual([
      ["created", "starting", null],
      ["state", "working", "started in its worktree"],
    ]);
  });

  test("outside its worktree: failed with the reason, and a card that says stop", async () => {
    const world = await crewWorld({ state: "starting" });
    const worktree = join(world.repo, ".claude", "worktrees", "crew-W2-hooks");
    // What `claude agents --json` reports at once for a `-w` launch (2.1.308): the main
    // checkout. The session's own `cwd` is the truth, and it is not the worktree.
    const result = await runHook(
      crewRoleHook,
      { hook_event_name: "SessionStart", session_id: "s", cwd: world.repo, source: "startup" },
      world.env,
    );
    const card = wrongFolderCard(world.record, world.repo);
    expect(result).toEqual(addContext("SessionStart", card));
    expect(card).toContain(
      `You are the crew session \`C app W2 hooks\`, and you are in \`${world.repo}\`, not in your worktree \`${worktree}\`.`,
    );
    expect(card).toContain(
      "Do nothing here — change no file, run no command — and end your turn now.",
    );
    // The record is failed, with the reason: the lead's monitor hears it, and its watch stops
    // the session (D35).
    const record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("failed");
    expect(
      readCrewEvents(world.stateDir, world.repo).events.map((one) => [
        one.type,
        one.state,
        one.text,
      ]),
    ).toEqual([
      ["created", "starting", null],
      ["state", "failed", wrongFolderReason(world.record, world.repo)],
    ]);
  });

  test("a symlink that leads out of the worktree is outside it", async () => {
    const world = await crewWorld();
    const worktree = makeWorktree(world.repo);
    // A name inside the worktree that really is the main checkout: the real path decides, so a
    // session that entered through the link is not mistaken for one in its worktree.
    const out = join(worktree, "out-link");
    symlinkSync(world.repo, out);
    const result = await runHook(
      crewRoleHook,
      { hook_event_name: "SessionStart", session_id: "s", cwd: out, source: "startup" },
      world.env,
    );
    expect(result).toEqual(addContext("SessionStart", wrongFolderCard(world.record, out)));
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("failed");
  });

  test("a phase that already ended keeps its state: a resumed merged session is told to stop, still merged", async () => {
    const world = await crewWorld({ state: "merged" });
    const result = await runHook(
      crewRoleHook,
      { hook_event_name: "SessionStart", session_id: "s", cwd: world.repo, source: "resume" },
      world.env,
    );
    expect(result).toEqual(addContext("SessionStart", wrongFolderCard(world.record, world.repo)));
    // `merged` is what a dependent phase waits for, and `crew rm` reads it: failing it would keep
    // that phase queued for ever.
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("merged");
    expect(readCrewEvents(world.stateDir, world.repo).events.map((one) => one.state)).toEqual([
      "merged",
    ]);
  });

  test("a folder inside the worktree is the worktree: the normal card", async () => {
    const world = await crewWorld();
    const worktree = makeWorktree(world.repo);
    const inside = join(worktree, "src");
    mkdirSync(inside, { recursive: true });
    const result = await runHook(
      crewRoleHook,
      { hook_event_name: "SessionStart", session_id: "s", cwd: inside, source: "startup" },
      world.env,
    );
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    expect(result).toEqual(addContext("SessionStart", roleCard(world.record, brief)));
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("working");
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

  test("F3: the Stop reads the log from its saved byte, and remembers the newest step or report", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual(blockAnswer());
    // The cursor is at the log's end, with the signal it read: the next Stop reads only what is new.
    expect(readStopState(world.stateDir, world.repo, CREW_ID)).toEqual({
      last: "step",
      offset: readCrewEvents(world.stateDir, world.repo).offset,
    });
    // Nothing new since: the newest word of the whole session is still the step, so it blocks.
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual(blockAnswer());
    await report(world.stateDir, world.repo);
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual({});
    expect(readStopState(world.stateDir, world.repo, CREW_ID)).toMatchObject({ last: "report" });
    await step(world.stateDir, world.repo);
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual(blockAnswer());
  });

  test("F3: only events after the saved byte decide the block", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    // A cursor already past that step, whose newest word it read was a report: the step is
    // history the Stop before it already read, not news for this one.
    writeStopState(world.stateDir, world.repo, CREW_ID, {
      last: "report",
      offset: readCrewEvents(world.stateDir, world.repo).offset,
    });
    expect(await runHook(crewRoleHook, stopInput(world.repo), world.env)).toEqual({});
    // A step after the cursor is news: the turn ended mid-phase, with no report.
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

describe("D55: the person's own prompt is recorded, and a delivery that is not theirs is not", () => {
  /** A UserPromptSubmit input for the crew session. */
  function promptInput(repo: string, prompt: string) {
    return { hook_event_name: "UserPromptSubmit", session_id: "s", cwd: repo, prompt };
  }

  /** The `person` events the hook's run left for this crew session. */
  function personEvents(stateDir: string, repo: string, id: string = CREW_ID) {
    return readCrewEvents(stateDir, repo).events.filter(
      (event) => event.crew === id && event.type === "person",
    );
  }

  /** A record with one question the lead has answered `agoMs` ago. */
  async function answered(agoMs: number, answer: string) {
    const world = await crewWorld({
      questions: [
        {
          answer: null,
          answeredAt: null,
          askedAt: new Date(Date.now() - agoMs - 60_000).toISOString(),
          options: ["keep the guard", "drop the guard"],
          question: "keep the guard or drop it?",
          recommended: 1,
        },
      ],
    });
    await answerCrewQuestion(
      world.stateDir,
      world.repo,
      CREW_ID,
      0,
      answer,
      Date.now() - agoMs,
      "working",
    );
    return world;
  }

  test("the person's prompt: one event with its first line, and the exact line of context", async () => {
    const world = await crewWorld();
    const result = await runHook(
      crewRoleHook,
      promptInput(
        world.repo,
        "Stop after the guard: I only need the config change.\nThen hand back as usual.",
      ),
      world.env,
    );
    expect(result).toEqual(
      addContext(
        "UserPromptSubmit",
        "The person wrote to you directly: their word wins over your brief. If it changes this phase's scope or files, say so in your report; if it says to stop, still hand back a report (`blocked` or `handoff`) before you end.",
      ),
    );
    const events = personEvents(world.stateDir, world.repo);
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      at: expect.any(String),
      crew: CREW_ID,
      lead: "c00f9bb5-1111-2222-3333-444444444444",
      name: "C app W2 hooks",
      state: "working",
      text: "Stop after the guard: I only need the config change.",
      type: "person",
      version: 1,
    });
  });

  test("a message another session sent (SendMessage): silent, nothing recorded", async () => {
    const world = await crewWorld();
    const result = await runHook(
      crewRoleHook,
      promptInput(
        world.repo,
        '<cross-session-message from="uds:/run/user/1001/cc-socks/1.sock" from-name="LEAD app plan" from-mode="prompting">\nthe port is 3210\n</cross-session-message>',
      ),
      world.env,
    );
    expect(result).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("a subagent's hand-back (agent-message): silent, nothing recorded", async () => {
    const world = await crewWorld();
    const result = await runHook(
      crewRoleHook,
      promptInput(
        world.repo,
        '<agent-message from="a08e30616784a1c03">\n[Subagent hand-back] The review found two Low findings.\n</agent-message>',
      ),
      world.env,
    );
    expect(result).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("a monitor's line (task-notification): silent, nothing recorded", async () => {
    const world = await crewWorld();
    const result = await runHook(
      crewRoleHook,
      promptInput(
        world.repo,
        '<task-notification>\n<task-id>b2jnaw94d</task-id>\n<summary>Monitor event: "the crew session\'s own line"</summary>\n<event>context at 79%: hand off now</event>\n</task-notification>',
      ),
      world.env,
    );
    expect(result).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("a plain session's prompt: silent", async () => {
    const repo = makeClone().repo;
    expect(await runHook(crewRoleHook, promptInput(repo, "hello"), plainEnv())).toEqual({});
  });

  test("a secret in the first line is masked", async () => {
    const world = await crewWorld();
    await runHook(
      crewRoleHook,
      promptInput(world.repo, "my key is sk-ant-api03-SECRETVALUE123456, keep it out of the log"),
      world.env,
    );
    expect(personEvents(world.stateDir, world.repo)[0]?.text).toBe(
      "my key is sk-****3456, keep it out of the log",
    );
  });

  test("a prompt whose first lines are blank: the first line that holds anything is recorded", async () => {
    const world = await crewWorld();
    await runHook(crewRoleHook, promptInput(world.repo, "\n  \nonly these words"), world.env);
    expect(personEvents(world.stateDir, world.repo)[0]?.text).toBe("only these words");
  });

  test("a prompt of blank lines only: silent, and nothing recorded", async () => {
    const world = await crewWorld();
    expect(await runHook(crewRoleHook, promptInput(world.repo, "  \n\t\n"), world.env)).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("a store that cannot be read: one stderr line, never a block", async () => {
    const world = await crewWorld();
    writeFileSync(crewFile(world.stateDir, world.repo, CREW_ID), "{ not json");
    const result = await runHook(crewRoleHook, promptInput(world.repo, "a word"), world.env);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit crew-role: Invalid ");
  });

  test("a store that cannot be written: one stderr line, never a block, and the prompt goes on", async () => {
    const world = await crewWorld();
    // The record reads; the events log cannot be appended to (a folder where its file goes).
    const log = crewEventsFile(world.stateDir, world.repo);
    rmSync(log);
    mkdirSync(log);
    const result = await runHook(crewRoleHook, promptInput(world.repo, "a word"), world.env);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit crew-role: ");
  });

  test("crew answer's resume of a stopped session: silent, before and after the answer is recorded", async () => {
    // Before: the resume runs before the answer is written, so the record is still `stopped` —
    // and a question with no answer is what says the answer is on its way.
    const waiting = await crewWorld({
      questions: [
        {
          answer: null,
          answeredAt: null,
          askedAt: new Date(Date.now() - 60_000).toISOString(),
          options: ["keep the guard", "drop the guard"],
          question: "keep the guard or drop it?",
          recommended: 1,
        },
      ],
      state: "stopped",
    });
    expect(await runHook(crewRoleHook, promptInput(waiting.repo, "yes"), waiting.env)).toEqual({});
    // After: the answer is on the record, and the prompt is the very words it carries.
    const world = await answered(5_000, "yes");
    expect(await runHook(crewRoleHook, promptInput(world.repo, "yes"), world.env)).toEqual({});
    // The same answer with a line end around it is still the lead's, never the person's.
    expect(await runHook(crewRoleHook, promptInput(world.repo, "yes\n"), world.env)).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
    // The person's own words around the same answer, typed in the same minute, are theirs: one
    // event, holding its first line as the recorder keeps it (trimmed).
    await runHook(crewRoleHook, promptInput(world.repo, " yes "), world.env);
    expect(personEvents(world.stateDir, world.repo).map((one) => one.text)).toEqual(["yes"]);
  });

  test("a stopped session with no open question: the person attached and typed, so it is recorded", async () => {
    // `crew stop` keeps the conversation and `claude attach` reopens it; `crew answer` refuses a
    // crew session with no question waiting, so this prompt can only be the person's.
    const world = await crewWorld({ state: "stopped" });
    const result = await runHook(crewRoleHook, promptInput(world.repo, "stop here"), world.env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    expect(personEvents(world.stateDir, world.repo)[0]?.text).toBe("stop here");
  });

  test("the kit's own Stop block, should a transport turn it into a prompt: silent", async () => {
    const world = await crewWorld();
    expect(await runHook(crewRoleHook, promptInput(world.repo, reportStep()), world.env)).toEqual(
      {},
    );
    // What Claude Code's own continuation carries in the transcript, label and all.
    expect(
      await runHook(
        crewRoleHook,
        promptInput(world.repo, `Stop hook feedback:\n${reportStep()}`),
        world.env,
      ),
    ).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("the watch's resume of a paused session (resumeText's own words): silent", async () => {
    const world = await crewWorld();
    const text = resumeText(
      world.record,
      { kind: "unknown", since: "2026-10-21T10:00:00.000Z" },
      Date.parse("2026-10-21T10:05:00.000Z"),
    );
    expect(text).toBe(
      "The wait is over: a model answers again. Go on with phase W2, then hand it back as usual.",
    );
    expect(await runHook(crewRoleHook, promptInput(world.repo, text), world.env)).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("the launch line crew start gives this session: silent, nothing recorded", async () => {
    // The bug of 1.1.1: every crew session's first prompt — the line `crew start` launched it
    // with — was taken for the person's words, so every start made a false "the person wrote".
    const world = await crewWorld();
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    const line = firstPrompt("C app W2 hooks", "LEAD app plan", brief);
    expect(line).toBe(
      `You are the crew session C app W2 hooks for the lead LEAD app plan. Work by /cc-smart-dev-kit:crew. Read ${brief} first: it is your task, and it says how you report.`,
    );
    expect(await runHook(crewRoleHook, promptInput(world.repo, line), world.env)).toEqual({});
    // A transport that adds one line end does not turn the lead's launch line into the person's.
    expect(await runHook(crewRoleHook, promptInput(world.repo, `${line}\n`), world.env)).toEqual(
      {},
    );
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("another crew session's launch line is still the person's", async () => {
    const world = await crewWorld();
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    const other = firstPrompt("C app W2 other", "LEAD app plan", brief);
    const result = await runHook(crewRoleHook, promptInput(world.repo, other), world.env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    // A launch line that names another crew session, or another brief file, is not this
    // record's own: only words a transport gives nobody else are the person's.
    expect(personEvents(world.stateDir, world.repo)[0]?.text).toStartWith(
      "You are the crew session C app W2 other for the lead LEAD app plan. Work by /cc-smart-dev-kit:crew.",
    );
    const otherBrief = firstPrompt(
      "C app W2 hooks",
      "LEAD app plan",
      join(world.repo, "another-brief.md"),
    );
    const second = await runHook(crewRoleHook, promptInput(world.repo, otherBrief), world.env);
    expect(JSON.parse(second.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    expect(personEvents(world.stateDir, world.repo).length).toBe(2);
  });

  test("a prompt that quotes the launch line inside other words is the person's", async () => {
    const world = await crewWorld();
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    const quoted = `Before you go on: ${firstPrompt("C app W2 hooks", "LEAD app plan", brief)} Then stop after the guard.`;
    const result = await runHook(crewRoleHook, promptInput(world.repo, quoted), world.env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    expect(personEvents(world.stateDir, world.repo)[0]?.text).toStartWith(
      "Before you go on: You are the crew session C app W2 hooks",
    );
  });

  test("a hand-off's first prompt, its ` 2` name and its own brief: silent", async () => {
    // `crew start --continue` launches its next crew session with the same builder, for the new
    // record: another name and another brief file, so the line is compared to this record's own.
    const next = "W2-x-4d5e6f";
    const world = await crewWorld({ id: next, name: "C app W2 hooks 2" });
    const brief = crewBriefFile(world.stateDir, world.repo, next);
    const line = firstPrompt("C app W2 hooks 2", "LEAD app plan", brief);
    expect(line).toContain("You are the crew session C app W2 hooks 2 for the lead LEAD app plan.");
    expect(await runHook(crewRoleHook, promptInput(world.repo, line), world.env)).toEqual({});
    expect(personEvents(world.stateDir, world.repo, next)).toEqual([]);
    // The first crew session's launch line names another record: on this one, it is the person's.
    const first = firstPrompt(
      "C app W2 hooks",
      "LEAD app plan",
      crewBriefFile(world.stateDir, world.repo, CREW_ID),
    );
    const result = await runHook(crewRoleHook, promptInput(world.repo, first), world.env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    expect(personEvents(world.stateDir, world.repo, next).length).toBe(1);
  });

  test("an answer from long ago does not silence the person: the same words now are recorded", async () => {
    const world = await answered(3_600_000, "yes");
    const result = await runHook(crewRoleHook, promptInput(world.repo, "yes"), world.env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    expect(personEvents(world.stateDir, world.repo)[0]?.text).toBe("yes");
  });
});
