/**
 * The frame fails closed for a guard, and records what the guards asked
 * (`.claude/rules/hooks-guards.md` § Fail safe; `src/hooks/run.ts`,
 * `src/hooks/ask-log.ts`, `src/hooks/specs.ts`).
 *
 * A guard's own crash asks the person about the call in the guard's own domain: a bug must
 * never let a call through. An informational hook's crash is one line on stderr and exit 0 —
 * a bug never stops a person's work. And every ask the frame gives is written to
 * `guard-asks.jsonl` in the state folder, with the reason masked and one line long.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { ASK_LOG_FILE, askLogFile } from "./ask-log";
import { toolDecision } from "./io";
import { type HookSpec, handleHook } from "./run";
import { guardCrash, sessionNameHook, userAwayHook } from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const NOW = 1_700_000_000_000;

/**
 * The guard with a call it judges: `user-away`, the one hook left that answers a question tool
 * (`AskUserQuestion`), and the one whose crash asks.
 */
const GUARD_CASES: { spec: HookSpec; what: string; input: Record<string, unknown> }[] = [
  {
    spec: userAwayHook,
    what: "whether the person is available",
    input: { tool_name: "AskUserQuestion", tool_input: { questions: [] } },
  },
];

/**
 * A hook that asks, standing in for one: the kit has no guard that asks any more, but the frame
 * still records an ask, and still turns an ask into a deny while the person is away.
 */
const ASK_REASON = "Approve this call: it stands in for a hook that asks.";
const ASKING: HookSpec = {
  ...sessionNameHook,
  name: "asking-hook",
  events: ["PreToolUse"],
  onConfigProblem: () => toolDecision("ask", ASK_REASON),
  run: () => toolDecision("ask", ASK_REASON),
};
const DENYING: HookSpec = {
  ...ASKING,
  name: "denying-hook",
  run: () => toolDecision("deny", "Refused: it stands in for a hook that denies."),
};

/** A Bash call, as Claude Code builds it. */
const BACKGROUND = { tool_name: "Bash", tool_input: { command: "ls" } };

/** The reason of an answer that asks the person. */
function askOf(result: { stdout?: string }): string {
  const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
  expect(output.permissionDecision).toBe("ask");
  return output.permissionDecisionReason;
}

/** The spec of a hook whose own code throws: the frame's crash path. */
function crashing(spec: HookSpec): HookSpec {
  return {
    ...spec,
    run: () => {
      throw new Error("boom");
    },
  };
}

describe("a guard's own crash", () => {
  test.each(GUARD_CASES)("$spec.name asks about the call in its own domain", async (one) => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const result = await runHook(
      crashing(one.spec),
      {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        ...one.input,
      },
      hookEnv(),
    );
    // The call does not go through on its own: the person is asked, and the reason names the
    // guard's domain and the crash.
    expect(result.exitCode ?? 0).toBe(0);
    expect(askOf(result)).toBe(`cc-smart-dev-kit cannot check ${one.what}: boom`);
  });

  test("a call outside the guard's domain is none of its business: it says nothing", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    // `user-away` judges the two question tools. A Bash call is neither, so the guard's crash
    // is silent there: it has no question to put.
    const result = await runHook(
      crashing(userAwayHook),
      {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
      },
      hookEnv(),
    );
    expect(result.stdout).toBeUndefined();
    expect(result.exitCode ?? 0).toBe(0);
  });

  test("guardCrash: a domain check that throws is no reason to let the call through", () => {
    const answer = guardCrash("this call", () => {
      throw new Error("the check broke too");
    });
    const context = { env: {}, nowMs: 0, paths: cliPaths({}) };
    const input = { hook_event_name: "PreToolUse", tool_name: "Bash" };
    expect(askOf(answer("boom", input, "PreToolUse", context))).toBe(
      "cc-smart-dev-kit cannot check this call: boom",
    );
    // A call the check says is none of the guard's business is left alone, and so is any
    // event that is not a question to answer.
    expect(guardCrash("this call", () => false)("boom", input, "PreToolUse", context)).toEqual({});
    expect(guardCrash("this call", () => true)("boom", input, "PostToolUse", context)).toEqual({});
  });

  test("a hook input that is not JSON: a guard asks in general, and nothing runs through", async () => {
    // The frame cannot know the event or the tool, so the guard asks about the call at large:
    // a guard that cannot judge a call does not let it through. No JSON here at all.
    const result = await handleHook(userAwayHook, "not json", hookEnv(), NOW);
    expect(result.exitCode ?? 0).toBe(0);
    expect(askOf(result)).toBe(
      "cc-smart-dev-kit cannot check whether the person is available: the hook input is not JSON",
    );
  });

  test("a hook input that is not JSON: an informational hook says one line, and the session goes on", async () => {
    const result = await handleHook(sessionNameHook, "not json", hookEnv());
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toBe("cc-smart-dev-kit session-name: the hook input is not JSON");
  });

  test("an informational hook's own crash: one line on stderr, exit 0 (a bug never stops work)", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const result = await runHook(
      crashing(sessionNameHook),
      {
        hook_event_name: "SessionStart",
        session_id: SESSION,
        cwd: repo,
        source: "startup",
      },
      hookEnv(),
    );
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toBe("cc-smart-dev-kit session-name: boom");
  });

  test("a hook without onCrash says one line, and an onCrash that throws says one line too", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const broken: HookSpec = {
      ...sessionNameHook,
      onCrash: () => {
        throw new Error("the crash answer itself broke");
      },
      run: () => {
        throw new Error("boom");
      },
    };
    const result = await runHook(
      broken,
      {
        hook_event_name: "SessionStart",
        session_id: SESSION,
        cwd: repo,
        source: "startup",
      },
      hookEnv(),
    );
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toBe("cc-smart-dev-kit session-name: boom");
  });
});

