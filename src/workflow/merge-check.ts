/**
 * The merge check: may this merge happen by itself? One judgment, made for a pull request and
 * for a local branch against a base (D22, the check before a phase's branch merges locally).
 * `cc-smart-dev-kit workflow merge-check` prints its verdicts and the portal shows them; no hook
 * calls it. It is what a session reads before it merges with `allowMerge` on, so it is the one
 * gate before an unattended merge: its checks below are the whole policy.
 *
 * **A pull request** is judged with the policy committed on its base (`resolveGate`), never a
 * checkout's working copy: `allowMerge` on, its base the project's integration base or the
 * repository's default branch, every required check green, and — with `reviewBeforePush` on —
 * the head covered by a review under D17 (`readCover`: a review of an earlier commit of the
 * head's branch counts while the fixes after it stay within `workflow.fixesAfterReview`), and
 * the pull request not stacked on another open one (`stackedVerdict`: its own commits, the
 * ones its base lacks by GitHub's compare, share none with another open pull request's, unless
 * that one is opened against this one's branch, which makes it the upper one). Only
 * then is it allowed; everything else is refused, with the reason. Every fact is read read-only
 * (`gh pr view`, `gh pr list`, `gh api` compare, `gh repo view`, `gh pr checks`, the review
 * record, git); a `gh` that is
 * missing or answers nothing is "could not read", never a guess.
 *
 * **`asked`** (`workflow merge-check <pr> --asked`): the person said yes to this merge. That sets
 * aside the `allowMerge` switch alone. The base rules, the required checks and the review are
 * judged as always, so an unattended session can prove that the switch is the only thing left
 * between it and a merge the person already asked for. A local branch has no switch, so it takes
 * no such option.
 *
 * **A local branch** is judged against a base without gh: the review gate's `reviewBeforePush`
 * and the record alone, the same limits. It is what the main session checks before it merges a
 * phase's branch locally (D22).
 *
 * **What it never decides:** which command is a merge, whether it names this project's own
 * repository, and whether it carries `--admin`: the caller's rules about the command line.
 *
 * Nothing here writes, fetches or reaches the network beyond the read-only `gh` calls.
 * **Every child is awaited** (`Bun.spawn`: the caller's `gh` runner, `runGitAsync`,
 * `readCover`): the portal makes this check inside its own process, where a blocking spawn
 * would freeze every page and the live stream (`.claude/rules/portal.md`).
 */
import type { CliPaths } from "../cli/paths";
import { commitArgs, commitIn, GUARD_GIT_TIMEOUT_MS, runGitAsync } from "../hooks/git";
import type { Env } from "../hooks/run";
import type { Checkout } from "../project/resolve";
import { autoMergeOff, autoMergeRefusal, baseRefusal } from "./auto-merge";
import { type GateRead, type ResolvedWorkflow, resolveGateAsync } from "./resolve";
import {
  allowanceOf,
  type ChangeCount,
  type Cover,
  type FixLimits,
  readCover,
} from "./review-cover";
import { COMMIT_SHA, reviewsFile, trustedReviews } from "./reviews";

/** How long one `gh` call may take: a read-only network call, and a guard has 30 s. */
export const GH_TIMEOUT_MS = 10_000;

/**
 * How long one `gh` call that WRITES may take (`issue file`: create, edit, label): GitHub
 * answers a write slower than a read, and a person waits for it, not a guard.
 */
export const GH_WRITE_TIMEOUT_MS = 30_000;

/** Where and how one `gh` call runs: the repository's folder, the environment, its time. */
export interface GhCall {
  env: Env;
  /**
   * The folder gh runs in. Left out, gh runs in the process's own folder as the child inherits
   * it, which still works after that folder was removed (a long-lived portal started from a
   * worktree that is gone now); asking `process.cwd()` there would throw.
   */
  folder?: string;
  /** Text written to gh's stdin (`--body-file -`); none when left out. */
  input?: string;
  timeoutMs: number;
}

/** What one `gh` call did: its streams and why it ended. */
export interface GhResult {
  /** gh's exit code; null when it did not exit on its own. */
  code: number | null;
  /** stderr, trimmed. */
  err: string;
  /** `ok` exit 0; `failed` another exit; `missing` no gh on PATH; `timeout` the time ran out. */
  kind: "failed" | "missing" | "ok" | "timeout";
  /** stdout, as gh printed it. */
  out: string;
  /**
   * The signal that ended gh, when one did (its number when it has no name): SIGTERM for a
   * timeout, another for gh dying. Left out when gh exited or never started. A caller whose
   * call may have acted before the end (`workflow propose`'s `gh pr create`) tells a signal
   * from a spawn that failed by it.
   */
  signal?: NodeJS.Signals | number;
}

/**
 * One `gh` call, awaited, with how it ended told apart: a timeout, no console window on
 * Windows, no blocking spawn. Every awaited `gh` call of the kit starts through it: `spawnGh`,
 * `issue file` (which must tell a missing gh from a timeout from a refusal), `workflow
 * propose`'s `gh pr create` and `project init`'s runners. A few blocking reads in hooks and the
 * worktree scan still spawn `gh` themselves.
 */
export type GhExec = (args: string[], call: GhCall) => Promise<GhResult>;

/** The `gh` executor in use. */
export const runGh: GhExec = async (args, { folder, env, input, timeoutMs }) => {
  try {
    const child = Bun.spawn(["gh", ...args], {
      ...(folder === undefined ? {} : { cwd: folder }),
      env,
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      // A guard runs with no console of its own on Windows: without this, gh opens one.
      windowsHide: true,
    });
    const [out, err] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (child.signalCode !== null) {
      // The time limit stops the child with SIGTERM; any other signal is gh dying, not time.
      const kind = child.signalCode === "SIGTERM" ? "timeout" : "failed";
      return { code: null, err: err.trim(), kind, out, signal: child.signalCode };
    }
    return {
      code: child.exitCode,
      err: err.trim(),
      kind: child.exitCode === 0 ? "ok" : "failed",
      out,
    };
  } catch (error) {
    // The spawn threw: no gh on the PATH the call runs with, or something else (a folder that
    // is not there). Only the first is "missing".
    return {
      code: null,
      err: error instanceof Error ? error.message : String(error),
      kind: Bun.which("gh", { PATH: env.PATH ?? "" }) === null ? "missing" : "failed",
      out: "",
    };
  }
};

