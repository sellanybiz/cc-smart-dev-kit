/**
 * How a plan's files are compared with another plan's (D2, D3): the committed `plans.mergeFiles`
 * list that takes no part in an overlap, and whether the file system ignores case. Both are
 * read from git, so a caller reads them **before** it takes the write lock (`writeWork`) and
 * passes them in: `reservePlan` as `ignore` and `caseFold`, `task_update` as `filesCheck`.
 */
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import { locateCheckout } from "../project/resolve";
import { resolveMergeFiles } from "../workflow/resolve";
import { baseBranch } from "../worktrees/command";
import type { FilesCheck } from "./work/store";

export interface PlanFilesCheck extends FilesCheck {
  /** Why the merge file list is empty or short (`resolveMergeFiles`), for the caller to show; null when whole. */
  reason: string | null;
}

/**
 * The check for the checkout `cwd` is in. `plans.mergeFiles` comes only from the committed copy
 * on `origin/<base>` (`resolveMergeFiles`), never from the working copy. A folder outside git
 * has no list and compares with case.
 *
 * `resolveMergeFiles` does not throw: a list it cannot read (no base, no ref, no file, a bad
 * entry) comes back empty or short with a `reason`, so more paths count as overlaps, and the
 * refusal that follows says why (`FilesCheck.reason`). An unreadable `core.ignorecase` reads as
 * false (paths compare with case). Only locating the checkout and reading the project's own
 * file (`locateCheckout`, `baseBranch`) can throw, and that fails the call.
 */
export function planFilesCheck(cwd: string, env: Env = process.env): PlanFilesCheck {
  const checkout = locateCheckout(cwd, { env });
  if (checkout === null) return { ignore: [], caseFold: false, reason: null };
  const merge = resolveMergeFiles(checkout, baseBranch(checkout, env, checkout.root).base, { env });
  const ignorecase = runGit(checkout.root, ["config", "--type=bool", "core.ignorecase"], env);
  return {
    ignore: merge.files,
    caseFold: ignorecase.ok && ignorecase.out === "true",
    reason: merge.reason,
  };
}
