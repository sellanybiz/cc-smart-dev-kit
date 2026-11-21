/** Local-ref comparisons also work for ordinary and subagent worktrees before a push. */
import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import * as gitTools from "../hooks/git";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { runWorktrees } from "./command";
import * as scan from "./scan";
import {
  deleteBranchOnRef,
  deleteJudgedBranch,
  deleteMergedBranch,
  judgeBranchOnRef,
  REMOVAL_TIMEOUT_MS,
  removeWorktree,
  scanWorktrees,
  tryDeleteBranch,
} from "./scan";

const env = cleanGitEnv();
const quiet = { containers: [], programs: [], sessions: [] };
const scanOptions = (claudeConfigDir = tempDir("against-config")) => ({
  base: "main",
  claudeConfigDir,
  env,
  facts: { ...quiet, mounts: [] },
  idleLimit: 0,
});

/**
 * What Claude Code writes when a builder finishes: the marker `agentFinished` reads. The
 * builder's folder is named `agent-<id>`, and it carries no lock.
 */
function markFinished(claudeConfigDir: string, worktree: string, id = "x"): void {
  const subagents = join(claudeConfigDir, "projects", "-repo", "session-1", "subagents");
  mkdirSync(subagents, { recursive: true });
  writeFileSync(
    join(subagents, `agent-${id}.meta.json`),
    JSON.stringify({ finished: true, worktreePath: worktree }),
  );
}

/** `withWork`, with the worktree a finished builder: no lock, folder `agent-x`, marker written. */
function withBuilder(): { main: string; worktree: string; claudeConfigDir: string } {
  const fixture = withWork("agent-x");
  const claudeConfigDir = tempDir("against-config");
  markFinished(claudeConfigDir, fixture.worktree);
  return { ...fixture, claudeConfigDir };
}

function withHolder(squash = false) {
  const fixture = withBuilder();
  const holder = join(tempDir("holding-worktree"), "plan");
  git(fixture.main, "worktree", "add", "-b", "plan", holder, "main");
  git(holder, "merge", squash ? "--squash" : "--no-ff", "fix/login", "-m", "merge work");
  if (squash) git(holder, "commit", "-m", "squashed work");
  return { ...fixture, holder };
}

describe("work held by a branch in another present worktree", () => {
  test("a merge commit lets the folder go but keeps its branch off the base", () => {
    const { main, worktree, claudeConfigDir } = withHolder();
    const options = scanOptions(claudeConfigDir);
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toEqual({
      finished: true,
      note: "its work is held by plan",
      heldBy: "plan",
    });
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
    const { main, worktree, holder, claudeConfigDir } = withHolder(kind === "squash");
    if (kind === "gone") git(main, "worktree", "lock", holder);
    if (kind === "gone" || kind === "prunable") rmSync(holder, { recursive: true });
    if (kind === "detached") git(holder, "checkout", "--detach");
    const options = scanOptions(claudeConfigDir);
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toEqual({ finished: false, held: false, why: "1 commit not on main" });
    if (found === undefined) throw new Error("missing builder worktree");
    expect(removeWorktree(main, found.listed, options).status).toBe("kept");
    expect(existsSync(worktree)).toBe(true);
  });

  test("removal rechecks the holder after a scan", () => {
    const { main, worktree, holder, claudeConfigDir } = withHolder();
    const options = scanOptions(claudeConfigDir);
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toMatchObject({ finished: true });
    git(holder, "reset", "--hard", "main");
    if (found === undefined) throw new Error("missing builder worktree");
    expect(removeWorktree(main, found.listed, options).status).toBe("kept");
  });
});

