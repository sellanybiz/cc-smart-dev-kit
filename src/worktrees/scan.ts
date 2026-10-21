/**
 * Gathering the facts `verdict.ts` judges, removing a finished worktree, and keeping the main
 * checkout on the base branch after a merge. Used by `worktrees` (`command.ts`); the note that
 * keeps sessions from leaving worktrees behind judges through
 * `hooks/worktree-leftovers.ts`, which names the questions again in its own words and says
 * there why it leaves the machine's facts out.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import {
  GUARD_GIT_TIMEOUT_MS,
  hasChanges,
  isInside,
  type ListedWorktree,
  listWorktrees,
  realPath,
  runGit,
  samePath,
} from "../hooks/git";
import { localFiles } from "../hooks/local-files";
import type { Env } from "../hooks/run";
import { liveSessions, type SessionRecord } from "../hooks/sessions";
import { idleMinutes } from "../hooks/worktree-leftovers";
import { parseGitVersion } from "../workflow/review-cover";
import { COMMIT_SHA } from "../workflow/reviews";
import {
  type ContainerMounts,
  containersUsing,
  dockerMounts,
  programsInside,
  type RunningProgram,
  runningPrograms,
} from "./machine-facts";
import {
  type MergedBy,
  MIN_MERGE_TREE_GIT,
  type Verdict,
  verdict,
  type WorktreeContents,
  type WorktreeFacts,
} from "./verdict";

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

/** How long a `gh` call may take: the same 10 s the guards give one read-only call. */
const GH_TIMEOUT_MS = 10_000;

/**
 * Is every commit on this worktree on `origin/<base>` under another sha? `git cherry` says so
 * with a `-` for each commit whose change is already there: what a rebase merge or a
 * cherry-pick leaves, where the base holds the same change as a commit of its own. False when
 * git cannot compare them, and when the range is empty (that is no evidence of a merge).
 */
export function cherryOnBase(repo: string, base: string, head: string, env: Env): boolean {
  const run = runGit(repo, ["cherry", `origin/${base}`, head], env);
  if (!run.ok) return false;
  const lines = run.out.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 && lines.every((line) => line.startsWith("-"));
}

/**
 * Is this branch's pull request merged, and is the branch's head the commit that pull request
 * merged? A merged pull request says its own commits are on the base; a branch with commits
 * after it says something else — work nobody merged, which a removal would lose. So the head
 * is compared too, and only a pull request that merged exactly this head proves anything.
 *
 * False whenever `gh` is not there, is not logged in, or gives no answer — this is evidence of
 * a merge, and its absence proves nothing either way.
 */
export function pullRequestMerged(repo: string, branch: string, head: string, env: Env): boolean {
  try {
    if (Bun.which("gh", { PATH: env.PATH ?? "" }) === null) return false;
    const run = Bun.spawnSync(
      [
        "gh",
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "merged",
        "--json",
        "number,headRefOid",
        "--limit",
        "1",
      ],
      { cwd: repo, env, stdin: "ignore", stderr: "pipe", stdout: "pipe", timeout: GH_TIMEOUT_MS },
    );
    const parsed: unknown = JSON.parse(run.stdout.toString() || "null");
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const first = parsed[0] as { headRefOid?: unknown };
    return typeof first.headRefOid === "string" && first.headRefOid === head;
  } catch {
    // No gh on PATH, a call that timed out, or an answer that is not JSON: not known merged.
    return false;
  }
}

/** What merging a branch into the base would change. */
export type Replay = "changes" | "nothing" | "unknown";

/**
 * A folder for the objects a git call writes, and the variables that keep them out of the
 * repository: `git merge-tree --write-tree` writes the trees and blobs it makes, and they
 * have no business in the checkout. The repository's own objects are read through
 * `GIT_ALTERNATE_OBJECT_DIRECTORIES` instead. Null when git cannot say where its objects are.
 */
