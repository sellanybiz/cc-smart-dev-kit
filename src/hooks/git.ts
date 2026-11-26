/**
 * The git the hooks need: run a command with a timeout, list the worktrees, compare folders,
 * and ask whether anything would be lost.
 */
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isInside } from "../path-compare";
import { gitEnv } from "../project/git-env";
import { COMMIT_SHA } from "../workflow/reviews";
import type { Env } from "./run";

// The path tests live in their one home, `src/path-compare.ts`; the hooks have always imported
// them from here, so this file hands them on rather than every hook changing its import.
export { IGNORE_CASE, isInside, samePath } from "../path-compare";

/** What `GitRun.err` says when the timeout stopped git. */
export const GIT_TIMED_OUT = "timed out";

export interface GitRun {
  ok: boolean;
  /** stdout, trimmed. */
  out: string;
  /** stderr, trimmed; `GIT_TIMED_OUT` when the timeout stopped it. */
  err: string;
  /** git's exit code; null when it did not exit on its own (a timeout, or it never started). */
  code: number | null;
}

/**
 * How long one git call inside a PreToolUse guard may take. The guard hook's own timeout is
 * 10 s (`plugin/hooks/hooks.json`), so every git call it makes has to answer well inside
 * that: a guard that hangs stops the call it guards.
 */
export const GUARD_GIT_TIMEOUT_MS = 5_000;

/**
 * A git command in `cwd`, without the GIT_* variables that point at another repo. `own` is set
 * after those are dropped: the variables this one call needs on purpose (a temporary object
 * folder, `src/workflow/review-cover.ts`), never ones inherited from outside. `input` is the
 * text git reads on stdin, as UTF-8 bytes exactly (`hash-object --stdin`, `mktree`); without it
 * git reads nothing.
 */
export function runGit(
  cwd: string,
  args: string[],
  env: Env,
  timeoutMs = 15_000,
  own: Record<string, string> = {},
  input?: string,
): GitRun {
  return spawnGit(cwd, args, env, timeoutMs, own, true, input);
}

/**
 * `runGit`, with stdout exactly as git wrote it. For `-z` output, where a name may start or
 * end with a space: trimming would cut it off the first or the last name.
 */
export function runGitRaw(
  cwd: string,
  args: string[],
  env: Env,
  timeoutMs = 15_000,
  own: Record<string, string> = {},
): GitRun {
  return spawnGit(cwd, args, env, timeoutMs, own, false);
}

/** Paths per git call, so a long list stays far below the system's argument limit. */
const PATHS_PER_GIT_CALL = 200;

/** `paths` cut into the lists one git call each names, `PATHS_PER_GIT_CALL` at most; none for none. */
export function pathBatches(paths: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let at = 0; at < paths.length; at += PATHS_PER_GIT_CALL) {
    batches.push(paths.slice(at, at + PATHS_PER_GIT_CALL));
  }
  return batches;
}

function spawnGit(
  cwd: string,
  args: string[],
  env: Env,
  timeoutMs: number,
  own: Record<string, string>,
  trim: boolean,
  input?: string,
): GitRun {
  const bytes = input === undefined ? undefined : new TextEncoder().encode(input);
  const run = spawnGitBytes(cwd, args, env, timeoutMs, own, bytes);
  // `ignoreBOM`: a byte order mark git wrote stays in the text, as a file's own first character.
  const out = new TextDecoder("utf-8", { ignoreBOM: true }).decode(run.out);
  return { ...run, out: trim ? out.trim() : out };
}

/** What `runGitBytes` answers: a `GitRun` whose stdout is the bytes git wrote. */
export interface GitBytesRun extends Omit<GitRun, "out"> {
  out: Uint8Array;
}

/**
 * `runGit` in bytes both ways: `input` and stdout exactly as git reads and writes them, never
 * decoded. For a tree listing (`ls-tree -z`, `mktree -z`), whose names are any bytes: a UTF-8
 * round trip renames one that is not UTF-8.
 */
export function runGitBytes(
  cwd: string,
  args: string[],
  env: Env,
  timeoutMs = 15_000,
  input?: Uint8Array,
): GitBytesRun {
  return spawnGitBytes(cwd, args, env, timeoutMs, {}, input);
}