/**
 * What `gh pr checks --required` says when the branch has none, as gh words it: a line on
 * stderr and exit 1, not a list. gh has two such lines: `no required checks reported` (checks
 * exist, none is required) and `no checks reported` (a pull request with no checks at all).
 * Both are an answer ("none"), so `spawnGh` hands it on and `requiredChecks` reads it as an
 * empty list; every other failure stays a failure.
 */
const NO_REQUIRED_CHECKS = /^no (?:required )?checks reported on the '.*' branch$/;

/**
 * One read-only `gh` command's stdout, or null when gh is not there, the call fails, or it
 * printed nothing (the one failure that is an answer, `NO_REQUIRED_CHECKS`, comes back as its
 * line). **It never blocks**: `spawnGh` is `Bun.spawn`, because the portal makes
 * this check inside its own process and a blocking spawn there freezes every page and the
 * live stream (`.claude/rules/portal.md`). A test hands in its own runner.
 */
export type GhRunner = (args: string[], call: GhCall) => Promise<string | null>;

/** The `gh` runner in use: the same command, environment and timeout as `ghStdout` always had. */
export const spawnGh: GhRunner = async (args, call) => {
  const { err, kind, out } = await runGh(args, call);
  // No gh on PATH, or a call that timed out: nothing. Any other exit keeps what gh printed.
  if (kind === "missing" || kind === "timeout") return null;
  if (out.trim() === "") return kind === "failed" && NO_REQUIRED_CHECKS.test(err) ? err : null;
  return out;
};

/** The fields `gh pr view --json` gives: the number, the base, and the head's branch and commit. */
export const PULL_REQUEST_FACTS = "number,baseRefName,headRefName,headRefOid";

/** The pull request facts the check judges with. */
export interface PullRequestFacts {
  /** The pull request's number, as the questions name it. */
  number: number;
  /** The branch it goes into. */
  base: string;
  /** The branch it comes from: the branch a review's record must name (D17). */
  headRef: string;
  /** The commit at its head. */
  headOid: string;
}

/** The facts from `gh pr view`'s JSON, or null when it is not the shape asked for. */
export function parsePullRequestFacts(json: string): PullRequestFacts | null {
  try {
    const view = JSON.parse(json) as Record<string, unknown>;
    const { baseRefName, headRefName, headRefOid, number } = view;
    if (typeof number !== "number" || typeof baseRefName !== "string") return null;
    if (typeof headRefName !== "string" || headRefName === "") return null;
    if (typeof headRefOid !== "string" || !COMMIT_SHA.test(headRefOid)) return null;
    return { number, base: baseRefName, headRef: headRefName, headOid: headRefOid };
  } catch {
    return null;
  }
}

/** The repository's default branch from `gh repo view --json defaultBranchRef`, or null. */
export function parseDefaultBranch(json: string): string | null {
  try {
    const view = JSON.parse(json) as { defaultBranchRef?: unknown };
    const ref = view.defaultBranchRef;
    if (typeof ref !== "object" || ref === null) return null;
    const name = (ref as { name?: unknown }).name;
    return typeof name === "string" && name !== "" ? name : null;
  } catch {
    return null;
  }
}

/**
 * How many open pull requests `gh pr list --limit` is asked for. A list that fills it may be
 * cut (gh's own default is 30), so the check refuses it rather than guess.
 */
export const OPEN_PULL_REQUESTS_LIMIT = 500;

/**
 * The fields the stacked check lists for each open pull request (`gh pr list --json`): its
 * number, its head's commit and branch, the branch it targets, and whether its head lives in
 * another repository (GitHub's `isCrossRepository`: "The head and base repositories are
 * different", https://docs.github.com/en/graphql/reference/pulls).
 */
export const OPEN_PULL_REQUEST_FIELDS =
  "number,headRefOid,headRefName,baseRefName,isCrossRepository";

/**
 * GitHub REST, "Compare two commits" (https://docs.github.com/en/rest/commits/commits#compare-two-commits):
 * `compare/BASE...HEAD` is "equivalent to running the git log BASE..HEAD command": `commits` are
 * the commits HEAD has and BASE lacks, `total_commits` how many there are. "When calling this
 * endpoint without any paging parameter (per_page or page), the returned list is limited to 250
 * commits", so the check always pages: `per_page` (most 100) and `page` (from 1). The printed
 * answer is the total on the first line, then one commit id a line.
 */
const COMMITS_FIELDS = ".total_commits, .commits[].sha";

/** The most commits one page of the compare holds: the docs' `per_page` maximum. */
const COMMITS_PER_PAGE = 100;

/**
 * The most commits the stacked check reads for one pull request. A pull request that carries
 * more is refused with that reason, never judged on part of its commits: one more page is one
 * more gh call, and a page has its deadline.
 */
export const STACK_COMMITS_LIMIT = 1000;

/** How many pull requests' commits one stacked check reads at once. */
const STACK_READS_AT_ONCE = 4;

/** One open pull request, as the stacked check reads it. */
export interface OpenPullRequest {
  number: number;
  /** The branch it targets. */
  base: string;
  /** The commit at its head. */
  headOid: string;
  /** Its head's branch, in the head's own repository. */
  headRef: string;
  /** Its head is in another repository (a fork), so `headRef` is not this repository's branch. */
  fork: boolean;
}

