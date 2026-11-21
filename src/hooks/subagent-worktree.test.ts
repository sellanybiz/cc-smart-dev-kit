/**
 * The worktree a subagent worked in, read from the folder it worked in.
 */
import { describe, expect, test } from "bun:test";
import { subagentWorktreeByShape } from "./subagent-worktree";

describe("subagentWorktreeByShape", () => {
  const AGENT = "a0b1c2d3e4f5a6b7c";

  test("the shape alone finds a subagent worktree of any agent id, and only that shape", () => {
    expect(subagentWorktreeByShape(`/r/.claude/worktrees/agent-${AGENT}/src`)).toBe(
      `/r/.claude/worktrees/agent-${AGENT}`,
    );
    expect(subagentWorktreeByShape(`C:\\r\\.claude\\worktrees\\agent-${AGENT}`)).toBe(
      `C:\\r\\.claude\\worktrees\\agent-${AGENT}`,
    );
    expect(subagentWorktreeByShape("/r/.claude/worktrees/my-work/src")).toBeNull();
    expect(subagentWorktreeByShape(`/r/xclaude/worktrees/agent-${AGENT}`)).toBeNull();
    expect(subagentWorktreeByShape(`/r/.claude/worktrees/agent-${AGENT}x`)).toBeNull();
    expect(subagentWorktreeByShape("/r/src")).toBeNull();
  });

  test("a Windows path inside the worktree finds the worktree itself", () => {
    expect(subagentWorktreeByShape(`C:\\r\\.claude\\worktrees\\agent-${AGENT}\\src`)).toBe(
      `C:\\r\\.claude\\worktrees\\agent-${AGENT}`,
    );
  });
});
