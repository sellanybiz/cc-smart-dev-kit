/**
 * The job-route hook (`job-route.ts`): which heavy command goes through the queue, and the
 * exact command line it becomes — plain commands as argv words, everything else through the
 * person's own shell. Plus the two answers: a rewrite (`updatedInput`) and, if a Claude Code
 * ever ignores that, a denial naming the command.
 */
import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findGitBash, GIT_BASH_INSTALLS, GIT_BASH_VAR } from "../cli/git-bash";
import { cliPaths } from "../cli/paths";
import { mergeKinds } from "../jobs/kinds";
import { hookEnv } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { pullRequestMerges } from "./after-merge";
import { guardQuestions } from "./git-guard";
import type { HookInput, HookResult } from "./io";
import {
  bashLineOf,
  bashToolExists,
  jobRoute,
  jobRouteConfigAnswer,
  jobRunCommand,
  judgeCommandAnswer,
  powerShellDenial,
  rewriteAnswer,
  routeDenial,
  routedShell,
  routeHeavyCommand,
  runsJobRun,
} from "./job-route";
import type { HookContext, HookEnvContext } from "./run";

const KINDS = mergeKinds(undefined);
const LAUNCHER = '"$HOME/.local/bin/cc-smart-dev-kit"';
/** The person's shell, as the hook finds it; every routed shell line goes through it. */
const SHELL = "/bin/bash";

