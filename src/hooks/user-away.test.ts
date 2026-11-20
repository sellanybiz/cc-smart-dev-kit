import { describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeClone, runHook, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import {
  awayStateFile,
  clearItems,
  type ParkDraft,
  parkItem,
  readAway,
  sayOnce,
  setAvailable,
  setUnavailable,
  stopSayOnce,
} from "../user-away/state";
import type { OwnerSources } from "../user-away/whose";
import { askLogFile } from "./ask-log";
import { toolDecision } from "./io";
import type { HookSpec } from "./run";
import { sessionNameHook, userAwayHook } from "./specs";
import { userAwayAnswer } from "./user-away";
import { awayStopBlock, awayStopWouldBlock } from "./user-away-stop";

const SESSION = "11111111-2222-3333-4444-555555555555";
const T0 = Date.parse("2026-10-25T01:00:00.000Z");
const UNTIL = "2026-10-25T07:00:00.000Z";
/** No session runs, and a folder under /work/<name> is project <name>: nothing reads this machine. */
const NO_OWNERS: OwnerSources = {
  sessions: () => [],
  projectOf: (cwd) => /^\/work\/([^/]+)/.exec(cwd)?.[1] ?? cwd,
};
const OPTIONS = { timeZone: "UTC", owners: NO_OWNERS };
const SKILL = "/cc-smart-dev-kit:user-unavailable";
/** The one command a session records a choice with: written by hand, so a changed word is seen here. */
const RECORD = `cc-smart-dev-kit user park --kind decision "Summary: <what you chose, why, how to undo>"`;
/** What the standing note tells a session to do while the person is away. */
const DECIDE = `take the recommended option of every question, record each choice with \`${RECORD}\`, and keep working.`;

/** A machine with the person away since `T0` (back about 07:00), and the paths a hook reads. */
async function away(until: null | string = UNTIL) {
  const env = hookEnv();
  const paths = cliPaths(env);
  await setUnavailable(paths.stateDir, T0, until);
  return { env, paths };
}

function draft(over: Partial<ParkDraft> = {}): ParkDraft {
  return {
    kind: "question",
    text: "Which name?",
    command: null,
    tool: null,
    options: [],
    recommend: null,
    session: SESSION,
    cwd: "/work/app",
    ...over,
  };
}

function preToolUse(tool: string, toolInput: Record<string, unknown> = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd: "/work/app",
    tool_name: tool,
    tool_input: toolInput,
  };
}

function decisionOf(stdout: string | undefined) {
  return JSON.parse(stdout ?? "{}").hookSpecificOutput;
}

/** A hook that asks, standing in for a guard: the kit has none left, the frame still turns its ask into a deny. */
const ASKING: HookSpec = {
  ...sessionNameHook,
  name: "asking-hook",
  events: ["PreToolUse"],
  run: () => toolDecision("ask", "Approve this call."),
};

