/** The commands the hooks brought: `hook`, `session-name`, and `doctor`'s options. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PLUGIN_ID, VERSION } from "../build-info";
import { projectHookCommand } from "../hooks/project-wiring";
import { launcherScript } from "../setup/launcher";
import { makeClone, makeRepo, writeClaudeFile } from "../testing/hooks";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, git, tempDir } from "../testing/temp";

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

/** The lines a project pastes, written out by hand: what the README shows. */
const SETTINGS = `{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\\"$HOME/.local/bin/cc-smart-dev-kit\\" hook worktree-create",
            "timeout": 600
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\\"$HOME/.local/bin/cc-smart-dev-kit\\" hook worktree-remove",
            "timeout": 60
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\\"$HOME/.local/bin/cc-smart-dev-kit\\" hook subagent-stop",
            "timeout": 60
          }
        ]
      }
    ]
  }
}`;

/** A clone with the worktree engine turned on. */
function engineClone(): string {
  const { repo } = makeClone();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", {
    worktrees: { base: "main", prefix: "app-wt-" },
  });
  return repo;
}

describe("cc-smart-dev-kit hook", () => {
  test("no name: the lines to paste, exit 0", () => {
    const run = cli(["hook"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      `Usage: cc-smart-dev-kit hook <worktree-create|worktree-remove|subagent-stop>

The worktree engine is opt-in per project. To turn it on in a project, give its
.claude/cc-smart-dev-kit.json a "worktrees" field, and paste these hooks into its
.claude/settings.json (merge them with any "hooks" it has):

${SETTINGS}
`,
    );
  });

  test("the README's § Worktrees shows exactly these lines", () => {
    const readme = readFileSync(join(import.meta.dir, "..", "..", "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("\n## Worktrees\n"));
    expect(section).toContain(`\`\`\`json\n${SETTINGS}\n\`\`\``);
  });

  test("an unknown hook: usage, exit 2, nothing read", () => {
    const run = cli(["hook", "git-guard"]);
    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toStartWith("Unknown hook: git-guard\n\nUsage: cc-smart-dev-kit hook <");
  });

  test("worktree-create: the folder on stdout and nothing else, exit 0", () => {
    const repo = engineClone();
    const run = cli(["hook", "worktree-create"], {
      stdin: JSON.stringify({
        hook_event_name: "WorktreeCreate",
        session_id: SESSION,
        cwd: repo,
        name: "fix/x",
      }),
    });
    expect(run).toMatchObject({
      exitCode: 0,
      stdout: join(dirname(repo), "app-wt-fix-x"),
      stderr: "",
    });
  });

  test("worktree-create without worktrees in cc-smart-dev-kit.json: exit 1, the reason, no folder", () => {
    const repo = makeRepo();
    const run = cli(["hook", "worktree-create"], {
      stdin: JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: repo, name: "fix/x" }),
    });
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      "worktree not created: this project wires the cc-smart-dev-kit worktree hooks (cc-smart-dev-kit hook ...), but has no .claude/cc-smart-dev-kit.json. " +
        'Add "worktrees" to .claude/cc-smart-dev-kit.json, or take the three cc-smart-dev-kit hook lines out of .claude/settings.json (the cc-smart-dev-kit README, § Worktrees)\n',
    );
  });

  test("worktree-remove: removes a clean worktree, exit 0; input that is not JSON: exit 1", () => {
    const repo = engineClone();
    const folder = join(repo, ".claude", "worktrees", "agent-0a1b");
    git(repo, "worktree", "add", "-q", "-b", "worktree-agent-0a1b", folder);
    const run = cli(["hook", "worktree-remove"], {
      cwd: folder,
      stdin: JSON.stringify({
        hook_event_name: "WorktreeRemove",
        cwd: folder,
        worktree_path: folder,
      }),
    });
    expect(run).toMatchObject({
      exitCode: 0,
      stdout: "",
      stderr: `removed ${folder}; deleted branch worktree-agent-0a1b\n`,
    });
    expect(existsSync(folder)).toBe(false);
    expect(cli(["hook", "worktree-remove"], { stdin: "nope" })).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: "cc-smart-dev-kit worktree-remove: the hook input is not JSON\n",
    });
  });

  test("subagent-stop: input that is not JSON is one line, exit 0 (a subagent must finish)", () => {
    expect(cli(["hook", "subagent-stop"], { stdin: "nope" })).toMatchObject({
      exitCode: 0,
      stdout: "",
      stderr: "cc-smart-dev-kit subagent-stop: the hook input is not JSON\n",
    });
  });

  test("the exact command a project wires: through sh, $HOME and the launcher, with no bun on PATH", () => {
    const repo = engineClone();
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
      {
        mode: 0o755,
      },
    );
    const run = Bun.spawnSync(["/bin/sh", "-c", projectHookCommand("worktree-create")], {
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
    });
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toBe(join(dirname(repo), "app-wt-fix-wired"));
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

  test("no name: usage, exit 2; a bad id: the reason, exit 1", () => {
    const usage = cli(["session-name", SESSION]);
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr).toStartWith("Usage: cc-smart-dev-kit session-name <session id> <name>");
    const bad = cli(["session-name", "../x", "name"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toBe('cc-smart-dev-kit: "../x" is not a session id\n');
  });
});

test("doctor refuses an option it does not know", () => {
  const run = cli(["doctor", "--lively"]);
  expect(run.exitCode).toBe(2);
  expect(run.stderr).toStartWith("Unknown option: --lively");
});

test("doctor checks the project of the folder it runs in, against the plugin's own hooks", () => {
  const repo = makeRepo();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", {
    worktrees: { base: "main", prefix: "app-wt-" },
  });
  writeClaudeFile(repo, "settings.json", {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./g.sh" }] }] },
  });
  const run = cli(["doctor"], { cwd: repo });
  expect(run.exitCode).toBe(1);
  expect(run.stdout).toContain(
    `! project: .claude/cc-smart-dev-kit.json still sets "worktrees.prefix": the worktree engine is deprecated and retires in the next minor version. Remove it; Claude Code's own worktrees need no hook, and a project whose base branch is not the repo's default branch adds "worktree": {"baseRef": "head"} to .claude/settings.json\n`,
  );
  expect(run.stdout).toContain(
    `! project: .claude/worktrees/ is not git-ignored here, so Claude Code's own worktrees show up in git status: add ".claude/worktrees/" to the repo's .gitignore and commit it\n`,
  );
  expect(run.stdout).toContain(
    `! project: the plugin's git-guard and the project's ./g.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of git-guard, list "git-guard" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed\n`,
  );
});
