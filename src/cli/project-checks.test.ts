/** `doctor`'s checks of the project in the folder it runs in (`project-checks.ts`). */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { tempDir, withGitVersion } from "../testing/temp";
import { checkLine } from "./doctor";
import { cliPaths } from "./paths";
import { projectChecks, renamedCommand } from "./project-checks";

const PLUGIN_HOOKS = join(import.meta.dir, "..", "..", "plugin", "hooks", "hooks.json");
const NOT_IGNORED =
  "project: .claude/worktrees/ is not git-ignored here, so Claude Code's own worktrees show up in git status: add \".claude/worktrees/\" to the repo's .gitignore and commit it";

/** The retired engine's three lines, as its old README had a project paste them: by hand. */
const ENGINE_HOOKS: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> = {
  WorktreeCreate: [
    {
      hooks: [
        {
          type: "command",
          command: '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-create',
          timeout: 600,
        },
      ],
    },
  ],
  WorktreeRemove: [
    {
      hooks: [
        {
          type: "command",
          command: '"$HOME/.local/bin/cc-smart-dev-kit" hook worktree-remove',
          timeout: 60,
        },
      ],
    },
  ],
  SubagentStop: [
    {
      hooks: [
        {
          type: "command",
          command: '"$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop',
          timeout: 60,
        },
      ],
    },
  ],
};

/** The doctor line for leftover engine lines in one settings file, written out by hand. */
const engineLine = (file: string, names: string[]) =>
  `✗ project: ${file} still runs ${names.map((name) => `cc-smart-dev-kit hook ${name}`).join(", ")}, retired with the plugin's worktree engine in 1.0.0, so ${names.length === 1 ? "it fails" : "each of them fails"} every time (Claude Code's own worktrees need no hook) Fix: cc-smart-dev-kit project init (it takes ${names.length === 1 ? "the line" : "those lines"} out)`;

async function check(repo: string, env = hookEnv(), hooksFile = PLUGIN_HOOKS) {
  return (await projectChecks(repo, env, cliPaths(env), hooksFile)).map(checkLine);
}

/** The repo ignores `.claude/worktrees/`, where Claude Code makes its worktrees. */
function ignoreWorktrees(repo: string): void {
  writeFileSync(join(repo, ".gitignore"), ".claude/worktrees/\n");
}

/** The project's settings with some of the retired engine's lines, and any other hooks. */
function wireOnly(repo: string, events: string[], extra: Record<string, unknown> = {}): void {
  writeClaudeFile(repo, "settings.json", {
    hooks: { ...Object.fromEntries(events.map((event) => [event, ENGINE_HOOKS[event]])), ...extra },
  });
}

