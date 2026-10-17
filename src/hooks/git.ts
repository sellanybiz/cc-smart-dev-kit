/**
 * The git the hooks need: run a command with a timeout, list the worktrees, compare folders,
 * and ask whether anything would be lost.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isInside } from "../path-compare";
import { gitEnv } from "../project/git-env";
import { BATCH_SSH_COMMAND, hasOwnSshCommand } from "../setup/marketplace-access";
import type { Env } from "./run";

// The path tests live in their one home, `src/path-compare.ts`; the hooks have always imported
// them from here, so this file hands them on rather than every hook changing its import.
export { IGNORE_CASE, isInside, samePath } from "../path-compare";

export interface GitRun {
  ok: boolean;
  /** stdout, trimmed. */
  out: string;
  /** stderr, trimmed; "timed out" when the timeout stopped it. */
  err: string;
}

/**
 * How long one git call inside a PreToolUse guard may take. The guard hook's own timeout is
 * 10 s (`plugin/hooks/hooks.json`, `project-wiring.ts`), so every git call it makes has to
 * answer well inside that: a guard that hangs stops the call it guards.
 */
export const GUARD_GIT_TIMEOUT_MS = 5_000;

/** A git command in `cwd`, without the GIT_* variables that point at another repo. */
export function runGit(cwd: string, args: string[], env: Env, timeoutMs = 15_000): GitRun {
  try {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: gitEnv(env),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    const err = result.signalCode ? "timed out" : result.stderr.toString().trim();
    return { ok: result.exitCode === 0, out: result.stdout.toString().trim(), err };
  } catch (error) {
    return { ok: false, out: "", err: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The environment for a git command that reaches the network: it never asks for a password
 * (GIT_TERMINAL_PROMPT=0), and ssh gets BatchMode unless the user has an ssh command of
 * their own (which would then be hidden).
 */
export function noPromptEnv(env: Env): Env {
  const quiet: Env = { ...env, GIT_TERMINAL_PROMPT: "0" };
  if (!hasOwnSshCommand(quiet)) quiet.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  return quiet;
}

/**
 * `path` with every link on the way to it resolved: the real path of its deepest folder that
 * exists, then the part that does not exist yet (the file an edit is about may not exist).
 * Two paths are the same place only as real paths: macOS puts the temp folder behind a link,
 * and a checkout can be reached through one.
 */
export function realPath(path: string): string {
  const rest: string[] = [];
  let at = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(at), ...rest);
    } catch {
      const parent = dirname(at);
      if (parent === at) return resolve(path);
      rest.unshift(basename(at));
      at = parent;
    }
  }
}

/** One entry of `git worktree list --porcelain`. The first one is the main checkout. */
export interface ListedWorktree {
  path: string;
  head: string;
  /** Without `refs/heads/`; null on a detached commit. */
  branch: string | null;
  locked: boolean;
  /** git found its folder gone. */
  prunable: boolean;
}

export function parseWorktreeList(porcelain: string): ListedWorktree[] {
  const worktrees: ListedWorktree[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line !== "");
    const value = (key: string) =>
      lines.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1);
    const flag = (key: string) => lines.some((line) => line === key || line.startsWith(`${key} `));
    const path = value("worktree");
    if (path === undefined) continue;
    worktrees.push({
      path,
      head: value("HEAD") ?? "",
      branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
      locked: flag("locked"),
      prunable: flag("prunable"),
    });
  }
  return worktrees;
}

/**
 * Every worktree of the repo `cwd` is in; the first one is the main checkout. `timeoutMs`:
 * a PreToolUse guard has 10 s of its own, so it asks for a short one (`.claude/rules/hooks.md`
 * § Timeouts).
 */
export function listWorktrees(cwd: string, env: Env, timeoutMs = 15_000): ListedWorktree[] {
  const listed = runGit(cwd, ["worktree", "list", "--porcelain"], env, timeoutMs);
  if (!listed.ok) throw new Error(`git worktree list failed: ${listed.err}`);
  return parseWorktreeList(listed.out);
}

/**
 * The worktree a path belongs to: the deepest listed one that holds it (a worktree can sit
 * inside another one, under `.claude/worktrees/`).
 */
export function innermostWorktree(path: string, worktrees: string[]): string | null {
  let deepest: string | null = null;
  for (const worktree of worktrees) {
    if (isInside(path, worktree) && (deepest === null || worktree.length > deepest.length)) {
      deepest = worktree;
    }
  }
  return deepest;
}

/**
 * True when the folder has changed or untracked files, or git cannot say (no proof of a
 * clean tree). `--no-optional-locks`: `git status` must not rewrite the index.
 * `--untracked-files=all` overrides a `status.showUntrackedFiles=no` setting.
 */
export function hasChanges(folder: string, env: Env): boolean {
  const status = runGit(
    folder,
    ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"],
    env,
  );
  return !status.ok || status.out !== "";
}

/** The commits on a branch that no other branch, local or remote, has. Null when git cannot tell. */
export function ownCommits(repo: string, branch: string, env: Env): number | null {
  const own = runGit(
    repo,
    [
      "rev-list",
      "--count",
      `refs/heads/${branch}`,
      "--not",
      `--exclude=${branch}`,
      "--branches",
      "--remotes",
    ],
    env,
  );
  return own.ok && /^\d+$/.test(own.out) ? Number(own.out) : null;
}

/** True when `ref` names something in the repo. */
export function hasRef(repo: string, ref: string, env: Env): boolean {
  return runGit(repo, ["rev-parse", "--verify", "--quiet", ref], env).ok;
}
