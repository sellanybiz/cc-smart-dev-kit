/**
 * The merge guard: PreToolUse on Bash and PowerShell, before a command that asks GitHub to
 * merge a pull request (`gh pr merge`, `--auto` included — an armed merge lands once the
 * checks pass, with nobody watching). It lets the call through **without a question** only
 * when the project's own policy allows that merge; every other case is a question for the
 * person, never a refusal.
 *
 * Allowed without a question only when every one of these holds:
 *
 * - `autoMerge` is on (`cc-smart-dev-kit workflow show`), and `autoMergeAllowed` says yes: the
 *   pull request's base IS the project's integration base (`worktrees.base`), which is
 *   neither the repository's default branch nor a target of `worktrees.bases`
 *   (`src/workflow/auto-merge.ts` — the rules live there, once);
 * - every required check passed (`gh pr checks <n> --required --json name,bucket`; a skipped
 *   required check counts as passing, which is GitHub's own rule for a merge);
 * - with `reviewBeforePush` on, the pull request's **head commit** has a recorded review
 *   (`cc-smart-dev-kit workflow review-done`, `src/workflow/reviews.ts`).
 *
 * Everything it reads is read-only — `gh pr view`, `gh repo view`, `gh pr checks` — and a
 * `gh` that is missing, fails, or answers something it cannot read **asks instead of
 * guessing**: a guard fails closed. Those calls run only for a command that really asks for
 * a merge (the line is read with the one lexer every guard uses, `shell-command.ts`, through
 * `after-merge.ts`), so an ordinary Bash call pays nothing and touches no network.
 *
 * Timeouts: each `gh` call gets 10 s and this hook has 30 s of its own
 * (`plugin/hooks/hooks.json`), so its calls fit well inside it (`.claude/rules/hooks.md`
 * § Timeouts).
 */
import type { CcSmartDevKitConfig } from "../project/config";
import { autoMergeOff, autoMergeRefusal } from "../workflow/auto-merge";
import { type ResolvedWorkflow, resolveWorkflow } from "../workflow/resolve";
import { hasReview, reviewsFile } from "../workflow/reviews";
import { mergeTarget, requestsMerge } from "./after-merge";
import { type HookResult, SILENT, stringField, toolDecision, toolInput } from "./io";
import type { Env, HookContext } from "./run";

/** How long one `gh` call may take: it is a network call, and this hook has 30 s (above). */
export const GH_TIMEOUT_MS = 10_000;

/** The fields `gh pr view --json` gives. */
export const PULL_REQUEST_FACTS = "number,baseRefName,headRefOid";

/** The pull request facts the guard decides with. */
export interface PullRequestFacts {
  /** The pull request's number, as the questions name it. */
  number: number;
  /** The branch it goes into. */
  base: string;
  /** The commit at its head: the commit a review must be recorded for. */
  headOid: string;
}

