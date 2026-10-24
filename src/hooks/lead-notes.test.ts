/**
 * The lead's notes hook (`lead-notes.ts`): one line about what changed among the lead's crew
 * sessions since its last turn, said once, and the one-line crew rule at a session start (D61).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import {
  appendCrewEvent,
  createCrew,
  crewEventsFile,
  leadFile,
  listCrew,
  type NewCrew,
  readNotesState,
  writeLead,
  writeNotesState,
  writeStoreFile,
} from "../crew/store";
import { LEAD_SESSION, OTHER_SESSION } from "../testing/crew-world";
import { hookEnv, makeClone, runHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { addContext } from "./io";
import { leadNotesAnswer, notesLine } from "./lead-notes";
import { namesDir } from "./session-name";
import { leadNotesHook } from "./specs";

const CREW_ID = "W2-x-1a2b3c";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const T0 = Date.parse("2026-10-21T10:00:00.000Z");
/** The D61 start note, written out: the lead skill's "Your crew builds" in one line. */
const START_NOTE =
  "You lead: your crew sessions build the work — your context is re-read every turn, so every file you read or write costs on every later turn.";

/** A crew record as `crew start` writes one, in `repo`. */
function newCrew(repo: string): NewCrew {
  return {
    base: null,
    baseRef: "main",
    branch: "crew/W2-hooks",
    effort: "high",
    files: [],
    id: CREW_ID,
    kind: "build",
    lastLine: null,
    leadName: "LEAD app plan",
    leadSessionId: LEAD_SESSION,
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
    state: "working",
    waitsFor: [],
    worktree: join(repo, ".claude", "worktrees", "crew-W2-hooks"),
  };
}

/**
 * A world with the lead registered and its crew session recorded. `cursor` (the default) seeds the
 * notes cursor at the log's start, so the events a test appends are the lead's news; without it the
 * lead's first turn seeds the cursor itself. `named` (the default) says the lead already took its
 * name at an earlier prompt: the record `session-name.ts` keeps is written by hand, so a test about
 * the news does not read the name too. Without it the next prompt is the lead's first since
 * `crew lead`, and the LD1 tests watch it name the session. `list` (the default) says the lead
 * already has a task list: one task file in Claude Code's own folder for its session
 * (`docs/claude-code-contract.md` § The to-do list), so a test about the news is not also about
 * the D23 reminder. Without it the lead has no list, and a prompt gets the reminder.
 */
async function leadWorld(
  options: { cursor?: boolean; list?: boolean; named?: boolean } = {},
): Promise<{
  env: Record<string, string>;
  repo: string;
  stateDir: string;
}> {
  const { repo } = makeClone();
  const env = hookEnv();
  const stateDir = cliPaths(env).stateDir;
  await writeLead(
    stateDir,
    {
      cwd: repo,
      name: "LEAD app plan",
      plan: "plan",
      repo,
      sessionId: LEAD_SESSION,
      tag: "app",
    },
    T0,
  );
  await createCrew(stateDir, newCrew(repo), T0);
  if (options.cursor ?? true) writeNotesState(stateDir, repo, LEAD_SESSION, { offset: 0 });
  if (options.named ?? true) {
    mkdirSync(namesDir(env), { recursive: true });
    writeFileSync(join(namesDir(env), LEAD_SESSION), "LEAD app plan");
  }
  if (options.list ?? true) taskFile(env, LEAD_SESSION, 1);
  return { env, repo, stateDir };
}

/**
 * One task file in `list`'s folder, as Claude Code writes it: the lead's own list, or the one
 * `CLAUDE_CODE_TASK_LIST_ID` names.
 */
function taskFile(env: Record<string, string>, list: string, n: number): void {
  const folder = join(cliPaths(env).claudeConfigDir, "tasks", list);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, `${String(n)}.json`),
    `${JSON.stringify({ id: String(n), subject: `Part ${String(n)}`, description: "x", status: "pending", blocks: [], blockedBy: [] }, null, 2)}\n`,
  );
}

/** One step of the crew session, as `crew step` appends it. */
async function step(
  stateDir: string,
  repo: string,
  text: string,
  lead: string = LEAD_SESSION,
): Promise<void> {
  await appendCrewEvent(
    stateDir,
    repo,
    {
      crew: CREW_ID,
      lead,
      name: "C app W2 hooks",
      sha: SHA,
      state: "working",
      text,
      type: "step",
    },
    T0,
  );
}

