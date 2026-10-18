/** `doctor`'s checks of the project in the folder it runs in (`project-checks.ts`). */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectHookSettings } from "../hooks/project-wiring";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { projectChecks, renamedCommand } from "./project-checks";

const PLUGIN_HOOKS = join(import.meta.dir, "..", "..", "plugin", "hooks", "hooks.json");
const ENGINE = { worktrees: { base: "main", prefix: "app-wt-" } };
const MOVE =
  '; Claude Code\'s own worktrees need no hook, and a project whose base branch is not the repo\'s default branch adds "worktree": {"baseRef": "head"} to .claude/settings.json';
const NOT_IGNORED =
  "project: .claude/worktrees/ is not git-ignored here, so Claude Code's own worktrees show up in git status: add \".claude/worktrees/\" to the repo's .gitignore and commit it";

function check(repo: string, env = hookEnv(), hooksFile = PLUGIN_HOOKS) {
  return projectChecks(repo, env, cliPaths(env), hooksFile).map(
    (line) => `${line.info ? "·" : line.warn ? "!" : line.ok ? "✓" : "✗"} ${line.text}`,
  );
}

/** The repo ignores `.claude/worktrees/`, where Claude Code makes its worktrees. */
function ignoreWorktrees(repo: string): void {
  writeFileSync(join(repo, ".gitignore"), ".claude/worktrees/\n");
}

/** The project's settings with only some of the engine's hooks. */
function wireOnly(repo: string, events: string[], extra: Record<string, unknown> = {}): void {
  const all = projectHookSettings().hooks;
  writeClaudeFile(repo, "settings.json", {
    hooks: { ...Object.fromEntries(events.map((event) => [event, all[event]])), ...extra },
  });
}