/** The open pull requests from `gh pr list --json <OPEN_PULL_REQUEST_FIELDS>`, or null when not that shape. */
export function parseOpenPullRequests(json: string): OpenPullRequest[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const open: OpenPullRequest[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) return null;
      const { baseRefName, headRefName, headRefOid, isCrossRepository, number } = entry as {
        baseRefName?: unknown;
        headRefName?: unknown;
        headRefOid?: unknown;
        isCrossRepository?: unknown;
        number?: unknown;
      };
      if (typeof number !== "number" || !Number.isInteger(number)) return null;
      if (typeof headRefOid !== "string" || !COMMIT_SHA.test(headRefOid)) return null;
      if (typeof baseRefName !== "string" || baseRefName === "") return null;
      if (typeof headRefName !== "string") return null;
      if (typeof isCrossRepository !== "boolean") return null;
      open.push({
        base: baseRefName,
        fork: isCrossRepository,
        headOid: headRefOid,
        headRef: headRefName,
        number,
      });
    }
    return open;
  } catch {
    return null;
  }
}

/** One required check `gh pr checks --required --json name,bucket` reported. */
export interface RequiredCheck {
  name: string;
  /** `pass`, `fail`, `pending`, `skipping` or `cancel`, as gh buckets the check's state. */
  bucket: string;
}

/** The checks from `gh pr checks`'s JSON, or null when it is not the shape asked for. */
export function parseRequiredChecks(json: string): RequiredCheck[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const checks: RequiredCheck[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) return null;
      const { bucket, name } = entry as { bucket?: unknown; name?: unknown };
      if (typeof bucket !== "string" || typeof name !== "string") return null;
      checks.push({ bucket, name });
    }
    return checks;
  } catch {
    return null;
  }
}

/**
 * The buckets that count as passed. GitHub treats a skipped required check as a success, so
 * a merge it would allow is not held up here either; `fail`, `pending` and `cancel` do not.
 */
export const PASSING_BUCKETS: ReadonlySet<string> = new Set(["pass", "skipping"]);

/**
 * The review gate's own numbers behind a verdict (D17, D22), for the portal's project page:
 * which review covers the head, the change made after it and the change it reviewed, and the
 * gate's `fixesAfterReview` limits those are judged against. A generated file is listed, not
 * counted, and a binary file changed after the review is never covered (`review-cover.ts`).
 * `limits` is null only in a caller that has no gate to read; the check fills it whenever it
 * read the gate, whether or not a review is required.
 */
export interface MergeDetail {
  /** What the review still covers: the limit or the percent of the reviewed change, whichever is larger. */
  allowance: null | { files: number; lines: number };
  /** The change after the review; null when it is the reviewed commit itself, or none was measured. */
  delta: null | { binary: number; files: number; lines: number };
  /** The gate's limits (`workflow.fixesAfterReview`); null when no gate was read. */
  limits: null | { files: number; lines: number; percent: number };
  /** The reviewed commit the verdict is about; null when no review candidate exists. */
  review: null | string;
  /** The reviewed change's own size; null unless both it and the change after it were measured. */
  reviewed: null | { binary: number; files: number; lines: number };
}

/** What one merge check decided. */
export type MergeVerdict =
  | {
      /** The review gate's numbers: null when the check refused before it read the gate. */
      detail: MergeDetail | null;
      kind: "allowed";
      /** The short sentence both the guard's `allow` and the command print. */
      reason: string;
    }
  | { detail: MergeDetail | null; kind: "refused"; number: number | null; reason: string }
  | { kind: "unread"; number: number | null; what: string }
  | { kind: "late"; number: number | null; what: string };

/** Everything a merge check reads: the checkout, gh's folder, the environment and the clock. */
export interface MergeWorld {
  /** Where the review record and the person's own workflow file live. */
  paths: CliPaths;
  /** The checkout the reviewed commits must be in, and whose objects the measurement reads. */
  checkout: Checkout;
  /** Where gh runs: the repository its answers are about. */
  folder: string;
  env: Env;
  /**
   * How long the next child may take: the smaller of `limitMs` and the time the caller has
   * left (merge-check's `timeFor`). A caller with no deadline returns `limitMs`.
   */
  timeFor: (limitMs: number) => number;
  /**
   * How gh runs. Left out: `spawnGh` (`Bun.spawn`). A test hands in a fake, and the portal's
   * own answer passes the runner on so a slow gh never blocks a page.
   */
  gh?: GhRunner;
  /**
   * The policy committed on a branch (`resolveGate`), or why it cannot be read; the hook
   * caches one read per branch per run. Left out: read here, once per call.
   */
  gateOf?: (branch: string) => GateRead | "late" | Promise<GateRead | "late">;
}

/** The review gate as the record is judged with: the rules, and where the record is. */
export interface ReviewGate {
  /** `reviewBeforePush` is on: a review is required. */
  reviewBeforePush: boolean;
  /** The agent types whose records count. */
  agents: readonly string[];
  /** The D17 limits a fix after the review may reach. */
  limits: FixLimits;
  /** The repository's review record: `<stateDir>/reviews/<key>.json`. */
  file: string;
}

/** The review gate of `resolved`, and the record of `checkout`'s repository. */
export function reviewGateOf(
  paths: CliPaths,
  checkout: Checkout,
  resolved: ResolvedWorkflow,
): ReviewGate {
  const repository = checkout.mainCheckout ?? checkout.root;
  return {
    reviewBeforePush: resolved.reviewBeforePush.value,
    agents: resolved.reviewAgents.value,
    limits: {
      lines: resolved.fixesAfterReview.lines.value,
      files: resolved.fixesAfterReview.files.value,
      percent: resolved.fixesAfterReview.percent.value,
    },
    file: reviewsFile(paths.stateDir, repository),
  };
}

/**
 * The review of `target` under D17: its cover when `reviewBeforePush` is on, null when no
 * review is required. Never throws. Awaited: the measurement runs git with `Bun.spawn`
 * (`readCover`), so a portal page is never frozen by it.
 */
async function coverOf(
  world: MergeWorld,
  review: ReviewGate,
  target: { head: string; branch: string | null; base: string },
): Promise<Cover | null> {
  if (!review.reviewBeforePush) return null;
  return await readCover(
    world.checkout,
    target,
    trustedReviews(review.file, review.agents),
    review.limits,
    {
      env: world.env,
      timeFor: world.timeFor,
    },
  );
}

