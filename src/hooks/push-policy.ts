/**
 * What the git guard reads to decide whether a push asks the person (D15): `autoPush`, as the
 * merge guard reads its gate. The value is the built-in default, the person's own
 * `workflow.json`, and the project's file **as committed on `origin/<worktrees.base>`**
 * (`resolveGate`), never this checkout's working copy: a session can edit its own worktree's
 * file, so it cannot switch the question off there. A project that names no `worktrees.base`
 * has no committed file to read, and only the default and the person's own file count.
 *
 * A policy that cannot be read (no `origin/<base>`, a committed file that is broken or needs a
 * newer plugin, a personal file that is broken) is a question with its reason, never a guess.
 * The read costs a few git calls, so it runs only for a line that really pushes
 * (`PushRules.autoPushAsk` is a function).
 */
import { COMMAND } from "../build-info/names";
import { autoPushOff } from "../workflow/pr-switches";
import { resolveGate } from "../workflow/resolve";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import type { HookContext } from "./run";

/** The question an `autoPush`-off push puts to the person, or null when `autoPush` is on. */
export function autoPushQuestion(context: HookContext): string | null {
  const { env, paths, project } = context;
  const base = project.config?.worktrees?.base ?? null;
  try {
    const read = resolveGate(paths, project, base, { env, timeoutMs: GUARD_GIT_TIMEOUT_MS });
    if (!read.ok) {
      return `${COMMAND} cannot tell whether this push is allowed: the push policy committed on ${base} cannot be read (${read.why}); a policy counts once it is committed, pushed and fetched. Approve the push yourself if it is right.`;
    }
    const off = autoPushOff(read.gate.resolved, base);
    return off === null
      ? null
      : `This push leaves the machine, and ${off}. Approve it yourself if you meant it.`;
  } catch (error) {
    // The person's own workflow file is broken (`WorkflowConfigError`): autoPush is unknown.
    const why = error instanceof Error ? error.message : String(error);
    return `${COMMAND} cannot tell whether this push is allowed: the workflow settings cannot be read (${why}). Approve the push yourself if it is right.`;
  }
}
