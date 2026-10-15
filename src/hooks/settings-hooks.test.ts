import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, wireProjectHook } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { matcherSelects, projectSettingsFiles, wiredHandlers } from "./settings-hooks";

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

describe("wiredHandlers", () => {
  test("names each handler of the matching groups: exec form joined, a shell string as is", () => {
    const dir = tempDir("settings");
    const file = join(dir, "settings.json");
    writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "bun", args: ["g.js", "x"] }] },
            { matcher: "Edit", hooks: [{ type: "command", command: "edit-check" }] },
            {
              hooks: [
                { type: "prompt", prompt: "is this safe?" },
                { type: "command", command: "all" },
              ],
            },
          ],
        },
      }),
    );
    expect(wiredHandlers(file, "PreToolUse", "Bash")).toEqual([
      { file, command: "bun g.js x" },
      { file, command: "(a prompt hook)" },
      { file, command: "all" },
    ]);
    expect(wiredHandlers(file, "PreToolUse", "Edit").map((handler) => handler.command)).toEqual([
      "edit-check",
      "(a prompt hook)",
      "all",
    ]);
    expect(wiredHandlers(file, "PostToolUse", "Bash")).toEqual([]);
  });

  test("a hook for the event and a matching tool counts; another tool or event does not", () => {
    const file = wireProjectHook(makeRepo(), "PreToolUse", "Bash");
    expect(wiredHandlers(file, "PreToolUse", "Bash")).toEqual([{ file, command: "true" }]);
    expect(wiredHandlers(file, "PreToolUse", "Edit")).toEqual([]);
    expect(wiredHandlers(file, "PostToolUse", "Bash")).toEqual([]);
  });

  test("a group with no handlers, a missing file and a broken file wire nothing", () => {
    const dir = tempDir("settings");
    const empty = join(dir, "empty.json");
    writeFileSync(empty, JSON.stringify({ hooks: { WorktreeCreate: [{ hooks: [] }] } }));
    expect(wiredHandlers(empty, "WorktreeCreate", null)).toEqual([]);
    expect(wiredHandlers(join(dir, "missing.json"), "WorktreeCreate", null)).toEqual([]);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(wiredHandlers(broken, "WorktreeCreate", null)).toEqual([]);
  });
});

test("projectSettingsFiles: the project's settings.json and settings.local.json", () => {
  expect(projectSettingsFiles("/p")).toEqual([
    join("/p", ".claude", "settings.json"),
    join("/p", ".claude", "settings.local.json"),
  ]);
});
