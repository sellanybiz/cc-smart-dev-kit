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
 * Who calls this: the merge guard hook (a later piece) decides a merge with it, after the
 * checks that are not branch policy — CI green, the review done — and after
 * `resolved.autoMerge` is on. Nothing here runs a command; it is a decision, so it is a
 * pure function with its own tests.
 */
import type { CcSmartDevKitConfig } from "../project/config";
import type { ResolvedWorkflow } from "./resolve";

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
  if (!resolved.autoMerge.value) return false;
  const integration = projectConfig?.worktrees?.base;
  if (integration === undefined) return false;
  if (prBase !== integration) return false;
  if (integration === defaultBranch) return false;
  const targets = Object.values(projectConfig?.worktrees?.bases ?? {});
  if (targets.includes(integration)) return false;
  return true;
}
