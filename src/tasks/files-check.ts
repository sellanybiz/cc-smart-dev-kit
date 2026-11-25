/**
 * How a plan's files are compared with another plan's (D2, D3): the committed `plans.mergeFiles`
 * list that takes no part in an overlap, the committed `plans.appendOnly` folders where only the
 * same file overlaps, and whether the file system ignores case. All three are read from git, so a
 * caller reads them **before** it takes the write lock (`writeWork`) and passes them in:
 * `reservePlan` as `ignore`, `appendOnly` and `caseFold`, `task_update` as `filesCheck`.
 */
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import { locateCheckout } from "../project/resolve";
import { resolvePlanFiles } from "../workflow/resolve";
import { baseBranch } from "../worktrees/command";
import type { FilesCheck } from "./work/store";

export interface PlanFilesCheck extends FilesCheck {
  /** `plans.appendOnly` as committed on `origin/<base>`; empty when none could be read. */
  appendOnly: readonly string[];
  /** Why the committed lists are empty or short (`resolvePlanFiles`), for the caller to show; null when whole. */
  reason: string | null;
}

/**
 * The check for the checkout `cwd` is in. `plans.mergeFiles` and `plans.appendOnly` come only
 * from the committed copy on `origin/<base>`, in one read (`resolvePlanFiles`), never from the
 * working copy, so a session cannot widen either by editing a file. A folder outside git has no
 * lists and compares with case.
 *
 * `resolvePlanFiles` does not throw: lists it cannot read (no base, no ref, no file, a bad
 * entry) come back empty or short with a `reason`, so more paths count as overlaps, and the
 * refusal that follows says why (`FilesCheck.reason`). An unreadable `core.ignorecase` reads as
 * false (paths compare with case). Only locating the checkout and reading the project's own
 * file (`locateCheckout`, `baseBranch`) can throw, and that fails the call.
 */
export function planFilesCheck(cwd: string, env: Env = process.env): PlanFilesCheck {
  const checkout = locateCheckout(cwd, { env });
  if (checkout === null) return { ignore: [], appendOnly: [], caseFold: false, reason: null };
  const committed = resolvePlanFiles(checkout, baseBranch(checkout, env, checkout.root).base, {
    env,
  });
  return {
    ignore: committed.files,
    appendOnly: committed.appendOnly,
    caseFold: ignoresCase(checkout.root, env),
    reason: committed.reason,
  };
}

/**
 * Whether the checkout at `root` compares paths without case (`core.ignorecase`). A setting git
 * cannot read is false: paths then compare with case.
 */
export function ignoresCase(root: string, env: Env = process.env): boolean {
  const ignorecase = runGit(root, ["config", "--type=bool", "core.ignorecase"], env);
  return ignorecase.ok && ignorecase.out === "true";
}
