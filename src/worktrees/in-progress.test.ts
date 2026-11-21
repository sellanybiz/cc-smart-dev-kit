/**
 * What git leaves in a worktree while a bisect, a rebase, a merge, a cherry-pick or a revert is
 * unfinished: read once per worktree, with one git call.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as gitTools from "../hooks/git";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { branchInProgressWhy, inProgressWhy } from "./in-progress";

const env = cleanGitEnv();

/** A git command that is expected to stop half way (a conflict), so it must not throw. */
function stops(cwd: string, ...args: string[]): void {
  const run = Bun.spawnSync(["git", ...args], { cwd, env, stderr: "pipe", stdout: "pipe" });
  expect(run.exitCode).not.toBe(0);
}

/**
 * A repo whose `main` and `other` change the same line, so a merge, a cherry-pick, a revert and a
 * rebase of one onto the other each stop on a conflict; and a linked worktree `side` on `fix/side`.
 */
function repo() {
  const root = tempDir("in-progress");
  const main = join(root, "app");
  mkdirSync(main);
  git(main, "init", "--initial-branch=main");
  writeFileSync(join(main, "file.txt"), "one\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "first");
  git(main, "checkout", "-q", "-b", "other");
  writeFileSync(join(main, "file.txt"), "other\n");
  git(main, "commit", "-am", "other change");
  git(main, "checkout", "-q", "main");
  writeFileSync(join(main, "file.txt"), "main\n");
  git(main, "commit", "-am", "main change");
  const side = join(root, "side");
  git(main, "worktree", "add", "-q", "-b", "fix/side", side, "main");
  return { main, side };
}

describe("an operation in progress in a worktree", () => {
  test("nothing in progress is null, for the folder and for any branch", () => {
    const { main, side } = repo();
    expect(inProgressWhy(side, env)).toBeNull();
    expect(inProgressWhy(main, env)).toBeNull();
    expect(branchInProgressWhy(side, "fix/side", env)).toBeNull();
  });

  test.each([
    ["a merge", ["merge", "other"]],
    ["a cherry-pick", ["cherry-pick", "other"]],
    ["a revert", ["revert", "main~1"]],
    ["a rebase", ["rebase", "other"]],
  ])("%s that stopped on a conflict is said", (what, args) => {
    const { side } = repo();
    stops(side, ...(args as string[]));
    expect(inProgressWhy(side, env)).toBe(`${what} is in progress`);
  });

  test("a bisect is said", () => {
    const { side } = repo();
    git(side, "commit", "--allow-empty", "-m", "two");
    git(side, "commit", "--allow-empty", "-m", "three");
    git(side, "bisect", "start", "HEAD", "HEAD~2");
    expect(inProgressWhy(side, env)).toBe("a bisect is in progress");
    git(side, "bisect", "reset");
    expect(inProgressWhy(side, env)).toBeNull();
  });

  test("a git am stopped in the middle of a series is said, though it leaves no head-name", () => {
    const { main, side } = repo();
    // Two patches from `one`: the first adds a file, the second changes the line main changed.
    git(main, "checkout", "-q", "-b", "series", "main~1");
    writeFileSync(join(main, "added.txt"), "added\n");
    git(main, "add", "added.txt");
    git(main, "commit", "-m", "add a file");
    writeFileSync(join(main, "file.txt"), "series\n");
    git(main, "commit", "-am", "series change");
    const patches = tempDir("patches");
    git(main, "format-patch", "-q", "-o", patches, "main~1..series");
    git(main, "checkout", "-q", "main");
    const files = readdirSync(patches)
      .sort()
      .map((name) => join(patches, name));
    stops(side, "am", ...files);
    expect(inProgressWhy(side, env)).toBe("a git am is in progress");
  });

  test("a cherry-pick series after its conflicting commit is committed is still said", () => {
    const { main, side } = repo();
    git(main, "checkout", "-q", "-b", "extra", "main");
    writeFileSync(join(main, "extra.txt"), "extra\n");
    git(main, "add", "extra.txt");
    git(main, "commit", "-m", "extra");
    git(main, "checkout", "-q", "main");
    // `other` conflicts; `extra` waits in the series.
    stops(side, "cherry-pick", "other", "extra");
    writeFileSync(join(side, "file.txt"), "resolved\n");
    git(side, "add", "file.txt");
    // A plain commit ends that pick (CHERRY_PICK_HEAD goes) and leaves the rest of the series.
    git(side, "commit", "--no-edit");
    expect(inProgressWhy(side, env)).toBe("a cherry-pick or revert series is in progress");
  });

  test("only the worktree that runs it is in progress, not its sibling", () => {
    const { main, side } = repo();
    stops(side, "merge", "other");
    expect(inProgressWhy(main, env)).toBeNull();
  });

  test("a folder that is gone has nothing in progress", () => {
    const { side } = repo();
    rmSync(side, { recursive: true });
    expect(inProgressWhy(side, env)).toBeNull();
    expect(branchInProgressWhy(side, "fix/side", env)).toBeNull();
  });

  test("git is asked once for all the files, not once for each", () => {
    const { side } = repo();
    const real = gitTools.runGit;
    const spy = spyOn(gitTools, "runGit").mockImplementation((...args) => real(...args));
    try {
      inProgressWhy(side, env);
      const asked = spy.mock.calls.filter((call) => call[1].includes("--git-path"));
      expect(asked).toHaveLength(1);
      expect(asked[0]?.[1].filter((word) => word === "--git-path").length).toBeGreaterThanOrEqual(
        6,
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("when git cannot answer, nothing is proved, so it is in progress and says why", () => {
    const { side } = repo();
    const spy = spyOn(gitTools, "runGit").mockReturnValue({
      code: 128,
      err: "fatal: not a git repository",
      ok: false,
      out: "",
    });
    try {
      expect(inProgressWhy(side, env)).toContain("fatal: not a git repository");
      expect(inProgressWhy(side, env)).toContain("kept");
      expect(branchInProgressWhy(side, "fix/side", env)).toContain("not proved");
    } finally {
      spy.mockRestore();
    }
  });

  test("an answer with the wrong number of lines is read as unreadable, never as nothing", () => {
    const { side } = repo();
    const spy = spyOn(gitTools, "runGit").mockReturnValue({ code: 0, err: "", ok: true, out: "" });
    try {
      expect(inProgressWhy(side, env)).toContain("kept");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("a branch a worktree is bisecting or rebasing", () => {
  test("a bisect names the branch it started on, and no other", () => {
    const { side } = repo();
    git(side, "commit", "--allow-empty", "-m", "two");
    git(side, "commit", "--allow-empty", "-m", "three");
    git(side, "bisect", "start", "HEAD", "HEAD~2");
    expect(branchInProgressWhy(side, "fix/side", env)).toBe(
      `a worktree is bisecting or rebasing it, at ${side}`,
    );
    expect(branchInProgressWhy(side, "fix/other", env)).toBeNull();
  });

  test("a rebase names the branch it rewrites", () => {
    const { side } = repo();
    stops(side, "rebase", "other");
    expect(branchInProgressWhy(side, "fix/side", env)).toBe(
      `a worktree is bisecting or rebasing it, at ${side}`,
    );
  });

  test("a merge or a cherry-pick names no branch, so it keeps none", () => {
    const { side } = repo();
    stops(side, "merge", "other");
    expect(branchInProgressWhy(side, "fix/side", env)).toBeNull();
  });
});
