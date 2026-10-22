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
import { CREW_ENV } from "../crew/session";
import {
  createCrew,
  crewEventsFile,
  leadFile,
  notesStateFile,
  writeStoreFile,
} from "../crew/store";
import { PLUGIN_HOOK_NAMES, UNSWITCHABLE_HOOK_NAMES } from "../project/config";
import { locateCheckout } from "../project/resolve";
import {
  hookEnv,
  makeClone,
  runHook,
  wireProjectHook,
  writeClaudeFile,
  writeSessionRecord,
} from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { CREW_PUSH_REFUSAL } from "./git-guard";
import type { HookResult } from "./io";
import { CREW_PR_REFUSAL } from "./merge-guard";
import type { HookSpec } from "./run";
import {
  afterMergeHook,
  agentGuardHook,
  crewRoleHook,
  fableSessionHook,
  gitGuardHook,
  HOOKS,
  jobRouteHook,
  leadNotesHook,
  mainFolderGuardHook,
  mergeGuardHook,
  messageGuardHook,
  reviewRecordHook,
  sessionEscapeGuardHook,
  sessionNameHook,
  subagentBackgroundHook,
  worktreeLeftoversHook,
} from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const AGENT = "0a1b2c3d4e5f60718";
const FULL_CONFIG = {
  jobs: { route: true },
  worktrees: { base: "main", guardMainFolder: true },
  sessionNames: true,
};

/** The crew session a hook test runs as; `crew-role` is silent without one. */
const CREW_ID = "W2-x-1a2b3c";
/** What a `step` event carries, so its watch line ends with the short sha. */
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const AT = "2026-10-21T10:00:00.000Z";

/**
 * A lead record, a crew step event, and a notes cursor before it: the three files that make
 * `lead-notes` speak. Written by hand, so the note's expected line is not computed by the code
 * under test.
 */