/** Only a builder proved finished may be judged by the branch that holds its work. */
describe("the held rule counts only for a finished builder", () => {
  // The lead's plan worktree, one commit that is not on main, and a builder cut from its head.
  function planWithBuilder(planFolder: string) {
    const { main, worktree: plan } = withWork(planFolder);
    const builder = join(tempDir("builder-root"), "agent-x");
    git(main, "worktree", "add", "-b", "builder", builder, "fix/login");
    const claudeConfigDir = tempDir("against-config");
    markFinished(claudeConfigDir, builder);
    return { main, plan, builder, claudeConfigDir };
  }

  test.each(["app-wt-plan", "agent-plan"])(
    "a plan worktree (%s) with unmerged commits is kept although a builder holds its head",
    (folder) => {
      const { main, plan, builder, claudeConfigDir } = planWithBuilder(folder);
      const options = scanOptions(claudeConfigDir);
      const scanned = scanWorktrees(main, options);
      const planScan = scanned.find((one) => one.listed.path === plan);
      expect(planScan?.state).toEqual({
        finished: false,
        held: false,
        why: "1 commit not on main",
      });
      // The builder, finished and with its work in the plan's branch, may go.
      expect(scanned.find((one) => one.listed.path === builder)?.state).toEqual({
        finished: true,
        note: "its work is held by fix/login",
        heldBy: "fix/login",
      });
      if (planScan === undefined) throw new Error("missing plan worktree");
      expect(removeWorktree(main, planScan.listed, options).status).toBe("kept");
      expect(existsSync(plan)).toBe(true);
    },
  );

  test("the mutual zero-commit pair: the finished builder goes, the plan stays", () => {
    const { main, plan, builder, claudeConfigDir } = planWithBuilder("app-wt-plan");
    const options = scanOptions(claudeConfigDir);
    const builderScan = scanWorktrees(main, options).find((one) => one.listed.path === builder);
    if (builderScan === undefined) throw new Error("missing builder worktree");
    expect(removeWorktree(main, builderScan.listed, options).status).toBe("removed");
    expect(existsSync(builder)).toBe(false);
    expect(existsSync(plan)).toBe(true);
    // The plan's branch still holds the commit, and the builder's branch stays with it.
    expect(git(main, "branch", "--list", "builder").trim()).toBe("builder");
  });

  test("a builder folder without the finished marker is judged by the base", () => {
    const { main, builder } = planWithBuilder("app-wt-plan");
    const found = scanWorktrees(main, scanOptions()).find((one) => one.listed.path === builder);
    expect(found?.state).toEqual({ finished: false, held: false, why: "1 commit not on main" });
  });

  const lockedFacts = {
    ...quiet,
    mounts: [],
    platform: "linux" as const,
    pidNamespace: "pid:[4026531836]",
    processIsGone: () => true,
    processStartTime: () => "proc:123",
    agentFinished: () => true,
  };

  test("a locked builder whose session ended, finished, with its work in a plan branch, goes", () => {
    const { main, worktree } = withWork("app-wt-fix-login");
    const holder = join(tempDir("holding-worktree"), "plan");
    git(main, "worktree", "add", "-b", "plan", holder, "main");
    git(holder, "merge", "--no-ff", "fix/login", "-m", "merge work");
    git(
      main,
      "worktree",
      "lock",
      "--reason",
      "claude agent agent-x (pid 424242 start 123)",
      worktree,
    );
    const options = { ...scanOptions(), facts: lockedFacts };
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toEqual({
      finished: true,
      note: "its work is held by plan",
      heldBy: "plan",
    });
  });

  test("a session lock that is stale does not count the held rule", () => {
    const { main, worktree } = withWork("app-wt-fix-login");
    const holder = join(tempDir("holding-worktree"), "plan");
    git(main, "worktree", "add", "-b", "plan", holder, "main");
    git(holder, "merge", "--no-ff", "fix/login", "-m", "merge work");
    git(
      main,
      "worktree",
      "lock",
      "--reason",
      "claude session lead (pid 424242 start 123)",
      worktree,
    );
    const options = { ...scanOptions(), facts: lockedFacts };
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    expect(found?.state).toEqual({ finished: false, held: false, why: "1 commit not on main" });
    if (found === undefined) throw new Error("missing worktree");
    expect(removeWorktree(main, found.listed, options).status).toBe("kept");
    expect(existsSync(worktree)).toBe(true);
  });
});

