/**
 * `checkBranch`: the verdict `workflow merge-check --branch` prints for a local branch (D22), and
 * the review gate's own numbers it carries for the portal's project page (`MergeDetail`).
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
import {
  checkBranch,
  checkPullRequest,
  type GhRunner,
  type MergeWorld,
  policyUnread,
} from "./merge-check";
import { reviewsFile } from "./reviews";

test("a missing origin base names the first push and repeat check", () => {
  const reason = policyUnread(
    "lead-plan",
    "origin/lead-plan is not known in this repository (no origin, or the branch was never fetched)",
  );
  expect(reason).toContain("git push -u origin lead-plan");
  expect(reason).toContain("run merge-check again");
});

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
          by: ["cc-smart-dev-kit:senior-engineer"],
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

test("merge-check keeps the origin trust boundary for an unpushed lead base", async () => {
  const { env, repo } = branchWorld();
  git(repo, "branch", "lead-plan", "main");
  const verdict = await checkBranch(worldOf(repo, env), { base: "lead-plan", branch: "feat" });
  expect(verdict).toMatchObject({ kind: "refused" });
  expect("reason" in verdict ? verdict.reason : "").toContain("git push -u origin lead-plan");
  expect("reason" in verdict ? verdict.reason : "").toContain("run merge-check again");
});

const LIMITS = { files: 10, lines: 200, percent: 20 };

describe("checkBranch's review detail", () => {
  test("a reviewed branch with a small fix: the review, the change after it, and the limits", async () => {
    const { env, repo, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    const head = commitFiles(repo, { "src/a.txt": numbered(65, "a") }, "fix");
    expect(await checkBranch(worldOf(repo, env), { base: "main", branch: "feat" })).toEqual({
      detail: {
        allowance: { files: 10, lines: 200 },
        delta: { binary: 0, files: 1, lines: 5 },
        limits: LIMITS,
        review: reviewed,
        reviewed: { binary: 0, files: 2, lines: 100 },
      },
      kind: "allowed",
      reason: `the review of ${reviewed.slice(0, 7)} covers ${head.slice(0, 7)}, with the fixes after it within the limits`,
    });
  });

  test("a review of the head itself: no change after it, and none in the detail", async () => {
    const { env, repo, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    expect(await checkBranch(worldOf(repo, env), { base: "main", branch: "feat" })).toEqual({
      detail: { allowance: null, delta: null, limits: LIMITS, review: reviewed, reviewed: null },
      kind: "allowed",
      reason: `the review of ${reviewed.slice(0, 7)} is of ${reviewed.slice(0, 7)} itself`,
    });
  });

  test("a rewrite over the limit: the refused verdict names the measured change and the limits", async () => {
    const { env, repo, reviewed } = branchWorld();
    recordReview(env, repo, reviewed, "feat");
    rmSync(join(repo, "src/a.txt"));
    rmSync(join(repo, "src/b.txt"));
    commitFiles(repo, { "src/c.txt": numbered(500, "c") }, "rewrite");
    const verdict = await checkBranch(worldOf(repo, env), { base: "main", branch: "feat" });
    expect(verdict.kind).toBe("refused");
    expect(verdict).toMatchObject({
      detail: {
        allowance: { files: 10, lines: 200 },
        delta: { binary: 0, files: 3, lines: 600 },
        limits: LIMITS,
        review: reviewed,
        reviewed: { binary: 0, files: 2, lines: 100 },
      },
      kind: "refused",
      number: null,
    });
  });

  test("no review recorded: refused, and the detail still carries the gate's limits", async () => {
    const { env, repo } = branchWorld();
    expect(await checkBranch(worldOf(repo, env), { base: "main", branch: "feat" })).toMatchObject({
      detail: { allowance: null, delta: null, limits: LIMITS, review: null, reviewed: null },
      kind: "refused",
      number: null,
    });
  });

  test("reviewBeforePush off: no review is required, and the limits still show", async () => {
    const { env, repo } = branchWorld({ workflow: { reviewBeforePush: false } });
    const verdict = await checkBranch(worldOf(repo, env), { base: "main", branch: "feat" });
    expect(verdict).toMatchObject({
      detail: { allowance: null, delta: null, limits: LIMITS, review: null, reviewed: null },
      kind: "allowed",
    });
  });

  test("a branch that is not in this checkout: the gate was never read, so no detail", async () => {
    const { env, repo } = branchWorld();
    expect(await checkBranch(worldOf(repo, env), { base: "main", branch: "nowhere" })).toEqual({
      detail: null,
      kind: "refused",
      number: null,
      reason: "branch nowhere is not in this checkout",
    });
  });
});

/**
 * `checkPullRequest`: the whole policy of a merge nobody watches. `merge-check` is the one gate
 * before such a merge into the integration base or the default branch, so each condition has
 * its own case: allowMerge, the base, the required checks, the recorded review of the head, and
 * the fixes after it.
 */
