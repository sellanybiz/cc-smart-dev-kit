import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH, readOwnHooks } from "./config-facts";
import { gitEnv } from "./git-env";

/**
 * Where a git checkout is, and which `cc-smart-dev-kit.json` belongs to it, with no zod. The
 * hook frame and every hook that stays light import this file and `config-facts.ts` directly,
 * never `resolve.ts`: `resolve.ts` imports the parser, and a module that imports the parser
 * pulls zod and the config schemas into its bundle (`docs/design/hooks.md` § What a hook
 * bundle carries). `resolve.ts` re-exports every name here, so its other importers do not change.
 */

/** Where a checkout is: what a hook needs before it reads the file. */
export interface Checkout {
  /** The top folder of the checkout `cwd` is in (a linked worktree's own folder). */
  root: string;
  /** The shared `.git` folder of every worktree of this repo. */
  commonDir: string;
  /** True inside a linked worktree (`git worktree add`), false in the main checkout. */
  isWorktree: boolean;
  /** The main checkout's folder, or null for a bare repo. */
  mainCheckout: string | null;
}

/**
 * What a shared budget gives one call (`Budget.timeFor`, `src/hooks/budget.ts`): the call's own
 * limit, or the time that is left if that is less. Zero or less: no time is left.
 */
export type TimeFor = (limitMs: number) => number;

export interface ResolveOptions {
  /** The plugin version to check `requires` against. Default: this build's version. */
  pluginVersion?: string;
  /** The environment git runs with (PATH finds git). Default: process.env. */
  env?: Record<string, string | undefined>;
  /**
   * A hook's shared budget: each git call takes `timeFor(RESOLVE_GIT_TIMEOUT_MS)`, and a call
   * with no time left is not made (it answers as a failed one). Default: no shared budget.
   */
  timeFor?: TimeFor;
}

/** `rev-parse --path-format` came in git 2.31. */
export const MIN_GIT_VERSION = "2.31.0";

/**
 * What one git call answered. `timedOut`: the call was stopped at its time limit, or never made
 * because its shared budget had none left — git did not answer, which is no answer about the
 * repository (a ref that is not there, a folder that is not in git).
 */
export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

type Git = (args: string[]) => GitResult;

/**
 * Each git call here may take this long. A hook resolves its project first, and a guard's
 * own timeout is 10 s (`.claude/rules/hooks.md` § Timeouts); these calls take milliseconds.
 */
export const RESOLVE_GIT_TIMEOUT_MS = 5_000;

/** What a machine with no git at all is told, instead of the spawner's own words. */
export const GIT_NOT_FOUND =
  "git was not found, so this project's own values cannot be read. Install git, then try again.";

/** A git runner that does not block the caller: `gitInAsync`. */
type GitAsync = (args: string[]) => Promise<GitResult>;

/** What a failed spawn says when there is no git at all, in words a page can act on. */
function gitNotFound(error: unknown): unknown {
  const why = error instanceof Error ? error.message : String(error);
  // No git on this machine's PATH at all — on Windows without Git for Windows, or in a
  // container. The spawner's own words for it (`Executable not found in $PATH: "git"`)
  // reach a portal page, where they read as a crash rather than as a fact to act on. A
  // folder that is gone, or anything else that throws here, is re-thrown as it is.
  return /not found in \$PATH|ENOENT/.test(why) ? new Error(GIT_NOT_FOUND) : error;
}

/** What a caller is told when git did not answer: the reason of a question, never a guess. */
export const GIT_TIMED_OUT = "git did not answer in time";

/** What a person does about it: the one fix every command that prints the error carries. */
export const GIT_TIMED_OUT_FIX =
  "run `git status` in this folder; if that hangs too, fix git first, then run this again";

/**
 * What a checkout lookup throws when git did not answer. A hung git is an error, never "outside
 * git" (RV4-2). The message is one plain line, the reason and its fix, so a command that prints
 * `error.message` (most do, and the CLI's last catch) tells the person what to do; a check that
 * prints its fix on a line of its own (`doctor`) says `GIT_TIMED_OUT` alone.
 */
export class GitTimedOutError extends Error {
  constructor() {
    super(`${GIT_TIMED_OUT}: ${GIT_TIMED_OUT_FIX}`);
    this.name = "GitTimedOutError";
  }
}

/**
 * What went wrong in a checkout lookup, without the fix a timeout's message carries: for a caller
 * that puts the reason inside a sentence or beside a fix of its own (`doctor`'s check, a guard's
 * question), where "run this again" would read wrongly.
 */
