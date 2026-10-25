/**
 * The merge check: may this merge happen, or does the person decide? One judgment, made for a
 * pull request (the merge guard's, D17 and D31) and for a local branch against a base (D22, the
 * lead's hand-back gate). The merge guard hook calls it before a merge
 * (`src/hooks/merge-guard.ts`); `cc-smart-dev-kit workflow merge-check` prints its verdicts.
 *
 * **A pull request** is judged with the policy committed on its base (`resolveGate`), never a
 * checkout's working copy: `autoMerge` on, its base the project's plain integration base, every
 * required check green, and — with `reviewBeforePush` on — the head covered by a review under
 * D17 (`readCover`: a review of an earlier commit of the head's branch counts while the fixes
 * after it stay within `workflow.fixesAfterReview`). Only then is it allowed; everything else
 * asks, with the reason. Every fact is read read-only (`gh pr view`, `gh repo view`, `gh pr
 * checks`, the review record, git); a `gh` that is missing or answers nothing is "could not
 * read", never a guess.
 *
 * **A local branch** is judged against a base without gh: the review gate's `reviewBeforePush`
 * and the record alone, the same limits. It is what a lead checks before merging a branch
 * locally (D22), and it never speaks for a merge the guard would make.
 *
 * **What it never decides:** which command is a merge, whether it names this project's own
 * repository, and whether it carries `--admin` — the guard's rules about the command line. It
 * does read `ownHooks` from the base's committed file: a project that runs its own merge guard
 * makes the check silent, and the hook then says nothing at all. And the one answer `allow` is
 * the guard's alone, only for the exact `gh pr merge <n>` (`exactMergeOf` in `after-merge.ts`,
 * D31); this module says the policy passed, not how the guard answers.
 *
 * Nothing here writes, fetches or reaches the network beyond the read-only `gh` calls.
 * **Every child is awaited** (`Bun.spawn`: the caller's `gh` runner, `runGitAsync`,
 * `readCover`): the portal makes this check inside its own process, where a blocking spawn
 * would freeze every page and the live stream (`.claude/rules/portal.md`).
 */
import type { CliPaths } from "../cli/paths";
import { GUARD_GIT_TIMEOUT_MS, runGitAsync } from "../hooks/git";
import type { Env } from "../hooks/run";
import type { Checkout } from "../project/resolve";
import { autoMergeRefusal } from "./auto-merge";
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
  folder: string;
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
}

/**
 * One `gh` call, awaited, with how it ended told apart. The one place the kit starts `gh`:
 * a timeout, no console window on Windows, no blocking spawn (`spawnGh` reads through it, and
 * so does `issue file`, which must tell a missing gh from a timeout from a refusal).
 */
export type GhExec = (args: string[], call: GhCall) => Promise<GhResult>;

/** The `gh` executor in use. */
export const runGh: GhExec = async (args, { folder, env, input, timeoutMs }) => {
  try {
    const child = Bun.spawn(["gh", ...args], {
      cwd: folder,
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
      return { code: null, err: err.trim(), kind: "timeout", out };
    }
    return {
      code: child.exitCode,
      err: err.trim(),
      kind: child.exitCode === 0 ? "ok" : "failed",
      out,
    };
  } catch (error) {
    // No gh on PATH (spawn throws ENOENT).
    return {
      code: null,
      err: error instanceof Error ? error.message : String(error),
      kind: "missing",
      out: "",
    };
  }
};

/**
 * One read-only `gh` command's stdout, or null when gh is not there, the call fails, or it
 * printed nothing. **It never blocks**: `spawnGh` is `Bun.spawn`, because the portal makes
 * this check inside its own process and a blocking spawn there freezes every page and the
 * live stream (`.claude/rules/portal.md`). A test hands in its own runner.
 */
export type GhRunner = (args: string[], call: GhCall) => Promise<string | null>;

/** The `gh` runner in use: the same command, environment and timeout as `ghStdout` always had. */
export const spawnGh: GhRunner = async (args, call) => {
  const { kind, out } = await runGh(args, call);
  // No gh on PATH, or a call that timed out: nothing. Any other exit keeps what gh printed.
  if (kind === "missing" || kind === "timeout") return null;
  return out.trim() === "" ? null : out;
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
 * The review gate's own numbers behind a verdict (D17, D22), for the portal's crew page:
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
  /**
   * The project runs its own merge guard (`ownHooks` in the committed file): that one answers,
   * so this check says nothing. Only the hook uses this; the command prints it as no verdict.
   */
  | { kind: "silent" }
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
   * left (the merge guard's `timeFor`). A caller with no deadline returns `limitMs`.
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
  return `${where} cannot be read: ${why}; a policy counts once it is committed, pushed and fetched`;
}

/** Why the guard cannot judge when the person's own workflow file cannot be read. */
export function workflowUnread(error: unknown): string {
  // The person's own workflow file cannot be read, so whether autoMerge is on is unknown.
  return `the workflow settings cannot be read (${error instanceof Error ? error.message : String(error)})`;
}

/** The question when cc-smart-dev-kit may not merge this by itself. */
export function notByItself(reason: string, number: null | number = null): string {
  const which = number === null ? "this pull request" : `#${number}`;
  return `cc-smart-dev-kit will not merge ${which} by itself: ${reason}. Approve the merge yourself if you meant it.`;
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

/** The required checks of one pull request, or null when gh cannot say. */
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
  return out === null ? null : parseRequiredChecks(out);
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

/**
 * The verdict for one pull request merge a command asks for. `defaultBranches` is the
 * caller's cache of the repository's default branch, read once per repository (`--repo` or
 * not): a command that merges several pull requests of one repository asks gh once.
 */
export async function checkPullRequest(
  world: MergeWorld,
  target: { ref: string | null; repo: string | null },
  defaultBranches: Map<string, string | null> = new Map(),
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
  // The project runs its own merge guard, as its committed policy says: that one answers.
  if (committed?.ownHooks?.includes("merge-guard") === true) return { kind: "silent" };

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
  const branchRefusal = autoMergeRefusal(resolved, committed, view.base, defaultBranch);
  let checks: RequiredCheck[] | null = null;
  if (branchRefusal === null) {
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
  return {
    detail: detailOf(cover, review.limits),
    kind: "allowed",
    reason: pullRequestAllowed(cover?.covered === true ? cover : null),
  };
}

/** The commit `rev` names in the checkout, or null when git cannot name one. Never blocking. */
async function commitOf(world: MergeWorld, rev: string): Promise<string | null> {
  const left = world.timeFor(GUARD_GIT_TIMEOUT_MS);
  if (left <= 0) return null;
  const run = await runGitAsync(
    world.checkout.root,
    ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`],
    world.env,
    left,
  );
  return run.ok && COMMIT_SHA.test(run.out) ? run.out : null;
}

/**
 * The verdict for a local branch against a base (D22): whether the review gate's record
 * covers the branch's head under D17. A local merge asks no pull request question — no
 * `autoMerge`, no checks — so those are not read.
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
