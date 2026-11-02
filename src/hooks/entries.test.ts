/**
 * The plugin's hooks as Claude Code runs them: `plugin/hooks/hooks.json` names each bundle in
 * shell form, through the bun shim `bin/cc-smart-dev-kit-bun.sh`, and each `src/entries/<name>.ts`
 * reads its JSON on stdin and answers on stdout. (`cc-smart-dev-kit hook notify` is the one
 * hook a person's settings wire: `src/cli/hook-commands.test.ts`.)
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
import { CREW_ENV } from "../crew/session";
import { RESOLVE_GIT_TIMEOUT_MS } from "../project/resolve";
import { hookEnv, makeRepo, runEntry, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { GH_TIMEOUT_MS } from "../workflow/merge-check";
import { GUARD_BUDGET_MS, SHORT_GUARD_BUDGET_MS } from "./budget";
import { CREW_ASK_TOOLS, CREW_EDIT_TOOLS } from "./crew-role";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import { HOOK_LOG_ENV } from "./run";
import { ESCAPE_EDIT_TOOLS, ESCAPE_SHELL_TOOLS } from "./session-escape-guard";
import { GUARD_BUNDLES, HOOKS, USER_HOOKS, userAwayHook } from "./specs";
import { AWAY_ASK_TOOLS } from "./user-away";

const ROOT = join(import.meta.dir, "..", "..");

interface Handler {
  type: string;
  command: string;
  args?: string[];
  timeout?: number;
  /** Claude Code's "what happens when the hook fails": `block` or nothing (continue). */
  onFailure?: string;
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

  test("a guard fails closed in Claude Code too: onFailure block on its PreToolUse entry, on nothing else", () => {
    // Claude Code lets a call through when a hook fails to start, times out, exits with
    // another code than 0 or 2, or prints something it cannot read — unless the entry says
    // `"onFailure": "block"` (2.1.295+). The shim's own answers and the frame's `onCrash`
    // cover a guard that runs; this covers one that cannot start at all (the plugin folder is
    // gone, so the shim is gone too). Only a guard's PreToolUse entry blocks: an
    // informational hook that fails must never stop a person's work, and on PostToolUse a
    // block would stop nothing (the call already ran).
    for (const { event, handler } of wired) {
      const guard = event === "PreToolUse" && GUARD_BUNDLES.has(bundleOf(handler));
      expect(handler.onFailure).toBe(guard ? "block" : undefined);
    }
    // And the list is not empty: every guard's PreToolUse entry blocks, and one guard may have
    // more than one (crew-role judges the two tools that ask the person, and the three edits
    // that wait for its task list).
    expect(wired.filter(({ handler }) => handler.onFailure === "block").length).toBe(
      wired.filter(
        ({ event, handler }) => event === "PreToolUse" && GUARD_BUNDLES.has(bundleOf(handler)),
      ).length,
    );
  });

  test("the agent guard's record is wired after the call ran: PostToolUse on the same tools", () => {
    // An asked launch is recorded when it is known to run, and Claude Code runs PostToolUse
    // only for a call that ran (`RAN_EVENT`). The matcher is the guard's own.
    const matcherOf = (event: string) =>
      wired.find(({ event: one, handler }) => one === event && bundleOf(handler) === "agent-guard")
        ?.matcher;
    expect(matcherOf("PostToolUse")).toBe("Agent|Task|Workflow");
    expect(matcherOf("PostToolUse")).toBe(matcherOf("PreToolUse"));
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
    // `WorktreeCreate` and `WorktreeRemove` are never wired: they would replace Claude Code's
    // own worktrees in every project. A `SubagentStop` hook is allowed only when it touches no
    // worktree, so the SubagentStop entries here are checked by name and nothing else:
    // `review-record` (the merge gate's record), `subagent-background` (a subagent's
    // hand-back with its own background work still running) and `agent-usage` (each subagent's
    // cost on record). SubagentStart is `review-record`'s own start (it notes the commit a
    // review agent starts on) and nothing else.
    expect(Object.keys(hooksJson.hooks).sort()).toEqual([
      "Notification",
      "PermissionRequest",
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
    const bundlesFor = (event: string) =>
      wired.filter(({ event: one }) => one === event).map(({ handler }) => bundleOf(handler));
    expect(bundlesFor("Stop")).toEqual([
      "notify",
      "fable-session",
      "crew-role",
      "lead-notes",
      "verify-gate",
    ]);
    expect(bundlesFor("SessionStart")).toContain("task-start");
    expect(bundlesFor("SubagentStart")).toEqual(["review-record"]);
    expect(bundlesFor("SubagentStop")).toEqual([
      "review-record",
      "subagent-background",
      "agent-usage",
    ]);
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

  test("the job-route matcher is exactly the shell tools its judge reads", () => {
    const matcher = wired.find(({ handler }) => bundleOf(handler) === "job-route")?.matcher;
    // Both of Claude Code's shell tools, so a raw `claude --bg` or a polling loop is judged in
    // PowerShell too — a limit a session steps around by changing tools is not a limit.
    expect(matcher).toBe("Bash|PowerShell");
  });

  test("the crew-role matchers are exactly the tools it judges: the two that ask, and the three edits", () => {
    const matchers = wired
      .filter(({ event, handler }) => event === "PreToolUse" && bundleOf(handler) === "crew-role")
      .map(({ matcher }) => matcher);
    expect(matchers).toEqual([CREW_ASK_TOOLS.join("|"), CREW_EDIT_TOOLS.join("|")]);
    // Written by hand too, so a changed list is seen here and not only in the constant.
    expect(matchers).toEqual(["AskUserQuestion|ExitPlanMode", "Edit|Write|NotebookEdit"]);
  });

  test("the user-away hook: the two tools that ask the person on PreToolUse, a permission prompt, and each prompt", () => {
    const entries = wired.filter(({ handler }) => bundleOf(handler) === "user-away");
    // Written by hand, so a changed list is seen here and not only in the constant.
    expect(entries.map(({ event, matcher }) => [event, matcher])).toEqual([
      ["PreToolUse", "AskUserQuestion|ExitPlanMode"],
      ["UserPromptSubmit", null],
      ["PermissionRequest", null],
    ]);
    expect(entries.map(({ event }) => event).sort()).toEqual([...userAwayHook.events].sort());
    expect(AWAY_ASK_TOOLS.join("|")).toBe("AskUserQuestion|ExitPlanMode");
    // Only its PreToolUse entry fails closed; the other two never stop a prompt or a permission.
    expect(entries.map(({ handler }) => handler.onFailure)).toEqual([
      "block",
      undefined,
      undefined,
    ]);
    // `PermissionRequest` is a hook event Claude Code runs before its own permission prompt: the
    // one place a plugin can answer it (`docs/claude-code-contract.md`).
    expect(hooksJson.hooks.PermissionRequest).toHaveLength(1);
  });

  test("the session-escape-guard matcher is exactly the tools it judges: the shell tools and the edit tools", () => {
    const matcher = wired.find(
      ({ handler }) => bundleOf(handler) === "session-escape-guard",
    )?.matcher;
    expect(matcher).toBe([...ESCAPE_SHELL_TOOLS, ...ESCAPE_EDIT_TOOLS].join("|"));
    // It is the guard that no project can switch off, so it is also on every PreToolUse once.
    expect(
      wired.filter(
        ({ event, handler }) =>
          event === "PreToolUse" && bundleOf(handler) === "session-escape-guard",
      ),
    ).toHaveLength(1);
  });

  test("the lead's start note comes at a start, a resume and a compaction — never a clear (D61)", () => {
    // `lead-notes` and the texts that describe it (its header, `specs.ts`, `docs/design/hooks.md`,
    // `docs/design/crew.md`) say these three sources and no other: a `clear` starts a new
    // conversation, and `crew-role` reads it that way. The wiring is the one place that decides.
    const matcher = wired.find(
      ({ event, handler }) => event === "SessionStart" && bundleOf(handler) === "lead-notes",
    )?.matcher;
    expect(matcher).toBe("startup|resume|compact");
  });

  test("the timeouts: short for a guard", () => {
    const timeout = (bundle: string) =>
      wired.find(({ handler }) => bundleOf(handler) === bundle)?.handler.timeout;
    expect(timeout("git-guard")).toBe(10);
    expect(timeout("main-folder-guard")).toBe(10);
    expect(timeout("message-guard")).toBe(10);
    expect(timeout("agent-guard")).toBe(10);
    expect(timeout("session-escape-guard")).toBe(10);
    // The crew session's ask is denied by a guard too, on the two tools that ask the person.
    expect(timeout("crew-role")).toBe(10);
    expect(timeout("job-route")).toBe(10);
  });

  test("a hook's budget is shorter than the hook's own timeout, the room to answer in between", () => {
    const timeoutMs = (bundle: string) =>
      (wired.find(({ handler }) => bundleOf(handler) === bundle)?.handler.timeout ?? 0) * 1000;
    // The merge guard and `after-merge` share `GUARD_BUDGET_MS`; `job-route`'s question about
    // `workflow propose` shares the short one (`budget.ts`).
    expect(GUARD_BUDGET_MS).toBeLessThan(timeoutMs("merge-guard"));
    expect(GUARD_BUDGET_MS).toBeLessThan(timeoutMs("after-merge"));
    expect(SHORT_GUARD_BUDGET_MS).toBeLessThan(timeoutMs("job-route"));
  });

  test("every git call inside a hook stays well inside that hook's own timeout", () => {
    // The merge guard: two `gh` calls of its own timeout, inside the 30 s hooks.json gives it.
    expect(GH_TIMEOUT_MS).toBeLessThan(30_000 / 2);
    expect(GUARD_GIT_TIMEOUT_MS).toBeLessThan(10_000); // git-guard, main-folder-guard, message-guard
    expect(RESOLVE_GIT_TIMEOUT_MS).toBeLessThan(10_000); // the frame's project lookup, in every hook
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

  // What each guard says it cannot check, when it cannot read its input: a guard that cannot
  // judge a call asks (written by hand, one per guard in `GUARD_BUNDLES`).
  const CANNOT_CHECK: Record<string, string> = {
    "agent-guard": "the model this launch runs on",
    "crew-role": "whether this crew session asks the person itself",
    "git-guard": "this git command",
    "job-route": "whether this launch or heavy command may run",
    "main-folder-guard": "whether this edit belongs in a worktree",
    "merge-guard": "whether this merge may happen by itself",
    "message-guard": "whether this message may go to that session",
    "session-escape-guard": "whether this call goes around the limits set for the session",
    "user-away": "whether the person is available",
  };

  test("the list of guards above is the list of guards", () => {
    expect(Object.keys(CANNOT_CHECK).sort()).toEqual([...GUARD_BUNDLES].sort());
  });

  test.each(
    HOOKS.filter((spec) => !GUARD_BUNDLES.has(spec.name)).map(
      (spec) => [spec.name, spec.crashExitCode ?? 0] as const,
    ),
  )("%s: input that is not JSON is one stderr line, exit %j", (name, exitCode) => {
    const run = runEntry(name, "not json", hookEnv());
    expect(run).toEqual({
      exitCode,
      stdout: "",
      stderr: `cc-smart-dev-kit ${name}: the hook input is not JSON\n`,
    });
  });

  // A guard that is silent outside its own sessions (crew-role is silent unless a crew session's
  // environment names it) is proved as a guard where it IS one: the crew env is part of the input.
  const GUARD_ENV: Record<string, Record<string, string>> = {
    "crew-role": { [CREW_ENV]: "W2-x-1a2b3c" },
  };

  test.each([...GUARD_BUNDLES])(
    "%s: input that is not JSON is an ask, never a pass: a guard that cannot read a call does not let it through",
    (name) => {
      const run = runEntry(name, "not json", { ...hookEnv(), ...(GUARD_ENV[name] ?? {}) });
      expect(run).toEqual({
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: `cc-smart-dev-kit cannot check ${CANNOT_CHECK[name]}: the hook input is not JSON`,
          },
        }),
        stderr: "",
      });
    },
  );

  test("no plugin hook exits 1 on a bad input: a bug never stops work", () => {
    expect(HOOKS.filter((spec) => spec.crashExitCode !== undefined)).toEqual([]);
  });
});