/** The input of a lead's turn. */
function leadInput(repo: string, change: Record<string, unknown> = {}) {
  return {
    hook_event_name: "UserPromptSubmit",
    session_id: LEAD_SESSION,
    cwd: repo,
    prompt: "go on",
    ...change,
  };
}

/** One note's exact line as a step event gives it. */
function stepLine(text: string): string {
  return `C app W2 hooks: ${text} · a1b2c3d`;
}

describe("one note, then none", () => {
  test("a new step is said once; the next turn says nothing", async () => {
    const world = await leadWorld();
    await step(world.stateDir, world.repo, "tests-green");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", stepLine("tests-green")),
    );
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("the newest line, and how many older ones this turn did not print", async () => {
    const world = await leadWorld();
    await step(world.stateDir, world.repo, "tests-green");
    await step(world.stateDir, world.repo, "committed");
    await step(world.stateDir, world.repo, "review-done");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", `${stepLine("review-done")} (and 2 more…)`),
    );
    expect(notesLine([])).toBeNull();
    expect(notesLine(["one"])).toBe("one");
    expect(notesLine(["one", "two"])).toBe("two (and 1 more…)");
  });

  test("the cursor survives a restart: the same news is never said twice", async () => {
    const world = await leadWorld();
    await step(world.stateDir, world.repo, "tests-green");
    const first = await runHook(leadNotesHook, leadInput(world.repo), world.env);
    expect(first.stdout).toBeDefined();
    // The cursor is past every whole line, so a new process (the same files, a new run) is silent.
    expect(readNotesState(world.stateDir, world.repo, LEAD_SESSION)).toEqual({
      offset: statSync(crewEventsFile(world.stateDir, world.repo)).size,
    });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
    // Only what is newer is said.
    await step(world.stateDir, world.repo, "committed");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", stepLine("committed")),
    );
  });

  test("the first turn seeds the cursor at the log's end: the history is not news", async () => {
    const world = await leadWorld({ cursor: false });
    await step(world.stateDir, world.repo, "tests-green");
    expect(readNotesState(world.stateDir, world.repo, LEAD_SESSION)).toBeNull();
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
    expect(readNotesState(world.stateDir, world.repo, LEAD_SESSION)).toEqual({
      offset: statSync(crewEventsFile(world.stateDir, world.repo)).size,
    });
    await step(world.stateDir, world.repo, "committed");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", stepLine("committed")),
    );
  });

  test("an event with no line (a start) is skipped, and the cursor still moves", async () => {
    const world = await leadWorld();
    await appendCrewEvent(
      world.stateDir,
      world.repo,
      {
        crew: CREW_ID,
        lead: LEAD_SESSION,
        name: "C app W2 hooks",
        state: "starting",
        text: null,
        type: "state",
      },
      T0,
    );
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
    expect(readNotesState(world.stateDir, world.repo, LEAD_SESSION)).toEqual({
      offset: statSync(crewEventsFile(world.stateDir, world.repo)).size,
    });
  });
});

describe("only this lead's news", () => {
  test("another lead's events are skipped, and a later own event is said alone", async () => {
    const world = await leadWorld();
    await step(world.stateDir, world.repo, "tests-green", OTHER_SESSION);
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
    await step(world.stateDir, world.repo, "committed");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", stepLine("committed")),
    );
  });
});

