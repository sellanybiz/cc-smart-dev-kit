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
            workflow: { autoMerge: true, reviewBeforePush: false },
            worktrees: { base: "integration" },
          },
          ["main", "integration"],
        ),
      ),
      { ref: "7", repo: null },
      new Map(),
    );
    expect(asked.map((one) => one.slice(0, 2))).toEqual([
      ["pr", "view"],
      ["repo", "view"],
      ["pr", "checks"],
    ]);
    expect(verdict).toEqual({
      kind: "allowed",
      reason: "its required checks are green, and reviewBeforePush is off",
    });
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