describe("the record of an ask", () => {
  test("one line per ask, with the time, the hook, the session, the tool and the reason", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const result = await handleHook(
      ASKING,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        ...BACKGROUND,
      }),
      env,
      NOW,
    );
    expect(askOf(result)).toBe(ASK_REASON);
    const file = askLogFile(cliPaths(env).stateDir);
    // The line the frame wrote, exactly: the question as one line. Written by hand, never built
    // from the code under test.
    expect(readFileSync(file, "utf8")).toBe(
      `${JSON.stringify({
        at: NOW,
        hook: "asking-hook",
        session: SESSION,
        tool: "Bash",
        reason: ASK_REASON,
      })}\n`,
    );
  });

  test("the reason is one line, short, and holds no secret", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    // A question that quotes a key: the record masks it, so the file never holds one.
    const spec: HookSpec = {
      ...sessionNameHook,
      run: () =>
        toolDecision("ask", "the token sk-abcdefghijklmnop is in the way, and this line is long"),
    };
    await handleHook(
      spec,
      JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: SESSION,
        cwd: repo,
        source: "startup",
      }),
      env,
      NOW,
    );
    const line = JSON.parse(readFileSync(askLogFile(cliPaths(env).stateDir), "utf8").trim()) as {
      reason: string;
    };
    expect(line.reason).not.toContain("sk-abcdefghijklmnop");
    expect(line.reason).toContain("sk-****");
    expect(line.reason).not.toContain("\n");
  });

  test("an ask while the project's cc-smart-dev-kit.json is broken is recorded too", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { not: "a config" });
    const env = hookEnv();
    const result = await runHook(
      ASKING,
      { hook_event_name: "PreToolUse", session_id: SESSION, cwd: repo, ...BACKGROUND },
      env,
    );
    expect(askOf(result)).toBe(ASK_REASON);
    const file = askLogFile(cliPaths(env).stateDir);
    expect(readFileSync(file, "utf8")).toContain('"hook":"asking-hook"');
  });

  test("a record that cannot be written: the answer stands, and one line says why", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    // The state folder's own path is a file: the record cannot be written.
    const stateFile = join(env.CLAUDE_CONFIG_DIR ?? "", "cc-smart-dev-kit");
    writeFileSync(stateFile, "not a folder\n");
    const result = await runHook(
      ASKING,
      { hook_event_name: "PreToolUse", session_id: SESSION, cwd: repo, ...BACKGROUND },
      env,
    );
    // The guard's answer is untouched: the record is information.
    expect(askOf(result)).toBe(ASK_REASON);
    expect(result.stderr).toContain("the ask could not be recorded");
  });

  test("the record is kept small: past the size rule, the newer half stays", async () => {
    const env = hookEnv();
    const file = askLogFile(cliPaths(env).stateDir);
    mkdirSync(join(file, ".."), { recursive: true });
    // A file that already grew past the size rule (256 KiB).
    const old = `${JSON.stringify({ at: 0, hook: "asking-hook", session: "", tool: "", reason: "x" })}\n`;
    writeFileSync(file, old.repeat(9000));
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const result = await handleHook(
      ASKING,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        ...BACKGROUND,
      }),
      env,
      NOW,
    );
    expect(askOf(result)).toBe(ASK_REASON);
    const text = readFileSync(file, "utf8");
    // Smaller than before, and the new line is the last one.
    expect(text.length).toBeLessThan(old.length * 9000);
    expect(text.trimEnd().split("\n").at(-1)).toContain(`"at":${NOW}`);
  });

  test("the record is the one file in the state folder, and a call that is not asked about writes none", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const state = cliPaths(env).stateDir;
    const run = (command: string) =>
      runHook(
        ASKING,
        {
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: repo,
          tool_name: "Bash",
          tool_input: { command },
        },
        env,
      );
    // A call the guard lets through: no question, no file (not even the state folder).
    expect(
      await runHook(
        sessionNameHook,
        {
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: repo,
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        env,
      ),
    ).toEqual({});
    expect(existsSync(state)).toBe(false);
    // A question: one file, the record, and no temp file or other leftover beside it.
    await run("ls -la; true");
    expect(readdirSync(state)).toEqual([ASK_LOG_FILE]);
    expect(readFileSync(join(state, ASK_LOG_FILE), "utf8")).toContain('"hook":"asking-hook"');
  });

  test("a denial is not a question: a deny writes no record", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const result = await runHook(
      DENYING,
      { hook_event_name: "PreToolUse", session_id: SESSION, cwd: repo, ...BACKGROUND },
      env,
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
    expect(existsSync(askLogFile(cliPaths(env).stateDir))).toBe(false);
  });
});
