/**
 * The lead's notes hook (`lead-notes.ts`): one line about what changed among the lead's crew
 * sessions since its last turn, said once, and the one-line crew rule at a session start (D61).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import {
  adoptLead,
  appendCrewEvent,
  createCrew,
  crewEventsFile,
  ISSUE_DATA_NOTE,
  ISSUE_EVENT_CREW,
  leadFile,
  listCrew,
  type NewCrew,
  readLead,
  readNotesState,
  takeWatchLease,
  updateCrew,
  watchLeaseFile,
  writeLead,
  writeNotesState,
  writeStoreFile,
} from "../crew/store";
import { ISSUE_DATA_FRAME, WATCH_MONITOR_COMMAND } from "../crew/watch";
import { currentHolder } from "../setup/lock";
import { LEAD_SESSION, OTHER_SESSION } from "../testing/crew-world";
import { hookEnv, makeClone, runHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { addContext } from "./io";
import {
  leadNotesAnswer,
  leadStopWouldBlockAt,
  notesLine,
  watchEndedNote,
  watchNeverStartedNote,
} from "./lead-notes";
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
 * the D23 reminder. Without it the lead has no list, and a prompt gets the reminder. `watch` (the
 * default `alive`) says a live watch holds the lead's lease, so a test about the news is not also
 * about the watch's own line: `ended` leaves a lease whose process is gone (the monitor ended),
 * `never` leaves none (the lead skill never ran), `once-ended` leaves a gone `--once` look's.
 */
async function leadWorld(
  options: {
    cursor?: boolean;
    list?: boolean;
    named?: boolean;
    watch?: "alive" | "ended" | "never" | "once-ended";
  } = {},
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
  const watch = options.watch ?? "alive";
  if (watch !== "never") {
    // An ended process: a short program that has run and exited, so its pid is gone.
    const ended = Bun.spawnSync([process.execPath, "-e", ""]);
    await takeWatchLease(stateDir, repo, LEAD_SESSION, {
      ...currentHolder(),
      ...(watch === "alive" ? {} : { pid: ended.pid }),
      ...(watch === "once-ended" ? { once: true } : {}),
      // The real clock: where a process's start time cannot be read (Windows), a lease is judged
      // by its age, and a live watch took its lease just now.
      at: Date.now(),
      token: "a-watch",
    });
  }
  return { env, repo, stateDir };
}

/**
 * One task file in `list`'s folder, as Claude Code writes it: the lead's own list, or the one
 * `CLAUDE_CODE_TASK_LIST_ID` names.
 */
function taskFile(env: Record<string, string>, list: string, n: number, status = "pending"): void {
  const folder = join(cliPaths(env).claudeConfigDir, "tasks", list);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, `${String(n)}.json`),
    `${JSON.stringify({ id: String(n), subject: `Part ${String(n)}`, description: "x", status, blocks: [], blockedBy: [] }, null, 2)}\n`,
  );
}

