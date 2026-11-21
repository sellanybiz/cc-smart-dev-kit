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
import { cleanGitEnv, git } from "../testing/temp";
import {
  checkBranch,
  checkPullRequest,
  type GhRunner,
  type MergeVerdict,
  type MergeWorld,
  newStackCache,
  OPEN_PULL_REQUESTS_LIMIT,
  policyUnread,
  STACK_COMMITS_LIMIT,
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
   * `gh api repos/{owner}/{repo}/compare/<basehead>?per_page=100&page=<n> --jq '.total_commits,
   * .commits[].sha'`, by what follows `compare/`: `BASE...HEAD` (a branch name arrives encoded,
   * as gh is given it), then the query.
   */
  compare: (path: string) => string | null;
  /** `gh pr list --state open --json <OPEN_PULL_REQUEST_FIELDS>`. */
  open: string | null;
}

/** The commit every history below grows from, which `main` holds. */
const ROOT = "9".repeat(40);

/**
 * The open pull requests `gh pr list --json <OPEN_PULL_REQUEST_FIELDS>` prints: each
 * [number, head], into `main` from branch `head-<number>` of this repository unless a base is given.
 */
function openJson(...open: Array<[number, string] | [number, string, string]>): string {
  return JSON.stringify(
    open.map(([number, headRefOid, baseRefName = "main"]) => ({
      baseRefName,
      headRefName: `head-${number}`,
      headRefOid,
      isCrossRepository: false,
      number,
    })),
  );
}

/** The commits as one page of the compare prints them: the total, then this page's ids. */
function commitsPage(commits: string[], path: string): string {
  const params = new URLSearchParams(path.split("?")[1] ?? "");
  const perPage = Number(params.get("per_page") ?? "250");
  const page = Number(params.get("page") ?? "1");
  return [String(commits.length), ...commits.slice((page - 1) * perPage, page * perPage)].join(
    "\n",
  );
}

/**
 * GitHub's compare over a small history, as `gh api` prints it: `descends` lists [parent,
 * commit] pairs, `inBase` the commits `main` already holds. A commit with no parent listed
 * grows from `ROOT`. `BASE...HEAD` lists the commits HEAD holds and BASE does not.
 */
function history(
  descends: Array<[string, string]> = [],
  inBase: string[] = [],
): (path: string) => string {
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
  return (path) => {
    const [base = "", head = ""] = (path.split("?")[0] ?? "").split("...").map(decodeURIComponent);
    const inBaseNow = held(base);
    const commits = [...held(head)].filter((commit) => !inBaseNow.has(commit)).sort();
    return commitsPage(commits, path);
  };
}

/** Nothing below it: no other pull request is open, so gh is never asked to compare. */
function notStacked(): StackAnswers {
  return { compare: () => null, open: "[]" };
}

