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
import { PLUGIN_HOOK_NAMES, RETIRED_HOOK_NAMES, UNSWITCHABLE_HOOK_NAMES } from "../project/config";
import { projectKey, taskContext } from "../tasks/context";
import { openWorkDb, workDbFile, writeWork } from "../tasks/work/db";
import { createTask, layPhase, updateTask } from "../tasks/work/store";
import {
  hookEnv,
  makeClone,
  runHook,
  wireProjectHook,
  writeClaudeFile,
  writeSessionRecord,
} from "../testing/hooks";
import { sessionProcessIdentity } from "../testing/session-record";
import { git, tempDir } from "../testing/temp";
import type { HookResult } from "./io";
import type { HookSpec } from "./run";
import {
  afterMergeHook,
  agentGuardHook,
  agentUsageHook,
  builderFinishHook,
  fableSessionHook,
  gitGuardHook,
  HOOKS,
  jobRouteHook,
  keepGoingHook,
  mainFolderGuardHook,
  mergeGuardHook,
  messageGuardHook,
  reviewRecordHook,
  sessionEscapeGuardHook,
  sessionNameHook,
  subagentBackgroundHook,
  taskStartHook,
  tierViewHook,
  userAwayHook,
  verifyGateHook,
  worktreeLeftoversHook,
} from "./specs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const AGENT = "0a1b2c3d4e5f60718";
const FULL_CONFIG = {
  jobs: { route: true },
  worktrees: { base: "main", guardMainFolder: true },
  sessionNames: true,
};

const AT = "2026-10-21T10:00:00.000Z";

/**
 * This test's own process as the session's Claude process: `keep-going` judges only a phase its
 * caller holds, and finds that caller among the hook's ancestors (as `keep-going.test.ts` does).
 */
const ME = {
  sessionId: SESSION,
  pid: process.ppid,
  procStart: sessionProcessIdentity(process.ppid).procStart ?? null,
};

/**
 * One phase of a plan, in progress by this session's process, and no subagent running: what
 * makes `keep-going` block a stop. The plan's own task is #1, the phase #2.
 */
function seedBusyPhase(env: Record<string, string>, repo: string): void {
  writeSessionRecord(env, { sessionId: SESSION, cwd: repo, name: "main", pid: process.ppid });
  const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
  try {
    const laid = writeWork(
      db,
      () =>
        layPhase(
          db,
          {
            project: projectKey(repo),
            plan: "plan-a",
            phase: "G1",
            subject: "G1 the guard",
            blockedBy: [],
          },
          { sessionId: null, pid: null, procStart: null },
          1,
        ).task,
    );
    if (!laid.ok) throw new Error(laid.why);
    const started = updateTask(db, laid.value.id, { status: "in_progress" }, ME, 2);
    if (!started.ok) throw new Error(started.why);
  } finally {
    db.close();
  }
}

/** The block `keep-going` gives that phase, written by hand. */
const KEEP_GOING_BLOCK = JSON.stringify({
  decision: "block",
  reason:
    "Phase #2 G1 the guard is still in progress, and no subagent runs. Close #2 with `task_done`, or record its blocker with `task_note` and end the turn with a `Waiting for: <what>` line.",
});

/**
 * A builder's task (#1) with one open blocking step (#2), under the project key the task server
 * gives `repo`, and the builder's transcript, whose brief names that task: what makes
 * `builder-finish` block its hand-back. Returns the transcript's path.
 */
