/**
 * `cc-smart-dev-kit job hook <name>`: the question the kit's git hook script asks (`hook-folder.ts`).
 *
 * It prints one line on stdout and exits 0, always:
 *
 *   direct        run the hook as it is
 *   queue <kind>  run the hook inside `job run --kind <kind>`
 *
 * A broken answer must never stop a commit, so every failure (an unknown name, a project file
 * that cannot be read, a bug) prints `direct`, with one line on stderr when something broke. The
 * script reads only these two forms and treats anything else as `direct` too.
 */

import { COMMAND } from "../build-info";
import { SHORT_GUARD_BUDGET_MS, startBudget } from "../hooks/budget";
import { GUARD_GIT_TIMEOUT_MS } from "../hooks/git";
import { resolveProject, type TimeFor } from "../project/resolve";
import { HOOK_NAMES, hookDecision } from "./git-hooks";
import { type Kinds, mergeKinds } from "./kinds";
import { packageScripts } from "./package-scripts";
import type { JobContext } from "./status";

type Env = Record<string, string | undefined>;

/**
 * The kinds a project's `.claude/cc-smart-dev-kit.json` adds to the defaults, for the project at
 * `cwd`. `env` is the environment git runs with; `timeFor` is a shared budget for its git calls.
 */
export function projectKinds(cwd: string, env: Env = process.env, timeFor?: TimeFor): Kinds {
  return mergeKinds(
    resolveProject(cwd, { env, ...(timeFor !== undefined && { timeFor }) })?.config?.jobs?.kinds,
  );
}

/**
 * What `job hook` prints for hook `name` in the repo at `cwd`. Throws when something breaks
 * (a project file that cannot be read, a git that does not answer in time): `runHookCommand`
 * answers `direct` for it.
 *
 * A hung child would hang the commit, so every git call shares one budget (`src/hooks/budget.ts`,
 * the short guard's 8 s): each takes the smaller of its own limit and the time left, and a call
 * with none left is not made.
 */
export function hookAnswer(name: string | undefined, cwd: string, env: Env = process.env): string {
  // The name comes from the script's own file name; only the names the folder holds are asked.
  if (name === undefined || !HOOK_NAMES.includes(name)) return "direct";
  const budget = startBudget(env, Date.now, SHORT_GUARD_BUDGET_MS);
  const kinds = projectKinds(cwd, env, budget.timeFor);
  const decision = hookDecision(
    name,
    cwd,
    kinds,
    { folder: cwd, scriptsIn: packageScripts },
    env,
    budget.timeFor(GUARD_GIT_TIMEOUT_MS),
  );
  return typeof decision === "object" ? `queue ${decision.queue}` : "direct";
}

/** `job hook <name>`: prints the answer; the exit code is always 0. */
export function runHookCommand(
  args: readonly string[],
  ctx: Pick<JobContext, "cwd" | "print" | "say">,
  env: Env = process.env,
): number {
  try {
    ctx.print(hookAnswer(args[0], ctx.cwd, env));
  } catch (error) {
    ctx.say(
      `${COMMAND}: the git hook queue could not read this project (${error instanceof Error ? error.message : String(error)}); the hook runs as it is`,
    );
    ctx.print("direct");
  }
  return 0;
}