describe("which commands are routed", () => {
  it("a dependency install is no heavy job: it runs as written (2.0 has no light lane)", () => {
    expect(routeHeavyCommand("bun install --frozen-lockfile", KINDS, SHELL)).toBeNull();
    expect(routeHeavyCommand("npm ci", KINDS, SHELL)).toBeNull();
  });
  it("a heavy command of a default kind is routed; a light one is not", () => {
    expect(routeHeavyCommand("bunx vitest run src/a.test.ts", KINDS, SHELL)).toEqual({
      command: `${LAUNCHER} job run --kind test:run -- bunx vitest run src/a.test.ts`,
      kind: "test:run",
    });
    expect(routeHeavyCommand("bunx tsc --noEmit", KINDS, SHELL)?.kind).toBe("tsc");
    expect(routeHeavyCommand("npx next build", KINDS, SHELL)?.kind).toBe("build");
    expect(routeHeavyCommand("bunx vitest run --coverage", KINDS, SHELL)?.kind).toBe(
      "test:coverage",
    );
    expect(routeHeavyCommand("ls -la", KINDS, SHELL)).toBeNull();
    expect(routeHeavyCommand("git status", KINDS, SHELL)).toBeNull();
    // A print-only run reserves nothing, so it is not heavy.
    expect(routeHeavyCommand("bunx tsc --version", KINDS, SHELL)).toBeNull();
    // A package.json script is matched only by a kind's own `script` rule.
    expect(routeHeavyCommand("bun run build", KINDS, SHELL)).toBeNull();
  });

  it("the project's own kinds are used, over the defaults", () => {
    const kinds = mergeKinds({ build: { gb: 14, match: [{ script: "build" }] } });
    expect(routeHeavyCommand("bun run build", kinds, SHELL)).toEqual({
      command: `${LAUNCHER} job run --kind build -- bun run build`,
      kind: "build",
    });
    expect(routeHeavyCommand("bun run build", KINDS, SHELL)).toBeNull();
  });

  it("what is already queued stays as it is", () => {
    expect(runsJobRun(`${LAUNCHER} job run --kind tsc -- bun run tsc`)).toBe(true);
    expect(runsJobRun("cc-smart-dev-kit job run --kind tsc -- bun run tsc")).toBe(true);
    expect(runsJobRun("~/.local/bin/cc-smart-dev-kit job run --kind tsc -- bun run tsc")).toBe(
      true,
    );
    expect(runsJobRun(`sh -c "${LAUNCHER} job run --kind tsc -- bun run tsc"`)).toBe(true);
    expect(runsJobRun("cc-smart-dev-kit job status")).toBe(false);
    expect(runsJobRun("bun run tsc")).toBe(false);
    expect(
      routeHeavyCommand(`${LAUNCHER} job run --kind tsc -- bun run tsc`, KINDS, SHELL),
    ).toBeNull();
    // The line the guard is really for: it queues one heavy command AND runs another one the
    // classifier knows. Rewriting it would nest the queue inside the queue, so it stays.
    expect(
      routeHeavyCommand(
        `${LAUNCHER} job run --kind test:run -- bunx vitest run; bunx tsc --noEmit`,
        KINDS,
        SHELL,
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
    expect(routeHeavyCommand("sh -c 'bunx vitest run'", KINDS, SHELL)?.kind).toBe("test:run");
    expect(routeHeavyCommand('bash -c "npx next build"', KINDS, SHELL)?.kind).toBe("build");
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
      expect([command, routeHeavyCommand(command, KINDS, SHELL)]).toEqual([command, null]);
    }
  });

  // HK hunch 1, proved live on Claude Code 2.1.308 (`docs/claude-code-contract.md`): a person's
  // own `Bash(rm:*)` deny rule is matched against the rewritten line, which starts with the
  // launcher and holds the person's line as one quoted word, so a routed `echo start && rm -f x`
  // ran the `rm`. So a line is routed only when every command in it is heavy, a `cd` or an
  // assignment; any other line stays raw, as the person's rules see it.
  it("HK hunch 1: a line with a command that is not heavy, a `cd` or an assignment stays raw", () => {
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
      "export FOO=1 && bunx tsc --noEmit",
    ];
    for (const line of raw) {
      expect([line, routeHeavyCommand(line, KINDS, SHELL)]).toEqual([line, null]);
    }
  });

  it("HK hunch 1: heavy commands, a `cd` and assignments together are still routed", () => {
    const routed: Array<[string, string]> = [
      ["bunx tsc --noEmit && bunx vitest run", "tsc"],
      ["cd app && bunx tsc --noEmit", "tsc"],
      ["FOO=1 bunx tsc --noEmit", "tsc"],
      ["FOO=1 && bunx tsc --noEmit", "tsc"],
      ["bash -c 'bunx tsc --noEmit && bunx vitest run'", "tsc"],
    ];
    for (const [line, kind] of routed) {
      expect([line, routeHeavyCommand(line, KINDS, SHELL)?.kind]).toEqual([line, kind]);
    }
    const plain = routeHeavyCommand("bash -c 'bunx tsc --noEmit'", KINDS, SHELL);
    // One quoted word with no shell meaning: the argv form, the person's `bash -c` kept.
    expect(plain?.command).toBe(`${LAUNCHER} job run --kind tsc -- bash -c 'bunx tsc --noEmit'`);
  });

  it("HK hunch 1: the kit's own guards still read inside a routed line", () => {
    const routed = routeHeavyCommand("cd app && bunx tsc --noEmit", KINDS, SHELL);
    const options = {
      protectedBranches: ["main"],
      autoPushAsk: () => null,
      sharedStash: false,
      env: {},
    };
    expect(guardQuestions(routed?.command ?? "", "/nowhere", options)).toEqual([]);
    // What a guard asks about is asked inside a routed line as well: a hand-built line that
    // hides a push and a merge in its shell string.
    const hidden = `${LAUNCHER} job run --kind tsc -- ${SHELL} -c 'bunx tsc --noEmit && git push --force origin main && gh pr merge 5'`;
    expect(guardQuestions(hidden, "/nowhere", options).length).toBe(2);
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
// The judge outside the project, and a heavy command beside a broken or too new project
// file: the person is asked.
// ---------------------------------------------------------------------------------------

describe("the judge alone, and a project file that cannot be read", () => {
  const input = (command: string, tool = "Bash"): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: tool,
  });
  const context = (env: Record<string, string>): HookEnvContext => ({
    env,
    nowMs: 0,
    paths: cliPaths(env),
  });
  const decisionOf = (result: HookResult | null) =>
    JSON.parse(result?.stdout ?? "{}").hookSpecificOutput;

  it("a `claude -p` launch the policy questions: the person is asked", () => {
    const command = "claude -p --model opus --effort max 'do it'";
    const person = decisionOf(judgeCommandAnswer(input(command), context(hookEnv())));
    expect(person.permissionDecision).toBe("ask");
  });

  it("a heavy command beside a broken or too new project file: the person is asked", () => {
    const env = hookEnv();
    const command = "bunx vitest run src/a.test.ts";
    const why =
      "cc-smart-dev-kit cannot check whether this project routes heavy commands through its job queue: the file needs a newer plugin";
    expect(
      jobRouteConfigAnswer("the file needs a newer plugin", input(command), context(env)),
    ).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: why,
        },
      }),
    });
  });

  it("a light command: silence", () => {
    const env = hookEnv();
    expect(jobRouteConfigAnswer("broken", input("git status"), context(env))).toEqual({});
    expect(jobRouteConfigAnswer("broken", input("git status", "PowerShell"), context(env))).toEqual(
      {},
    );
  });

  it("a PowerShell heavy command: asked about like a Bash one, since the route may refuse it", () => {
    // A Git Bash the lookup finds on any machine (off Windows the Bash tool is always there).
    const bash = join(tempDir("git-bash"), "bash.exe");
    writeFileSync(bash, "");
    const env = { ...hookEnv(), [GIT_BASH_VAR]: bash };
    const answer = decisionOf(
      jobRouteConfigAnswer(
        "broken",
        input("bunx vitest run src/a.test.ts", "PowerShell"),
        context(env),
      ),
    );
    expect(answer.permissionDecision).toBe("ask");
    expect(answer.permissionDecisionReason).toBe(
      "cc-smart-dev-kit cannot check whether this project routes heavy commands through its job queue: broken",
    );
  });
});