function seedOpenStep(env: Record<string, string>, repo: string): string {
  const context = taskContext(repo, env);
  if (!context.ok) throw new Error(context.why);
  const who = { sessionId: SESSION, pid: 12, procStart: "34" };
  const db = openWorkDb(workDbFile(cliPaths(env)), { mode: "write" });
  try {
    const phase = createTask(
      db,
      { project: context.project, subject: "G2 the phase", kind: "phase" },
      who,
      1,
    );
    if (!phase.ok) throw new Error(phase.why);
    const step = createTask(
      db,
      { project: context.project, subject: "Write the test", parentId: phase.value.id },
      who,
      2,
    );
    if (!step.ok) throw new Error(step.why);
  } finally {
    db.close();
  }
  const transcript = join(tempDir("builder-transcript"), "agent.jsonl");
  writeFileSync(
    transcript,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: true,
      agentId: AGENT,
      type: "user",
      message: { role: "user", content: "Build phase G2.\nYour task: #1\n" },
    })}\n`,
  );
  return transcript;
}

/** The block `builder-finish` gives that step, written by hand. */
const BUILDER_FINISH_BLOCK = JSON.stringify({
  decision: "block",
  reason: [
    "Task #1 still has open blocking steps. Close each one, then hand back:",
    '- #2 Write the test: finish it and close it with `task_done` (task "#2", with evidence), or drop it with `task_done` (task "#2", outcome "dropped") and a note saying why.',
  ].join("\n"),
});

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
    spec: taskStartHook,
    own: { event: "SessionStart", matcher: "startup" },
    machineWide: true,
    setup: (config) => ({
      input: { hook_event_name: "SessionStart", cwd: project(config), source: "startup" },
      env: hookEnv(),
    }),
    failsClosed: (result) => {
      expect(result.stdout).toBe(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext:
              "The kit's task list is not set up on this machine yet: run `cc-smart-dev-kit setup`.",
          },
        }),
      );
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
    spec: tierViewHook,
    own: { event: "SessionStart", matcher: "startup" },
    machineWide: true,
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
      expect(result.exitCode ?? 0).toBe(0);
      const said: string = JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext;
      expect(said).toStartWith("Subagent tiers now (the Agent tool's `model`):");
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
      expect(output.permissionDecisionReason).toStartWith(
        "This starts a raw background session (`claude --bg`): it runs beside this session, nobody watches it, and it reports to nobody.\nBuild the work with subagents instead (the Agent tool):",
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
    spec: verifyGateHook,
    own: { event: "Stop" },
    setup: (config) => {
      // The hook speaks only when the project names its fast check, so every config the shared
      // rows write gets one — except "no file", which must stay no file.
      const withCheck =
        typeof config === "object" && config !== null && !Array.isArray(config)
          ? { ...(config as Record<string, unknown>), checks: { fast: "bun run typecheck" } }
          : config;
      const repo = project(withCheck);
      // This session's transcript: one edit, and no Bash call that ran the check.
      const transcript = join(tempDir("verify-gate-transcript"), "session.jsonl");
      writeFileSync(
        transcript,
        `${JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_edit",
                name: "Edit",
                input: { file_path: "src/a.ts" },
              },
            ],
          },
        })}\n`,
      );
      return {
        input: {
          hook_event_name: "Stop",
          session_id: SESSION,
          cwd: repo,
          stop_hook_active: false,
          transcript_path: transcript,
        },
        env: hookEnv(),
      };
    },
    // One stderr line, exit 0: a reminder never stops a person's work.
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toStartWith("cc-smart-dev-kit verify-gate: ");
    },
  },
  {
    spec: agentUsageHook,
    own: { event: "SubagentStop" },
    // Machine-wide: the person's spend is recorded with no file and with a broken one alike.
    // A successful record is silence (SubagentStop carries no context), so the one answer this
    // hook has is a failure: the agent's transcript cannot be read. That is also how the shared
    // rows' "it speaks" is proved here.
    machineWide: true,
    setup: (config) => ({
      input: {
        hook_event_name: "SubagentStop",
        session_id: SESSION,
        cwd: project(config),
        agent_id: AGENT,
        agent_type: "general-purpose",
        agent_transcript_path: join(tempDir("agent-usage-transcript"), "agent.jsonl"),
      },
      env: hookEnv(),
    }),
    // One stderr line, exit 0: a subagent must always finish.
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toStartWith("cc-smart-dev-kit agent-usage: ");
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
    spec: keepGoingHook,
    own: { event: "Stop" },
    // Machine-wide: it reads only the person's own task list, never a project setting, so no
    // file, a broken one and a newer one judge the same.
    machineWide: true,
    setup: (config) => {
      const repo = project(config);
      const env = hookEnv();
      seedBusyPhase(env, repo);
      return {
        input: {
          hook_event_name: "Stop",
          session_id: SESSION,
          cwd: repo,
          stop_hook_active: false,
          last_assistant_message: "The reader is in. Next I build the hook.",
        },
        env,
      };
    },
    failsClosed: (result) => {
      expect(result).toEqual({ stdout: KEEP_GOING_BLOCK });
    },
  },
  {
    spec: builderFinishHook,
    own: { event: "SubagentStop" },
    // Machine-wide, like keep-going: the task list is the person's, and no project setting is read.
    machineWide: true,
    setup: (config) => {
      const repo = project(config);
      const env = hookEnv();
      return {
        input: {
          hook_event_name: "SubagentStop",
          session_id: SESSION,
          cwd: repo,
          agent_id: AGENT,
          agent_type: "cc-smart-dev-kit:builder",
          agent_transcript_path: seedOpenStep(env, repo),
          stop_hook_active: false,
        },
        env,
      };
    },
    failsClosed: (result) => {
      expect(result).toEqual({ stdout: BUILDER_FINISH_BLOCK });
    },
  },
  {
    spec: userAwayHook,
    own: { event: "PreToolUse", matcher: "AskUserQuestion|ExitPlanMode" },
    // Machine-wide and `alwaysOn`: the person is one for the machine, so the answer reads the
    // state file and never the project's, and no `ownHooks` list switches it off.
    machineWide: true,
    alwaysOn: true,
    setup: (config) => {
      const env = hookEnv();
      // The state file, written by hand: the person has been away since 01:00.
      const folder = join(cliPaths(env).stateDir, "user-away");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "state.json"),
        `${JSON.stringify({ unavailable: true, since: AT, until: null, items: [], nextId: 1, said: {} })}\n`,
      );
      return {
        input: {
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: project(config),
          tool_name: "AskUserQuestion",
          tool_input: { questions: [] },
        },
        env,
      };
    },
    failsClosed: (result) => {
      expect(result.exitCode ?? 0).toBe(0);
      const output = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
      expect(output.permissionDecision).toBe("deny");
      expect(output.permissionDecisionReason).toStartWith("The person is unavailable since ");
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
    "user-away",
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

  test("the retired names in ownHooks (serena-root, crew-role, lead-notes): the file still reads, and this hook still speaks", async () => {
    // A project file written for an older plugin may still list one. Refused, the strict parse
    // would fail and every guard would ask about every call; accepted, it silences nothing.
    expect([...RETIRED_HOOK_NAMES]).toEqual(["serena-root", "crew-role", "lead-notes"]);
    const { input, env } = c.setup({ ...FULL_CONFIG, ownHooks: [...RETIRED_HOOK_NAMES] });
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
