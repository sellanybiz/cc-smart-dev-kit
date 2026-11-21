/**
 * The merge check's async path (B8, Part A): every child it starts is awaited, through an
 * injected `gh` runner, so the portal can make the same check inside its own process without
 * freezing a page or the live stream. The judgment itself is proved by the guard's and the
 * command's own tests; these prove the shape of the path.
 */
import { describe, expect, test } from "bun:test";
import { cliPaths } from "../cli/paths";
import { locateCheckout } from "../project/resolve";
import { commitConfig, makeRepo } from "../testing/hooks";
import { cleanGitEnv } from "../testing/temp";
import {
  checkBranch,
  checkPullRequest,
  type GhRunner,
  type MergeWorld,
  viewPullRequest,
} from "./merge-check";

/**
 * A world over a real temp checkout, with no deadline unless a test gives one. `prepare` gives
 * the repo its committed policy (and its `origin/<base>`), which the check reads with git.
 */
function world(
  run: GhRunner,
  timeFor: (limitMs: number) => number = (limit) => limit,
  prepare?: (repo: string) => void,
): MergeWorld {
  const repo = makeRepo("merge-check");
  prepare?.(repo);
  const checkout = locateCheckout(repo, { env: cleanGitEnv() });
  if (checkout === null) throw new Error(`${repo} is not in git`);
  return {
    checkout,
    env: cleanGitEnv(),
    folder: repo,
    gh: run,
    paths: cliPaths({ HOME: repo, CLAUDE_CONFIG_DIR: `${repo}/.claude` }),
    timeFor,
  };
}

