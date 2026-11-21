/**
 * The job-route hook (`job-route.ts`): which heavy command goes through the queue, and the
 * exact command line it becomes — plain commands as argv words, everything else through the
 * person's own shell. Plus the two answers: a rewrite (`updatedInput`) and, if a Claude Code
 * ever ignores that, a denial naming the command.
 */
import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { findGitBash, GIT_BASH_INSTALLS } from "../cli/git-bash";
import { cliPaths } from "../cli/paths";
import { classifyHeavyCommand, runWeight, type WeightSource } from "../jobs/classify";
import { HOOK_NAMES } from "../jobs/git-hooks";
import { mergeKinds } from "../jobs/kinds";
import { OWNED_FOLDER_MARK } from "../setup/managed-folder";
import {
  type GitHookWorld,
  gitHookWorld,
  runIn,
  stageFile,
  writeFileIn,
} from "../testing/git-hook-world";
import { hookEnv, makeRepo, runHook, writeClaudeFile } from "../testing/hooks";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { pullRequestMerges } from "./after-merge";
import type { HookResult } from "./io";
import {
  bashLineOf,
  bashToolExists,
  DEFAULT_BASH_MAX_TIMEOUT_MS,
  DEFAULT_BASH_TIMEOUT_MS,
  jobRoute,
  jobRunCommand,
  powerShellDenial,
  REWRITE_TIMEOUT_SUPPORTED,
  rewriteAnswer,
  routeDenial,
  routedShell,
  routedTimeoutMs,
  routeGitHooks,
  routeHeavyCommand,
} from "./job-route";
import type { HookContext } from "./run";
import { jobRouteHook } from "./specs";

const KINDS = mergeKinds(undefined);
const LAUNCHER = '"$HOME/.local/bin/cc-smart-dev-kit"';
/** The person's shell, as the hook finds it; every routed shell line goes through it. */
const SHELL = "/bin/bash";
/** A folder with no `package.json` and no file: nothing is light, no name is a script. */
const SOURCE: WeightSource = { folder: "/repo", isFile: () => false, scriptsIn: () => null };

describe("which commands are routed", () => {
  it("a dependency install is no heavy job: it runs as written (2.0 has no light lane)", () => {
    expect(routeHeavyCommand("bun install --frozen-lockfile", KINDS, SHELL, SOURCE)).toBeNull();
    expect(routeHeavyCommand("npm ci", KINDS, SHELL, SOURCE)).toBeNull();
  });
  it("a heavy command of a default kind is routed; a light one is not", () => {
    expect(routeHeavyCommand("bunx vitest run src/a.test.ts", KINDS, SHELL, SOURCE)).toEqual({
      command: `${LAUNCHER} job run --kind test:run -- bunx vitest run src/a.test.ts`,
      kind: "test:run",
    });
    expect(routeHeavyCommand("bunx tsc --noEmit", KINDS, SHELL, SOURCE)?.kind).toBe("tsc");
    expect(routeHeavyCommand("npx next build", KINDS, SHELL, SOURCE)?.kind).toBe("build");
    expect(routeHeavyCommand("bunx vitest run --coverage", KINDS, SHELL, SOURCE)?.kind).toBe(
      "test:coverage",
    );
    expect(routeHeavyCommand("ls -la", KINDS, SHELL, SOURCE)).toBeNull();
    expect(routeHeavyCommand("git status", KINDS, SHELL, SOURCE)).toBeNull();
    // A print-only run reserves nothing, so it is not heavy.
    expect(routeHeavyCommand("bunx tsc --version", KINDS, SHELL, SOURCE)).toBeNull();
    // A package.json script is matched only by a kind's own `script` rule.
    expect(routeHeavyCommand("bun run build", KINDS, SHELL, SOURCE)).toBeNull();
  });

  it("the project's own kinds are used, over the defaults", () => {
    const kinds = mergeKinds({ build: { gb: 14, match: [{ script: "build" }] } });
    expect(routeHeavyCommand("bun run build", kinds, SHELL, SOURCE)).toEqual({
      command: `${LAUNCHER} job run --kind build -- bun run build`,
      kind: "build",
    });
    expect(routeHeavyCommand("bun run build", KINDS, SHELL, SOURCE)).toBeNull();
  });

  it("what is already queued stays as it is", () => {
    // The classifier's own answer: a line that runs `job run` has no route and no weight.
    for (const line of [
      `${LAUNCHER} job run --kind tsc -- bun run tsc`,
      "cc-smart-dev-kit job run --kind tsc -- bun run tsc",
      "~/.local/bin/cc-smart-dev-kit job run --kind tsc -- bun run tsc",
      `sh -c "${LAUNCHER} job run --kind tsc -- bun run tsc"`,
    ]) {
      expect([line, routeHeavyCommand(line, KINDS, SHELL, SOURCE)]).toEqual([line, null]);
      expect([line, runWeight(line, KINDS, SOURCE)]).toEqual([line, { weight: "none" }]);
    }
    expect(
      routeHeavyCommand(`${LAUNCHER} job run --kind tsc -- bun run tsc`, KINDS, SHELL, SOURCE),
    ).toBeNull();
    // The line the guard is really for: it queues one heavy command AND runs another one the
    // classifier knows. Rewriting it would nest the queue inside the queue, so it stays.
    expect(
      routeHeavyCommand(
        `${LAUNCHER} job run --kind test:run -- bunx vitest run; bunx tsc --noEmit`,
        KINDS,
        SHELL,
        SOURCE,
      ),
    ).toBeNull();
  });

  it("a plain command goes in as its own words; a compound one through the person's shell", () => {
    expect(jobRunCommand("tsc", "bunx tsc --noEmit", SHELL)).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`,
    );
    // A quoted word with a space stays one word: quoted again for the shell.
    expect(jobRunCommand("tsc", 'bunx tsc --project "my dir/tsconfig.json"', SHELL)).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --project 'my dir/tsconfig.json'`,
    );
    // The whole line goes through the shell the person's session runs: never `/bin/sh`,
    // which is dash on Debian and Ubuntu and reads bash syntax differently.
    expect(jobRunCommand("tsc", "bunx tsc --noEmit && echo ok", "/bin/bash")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bunx tsc --noEmit && echo ok'`,
    );
    expect(jobRunCommand("tsc", "[[ -f x ]] && source .env && bunx tsc", "/usr/bin/zsh")).toBe(
      `${LAUNCHER} job run --kind tsc -- /usr/bin/zsh -c '[[ -f x ]] && source .env && bunx tsc'`,
    );
    expect(jobRunCommand("build", "npx next build | tail -5", SHELL)).toContain(
      `/bin/bash -c 'npx next build | tail -5'`,
    );
    expect(jobRunCommand("tsc", "$(which tsc) --noEmit", SHELL)).toContain(
      `/bin/bash -c '$(which tsc) --noEmit'`,
    );
    // A quote inside the command cannot end the quoted string.
    expect(jobRunCommand("build", `npx next build && echo "it's done"`, SHELL)).toBe(
      `${LAUNCHER} job run --kind build -- /bin/bash -c 'npx next build && echo "it'\\''s done"'`,
    );
    // A glob, a leading variable, an assignment, a wrapper or a redirect is not a plain word.
    expect(jobRunCommand("test:run", "bunx vitest run src/*.test.ts", SHELL)).toContain("-c ");
    expect(jobRunCommand("tsc", "VAR=1 bunx tsc", SHELL)).toContain("-c ");
    expect(jobRunCommand("tsc", "time bunx tsc", SHELL)).toContain("-c ");
    expect(jobRunCommand("tsc", "bunx tsc --noEmit > out.txt", SHELL)).toContain("-c ");
  });

  it("the shell is the person's own: $SHELL when it is bash or zsh, else bash, else sh", () => {
    const found = (path: string) => () => path;
    expect(routedShell({ SHELL: "/bin/bash" }, found("/usr/bin/bash"))).toBe("/bin/bash");
    expect(routedShell({ SHELL: "/usr/bin/zsh" }, found("/usr/bin/zsh"))).toBe("/usr/bin/zsh");
    // A login shell that is neither (dash, fish, a Windows shell): bash where it is.
    expect(routedShell({ SHELL: "/bin/dash" }, found("/usr/bin/bash"))).toBe("/usr/bin/bash");
    expect(routedShell({ SHELL: "" }, found("/usr/bin/bash"))).toBe("/usr/bin/bash");
    // No bash anywhere: the smallest shell every machine has.
    expect(routedShell({}, found("/nowhere"))).toBe("/nowhere");
    expect(routedShell({}, () => null)).toBe("sh");
  });

  it("a nested heavy command in a shell string is routed too (the whole line goes)", () => {
    expect(routeHeavyCommand("sh -c 'bunx vitest run'", KINDS, SHELL, SOURCE)?.kind).toBe(
      "test:run",
    );
    expect(routeHeavyCommand('bash -c "npx next build"', KINDS, SHELL, SOURCE)?.kind).toBe("build");
  });

  it("a runner's line stays as written: find, watch, su and parallel do work of their own", () => {
    // The review of the runner follow-up: the reader now knows what they run, and the route must
    // still leave them alone — a rewrite would hide `find -delete` or `su` from the person's
    // own `Bash(find:*)` / `Bash(su:*)` rules, and `watch` would hold a lease for ever.
    for (const command of [
      "watch tsc --noEmit",
      "watch bunx vitest run",
      "find . -delete -exec tsc \\;",
      "su -c 'tsc --noEmit' root",
      "parallel -S host1 tsc ::: a b",
    ]) {
      expect([command, routeHeavyCommand(command, KINDS, SHELL, SOURCE)]).toEqual([command, null]);
    }
  });

  // HK hunch 1, proved live on Claude Code 2.1.308 (`docs/claude-code-contract.md`): a person's
  // own `Bash(rm:*)` deny rule is matched against the rewritten line, which starts with the
  // launcher and holds the person's line as one quoted word, so a routed `echo start && rm -f x`
  // ran the `rm`. So the rewrite never hides a command that is not heavy, a `cd`, an assignment
  // or harmless glue; `jobRoute` refuses such a mixed line instead (§ a mixed line, below).
  it("HK hunch 1: a line with a command that is not heavy, a `cd` or glue is never rewritten", () => {
    const raw = [
      "bunx tsc --noEmit && rm -f marker.txt",
      "rm -f marker.txt && bunx tsc --noEmit",
      // A pipe into a command that is no read-only filter: `xargs` runs what it reads.
      "bunx tsc --noEmit | xargs rm -f",
      "bunx tsc --noEmit; git push --force origin main",
      "bash -c 'bunx tsc --noEmit && git push --force origin main'",
      'sh -c "bunx tsc --noEmit; gh pr merge 5"',
      "bunx tsc --noEmit && $(rm -f marker.txt)",
      "bunx tsc --noEmit && echo `rm -f marker.txt`",
      "bash -c 'rm -f marker.txt'",
      "export FOO=$(rm -f marker.txt) && bunx tsc --noEmit",
    ];
    for (const line of raw) {
      expect([line, routeHeavyCommand(line, KINDS, SHELL, SOURCE)]).toEqual([line, null]);
    }
  });

  it("HK hunch 1: heavy commands, a `cd` and assignments together are still routed", () => {
    const routed: Array<[string, string]> = [
      ["bunx tsc --noEmit && bunx vitest run", "tsc"],
      ["cd app && bunx tsc --noEmit", "tsc"],
      ["FOO=1 bunx tsc --noEmit", "tsc"],
      ["FOO=1 && bunx tsc --noEmit", "tsc"],
      // `export` is harmless glue: it sets the shell up, and cannot be run in another call.
      ["export FOO=1 && bunx tsc --noEmit", "tsc"],
      ["bash -c 'bunx tsc --noEmit && bunx vitest run'", "tsc"],
    ];
    for (const [line, kind] of routed) {
      expect([line, routeHeavyCommand(line, KINDS, SHELL, SOURCE)?.kind]).toEqual([line, kind]);
    }
    const plain = routeHeavyCommand("bash -c 'bunx tsc --noEmit'", KINDS, SHELL, SOURCE);
    // One quoted word with no shell meaning: the argv form, the person's `bash -c` kept.
    expect(plain?.command).toBe(`${LAUNCHER} job run --kind tsc -- bash -c 'bunx tsc --noEmit'`);
  });

  it("HK hunch 1: the merge reader still reads inside a routed line", () => {
    // A hand-built line hides a push and a merge in its shell string: `after-merge` still finds
    // the merge there.
    const hidden = `${LAUNCHER} job run --kind tsc -- ${SHELL} -c 'bunx tsc --noEmit && git push --force origin main && gh pr merge 5'`;
    expect(pullRequestMerges(hidden).map((one) => one.target?.ref)).toEqual(["5"]);
  });
});