/** The facts from `gh pr view`'s JSON, or null when it is not the shape asked for. */
export function parsePullRequestFacts(json: string): PullRequestFacts | null {
  try {
    const view = JSON.parse(json) as Record<string, unknown>;
    const { baseRefName, headRefOid, number } = view;
    if (typeof number !== "number" || typeof baseRefName !== "string") return null;
    if (typeof headRefOid !== "string" || !/^[0-9a-f]{40,64}$/.test(headRefOid)) return null;
    return { number, base: baseRefName, headOid: headRefOid };
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

/** What the guard knows when it decides: every field is a fact it read, none is a guess. */
export interface MergeFacts {
  /** Why the branch policy refuses, or null when it allows. */
  branchRefusal: string | null;
  /** The head commit the review must be recorded for. */
  headOid: string;
  /** `reviewBeforePush` is on: a recorded review is required. */
  reviewBeforePush: boolean;
  /** The head commit has a recorded review. */
  reviewed: boolean;
  /** The required checks gh reported; null when gh did not say. */
  checks: RequiredCheck[] | null;
}

/**
 * The reason the person must decide this merge, or null when it may happen by itself. Every
 * fact is about a merge `autoMerge` already allows — the caller checks that first, before it
 * reads anything with gh (`autoMergeOff`). With `checks` null the answer here is null: gh
 * did not answer, and that has its own question (`notChecked`).
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
  if (facts.reviewBeforePush && !facts.reviewed) {
    return `the head commit ${facts.headOid.slice(0, 7)} has no recorded review (reviewBeforePush is on: run the review, then \`cc-smart-dev-kit workflow review-done\`)`;
  }
  return null;
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

/** True when no `gh` is on the hook's PATH. */
function ghMissing(env: Env): boolean {
  try {
    return Bun.which("gh", { PATH: env.PATH ?? "" }) === null;
  } catch {
    return false;
  }
}

/**
 * One read-only `gh` command's stdout, or null when gh is not there, the call fails, or it
 * printed nothing. The exit code is not the test: `gh pr checks` exits 8 while the required
 * checks are still running, and the JSON on its stdout is what matters.
 */
function ghStdout(args: string[], folder: string, env: Env): string | null {
  try {
    const run = Bun.spawnSync(["gh", ...args], {
      cwd: folder,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: GH_TIMEOUT_MS,
    });
    const out = run.stdout.toString();
    return out.trim() === "" ? null : out;
  } catch {
    // No gh on PATH, or a call that timed out.
    return null;
  }
}

/** The pull request a merge command names: `gh pr view`'s facts, or null when gh cannot say. */
export function viewPullRequest(
  target: { ref: string | null; repo: string | null },
  folder: string,
  env: Env,
): PullRequestFacts | null {
  const out = ghStdout(
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
  );
  return out === null ? null : parsePullRequestFacts(out);
}

/** The required checks of one pull request, or null when gh cannot say. */
export function requiredChecks(
  number: number,
  repo: string | null,
  folder: string,
  env: Env,
): RequiredCheck[] | null {
  const out = ghStdout(
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
  );
  return out === null ? null : parseRequiredChecks(out);
}

/**
 * The repository's default branch, or null when gh cannot say. A merge command that named
 * another repository (`--repo`) is judged against THAT repository's default branch, not the
 * one in the folder the session runs in.
 */
export function defaultBranchOf(
  folder: string,
  env: Env,
  repo: string | null = null,
): string | null {
  const out = ghStdout(
    ["repo", "view", ...(repo === null ? [] : ["--repo", repo]), "--json", "defaultBranchRef"],
    folder,
    env,
  );
  return out === null ? null : parseDefaultBranch(out);
}

/**
 * The guard's answer for one command: nothing to do for anything that is not a merge, and
 * for a merge the whole policy allows; a question whenever one condition fails or a fact
 * could not be read.
 */
export function mergeGuard(context: HookContext): HookResult {
  const { project, input, env, cwd, paths } = context;
  const command = stringField(toolInput(input).command);
  if (command === null || !requestsMerge(command)) return SILENT;
  const target = mergeTarget(command);
  if (target === null) return SILENT;
  const config: CcSmartDevKitConfig | null = project.config;
  // A project that never opted in must not notice the plugin (`.claude/rules/hooks.md`):
  // the policy it would judge with lives in the project's own file.
  if (config === null) return SILENT;

  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(paths, config);
  } catch (error) {
    // The person's own workflow file cannot be read, so whether autoMerge is on is unknown.
    const why = error instanceof Error ? error.message : String(error);
    return toolDecision("ask", notByItself(`the workflow settings cannot be read (${why})`));
  }
  // The policy first: it needs no gh, so a machine without gh hears the real reason.
  const off = autoMergeOff(resolved);
  if (off !== null) return toolDecision("ask", notByItself(off));

  const view = viewPullRequest(target, cwd, env);
  if (view === null) {
    return toolDecision("ask", notChecked("the pull request this command names", env));
  }
  const defaultBranch = defaultBranchOf(cwd, env, target.repo);
  if (defaultBranch === null) {
    return toolDecision("ask", notChecked("this repository's default branch", env));
  }
  const branchRefusal = autoMergeRefusal(resolved, config, view.base, defaultBranch);
  const checks = branchRefusal === null ? requiredChecks(view.number, target.repo, cwd, env) : null;
  if (branchRefusal === null && checks === null) {
    return toolDecision("ask", notChecked(`the required checks of #${view.number}`, env));
  }
  const repository = project.mainCheckout ?? project.root;
  const reviewed =
    !resolved.reviewBeforePush.value ||
    hasReview(reviewsFile(paths.stateDir, repository), view.headOid);

  const reason = mergeRefusal({
    branchRefusal,
    checks,
    headOid: view.headOid,
    reviewBeforePush: resolved.reviewBeforePush.value,
    reviewed,
  });
  return reason === null ? SILENT : toolDecision("ask", notByItself(reason, view.number));
}
