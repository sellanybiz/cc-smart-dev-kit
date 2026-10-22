/**
 * Judging a worktree against another ref than `origin/<base>` (`scan.ts`): a worker's branch is
 * merged into its lead's branch and never pushed (D24), so `worker rm` asks whether the lead has
 * every commit, not whether the remote has.
 *
 * Real git repos in temp folders, with the machine's facts given (no Docker, no processes, no
 * sessions), as `worktrees.test.ts` does.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { deleteBranchOnRef, deleteMergedBranch, scanWorktrees } from "./scan";

const env = cleanGitEnv();
const quiet = { containers: [], programs: [], sessions: [] };

/** A repo with a bare origin, one commit, and one worktree on `fix/login` with one commit of its own. */
function withWork(): { main: string; worktree: string } {
  const root = tempDir("against");
  const origin = join(root, "origin.git");
  const main = join(root, "app");
  mkdirSync(origin);
  git(origin, "init", "--bare", "--initial-branch=main");
  mkdirSync(main);
  git(main, "init", "--initial-branch=main");
  writeFileSync(join(main, "README.md"), "# app\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "first");
  git(main, "remote", "add", "origin", origin);
  git(main, "push", "-u", "origin", "main");
  const worktree = join(root, "app-wt-fix-login");
  git(main, "worktree", "add", "-b", "fix/login", worktree);
  writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-m", "work");
  return { main, worktree };
}

describe("scanWorktrees against a ref of the caller's", () => {
  test("every commit must be on the given ref; a local merge counts although nothing was pushed", () => {
    const { main, worktree } = withWork();
    const lead = () => ({
      label: "main, the lead's branch",
      ref: git(main, "rev-parse", "HEAD").trim(),
    });
    const options = (against: { label: string; ref: string }) => ({
      against,
      base: "main",
      claudeConfigDir: tempDir("against-config"),
      env,
      facts: quiet,
      idleLimit: 0,
    });
    expect(scanWorktrees(main, options(lead()))[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "1 commit not on main, the lead's branch",
    });

    // The lead merges locally. origin/main does not have the commit, and does not need to.
    git(main, "merge", "--ff-only", "fix/login");
    expect(scanWorktrees(main, options(lead()))[1]?.state).toEqual({
      finished: true,
      note: null,
    });
    // The same worktree, judged the usual way, is still not on origin/main.
    expect(
      scanWorktrees(main, {
        base: "main",
        claudeConfigDir: tempDir("against-config"),
        env,
        facts: quiet,
        idleLimit: 0,
      })[1]?.state,
    ).toEqual({ finished: false, held: false, why: "1 commit not on main" });
    expect(existsSync(worktree)).toBe(true);
  });

  test("a ref that is not there is refused by name, never judged against nothing", () => {
    const { main } = withWork();
    expect(() =>
      scanWorktrees(main, {
        against: { label: "the lead's branch", ref: "no-such-branch" },
        base: "main",
        claudeConfigDir: tempDir("against-config"),
        env,
        facts: quiet,
      }),
    ).toThrow("the lead's branch is not known here");
  });
});

describe("deleting a branch that a given ref holds", () => {
  test("it goes only when the ref has all of it, and the reason names that ref", () => {
    const { main, worktree } = withWork();
    git(main, "worktree", "remove", "--force", worktree);
    expect(deleteBranchOnRef(main, "main", "the lead's branch", "fix/login", env)).toBe(
      "kept branch fix/login: it has commits that are not on the lead's branch",
    );
    git(main, "merge", "--ff-only", "fix/login");
    expect(deleteBranchOnRef(main, "main", "the lead's branch", "fix/login", env)).toBe(
      "deleted branch fix/login",
    );
    expect(git(main, "branch", "--list", "fix/login")).toBe("");
  });

  test("a branch git cannot compare is kept with git's own words", () => {
    const { main } = withWork();
    expect(deleteBranchOnRef(main, "no-such-ref", "nowhere", "fix/login", env)).toStartWith(
      "kept branch fix/login:",
    );
  });

  test("the origin-based call is the same function with origin's ref", () => {
    const { main, worktree } = withWork();
    git(main, "push", "origin", "fix/login:main");
    git(main, "worktree", "remove", "--force", worktree);
    expect(deleteMergedBranch(main, "main", "fix/login", env)).toBe("deleted branch fix/login");
  });
});
