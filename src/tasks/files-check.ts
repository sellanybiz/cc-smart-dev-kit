/**
 * How a plan's files are compared with another plan's (D2, D3): the committed `plans.mergeFiles`
 * list that takes no part in an overlap, the committed `plans.appendOnly` folders where only the
 * same file overlaps, and whether the file system ignores case. All three are read from git, so a
 * caller reads them **before** it takes the write lock (`writeWork`) and passes them in:
 * `reservePlan` as `ignore`, `appendOnly` and `caseFold`, `task_update` as `filesCheck`.
 */
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import { type Checkout, locateCheckout, readCommittedConfig } from "../project/resolve";
import { resolveMergeFiles } from "../workflow/resolve";
import { baseBranch } from "../worktrees/command";
import type { FilesCheck } from "./work/store";

export interface PlanFilesCheck extends FilesCheck {
  /** `plans.appendOnly` as committed on `origin/<base>`; empty when none could be read. */
  appendOnly: readonly string[];
  /** Why the merge file list is empty or short (`resolveMergeFiles`), for the caller to show; null when whole. */
  reason: string | null;
}

/**
 * The check for the checkout `cwd` is in. `plans.mergeFiles` and `plans.appendOnly` come only
 * from the committed copy on `origin/<base>`, never from the working copy, so a session cannot
 * widen either by editing a file. A folder outside git has no lists and compares with case.
 *
 * `resolveMergeFiles` does not throw: a list it cannot read (no base, no ref, no file, a bad
 * entry) comes back empty or short with a `reason`, so more paths count as overlaps, and the
 * refusal that follows says why (`FilesCheck.reason`). An unreadable `core.ignorecase` reads as
 * false (paths compare with case). Only locating the checkout and reading the project's own
 * file (`locateCheckout`, `baseBranch`) can throw, and that fails the call.
 */
export function planFilesCheck(cwd: string, env: Env = process.env): PlanFilesCheck {
  const checkout = locateCheckout(cwd, { env });
  if (checkout === null) return { ignore: [], appendOnly: [], caseFold: false, reason: null };
  const { base } = baseBranch(checkout, env, checkout.root);
  const merge = resolveMergeFiles(checkout, base, { env });
  const ignorecase = runGit(checkout.root, ["config", "--type=bool", "core.ignorecase"], env);
  return {
    ignore: merge.files,
    appendOnly: committedAppendOnly(checkout, base, env),
    caseFold: ignorecase.ok && ignorecase.out === "true",
    reason: merge.reason,
  };
}

/**
 * `plans.appendOnly` as committed on `origin/<base>`. It reads the same committed file as
 * `resolveMergeFiles`, so whatever keeps that file from being read (no ref, no file, a file this
 * kit refuses) is already the merge list's `reason`, which the refusal shows. Such a
 * file gives no folders here: every path then overlaps as a plain path, never fewer.
 */
function committedAppendOnly(checkout: Checkout, base: string, env: Env): string[] {
  try {
    const committed = readCommittedConfig(checkout, base, { env });
    return committed.found ? [...(committed.config.workflow?.plans?.appendOnly ?? [])] : [];
  } catch {
    // The same read failed inside `resolveMergeFiles`, which names it in `reason`.
    return [];
  }
}