describe("the two answers", () => {
  const routed = { command: `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`, kind: "tsc" };

  it("the rewrite: the same tool input, its command replaced, no permission decision", () => {
    const answer = JSON.parse(
      rewriteAnswer({ command: "bunx tsc --noEmit", timeout: 120000 }, routed.command).stdout ??
        "{}",
    ).hookSpecificOutput;
    expect(answer).toEqual({
      hookEventName: "PreToolUse",
      updatedInput: { command: routed.command, timeout: 120000 },
    });
  });

  it("the denial names the exact command to run instead", () => {
    const answer = JSON.parse(routeDenial(routed).stdout ?? "{}").hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain(routed.command);
    expect(answer.permissionDecisionReason).toContain("heavy command (tsc)");
  });
});

// ---------------------------------------------------------------------------------------
// The kit has one guard: the heavy-job queue. job-route judges no launch, and never asks.
// ---------------------------------------------------------------------------------------

describe("job-route answers nothing but the queue", () => {
  const input = (command: string, tool = "Bash"): Record<string, unknown> => ({
    cwd: makeRepo(),
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: tool,
  });

  it.each([
    "claude --bg 'do the phase'",
    "claude -p --model fable --effort max 'do it'",
    "claude -p 'do it'",
    "cc-smart-dev-kit workflow propose autoCommit true",
    "cc-smart-dev-kit herdr start --model opus --effort max --mode manual -- work",
    "hc send t1 hi",
  ])("%s: no answer, whichever the project's settings", async (command) => {
    const result = await runHook(jobRouteHook, input(command), hookEnv());
    expect(result).toEqual({});
    const unattended = await runHook(jobRouteHook, input(command), {
      ...hookEnv(),
      CLAUDE_CODE_SESSION_ATTENDED: "0",
    });
    expect(unattended).toEqual({});
  });

  /** The person's own workflow file, with the route default on or off. */
  const personal = (route: boolean) => {
    const env = hookEnv();
    const file = cliPaths(env).workflowConfigFile;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ switches: { jobRoute: route } })}\n`);
    return env;
  };
  const heavy = "bunx tsc --noEmit";
  const queued = (result: HookResult) =>
    JSON.parse(result.stdout ?? "{}").hookSpecificOutput?.updatedInput?.command ?? null;

  it.each([
    ["too new", { requires: ">=99", future: true }],
    ["broken", { worktree: {} }],
  ])(
    "a project file that is %s: the person's own route default decides, as if it were absent",
    async (_name, file) => {
      const repo = makeRepo();
      writeClaudeFile(repo, "cc-smart-dev-kit.json", file);
      const call = { ...input(heavy), cwd: repo };
      // Their default on: the heavy command is queued, though the project's own file says nothing.
      expect(queued(await runHook(jobRouteHook, call, personal(true)))).toContain(
        "job run --kind tsc -- bunx tsc --noEmit",
      );
      // Their default off (or none): it runs as written.
      expect(await runHook(jobRouteHook, call, personal(false))).toEqual({});
      expect(await runHook(jobRouteHook, call, hookEnv())).toEqual({});
    },
  );

  it("a folder outside git has no project to route for: the line runs as written", async () => {
    const call = { ...input(heavy), cwd: tempDir("not-git") };
    expect(await runHook(jobRouteHook, call, personal(true))).toEqual({});
  });
});

// A heavy command piped into read-only filters: only the heavy part is queued, and the filters
// stay after the queue's command, where the person's own Bash rules still see them.
describe("a heavy command piped into read-only filters", () => {
  const routed = (line: string) => routeHeavyCommand(line, KINDS, SHELL, SOURCE)?.command ?? null;

  it("tail: the redirection stays with the heavy step, the filter after the queue's command", () => {
    expect(routed("bunx tsc --noEmit 2>&1 | tail -20")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bunx tsc --noEmit 2>&1' | tail -20`,
    );
  });

  it("grep: a plain heavy step goes in as its own words", () => {
    expect(routed("bunx vitest run src/a.test.ts | grep FAIL")).toBe(
      `${LAUNCHER} job run --kind test:run -- bunx vitest run src/a.test.ts | grep FAIL`,
    );
  });

  it("wc, after tail: every filter is kept, as written", () => {
    expect(routed("bunx tsc --noEmit | tail -5 | wc -l")).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit | tail -5 | wc -l`,
    );
  });

  it("a cd before the heavy step is queued with it", () => {
    expect(routed("cd app && bunx tsc --noEmit | tail -5")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'cd app && bunx tsc --noEmit' | tail -5`,
    );
  });

  it("tee with a file refused: the line stays raw", () => {
    expect(routed("bunx tsc --noEmit | tee out.txt")).toBeNull();
    expect(routed("bunx tsc --noEmit | tee")).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit | tee`,
    );
  });

  it("sed -i refused: the line stays raw", () => {
    expect(routed("bunx tsc --noEmit | sed -i 's/a/b/' x.ts")).toBeNull();
    expect(routed("bunx tsc --noEmit | sed -n '1,20p'")).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit | sed -n '1,20p'`,
    );
  });

  it("filter before heavy refused: it names a file, and the line stays raw", () => {
    expect(routed("cat tsconfig.json | bunx tsc --noEmit")).toBeNull();
  });

  it("a reader with no file word before the heavy command is glue: the whole line is queued", () => {
    expect(routed("echo x | cat | bunx tsc --noEmit")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'echo x | cat | bunx tsc --noEmit'`,
    );
    // A command that is no reader keeps the line raw.
    expect(routed("xargs rm -f | bunx tsc --noEmit")).toBeNull();
  });

  it("two heavy steps piped: the whole line goes through the person's shell, as before", () => {
    expect(routed("bunx tsc --noEmit | bunx vitest run")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bunx tsc --noEmit | bunx vitest run'`,
    );
  });

  // The rewrite keeps the pipeline the person wrote, so its exit code is the one their shell
  // gives that pipeline: the last filter's, or the heavy command's under `pipefail`. Run for
  // real: a fake launcher that runs what follows `--`, and a fake `tsc` that fails with 2.
  it("the exit code: the same as the line as written, with and without pipefail", () => {
    const bash =
      process.platform === "win32"
        ? findGitBash(process.env, { exists: existsSync, which: (name) => Bun.which(name) }).path
        : Bun.which("bash");
    expect(bash).not.toBeNull();
    const home = tempDir("route-exit");
    const bin = join(home, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "cc-smart-dev-kit"),
      '#!/bin/sh\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n',
    );
    writeFileSync(join(home, "tsc"), '#!/bin/sh\necho "error TS1"\necho "error TS2" >&2\nexit 2\n');
    chmodSync(join(bin, "cc-smart-dev-kit"), 0o755);
    chmodSync(join(home, "tsc"), 0o755);
    const line = "./tsc --noEmit 2>&1 | tail -1";
    const rewritten = routeHeavyCommand(line, KINDS, "bash", SOURCE)?.command ?? "";
    expect(rewritten).toBe(
      `${LAUNCHER} job run --kind tsc -- bash -c './tsc --noEmit 2>&1' | tail -1`,
    );
    const run = (options: string[], command: string) => {
      const done = Bun.spawnSync([bash ?? "bash", ...options, "-c", command], {
        cwd: home,
        env: { ...process.env, HOME: home },
      });
      return { code: done.exitCode, out: done.stdout.toString() };
    };
    // Both streams reach the filter, which prints the last line and ends well.
    expect(run([], line)).toEqual({ code: 0, out: "error TS2\n" });
    expect(run([], rewritten)).toEqual({ code: 0, out: "error TS2\n" });
    // Under pipefail the heavy command's own failure is the line's.
    expect(run(["-o", "pipefail"], line)).toEqual({ code: 2, out: "error TS2\n" });
    expect(run(["-o", "pipefail"], rewritten)).toEqual({ code: 2, out: "error TS2\n" });
  });
});

