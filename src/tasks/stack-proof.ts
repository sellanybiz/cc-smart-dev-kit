/**
 * Whether a stacked plan (`stacked_on`) is really built on its parent: the proof the overlap check
 * needs before it skips the pair (`isStackedPair`). Read from git, so a caller reads it **before**
 * it takes the write lock, the way it reads `planFilesCheck`, from the task rows **as the call
 * will write them**, and passes the proved pairs in: `reservePlan` as `stacked`, `task_update`
 * and a start as `FilesCheck.stacked`, `herdr plans` to its own lines. A stack it cannot prove is
 * no pair: the two plans are rivals (fail closed).
 *
 * The proof uses fork points, never a recorded base of the parent. With T the parent's branch tip
 * and D `origin/<default branch>`: the parent has work of its own (T is not on D), and the
 * stacked plan's start S shares some of it (`git merge-base S T` is not on D). That holds when
 * the parent moves on after the start, and fails when the parent is rebased, since the fork point
 * then sits on D. When the stacked plan records a branch, its tip must hold S, so a start it
 * merely wrote down proves nothing.
 */
import type { GitRun } from "../hooks/git";
import { parentHolds, type StackPair, sameLead } from "./work/queries";
import type { WorkTask } from "./work/types";

/** One git command in the caller's checkout (branches are shared by every worktree). */
export type StackGit = (args: string[]) => GitRun;

/**
 * Why a stack is not proved, for the fix a line shows (`herdr plans`):
 * - `default-unknown`: the default branch is not known, or origin has no copy of it;
 * - `other-lead`: no one lead leads both plans now (`sameLead`);
 * - `parent-branch`: the parent records no branch, or git knows no such branch;
 * - `parent-empty`: the parent's branch holds no commit past the default branch yet;
 * - `no-start`: no start was given and the stacked plan records no base git knows;
 * - `start-lacks-parent`: the start holds none of the parent's own work (a parent rebased since
 *   the start is one way);
 * - `start-off-branch`: the stacked plan records a branch whose tip does not hold the start;
 * - `git`: a git command failed.
 */
export type StackGap =
  | "default-unknown"
  | "other-lead"
  | "parent-branch"
  | "parent-empty"
  | "no-start"
  | "start-lacks-parent"
  | "start-off-branch"
  | "git";

export type StackVerdict = { proved: true } | { proved: false; gap: StackGap };

const gap = (why: StackGap): StackVerdict => ({ proved: false, gap: why });

/** The commit a recorded branch is at, here or on origin; null when the branch is unknown. */
export function branchTip(git: StackGit, branch: string): string | null {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const run = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (run.ok && run.out !== "") return run.out;
  }
  return null;
}

/**
 * The commit `origin/<default branch>` is at (D); null when the default branch is unknown
 * (`defaultBranch` null) or origin has no such branch here.
 */
