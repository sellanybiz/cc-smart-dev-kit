/** Local-ref comparisons also work for ordinary and subagent worktrees before a push. */
import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import * as gitTools from "../hooks/git";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { REMOVAL_TIMEOUT_MS } from "./clean";
import { runWorktrees } from "./command";
import * as scan from "./scan";
import { deleteBranchOnRef, deleteMergedBranch, removeWorktree, scanWorktrees } from "./scan";

const env = cleanGitEnv();
const quiet = { containers: [], programs: [], sessions: [] };
const scanOptions = () => ({
  base: "main",
  claudeConfigDir: tempDir("against-config"),
  env,
  facts: { ...quiet, mounts: [] },
  idleLimit: 0,
});

function withHolder(squash = false) {
  const fixture = withWork();
  const holder = join(tempDir("holding-worktree"), "plan");
  git(fixture.main, "worktree", "add", "-b", "plan", holder, "main");
  git(holder, "merge", squash ? "--squash" : "--no-ff", "fix/login", "-m", "merge work");
  if (squash) git(holder, "commit", "-m", "squashed work");
  return { ...fixture, holder };
}

describe("work held by a branch in another present worktree", () => {
  test("a merge commit lets the folder go but keeps its branch off the base", () => {
    const { main, worktree } = withHolder();
    const options = scanOptions();
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toEqual({ finished: true, note: "its work is held by plan" });
    if (found === undefined) throw new Error("missing builder worktree");
    expect(removeWorktree(main, found.listed, options)).toEqual({
      status: "removed",
      said: [
        `removed ${worktree}`,
        "kept branch fix/login: its work is held by plan, not yet on main",
      ],
    });
    expect(existsSync(worktree)).toBe(false);
    expect(git(main, "log", "-1", "--format=%s", "fix/login").trim()).toBe("work");
  });

  test.each(["squash", "gone", "prunable", "detached"])("%s is not a holder", (kind) => {
    const { main, worktree, holder } = withHolder(kind === "squash");
    if (kind === "gone") git(main, "worktree", "lock", holder);
    if (kind === "gone" || kind === "prunable") rmSync(holder, { recursive: true });
    if (kind === "detached") git(holder, "checkout", "--detach");
    const options = scanOptions();
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toEqual({ finished: false, held: false, why: "1 commit not on main" });
    if (found === undefined) throw new Error("missing builder worktree");
    expect(removeWorktree(main, found.listed, options).status).toBe("kept");
    expect(existsSync(worktree)).toBe(true);
  });

  test("removal rechecks the holder after a scan", () => {
    const { main, worktree, holder } = withHolder();
    const options = scanOptions();
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toMatchObject({ finished: true });
    git(holder, "reset", "--hard", "main");
    if (found === undefined) throw new Error("missing builder worktree");
    expect(removeWorktree(main, found.listed, options).status).toBe("kept");
  });
});

test.each([false, true])("removal uses the long deadline (already parked: %s)", (parked) => {
  const { main, worktree } = withWork();
  git(main, "merge", "--ff-only", "fix/login");
  const path = parked ? `${worktree}-removing-1761300000000` : worktree;
  if (parked) git(main, "worktree", "move", worktree, path);
  const options = scanOptions();
  const found = scanWorktrees(main, options).find((one) => one.listed.path === path);
  if (found === undefined) throw new Error("missing worktree");
  const realRun = gitTools.runGit;
  const timeouts: Array<number | undefined> = [];
  const spy = spyOn(gitTools, "runGit").mockImplementation((cwd, args, givenEnv, timeout, own) => {
    if (args[0] === "worktree" && args[1] === "remove") timeouts.push(timeout);
    return realRun(cwd, args, givenEnv, timeout, own);
  });
  try {
    expect(removeWorktree(main, found.listed, options).status).toBe("removed");
    expect(timeouts).toEqual([REMOVAL_TIMEOUT_MS]);
  } finally {
    spy.mockRestore();
  }
});

