/** The commands the hooks brought: `hook`, `session-name`, and `doctor`'s options. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ID, VERSION } from "../build-info";
import { launcherScript } from "../setup/launcher";
import { USER_NOTIFY_COMMAND, USER_NOTIFY_HOOK_NAME } from "../setup/user-notify-hook";
import { makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, tempDir } from "../testing/temp";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");
const SESSION = "11111111-2222-3333-4444-555555555555";

function cli(args: string[], options: { stdin?: string; cwd?: string } = {}) {
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
  test("no name: the help, exit 0 — the notifier hook's, since the engine's names are retired", () => {
    const run = cli(["hook"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      `Usage: cc-smart-dev-kit hook <notify>

notify is the notifier hook, with the same input and answer as the plugin's own bundle.
cc-smart-dev-kit setup wires it in your user settings for agent view, which runs no plugin hooks
(Claude Code's list of sessions raises agent_needs_input and agent_completed there). It is
not a project hook: it needs no settings from a project, and it works in every folder.
`,
    );
  });

  test("the README and the help name the same hook command", () => {
    // The help names the one hook left, from its constant; the README names it too.
    const readme = readFileSync(join(import.meta.dir, "..", "..", "README.md"), "utf8");
    expect(readme).toContain(`\`cc-smart-dev-kit hook <${USER_NOTIFY_HOOK_NAME}>\``);
    expect(cli(["hook"]).stdout.split("\n")[0]).toBe(
      `Usage: cc-smart-dev-kit hook <${USER_NOTIFY_HOOK_NAME}>`,
    );
  });

  test("an unknown hook: usage, exit 2, nothing read", () => {
    const run = cli(["hook", "git-guard"]);
    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toStartWith("Unknown hook: git-guard\n\nUsage: cc-smart-dev-kit hook <");
  });

  test.each(["worktree-create", "worktree-remove", "subagent-stop"])(
    "D20: %s was retired: the fix on stderr, nothing on stdout, exit 2",
    (name) => {
      const repo = makeRepo();
      expect(
        cli(["hook", name], {
          cwd: repo,
          stdin: JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: repo, name: "fix/x" }),
        }),
      ).toMatchObject({
        exitCode: 2,
        stdout: "",
        stderr: `cc-smart-dev-kit hook ${name}: this hook was retired in 1.0.0: remove its line from your settings — \`cc-smart-dev-kit project init\` does it\n`,
      });
      // Nothing was made: Claude Code's creation fails, and says why.
      expect(existsSync(join(repo, ".claude", "worktrees"))).toBe(false);
    },
  );

  test("D20: the exact line a project still wires: through sh, $HOME and the launcher, the fix, exit 2", () => {
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
    expect(run.exitCode).toBe(2);
  });
});

describe("cc-smart-dev-kit hook notify", () => {
  /**
   * Runs a command detached (`setsid` on POSIX), so the process has no controlling terminal:
   * the notifier's `/dev/tty` route fails, and `CLAUDE_PID` names no process, so it cannot
   * find the session's own device either. The test writes nothing to a real terminal.
   */
  function spawn(
    argv: string[],
    stdin: string,
    env: Record<string, string>,
  ): { exitCode: number; stdout: string; stderr: string } {
    const result = Bun.spawnSync(argv, {
      detached: true,
      env,
      stdin: Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode ?? -1,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  /** A bun script (the entry, the CLI) with the port guard loaded. */
  function detached(
    argv: string[],
    stdin: string,
    env: Record<string, string>,
  ): { exitCode: number; stdout: string; stderr: string } {
    const guard = subprocessGuard();
    return spawn([process.execPath, ...guard.args, ...argv], stdin, { ...env, ...guard.env });
  }

  /** A temp home whose notifier settings say the far end is Warp. */
  function warpHome(): {
    app: string;
    configDir: string;
    env: Record<string, string>;
    home: string;
  } {
    const home = tempDir("notify-hook");
    const configDir = join(home, ".claude");
    mkdirSync(join(configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(join(configDir, "cc-smart-dev-kit", "notify.json"), '{"sshWarp":true}\n');
    const app = join(home, "my-app");
    return {
      app,
      configDir,
      home,
      env: {
        ...cleanGitEnv(),
        CLAUDE_CODE_VERSION: "2.1.301",
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_PID: "999999",
        DISPLAY: "",
        HOME: home,
        PATH: tempDir("notify-empty-path"),
        SSH_CONNECTION: "10.0.0.2 51000",
        TMPDIR: home,
        XDG_RUNTIME_DIR: home,
      },
    };
  }

  test("input that is not JSON: one line, exit 0", () => {
    expect(cli(["hook", "notify"], { stdin: "not json" })).toMatchObject({
      exitCode: 0,
      stdout: "",
      stderr: "cc-smart-dev-kit notify: the hook input is not JSON\n",
    });
  });

  test("agent view's agent_completed over SSH with sshWarp: the same answer as the plugin's bundle", () => {
    const { app, env } = warpHome();
    const input = JSON.stringify({
      cwd: app,
      hook_event_name: "Notification",
      message: "my-app finished",
      notification_type: "agent_completed",
      session_id: "list-1",
    });
    const entry = detached([join(import.meta.dir, "..", "entries", "notify.ts")], input, env);
    const command = detached([CLI, "hook", "notify"], input, env);
    const sequence = `\u001b]777;notify;warp://cli-agent;{"v":1,"agent":"claude","event":"stop","session_id":"list-1","cwd":${JSON.stringify(app)},"project":"my-app","response":"my-app finished"}\u0007`;
    const answer = `{"terminalSequence":${JSON.stringify(sequence)}}`;
    expect(entry).toEqual({ exitCode: 0, stdout: answer, stderr: "" });
    expect(command).toEqual(entry);
  });

  test("the exact user-hook line: through sh, $HOME and the real launcher, with no bun on PATH", () => {
    // The line `setup` writes into ~/.claude/settings.json, run the way Claude Code runs a
    // shell-form hook (hooks.md § Tests does the same for the project's lines).
    expect(USER_NOTIFY_COMMAND).toBe('"$HOME/.local/bin/cc-smart-dev-kit" hook notify');
    const home = tempDir("notify-wired");
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
    mkdirSync(join(configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(join(configDir, "cc-smart-dev-kit", "notify.json"), '{"sshWarp":true}\n');
    const app = join(home, "my-app");
    const result = spawn(
      ["/bin/sh", "-c", USER_NOTIFY_COMMAND],
      JSON.stringify({
        cwd: app,
        hook_event_name: "Notification",
        message: "my-app finished",
        notification_type: "agent_completed",
        session_id: "list-1",
      }),
      {
        ...cleanGitEnv(),
        ...guard.env,
        CLAUDE_CODE_VERSION: "2.1.301",
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_PID: "999999",
        DISPLAY: "",
        HOME: home,
        PATH: "/usr/bin:/bin",
        SSH_CONNECTION: "10.0.0.2 51000",
        TMPDIR: home,
        XDG_RUNTIME_DIR: home,
      },
    );
    const sequence = `\u001b]777;notify;warp://cli-agent;{"v":1,"agent":"claude","event":"stop","session_id":"list-1","cwd":${JSON.stringify(app)},"project":"my-app","response":"my-app finished"}\u0007`;
    expect(result).toEqual({
      exitCode: 0,
      stdout: `{"terminalSequence":${JSON.stringify(sequence)}}`,
      stderr: "",
    });
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
