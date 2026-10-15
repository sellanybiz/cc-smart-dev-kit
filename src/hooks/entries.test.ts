/**
 * The plugin's hooks as Claude Code runs them: `plugin/hooks/hooks.json` names each bundle in
 * exec form, through the bun shim `bin/anymodel-bun`, and each `src/entries/<name>.ts` reads
 * its JSON on stdin and answers on stdout. (The worktree engine a project wires itself runs
 * as `anymodel hook <name>`: `src/cli/hook-commands.test.ts`.)
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RESOLVE_GIT_TIMEOUT_MS } from "../project/resolve";
import { hookEnv, makeRepo, runEntry, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import { HOOK_LOG_ENV } from "./run";
import { HOOKS, USER_HOOKS } from "./specs";
import { ADD_TIMEOUT_MS, SETUP_TIMEOUT_MS } from "./worktree-create";
import { REMOVE_TIMEOUT_MS } from "./worktree-remove";

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
  test("every handler is exec form: the bun shim, the missing-bun mode and one bundle in dist/, with its own timeout", () => {
    for (const { event, handler } of wired) {
      expect(handler.type).toBe("command");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
      expect(handler.command).toBe("${CLAUDE_PLUGIN_ROOT}/bin/anymodel-bun");
      // The shim's first argument says what it does when bun is missing: a guard fails
      // closed by asking the person (PreToolUse); every other hook is quiet, one line.
      expect(handler.args).toEqual([
        event === "PreToolUse" ? "--missing=ask" : "--missing=quiet",
        expect.stringMatching(/^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/[a-z-]+\.js$/),
      ]);
      expect(typeof handler.timeout).toBe("number");
    }
  });

  test("each bundle it names has an entry in src/entries/, and every plugin hook is wired", () => {
    const bundles = new Set(
      wired.map(({ handler }) => (handler.args?.[1] ?? "").replace(/^.*\/dist\/|\.js$/g, "")),
    );
    for (const bundle of bundles) {
      expect(existsSync(join(ROOT, "src", "entries", `${bundle}.ts`))).toBe(true);
    }
    expect([...bundles].sort()).toEqual([...HOOKS.map((spec) => spec.name), ...USER_HOOKS].sort());
  });

  test("no worktree hook: a plugin WorktreeCreate would replace Claude Code's worktrees everywhere", () => {
    expect(Object.keys(hooksJson.hooks).sort()).toEqual([
      "Notification",
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "StopFailure",
      "UserPromptSubmit",
    ]);
  });

  test("each hook is wired for exactly the events it handles", () => {
    for (const spec of HOOKS) {
      const events = wired
        .filter(({ handler }) => handler.args?.[1]?.endsWith(`/dist/${spec.name}.js`))
        .map(({ event }) => event);
      expect([...new Set(events)].sort()).toEqual([...spec.events].sort());
    }
  });

  test("the timeouts: short for a guard", () => {
    const timeout = (bundle: string) =>
      wired.find(({ handler }) => handler.args?.[1]?.endsWith(`/dist/${bundle}.js`))?.handler
        .timeout;
    expect(timeout("git-guard")).toBe(10);
    expect(timeout("main-folder-guard")).toBe(10);
    expect(timeout("message-guard")).toBe(10);
    expect(timeout("agent-guard")).toBe(10);
  });

  test("every git call inside a hook stays well inside that hook's own timeout", () => {
    // The project's own hooks: the worktree engine (`project-wiring.ts`).
    expect(GUARD_GIT_TIMEOUT_MS).toBeLessThan(10_000); // git-guard, main-folder-guard, message-guard
    expect(RESOLVE_GIT_TIMEOUT_MS).toBeLessThan(10_000); // the frame's project lookup, in every hook
    expect(ADD_TIMEOUT_MS).toBeLessThan(600_000); // worktree-create
    expect(SETUP_TIMEOUT_MS).toBeLessThan(600_000); // the setup inside it
    expect(REMOVE_TIMEOUT_MS).toBeLessThan(60_000); // worktree-remove, subagent-stop
  });
});

describe("the entries, run as Claude Code runs them", () => {
  test("the git guard: a PreToolUse ask, exactly; the run is logged with its cwd", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", {});
    const log = join(tempDir("log"), "hooks.log");
    const run = runEntry(
      "git-guard",
      JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "git reset --hard" },
      }),
      { ...hookEnv(), [HOOK_LOG_ENV]: log },
    );
    const answer = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "`git reset --hard` throws away every uncommitted change in this folder, for good. Approve only if you want them gone; a WIP commit keeps the work first.",
      },
    });
    expect(run).toEqual({ exitCode: 0, stdout: answer, stderr: "" });
    // The log line carries the answer, its cwd, and what the guard's parser read (`facts`):
    // `doctor --live` reads that to prove the guard answered, not only that it ran.
    expect(readFileSync(log, "utf8")).toBe(
      `${JSON.stringify({
        hook: "git-guard",
        event: "PreToolUse",
        cwd: repo,
        exitCode: 0,
        stdout: answer,
        facts: { programs: ["git"] },
      })}\n`,
    );
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

  test("no plugin hook exits 1 on a bad input: a bug never stops work", () => {
    expect(HOOKS.filter((spec) => spec.crashExitCode !== undefined)).toEqual([]);
  });
});
