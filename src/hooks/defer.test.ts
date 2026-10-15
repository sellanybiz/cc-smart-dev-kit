import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { locateCheckout } from "../project/resolve";
import { makeRepo, wireProjectHook } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { deferSources, fileWiresHook, matcherSelects, ownHookIn } from "./defer";

describe("matcherSelects: Claude Code's matcher rules", () => {
  test.each([
    [undefined, "Bash", true],
    ["", "Bash", true],
    ["*", "Bash", true],
    ["Bash", "Bash", true],
    ["Bash", "PowerShell", false],
    ["Bash|PowerShell", "PowerShell", true],
    ["Edit, Write", "Write", true],
    ["Edit, Write", "NotebookEdit", false],
    // Exact names: "Edit" is not "NotebookEdit".
    ["Edit|Write", "NotebookEdit", false],
    // A regular expression, not anchored: "Edit.*" also selects "NotebookEdit".
    ["Edit.*", "NotebookEdit", true],
    ["^Edit$", "NotebookEdit", false],
    ["mcp__memory__.*", "mcp__memory__read", true],
    // Only exact-name characters: compared as a name, so no MCP tool matches it.
    ["mcp__memory", "mcp__memory__read", false],
    ["startup|resume", "compact", false],
    ["startup|resume", "resume", true],
    ["(", "Bash", false],
  ])("matcher %j and %j: %j", (matcher, subject, expected) => {
    expect(matcherSelects(matcher, subject)).toBe(expected);
  });

  test("an event without matchers: every matcher counts", () => {
    expect(matcherSelects("anything", null)).toBe(true);
  });

  test("a matcher that is not a string selects nothing", () => {
    expect(matcherSelects(5, "Bash")).toBe(false);
  });
});

describe("fileWiresHook", () => {
  test("a hook for the event and a matching tool counts; another tool or event does not", () => {
    const repo = makeRepo();
    const file = wireProjectHook(repo, "PreToolUse", "Bash");
    expect(fileWiresHook(file, "PreToolUse", "Bash")).toBe(true);
    expect(fileWiresHook(file, "PreToolUse", "Edit")).toBe(false);
    expect(fileWiresHook(file, "PostToolUse", "Bash")).toBe(false);
  });

  test("a group with no handlers, a missing file and a broken file do not count", () => {
    const dir = tempDir("settings");
    const empty = join(dir, "empty.json");
    writeFileSync(empty, JSON.stringify({ hooks: { WorktreeCreate: [{ hooks: [] }] } }));
    expect(fileWiresHook(empty, "WorktreeCreate", null)).toBe(false);
    expect(fileWiresHook(join(dir, "missing.json"), "WorktreeCreate", null)).toBe(false);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(fileWiresHook(broken, "WorktreeCreate", null)).toBe(false);
  });
});

describe("deferSources", () => {
  test("the checkout's and the main checkout's settings, both files each; the user's when asked", () => {
    const repo = makeRepo();
    const worktree = join(repo, "..", "wt");
    git(repo, "worktree", "add", "-q", "-b", "wt", worktree);
    const checkout = locateCheckout(worktree);
    if (checkout === null) throw new Error("no checkout");
    expect(deferSources(checkout, null)).toEqual([
      join(worktree, ".claude", "settings.json"),
      join(worktree, ".claude", "settings.local.json"),
      join(repo, ".claude", "settings.json"),
      join(repo, ".claude", "settings.local.json"),
    ]);
    expect(deferSources(checkout, "/home/user/.claude/settings.json").at(-1)).toBe(
      "/home/user/.claude/settings.json",
    );
  });

  test("the main checkout's settings.local.json silences a hook running in a worktree", () => {
    const repo = makeRepo();
    const worktree = join(repo, "..", "wt");
    git(repo, "worktree", "add", "-q", "-b", "wt", worktree);
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const local = wireProjectHook(repo, "WorktreeCreate", undefined, "settings.local.json");
    const checkout = locateCheckout(worktree);
    if (checkout === null) throw new Error("no checkout");
    expect(ownHookIn(deferSources(checkout, null), "WorktreeCreate", null)).toBe(local);
    expect(ownHookIn(deferSources(checkout, null), "WorktreeRemove", null)).toBeNull();
  });
});
