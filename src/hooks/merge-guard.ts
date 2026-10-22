/**
 * The merge guard: PreToolUse on Bash and PowerShell, before a command that asks GitHub to
 * merge a pull request (`gh pr merge`, `--auto` included — an armed merge lands once the
 * checks pass, with nobody watching).
 *
 * **What it answers.**
 *
 * - `allow` — no question at all — only for the **exact** form `gh pr merge <n>` with flags
 *   this guard knows, and only when the whole policy passes (D31). An `allow` skips auto
 *   mode's built-in "Merge Without Review" rule for that tool call (proved live, L1a.5), so
 *   every protection is this guard's own: `autoMerge` on, the pull request's base the
 *   project's plain integration base, every required check green, and — with
 *   `reviewBeforePush` on — a review that covers the head under D17. Any other line (a second
 *   command, a wrapper, an alias, a branch or URL instead of a number, an unknown flag, an
 *   armed `--auto` merge that lands later) stays silent when the policy passes, as before, and
 *   auto mode's own rule still applies to it.
 *   **A crew session never gets `allow`** (D24: it never merges — the lead does), and every
 *   question below is a denial for it instead: nobody is at the machine to answer, and the
 *   step is the same for every one of them — commit on the branch, and the lead merges.
 * - `ask` — for every other merge the policy does not allow, with the reason. **The judgment
 *   itself is one home:** `src/workflow/merge-check.ts` (`checkPullRequest`), which
 *   `cc-smart-dev-kit workflow merge-check` prints too.
 *
 * **The policy is the one committed on the pull request's base.** Every value it judges with —
 * `autoMerge`, `reviewBeforePush`, `reviewAgents`, the `fixesAfterReview` limits, `worktrees.base`
 * and `worktrees.bases`, and whether `ownHooks` hands the merge to the project's own guard —
 * comes from the built-in default, the person's own `workflow.json`, and
 * `.claude/cc-smart-dev-kit.json` as committed on `origin/<base>` (`resolveGate`), never a
 * checkout's working copy: a session can edit its own worktree's file, but not what a branch it
 * cannot push to says. Nothing is fetched, so a policy change counts once it is pushed and
 * fetched; a ref or a file that is not there asks. Before any gh call the guard reads the base
 * this checkout names (`worktrees.base`), so `autoMerge` off still asks without gh; once gh
 * names the pull request's base, that base's file judges it.
 *
 * **A review counts for its fixes (D17).** With `reviewBeforePush` on, the pull request's head
 * is covered when the record has a review of the head itself, or of an earlier commit of the
 * head's branch whose change since — the base's own changes taken out — stays within the
 * committed `workflow.fixesAfterReview` (`readCover` in `src/workflow/review-cover.ts`, judged
 * by `merge-check.ts`). The question names the counts and the limit when a fix is too big.
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
 * **It also reads `gh pr create` and `gh pr ready`** (D16: `openPr`), the forms it reads for
 * merges (`-R`, aliases, a `gh api` POST to the pulls endpoint, the GraphQL `createPullRequest`
 * and `markPullRequestReadyForReview`): `openPr` off asks before any of them, `draft` asks for
 * one that opens ready (no `--draft`) and for every `gh pr ready`, `ready` is silent. The
 * policy is read as a merge's is (`resolveGate`, below). **A pull request opened outside the
 * base its head branch belongs to also asks, never denies** (WA1): a `gh pr create` whose
 * `--base` is not the project's base for that branch — `worktrees.base`, or the
 * `worktrees.bases` prefix mapping for the head branch — and one with no `--base` when the
 * repository's default branch is not that base (read with `gh repo view`, then git's
 * `origin/HEAD`). The question names both branches; the person may mean it. **And a crew
 * session opens no pull request at all** (D24): `gh pr create` pushes the branch, so it is denied, whatever `openPr`
 * says (`CC_SMART_DEV_KIT_CREW` is set in a crew session's environment). That refusal is the
 * guard's **crew part** (`crewPrAnswer`, `HookSpec.crewLimits`): the frame runs it before
 * `ownHooks` and before the project's file, so no project — one with no file, or one whose
 * `ownHooks` names `merge-guard` — can lose it.
 *
 * Every merge in the command is judged, in the order it runs them — `gh pr merge 5 && gh pr
 * merge 6` checks both — and the first the policy does not allow asks, naming its pull
 * request. The forms it cannot judge ask too, with the reason: a `gh api` merge, a GraphQL
 * query it cannot read, a shell alias, a `gh <word>` that is neither a gh command nor an
 * alias while the words name a merge, a `gh pr merge` flag this guard does not know, and a
 * command whose earlier steps change the folder, the branch or the repository (`cd`, `git
 * switch`, `GH_REPO=…`, `env`) the merge acts on.
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
 * several reads three each, with the default branch read once per repository, plus the git
 * calls that measure the change after a review (`.claude/rules/hooks.md` § Timeouts).
 */

