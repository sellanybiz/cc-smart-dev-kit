/**
 * Which git hook a commit or a push really runs, and whether it is heavy: the decision behind
 * the kit's git hooks folder (`hook-folder.ts`).
 *
 * A routed `git commit` or `git push` points git at the kit's folder for that one command. The
 * script there (the same for every hook name) asks `cc-smart-dev-kit job hook <name>`, which
 * answers from this file: `direct` (run the person's own hook as it is), or `queue <kind>` (run
 * it inside `job run`, so it waits for a heavy slot like any other heavy command).
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GUARD_GIT_TIMEOUT_MS, runGit } from "../hooks/git";
import { classifyHeavyCommand, type ScriptSource } from "./classify";
import type { Kinds } from "./kinds";

/**
 * The hook names the kit's folder holds a script for: every client-side hook in `git help
 * githooks`, plus `pre-receive`, `update`, `post-receive` and `post-update`, which git runs on
 * a server and the script passes straight through.
 *
 * Never `push-to-checkout` and never `proc-receive`: git changes what it does when one of them
 * exists (a push to a checked-out branch is refused until `push-to-checkout` is there, and
 * `proc-receive` takes over a push's reference updates), so a script under those names would
 * change a command for every repo that has no such hook.
 *
 * The one list: the folder's writer and `doctor` read it here.
 */
export const HOOK_NAMES: readonly string[] = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "post-receive",
  "post-update",
  "reference-transaction",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
];

/** What the kit does with one hook: run it as it is, run it inside a queue slot, or nothing. */
export type HookDecision = "direct" | "none" | { queue: string };

/**
 * A hook larger than this runs direct, unread. A hook that runs tests is a few lines; a file
 * this size is a program, and reading it as a shell line would prove nothing.
 */
export const MAX_HOOK_BYTES = 256 * 1024;

/** Git's own answer to "where do hooks live", asked with the kit's override switched off. */
const HOOKS_PATH_ARGS = ["rev-parse", "--path-format=absolute", "--git-path", "hooks"];

/**
 * The hooks folder git itself would use in `cwd`: the repo's own `core.hooksPath` (a relative
 * one is read from the work tree's root), else `<git dir>/hooks`. `GIT_CONFIG_COUNT=0` throws
 * away the `GIT_CONFIG_*` pairs a routed command sets, so the answer is the person's folder and
 * never the kit's. Null when git cannot say (not a repo, no git, slower than `timeoutMs`, or
 * no time left: zero or less asks git nothing): the caller treats that as "no hook".
 */
export function realHooksFolder(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  timeoutMs: number = GUARD_GIT_TIMEOUT_MS,
): string | null {
  if (timeoutMs <= 0) return null;
  const run = runGit(cwd, HOOKS_PATH_ARGS, env, timeoutMs, { GIT_CONFIG_COUNT: "0" });
  return run.ok && run.out !== "" ? run.out : null;
}

/** True when `folder` is husky v9's generated stub folder (`<repo>/.husky/_`). */
function isHuskyStubFolder(folder: string): boolean {
  return basename(folder) === "_" && basename(dirname(folder)) === ".husky";
}

/** True when `file` is a regular file (what git runs as a hook). */
function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The text of a hook, or null when it is not text the classifier can read: it cannot be read,
 * it is larger than `MAX_HOOK_BYTES`, or it holds a NUL byte (a compiled program).
 */
function hookText(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const size = statSync(file).size;
    if (size > MAX_HOOK_BYTES) return null;
    const buffer = Buffer.alloc(size);
    const read = readSync(fd, buffer, 0, size, 0);
    const bytes = buffer.subarray(0, read);
    return bytes.includes(0) ? null : bytes.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * What the kit does with hook `name` in the repo at `cwd`.
 *
 * - `none`: there is no hook, so there is nothing to run (and for husky v9, whose stub folder
 *   holds a stub for every name, no `.husky/<name>` behind the stub).
 * - `{ queue: kind }`: the hook's text runs a heavy command. Read **any-heavy**: one heavy
 *   command anywhere in it is enough, because nothing is hidden (the git line stays visible
 *   to the person's own rules). A package script in it is followed into its body through
 *   `source`, so `bun run typecheck` reads as `tsc --noEmit`.
 * - `direct`: anything else, a hook it cannot read included: a broken guess never blocks a
 *   commit, it only skips the queue.
 *
 * For husky v9 the executable file git runs is the stub in `.husky/_/`, and the person's
 * commands are in `.husky/<name>`, so that is the file read.
 */
export function hookDecision(
  name: string,
  cwd: string,
  kinds: Kinds,
  source: ScriptSource,
  env: Record<string, string | undefined> = process.env,
  gitTimeoutMs: number = GUARD_GIT_TIMEOUT_MS,
): HookDecision {
  const folder = realHooksFolder(cwd, env, gitTimeoutMs);
  if (folder === null || !isFile(join(folder, name))) return "none";
  const file = isHuskyStubFolder(folder) ? join(dirname(folder), name) : join(folder, name);
  if (!isFile(file)) return "none";
  const text = hookText(file);
  if (text === null) return "direct";
  const kind = classifyHeavyCommand(text, kinds, source);
  return kind === null ? "direct" : { queue: kind };
}
