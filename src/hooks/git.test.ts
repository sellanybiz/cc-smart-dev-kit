/**
 * `parseWorktreeList` (`git.ts`): what `git worktree list --porcelain` says about each worktree,
 * the reason of a lock included.
 */
import { describe, expect, test } from "bun:test";
import { parseWorktreeList } from "./git";

describe("parseWorktreeList", () => {
  test("a lock keeps its reason: Claude Code's own lock can be told from a person's", () => {
    const porcelain = [
      "worktree /work/app",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /work/app/.claude/worktrees/agent-B1-help",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feat/B1-help",
      "locked claude session agent-B1-help (pid 4242 start 99)",
      "",
      "worktree /work/usb",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "locked",
      "",
      "worktree /work/plain",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/plain",
      "",
    ].join("\n");
    const [main, claude, bare, plain] = parseWorktreeList(porcelain);
    expect(main).toEqual({
      branch: "main",
      head: "1111111111111111111111111111111111111111",
      locked: false,
      path: "/work/app",
      prunable: false,
    });
    expect(claude?.locked).toBe(true);
    expect(claude?.lockReason).toBe("claude session agent-B1-help (pid 4242 start 99)");
    // A lock with no reason is a lock all the same, with nothing said.
    expect(bare?.locked).toBe(true);
    expect(bare?.lockReason).toBeUndefined();
    expect(plain?.locked).toBe(false);
    expect(plain?.lockReason).toBeUndefined();
  });
});