function seedLeadNotes(stateDir: string, repo: string): void {
  writeStoreFile(
    leadFile(stateDir, repo, SESSION),
    `${JSON.stringify({
      cwd: repo,
      createdAt: AT,
      name: "LEAD app plan",
      plan: "plan",
      repo,
      sessionId: SESSION,
      tag: "app",
      updatedAt: AT,
      version: 1,
    })}\n`,
  );
  writeStoreFile(notesStateFile(stateDir, repo, SESSION), `${JSON.stringify({ offset: 0 })}\n`);
  writeStoreFile(
    crewEventsFile(stateDir, repo),
    `${JSON.stringify({
      at: AT,
      crew: CREW_ID,
      lead: SESSION,
      name: "C app W2 hooks",
      sha: SHA,
      state: "working",
      text: "tests-green",
      type: "step",
      version: 1,
    })}\n`,
  );
}

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
  /** A hook `ownHooks` cannot switch off (`HookSpec.alwaysOn`): listing it silences nothing. */
  alwaysOn?: boolean;
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
    spec: sessionEscapeGuardHook,
    own: { event: "PreToolUse", matcher: "Bash|PowerShell|Edit|Write|NotebookEdit" },
    machineWide: true,
    alwaysOn: true,
    setup: (config) => ({
      input: {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project(config),
        tool_name: "Bash",
        tool_input: { command: "env -u CLAUDECODE cc-smart-dev-kit workflow set autoMerge true" },
      },
      env: hookEnv(),
    }),
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
      expect(output.permissionDecision).toBe("deny");
      expect(output.permissionDecisionReason).toContain("with CLAUDECODE removed");
    },
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
    machineWide: true,
    alwaysOn: true,
    setup: (config) => ({
      input: {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project(config),
        tool_name: "Bash",
        tool_input: { command: "claude --bg 'do the phase'" },
      },
      env: hookEnv(),
    }),
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
      expect(output.permissionDecision).toBe("ask");
      expect(output.permissionDecisionReason).toContain(
        "crew start <phase> --slug <slug> --kind <kind> --brief <file|->",
      );
    },
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
    spec: subagentBackgroundHook,
    own: { event: "SubagentStop" },
    setup: (config) => {
      const repo = project(config);
      // The subagent's own transcript, where a background Bash tool result names the task id:
      // the input's `background_tasks` is the session's list, so this is what proves the task
      // is this agent's (src/hooks/subagent-background.ts). The `tool_use` line comes first,
      // as Claude Code writes it: only a result of the agent's own Bash call counts.
      const transcript = join(tempDir("subagent-transcript"), "agent.jsonl");
      writeFileSync(
        transcript,
        `${JSON.stringify({
          type: "assistant",
          agentId: AGENT,
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_bash",
                name: "Bash",
                input: { command: "bun test", run_in_background: true },
              },
            ],
          },
        })}\n${JSON.stringify({
          type: "user",
          agentId: AGENT,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_bash",
                content:
                  "Command running in background with ID: shell1234. Output is being written to: /tmp/claude/tasks/shell1234.output.",
              },
            ],
          },
        })}\n`,
      );
      return {
        input: {
          hook_event_name: "SubagentStop",
          session_id: SESSION,
          cwd: repo,
          agent_id: AGENT,
          agent_type: "general-purpose",
          agent_transcript_path: transcript,
          stop_hook_active: false,
          background_tasks: [
            {
              id: "shell1234",
              type: "shell",
              status: "running",
              description: "the tests",
              command: "bun test",
            },
          ],
        },
        env: hookEnv(),
      };
    },
    // One stderr line, exit 0: a subagent must always finish.
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toStartWith("cc-smart-dev-kit subagent-background: ");
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
  {
    spec: crewRoleHook,
    own: { event: "PreToolUse", matcher: "AskUserQuestion|ExitPlanMode" },
    // Machine-wide: the ask is denied the same way with no file, a broken one, or one from a
    // newer plugin, because the answer reads no store at all.
    machineWide: true,
    setup: (config) => ({
      input: {
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project(config),
        tool_name: "AskUserQuestion",
        tool_input: { questions: [] },
      },
      env: { ...hookEnv(), [CREW_ENV]: CREW_ID },
    }),
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
      expect(output.permissionDecision).toBe("deny");
      expect(output.permissionDecisionReason).toBe(
        'cc-smart-dev-kit crew report --question "<q>" --option "<a>" --option "<b>" --recommend <n>',
      );
    },
  },
  {
    spec: leadNotesHook,
    own: { event: "UserPromptSubmit" },
    // Machine-wide: a registered lead hears its news with no file and with a broken one alike.
    machineWide: true,
    setup: (config) => {
      const repo = project(config);
      const env = hookEnv();
      seedLeadNotes(cliPaths(env).stateDir, repo);
      return {
        input: {
          hook_event_name: "UserPromptSubmit",
          session_id: SESSION,
          cwd: repo,
          prompt: "go on",
        },
        env,
      };
    },
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      const text: string = JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
      expect(text).toBe("C app W2 hooks: tests-green · a1b2c3d");
    },
  },
];

test("the table covers every hook", () => {
  expect(CASES.map((c) => c.spec.name).sort()).toEqual(HOOKS.map((spec) => spec.name).sort());
});

