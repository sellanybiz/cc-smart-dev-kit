/**
 * The crew session's own hook (`crew-role.ts`): the card at a start, the session's own folder
 * checked against its worktree (H101), the ask refused, the report block at a stop, the pause at
 * a model limit, and silence everywhere else.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { deliveryText } from "../crew/answer";
import { firstPrompt, modelChangeText, SELF_MONITOR, withCrewCommand } from "../crew/brief";
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
  updateCrew,
  writeLead,
  writeStopState,
} from "../crew/store";
import { readTaskGate, taskGateFile, writeTaskGate } from "../crew/tasks";
import { resumeText } from "../crew/wait";
import { emptyConfig, saveConfig } from "../gateway/config";
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
import { addContext, addContextAndTitle, toolDecision } from "./io";
import { crewRoleHook } from "./specs";

const CREW_ID = "W2-x-1a2b3c";
/** The session id of a `UserPromptSubmit` input: Claude Code's own shape, a UUID. */
const SESSION_UUID = "9f1c2d3e-1111-2222-3333-444444444444";
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
        "No report has been handed back for this phase. Hand it back with `cc-smart-dev-kit crew report --status done --file -` and the JSON part (tests, checks, review), or `--status failed` and why, then end the turn.",
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
  test("C3: an earlier copy in the main folder leaves the record unchanged", async () => {
    const world = await crewWorld({ sessionId: SESSION_UUID, shortId: "9f1c2d3e" });
    await updateCrew(
      world.stateDir,
      world.repo,
      CREW_ID,
      {
        earlierSessions: [{ sessionId: "old-session", shortId: "old-sess" }],
      },
      T0,
    );
    const before = readCrew(world.stateDir, world.repo, CREW_ID);
    const events = readCrewEvents(world.stateDir, world.repo);
    const result = await runHook(
      crewRoleHook,
      {
        hook_event_name: "SessionStart",
        session_id: "old-session",
        cwd: world.repo,
        source: "resume",
      },
      world.env,
    );
    expect(readCrew(world.stateDir, world.repo, CREW_ID)).toEqual(before);
    expect(readCrewEvents(world.stateDir, world.repo)).toEqual(events);
    expect(result).toEqual(
      addContext(
        "SessionStart",
        "You are an earlier copy of the crew session `C app W2 hooks`; its current session is `9f1c2d3e`. Do nothing — change no file, run no command — and end your turn now.",
      ),
    );
  });

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
      "Write your task list first, in Claude Code's task tools (not claude-mem's work state): look up the task tools (ToolSearch `select:TaskCreate,TaskUpdate,TaskList`), then one TaskCreate per part of your brief, each with its done-check. Your first edit waits for it, and `cc-smart-dev-kit crew report --status done --file -` waits until no task is open.",
      "Hand the phase back with `cc-smart-dev-kit crew report --status done --file -` and the JSON part (tests, checks, review), or `--status failed` and why, then end the turn.",
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

/**
 * D23: a crew session's first edit waits for its task list. The list is Claude Code's own
 * folder, `<config dir>/tasks/<session id>/`, so each case builds it by hand in the shape a live
 * run wrote (`docs/claude-code-contract.md` § The to-do list): `N.json` files, a `.lock`, and a
 * `.highwatermark` once a task has been removed.
 */