/** gh's answer to a stacked question, or undefined when `args` is not one. */
function stackAnswer(args: string[], answers: StackAnswers): string | null | undefined {
  if (args[0] === "pr" && args[1] === "list") return answers.open;
  if (args[0] === "api") return answers.compare(args[1]?.split("/compare/")[1] ?? "");
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

  /** The stack where #5 (head `BELOW`) is below #7 (head `head`), both into main. */
  const below = (head: string): StackAnswers => ({
    compare: history([[BELOW, head]]),
    open: openJson([5, BELOW], [7, head]),
  });
  /** The refusal of #7 for sharing commits with open pull request #`m` that main lacks. */
  const sharesWith = (m: number) =>
    `pull request #7 shares commits with open pull request #${m} that main does not hold yet: merge the lower one first (open the upper one against the lower one's branch), then check again`;
  const SHARES_5 = sharesWith(5);
  /** The same refusal when one of the two is a fork's: neither can be opened against the other. */
  const SHARES_5_FORK =
    "pull request #7 shares commits with open pull request #5 that main does not hold yet, and one of them is from a fork, so neither can be opened against the other: merge the lower one by hand, then check again";
  /** The compare call the check makes for page `page` of `<base>...<head>`. */
  const compareArgs = (basehead: string, page = 1) => [
    "api",
    `repos/{owner}/{repo}/compare/${basehead}?per_page=100&page=${page}`,
    "--jq",
    ".total_commits, .commits[].sha",
  ];

  test("it carries another open pull request's head, both into main: refused, in words that fit either order", async () => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, below);
    expect(await check(world)).toEqual({
      detail: null,
      kind: "refused",
      number: 7,
      reason: SHARES_5,
    });
  });

  test("two open pull requests share its commits: the lowest number is named", async () => {
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
    expect(reasonOf(await check(world))).toBe(SHARES_5);
  });

  test("no commit in common: allowed, as without it", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({ compare: history(), open: openJson([5, BELOW], [7, head]) }),
    );
    expect((await check(world)).kind).toBe("allowed");
  });

  test("an open pull request against this one's branch is the upper one: skipped, its commits never read", async () => {
    // #5 holds #7's head and more, and targets `feat`, #7's head branch: it is stacked on #7.
    const asked: string[][] = [];
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => {
          asked.push([path]);
          return history([[head, BELOW]])(path);
        },
        open: JSON.stringify([
          {
            baseRefName: "feat",
            headRefName: "upper",
            headRefOid: BELOW,
            isCrossRepository: false,
            number: 5,
          },
          {
            baseRefName: "main",
            headRefName: "feat",
            headRefOid: head,
            isCrossRepository: false,
            number: 7,
          },
        ]),
      }),
    );
    expect((await check(world)).kind).toBe("allowed");
    expect(asked).toEqual([]);
  });

  test("the same upper pull request opened against main instead: which is lower is unknown, so refused", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({ compare: history([[head, BELOW]]), open: openJson([5, BELOW], [7, head]) }),
    );
    expect(reasonOf(await check(world))).toBe(SHARES_5);
  });

  test("an upper pull request is skipped only when this one is in the open list and neither is a fork", async () => {
    const rows = (self: boolean | null, other: boolean) => (head: string) => ({
      compare: history([[head, BELOW]]),
      open: JSON.stringify([
        {
          baseRefName: "feat",
          headRefName: "upper",
          headRefOid: BELOW,
          isCrossRepository: other,
          number: 5,
        },
        ...(self === null
          ? []
          : [
              {
                baseRefName: "main",
                headRefName: "feat",
                headRefOid: head,
                isCrossRepository: self,
                number: 7,
              },
            ]),
      ]),
    });
    for (const [self, other, reason] of [
      [true, false, SHARES_5_FORK],
      [false, true, SHARES_5_FORK],
      [null, false, SHARES_5],
    ] as const) {
      // #5 holds #7's head, so once #5 is not skipped, the two share it.
      const { world } = prWorld(
        ON,
        "main",
        (built) => built.reviewed,
        GREEN,
        true,
        rows(self, other),
      );
      expect(reasonOf(await check(world))).toBe(reason);
    }
  });

  test("an open pull request whose commits its base already holds does not stop it", async () => {
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
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, movedPast());
    expect(reasonOf(await check(world))).toBe(SHARES_5);
  });

  test("the commit they share is already in the base: allowed", async () => {
    const shared = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, movedPast([BELOW]));
    expect((await check(shared.world)).kind).toBe("allowed");
  });

  test("two open pull requests at the same head: neither stacks the other, and nothing is read", async () => {
    const asked: string[] = [];
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => {
          asked.push(path);
          return history()(path);
        },
        open: openJson([5, head], [7, head]),
      }),
    );
    expect((await check(world)).kind).toBe("allowed");
    expect(asked).toEqual([]);
  });

  test("unrelated pull requests: each one's commits are read once, its own too", async () => {
    const asked: string[] = [];
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => {
          asked.push(path);
          return history()(path);
        },
        open: openJson([4, "d".repeat(40)], [5, BELOW], [6, LOWER_MOVED], [7, head]),
      }),
    );
    expect((await check(world)).kind).toBe("allowed");
    expect(asked).toHaveLength(4);
  });

  test("the compare pages by 100 and asks for the total and the commit ids only", async () => {
    const calls: string[][] = [];
    const { world, reviewed } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, below);
    const inner = world.gh;
    await check({
      ...world,
      gh: async (args, call) => {
        calls.push(args);
        return (await inner?.(args, call)) ?? null;
      },
    });
    expect(calls.filter((args) => args[0] === "api")).toEqual([
      compareArgs(`main...${reviewed}`),
      compareArgs(`main...${BELOW}`),
    ]);
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
    expect(calls.filter((args) => args[1]?.includes("compare/release%2F1..."))).toEqual([
      compareArgs(`release%2F1...${built.reviewed}`),
    ]);
  });

  test("gh's error body is never read as an answer or shown: GitHub could not compare", async () => {
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
    expect(reasonOf(await run(mine.world))).toBe(SHARES_5);
    expect((await run(other.world)).kind).toBe("allowed");
    expect(asked.filter((args) => args[0] === "pr" && args[1] === "list")).toHaveLength(2);
  });

  test("the stacked refusal comes before the required checks, and after the base rule", async () => {
    const red = prWorld(ON, "main", (built) => built.reviewed, RED, true, below);
    expect(reasonOf(await check(red.world))).toBe(SHARES_5);
    const wrongBase = prWorld(ON, "release/1", (built) => built.reviewed, GREEN, true, below);
    expect(reasonOf(await check(wrongBase.world))).toContain("not the project's integration base");
  });

  /** An open list whose one row lacks `field`. */
  const rowWithout = (field: string) =>
    JSON.stringify([
      Object.fromEntries(
        Object.entries({
          baseRefName: "main",
          headRefName: "head-5",
          headRefOid: BELOW,
          isCrossRepository: false,
          number: 5,
        }).filter(([key]) => key !== field),
      ),
    ]);

  test.each([
    ["the open pull requests cannot be listed", () => ({ compare: () => null, open: null })],
    ["the open list is not JSON", () => ({ compare: () => null, open: "{" })],
    [
      "an open pull request has no head",
      () => ({ compare: () => null, open: rowWithout("headRefOid") }),
    ],
    [
      "an open pull request has no number",
      () => ({ compare: () => null, open: rowWithout("number") }),
    ],
    [
      "an open pull request has no base",
      () => ({ compare: () => null, open: rowWithout("baseRefName") }),
    ],
    [
      "an open pull request does not say whether it is a fork's",
      () => ({ compare: () => null, open: rowWithout("isCrossRepository") }),
    ],
    [
      "gh cannot list this pull request's own commits",
      (head: string) => ({
        compare: (path: string) => (path.includes(head) ? null : history()(path)),
        open: openJson([5, BELOW], [7, head]),
      }),
    ],
    [
      "gh cannot list the other's commits",
      (head: string) => ({
        compare: (path: string) => (path.includes(BELOW) ? null : history()(path)),
        open: openJson([5, BELOW], [7, head]),
      }),
    ],
    [
      "gh answers a total that is not a number",
      (head: string) => ({ compare: () => `many\n${head}`, open: openJson([5, BELOW], [7, head]) }),
    ],
    [
      "gh answers a line that is not a commit id",
      (head: string) => ({ compare: () => `2\n${head}\nnot a commit`, open: openJson([5, BELOW]) }),
    ],
  ])("a gh that cannot answer (%s): refused, never read as not stacked", async (_what, stack) => {
    const { world } = prWorld(ON, "main", (built) => built.reviewed, GREEN, true, stack);
    const verdict = await check(world);
    expect(verdict.kind).toBe("refused");
    expect(reasonOf(verdict)).toContain("cannot prove it is not stacked");
  });

  test("an unreadable other pull request is named in the refusal", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => (path.includes(BELOW) ? null : history()(path)),
        open: openJson([5, BELOW], [7, head]),
      }),
    );
    expect(reasonOf(await check(world))).toBe(
      `the commits of open pull request #5 could not be read (GitHub could not compare main and ${BELOW.slice(0, 12)} (gh printed no total and commit ids)), so merge-check cannot prove it is not stacked on an open pull request`,
    );
  });

  test("a stack found is named even when gh could not read another open pull request", async () => {
    const other = "c".repeat(40);
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => (path.includes(other) ? null : history([[BELOW, head]])(path)),
        open: openJson([4, other], [5, BELOW]),
      }),
    );
    expect(reasonOf(await check(world))).toBe(SHARES_5);
  });

  /** `count` made-up commit ids, `tag` keeping each list apart. */
  const ids = (count: number, tag: string) =>
    Array.from({ length: count }, (_, index) => `${tag}${index.toString(16).padStart(39, "0")}`);

  test("more commits than one page: every page is read, so a commit shared on the second is seen", async () => {
    const mine = ids(150, "a");
    const theirs = [mine[140] ?? "", ...ids(3, "f")];
    const asked: string[] = [];
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => {
          asked.push(path);
          return commitsPage(path.includes(BELOW) ? theirs : [...mine, head], path);
        },
        open: openJson([5, BELOW], [7, head]),
      }),
    );
    expect(reasonOf(await check(world))).toBe(SHARES_5);
    expect(asked.filter((path) => !path.includes(BELOW)).map((path) => path.split("?")[1])).toEqual(
      ["per_page=100&page=1", "per_page=100&page=2"],
    );
  });

  test("more commits than merge-check reads: refused with the count and the limit, after one page", async () => {
    const asked: string[] = [];
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => {
          asked.push(path);
          return commitsPage(ids(STACK_COMMITS_LIMIT + 1, "a"), path);
        },
        open: openJson([5, BELOW], [7, head]),
      }),
    );
    expect(reasonOf(await check(world))).toContain(
      `holds ${STACK_COMMITS_LIMIT + 1} commits, more than the ${STACK_COMMITS_LIMIT} merge-check reads), so merge-check cannot prove it is not stacked`,
    );
    expect(asked).toHaveLength(1);
  });

  test("a full page is followed by another, whatever the total says: a total counted too low is refused", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        // It says 100, gives a full page of 100, and then 20 more.
        compare: (path) => {
          const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
          return ["100", ...(page === 1 ? ids(100, "a") : page === 2 ? ids(20, "b") : [])].join(
            "\n",
          );
        },
        open: openJson([5, BELOW], [7, head]),
      }),
    );
    expect(reasonOf(await check(world))).toContain("GitHub listed 120 of the 100 commits");
  });

  test("GitHub's pages end before its total: refused, never judged on part of the commits", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        // It says 150, then lists only the first page and nothing after it.
        compare: (path) => (path.endsWith("page=1") ? commitsPage(ids(150, "a"), path) : "150"),
        open: openJson([5, BELOW], [7, head]),
      }),
    );
    expect(reasonOf(await check(world))).toContain("GitHub listed 100 of the 150 commits");
  });

  test("a total that changes between pages: refused", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      (head) => ({
        compare: (path) => commitsPage(ids(path.endsWith("page=1") ? 150 : 151, "a"), path),
        open: openJson([5, BELOW], [7, head]),
      }),
    );
    expect(reasonOf(await check(world))).toContain("changed from 150 to 151 while it was read");
  });

  test("gh may have cut the open pull requests at its limit: a list that long is refused", async () => {
    const { world } = prWorld(
      ON,
      "main",
      (built) => built.reviewed,
      GREEN,
      true,
      () => ({
        compare: () => "0",
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

  test("a shared run asks the open list once, and each pull request's commits once", async () => {
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
    expect(reasonOf(one)).toBe(SHARES_5);
    expect(reasonOf(two)).toBe(SHARES_5);
    expect(asked.filter((args) => args[0] === "pr" && args[1] === "list")).toHaveLength(1);
    // Its own commits and #5's: not one more for the second look.
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
        "pull request #7 shares commits with open pull request #5 that main does not hold yet: merge the lower one first (open the upper one against the lower one's branch), then check again",
    });
    // allowMerge on and asked: the same, so the yes is never what refuses it.
    const on = { workflow: { allowMerge: true } };
    expect(reasonOf(await check(prWorld({ checks: GREEN, policy: on, stack }), true))).toContain(
      "shares commits with open pull request #5",
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

/**
 * The stacked check over real git histories: each shape a stack takes, built with git, and gh's
 * compare answered by git itself. GitHub's own docs define the compare as `git log BASE..HEAD`
 * (https://docs.github.com/en/rest/commits/commits#compare-two-commits), and it answers 404 when
 * the two share no history, so `git rev-list <base>..<head>` is the fake's whole answer, paged
 * by the query's `per_page` and `page`.
 */
describe("the stacked check over real git histories", () => {
  /** gh's body for a compare GitHub cannot make (no such ref, or no common history). */
  const NOT_FOUND = '{"message":"Not Found","status":"404"}';

  /** One open pull request as `gh pr list` lists it. */
  interface Row {
    base: string;
    fork?: boolean;
    head: string;
    headRef: string;
    number: number;
  }

  /** Runs git in `repo`; null when it fails. */
  function tryGit(repo: string, ...args: string[]): string | null {
    const run = Bun.spawnSync(["git", ...args], {
      cwd: repo,
      env: cleanGitEnv(),
      stderr: "pipe",
      stdout: "pipe",
    });
    return run.exitCode === 0 ? run.stdout.toString().trim() : null;
  }

  /** GitHub's compare of `path` (`<base>...<head>?<query>`) in `repo`, as `--jq` prints it. */
  function gitCompare(repo: string, path: string, jq: string): string {
    const [basehead = "", query = ""] = path.split("?");
    const [base = "", head = ""] = basehead.split("...").map(decodeURIComponent);
    if (tryGit(repo, "merge-base", base, head) === null) return NOT_FOUND;
    const listed = tryGit(repo, "rev-list", "--reverse", "--topo-order", `${base}..${head}`);
    if (listed === null) return NOT_FOUND;
    const commits = listed === "" ? [] : listed.split("\n");
    // Only the fields the check asks for are printed: any other question has no such answer.
    if (jq !== ".total_commits, .commits[].sha") return NOT_FOUND;
    const params = new URLSearchParams(query);
    const perPage = Number(params.get("per_page") ?? "250");
    const page = Number(params.get("page") ?? "1");
    const shown = commits.slice((page - 1) * perPage, page * perPage);
    return [String(commits.length), ...shown].join("\n");
  }

  /** A clone whose committed policy merges by itself with no review gate, on `main`. */
  function historyWorld() {
    const built = branchWorld({ workflow: { allowMerge: true, reviewBeforePush: false } });
    git(built.repo, "checkout", "-q", "main");
    let count = 0;
    /** Starts `branch` at `from` and checks it out. */
    const start = (branch: string, from: string) =>
      git(built.repo, "checkout", "-q", "-B", branch, from);
    /** One commit on the branch checked out now. */
    const commit = (name: string) => {
      count += 1;
      return commitFiles(built.repo, { [`${name}.txt`]: `${name} ${count}\n` }, name);
    };
    /** Merges `other` into the branch checked out now, and returns the merge commit. */
    const merge = (other: string) => {
      git(built.repo, "merge", "-q", "--no-edit", "--no-ff", other);
      return git(built.repo, "rev-parse", "HEAD").trim();
    };
    return { ...built, commit, merge, start };
  }

  /** The verdict for open pull request `view` among `rows`, by gh as the fake answers it. */
  async function judge(repo: string, env: Record<string, string>, view: Row, rows: Row[]) {
    if (view.base !== "main") {
      git(repo, "update-ref", `refs/remotes/origin/${view.base}`, "origin/main");
    }
    const asked: string[][] = [];
    const gh: GhRunner = async (args) => {
      asked.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({
          baseRefName: view.base,
          headRefName: view.headRef,
          headRefOid: view.head,
          number: view.number,
        });
      }
      if (args[0] === "repo" && args[1] === "view") {
        return JSON.stringify({ defaultBranchRef: { name: "main" } });
      }
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify(
          rows.map((row) => ({
            baseRefName: row.base,
            headRefName: row.headRef,
            headRefOid: row.head,
            isCrossRepository: row.fork === true,
            number: row.number,
          })),
        );
      }
      if (args[0] === "pr" && args[1] === "checks") {
        return JSON.stringify([{ bucket: "pass", name: "ci" }]);
      }
      if (args[0] === "api") {
        return gitCompare(repo, args[1]?.split("/compare/")[1] ?? "", args[3] ?? "");
      }
      return null;
    };
    const world: MergeWorld = { ...worldOf(repo, env), gh };
    const verdict = await checkPullRequest(
      world,
      { ref: String(view.number), repo: null },
      new Map(),
    );
    return { asked, verdict };
  }

  const ALLOWED: MergeVerdict = {
    detail: { allowance: null, delta: null, limits: LIMITS, review: null, reviewed: null },
    kind: "allowed",
    reason: "its required checks are green, and reviewBeforePush is off",
  };
  /** The refusal when two pull requests into `base` share commits it lacks. */
  const shares = (n: number, m: number, base = "main"): MergeVerdict => ({
    detail: null,
    kind: "refused",
    number: n,
    reason: `pull request #${n} shares commits with open pull request #${m} that ${base} does not hold yet: merge the lower one first (open the upper one against the lower one's branch), then check again`,
  });
  /** The same refusal when one of the two is from a fork: no base can name the other's branch. */
  const sharesFork = (n: number, m: number): MergeVerdict => ({
    detail: null,
    kind: "refused",
    number: n,
    reason: `pull request #${n} shares commits with open pull request #${m} that main does not hold yet, and one of them is from a fork, so neither can be opened against the other: merge the lower one by hand, then check again`,
  });
  /** The base rule's refusal of a pull request into `base`. */
  const intoBranch = (n: number, base: string): MergeVerdict => ({
    detail: null,
    kind: "refused",
    number: n,
    reason: `the pull request's base is ${base}, not the project's integration base main or the repository's default branch main`,
  });

  test("a plain stack, the upper opened against the lower branch: the lower is allowed, the upper waits on the base rule", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    const b1 = w.commit("b1");
    const lower = { base: "main", head: a1, headRef: "a", number: 5 };
    const upper = { base: "a", head: b1, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, lower, [lower, upper])).verdict).toEqual(ALLOWED);
    expect((await judge(w.repo, w.env, upper, [lower, upper])).verdict).toEqual(intoBranch(7, "a"));
  });

  test("the lower pull request moved on, the upper opened against its branch: the lower is allowed", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    const b1 = w.commit("b1");
    w.start("a", a1);
    const a2 = w.commit("a2");
    const lower = { base: "main", head: a2, headRef: "a", number: 5 };
    const upper = { base: "a", head: b1, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, lower, [lower, upper])).verdict).toEqual(ALLOWED);
    expect((await judge(w.repo, w.env, upper, [lower, upper])).verdict).toEqual(intoBranch(7, "a"));
  });

  test("our own case: 6.2.0 into main is never refused because of 6.3.0 opened against its branch", async () => {
    const w = historyWorld();
    w.start("bug-hunt-6x", "main");
    const released = w.commit("release-6-2-0");
    w.start("plan-6-3-0", released);
    const next = w.commit("plan-6-3-0-work");
    w.start("bug-hunt-6x", released);
    // 6.2.0 then takes its last review's fixes, after 6.3.0 started from it.
    const fixed = w.commit("last-review-fixes");
    const release = { base: "main", head: fixed, headRef: "bug-hunt-6x", number: 90 };
    const plan = { base: "bug-hunt-6x", head: next, headRef: "plan-6-3-0", number: 91 };
    expect((await judge(w.repo, w.env, release, [release, plan])).verdict).toEqual(ALLOWED);
    // And before the fixes, too.
    const early = { ...release, head: released };
    expect((await judge(w.repo, w.env, early, [early, plan])).verdict).toEqual(ALLOWED);
  });

  test("the upper opened against main: which is lower is unknown, so both are refused, in words that fit both", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    const b1 = w.commit("b1");
    const lower = { base: "main", head: a1, headRef: "a", number: 5 };
    const upper = { base: "main", head: b1, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, lower, [lower, upper])).verdict).toEqual(shares(5, 7));
    expect((await judge(w.repo, w.env, upper, [lower, upper])).verdict).toEqual(shares(7, 5));
  });

  test("the lower moved on and the upper is against main: both are refused", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    const b1 = w.commit("b1");
    w.start("a", a1);
    const a2 = w.commit("a2");
    const lower = { base: "main", head: a2, headRef: "a", number: 5 };
    const upper = { base: "main", head: b1, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, lower, [lower, upper])).verdict).toEqual(shares(5, 7));
    expect((await judge(w.repo, w.env, upper, [lower, upper])).verdict).toEqual(shares(7, 5));
  });

  test("a criss-cross (both branches merged a newer main): the shared commit is still seen, so refused", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    w.commit("b1");
    git(w.repo, "checkout", "-q", "main");
    w.commit("x");
    git(w.repo, "checkout", "-q", "a");
    const a2 = w.merge("main");
    git(w.repo, "checkout", "-q", "b");
    const b2 = w.merge("main");
    // git's one merge base of the two heads is main's new commit: the shared a1 hides behind it.
    expect(git(w.repo, "merge-base", a2, b2).trim()).toBe(git(w.repo, "rev-parse", "main").trim());
    const lower = { base: "main", head: a2, headRef: "a", number: 5 };
    const upper = { base: "main", head: b2, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, upper, [lower, upper])).verdict).toEqual(shares(7, 5));
    expect((await judge(w.repo, w.env, lower, [lower, upper])).verdict).toEqual(shares(5, 7));
  });

  test("two open pull requests at the same head: clear, one commit has one review and one set of checks", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    const one = { base: "main", head: a1, headRef: "a", number: 5 };
    const two = { base: "main", head: a1, headRef: "a-copy", number: 7 };
    expect((await judge(w.repo, w.env, two, [one, two])).verdict).toEqual(ALLOWED);
  });

  test("unrelated work from the same main: neither is stacked", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("c", "main");
    const c1 = w.commit("c1");
    const one = { base: "main", head: a1, headRef: "a", number: 5 };
    const two = { base: "main", head: c1, headRef: "c", number: 7 };
    expect((await judge(w.repo, w.env, one, [one, two])).verdict).toEqual(ALLOWED);
    expect((await judge(w.repo, w.env, two, [one, two])).verdict).toEqual(ALLOWED);
  });

  test("an open pull request with no history in common with its base: its commits cannot be read, so refused", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    git(w.repo, "checkout", "-q", "--orphan", "pages");
    const pages = w.commit("pages");
    const mine = { base: "main", head: a1, headRef: "a", number: 5 };
    const other = { base: "main", head: pages, headRef: "pages", number: 7 };
    const { verdict } = await judge(w.repo, w.env, mine, [mine, other]);
    expect(verdict).toMatchObject({ kind: "refused", number: 5 });
    const reason = "reason" in verdict ? verdict.reason : "";
    expect(reason).toContain(
      "so merge-check cannot prove it is not stacked on an open pull request",
    );
    expect(reason).toContain("#7");
  });

  test("a squash-merged lower one: the upper waits on its base until retargeted, then the lower is no longer open", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    const b1 = w.commit("b1");
    // The squash: a1's change lands on main as a new commit; #5 is merged, so not open.
    git(w.repo, "checkout", "-q", "main");
    git(w.repo, "merge", "-q", "--squash", "a");
    git(w.repo, "commit", "-q", "-m", "a (#5)");
    const before = { base: "a", head: b1, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, before, [before])).verdict).toEqual(intoBranch(7, "a"));
    const retargeted = { ...before, base: "main" };
    expect((await judge(w.repo, w.env, retargeted, [retargeted])).verdict).toEqual(ALLOWED);
  });

  test("a lower one closed without a merge is not open, so it holds nothing up: the skill rebuilds the upper one", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    const b1 = w.commit("b1");
    const upper = { base: "main", head: b1, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, upper, [upper])).verdict).toEqual(ALLOWED);
  });

  test("a fork's head branch is not this repository's branch: one opened against that name is not stacked on it", async () => {
    const w = historyWorld();
    // This repository has its own branch `a`; the fork's pull request comes from its own `a`.
    w.start("a", "main");
    w.commit("a0");
    w.start("fork-a", "main");
    const f1 = w.commit("f1");
    w.start("m", f1);
    const m1 = w.commit("m1");
    const fork = { base: "main", fork: true, head: f1, headRef: "a", number: 5 };
    const other = { base: "a", head: m1, headRef: "m", number: 7 };
    expect((await judge(w.repo, w.env, fork, [fork, other])).verdict).toEqual(sharesFork(5, 7));
    // The same rows from this repository's own branch: #7 is stacked on #5, so #5 goes.
    const own = { ...fork, fork: false };
    expect((await judge(w.repo, w.env, own, [own, other])).verdict).toEqual(ALLOWED);
  });

  test("two fork pull requests into main, one built on the other: each is told to merge by hand", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("b", a1);
    const b1 = w.commit("b1");
    const lower = { base: "main", fork: true, head: a1, headRef: "a", number: 5 };
    const upper = { base: "main", fork: true, head: b1, headRef: "b", number: 7 };
    expect((await judge(w.repo, w.env, lower, [lower, upper])).verdict).toEqual(sharesFork(5, 7));
    expect((await judge(w.repo, w.env, upper, [lower, upper])).verdict).toEqual(sharesFork(7, 5));
  });

  test("each pull request's commits are read once, paged, and nothing is read with no other pull request open", async () => {
    const w = historyWorld();
    w.start("a", "main");
    const a1 = w.commit("a1");
    w.start("c", "main");
    const c1 = w.commit("c1");
    const one = { base: "main", head: a1, headRef: "a", number: 5 };
    const two = { base: "main", head: c1, headRef: "c", number: 7 };
    const alone = await judge(w.repo, w.env, one, [one]);
    expect(alone.asked.filter((args) => args[0] === "api")).toEqual([]);
    const both = await judge(w.repo, w.env, one, [one, two]);
    expect(both.asked.filter((args) => args[0] === "api")).toEqual([
      [
        "api",
        `repos/{owner}/{repo}/compare/main...${a1}?per_page=100&page=1`,
        "--jq",
        ".total_commits, .commits[].sha",
      ],
      [
        "api",
        `repos/{owner}/{repo}/compare/main...${c1}?per_page=100&page=1`,
        "--jq",
        ".total_commits, .commits[].sha",
      ],
    ]);
  });
});