/**
 * Why the head is not covered by a review, or null when it is (or none is required). When no
 * review is recorded at all, the reason also says how one gets recorded; a fix over the limit
 * already carries the counts and the limit.
 */
function reviewRefusal(cover: Cover | null): string | null {
  if (cover === null || cover.covered) return null;
  if (cover.review !== null) return cover.why;
  return `${cover.why} (reviewBeforePush is on: a review agent's return records the commit, so run the reviewer with your fixes already committed)`;
}

/** One change as a page reads it: its lines and files, and how many binary files it holds. */
function counted(change: ChangeCount): { binary: number; files: number; lines: number } {
  return { binary: change.binary.length, files: change.files, lines: change.lines };
}

/** One of the cover's changes as a page reads it, or null when it was not measured. */
function countsOf(
  change: ChangeCount | null | undefined,
): null | { binary: number; files: number; lines: number } {
  return change === null || change === undefined ? null : counted(change);
}

/**
 * The review gate's numbers behind a verdict: the review the cover is about, the change after
 * it and the change it reviewed, what that review still covers (`allowanceOf`), and the limits
 * they were judged against. A review of the head itself has no delta, no reviewed change and no
 * allowance; a cover that refuses carries the measurement its reason is about, when one was
 * made. `limits` is always the gate's own: the verdict says what it judged by.
 */
function detailOf(cover: Cover | null, limits: FixLimits): MergeDetail {
  const reviewed = cover?.reviewed;
  return {
    allowance: reviewed === null || reviewed === undefined ? null : allowanceOf(reviewed, limits),
    delta: countsOf(cover?.delta),
    limits: { files: limits.files, lines: limits.lines, percent: limits.percent },
    review: cover?.review ?? null,
    reviewed: countsOf(reviewed),
  };
}

/** The first seven characters of a commit: how a person reads it. */
function short(sha: string): string {
  return sha.slice(0, 7);
}

/** A cover that says the head is covered: the allowed path's shape. */
type Covered = Extract<Cover, { covered: true }>;

/** The short reason an allowed pull request merge gives: what the policy proved. */
function pullRequestAllowed(cover: Covered | null): string {
  if (cover === null) return "its required checks are green, and reviewBeforePush is off";
  return `the review of ${short(cover.review)} covers its head, and its required checks are green`;
}

/**
 * The reason an allowed pull request gives when the person's yes (`asked`) stood in for the
 * `allowMerge` switch: it says so first, so the verdict line never reads as `allowMerge` being on.
 */
function askedAllowed(reason: string): string {
  return `the merge rests on the person's yes (--asked), not on allowMerge, which is off: ${reason}`;
}

/** The reason an allowed local branch gives. */
function branchAllowed(branch: string, head: string, cover: Covered | null): string {
  if (cover === null) return `reviewBeforePush is off, so no review is required for ${branch}`;
  if (cover.delta === null)
    return `the review of ${short(cover.review)} is of ${short(head)} itself`;
  return `the review of ${short(cover.review)} covers ${short(head)}, with the fixes after it within the limits`;
}

/** What the guard knows when it decides a pull request merge: every field is a fact it read. */
export interface MergeFacts {
  /** Why the branch policy refuses, or null when it allows. */
  branchRefusal: string | null;
  /** Why the review does not cover the head, or null when it does (or none is required). */
  reviewRefusal: string | null;
  /** The required checks gh reported; null when gh did not say. */
  checks: RequiredCheck[] | null;
}

/**
 * The reason the person must decide this merge, or null when it may happen by itself. With
 * `checks` null the answer here is null: gh did not answer, and that has its own question
 * (`notChecked`). The review comes last, so a merge whose checks are red never pays for the
 * measurement.
 */
export function mergeRefusal(facts: MergeFacts): string | null {
  if (facts.branchRefusal !== null) return facts.branchRefusal;
  if (facts.checks === null) return null;
  if (facts.checks.length === 0) {
    return "gh reports no required checks for it, so there is nothing green to trust";
  }
  const failing = facts.checks.filter((check) => !PASSING_BUCKETS.has(check.bucket));
  if (failing.length > 0) {
    const list = failing.map((check) => `${check.name} (${check.bucket})`).join(", ");
    return `its required checks are not all green: ${list}`;
  }
  return facts.reviewRefusal;
}

/**
 * Why the guard cannot judge with the policy committed on `branch`: its ref, its file, or the
 * file's content cannot be used. A policy counts once it is pushed and fetched — the guard
 * fetches nothing itself — so that is the way out the question names.
 */
export function policyUnread(branch: string | null, why: string, policy = "merge policy"): string {
  const where = branch === null ? "the workflow settings" : `the ${policy} committed on ${branch}`;
  if (branch !== null && why.startsWith(`origin/${branch} is not known in this repository`)) {
    return `${where} cannot be read: ${why}; the base branch may never have been pushed: push it once (git push -u origin ${branch}), then run merge-check again; if it already exists on origin, fetch it first`;
  }
  return `${where} cannot be read: ${why}; a policy counts once it is committed, pushed and fetched`;
}

/** Why the guard cannot judge when the person's own workflow file cannot be read. */
export function workflowUnread(error: unknown): string {
  // The person's own workflow file cannot be read, so whether allowMerge is on is unknown.
  return `the workflow settings cannot be read (${error instanceof Error ? error.message : String(error)})`;
}

/** The question when the guard could not read what it needs: gh is missing, or did not answer. */
export function notChecked(what: string, env: Env): string {
  const why = ghMissing(env) ? "gh is not installed" : `gh could not read ${what}`;
  return `cc-smart-dev-kit could not check this merge: ${why}. Approve the merge yourself if it is right.`;
}

/**
 * The question when the guard's own budget ran out before it could read `what`. Its own
 * answer, not `notChecked`'s: gh was never asked, and the reason is the guard's deadline.
 */
export function notInTime(what: string): string {
  return `cc-smart-dev-kit could not check this merge in time: reading ${what} would have taken longer than the guard's own budget allows. Approve the merge yourself if it is right.`;
}