// A heavy PowerShell line, where the route is on: the queue's rewrite is a Bash line, so the
// line is refused and the reason names the Bash tool and the line to run there.
describe("a heavy PowerShell line", () => {
  it("one plain command becomes the same command as a Bash line", () => {
    expect(bashLineOf("npx tsc --noEmit")).toBe("npx tsc --noEmit");
    expect(bashLineOf('npx vitest run "src\\a b.test.ts"')).toBe(
      "npx vitest run 'src\\a b.test.ts'",
    );
    // Two commands, a pipe, a redirection, a variable or a call operator are not translated.
    expect(bashLineOf("cd app; npx tsc")).toBeNull();
    expect(bashLineOf("npx tsc | Select-Object -Last 5")).toBeNull();
    expect(bashLineOf("npx tsc 2>&1")).toBeNull();
    expect(bashLineOf("npx tsc -p $env:CONFIG")).toBeNull();
    expect(bashLineOf("& npx tsc")).toBeNull();
  });

  it("is refused with the Bash tool and the exact line, which the Bash tool then queues", () => {
    const answer = JSON.parse(powerShellDenial("npx tsc --noEmit", KINDS, SOURCE)?.stdout ?? "{}");
    expect(answer.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "This is a heavy command (tsc), and the job queue takes Bash lines only: run in PowerShell it would not wait for a free slot, and many heavy runs at once have run machines out of memory.\nRun it with the Bash tool instead, where it waits for a slot in the queue:\nnpx tsc --noEmit",
    });
  });

  it("a line it cannot translate is refused too, and told to write it for Bash", () => {
    const answer = JSON.parse(
      powerShellDenial("cd app; npx tsc --noEmit", KINDS, SOURCE)?.stdout ?? "{}",
    );
    expect(answer.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(answer.hookSpecificOutput.permissionDecisionReason).toEndWith(
      "Run it with the Bash tool instead, written for Bash: there a heavy command alone (or after a cd, or piped into a filter such as tail) waits for a slot in the queue.",
    );
  });

  it("a print-only run and a light line are not refused", () => {
    expect(powerShellDenial("npx tsc --version", KINDS, SOURCE)).toBeNull();
    expect(powerShellDenial("Get-ChildItem", KINDS, SOURCE)).toBeNull();
    expect(powerShellDenial("git status", KINDS, SOURCE)).toBeNull();
  });

  it("the Bash tool exists off Windows, and on Windows only where Git Bash is found", () => {
    const none = { exists: () => false, which: () => null };
    expect(bashToolExists({}, "linux", none)).toBe(true);
    expect(bashToolExists({}, "darwin", none)).toBe(true);
    expect(bashToolExists({}, "win32", none)).toBe(false);
    const installed = {
      exists: (path: string) => path === GIT_BASH_INSTALLS[0],
      which: () => null,
    };
    expect(bashToolExists({}, "win32", installed)).toBe(true);
  });

  it("with no Git Bash on Windows the line is left as written", () => {
    const repo = tempDir("ps-route");
    const env = hookEnv();
    const context = {
      cwd: repo,
      env,
      event: "PreToolUse",
      input: {
        hook_event_name: "PreToolUse",
        tool_input: { command: "npx tsc --noEmit" },
        tool_name: "PowerShell",
      },
      nowMs: 0,
      paths: cliPaths(env),
      project: { config: { jobs: { route: true } }, mainCheckout: null, root: repo },
    } as unknown as HookContext;
    expect(jobRoute(context, () => false)).toEqual({});
    const refused = JSON.parse(jobRoute(context, () => true).stdout ?? "{}");
    expect(refused.hookSpecificOutput.permissionDecision).toBe("deny");
  });
});

// ---------------------------------------------------------------------------------------
// The judge in the route (`runWeight`): a light line is answered with nothing, a heavy one is
// routed as before. These run the whole hook against a real folder, so the files and the
// `package.json` scripts the judge reads are real ones.
// ---------------------------------------------------------------------------------------

/** A real folder holding these files (a name with a `/` makes its folders). */
function repoWith(files: Record<string, string>): string {
  const repo = tempDir("route-weight");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), text);
  }
  return repo;
}

/** The hook's context for one line the Bash (or PowerShell) tool is about to run in `repo`. */
function contextFor(
  repo: string,
  command: string,
  tool = "Bash",
  more: { env?: Record<string, string>; fields?: Record<string, unknown> } = {},
): HookContext {
  // hookEnv drops the session's own Bash timeouts (cleanGitEnv): a test sets them itself.
  const env = { ...hookEnv(), SHELL, ...more.env };
  return {
    cwd: repo,
    env,
    event: "PreToolUse",
    input: {
      hook_event_name: "PreToolUse",
      tool_input: { command, ...more.fields },
      tool_name: tool,
    },
    nowMs: Date.now(),
    paths: cliPaths(env),
    project: { config: { jobs: { route: true } }, mainCheckout: null, root: repo },
  } as unknown as HookContext;
}

/** The command the hook rewrites a Bash line to, or null when it answers nothing. */
function rewrittenTo(repo: string, command: string): null | string {
  const result = jobRoute(contextFor(repo, command));
  if (result.stdout === undefined) return null;
  return JSON.parse(result.stdout).hookSpecificOutput.updatedInput.command;
}

/** The decision the hook gives a PowerShell line, or null when it answers nothing. */
function powerShellDecision(repo: string, command: string): null | Record<string, unknown> {
  const result = jobRoute(contextFor(repo, command, "PowerShell"), () => true);
  return result.stdout === undefined ? null : JSON.parse(result.stdout).hookSpecificOutput;
}

const TEST_FILE = { "a.test.ts": "" };

describe("a light line stays raw, a heavy one is routed", () => {
  it("a test run on a file that exists is answered with nothing", () => {
    const repo = repoWith({ "src/a.test.ts": "" });
    expect(rewrittenTo(repo, "bunx vitest run src/a.test.ts")).toBeNull();
    // The same line on a file that is not there is a full run: routed.
    expect(rewrittenTo(repo, "bunx vitest run src/missing.test.ts")).toBe(
      `${LAUNCHER} job run --kind test:run -- bunx vitest run src/missing.test.ts`,
    );
  });

  it("a cd, then a run on a file of that folder: nothing", () => {
    const repo = repoWith({ "app/a.test.ts": "" });
    expect(rewrittenTo(repo, "cd app && bunx vitest run a.test.ts")).toBeNull();
    // The file is read in the folder the cd moves to, not in the one the call started in.
    expect(rewrittenTo(repo, "bunx vitest run a.test.ts")).not.toBeNull();
  });

  it("bun test with no file is routed as a test run; with a file that exists it is not", () => {
    const repo = repoWith(TEST_FILE);
    expect(rewrittenTo(repo, "bun test")).toBe(`${LAUNCHER} job run --kind test:run -- bun test`);
    expect(rewrittenTo(repo, "bun test ./a.test.ts")).toBeNull();
  });

  it("a type check on named files is light; a whole-project one is routed", () => {
    const repo = repoWith({ "src/a.ts": "" });
    expect(rewrittenTo(repo, "bunx tsc --noEmit src/a.ts")).toBeNull();
    expect(rewrittenTo(repo, "bunx tsc --noEmit")).toBe(
      `${LAUNCHER} job run --kind tsc -- bunx tsc --noEmit`,
    );
  });

  it("a package script is read by its body: a lone tsc is routed, and a mixed body is queued whole", () => {
    const repo = repoWith({
      "package.json": JSON.stringify({
        scripts: { typecheck: "tsc --noEmit", check: "tsc --noEmit && biome check ." },
      }),
    });
    expect(rewrittenTo(repo, "bun run typecheck")).toBe(
      `${LAUNCHER} job run --kind tsc -- bun run typecheck`,
    );
    expect(rewrittenTo(repo, "bun run check")).toBe(
      `${LAUNCHER} job run --kind tsc -- bun run check`,
    );
  });

  it("two heavy commands in one line are queued once, as one job", () => {
    const repo = repoWith({});
    const command = rewrittenTo(repo, "bunx tsc --noEmit && bun test") ?? "";
    expect(command).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bunx tsc --noEmit && bun test'`,
    );
    expect(command.match(/job run/g)).toHaveLength(1);
  });

  // `routableLine` knows the kind and says nothing of weight: a run that never ends must not
  // hold a slot while a person uses it (review 3 of the judge).
  it("a watch run or an interactive run is never queued", () => {
    const repo = repoWith({
      "package.json": JSON.stringify({ scripts: { e2e: "playwright test" } }),
    });
    for (const line of [
      "bunx vitest --watch",
      "bunx tsc --noEmit && bunx vitest --watch",
      "bunx playwright test --ui",
      "bunx playwright test --debug",
      "bun run e2e --ui",
      // Bun drops the `--` before it hands the words to the script, so the script sees `--ui`.
      "bun run e2e -- --ui",
      "npm run e2e -- --ui",
    ]) {
      expect([line, rewrittenTo(repo, line)]).toEqual([line, null]);
    }
    // The same script without the flag is a heavy e2e run.
    expect(rewrittenTo(repo, "bun run e2e")).toBe(`${LAUNCHER} job run --kind e2e -- bun run e2e`);
    // npm keeps a flag written before its `--` for itself: the plain script runs, a full run.
    expect(rewrittenTo(repo, "npm run e2e --ui")).toBe(
      `${LAUNCHER} job run --kind e2e -- npm run e2e --ui`,
    );
    const tests = repoWith({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) });
    expect(rewrittenTo(tests, "npm test --watch")).toBe(
      `${LAUNCHER} job run --kind test:run -- npm test --watch`,
    );
  });

  it("a script whose body already queues itself is not queued again", () => {
    const repo = repoWith({
      "package.json": JSON.stringify({
        scripts: { tsc: "cc-smart-dev-kit job run --kind tsc -- tsc --noEmit" },
      }),
    });
    expect(rewrittenTo(repo, "bun run tsc")).toBeNull();
  });

  it("with the route switch off nothing is routed, heavy or light", () => {
    const repo = repoWith({});
    const off = {
      ...contextFor(repo, "bun test"),
      project: { config: { jobs: { route: false } }, mainCheckout: null, root: repo },
    } as unknown as HookContext;
    expect(jobRoute(off)).toEqual({});
  });
});

