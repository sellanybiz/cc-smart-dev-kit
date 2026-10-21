/**
 * The plugin's hooks as Claude Code runs them: `plugin/hooks/hooks.json` names each bundle in
 * shell form, through the bun shim `bin/cc-smart-dev-kit-bun.sh`, and each `src/entries/<name>.ts`
 * reads its JSON on stdin and answers on stdout. (The worktree engine a project wires itself
 * runs as `cc-smart-dev-kit hook <name>`: `src/cli/hook-commands.test.ts`.)
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { RESOLVE_GIT_TIMEOUT_MS } from "../project/resolve";
import { hookEnv, makeRepo, runEntry, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import { GH_TIMEOUT_MS } from "./merge-guard";
import { HOOK_LOG_ENV } from "./run";
import { GUARD_BUNDLES, HOOKS, USER_HOOKS } from "./specs";
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

/** Claude Code's placeholder for the plugin's own folder, filled in by Claude Code. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
/** The bun shim's file name: it ends in .sh on purpose (below). */
const SHIM = "cc-smart-dev-kit-bun.sh";

/** The bundle a handler runs, from the path under `dist/` in its command. */
const bundleOf = (handler: Handler): string =>
  (handler.command.match(/\/dist\/([a-z-]+)\.js/) ?? [])[1] ?? "";

/**
 * The shell Claude Code runs a shell-form hook with: `/bin/sh` on macOS and Linux, Git Bash
 * on Windows. Resolved before any test replaces PATH, so bash is found where the machine has it.
 */
const SHELL = process.platform === "win32" ? (Bun.which("bash") ?? "bash") : "/bin/sh";

