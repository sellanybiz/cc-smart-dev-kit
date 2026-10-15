/**
 * The hooks as Claude Code runs them: `plugin/hooks/hooks.json` names each bundle in exec
 * form, and each `src/entries/<name>.ts` reads its JSON on stdin and answers on stdout.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, runEntry, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { HOOK_LOG_ENV } from "./run";
import { HOOKS } from "./specs";

const ROOT = join(import.meta.dir, "..", "..");

interface Handler {
  type: string;
  command: string;
  args?: string[];
  timeout?: number;
}
interface Group {
  matcher?: string;
  hooks: Handler[];
}

const hooksJson = JSON.parse(readFileSync(join(ROOT, "plugin", "hooks", "hooks.json"), "utf8")) as {
  hooks: Record<string, Group[]>;
};

/** Every (event, matcher, bundle, timeout) hooks.json wires. */
const wired = Object.entries(hooksJson.hooks).flatMap(([event, groups]) =>
  groups.flatMap((group) =>
    group.hooks.map((handler) => ({ event, matcher: group.matcher ?? null, handler })),
  ),
);

describe("hooks.json", () => {
  test("every handler is exec form: bun and one bundle in dist/, with its own timeout", () => {
    for (const { handler } of wired) {
      expect(handler.type).toBe("command");
      expect(handler.command).toBe("bun");
      expect(handler.args).toHaveLength(1);
      expect(handler.args?.[0]).toMatch(/^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/[a-z-]+\.js$/);
      expect(typeof handler.timeout).toBe("number");
    }
  });

  test("each bundle it names has an entry in src/entries/, and every hook is wired", () => {
    const bundles = new Set(
      wired.map(({ handler }) => (handler.args?.[0] ?? "").replace(/^.*\/dist\/|\.js$/g, "")),
    );
    for (const bundle of bundles) {
      expect(existsSync(join(ROOT, "src", "entries", `${bundle}.ts`))).toBe(true);
    }
    expect([...bundles].sort()).toEqual(HOOKS.map((spec) => spec.name).sort());
  });

  test("each hook is wired for exactly the events it handles", () => {
    for (const spec of HOOKS) {
      const events = wired
        .filter(({ handler }) => handler.args?.[0]?.endsWith(`/dist/${spec.name}.js`))
        .map(({ event }) => event);
      expect([...new Set(events)].sort()).toEqual([...spec.events].sort());
    }
  });

  test("the timeouts: long for a worktree's setup, short for a guard", () => {
    const timeout = (bundle: string) =>
      wired.find(({ handler }) => handler.args?.[0]?.endsWith(`/dist/${bundle}.js`))?.handler
        .timeout;
    expect(timeout("worktree-create")).toBe(600);
    expect(timeout("git-guard")).toBe(10);
    expect(timeout("main-folder-guard")).toBe(10);
    expect(timeout("message-guard")).toBe(10);
  });
});

describe("the entries, run as Claude Code runs them", () => {
  test("WorktreeCreate: stdout is the folder and nothing else; the run is logged", () => {
    const repo = makeRepo();
    const log = join(tempDir("log"), "hooks.log");
    const env = { ...hookEnv(), [HOOK_LOG_ENV]: log };
    const run = runEntry(
      "worktree-create",
      JSON.stringify({
        hook_event_name: "WorktreeCreate",
        session_id: "s",
        cwd: repo,
        name: "feat/x",
      }),
      env,
    );
    const folder = join(repo, ".claude", "worktrees", "feat+x");
    expect(run).toEqual({ exitCode: 0, stdout: folder, stderr: "" });
    expect(readFileSync(log, "utf8")).toBe(
      `${JSON.stringify({ hook: "worktree-create", event: "WorktreeCreate", exitCode: 0, stdout: folder })}\n`,
    );
  });

  test("WorktreeCreate that fails: exit 1, nothing on stdout, the reason on stderr", () => {
    const run = runEntry(
      "worktree-create",
      JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: tempDir("nogit"), name: "x" }),
      hookEnv(),
    );
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toStartWith("worktree not created: ");
  });

  test("the git guard: a PreToolUse ask, exactly", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", {});
    const run = runEntry(
      "git-guard",
      JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "git reset --hard" },
      }),
      hookEnv(),
    );
    expect(run).toEqual({
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason:
            "`git reset --hard` throws away every uncommitted change in this folder, for good. Approve only if you want them gone; a WIP commit keeps the work first.",
        },
      }),
      stderr: "",
    });
  });

  test.each(HOOKS.map((spec) => [spec.name, spec.crashExitCode ?? 0] as const))(
    "%s: input that is not JSON is one stderr line, exit %j",
    (name, exitCode) => {
      const run = runEntry(name, "not json", hookEnv());
      expect(run).toEqual({
        exitCode,
        stdout: "",
        stderr: `anymodel ${name}: the hook input is not JSON\n`,
      });
    },
  );

  test("only the two worktree hooks exit 1 on a bad input: they cannot succeed without one", () => {
    expect(HOOKS.filter((spec) => spec.crashExitCode === 1).map((spec) => spec.name)).toEqual([
      "worktree-create",
      "worktree-remove",
    ]);
  });
});