describe("a PowerShell line: only a heavy run is refused", () => {
  it("a test run on a file that exists is not refused; a full run is, with its Bash line", () => {
    const repo = repoWith(TEST_FILE);
    expect(powerShellDecision(repo, "bun test ./a.test.ts")).toBeNull();
    const refused = powerShellDecision(repo, "bun test");
    expect(refused?.permissionDecision).toBe("deny");
    expect(String(refused?.permissionDecisionReason)).toEndWith(
      "Run it with the Bash tool instead, where it waits for a slot in the queue:\nbun test",
    );
  });

  it("a line that already queues itself is not refused", () => {
    const repo = repoWith({
      "package.json": JSON.stringify({
        scripts: { tsc: "cc-smart-dev-kit job run --kind tsc -- tsc --noEmit" },
      }),
    });
    expect(powerShellDecision(repo, "cc-smart-dev-kit job run --kind tsc -- tsc")).toBeNull();
    expect(powerShellDecision(repo, "bun run tsc")).toBeNull();
  });

  it("a watch run is not refused", () => {
    expect(powerShellDecision(repoWith({}), "bunx vitest --watch")).toBeNull();
  });

  it("a line the Bash translation cannot read stays refused, as before", () => {
    const refused = powerShellDecision(repoWith(TEST_FILE), "cd app; bun test");
    expect(refused?.permissionDecision).toBe("deny");
  });
});