describe("checkPullRequest: every condition of an unattended merge", () => {
  /** gh as a pull request into `base` meets it: the view, the default branch, the checks. */
  function ghFor(base: string, head: string, checks: string | null): GhRunner {
    return async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({
          baseRefName: base,
          headRefName: "feat",
          headRefOid: head,
          number: 7,
        });
      }
      if (args[0] === "repo" && args[1] === "view") {
        return JSON.stringify({ defaultBranchRef: { name: "main" } });
      }
      if (args[0] === "pr" && args[1] === "checks") return checks;
      return null;
    };
  }
  const GREEN = JSON.stringify([{ bucket: "pass", name: "ci" }]);
  const ON = { workflow: { allowMerge: true } };

  /** The world of `branchWorld`, with a gh runner and `origin/<base>` pointing at the policy. */
  function prWorld(
    policy: Record<string, unknown>,
    base: string,
    head: (built: ReturnType<typeof branchWorld>) => string,
    checks: string | null,
    review: boolean,
  ) {
    const built = branchWorld(policy);
    if (base !== "main") git(built.repo, "update-ref", `refs/remotes/origin/${base}`, "main");
    if (review) recordReview(built.env, built.repo, built.reviewed, "feat");
    const sha = head(built);
    const world: MergeWorld = {
      ...worldOf(built.repo, built.env),
      gh: ghFor(base, sha, checks),
    };
    return { ...built, world };
  }
  const check = (world: MergeWorld) => checkPullRequest(world, { ref: "7", repo: null }, new Map());
  const reasonOf = (verdict: Awaited<ReturnType<typeof check>>) =>
    "reason" in verdict ? verdict.reason : "what" in verdict ? verdict.what : "";

  test("all conditions met: allowMerge on, green required checks, the head's review recorded: allowed", async () => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true);
    const verdict = await check(world);
    expect(verdict.kind).toBe("allowed");
    expect(reasonOf(verdict)).toContain("its required checks are green");
  });

  test.each([
    ["pending", JSON.stringify([{ bucket: "pending", name: "ci" }]), "ci (pending)"],
    ["failed", JSON.stringify([{ bucket: "fail", name: "ci" }]), "ci (fail)"],
    [
      "one of several failed",
      JSON.stringify([
        { bucket: "pass", name: "lint" },
        { bucket: "fail", name: "ci" },
      ]),
      "ci (fail)",
    ],
    ["missing: gh lists none", "[]", "gh reports no required checks"],
  ])("a required check that is %s refuses, with its reason", async (_what, checks, reason) => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, checks, true);
    const verdict = await check(world);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain(reason);
  });

  test("checks gh cannot read: not read, never allowed", async () => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, null, true);
    const verdict = await check(world);
    expect(verdict.kind).toBe("unread");
    expect(reasonOf(verdict)).toContain("required checks");
  });

  test("no recorded review of the head: refused, and the detail has no review", async () => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, false);
    expect(await check(world)).toMatchObject({ detail: { review: null }, kind: "refused" });
  });

  test("fixes after the review within fixesAfterReview: allowed; over the limit: refused", async () => {
    const small = prWorld(
      ON,
      "main",
      (built) => commitFiles(built.repo, { "src/a.txt": numbered(65, "a") }, "fix"),
      GREEN,
      true,
    );
    expect((await check(small.world)).kind).toBe("allowed");
    const big = prWorld(
      ON,
      "main",
      (built) => {
        rmSync(join(built.repo, "src/a.txt"));
        rmSync(join(built.repo, "src/b.txt"));
        return commitFiles(built.repo, { "src/c.txt": numbered(500, "c") }, "rewrite");
      },
      GREEN,
      true,
    );
    expect(await check(big.world)).toMatchObject({
      detail: { delta: { files: 3, lines: 600 }, limits: LIMITS },
      kind: "refused",
    });
  });

  test("a base that is neither the integration base nor the default branch: refused", async () => {
    const { world } = prWorld(ON, "release/1", (built) => built.reviewed, GREEN, true);
    const verdict = await check(world);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain(
      "not the project's integration base main or the repository's default branch main",
    );
  });

  test("allowMerge off: refused, naming the setting", async () => {
    const { world } = prWorld(
      { workflow: { allowMerge: false } },
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
    );
    const verdict = await check(world);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("allowMerge is off");
  });
});

