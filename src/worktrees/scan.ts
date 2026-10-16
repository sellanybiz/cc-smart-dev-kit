/**
 * Gathering the facts `verdict.ts` judges, removing a finished worktree, and keeping the main
 * checkout on the base branch after a merge. Used by `worktrees` (`command.ts`) and by the
 * plugin's hooks that keep sessions from leaving worktrees behind.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasChanges, isInside, type ListedWorktree, listWorktrees, runGit } from "../hooks/git";
import { localFiles } from "../hooks/local-files";
import type { Env } from "../hooks/run";
import { liveSessions, type SessionRecord } from "../hooks/sessions";
import { idleMinutes } from "../hooks/worktree-leftovers";
import {
  type ContainerMounts,
  containersUsing,
  dockerMounts,
  programsInside,
  type RunningProgram,
  runningPrograms,
} from "./machine-facts";
import { type Verdict, verdict, type WorktreeContents, type WorktreeFacts } from "./verdict";

/**
 * Brings `origin/<base>` up to date, so work merged a minute ago counts as merged. Never asks
 * for credentials (a hook has nobody to answer) and gives up after 30 seconds, so a dead
 * network cannot hold a hook until its own timeout throws its output away.
 */
export function fetchBase(repo: string, base: string, env: Env, timeoutMs = 30_000): boolean {
  return runGit(
    repo,
    ["-c", "credential.interactive=never", "fetch", "origin", base, "--quiet"],
    env,
    timeoutMs,
  ).ok;
}

/**
 * A worktree living inside this one: another listed worktree, or a folder under its
 * `.claude/worktrees/`, where Claude Code makes its own. git's exclude file hides those from
 * `git status`, and removing the outer folder deletes them.
 */
function innerWorktreeOf(worktree: string, all: ListedWorktree[]): null | string {
  const listed = all.find(
    (other) => isInside(other.path, worktree) && !isInside(worktree, other.path),
  );
  if (listed !== undefined) return listed.path;
  const claudeOwn = join(worktree, ".claude", "worktrees");
  let entries: string[];
  try {
    entries = readdirSync(claudeOwn);
  } catch {
    return null;
  }
  // Only a folder that holds something counts: an empty one loses nothing.
  for (const entry of entries) {
    const folder = join(claudeOwn, entry);
    try {
      if (statSync(folder).isDirectory() && readdirSync(folder).length > 0) return folder;
    } catch {
      // Removed between the listing and the look: nothing left to lose.
    }
  }
  return null;
}

/** What removing the worktree would lose. */
function contentsOf(worktree: string, mainCheckout: string, env: Env): WorktreeContents {
  if (hasChanges(worktree, env)) return { localFiles: [], uncommitted: true };
  const ignored = localFiles(worktree, mainCheckout, env);
  if (ignored === null) {
    return { localFiles: ["(git could not list the ignored files)"], uncommitted: false };
  }
  return { localFiles: ignored, uncommitted: false };
}

export interface ScannedWorktree {
  listed: ListedWorktree;
  /** "main" for the main checkout, "gone" for a worktree whose folder no longer exists. */
  state: "gone" | "main" | Verdict;
}

export interface ScanOptions {
  /** The base branch work must be on: `worktrees.base`, or the repo's default branch. */
  base: string;
  env: Env;
  /**
   * 0 lets a session remove the worktree it has just finished in. The default is the hour
   * `verdict.ts` asks for.
   */
  idleLimit?: number;
  /** The session doing the removing: it is not "working in" the worktree it asked to remove. */
  ignoreSession?: string;
  /** The Claude config folder, for the running sessions' records. */
  claudeConfigDir: string;
  now?: number;
  /** A test hands in fakes; the default reads this machine. */
  facts?: {
    containers?: "unknown" | ContainerMounts[];
    programs?: "unknown" | RunningProgram[];
    sessions?: SessionRecord[];
  };
}

/**
 * Every worktree of the repo, judged. Reads `origin/<base>` as it is — fetch first for a
 * fresh answer (`fetchBase`).
 *
 * Throws when `origin/<base>` is not known here: nothing can be judged against it.
 */
export function scanWorktrees(repo: string, options: ScanOptions): ScannedWorktree[] {
  const { base, env } = options;
  if (!runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`], env).ok) {
    throw new Error(`origin/${base} is not known here — run \`git fetch origin ${base}\` first`);
  }
  const sessions = (options.facts?.sessions ?? liveSessions(options.claudeConfigDir)).filter(
    (session) => session.sessionId !== options.ignoreSession,
  );
  const containers = options.facts?.containers ?? dockerMounts();
  const programs = options.facts?.programs ?? runningPrograms();
  const now = options.now ?? Date.now();
  const all = listWorktrees(repo, env);
  const [main, ...others] = all;
  const scanned: ScannedWorktree[] = main === undefined ? [] : [{ listed: main, state: "main" }];

  for (const listed of others) {
    if (listed.locked) {
      // Before "gone": a locked worktree may sit on a drive that is not connected.
      scanned.push({ listed, state: { finished: false, why: "locked with `git worktree lock`" } });
      continue;
    }
    if (listed.prunable || !existsSync(listed.path)) {
      scanned.push({ listed, state: "gone" });
      continue;
    }
    const ahead = runGit(repo, ["rev-list", "--count", `origin/${base}..${listed.head}`], env);
    if (!ahead.ok) {
      scanned.push({
        listed,
        state: { finished: false, why: `git could not compare it with ${base}` },
      });
      continue;
    }
    const session = sessions.find((one) => isInside(one.cwd, listed.path));
    const facts: WorktreeFacts = {
      aheadOfBase: Number(ahead.out),
      base,
      containers: containers === "unknown" ? "unknown" : containersUsing(listed.path, containers),
      idleMinutes: idleMinutes(listed.path, now),
      innerWorktree: innerWorktreeOf(listed.path, all),
      locked: listed.locked,
      programs: programs === "unknown" ? "unknown" : programsInside(programs, listed.path),
      sessionName: session?.name ?? null,
    };
    scanned.push({
      listed,
      state: verdict(facts, () => contentsOf(listed.path, repo, env), options.idleLimit),
    });
  }
  return scanned;
}