// Claude Code's docs (https://code.claude.com/docs/en/env-vars): BASH_MAX_TIMEOUT_MS is the
// longest timeout the model can set (default 600000), BASH_DEFAULT_TIMEOUT_MS the default one
// (default 120000), and "the effective ceiling is the larger of" the two. A routed call that
// set no timeout gets that ceiling: never a shorter one than the call would have had.
describe("a routed call gets the Bash tool's longest timeout", () => {
  const fields = { command: "bunx tsc --noEmit", description: "check types" };
  const updated = (answer: HookResult) => JSON.parse(answer.stdout ?? "{}").hookSpecificOutput;

  it("the defaults are the docs' ones, and the switch is on", () => {
    expect(DEFAULT_BASH_MAX_TIMEOUT_MS).toBe(600_000);
    expect(DEFAULT_BASH_TIMEOUT_MS).toBe(120_000);
    expect(REWRITE_TIMEOUT_SUPPORTED).toBe(true);
  });

  it("with a ceiling: a call with no timeout gets it; one that set a timeout keeps it", () => {
    expect(updated(rewriteAnswer(fields, "queued", 600_000))).toEqual({
      hookEventName: "PreToolUse",
      updatedInput: { ...fields, command: "queued", timeout: 600_000 },
    });
    expect(
      updated(rewriteAnswer({ ...fields, timeout: 120_000 }, "queued", 600_000)).updatedInput,
    ).toEqual({ ...fields, command: "queued", timeout: 120_000 });
  });

  it("a background call is not given one: it has its own limit", () => {
    const background = { ...fields, run_in_background: true };
    expect(updated(rewriteAnswer(background, "queued", 600_000)).updatedInput).toEqual({
      ...background,
      command: "queued",
    });
    // Only `true` is background.
    expect(
      updated(rewriteAnswer({ ...fields, run_in_background: false }, "queued", 600_000))
        .updatedInput.timeout,
    ).toBe(600_000);
  });

  it("no ceiling (not supported): the answer carries no timeout of its own", () => {
    expect(updated(rewriteAnswer(fields, "queued", null)).updatedInput).toEqual({
      ...fields,
      command: "queued",
    });
    expect(
      updated(rewriteAnswer({ ...fields, timeout: 120_000 }, "queued", null)).updatedInput,
    ).toEqual({ ...fields, command: "queued", timeout: 120_000 });
  });

  it("the ceiling is the larger of the Bash tool's max and default, read from the env", () => {
    expect(routedTimeoutMs({})).toBe(600_000);
    expect(routedTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: "1800000" })).toBe(1_800_000);
    expect(routedTimeoutMs({ BASH_MAX_TIMEOUT_MS: "900000" })).toBe(900_000);
    // A default below the max changes nothing; a max below the default does not shorten it.
    expect(routedTimeoutMs({ BASH_DEFAULT_TIMEOUT_MS: "300000" })).toBe(600_000);
    expect(routedTimeoutMs({ BASH_MAX_TIMEOUT_MS: "60000" })).toBe(120_000);
    // A value that is no positive whole number takes the default.
    for (const garbage of ["", "abc", "-5", "0", "1.5", "10m", "NaN"]) {
      expect(
        routedTimeoutMs({ BASH_MAX_TIMEOUT_MS: garbage, BASH_DEFAULT_TIMEOUT_MS: garbage }),
      ).toBe(600_000);
    }
  });

  it("the hook's own rewrite carries the ceiling of its env when the call set none", () => {
    const repo = repoWith({});
    const timeoutOf = (more: Parameters<typeof contextFor>[3]) =>
      updated(jobRoute(contextFor(repo, "bun test", "Bash", more))).updatedInput.timeout;
    expect(timeoutOf({})).toBe(600_000);
    expect(timeoutOf({ env: { BASH_DEFAULT_TIMEOUT_MS: "1800000" } })).toBe(1_800_000);
    expect(timeoutOf({ env: { BASH_MAX_TIMEOUT_MS: "900000" } })).toBe(900_000);
    expect(timeoutOf({ env: { BASH_MAX_TIMEOUT_MS: "garbage" } })).toBe(600_000);
    expect(timeoutOf({ fields: { timeout: 5000 } })).toBe(5000);
    expect(timeoutOf({ fields: { run_in_background: true } })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------
// A git command whose own hook is heavy gets the kit's hooks-folder prefix (`routeGitHooks`).
// Real git in temp repos, the kit's real folder written in a temp home, a fake launcher.
// ---------------------------------------------------------------------------------------

/**
 * Native Windows gets no prefix yet (docs/windows-jobs.md § Limits): the blocks below prove the
 * POSIX route, with `#!/bin/sh` hooks, file modes and bash, so the Windows job skips them and
 * runs the one test after them, which proves the real platform leaves the line as written.
 */
const NATIVE_WINDOWS = process.platform === "win32";

/** A hook that runs the tests: heavy. */
const HEAVY_HOOK = "#!/bin/sh\nbun test\n";
/** A hook that only checks the style: light. */
const LIGHT_HOOK = "#!/bin/sh\nbunx biome check .\n";

/** A git world, the kit's folder written (unless `installed` is false), with these repo hooks. */
function worldWithHooks(hooks: Record<string, string>, installed = true): GitHookWorld {
  const world = gitHookWorld("route-git");
  if (installed) world.install();
  for (const [name, text] of Object.entries(hooks)) {
    writeFileIn(join(world.repo, ".git", "hooks", name), text, 0o755);
  }
  return world;
}

/** The three assignments in front of a routed git command; `pair` is the number of the pair. */
function prefixOf(world: GitHookWorld, pair = 0): string {
  return `GIT_CONFIG_COUNT=${pair + 1} GIT_CONFIG_KEY_${pair}=core.hooksPath GIT_CONFIG_VALUE_${pair}=${world.paths.gitHooksFolder}`;
}

/** The line the hook rewrites `command` to in the world's repo, or null when it answers nothing. */
function gitRewrite(
  world: GitHookWorld,
  command: string,
  more: Parameters<typeof contextFor>[3] = {},
  platform?: NodeJS.Platform,
): null | string {
  const context = contextFor(world.repo, command, "Bash", {
    ...more,
    env: { HOME: world.home, ...more.env },
  });
  const result = jobRoute(context, () => true, platform);
  return result.stdout === undefined
    ? null
    : JSON.parse(result.stdout).hookSpecificOutput.updatedInput.command;
}

describe.skipIf(NATIVE_WINDOWS)(
  "a git command with a heavy hook gets the hooks-folder prefix",
  () => {
    it("git push with a heavy pre-push: the three assignments, then the line as written", () => {
      const world = worldWithHooks({ "pre-push": HEAVY_HOOK });
      expect(prefixOf(world)).toBe(
        `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=${world.home}/.local/share/cc-smart-dev-kit/git-hooks`,
      );
      expect(gitRewrite(world, "git push origin x")).toBe(`${prefixOf(world)} git push origin x`);
      // The answer carries the Bash tool's longest timeout, as a routed heavy command does.
      const answer = jobRoute(
        contextFor(world.repo, "git push origin x", "Bash", { env: { HOME: world.home } }),
        () => true,
      );
      expect(JSON.parse(answer.stdout ?? "{}").hookSpecificOutput.updatedInput).toEqual({
        command: `${prefixOf(world)} git push origin x`,
        timeout: 600_000,
      });
    });

    it("only the git command of a chain is prefixed; the commands before it are byte-identical", () => {
      const world = worldWithHooks({ "pre-commit": HEAVY_HOOK });
      expect(gitRewrite(world, 'git add -A && git commit -m "x"')).toBe(
        `git add -A && ${prefixOf(world)} git commit -m "x"`,
      );
      expect(gitRewrite(world, "cd .   ;  ls | wc -l\ngit  commit -m x  # note")).toBe(
        `cd .   ;  ls | wc -l\n${prefixOf(world)} git  commit -m x  # note`,
      );
      expect(gitRewrite(world, "FOO=1 git commit -m x")).toBe(
        `${prefixOf(world)} FOO=1 git commit -m x`,
      );
    });

    it("two git commands with heavy hooks in one line are both prefixed, each in its place", () => {
      const world = worldWithHooks({ "pre-commit": HEAVY_HOOK, "pre-push": HEAVY_HOOK });
      expect(gitRewrite(world, "git commit -m x && git push")).toBe(
        `${prefixOf(world)} git commit -m x && ${prefixOf(world)} git push`,
      );
      // The one with a light hook stays as it is.
      const mixed = worldWithHooks({ "pre-commit": LIGHT_HOOK, "pre-push": HEAVY_HOOK });
      expect(gitRewrite(mixed, "git commit -m x && git push")).toBe(
        `git commit -m x && ${prefixOf(mixed)} git push`,
      );
    });

    it("the hook a command runs decides: commit-msg counts for a commit, pre-merge-commit for a merge", () => {
      const world = worldWithHooks({
        "commit-msg": HEAVY_HOOK,
        "pre-merge-commit": HEAVY_HOOK,
        "post-commit": HEAVY_HOOK,
      });
      expect(gitRewrite(world, "git commit -m x")).toBe(`${prefixOf(world)} git commit -m x`);
      expect(gitRewrite(world, "git merge topic")).toBe(`${prefixOf(world)} git merge topic`);
      // A heavy hook of another command, or one this command does not run, changes nothing.
      expect(gitRewrite(world, "git push")).toBeNull();
      const after = worldWithHooks({ "post-commit": HEAVY_HOOK });
      expect(gitRewrite(after, "git commit -m x")).toBeNull();
      expect(gitRewrite(world, "git status")).toBeNull();
    });

    it("a commit message with a here-doc is no obstacle: one prefix, the line otherwise untouched", () => {
      const world = worldWithHooks({ "pre-commit": HEAVY_HOOK });
      const line = "git commit -m \"$(cat <<'EOF'\nfix: x; git push\nEOF\n)\"";
      expect(gitRewrite(world, line)).toBe(`${prefixOf(world)} ${line}`);
    });
  },
);

describe.skipIf(NATIVE_WINDOWS)("a git command that stays as written", () => {
  it("--no-verify and a commit's -n skip the hook: no prefix; a push's -n is --dry-run: prefix", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK, "pre-push": HEAVY_HOOK });
    for (const line of [
      "git push --no-verify",
      "git push origin x --no-verify",
      "git commit --no-verify -m x",
      "git commit -n -m x",
      "git commit -nm x",
      "git commit -anm x",
      "git merge --no-verify topic",
    ]) {
      expect([line, gitRewrite(world, line)]).toEqual([line, null]);
    }
    expect(gitRewrite(world, "git push -n")).toBe(`${prefixOf(world)} git push -n`);
    // `-m n` is a message, not the flag; so is an `n` after the value letter of a group.
    expect(gitRewrite(world, "git commit -m n")).toBe(`${prefixOf(world)} git commit -m n`);
    expect(gitRewrite(world, "git commit -mn")).toBe(`${prefixOf(world)} git commit -mn`);
  });

  it("a light hook, no hook, or a hook the kit cannot route: unchanged", () => {
    const light = worldWithHooks({ "pre-push": LIGHT_HOOK });
    expect(gitRewrite(light, "git push")).toBeNull();
    const none = worldWithHooks({});
    expect(gitRewrite(none, "git push")).toBeNull();
    expect(gitRewrite(none, "git commit -m x")).toBeNull();
  });

  it("the kit's folder missing, or one name in it not executable: unchanged, never a skipped hook", () => {
    const missing = worldWithHooks({ "pre-push": HEAVY_HOOK }, false);
    expect(gitRewrite(missing, "git push")).toBeNull();
    const broken = worldWithHooks({ "pre-push": HEAVY_HOOK });
    expect(gitRewrite(broken, "git push")).toBe(`${prefixOf(broken)} git push`);
    expect(HOOK_NAMES).toContain("post-index-change");
    chmodSync(join(broken.paths.gitHooksFolder, "post-index-change"), 0o644);
    expect(gitRewrite(broken, "git push")).toBeNull();
    // A name that is gone is as bad.
    const gone = worldWithHooks({ "pre-push": HEAVY_HOOK });
    unlinkSync(join(gone.paths.gitHooksFolder, "pre-push"));
    expect(gitRewrite(gone, "git push")).toBeNull();
  });

  it("with the route off, on native Windows, or in PowerShell: unchanged", () => {
    const world = worldWithHooks({ "pre-push": HEAVY_HOOK });
    const off = {
      ...contextFor(world.repo, "git push", "Bash", { env: { HOME: world.home } }),
      project: { config: { jobs: { route: false } }, mainCheckout: null, root: world.repo },
    } as unknown as HookContext;
    expect(jobRoute(off, () => true)).toEqual({});
    expect(gitRewrite(world, "git push", {}, "win32")).toBeNull();
    expect(gitRewrite(world, "git push", {}, "darwin")).toBe(`${prefixOf(world)} git push`);
    const powerShell = contextFor(world.repo, "git push", "PowerShell", {
      env: { HOME: world.home },
    });
    expect(jobRoute(powerShell, () => true)).toEqual({});
  });

  it("a git command the reader cannot place, or that is not plain git: unchanged", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK, "pre-push": HEAVY_HOOK });
    for (const line of [
      "bash -c 'git commit -m x'",
      'sh -c "git push"',
      "echo `git push`",
      "sudo git push",
      "env git push",
      "command git push",
      "if git push; then echo ok; fi",
      "$GIT push",
      'git -C "$dir" push',
      ">/dev/null git push",
      "git --unknown-option push origin",
    ]) {
      expect([line, gitRewrite(world, line)]).toEqual([line, null]);
    }
  });

  it("a line that sets GIT_CONFIG_* itself, or git -c core.hooksPath, is the person's: unchanged", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK });
    for (const line of [
      "GIT_CONFIG_COUNT=0 git commit -m x",
      "GIT_CONFIG_KEY_0=core.hooksPath git commit -m x",
      "export GIT_CONFIG_COUNT=0; git commit -m x",
      "git -c core.hooksPath=/elsewhere commit -m x",
      "git -c core.hookspath=/elsewhere commit -m x",
      "git --config-env=core.hooksPath=HOOKS commit -m x",
    ]) {
      expect([line, gitRewrite(world, line)]).toEqual([line, null]);
    }
    // Another setting of `-c` changes nothing about the hook.
    expect(gitRewrite(world, "git -c user.name=a commit -m x")).toBe(
      `${prefixOf(world)} git -c user.name=a commit -m x`,
    );
  });

  it("a line that continues past an escaped line break is read two ways: unchanged", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK });
    expect(gitRewrite(world, "git commit -m x \\\n  --no-verify")).toBeNull();
  });
});