/**
 * `checkPullRequest` with `asked`: the person said yes to this merge. That yes sets aside the
 * `allowMerge` switch and nothing else, so each other condition keeps its own refusing case.
 */
describe("checkPullRequest: the person's yes sets aside only allowMerge", () => {
  function ghFor(base: string, head: string, checks: string | null): GhRunner {
    return async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({
          baseRefName: base,
          headRefName: "feat",
          headRefOid: head,
          number: 7,
        });
      }
      if (args[0] === "repo" && args[1] === "view") {
        return JSON.stringify({ defaultBranchRef: { name: "main" } });
      }
      if (args[0] === "pr" && args[1] === "checks") return checks;
      return null;
    };
  }
  const GREEN = JSON.stringify([{ bucket: "pass", name: "ci" }]);
  const RED = JSON.stringify([{ bucket: "fail", name: "ci" }]);
  const OFF = { workflow: { allowMerge: false } };

  /** `allowMerge` off unless `policy` says otherwise; the review recorded unless `review` is off. */
  function prWorld(opts: {
    base?: string;
    checks: string | null;
    policy?: Record<string, unknown>;
    review?: boolean;
  }) {
    const base = opts.base ?? "main";
    const built = branchWorld(opts.policy ?? OFF);
    if (base !== "main") git(built.repo, "update-ref", `refs/remotes/origin/${base}`, "main");
    if (opts.review ?? true) recordReview(built.env, built.repo, built.reviewed, "feat");
    return { ...worldOf(built.repo, built.env), gh: ghFor(base, built.reviewed, opts.checks) };
  }
  const check = (world: MergeWorld, asked: boolean) =>
    checkPullRequest(world, { ref: "7", repo: null }, new Map(), { asked });
  const reasonOf = (verdict: Awaited<ReturnType<typeof check>>) =>
    "reason" in verdict ? verdict.reason : "what" in verdict ? verdict.what : "";

  test("allowMerge off, asked, checks green, the review covers the head: allowed, on the person's yes", async () => {
    const verdict = await check(prWorld({ checks: GREEN }), true);
    expect(verdict.kind).toBe("allowed");
    expect(reasonOf(verdict)).toContain("rests on the person's yes");
    expect(reasonOf(verdict)).toContain("allowMerge, which is off");
    expect(reasonOf(verdict)).toContain("its required checks are green");
  });

  test("allowMerge off, asked, a red required check: refused for the check", async () => {
    const verdict = await check(prWorld({ checks: RED }), true);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("ci (fail)");
  });

  test("allowMerge off, asked, no required checks listed: refused, nothing green to trust", async () => {
    const verdict = await check(prWorld({ checks: "[]" }), true);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("gh reports no required checks");
  });

  test("allowMerge off, asked, checks gh cannot read: not read, never allowed", async () => {
    expect((await check(prWorld({ checks: null }), true)).kind).toBe("unread");
  });

  test("allowMerge off, asked, no recorded review of the head: refused for the review", async () => {
    const verdict = await check(prWorld({ checks: GREEN, review: false }), true);
    expect(verdict).toMatchObject({ detail: { review: null }, kind: "refused" });
    expect(reasonOf(verdict)).toContain("reviewBeforePush is on");
  });

  test("allowMerge off, asked, a base the rules refuse: refused for the base, not for allowMerge", async () => {
    const verdict = await check(prWorld({ base: "release/1", checks: GREEN }), true);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain(
      "not the project's integration base main or the repository's default branch main",
    );
    expect(reasonOf(verdict)).not.toContain("allowMerge");
  });

  test("allowMerge off, asked, reviewBeforePush off: no review is required, so allowed", async () => {
    const policy = { workflow: { allowMerge: false, reviewBeforePush: false } };
    const verdict = await check(prWorld({ checks: GREEN, policy, review: false }), true);
    expect(verdict.kind).toBe("allowed");
    expect(reasonOf(verdict)).toContain("rests on the person's yes");
  });

  test("allowMerge off, not asked: refused as before, naming the setting", async () => {
    const verdict = await check(prWorld({ checks: GREEN }), false);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("allowMerge is off");
  });

  test("allowMerge off, no options passed: the same refusal as asked false", async () => {
    const world = prWorld({ checks: GREEN });
    const verdict = await checkPullRequest(world, { ref: "7", repo: null }, new Map());
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("allowMerge is off");
  });

  test("allowMerge on and asked: allowed on allowMerge, the person's yes not claimed", async () => {
    const policy = { workflow: { allowMerge: true } };
    const verdict = await check(prWorld({ checks: GREEN, policy }), true);
    expect(verdict.kind).toBe("allowed");
    expect(reasonOf(verdict)).not.toContain("person's yes");
  });
});
