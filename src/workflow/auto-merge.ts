/**
 * May cc-smart-dev-kit merge a pull request by itself?
 *
 * With `allowMerge` on (and the checks green and the review recorded, which `merge-check.ts`
 * reads), a pull request may be merged into two bases and no other:
 *
 * - the project's **integration base**, `worktrees.base`: the branch every session's work
 *   comes together on;
 * - the repository's **default branch** (`main`): the person's ruling (2026-11-21) is that
 *   `allowMerge` on means a merge into `main` too, with no question.
 *
 * A project that names no integration base may merge into the default branch alone. A pull
 * request into any other branch (a release branch, a protected one) is not covered: that merge
 * stays the person's own. The old rule that a target of `worktrees.bases` is no plain base is
 * gone with the guard it fed: a merge into the PR's base is the merge `allowMerge` asked for.
 *
 * Who calls this: `workflow merge-check` and the portal's branch verdicts, after the checks that
 * are not branch policy (CI green, the review done) and after `resolved.allowMerge` is on.
 * `merge-check --asked` calls `baseRefusal` alone: the person's yes stands in for the switch.
 * Nothing here runs a command; it is a decision, so it is a pure function with its own tests.
 */

import { COMMAND } from "../build-info/names";
import { type CcSmartDevKitConfig, WORKFLOW_ALLOW_KEYS_SINCE } from "../project/config";
import { requiresFor } from "../project/init";
import { CONFIG_PATH } from "../project/resolve";
import { type ResolvedWorkflow, sourceLabel } from "./resolve";

/**
 * The first condition on its own: the policy is off. `merge-check` asks with this before
 * it reads anything with `gh`, so a machine without `gh` still hears the real reason.
 *
 * `base` is the branch whose committed file the value was read from (`resolveGate`), or null
 * when none was. The project's value is the one committed on that branch and pushed, so the
 * message names the file to change.
 */
export function autoMergeOff(resolved: ResolvedWorkflow, base: string | null): string | null {
  if (resolved.allowMerge.value) return null;
  const where = base ?? "the integration base (worktrees.base)";
  // A hand-written `allowMerge` needs `requires` at the release that knows it; `workflow set
  // --project` raises it, so the command is the first way named.
  return `allowMerge is off (${sourceLabel(resolved.allowMerge, base)}): turn it on with \`${COMMAND} workflow set allowMerge true --project\`, or write ("workflow": {"allowMerge": true}) in ${CONFIG_PATH} together with "requires": "${requiresFor(WORKFLOW_ALLOW_KEYS_SINCE)}"; commit it to ${where} and push`;
}

/**
 * The base rules on their own, without the `allowMerge` switch: a pull request may be merged by
 * itself into the integration base or the default branch and no other. The one home of those
 * rules. `merge-check --asked` calls this alone, because the person's yes sets aside the switch
 * (`autoMergeOff`) and nothing else; every other caller goes through `autoMergeRefusal`.
 *
 * `defaultBranch` is the repository's own default branch, as the caller read it.
 */
export function baseRefusal(
  projectConfig: CcSmartDevKitConfig | null,
  prBase: string,
  defaultBranch: string,
): string | null {
  const integration = projectConfig?.worktrees?.base;
  if (prBase === defaultBranch || prBase === integration) return null;
  return integration === undefined
    ? `the pull request's base is ${prBase}, not the repository's default branch ${defaultBranch}`
    : `the pull request's base is ${prBase}, not the project's integration base ${integration} or the repository's default branch ${defaultBranch}`;
}

/**
 * The reason cc-smart-dev-kit may not merge this pull request by itself, in words for the person
 * or the session; null when it may: the switch first, then the base rules. These two are the
 * whole of the conditions: `autoMergeAllowed` is `autoMergeRefusal(…) === null`.
 *
 * `defaultBranch` is the repository's own default branch, as the caller read it.
 */
export function autoMergeRefusal(
  resolved: ResolvedWorkflow,
  projectConfig: CcSmartDevKitConfig | null,
  prBase: string,
  defaultBranch: string,
): string | null {
  // The policy is the one committed on the pull request's own base (`resolveGate`).
  const off = autoMergeOff(resolved, prBase);
  if (off !== null) return off;
  return baseRefusal(projectConfig, prBase, defaultBranch);
}

/**
 * True when cc-smart-dev-kit may merge a pull request whose base is `prBase` by itself.
 * `defaultBranch` is the repository's own default branch (`origin/HEAD`), as the caller read it.
 */
export function autoMergeAllowed(
  resolved: ResolvedWorkflow,
  projectConfig: CcSmartDevKitConfig | null,
  prBase: string,
  defaultBranch: string,
): boolean {
  return autoMergeRefusal(resolved, projectConfig, prBase, defaultBranch) === null;
}
