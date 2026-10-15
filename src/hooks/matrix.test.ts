/**
 * Every hook through the same frame (`run.ts`), in a table:
 * - with no anymodel.json: Claude Code's default worktree, and every guard silent;
 * - the defer check: the project's own hook for the same event (and tool) silences it;
 * - `requires` not met (and a broken anymodel.json): each fails closed its own way;
 * - the guard matrix: the plugin's hook on or off × the project's hook wired or not ×
 *   the project's `requires` met or not. Exactly one guard answers a destructive command,
 *   never two; none only when neither is installed.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  hookEnv,
  makeClone,
  runHook,
  wireProjectHook,
  writeClaudeFile,
  writeSessionRecord,
} from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import type { HookResult } from "./io";
import type { HookSpec } from "./run";
import {
  afterMergeHook,
  gitGuardHook,
  HOOKS,
  mainFolderGuardHook,
  messageGuardHook,
  sessionNameHook,
  subagentStopHook,
  worktreeCreateHook,
  worktreeLeftoversHook,
  worktreeRemoveHook,
} from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const AGENT = "0a1b2c3d4e5f60718";
const FULL_CONFIG = {
  worktrees: { base: "main", prefix: "app-wt-", guardMainFolder: true },
  sessionNames: true,
};

interface Case {
  spec: HookSpec;
  /** The project's own hook that silences this one: event and matcher. */
  own: { event: string; matcher?: string };
  /** A project and an input that make this hook speak. */
  setup: (config: unknown) => { input: Record<string, unknown>; env: Record<string, string> };
  /** What it says when `requires` is not met (null: silent but for one stderr line). */
  failsClosed: (result: HookResult) => void;
}

function project(config: unknown) {
  const { repo } = makeClone();
  if (config !== undefined) writeClaudeFile(repo, "anymodel.json", config);
  return repo;
}

/**
 * The main checkout of the input's `cwd`: where the project's own hook is wired. Never the
 * worktree itself, where a new settings file would be an untracked change that keeps a
 * worktree for the wrong reason.
 */
function mainOf(input: Record<string, unknown>): string {
  const common = git(String(input.cwd), "rev-parse", "--path-format=absolute", "--git-common-dir");
  return dirname(common.trim());
}

function makeIdle(worktree: string): void {
  const admin = resolve(
    worktree,
    readFileSync(join(worktree, ".git"), "utf8")
      .trim()
      .replace(/^gitdir:\s*/, ""),
  );
  const old = new Date(Date.now() - 90 * 60_000);
  for (const file of ["index", "HEAD", join("logs", "HEAD")])
    utimesSync(join(admin, file), old, old);
}

const askLine = (result: HookResult) => {
  expect(result.exitCode ?? 0).toBe(0);
  const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
  expect(output.permissionDecision).toBe("ask");
  expect(output.permissionDecisionReason).toEndWith("run claude plugin update anymodel@anymodel");
};
const contextLine = (result: HookResult) => {
  const text: string = JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
  expect(text).toStartWith("anymodel: ");
  expect(text).toEndWith("run claude plugin update anymodel@anymodel");
  expect(text).not.toContain("\n");
};