describe("Claude Code's own worktrees, and the deprecated engine", () => {
  test("outside git: nothing to say", () => {
    expect(check(tempDir("nogit"))).toEqual([]);
  });

  test("a project that never opted in: nothing to say", () => {
    expect(check(makeRepo())).toEqual([]);
  });

  test("no git on PATH: one · line, not checked", () => {
    const env = { ...hookEnv(), PATH: tempDir("empty-path") };
    expect(check(makeRepo(), env)).toEqual(["· project: not checked, git is not on PATH"]);
  });

  test("worktrees set, no engine hook, the folder ignored: nothing to say", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([]);
  });

  test(".claude/worktrees/ not git-ignored: one ! line naming the .gitignore entry", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    expect(check(repo)).toEqual([`! ${NOT_IGNORED}`]);
  });

  test("a base branch that is not the default, no baseRef: one ! line naming the line to add", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([
      '! project: worktrees.base is dev, not this repo\'s default branch main, and the project\'s settings do not set "worktree": {"baseRef": "head"}, so a new worktree is cut from the default branch instead: add "worktree": {"baseRef": "head"} to .claude/settings.json and commit it',
    ]);
  });

  test("a base branch that is not the default, with baseRef head: nothing to say", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    writeClaudeFile(repo, "settings.json", { worktree: { baseRef: "head" } });
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([]);
  });

  test("a base branch that is not the default, baseRef head in settings.local.json: nothing", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "dev" } });
    writeClaudeFile(repo, "settings.local.json", { worktree: { baseRef: "head" } });
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([]);
  });

  test("the default branch as the base needs no baseRef line", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([]);
  });

  test("a non-default base with the engine still wired: the line says the engine decides", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "dev", prefix: "app-wt-" },
    });
    writeClaudeFile(repo, "settings.json", projectHookSettings());
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([
      `! project: the project's settings wire WorktreeCreate, WorktreeRemove, SubagentStop to cc-smart-dev-kit hook: the worktree engine is deprecated and retires in the next minor version. Take those lines out of .claude/settings.json and drop "worktrees.prefix" from .claude/cc-smart-dev-kit.json${MOVE}`,
      '! project: worktrees.base is dev, not this repo\'s default branch main, and the project\'s settings do not set "worktree": {"baseRef": "head"}, so a new worktree is cut from the default branch instead, and the plugin\'s worktree engine decides while it is wired: add "worktree": {"baseRef": "head"} to .claude/settings.json and commit it',
    ]);
  });

  test("the wired-engine line names no field when the file sets none", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktrees: { base: "main" } });
    writeClaudeFile(repo, "settings.json", projectHookSettings());
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([
      `! project: the project's settings wire WorktreeCreate, WorktreeRemove, SubagentStop to cc-smart-dev-kit hook: the worktree engine is deprecated and retires in the next minor version. Take those lines out of .claude/settings.json${MOVE}`,
    ]);
  });

  test("the deprecated fields still set, nothing wired: one ! line naming each field", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", prefix: "app-wt-", setup: ["bun", "install"], engine: "own" },
    });
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([
      `! project: .claude/cc-smart-dev-kit.json still sets "worktrees.engine", "worktrees.prefix", "worktrees.setup": the worktree engine is deprecated and retires in the next minor version. Remove them${MOVE}`,
    ]);
  });

  test("the engine's three hooks wired: one ! line naming the lines and the fields to remove", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", ENGINE);
    writeClaudeFile(repo, "settings.json", projectHookSettings());
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([
      `! project: the project's settings wire WorktreeCreate, WorktreeRemove, SubagentStop to cc-smart-dev-kit hook: the worktree engine is deprecated and retires in the next minor version. Take those lines out of .claude/settings.json and drop "worktrees.prefix" from .claude/cc-smart-dev-kit.json${MOVE}`,
    ]);
  });

  test("the engine's hooks wired, part of them in settings.local.json: ! naming every event", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", ENGINE);
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.local.json", {
      hooks: { WorktreeCreate: projectHookSettings().hooks.WorktreeCreate },
    });
    expect(check(repo)).toEqual([
      `! project: the project's settings wire WorktreeCreate to cc-smart-dev-kit hook: the worktree engine is deprecated and retires in the next minor version. Take those lines out of .claude/settings.json and drop "worktrees.prefix" from .claude/cc-smart-dev-kit.json${MOVE}`,
    ]);
  });

  test("wired, but no cc-smart-dev-kit.json, or one without worktrees: ✗, each hook fails", () => {
    const repo = makeRepo();
    wireOnly(repo, ["WorktreeCreate", "WorktreeRemove"]);
    expect(check(repo)).toEqual([
      `✗ project: the project's settings wire WorktreeCreate, WorktreeRemove to cc-smart-dev-kit hook, but there is no .claude/cc-smart-dev-kit.json, so each of them fails. Take the cc-smart-dev-kit hook lines out: the worktree engine is deprecated and retires in the next minor version${MOVE}`,
    ]);
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    expect(check(repo)).toEqual([
      `✗ project: the project's settings wire WorktreeCreate, WorktreeRemove to cc-smart-dev-kit hook, but .claude/cc-smart-dev-kit.json has no "worktrees", so each of them fails. Take the cc-smart-dev-kit hook lines out: the worktree engine is deprecated and retires in the next minor version${MOVE}`,
    ]);
  });

  test("a second WorktreeCreate next to the engine, the project's or the user's: ✗ for each", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", ENGINE);
    ignoreWorktrees(repo);
    const settings = projectHookSettings();
    settings.hooks.WorktreeCreate?.push({
      hooks: [{ type: "command", command: "./make-worktree.sh", timeout: 60 }],
    });
    writeClaudeFile(repo, "settings.json", settings);
    const env = hookEnv();
    writeFileSync(
      join(env.CLAUDE_CONFIG_DIR ?? "", "settings.json"),
      JSON.stringify({
        hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: "mine" }] }] },
      }),
    );
    expect(check(repo, env)).toEqual([
      `! project: the project's settings wire WorktreeCreate, WorktreeRemove, SubagentStop to cc-smart-dev-kit hook: the worktree engine is deprecated and retires in the next minor version. Take those lines out of .claude/settings.json and drop "worktrees.prefix" from .claude/cc-smart-dev-kit.json${MOVE}`,
      "✗ project: another WorktreeCreate hook runs too: ./make-worktree.sh (.claude/settings.json). Claude Code runs both and makes two worktrees for each request; remove one",
      "✗ project: another WorktreeCreate hook runs too: mine (~/.claude/settings.json). Claude Code runs both and makes two worktrees for each request; remove one",
    ]);
  });

  test("an engine of the project's own, no hooks: the deprecated fields line, never a failure", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", prefix: "app-wt-", engine: "own" },
    });
    ignoreWorktrees(repo);
    expect(check(repo)).toEqual([
      `! project: .claude/cc-smart-dev-kit.json still sets "worktrees.engine", "worktrees.prefix": the worktree engine is deprecated and retires in the next minor version. Remove them${MOVE}`,
    ]);
  });

  test("a broken cc-smart-dev-kit.json: ✗ naming the file and field", () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { worktree: {} });
    expect(check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktree: unknown field (a newer cc-smart-dev-kit may be needed)`,
    ]);
  });
});

describe("a project that used the old anymodel name", () => {
  test("the old config file, the old add-ons folder and an old launcher in a hook: one ! each", () => {
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
    expect(check(repo)).toEqual([
      "! project: .claude/anymodel.json is the old name of .claude/cc-smart-dev-kit.json, which the plugin reads now: rename it (merge the two when both are there)",
      "! project: .claude/anymodel/ is the old name of .claude/cc-smart-dev-kit/, where a skill reads the project's own add-ons: rename the folder",
      '! project: the hook "$HOME/.local/bin/anymodel" hook session-name (.claude/settings.json) still runs the plugin\'s old "anymodel" launcher: change it to "$HOME/.local/bin/cc-smart-dev-kit" hook session-name',
    ]);
  });

  test("the new names: no warning; a hook that only says anymodel somewhere else is not one", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", ENGINE);
    ignoreWorktrees(repo);
    writeClaudeFile(repo, "settings.json", {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "./note-anymodel.sh" }] },
        ],
        ...projectHookSettings().hooks,
      },
    });
    expect(check(repo)).toEqual([
      `! project: the project's settings wire WorktreeCreate, WorktreeRemove, SubagentStop to cc-smart-dev-kit hook: the worktree engine is deprecated and retires in the next minor version. Take those lines out of .claude/settings.json and drop "worktrees.prefix" from .claude/cc-smart-dev-kit.json${MOVE}`,
      "! project: the plugin's git-guard and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of git-guard, list \"git-guard\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
      "! project: the plugin's merge-guard and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of merge-guard, list \"merge-guard\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
      "! project: the plugin's job-route and the project's ./note-anymodel.sh (.claude/settings.json) both run on PreToolUse (Bash), so both may answer. If that is the project's own copy of job-route, list \"job-route\" in ownHooks in .claude/cc-smart-dev-kit.json until the copy is removed",
    ]);
  });

  test("a launcher path is the old name; a word that merely holds it is not", () => {
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

  test("a project hook next to a plugin hook it does not list: one ! warning each, not a failure", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], OTHERS);
    expect(check(repo)).toEqual([
      both("git-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("job-route", "./guard.sh", "PreToolUse (Bash)"),
      // serena-root also runs at a session start (it forgets or distrusts its record there).
      both("serena-root", "./hello.sh", "SessionStart (startup)"),
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "bun p.ts", "UserPromptSubmit"),
    ]);
    const env = hookEnv();
    expect(projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS).every((l) => l.ok)).toBe(true);
  });

  test("a listed hook: one · line, and no warning for its copy", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-guard", "session-name"] });
    wireOnly(repo, [], OTHERS);
    expect(check(repo)).toEqual([
      "· project: the plugin's git-guard is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      "· project: the plugin's session-name is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      both("merge-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("job-route", "./guard.sh", "PreToolUse (Bash)"),
      both("serena-root", "./hello.sh", "SessionStart (startup)"),
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
    ]);
  });

  test("a project hook on SessionStart: no warning for the machine-wide update-check", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      ownHooks: ["session-name", "worktree-leftovers"],
    });
    wireOnly(repo, [], { SessionStart: OTHERS.SessionStart });
    expect(check(repo)).toEqual([
      "· project: the plugin's session-name is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      "· project: the plugin's worktree-leftovers is off here: .claude/cc-smart-dev-kit.json lists it in ownHooks, so the project's own copy answers alone",
      both("serena-root", "./hello.sh", "SessionStart (startup)"),
    ]);
  });

  test("a project hook on the Agent event: no warning for the machine-wide agent-guard", () => {
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
    expect(check(repo)).toEqual([]);
  });

  test("a listed hook with no project hook left on its event: ! nothing answers in its place", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["main-folder-guard"] });
    expect(check(repo)).toEqual([
      "! project: .claude/cc-smart-dev-kit.json lists main-folder-guard in ownHooks, so the plugin's main-folder-guard is off here, but the project's settings wire no hook on PreToolUse (Edit, Write, NotebookEdit, mcp__serena__(replace_symbol_body, insert_after_symbol, insert_before_symbol, replace_content, rename_symbol, safe_delete_symbol, replace_in_files, write_memory, rename_memory, edit_memory, delete_memory)): nothing answers in its place. Take \"main-folder-guard\" out of ownHooks once the project's copy is gone",
    ]);
  });

  test("a project hook for every tool runs next to each plugin hook on that event, for all its tools", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    wireOnly(repo, [], {
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "./log.sh" }] }],
    });
    // review-record runs on SubagentStop, not PostToolUse, so a PostToolUse "*" never meets it.
    expect(check(repo)).toEqual([
      both("after-merge", "./log.sh", "PostToolUse (Bash, PowerShell)"),
      both("serena-root", "./log.sh", "PostToolUse (mcp__serena__activate_project)"),
    ]);
  });

  test("a project hook on SubagentStop is the engine's own line: no 'second copy' warning", () => {
    // Every project that wires the worktree engine has a SubagentStop line, and the plugin's
    // review-record shares that event: they are different pieces, so pairing them would warn
    // on every healthy project. The engine's own check is what judges those lines.
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", {
      worktrees: { base: "main", prefix: "app-wt-" },
    });
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
    const lines = check(repo);
    expect(lines.some((line) => line.includes("review-record"))).toBe(false);
    expect(lines.some((line) => line.includes("both may answer"))).toBe(false);
  });

  test("no cc-smart-dev-kit.json: the plugin hooks are silent, so nothing can answer twice", () => {
    const repo = makeRepo();
    wireOnly(repo, [], OTHERS);
    expect(check(repo)).toEqual([]);
  });

  test("the settings of $CLAUDE_PROJECT_DIR, when set, not the checkout's", () => {
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
    expect(check(repo, env)).toEqual([both("after-merge", "./log.sh", "PostToolUse (Bash)")]);
  });

  test("an unknown name in ownHooks: ✗ naming the field", () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "cc-smart-dev-kit.json", { ownHooks: ["git-gaurd"] });
    const lines = check(repo);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ project: Invalid ${file}: ownHooks.0: `);
  });

  test("the plugin's hooks.json cannot be read: ✗", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "cc-smart-dev-kit.json", { sessionNames: true });
    const missing = join(tempDir("plugin"), "hooks.json");
    const lines = check(repo, hookEnv(), missing);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ cannot read the plugin's hooks (${missing}): `);
  });
});