describe("D23: a crew session's first edit waits for its task list", () => {
  const SESSION_ID = "9b4632f1-d3bd-43ce-bc1a-00349c5f30ac";
  /** The deny, written out: the why, the step, and the way out when there are no task tools. */
  const REFUSAL =
    'A crew session writes its task list before it changes a file: the list is what it resumes from after a compaction, and what the person reads. Write your task list first, in Claude Code\'s task tools (not claude-mem\'s work state): look up the task tools (ToolSearch `select:TaskCreate,TaskUpdate,TaskList`), then one TaskCreate per part of your brief, each with its done-check. If ToolSearch finds no task tools in this session, tell your lead: `cc-smart-dev-kit crew report --question "<q>" --option "<a>" --option "<b>" --recommend <n>`';

  /** A project, the crew session's environment, and where its task list would be. */
  function gateWorld(extraEnv: Record<string, string> = {}) {
    const { repo } = makeClone();
    const env = { ...hookEnv(), [CREW_ENV]: CREW_ID, ...extraEnv };
    const paths = cliPaths(env);
    return {
      env,
      listDir: (listId: string = SESSION_ID) => join(paths.claudeConfigDir, "tasks", listId),
      paths,
      repo,
    };
  }

  /** A task file as Claude Code writes one. */
  function writeTask(folder: string, n: number, status = "pending"): void {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, `${String(n)}.json`),
      `${JSON.stringify(
        {
          id: String(n),
          subject: `Part ${String(n)}`,
          description: "x",
          status,
          blocks: [],
          blockedBy: [],
        },
        null,
        2,
      )}\n`,
    );
  }

  /** A PreToolUse input for an edit tool; `change` goes over it. */
  function editInput(repo: string, tool = "Write", change: Record<string, unknown> = {}) {
    return {
      hook_event_name: "PreToolUse",
      session_id: SESSION_ID,
      cwd: repo,
      tool_name: tool,
      tool_input: { file_path: join(repo, "src", "a.ts"), content: "x\n" },
      ...change,
    };
  }

  test.each(["Edit", "Write", "NotebookEdit"])(
    "%s is denied with the step while the session has no task file",
    async (tool) => {
      const world = gateWorld();
      const result = await runHook(crewRoleHook, editInput(world.repo, tool), world.env);
      expect(result).toEqual(toolDecision("deny", REFUSAL));
    },
  );

  test("the deny is a deny, never an ask: nobody is at the machine to answer", async () => {
    const world = gateWorld();
    const result = await runHook(crewRoleHook, editInput(world.repo), world.env);
    const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
    expect(output.hookEventName).toBe("PreToolUse");
    expect(output.permissionDecision).toBe("deny");
    expect(result.exitCode ?? 0).toBe(0);
  });

  test("a folder with only the lock and the high-water mark is no list: every task was removed", async () => {
    const world = gateWorld();
    // What a live run left after its last task was removed: no `N.json` at all.
    mkdirSync(world.listDir(), { recursive: true });
    writeFileSync(join(world.listDir(), ".lock"), "");
    writeFileSync(join(world.listDir(), ".highwatermark"), "2");
    const result = await runHook(crewRoleHook, editInput(world.repo), world.env);
    expect(result).toEqual(toolDecision("deny", REFUSAL));
  });

  test("another session's list is not this session's", async () => {
    const world = gateWorld();
    writeTask(world.listDir("0a1b2c3d-0000-4000-8000-000000000000"), 1);
    const result = await runHook(crewRoleHook, editInput(world.repo), world.env);
    expect(result).toEqual(toolDecision("deny", REFUSAL));
  });

  test("one task file, in any status, ends the denial: the edit goes through", async () => {
    for (const status of ["pending", "in_progress", "completed"]) {
      const world = gateWorld();
      writeTask(world.listDir(), 1, status);
      expect(await runHook(crewRoleHook, editInput(world.repo), world.env)).toEqual({});
    }
  });

  test("once allowed, the folder is never read again: the list can vanish and the edit goes through", async () => {
    const world = gateWorld();
    writeTask(world.listDir(), 1);
    expect(await runHook(crewRoleHook, editInput(world.repo), world.env)).toEqual({});
    // The cache is the crew session's own file in its store folder, naming the list it saw.
    expect(readTaskGate(world.paths.stateDir, world.repo, CREW_ID)).toEqual({ listId: SESSION_ID });
    // The list is gone — a folder the hook would read as no list — and the next edit still passes.
    rmSync(world.listDir(), { recursive: true });
    expect(await runHook(crewRoleHook, editInput(world.repo, "Edit"), world.env)).toEqual({});
    expect(await runHook(crewRoleHook, editInput(world.repo, "NotebookEdit"), world.env)).toEqual(
      {},
    );
  });

  test("a gate recorded for another list is not this list's: the folder is read again", async () => {
    const world = gateWorld();
    writeTaskGate(world.paths.stateDir, world.repo, CREW_ID, { listId: "an-older-list" });
    expect(await runHook(crewRoleHook, editInput(world.repo), world.env)).toEqual(
      toolDecision("deny", REFUSAL),
    );
    writeTask(world.listDir(), 1);
    expect(await runHook(crewRoleHook, editInput(world.repo), world.env)).toEqual({});
    expect(readTaskGate(world.paths.stateDir, world.repo, CREW_ID)).toEqual({ listId: SESSION_ID });
  });

  test("while the session is denied, nothing is remembered", async () => {
    const world = gateWorld();
    await runHook(crewRoleHook, editInput(world.repo), world.env);
    expect(readTaskGate(world.paths.stateDir, world.repo, CREW_ID)).toBeNull();
  });

  test("CLAUDE_CODE_TASK_LIST_ID names the list: a shared list ends the denial, the session id's folder does not", async () => {
    const world = gateWorld({ CLAUDE_CODE_TASK_LIST_ID: "shared-list" });
    writeTask(world.listDir(), 1);
    expect(await runHook(crewRoleHook, editInput(world.repo), world.env)).toEqual(
      toolDecision("deny", REFUSAL),
    );
    writeTask(world.listDir("shared-list"), 1);
    expect(await runHook(crewRoleHook, editInput(world.repo), world.env)).toEqual({});
    expect(readTaskGate(world.paths.stateDir, world.repo, CREW_ID)).toEqual({
      listId: "shared-list",
    });
  });

  test("a subagent's edit is judged against the same list: its TaskCreate writes into the session's folder", async () => {
    // Proved live: the hook input of a subagent's edit carries the PARENT session's id, with the
    // agent's id beside it, and the subagent's TaskCreate wrote `2.json` into the parent's folder.
    const world = gateWorld();
    const sub = { agent_id: "aa9de47afbd459249", agent_type: "general-purpose" };
    expect(await runHook(crewRoleHook, editInput(world.repo, "Write", sub), world.env)).toEqual(
      toolDecision("deny", REFUSAL),
    );
    writeTask(world.listDir(), 1);
    expect(await runHook(crewRoleHook, editInput(world.repo, "Write", sub), world.env)).toEqual({});
  });

  test("a session that is not a crew session is never denied, and reads nothing", async () => {
    const { repo } = makeClone();
    const env = plainEnv();
    for (const tool of ["Edit", "Write", "NotebookEdit"]) {
      expect(await runHook(crewRoleHook, editInput(repo, tool), env)).toEqual({});
    }
    expect(readTaskGate(cliPaths(env).stateDir, repo, CREW_ID)).toBeNull();
  });

  test("a lead is never denied: a recorded lead's session is a plain session", async () => {
    const { repo } = makeClone();
    const env = plainEnv();
    await writeLead(
      cliPaths(env).stateDir,
      {
        cwd: repo,
        name: "LEAD app plan",
        plan: "plan",
        repo,
        sessionId: SESSION_ID,
        tag: "app",
      },
      T0,
    );
    expect(await runHook(crewRoleHook, editInput(repo), env)).toEqual({});
  });

  test("another tool is not judged: only the three edit tools wait for the list", async () => {
    const world = gateWorld();
    for (const tool of ["Bash", "Read", "TaskCreate", "Agent"]) {
      const result = await runHook(
        crewRoleHook,
        { ...editInput(world.repo, tool), tool_input: { command: "ls" } },
        world.env,
      );
      expect(result).toEqual({});
    }
  });

  test("a folder it cannot read lets the edit through, with one stderr line and nothing remembered", async () => {
    const world = gateWorld();
    // A file where the session's folder belongs: the hook cannot say whether there is a list.
    mkdirSync(join(world.paths.claudeConfigDir, "tasks"), { recursive: true });
    writeFileSync(world.listDir(), "{}");
    const result = await runHook(crewRoleHook, editInput(world.repo), world.env);
    expect(result.stdout).toBeUndefined();
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr).toBe(
      `cc-smart-dev-kit crew-role: the task folder ${world.listDir()} cannot be read, so the edit is not held for the task list`,
    );
    expect(readTaskGate(world.paths.stateDir, world.repo, CREW_ID)).toBeNull();
  });

  test("a gate that cannot be written: one stderr line, and the edit still goes through", async () => {
    const world = gateWorld();
    writeTask(world.listDir(), 1);
    // The crew session's files folder is a file: the gate cannot be made under it.
    const filesFolder = dirname(dirname(taskGateFile(world.paths.stateDir, world.repo, CREW_ID)));
    mkdirSync(dirname(filesFolder), { recursive: true });
    writeFileSync(filesFolder, "not a folder");
    const result = await runHook(crewRoleHook, editInput(world.repo), world.env);
    expect(result.stdout).toBeUndefined();
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit crew-role: the task list gate could not be recorded: ",
    );
  });

  test("a call that names no session cannot be judged: it goes through", async () => {
    const world = gateWorld();
    const { session_id: _gone, ...without } = editInput(world.repo);
    expect(await runHook(crewRoleHook, without, world.env)).toEqual({});
  });

  test("the gate holds with no project file, a broken one, and outside git: it reads no config", async () => {
    // No cc-smart-dev-kit.json: `makeClone` writes none.
    const none = gateWorld();
    expect(await runHook(crewRoleHook, editInput(none.repo), none.env)).toEqual(
      toolDecision("deny", REFUSAL),
    );
    // A broken one, and one from a newer plugin: `onConfigProblem` judges the edit all the same.
    for (const file of [{ worktree: {} }, { requires: ">=99", fieldFromTheFuture: true }]) {
      const world = gateWorld();
      writeClaudeFile(world.repo, "cc-smart-dev-kit.json", file);
      expect(await runHook(crewRoleHook, editInput(world.repo), world.env)).toEqual(
        toolDecision("deny", REFUSAL),
      );
    }
    // Outside git: denied, then allowed with a list — and there is no store folder to remember in.
    const world = gateWorld();
    const outside = tempDir("outside");
    expect(await runHook(crewRoleHook, editInput(outside), world.env)).toEqual(
      toolDecision("deny", REFUSAL),
    );
    writeTask(world.listDir(), 1);
    expect(await runHook(crewRoleHook, editInput(outside), world.env)).toEqual({});
    expect(readTaskGate(world.paths.stateDir, world.repo, CREW_ID)).toBeNull();
  });

  test("a crash on an edit asks, as every guard's crash does; a plain session is never asked", async () => {
    const world = gateWorld();
    const context = { env: world.env, nowMs: T0, paths: world.paths };
    const asked = crewRoleHook.onCrash?.("boom", editInput(world.repo), "PreToolUse", context);
    expect(asked).toEqual(
      toolDecision(
        "ask",
        "cc-smart-dev-kit cannot check whether this crew session keeps its task list: boom",
      ),
    );
    const plain = { env: plainEnv(), nowMs: T0, paths: world.paths };
    expect(crewRoleHook.onCrash?.("boom", editInput(world.repo), "PreToolUse", plain)).toEqual({});
    // A call outside both domains is still no business of the hook's.
    expect(
      crewRoleHook.onCrash?.("boom", editInput(world.repo, "Bash"), "PreToolUse", context),
    ).toEqual({});
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

  /**
   * What Claude Code lists in `background_tasks` for the crew session's own monitor (read from the
   * 2.1.310 binary): a plugin monitor is a shell task, so its `type` says "shell", with the
   * monitor's own command and description from `plugin/monitors/monitors.json`; nothing in the
   * entry says "monitor". It is running for the whole life of the session.
   */
  function selfWatchTask(): Record<string, unknown> {
    const monitors = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "plugin", "monitors", "monitors.json"),
        "utf8",
      ),
    ) as { command: string; description: string; name: string }[];
    const self = monitors.find((one) => one.name === SELF_MONITOR);
    return {
      command: self?.command,
      description: self?.description,
      id: "bm4k2x9a1",
      status: "running",
      type: "shell",
    };
  }

  test("the crew session's own monitor always runs, and is no reason to skip the gate", async () => {
    // Before: the monitor is a running background task, so the hook took every turn for one that
    // waits for work, and a turn that ended on a step with no report was never blocked.
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    const result = await runHook(
      crewRoleHook,
      stopInput(world.repo, { background_tasks: [selfWatchTask()] }),
      world.env,
    );
    expect(result).toEqual(blockAnswer());
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastLine).toBe(
      "Fixed the guard. It now denies the ask.",
    );
  });

  test("the monitor and a task of the session's own: the turn waits for that task, so silent", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    const result = await runHook(
      crewRoleHook,
      stopInput(world.repo, {
        background_tasks: [
          selfWatchTask(),
          {
            command: "bun test",
            description: "the tests",
            id: "b1",
            status: "running",
            type: "shell",
          },
        ],
      }),
      world.env,
    );
    expect(result).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastLine).toBeNull();
  });

  test("a task that only has the monitor's words in its command is the session's own work: silent", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    for (const command of [
      "tail -f /tmp/crew-self-watch.log",
      "bun test # crew self-watch",
      "grep -r 'crew self-watch' src",
    ]) {
      const result = await runHook(
        crewRoleHook,
        stopInput(world.repo, {
          background_tasks: [
            { command, description: "x", id: "b2", status: "running", type: "shell" },
          ],
        }),
        world.env,
      );
      expect(result).toEqual({});
    }
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
      [
        "state",
        "paused",
        "worker slot limited since 21:05; goes on by itself when it answers · rate_limit: You've hit your limit · resets 22:30",
      ],
    ]);
  });

  test("a session in a profile pauses on its profile's breaker, kept under <profile>/<slot> (RV3)", async () => {
    const world = await workerWorld();
    // The router's address and the profile are the config's; the session's own URL names them.
    saveConfig(cliPaths(world.env).gatewayConfigFile, {
      ...emptyConfig(),
      port: 20997,
      profiles: { "my-project": {} },
      slots: { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] },
    });
    const own = breaker().breakers?.["cc-smart-dev-kit-worker"];
    if (own === undefined) throw new Error("the fixture has a worker breaker");
    writeState(world.env, {
      ...breaker(),
      breakers: { "my-project/cc-smart-dev-kit-worker": own },
    });
    await crewRoleAnswer(
      stopFailure(world.repo),
      "StopFailure",
      { ...world.env, ANTHROPIC_BASE_URL: "http://127.0.0.1:20997/p/my-project" },
      cliPaths(world.env),
      world.repo,
      { nowMs: NOW, timeZone: "UTC" },
    );
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toEqual({
      kind: "slot",
      since: "2026-10-21T21:05:00.000Z",
      slot: "my-project/cc-smart-dev-kit-worker",
    });
    expect(readCrewEvents(world.stateDir, world.repo).events.at(-1)?.text).toBe(
      "worker slot in profile my-project limited since 21:05; goes on by itself when it answers · rate_limit: You've hit your limit · resets 22:30",
    );
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
      "claude-sonnet-5-5 is at its limit, resets 22:30; goes on by itself when it answers once the limit lifts · rate_limit: You've hit your limit · resets 22:30",
    );
  });

  test("nothing the router explains: an unknown wait, with the error in its line", async () => {
    const world = await workerWorld();
    writeState(world.env, { fallbacks: {}, limits: {}, version: 1 });
    await crewRoleAnswer(
      stopFailure(world.repo, {
        error: "server_error",
        last_assistant_message: "API Error: 500 upstream connect error",
      }),
      "StopFailure",
      world.env,
      cliPaths(world.env),
      world.repo,
      { nowMs: NOW, timeZone: "UTC" },
    );
    // The wait keeps the state key of the session's own slot, so the watch asks its breaker.
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toEqual({
      kind: "unknown",
      since: "2026-10-21T22:00:00.000Z",
      slot: "cc-smart-dev-kit-worker",
    });
    expect(readCrewEvents(world.stateDir, world.repo).events.at(-1)?.text).toBe(
      "it stopped on server_error: API Error: 500 upstream connect error; the watch goes on with it once a model answers",
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
    // No state event either: the only event is the one the record was created with.
    expect(readCrewEvents(world.stateDir, world.repo).events.map((one) => one.type)).toEqual([
      "created",
    ]);
  });

  test("a crew session whose phase ended or that waits in the queue pauses nothing and records nothing", async () => {
    for (const state of ["done", "failed", "handoff", "merged", "removed", "stopped", "queued"]) {
      const world = await workerWorld({ state });
      writeState(world.env, breaker());
      expect(await runHook(crewRoleHook, stopFailure(world.repo), world.env)).toEqual({});
      expect(
        await runHook(crewRoleHook, stopFailure(world.repo, { error: "unknown" }), world.env),
      ).toEqual({});
      const record = readCrew(world.stateDir, world.repo, CREW_ID);
      expect(record?.state).toBe(state);
      expect(record?.lastApiError).toBeUndefined();
    }
    // Seven worlds, each a git clone: more than the default five seconds on a slow disk.
  }, 30_000);

  test("every class is kept on the record: the class, the text Claude Code showed, and when", async () => {
    const world = await workerWorld();
    writeState(world.env, { fallbacks: {}, limits: {}, version: 1 });
    const options = { nowMs: NOW, timeZone: "UTC" };
    const answer = (change: Record<string, unknown>) =>
      crewRoleAnswer(
        stopFailure(world.repo, change),
        "StopFailure",
        world.env,
        cliPaths(world.env),
        world.repo,
        options,
      );
    // A backend's refusal: Claude Code's class is `unknown`; the router's reason is the text.
    expect(
      await answer({
        error: "unknown",
        last_assistant_message: "API Error: 424 the backend refused the request: content filter",
      }),
    ).toEqual({});
    let record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("working");
    expect(record?.lastApiError).toEqual({
      at: "2026-10-21T22:00:00.000Z",
      class: "unknown",
      text: "API Error: 424 the backend refused the request: content filter",
    });
    // The next error replaces it.
    await answer({
      error: "model_not_found",
      last_assistant_message: "There's an issue with the model",
    });
    record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.lastApiError).toEqual({
      at: "2026-10-21T22:00:00.000Z",
      class: "model_not_found",
      text: "There's an issue with the model",
    });
    // A class that pauses keeps it too, in the same write as the pause.
    await answer({ error: "server_error", last_assistant_message: "API Error: 500" });
    record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("paused");
    expect(record?.lastApiError).toEqual({
      at: "2026-10-21T22:00:00.000Z",
      class: "server_error",
      text: "API Error: 500",
    });
  });

  test("the text is Claude Code's error_details when it sends them, masked and cut to one line", async () => {
    const world = await workerWorld();
    const options = { nowMs: NOW, timeZone: "UTC" };
    const run = (change: Record<string, unknown>) =>
      crewRoleAnswer(
        stopFailure(world.repo, change),
        "StopFailure",
        world.env,
        cliPaths(world.env),
        world.repo,
        options,
      );
    await run({
      error: "unknown",
      error_details: { status: 424, message: "refused by the backend" },
      last_assistant_message: "API Error",
    });
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastApiError?.text).toBe(
      '{"status":424,"message":"refused by the backend"}',
    );
    await run({
      error: "unknown",
      error_details: "first line\nsecond line",
      last_assistant_message: "x",
    });
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastApiError?.text).toBe(
      "first line second line",
    );
    // A secret in the text never reaches the record the lead and the portal read.
    await run({
      error: "unknown",
      last_assistant_message:
        "API Error: key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 refused",
    });
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastApiError?.text).not.toContain(
      "abcdefghijklmnopqrstuvwxyz0123456789",
    );
    // A long text is cut after 400 characters, and an ellipsis marks the cut.
    await run({
      error: "unknown",
      last_assistant_message: `API Error: ${"refused again ".repeat(100)}`,
    });
    const text = readCrew(world.stateDir, world.repo, CREW_ID)?.lastApiError?.text ?? "";
    expect(text).toHaveLength(401);
    expect(text.endsWith("…")).toBe(true);
    // No text at all: an empty one, and the class still counts.
    await run({ error: "unknown", last_assistant_message: undefined });
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastApiError).toEqual({
      at: "2026-10-21T22:00:00.000Z",
      class: "unknown",
      text: "",
    });
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

