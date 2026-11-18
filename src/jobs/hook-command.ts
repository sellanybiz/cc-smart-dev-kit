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
import { resolveProject } from "../project/resolve";
import { HOOK_NAMES, hookDecision } from "./git-hooks";
import { type Kinds, mergeKinds } from "./kinds";
import { packageScripts } from "./package-scripts";
import type { JobContext } from "./status";

/** The kinds a project's `.claude/cc-smart-dev-kit.json` adds to the defaults, for the project at `cwd`. */
export function projectKinds(cwd: string): Kinds {
  return mergeKinds(resolveProject(cwd)?.config?.jobs?.kinds);
}

/**
 * What `job hook` prints for hook `name` in the repo at `cwd`. Throws when something breaks
 * (a project file that cannot be read): `runHookCommand` answers `direct` for it.
 */
export function hookAnswer(
  name: string | undefined,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): string {
  // The name comes from the script's own file name; only the names the folder holds are asked.
  if (name === undefined || !HOOK_NAMES.includes(name)) return "direct";
  const decision = hookDecision(
    name,
    cwd,
    projectKinds(cwd),
    { folder: cwd, scriptsIn: packageScripts },
    env,
  );
  return typeof decision === "object" ? `queue ${decision.queue}` : "direct";
}

/** `job hook <name>`: prints the answer; the exit code is always 0. */
export function runHookCommand(
  args: readonly string[],
  ctx: Pick<JobContext, "cwd" | "print" | "say">,
): number {
  try {
    ctx.print(hookAnswer(args[0], ctx.cwd));
  } catch (error) {
    ctx.say(
      `${COMMAND}: the git hook queue could not read this project (${error instanceof Error ? error.message : String(error)}); the hook runs as it is`,
    );
    ctx.print("direct");
  }
  return 0;
}