describe("the merge check never blocks its caller (B8)", () => {
  test("a slow gh runner is awaited: the call does not settle, and other work runs", async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gh: GhRunner = async () => {
      await slow;
      return null;
    };
    const verdict = checkPullRequest(world(gh), { ref: "7", repo: null }, new Map());
    let settled = false;
    void verdict.then(() => {
      settled = true;
    });
    // The caller goes on while gh is still answering (a blocking spawn could not).
    let ran = false;
    await Bun.sleep(10).then(() => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(settled).toBe(false);
    release();
    expect(await verdict).toEqual({
      kind: "unread",
      number: null,
      what: "the pull request this command names",
    });
  });

  test("every gh read goes through the injected runner: the view, the default branch, the checks", async () => {
    const asked: string[][] = [];
    const gh: GhRunner = async (args) => {
      asked.push(args);
      if (args[0] === "pr" && args[1] === "list") return "[]";
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({
          baseRefName: "integration",
          headRefName: "feat",
          headRefOid: "a".repeat(40),
          number: 7,
        });
      }
      if (args[0] === "repo" && args[1] === "view") {
        return JSON.stringify({ defaultBranchRef: { name: "main" } });
      }
      if (args[0] === "pr" && args[1] === "checks") {
        return JSON.stringify([{ bucket: "pass", name: "ci" }]);
      }
      return null;
    };
    // The policy committed on the pull request's base, so the check gets past it and asks the
    // other two gh questions: a plain integration base, green checks, no review gate.
    const verdict = await checkPullRequest(
      world(gh, undefined, (repo) =>
        commitConfig(
          repo,
          {
            workflow: { allowMerge: true, reviewBeforePush: false },
            worktrees: { base: "integration" },
          },
          ["main", "integration"],
        ),
      ),
      { ref: "7", repo: null },
      new Map(),
    );
    // The stacked questions sit after the base rule and before the checks, in that order.
    expect(asked).toEqual([
      ["pr", "view", "7", "--json", "number,baseRefName,headRefName,headRefOid"],
      ["repo", "view", "--json", "defaultBranchRef"],
      ["pr", "list", "--state", "open", "--limit", "500", "--json", "number,headRefOid"],
      ["pr", "checks", "7", "--required", "--json", "name,bucket"],
    ]);
    expect(verdict).toEqual({
      detail: {
        allowance: null,
        delta: null,
        limits: { files: 10, lines: 200, percent: 20 },
        review: null,
        reviewed: null,
      },
      kind: "allowed",
      reason: "its required checks are green, and reviewBeforePush is off",
    });
  });

  test("a pair of commits is compared once, in the lower id's order, and its answer turned round", async () => {
    // The pull request's head is "a…"; #5 is at "9…" (compared as 9…...a…) and #6 at "c…"
    // (compared as a…...c…, then the answer turned round: a… holds c…).
    const asked: string[][] = [];
    const nine = "9".repeat(40);
    const see = "c".repeat(40);
    const gh: GhRunner = async (args) => {
      asked.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({
          baseRefName: "main",
          headRefName: "feat",
          headRefOid: "a".repeat(40),
          number: 7,
        });
      }
      if (args[0] === "repo" && args[1] === "view") {
        return JSON.stringify({ defaultBranchRef: { name: "main" } });
      }
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([
          { headRefOid: nine, number: 5 },
          { headRefOid: see, number: 6 },
        ]);
      }
      if (args[0] === "api") {
        const basehead = args[1]?.split("/compare/")[1];
        // #5's head neither holds nor is held; #6's head is held by the pull request's own.
        if (basehead === `${nine}...${"a".repeat(40)}`) return "diverged";
        if (basehead === `${"a".repeat(40)}...${see}`) return "behind";
        if (basehead === `main...${see}`) return "diverged";
      }
      return null;
    };
    const verdict = await checkPullRequest(
      world(gh, undefined, (repo) =>
        commitConfig(repo, { workflow: { allowMerge: true, reviewBeforePush: false } }, ["main"]),
      ),
      { ref: "7", repo: null },
      new Map(),
    );
    expect(verdict).toMatchObject({
      kind: "refused",
      reason:
        "pull request #7 is stacked on open pull request #6: merge #6 first, then check again",
    });
    const compares = asked
      .filter((one) => one[0] === "api")
      .map((one) => one.slice(1))
      .sort();
    const at = (basehead: string) => [
      `repos/{owner}/{repo}/compare/${basehead}`,
      "--jq",
      ".status",
    ];
    expect(compares).toEqual(
      [
        at(`${nine}...${"a".repeat(40)}`),
        at(`${"a".repeat(40)}...${see}`),
        at(`main...${see}`),
      ].sort(),
    );
  });

  /** gh as a pull request into `base` meets it: the view, the default branch, the checks. */
  const ghFor =
    (base: string, bucket: string): GhRunner =>
    async (args) => {
      if (args[0] === "pr" && args[1] === "list") return "[]";
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({
          baseRefName: base,
          headRefName: "feat",
          headRefOid: "a".repeat(40),
          number: 7,
        });
      }
      if (args[0] === "repo" && args[1] === "view") {
        return JSON.stringify({ defaultBranchRef: { name: "main" } });
      }
      if (args[0] === "pr" && args[1] === "checks") return JSON.stringify([{ bucket, name: "ci" }]);
      return null;
    };
  const checkInto = (base: string, bucket: string, workflow: Record<string, unknown>) =>
    checkPullRequest(
      world(ghFor(base, bucket), undefined, (repo) =>
        commitConfig(repo, { workflow, worktrees: { base: "integration" } }, [
          "main",
          "integration",
        ]),
      ),
      { ref: "7", repo: null },
      new Map(),
    );

  test("allowMerge on, a pull request into the default branch (main), green checks, no review gate: allowed", async () => {
    const verdict = await checkInto("main", "pass", { allowMerge: true, reviewBeforePush: false });
    expect(verdict.kind).toBe("allowed");
    expect(verdict).toMatchObject({
      reason: "its required checks are green, and reviewBeforePush is off",
    });
  });

  test("into main it explains why not: allowMerge off, a red check, or no recorded review", async () => {
    const off = await checkInto("main", "pass", { allowMerge: false, reviewBeforePush: false });
    expect(off).toMatchObject({ kind: "refused" });
    expect(JSON.stringify(off)).toContain("allowMerge is off");
    const red = await checkInto("main", "fail", { allowMerge: true, reviewBeforePush: false });
    expect(red).toMatchObject({
      kind: "refused",
      reason: "its required checks are not all green: ci (fail)",
    });
    // The review gate stays on: no review is recorded for the head, so it is refused.
    const unreviewed = await checkInto("main", "pass", { allowMerge: true });
    expect(unreviewed).toMatchObject({ kind: "refused" });
    expect(JSON.stringify(unreviewed)).toContain("review");
  });

  test("a pull request into a branch that is neither the integration base nor main is refused", async () => {
    const verdict = await checkInto("release/1.0", "pass", {
      allowMerge: true,
      reviewBeforePush: false,
    });
    expect(verdict).toMatchObject({ kind: "refused" });
  });

  test("past the caller's deadline a verdict is late, and no gh call is made", async () => {
    const asked: string[][] = [];
    const gh: GhRunner = async (args) => {
      asked.push(args);
      return null;
    };
    expect(
      await checkPullRequest(
        world(gh, () => 0),
        { ref: "7", repo: null },
      ),
    ).toEqual({
      kind: "late",
      number: null,
      what: "the pull request this command names",
    });
    expect(
      await checkBranch(
        world(gh, () => 0),
        { branch: "feat", base: "main" },
      ),
    ).toEqual({
      kind: "late",
      number: null,
      what: "branch feat",
    });
    expect(asked).toEqual([]);
  });

  test("viewPullRequest reads gh's JSON through the runner, or says it could not", async () => {
    const facts = await viewPullRequest({ ref: "7", repo: null }, "/tmp", {}, 1_000, async () =>
      JSON.stringify({
        baseRefName: "main",
        headRefName: "feat",
        headRefOid: "b".repeat(40),
        number: 7,
      }),
    );
    expect(facts).toEqual({ base: "main", headRef: "feat", headOid: "b".repeat(40), number: 7 });
    expect(
      await viewPullRequest({ ref: "7", repo: null }, "/tmp", {}, 1_000, async () => null),
    ).toBeNull();
  });
});