describe("the safety checks fail: a turn with no report pauses instead of a block", () => {
  const NOW = Date.parse("2026-10-21T22:00:00.000Z");
  const MINUTE = 60_000;
  const JUDGE = "cc-smart-dev-kit-judge";
  /** A session on the machine's gateway: its URL is the router's, not Anthropic's. */
  const ON_GATEWAY = { ANTHROPIC_BASE_URL: "http://127.0.0.1:20997" };
  /** The exact line the pause's state event carries: the checks' own words, in UTC. */
  const PAUSE_LINE =
    "auto mode's safety checks are failing since 21:40: Claude is at its plan limit (five_hour) until 23:00, and no worker target has passed the judge test; goes on by itself when they answer again";

  /** The router's state file with one failing-checks record under `key`, last touched `lastAt`. */
  function writeDown(env: Record<string, string>, key = JUDGE, lastAt = NOW - MINUTE): void {
    const file = cliPaths(env).gatewayStateFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      formatLimitState({
        checksDown: {
          [key]: {
            claim: "five_hour",
            lastAt,
            resetsAt: Date.parse("2026-10-21T23:00:00.000Z") / 1000,
            since: Date.parse("2026-10-21T21:40:00.000Z"),
            status: 429,
            why: "untested",
          },
        },
        fallbacks: {},
        limits: {},
        version: 1,
      }),
    );
  }

  /** A Stop input for the crew session. */
  function stopInput(repo: string, change: Record<string, unknown> = {}) {
    return {
      hook_event_name: "Stop",
      session_id: "s",
      cwd: repo,
      last_assistant_message: "Auto mode cannot check the next command.",
      ...change,
    };
  }

  /** The Stop, as the hook answers it at `NOW`. */
  function stop(
    world: Awaited<ReturnType<typeof crewWorld>>,
    env: Record<string, string>,
    change: Record<string, unknown> = {},
  ): Promise<HookResult> {
    return crewRoleAnswer(
      stopInput(world.repo, change),
      "Stop",
      env,
      cliPaths(world.env),
      world.repo,
      {
        nowMs: NOW,
        timeZone: "UTC",
      },
    );
  }

  test("after a step: no block; paused, waiting for the checks, with one exact line", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    writeDown(world.env);
    expect(await stop(world, { ...world.env, ...ON_GATEWAY })).toEqual({});
    const record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("paused");
    expect(record?.waitingFor).toEqual({
      kind: "safety-checks",
      scope: JUDGE,
      since: "2026-10-21T21:40:00.000Z",
    });
    expect(record?.lastPause).toEqual({ backoffMs: 0, since: "2026-10-21T22:00:00.000Z" });
    // The last line is still kept.
    expect(record?.lastLine).toBe("Auto mode cannot check the next command.");
    const states = readCrewEvents(world.stateDir, world.repo).events.filter(
      (one) => one.type === "state",
    );
    expect(states.map((one) => [one.state, one.text])).toEqual([["paused", PAUSE_LINE]]);
  });

  test("a turn that reported is not paused, and is silent as before", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    await report(world.stateDir, world.repo);
    // `crew report --status done` moves the record with its event (`recordCrewReport`).
    await updateCrew(world.stateDir, world.repo, CREW_ID, { state: "done" }, T0);
    writeDown(world.env);
    expect(await stop(world, { ...world.env, ...ON_GATEWAY })).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("done");
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toBeUndefined();
  });

  test("a blocked report that was answered is no report of this turn: the session pauses (watch review #1)", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    // The session reported `blocked` with a question; the lead answered, so it works again and
    // its newest event is still that old report.
    await report(world.stateDir, world.repo);
    await updateCrew(world.stateDir, world.repo, CREW_ID, { state: "blocked" }, T0);
    await updateCrew(world.stateDir, world.repo, CREW_ID, { state: "working" }, T0);
    writeDown(world.env);
    // The checks fail, its tool calls are denied, and the turn ends with no new report.
    expect(await stop(world, { ...world.env, ...ON_GATEWAY })).toEqual({});
    const record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("paused");
    expect(record?.waitingFor).toEqual({
      kind: "safety-checks",
      scope: JUDGE,
      since: "2026-10-21T21:40:00.000Z",
    });
  });

  test("a blocked session keeps its open question: never paused, the answer before stays (watch review #5)", async () => {
    const world = await crewWorld({ state: "blocked" });
    // A step after its blocked report (after a `crew tell`, say): a turn with no report.
    await step(world.stateDir, world.repo);
    writeDown(world.env);
    expect(await stop(world, { ...world.env, ...ON_GATEWAY })).toEqual(blockAnswer());
    const record = readCrew(world.stateDir, world.repo, CREW_ID);
    expect(record?.state).toBe("blocked");
    expect(record?.waitingFor).toBeUndefined();
  });

  test("a turn that ends normally drops the last API error, with or without a last line (watch review #4)", async () => {
    const lastApiError = {
      at: "2026-10-21T21:00:00.000Z",
      class: "unknown",
      text: "API Error: 424 the backend refused the request",
    };
    for (const change of [{}, { last_assistant_message: undefined }]) {
      const world = await crewWorld();
      await updateCrew(world.stateDir, world.repo, CREW_ID, { lastApiError }, T0);
      expect(readCrew(world.stateDir, world.repo, CREW_ID)?.lastApiError).toEqual(lastApiError);
      expect(await stop(world, world.env, change)).toEqual({});
      const record = readCrew(world.stateDir, world.repo, CREW_ID);
      expect(record?.lastApiError).toBeUndefined();
      expect(record?.state).toBe("working");
    }
  });

  test("a session that recorded nothing yet pauses too: its first command needed a check", async () => {
    const world = await crewWorld();
    writeDown(world.env);
    expect(await stop(world, { ...world.env, ...ON_GATEWAY })).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("paused");
  });

  test("the stop that answers a block pauses too: the checks may have failed in that turn", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    writeDown(world.env);
    expect(await stop(world, { ...world.env, ...ON_GATEWAY }, { stop_hook_active: true })).toEqual(
      {},
    );
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("paused");
  });

  test("a session in a profile pauses on its profile's checks, under <profile>/<judge>", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    saveConfig(cliPaths(world.env).gatewayConfigFile, {
      ...emptyConfig(),
      port: 20997,
      profiles: { "my-project": {} },
    });
    writeDown(world.env, `my-project/${JUDGE}`);
    const env = { ...world.env, ANTHROPIC_BASE_URL: "http://127.0.0.1:20997/p/my-project" };
    expect(await stop(world, env)).toEqual({});
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.waitingFor).toEqual({
      kind: "safety-checks",
      scope: `my-project/${JUDGE}`,
      since: "2026-10-21T21:40:00.000Z",
    });
    expect(readCrewEvents(world.stateDir, world.repo).events.at(-1)?.text).toBe(
      "auto mode's safety checks are failing in profile my-project since 21:40: Claude is at its plan limit (five_hour) until 23:00, and no worker target has passed the judge test; goes on by itself when they answer again",
    );
  });

  test("the answer before stays where the checks are not this session's to wait for", async () => {
    // Each case: a session after a step, so the answer before is the one block.
    const cases: [
      string,
      (world: Awaited<ReturnType<typeof crewWorld>>) => Record<string, string>,
    ][] = [
      // Not on the gateway: Claude Code asks Anthropic, and the router's record is not its own.
      [
        "off the gateway",
        (world) => {
          writeDown(world.env);
          return world.env;
        },
      ],
      // A profile's checks fail; this session runs on the machine's chains.
      [
        "another scope",
        (world) => {
          writeDown(world.env, `my-project/${JUDGE}`);
          return { ...world.env, ...ON_GATEWAY };
        },
      ],
      // A record nobody refreshed for 15 minutes is no longer current.
      [
        "a stale record",
        (world) => {
          writeDown(world.env, JUDGE, NOW - 16 * MINUTE);
          return { ...world.env, ...ON_GATEWAY };
        },
      ],
      // A state file that cannot be read says nothing: no pause, the block as before.
      [
        "an unreadable state file",
        (world) => {
          const file = cliPaths(world.env).gatewayStateFile;
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, "{ not json");
          return { ...world.env, ...ON_GATEWAY };
        },
      ],
    ];
    for (const [name, arrange] of cases) {
      const world = await crewWorld();
      await step(world.stateDir, world.repo);
      const env = arrange(world);
      expect([name, await stop(world, env)]).toEqual([name, blockAnswer()]);
      expect([name, readCrew(world.stateDir, world.repo, CREW_ID)?.state]).toEqual([
        name,
        "working",
      ]);
    }
    // Four worlds, each a git clone: more than the default five seconds on a slow disk.
  }, 30_000);

  test("a phase that ended keeps its state and its answer", async () => {
    const world = await crewWorld({ state: "done" });
    await step(world.stateDir, world.repo);
    writeDown(world.env);
    expect(await stop(world, { ...world.env, ...ON_GATEWAY })).toEqual(blockAnswer());
    expect(readCrew(world.stateDir, world.repo, CREW_ID)?.state).toBe("done");
  });

  test("a session already paused stays paused, with no block and no second event", async () => {
    const world = await crewWorld();
    await step(world.stateDir, world.repo);
    writeDown(world.env);
    const env = { ...world.env, ...ON_GATEWAY };
    await stop(world, env);
    expect(await stop(world, env)).toEqual({});
    expect(
      readCrewEvents(world.stateDir, world.repo).events.filter((one) => one.type === "state"),
    ).toHaveLength(1);
  });

  test("the watch's resume of a checks pause is the lead's, not the person's", async () => {
    const world = await crewWorld({
      state: "paused",
      waitingFor: { kind: "safety-checks", scope: JUDGE, since: "2026-10-21T21:40:00.000Z" },
    });
    const record = readCrew(world.stateDir, world.repo, CREW_ID);
    if (record === null) throw new Error("the world has its record");
    const prompt = withCrewCommand(resumeText(record, record.waitingFor, NOW));
    const result = await runHook(
      crewRoleHook,
      { hook_event_name: "UserPromptSubmit", session_id: "s", cwd: world.repo, prompt },
      world.env,
    );
    expect(result).toEqual({});
    expect(
      readCrewEvents(world.stateDir, world.repo).events.filter((one) => one.type === "person"),
    ).toEqual([]);
  });
});

