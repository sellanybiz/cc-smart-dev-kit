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
import { RESOLVE_GIT_TIMEOUT_MS } from "../project/resolve";
import { hookEnv, makeRepo, runEntry, runHook, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { GH_TIMEOUT_MS } from "../workflow/merge-check";
import { GUARD_BUDGET_MS, SHORT_GUARD_BUDGET_MS } from "./budget";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import { HOOK_LOG_ENV } from "./run";
import { GUARD_BUNDLES, HOOKS, sessionNameHook, USER_HOOKS, userAwayHook } from "./specs";
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

/** The guards the kit no longer has (5.7.0): its only guard is the heavy-job queue. */
const REMOVED_GUARDS = [
  "git-guard",
  "merge-guard",
  "deploy-guard",
  "main-folder-guard",
  "agent-guard",
  "session-escape-guard",
] as const;

describe("hooks.json", () => {
  test("wires none of the removed guards: no entry, no spec, no source entry file", () => {
    expect(
      wired
        .map(({ handler }) => bundleOf(handler))
        .filter((name) => REMOVED_GUARDS.includes(name as never)),
    ).toEqual([]);
    expect(
      HOOKS.map((spec) => spec.name).filter((name) => REMOVED_GUARDS.includes(name as never)),
    ).toEqual([]);
    for (const name of REMOVED_GUARDS) {
      expect({ name, entry: existsSync(join(ROOT, "src", "entries", `${name}.ts`)) }).toEqual({
        name,
        entry: false,
      });
    }
  });

  test("registered session-name matcher resets an unnamed context on clear", async () => {
    const registered = wired.find(
      ({ event, handler }) => event === "SessionStart" && bundleOf(handler) === "session-name",
    );
    expect(registered?.matcher).toBe("startup|resume|compact|clear");
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    const env = hookEnv();
    const input = { session_id: "11111111-2222-3333-4444-555555555555", cwd: repo };
    const prompt = { ...input, hook_event_name: "UserPromptSubmit" };
    const first = await runHook(sessionNameHook, prompt, env);
    expect(first.stdout).toContain("This session has no name yet.");
    expect(await runHook(sessionNameHook, prompt, env)).toEqual({});
    if (
      registered?.matcher !== null &&
      registered?.matcher !== undefined &&
      new RegExp(`^(?:${registered.matcher})$`).test("clear")
    ) {
      const result = await runHook(
        sessionNameHook,
        { ...input, hook_event_name: "SessionStart", source: "clear" },
        env,
      );
      expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.additionalContext).toBe(
        `This session has no name yet. Name it once, as soon as its main task is clear: people and other sessions find it by this name in ListAgents and /resume. Run: cc-smart-dev-kit session-name ${input.session_id} "<the task, in a few words>"`,
      );
    }
    expect(await runHook(sessionNameHook, prompt, env)).toEqual(first);
    expect(await runHook(sessionNameHook, prompt, env)).toEqual({});
  });
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
    // And the list is not empty: every guard's PreToolUse entry blocks.
    expect(wired.filter(({ handler }) => handler.onFailure === "block").length).toBe(
      wired.filter(
        ({ event, handler }) => event === "PreToolUse" && GUARD_BUNDLES.has(bundleOf(handler)),
      ).length,
    );
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
    // hand-back with its own background work still running), `builder-finish` (a builder's
    // hand-back with its brief's task still holding open blocking steps) and `agent-usage`
    // (each subagent's cost on record). SubagentStart is `review-record`'s own start (it notes the commit a
    // review agent starts on) and nothing else.
    expect(Object.keys(hooksJson.hooks).sort()).toEqual([
      "PostModelSwitch",
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);
    const bundlesFor = (event: string) =>
      wired.filter(({ event: one }) => one === event).map(({ handler }) => bundleOf(handler));
    expect(bundlesFor("Stop")).toEqual(["fable-session", "verify-gate", "keep-going", "user-away"]);
    expect(bundlesFor("SessionStart")).toContain("task-start");
    expect(bundlesFor("SubagentStart")).toEqual(["review-record"]);
    expect(bundlesFor("SubagentStop")).toEqual([
      "review-record",
      "subagent-background",
      "builder-finish",
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

  test("the job-route matcher is exactly the shell tools its judge reads", () => {
    const matcher = wired.find(({ handler }) => bundleOf(handler) === "job-route")?.matcher;
    // Both of Claude Code's shell tools, so a raw `claude --bg` or a polling loop is judged in
    // PowerShell too — a limit a session steps around by changing tools is not a limit.
    expect(matcher).toBe("Bash|PowerShell");
  });

  test("the user-away hook: the two tools that ask the person on PreToolUse, each prompt and each stop; no permission prompt", () => {
    const entries = wired.filter(({ handler }) => bundleOf(handler) === "user-away");
    // Written by hand, so a changed list is seen here and not only in the constant.
    expect(entries.map(({ event, matcher }) => [event, matcher])).toEqual([
      ["PreToolUse", "AskUserQuestion|ExitPlanMode"],
      ["Stop", null],
      ["UserPromptSubmit", null],
    ]);
    expect(entries.map(({ event }) => event).sort()).toEqual([...userAwayHook.events].sort());
    expect(AWAY_ASK_TOOLS.join("|")).toBe("AskUserQuestion|ExitPlanMode");
    // Only its PreToolUse entry fails closed; the other two never stop a prompt
    // or a turn's end (`onFailure: block` never goes on a Stop entry).
    expect(entries.map(({ handler }) => handler.onFailure)).toEqual([
      "block",
      undefined,
      undefined,
    ]);
    // A hook never approves for the person, and no hook answers Claude Code's own permission
    // prompt either: `PermissionRequest` is not wired at all.
    expect(hooksJson.hooks).not.toHaveProperty("PermissionRequest");
  });

  test("the timeouts: short for a guard", () => {
    const timeout = (bundle: string) =>
      wired.find(({ handler }) => bundleOf(handler) === bundle)?.handler.timeout;
    expect(timeout("job-route")).toBe(10);
  });

  test("a hook's budget is shorter than the hook's own timeout, the room to answer in between", () => {
    const timeoutMs = (bundle: string) =>
      (wired.find(({ handler }) => bundleOf(handler) === bundle)?.handler.timeout ?? 0) * 1000;
    // `after-merge` runs on `GUARD_BUDGET_MS`; `job-route`'s question about `workflow propose`
    // shares the short one (`budget.ts`).
    expect(GUARD_BUDGET_MS).toBeLessThan(timeoutMs("after-merge"));
    expect(SHORT_GUARD_BUDGET_MS).toBeLessThan(timeoutMs("job-route"));
  });

  test("every git call inside a hook stays well inside that hook's own timeout", () => {
    // `after-merge`: two `gh` calls of its own timeout, inside the 30 s hooks.json gives it.
    expect(GH_TIMEOUT_MS).toBeLessThan(30_000 / 2);
    expect(GUARD_GIT_TIMEOUT_MS).toBeLessThan(10_000); // job-route
    expect(RESOLVE_GIT_TIMEOUT_MS).toBeLessThan(10_000); // the frame's project lookup, in every hook
  });
});

describe("the entries, run as Claude Code runs them", () => {
  test("job-route: a heavy command is queued, a raw background session is left alone; the run is logged with its weight", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { jobs: { route: true } });
    const log = join(tempDir("log"), "hooks.log");
    const env = { ...hookEnv(), [HOOK_LOG_ENV]: log };
    const call = (command: string) =>
      runEntry(
        "job-route",
        JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd: repo,
          tool_name: "Bash",
          tool_input: { command },
        }),
        env,
      );
    const queued = call("bunx tsc --noEmit");
    expect(queued.exitCode).toBe(0);
    const answer = JSON.parse(queued.stdout).hookSpecificOutput;
    expect(answer.updatedInput.command).toContain("job run --kind tsc -- bunx tsc --noEmit");
    // Nothing else is judged: a raw background session gets no answer at all.
    expect(call("claude --bg")).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    // The log line carries the answer, its cwd, and what the hook read (`facts`): `doctor --live`
    // reads that to prove the hook read the line, not only that it ran.
    const logged = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(logged[0]).toMatchObject({
      hook: "job-route",
      event: "PreToolUse",
      cwd: repo,
      exitCode: 0,
    });
    expect(logged[0].facts.weight).toBe("heavy");
  });

  // What each guard says it cannot check, when it cannot read its input: a guard that cannot
  // judge a call asks (written by hand, one per guard in `GUARD_BUNDLES`).
  const CANNOT_CHECK: Record<string, string> = {
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

  test.each([...GUARD_BUNDLES])(
    "%s: input that is not JSON is an ask, never a pass: a guard that cannot read a call does not let it through",
    (name) => {
      const run = runEntry(name, "not json", hookEnv());
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
