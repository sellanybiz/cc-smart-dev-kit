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
import { basename, dirname, join, resolve } from "node:path";
import { GIT_TIMED_OUT, GUARD_GIT_TIMEOUT_MS, runGit } from "../hooks/git";
import { classifyUnqueuedHeavy, type ScriptsOf } from "./classify";
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

/** What `realHooksFolder` answers when git did not answer in time, or had no time left. */
export const TIMED_OUT = "timed-out";

/**
 * What the kit does with one hook: run it as it is, run it inside a queue slot, or nothing.
 * `timed-out`: git did not say where the hooks are, so nothing is known about this hook; the
 * command answers `direct` and says why.
 */
export type HookDecision = "direct" | "none" | "timed-out" | { queue: string };

/**
 * A hook larger than this runs direct, unread. A hook that runs tests is a few lines; a file
 * this size is a program, and reading it as a shell line would prove nothing.
 */
export const MAX_HOOK_BYTES = 256 * 1024;

/**
 * Git's own answer to "where do hooks live, and where does a hook run", asked with the kit's
 * override switched off: the hooks folder, then (when there is a work tree) the way up to its
 * top and `true`, or just `false` where there is none (a bare repo, the `.git` folder).
 * `--show-cdup` and `--is-inside-work-tree` stand in for `--show-toplevel`, which stops git
 * with an error where there is no work tree, and would take the hooks folder's answer with it.
 */
const HOOKS_PATH_ARGS = [
  "rev-parse",
  "--path-format=absolute",
  "--git-path",
  "hooks",
  "--show-cdup",
  "--is-inside-work-tree",
];

/** Where git looks for hooks in a folder, and the folder it runs them in. */
export interface HooksPlace {
  /** The hooks folder git itself would use. */
  folder: string;
  /** The top of the work tree, where git runs a hook; the asking folder when there is none. */
  top: string;
}

/**
 * The hooks folder git itself would use in `cwd`: the repo's own `core.hooksPath` (a relative
 * one is read from the work tree's root), else `<git dir>/hooks`; and the folder git runs a
 * hook in, the top of the work tree (`cwd` itself where the repo has none). `GIT_CONFIG_COUNT=0`
 * throws away the `GIT_CONFIG_*` pairs a routed command sets, so the answer is the person's
 * folder and never the kit's. Null when git cannot say (not a repo, no git): the caller treats
 * that as "no hook". `TIMED_OUT` when git did not answer in `timeoutMs`, or no time is left
 * (zero or less asks git nothing): that says nothing about the repo, and the caller says so.
 */
export function hooksPlace(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  timeoutMs: number = GUARD_GIT_TIMEOUT_MS,
): HooksPlace | null | typeof TIMED_OUT {
  if (timeoutMs <= 0) return TIMED_OUT;
  const run = runGit(cwd, HOOKS_PATH_ARGS, env, timeoutMs, { GIT_CONFIG_COUNT: "0" });
  // No exit code and `GIT_TIMED_OUT`: the timeout stopped git.
  if (run.code === null && run.err === GIT_TIMED_OUT) return TIMED_OUT;
  if (!run.ok) return null;
  // Lines: the hooks folder; the way up (empty at the top, and then a blank line); `true` or
  // `false`. A path may hold a space, never a line break.
  const lines = run.out.split("\n");
  const folder = lines[0];
  if (folder === undefined || folder === "") return null;
  const inside = lines.at(-1) === "true";
  return { folder, top: inside ? resolve(cwd, lines[1] ?? "") : cwd };
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
 *   `scriptsIn`, so `bun run typecheck` reads as `tsc --noEmit`. Git runs a hook at the top
 *   of the work tree, so the scripts are the top's, whichever folder `cwd` is (the route and
 *   `job hook` ask from different folders and must get one answer).
 * - `timed-out`: git did not answer within `gitTimeoutMs` (or no time was left), so it never
 *   asked: no answer about the hook, which is not the same as no hook.
 * - `direct`: anything else, a hook it cannot read included: a broken guess never blocks a
 *   commit, it only skips the queue. A hook that already runs `job run` (itself, or through a
 *   script's body) is one too: it is queued already, and `job run --hook` around it would nest.
 *
 * For husky v9 the executable file git runs is the stub in `.husky/_/`, and the person's
 * commands are in `.husky/<name>`, so that is the file read.
 */
export function hookDecision(
  name: string,
  cwd: string,
  kinds: Kinds,
  scriptsIn: ScriptsOf,
  env: Record<string, string | undefined> = process.env,
  gitTimeoutMs: number = GUARD_GIT_TIMEOUT_MS,
): HookDecision {
  const place = hooksPlace(cwd, env, gitTimeoutMs);
  if (place === TIMED_OUT) return "timed-out";
  if (place === null) return "none";
  const { folder, top } = place;
  if (!isFile(join(folder, name))) return "none";
  const file = isHuskyStubFolder(folder) ? join(dirname(folder), name) : join(folder, name);
  if (!isFile(file)) return "none";
  const text = hookText(file);
  if (text === null) return "direct";
  const kind = classifyUnqueuedHeavy(text, kinds, { folder: top, scriptsIn });
  return kind === null ? "direct" : { queue: kind };
}
