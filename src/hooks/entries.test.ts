/**
 * The plugin's hooks as Claude Code runs them: `plugin/hooks/hooks.json` names each bundle in
 * exec form, through the bun shim `bin/anymodel-bun`, and each `src/entries/<name>.ts` reads
 * its JSON on stdin and answers on stdout. (The worktree engine a project wires itself runs
 * as `anymodel hook <name>`: `src/cli/hook-commands.test.ts`.)
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
  test("every handler is exec form: the bun shim and one bundle in dist/, with its own timeout", () => {
    for (const { handler } of wired) {
      expect(handler.type).toBe("command");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
      expect(handler.command).toBe("${CLAUDE_PLUGIN_ROOT}/bin/anymodel-bun");
      expect(handler.args).toHaveLength(1);
      expect(handler.args?.[0]).toMatch(/^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/[a-z-]+\.js$/);
      expect(typeof handler.timeout).toBe("number");
    }
  });

  test("each bundle it names has an entry in src/entries/, and every plugin hook is wired", () => {
    const bundles = new Set(
      wired.map(({ handler }) => (handler.args?.[0] ?? "").replace(/^.*\/dist\/|\.js$/g, "")),
    );
    for (const bundle of bundles) {
      expect(existsSync(join(ROOT, "src", "entries", `${bundle}.ts`))).toBe(true);
    }
    expect([...bundles].sort()).toEqual(HOOKS.map((spec) => spec.name).sort());
  });

  test("no worktree hook: a plugin WorktreeCreate would replace Claude Code's worktrees everywhere", () => {
    expect(Object.keys(hooksJson.hooks).sort()).toEqual([
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "SessionStart",
      "UserPromptSubmit",
    ]);
  });

  test("each hook is wired for exactly the events it handles", () => {
    for (const spec of HOOKS) {
      const events = wired
        .filter(({ handler }) => handler.args?.[0]?.endsWith(`/dist/${spec.name}.js`))
        .map(({ event }) => event);
      expect([...new Set(events)].sort()).toEqual([...spec.events].sort());
    }
  });

  test("the timeouts: short for a guard", () => {
    const timeout = (bundle: string) =>
      wired.find(({ handler }) => handler.args?.[0]?.endsWith(`/dist/${bundle}.js`))?.handler
        .timeout;
    expect(timeout("git-guard")).toBe(10);
    expect(timeout("main-folder-guard")).toBe(10);
    expect(timeout("message-guard")).toBe(10);
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
    expect(readFileSync(log, "utf8")).toBe(
      `${JSON.stringify({ hook: "git-guard", event: "PreToolUse", cwd: repo, exitCode: 0, stdout: answer })}\n`,
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