describe("lead Stop continuation", () => {
  const stop = (repo: string, extra: Record<string, unknown> = {}) => ({
    hook_event_name: "Stop",
    session_id: LEAD_SESSION,
    cwd: repo,
    last_assistant_message: "Next I'll push the PRs.",
    ...extra,
  });
  const one = {
    stdout: JSON.stringify({
      decision: "block",
      reason:
        'Your task "Part 1" is still in progress. Continue it now. If it really waits for something — a crew session, the person, CI — end your turn with one line: Waiting for: <what>.',
    }),
  };

  test("the notifier decision matches the Stop and fails open", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    expect(leadStopWouldBlockAt(stop(w.repo), w.env)).toBe(true);
    expect(leadStopWouldBlockAt(stop(w.repo, { stop_hook_active: true }), w.env)).toBe(false);
    expect(leadStopWouldBlockAt(stop(w.repo, { session_id: OTHER_SESSION }), w.env)).toBe(false);
    expect(leadStopWouldBlockAt(stop(tempDir("outside-notifier")), w.env)).toBe(false);
    writeStoreFile(leadFile(w.stateDir, w.repo, LEAD_SESSION), "{ not json");
    expect(leadStopWouldBlockAt(stop(w.repo), w.env)).toBe(false);
  });

  test("one in-progress task blocks with the exact instruction", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    expect(await runHook(leadNotesHook, stop(w.repo), w.env)).toEqual(one);
  });

  test("two in-progress tasks name the first and count the rest", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    taskFile(w.env, LEAD_SESSION, 2, "in_progress");
    expect(await runHook(leadNotesHook, stop(w.repo), w.env)).toEqual({
      stdout: JSON.stringify({
        decision: "block",
        reason:
          'Your task "Part 1" (and 1 more) is still in progress. Continue it now. If it really waits for something — a crew session, the person, CI — end your turn with one line: Waiting for: <what>.',
      }),
    });
  });

  test.each([
    [
      "bold waiting line",
      { last_assistant_message: "Done for now.\n**Waiting for:** C1's hand-back" },
    ],
    ["quoted mixed-case waiting line", { last_assistant_message: " > - _**wAiTiNg FoR:** CI" }],
    ["follow-up stop", { stop_hook_active: true }],
    ["missing last message", { last_assistant_message: undefined }],
    ["non-string last message", { last_assistant_message: 7 }],
  ])("%s is silent", async (_name, extra) => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    taskFile(w.env, LEAD_SESSION, 2, "in_progress");
    expect(await runHook(leadNotesHook, stop(w.repo, extra), w.env)).toEqual({});
  });

  test("a turn that waits on background work is not over: silent", async () => {
    // A lead that ended its turn while its subagent builds: Claude Code wakes it when the work
    // lands, so a block would only cost a turn.
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    const builder = { id: "a1b2c3", status: "running", type: "agent" };
    const watch = {
      command: WATCH_MONITOR_COMMAND,
      id: "bm4k2x9a1",
      status: "running",
      type: "shell",
    };
    expect(
      await runHook(leadNotesHook, stop(w.repo, { background_tasks: [watch, builder] }), w.env),
    ).toEqual({});
    expect(leadStopWouldBlockAt(stop(w.repo, { background_tasks: [builder] }), w.env)).toBe(false);
  });

  test("the lead's own watch is no background work: it runs all session, and the block holds", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    const watch = {
      command: WATCH_MONITOR_COMMAND,
      id: "bm4k2x9a1",
      status: "running",
      type: "shell",
    };
    expect(
      await runHook(leadNotesHook, stop(w.repo, { background_tasks: [watch] }), w.env),
    ).toEqual(one);
  });

  test("pending and completed tasks do not hold the turn", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 2, "completed");
    expect(await runHook(leadNotesHook, stop(w.repo), w.env)).toEqual({});
  });

  test("no task folder is silent", async () => {
    const w = await leadWorld({ list: false });
    expect(await runHook(leadNotesHook, stop(w.repo), w.env)).toEqual({});
  });

  test("an unreadable task folder is silent", async () => {
    const w = await leadWorld({ list: false });
    mkdirSync(join(cliPaths(w.env).claudeConfigDir, "tasks"), { recursive: true });
    writeFileSync(join(cliPaths(w.env).claudeConfigDir, "tasks", LEAD_SESSION), "{}");
    expect(await runHook(leadNotesHook, stop(w.repo), w.env)).toEqual({});
  });

  test("no lead record is silent even with an active task", async () => {
    const { repo } = makeClone();
    const env = hookEnv();
    taskFile(env, LEAD_SESSION, 1, "in_progress");
    expect(await runHook(leadNotesHook, stop(repo), env)).toEqual({});
  });

  test("an ended lead is silent", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    const file = leadFile(w.stateDir, w.repo, LEAD_SESSION);
    const record = JSON.parse(readFileSync(file, "utf8"));
    writeStoreFile(file, JSON.stringify({ ...record, endedAt: new Date(T0).toISOString() }));
    expect(await runHook(leadNotesHook, stop(w.repo), w.env)).toEqual({});
  });

  test("a crew session is silent even with a lead record", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    expect(
      await runHook(leadNotesHook, stop(w.repo), { ...w.env, CC_SMART_DEV_KIT_CREW: CREW_ID }),
    ).toEqual({});
  });

  test("outside git is silent", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    expect(await runHook(leadNotesHook, stop(tempDir("outside-stop")), w.env)).toEqual({});
  });

  test("the named task list is read instead of the session list", async () => {
    const w = await leadWorld();
    taskFile(w.env, "shared-list", 1, "in_progress");
    expect(
      await runHook(leadNotesHook, stop(w.repo), {
        ...w.env,
        CLAUDE_CODE_TASK_LIST_ID: "shared-list",
      }),
    ).toEqual(one);
  });

  test.each([{ worktree: {} }, { requires: ">=99" }])(
    "a config problem never blocks: %j",
    async (config) => {
      const w = await leadWorld();
      taskFile(w.env, LEAD_SESSION, 1, "in_progress");
      mkdirSync(join(w.repo, ".claude"), { recursive: true });
      writeFileSync(join(w.repo, ".claude", "cc-smart-dev-kit.json"), JSON.stringify(config));
      expect(await runHook(leadNotesHook, stop(w.repo), w.env)).toEqual({});
    },
  );

  test("a broken store is stderr only, exit zero", async () => {
    const w = await leadWorld();
    taskFile(w.env, LEAD_SESSION, 1, "in_progress");
    writeStoreFile(leadFile(w.stateDir, w.repo, LEAD_SESSION), "{ not json");
    const result = await runHook(leadNotesHook, stop(w.repo), w.env);
    expect(result.stdout).toBeUndefined();
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr).toStartWith("cc-smart-dev-kit lead-notes: Invalid ");
    expect(result.stderr).not.toContain("\n");
  });
});

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

  test("GI4: a line of GitHub's words carries its own data frame, since only the newest line is shown", async () => {
    const world = await leadWorld();
    await appendCrewEvent(
      world.stateDir,
      world.repo,
      {
        crew: ISSUE_EVENT_CREW,
        lead: LEAD_SESSION,
        name: "issues",
        note: ISSUE_DATA_NOTE,
        state: "working",
        text: 'issue #2 opened by alice: "Login fails"',
        type: "issue",
      },
      T0,
    );
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext(
        "UserPromptSubmit",
        `${ISSUE_DATA_FRAME} — issue #2 opened by alice: "Login fails"`,
      ),
    );
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

test("a question from an earlier lead id reaches the adopted lead", async () => {
  const world = await leadWorld({ watch: "never" });
  const nextId = "dddd1111-2222-3333-4444-555555555555";
  const lead = readLead(world.stateDir, world.repo, LEAD_SESSION);
  if (lead === null) throw new Error("missing test lead");
  await writeLead(world.stateDir, { ...lead, sessionId: nextId }, T0);
  await appendCrewEvent(
    world.stateDir,
    world.repo,
    {
      crew: CREW_ID,
      lead: LEAD_SESSION,
      name: "C app W2 hooks",
      state: "blocked",
      type: "question",
      text: "Which path?",
    },
    T0,
  );
  await adoptLead(world.stateDir, world.repo, LEAD_SESSION, nextId, T0, () => false);
  const answer = leadNotesAnswer(
    { ...leadInput(world.repo), session_id: nextId },
    "UserPromptSubmit",
    cliPaths(world.env),
    world.repo,
    world.env,
  );
  expect(JSON.stringify(answer)).toContain("Which path?");
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
      "cc-smart-dev-kit lead-notes: the session name could not be recorded (",
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
    "You have no Claude Code task list: put the person's asks and your open work on it (TaskCreate, not claude-mem's work state), and keep it true as they move.";
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

describe("a lead whose watch is gone is told how to start it", () => {
  /** The two lines, written out: what the hook says in each case (not computed by the hook). */
  const NEVER =
    "Your crew watch is not running, so crew news will not reach you: run /cc-smart-dev-kit:lead to start it.";
  const ENDED =
    'Your crew watch ended: start the watch again with Claude Code\'s Monitor tool (timeout_ms: 1800000; re-arm at once on expiry), command: "$HOME/.local/bin/cc-smart-dev-kit" crew watch (or run /cc-smart-dev-kit:lead in a new session).';

  test("the two lines are the ones written out above", () => {
    expect(watchNeverStartedNote()).toBe(NEVER);
    expect(watchEndedNote()).toBe(ENDED);
  });

  test("the command in the line is the one the lead's monitor runs", () => {
    const monitors = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "plugin", "monitors", "monitors.json"),
        "utf8",
      ),
    ) as Array<{ command: string; name: string }>;
    const events = monitors.find((one) => one.name === "crew-events");
    expect(events?.command).toBe(WATCH_MONITOR_COMMAND);
    expect(watchEndedNote()).toContain(WATCH_MONITOR_COMMAND);
  });

  test("a live watch holds the lease: nothing is said", async () => {
    const world = await leadWorld({ watch: "alive" });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("no lease was ever taken: the lead is told to run the lead skill", async () => {
    const world = await leadWorld({ watch: "never" });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", NEVER),
    );
  });

  test("a lease whose watch ended: the lead is told to start the monitor itself", async () => {
    const world = await leadWorld({ watch: "ended" });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", ENDED),
    );
  });

  test("a lease a --once look left is no ended watch: nothing is said (watch review #6)", async () => {
    // A lead that uses only `--once` looks: each ends at its first news by design.
    const world = await leadWorld({ watch: "once-ended" });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("it is said on every turn while it lasts, and the news comes after it in one answer", async () => {
    const world = await leadWorld({ watch: "ended" });
    await step(world.stateDir, world.repo, "tests-green");
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", `${ENDED}\n${stepLine("tests-green")}`),
    );
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", ENDED),
    );
    // The lead starts its watch: the line stops.
    await takeWatchLease(world.stateDir, world.repo, LEAD_SESSION, {
      ...currentHolder(),
      at: Date.now(),
      token: "the-new-watch",
    });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("a start carries it after the crew rule; the first turn, which seeds the cursor, too", async () => {
    const world = await leadWorld({ cursor: false, watch: "never" });
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
    ).toEqual(addContext("SessionStart", `${START_NOTE}\n${NEVER}`));
    expect(readNotesState(world.stateDir, world.repo, LEAD_SESSION)).not.toBeNull();
  });

  test("a lead whose plan ended hears nothing about its watch", async () => {
    const world = await leadWorld({ watch: "never" });
    const lead = JSON.parse(
      readFileSync(leadFile(world.stateDir, world.repo, LEAD_SESSION), "utf8"),
    );
    writeStoreFile(
      leadFile(world.stateDir, world.repo, LEAD_SESSION),
      `${JSON.stringify({ ...lead, endedAt: "2026-10-21T11:00:00.000Z" })}\n`,
    );
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("a lead whose crew sessions are all merged has no news to miss", async () => {
    const world = await leadWorld({ watch: "never" });
    await updateCrew(world.stateDir, world.repo, CREW_ID, { state: "merged" }, T0);
    // The merge is news, said alone: no line about the watch beside it, and none after it.
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", "C app W2 hooks: merged"),
    );
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("a lease the hook cannot read says nothing: a wrong line is worse than none", async () => {
    const world = await leadWorld({ watch: "never" });
    // A folder where the lease file should be: reading it fails, and the lead's turn goes on.
    mkdirSync(watchLeaseFile(world.stateDir, world.repo, LEAD_SESSION), { recursive: true });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual({});
  });

  test("another lead's live watch is not this lead's", async () => {
    const world = await leadWorld({ watch: "never" });
    await takeWatchLease(world.stateDir, world.repo, OTHER_SESSION, {
      ...currentHolder(),
      at: Date.now(),
      token: "another-lead's-watch",
    });
    expect(await runHook(leadNotesHook, leadInput(world.repo), world.env)).toEqual(
      addContext("UserPromptSubmit", NEVER),
    );
  });
});

test.each(["working", "merged", "removed", "discarded"])(
  "an absent lead hints only for open crew: %s",
  async (state) => {
    const world = await leadWorld({ watch: "never" });
    const lead = readLead(world.stateDir, world.repo, LEAD_SESSION);
    if (lead === null) throw new Error("missing fixture lead");
    await writeLead(
      world.stateDir,
      { ...lead, sessionUnknownSince: new Date(T0).toISOString() },
      T0,
    );
    await updateCrew(world.stateDir, world.repo, CREW_ID, { state }, T0);
    expect(
      leadNotesAnswer(
        leadInput(world.repo, { session_id: OTHER_SESSION }),
        "UserPromptSubmit",
        cliPaths(world.env),
        world.repo,
        world.env,
        { sessions: () => [] },
      ),
    ).toEqual(
      state === "working"
        ? addContext(
            "UserPromptSubmit",
            "This session continues lead LEAD app plan (c00f9bb5)? Run `cc-smart-dev-kit crew lead --plan plan` to take its 1 crew sessions.",
          )
        : {},
    );
  },
);

test("an unregistered crew session hears no adoption hint even when session records throw", async () => {
  const world = await leadWorld({ watch: "never" });
  const result = leadNotesAnswer(
    leadInput(world.repo, { session_id: OTHER_SESSION }),
    "UserPromptSubmit",
    cliPaths(world.env),
    world.repo,
    { ...world.env, CC_SMART_DEV_KIT_CREW: CREW_ID },
    {
      sessions: () => {
        throw new Error("records unreadable");
      },
    },
  );
  expect(result).toEqual({});
});

test("an unregistered session with unreadable records gets only one stderr line", async () => {
  const world = await leadWorld({ watch: "never" });
  expect(
    leadNotesAnswer(
      leadInput(world.repo, { session_id: OTHER_SESSION }),
      "UserPromptSubmit",
      cliPaths(world.env),
      world.repo,
      world.env,
      {
        sessions: () => {
          throw new Error("records unreadable");
        },
      },
    ),
  ).toEqual({ stderr: "cc-smart-dev-kit lead-notes: the session records cannot be read" });
});