describe("D55: the person's own prompt is recorded, and a delivery that is not theirs is not", () => {
  /** A UserPromptSubmit input for the crew session. */
  function promptInput(repo: string, prompt: string, sessionId = "s") {
    return { hook_event_name: "UserPromptSubmit", session_id: sessionId, cwd: repo, prompt };
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

  test("a title that is not the record's name: the record's name comes back", async () => {
    // 1.1.1 let a crew session name itself after its task, and 1.1.2 refused new renames
    // without setting the title back: the name its lead, `crew answer` and the message guard
    // address it by stayed lost. The crew record is the one owner of the title.
    const world = await crewWorld();
    const result = await runHook(
      crewRoleHook,
      {
        ...promptInput(world.repo, "a word", SESSION_UUID),
        session_title: "Fix the login page",
      },
      world.env,
    );
    expect(result).toEqual(
      addContextAndTitle(
        "UserPromptSubmit",
        "The person wrote to you directly: their word wins over your brief. If it changes this phase's scope or files, say so in your report; if it says to stop, still hand back a report (`blocked` or `handoff`) before you end.",
        "C app W2 hooks",
      ),
    );
    expect(personEvents(world.stateDir, world.repo).length).toBe(1);
  });

  test("a title that is the record's name already: nothing about it", async () => {
    const world = await crewWorld();
    const result = await runHook(
      crewRoleHook,
      { ...promptInput(world.repo, "a word", SESSION_UUID), session_title: "C app W2 hooks" },
      world.env,
    );
    expect(result).toEqual(
      addContext(
        "UserPromptSubmit",
        "The person wrote to you directly: their word wins over your brief. If it changes this phase's scope or files, say so in your report; if it says to stop, still hand back a report (`blocked` or `handoff`) before you end.",
      ),
    );
  });

  test("the name's record cannot be written (TMPDIR is a file): the person's event is recorded, the prompt goes on, one line says why", async () => {
    // `titleToSet` writes the name it sets into `<TMPDIR>/cc-smart-dev-kit-session-names` before
    // the event is appended. A throw there crashed the hook; `onCrash` is silent on
    // UserPromptSubmit, so the lead never heard the person and the session never read that its
    // brief was overruled.
    const world = await crewWorld();
    const notAFolder = join(tempDir("tmp-is-a-file"), "tmp");
    writeFileSync(notAFolder, "");
    const result = await runHook(
      crewRoleHook,
      {
        ...promptInput(world.repo, "Stop after the guard.", SESSION_UUID),
        session_title: "Fix the login page",
      },
      { ...world.env, TMPDIR: notAFolder },
    );
    expect(result.stdout).toBe(
      addContext(
        "UserPromptSubmit",
        "The person wrote to you directly: their word wins over your brief. If it changes this phase's scope or files, say so in your report; if it says to stop, still hand back a report (`blocked` or `handoff`) before you end.",
      ).stdout,
    );
    // The name is not set: the kit cannot remember it set it, and setting it every turn would
    // override a `/rename` the person gives later.
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit crew-role: the session name could not be recorded (",
    );
    const events = personEvents(world.stateDir, world.repo);
    expect(events.map((event) => event.text)).toEqual(["Stop after the guard."]);
  });

  test("the name's record cannot be written, on a turn that is not the person's: silent, and no title", async () => {
    const world = await crewWorld();
    const notAFolder = join(tempDir("tmp-is-a-file"), "tmp");
    writeFileSync(notAFolder, "");
    const result = await runHook(
      crewRoleHook,
      {
        ...promptInput(
          world.repo,
          '<cross-session-message from="uds:/run/user/1001/cc-socks/1.sock" from-name="LEAD app plan" from-mode="prompting">\nthe port is 3210\n</cross-session-message>',
          SESSION_UUID,
        ),
        session_title: "Fix the login page",
      },
      { ...world.env, TMPDIR: notAFolder },
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit crew-role: the session name could not be recorded (",
    );
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("the lead's own delivery, with a title that is not the record's: the name alone", async () => {
    // A crew session its lead drives gets no person prompt at all, so the name comes back on
    // the turns that are the lead's too — one answer, the title and nothing else.
    const world = await crewWorld();
    const result = await runHook(
      crewRoleHook,
      {
        ...promptInput(
          world.repo,
          '<cross-session-message from="uds:/run/user/1001/cc-socks/1.sock" from-name="LEAD app plan" from-mode="prompting">\nthe port is 3210\n</cross-session-message>',
          SESSION_UUID,
        ),
        session_title: "Fix the login page",
      },
      world.env,
    );
    expect(result).toEqual(addContextAndTitle("UserPromptSubmit", null, "C app W2 hooks"));
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
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

  test("a store that cannot be written still gets the name back", async () => {
    // `titleToSet` records the name as the kit's the moment it answers with it, so a turn that
    // answered the error alone would never set it again: the address would stay lost, which is
    // the bug the title is set for. The line and the title go out in the one answer.
    const world = await crewWorld();
    const log = crewEventsFile(world.stateDir, world.repo);
    rmSync(log);
    mkdirSync(log);
    const result = await runHook(
      crewRoleHook,
      {
        ...promptInput(world.repo, "a word", SESSION_UUID),
        session_title: "Fix the login page",
      },
      world.env,
    );
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr).toStartWith("cc-smart-dev-kit crew-role: ");
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput).toEqual({
      hookEventName: "UserPromptSubmit",
      sessionTitle: "C app W2 hooks",
    });
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
    expect(
      await runHook(
        crewRoleHook,
        promptInput(waiting.repo, "/cc-smart-dev-kit:crew yes"),
        waiting.env,
      ),
    ).toEqual({});
    // After: the answer is on the record, and the prompt is the crew command and the very words
    // it carries (`resumeArgs` puts the command in front of every resume).
    const world = await answered(5_000, "yes");
    expect(
      await runHook(crewRoleHook, promptInput(world.repo, "/cc-smart-dev-kit:crew yes"), world.env),
    ).toEqual({});
    // The same answer with a line end after it is still the lead's, never the person's.
    expect(
      await runHook(
        crewRoleHook,
        promptInput(world.repo, "/cc-smart-dev-kit:crew yes\n"),
        world.env,
      ),
    ).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
    // The person's own words around the same answer, typed in the same minute, are theirs: one
    // event, holding its first line as the recorder keeps it (trimmed).
    await runHook(crewRoleHook, promptInput(world.repo, " yes "), world.env);
    expect(personEvents(world.stateDir, world.repo).map((one) => one.text)).toEqual(["yes"]);
  });

  test("a stopped session with an open question: a plain prompt is the person's, the crew command's is not (review #6)", async () => {
    // Every prompt the kit sends starts with the crew command, so the open question only explains
    // a prompt that has it. A person who attached and typed while the question waits is heard.
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
    expect(
      await runHook(
        crewRoleHook,
        promptInput(waiting.repo, "/cc-smart-dev-kit:crew keep the guard"),
        waiting.env,
      ),
    ).toEqual({});
    expect(personEvents(waiting.stateDir, waiting.repo)).toEqual([]);
    const result = await runHook(
      crewRoleHook,
      promptInput(waiting.repo, "keep the guard"),
      waiting.env,
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    expect(personEvents(waiting.stateDir, waiting.repo).map((one) => one.text)).toEqual([
      "keep the guard",
    ]);
  });

  test("the answer's words alone, with no crew command, are the person's: the kit's resume always has it", async () => {
    const world = await answered(5_000, "yes");
    const result = await runHook(crewRoleHook, promptInput(world.repo, "yes"), world.env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    expect(personEvents(world.stateDir, world.repo).map((one) => one.text)).toEqual(["yes"]);
  });

  test("other words after the crew command are the person's, even inside the minute", async () => {
    const world = await answered(5_000, "yes");
    await runHook(
      crewRoleHook,
      promptInput(world.repo, "/cc-smart-dev-kit:crew no, drop the guard"),
      world.env,
    );
    // The first line of what the person typed, as the recorder keeps it: the command line itself.
    expect(personEvents(world.stateDir, world.repo).map((one) => one.text)).toEqual([
      "/cc-smart-dev-kit:crew no, drop the guard",
    ]);
  });

  test("a resume with nothing to say (crew resume): the bare crew command is silent", async () => {
    const world = await crewWorld({ state: "stopped" });
    for (const prompt of ["/cc-smart-dev-kit:crew", "/cc-smart-dev-kit:crew\n"]) {
      expect(await runHook(crewRoleHook, promptInput(world.repo, prompt), world.env)).toEqual({});
    }
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("a dispatched command, as Claude Code writes it, reads the same as the typed one", async () => {
    const world = await crewWorld();
    const written = (args: string) =>
      `<command-message>cc-smart-dev-kit:crew</command-message>\n<command-name>/cc-smart-dev-kit:crew</command-name>\n<command-args>${args}</command-args>`;
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    const launch = firstPrompt("C app W2 hooks", "LEAD app plan", brief).slice(
      "/cc-smart-dev-kit:crew ".length,
    );
    expect(
      await runHook(crewRoleHook, promptInput(world.repo, written(launch)), world.env),
    ).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
    // Words the lead never sent are the person's in that form too.
    await runHook(crewRoleHook, promptInput(world.repo, written("do something else")), world.env);
    expect(personEvents(world.stateDir, world.repo)).toHaveLength(1);
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
    // The resume has the crew command in front (`resumeArgs`), so the skill is dispatched.
    expect(
      await runHook(crewRoleHook, promptInput(world.repo, withCrewCommand(text)), world.env),
    ).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
  });

  test("the wait-over words without the crew command, or for another phase, are the person's", async () => {
    const world = await crewWorld();
    const text = resumeText(
      world.record,
      { kind: "unknown", since: "2026-10-21T10:00:00.000Z" },
      Date.parse("2026-10-21T10:05:00.000Z"),
    );
    const result = await runHook(crewRoleHook, promptInput(world.repo, text), world.env);
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toStartWith(
      "The person wrote to you directly:",
    );
    // Another phase's wait-over line, behind the command, is not this record's either.
    await runHook(
      crewRoleHook,
      promptInput(
        world.repo,
        withCrewCommand(
          "The wait is over: a model answers again. Go on with phase W9, then hand it back as usual.",
        ),
      ),
      world.env,
    );
    expect(personEvents(world.stateDir, world.repo)).toHaveLength(2);
  });

  test("the launch line crew start gives this session: silent, nothing recorded", async () => {
    // The bug of 1.1.1: every crew session's first prompt — the line `crew start` launched it
    // with — was taken for the person's words, so every start made a false "the person wrote".
    const world = await crewWorld();
    const brief = crewBriefFile(world.stateDir, world.repo, CREW_ID);
    const line = firstPrompt("C app W2 hooks", "LEAD app plan", brief);
    // The crew command first, so Claude Code dispatches the skill and its monitor starts.
    expect(line).toBe(
      `/cc-smart-dev-kit:crew You are the crew session C app W2 hooks for the lead LEAD app plan. Work by /cc-smart-dev-kit:crew. Read ${brief} first: it is your task, and it says how you report.`,
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
    // The recorder keeps the first 120 characters of the line: the command, then the line's start.
    expect(personEvents(world.stateDir, world.repo)[0]?.text).toStartWith(
      "/cc-smart-dev-kit:crew You are the crew session C app W2 other for the lead LEAD app plan.",
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
      "Before you go on: /cc-smart-dev-kit:crew You are the crew session C app W2 hooks",
    );
  });

  test("a hand-off's first prompt, its ` 2` name and its own brief: silent", async () => {
    // `crew start --continue` launches its next crew session with the same builder, for the new
    // record: another name and another brief file, so the line is compared to this record's own.
    const next = "W2-x-4d5e6f";
    const world = await crewWorld({ id: next, name: "C app W2 hooks 2" });
    const brief = crewBriefFile(world.stateDir, world.repo, next);
    const line = firstPrompt("C app W2 hooks 2", "LEAD app plan", brief);
    expect(line).toStartWith(
      "/cc-smart-dev-kit:crew You are the crew session C app W2 hooks 2 for the lead LEAD app plan.",
    );
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

  test("crew model's resume, for the model and effort the record now holds: silent; any other is the person's", async () => {
    // `crew model` writes the new values to the record, then resumes the session with
    // `modelChangeText` behind the crew command. Before, every such resume was a false "person".
    const world = await crewWorld({ state: "stopped" });
    const now = { effort: "high", model: "sonnet" };
    for (const from of [
      { effort: "high", model: "opus" },
      { effort: "medium", model: "opus" },
      { effort: "medium", model: "sonnet" },
    ]) {
      const prompt = withCrewCommand(modelChangeText(from, now));
      expect(await runHook(crewRoleHook, promptInput(world.repo, prompt), world.env)).toEqual({});
    }
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
    // A change to values the record does not hold, and the words with no crew command, are theirs.
    const other = modelChangeText(
      { effort: "high", model: "opus" },
      { effort: "high", model: "haiku" },
    );
    await runHook(crewRoleHook, promptInput(world.repo, withCrewCommand(other)), world.env);
    await runHook(
      crewRoleHook,
      promptInput(world.repo, modelChangeText({ effort: "high", model: "opus" }, now)),
      world.env,
    );
    expect(personEvents(world.stateDir, world.repo).length).toBe(2);
  });

  /** A stopped record whose one question has the answer "yes", heard by the session or not. */
  async function answeredStopped(heard: boolean) {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    return await crewWorld({
      questions: [
        {
          answer: "yes",
          answeredAt: at,
          askedAt: at,
          deliveredAt: heard ? at : null,
          options: ["keep the guard", "drop the guard"],
          question: "keep the guard or drop it?",
          recommended: 1,
        },
      ],
      state: "stopped",
    });
  }

  test("crew answer's resume with a correction: silent before and after the store records it", async () => {
    const world = await answeredStopped(true);
    const corrected = withCrewCommand(deliveryText("keep the guard or drop it?", "no", "yes"));
    // Before the write: the head names the answer on record now.
    expect(await runHook(crewRoleHook, promptInput(world.repo, corrected), world.env)).toEqual({});
    // After it: the replaced answer is in `superseded`, and the head still names it.
    await answerCrewQuestion(
      world.stateDir,
      world.repo,
      CREW_ID,
      0,
      "no",
      Date.now(),
      "working",
      null,
      { correction: true, delivered: true },
    );
    expect(await runHook(crewRoleHook, promptInput(world.repo, corrected), world.env)).toEqual({});
    expect(personEvents(world.stateDir, world.repo)).toEqual([]);
    // The same words with no crew command, and a head that names an answer the question never
    // had, are the person's.
    await runHook(
      crewRoleHook,
      promptInput(world.repo, deliveryText("keep the guard or drop it?", "no", "yes")),
      world.env,
    );
    await runHook(
      crewRoleHook,
      promptInput(
        world.repo,
        withCrewCommand(deliveryText("keep the guard or drop it?", "no", "maybe")),
      ),
      world.env,
    );
    expect(personEvents(world.stateDir, world.repo).length).toBe(2);
  });

  test("a correction of an answer the session never heard has no head: behind the command, while stopped, it is the lead's", async () => {
    const unheard = await answeredStopped(false);
    const prompt = withCrewCommand(deliveryText("keep the guard or drop it?", "no", null));
    expect(await runHook(crewRoleHook, promptInput(unheard.repo, prompt), unheard.env)).toEqual({});
    expect(personEvents(unheard.stateDir, unheard.repo)).toEqual([]);
    // Once the session heard the answer, a bare answer behind the command is no correction.
    const heard = await answeredStopped(true);
    await runHook(crewRoleHook, promptInput(heard.repo, prompt), heard.env);
    expect(personEvents(heard.stateDir, heard.repo).length).toBe(1);
  });
});