/** True when no `gh` is on the PATH `env` names. */
export function ghMissing(env: Env): boolean {
  try {
    return Bun.which("gh", { PATH: env.PATH ?? "" }) === null;
  } catch {
    return false;
  }
}

/**
 * One read-only `gh` command's stdout, or null when gh is not there, the call fails, or it
 * printed nothing. The exit code is not the test: `gh pr checks` exits 8 while the required
 * checks are still running, and the JSON on its stdout is what matters. Awaited, through the
 * caller's runner (`spawnGh` unless a caller passed one).
 */
async function ghStdout(
  args: string[],
  folder: string,
  env: Env,
  timeoutMs: number,
  run: GhRunner,
): Promise<string | null> {
  return await run(args, { env, folder, timeoutMs });
}

/** The pull request a merge command names: `gh pr view`'s facts, or null when gh cannot say. */
export async function viewPullRequest(
  target: { ref: string | null; repo: string | null },
  folder: string,
  env: Env,
  timeoutMs: number = GH_TIMEOUT_MS,
  run: GhRunner = spawnGh,
): Promise<PullRequestFacts | null> {
  const out = await ghStdout(
    [
      "pr",
      "view",
      ...(target.ref === null ? [] : [target.ref]),
      ...(target.repo === null ? [] : ["--repo", target.repo]),
      "--json",
      PULL_REQUEST_FACTS,
    ],
    folder,
    env,
    timeoutMs,
    run,
  );
  return out === null ? null : parsePullRequestFacts(out);
}

/**
 * The required checks of one pull request, or null when gh cannot say. A branch with none is an
 * empty list (`NO_REQUIRED_CHECKS`), which `mergeRefusal` refuses in its own words.
 */
export async function requiredChecks(
  number: number,
  repo: string | null,
  folder: string,
  env: Env,
  timeoutMs: number = GH_TIMEOUT_MS,
  run: GhRunner = spawnGh,
): Promise<RequiredCheck[] | null> {
  const out = await ghStdout(
    [
      "pr",
      "checks",
      String(number),
      "--required",
      ...(repo === null ? [] : ["--repo", repo]),
      "--json",
      "name,bucket",
    ],
    folder,
    env,
    timeoutMs,
    run,
  );
  if (out === null) return null;
  return NO_REQUIRED_CHECKS.test(out.trim()) ? [] : parseRequiredChecks(out);
}

/**
 * The repository's default branch, or null when gh cannot say. A merge command that named
 * this project's own repository (`--repo owner/name`) is judged against THAT repository's
 * default branch, not the one in the folder the session runs in.
 *
 * `gh repo view` takes the repository as an argument, not as a flag — `gh repo view --repo x`
 * fails with "unknown flag: --repo" (gh 2.102.0, checked live), so the flag form only ever
 * asked the guard a question it could have answered.
 */
export async function defaultBranchOf(
  folder: string,
  env: Env,
  repo: string | null = null,
  timeoutMs: number = GH_TIMEOUT_MS,
  run: GhRunner = spawnGh,
): Promise<string | null> {
  const out = await ghStdout(
    ["repo", "view", ...(repo === null ? [] : [repo]), "--json", "defaultBranchRef"],
    folder,
    env,
    timeoutMs,
    run,
  );
  return out === null ? null : parseDefaultBranch(out);
}

/** The gate committed on `branch`: the caller's cached read, or one made here (never blocking). */
async function gateFor(world: MergeWorld, branch: string): Promise<GateRead | "late"> {
  if (world.gateOf !== undefined) return await world.gateOf(branch);
  const left = world.timeFor(GUARD_GIT_TIMEOUT_MS);
  if (left <= 0) return "late";
  return await resolveGateAsync(world.paths, world.checkout, branch, {
    env: world.env,
    timeoutMs: left,
  });
}

/** One read the stacked check shares: its value, or why there is none (`late`: the deadline). */
type StackRead<T> = { ok: true; value: T } | { late: boolean; ok: false; why: string };

/**
 * What one run of `merge-check` shares between the pull requests it judges: the open pull
 * requests (read once per repository) and each pull request's own commits (read once per base
 * and head). The portal's project page and a command given several pull requests pass one, so
 * ten rows cost one list and one read of each pull request's commits, not ten of each.
 */
export interface StackCache {
  /** The commits a head has and its base lacks, by folder, repository, base and head. */
  commits: Map<string, Promise<StackRead<ReadonlySet<string>>>>;
  /** The open pull requests, by folder and repository. */
  open: Map<string, Promise<StackRead<OpenPullRequest[]>>>;
}

/** A fresh cache for one run. */
export function newStackCache(): StackCache {
  return { commits: new Map(), open: new Map() };
}

/** Where gh runs a stacked read: the repository it names, or the folder's own. */
type StackTarget = { ref: string | null; repo: string | null };

/**
 * What a stacked read answers when it has none: `late` when the caller's clock has run out (the
 * read was cut short, or never made), otherwise `why`. A cut read is `late`, as every other
 * read of the check is, never a refusal that blames gh.
 */
function noAnswer(world: MergeWorld, why: string): { late: boolean; ok: false; why: string } {
  return world.timeFor(GH_TIMEOUT_MS) <= 0
    ? { late: true, ok: false, why: "" }
    : { late: false, ok: false, why };
}

/**
 * The key of a cached read: the folder and the repository it was made for, then what was asked.
 * One cache may then serve several projects and never mix their answers.
 */
function stackKey(world: MergeWorld, target: StackTarget, asked: string): string {
  return [world.folder, target.repo ?? "", asked].join("\n");
}