// A heavy command piped into read-only filters: only the heavy part is queued, and the filters
// stay after the queue's command, where the person's own Bash rules still see them.
describe("a heavy command piped into read-only filters", () => {
  const routed = (line: string) => routeHeavyCommand(line, KINDS, SHELL)?.command ?? null;

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

  it("filter before heavy refused: the line stays raw", () => {
    expect(routed("cat tsconfig.json | bunx tsc --noEmit")).toBeNull();
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
    const rewritten = routeHeavyCommand(line, KINDS, "bash")?.command ?? "";
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
    const answer = JSON.parse(powerShellDenial("npx tsc --noEmit", KINDS)?.stdout ?? "{}");
    expect(answer.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "This is a heavy command (tsc), and the job queue takes Bash lines only: run in PowerShell it would not wait for a free slot, and many heavy runs at once have run machines out of memory.\nRun it with the Bash tool instead, where it waits for a slot in the queue:\nnpx tsc --noEmit",
    });
  });

  it("a line it cannot translate is refused too, and told to write it for Bash", () => {
    const answer = JSON.parse(powerShellDenial("cd app; npx tsc --noEmit", KINDS)?.stdout ?? "{}");
    expect(answer.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(answer.hookSpecificOutput.permissionDecisionReason).toEndWith(
      "Run it with the Bash tool instead, written for Bash: there a heavy command alone (or after a cd, or piped into a filter such as tail) waits for a slot in the queue.",
    );
  });

  it("a print-only run and a light line are not refused", () => {
    expect(powerShellDenial("npx tsc --version", KINDS)).toBeNull();
    expect(powerShellDenial("Get-ChildItem", KINDS)).toBeNull();
    expect(powerShellDenial("git status", KINDS)).toBeNull();
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
