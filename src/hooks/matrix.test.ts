/**
 * Every hook through the same frame (`run.ts`), in a table:
 * - with no cc-smart-dev-kit.json: every hook silent, except the machine-wide ones, which
 *   judge the same way;
 * - the project's own copy: a hook its cc-smart-dev-kit.json lists in `ownHooks` is silent,
 *   even when the rest of the file is broken or too new; a project hook on the same event
 *   that is not listed silences nothing;
 * - `requires` not met (and a broken cc-smart-dev-kit.json): each fails closed its own way;
 * - the guard matrix: the plugin's hook on or off × the project's hook wired or not × listed
 *   in `ownHooks` or not × the project's `requires` met or not. Exactly one guard answers a
 *   destructive command when the project lists the copy it runs; two when it forgot to (what
 *   `cc-smart-dev-kit doctor` warns about); none only when neither is installed.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cliPaths } from "../cli/paths";
import { PLUGIN_HOOK_NAMES } from "../project/config";
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
  agentGuardHook,
  fableSessionHook,
  gitGuardHook,
  HOOKS,
  jobRouteHook,
  mainFolderGuardHook,
  mergeGuardHook,
  messageGuardHook,
  reviewRecordHook,
  sessionNameHook,
  worktreeLeftoversHook,
} from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const AGENT = "0a1b2c3d4e5f60718";
const FULL_CONFIG = {
  jobs: { route: true },
  worktrees: { base: "main", guardMainFolder: true },
  sessionNames: true,
};

interface Case {
  spec: HookSpec;
  /** The project's own copy of this hook: event and matcher. */
  own: { event: string; matcher?: string };
  /** A project and an input that make this hook speak. */
  setup: (config: unknown) => { input: Record<string, unknown>; env: Record<string, string> };
  /** What it says when `requires` is not met (null: silent but for one stderr line). */
  failsClosed: (result: HookResult) => void;
  /**
   * A machine-wide hook (agent-guard): it runs with or without cc-smart-dev-kit.json, and its answer
   * does not depend on the project's file, so the shared rows below say so.
   */
  machineWide?: boolean;
}

function project(config: unknown) {
  const { repo } = makeClone();
  if (config !== undefined) writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
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
  expect(output.permissionDecisionReason).toEndWith(
    "run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit",
  );
};
const denyLine = (result: HookResult) => {
  expect(result.exitCode ?? 0).toBe(0);
  const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
  expect(output.permissionDecision).toBe("deny");
  expect(output.permissionDecisionReason).toContain("asks for effort `low`");
};
const contextLine = (result: HookResult) => {
  const text: string = JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
  expect(text).toStartWith("cc-smart-dev-kit: ");
  expect(text).toEndWith("run claude plugin update cc-smart-dev-kit@cc-smart-dev-kit");
  expect(text).not.toContain("\n");
};

const CASES: Case[] = [
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
    spec: mergeGuardHook,
    own: { event: "PreToolUse", matcher: "Bash|PowerShell" },
    setup: (config) => ({
      input: {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project(config),
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 7" },
      },
      env: hookEnv(),
    }),
    failsClosed: askLine,
  },
  {
    spec: agentGuardHook,
    own: { event: "PreToolUse", matcher: "Agent|Task|Workflow" },
    machineWide: true,
    setup: (config) => ({
      input: {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project(config),
        tool_name: "Agent",
        tool_input: { effort: "low", model: "opus", prompt: "do it" },
      },
      env: hookEnv(),
    }),
    failsClosed: denyLine,
  },
  {
    spec: fableSessionHook,
    own: { event: "SessionStart", matcher: "startup" },
    machineWide: true,
    setup: (config) => ({
      input: {
        hook_event_name: "SessionStart",
        session_id: SESSION,
        cwd: project(config),
        source: "startup",
        model: "claude-fable-5-1",
      },
      env: hookEnv(),
    }),
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      const said: string = JSON.parse(result.stdout ?? "{}").systemMessage;
      expect(said).toStartWith("cc-smart-dev-kit: this session runs on Claude Fable");
    },
  },
  {
    spec: jobRouteHook,
    own: { event: "PreToolUse", matcher: "Bash" },
    setup: (config) => ({
      input: {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project(config),
        tool_name: "Bash",
        tool_input: { command: "bunx tsc --noEmit" },
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
    spec: reviewRecordHook,
    own: { event: "SubagentStop" },
    setup: (config) => {
      const env = hookEnv();
      // A successful record is silence (SubagentStop carries no context), so the one answer
      // this hook has is a failure: the person's own workflow file cannot be read. That is
      // also how the shared rows' "it speaks" is proved here.
      const file = cliPaths(env).workflowConfigFile;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "{ not json");
      return {
        input: {
          hook_event_name: "SubagentStop",
          session_id: SESSION,
          cwd: project(config),
          agent_id: AGENT,
          agent_type: "cc-smart-dev-kit:reviewer",
        },
        env,
      };
    },
    // One stderr line, exit 0: a subagent must always finish.
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toStartWith("cc-smart-dev-kit review-record: ");
    },
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
      expect(result.stderr).toStartWith("cc-smart-dev-kit session-name: ");
    },
  },
];

test("the table covers every hook", () => {
  expect(CASES.map((c) => c.spec.name).sort()).toEqual(HOOKS.map((spec) => spec.name).sort());
});

test("ownHooks accepts exactly the plugin's hooks", () => {
  const listed: string[] = [...PLUGIN_HOOK_NAMES];
  expect(listed.sort()).toEqual(HOOKS.map((spec) => spec.name).sort());
});