export function checkoutFailure(error: unknown): string {
  if (error instanceof GitTimedOutError) return GIT_TIMED_OUT;
  return error instanceof Error ? error.message : String(error);
}

/** What a call answers when its shared budget has no time left: it was never made. */
const NO_TIME_LEFT: GitResult = {
  ok: false,
  stdout: "",
  stderr: "no time left in the hook's budget",
  timedOut: true,
};

/**
 * How long one call may take: `timeoutMs`, or what the shared budget leaves if that is less;
 * zero or less means the call is not made (`Bun.spawn` reads a timeout of 0 as no limit at all).
 */
function callLimit(timeoutMs: number, timeFor: TimeFor | undefined): number {
  return timeFor === undefined ? timeoutMs : timeFor(timeoutMs);
}

/** A git runner for `cwd` that blocks until git answers or the time limit stops it. */
export function gitIn(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number = RESOLVE_GIT_TIMEOUT_MS,
  timeFor?: TimeFor,
): Git {
  return (args) => {
    const limit = callLimit(timeoutMs, timeFor);
    if (limit <= 0) return NO_TIME_LEFT;
    try {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: limit,
        // A hook or a background command may run with no console of its own on Windows.
        windowsHide: true,
      });
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        timedOut: result.exitedDueToTimeout === true,
      };
    } catch (error) {
      throw gitNotFound(error);
    }
  };
}

/**
 * `gitIn` without blocking: the portal lists the person's projects inside its own process,
 * and a blocking spawn there freezes every page and the live stream
 * (`.claude/rules/portal.md`).
 */
