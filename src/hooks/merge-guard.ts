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
 * - with `reviewBeforePush` on, the pull request's **head commit** has a recorded review,
 *   written by the review agent's own end (`src/hooks/review-record.ts`,
 *   `src/workflow/reviews.ts`) — by an agent `reviewAgents` names, or by the person by hand.
 *
 * **The policy is the one committed on the pull request's base.** Every value it judges with —
 * `autoMerge`, `reviewBeforePush`, `reviewAgents`, `worktrees.base` and `worktrees.bases`, and
 * whether `ownHooks` hands the merge to the project's own guard — comes from the built-in
 * default, the person's own `workflow.json`, and `.claude/cc-smart-dev-kit.json` as committed on
 * `origin/<base>` (`resolveGate`), never a checkout's working copy: a session can edit its own
 * worktree's file, but not what a branch it cannot push to says. Nothing is fetched, so a policy
 * change counts once it is pushed and fetched; a ref or a file that is not there asks. Before
 * any gh call the guard reads the base this checkout names (`worktrees.base`), so `autoMerge`
 * off still asks without gh; once gh names the pull request's base, that base's file judges it.
 *
 * These checks stop mistakes, not a process that sets out to get past them: anything that runs
 * as the person can write the person's own files (`docs/design.md` § The review record).
 *
 * **And only for this project's own repository.** A merge that names another one
 * (`--repo`/`-R`, or a `gh api` path) always asks: the policy is about the repository the
 * work is in, read from its `origin` remote.
 *
 * **And never with `--admin`.** `gh pr merge … --admin` (or `--admin=<anything>`) merges with
 * administrator rights, past the repository's branch protection — its required reviews (a
 * code-owner approval among them), its required checks and its merge queue. Such a merge
 * always asks, whatever the policy says and before it is read, naming the pull request, so the
 * person decides each one; it never denies, because a release flow may use `--admin` on
 * purpose and the person's yes to the prompt is that decision. The flag is read with the
 * merge's other words (`after-merge.ts`), in every form below, aliases included.
 *
 * Every merge in the command is judged, in the order it runs them — `gh pr merge 5 && gh pr
 * merge 6` checks both — and the first the policy does not allow asks, naming its pull
 * request. The forms it cannot judge ask too, with the reason: a `gh api` merge, a GraphQL
 * query it cannot read, a shell alias, a `gh <word>` that is neither a gh command nor an
 * alias while the words name a merge, and a command whose earlier steps change the folder,
 * the branch or the repository (`cd`, `git switch`, `GH_REPO=…`, `env`) the merge acts on.
 *
 * Everything it reads is read-only — `gh pr view`, `gh repo view`, `gh pr checks`, `gh alias
 * list` when a `gh <word>` needs it — and a `gh` that is missing, fails, or answers
 * something it cannot read **asks instead of guessing**: a guard fails closed. Those calls
 * run only for a command that really asks for a merge (the line is read with the one shell
 * reader every guard uses, `src/shell/command.ts`, through `after-merge.ts`, in the dialect
 * of the tool that runs it), so an ordinary Bash call pays nothing and touches no network.
 *
 * Timeouts: each `gh` call gets 10 s and this hook has 30 s of its own
 * (`plugin/hooks/hooks.json`). A one-merge command reads three facts; a command that merges
 * several reads three each, with the default branch read once per repository
 * (`.claude/rules/hooks.md` § Timeouts).
 */
