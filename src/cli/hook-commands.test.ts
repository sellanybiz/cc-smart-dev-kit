/** The commands the hooks brought: `hook`, `session-name`, and `doctor`'s options. */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ID, VERSION } from "../build-info";
import { launcherScript } from "../setup/launcher";
import { makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";

// This file starts the CLI as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");
const SESSION = "11111111-2222-3333-4444-555555555555";

function cli(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
) {
  const home = tempDir("cmd-home");
  const guard = subprocessGuard();
  // `process.execPath`: the CLI refuses a Bun older than 1.4.3 (`src/cli/bun-check.ts`),
  // and PATH's bun may be another one.
  const result = Bun.spawnSync([process.execPath, ...guard.args, CLI, ...args], {
    env: {
      ...cleanGitEnv(),
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      TMPDIR: home,
      ...guard.env,
      ...(options.env ?? {}),
    },
    stdout: "pipe",
    stderr: "pipe",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.stdin === undefined ? {} : { stdin: Buffer.from(options.stdin) }),
  });
  return {
    home,
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("cc-smart-dev-kit hook", () => {
  test("no user hooks remain", () => {
    expect(cli(["hook"])).toMatchObject({
      exitCode: 0,
      stdout: "Usage: cc-smart-dev-kit hook\n\nThe plugin has no user-invoked hooks.\n",
    });
    expect(cli(["hook", "notify"], { stdin: "not json" })).toMatchObject({
      exitCode: 2,
      stdout: "",
    });
  });

  /** The stderr line every retired name prints, whatever event Claude Code ran it on. */
  const retiredLine = (name: string) =>
    `cc-smart-dev-kit hook ${name}: this hook was retired in 1.0.0: remove its line from your settings — \`cc-smart-dev-kit project init\` does it\n`;

  /** Runs a retired name with the input of one event, in a new repo. */
  function retired(name: string, event: string, extra: Record<string, unknown>) {
    const repo = makeRepo();
    return {
      repo,
      run: cli(["hook", name], {
        cwd: repo,
        stdin: JSON.stringify({ hook_event_name: event, cwd: repo, ...extra }),
      }),
    };
  }

  // F4: exit 1, never 2. Exit 2 is Claude Code's blocking exit: on `SubagentStop` it blocks
  // the stop, and nothing here reads `stop_hook_active`, so a leftover `subagent-stop` line
  // would loop every subagent for ever. Exit 1 is a non-blocking error on `SubagentStop` and
  // `WorktreeRemove`, and any non-zero exit still fails `WorktreeCreate`
  // (`docs/claude-code-contract.md` § Hooks: the SubagentStop, WorktreeCreate and
  // WorktreeRemove rows).
  test("F4: a retired worktree-create line: exit 1 and the fix on stderr — non-zero still fails the creation", () => {
    const { repo, run } = retired("worktree-create", "WorktreeCreate", { name: "fix/x" });
    expect(run).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: retiredLine("worktree-create"),
    });
    // Nothing was made: Claude Code's creation fails, and says why.
    expect(existsSync(join(repo, ".claude", "worktrees"))).toBe(false);
  });

  test("F4: a retired worktree-remove line: exit 1, a non-blocking error — the session goes on", () => {
    const { run } = retired("worktree-remove", "WorktreeRemove", {
      worktree_path: "/tmp/app-wt-fix",
    });
    expect(run).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: retiredLine("worktree-remove"),
    });
  });

  test("F4: a retired subagent-stop line never blocks a subagent's stop: exit 1 and the fix on stderr", () => {
    const { run } = retired("subagent-stop", "SubagentStop", {
      agent_id: "a1",
      stop_hook_active: false,
    });
    expect(run).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: retiredLine("subagent-stop"),
    });
  });

  test("F4: the exact line a project still wires: through sh, $HOME and the launcher, the fix, exit 1", () => {
    const repo = makeRepo();
    const home = tempDir("wired-home");
    const configDir = join(home, ".claude");
    // The installed plugin: its dist/cli.js runs this repo's CLI, with the port guard.
    const installPath = join(
      configDir,
      "plugins",
      "cache",
      "cc-smart-dev-kit",
      "cc-smart-dev-kit",
      VERSION,
    );
    mkdirSync(join(installPath, "dist"), { recursive: true });
    const guard = subprocessGuard();
    writeFileSync(
      join(installPath, "dist", "cli.js"),
      `await import(${JSON.stringify(guard.args[1])});\nawait import(${JSON.stringify(CLI)});\n`,
    );
    writeFileSync(
      join(configDir, "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { [PLUGIN_ID]: [{ scope: "user", installPath, version: VERSION }] },
      }),
    );
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(
      join(home, ".local", "bin", "cc-smart-dev-kit"),
      launcherScript(process.execPath),
      { mode: 0o755 },
    );
    // The line the old README had a project paste, written out by hand.
    const run = Bun.spawnSync(
      ["/bin/sh", "-c", '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create'],
      {
        cwd: repo,
        env: {
          ...cleanGitEnv(),
          ...guard.env,
          HOME: home,
          CLAUDE_CONFIG_DIR: configDir,
          PATH: "/usr/bin:/bin",
        },
        stdin: Buffer.from(
          JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: repo, name: "fix/wired" }),
        ),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(run.stdout.toString()).toBe("");
    expect(run.stderr.toString()).toBe(
      "cc-smart-dev-kit hook worktree-create: this hook was retired in 1.0.0: remove its line from your settings — `cc-smart-dev-kit project init` does it\n",
    );
    expect(run.exitCode).toBe(1);
  });
});

describe("cc-smart-dev-kit session-name", () => {
  test("records the name the session chose, cleaned", () => {
    const run = cli(["session-name", SESSION, "Fix", "the", "login\tpage"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      'This session will be named "Fix the login page" from the next prompt.\n',
    );
    expect(
      readFileSync(join(run.home, "cc-smart-dev-kit-session-names", `${SESSION}.name`), "utf8"),
    ).toBe("Fix the login page");
  });

  test("no name: usage, exit 2; a bad id: the reason, exit 2", () => {
    const usage = cli(["session-name", SESSION]);
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr).toStartWith("Usage: cc-smart-dev-kit session-name <session id> <name>");
    // A wrong argument is a usage mistake (exit 2), not a failed command (exit 1).
    const bad = cli(["session-name", "../x", "name"]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toBe(
      '"../x" is not a session id\nSee: cc-smart-dev-kit session-name --help\n',
    );
    // A name that is nothing at all is the same.
    const empty = cli(["session-name", SESSION, "   "]);
    expect(empty.exitCode).toBe(2);
    expect(empty.stderr).toStartWith("the name is empty");
  });
});

test("doctor refuses an option it does not know", () => {
  const run = cli(["doctor", "--lively"]);
  expect(run.exitCode).toBe(2);
  expect(run.stderr).toStartWith("Unknown option: --lively");
});

test("doctor checks the project of the folder it runs in, against the plugin's own hooks", () => {
  const repo = makeRepo();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
  writeClaudeFile(repo, "settings.json", {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./g.sh" }] }] },
  });
  const run = cli(["doctor"], { cwd: repo });
  expect(run.exitCode).toBe(1);
  expect(run.stdout).toContain(
    `! project: .claude/worktrees/ is not git-ignored here, so Claude Code's own worktrees show up in git status: add ".claude/worktrees/" to the repo's .gitignore and commit it\n`,
  );
  expect(run.stdout).toContain(
    `! project: the plugin's git-guard and the project's ./g.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of git-guard, list "git-guard" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed\n`,
  );
});