export function gitInAsync(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number = RESOLVE_GIT_TIMEOUT_MS,
  timeFor?: TimeFor,
): GitAsync {
  return async (args) => {
    const limit = callLimit(timeoutMs, timeFor);
    if (limit <= 0) return NO_TIME_LEFT;
    try {
      const child = Bun.spawn(["git", ...args], {
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: limit,
        windowsHide: true,
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      // Bun stops a call at its time limit with SIGTERM, and a git that ends otherwise has none.
      return { ok: code === 0, stdout, stderr, timedOut: child.signalCode === "SIGTERM" };
    } catch (error) {
      throw gitNotFound(error);
    }
  };
}

/** Throws when the git `--version` output names one older than MIN_GIT_VERSION. */
function requireGitVersionText(out: string): void {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
  if (!match) return;
  const version = `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
  if (Bun.semver.order(version, MIN_GIT_VERSION) < 0) {
    throw new Error(`git 2.31 or newer is needed; you have git ${version}. Update git.`);
  }
}

/** Throws when git is older than MIN_GIT_VERSION. An unreadable version passes. */
function requireGitVersion(git: Git): void {
  requireGitVersionText(git(["--version"]).stdout);
}

async function requireGitVersionAsync(git: GitAsync): Promise<void> {
  requireGitVersionText((await git(["--version"])).stdout);
}

/**
 * The first `worktree` entry of `git worktree list --porcelain` is the main checkout: the
 * one parse both readers of the list use.
 */
function mainCheckoutFrom(list: GitResult, cwd: string): string | null {
  if (list.timedOut === true) throw new GitTimedOutError();
  if (!list.ok) throw new Error(`git worktree list failed in ${cwd}: ${list.stderr.trim()}`);
  const [firstEntry = ""] = list.stdout.split("\n\n");
  const lines = firstEntry.split("\n");
  if (lines.includes("bare")) return null;
  const pathLine = lines.find((line) => line.startsWith("worktree "));
  if (!pathLine) return null;
  const path = pathLine.slice("worktree ".length);
  if (!existsSync(path) || lines.some((line) => line.startsWith("prunable"))) {
    throw new Error(
      `The main checkout of the repo at ${cwd} is missing: ${path} was moved or deleted. ` +
        'If you moved it, run "git worktree repair" in its new folder.',
    );
  }
  return realpathSync(path);
}

function findMainCheckout(git: Git, cwd: string): string | null {
  return mainCheckoutFrom(git(["worktree", "list", "--porcelain"]), cwd);
}

async function findMainCheckoutAsync(git: GitAsync, cwd: string): Promise<string | null> {
  return mainCheckoutFrom(await git(["worktree", "list", "--porcelain"]), cwd);
}

/** The three paths `rev-parse` printed, or why the answer is no checkout. */
type RevParseParts = { common: string; gitDir: string; top: string };

/**
 * `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir`'s answer, read the same
 * way for the blocking and the awaited runner.
 */
function revParseParts(revParse: {
  ok: boolean;
  stdout: string;
}): RevParseParts | "not-understood" | "outside" {
  const [top, gitDir, common] = revParse.stdout.trim().split("\n");
  // git before 2.31 does not know --path-format: it fails, or prints the option back.
  if (!revParse.ok || top?.startsWith("--")) return "not-understood";
  // A bare repo has no top level: there is no checkout to work in.
  if (!top || !gitDir || !common) return "outside";
  return { common, gitDir, top };
}

/** The checkout's real paths, and whether it is a linked worktree. */
function checkoutRoots(parts: RevParseParts): {
  commonDir: string;
  isWorktree: boolean;
  root: string;
} {
  const root = realpathSync(parts.top);
  const commonDir = realpathSync(parts.common);
  return { commonDir, isWorktree: realpathSync(parts.gitDir) !== commonDir, root };
}

/**
 * Finds the git checkout `cwd` is in, reading no cc-smart-dev-kit.json. Returns null outside git or
 * in a bare repo. Throws when git is older than 2.31, the main checkout is missing, or git did
 * not answer in time (`GitTimedOutError`: a hung git says nothing about the folder).
 * A hook calls it first, then `ownHooksOf`, so a hook the project runs as its own copy stays
 * silent even when the cc-smart-dev-kit.json is broken.
 */
export function locateCheckout(cwd: string, options: ResolveOptions = {}): Checkout | null {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`resolveProject: ${cwd} is not a folder`);
  }
  const git = gitIn(cwd, gitEnv(options.env ?? process.env), undefined, options.timeFor);
  const revParse = git([
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir",
  ]);
  // A git that did not answer says nothing about the folder: not "outside git".
  if (revParse.timedOut === true) throw new GitTimedOutError();
  const parts = revParseParts(revParse);
  if (parts === "not-understood") {
    requireGitVersion(git);
    if (revParse.ok) {
      throw new Error(
        "git did not understand rev-parse --path-format: git 2.31 or newer is needed.",
      );
    }
    return null; // outside git
  }
  if (parts === "outside") return null;

  const roots = checkoutRoots(parts);
  return {
    ...roots,
    mainCheckout: roots.isWorktree ? findMainCheckout(git, cwd) : roots.root,
  };
}

/**
 * `locateCheckout`, without blocking: the same answers, read with `Bun.spawn`. The portal's
 * project list and its merge verdicts run inside the server's own process, where a blocking
 * spawn freezes every page and the live stream (`.claude/rules/portal.md`).
 */
export async function locateCheckoutAsync(
  cwd: string,
  options: ResolveOptions = {},
): Promise<Checkout | null> {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`resolveProject: ${cwd} is not a folder`);
  }
  const git = gitInAsync(cwd, gitEnv(options.env ?? process.env), undefined, options.timeFor);
  const revParse = await git([
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir",
  ]);
  if (revParse.timedOut === true) throw new GitTimedOutError();
  const parts = revParseParts(revParse);
  if (parts === "not-understood") {
    await requireGitVersionAsync(git);
    if (revParse.ok) {
      throw new Error(
        "git did not understand rev-parse --path-format: git 2.31 or newer is needed.",
      );
    }
    return null; // outside git
  }
  if (parts === "outside") return null;

  const roots = checkoutRoots(parts);
  return {
    ...roots,
    mainCheckout: roots.isWorktree ? await findMainCheckoutAsync(git, cwd) : roots.root,
  };
}

/**
 * The project's `cc-smart-dev-kit.json` for a located checkout: its own, else the main
 * checkout's, else null when neither exists. The one home of that choice: `ownHooksOf`,
 * `loadProjectConfig` and the hooks' checked loader all ask it, so they can never read two
 * different files.
 */
export function projectFileFor(checkout: Checkout): string | null {
  const { root, mainCheckout } = checkout;
  const own = join(root, CONFIG_PATH);
  if (existsSync(own)) return own;
  if (mainCheckout === null || mainCheckout === root) return null;
  const main = join(mainCheckout, CONFIG_PATH);
  return existsSync(main) ? main : null;
}

/**
 * The plugin hooks the project runs as its own copy (`ownHooks`), read on their own from the
 * same cc-smart-dev-kit.json `loadProjectConfig` reads. Never throws: empty when there is no file,
 * or it cannot be read.
 */
export function ownHooksOf(checkout: Checkout): string[] {
  const file = projectFileFor(checkout);
  return file === null ? [] : (readOwnHooks(file) ?? []);
}
