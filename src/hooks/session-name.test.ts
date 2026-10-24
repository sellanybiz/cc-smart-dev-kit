import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { CREW_ENV } from "../crew/session";
import { writeLead } from "../crew/store";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import {
  isSessionId,
  namesDir,
  namingNote,
  recordSessionName,
  titleToSet,
  titleToSetOrProblem,
} from "./session-name";
import { sessionNameHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";

// `cleanSessionName` lives in `src/crew/names.ts`, and its tests beside it.
describe("names", () => {
  test("only a UUID is a session id", () => {
    expect(isSessionId(SESSION)).toBe(true);
    expect(isSessionId("../../etc")).toBe(false);
  });

  test("recordSessionName writes the clean name; refuses a bad id or an empty name", () => {
    const env = hookEnv();
    expect(recordSessionName(SESSION, "Fix login\nmore", env)).toBe("Fix login");
    expect(readFileSync(join(namesDir(env), `${SESSION}.name`), "utf8")).toBe("Fix login");
    expect(() => recordSessionName("../x", "a", env)).toThrow('"../x" is not a session id');
    expect(() => recordSessionName(SESSION, "  ", env)).toThrow("the name is empty");
  });

  test("recordSessionName refuses in a crew session, and records nothing", () => {
    const env = { ...hookEnv(), [CREW_ENV]: "W2-x-1a2b3c" };
    expect(() => recordSessionName(SESSION, "Fix login", env)).toThrow(
      "a crew session keeps the name its lead gave it",
    );
    expect(existsSync(join(namesDir(env), `${SESSION}.name`))).toBe(false);
  });
});

describe("titleToSetOrProblem: a name whose record cannot be written is not set, and says why", () => {
  test("it answers as titleToSet does while the record can be written", () => {
    const env = hookEnv();
    expect(titleToSetOrProblem(env, SESSION, "LEAD app plan", "other")).toEqual({
      problem: null,
      title: "LEAD app plan",
    });
    // Recorded now: the same name is not set twice.
    expect(titleToSetOrProblem(env, SESSION, "LEAD app plan", "other")).toEqual({
      problem: null,
      title: null,
    });
  });

  test("a TMPDIR that is a file: no title, and the reason, where titleToSet throws", () => {
    const notAFolder = join(tempDir("tmp-is-a-file"), "tmp");
    writeFileSync(notAFolder, "");
    const env = { ...hookEnv(), TMPDIR: notAFolder };
    expect(() => titleToSet(env, SESSION, "LEAD app plan", "other")).toThrow();
    const answer = titleToSetOrProblem(env, SESSION, "LEAD app plan", "other");
    expect(answer.title).toBeNull();
    expect(answer.problem).toStartWith(
      "the session name could not be recorded, so it is not set this turn (",
    );
  });
});

describe("the hook", () => {
  function setup(sessionNames = true) {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames });
    return { repo, env: hookEnv() };
  }
  const start = (cwd: string) => ({
    hook_event_name: "SessionStart",
    session_id: SESSION,
    cwd,
    source: "startup",
  });
  const prompt = (cwd: string, change: Record<string, unknown> = {}) => ({
    hook_event_name: "UserPromptSubmit",
    session_id: SESSION,
    cwd,
    prompt: "hi",
    ...change,
  });

  test("at the start: the note with the command", async () => {
    const { repo, env } = setup();
    expect(await runHook(sessionNameHook, start(repo), env)).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: `This session has no name yet. Name it once, as soon as its main task is clear: people and other sessions find it by this name in ListAgents and /resume. Run: cc-smart-dev-kit session-name ${SESSION} "<the task, in a few words>"`,
        },
      }),
    });
    expect(namingNote(SESSION, "Fix login")).toBe(
      `This session is named "Fix login" after its main task. Keep it; rename it only if the name no longer describes the main task: cc-smart-dev-kit session-name ${SESSION} "<the task, in a few words>"`,
    );
  });

  test("a title the session already carries is recorded, not set: a rename from there stays", async () => {
    const { repo, env } = setup();
    recordSessionName(SESSION, "Fix login", env);
    expect(
      await runHook(sessionNameHook, prompt(repo, { session_title: "Fix login" }), env),
    ).toEqual({});
    expect(
      await runHook(sessionNameHook, prompt(repo, { session_title: "mine now" }), env),
    ).toEqual({});
  });

  test("at a prompt: the title once after the session named itself, then nothing", async () => {
    const { repo, env } = setup();
    const before = await runHook(sessionNameHook, prompt(repo), env);
    expect(before.stdout).toContain('"additionalContext":"This session has no name yet.');
    recordSessionName(SESSION, "Fix login", env);
    expect(await runHook(sessionNameHook, prompt(repo), env)).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", sessionTitle: "Fix login" },
      }),
    });
    expect(await runHook(sessionNameHook, prompt(repo), env)).toEqual({});
  });

  test("off unless cc-smart-dev-kit.json turns it on", async () => {
    const { repo, env } = setup(false);
    expect(await runHook(sessionNameHook, start(repo), env)).toEqual({});
    expect(await runHook(sessionNameHook, start(makeRepo("plain")), env)).toEqual({});
  });

  test("a recorded lead: silence, because the lead's name is lead-notes' (LD1)", async () => {
    const { repo, env } = setup();
    await writeLead(
      cliPaths(env).stateDir,
      {
        cwd: repo,
        name: "LEAD app plan",
        plan: "plan",
        repo,
        sessionId: SESSION,
        tag: "app",
      },
      Date.now(),
    );
    recordSessionName(SESSION, "Fix login", env);
    expect(await runHook(sessionNameHook, start(repo), env)).toEqual({});
    expect(await runHook(sessionNameHook, prompt(repo), env)).toEqual({});
  });

  test("a crew session: no note and no title, even with a name recorded for it", async () => {
    const { repo, env } = setup();
    // A name recorded before it was a crew session (or for another session with this id): the
    // name `crew start --name` gave it is the address its lead and `crew answer` use, and the
    // hook never sets another one.
    recordSessionName(SESSION, "Fix login", env);
    const crew = { ...env, [CREW_ENV]: "W2-x-1a2b3c" };
    expect(await runHook(sessionNameHook, start(repo), crew)).toEqual({});
    expect(await runHook(sessionNameHook, prompt(repo), crew)).toEqual({});
    expect(
      await runHook(sessionNameHook, prompt(repo, { session_title: "mine now" }), crew),
    ).toEqual({});
  });
});