/** `gh pr list` of the open pull requests, awaited; one answer or why there is none. */
async function askOpenPullRequests(
  world: MergeWorld,
  target: StackTarget,
): Promise<StackRead<OpenPullRequest[]>> {
  const left = world.timeFor(GH_TIMEOUT_MS);
  if (left <= 0) return { late: true, ok: false, why: "" };
  const out = await ghStdout(
    [
      "pr",
      "list",
      "--state",
      "open",
      ...(target.repo === null ? [] : ["--repo", target.repo]),
      "--limit",
      String(OPEN_PULL_REQUESTS_LIMIT),
      "--json",
      OPEN_PULL_REQUEST_FIELDS,
    ],
    world.folder,
    world.env,
    left,
    world.gh ?? spawnGh,
  );
  const open = out === null ? null : parseOpenPullRequests(out);
  if (open === null) return noAnswer(world, "gh could not list the open pull requests");
  if (open.length >= OPEN_PULL_REQUESTS_LIMIT) {
    return {
      late: false,
      ok: false,
      why: `gh listed ${OPEN_PULL_REQUESTS_LIMIT} open pull requests, the most it was asked for`,
    };
  }
  return { ok: true, value: open };
}

/** The open pull requests, read once per repository for every caller of `cache`. */
function openPullRequestsOf(
  world: MergeWorld,
  target: StackTarget,
  cache: StackCache,
): Promise<StackRead<OpenPullRequest[]>> {
  const key = stackKey(world, target, "open pull requests");
  let read = cache.open.get(key);
  if (read === undefined) {
    read = askOpenPullRequests(world, target);
    cache.open.set(key, read);
  }
  return read;
}

/** A commit id as a person reads it (twelve characters); a branch name as it is. */
function shortCommit(name: string): string {
  return COMMIT_SHA.test(name) ? name.slice(0, 12) : name;
}

/**
 * One page as `COMMITS_FIELDS` prints it: the total on the first line, then only commit ids.
 * Null for anything else: gh prints the JSON body of an HTTP error (a 404, a rate limit) on
 * stdout, and that body is never read as an answer or shown as one.
 */
function parseCommitsPage(out: string): { commits: string[]; total: number } | null {
  const [first, ...commits] = out.trim().split(/\r?\n/);
  if (first === undefined || !/^\d+$/.test(first)) return null;
  if (!commits.every((line) => COMMIT_SHA.test(line))) return null;
  return { commits, total: Number(first) };
}

/**
 * The commits `head` has and `base` lacks, by GitHub's compare (`COMMITS_FIELDS`), read page by
 * page until a page holds fewer than `per_page` commits, then the count must equal
 * `total_commits`. Never a part of them: a total above `STACK_COMMITS_LIMIT`, a total that
 * changes between pages, or a count that is not the total are no answer, with the reason. `{owner}/{repo}` is gh's own placeholder for the
 * folder's repository; a `--repo` names it outright. Each name is encoded as a path segment (a
 * branch `release/1` is `release%2F1`), and the `...` between them stays.
 */
async function askCommits(
  world: MergeWorld,
  target: StackTarget,
  base: string,
  head: string,
): Promise<StackRead<ReadonlySet<string>>> {
  const basehead = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const named = `${shortCommit(base)}...${shortCommit(head)}`;
  const read = new Set<string>();
  let total: number | null = null;
  for (let page = 1; ; page += 1) {
    const left = world.timeFor(GH_TIMEOUT_MS);
    if (left <= 0) return { late: true, ok: false, why: "" };
    const out = await ghStdout(
      [
        "api",
        `repos/${target.repo ?? "{owner}/{repo}"}/compare/${basehead}?per_page=${COMMITS_PER_PAGE}&page=${page}`,
        "--jq",
        COMMITS_FIELDS,
      ],
      world.folder,
      world.env,
      left,
      world.gh ?? spawnGh,
    );
    const answer = out === null ? null : parseCommitsPage(out);
    if (answer === null) {
      return noAnswer(
        world,
        `GitHub could not compare ${shortCommit(base)} and ${shortCommit(head)} (gh printed no total and commit ids)`,
      );
    }
    if (total !== null && answer.total !== total) {
      return {
        late: false,
        ok: false,
        why: `GitHub's count of ${named} changed from ${total} to ${answer.total} while it was read`,
      };
    }
    total = answer.total;
    if (total > STACK_COMMITS_LIMIT) {
      return {
        late: false,
        ok: false,
        why: `${named} holds ${total} commits, more than the ${STACK_COMMITS_LIMIT} merge-check reads`,
      };
    }
    for (const commit of answer.commits) read.add(commit);
    // A page with room left is the last one. Only then is the count checked against the total, so
    // a total that counts too low cannot stop the reading on a partial set.
    if (answer.commits.length < COMMITS_PER_PAGE) {
      if (read.size === total) return { ok: true, value: read };
      return {
        late: false,
        ok: false,
        why: `GitHub listed ${read.size} of the ${total} commits of ${named}`,
      };
    }
    if (read.size > total || page >= Math.ceil(STACK_COMMITS_LIMIT / COMMITS_PER_PAGE) + 1) {
      return {
        late: false,
        ok: false,
        why: `GitHub listed more than the ${total} commits of ${named}`,
      };
    }
  }
}

/** One pull request's commits, read once per run: the same base and head in `cache` are one answer. */
function commitsOf(
  world: MergeWorld,
  target: StackTarget,
  cache: StackCache,
  base: string,
  head: string,
): Promise<StackRead<ReadonlySet<string>>> {
  const key = stackKey(world, target, `commits ${base}...${head}`);
  let read = cache.commits.get(key);
  if (read === undefined) {
    read = askCommits(world, target, base, head);
    cache.commits.set(key, read);
  }
  return read;
}

/**
 * True when `other` is opened against `view`'s own head branch: it is stacked on `view`, the
 * way the commit skill opens an upper pull request, so it never holds `view` up. Only when
 * neither head is a fork's: a fork's `headRef` names a branch of the fork, not one of this
 * repository, so a base of that name is another branch. `self` is `view` as the open list has
 * it; when the list does not have it, nothing is skipped.
 */
function stackedOnView(
  other: OpenPullRequest,
  view: PullRequestFacts,
  self: OpenPullRequest | undefined,
): boolean {
  if (self === undefined || self.fork || other.fork) return false;
  return other.base === view.headRef;
}