export function defaultTip(git: StackGit, defaultBranch: string | null): string | null {
  if (defaultBranch === null) return null;
  const run = git([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/origin/${defaultBranch}^{commit}`,
  ]);
  return run.ok && run.out !== "" ? run.out : null;
}

/**
 * The full commit a stored name says (a plan's `base`, a start's commit); null when it names
 * none. A name that starts with `-` would reach git as an option, so it names nothing here.
 */
function commitOf(git: StackGit, name: string): string | null {
  if (name.startsWith("-")) return null;
  const run = git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
  return run.ok && run.out !== "" ? run.out : null;
}

/** Whether `commit` is in `tip`'s history: null when git cannot say. */
function isAncestor(git: StackGit, commit: string, tip: string): boolean | null {
  const run = git(["merge-base", "--is-ancestor", commit, tip]);
  return run.code === 0 ? true : run.code === 1 ? false : null;
}

/**
 * Whether `child`, starting from `start`, is built on `parent`'s own work, judged against
 * `onDefault` (D, `defaultTip`). The lead is judged by the caller (`judgeStacks`). In order:
 * the parent's branch tip T is known and not on D; the start S names a commit; `git merge-base
 * S T` exists and is not on D; and when the child records a branch, its tip holds S. Anything
 * git cannot answer is not proved.
 */
export function stackHolds(
  git: StackGit,
  onDefault: string | null,
  parent: WorkTask,
  child: WorkTask,
  start: string | null,
): StackVerdict {
  if (onDefault === null) return gap("default-unknown");
  if (parent.branch === null) return gap("parent-branch");
  const tip = branchTip(git, parent.branch);
  if (tip === null) return gap("parent-branch");
  const empty = isAncestor(git, tip, onDefault);
  if (empty === null) return gap("git");
  if (empty) return gap("parent-empty");
  const from = start === null ? null : commitOf(git, start);
  if (from === null) return gap("no-start");
  // Exit 1 with no output: the two share no history at all.
  const fork = git(["merge-base", from, tip]);
  if (fork.code === 1) return gap("start-lacks-parent");
  if (!fork.ok || fork.out === "") return gap("git");
  const shared = isAncestor(git, fork.out, onDefault);
  if (shared === null) return gap("git");
  if (shared) return gap("start-lacks-parent");
  if (child.branch !== null) {
    const built = branchTip(git, child.branch);
    if (built === null) return gap("start-off-branch");
    const holds = isAncestor(git, from, built);
    if (holds === null) return gap("git");
    if (!holds) return gap("start-off-branch");
  }
  return { proved: true };
}

/** One stacked plan's verdict (`judgeStacks`): the pair it names and whether it is proved. */
export interface StackJudgment {
  pair: StackPair;
  verdict: StackVerdict;
}

/**
 * The verdict of every stacked plan among `all` whose parent holds its files (`parentHolds`), by
 * the stacked plan's task id. `all` is the task rows as the caller's write will leave them. A
 * plan's start is `starts[its id]` when the caller is about to start it there (`herdr start
 * --plan`), else its recorded `base`. `defaultBranch` is the project's default branch, null when
 * it is unknown: then nothing is proved. A pair whose plans have no one lead (`sameLead`) runs no git.
 */
export function judgeStacks(
  all: readonly WorkTask[],
  git: StackGit,
  defaultBranch: string | null,
  starts: Readonly<Record<string, string>> = {},
): Map<string, StackJudgment> {
  const plans = new Map(
    all.filter((t) => t.kind === "plan" && t.plan !== null).map((t) => [t.plan, t]),
  );
  const judged = new Map<string, StackJudgment>();
  // D is read once, and only when some pair gets as far as git.
  let onDefault: { tip: string | null } | null = null;
  for (const plan of plans.values()) {
    if (plan.stackedOn === null) continue;
    const parent = plans.get(plan.stackedOn);
    if (parent === undefined || !parentHolds(parent)) continue;
    const pair = { child: plan.id, parent: plan.stackedOn };
    if (!sameLead(plan, parent)) {
      judged.set(plan.id, { pair, verdict: gap("other-lead") });
      continue;
    }
    onDefault ??= { tip: defaultTip(git, defaultBranch) };
    const verdict = stackHolds(git, onDefault.tip, parent, plan, starts[plan.id] ?? plan.base);
    judged.set(plan.id, { pair, verdict });
  }
  return judged;
}

/** The proved pairs among `judgeStacks`'s verdicts: what the overlap check is given. */
export function provedStacks(
  all: readonly WorkTask[],
  git: StackGit,
  defaultBranch: string | null,
  starts: Readonly<Record<string, string>> = {},
): StackPair[] {
  return provedPairs(judgeStacks(all, git, defaultBranch, starts));
}

/** The pairs of the proved verdicts. */
export function provedPairs(judged: ReadonlyMap<string, StackJudgment>): StackPair[] {
  return [...judged.values()].filter((one) => one.verdict.proved).map((one) => one.pair);
}
