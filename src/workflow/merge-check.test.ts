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
  newStackCache,
  OPEN_PULL_REQUESTS_LIMIT,
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

/** The head of another open pull request, which a stacked pull request carries. */
const BELOW = "b".repeat(40);

/** What gh answers to the stacked questions; null is a gh that cannot answer. */
interface StackAnswers {
  /**
   * `gh api repos/{owner}/{repo}/compare/<basehead>?per_page=1 --jq '.status + " " +
   * .merge_base_commit.sha'`: the status and the merge base, by `BASE...HEAD` (a branch name
   * arrives encoded, as gh is given it).
   */
  compare: (basehead: string) => string | null;
  /** `gh pr list --state open --json number,headRefOid`. */
  open: string | null;
}

/** The commit every history below grows from: the one merge base of otherwise unrelated work. */
const ROOT = "9".repeat(40);

/** The open pull requests `gh pr list --json number,headRefOid` prints. */
function openJson(...open: Array<[number, string]>): string {
  return JSON.stringify(open.map(([number, headRefOid]) => ({ headRefOid, number })));
}

/**
 * GitHub's compare over a small history, as `gh api` prints it (`status merge-base`):
 * `descends` lists [parent, commit] pairs, `inBase` the commits `main` already holds. A commit
 * with no parent listed grows from `ROOT`, which `main` holds too. `A...B` is `ahead` when B
 * holds A and more, `behind` when A holds B, `identical` for one commit, `diverged` for
 * anything else, and the merge base is the best commit both hold (the same either way round).
 */
function history(
  descends: Array<[string, string]> = [],
  inBase: string[] = [],
): (basehead: string) => string {
  const parents = new Map<string, string[]>();
  const grow = (commit: string, parent: string) =>
    parents.set(commit, [...(parents.get(commit) ?? []), parent]);
  for (const [parent, commit] of descends) grow(commit, parent);
  for (const commit of inBase) grow("main", commit);
  const held = (commit: string): Set<string> => {
    const seen = new Set<string>();
    const walk = (at: string): void => {
      if (seen.has(at)) return;
      seen.add(at);
      if (at !== ROOT) for (const parent of parents.get(at) ?? [ROOT]) walk(parent);
    };
    walk(commit);
    return seen;
  };
  return (basehead) => {
    const [a = "", b = ""] = basehead.split("...").map(decodeURIComponent);
    const [fromA, fromB] = [held(a), held(b)];
    const common = [...fromA].filter((commit) => fromB.has(commit));
    const best = common.find(
      (commit) => !common.some((other) => other !== commit && held(other).has(commit)),
    );
    const status =
      a === b ? "identical" : fromB.has(a) ? "ahead" : fromA.has(b) ? "behind" : "diverged";
    return `${status} ${best ?? ROOT}`;
  };
}

/** Nothing below it: no other pull request is open, so gh is never asked to compare. */
function notStacked(): StackAnswers {
  return { compare: () => null, open: "[]" };
}

/** gh's answer to a stacked question, or undefined when `args` is not one. */
function stackAnswer(args: string[], answers: StackAnswers): string | null | undefined {
  if (args[0] === "pr" && args[1] === "list") return answers.open;
  if (args[0] === "api")
    return answers.compare(args[1]?.split("/compare/")[1]?.split("?")[0] ?? "");
  return undefined;
}

/**
 * `checkPullRequest`: the whole policy of a merge nobody watches. `merge-check` is the one gate
 * before such a merge into the integration base or the default branch, so each condition has
 * its own case: allowMerge, the base, the required checks, the recorded review of the head, and
 * the fixes after it.
 */