describe.skipIf(NATIVE_WINDOWS)("which repo's hook decides", () => {
  it("git -C sub decides by sub's own hooks, not the folder the call started in", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK });
    const sub = join(world.repo, "sub");
    mkdirSync(sub);
    git(sub, "init", "-q");
    // The outer repo's hook is heavy, but the command runs in `sub`, which has none.
    expect(gitRewrite(world, "git -C sub commit -m x")).toBeNull();
    writeFileIn(join(sub, ".git", "hooks", "pre-commit"), HEAVY_HOOK, 0o755);
    expect(gitRewrite(world, "git -C sub commit -m x")).toBe(
      `${prefixOf(world)} git -C sub commit -m x`,
    );
    // And the other way round: a light hook in `sub`, the heavy one outside.
    writeFileIn(join(sub, ".git", "hooks", "pre-commit"), LIGHT_HOOK, 0o755);
    expect(gitRewrite(world, "git -C sub commit -m x")).toBeNull();
    expect(gitRewrite(world, "git commit -m x")).toBe(`${prefixOf(world)} git commit -m x`);
  });

  it("a cd before the command moves it to the folder it names; a cd to an unknown folder leaves the line", () => {
    const world = worldWithHooks({});
    const sub = join(world.repo, "sub");
    mkdirSync(sub);
    git(sub, "init", "-q");
    writeFileIn(join(sub, ".git", "hooks", "pre-commit"), HEAVY_HOOK, 0o755);
    expect(gitRewrite(world, "cd sub && git commit -m x")).toBe(
      `cd sub && ${prefixOf(world)} git commit -m x`,
    );
    expect(gitRewrite(world, "git commit -m x")).toBeNull();
    // A `cd` inside ( … ) ends at its `)`.
    expect(gitRewrite(world, "(cd sub); git commit -m x")).toBeNull();
    expect(gitRewrite(world, 'cd "$DIR" && git commit -m x')).toBeNull();
  });

  it("a package folder of a monorepo: git runs the hook at the top, so the root's script decides", () => {
    const world = worldWithHooks({ "pre-commit": "#!/bin/sh\nbun run test\n" });
    writeFileSync(
      join(world.repo, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    const web = join(world.repo, "web");
    mkdirSync(web);
    // The folder the call starts in has a `test` that is light, but the hook never runs there.
    writeFileSync(join(web, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }));
    const line = "git commit -m x";
    const fromWeb = jobRoute(
      contextFor(web, line, "Bash", { env: { HOME: world.home } }),
      () => true,
    );
    expect(JSON.parse(fromWeb.stdout ?? "{}").hookSpecificOutput.updatedInput.command).toBe(
      `${prefixOf(world)} ${line}`,
    );
    expect(gitRewrite(world, line)).toBe(`${prefixOf(world)} ${line}`);
  });

  it("a separate --git-dir: decided in the folder the call is in, and job hook answers direct for the rest", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK });
    // From inside the repo, the prefix is placed (the hook is heavy there). When git runs the
    // hook, `GIT_DIR` is set and `job hook` asks git without it, so a repo it cannot find from the
    // hook's folder answers direct: the hook runs unqueued, which is safe.
    expect(gitRewrite(world, `git --git-dir=${world.repo}/.git commit -m x`)).toBe(
      `${prefixOf(world)} git --git-dir=${world.repo}/.git commit -m x`,
    );
    // From a folder that is no repo, nothing is known about any hook: the line stays.
    const outside = contextFor(
      tempDir("route-git-nowhere"),
      `git --git-dir=${world.repo}/.git commit -m x`,
      "Bash",
      { env: { HOME: world.home } },
    );
    expect(jobRoute(outside, () => true)).toEqual({});
  });
});

describe.skipIf(NATIVE_WINDOWS)("an environment that already holds GIT_CONFIG pairs", () => {
  const pair = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "*",
  };

  it("the kit's pair is added after them: the count grows, nothing is overwritten", () => {
    const world = worldWithHooks({ "pre-push": HEAVY_HOOK });
    expect(gitRewrite(world, "git push", { env: pair })).toBe(`${prefixOf(world, 1)} git push`);
    expect(
      gitRewrite(world, "git push", {
        env: {
          GIT_CONFIG_COUNT: "2",
          GIT_CONFIG_KEY_0: "safe.directory",
          GIT_CONFIG_VALUE_0: "*",
          GIT_CONFIG_KEY_1: "user.name",
          GIT_CONFIG_VALUE_1: "x",
        },
      }),
    ).toBe(`${prefixOf(world, 2)} git push`);
    expect(gitRewrite(world, "git push", { env: { GIT_CONFIG_COUNT: "0" } })).toBe(
      `${prefixOf(world, 0)} git push`,
    );
  });

  it("a pair of the environment that sets core.hooksPath is the person's choice: unchanged", () => {
    const world = worldWithHooks({ "pre-push": HEAVY_HOOK });
    for (const key of ["core.hooksPath", "CORE.HOOKSPATH", "Core.hookspath"]) {
      expect(
        gitRewrite(world, "git push", {
          env: {
            ...pair,
            GIT_CONFIG_COUNT: "2",
            GIT_CONFIG_KEY_1: key,
            GIT_CONFIG_VALUE_1: "/mine",
          },
        }),
      ).toBeNull();
    }
    // A key past the count is not a pair git reads.
    expect(
      gitRewrite(world, "git push", {
        env: { ...pair, GIT_CONFIG_KEY_1: "core.hooksPath", GIT_CONFIG_VALUE_1: "/mine" },
      }),
    ).toBe(`${prefixOf(world, 1)} git push`);
  });

  it("a count that is not a plain whole number: unchanged", () => {
    const world = worldWithHooks({ "pre-push": HEAVY_HOOK });
    for (const count of ["", "abc", "-1", "01", "1.5", " 1", "1e3", "99999999999999999999"]) {
      expect([count, gitRewrite(world, "git push", { env: { GIT_CONFIG_COUNT: count } })]).toEqual([
        count,
        null,
      ]);
    }
  });
});

describe.skipIf(NATIVE_WINDOWS)("a line with a git command is never queued whole", () => {
  it("git is no heavy kind, so a line of heavy commands and git has no route of its own", () => {
    const source: WeightSource = { folder: "/repo", isFile: () => false, scriptsIn: () => null };
    for (const line of [
      "git commit -m x && bun test",
      "bun test && git push",
      "git push; bunx tsc",
    ]) {
      expect([line, routeHeavyCommand(line, KINDS, SHELL, source)]).toEqual([line, null]);
    }
  });

  it("a script that runs no heavy work, a heavy run and git: refused, never the hooks prefix", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK });
    writeFileIn(
      join(world.repo, "package.json"),
      JSON.stringify({ scripts: { lint: "biome check ." } }),
    );
    // The lint script runs raw beside the full test run, which needs its slot: the person splits
    // the script off. The hooks prefix would leave the test run raw, so it must not answer first.
    const line = "bun run lint && bun test && git commit -m x";
    const refused = jobRoute(
      contextFor(world.repo, line, "Bash", { env: { HOME: world.home } }),
      () => true,
    );
    const answer = JSON.parse(refused.stdout ?? "{}").hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain("beside other commands (bun run lint)");
    expect(answer.updatedInput).toBeUndefined();
  });

  it("a full heavy run next to a git command is refused: the prefix would leave it raw", () => {
    const world = worldWithHooks({ "pre-push": HEAVY_HOOK });
    // With the world's HOME the hooks prefix is available: only the order of the two answers
    // keeps this line from getting it (the same context gives `git push` its prefix below).
    const refused = jobRoute(
      contextFor(world.repo, "bun test && git push", "Bash", { env: { HOME: world.home } }),
      () => true,
    );
    expect(JSON.parse(refused.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
    // The git command alone still gets its prefix, and so does one beside a light run, which
    // takes no slot and is no mix.
    expect(gitRewrite(world, "git push")).toBe(`${prefixOf(world)} git push`);
    writeFileSync(join(world.repo, "a.test.ts"), "");
    expect(gitRewrite(world, "bun test ./a.test.ts && git push")).toBe(
      `bun test ./a.test.ts && ${prefixOf(world)} git push`,
    );
    expect(routeGitHooks("git status", contextFor(world.repo, "git status"), KINDS)).toBeNull();
  });
});

describe.skipIf(NATIVE_WINDOWS)("the rewritten line, run by bash with real git", () => {
  it("a heavy pre-commit runs through the launcher: job hook, then job run --hook", () => {
    const world = worldWithHooks({});
    const marker = join(world.repo, "marker");
    const hook = join(world.repo, ".git", "hooks", "pre-commit");
    writeFileIn(hook, `#!/bin/sh\necho ran >> ${marker}\nif false; then bun test; fi\n`, 0o755);
    world.fakeLauncher({ answer: "queue test:run", strict: true });
    stageFile(world.repo);
    const line = gitRewrite(world, 'git commit -q -m "two"');
    expect(line).toBe(`${prefixOf(world)} git commit -q -m "two"`);
    const ran = runIn(world.repo, ["bash", "-c", line ?? "false"], cleanGitEnv());
    expect(ran.code).toBe(0);
    expect(git(world.repo, "log", "--format=%s", "-1")).toBe("two\n");
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(world.calls()).toEqual([
      "job hook pre-commit",
      `job run --hook --kind test:run -- ${hook}`,
    ]);
  });

  it("an inherited pair survives: the hook sees it alone (the kit's own pair is taken out), and git still runs the hook", () => {
    const world = worldWithHooks({});
    const seen = join(world.repo, "seen");
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-commit"),
      `#!/bin/sh\necho "$GIT_CONFIG_COUNT $GIT_CONFIG_KEY_0=$GIT_CONFIG_VALUE_0" > ${seen}\nif false; then bun test; fi\n`,
      0o755,
    );
    world.fakeLauncher({ answer: "queue test:run", strict: true });
    stageFile(world.repo);
    const inherited = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: "*",
    };
    const line = gitRewrite(world, "git commit -q -m two", { env: inherited });
    expect(line).toBe(`${prefixOf(world, 1)} git commit -q -m two`);
    const ran = runIn(world.repo, ["bash", "-c", line ?? "false"], {
      ...cleanGitEnv(),
      ...inherited,
    });
    expect(ran.code).toBe(0);
    expect(readFileSync(seen, "utf8")).toBe("1 safe.directory=*\n");
    expect(world.calls()).toHaveLength(2);
  });

  it("the commit that was left as written runs its hook as git always did: the launcher is never asked", () => {
    const world = worldWithHooks({});
    const marker = join(world.repo, "marker");
    writeFileIn(
      join(world.repo, ".git", "hooks", "pre-commit"),
      `#!/bin/sh\necho ran >> ${marker}\nbunx biome check .\nexit 0\n`,
      0o755,
    );
    world.fakeLauncher({ answer: "queue test:run", strict: true });
    stageFile(world.repo);
    expect(gitRewrite(world, "git commit -q -m two")).toBeNull();
    expect(runIn(world.repo, ["git", "commit", "-q", "-m", "two"], cleanGitEnv()).code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(world.calls()).toEqual([]);
  });
});