/** What the stacked check found about one other open pull request. */
type StackedOn =
  | { kind: "clear" }
  | { kind: "shares"; fork: boolean }
  | { kind: "unread"; late: boolean; why: string };

/** The refusal when the check cannot tell whether a pull request is stacked: never a pass. */
function cannotProve(number: number, why: string): MergeVerdict {
  return {
    detail: null,
    kind: "refused",
    number,
    reason: `${why}, so merge-check cannot prove it is not stacked on an open pull request`,
  };
}

/**
 * Whether a pull request is stacked on another open one, so that merging it would put that
 * pull request's commits into the base past their own review, checks and refusals.
 *
 * Each pull request's own commits are what its base lacks (`compare/<base>...<head>`, read in
 * full, `commitsOf`). Two pull requests are stacked when those sets share a commit. Commits,
 * not a merge base: one merge base can hide shared commits (a criss-cross, after both branches
 * merged a newer base), and any number of merge bases cannot hide a shared commit.
 *
 * Which one is lower comes from the open list's branches. An open pull request opened against
 * this one's head branch (`stackedOnView`) is the upper one, so it is skipped: the lower pull
 * request of a stack opened that way is never refused because of the one above it, and the
 * upper one is refused by the base rule until the lower one merges. Two pull requests into the
 * same base that share commits cannot say which is lower, so each is refused, in words that fit
 * both. Two at the same head are one commit, with one review and one set of checks: clear.
 *
 * Null when it is not stacked; a refusal when it is, and also when gh cannot say, answers
 * something that is not a total and commit ids, holds more commits than the check reads, or may
 * have cut the open list (`OPEN_PULL_REQUESTS_LIMIT`): only a complete answer proves it is not
 * stacked. A read the caller's deadline cut short is `late`, never a refusal. A stack found
 * wins over a read that failed. The person's yes (`asked`) never reaches here: it sets aside
 * `allowMerge` alone.
 */
async function stackedVerdict(
  world: MergeWorld,
  view: PullRequestFacts,
  target: StackTarget,
  cache: StackCache,
): Promise<MergeVerdict | null> {
  const listed = await openPullRequestsOf(world, target, cache);
  if (!listed.ok) {
    if (listed.late) return { kind: "late", number: view.number, what: "the open pull requests" };
    return cannotProve(view.number, listed.why);
  }
  const self = listed.value.find((one) => one.number === view.number);
  const others = listed.value
    .filter(
      (other) =>
        other.number !== view.number &&
        other.headOid !== view.headOid &&
        !stackedOnView(other, view, self),
    )
    .sort((left, right) => left.number - right.number);
  if (others.length === 0) return null;
  const mine = await commitsOf(world, target, cache, view.base, view.headOid);
  if (!mine.ok) {
    if (mine.late) {
      return { kind: "late", number: view.number, what: `whether #${view.number} is stacked` };
    }
    return cannotProve(
      view.number,
      `the commits of pull request #${view.number} could not be read (${mine.why})`,
    );
  }
  // Nothing of its own to bring into the base, so nothing it could carry for another.
  if (mine.value.size === 0) return null;
  const found: Array<{ number: number; on: StackedOn }> = [];
  for (let at = 0; at < others.length; at += STACK_READS_AT_ONCE) {
    const batch = others.slice(at, at + STACK_READS_AT_ONCE);
    const ons = await Promise.all(
      batch.map(async (other): Promise<StackedOn> => {
        const theirs = await commitsOf(world, target, cache, other.base, other.headOid);
        if (!theirs.ok) return { kind: "unread", late: theirs.late, why: theirs.why };
        for (const commit of theirs.value) {
          if (mine.value.has(commit)) {
            return { fork: other.fork || self?.fork === true, kind: "shares" };
          }
        }
        return { kind: "clear" };
      }),
    );
    batch.forEach((other, index) => {
      const on = ons[index];
      if (on !== undefined) found.push({ number: other.number, on });
    });
  }
  const shared = found.find((one) => one.on.kind === "shares");
  if (shared !== undefined) {
    // A base must be a branch of this repository, so a fork's branch cannot be one: the advice to
    // open the upper one against the lower one's branch cannot be followed.
    const advice =
      shared.on.kind === "shares" && shared.on.fork
        ? ", and one of them is from a fork, so neither can be opened against the other: merge the lower one by hand, then check again"
        : ": merge the lower one first (open the upper one against the lower one's branch), then check again";
    return {
      detail: null,
      kind: "refused",
      number: view.number,
      reason: `pull request #${view.number} shares commits with open pull request #${shared.number} that ${view.base} does not hold yet${advice}`,
    };
  }
  for (const { number, on } of found) {
    if (on.kind !== "unread") continue;
    if (on.late) {
      return { kind: "late", number: view.number, what: `whether #${view.number} is stacked` };
    }
    return cannotProve(
      view.number,
      `the commits of open pull request #${number} could not be read (${on.why})`,
    );
  }
  return null;
}

/** What a caller may add to a pull request check. */
export interface PullRequestOptions {
  /**
   * The person said yes to this merge, in their own words. It sets aside the `allowMerge`
   * switch (`autoMergeOff`) and nothing else: the base rules, the required checks and the
   * review under D17 are all still judged. Left out: off, and nothing changes.
   */
  asked?: boolean;
  /**
   * What this run shares between pull requests (`newStackCache`): the open pull requests'
   * heads and GitHub's compare answers. Left out: one fresh cache for this call alone.
   */
  stack?: StackCache;
}

/**
 * The verdict for one pull request merge a command asks for. `defaultBranches` is the
 * caller's cache of the repository's default branch, read once per repository (`--repo` or
 * not): a command that merges several pull requests of one repository asks gh once.
 */