import { crewIdOf } from "../crew/session";
import { baseForBranch, type CcSmartDevKitConfig } from "../project/config";
import type { Project } from "../project/resolve";
import { dialectOfTool } from "../shell/command";
import { autoMergeOff } from "../workflow/auto-merge";
import {
  checkPullRequest,
  defaultBranchOf,
  GH_TIMEOUT_MS,
  type MergeVerdict,
  type MergeWorld,
  notByItself,
  notChecked,
  notInTime,
  policyUnread,
  workflowUnread,
} from "../workflow/merge-check";
import { openPrRefusal } from "../workflow/pr-switches";
import { type GateRead, resolveGate } from "../workflow/resolve";
import {
  COMPUTED_MERGE,
  computedMergeRisk,
  computedPullRequestRisk,
  exactMergeOf,
  isMerge,
  type MergeCall,
  pullRequestCallsWithAliases,
  pullRequestMerges,
  repositoryKey,
  requestsPullRequestChange,
} from "./after-merge";
import { startBudget } from "./budget";
import { GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { Env, HookContext } from "./run";

/** How long the alias lookup may take inside the budget: the same cap it has on its own. */
const ALIAS_LIMIT_MS = 3_000;

/** Why a crew session's `gh pr create` / `gh pr ready` is denied (D24). */
export const CREW_PR_REFUSAL =
  "A crew session opens no pull request: `gh pr create` pushes the branch, and a crew session " +
  "never pushes. It commits on its own branch, and the lead merges that branch locally. Stop " +
  "at your commit and say so in your report.";

/**
 * Why a crew session's `gh pr merge` is denied (D24): nobody is at the machine to answer the
 * guard's question, and no answer would change the step — it never merges. It covers every
 * question the guard puts for a merge (the policy off, `--admin`, another repository, a check
 * that is not green, no covering review, a policy or a form it cannot read, its own budget),
 * because each one ends at the same step.
 */
export const CREW_MERGE_REFUSAL =
  "A crew session never merges a pull request: nobody is at the machine to answer the guard's " +
  "question, and the step is the same without one. It commits on its own branch, and the lead " +
  "merges that branch locally (`git merge`). Stop at your commit and say so in your report.";

/**
 * The guard's crew part (D24): a crew session opens no pull request, whatever `openPr` says,
 * and merges none, whatever `autoMerge` says. The forms are the guard's own reader's
 * (`pullRequestCalls`, and the aliases `pullRequestCallsWithAliases`
 * expands), so an alias that expands to `gh pr create` or `gh pr merge` is refused here exactly
 * as `mergeGuard` refuses it, and so is a program the line works out when it runs whose words
 * name an opening or a merge (`computedPullRequestRisk`). **Every question the guard would put
 * for a merge is the merge refusal here**, naming the step: a crew session is never asked, and
 * commits on its branch for its lead to merge. The frame runs this before `ownHooks` and
 * before the project's file, so a project with no `cc-smart-dev-kit.json`, or one whose
 * `ownHooks` names `merge-guard`, keeps the refusals.
 *
 * A `--disable-auto` merge lands nothing (it takes an armed merge back), so it is no merge
 * here: it stays silent, as it does for anyone.
 *
 * Not a crew session, or a line with nothing to judge: silence.
 */
export function crewPullRequestAnswer(input: HookInput, env: Env, cwd: string): HookResult {
  if (crewIdOf(env) === null) return SILENT;
  const command = stringField(toolInput(input).command);
  if (command === null) return SILENT;
  // The cheap pure read first, as `mergeGuard` does: an ordinary call finds nothing and pays
  // nothing, and `gh alias list` is read only for a word that may be an alias.
  const dialect = dialectOfTool(input.tool_name);
  if (!requestsPullRequestChange(command, dialect)) return SILENT;
  // A program the line works out when it runs (`$GH pr create`, `$(which gh) pr create`)
  // cannot be named: its words name an opening or a merge, which a crew session never does
  // (D24), so it is denied here rather than left to the guard's project part (F5-1).
  if (computedPullRequestRisk(command, dialect)) return toolDecision("deny", CREW_PR_REFUSAL);
  // Every call the reader finds, with a `gh <word>` alias expanded (`gh np` may be a create,
  // and `gh mg` a merge), so each one is refused by what it really does:
  // - a merge (or a word that may expand to one) is the merge refusal;
  // - an opening is the pull request refusal.
  const calls = pullRequestCallsWithAliases(command, cwd, env, ALIAS_LIMIT_MS, dialect);
  if (calls.some((one) => isMerge(one) && !one.disarms)) {
    return toolDecision("deny", CREW_MERGE_REFUSAL);
  }
  return calls.some((one) => !isMerge(one)) ? toolDecision("deny", CREW_PR_REFUSAL) : SILENT;
}

/** The question when `openPr` (or something unreadable) does not let this pull request be opened. */
export function notOpenedByItself(opening: MergeCall, reason: string): string {
  const what =
    opening.opens === "ready" ? "marks a pull request ready for review" : "opens a pull request";
  return `cc-smart-dev-kit asks before this ${what}: ${reason}. Approve it yourself if you meant it.`;
}

/**
 * Why a `gh pr create` asks when it would open outside the base its head branch belongs to
 * (WA1): `worktrees.base`, or the `worktrees.bases` mapping for that branch. It names the
 * branch it would open into, the head branch, and the base the project sends that branch to.
 */
export function opensElsewhere(into: string, head: string, expected: string): string {
  return `the pull request would open into \`${into}\`, but this project sends a \`${head}\` branch into \`${expected}\` (worktrees.base, or worktrees.bases for that branch)`;
}

/** Why a `gh pr create` with no `--base` cannot be judged: gh could not say the default branch. */
export const OPENING_DEFAULT_UNREAD =
  "gh could not read this repository's default branch, so this guard cannot tell which branch this pull request opens into";

/** Why a `gh pr create` with no `--base` cannot be judged: reading the default branch ran late. */
export const OPENING_DEFAULT_LATE =
  "reading this repository's default branch would have taken longer than the guard's own budget allows";

/** The branch of a `--head` value: `owner:branch` names a fork's branch, and `branch` itself. */
function headBranchOf(head: string | null): string | null {
  if (head === null) return null;
  const branch = head.slice(head.lastIndexOf(":") + 1);
  return branch === "" ? null : branch;
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

/** The question the guard's answer gives for one check's verdict. */
function askFor(verdict: Exclude<MergeVerdict, { kind: "allowed" | "silent" }>, env: Env): string {
  if (verdict.kind === "refused") return notByItself(verdict.reason, verdict.number);
  if (verdict.kind === "unread") return notChecked(verdict.what, env);
  return notInTime(verdict.what);
}

/**
 * The guard's answer for one command: nothing to do for anything that is not a merge, and
 * for a merge the whole policy allows; a question whenever one condition fails or a fact
 * could not be read. An exact `gh pr merge <n>` that the policy allows gets `allow` (D31).
 */
export function mergeGuard(context: HookContext): HookResult {
  const { project, input, env, cwd, paths } = context;
  const command = stringField(toolInput(input).command);
  // The line in the dialect of the tool that runs it: Bash and PowerShell quote differently.
  const dialect = dialectOfTool(input.tool_name);
  if (command === null) return SILENT;
  // The cheap pure read first: an ordinary Bash call finds nothing here and pays nothing.
  // A computed program whose words name a merge counts (`$GH pr merge 5`).
  if (!requestsPullRequestChange(command, dialect)) return SILENT;
  const config: CcSmartDevKitConfig | null = project.config;
  // A project that never opted in must not notice the plugin (`.claude/rules/hooks.md`):
  // the policy it would judge with lives in the project's own file. (A crew session's
  // opening refusal is not here: the guard's crew part already answered it before the file,
  // `crewPullRequestAnswer`.)
  if (config === null) return SILENT;
  // A crew session is never asked (D24): nobody is at the machine, and every question about a
  // merge ends at the same step — it commits on its branch and the lead merges. So each question
  // below is that refusal instead. The crew part (`crewPullRequestAnswer`) has already refused
  // every merge it can read; this is the belt for a spelling it missed.
  const crew = crewIdOf(env) !== null;
  const refuseMerge = (why: string): HookResult =>
    crew ? toolDecision("deny", CREW_MERGE_REFUSAL) : toolDecision("ask", why);
  const refuseOpening = (why: string): HookResult =>
    crew ? toolDecision("deny", CREW_PR_REFUSAL) : toolDecision("ask", why);
  // A program the line works out when it runs cannot be named: the guard asks.
  if (computedMergeRisk(command, dialect)) {
    return refuseMerge(notByItself(COMPUTED_MERGE));
  }
  // `--admin` asks whatever the policy says, so it is read first, from the line alone: no
  // policy, no gh, and the question names the real risk even where the policy would ask anyway.
  // (A merge an alias runs is read below, once its expansion is known.)
  const admin = adminMerge(pullRequestMerges(command, null, dialect));
  if (admin !== undefined) {
    return refuseMerge(notByItself(adminRefusal(admin.target?.ref ?? null)));
  }

  // One deadline for the whole run (`budget.ts`: a killed hook blocks nothing, so an overrun
  // is fail-open). Every call gets its own limit or what is left of the budget, whichever is
  // smaller; when too little is left for the next one, the guard asks instead.
  const { timeFor } = startBudget(env);

  // The review gate, read as committed on a branch — never this checkout's own copy of the
  // file, which a session can edit (`resolveGate`). One read per branch per run.
  const gates = new Map<string | null, GateRead>();
  const gateOf = (branch: string | null): GateRead | "late" => {
    const known = gates.get(branch);
    if (known !== undefined) return known;
    const left = timeFor(GUARD_GIT_TIMEOUT_MS);
    if (left <= 0) return "late";
    const read = resolveGate(paths, project, branch, { env, timeoutMs: left });
    gates.set(branch, read);
    return read;
  };

  // WA1: a `gh pr create` with no `--head` comes from the branch this folder is on, read once.
  let branchHere: string | null | undefined;
  const currentBranch = (): string | null => {
    if (branchHere !== undefined) return branchHere;
    const left = timeFor(GUARD_GIT_TIMEOUT_MS);
    if (left <= 0) {
      branchHere = null;
      return null;
    }
    const read = runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], env, left);
    branchHere = read.ok && read.out !== "" ? read.out : null;
    return branchHere;
  };

  // WA1: the repository's default branch for an opening with no `--base`, read once per
  // repository — `gh repo view` first (the guard's own way to read a repo fact), then the
  // `origin/HEAD` git already has. Late and unread are their own answers: both ask.
  const openingDefaults = new Map<string, string | null>();
  const defaultBranchHere = (repo: string | null): string | null | "late" | "unread" => {
    const key = repo ?? "";
    if (openingDefaults.has(key)) return openingDefaults.get(key) ?? null;
    const left = timeFor(GH_TIMEOUT_MS);
    if (left <= 0) return "late";
    let branch = defaultBranchOf(cwd, env, repo, left);
    if (branch === null) {
      const gitLeft = timeFor(GUARD_GIT_TIMEOUT_MS);
      if (gitLeft <= 0) return "late";
      const origin = runGit(cwd, ["rev-parse", "--abbrev-ref", "origin/HEAD"], env, gitLeft);
      const name = origin.ok ? origin.out.replace(/^origin\//, "") : "";
      branch = name === "" ? null : name;
    }
    if (branch === null) return "unread";
    openingDefaults.set(key, branch);
    return branch;
  };

  /**
   * Why a `gh pr create` opens outside the base its head branch belongs to, or null:
   * `worktrees.base`, or the `worktrees.bases` mapping for that branch. With no `--base` the
   * pull request opens into the repository's default branch.
   */
  const opensOutsideBase = (
    opening: MergeCall,
    worktrees: CcSmartDevKitConfig["worktrees"] | undefined,
  ): string | null | "late" | "unread" => {
    if (opening.opens !== "create" || opening.cli !== true || worktrees === undefined) return null;
    const head = headBranchOf(opening.head ?? null) ?? currentBranch();
    if (head === null) return null;
    const expected = baseForBranch(worktrees, head);
    const into = opening.base ?? defaultBranchHere(opening.target?.repo ?? null);
    if (into === "late" || into === "unread") return into;
    if (into === null) return null;
    return into === expected ? null : opensElsewhere(into, head, expected);
  };

  // Every merge and every opening the command runs, in order, its aliases read when a `gh
  // <word>` needs them (a local file read, no network). A `--disable-auto` takes an armed
  // merge back: it merges nothing, so it is not judged.
  const calls = pullRequestCallsWithAliases(command, cwd, env, timeFor(ALIAS_LIMIT_MS), dialect);
  const merges = calls.filter((one) => isMerge(one) && !one.disarms);
  const openings = calls.filter((one) => !isMerge(one));

  // The merge policy first, from the base this checkout names: it needs no gh, so a machine
  // without gh hears the real reason — and a command the guard cannot judge at all costs no gh
  // call either. The pull request's own base is read again below, once gh has named it.
  const integration = config.worktrees?.base ?? null;
  if (integration !== null && merges.length > 0) {
    let early: GateRead | "late";
    try {
      early = gateOf(integration);
    } catch (error) {
      return refuseMerge(notByItself(workflowUnread(error)));
    }
    if (early === "late") return refuseMerge(notInTime(`the policy committed on ${integration}`));
    if (!early.ok) return refuseMerge(notByItself(policyUnread(integration, early.why)));
    // The project runs its own merge guard, as its committed policy says: that one answers.
    if (early.gate.config?.ownHooks?.includes("merge-guard") === true) return SILENT;
    const off = autoMergeOff(early.gate.resolved, integration);
    if (off !== null) return refuseMerge(notByItself(off));
  }

  // The one judgment, shared with `workflow merge-check` (`src/workflow/merge-check.ts`).
  const world: MergeWorld = {
    paths,
    checkout: {
      root: project.root,
      commonDir: project.commonDir,
      isWorktree: project.isWorktree,
      mainCheckout: project.mainCheckout,
    },
    folder: cwd,
    env,
    timeFor,
    gateOf,
  };
  const defaultBranches = new Map<string, string | null>();
  let own: string | null = null;
  let ownRead = false;
  /** Why a call naming `repo` is no call about this project's own repository: late, or why not. */
  const foreignReason = (repo: string): { late: boolean; reason: string | null } => {
    if (!ownRead) {
      const left = timeFor(GUARD_GIT_TIMEOUT_MS);
      if (left <= 0) return { late: true, reason: null };
      own = ownRepository(project, env, left);
      ownRead = true;
    }
    return { late: false, reason: foreignRepository(repo, own) };
  };
  /** The reason the policy allowed the last merge judged; null until one is. */
  let allowed: string | null = null;
  for (const merge of merges) {
    const number = numericRef(merge.target?.ref ?? null);
    if (merge.admin) {
      return refuseMerge(notByItself(adminRefusal(merge.target?.ref ?? null)));
    }
    if (merge.unread !== null) return refuseMerge(notChecked(merge.unread, env));
    if (merge.refusal !== null) return refuseMerge(notByItself(merge.refusal, number));
    const target = merge.target;
    if (target === null) continue;
    // The policy covers this project's own repository only: a merge that names another one
    // asks, whatever the facts say (and the origin is read once, only when one is named).
    if (target.repo !== null) {
      const foreign = foreignReason(target.repo);
      if (foreign.late) return refuseMerge(notInTime("this project's own repository"));
      if (foreign.reason !== null) {
        return refuseMerge(notByItself(foreign.reason, number));
      }
    }
    const verdict = checkPullRequest(world, target, defaultBranches);
    // A crew session never merges: even a merge no policy covers is refused (D24).
    if (verdict.kind === "silent") {
      return crew ? toolDecision("deny", CREW_MERGE_REFUSAL) : SILENT;
    }
    if (verdict.kind !== "allowed") return refuseMerge(askFor(verdict, env));
    allowed = verdict.reason;
  }

  // Then every pull request the command opens or readies (D16): `openPr` decides.
  for (const opening of openings) {
    if (opening.refusal !== null) {
      return refuseOpening(notOpenedByItself(opening, opening.refusal));
    }
    const repo = opening.target?.repo ?? null;
    if (repo !== null) {
      const foreign = foreignReason(repo);
      if (foreign.late) {
        return refuseOpening(
          notOpenedByItself(
            opening,
            "reading this project's own repository would have taken longer than the guard's own budget allows",
          ),
        );
      }
      if (foreign.reason !== null) {
        return refuseOpening(notOpenedByItself(opening, foreign.reason));
      }
    }
    let read: GateRead | "late";
    try {
      read = gateOf(integration);
    } catch (error) {
      return refuseOpening(notOpenedByItself(opening, workflowUnread(error)));
    }
    if (read === "late") {
      return refuseOpening(
        notOpenedByItself(
          opening,
          "reading the policy would have taken longer than the guard's own budget allows",
        ),
      );
    }
    if (!read.ok) {
      return refuseOpening(
        notOpenedByItself(opening, policyUnread(integration, read.why, "openPr policy")),
      );
    }
    // The project runs its own merge guard, as its committed policy says: that one answers.
    if (read.gate.config?.ownHooks?.includes("merge-guard") === true) return SILENT;
    const why = openPrRefusal(read.gate.resolved, integration, {
      draft: opening.draft === true,
      kind: opening.opens ?? "create",
    });
    if (why !== null) return refuseOpening(notOpenedByItself(opening, why));
    // WA1: a `gh pr create` outside the base its head branch belongs to asks, never denies:
    // the person may mean it.
    const outside = opensOutsideBase(opening, read.gate.config?.worktrees);
    if (outside === "late") {
      return refuseOpening(notOpenedByItself(opening, OPENING_DEFAULT_LATE));
    }
    if (outside === "unread") {
      return refuseOpening(notOpenedByItself(opening, OPENING_DEFAULT_UNREAD));
    }
    if (outside !== null) return refuseOpening(notOpenedByItself(opening, outside));
  }
  // D31: an exact `gh pr merge <n>` the whole policy allowed skips auto mode's "Merge Without
  // Review" rule for the call. Any other passing line stays silent, as before. A crew session
  // is never allowed, and never merges: the merge is refused (D24).
  if (allowed !== null && !crew && exactMergeOf(command, dialect) !== null) {
    return toolDecision("allow", allowed);
  }
  if (crew && (merges.length > 0 || openings.length > 0)) {
    return toolDecision("deny", merges.length > 0 ? CREW_MERGE_REFUSAL : CREW_PR_REFUSAL);
  }
  return SILENT;
}