function objectFolder(repo: string, env: Env): { dir: string; own: Record<string, string> } | null {
  const common = runGit(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], env);
  if (!common.ok || common.out === "") return null;
  const dir = mkdtempSync(join(tmpdir(), `${COMMAND}-worktrees-`));
  const objects = join(common.out, "objects");
  return {
    dir,
    own: {
      GIT_OBJECT_DIRECTORY: dir,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: `"${objects.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    },
  };
}

/**
 * Does merging this branch into the base change anything?
 *
 * A squash or a rebase merge puts the work on the base as a commit of its own: the branch's
 * own commits are not there, and `git cherry` finds no equivalent of them either (a squash
 * carries the release notes with it). Merging the branch into the base is the other way to
 * see it: when the base already holds the change, the merge gives the base's own tree back.
 *
 * "unknown" whenever the answer is not certain: a conflict (the merge would need a hand), an
 * error, a base that cannot be read. The worktree is then kept.
 */
export function replayOntoBase(repo: string, baseRef: string, head: string, env: Env): Replay {
  const base = runGit(repo, ["rev-parse", "--verify", "--quiet", `${baseRef}^{tree}`], env);
  if (!base.ok || !COMMIT_SHA.test(base.out)) return "unknown";
  const objects = objectFolder(repo, env);
  if (objects === null) return "unknown";
  try {
    const merged = runGit(
      repo,
      ["merge-tree", "--write-tree", "--no-messages", baseRef, head],
      env,
      GUARD_GIT_TIMEOUT_MS,
      objects.own,
    );
    // A conflicted merge exits 1: its tree holds conflict markers, so it says nothing.
    if (!merged.ok) return "unknown";
    const tree = merged.out.split("\n")[0] ?? "";
    if (!COMMIT_SHA.test(tree)) return "unknown";
    return tree === base.out ? "nothing" : "changes";
  } finally {
    rmSync(objects.dir, { recursive: true, force: true });
  }
}

/**
 * The replay of a branch onto the base, and the git version it needs.
 *
 * `git merge-tree --write-tree` came with git 2.38 (`MIN_MERGE_TREE_GIT`). An older git
 * cannot answer, so a squash merge cannot be seen on it and the worktree is kept; the
 * version is read once, and the reason says which git is too old.
 */
export interface Replayer {
  /** The git version when it is too old for the replay, else null. */
  tooOld: string | null;
  /** What merging `head` into `baseRef` would change. */
  replay(baseRef: string, head: string): Replay;
}

/** The replayer of this repository: its git version, and the folder a replay writes into. */
export function replayerFor(repo: string, env: Env): Replayer {
  const asked = runGit(repo, ["--version"], env);
  const version = asked.ok ? parseGitVersion(asked.out) : null;
  const tooOld =
    version !== null && Bun.semver.order(version, MIN_MERGE_TREE_GIT) < 0 ? version : null;
  return {
    tooOld,
    replay: (baseRef: string, head: string) =>
      tooOld === null ? replayOntoBase(repo, baseRef, head, env) : "unknown",
  };
}

/**
 * Does this worktree hold a git submodule? `git worktree move` AND `git worktree remove`
 * refuse such a worktree — "working trees containing submodules cannot be moved or removed"
 * (git 2.43, checked both with the submodule checked out and with one only in the index) —
 * because a submodule's own git folder lives inside the folder they would move. Asking git is
 * the same rule the refusal comes from, so the two can never disagree.
 */
export function holdsSubmodule(worktree: string, env: Env): boolean {
  const status = runGit(worktree, ["submodule", "status"], env);
  return status.ok && status.out.trim() !== "";
}

/**
 * Is the work on this branch on the base already, and how is it known? Null when it is not
 * known to be there.
 *
 * Merging the branch into the base is git's own answer, and the one that sees a squash merge:
 * `git cherry` cannot (a squash carries the release notes with it), and the pull request needs
 * the network. When the merge would change the base, the branch holds work the base does not
 * have — and nothing else may say otherwise, or a removal would lose that work.
 *
 * The replay could not answer (a conflict, an error, a git too old): the other two may.
 */
export function workOnBase(
  repo: string,
  base: string,
  head: string,
  branch: string | null,
  env: Env,
  replayer: Replayer,
): MergedBy | null {
  const replay = replayer.replay(`origin/${base}`, head);
  if (replay === "nothing") return "replay";
  if (replay === "changes") return null;
  if (cherryOnBase(repo, base, head, env)) return "cherry";
  if (branch !== null && pullRequestMerged(repo, branch, head, env)) return "pull request";
  return null;
}

/** What one look at this machine gives every worktree of the scan. */
interface MachineLook {
  base: string;
  containers: "unknown" | ContainerMounts[];
  env: Env;
  idleLimit: number | undefined;
  now: number;
  programs: "unknown" | RunningProgram[];
  /** The replay of a branch onto the base: git's own answer, and the git version it needs. */
  replayer: Replayer;
  sessions: SessionRecord[];
}

/**
 * ONE worktree, judged: the machine's facts, git's, and then what is in it — the slow part,
 * asked last. The scan uses this for each worktree, and the removal uses it again on the
 * folder as it is now (`removeWorktree`).
 */
function judgeOne(
  repo: string,
  listed: ListedWorktree,
  all: ListedWorktree[],
  look: MachineLook,
): Verdict {
  const ahead = runGit(
    repo,
    ["rev-list", "--count", `origin/${look.base}..${listed.head}`],
    look.env,
  );
  if (!ahead.ok) {
    return {
      finished: false,
      held: false,
      why: `git could not compare it with ${look.base}`,
    };
  }
  const aheadOfBase = Number(ahead.out);
  // The session's own folder, and the worktree, as real paths: `git worktree list` prints
  // the path the worktree was made with, while a session record holds the physical one when
  // the repo is reached through a symlink.
  const session = look.sessions.find((one) => isInside(realPath(one.cwd), realPath(listed.path)));
  const facts: WorktreeFacts = {
    aheadOfBase,
    base: look.base,
    containers:
      look.containers === "unknown" ? "unknown" : containersUsing(listed.path, look.containers),
    gitTooOld: look.replayer.tooOld,
    idleMinutes: idleMinutes(listed.path, look.now),
    innerWorktree: innerWorktreeOf(listed.path, all),
    locked: listed.locked,
    // A few more git calls (and one `gh` call) per worktree: only worth it for one with
    // commits of its own.
    mergedBy:
      aheadOfBase > 0
        ? workOnBase(repo, look.base, listed.head, listed.branch, look.env, look.replayer)
        : null,
    programs: look.programs === "unknown" ? "unknown" : programsInside(look.programs, listed.path),
    sessionName: session?.name ?? null,
  };
  return verdict(facts, () => contentsOf(listed.path, repo, look.env), look.idleLimit);
}

/** The machine's facts, read once for a whole scan (or one removal). */
function lookAt(repo: string, base: string, options: ScanOptions): MachineLook {
  return {
    base,
    containers: options.facts?.containers ?? dockerMounts(),
    env: options.env,
    idleLimit: options.idleLimit,
    now: options.now ?? Date.now(),
    programs: options.facts?.programs ?? runningPrograms(),
    replayer: replayerFor(repo, options.env),
    sessions: options.facts?.sessions ?? liveSessions(options.claudeConfigDir),
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
  const look = lookAt(repo, base, options);
  const all = listWorktrees(repo, env);
  const [main, ...others] = all;
  const scanned: ScannedWorktree[] = main === undefined ? [] : [{ listed: main, state: "main" }];

  for (const listed of others) {
    if (listed.locked) {
      // Before "gone": a locked worktree may sit on a drive that is not connected.
      scanned.push({
        listed,
        state: { finished: false, held: false, why: "locked with `git worktree lock`" },
      });
      continue;
    }
    if (listed.prunable || !existsSync(listed.path)) {
      scanned.push({ listed, state: "gone" });
      continue;
    }
    scanned.push({ listed, state: judgeOne(repo, listed, all, look) });
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
 * **The verdict is taken again here**, on the folder as it is now, with the same options the
 * scan ran with: the scan a person read may be minutes old, and in between the session in
 * that worktree can commit, leave a file or start a program. A removal acts on what is there
 * now, never on the scan.
 *
 * It MOVES the folder first: a folder a program still uses cannot be renamed on Windows, so
 * the move fails and nothing is touched, where a plain `git worktree remove` would delete
 * files up to the first one in use and then forget the worktree, leaving half a folder nobody
 * tracks. So the checks above happen right before the move, not earlier.
 */
export function removeWorktree(
  repo: string,
  listed: ListedWorktree,
  options: ScanOptions & {
    /** How its branch goes once the folder did: the default keeps a branch off the base. */
    deleteBranch?: (repo: string, branch: string) => string;
  },
): Removal {
  // The listing is read again too: a worktree's head moves when a session commits, and a
  // verdict on the head the scan saw would miss exactly that.
  const all = listWorktrees(repo, options.env);
  const current = all.find((one) => samePath(one.path, listed.path));
  if (current === undefined || !existsSync(current.path)) {
    return {
      said: [`kept ${listed.path}: its folder is gone — \`${COMMAND} worktrees\` forgets it`],
      status: "kept",
    };
  }
  const fresh = judgeOne(repo, current, all, lookAt(repo, options.base, options));
  if (!fresh.finished) {
    return {
      said: [`kept ${listed.path}: ${fresh.why}`],
      status: fresh.held ? "held" : "kept",
    };
  }
  const parked = `${listed.path}-removing-${String(Date.now())}`;
  const moved = runGit(repo, ["worktree", "move", listed.path, parked], options.env);
  if (!moved.ok) {
    // A worktree holding a submodule can never be moved, however long anyone waits: git
    // refuses those by its own rule, so the message says the way out, and no "try again".
    if (holdsSubmodule(listed.path, options.env)) {
      return {
        said: [
          `kept ${listed.path}: it holds a git submodule, and git cannot move or remove such a ` +
            `worktree. Commit and push the work in it, delete the folder by hand, and run ` +
            `\`${COMMAND} worktrees\` again: a worktree whose folder is gone is forgotten.`,
        ],
        status: "kept",
      };
    }
    return {
      said: [
        `kept ${listed.path}: a program may still work in it — a terminal, a background command, ` +
          `or an MCP server restarted while a session was in it (${moved.err})`,
      ],
      status: "held",
    };
  }
  const removed = runGit(repo, ["worktree", "remove", parked], options.env);
  if (!removed.ok) {
    return {
      said: [`moved ${listed.path} to ${parked}, then could not remove it: ${removed.err}`],
      status: "failed",
    };
  }
  const deleteBranch =
    options.deleteBranch ??
    ((repo_: string, branch: string) =>
      deleteMergedBranch(repo_, options.base, branch, options.env));
  const said = [`removed ${listed.path}`];
  if (listed.branch !== null) said.push(deleteBranch(repo, listed.branch));
  return { said, status: "removed" };
}