describe("AskUserQuestion and ExitPlanMode", () => {
  test("denied while the person is away: take the recommended option, record a decision, park nothing", async () => {
    const { env, paths } = await away();
    const result = await userAwayAnswer(
      preToolUse("AskUserQuestion", { questions: [{ question: "Which name?" }] }),
      "PreToolUse",
      env,
      paths,
      T0 + 60_000,
      OPTIONS,
    );
    expect(result).toEqual(
      toolDecision(
        "deny",
        `The person is unavailable since 01:00, back about 07:00: do not wait for an answer. Take the recommended option yourself, keep working, and record the choice with \`${RECORD}\`. Never park a question or an action. The rules: ${SKILL}.`,
      ),
    );
    expect(readAway(paths.stateDir).items).toEqual([]);
  });

  test("a plan waiting for approval is refused the same way, and parks nothing", async () => {
    const { env, paths } = await away(null);
    const result = await userAwayAnswer(
      preToolUse("ExitPlanMode", { plan: "..." }),
      "PreToolUse",
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(result).toEqual(
      toolDecision(
        "deny",
        `The person is unavailable since 01:00: the plan cannot be approved now. Take the recommended option yourself, keep working, and record the choice with \`${RECORD}\`. Never park a question or an action. The rules: ${SKILL}.`,
      ),
    );
    expect(readAway(paths.stateDir).items).toEqual([]);
  });

  test("allowed (silent) once the person is available again, and when nothing was ever said", async () => {
    const { env, paths } = await away();
    await setAvailable(paths.stateDir);
    expect(
      await userAwayAnswer(preToolUse("AskUserQuestion"), "PreToolUse", env, paths, T0, OPTIONS),
    ).toEqual({});
    const fresh = hookEnv();
    expect(
      await userAwayAnswer(
        preToolUse("AskUserQuestion"),
        "PreToolUse",
        fresh,
        cliPaths(fresh),
        T0,
        OPTIONS,
      ),
    ).toEqual({});
  });

  test("every other tool is none of its business, away or not", async () => {
    const { env, paths } = await away();
    for (const tool of ["Bash", "Edit", "Agent", "SendMessage"]) {
      expect(await userAwayAnswer(preToolUse(tool), "PreToolUse", env, paths, T0, OPTIONS)).toEqual(
        {},
      );
    }
  });

  test("a state file it cannot read lets the question through, with one line why", async () => {
    const { env, paths } = await away();
    writeFileSync(awayStateFile(paths.stateDir), "{ nope");
    const result = await userAwayAnswer(
      preToolUse("AskUserQuestion"),
      "PreToolUse",
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
    expect(result.stderr).toContain("is not a state file");
  });
});

describe("Claude Code's own permission prompt (PermissionRequest)", () => {
  const permissionRequest = (tool: string, toolInput: Record<string, unknown>) => ({
    hook_event_name: "PermissionRequest",
    session_id: SESSION,
    cwd: "/work/app",
    tool_name: tool,
    tool_input: toolInput,
  });
  const CALLS: [string, Record<string, unknown>][] = [
    ["Bash", { command: "make deploy" }],
    ["Edit", { file_path: "/work/app/f.ts", old_string: "one", new_string: "two" }],
    ["WebFetch", { url: "https://example.com/a", prompt: "x" }],
    ["AskUserQuestion", { questions: [{ question: "Which name?" }] }],
  ];

  test("while away: no answer at all, and nothing parked: Claude Code shows its own dialog", async () => {
    const { env, paths } = await away();
    for (const [tool, toolInput] of CALLS) {
      const result = await userAwayAnswer(
        permissionRequest(tool, toolInput),
        "PermissionRequest",
        env,
        paths,
        T0,
        OPTIONS,
      );
      expect(result).toEqual({});
    }
    expect(readAway(paths.stateDir).items).toEqual([]);
  });

  test("through the spec the plugin wires: no output while away, none when available", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const input = permissionRequest("Bash", { command: "make deploy" });
    input.cwd = repo;
    await setUnavailable(cliPaths(env).stateDir, Date.now(), null);
    for (const state of ["away", "available"]) {
      if (state === "available") await setAvailable(cliPaths(env).stateDir);
      const result = await runHook(userAwayHook, input, env);
      expect(result.stdout ?? "").toBe("");
      expect(result.stderr ?? "").toBe("");
    }
    expect(readAway(cliPaths(env).stateDir).items).toEqual([]);
  });

  test("a state file it cannot read changes nothing: still no answer, no line", async () => {
    const { env, paths } = await away();
    writeFileSync(awayStateFile(paths.stateDir), "{ nope");
    const result = await userAwayAnswer(
      permissionRequest("Bash", { command: "make deploy" }),
      "PermissionRequest",
      env,
      paths,
      T0,
      OPTIONS,
    );
    expect(result).toEqual({});
  });
});

describe("the frame no longer turns a guard's ask into a deny", () => {
  const ASK = toolDecision("ask", "Approve this call.");

  test("away or available, an asking hook asks, and nothing is parked", async () => {
    const { repo } = makeClone();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const paths = cliPaths(env);
    const input = preToolUse("Bash", { command: "ls -la; true" });
    input.cwd = repo;
    const log = askLogFile(paths.stateDir);
    const lines = () =>
      existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

    const available = await runHook(ASKING, input, env);
    expect(available.stdout).toBe(ASK.stdout);
    expect(lines()).toHaveLength(1);

    await setUnavailable(paths.stateDir, Date.now(), null);
    const whileAway = await runHook(ASKING, input, env);
    expect(whileAway.stdout).toBe(ASK.stdout);
    expect(whileAway.stderr ?? "").toBe("");
    // The ask is an ask, so the frame records it, away or not.
    expect(lines()).toHaveLength(2);
    expect(readAway(paths.stateDir).items).toEqual([]);
  });
});

describe("the note at each prompt", () => {
  const prompt = (text: string, session = SESSION) => ({
    hook_event_name: "UserPromptSubmit",
    session_id: session,
    cwd: "/work/app",
    prompt: text,
  });

  async function note(
    text: string,
    state: { env: Record<string, string>; paths: ReturnType<typeof cliPaths> },
    at = T0,
    session = SESSION,
  ): Promise<string | null> {
    const result = await userAwayAnswer(
      prompt(text, session),
      "UserPromptSubmit",
      state.env,
      state.paths,
      at,
      OPTIONS,
    );
    if (result.stdout === undefined) return null;
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  }

  test("said once, and again only when the state or the count changes", async () => {
    const state = await away();
    // A turn that is not the person's (a monitor's line): the standing note, once.
    const turn = "<task-notification><task-id>x</task-id></task-notification>";
    expect(await note(turn, state)).toBe(
      `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: ${DECIDE} Nothing is recorded yet.`,
    );
    expect(await note(turn, state)).toBeNull();
    expect(await note(turn, state)).toBeNull();

    await parkItem(state.paths.stateDir, draft(), T0);
    expect(await note(turn, state)).toBe(
      `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: ${DECIDE} 1 item is on the list.`,
    );
    expect(await note(turn, state)).toBeNull();

    await parkItem(state.paths.stateDir, draft({ text: "another" }), T0);
    expect(await note(turn, state)).toContain("2 items are on the list.");
    await clearItems(state.paths.stateDir, [1]);
    expect(await note(turn, state)).toContain("1 item is on the list.");
  });

  test("every session hears it once, in its own context", async () => {
    const state = await away();
    const turn = "<task-notification><task-id>x</task-id></task-notification>";
    expect(await note(turn, state, T0, "session-a")).not.toBeNull();
    expect(await note(turn, state, T0, "session-b")).not.toBeNull();
    expect(await note(turn, state, T0, "session-a")).toBeNull();
  });

  test("the person's own prompt: still unavailable, said at every one, and never switching it back", async () => {
    const state = await away();
    await parkItem(state.paths.stateDir, draft(), T0);
    const first = await note("looks good, carry on", state);
    expect(first).toBe(
      "The person wrote, and is still marked unavailable since 01:00, back about 07:00: a message does not switch it back (it may come from a phone). Do what it asks, and keep following /cc-smart-dev-kit:user-unavailable. 1 item waits for /cc-smart-dev-kit:user-available.",
    );
    // Said again at the next one: the person typed, and nothing else changed.
    expect(await note("and one more thing", state)).toBe(first);
    expect(readAway(state.paths.stateDir).unavailable).toBe(true);
    // What they heard counts: the standing note stays quiet after it.
    expect(await note("<task-notification>x</task-notification>", state)).toBeNull();
  });

  test("a message from another session, a hand-back and a Stop hook's block are not the person", async () => {
    const state = await away();
    for (const text of [
      '<cross-session-message from="uds:1" from-name="lead">go</cross-session-message>',
      '<agent-message from="a1">done</agent-message>',
      '<hc from="t1">done</hc>',
      '<kit-report from="t1">done</kit-report>',
      "Stop hook feedback: report first",
    ]) {
      const said = await note(text, state, T0, `s-${text.length}`);
      expect(said).toStartWith("The person is unavailable since");
    }
  });

  test("back: a session that heard 'unavailable' is told once that the person is available again", async () => {
    const state = await away();
    await parkItem(state.paths.stateDir, draft(), T0);
    await note("go", state);
    await setAvailable(state.paths.stateDir);
    expect(await note("next", state)).toBe(
      "The person is available again: ask your questions as usual. 1 item waits for this session: go through it with /cc-smart-dev-kit:user-available.",
    );
    expect(await note("next", state)).toBeNull();
  });

  test("back: the note counts this session's items, and names the sessions the others wait in", async () => {
    const state = await away();
    await parkItem(state.paths.stateDir, draft(), T0);
    await parkItem(
      state.paths.stateDir,
      draft({ session: "sess-peer", cwd: "/work/shop", text: "Ship the build?" }),
      T0,
    );
    await note("go", state);
    await setAvailable(state.paths.stateDir);
    const result = await userAwayAnswer(
      prompt("next"),
      "UserPromptSubmit",
      state.env,
      state.paths,
      T0,
      {
        ...OPTIONS,
        owners: {
          ...NO_OWNERS,
          sessions: () => [{ pid: 7, sessionId: "sess-peer", cwd: "/work/shop", name: "shop fix" }],
        },
      },
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toBe(
      "The person is available again: ask your questions as usual. 1 item waits for this session: go through it with /cc-smart-dev-kit:user-available. 1 item waits in other sessions, which go through their own: shop fix (1).",
    );
  });

  test("back: the note's git calls stay inside the hook's budget, and a project it had no time for is never this session's", async () => {
    const repo = join(tempDir("away-repo"), "app");
    mkdirSync(repo);
    git(repo, "init", "-q");
    // `startedAt` is the frame's clock at the hook's start, which the budget counts from.
    const backWith = async (budget: Record<string, string>, startedAt: number) => {
      const state = await away();
      // A session that ended parked it in this repo: this session's, when the repo can be read.
      await parkItem(state.paths.stateDir, draft({ session: "sess-ended", cwd: repo }), T0);
      await note("go", state);
      await setAvailable(state.paths.stateDir);
      const result = await userAwayAnswer(
        { ...prompt("next"), cwd: repo },
        "UserPromptSubmit",
        { ...state.env, ...budget },
        state.paths,
        startedAt,
        { timeZone: "UTC", owners: { sessions: () => [] } },
      );
      return JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
    };
    const mine =
      "The person is available again: ask your questions as usual. 1 item waits for this session: go through it with /cc-smart-dev-kit:user-available.";
    const noTime =
      "The person is available again: ask your questions as usual. 1 item was parked in another project by a session that ended: /cc-smart-dev-kit:user-available asks whether to take it here.";
    expect(await backWith({}, Date.now())).toBe(mine);
    expect(await backWith({ CC_SMART_DEV_KIT_GUARD_BUDGET_MS: "1" }, Date.now())).toBe(noTime);
    // A hook that already spent its time (a long wait for the state's lock) makes no git call.
    expect(await backWith({}, Date.now() - 20_000)).toBe(noTime);
  });

  test("back, with nothing left on the list", async () => {
    const state = await away();
    await note("go", state);
    await setAvailable(state.paths.stateDir);
    expect(await note("next", state)).toBe(
      "The person is available again: ask your questions as usual. Nothing is left parked.",
    );
  });

  test("a session that never heard it is told nothing when the person is available", async () => {
    const state = await away();
    await setAvailable(state.paths.stateDir);
    expect(await note("go", state)).toBeNull();
  });

  test("a prompt with no text is not the person's; a state it cannot read is one line on stderr", async () => {
    const state = await away();
    expect(
      await userAwayAnswer(
        { hook_event_name: "UserPromptSubmit", session_id: SESSION, cwd: "/work/app" },
        "UserPromptSubmit",
        state.env,
        state.paths,
        T0,
        OPTIONS,
      ),
    ).toEqual({
      stdout: expect.stringContaining("The person is unavailable since"),
    });
    writeFileSync(awayStateFile(state.paths.stateDir), "{ nope");
    const result = await userAwayAnswer(
      prompt("hello"),
      "UserPromptSubmit",
      state.env,
      state.paths,
      T0,
      OPTIONS,
    );
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
  });
});

describe("the note at turn end (Stop): a session the person never prompts hears the switch", () => {
  const PERIOD = "[away period 2026-10-25T01:00:00.000Z|2026-10-25T07:00:00.000Z]";
  const BLOCK_REASON = `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: ${DECIDE} Nothing is recorded yet. Do not end the turn on a question for them: take the recommended option, record it, and go on. If nothing is left to do, end the turn. ${PERIOD}`;
  const turn = "<task-notification><task-id>x</task-id></task-notification>";
  type State = { env: Record<string, string>; paths: ReturnType<typeof cliPaths> };

  /** A session transcript with one answer in it, as Claude Code writes one. */
  function transcriptFile(): string {
    const file = join(tempDir("away-transcript"), "session.jsonl");
    const answer = {
      type: "assistant",
      isSidechain: false,
      message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
    };
    writeFileSync(file, `${JSON.stringify(answer)}\n`);
    return file;
  }

  /** What Claude Code writes after a Stop hook blocked: the reason as the block's feedback. */
  function feedback(file: string, reason: string): void {
    const entry = {
      type: "user",
      isMeta: true,
      isSidechain: false,
      message: { role: "user", content: `Stop hook feedback:\n${reason}` },
    };
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  }

  const stop = (transcript: null | string, over: Record<string, unknown> = {}) => ({
    hook_event_name: "Stop",
    session_id: SESSION,
    cwd: "/work/app",
    stop_hook_active: false,
    ...(transcript === null ? {} : { transcript_path: transcript }),
    ...over,
  });

  function atStop(state: State, transcript: null | string, over: Record<string, unknown> = {}) {
    return userAwayAnswer(stop(transcript, over), "Stop", state.env, state.paths, T0, OPTIONS);
  }

  /** The reason of a block, or null for any other answer. */
  function reasonOf(result: { stdout?: string }): null | string {
    if (result.stdout === undefined) return null;
    const output = JSON.parse(result.stdout);
    return output.decision === "block" ? output.reason : null;
  }

  async function atPrompt(text: string, state: State): Promise<string | null> {
    const result = await userAwayAnswer(
      { hook_event_name: "UserPromptSubmit", session_id: SESSION, cwd: "/work/app", prompt: text },
      "UserPromptSubmit",
      state.env,
      state.paths,
      T0,
      OPTIONS,
    );
    if (result.stdout === undefined) return null;
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  }

  describe("the decision, one input at a time", () => {
    test("all three hold: the state is away, `said` does not cover the period, no feedback for it", async () => {
      const state = await away();
      const block = awayStopBlock(stop(transcriptFile()), state.paths.stateDir);
      expect(block?.session).toBe(SESSION);
      expect(block?.state.since).toBe("2026-10-25T01:00:00.000Z");
    });

    test("the state: available is no block", async () => {
      const state = await away();
      await setAvailable(state.paths.stateDir);
      expect(awayStopBlock(stop(transcriptFile()), state.paths.stateDir)).toBeNull();
    });

    test("`said`: this period, at any count, is no block; another period is", async () => {
      const state = await away();
      const dir = state.paths.stateDir;
      await sayOnce(dir, SESSION, "2026-10-25T01:00:00.000Z|2026-10-25T07:00:00.000Z|7");
      expect(awayStopBlock(stop(transcriptFile()), dir)).toBeNull();
      await sayOnce(dir, SESSION, "2026-10-24T01:00:00.000Z|null|0");
      expect(awayStopBlock(stop(transcriptFile()), dir)).not.toBeNull();
    });

    test("the transcript: this period's feedback is no block; another period's, or a quote, is", async () => {
      const state = await away();
      const mine = transcriptFile();
      feedback(mine, `The person is unavailable … ${PERIOD}`);
      expect(awayStopBlock(stop(mine), state.paths.stateDir)).toBeNull();

      const older = transcriptFile();
      feedback(older, "The person is unavailable … [away period 2026-10-24T01:00:00.000Z|null]");
      expect(awayStopBlock(stop(older), state.paths.stateDir)).not.toBeNull();

      const quoted = transcriptFile();
      const quote = {
        type: "assistant",
        isSidechain: false,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `Stop hook feedback:\n${PERIOD}` }],
        },
      };
      appendFileSync(quoted, `${JSON.stringify(quote)}\n`);
      expect(awayStopBlock(stop(quoted), state.paths.stateDir)).not.toBeNull();
    });

    test("no transcript, or one it cannot read: no block, so a block it could not see never repeats", async () => {
      const state = await away();
      expect(awayStopBlock(stop(null), state.paths.stateDir)).toBeNull();
      const gone = join(tempDir("none"), "gone.jsonl");
      expect(awayStopBlock(stop(gone), state.paths.stateDir)).toBeNull();
    });

    test("it never reads `stopSaid`, the mark the Stop answer writes", async () => {
      const state = await away();
      const dir = state.paths.stateDir;
      await stopSayOnce(dir, SESSION, "2026-10-25T01:00:00.000Z|2026-10-25T07:00:00.000Z|0");
      expect(awayStopBlock(stop(transcriptFile()), dir)).not.toBeNull();
    });
  });

  test("the notifier's prediction is the same before and after the Stop answer writes its mark", async () => {
    const state = await away();
    const transcript = transcriptFile();
    const input = stop(transcript);
    // `notify` reads first ...
    expect(awayStopWouldBlock(input, state.paths)).toBe(true);
    expect(reasonOf(await atStop(state, transcript))).toBe(BLOCK_REASON);
    // ... or after: the same stop, the same answer.
    expect(awayStopWouldBlock(input, state.paths)).toBe(true);
    // Claude Code writes the feedback after every Stop hook answered: a later stop ends the turn.
    feedback(transcript, BLOCK_REASON);
    expect(awayStopWouldBlock(input, state.paths)).toBe(false);
  });

  test("a state file the prediction cannot read is no block", async () => {
    const state = await away();
    writeFileSync(awayStateFile(state.paths.stateDir), "{ nope");
    expect(awayStopWouldBlock(stop(transcriptFile()), state.paths)).toBe(false);
  });

  test("unavailable and not heard yet: one block with the note; once its feedback is in the transcript, silence", async () => {
    const state = await away();
    const transcript = transcriptFile();
    expect(await atStop(state, transcript)).toEqual({
      stdout: JSON.stringify({ decision: "block", reason: BLOCK_REASON }),
    });
    feedback(transcript, BLOCK_REASON);
    expect(await atStop(state, transcript, { stop_hook_active: true })).toEqual({});
    expect(await atStop(state, transcript)).toEqual({});
    // The block is recorded in its own mark, never in `said`.
    expect(readAway(state.paths.stateDir).said).toEqual({});
    expect(readAway(state.paths.stateDir).stopSaid).toEqual({
      [SESSION]: "2026-10-25T01:00:00.000Z|2026-10-25T07:00:00.000Z|0",
    });
  });

  test("a stop a Stop hook continued is never blocked, and the prediction agrees: at most one block per chain", async () => {
    const state = await away();
    // Not heard, and no feedback of this hook's in the transcript: only the input field decides.
    const transcript = transcriptFile();
    feedback(transcript, "Run `bun run check` before you stop.");
    const continued = { stop_hook_active: true };
    expect(await atStop(state, transcript, continued)).toEqual({});
    expect(awayStopWouldBlock(stop(transcript, continued), state.paths)).toBe(false);
    expect(readAway(state.paths.stateDir).stopSaid).toEqual({});
    // The next stop no hook continued carries the note.
    expect(reasonOf(await atStop(state, transcript))).toBe(BLOCK_REASON);
  });

  test("a count that comes back to the block's count after a prompt is said: the stop mark is stale once `said` covers the period", async () => {
    const state = await away();
    await atStop(state, transcriptFile());
    // An automated turn after the block: silent, and `said` now covers the period.
    expect(await atPrompt(turn, state)).toBeNull();
    await parkItem(state.paths.stateDir, draft(), T0);
    expect(await atPrompt(turn, state)).toBe(
      `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: ${DECIDE} 1 item is on the list.`,
    );
    await clearItems(state.paths.stateDir, "all");
    expect(await atPrompt(turn, state)).toBe(
      `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: ${DECIDE} Nothing is recorded yet.`,
    );
  });

  test("heard at the stop: the next prompt does not say it again, and `said` then covers the period", async () => {
    const state = await away();
    await atStop(state, transcriptFile());
    expect(await atPrompt(turn, state)).toBeNull();
    expect(readAway(state.paths.stateDir).said).toEqual({
      [SESSION]: "2026-10-25T01:00:00.000Z|2026-10-25T07:00:00.000Z|0",
    });
  });

  test("heard at a prompt: the stop is silent", async () => {
    const state = await away();
    expect(await atPrompt(turn, state)).not.toBeNull();
    expect(await atStop(state, transcriptFile())).toEqual({});
  });

  test("a count change alone does not block at the stop; the next prompt still says it", async () => {
    const state = await away();
    const transcript = transcriptFile();
    feedback(transcript, reasonOf(await atStop(state, transcript)) ?? "");
    // The session's own park (the skill's `Summary:` at the end of a stretch) changes the count.
    await parkItem(state.paths.stateDir, draft(), T0);
    expect(await atStop(state, transcript)).toEqual({});
    expect(await atPrompt(turn, state)).toBe(
      `The person is unavailable since 01:00, back about 07:00. Follow ${SKILL}: ${DECIDE} 1 item is on the list.`,
    );
  });

  test("a new away period blocks once more", async () => {
    const state = await away();
    const transcript = transcriptFile();
    feedback(transcript, reasonOf(await atStop(state, transcript)) ?? "");
    await setAvailable(state.paths.stateDir);
    await setUnavailable(state.paths.stateDir, T0, null);
    expect(reasonOf(await atStop(state, transcript))).toBe(
      `The person is unavailable since 01:00. Follow ${SKILL}: ${DECIDE} Nothing is recorded yet. Do not end the turn on a question for them: take the recommended option, record it, and go on. If nothing is left to do, end the turn. [away period 2026-10-25T01:00:00.000Z|null]`,
    );
  });

  test("told only at its stop, a session still hears 'available again' at its next prompt, and is never blocked while available", async () => {
    const state = await away();
    const transcript = transcriptFile();
    await atStop(state, transcript);
    await setAvailable(state.paths.stateDir);
    expect(await atStop(state, transcript)).toEqual({});
    expect(await atPrompt("next", state)).toBe(
      "The person is available again: ask your questions as usual. Nothing is left parked.",
    );
    expect(await atPrompt("next", state)).toBeNull();
  });

  test("no session id: silent, and nothing is marked", async () => {
    const state = await away();
    expect(await atStop(state, transcriptFile(), { session_id: undefined })).toEqual({});
    expect(readAway(state.paths.stateDir).said).toEqual({});
    expect(readAway(state.paths.stateDir).stopSaid).toEqual({});
  });

  test("a state file it cannot read: one line on stderr, no block", async () => {
    const state = await away();
    writeFileSync(awayStateFile(state.paths.stateDir), "{ nope");
    const result = await atStop(state, transcriptFile());
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit user-away: ");
    expect(result.stderr).toContain("is not a state file");
  });

  test("through the frame, with no project file: the block, then silence once its feedback is written", async () => {
    const { repo } = makeClone();
    const env = hookEnv();
    await setUnavailable(cliPaths(env).stateDir, Date.now(), null);
    const transcript = transcriptFile();
    const input = { ...stop(transcript), cwd: repo };
    const reason = reasonOf(await runHook(userAwayHook, input, env));
    expect(reason).toStartWith("The person is unavailable since");
    feedback(transcript, reason ?? "");
    expect(await runHook(userAwayHook, input, env)).toEqual({});
  });
});