/** The full config, with `ownHooks` listing this hook. */
function listing(c: Case, config: Record<string, unknown> = FULL_CONFIG) {
  return { ...config, ownHooks: [c.spec.name] };
}

/** What a hook says: anything at all on stdout or stderr. */
const speaks = (result: HookResult) => result.stdout !== undefined || result.stderr !== undefined;

describe.each(CASES.map((c) => [c.spec.name, c] as const))("%s", (_name, c) => {
  test("speaks with a full cc-smart-dev-kit.json (the baseline the other rows silence)", async () => {
    const { input, env } = c.setup(FULL_CONFIG);
    const result = await runHook(c.spec, input, env);
    expect(speaks(result)).toBe(true);
    expect(result.exitCode ?? 0).toBe(0);
  });

  test.each(["settings.json", "settings.local.json"])(
    "another hook for the same event in the project's %s, not listed in ownHooks: it still speaks",
    async (file) => {
      const { input, env } = c.setup(FULL_CONFIG);
      wireProjectHook(mainOf(input), c.own.event, c.own.matcher, file);
      const result = await runHook(c.spec, input, env);
      expect(speaks(result)).toBe(true);
      expect(result.exitCode ?? 0).toBe(0);
    },
  );

  test("listed in ownHooks: a plugin hook stays silent (the project's copy answers)", async () => {
    const { input, env } = c.setup(listing(c));
    expect(await runHook(c.spec, input, env)).toEqual({});
  });

  test("a retired name in ownHooks (serena-root): the file still reads, and this hook still speaks", async () => {
    // A project file written for an older plugin may still list it. Refused, the strict parse
    // would fail and every guard would ask about every call; accepted, it silences nothing.
    const { input, env } = c.setup({ ...FULL_CONFIG, ownHooks: ["serena-root"] });
    const result = await runHook(c.spec, input, env);
    expect(speaks(result)).toBe(true);
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).not.toContain("ownHooks");
  });

  test("requires not met: fails closed", async () => {
    const { input, env } = c.setup({ requires: ">=99", fieldFromTheFuture: true });
    c.failsClosed(await runHook(c.spec, input, env));
  });

  test("a broken cc-smart-dev-kit.json: fails closed the same way, naming the file", async () => {
    const { input, env } = c.setup({ worktree: {} });
    const result = await runHook(c.spec, input, env);
    if (c.machineWide === true) {
      // A machine-wide hook's answer never depends on the project's file: it judges on.
      c.failsClosed(result);
      return;
    }
    const said = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(said).toContain("cc-smart-dev-kit.json: worktree: unknown field");
  });

  test("requires not met, and listed in ownHooks: the hook stays silent (the project's copy runs)", async () => {
    const { input, env } = c.setup(listing(c, { requires: ">=99", fieldFromTheFuture: true }));
    wireProjectHook(mainOf(input), c.own.event, c.own.matcher);
    expect(await runHook(c.spec, input, env)).toEqual({});
  });

  test("requires not met, another hook for the same event, not listed: fails closed all the same", async () => {
    const { input, env } = c.setup({ requires: ">=99" });
    wireProjectHook(mainOf(input), c.own.event, c.own.matcher);
    c.failsClosed(await runHook(c.spec, input, env));
  });
});

describe("no cc-smart-dev-kit.json", () => {
  test.each(CASES.filter((c) => c.machineWide !== true).map((c) => [c.spec.name, c] as const))(
    "the plugin's %s is silent",
    async (_name, c) => {
      const { input, env } = c.setup(undefined);
      expect(await runHook(c.spec, input, env)).toEqual({});
    },
  );

  test.each(CASES.filter((c) => c.machineWide === true).map((c) => [c.spec.name, c] as const))(
    "the machine-wide %s judges the same without cc-smart-dev-kit.json",
    async (_name, c) => {
      const { input, env } = c.setup(undefined);
      c.failsClosed(await runHook(c.spec, input, env));
    },
  );
});

describe("the guard matrix", () => {
  const guards = CASES.filter((c) =>
    [gitGuardHook, mergeGuardHook, mainFolderGuardHook, messageGuardHook].includes(c.spec),
  );

  // [plugin installed, project wires its own, listed in ownHooks, requires met, guards that answer]
  const ROWS: Array<[boolean, boolean, boolean, boolean, number]> = [
    [true, false, false, true, 1], // the plugin's
    [true, true, true, true, 1], // the project's alone: listed, so the plugin's is silent
    [true, true, false, true, 2], // both: the project forgot to list it (doctor warns)
    [true, false, false, false, 1], // the plugin's, failing closed: it asks
    [true, true, true, false, 1], // the project's alone: ownHooks is read on its own
    [false, true, true, true, 1], // the project's
    [false, true, true, false, 1], // the project's
    [false, false, false, true, 0], // nobody: the project removed its copy before the plugin came
    [false, false, false, false, 0], // the project's own fail-closed check covers this (design.md)
  ];

  test.each(
    guards.flatMap((c) =>
      ROWS.map(
        ([plugin, wired, listed, met, expected]) =>
          [c.spec.name, plugin, wired, listed, met, expected, c] as const,
      ),
    ),
  )(
    "%s: plugin %j, project's own %j, listed %j, requires met %j → %j",
    async (_n, plugin, wired, listed, met, expected, c) => {
      const config = met ? FULL_CONFIG : { requires: ">=99" };
      const { input, env } = c.setup(listed ? listing(c, config) : config);
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
    stderr: "cc-smart-dev-kit git-guard: the hook input is not JSON",
  });
  expect(
    await handleHook(
      gitGuardHook,
      JSON.stringify({ hook_event_name: "Stop", cwd: "/" }),
      hookEnv(),
    ),
  ).toEqual({});
});