export async function checkPullRequest(
  world: MergeWorld,
  target: { ref: string | null; repo: string | null },
  defaultBranches: Map<string, string | null> = new Map(),
  options: PullRequestOptions = {},
): Promise<MergeVerdict> {
  const viewLeft = world.timeFor(GH_TIMEOUT_MS);
  if (viewLeft <= 0) {
    return { kind: "late", number: null, what: "the pull request this command names" };
  }
  const view = await viewPullRequest(
    target,
    world.folder,
    world.env,
    viewLeft,
    world.gh ?? spawnGh,
  );
  if (view === null) {
    return { kind: "unread", number: null, what: "the pull request this command names" };
  }
  // The policy that judges this pull request: the one committed on its own base.
  let read: GateRead | "late";
  try {
    read = await gateFor(world, view.base);
  } catch (error) {
    return { detail: null, kind: "refused", number: view.number, reason: workflowUnread(error) };
  }
  if (read === "late") {
    return { kind: "late", number: view.number, what: `the policy committed on ${view.base}` };
  }
  if (!read.ok) {
    return {
      detail: null,
      kind: "refused",
      number: view.number,
      reason: policyUnread(view.base, read.why),
    };
  }
  const { resolved, config: committed } = read.gate;
  const where = target.repo ?? "";
  if (!defaultBranches.has(where)) {
    const branchLeft = world.timeFor(GH_TIMEOUT_MS);
    if (branchLeft <= 0) {
      return { kind: "late", number: view.number, what: "this repository's default branch" };
    }
    defaultBranches.set(
      where,
      await defaultBranchOf(world.folder, world.env, target.repo, branchLeft, world.gh ?? spawnGh),
    );
  }
  const defaultBranch = defaultBranches.get(where) ?? null;
  if (defaultBranch === null) {
    return { kind: "unread", number: view.number, what: "this repository's default branch" };
  }
  // The person's yes replaces the switch only: the base rules run either way.
  const asked = options.asked === true;
  const branchRefusal = asked
    ? baseRefusal(committed, view.base, defaultBranch)
    : autoMergeRefusal(resolved, committed, view.base, defaultBranch);
  const onTheYes = asked && autoMergeOff(resolved, view.base) !== null;
  let checks: RequiredCheck[] | null = null;
  if (branchRefusal === null) {
    // After the base rule, before the checks: a stack is refused whatever the checks say, and
    // never set aside by `asked`.
    const stacked = await stackedVerdict(world, view, target, options.stack ?? newStackCache());
    if (stacked !== null) return stacked;
    const checksLeft = world.timeFor(GH_TIMEOUT_MS);
    if (checksLeft <= 0) {
      return { kind: "late", number: view.number, what: `the required checks of #${view.number}` };
    }
    checks = await requiredChecks(
      view.number,
      target.repo,
      world.folder,
      world.env,
      checksLeft,
      world.gh ?? spawnGh,
    );
    if (checks === null) {
      return {
        kind: "unread",
        number: view.number,
        what: `the required checks of #${view.number}`,
      };
    }
  }
  // The review is measured only when everything else passed: a red check never pays for git.
  const before = mergeRefusal({ branchRefusal, checks, reviewRefusal: null });
  if (before !== null) {
    return { detail: null, kind: "refused", number: view.number, reason: before };
  }
  const review = reviewGateOf(world.paths, world.checkout, resolved);
  const cover = await coverOf(world, review, {
    head: view.headOid,
    branch: view.headRef,
    base: view.base,
  });
  const refused = reviewRefusal(cover);
  if (refused !== null) {
    return {
      detail: detailOf(cover, review.limits),
      kind: "refused",
      number: view.number,
      reason: refused,
    };
  }
  const allowed = pullRequestAllowed(cover?.covered === true ? cover : null);
  return {
    detail: detailOf(cover, review.limits),
    kind: "allowed",
    reason: onTheYes ? askedAllowed(allowed) : allowed,
  };
}

/** The commit `rev` names in the checkout, or null when git cannot name one. Never blocking. */
async function commitOf(world: MergeWorld, rev: string): Promise<string | null> {
  const left = world.timeFor(GUARD_GIT_TIMEOUT_MS);
  if (left <= 0) return null;
  return commitIn(await runGitAsync(world.checkout.root, commitArgs(rev), world.env, left));
}

/**
 * The verdict for a local branch against a base (D22): whether the review gate's record
 * covers the branch's head under D17. A local merge asks no pull request question — no
 * `allowMerge`, no checks — so those are not read.
 */
export async function checkBranch(
  world: MergeWorld,
  target: { branch: string; base: string },
): Promise<MergeVerdict> {
  const firstLeft = world.timeFor(GUARD_GIT_TIMEOUT_MS);
  if (firstLeft <= 0) {
    return { kind: "late", number: null, what: `branch ${target.branch}` };
  }
  const head =
    (await commitOf(world, target.branch)) ?? (await commitOf(world, `origin/${target.branch}`));
  if (head === null) {
    // Out of the caller's time, not a branch that is missing: never report the second as the
    // first (the portal's own deadline turns it into "not read yet").
    if (world.timeFor(GUARD_GIT_TIMEOUT_MS) <= 0) {
      return { kind: "late", number: null, what: `branch ${target.branch}` };
    }
    return {
      detail: null,
      kind: "refused",
      number: null,
      reason: `branch ${target.branch} is not in this checkout`,
    };
  }
  let read: GateRead | "late";
  try {
    read = await gateFor(world, target.base);
  } catch (error) {
    return { detail: null, kind: "refused", number: null, reason: workflowUnread(error) };
  }
  if (read === "late") {
    return { kind: "late", number: null, what: `the policy committed on ${target.base}` };
  }
  if (!read.ok) {
    return {
      detail: null,
      kind: "refused",
      number: null,
      reason: policyUnread(target.base, read.why),
    };
  }
  const review = reviewGateOf(world.paths, world.checkout, read.gate.resolved);
  const cover = await coverOf(world, review, { head, branch: target.branch, base: target.base });
  const detail = detailOf(cover, review.limits);
  const refused = reviewRefusal(cover);
  if (refused !== null) return { detail, kind: "refused", number: null, reason: refused };
  return {
    detail,
    kind: "allowed",
    reason: branchAllowed(target.branch, head, cover?.covered === true ? cover : null),
  };
}