test("ownHooks accepts exactly the plugin's hooks that a project can switch off", () => {
  const listed: string[] = [...PLUGIN_HOOK_NAMES];
  const switchable = HOOKS.filter((spec) => spec.alwaysOn !== true).map((spec) => spec.name);
  expect(listed.sort()).toEqual(switchable.sort());
  // An `alwaysOn` hook is wired and in the table, and `ownHooks` cannot switch it off. A name
  // a project file may already list for one (`UNSWITCHABLE_HOOK_NAMES`) still parses and
  // silences nothing.
  expect(HOOKS.filter((spec) => spec.alwaysOn === true).map((spec) => spec.name)).toEqual([
    "session-escape-guard",
    "job-route",
  ]);
  const alwaysOn = HOOKS.filter((spec) => spec.alwaysOn === true).map((spec) => spec.name);
  expect([...UNSWITCHABLE_HOOK_NAMES].every((name) => alwaysOn.includes(name))).toBe(true);
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
    const result = await runHook(c.spec, input, env);
    // An `alwaysOn` hook is the one no project can switch off: it answers all the same.
    if (c.alwaysOn === true) expect(speaks(result)).toBe(true);
    else expect(result).toEqual({});
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
    const result = await runHook(c.spec, input, env);
    if (c.alwaysOn === true) expect(speaks(result)).toBe(true);
    else expect(result).toEqual({});
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

/**
 * A crew session's refusals (D24, D47) hold in a project that never opted in, and in one whose
 * `ownHooks` names its own copy of the guard: the frame runs each guard's crew part before
 * `ownHooks` and before the project's file (`HookSpec.crewLimits`, `run.ts`). The same rows
 * prove a plain session keeps the old behaviour: silent with no file, and the project's own
 * guard alone when it is listed.
 */
describe("a crew session's refusals: no file, and whatever ownHooks says (F2b-1, F2b-2)", () => {
  const SELF = { id: "B1-lookup-1a2b3c", name: "C app B1 lookup", phase: "B1" };
  const PEER = { id: "B2-api-4d5e6f", name: "C app B2 api", phase: "B2" };
  const LEAD = "LEAD app lead";

  /** One crew session's record, as `crew start` writes it. */
  async function record(
    stateDir: string,
    repo: string,
    one: { id: string; name: string; phase: string },
  ): Promise<void> {
    await createCrew(
      stateDir,
      {
        base: null,
        baseRef: "main",
        branch: `crew/${one.phase}-${one.id}`,
        effort: "high",
        files: [],
        id: one.id,
        kind: "build",
        lastLine: null,
        leadName: LEAD,
        leadSessionId: "c00f9bb5-1111-2222-3333-444444444444",
        memoryMb: null,
        model: { named: "sonnet", resolved: "sonnet", slot: null, tier: null },
        name: one.name,
        permissionMode: "auto",
        phase: one.phase,
        plan: "lead",
        pr: null,
        questions: [],
        repo,
        reportPath: null,
        sessionId: null,
        shortId: null,
        slug: one.id,
        state: "working",
        waitsFor: [],
        worktree: join(repo, ".claude", "worktrees", one.id),
      },
      Date.parse("2026-10-21T10:00:00.000Z"),
    );
  }

  /** A repo (with the project's file only when `config` is given) and the two crew records. */
  async function world(config?: unknown): Promise<{
    crew: Record<string, string>;
    env: Record<string, string>;
    repo: string;
  }> {
    const { repo } = makeClone();
    if (config !== undefined) writeClaudeFile(repo, "cc-smart-dev-kit.json", config);
    const env = hookEnv();
    const root = locateCheckout(repo)?.root ?? repo;
    const stateDir = cliPaths(env).stateDir;
    for (const one of [SELF, PEER]) await record(stateDir, root, one);
    return { crew: { ...env, [CREW_ENV]: SELF.id }, env, repo };
  }

  /** The shell call a crew session may not run. */
  function shell(repo: string, command: string): Record<string, unknown> {
    return {
      hook_event_name: "PreToolUse",
      session_id: SESSION,
      cwd: repo,
      tool_name: "Bash",
      tool_input: { command },
    };
  }

  /** The message a crew session sends. */
  function message(repo: string, to: string, text: string): Record<string, unknown> {
    return {
      hook_event_name: "PreToolUse",
      session_id: SESSION,
      cwd: repo,
      tool_name: "SendMessage",
      tool_input: { message: text, to },
    };
  }

  /** A denial, checked as the guard's answer: the reason is written by hand, never computed. */
  function denied(result: HookResult, reason: string): void {
    expect(result.exitCode ?? 0).toBe(0);
    const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
    expect(output.permissionDecision).toBe("deny");
    expect(output.permissionDecisionReason).toBe(reason);
  }

  /** The refusal of an untagged message to the peer, in the guard's own words. */
  const UNTAGGED = [
    `"C app B2 api" is a crew session too, and one crew session messages another only with a contract note or a contract question.`,
    `Fix: cc-smart-dev-kit crew tell "C app B2 api" --kind contract "<what changed: file:symbol, commit>", or --kind question "<the ask>"`,
    `It writes the first line the note must carry ("[B1] CONTRACT: …"), and records the note for your lead.`,
    `That the phase is done, or how it goes, goes to the lead: cc-smart-dev-kit crew report --status done.`,
  ].join("\n");

  /** The refusal of a message to the lead, in the guard's own words. */
  const TO_LEAD = [
    `"LEAD app lead" is your lead, and a crew session reaches its lead through crew report, not a message.`,
    `Fix: cc-smart-dev-kit crew report --status done, or cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>`,
    "The report is recorded for the lead, and its watch wakes the lead on the line.",
  ].join("\n");

  async function expectRefused(crew: Record<string, string>, repo: string): Promise<void> {
    denied(
      await runHook(gitGuardHook, shell(repo, "git push origin fix/x"), crew),
      CREW_PUSH_REFUSAL,
    );
    denied(
      await runHook(mergeGuardHook, shell(repo, "gh pr create --fill"), crew),
      CREW_PR_REFUSAL,
    );
    denied(await runHook(messageGuardHook, message(repo, PEER.name, "done!"), crew), UNTAGGED);
    denied(await runHook(messageGuardHook, message(repo, LEAD, "done"), crew), TO_LEAD);
  }

  test("no cc-smart-dev-kit.json: the push, the pull request and the untagged peer message are denied", async () => {
    const { crew, repo } = await world(undefined);
    await expectRefused(crew, repo);
  });

  test('ownHooks: ["git-guard", "merge-guard"] silences none of the crew refusals', async () => {
    const { crew, repo } = await world({ ownHooks: ["git-guard", "merge-guard"] });
    await expectRefused(crew, repo);
  });

  test("ownHooks listing message-guard silences no crew message refusal", async () => {
    const { crew, repo } = await world({ ownHooks: ["message-guard"] });
    denied(await runHook(messageGuardHook, message(repo, PEER.name, "done!"), crew), UNTAGGED);
  });

  test("a file that needs a newer plugin does not soften them either", async () => {
    const { crew, repo } = await world({ requires: ">=99" });
    await expectRefused(crew, repo);
  });

  test("a plain session with no file keeps today's silence; a crew session's other git work is not judged", async () => {
    const { crew, env, repo } = await world(undefined);
    expect(await runHook(gitGuardHook, shell(repo, "git push origin fix/x"), env)).toEqual({});
    expect(await runHook(mergeGuardHook, shell(repo, "gh pr create --fill"), env)).toEqual({});
    expect(await runHook(messageGuardHook, message(repo, PEER.name, "done!"), env)).toEqual({});
    // A crew session's other git work is not refused either: this part judges a push only.
    expect(await runHook(gitGuardHook, shell(repo, "git status"), crew)).toEqual({});
  });
});

test("an input that is not JSON: a guard asks, any other hook says one line; for another event: nothing", async () => {
  const { handleHook } = await import("./run");
  // A guard that cannot read its input cannot judge the call, so it asks (fails closed).
  expect(await handleHook(gitGuardHook, "not json", hookEnv())).toEqual({
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "cc-smart-dev-kit cannot check this git command: the hook input is not JSON",
      },
    }),
  });
  // An informational hook never stops a person's work: one line on stderr, exit 0.
  expect(await handleHook(sessionNameHook, "not json", hookEnv())).toEqual({
    exitCode: 0,
    stderr: "cc-smart-dev-kit session-name: the hook input is not JSON",
  });
  expect(
    await handleHook(
      gitGuardHook,
      JSON.stringify({ hook_event_name: "Stop", cwd: "/" }),
      hookEnv(),
    ),
  ).toEqual({});
});