test("--clean finishes new strays in the same run and retains the before-list", async () => {
  const { main, worktree } = withWork();
  const paths = cliPaths({
    HOME: tempDir("clean-home"),
    CLAUDE_CONFIG_DIR: tempDir("clean-config"),
  });
  const leftovers = join(main, ".claude", "worktrees");
  mkdirSync(leftovers, { recursive: true });
  const parked = join(leftovers, "builder-removing-1761300000000");
  const before = `${worktree}-removing-1761300000000`;
  mkdirSync(before);
  const originalScan = scan.scanWorktrees;
  const scanSpy = spyOn(scan, "scanWorktrees").mockImplementation((cwd, options) =>
    originalScan(cwd, { ...options, ...scanOptions() }),
  );
  const originalRemove = scan.removeWorktree;
  const removeSpy = spyOn(scan, "removeWorktree").mockImplementation((cwd, listed, options) =>
    originalRemove(cwd, listed, { ...options, ...scanOptions() }),
  );
  const realRun = gitTools.runGit;
  const gitSpy = spyOn(gitTools, "runGit").mockImplementation(
    (cwd, args, givenEnv, timeout, own) => {
      if (args[0] === "worktree" && args[1] === "remove") {
        const result = realRun(cwd, args, givenEnv, timeout, own);
        if (!result.ok) return result;
        // Git forgot the worktree but could not finish deleting its folder.
        mkdirSync(parked);
        return { ok: false, out: "", err: "simulated interrupted deletion", code: 1 };
      }
      return realRun(cwd, args, givenEnv, timeout, own);
    },
  );
  git(main, "merge", "--ff-only", "fix/login");
  const out: string[] = [];
  try {
    expect(
      await runWorktrees(
        paths,
        { clean: true, json: false, noFetch: true, remove: null },
        env,
        main,
        { print: (line) => out.push(line), error: (line) => out.push(line) },
        async () => ({ close() {} }),
      ),
    ).toBe(0);
    expect(out.join("\n")).toContain("simulated interrupted deletion");
    expect(out.join("\n")).toContain(`removed ${parked} (left by a removal`);
    expect(out.join("\n")).toContain(`removed ${before} (left by a removal`);
    expect(existsSync(parked)).toBe(false);
    expect(existsSync(before)).toBe(false);
  } finally {
    scanSpy.mockRestore();
    removeSpy.mockRestore();
    gitSpy.mockRestore();
  }
});

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
    const local = () => ({
      label: "main, the local branch",
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
    expect(scanWorktrees(main, options(local()))[1]?.state).toEqual({
      finished: false,
      held: false,
      why: "1 commit not on main, the local branch",
    });

    // Merge locally. origin/main does not have the commit, and does not need to.
    git(main, "merge", "--ff-only", "fix/login");
    expect(scanWorktrees(main, options(local()))[1]?.state).toEqual({
      finished: true,
      note: null,
    });
    // origin/main lacks it, but the present main checkout now holds its work.
    expect(
      scanWorktrees(main, {
        base: "main",
        claudeConfigDir: tempDir("against-config"),
        env,
        facts: quiet,
        idleLimit: 0,
      })[1]?.state,
    ).toEqual({ finished: true, note: "its work is held by main" });
    expect(existsSync(worktree)).toBe(true);
  });

  test("a ref that is not there is refused by name, never judged against nothing", () => {
    const { main } = withWork();
    expect(() =>
      scanWorktrees(main, {
        against: { label: "the local branch", ref: "no-such-branch" },
        base: "main",
        claudeConfigDir: tempDir("against-config"),
        env,
        facts: quiet,
      }),
    ).toThrow("the local branch is not known here");
  });
});

describe("deleting a branch that a given ref holds", () => {
  test("it goes only when the ref has all of it, and the reason names that ref", () => {
    const { main, worktree } = withWork();
    git(main, "worktree", "remove", "--force", worktree);
    expect(deleteBranchOnRef(main, "main", "the local branch", "fix/login", env)).toBe(
      "kept branch fix/login: it has commits that are not on the local branch",
    );
    git(main, "merge", "--ff-only", "fix/login");
    expect(deleteBranchOnRef(main, "main", "the local branch", "fix/login", env)).toBe(
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