describe.skipIf(NATIVE_WINDOWS)("a git command inside another git command's substitution", () => {
  it("each command gets its own prefix, whatever order the reader lists them in", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK, "pre-push": HEAVY_HOOK });
    const p = prefixOf(world);
    expect(gitRewrite(world, 'git commit -m "$(git push -n)"')).toBe(
      `${p} git commit -m "$(${p} git push -n)"`,
    );
    expect(
      gitRewrite(world, "git push -n origin $(git commit -q --allow-empty -m y && echo HEAD)"),
    ).toBe(`${p} git push -n origin $(${p} git commit -q --allow-empty -m y && echo HEAD)`);
  });

  it("run by bash, both hooks reach the launcher", () => {
    const world = worldWithHooks({});
    const origin = tempDir("route-git-origin");
    git(origin, "init", "-q", "--bare");
    git(world.repo, "remote", "add", "origin", origin);
    const hooks = join(world.repo, ".git", "hooks");
    const noop = "#!/bin/sh\nif false; then bun test; fi\n";
    writeFileIn(join(hooks, "pre-commit"), noop, 0o755);
    writeFileIn(join(hooks, "pre-push"), noop, 0o755);
    world.fakeLauncher({ answer: "queue test:run", strict: true });
    const p = prefixOf(world);
    const lines = [
      [
        'git commit -q --allow-empty --allow-empty-message -m "$(git push -n origin HEAD:refs/heads/x 2>/dev/null)"',
        `${p} git commit -q --allow-empty --allow-empty-message -m "$(${p} git push -n origin HEAD:refs/heads/x 2>/dev/null)"`,
      ],
      [
        "git push -q -n origin $(git commit -q --allow-empty -m y && echo HEAD:refs/heads/x)",
        `${p} git push -q -n origin $(${p} git commit -q --allow-empty -m y && echo HEAD:refs/heads/x)`,
      ],
    ] as const;
    for (const [line, expected] of lines) {
      const rewritten = gitRewrite(world, line);
      expect(rewritten).toBe(expected);
      const ran = runIn(world.repo, ["bash", "-c", rewritten ?? "false"], cleanGitEnv());
      expect([line, ran.err, ran.code]).toEqual([line, "", 0]);
      const asked = world.calls().filter((call) => call.startsWith("job hook "));
      expect(asked.toSorted()).toEqual(["job hook pre-commit", "job hook pre-push"]);
      expect(world.calls().filter((call) => call.startsWith("job run "))).toHaveLength(2);
      rmSync(world.log);
    }
  });
});

describe.skipIf(NATIVE_WINDOWS)("a git command in a bash array stays as written", () => {
  it("the list of an array assignment holds words, not commands", () => {
    const world = worldWithHooks({ "pre-commit": HEAVY_HOOK, "pre-push": HEAVY_HOOK });
    for (const line of [
      `cmd=(git commit --allow-empty -m x); "\${cmd[@]}"`,
      "args+=(git push)",
      "local -a cmd=(git push origin main)",
      "declare -a a=(git push)",
      "cmd=(\n  git push\n)",
      "cmd=( git push )",
    ]) {
      expect([line, gitRewrite(world, line)]).toEqual([line, null]);
    }
    // A plain subshell, and a substitution that is assigned, are commands.
    expect(gitRewrite(world, "(git push)")).toBe(`(${prefixOf(world)} git push)`);
    expect(gitRewrite(world, "x=$(git push)")).toBe(`x=$(${prefixOf(world)} git push)`);
  });
});

describe.skipIf(NATIVE_WINDOWS)(
  "only the kit's own folder, as this version writes it, is routed to",
  () => {
    it("a folder without the kit's mark, or with a stale script or a stray file: no prefix", () => {
      const marked = worldWithHooks({ "pre-push": HEAVY_HOOK });
      expect(gitRewrite(marked, "git push")).toBe(`${prefixOf(marked)} git push`);
      rmSync(join(marked.paths.gitHooksFolder, OWNED_FOLDER_MARK));
      expect(gitRewrite(marked, "git push")).toBeNull();

      const stale = worldWithHooks({ "pre-push": HEAVY_HOOK });
      writeFileIn(join(stale.paths.gitHooksFolder, "pre-push"), "#!/bin/sh\nexit 0\n", 0o755);
      expect(gitRewrite(stale, "git push")).toBeNull();

      const stray = worldWithHooks({ "pre-push": HEAVY_HOOK });
      writeFileIn(join(stray.paths.gitHooksFolder, "push-to-checkout"), "#!/bin/sh\n", 0o755);
      expect(gitRewrite(stray, "git push")).toBeNull();
    });
  },
);

describe.skipIf(NATIVE_WINDOWS)("git merge runs commit-msg too", () => {
  it("a merge whose only heavy hook is commit-msg is prefixed", () => {
    const world = worldWithHooks({ "commit-msg": HEAVY_HOOK });
    expect(gitRewrite(world, "git merge topic")).toBe(`${prefixOf(world)} git merge topic`);
    const light = worldWithHooks({ "commit-msg": LIGHT_HOOK, "pre-merge-commit": LIGHT_HOOK });
    expect(gitRewrite(light, "git merge topic")).toBeNull();
  });
});

describe.skipIf(!NATIVE_WINDOWS)("on native Windows, the real platform", () => {
  it("leaves a git command with a heavy hook as written: no prefix yet", () => {
    const world = worldWithHooks({ "pre-push": HEAVY_HOOK, "pre-commit": HEAVY_HOOK });
    expect(gitRewrite(world, "git push")).toBeNull();
    expect(gitRewrite(world, 'git add -A && git commit -m "x"')).toBeNull();
  });
});

describe("the tool reader reads a script file: the route's answers are the same as before", () => {
  // `bash x.sh "…"` runs a script file: it is no heavy command and no routed line, as before
  // the tool reader learned to follow a shell to the file it is given (`src/shell/tool.ts`).
  it("npx tsc --noEmit is routed as a tsc run, exactly", () => {
    expect(routeHeavyCommand("npx tsc --noEmit", KINDS, SHELL, SOURCE)).toEqual({
      command: `${LAUNCHER} job run --kind tsc -- npx tsc --noEmit`,
      kind: "tsc",
    });
  });

  it("a shell given a script file is never routed, whatever its words say", () => {
    for (const line of [
      'bash x.sh "a; git push -f"',
      'bash x.sh "npx tsc --noEmit"',
      "bash -o pipefail x.sh 'bunx vitest run'",
      "source x.sh 'bunx tsc'",
      "node deploy.js 'bunx tsc'",
    ]) {
      expect({ line, routed: routeHeavyCommand(line, KINDS, SHELL, SOURCE) }).toEqual({
        line,
        routed: null,
      });
    }
  });

  it("PowerShell: npx tsc is read as the same tsc run", () => {
    expect(classifyHeavyCommand("npx tsc", KINDS, SOURCE, "powershell")).toBe("tsc");
    expect(runWeight("npx tsc", KINDS, SOURCE)).toEqual({ weight: "heavy", kind: "tsc" });
  });
});

// ---------------------------------------------------------------------------------------
// A mixed Bash line. Glue beside the heavy commands (`echo`, a read-only reader, a `{ … }`
// group) is queued whole; any other command beside heavy work is refused, with the fix.
// ---------------------------------------------------------------------------------------

/** The reason of the deny the hook gives a Bash line, or null when it answers anything else. */
function denialOf(repo: string, command: string): null | string {
  const result = jobRoute(contextFor(repo, command));
  if (result.stdout === undefined) return null;
  const answer = JSON.parse(result.stdout).hookSpecificOutput;
  return answer.permissionDecision === "deny" ? String(answer.permissionDecisionReason) : null;
}

/** The session's own line: a group of runs and a command that is no glue, sent to one file. */
const SESSION_LINE =
  'OUT=/tmp/check.log; { echo "start"; bun run check; claude plugin validate plugin --strict; ( cd portal && bun run test ); echo "end"; } > $OUT 2>&1';