describe("hooks.json", () => {
  test("every handler is shell form: the quoted .sh shim, the missing-bun mode and one quoted bundle in dist/, with its own timeout", () => {
    // The shim's first argument says what it does when bun is missing: a guard fails closed
    // by asking the person; every other hook is quiet, one line (`GUARD_BUNDLES`).
    for (const { event, handler } of wired) {
      expect(handler.type).toBe("command");
      // Shell form: no `args`, so Claude Code passes the string to a shell — `sh -c` on
      // macOS and Linux, Git Bash on Windows. Exec form cannot work on Windows: it needs a
      // `command` that resolves to a real executable, and an extensionless sh script is not
      // one (`docs/claude-code-contract.md` § Windows). In shell form the shell expands
      // `${CLAUDE_PLUGIN_ROOT}`, which Claude Code exports, so every placeholder is quoted:
      // a plugin folder with a space stays one word.
      expect(handler.args).toBeUndefined();
      const bundle = bundleOf(handler);
      const mode =
        event === "PreToolUse" && GUARD_BUNDLES.has(bundle) ? "--missing=ask" : "--missing=quiet";
      expect(handler.command).toBe(
        `"${PLUGIN_ROOT}/bin/${SHIM}" ${mode} "${PLUGIN_ROOT}/dist/${bundle}.js"`,
      );
      expect(typeof handler.timeout).toBe("number");
    }
  });

  test("the first token is the shim and ends in .sh: Claude Code runs it through bash on Windows", () => {
    // Claude Code rewrites a shell-form command whose first token ends in `.sh` to
    // `bash <command>` on Windows, so the shim needs no execute bit there. The check is on
    // the token with its quotes stripped, so it must be the quoted path, not a bare word.
    const firstToken = (command: string): string => {
      const command0 = command.trim();
      if (command0.startsWith('"')) return command0.slice(1, command0.indexOf('"', 1));
      return command0.split(/\s/)[0] ?? "";
    };
    for (const { handler } of wired) {
      expect(firstToken(handler.command)).toBe(`${PLUGIN_ROOT}/bin/${SHIM}`);
    }
  });

  test("a plugin folder with a space: the command runs the bundle through the shim, whole", () => {
    // What Claude Code does with the placeholders on macOS and Linux: it exports the plugin
    // folder and the shell expands it (`sh -c <command>`). This runs one wired command
    // exactly as an installed plugin does, from a folder whose name has a space, against a
    // fake bun that prints the arguments it got: an unquoted placeholder would split the
    // path into three words.
    const root = join(tempDir("plugin root"), "plugin folder");
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(join(root, "dist"));
    copyFileSync(join(ROOT, "plugin", "bin", SHIM), join(root, "bin", SHIM));
    chmodSync(join(root, "bin", SHIM), 0o755);
    const bin = tempDir("smoke-path");
    // The fake bun answers the shim's `--version` like a bun the plugin accepts, and prints
    // the LAST argument of a real run (the shim puts its own `--no-env-file` and `--config=`
    // flags in front of the bundle) — POSIX sh, so no `${@: -1}`.
    writeFileSync(
      join(bin, "bun"),
      `#!/bin/sh
case $1 in
  --version) echo "1.9.9" ;;
  *) for arg in "$@"; do last=$arg; done; printf "fake-bun <%s>\\n" "$last" ;;
esac
`,
    );
    chmodSync(join(bin, "bun"), 0o755);
    const handler = wired.find(({ handler: h }) => bundleOf(h) === "update-check")?.handler;
    expect(handler).toBeDefined();
    const command = (handler?.command ?? "").replaceAll(PLUGIN_ROOT, root);
    // The bundle the command names: a real file (the fake bun only prints its arguments,
    // so nothing runs it), and what the shim must hand over as ONE argument. Built the way
    // the command builds it — `${CLAUDE_PLUGIN_ROOT}/dist/…` — so on Windows it is the
    // folder's own `\` path, then `/dist/…`: exactly what bun gets there.
    const bundle = `${root}/dist/update-check.js`;
    writeFileSync(bundle, "// the bundle the shim hands to bun\n");
    const run = Bun.spawnSync([SHELL, "-c", command], {
      // The shell, and the fake bun first: the shim is what that shell runs, and the shim
      // finds a bun. `$HOME` holds no launcher, so the PATH is the only place bun can come from.
      env: { HOME: tempDir("smoke-home"), PATH: `${bin}:/usr/bin:/bin` },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.stderr.toString()).toBe("");
    expect(run.stdout.toString()).toBe(`fake-bun <${bundle}>\n`);
  });

  test("each bundle it names has an entry in src/entries/, and every plugin hook is wired", () => {
    const bundles = new Set(wired.map(({ handler }) => bundleOf(handler)));
    for (const bundle of bundles) {
      expect(existsSync(join(ROOT, "src", "entries", `${bundle}.ts`))).toBe(true);
    }
    expect([...bundles].sort()).toEqual([...HOOKS.map((spec) => spec.name), ...USER_HOOKS].sort());
  });

  test("no worktree hook: a plugin WorktreeCreate would replace Claude Code's worktrees everywhere", () => {
    // `SubagentStop` is allowed only for a hook that touches no worktree: the engine's
    // `subagent-stop` (which removes one) must stay the project's own wiring, so every
    // SubagentStop entry here is checked to be `review-record` and nothing else. SubagentStart
    // is the same hook's start (it notes the commit a review agent starts on) and nothing else.
    expect(Object.keys(hooksJson.hooks).sort()).toEqual([
      "Notification",
      "PostModelSwitch",
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);
    for (const subagentEvent of ["SubagentStart", "SubagentStop"]) {
      const bundles = wired
        .filter(({ event }) => event === subagentEvent)
        .map(({ handler }) => bundleOf(handler));
      expect(bundles).toEqual(["review-record"]);
      expect(bundles).not.toContain("subagent-stop");
    }
  });

  test("each hook is wired for exactly the events it handles", () => {
    for (const spec of HOOKS) {
      const events = wired
        .filter(({ handler }) => bundleOf(handler) === spec.name)
        .map(({ event }) => event);
      expect([...new Set(events)].sort()).toEqual([...spec.events].sort());
    }
  });

  test("the main-folder-guard matcher is exactly the tools the guard judges", () => {
    const matcher = wired.find(({ handler }) => bundleOf(handler) === "main-folder-guard")?.matcher;
    // Claude Code matches the tool name against the matcher as a regular expression: the
    // three edit tools that name their file by an absolute path, and nothing else.
    expect(matcher).toBe("Edit|Write|NotebookEdit");
  });

  test("the timeouts: short for a guard", () => {
    const timeout = (bundle: string) =>
      wired.find(({ handler }) => bundleOf(handler) === bundle)?.handler.timeout;
    expect(timeout("git-guard")).toBe(10);
    expect(timeout("main-folder-guard")).toBe(10);
    expect(timeout("message-guard")).toBe(10);
    expect(timeout("agent-guard")).toBe(10);
  });

  test("every git call inside a hook stays well inside that hook's own timeout", () => {
    // The merge guard: two `gh` calls of its own timeout, inside the 30 s hooks.json gives it.
    expect(GH_TIMEOUT_MS).toBeLessThan(30_000 / 2);
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
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {});
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
        stderr: `cc-smart-dev-kit ${name}: the hook input is not JSON\n`,
      });
    },
  );

  test("no plugin hook exits 1 on a bad input: a bug never stops work", () => {
    expect(HOOKS.filter((spec) => spec.crashExitCode !== undefined)).toEqual([]);
  });
});