/**
 * Deletes a branch only when `origin/<base>` holds its work, so nothing on it is lost: every
 * commit by ancestry, or the work under another sha (a rebase merge), or the work a squash
 * merge left on the base (merging the branch into the base changes nothing), or the work
 * through a merged pull request. git refuses while a worktree — even one whose folder is gone
 * and not yet pruned — still has it checked out.
 */
export function deleteMergedBranch(repo: string, base: string, branch: string, env: Env): string {
  const ahead = runGit(repo, ["rev-list", "--count", `origin/${base}..refs/heads/${branch}`], env);
  if (!ahead.ok) {
    return `kept branch ${branch}: ${ahead.err || `git could not compare it with ${base}`}`;
  }
  if (ahead.out !== "0") {
    const head = runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], env);
    const sha = head.ok ? head.out.trim() : "";
    // The same answer the worktree's verdict gave, on the same branch: the branch goes only
    // when its work is on the base.
    const elsewhere =
      COMMIT_SHA.test(sha) &&
      workOnBase(repo, base, sha, branch, env, replayerFor(repo, env)) !== null;
    if (!elsewhere) return `kept branch ${branch}: it has commits that are not on ${base}`;
  }
  const deleted = runGit(repo, ["branch", "-D", branch], env);
  return deleted.ok ? `deleted branch ${branch}` : `kept branch ${branch}: ${deleted.err}`;
}

/** Forgets worktrees whose folder is gone. */
export function pruneWorktrees(repo: string, env: Env): void {
  runGit(repo, ["worktree", "prune"], env);
}