describe("a mixed line: glue rides in the queue", () => {
  const repo = () =>
    repoWith({
      "package.json": JSON.stringify({ scripts: { check: "tsc --noEmit && bun test" } }),
      "portal/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    });

  it("an echo after or before the run: the whole line goes through the person's shell", () => {
    expect(rewrittenTo(repo(), 'bun run check; echo "exit $?"')).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bun run check; echo "exit $?"'`,
    );
    expect(rewrittenTo(repo(), "echo start && bun test")).toBe(
      `${LAUNCHER} job run --kind test:run -- /bin/bash -c 'echo start && bun test'`,
    );
  });

  it("a group sent to a file, a subshell with a cd, a reader of the log", () => {
    expect(rewrittenTo(repo(), "{ echo a; bun test; } > out.log 2>&1")).toBe(
      `${LAUNCHER} job run --kind test:run -- /bin/bash -c '{ echo a; bun test; } > out.log 2>&1'`,
    );
    expect(rewrittenTo(repo(), "( cd portal && bun run test )")).toBe(
      `${LAUNCHER} job run --kind test:run -- /bin/bash -c '( cd portal && bun run test )'`,
    );
    expect(rewrittenTo(repo(), "bun test 2>&1 | tail -5; echo done")).toBe(
      `${LAUNCHER} job run --kind test:run -- /bin/bash -c 'bun test 2>&1 | tail -5; echo done'`,
    );
    expect(rewrittenTo(repo(), "bun test | grep -E fail; echo done")).toBe(
      `${LAUNCHER} job run --kind test:run -- /bin/bash -c 'bun test | grep -E fail; echo done'`,
    );
  });

  it("a reader that names a file is refused: a Read deny rule must see that word", () => {
    for (const line of [
      "bun test; tail -5 out.log",
      "bun test; cat .env",
      "bun test | cat < .env; echo done",
    ]) {
      expect([line, denialOf(repo(), line)?.includes("beside other commands")]).toEqual([
        line,
        true,
      ]);
    }
  });

  it("a trailing tee with no file is still cut off, as before", () => {
    expect(rewrittenTo(repo(), "bun test 2>&1 | tee")).toBe(
      `${LAUNCHER} job run --kind test:run -- /bin/bash -c 'bun test 2>&1' | tee`,
    );
  });
});

describe("a mixed line: heavy work beside anything else is refused", () => {
  const repo = () =>
    repoWith({
      "package.json": JSON.stringify({ scripts: { check: "tsc --noEmit" } }),
      "portal/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    });

  it("the reason names the heavy run, the other command and the fix", () => {
    const reason = denialOf(repo(), "bun test; git status --short") ?? "";
    expect(reason).toContain("heavy work (test:run: bun test)");
    expect(reason).toContain("beside other commands (git status --short)");
    expect(reason).toContain("hiding those commands from your permission rules");
    expect(reason).toContain("would not wait for a free slot");
    expect(reason).toContain("Run the heavy command on its own line");
    expect(reason).toContain("echo or printf around it");
    // The plain-words rule is the readers' alone: `cd "$D"` and `> $OUT` are queued.
    expect(reason).toContain("a pipe into tail, head or grep with plain words");
    expect(reason).not.toContain("all with plain words");
    expect(reason).toContain("in a separate call");
    // To keep an exit code, the one-line form is named.
    expect(reason).toContain('{ cmd; echo "exit $?"; } 2>&1 | tail -20');
  });

  it("the one-line form for an exit code is queued, not refused again (no refusal loop)", () => {
    expect(denialOf(repo(), 'bun test; echo "exit $?"')).toBeNull();
    const line = '{ bun test; echo "exit $?"; } 2>&1 | tail -20';
    expect(denialOf(repo(), line)).toBeNull();
    expect(rewrittenTo(repo(), line)).toContain("job run --kind test:run");
  });

  it("a heavy run in a shell fed by a pipe is named by its kind, not quoted", () => {
    const reason = denialOf(repo(), "printf 'bunx tsc --noEmit\\nrm -rf x' | sh") ?? "";
    expect(reason).toContain("heavy work (tsc) beside other commands (sh)");
    expect(reason).not.toContain("bunx tsc --noEmit");
  });

  it("a heavy run and a command that is not glue, in either order", () => {
    const refused: Array<[string, string]> = [
      ["bun test; git status --short", "git status --short"],
      ["bun run check && claude plugin validate plugin --strict", "claude plugin validate"],
      ["claude plugin validate plugin --strict && bun run check", "claude plugin validate"],
      ["echo $(rm -rf x) && bun test", "rm -rf x"],
      ["bun test | tee out.log; echo done", "tee out.log"],
      ["[ -d node_modules ] || bun install && bun test", "bun install"],
      ["bun test && git commit -m x", "git commit -m x"],
      ["bun test; echo done > status.txt", "echo done > status.txt"],
      ["bash -c 'bun test && rm -f x'", "rm -f x"],
      // Glue that runs code, a read that names a file, a shell fed by a pipe.
      ["bun test; test -v 'a[$(rm -rf x)]'", "test -v"],
      ["bun test; printf -v 'a[$(rm -rf x)]' y", "printf -v"],
      ["bun test; cat .env", "cat .env"],
      ["printf 'bunx tsc --noEmit\\nrm -rf x' | sh", "sh"],
    ];
    for (const [line, other] of refused) {
      expect([line, denialOf(repo(), line)?.includes(`(${other}`) ?? false]).toEqual([line, true]);
    }
  });

  it("the session's own line is refused, at the command that is no glue", () => {
    const reason = denialOf(repo(), SESSION_LINE) ?? "";
    expect(reason).toContain("heavy work (tsc: bun run check)");
    expect(reason).toContain("(claude plugin validate plugin --strict)");
  });

  it("a deny stays a deny: the answer has no rewrite", () => {
    const result = jobRoute(contextFor(repo(), "bun test; git status"));
    const answer = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.updatedInput).toBeUndefined();
  });

  it("a long command is quoted shortened", () => {
    const reason = denialOf(repo(), `bun test; git log --grep=${"x".repeat(400)}`) ?? "";
    expect(reason).toContain("…");
    expect(reason.length).toBeLessThan(900);
  });

  it("the split line the reason suggests is queued, not refused again (no refusal loop)", () => {
    const line = "bun run check; git status --short";
    expect(denialOf(repo(), line)).not.toBeNull();
    expect(rewrittenTo(repo(), "bun run check > log 2>&1")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bun run check > log 2>&1'`,
    );
    expect(rewrittenTo(repo(), "bun run check 2>&1 | tail -20")).toBe(
      `${LAUNCHER} job run --kind tsc -- /bin/bash -c 'bun run check 2>&1' | tail -20`,
    );
    expect(denialOf(repo(), "git status --short")).toBeNull();
  });
});

describe("a mixed line: what is not refused", () => {
  it("a run that takes no slot, beside any command", () => {
    const repo = repoWith(TEST_FILE);
    // A run on a file that exists is light: it starts at once, raw.
    expect(denialOf(repo, "bun test ./a.test.ts; git status")).toBeNull();
    expect(rewrittenTo(repo, "bun test ./a.test.ts; git status")).toBeNull();
    // A watch run never ends, so it must never hold a slot.
    expect(denialOf(repo, "bun test --watch; echo x")).toBeNull();
    expect(denialOf(repo, "bunx vitest --watch && git status")).toBeNull();
  });

  it("a line that already queues itself", () => {
    const repo = repoWith({});
    for (const line of [
      "cc-smart-dev-kit job run --kind test:run -- bun test; echo done",
      "cc-smart-dev-kit job run --kind test:run -- bun test; git status",
    ]) {
      expect([line, jobRoute(contextFor(repo, line))]).toEqual([line, {}]);
    }
  });

  it("no heavy run in the line, and a heavy script whose body holds other commands", () => {
    const repo = repoWith({
      "package.json": JSON.stringify({ scripts: { check: "tsc --noEmit && rm -rf dist" } }),
    });
    expect(jobRoute(contextFor(repo, "git status && ls"))).toEqual({});
    expect(jobRoute(contextFor(repo, "bun install && git status"))).toEqual({});
    // The person's rules see only the call, never the body: the call is queued whole.
    expect(rewrittenTo(repo, "bun run check")).toBe(
      `${LAUNCHER} job run --kind tsc -- bun run check`,
    );
    // Only what the person's own line adds beside the call is refused.
    expect(denialOf(repo, "bun run check && git status")).toContain("beside other commands");
  });

  // The rule's walk stops at a body's first failing command, so a heavy command after it
  // (`biome check . && tsc --noEmit`) is found by the plain walk of the whole body: the call is
  // heavy work, and is queued whole.
  it("a heavy script whose body starts with a command that is not heavy", () => {
    const repo = repoWith({
      "package.json": JSON.stringify({
        scripts: {
          check: "biome check . && tsc --noEmit",
          lint: "biome check .",
          tsc: "SKIP_ENV_VALIDATION=1 next typegen && tsc --noEmit",
          loop: "next typegen && tsc --noEmit && bun run loop",
        },
      }),
    });
    expect(rewrittenTo(repo, "bun run check")).toBe(
      `${LAUNCHER} job run --kind tsc -- bun run check`,
    );
    expect(rewrittenTo(repo, "npm run check")).toBe(
      `${LAUNCHER} job run --kind tsc -- npm run check`,
    );
    expect(rewrittenTo(repo, "bun run tsc")).toBe(`${LAUNCHER} job run --kind tsc -- bun run tsc`);
    expect(denialOf(repo, "bun run check; git status")).toContain("beside other commands");
    expect(denialOf(repo, "bun run tsc && rm x")).toContain("beside other commands");
    // A script that calls itself cannot be read whole: the line runs raw, as it did.
    expect(jobRoute(contextFor(repo, "bun run loop"))).toEqual({});
    // A script call whose body runs no heavy work is still a command of its own.
    expect(denialOf(repo, "bun run lint && bun test")).toContain("beside other commands");
  });

  // A body that never ends holds the one slot for as long as it runs: it stays raw, with a
  // call's own words (`--watch`, `--ui`) read as the runners hand them to the body.
  it("a script body that never ends, or runs in the background, is not queued", () => {
    const repo = repoWith({
      "package.json": JSON.stringify({
        scripts: {
          t: "next typegen && vitest",
          pure: "tsc --noEmit && vitest",
          e2e: "next typegen && playwright test",
          w2: "next typegen && watch tsc --noEmit",
          bg: "next dev & tsc --noEmit",
        },
      }),
    });
    for (const command of [
      "bun run t --watch",
      "bun run t -- --watch",
      "bun run pure --watch",
      "bun run e2e --ui",
      "bun run w2",
      "bun run bg",
    ]) {
      expect([command, jobRoute(contextFor(repo, command))]).toEqual([command, {}]);
    }
    expect(rewrittenTo(repo, "bun run t")).toBe(`${LAUNCHER} job run --kind test:run -- bun run t`);
  });

  it("the route off, and outside git", () => {
    const repo = repoWith({});
    const off = {
      ...contextFor(repo, "bun test; git status"),
      project: { config: { jobs: { route: false } }, mainCheckout: null, root: repo },
    } as unknown as HookContext;
    expect(jobRoute(off)).toEqual({});
  });

  it("a PowerShell line keeps its own refusal, a git-only line keeps the hooks prefix", () => {
    const repo = repoWith(TEST_FILE);
    const refused = powerShellDecision(repo, "bun test; git status");
    expect(String(refused?.permissionDecisionReason)).toContain("the job queue takes Bash lines");
    expect(denialOf(repo, "git status && ls")).toBeNull();
  });
});