describe("checkPullRequest: every condition of an unattended merge", () => {
  /** gh as a pull request into `base` meets it: the view, the default branch, the checks. */
  function ghFor(
    base: string,
    head: string,
    checks: string | null,
    stack: StackAnswers = notStacked(),
  ): GhRunner {
    return async (args) => {
      const stacked = stackAnswer(args, stack);
      if (stacked !== undefined) return stacked;
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
  const ON = { workflow: { allowMerge: true } };

  /** The world of `branchWorld`, with a gh runner and `origin/<base>` pointing at the policy. */
  function prWorld(
    policy: Record<string, unknown>,
    base: string,
    head: (built: ReturnType<typeof branchWorld>) => string,
    checks: string | null,
    review: boolean,
    stack?: (head: string) => StackAnswers,
  ) {
    const built = branchWorld(policy);
    if (base !== "main") git(built.repo, "update-ref", `refs/remotes/origin/${base}`, "main");
    if (review) recordReview(built.env, built.repo, built.reviewed, "feat");
    const sha = head(built);
    const world: MergeWorld = {
      ...worldOf(built.repo, built.env),
      gh: ghFor(base, sha, checks, stack?.(sha)),
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

  /** The stack where #5 (head `BELOW`) is below #7 (head `head`): #7 holds #5's head. */
  const below = (head: string): StackAnswers => ({
    compare: history([[BELOW, head]]),
    open: openJson([5, BELOW], [7, head]),
  });
  const STACKED_ON_5 =
    "pull request #7 is stacked on open pull request #5: merge #5 first, then check again";

  test("another open pull request's head is one it carries: refused, that one goes first", async () => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, below);
    expect(await check(world)).toEqual({
      detail: null,
      kind: "refused",
      number: 7,
      reason: STACKED_ON_5,
    });
  });

  test("two open pull requests below it: the lowest number is named", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: history([
          ["c".repeat(40), head],
          [BELOW, head],
        ]),
        open: openJson([9, "c".repeat(40)], [5, BELOW]),
      }),
    );
    expect(reasonOf(await check(world))).toBe(STACKED_ON_5);
  });

  test("an open pull request whose head it does not carry: allowed, as without it", async () => {
    // Diverged: neither holds the other. Behind: it is the other that holds this head.
    const histories: Array<(head: string) => Array<[string, string]>> = [
      () => [],
      (head) => [[head, BELOW]],
    ];
    for (const descends of histories) {
      const { world } = prWorld(
        ON,
        "main",
        (built) => built.reviewed,
        GREEN,
        true,
        (head) => ({
          compare: history(descends(head)),
          open: openJson([5, BELOW], [7, head]),
        }),
      );
      expect((await check(world)).kind).toBe("allowed");
    }
  });

  test("an open pull request whose head its base already holds does not stop it", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({ compare: history([[BELOW, head]], [BELOW]), open: openJson([5, BELOW]) }),
    );
    expect((await check(world)).kind).toBe("allowed");
  });

  test("the base is not compared when the merge base is the pull request's own head", async () => {
    // #5 is ahead of #7 (it holds #7's head and more): #7 has nothing of #5's, so one compare.
    const asked: string[] = [];
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (basehead) => {
          asked.push(basehead);
          return history([[head, BELOW]])(basehead);
        },
        open: openJson([5, BELOW], [7, head]),
      }),
    );
    expect((await check(world)).kind).toBe("allowed");
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain("main...");
  });

  /** #5 (head `LOWER_MOVED`) was cut from `BELOW`, #7 carries `BELOW` and adds its own. */
  const LOWER_MOVED = "c".repeat(40);
  const movedPast =
    (inBase: string[] = []) =>
    (head: string): StackAnswers => ({
      compare: history(
        [
          [BELOW, LOWER_MOVED],
          [BELOW, head],
        ],
        inBase,
      ),
      open: openJson([5, LOWER_MOVED], [7, head]),
    });

  test("the lower pull request has moved past a commit that #7 still carries: refused", async () => {
    // Plan 7 started from #5's head `BELOW`; #5 then gained a commit. Neither head holds the
    // other, yet #7 carries `BELOW`, which main lacks: merging #7 would put it into main.
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, movedPast());
    expect(await check(world)).toEqual({
      detail: null,
      kind: "refused",
      number: 7,
      reason: STACKED_ON_5,
    });
  });

  test("the commit they share is already in the base: allowed, whichever way round they moved", async () => {
    const shared = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, movedPast([BELOW]));
    expect((await check(shared.world)).kind).toBe("allowed");
  });

  test("two open pull requests at the same head: neither stacks the other", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({ compare: history(), open: openJson([5, head], [7, head]) }),
    );
    expect((await check(world)).kind).toBe("allowed");
  });

  test("unrelated pull requests share one compare of the base with their merge base", async () => {
    const asked: string[] = [];
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (basehead) => {
          asked.push(basehead);
          return history()(basehead);
        },
        open: openJson([4, "d".repeat(40)], [5, BELOW], [6, LOWER_MOVED], [7, head]),
      }),
    );
    expect((await check(world)).kind).toBe("allowed");
    // Three pairs of heads (one each) and one `main...<merge base>` for all three.
    expect(asked).toHaveLength(4);
    expect(asked.filter((basehead) => basehead.startsWith("main..."))).toEqual([`main...${ROOT}`]);
  });

  test("the compare asks for the merge base and one commit, never the whole list", async () => {
    const calls: string[][] = [];
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, below);
    const inner = world.gh;
    await check({
      ...world,
      gh: async (args, call) => {
        calls.push(args);
        return (await inner?.(args, call)) ?? null;
      },
    });
    const compares = calls.filter((args) => args[0] === "api");
    expect(compares.length).toBeGreaterThan(0);
    for (const args of compares) {
      expect(args[1]).toMatch(
        /^repos\/\{owner\}\/\{repo\}\/compare\/[^.?]+\.\.\.[^.?]+\?per_page=1$/,
      );
      expect(args.slice(2)).toEqual(["--jq", '.status + " " + .merge_base_commit.sha']);
    }
  });

  test("the base is encoded as a path segment, and the dots between the names stay", async () => {
    const built = branchWorld(ON);
    git(built.repo, "update-ref", "refs/remotes/origin/release/1", "main");
    recordReview(built.env, built.repo, built.reviewed, "feat");
    const inner = ghFor("release/1", built.reviewed, GREEN, below(built.reviewed));
    const calls: string[][] = [];
    const world: MergeWorld = {
      ...worldOf(built.repo, built.env),
      gh: async (args, call) => {
        calls.push(args);
        // `release/1` is the default branch here, so the base rule lets the check go on.
        if (args[0] === "repo") return JSON.stringify({ defaultBranchRef: { name: "release/1" } });
        return await inner(args, call);
      },
    };
    await check(world);
    const toBase = calls.filter((args) => args[1]?.includes("compare/release%2F1..."));
    expect(toBase).toHaveLength(1);
    expect(toBase[0]?.[1]).toBe(`repos/{owner}/{repo}/compare/release%2F1...${BELOW}?per_page=1`);
  });

  test("gh's error body is never read as a status or shown: GitHub could not compare", async () => {
    const body = '{"message":"Not Found","status":"404"}';
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({ compare: () => body, open: openJson([5, BELOW], [7, head]) }),
    );
    const verdict = await check(world);
    expect(verdict.kind).toBe("refused");
    const reason = reasonOf(verdict);
    expect(reason).toContain("GitHub could not compare");
    expect(reason).toContain("cannot prove it is not stacked");
    expect(reason).not.toContain("Not Found");
    expect(reason).not.toContain("{");
  });

  test("a read the deadline cut short is late, not a refusal that blames gh", async () => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, below);
    let spent = false;
    const inner = world.gh;
    const verdict = await check({
      ...world,
      // The compare is the call that eats the caller's whole time, and answers nothing.
      gh: async (args, call) => {
        if (args[0] === "api") {
          spent = true;
          return null;
        }
        return (await inner?.(args, call)) ?? null;
      },
      timeFor: (limitMs) => (spent ? 0 : limitMs),
    });
    expect(verdict).toEqual({ kind: "late", number: 7, what: "whether #7 is stacked" });
  });

  test("one cache shared between two folders never mixes their answers", async () => {
    const asked: string[][] = [];
    const mine = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, below);
    const other = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, notStacked);
    const watch = (world: MergeWorld): MergeWorld => ({
      ...world,
      gh: async (args, call) => {
        asked.push(args);
        return (await world.gh?.(args, call)) ?? null;
      },
    });
    const stack = newStackCache();
    const run = (world: MergeWorld) =>
      checkPullRequest(watch(world), { ref: "7", repo: null }, new Map(), { stack });
    // Folder one has a stack, folder two does not: each gets its own answer from the one cache.
    expect(reasonOf(await run(mine.world))).toBe(STACKED_ON_5);
    expect((await run(other.world)).kind).toBe("allowed");
    expect(asked.filter((args) => args[0] === "pr" && args[1] === "list")).toHaveLength(2);
  });

  test("the stacked refusal comes before the required checks, and after the base rule", async () => {
    const red = prWorld(ON, "main", (built) => built.reviewed, RED, true, below);
    expect(reasonOf(await check(red.world))).toContain("is stacked on open pull request #5");
    const wrongBase = prWorld(ON, "release/1", (built) => built.reviewed, GREEN, true, below);
    expect(reasonOf(await check(wrongBase.world))).toContain("not the project's integration base");
  });

  test.each([
    ["the open pull requests cannot be listed", () => ({ compare: () => null, open: null })],
    ["the open list is not JSON", () => ({ compare: () => null, open: "{" })],
    ["an open pull request has no head", () => ({ compare: () => null, open: '[{"number":5}]' })],
    [
      "an open pull request has no number",
      () => ({ compare: () => null, open: `[{"headRefOid":"${BELOW}"}]` }),
    ],
    [
      "gh cannot compare the two heads",
      (head: string) => ({ compare: () => null, open: openJson([5, BELOW], [7, head]) }),
    ],
    [
      "gh answers a status it does not know",
      (head: string) => ({ compare: () => "ancestor", open: openJson([5, BELOW], [7, head]) }),
    ],
    [
      "gh answers nothing useful",
      (head: string) => ({
        compare: () => "ahead or behind",
        open: openJson([5, BELOW], [7, head]),
      }),
    ],
    [
      "gh cannot compare the base once the head is carried",
      (head: string) => ({
        compare: (basehead: string) =>
          basehead.startsWith("main...") ? null : history([[BELOW, head]])(basehead),
        open: openJson([5, BELOW], [7, head]),
      }),
    ],
  ])("a gh that cannot answer (%s): refused, never read as not stacked", async (_what, stack) => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, stack);
    const verdict = await check(world);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("cannot prove it is not stacked");
  });

  test("a stack found is named even when gh could not compare another open pull request", async () => {
    const other = "c".repeat(40);
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (basehead) =>
          basehead.includes(other) ? null : history([[BELOW, head]])(basehead),
        open: openJson([4, other], [5, BELOW]),
      }),
    );
    expect(reasonOf(await check(world))).toBe(STACKED_ON_5);
  });

  test("a pull request with 150 commits is not refused for its size: no commit list is read", async () => {
    const asked: string[][] = [];
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true);
    const inner = world.gh;
    const counted: MergeWorld = {
      ...world,
      gh: async (args, call) => {
        asked.push(args);
        // gh would cut the commits at 100; the check never asks for them.
        if (args.includes("commits")) {
          return JSON.stringify({ commits: Array.from({ length: 100 }, () => ({ oid: BELOW })) });
        }
        return (await inner?.(args, call)) ?? null;
      },
    };
    expect((await check(counted)).kind).toBe("allowed");
    expect(asked.some((args) => args.includes("commits"))).toBe(false);
  });

  test("gh may have cut the open pull requests at its limit: a list that long is refused", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      () => ({
        compare: () => "diverged",
        open: openJson(
          ...Array.from({ length: OPEN_PULL_REQUESTS_LIMIT }, (_, index): [number, string] => [
            100 + index,
            index.toString(16).padStart(40, "0"),
          ]),
        ),
      }),
    );
    const verdict = await check(world);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("cannot prove it is not stacked");
  });

  test("a shared run asks the open list once, and each pair of commits once", async () => {
    const asked: string[][] = [];
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, below);
    const inner = world.gh;
    const counted: MergeWorld = {
      ...world,
      gh: async (args, call) => {
        asked.push(args);
        return (await inner?.(args, call)) ?? null;
      },
    };
    const stack = newStackCache();
    const run = () => checkPullRequest(counted, { ref: "7", repo: null }, new Map(), { stack });
    const [one, two] = await Promise.all([run(), run()]);
    expect(reasonOf(one)).toBe(STACKED_ON_5);
    expect(reasonOf(two)).toBe(STACKED_ON_5);
    expect(asked.filter((args) => args[0] === "pr" && args[1] === "list")).toHaveLength(1);
    // One compare of the pair, and one of the base: not one more for the second look.
    expect(asked.filter((args) => args[0] === "api")).toHaveLength(2);
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
  function ghFor(
    base: string,
    head: string,
    checks: string | null,
    stack: StackAnswers = notStacked(),
  ): GhRunner {
    return async (args) => {
      const stacked = stackAnswer(args, stack);
      if (stacked !== undefined) return stacked;
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
    stack?: (head: string) => StackAnswers;
  }) {
    const base = opts.base ?? "main";
    const built = branchWorld(opts.policy ?? OFF);
    if (base !== "main") git(built.repo, "update-ref", `refs/remotes/origin/${base}`, "main");
    if (opts.review ?? true) recordReview(built.env, built.repo, built.reviewed, "feat");
    return {
      ...worldOf(built.repo, built.env),
      gh: ghFor(base, built.reviewed, opts.checks, opts.stack?.(built.reviewed)),
    };
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

  test("allowMerge off, asked, stacked on an open pull request: refused for it, the yes does not set it aside", async () => {
    const stack = (head: string): StackAnswers => ({
      compare: history([[BELOW, head]]),
      open: openJson([5, BELOW]),
    });
    expect(await check(prWorld({ checks: GREEN, stack }), true)).toEqual({
      detail: null,
      kind: "refused",
      number: 7,
      reason:
        "pull request #7 is stacked on open pull request #5: merge #5 first, then check again",
    });
    // allowMerge on and asked: the same, so the yes is never what refuses it.
    const on = { workflow: { allowMerge: true } };
    expect(reasonOf(await check(prWorld({ checks: GREEN, policy: on, stack }), true))).toContain(
      "is stacked on open pull request #5",
    );
  });

  test("allowMerge off, asked, a gh that cannot list the open pull requests: refused", async () => {
    const verdict = await check(
      prWorld({ checks: GREEN, stack: () => ({ compare: () => null, open: null }) }),
      true,
    );
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("cannot prove it is not stacked");
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
