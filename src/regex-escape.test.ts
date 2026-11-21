import { describe, expect, test } from "bun:test";
import { escapeRegex } from "./regex-escape";

describe("escapeRegex", () => {
  test("every regex metacharacter matches only itself", () => {
    const meta = ".*+?^$" + "{}()|[]\\";
    expect(new RegExp(`^${escapeRegex(meta)}$`).test(meta)).toBe(true);
    expect(escapeRegex("a.b")).toBe("a\\.b");
  });

  test("a dot is not any character", () => {
    expect(new RegExp(`^${escapeRegex("a.b")}$`).test("axb")).toBe(false);
  });

  test("plain text, slashes and dashes pass through", () => {
    expect(escapeRegex("claude/worktrees-1")).toBe("claude/worktrees-1");
  });
});
