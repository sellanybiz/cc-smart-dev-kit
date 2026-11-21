/**
 * Whether a stacked plan (`stacked_on`) is really built on its parent: the proof the overlap check
 * needs before it skips the pair (`isStackedPair`). Read from git, so a caller reads it **before**
 * it takes the write lock, the way it reads `planFilesCheck`, from the task rows **as the call
 * will write them**, and passes the proved pairs in: `reservePlan` as `stacked`, `task_update`
 * and a start as `FilesCheck.stacked`, `herdr plans` to its own lines. A stack it cannot prove is
 * no pair: the two plans are rivals (fail closed).
 *
 * The proof uses fork points. With T the parent's branch tip and D `origin/<default branch>`: the
 * parent has work of its own (T is not on D), and the stacked plan's start S shares some of it:
 * every fork point of S and T (`git merge-base --all`) is a commit of the parent's own line above
 * its own start (`git rev-list --first-parent <base>..T`, its recorded `base`), and is on neither D
 * nor the branch tip of the plan the parent is stacked on. So a commit that is only missing from D
 * (an unpushed default-branch commit, a grandparent's work, a branch the parent merged in) never
 * counts as the parent's. That holds when the parent moves on or merges the default branch after
 * the start, and fails when the parent is rebased, since a fork point then sits on D or under its
 * start. A branch the stacked plan
 * records must hold S and differ from the parent's, and a start the plan only recorded (its
 * `base`, not the commit a `herdr start` is about to reset to) counts only with that branch
 * recorded: herdr records it at launch.
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
 * - `parent-base`: the parent records no start (`base`) git knows, so its own work has no lower end;
 * - `chain-branch`: the plan the parent is stacked on records a branch git does not know;
 * - `no-start`: no start was given and the stacked plan records no base git knows;
 * - `own-branch`: the stacked plan has no branch of its own: none recorded for a recorded start,
 *   or the parent's branch;
 * - `start-lacks-parent`: a fork point of the start and the parent is not the parent's own work (a
 *   parent rebased since the start, or a start on a branch the parent only merged in);
 * - `start-off-branch`: the stacked plan records a branch whose tip does not hold the start;
 * - `git`: a git command failed.
 */
export type StackGap =
  | "default-unknown"
  | "other-lead"
  | "parent-branch"
  | "parent-empty"
  | "parent-base"
  | "chain-branch"
  | "no-start"
  | "own-branch"
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

/** One stacked pair as `stackHolds` judges it. */
export interface StackCase {
  parent: WorkTask;
  child: WorkTask;
  /** The plan the parent is stacked on, or null: its branch tip fences the parent's own work. */
  grandparent: WorkTask | null;
  /** The commit the child starts from: given (a start about to happen), else its recorded `base`. */
  start: string | null;
  /** True when `start` is the commit a `herdr start` is about to reset the child to. */
  given: boolean;
}

/**
 * Whether the child, starting from its start S, is built on the parent's own work, judged against
 * `onDefault` (D, `defaultTip`). The lead is judged by the caller (`judgeStacks`). In order: the
 * parent's branch T is known, is not the child's branch, and is not on D; the parent's recorded
 * start and the grandparent's branch tip (when it records one) are known; S names a commit; a
 * recorded S comes with a recorded child branch; every `git merge-base --all S T` is on the
 * parent's first-parent line above its start and on neither D nor the grandparent's tip; and the
 * child's branch, when recorded, holds S.
 * Anything git cannot answer is not proved.
 */
export function stackHolds(
  git: StackGit,
  onDefault: string | null,
  { parent, child, grandparent, start, given }: StackCase,
): StackVerdict {
  if (onDefault === null) return gap("default-unknown");
  if (parent.branch === null) return gap("parent-branch");
  if (child.branch === parent.branch) return gap("own-branch");
  const tip = branchTip(git, parent.branch);
  if (tip === null) return gap("parent-branch");
  const empty = isAncestor(git, tip, onDefault);
  if (empty === null) return gap("git");
  if (empty) return gap("parent-empty");
  const parentStart = parent.base === null ? null : commitOf(git, parent.base);
  if (parentStart === null) return gap("parent-base");
  const fences = [onDefault];
  if (grandparent !== null && grandparent.branch !== null) {
    const chain = branchTip(git, grandparent.branch);
    if (chain === null) return gap("chain-branch");
    fences.push(chain);
  }
  const from = start === null ? null : commitOf(git, start);
  if (from === null) return gap("no-start");
  if (!given && child.branch === null) return gap("own-branch");
  // Exit 1 with no output: the two share no history at all. A criss-cross history has several
  // fork points, and every one must pass.
  const forks = git(["merge-base", "--all", from, tip]);
  if (forks.code === 1) return gap("start-lacks-parent");
  if (!forks.ok || forks.out === "") return gap("git");
  // The parent's own line: the commits it made itself above its start, never a branch it merged
  // in. `<start>..` already leaves out everything under the parent's start.
  const own = git(["rev-list", "--first-parent", `${parentStart}..${tip}`]);
  if (!own.ok) return gap("git");
  const line = new Set(own.out.split("\n"));
  for (const fork of forks.out.split("\n")) {
    if (!line.has(fork)) return gap("start-lacks-parent");
    for (const fence of fences) {
      const under = isAncestor(git, fork, fence);
      if (under === null) return gap("git");
      if (under) return gap("start-lacks-parent");
    }
  }
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
 * --plan`), else its recorded `base`, which counts only with its branch recorded (`stackHolds`). `defaultBranch` is the project's default branch, null when
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
    const given = starts[plan.id];
    const verdict = stackHolds(git, onDefault.tip, {
      parent,
      child: plan,
      grandparent: parent.stackedOn === null ? null : (plans.get(parent.stackedOn) ?? null),
      start: given ?? plan.base,
      given: given !== undefined,
    });
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