describe("the lead's name (LD1)", () => {
  const NAME = "LEAD app plan";

  /**
   * The answer this turn must give, written by hand — never built with the hook's own
   * `addContextAndTitle`: one `UserPromptSubmit` answer holding the lead's note and its name.
   */
  function named(text: null | string, title: string): { stdout: string } {
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          ...(text === null ? {} : { additionalContext: text }),
          sessionTitle: title,
        },
      }),
    };
  }

  test("the first prompt after crew lead sets it, alone", async () => {
    // No cursor, no name and no events: the turn seeds the cursor, and still names the session.
    const world = await leadWorld({ cursor: false, named: false });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      named(null, NAME),
    );
  });

  test("one answer carries the lead's note and its name", async () => {
    const world = await leadWorld({ named: false });
    await step(world.stateDir, world.repo, "tests-green");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      named(stepLine("tests-green"), NAME),
    );
  });

  test("the name's record cannot be written (TMPDIR is a file): the news still reaches the lead, once, and one line says why", async () => {
    // `titleToSet` writes the name it sets into `<TMPDIR>/cc-smart-dev-kit-session-names`. The
    // cursor had already moved past the news when that write threw, so the throw lost the news
    // for good: the next turn heard nothing of it.
    const world = await leadWorld({ named: false });
    await step(world.stateDir, world.repo, "tests-green");
    const notAFolder = join(tempDir("tmp-is-a-file"), "tmp");
    writeFileSync(notAFolder, "");
    const result = await runHook(leadNotesHook, leadInput(world.repo), {
      ...world.env,
      TMPDIR: notAFolder,
    });
    expect(result.stdout).toBe(addContext("UserPromptSubmit", stepLine("tests-green")).stdout);
    expect(result.stderr).toStartWith(
      "cc-smart-dev-kit lead-notes: the session name could not be recorded, so it is not set this turn (",
    );
    // The news is said once, and the name is set on the first turn that can record it.
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      named(null, NAME),
    );
  });

  test("a second prompt with the same title sets nothing", async () => {
    const world = await leadWorld({ named: false });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      named(null, NAME),
    );
    // The next prompt carries the title Claude Code applied.
    expect(
      await runHook(leadNotesHook, leadInput(world.repo, { session_title: NAME }), world.env),
    ).toEqual({});
    // A prompt that names no title at all is not set again either: the kit's record says it set it.
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("a lost record, with the session already called that: nothing is set again", async () => {
    const world = await leadWorld({ named: false });
    await runHook(leadNotesHook, leadInput(world.repo), world.env);
    rmSync(join(namesDir(world.env), LEAD_SESSION));
    expect(
      await runHook(leadNotesHook, leadInput(world.repo, { session_title: NAME }), world.env),
    ).toEqual({});
    // The name the session already carries is the kit's now: a rename from here is the person's.
    expect(
      await runHook(leadNotesHook, leadInput(world.repo, { session_title: "mine now" }), world.env),
    ).toEqual({});
  });

  test("the name is remembered where the session-name hook keeps the one it set", async () => {
    const world = await leadWorld({ named: false });
    await runHook(leadNotesHook, leadInput(world.repo), world.env);
    expect(readFileSync(join(namesDir(world.env), LEAD_SESSION), "utf8")).toBe(NAME);
  });

  test("the person's own /rename stays, and the news still comes", async () => {
    const world = await leadWorld();
    await step(world.stateDir, world.repo, "tests-green");
    expect(
      await runHook(
        leadNotesHook,
        leadInput(world.repo, { session_title: "my own name" }),
        world.env,
      ),
    ).toEqual(addContext("UserPromptSubmit", stepLine("tests-green")));
  });

  test("a session named after its task first: the lead's name takes over", async () => {
    const world = await leadWorld({ named: false });
    // `session-name` set a task name at an earlier prompt: its record, by hand.
    mkdirSync(namesDir(world.env), { recursive: true });
    writeFileSync(join(namesDir(world.env), LEAD_SESSION), "Fix login");
    expect(
      await runHook(
        leadNotesHook,
        leadInput(world.repo, { session_title: "Fix login" }),
        world.env,
      ),
    ).toEqual(named(null, NAME));
  });

  test("another plan registered later takes its new name", async () => {
    const world = await leadWorld();
    await writeLead(
      world.stateDir,
      {
        cwd: world.repo,
        name: "LEAD app other",
        plan: "other",
        repo: world.repo,
        sessionId: LEAD_SESSION,
        tag: "app",
      },
      T0,
    );
    expect(
      await runHook(
        leadNotesHook,
        leadInput(world.repo, { session_title: "my own name" }),
        world.env,
      ),
    ).toEqual(named(null, "LEAD app other"));
  });

  test("a SessionStart never sets a title: the prompt is the route that reaches the name", async () => {
    const world = await leadWorld({ named: false });
    expect(
      await runHook(
        leadNotesHook,
        {
          hook_event_name: "SessionStart",
          session_id: LEAD_SESSION,
          cwd: world.repo,
          source: "resume",
        },
        world.env,
      ),
      // The start note, and no `sessionTitle` beside it: `addContext` is the exact answer.
    ).toEqual(addContext("SessionStart", START_NOTE));
  });
});