export interface Removal {
  /** What happened, one line each. */
  said: string[];
  /**
   * "held": a program still works in the folder or runs from it, so nothing was touched — try
   * again once it has stopped. "kept": something in it is changed or untracked, so nothing was
   * touched — do not try again. "failed": it was moved aside, then git could not finish
   * (`said` names where it is now).
   */
  status: "failed" | "held" | "kept" | "removed";
}

/**
 * Removes a worktree that is finished, then its branch (by `deleteBranch`, which says whether
 * it went). git itself refuses a worktree with modified or untracked files.
 *
 * It MOVES the folder first: a folder a program still uses cannot be renamed on Windows, so
 * the move fails and nothing is touched, where a plain `git worktree remove` would delete
 * files up to the first one in use and then forget the worktree, leaving half a folder nobody
 * tracks. A program running FROM a file inside it does not stop the move, only the delete — so
 * that is checked right before the move, not trusted from an earlier scan. So are changes:
 * git refuses to remove a changed worktree only AFTER the move.
 */
export function removeWorktree(
  repo: string,
  listed: ListedWorktree,
  env: Env,
  base: string,
  deleteBranch: (repo: string, branch: string) => string = (repo_, branch) =>
    deleteMergedBranch(repo_, base, branch, env),
): Removal {
  const programs = runningPrograms();
  const running = programs === "unknown" ? null : programsInside(programs, listed.path);
  if (running === null || running.length > 0) {
    const why =
      running === null
        ? "the running programs could not be listed"
        : running.length === 1
          ? `a program runs from its files: ${running[0] ?? ""}`
          : `programs run from its files: ${running.join(", ")}`;
    return { said: [`kept ${listed.path}: ${why}`], status: "held" };
  }
  if (hasChanges(listed.path, env)) {
    return {
      said: [`kept ${listed.path}: something in it is changed or untracked`],
      status: "kept",
    };
  }
  const parked = `${listed.path}-removing-${String(Date.now())}`;
  const moved = runGit(repo, ["worktree", "move", listed.path, parked], env);
  if (!moved.ok) {
    return {
      said: [
        `kept ${listed.path}: a program may still work in it — a terminal, a background command, ` +
          `or an MCP server restarted while a session was in it (${moved.err})`,
      ],
      status: "held",
    };
  }
  const removed = runGit(repo, ["worktree", "remove", parked], env);
  if (!removed.ok) {
    return {
      said: [`moved ${listed.path} to ${parked}, then could not remove it: ${removed.err}`],
      status: "failed",
    };
  }
  const said = [`removed ${listed.path}`];
  if (listed.branch !== null) said.push(deleteBranch(repo, listed.branch));
  return { said, status: "removed" };
}

/** The commits on a branch that no other branch, local or remote, has. Null when git cannot tell. */
export function ownCommits(repo: string, branch: string, env: Env): null | number {
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

/**
 * Deletes a branch when every commit on it is also on another branch, so nothing is lost. A
 * subagent's branch is cut from whatever its session had checked out, which may not be on the
 * base yet — `deleteMergedBranch` would keep every one of those.
 */
export function deleteCopiedBranch(repo: string, branch: string, env: Env): string {
  const own = ownCommits(repo, branch, env);
  if (own === null) {
    return `kept branch ${branch}: git could not compare it with the other branches`;
  }
  if (own > 0) return `kept branch ${branch}: it has commits no other branch has`;
  const deleted = runGit(repo, ["branch", "-D", branch], env);
  return deleted.ok ? `deleted branch ${branch}` : `kept branch ${branch}: ${deleted.err}`;
}

/**
 * Deletes a branch only when `origin/<base>` holds every commit on it, so nothing on it is
 * lost. git refuses while a worktree — even one whose folder is gone and not yet pruned —
 * still has it checked out.
 */
export function deleteMergedBranch(repo: string, base: string, branch: string, env: Env): string {
  const ahead = runGit(repo, ["rev-list", "--count", `origin/${base}..refs/heads/${branch}`], env);
  if (!ahead.ok) {
    return `kept branch ${branch}: ${ahead.err || `git could not compare it with ${base}`}`;
  }
  if (ahead.out !== "0") return `kept branch ${branch}: it has commits that are not on ${base}`;
  const deleted = runGit(repo, ["branch", "-D", branch], env);
  return deleted.ok ? `deleted branch ${branch}` : `kept branch ${branch}: ${deleted.err}`;
}

/** Forgets worktrees whose folder is gone. */
export function pruneWorktrees(repo: string, env: Env): void {
  runGit(repo, ["worktree", "prune"], env);
}
