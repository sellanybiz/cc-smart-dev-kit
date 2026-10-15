/** `doctor`'s checks of the project in the folder it runs in (`project-checks.ts`). */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectHookSettings } from "../hooks/project-wiring";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { projectChecks } from "./project-checks";

const PLUGIN_HOOKS = join(import.meta.dir, "..", "..", "plugin", "hooks", "hooks.json");
const ENGINE = { worktrees: { base: "main", prefix: "app-wt-" } };
const HINT =
  "Run `anymodel hook` for the lines to paste (also in the anymodel README, § Worktrees)";

function check(repo: string, env = hookEnv(), hooksFile = PLUGIN_HOOKS) {
  return projectChecks(repo, env, cliPaths(env), hooksFile).map(
    (line) => `${line.info ? "·" : line.warn ? "!" : line.ok ? "✓" : "✗"} ${line.text}`,
  );
}

/** The project's settings with only some of the engine's hooks. */
function wireOnly(repo: string, events: string[], extra: Record<string, unknown> = {}): void {
  const all = projectHookSettings().hooks;
  writeClaudeFile(repo, "settings.json", {
    hooks: { ...Object.fromEntries(events.map((event) => [event, all[event]])), ...extra },
  });
}

describe("the worktree engine's wiring", () => {
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

  test("worktrees set, the three hooks wired as the README says: one ✓", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", ENGINE);
    writeClaudeFile(repo, "settings.json", projectHookSettings());
    expect(check(repo)).toEqual([
      "✓ project: the worktree engine is wired (WorktreeCreate, WorktreeRemove, SubagentStop)",
    ]);
  });

  test("worktrees set, nothing wired: ✗, Claude Code makes its own worktrees, and how to wire them", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", ENGINE);
    expect(check(repo)).toEqual([
      `✗ project: "worktrees" is set in .claude/anymodel.json, but the project's settings do not wire WorktreeCreate, WorktreeRemove, SubagentStop to anymodel hook, so Claude Code makes its own worktrees. ${HINT}`,
    ]);
  });

  test("worktrees set, only WorktreeCreate wired (in settings.local.json): ✗ naming the other two", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", ENGINE);
    writeClaudeFile(repo, "settings.local.json", {
      hooks: { WorktreeCreate: projectHookSettings().hooks.WorktreeCreate },
    });
    expect(check(repo)).toEqual([
      `✗ project: "worktrees" is set in .claude/anymodel.json, but the project's settings do not wire WorktreeRemove, SubagentStop to anymodel hook. ${HINT}`,
    ]);
  });

  test("wired, but no anymodel.json, or one without worktrees: ✗, each worktree would fail", () => {
    const repo = makeRepo();
    wireOnly(repo, ["WorktreeCreate", "WorktreeRemove"]);
    expect(check(repo)).toEqual([
      '✗ project: the project\'s settings wire WorktreeCreate, WorktreeRemove to anymodel hook, but there is no .claude/anymodel.json, so each of them fails. Add "worktrees", or take the anymodel hook lines out',
    ]);
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
    expect(check(repo)).toEqual([
      '✗ project: the project\'s settings wire WorktreeCreate, WorktreeRemove to anymodel hook, but .claude/anymodel.json has no "worktrees", so each of them fails. Add "worktrees", or take the anymodel hook lines out',
    ]);
  });

  test("a second WorktreeCreate next to the engine, the project's or the user's: ✗ for each", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", ENGINE);
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
      "✓ project: the worktree engine is wired (WorktreeCreate, WorktreeRemove, SubagentStop)",
      "✗ project: another WorktreeCreate hook runs too: ./make-worktree.sh (.claude/settings.json). Claude Code runs both and makes two worktrees for each request; remove one",
      "✗ project: another WorktreeCreate hook runs too: mine (~/.claude/settings.json). Claude Code runs both and makes two worktrees for each request; remove one",
    ]);
  });

  test("a broken anymodel.json: ✗ naming the file and field", () => {
    const repo = makeRepo();
    const file = writeClaudeFile(repo, "anymodel.json", { worktree: {} });
    expect(check(repo)).toEqual([
      `✗ project: Invalid ${file}: worktree: unknown field (a newer anymodel may be needed)`,
    ]);
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
    `! project: the plugin's ${plugin} and the project's ${command} (.claude/settings.json) both run on ${on}, so both may answer. If that is the project's own copy of ${plugin}, list "${plugin}" in ownHooks in .claude/anymodel.json until the copy is removed`;

  test("a project hook next to a plugin hook it does not list: one ! warning each, not a failure", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
    wireOnly(repo, [], OTHERS);
    expect(check(repo)).toEqual([
      both("git-guard", "./guard.sh", "PreToolUse (Bash)"),
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "./hello.sh", "SessionStart (startup)"),
      both("session-name", "bun p.ts", "UserPromptSubmit"),
    ]);
    const env = hookEnv();
    expect(projectChecks(repo, env, cliPaths(env), PLUGIN_HOOKS).every((l) => l.ok)).toBe(true);
  });

  test("a listed hook: one · line, and no warning for its copy", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { ownHooks: ["git-guard", "session-name"] });
    wireOnly(repo, [], OTHERS);
    expect(check(repo)).toEqual([
      "· project: the plugin's git-guard is off here: .claude/anymodel.json lists it in ownHooks, so the project's own copy answers alone",
      "· project: the plugin's session-name is off here: .claude/anymodel.json lists it in ownHooks, so the project's own copy answers alone",
      both("worktree-leftovers", "./hello.sh", "SessionStart (startup)"),
    ]);
  });

  test("a listed hook with no project hook left on its event: ! nothing answers in its place", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { ownHooks: ["main-folder-guard"] });
    expect(check(repo)).toEqual([
      "! project: .claude/anymodel.json lists main-folder-guard in ownHooks, so the plugin's main-folder-guard is off here, but the project's settings wire no hook on PreToolUse (Edit, Write, NotebookEdit): nothing answers in its place. Take \"main-folder-guard\" out of ownHooks once the project's copy is gone",
    ]);
  });

  test("a project hook for every tool runs next to each plugin hook on that event, for all its tools", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
    wireOnly(repo, [], {
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "./log.sh" }] }],
    });
    expect(check(repo)).toEqual([
      both("after-merge", "./log.sh", "PostToolUse (Bash, PowerShell)"),
    ]);
  });

  test("no anymodel.json: the plugin hooks are silent, so nothing can answer twice", () => {
    const repo = makeRepo();
    wireOnly(repo, [], OTHERS);
    expect(check(repo)).toEqual([]);
  });

  test("the settings of $CLAUDE_PROJECT_DIR, when set, not the checkout's", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
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
    const file = writeClaudeFile(repo, "anymodel.json", { ownHooks: ["git-gaurd"] });
    const lines = check(repo);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ project: Invalid ${file}: ownHooks.0: `);
  });

  test("the plugin's hooks.json cannot be read: ✗", () => {
    const repo = makeRepo();
    writeClaudeFile(repo, "anymodel.json", { sessionNames: true });
    const missing = join(tempDir("plugin"), "hooks.json");
    const lines = check(repo, hookEnv(), missing);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ cannot read the plugin's hooks (${missing}): `);
  });
});