describe("D61: a lead's start note, and never a prompt", () => {
  /** A session start, as Claude Code gives it. */
  function start(repo: string, source: string) {
    return { hook_event_name: "SessionStart", session_id: LEAD_SESSION, cwd: repo, source };
  }

  test("a start, a resume and a compaction each carry it (the wiring's three sources, `entries.test.ts`)", async () => {
    const world = await leadWorld();
    for (const source of ["startup", "resume", "compact"]) {
      expect(await runHook(leadNotesHook, start(world.repo, source), world.env)).toEqual(
        addContext("SessionStart", START_NOTE),
      );
    }
  });

  test("a prompt never carries it: words at a start only", async () => {
    const world = await leadWorld();
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("a start's news comes after it, in one answer", async () => {
    const world = await leadWorld();
    await step(world.stateDir, world.repo, "tests-green");
    expect(await runHook(leadNotesHook, start(world.repo, "resume"), world.env)).toEqual(
      addContext("SessionStart", `${START_NOTE}\n${stepLine("tests-green")}`),
    );
  });

  test("the first turn in a lead, which seeds the cursor, still carries it", async () => {
    const world = await leadWorld({ cursor: false });
    expect(await runHook(leadNotesHook, start(world.repo, "startup"), world.env)).toEqual(
      addContext("SessionStart", START_NOTE),
    );
    expect(readNotesState(world.stateDir, world.repo, LEAD_SESSION)).toEqual({
      offset: statSync(crewEventsFile(world.stateDir, world.repo)).size,
    });
  });

  test("an ordinary session hears nothing", async () => {
    const { repo } = makeClone();
    const env = hookEnv();
    expect(await runHook(leadNotesHook, start(repo, "startup"), env)).toEqual({});
  });

  test("a crew session hears nothing: it is not the lead", async () => {
    const world = await leadWorld();
    // The store really holds a crew session for that id (`sessionId` is null on the world's own
    // record): a crew session is a crew record, never a lead one, so the note is not for it.
    const crewSession = "0a1b2c3d-0000-4000-8000-000000000000";
    await createCrew(
      world.stateDir,
      { ...newCrew(world.repo), id: "W3-x-9f8e7d", sessionId: crewSession },
      T0,
    );
    expect(
      await runHook(
        leadNotesHook,
        { ...start(world.repo, "startup"), session_id: crewSession },
        world.env,
      ),
    ).toEqual({});
  });
});

describe("D23: a lead with no to-do list is reminded, never blocked", () => {
  /** The reminder, written out. */
  const REMINDER =
    "You have no to-do list: put the person's asks and your open work on it (TaskCreate), and keep it true as they move.";
  const NAME = "LEAD app plan";

  test("a prompt while the lead has no list: the reminder, as the one line of context", async () => {
    const world = await leadWorld({ list: false });
    const result = await runHook(leadNotesHook, leadInput(world.repo), world.env);
    expect(result).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: REMINDER },
      }),
    });
    // Never a block, never a question: the answer carries context and nothing else.
    expect(result.exitCode ?? 0).toBe(0);
  });

  test("every prompt says it while the list is missing, and none once a task exists", async () => {
    const world = await leadWorld({ list: false });
    const reminder = addContext("UserPromptSubmit", REMINDER);
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(reminder);
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(reminder);
    taskFile(world.env, LEAD_SESSION, 1);
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("a task in any status is a list: a finished list is not a missing one", async () => {
    const world = await leadWorld({ list: false });
    const folder = join(cliPaths(world.env).claudeConfigDir, "tasks", LEAD_SESSION);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "1.json"),
      JSON.stringify({ id: "1", subject: "done", description: "x", status: "completed" }),
    );
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("a list whose every task was removed is no list: the lock and the high-water mark are not tasks", async () => {
    const world = await leadWorld({ list: false });
    const folder = join(cliPaths(world.env).claudeConfigDir, "tasks", LEAD_SESSION);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".lock"), "");
    writeFileSync(join(folder, ".highwatermark"), "3");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", REMINDER),
    );
  });

  test("another session's list is not the lead's", async () => {
    const world = await leadWorld({ list: false });
    taskFile(world.env, "0a1b2c3d-0000-4000-8000-000000000000", 1);
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", REMINDER),
    );
  });

  test("CLAUDE_CODE_TASK_LIST_ID names the lead's list too", async () => {
    const world = await leadWorld({ list: false });
    const env = { ...world.env, CLAUDE_CODE_TASK_LIST_ID: "shared-list" };
    // A list in the session's own folder is not the one the environment names.
    taskFile(env, LEAD_SESSION, 1);
    expect(await runHook(leadNotesHook, leadInput(world.repo), env)).toEqual(
      addContext("UserPromptSubmit", REMINDER),
    );
    taskFile(env, "shared-list", 1);
    expect(await runHook(leadNotesHook, leadInput(world.repo), env)).toEqual({});
  });

  test("the reminder comes first and the news after it, in one answer", async () => {
    const world = await leadWorld({ list: false });
    await step(world.stateDir, world.repo, "tests-green");
    await step(world.stateDir, world.repo, "committed");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", `${REMINDER}\n${stepLine("committed")} (and 1 more…)`),
    );
    // The news is said once; the reminder is said again.
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", REMINDER),
    );
  });

  test("the first prompt, which seeds the cursor, carries it too, beside the lead's name", async () => {
    const world = await leadWorld({ cursor: false, list: false, named: false });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: REMINDER,
          sessionTitle: NAME,
        },
      }),
    });
  });

  test("a start is not a prompt: SessionStart never carries the reminder", async () => {
    const world = await leadWorld({ list: false });
    const start = {
      hook_event_name: "SessionStart",
      session_id: LEAD_SESSION,
      cwd: world.repo,
      source: "resume",
    };
    // The D61 start note, and never the reminder: `addContext` is the exact answer.
    expect(await runHook(leadNotesHook, start, world.env)).toEqual(
      addContext("SessionStart", START_NOTE),
    );
    // News at a start is still said, without it.
    await step(world.stateDir, world.repo, "tests-green");
    expect(await runHook(leadNotesHook, start, world.env)).toEqual(
      addContext("SessionStart", `${START_NOTE}\n${stepLine("tests-green")}`),
    );
  });

  test("a session that is not a recorded lead hears nothing of it", async () => {
    const { repo } = makeClone();
    const env = hookEnv();
    expect(await runHook(leadNotesHook, leadInput(repo), env)).toEqual({});
  });

  test("a folder it cannot read says nothing: no reminder on a guess", async () => {
    const world = await leadWorld({ list: false });
    // A file where the lead's task folder belongs.
    mkdirSync(join(cliPaths(world.env).claudeConfigDir, "tasks"), { recursive: true });
    writeFileSync(join(cliPaths(world.env).claudeConfigDir, "tasks", LEAD_SESSION), "{}");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });
});