describe("the hook as the frame runs it", () => {
  test("a hook run from the spec: AskUserQuestion denied with no project file, and silent after available", async () => {
    const { repo } = makeClone();
    const env = hookEnv();
    const paths = cliPaths(env);
    await setUnavailable(paths.stateDir, Date.now(), null);
    const input = { ...preToolUse("AskUserQuestion"), cwd: repo };
    const denied = await runHook(userAwayHook, input, env);
    expect(decisionOf(denied.stdout).permissionDecision).toBe("deny");
    await setAvailable(paths.stateDir);
    expect(await runHook(userAwayHook, input, env)).toEqual({});
  });
});

describe("what the review found", () => {
  test("a crash on the events that ask nobody is one line on stderr, and on the question tools an ask", async () => {
    const { env, paths } = await away();
    const context = { env, paths, nowMs: T0 };
    for (const event of ["UserPromptSubmit", "Stop"]) {
      const result = userAwayHook.onCrash?.("boom", preToolUse("Bash"), event, context);
      expect(result?.stderr).toBe("cc-smart-dev-kit user-away: boom");
      expect(result?.stdout).toBeUndefined();
    }
    const asked = userAwayHook.onCrash?.(
      "boom",
      preToolUse("AskUserQuestion"),
      "PreToolUse",
      context,
    );
    expect(decisionOf(asked?.stdout).permissionDecision).toBe("ask");
  });
});