const CASES: Case[] = [
  {
    spec: worktreeCreateHook,
    own: { event: "WorktreeCreate" },
    setup: (config) => ({
      input: {
        hook_event_name: "WorktreeCreate",
        session_id: SESSION,
        cwd: project(config),
        name: "x",
      },
      env: hookEnv(),
    }),
    failsClosed: (result) => {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toEndWith("run claude plugin update anymodel@anymodel");
    },
  },
  {
    spec: worktreeRemoveHook,
    own: { event: "WorktreeRemove" },
    setup: (config) => {
      const repo = project(config);
      const folder = join(repo, ".claude", "worktrees", "x");
      git(repo, "worktree", "add", "-q", "-b", "worktree-x", folder);
      return {
        input: {
          hook_event_name: "WorktreeRemove",
          session_id: SESSION,
          cwd: folder,
          worktree_path: folder,
        },
        env: hookEnv(),
      };
    },
    failsClosed: (result) => {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toEndWith("run claude plugin update anymodel@anymodel");
    },
  },
  {
    spec: subagentStopHook,
    own: { event: "SubagentStop", matcher: "general-purpose" },
    setup: (config) => {
      const repo = project(config);
      const folder = join(repo, ".claude", "worktrees", `agent-${AGENT}`);
      git(repo, "worktree", "add", "-q", "-b", `worktree-agent-${AGENT}`, folder);
      return {
        input: {
          hook_event_name: "SubagentStop",
          session_id: SESSION,
          cwd: folder,
          agent_id: AGENT,
          agent_type: "general-purpose",
        },
        env: hookEnv(),
      };
    },
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toStartWith("subagent worktree kept: ");
    },
  },
  {
    spec: gitGuardHook,
    own: { event: "PreToolUse", matcher: "Bash|PowerShell" },
    setup: (config) => ({
      input: {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project(config),
        tool_name: "Bash",
        tool_input: { command: "git push --force" },
      },
      env: hookEnv(),
    }),
    failsClosed: askLine,
  },
  {
    spec: mainFolderGuardHook,
    own: { event: "PreToolUse", matcher: "Edit|Write|NotebookEdit" },
    setup: (config) => {
      const repo = project(config);
      return {
        input: {
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: repo,
          tool_name: "Edit",
          tool_input: { file_path: join(repo, "README.md") },
        },
        env: hookEnv(),
      };
    },
    failsClosed: askLine,
  },
  {
    spec: messageGuardHook,
    own: { event: "PreToolUse", matcher: "SendMessage" },
    setup: (config) => {
      const env = hookEnv();
      writeSessionRecord(env, { sessionId: "other", cwd: tempDir("elsewhere"), name: "elsewhere" });
      return {
        input: {
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: project(config),
          tool_name: "SendMessage",
          tool_input: { to: "elsewhere", message: "hi" },
        },
        env,
      };
    },
    failsClosed: askLine,
  },
  {
    spec: afterMergeHook,
    own: { event: "PostToolUse", matcher: "Bash" },
    setup: (config) => {
      const repo = project(config);
      git(repo, "remote", "set-url", "origin", "git@github.com:example-org/app.git");
      const env = hookEnv();
      const bin = tempDir("fake-gh");
      const view = {
        number: 7,
        title: "T",
        baseRefName: "main",
        headRefName: "fix/a",
        state: "MERGED",
        url: "https://github.com/example-org/app/pull/7",
        mergedAt: new Date().toISOString(),
      };
      writeFileSync(join(bin, "gh"), `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(view)}\nEOF\n`);
      chmodSync(join(bin, "gh"), 0o755);
      return {
        input: {
          hook_event_name: "PostToolUse",
          session_id: SESSION,
          cwd: repo,
          tool_name: "Bash",
          tool_input: { command: "gh pr merge 7" },
        },
        env: { ...env, PATH: `${bin}:${env.PATH ?? ""}` },
      };
    },
    failsClosed: contextLine,
  },
  {
    spec: worktreeLeftoversHook,
    own: { event: "SessionStart", matcher: "startup|resume" },
    setup: (config) => {
      const repo = project(config);
      const folder = join(repo, "..", "app-wt-done");
      git(repo, "worktree", "add", "-q", "-b", "done", folder, "origin/main");
      makeIdle(folder);
      return {
        input: {
          hook_event_name: "SessionStart",
          session_id: SESSION,
          cwd: repo,
          source: "startup",
        },
        env: hookEnv(),
      };
    },
    failsClosed: contextLine,
  },
  {
    spec: sessionNameHook,
    own: { event: "SessionStart", matcher: "startup" },
    setup: (config) => ({
      input: {
        hook_event_name: "SessionStart",
        session_id: SESSION,
        cwd: project(config),
        source: "startup",
      },
      env: hookEnv(),
    }),
    failsClosed: (result) => {
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toStartWith("anymodel session-name: ");
    },
  },
];

test("the table covers every hook", () => {
  expect(CASES.map((c) => c.spec.name).sort()).toEqual(HOOKS.map((spec) => spec.name).sort());
});

