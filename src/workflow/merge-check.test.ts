/**
 * `checkBranch`: the verdict a lead's hand-back gate reads (D22), and the review gate's own
 * numbers it now carries for the portal's crew page (`MergeDetail`).
 *
 * The cases run in a real clone of a bare origin, so `readCover` really measures the fixes:
 * a review of 100 lines in 2 files, then a fix, exactly as `workflow merge-check` sees them.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { locateCheckout } from "../project/resolve";
import { hookEnv, makeClone, writeClaudeFile } from "../testing/hooks";
import { git } from "../testing/temp";
import { checkBranch, type MergeWorld } from "./merge-check";
import { reviewsFile } from "./reviews";

/** The project's policy as committed on `main`: the defaults the gate reads. */
const POLICY = {
  protectedBranches: ["main"],
  requires: ">=0.1",
  sessionNames: true,
  worktrees: { base: "main" },
};

/** `n` lines `a 1` … `a n`, each ending in a newline. */
function numbered(n: number, tag: string): string {
  return Array.from({ length: n }, (_, index) => `${tag} ${index + 1}\n`).join("");
}

/** Writes each file, commits everything, and returns the new commit. */
function commitFiles(repo: string, files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD").trim();
}

/** The review record of `repo` in `env`: `sha` reviewed by the plugin's reviewer on `branch`. */
function recordReview(
  env: Record<string, string>,
  repo: string,
  sha: string,
  branch: string,
): void {
  const file = reviewsFile(cliPaths(env).stateDir, repo);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        [sha]: {
          at: "2026-10-21T10:00:00.000Z",
          branches: [branch],
          by: ["cc-smart-dev-kit:reviewer"],
        },
      },
      null,
      2,
    )}\n`,
  );
}

/** The merge check's world for `repo`: the checkout, the environment and the clock. */
function worldOf(repo: string, env: Record<string, string>): MergeWorld {
  const checkout = locateCheckout(repo, { env });
  if (checkout === null) throw new Error("the test's repo is not a git checkout");
  return {
    checkout,
    env,
    folder: repo,
    paths: cliPaths(env),
    timeFor: (limitMs) => limitMs,
  };
}

/** A clone whose `main` carries the policy, on a `feat` branch with 100 reviewed lines. */
function branchWorld(policy: Record<string, unknown> = {}): {
  env: Record<string, string>;
  repo: string;
  reviewed: string;
} {
  const { repo } = makeClone();
  const env = hookEnv();
  writeClaudeFile(repo, "cc-smart-dev-kit.json", { ...POLICY, ...policy });
  git(repo, "add", ".claude/cc-smart-dev-kit.json");
  git(repo, "commit", "-q", "-m", "the project's policy");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repo, "checkout", "-q", "-b", "feat");
  const reviewed = commitFiles(
    repo,
    { "src/a.txt": numbered(60, "a"), "src/b.txt": numbered(40, "b") },
    "reviewed",
  );
  return { env, repo, reviewed };
}

const LIMITS = { files: 10, lines: 200, percent: 20 };

describe("checkBranch's review detail", () => {
  test("a reviewed branch with a small fix: the review, the change after it, and the limits", () => {
    const { env, repo, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    const head = commitFiles(repo, { "src/a.txt": numbered(65, "a") }, "fix");
    expect(checkBranch(worldOf(repo, env), { base: "main", branch: "feat" })).toEqual({
      detail: {
        allowance: { files: 10, lines: 200 },
        delta: { files: 1, lines: 5 },
        limits: LIMITS,
        review: reviewed,
        reviewed: { files: 2, lines: 100 },
      },
      kind: "allowed",
      reason: `the review of ${reviewed.slice(0, 7)} covers ${head.slice(0, 7)}, with the fixes after it within the limits`,
    });
  });

  test("a review of the head itself: no change after it, and none in the detail", () => {
    const { env, repo, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    expect(checkBranch(worldOf(repo, env), { base: "main", branch: "feat" })).toEqual({
      detail: { allowance: null, delta: null, limits: LIMITS, review: reviewed, reviewed: null },
      kind: "allowed",
      reason: `the review of ${reviewed.slice(0, 7)} is of ${reviewed.slice(0, 7)} itself`,
    });
  });

  test("a rewrite over the limit: the refused verdict names the measured change and the limits", () => {
    const { env, repo, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    rmSync(join(repo, "src/a.txt"));
    rmSync(join(repo, "src/b.txt"));
    commitFiles(repo, { "src/c.txt": numbered(500, "c") }, "rewrite");
    const verdict = checkBranch(worldOf(repo, env), { base: "main", branch: "feat" });
    expect(verdict.kind).toBe("refused");
    expect(verdict).toMatchObject({
      detail: {
        allowance: { files: 10, lines: 200 },
        delta: { files: 3, lines: 600 },
        limits: LIMITS,
        review: reviewed,
        reviewed: { files: 2, lines: 100 },
      },
      kind: "refused",
      number: null,
    });
  });

  test("no review recorded: refused, and the detail still carries the gate's limits", () => {
    const { env, repo } = branchWorld();
    expect(checkBranch(worldOf(repo, env), { base: "main", branch: "feat" })).toMatchObject({
      detail: { allowance: null, delta: null, limits: LIMITS, review: null, reviewed: null },
      kind: "refused",
      number: null,
    });
  });

  test("reviewBeforePush off: no review is required, and the limits still show", () => {
    const { env, repo } = branchWorld({ workflow: { reviewBeforePush: false } });
    const verdict = checkBranch(worldOf(repo, env), { base: "main", branch: "feat" });
    expect(verdict).toMatchObject({
      detail: { allowance: null, delta: null, limits: LIMITS, review: null, reviewed: null },
      kind: "allowed",
    });
  });

  test("a branch that is not in this checkout: the gate was never read, so no detail", () => {
    const { env, repo } = branchWorld();
    expect(checkBranch(worldOf(repo, env), { base: "main", branch: "nowhere" })).toEqual({
      detail: null,
      kind: "refused",
      number: null,
      reason: "branch nowhere is not in this checkout",
    });
  });
});
