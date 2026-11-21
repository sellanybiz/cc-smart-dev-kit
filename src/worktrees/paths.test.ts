/**
 * The one home of Claude Code's worktree names: the helpers, and a scan that no other source
 * file builds the folder by hand.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  SUBAGENT_BRANCH_PREFIX,
  SUBAGENT_NAME_PREFIX,
  WORKTREES_FOLDER_SEGMENTS,
  worktreeBranch,
  worktreePath,
  worktreesFolder,
} from "./paths";

test("the worktrees folder and one worktree's path, from the repo's root", () => {
  expect(worktreesFolder("/r")).toBe(join("/r", ".claude", "worktrees"));
  expect(worktreePath("/r", "my-work")).toBe(join("/r", ".claude", "worktrees", "my-work"));
  expect(WORKTREES_FOLDER_SEGMENTS).toEqual([".claude", "worktrees"]);
});

test("a worktree's branch is its name behind worktree-", () => {
  expect(worktreeBranch("my-work")).toBe("worktree-my-work");
  expect(worktreeBranch(`${SUBAGENT_NAME_PREFIX}1f`)).toBe("worktree-agent-1f");
});

test("a subagent's name and branch prefixes are the shapes Claude Code gives", () => {
  expect(SUBAGENT_NAME_PREFIX).toBe("agent-");
  expect(SUBAGENT_BRANCH_PREFIX).toBe("worktree-agent-");
});

/**
 * The two hand-built shapes: a join of the two folder names (on one line or over several), and
 * a regex that spells the folder out (`.claude[\\/]worktrees`).
 */
const BUILT_BY_HAND = [/"\.claude"\s*,\s*"worktrees"/, /\.claude\[\\\\\/\]worktrees/];

test("no source file outside paths.ts builds the worktrees folder by hand", () => {
  const sourceRoot = join(import.meta.dir, "..");
  const offenders: string[] = [];
  for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: sourceRoot })) {
    if (file.endsWith(".test.ts") || file === join("worktrees", "paths.ts")) continue;
    const text = readFileSync(join(sourceRoot, file), "utf8");
    if (BUILT_BY_HAND.some((pattern) => pattern.test(text))) {
      offenders.push(relative(join(sourceRoot, ".."), join(sourceRoot, file)));
    }
  }
  expect(offenders).toEqual([]);
});

test("the scan can fail: it names a file that joins the folder by hand", () => {
  expect(BUILT_BY_HAND.some((p) => p.test('join(repo, ".claude", "worktrees", name)'))).toBe(true);
  expect(BUILT_BY_HAND.some((p) => p.test('join(repo, ".claude",\n  "worktrees")'))).toBe(true);
  expect(
    BUILT_BY_HAND.some((p) => p.test(String.raw`^(.*[\\/]\.claude[\\/]worktrees[\\/]agent-1)`)),
  ).toBe(true);
  expect(BUILT_BY_HAND.some((p) => p.test('basename(common) === ".git"'))).toBe(false);
});