describe.each(CASES.map((c) => [c.spec.name, c] as const))("%s", (_name, c) => {
  test("speaks with a full anymodel.json (the baseline the other rows silence)", async () => {
    const { input, env } = c.setup(FULL_CONFIG);
    const result = await runHook(c.spec, input, env);
    expect(result.stdout !== undefined || result.stderr !== undefined).toBe(true);
    expect(result.exitCode ?? 0).toBe(0);
  });

  test("the project wires its own: exit 0 and nothing at all", async () => {
    const { input, env } = c.setup(FULL_CONFIG);
    wireProjectHook(mainOf(input), c.own.event, c.own.matcher);
    expect(await runHook(c.spec, input, env)).toEqual({});
  });

  test("the project wires its own in settings.local.json: the same", async () => {
    const { input, env } = c.setup(FULL_CONFIG);
    wireProjectHook(mainOf(input), c.own.event, c.own.matcher, "settings.local.json");
    expect(await runHook(c.spec, input, env)).toEqual({});
  });

  test("requires not met: fails closed", async () => {
    const { input, env } = c.setup({ requires: ">=99", fieldFromTheFuture: true });
    c.failsClosed(await runHook(c.spec, input, env));
  });

  test("a broken anymodel.json: fails closed the same way, naming the file", async () => {
    const { input, env } = c.setup({ worktree: {} });
    const result = await runHook(c.spec, input, env);
    const said = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(said).toContain("anymodel.json: worktree: unknown field");
  });

  test("requires not met, but the project still wires its own: silent (its copy runs)", async () => {
    const { input, env } = c.setup({ requires: ">=99" });
    wireProjectHook(mainOf(input), c.own.event, c.own.matcher);
    expect(await runHook(c.spec, input, env)).toEqual({});
  });
});

describe("no anymodel.json", () => {
  test.each(
    CASES.filter(
      (c) =>
        c.spec !== worktreeCreateHook &&
        c.spec !== worktreeRemoveHook &&
        c.spec !== subagentStopHook,
    ).map((c) => [c.spec.name, c] as const),
  )("%s is silent", async (_name, c) => {
    const { input, env } = c.setup(undefined);
    expect(await runHook(c.spec, input, env)).toEqual({});
  });

  test("worktree-create makes Claude Code's default shape", async () => {
    const c = CASES.find((one) => one.spec === worktreeCreateHook);
    if (c === undefined) throw new Error("no case");
    const { input, env } = c.setup(undefined);
    expect(await runHook(c.spec, input, env)).toEqual({
      stdout: join(String(input.cwd), ".claude", "worktrees", "x"),
    });
  });
});

describe("the guard matrix", () => {
  const guards = CASES.filter((c) =>
    [gitGuardHook, mainFolderGuardHook, messageGuardHook].includes(c.spec),
  );

  // [plugin installed, project wires its own, requires met, guards that answer]
  const ROWS: Array<[boolean, boolean, boolean, number]> = [
    [true, false, true, 1], // the plugin's
    [true, true, true, 1], // the project's alone: the plugin defers
    [true, false, false, 1], // the plugin's, failing closed: it asks
    [true, true, false, 1], // the project's alone
    [false, true, true, 1], // the project's
    [false, true, false, 1], // the project's
    [false, false, true, 0], // nobody: the project removed its copy before the plugin came
    [false, false, false, 0], // the project's own fail-closed check covers this (design.md)
  ];

  test.each(
    guards.flatMap((c) =>
      ROWS.map(
        ([plugin, wired, met, expected]) => [c.spec.name, plugin, wired, met, expected, c] as const,
      ),
    ),
  )(
    "%s: plugin %j, project's own %j, requires met %j → %j",
    async (_n, plugin, wired, met, expected, c) => {
      const { input, env } = c.setup(met ? FULL_CONFIG : { requires: ">=99" });
      if (wired) wireProjectHook(mainOf(input), c.own.event, c.own.matcher);
      const pluginAnswered = plugin
        ? (await runHook(c.spec, input, env)).stdout !== undefined
        : false;
      expect(Number(pluginAnswered) + Number(wired)).toBe(expected);
    },
  );
});

test("an input that is not JSON, or for another event: nothing (and no crash)", async () => {
  const { handleHook } = await import("./run");
  expect(await handleHook(gitGuardHook, "not json", hookEnv())).toEqual({
    exitCode: 0,
    stderr: "anymodel git-guard: the hook input is not JSON",
  });
  expect(
    await handleHook(
      gitGuardHook,
      JSON.stringify({ hook_event_name: "Stop", cwd: "/" }),
      hookEnv(),
    ),
  ).toEqual({});
});