import type { CcSmartDevKitConfig } from "../project/config";
import type { Project } from "../project/resolve";
import { dialectOfTool } from "../shell/command";
import { autoMergeOff, autoMergeRefusal } from "../workflow/auto-merge";
import { type GateRead, resolveGate } from "../workflow/resolve";
import { hasReview, reviewsFile } from "../workflow/reviews";
import {
  type MergeCall,
  mergeCalls,
  pullRequestMerges,
  repositoryKey,
  requestsMerge,
} from "./after-merge";
import { GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
import { type HookResult, SILENT, stringField, toolDecision, toolInput } from "./io";
import type { Env, HookContext } from "./run";

/** How long one `gh` call may take: it is a network call, and this hook has 30 s (above). */
export const GH_TIMEOUT_MS = 10_000;

/**
 * The guard's own budget: the hook has 30 s (`plugin/hooks/hooks.json`), and this leaves room
 * for the answer. A PreToolUse hook Claude Code has to kill blocks nothing — the call it
 * guards then runs unguarded — so the guard gives itself a deadline instead of overrunning,
 * and asks ("… in time") when too little of it is left for the next call.
 */
export const GUARD_BUDGET_MS = 25_000;

/** What is kept back when a call is handed its time: the answer itself, and Claude Code reading it. */
export const BUDGET_MARGIN_MS = 2_000;

/**
 * Where a test sets the budget: `CC_SMART_DEV_KIT_GUARD_BUDGET_MS`, in milliseconds, so the
 * deadline can be proved to bite without waiting 25 s. A hook never sets it, and a value that
 * is not a positive number leaves the default.
 */
export const GUARD_BUDGET_ENV = "CC_SMART_DEV_KIT_GUARD_BUDGET_MS";

/** `GUARD_BUDGET_MS`, or what `env` overrides it with (a test's own budget, in milliseconds). */
export function budgetMs(env: Env): number {
  const given = Number(env[GUARD_BUDGET_ENV]);
  return Number.isFinite(given) && given > 0 ? given : GUARD_BUDGET_MS;
}

/** How long the alias lookup may take inside the budget: the same cap it has on its own. */
const ALIAS_LIMIT_MS = 3_000;

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
    return `the head commit ${facts.headOid.slice(0, 7)} has no recorded review (reviewBeforePush is on: a review agent's return records the commit, so run the reviewer with your fixes already committed)`;
  }
  return null;
}

/** The question when cc-smart-dev-kit may not merge this by itself. */
export function notByItself(reason: string, number: null | number = null): string {
  const which = number === null ? "this pull request" : `#${number}`;
  return `cc-smart-dev-kit will not merge ${which} by itself: ${reason}. Approve the merge yourself if you meant it.`;
}

/**
 * Why the guard cannot judge with the policy committed on `branch`: its ref, its file, or the
 * file's content cannot be used. A policy counts once it is pushed and fetched — the guard
 * fetches nothing itself — so that is the way out the question names.
 */
export function policyUnread(branch: string, why: string): string {
  return `the merge policy committed on ${branch} cannot be read: ${why}; a policy counts once it is committed, pushed and fetched`;
}

/** Why the guard cannot judge when the person's own workflow file cannot be read. */
function workflowUnread(error: unknown): string {
  // The person's own workflow file cannot be read, so whether autoMerge is on is unknown.
  return `the workflow settings cannot be read (${error instanceof Error ? error.message : String(error)})`;
}

/**
 * Why a merge that carries `--admin` asks: it names the pull request as the command does (a
 * number, a URL or a branch, or the current branch's when it names none).
 */
export function adminRefusal(ref: string | null): string {
  const which =
    ref === null
      ? "the current branch's pull request"
      : numericRef(ref) === null
        ? `\`${ref}\``
        : `#${ref}`;
  return `the command merges ${which} with \`--admin\`, which uses administrator rights to merge past the repository's branch protection (its required reviews, a code-owner approval among them, its required checks and its merge queue), so you decide each one`;
}

