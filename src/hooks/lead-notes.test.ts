/**
 * The lead's notes hook (`lead-notes.ts`): one line about what changed among the lead's crew
 * sessions since its last turn, said once.
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
 * `crew lead`, and the LD1 tests watch it name the session.
 */
async function leadWorld(options: { cursor?: boolean; named?: boolean } = {}): Promise<{
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
  return { env, repo, stateDir };
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
    ).toEqual({});
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
