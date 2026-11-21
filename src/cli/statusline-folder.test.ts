/**
 * The status line reads one folder: the session's (`cwd` in the JSON Claude Code pipes in), not the
 * folder the command's own process started in. The usage-warning share and the task rows must
 * agree on it, and the checkout is located once. Each case runs the real entry as its own process
 * (the alerts used to be read in the entry, before stdin), with a fake `git` first on PATH that
 * logs each call and runs the real one.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";

setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

/** A repo whose project file sets the warning share to `percent`. */
function repoWithAlerts(name: string, percent: number): string {
  const repo = makeRepo(name);
  writeClaudeFile(repo, "cc-smart-dev-kit.json", {
    requires: ">=0.4",
    workflow: { alerts: { usagePercent: percent } },
  });
  return repo;
}

/** The input Claude Code pipes in: the 5-hour window at `used` percent, in the folder `cwd`. */
function input(used: number, cwd?: string): string {
  return JSON.stringify({
    model: { display_name: "Opus 5.5", id: "claude-opus-5-5" },
    rate_limits: { five_hour: { used_percentage: used, resets_at: 1_900_000_000 } },
    session_id: "s-1",
    ...(cwd === undefined ? {} : { cwd }),
  });
}

/**
 * Runs `cc-smart-dev-kit statusline` as its own process in `processFolder`, with `stdin`. The git
 * calls land in the returned log, one line each.
 */
function runStatusline(processFolder: string, stdin: string) {
  const home = tempDir("sl-folder-home");
  const fakeBin = join(home, "fake-bin");
  const log = join(home, "git-calls.log");
  mkdirSync(fakeBin);
  const realGit = Bun.which("git");
  if (realGit === null) throw new Error("this test needs git");
  writeFileSync(
    join(fakeBin, "git"),
    `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
  );
  chmodSync(join(fakeBin, "git"), 0o755);
  const guard = subprocessGuard();
  const env = {
    ...hookEnv(),
    // The session's own id: the task rows need a caller.
    CLAUDE_CODE_SESSION_ID: "s-1",
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: fakeBin,
    ...guard.env,
  };
  const result = Bun.spawnSync([process.execPath, ...guard.args, CLI, "statusline"], {
    cwd: processFolder,
    env,
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    gitCalls: existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line !== "")
      : [],
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

describe("the status line reads the session's folder", () => {
  test("the warning share is the session folder's, not the process folder's", () => {
    const strict = repoWithAlerts("strict", 60);
    const lax = repoWithAlerts("lax", 95);
    // 70% of the window: over the strict share, under the lax one.
    const inLax = runStatusline(strict, input(70, lax));
    expect(inLax.exitCode).toBe(0);
    expect(inLax.stdout).toBe("Opus 5.5 · 5h 70%\n");
    const inStrict = runStatusline(lax, input(70, strict));
    expect(inStrict.stdout).toContain("⚠ 5h 70%");
  });

  test("with no input from Claude Code the process folder decides", () => {
    const strict = repoWithAlerts("strict", 60);
    expect(runStatusline(strict, "").stdout).toBe("\n");
    const notJson = runStatusline(strict, "not json");
    expect(notJson.exitCode).toBe(0);
    expect(notJson.stdout).toBe("\n");
    expect(notJson.stderr).toBe("");
  });

  test("an input folder that is not a checkout leaves the person's defaults", () => {
    const strict = repoWithAlerts("strict", 60);
    const outside = tempDir("not-git");
    // 70% is under the built-in 85: no warning, though the process runs in the strict project.
    expect(runStatusline(strict, input(70, outside)).stdout).toBe("Opus 5.5 · 5h 70%\n");
    // A folder that does not exist: the same, and nothing throws.
    const gone = runStatusline(strict, input(70, join(outside, "gone")));
    expect(gone.exitCode).toBe(0);
    expect(gone.stdout).toBe("Opus 5.5 · 5h 70%\n");
  });

  test("the checkout is located once, for the alerts and the task rows together", () => {
    const repo = repoWithAlerts("one", 60);
    const run = runStatusline(repo, input(70, repo));
    expect(run.stdout).toContain("⚠ 5h 70%");
    // One `rev-parse`, and no second lookup.
    expect(run.gitCalls.filter((line) => line.startsWith("rev-parse"))).toHaveLength(1);
    expect(run.gitCalls).toHaveLength(1);
  });

  test("a linked worktree is located once too: its own settings, one worktree list", () => {
    const main = repoWithAlerts("main", 95);
    const worktree = join(tempDir("sl-wt"), "wt");
    git(main, "worktree", "add", "-q", "-b", "feature", worktree);
    // The worktree's own file wins over the main checkout's.
    writeClaudeFile(worktree, "cc-smart-dev-kit.json", {
      requires: ">=0.4",
      workflow: { alerts: { usagePercent: 60 } },
    });
    const run = runStatusline(main, input(70, worktree));
    expect(run.stdout).toContain("⚠ 5h 70%");
    expect(run.gitCalls.filter((line) => line.startsWith("rev-parse"))).toHaveLength(1);
    expect(run.gitCalls.filter((line) => line.startsWith("worktree list"))).toHaveLength(1);
  });
});
