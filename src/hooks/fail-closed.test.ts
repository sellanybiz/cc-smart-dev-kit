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
import { agentLaunchesFile, readAgentLaunches } from "./agent-launches";
import { ASK_LOG_FILE, askLogFile } from "./ask-log";
import { toolDecision } from "./io";
import { type HookSpec, handleHook } from "./run";
import {
  agentGuardHook,
  gitGuardHook,
  guardCrash,
  jobRouteHook,
  mainFolderGuardHook,
  mergeGuardHook,
  sessionEscapeGuardHook,
  sessionNameHook,
} from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const NOW = 1_700_000_000_000;

/** The guards, with a call each of them judges. */
const GUARD_CASES: { spec: HookSpec; what: string; input: Record<string, unknown> }[] = [
  {
    spec: gitGuardHook,
    what: "this git command",
    input: { tool_name: "Bash", tool_input: { command: "git push --force" } },
  },
  {
    spec: mergeGuardHook,
    what: "whether this merge may happen by itself",
    input: { tool_name: "Bash", tool_input: { command: "gh pr merge 7" } },
  },
  {
    spec: mainFolderGuardHook,
    what: "whether this edit belongs in a worktree",
    input: { tool_name: "Edit", tool_input: { file_path: "/code/app/README.md" } },
  },

  {
    spec: jobRouteHook,
    what: "whether this launch or heavy command may run",
    input: { tool_name: "Bash", tool_input: { command: "bunx tsc --noEmit" } },
  },
  {
    spec: agentGuardHook,
    what: "the model this launch runs on",
    input: { tool_name: "Agent", tool_input: { effort: "low", model: "opus", prompt: "do it" } },
  },
  {
    spec: sessionEscapeGuardHook,
    what: "whether this call goes around the limits set for the session",
    input: {
      tool_name: "Bash",
      tool_input: { command: "env -u CLAUDECODE cc-smart-dev-kit workflow review-done" },
    },
  },
];

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
    // The git guard asks about git commands. A `ls` is not one, so the guard's crash is
    // silent there — it has no question to put.
    const result = await runHook(
      crashing(gitGuardHook),
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

  test("the agent guard's crash on its record (PostToolUse) says nothing: the launch already ran", async () => {
    // A question after the call ran would ask about nothing: the record is information, and
    // its crash is one line on stderr like any informational hook's.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const result = await runHook(
      crashing(agentGuardHook),
      {
        hook_event_name: "PostToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Agent",
        tool_input: { effort: "max", model: "opus", prompt: "do it" },
      },
      hookEnv(),
    );
    expect(result.stdout).toBeUndefined();
    expect(result.exitCode ?? 0).toBe(0);
  });

  test("a hook input that is not JSON: a guard asks in general, and nothing runs through", async () => {
    // The frame cannot know the event or the tool, so the guard asks about the call at large:
    // a guard that cannot judge a call does not let it through. No JSON here at all.
    const result = await handleHook(gitGuardHook, "not json", hookEnv(), NOW);
    expect(result.exitCode ?? 0).toBe(0);
    expect(askOf(result)).toBe(
      "cc-smart-dev-kit cannot check this git command: the hook input is not JSON",
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
      gitGuardHook,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "git reset --hard" },
      }),
      env,
      NOW,
    );
    expect(askOf(result)).toContain("throws away every uncommitted change");
    const file = askLogFile(cliPaths(env).stateDir);
    // The line the frame wrote, exactly: the git guard's own question, as one line. Written
    // by hand, never built from the code under test.
    expect(readFileSync(file, "utf8")).toBe(
      `${JSON.stringify({
        at: NOW,
        hook: "git-guard",
        session: SESSION,
        tool: "Bash",
        reason:
          "`git reset --hard` throws away every uncommitted change in this folder, for good. Approve only if you want them gone; a WIP commit keeps the work first.",
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

  test("an ask the frame gives for a broken cc-smart-dev-kit.json is recorded too", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { not: "a config" });
    const env = hookEnv();
    const result = await runHook(
      gitGuardHook,
      {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "git push --force" },
      },
      env,
    );
    expect(askOf(result)).toContain("cannot check this git command");
    const file = askLogFile(cliPaths(env).stateDir);
    expect(readFileSync(file, "utf8")).toContain('"hook":"git-guard"');
  });

  test("a record that cannot be written: the answer stands, and one line says why", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    // The state folder's own path is a file: the record cannot be written.
    const stateFile = join(env.CLAUDE_CONFIG_DIR ?? "", "cc-smart-dev-kit");
    writeFileSync(stateFile, "not a folder\n");
    const result = await runHook(
      gitGuardHook,
      {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "git push --force" },
      },
      env,
    );
    // The guard's answer is untouched: the record is information.
    expect(askOf(result)).toContain("force-push");
    expect(result.stderr).toContain("the ask could not be recorded");
  });

  test("the record is kept small: past the size rule, the newer half stays", async () => {
    const env = hookEnv();
    const file = askLogFile(cliPaths(env).stateDir);
    mkdirSync(join(file, ".."), { recursive: true });
    // A file that already grew past the size rule (256 KiB).
    const old = `${JSON.stringify({ at: 0, hook: "git-guard", session: "", tool: "", reason: "x" })}\n`;
    writeFileSync(file, old.repeat(9000));
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const result = await handleHook(
      gitGuardHook,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "git push --force" },
      }),
      env,
      NOW,
    );
    expect(askOf(result)).toContain("force-push");
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
        gitGuardHook,
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
    expect(await run("git status")).toEqual({});
    expect(existsSync(state)).toBe(false);
    // A question: one file, the record, and no temp file or other leftover beside it.
    await run("git push --force");
    expect(readdirSync(state)).toEqual([ASK_LOG_FILE]);
    expect(readFileSync(join(state, ASK_LOG_FILE), "utf8")).toContain('"hook":"git-guard"');
  });

  test("a denial is not a question: the main-folder guard's deny writes no record", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", guardMainFolder: true },
    });
    const env = hookEnv();
    const result = await runHook(
      mainFolderGuardHook,
      {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Edit",
        tool_input: { file_path: join(repo, "README.md") },
      },
      env,
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
    expect(existsSync(askLogFile(cliPaths(env).stateDir))).toBe(false);
  });
});

describe("the agent guard records an asked launch through the frame (PostToolUse is wired)", () => {
  const launch = {
    effort: "max",
    model: "opus",
    prompt: "Opus reason: debugging - the router hangs",
  };

  test("PreToolUse asks and records the ask; PostToolUse (it ran) records the launch and asks nothing", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const env = hookEnv();
    const state = cliPaths(env).stateDir;
    const call = {
      session_id: SESSION,
      cwd: repo,
      tool_name: "Agent",
      tool_use_id: "toolu_a4",
      tool_input: launch,
    };
    const asked = await runHook(agentGuardHook, { ...call, hook_event_name: "PreToolUse" }, env);
    expect(askOf(asked)).toStartWith("Claude Opus launch at effort `max`");
    // The person has not answered yet: the launch is not recorded, the question is.
    expect(existsSync(join(state, "agent-launches.jsonl"))).toBe(false);
    expect(readFileSync(join(state, ASK_LOG_FILE), "utf8").trimEnd().split("\n")).toHaveLength(1);
    // Claude Code runs PostToolUse only for a call that ran, so the person said yes: the
    // launch is recorded, the hook says nothing, and no second question is written.
    // PostToolUse on the Agent tool fires at the launch and carries the model Claude Code
    // resolved (`tool_response.resolvedModel`, proved live on 2.1.306): the record keeps it.
    const ran = await runHook(
      agentGuardHook,
      {
        ...call,
        hook_event_name: "PostToolUse",
        tool_response: {
          isAsync: true,
          status: "async_launched",
          agentId: "a3a1eb37dae867cff",
          resolvedModel: "claude-opus-5-5",
        },
      },
      env,
    );
    expect(ran).toEqual({});
    const launches = readAgentLaunches(agentLaunchesFile(state), 0);
    expect(launches.map((one) => [one.reason, one.toolUseId, one.session, one.model])).toEqual([
      ["opus:max:debugging", "toolu_a4", SESSION, "claude-opus-5-5"],
    ]);
    expect(readFileSync(join(state, ASK_LOG_FILE), "utf8").trimEnd().split("\n")).toHaveLength(1);
  });

  test("a PostToolUse answer with no resolvedModel (or a broken one): the guard's own model stays", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
    const call = {
      session_id: SESSION,
      cwd: repo,
      tool_name: "Agent",
      tool_use_id: "toolu_a4",
      tool_input: launch,
      hook_event_name: "PostToolUse",
    };
    for (const tool_response of [
      undefined,
      "a string",
      ["list"],
      {},
      { resolvedModel: "" },
      { resolvedModel: 42 },
      { resolvedModel: { id: "claude-opus-5-5" } },
    ]) {
      const env = hookEnv();
      await runHook(agentGuardHook, { ...call, tool_response }, env);
      const launches = readAgentLaunches(agentLaunchesFile(cliPaths(env).stateDir), 0);
      // The model the guard resolved from the name `opus`: no outside text is trusted blindly.
      expect(launches.map((one) => one.model)).toEqual(["opus"]);
    }
  });

  test("the record's line for the ask names the hook and the tool, and holds the question cut short", async () => {
    const repo = makeRepo();
    const env = hookEnv();
    await handleHook(
      agentGuardHook,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: repo,
        tool_name: "Agent",
        tool_use_id: "toolu_a4",
        tool_input: launch,
      }),
      env,
      NOW,
    );
    // No cc-smart-dev-kit.json here: the agent guard is machine-wide, so it asks all the same.
    expect(readFileSync(askLogFile(cliPaths(env).stateDir), "utf8")).toBe(
      `${JSON.stringify({
        at: NOW,
        hook: "agent-guard",
        session: SESSION,
        tool: "Agent",
        reason:
          'Claude Opus launch at effort `max`: `general-purpose`, with the reason line "Opus reason: debugging - the router hangs". The opus tier runs at `medium`, `high` or `xhigh` with no question; `max` only ...',
      })}\n`,
    );
  });
});