test.each([false, true])("removal uses the long deadline (already parked: %s)", (parked) => {
  const { main, worktree, claudeConfigDir } = withBuilder();
  git(main, "merge", "--ff-only", "fix/login");
  const path = parked ? `${worktree}-removing-1761300000000` : worktree;
  if (parked) git(main, "worktree", "move", worktree, path);
  const options = scanOptions(claudeConfigDir);
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
  const { main, worktree, claudeConfigDir } = withBuilder();
  const paths = cliPaths({
    HOME: tempDir("clean-home"),
    CLAUDE_CONFIG_DIR: tempDir("clean-config"),
  });
  // A folder an earlier removal left beside the worktree, outside `.claude/worktrees`.
  const before = `${worktree}-removing-1761300000000`;
  mkdirSync(before);
  // The folder THIS clean parks: `removeWorktree` names it, and the fake remove recreates it.
  const parked: string[] = [];
  const originalScan = scan.scanWorktrees;
  const scanSpy = spyOn(scan, "scanWorktrees").mockImplementation((cwd, options) =>
    originalScan(cwd, { ...options, ...scanOptions(claudeConfigDir) }),
  );
  const originalRemove = scan.removeWorktree;
  const removeSpy = spyOn(scan, "removeWorktree").mockImplementation((cwd, listed, options) =>
    originalRemove(cwd, listed, { ...options, ...scanOptions(claudeConfigDir) }),
  );
  const realRun = gitTools.runGit;
  const gitSpy = spyOn(gitTools, "runGit").mockImplementation(
    (cwd, args, givenEnv, timeout, own) => {
      if (args[0] === "worktree" && args[1] === "remove") {
        const result = realRun(cwd, args, givenEnv, timeout, own);
        if (!result.ok) return result;
        // Git forgot the worktree but could not finish deleting its folder.
        const folder = args.at(-1);
        if (folder === undefined) throw new Error("git worktree remove named no folder");
        mkdirSync(folder);
        parked.push(folder);
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
    expect(parked).toHaveLength(1);
    expect(parked[0]).toStartWith(`${worktree}-removing-`);
    expect(out.join("\n")).toContain(`removed ${parked[0]} (left by a removal`);
    expect(out.join("\n")).toContain(`removed ${before} (left by a removal`);
    expect(existsSync(parked[0] ?? "")).toBe(false);
    expect(existsSync(before)).toBe(false);
  } finally {
    scanSpy.mockRestore();
    removeSpy.mockRestore();
    gitSpy.mockRestore();
  }
});

/** A repo with a bare origin, one commit, and one worktree on `fix/login` with one commit of its own. */
function withWork(folder = "app-wt-fix-login"): { main: string; worktree: string } {
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
  const worktree = join(root, folder);
  git(main, "worktree", "add", "-b", "fix/login", worktree);
  writeFileSync(join(worktree, "work.ts"), "export const x = 1;\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-m", "work");
  return { main, worktree };
}

describe("scanWorktrees against a ref of the caller's", () => {
  test("every commit must be on the given ref; a local merge counts although nothing was pushed", () => {
    const { main, worktree, claudeConfigDir } = withBuilder();
    const local = () => ({
      label: "main, the local branch",
      ref: git(main, "rev-parse", "HEAD").trim(),
    });
    const options = (against: { label: string; ref: string }) => ({
      against,
      base: "main",
      claudeConfigDir,
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
        claudeConfigDir,
        env,
        facts: quiet,
        idleLimit: 0,
      })[1]?.state,
    ).toEqual({ finished: true, note: "its work is held by main", heldBy: "main" });
    expect(existsSync(worktree)).toBe(true);
  });

  test("the holder named like the base says which ref lacks the work", () => {
    const { main, worktree, claudeConfigDir } = withBuilder();
    git(main, "merge", "--ff-only", "fix/login");
    const options = scanOptions(claudeConfigDir);
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    if (found === undefined) throw new Error("missing builder worktree");
    expect(removeWorktree(main, found.listed, options).said).toEqual([
      `removed ${worktree}`,
      "kept branch fix/login: its work is held by main, not yet on origin/main",
    ]);
  });

  test("with no holder left the same worktree is kept, as its commit is not on main", () => {
    const { main, worktree } = withWork();
    git(main, "merge", "--ff-only", "fix/login");
    git(main, "checkout", "--detach");
    const found = scanWorktrees(main, scanOptions()).find((one) => one.listed.path === worktree);
    expect(found?.state).toEqual({ finished: false, held: false, why: "1 commit not on main" });
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

describe("the outcome of a branch deletion, as data", () => {
  test("deleted, not on the ref, and git's own refusal each have their own kind", () => {
    const { main, worktree } = withWork();
    git(main, "worktree", "remove", "--force", worktree);
    expect(tryDeleteBranch(main, "main", "main", "fix/login", env)).toEqual({ kind: "not-on-ref" });
    expect(tryDeleteBranch(main, "no-such-ref", "nowhere", "fix/login", env).kind).toBe(
      "git-error",
    );
    git(main, "merge", "--ff-only", "fix/login");
    expect(tryDeleteBranch(main, "main", "main", "fix/login", env)).toEqual({ kind: "deleted" });
  });

  test("a branch that moved after it was judged is kept: only the judged commit is deleted", () => {
    const { main, worktree } = withWork();
    git(main, "worktree", "remove", "--force", worktree);
    git(main, "merge", "--ff-only", "fix/login");
    const judged = judgeBranchOnRef(main, "main", "main", "fix/login", env);
    if (judged.kind !== "on-ref") throw new Error("the merged branch should be on main");
    // New work lands on the branch between the judge and the delete.
    git(main, "checkout", "-q", "fix/login");
    git(main, "commit", "--allow-empty", "-m", "late work");
    git(main, "checkout", "-q", "main");
    const outcome = deleteJudgedBranch(main, "fix/login", judged.sha, env);
    expect(outcome).toEqual({
      kind: "git-error",
      text: "it moved after it was judged, so it stays",
    });
    expect(git(main, "branch", "--list", "fix/login")).toContain("fix/login");
    // Still at the judged commit, it goes.
    git(main, "branch", "-f", "fix/login", judged.sha);
    expect(deleteJudgedBranch(main, "fix/login", judged.sha, env)).toEqual({ kind: "deleted" });
    expect(git(main, "branch", "--list", "fix/login")).toBe("");
  });

  test("a branch a worktree has checked out is kept, with the folder named", () => {
    const { main, worktree } = withWork();
    git(main, "merge", "--ff-only", "fix/login");
    const judged = judgeBranchOnRef(main, "main", "main", "fix/login", env);
    if (judged.kind !== "on-ref") throw new Error("the merged branch should be on main");
    expect(deleteJudgedBranch(main, "fix/login", judged.sha, env)).toEqual({
      kind: "git-error",
      text: `a worktree has it checked out, at ${worktree}`,
    });
    expect(git(main, "branch", "--list", "fix/login")).toContain("fix/login");
  });

  test("git's refusal keeps git's words and is never rewritten as a held branch", () => {
    const { main, worktree } = withWork();
    // Merged, so the branch may go — but a second worktree still stands on it.
    git(main, "merge", "--ff-only", "fix/login");
    git(main, "push", "origin", "main");
    const second = join(tempDir("second-checkout"), "again");
    git(main, "worktree", "add", "--force", second, "fix/login");
    const options = scanOptions();
    const found = scanWorktrees(main, options).find((one) => one.listed.path === worktree);
    if (found === undefined) throw new Error("missing builder worktree");
    const said = removeWorktree(main, found.listed, options).said;
    expect(said[0]).toBe(`removed ${worktree}`);
    expect(said[1]).toStartWith("kept branch fix/login: ");
    expect(said[1]).not.toContain("held by");
  });
});

test("a worktree on the same branch is not its holder", () => {
  const { main, worktree } = withWork();
  const second = join(tempDir("second-checkout"), "again");
  git(main, "worktree", "add", "--force", second, "fix/login");
  const found = scanWorktrees(main, scanOptions()).find((one) => one.listed.path === worktree);
  expect(found?.state).toEqual({ finished: false, held: false, why: "1 commit not on main" });
});