describe("Claude Code's own worktrees, and the retired engine", () => {
  test("outside git: nothing to say", async () => {
    expect(await check(tempDir("nogit"))).toEqual([]);
  });

  test("a project that never opted in: nothing to say", async () => {
    expect(await check(makeRepo())).toEqual([]);
  });

  test("no git on PATH: one · line, not checked", async () => {
    const env = { ...hookEnv(), PATH: tempDir("empty-path") };
    expect(await check(makeRepo(), env)).toEqual(["· project: not checked, git is not on PATH"]);
  });

  test("worktrees set, no engine hook, the folder ignored: nothing to say", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test(".claude/worktrees/ not git-ignored: one ! line naming the .gitignore entry", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    expect(await check(repo)).toEqual([`! ${NOT_IGNORED}`]);
  });

  test("a base branch that is not the default, no baseRef: one ! line naming the line to add", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([
      '! project: worktrees.base is dev, not this repo\'s default branch main, and the project\'s settings do not set "worktree": {"baseRef": "head"}, so a new worktree is cut from the default branch instead: add "worktree": {"baseRef": "head"} to .claude/settings.json and commit it',
    ]);
  });

  test("a base branch that is not the default, with baseRef head: nothing to say", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    writeClaudeFile(repo, "settings.json", { worktree: { baseRef: "head" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test("a base branch that is not the default, baseRef head in settings.local.json: nothing", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    writeClaudeFile(repo, "settings.local.json", { worktree: { baseRef: "head" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test("the default branch as the base needs no baseRef line", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([]);
  });

  test("D20: a retired engine field: the parse line, naming the field and the fix", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", prefix: "app-wt-" },
    });
    expect(await check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktrees.prefix is no longer supported: remove it — Claude Code's own worktrees need none. \`cc-smart-dev-kit project init\` removes it (README § Worktrees). Fix: correct the file as this line says, or run: cc-smart-dev-kit project init`,
    ]);
  });

  test("D20: the engine's three lines: one ✗ line naming the file, the hooks and the fix", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    writeClaudeFile(repo, "settings.json", { hooks: ENGINE_HOOKS });
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove", "subagent-stop"]),
    ]);
  });

  test("D20: engine lines in both settings files, beside other hooks: one ✗ line per file", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "./stop.sh" }] }],
        WorktreeRemove: ENGINE_HOOKS.WorktreeRemove,
      },
    });
    writeClaudeFile(repo, "settings.local.json", {
      hooks: {
        WorktreeCreate: [
          { hooks: [{ type: "command", command: "  cc-smart-dev-kit   hook  worktree-create " }] },
        ],
      },
    });
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-remove"]),
      engineLine(".claude/settings.local.json", ["worktree-create"]),
    ]);
  });

  test("a project Stop hook beside verify-gate: a warning only when the project sets checks.fast", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { checks: { fast: "bun run check" } });
    writeClaudeFile(repo, "settings.json", {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./stop.sh" }] }] },
    });
    expect(await check(repo)).toEqual([
      "! project: the plugin's verify-gate and the project's ./stop.sh (.claude/settings.json) both run on Stop, so both may answer. If that is the project's own copy of verify-gate, list \"verify-gate\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
    ]);
  });

  test("D20: engine lines with no cc-smart-dev-kit.json at all: still named, each fails", async () => {
    const repo = makeRepo();
    wireOnly(repo, ["WorktreeCreate", "WorktreeRemove"]);
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove"]),
    ]);
  });

  test("D20: a retired field and the engine's lines: both lines, so one project init run fixes both", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", engine: "plugin" },
    });
    writeClaudeFile(repo, "settings.json", { hooks: ENGINE_HOOKS });
    expect(await check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktrees.engine is no longer supported: remove it — Claude Code's own worktrees need none. \`cc-smart-dev-kit project init\` removes it (README § Worktrees). Fix: correct the file as this line says, or run: cc-smart-dev-kit project init`,
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove", "subagent-stop"]),
    ]);
  });

  test("D20: hook notify, and a program whose name only ends the same way, are not the engine", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        WorktreeCreate: [
          { hooks: [{ type: "command", command: "my-cc-smart-dev-kit hook worktree-create" }] },
        ],
        Notification: [{ hooks: [{ type: "command", command: "cc-smart-dev-kit hook notify" }] }],
      },
    });
    expect((await check(repo)).some((line) => line.includes("retired"))).toBe(false);
  });

  test("a broken cc-smart-dev-kit.json: ✗ naming the file and field", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktree: {} });
    expect(await check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktree: unknown field (a newer cc-smart-dev-kit may be needed) Fix: correct the file as this line says, or run: cc-smart-dev-kit project init`,
    ]);
  });
});

describe("a project that used the old anymodel name", () => {
  test("the old config file, the old add-ons folder and an old launcher in a hook: one ! each", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
    mkdirSync(join(repo, ".claude", "anymodel"), { recursive: true });
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/anymodel" hook session-name',
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
    expect(await check(repo)).toEqual([
      "! project: .claude/anymodel.json is the old name of .claude/cc-smart-dev-kit.json, which the plugin reads now: rename it (merge the two when both are there)",
      "! project: .claude/anymodel/ is the old name of .claude/cc-smart-dev-kit/, where a skill reads the project's own add-ons: rename the folder",
      '! project: the hook "$HOME/.local/bin/anymodel" hook session-name (.claude/settings.json) still runs the plugin\'s old "anymodel" launcher: change it to "$HOME/.local/bin/cc-smart-dev-kit" hook session-name',
    ]);
  });

  test("the new names: no warning; a hook that only says anymodel somewhere else is not one", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "./note-anymodel.sh" }] },
        ],
        ...ENGINE_HOOKS,
      },
    });
    expect(await check(repo)).toEqual([
      engineLine(".claude/settings.json", ["worktree-create", "worktree-remove", "subagent-stop"]),
      "! project: the plugin's git-guard and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of git-guard, list \"git-guard\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
      "! project: the plugin's merge-guard and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of merge-guard, list \"merge-guard\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
      "! project: the plugin's job-route and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. The plugin's job-route cannot be switched off (it judges every launch): remove the project's copy, or keep it knowing both answer",
    ]);
  });

  test("a launcher path is the old name; a word that merely holds it is not", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
    const pluginRoot = "${CLAUDE_PLUGIN_ROOT}";
    expect(renamedCommand('"$HOME/.local/bin/anymodel-bun" x')).toBe(
      '"$HOME/.local/bin/cc-smart-dev-kit-bun.sh" x',
    );
    // The plugin folder's own shim, as a project copied it out of hooks.json: the file is
    // `cc-smart-dev-kit-bun.sh` now (the hooks are shell form).
    expect(renamedCommand(`"${pluginRoot}/bin/anymodel-bun" x`)).toBe(
      `"${pluginRoot}/bin/cc-smart-dev-kit-bun.sh" x`,
    );
    expect(renamedCommand("anymodel --version")).toBe("cc-smart-dev-kit --version");
    expect(renamedCommand("./note-anymodel.sh")).toBe("./note-anymodel.sh");
  });
});

describe("the project's own copies of plugin hooks (ownHooks)", () => {
  const OTHERS = {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] },
      { matcher: "Read", hooks: [{ type: "command", command: "./reads.sh" }] },
    ],
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "./hello.sh" }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "bun", args: ["p.ts"] }] }],
  };
  const both = (plugin: string, command: string, on: string) =>
    `! project: the plugin's ${plugin} and the project's ${command} (.claude/settings.json) both run on ${on}, so both may answer. If that is the project's own copy of ${plugin}, list "${plugin}" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed`;
  /** `job-route` is `alwaysOn` since 1.0.0: no project can switch it off, so the warning says so. */
  const bothJobRoute = (command: string, on: string) =>
    `! project: the plugin's job-route and the project's ${command} (.claude/settings.json) both run on ${on}, so both may answer. The plugin's job-route cannot be switched off (it judges every launch): remove the project's copy, or keep it knowing both answer`;

  test("a project hook next to a plugin hook it does not list: one ! warning each, not a failure", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], OTHERS);
    expect(await check(repo)).toEqual([
      both("git-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      bothJobRoute("./guard.sh", "PreToolUse (Bash)"),
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "bun p.ts", "UserPromptSubmit"),
    ]);
    const env = hookEnv();
    expect((await projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS)).every((l) => l.ok)).toBe(
      true,
    );
  });

  test("a listed hook: one · line, and no warning for its copy", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-guard", "session-name"] });
    wireOnly(repo, [], OTHERS);
    expect(await check(repo)).toEqual([
      "· project: the plugin's git-guard is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      "· project: the plugin's session-name is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      bothJobRoute("./guard.sh", "PreToolUse (Bash)"),
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
    ]);
  });

  test("a project hook on SessionStart: no warning for the machine-wide update-check", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ownHooks: ["session-name", "worktree-leftovers"],
    });
    wireOnly(repo, [], { SessionStart: OTHERS.SessionStart });
    expect(await check(repo)).toEqual([
      "· project: the plugin's session-name is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      "· project: the plugin's worktree-leftovers is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
    ]);
  });

  test("a project hook on the Agent event: no warning for the machine-wide agent-guard", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], {
      PreToolUse: [
        {
          matcher: "Agent|Task|Workflow",
          hooks: [{ type: "command", command: "./agent-guard.sh" }],
        },
      ],
    });
    // The machine-wide hooks (notify, update-check, agent-guard) answer about the machine,
    // not this project: a project hook beside one is not a second copy of a plugin piece.
    expect(await check(repo)).toEqual([]);
  });

  test("a listed hook with no project hook left on its event: ! nothing answers in its place", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["main-folder-guard"] });
    expect(await check(repo)).toEqual([
      "! project: .claude/cc-smart-dev-kit.json lists main-folder-guard in ownHooks, so the plugin's main-folder-guard is off here, but the project's settings wire no hook on PreToolUse (Edit, Write, NotebookEdit): nothing answers in its place. Take \"main-folder-guard\" out of ownHooks once the project's copy is gone",
    ]);
  });

  test("a retired hook name in ownHooks: one · line that it silences nothing and can go, never a warning", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["serena-root"] });
    expect(await check(repo)).toEqual([
      '· project: .claude/cc-smart-dev-kit.json lists serena-root in ownHooks, a plugin hook that is retired: it silences nothing. Take "serena-root" out of ownHooks',
    ]);
    const env = hookEnv();
    expect((await projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS)).every((l) => l.ok)).toBe(
      true,
    );
  });

  test("a hook no project can switch off any more (job-route): one · line that it silences nothing, and a copy still warns", async () => {
    // A project file written before 1.0.0 may list it: the strict parse still accepts the name,
    // and the plugin's copy answers all the same (the frame skips the ownHooks step), so a
    // project's own copy beside it is still two answers.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["job-route"] });
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }],
      },
    });
    expect(await check(repo)).toEqual([
      '· project: .claude/cc-smart-dev-kit.json lists job-route in ownHooks, a plugin hook no project can switch off any more: it silences nothing. Take "job-route" out of ownHooks',
      both("git-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      bothJobRoute("./guard.sh", "PreToolUse (Bash)"),
    ]);
  });

  test("a project hook for every tool runs next to each plugin hook on that event, for all its tools", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], {
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "./log.sh" }] }],
    });
    // review-record runs on SubagentStop, not PostToolUse, so a PostToolUse "*" never meets it.
    expect(await check(repo)).toEqual([
      both("after-merge", "./log.sh", "PostToolUse (Bash, PowerShell)"),
    ]);
  });

  test("a project hook on SubagentStop is the engine's own line: no 'second copy' warning", async () => {
    // A project that wired the retired worktree engine has a SubagentStop line, and the
    // plugin's review-record shares that event: they are different pieces, so pairing them
    // would warn twice for one line. The engine's own ✗ line is what judges it.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        SubagentStop: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop',
              },
            ],
          },
        ],
      },
    });
    const lines = await check(repo);
    expect(lines.some((line) => line.includes("review-record"))).toBe(false);
    expect(lines.some((line) => line.includes("both may answer"))).toBe(false);
  });

  test("no cc-smart-dev-kit.json: the plugin hooks are silent, so nothing can answer twice", async () => {
    const repo = makeRepo();
    wireOnly(repo, [], OTHERS);
    expect(await check(repo)).toEqual([]);
  });

  test("the settings of $CLAUDE_PROJECT_DIR, when set, not the checkout's", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], OTHERS);
    const started = tempDir("project-dir");
    writeClaudeFile(started, "settings.json", {
      hooks: {
        PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./log.sh" }] }],
      },
    });
    const env = { ...hookEnv(), CLAUDE_PROJECT_DIR: started };
    expect(await check(repo, env)).toEqual([both("after-merge", "./log.sh", "PostToolUse (Bash)")]);
  });

  test("an unknown name in ownHooks: ✗ naming the field", async () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-gaurd"] });
    const lines = await check(repo);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ project: Invalid ${file}: ownHooks.0: `);
  });

  test("the plugin's hooks.json cannot be read: ✗", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    const missing = join(tempDir("plugin"), "hooks.json");
    const lines = await check(repo, hookEnv(), missing);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ cannot read the plugin's hooks (${missing}): `);
  });
});

