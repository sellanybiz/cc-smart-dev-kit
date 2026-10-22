/**
 * May cc-smart-dev-kit merge a pull request by itself?
 *
 * The one place it may write to is the project's **integration base**, `worktrees.base`: the
 * branch every session's work comes together on. And even there it asks the person when that
 * base is not a plain one:
 *
 * - the repository's **default branch** (`main`): merging there is a release, which is the
 *   person's decision, never a hook's;
 * - a **target of `worktrees.bases`** (`{"release/": "dev"}` makes `dev` such a target):
 *   another family of branches feeds it, so it is not a plain integration base either.
 *
 * The integration base may itself be listed in `protectedBranches`: it is the one branch
 * this may write to, and a protection there is about pushing by hand (the git guard still
 * asks about that). Any other protected branch is never a target here — the pull request's
 * base must BE the integration base — so those keep asking the person, as they should.
 *
 * Who calls this: the merge guard hook (`src/hooks/merge-guard.ts`) decides a merge with the
 * two functions here, after the checks that are not branch policy — CI green, the review
 * done — and after `resolved.autoMerge` is on. Nothing here runs a command; it is a decision,
 * so it is a pure function with its own tests.
 */

import type { CcSmartDevKitConfig } from "../project/config";
import { CONFIG_PATH } from "../project/resolve";
import { type ResolvedWorkflow, sourceLabel } from "./resolve";

/**
 * The first condition on its own: the policy is off. The merge guard asks with this before
 * it reads anything with `gh`, so a machine without `gh` still hears the real reason.
 *
 * `base` is the branch whose committed file the value was read from (`resolveGate`), or null
 * when none was. The way to turn it on is the way the guard reads it: in the project's file,
 * committed to that branch and pushed — never a `workflow set` a session cannot run, nor a
 * change in a checkout the guard does not read.
 */
export function autoMergeOff(resolved: ResolvedWorkflow, base: string | null): string | null {
  if (resolved.autoMerge.value) return null;
  const where = base ?? "the integration base (worktrees.base)";
  return `autoMerge is off (${sourceLabel(resolved.autoMerge, base)}): turn it on in ${CONFIG_PATH} ("workflow": {"autoMerge": true}), commit it to ${where} and push`;
}

/**
 * The reason cc-smart-dev-kit may not merge this pull request by itself, in the words the
 * person reads when the merge guard asks them; null when it may. This is the one home of
 * those conditions: `autoMergeAllowed` is `autoMergeRefusal(…) === null`.
 *
 * `defaultBranch` is the repository's own default branch, as the caller read it.
 */
export function autoMergeRefusal(
  resolved: ResolvedWorkflow,
  projectConfig: CcSmartDevKitConfig | null,
  prBase: string,
  defaultBranch: string,
): string | null {
  // The guard reads the policy committed on the pull request's own base (`resolveGate`).
  const off = autoMergeOff(resolved, prBase);
  if (off !== null) return off;
  const integration = projectConfig?.worktrees?.base;
  if (integration === undefined) {
    return "this project names no integration base (worktrees.base in .claude/cc-smart-dev-kit.json), so there is no branch cc-smart-dev-kit may merge into by itself";
  }
  if (prBase !== integration) {
    return `the pull request's base is ${prBase}, not the project's integration base ${integration}`;
  }
  if (integration === defaultBranch) {
    return `${integration} is the repository's default branch: merging there is a release, and that is your decision`;
  }
  const targets = Object.values(projectConfig?.worktrees?.bases ?? {});
  if (targets.includes(integration)) {
    return `${integration} is the target of another branch family (worktrees.bases), so it is not a plain integration base`;
  }
  return null;
}

/**
 * True when cc-smart-dev-kit may merge a pull request whose base is `prBase` into the
 * project's integration base by itself. `defaultBranch` is the repository's own default
 * branch (`origin/HEAD`), as the caller read it. False whenever anything is not plain.
 */
export function autoMergeAllowed(
  resolved: ResolvedWorkflow,
  projectConfig: CcSmartDevKitConfig | null,
  prBase: string,
  defaultBranch: string,
): boolean {
  return autoMergeRefusal(resolved, projectConfig, prBase, defaultBranch) === null;
}
