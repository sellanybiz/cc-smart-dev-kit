/**
 * Whether a stacked plan (`stacked_on`) is really built on its parent: the proof the overlap check
 * needs before it skips the pair (`isStackedPair`). Read from git, so a caller reads it **before**
 * it takes the write lock, the way it reads `planFilesCheck`, and passes the proved plans in:
 * `reservePlan` as `stacked`, `task_update` and a start as `FilesCheck.stacked`, `herdr plans`
 * to its own lines. A stack it cannot prove is no pair: the two plans are rivals (fail closed).
 */
import type { GitRun } from "../hooks/git";
import { parentHolds } from "./work/queries";
import type { WorkTask } from "./work/types";

/** One git command in the caller's checkout (branches are shared by every worktree). */
export type StackGit = (args: string[]) => GitRun;

/** The commit a recorded branch is at, here or on origin; null when the branch is unknown. */
export function branchTip(git: StackGit, branch: string): string | null {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const run = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (run.ok && run.out !== "") return run.out;
  }
  return null;
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

/**
 * True when `start`, the commit the stacked plan starts from, holds its parent's work. The parent
 * must record its branch and its `base`, and its branch must hold a commit past that base (an
 * empty parent has no work to build on). Then either the parent's branch tip is in the start
 * (`git merge-base --is-ancestor`: started on the tip, or merged it since), or the start is a
 * commit of the parent's own line (`git rev-list --first-parent <base>..<tip>`: started on the
 * tip, which has moved on since). Anything git cannot answer is false.
 */
export function stackHolds(git: StackGit, parent: WorkTask, start: string | null): boolean {
  if (parent.branch === null || parent.base === null || start === null) return false;
  const tip = branchTip(git, parent.branch);
  const base = commitOf(git, parent.base);
  const from = commitOf(git, start);
  if (tip === null || base === null || from === null) return false;
  const line = git(["rev-list", "--first-parent", `${base}..${tip}`]);
  if (!line.ok || line.out === "") return false;
  if (line.out.split("\n").includes(from)) return true;
  return git(["merge-base", "--is-ancestor", tip, from]).code === 0;
}

/**
 * The plan task ids of the stacked plans among `all` whose start holds their parent's work
 * (`stackHolds`), judged only while the parent holds its files (`parentHolds`). A plan's start is
 * `starts[its id]` when the caller is about to start it there (`herdr start --plan`), else its
 * recorded `base`; with neither it is not proved.
 */
export function provedStacks(
  all: readonly WorkTask[],
  git: StackGit,
  starts: Readonly<Record<string, string>> = {},
): string[] {
  const plans = new Map(
    all.filter((t) => t.kind === "plan" && t.plan !== null).map((t) => [t.plan, t]),
  );
  const proved: string[] = [];
  for (const plan of plans.values()) {
    if (plan.stackedOn === null) continue;
    const parent = plans.get(plan.stackedOn);
    if (parent === undefined || !parentHolds(parent)) continue;
    if (stackHolds(git, parent, starts[plan.id] ?? plan.base)) proved.push(plan.id);
  }
  return proved;
}