describe("silence, and the fail-safe", () => {
  test("a session that is not a registered lead hears nothing, and no cursor is made", async () => {
    const { repo } = makeClone();
    const env = hookEnv();
    expect(await runHook(leadNotesHook, leadInput(repo), env)).toEqual({});
    expect(readNotesState(cliPaths(env).stateDir, repo, LEAD_SESSION)).toBeNull();
  });

  test("outside git: nothing", async () => {
    const env = hookEnv();
    const repo = tempDir("outside");
    expect(await runHook(leadNotesHook, leadInput(repo), env)).toEqual({});
    expect(
      leadNotesAnswer(
        { hook_event_name: "UserPromptSubmit", session_id: LEAD_SESSION },
        "UserPromptSubmit",
        cliPaths(env),
        null,
        env,
      ),
    ).toEqual({});
  });

  test("a broken store is one stderr line, exit 0: a lead's turn goes on", async () => {
    const world = await leadWorld();
    writeStoreFile(leadFile(world.stateDir, world.repo, LEAD_SESSION), "{ not json");
    const result = await runHook(leadNotesHook, leadInput(world.repo), world.env);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit lead-notes: Invalid ");
  });

  test("a broken events line is counted and skipped: the rest is still said", async () => {
    const world = await leadWorld();
    writeStoreFile(
      crewEventsFile(world.stateDir, world.repo),
      `not json\n${JSON.stringify({
        at: "2026-10-21T10:00:00.000Z",
        crew: CREW_ID,
        lead: LEAD_SESSION,
        name: "C app W2 hooks",
        sha: SHA,
        state: "working",
        text: "committed",
        type: "step",
        version: 1,
      })}\n`,
    );
    writeNotesState(world.stateDir, world.repo, LEAD_SESSION, { offset: 0 });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", stepLine("committed")),
    );
    // The store is otherwise untouched: one crew record, read for its line.
    expect(listCrew(world.stateDir, world.repo).records).toHaveLength(1);
  });
});