describe("a requires below what the file's fields need", () => {
  const LOW = {
    requires: ">=1.0",
    worktrees: { base: "main" },
    workflow: { crew: { enabled: true, handoffTokens: 300000 } },
  };

  test("1.2.0 wrote handoffTokens under >=1.0: one ! line naming the range, the floor and the fix", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", LOW);
    ignoreWorktrees(repo);
    expect(await check(repo)).toEqual([
      '! project: .claude/cc-smart-dev-kit.json says requires ">=1.0", but its fields need ">=1.2": a teammate on an older plugin gets the whole file refused instead of "update" Fix: cc-smart-dev-kit project init (or any cc-smart-dev-kit workflow set … --project) raises it to ">=1.2"',
    ]);
  });

  test("a requires at or above the floor, a range read as a newer one, or none: nothing to say", async () => {
    const repo = makeRepo();
    ignoreWorktrees(repo);
    for (const requires of [">=1.2", ">=1.3", "^1.2", undefined]) {
      writeClaudeFile(repo, "cc-smart-dev-kit.json", { ...LOW, requires });
      expect(await check(repo)).toEqual([]);
    }
  });
});

describe("D17: a git too old to measure fixes after a review", () => {
  test("D17: git older than 2.40 in a project: one ! line saying fixes need an exact re-review", async () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    expect(await check(repo, withGitVersion(hookEnv(), "2.39.2"))).toEqual([
      "! project: git 2.39.2 is older than 2.40, so fixes made after a review cannot be measured here: each fix then needs a review of the exact new head (update git)",
    ]);
  });

  test("D17: git 2.40 or newer, or a project that never opted in: nothing to say", async () => {
    const repo = makeRepo();
    expect(await check(repo, withGitVersion(hookEnv(), "2.39.2"))).toEqual([]);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    expect(await check(repo, withGitVersion(hookEnv(), "2.40.0"))).toEqual([]);
  });
});
