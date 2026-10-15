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
    (line) => `${line.info ? "·" : line.ok ? "✓" : "✗"} ${line.text}`,
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

describe("the plugin hooks a project hook silences (the defer check)", () => {
  test("one · line for each, naming the plugin hook, the event and tools, the project's command", () => {
    const repo = makeRepo();
    wireOnly(repo, [], {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] },
        { matcher: "Read", hooks: [{ type: "command", command: "./reads.sh" }] },
      ],
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "./hello.sh" }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "bun", args: ["p.ts"] }] }],
    });
    expect(check(repo)).toEqual([
      "· project: the plugin's git-guard is off here for PreToolUse (Bash): ./guard.sh (.claude/settings.json) runs on the same event",
      "· project: the plugin's worktree-leftovers is off here for SessionStart (startup): ./hello.sh (.claude/settings.json) runs on the same event",
      "· project: the plugin's session-name is off here for SessionStart (startup): ./hello.sh (.claude/settings.json) runs on the same event",
      "· project: the plugin's session-name is off here for UserPromptSubmit: bun p.ts (.claude/settings.json) runs on the same event",
    ]);
  });

  test("a project hook for every tool silences each plugin hook on that event, for all its tools", () => {
    const repo = makeRepo();
    wireOnly(repo, [], {
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "./log.sh" }] }],
    });
    expect(check(repo)).toEqual([
      "· project: the plugin's after-merge is off here for PostToolUse (Bash, PowerShell): ./log.sh (.claude/settings.json) runs on the same event",
    ]);
  });

  test("the plugin's hooks.json cannot be read: ✗", () => {
    const missing = join(tempDir("plugin"), "hooks.json");
    const lines = check(makeRepo(), hookEnv(), missing);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`✗ cannot read the plugin's hooks (${missing}): `);
  });
});