/** The first of `calls` that merges with `--admin`, or undefined (a `--disable-auto` merges nothing). */
function adminMerge(calls: MergeCall[]): MergeCall | undefined {
  return calls.find((one) => one.admin && !one.disarms);
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
function ghStdout(args: string[], folder: string, env: Env, timeoutMs: number): string | null {
  try {
    const run = Bun.spawnSync(["gh", ...args], {
      cwd: folder,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
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
  timeoutMs: number = GH_TIMEOUT_MS,
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
    timeoutMs,
  );
  return out === null ? null : parsePullRequestFacts(out);
}

/** The required checks of one pull request, or null when gh cannot say. */
export function requiredChecks(
  number: number,
  repo: string | null,
  folder: string,
  env: Env,
  timeoutMs: number = GH_TIMEOUT_MS,
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
    timeoutMs,
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
export function defaultBranchOf(
  folder: string,
  env: Env,
  repo: string | null = null,
  timeoutMs: number = GH_TIMEOUT_MS,
): string | null {
  const out = ghStdout(
    ["repo", "view", ...(repo === null ? [] : [repo]), "--json", "defaultBranchRef"],
    folder,
    env,
    timeoutMs,
  );
  return out === null ? null : parseDefaultBranch(out);
}

/** The project's own repository, `owner/name` from its `origin` remote, or null when git cannot say. */
function ownRepository(project: Project, env: Env, timeoutMs: number): string | null {
  const folder = project.mainCheckout ?? project.root;
  const origin = runGit(folder, ["remote", "get-url", "origin"], env, timeoutMs);
  return origin.ok && origin.out !== "" ? repositoryKey(origin.out) : null;
}

/**
 * The reason a merge naming `repo` (`--repo`/`-R`) must ask whatever the policy says, or
 * null when it names this project's own repository — the only one the policy covers. `own`
 * is `ownRepository`'s answer; null when git could not say, which asks too.
 */
function foreignRepository(repo: string | null, own: string | null): string | null {
  if (repo === null) return null;
  const named = repositoryKey(repo);
  if (own !== null && named !== null && named === own) return null;
  return own === null
    ? `the command names the repository ${repo}, and cc-smart-dev-kit could not read this project's own (\`git remote get-url origin\`), so it cannot tell whether they are the same one`
    : `the command names the repository ${repo}, and the autoMerge policy covers only this project's own repository (${own})`;
}

/** The pull request's number when the merge names it as one (`5`), else null. */
function numericRef(ref: string | null): number | null {
  return ref !== null && /^\d+$/.test(ref) ? Number(ref) : null;
}

/**
 * The guard's answer for one command: nothing to do for anything that is not a merge, and
 * for a merge the whole policy allows; a question whenever one condition fails or a fact
 * could not be read.
 */
export function mergeGuard(context: HookContext): HookResult {
  const { project, input, env, cwd, paths } = context;
  const command = stringField(toolInput(input).command);
  // The line in the dialect of the tool that runs it: Bash and PowerShell quote differently.
  const dialect = dialectOfTool(input.tool_name);
  // The cheap pure read first: an ordinary Bash call finds nothing here and pays nothing.
  if (command === null || !requestsMerge(command, dialect)) return SILENT;
  const config: CcSmartDevKitConfig | null = project.config;
  // A project that never opted in must not notice the plugin (`.claude/rules/hooks.md`):
  // the policy it would judge with lives in the project's own file.
  if (config === null) return SILENT;
  // `--admin` asks whatever the policy says, so it is read first, from the line alone: no
  // policy, no gh, and the question names the real risk even where the policy would ask anyway.
  // (A merge an alias runs is read below, once its expansion is known.)
  const admin = adminMerge(pullRequestMerges(command, null, dialect));
  if (admin !== undefined) {
    return toolDecision("ask", notByItself(adminRefusal(admin.target?.ref ?? null)));
  }

  // One deadline for the whole run (fix: a killed hook blocks nothing, so an overrun is
  // fail-open). Every call gets its own limit or what is left of the budget, whichever is
  // smaller; when too little is left for the next one, the guard asks instead.
  const startedAt = Date.now();
  const budgetAt = startedAt + budgetMs(env);
  const timeFor = (limitMs: number): number =>
    Math.min(limitMs, budgetAt - Date.now() - BUDGET_MARGIN_MS);

  // The review gate, read as committed on a branch — never this checkout's own copy of the
  // file, which a session can edit (`resolveGate`). One read per branch per run.
  const gates = new Map<string, GateRead>();
  const gateOf = (branch: string): GateRead | "late" => {
    const known = gates.get(branch);
    if (known !== undefined) return known;
    const left = timeFor(GUARD_GIT_TIMEOUT_MS);
    if (left <= 0) return "late";
    const read = resolveGate(paths, project, branch, { env, timeoutMs: left });
    gates.set(branch, read);
    return read;
  };

  // The policy first, from the base this checkout names: it needs no gh, so a machine without
  // gh hears the real reason — and a command the guard cannot judge at all costs no gh call
  // either. The pull request's own base is read again below, once gh has named it.
  const integration = config.worktrees?.base ?? null;
  if (integration !== null) {
    let early: GateRead | "late";
    try {
      early = gateOf(integration);
    } catch (error) {
      return toolDecision("ask", notByItself(workflowUnread(error)));
    }
    if (early === "late")
      return toolDecision("ask", notInTime(`the policy committed on ${integration}`));
    if (!early.ok) return toolDecision("ask", notByItself(policyUnread(integration, early.why)));
    // The project runs its own merge guard, as its committed policy says: that one answers.
    if (early.gate.config?.ownHooks?.includes("merge-guard") === true) return SILENT;
    const off = autoMergeOff(early.gate.resolved, integration);
    if (off !== null) return toolDecision("ask", notByItself(off));
  }

  // Every merge the command runs, in order, its aliases read when a `gh <word>` needs them.
  // A `--disable-auto` takes an armed merge back: it merges nothing, so it is not judged.
  const merges = mergeCalls(command, cwd, env, timeFor(ALIAS_LIMIT_MS), dialect).filter(
    (one) => !one.disarms,
  );
  const defaultBranches = new Map<string, string | null>();
  let own: string | null = null;
  let ownRead = false;
  for (const merge of merges) {
    const number = numericRef(merge.target?.ref ?? null);
    if (merge.admin) {
      return toolDecision("ask", notByItself(adminRefusal(merge.target?.ref ?? null)));
    }
    if (merge.unread !== null) return toolDecision("ask", notChecked(merge.unread, env));
    if (merge.refusal !== null) return toolDecision("ask", notByItself(merge.refusal, number));
    const target = merge.target;
    if (target === null) continue;
    // The policy covers this project's own repository only: a merge that names another one
    // asks, whatever the facts say (and the origin is read once, only when one is named).
    if (target.repo !== null) {
      if (!ownRead) {
        const left = timeFor(GUARD_GIT_TIMEOUT_MS);
        if (left <= 0) return toolDecision("ask", notInTime("this project's own repository"));
        own = ownRepository(project, env, left);
        ownRead = true;
      }
      const foreign = foreignRepository(target.repo, own);
      if (foreign !== null) return toolDecision("ask", notByItself(foreign, number));
    }
    const viewLeft = timeFor(GH_TIMEOUT_MS);
    if (viewLeft <= 0) {
      return toolDecision("ask", notInTime("the pull request this command names"));
    }
    const view = viewPullRequest(target, cwd, env, viewLeft);
    if (view === null) {
      return toolDecision("ask", notChecked("the pull request this command names", env));
    }
    // The policy that judges this pull request: the one committed on its own base.
    let read: GateRead | "late";
    try {
      read = gateOf(view.base);
    } catch (error) {
      return toolDecision("ask", notByItself(workflowUnread(error), view.number));
    }
    if (read === "late") {
      return toolDecision("ask", notInTime(`the policy committed on ${view.base}`));
    }
    if (!read.ok) {
      return toolDecision("ask", notByItself(policyUnread(view.base, read.why), view.number));
    }
    const { resolved, config: committed } = read.gate;
    // The default branch is a fact of the repository: read once for a command that merges
    // several pull requests of the same one.
    const where = target.repo ?? "";
    if (!defaultBranches.has(where)) {
      const branchLeft = timeFor(GH_TIMEOUT_MS);
      if (branchLeft <= 0) {
        return toolDecision("ask", notInTime("this repository's default branch"));
      }
      defaultBranches.set(where, defaultBranchOf(cwd, env, target.repo, branchLeft));
    }
    const defaultBranch = defaultBranches.get(where) ?? null;
    if (defaultBranch === null) {
      return toolDecision("ask", notChecked("this repository's default branch", env));
    }
    const branchRefusal = autoMergeRefusal(resolved, committed, view.base, defaultBranch);
    let checks: RequiredCheck[] | null = null;
    if (branchRefusal === null) {
      const checksLeft = timeFor(GH_TIMEOUT_MS);
      if (checksLeft <= 0) {
        return toolDecision("ask", notInTime(`the required checks of #${view.number}`));
      }
      checks = requiredChecks(view.number, target.repo, cwd, env, checksLeft);
      if (checks === null) {
        return toolDecision("ask", notChecked(`the required checks of #${view.number}`, env));
      }
    }
    const repository = project.mainCheckout ?? project.root;
    // A record counts only when an agent the committed `reviewAgents` names wrote it, or the
    // person did by hand: a list a session edits in its own checkout trusts no one (`hasReview`).
    const reviewed =
      !resolved.reviewBeforePush.value ||
      hasReview(reviewsFile(paths.stateDir, repository), view.headOid, resolved.reviewAgents.value);

    const reason = mergeRefusal({
      branchRefusal,
      checks,
      headOid: view.headOid,
      reviewBeforePush: resolved.reviewBeforePush.value,
      reviewed,
    });
    if (reason !== null) return toolDecision("ask", notByItself(reason, view.number));
  }
  return SILENT;
}
