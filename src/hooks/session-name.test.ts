import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import {
  cleanSessionName,
  isSessionId,
  namesDir,
  namingNote,
  recordSessionName,
} from "./session-name";
import { sessionNameHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";

describe("names", () => {
  test.each([
    ["Fix the login page", "Fix the login page"],
    ["  two\tspaces  \nsecond line", "two spaces"],
    ["\u001b]0;evil\u0007title", "]0;evil title"],
    ["\u009bx", "x"],
    ["   ", null],
    ["x".repeat(70), "x".repeat(60)],
  ])("cleanSessionName(%j) is %j", (raw, expected) => {
    expect(cleanSessionName(raw)).toBe(expected);
  });

  test("never splits an emoji at the cut", () => {
    expect(cleanSessionName(`${"a".repeat(59)}😀😀`)).toBe(`${"a".repeat(59)}😀`);
  });

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
});

describe("the hook", () => {
  function setup(sessionNames = true) {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames });
    return { repo, env: hookEnv() };
  }
  const start = (cwd: string) => ({
    hook_event_name: "SessionStart",
    session_id: SESSION,
    cwd,
    source: "startup",
  });
  const prompt = (cwd: string) => ({
    hook_event_name: "UserPromptSubmit",
    session_id: SESSION,
    cwd,
    prompt: "hi",
  });

  test("at the start: the note with the command", async () => {
    const { repo, env } = setup();
    expect(await runHook(sessionNameHook, start(repo), env)).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: `This session has no name yet. Name it once, as soon as its main task is clear: people and other sessions find it by this name in ListAgents and /resume. Run: anymodel session-name ${SESSION} "<the task, in a few words>"`,
        },
      }),
    });
    expect(namingNote(SESSION, "Fix login")).toBe(
      `This session is named "Fix login" after its main task. Keep it; rename it only if the name no longer describes the main task: anymodel session-name ${SESSION} "<the task, in a few words>"`,
    );
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

  test("off unless anymodel.json turns it on", async () => {
    const { repo, env } = setup(false);
    expect(await runHook(sessionNameHook, start(repo), env)).toEqual({});
    expect(await runHook(sessionNameHook, start(makeRepo("plain")), env)).toEqual({});
  });
});