/** The one blocking spawn of git: bytes in, bytes out. */
function spawnGitBytes(
  cwd: string,
  args: string[],
  env: Env,
  timeoutMs: number,
  own: Record<string, string>,
  input?: Uint8Array,
): GitBytesRun {
  try {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...gitEnv(env), ...own },
      stdin: input ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      // A guard runs with no console of its own on Windows: without this, git opens one.
      windowsHide: true,
    });
    const err = result.signalCode ? GIT_TIMED_OUT : result.stderr.toString().trim();
    const code = result.signalCode ? null : result.exitCode;
    return { ok: result.exitCode === 0, out: result.stdout, err, code };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { ok: false, out: new Uint8Array(), err, code: null };
  }
}

/**
 * `runGit`, without blocking the caller: the same arguments, environment, timeout and result,
 * spawned with `Bun.spawn`. The portal runs the merge check inside its own process, and a
 * blocking spawn there freezes every page and the live stream (`.claude/rules/portal.md`);
 * a hook or a command with a process of its own keeps `runGit`.
 */
export async function runGitAsync(
  cwd: string,
  args: string[],
  env: Env,
  timeoutMs = 15_000,
  own: Record<string, string> = {},
): Promise<GitRun> {
  try {
    const child = Bun.spawn(["git", ...args], {
      cwd,
      env: { ...gitEnv(env), ...own },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      // A child with no console of its own on Windows: without this, git opens one.
      windowsHide: true,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    // `exited` gives the code the process ended with; the signal is known once it has.
    const signaled = child.signalCode !== null && child.signalCode !== undefined;
    return {
      ok: code === 0,
      out: stdout.trim(),
      err: signaled ? GIT_TIMED_OUT : stderr.trim(),
      code: signaled ? null : code,
    };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { ok: false, out: "", err, code: null };
  }
}

/**
 * The arguments of the call that asks which commit `rev` names; `commitIn` reads its answer.
 * Each caller runs it its own way (sync or async, with its own time limit). The `^{commit}`
 * suffix keeps a stored name that starts with `-` from working as an option: git answers it as
 * no commit (exit 1), so no caller needs its own dash test. `--end-of-options` would say the
 * same, but `rev-parse` takes it only from git 2.30, and these lookups run on any git.
 */
export function commitArgs(rev: string): string[] {
  return ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`];
}

/** The full commit id a `commitArgs` call answered, or null when git named none. */
export function commitIn(run: GitRun): string | null {
  return run.ok && COMMIT_SHA.test(run.out) ? run.out : null;
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
  /** Why it is locked, when the lock says (`git worktree lock --reason`); absent for a bare lock. */
  lockReason?: string;
  /** git found its folder gone. */
  prunable: boolean;
  /** A bare repo's own entry: no folder of files, no HEAD and no branch. Absent otherwise. */
  bare?: true;
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
    const lockReason = value("locked")?.trim();
    worktrees.push({
      path,
      head: value("HEAD") ?? "",
      branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
      locked: flag("locked"),
      ...(lockReason === undefined || lockReason === "" ? {} : { lockReason }),
      prunable: flag("prunable"),
      ...(flag("bare") ? { bare: true } : {}),
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

/**
 * The worktree's own folder in the main repository's `.git/worktrees/`, read from the `.git`
 * file the worktree holds (`gitdir: <path>`, absolute or relative to the worktree). The one
 * reader for every part that looks at a worktree's bookkeeping. Null when the `.git` entry
 * cannot be read as a file or does not say `gitdir:` — a main checkout (its `.git` is a
 * folder), a gone folder, a broken file. Whether the folder it names exists is for the caller.
 */
export function worktreeAdminDir(worktree: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(worktree, ".git"), "utf8");
  } catch {
    return null;
  }
  const target = /^gitdir:\s*(.+)$/.exec(text.trim())?.[1]?.trim();
  return target === undefined || target === "" ? null : resolve(worktree, target);
}

/** Git's own header of a reflog entry: both ids, the committer, then epoch seconds and zone. */
const REFLOG_HEADER = /^[a-f0-9]+ [a-f0-9]+ .*<[^<>]*> (\d+) [+-]\d{4}$/;

/**
 * The time of one reflog line (`<old> <new> <name> <email> <epoch> <zone>`, then a tab and the
 * message when there is one: git writes an entry with no message for a new worktree) in
 * milliseconds, or null when the header does not have exactly that form: a half-written
 * entry, a line from another tool. The one reader of the entry's time, for the last entry
 * (how long a worktree has been idle) and the first (when it was set up).
 */
export function reflogEntryTime(line: string): number | null {
  const tab = line.indexOf("\t");
  const epoch = REFLOG_HEADER.exec(tab < 0 ? line : line.slice(0, tab))?.[1];
  if (epoch === undefined) return null;
  const time = Number(epoch) * 1000;
  return Number.isFinite(time) ? time : null;
}
