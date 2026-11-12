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
import { idleMinutesOrNull } from "../hooks/worktree-leftovers";
import { ancestorsBy } from "../jobs/ancestry";
import { processIsGone } from "../jobs/windows";
import { ownPidNamespace, processStartTime } from "../setup/lock";
import { parseGitVersion } from "../workflow/review-cover";
import { COMMIT_SHA } from "../workflow/reviews";
import { agentFinished, ownsClaudeLock, parentOf, parseClaudeLock } from "./agent-lock";
import {
  type ContainerMounts,
  containersUsing,
  dockerMounts,
  mountKeptWhy,
  mountPoints,
  type OwnerSession,
  programName,
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
 * The mark a removal gives the folder it moves aside before removing it:
 * `<path>-removing-<milliseconds>` (`removeWorktree`). A folder carrying it is one whose removal
 * stopped halfway, and the next `worktrees --clean` finishes it
 * (D62). An older kit moved such a folder aside again, so the mark may stand more than once.
 */
const PARKED_END = /(?:-removing-\d{13})+$/;

/** The folder a half-done removal moved aside was at, or null when `path` is not one. */
export function parkedOriginal(path: string): null | string {
  const found = PARKED_END.exec(path);
  return found === null || found.index === 0 ? null : path.slice(0, found.index);
}

/** True when `path` is a folder a half-done removal moved aside (`<path>-removing-<time>`). */
export function isParkedWorktree(path: string): boolean {
  return parkedOriginal(path) !== null;
}

/**
 * Said when a worktree whose folder is gone is forgotten. `git worktree prune` cannot tell a
 * folder that was deleted from one on a disk that is not connected — and a LOCKED worktree is
 * never pruned, so the line says how to be sure next time.
 */
export function forgottenLine(path: string): string {
  return (
    `forgot ${path} (its folder was already gone). A worktree on a disk that is not connected reads ` +
    `the same way: lock one there (\`git worktree lock "${path}"\`) and prune leaves it alone.`
  );
}

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

/**
 * True when the folder has anything uncommitted beyond tracked files that are gone: what a
 * removal that stopped halfway leaves behind is files it deleted itself, and `git status` reads
 * those as changes. A file someone changed, added or staged is not the removal's own work.
 * `git status` prints ` D path` or `D  path`, and `runGit` trims the first line's leading space,
 * so a deletion reads `D path` there.
 */
function hasChangesBeyondDeletions(worktree: string, env: Env): boolean {
  const status = runGit(
    worktree,
    ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"],
    env,
  );
  if (!status.ok) return true;
  return status.out.split("\n").some((line) => line !== "" && !/^(?: D|D) /.test(line));
}

/**
 * What removing the worktree would lose. `parked`: a folder a removal moved aside (D62), whose
 * deleted tracked files are the removal's own and are not changes.
 */
function contentsOf(
  worktree: string,
  mainCheckout: string,
  env: Env,
  parked = false,
): WorktreeContents {
  const changed = parked ? hasChangesBeyondDeletions(worktree, env) : hasChanges(worktree, env);
  if (changed) return { localFiles: [], uncommitted: true };
  const ignored = localFiles(worktree, mainCheckout, env);
  if (ignored === null) {
    return { localFiles: ["(git could not list the ignored files)"], uncommitted: false };
  }
  return { localFiles: ignored, uncommitted: false };
}

export interface ScannedWorktree {
  listed: ListedWorktree;
  /**
   * Minutes since git last wrote to it, measured once by this scan; null when unknown (a folder
   * that is gone, or one that is not a worktree any more) and for the main checkout.
   */
  idleMinutes: null | number;
  /** "main" for the main checkout, "gone" for a worktree whose folder no longer exists. */
  state: "gone" | "main" | Verdict;
}

export interface ScanOptions {
  /** The base branch work must be on: `worktrees.base`, or the repo's default branch. */
  base: string;
  /**
   * The ref the commits are judged against, and how a message calls it. Without it the ref is
   * `origin/<base>`, as `worktrees` judges.
   */
  against?: { label: string; ref: string };
  env: Env;
  /**
   * 0 lets a session remove the worktree it has just finished in. The default is the hour
   * `verdict.ts` asks for.
   */
  idleLimit?: number;
  /** The Claude config folder, for the running sessions' records. */
  claudeConfigDir: string;
  now?: number;
  /** Only the explicit --remove command may prove the caller owns a lock. */
  ownerMode?: boolean;
  /** A test hands in fakes; the default reads this machine. */
  facts?: {
    containers?: "unknown" | ContainerMounts[];
    mounts?: "unknown" | string[];
    programs?: "unknown" | RunningProgram[];
    sessions?: SessionRecord[];
    parentOf?: typeof parentOf;
    agentFinished?: typeof agentFinished;
    processStartTime?: typeof processStartTime;
    processIsGone?: typeof processIsGone;
    platform?: NodeJS.Platform;
    pidNamespace?: string | null;
  };
}

/** How long a `gh` call may take: the same 10 s the guards give one read-only call. */
const GH_TIMEOUT_MS = 10_000;

/**
 * Is every commit on this branch on `baseRef` under another sha? `git cherry` says so with a
 * `-` for each commit whose change is already there: what a rebase merge or a cherry-pick
 * leaves, where the base holds the same change as a commit of its own. False when git cannot
 * compare them, and when the range is empty (that is no evidence of a merge).
 */
export function cherryOnBase(repo: string, baseRef: string, head: string, env: Env): boolean {
  const run = runGit(repo, ["cherry", baseRef, head], env);
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
  baseRef: string,
  head: string,
  branch: string | null,
  env: Env,
  replayer: Replayer,
): MergedBy | null {
  const replay = replayer.replay(baseRef, head);
  if (replay === "nothing") return "replay";
  if (replay === "changes") return null;
  if (cherryOnBase(repo, baseRef, head, env)) return "cherry";
  if (branch !== null && pullRequestMerged(repo, branch, head, env)) return "pull request";
  return null;
}

/** Where a branch's work stands against a ref (`workOnRef`). */
export type WorkOnRef =
  /** Every commit of the branch is an ancestor of the ref. */
  | "ancestor"
  /** Merging the branch into the ref would change nothing: a squash or rebase merge put it there. */
  | "replay"
  /** Merging the branch into the ref would change it: the branch holds work the ref does not. */
  | "missing"
  /** Git could not say (a conflict, an error, a git too old for the replay): treat it as not merged. */
  | "unknown";

/**
 * Is the work of the commit `head` on `ref`? The one answer for "is this branch merged": an
 * ancestor (a merge commit or a fast-forward), or a merge of it that changes nothing (a squash
 * merge, `replayOntoBase`). Every removal asks the same question, so they agree
 * with `worktrees --clean`. Only "ancestor" and "replay" are certain; keep what is at stake for
 * the rest.
 */
export function workOnRef(
  repo: string,
  ref: string,
  head: string,
  env: Env,
  replayer: Replayer = replayerFor(repo, env),
): WorkOnRef {
  const ancestor = runGit(repo, ["merge-base", "--is-ancestor", head, ref], env);
  if (ancestor.ok) return "ancestor";
  if (ancestor.code !== 1) return "unknown";
  const replay = replayer.replay(ref, head);
  if (replay === "nothing") return "replay";
  return replay === "changes" ? "missing" : "unknown";
}

/** What one look at this machine gives every worktree of the scan. */
interface MachineLook {
  mounts: "unknown" | string[];
  containers: "unknown" | ContainerMounts[];
  env: Env;
  idleLimit: number | undefined;
  /** How a message calls the ref the work is judged against: the base, or `against.label`. */
  label: string;
  now: number;
  programs: "unknown" | RunningProgram[];
  /** Reads the start time of a process named by a Claude Code worktree lock. */
  processStartTime: typeof processStartTime;
  processIsGone: typeof processIsGone;
  parentOf: typeof parentOf;
  agentFinished: typeof agentFinished;
  ownerMode: boolean;
  platform: NodeJS.Platform;
  pidNamespace: string | null;
  /** The ref commits are judged against: `origin/<base>`, or `against.ref`. */
  ref: string;
  /** The replay of a branch onto the base: git's own answer, and the git version it needs. */
  replayer: Replayer;
  sessions: SessionRecord[];
}

/**
 * ONE worktree, judged: the machine's facts, git's, and then what is in it — the slow part,
 * asked last. The scan uses this for each worktree, and the removal uses it again on the
 * folder as it is now (`removeWorktree`).
 */
const INITIAL_PID_NAMESPACE = `pid:[${0xeffffffc}]`;

function staleClaudeLock(listed: ListedWorktree, look: MachineLook): boolean {
  const lock = parseClaudeLock(listed.lockReason ?? "");
  if (!listed.locked || lock === null || !lockPlatform(look)) return false;
  return (
    lockerGone(listed.lockReason ?? "", look) &&
    (lock.kind === "session" || finishedAgent(lock.name, listed.path, look))
  );
}

/** A numeric identity is required for sessions; agents also allow a dead pid alone. */
function lockerGone(reason: string, look: MachineLook): boolean {
  const lock = parseClaudeLock(reason);
  if (lock === null || !lockPlatform(look)) return false;
  const expected = lock.start !== null && /^\d+$/.test(lock.start) ? `proc:${lock.start}` : null;
  if (lock.kind === "session" && expected === null) return false;
  if (look.processIsGone(lock.pid)) return true;
  const actual = expected === null ? null : look.processStartTime(lock.pid, expected);
  return actual !== null && actual !== expected;
}

function lockPlatform(look: MachineLook): boolean {
  return look.platform === "linux" && look.pidNamespace === INITIAL_PID_NAMESPACE;
}

function finishedAgent(name: string, path: string, look: MachineLook): boolean {
  return /^agent-[A-Za-z0-9_-]+$/.test(name) && look.agentFinished(name.slice(6), path);
}

function releasableClaudeLock(listed: ListedWorktree, look: MachineLook): boolean {
  if (staleClaudeLock(listed, look)) return true;
  if (!look.ownerMode || !lockPlatform(look)) return false;
  const lock = parseClaudeLock(listed.lockReason ?? "");
  return (
    lock !== null &&
    ownsClaudeLock(lock, process.pid, look.parentOf, look.processStartTime) &&
    (lock.kind === "session" || finishedAgent(lock.name, listed.path, look))
  );
}

/**
 * The session that is removing its own worktree, or undefined: `--remove` only, on the machines
 * the lock proofs cover. Its own MCP servers do not hold the folder (`programsUsing`).
 *
 * The Claude process is the one whose lock the owner proof matched. After ExitWorktree `keep`
 * Claude Code has usually released a session's lock, so with no lock to prove, it is the nearest
 * process above this command that the listing names `claude`. That claims nothing about the
 * worktree: only the children of THIS command's own session are skipped, and the verdict still
 * holds the folder for any other session, shell or program. The name is argv[0] as `ps` prints
 * it: `claude` on a normal install. A launch as `node …/cli.js` does not match, and the folder
 * is kept — the safe side.
 */
function ownerSession(listed: ListedWorktree, look: MachineLook): OwnerSession | undefined {
  if (!look.ownerMode || !lockPlatform(look) || look.programs === "unknown") return undefined;
  const lock = parseClaudeLock(listed.lockReason ?? "");
  if (lock !== null && ownsClaudeLock(lock, process.pid, look.parentOf, look.processStartTime)) {
    return { claudePid: lock.pid };
  }
  for (const pid of ancestorsBy(process.pid, look.parentOf)) {
    const program = look.programs.find((one) => one.pid === pid);
    if (program !== undefined && programName(program) === "claude") return { claudePid: pid };
  }
  return undefined;
}

/**
 * The branch of ANOTHER worktree that holds the work of `listed`, or null. Only ancestry counts
 * (never a replay onto a branch that is still being worked on), and the holder must be a worktree
 * whose folder is there and that stands on a branch: a detached or vanished one holds nothing
 * for long. One git call names every branch that contains the head.
 */
function holdingBranch(
  repo: string,
  listed: ListedWorktree,
  all: ListedWorktree[],
  env: Env,
): string | null {
  const containing = runGit(
    repo,
    ["for-each-ref", "--contains", listed.head, "--format=%(refname)", "refs/heads/"],
    env,
  );
  if (!containing.ok) return null;
  // The full ref name, cut by hand: `%(refname:short)` may print `heads/x` when a tag shares the name.
  const prefix = "refs/heads/";
  const holders = new Set(
    containing.out
      .split("\n")
      .filter((ref) => ref.startsWith(prefix))
      .map((ref) => ref.slice(prefix.length)),
  );
  for (const other of all) {
    if (
      other.branch !== null &&
      other.branch !== listed.branch &&
      holders.has(other.branch) &&
      !other.prunable &&
      !samePath(other.path, listed.path) &&
      existsSync(other.path)
    ) {
      return other.branch;
    }
  }
  return null;
}

function judgeOne(
  repo: string,
  listed: ListedWorktree,
  all: ListedWorktree[],
  look: MachineLook,
  idle: null | number,
): Verdict {
  const ahead = runGit(repo, ["rev-list", "--count", `${look.ref}..${listed.head}`], look.env);
  if (!ahead.ok) {
    return {
      finished: false,
      held: false,
      why: `git could not compare it with ${look.label}`,
    };
  }
  const aheadOfBase = Number(ahead.out);
  // The session's own folder, and the worktree, as real paths: `git worktree list` prints
  // the path the worktree was made with, while a session record holds the physical one when
  // the repo is reached through a symlink.
  // In owner mode the owner's own record never counts: ExitWorktree keep moves the session out
  // of the folder, and a record whose cwd lags behind must not keep it. `--remove` already
  // refuses a target that holds the caller's cwd. Any other session's record still counts.
  const owner = ownerSession(listed, look);
  const session = look.sessions.find(
    (one) => one.pid !== owner?.claudePid && isInside(realPath(one.cwd), realPath(listed.path)),
  );
  // A folder a removal moved aside, standing on a branch (D62): the branch holds its commits.
  const parked = isParkedWorktree(listed.path) && listed.branch !== null;
  if (parked) {
    const mountWhy = mountKeptWhy(listed.path, look.mounts);
    if (mountWhy !== null) return { finished: false, held: false, why: mountWhy };
  }
  const mergedBy =
    aheadOfBase > 0
      ? workOnBase(repo, look.ref, listed.head, listed.branch, look.env, look.replayer)
      : null;
  const facts: WorktreeFacts = {
    aheadOfBase,
    heldByBranch:
      aheadOfBase > 0 && mergedBy === null ? holdingBranch(repo, listed, all, look.env) : null,
    base: look.label,
    containers:
      look.containers === "unknown" ? "unknown" : containersUsing(listed.path, look.containers),
    gitTooOld: look.replayer.tooOld,
    // The hook's own rule: unknown counts as just now, which keeps it.
    idleMinutes: idle ?? 0,
    innerWorktree: innerWorktreeOf(listed.path, all),
    locked: listed.locked && !releasableClaudeLock(listed, look),
    // A few more git calls (and one `gh` call) per worktree: only worth it for one with
    // commits of its own.
    mergedBy,
    parked,
    programs:
      look.programs === "unknown"
        ? "unknown"
        : programsInside(look.programs, listed.path, undefined, undefined, owner),
    sessionName: session?.name ?? null,
  };
  return verdict(facts, () => contentsOf(listed.path, repo, look.env, parked), look.idleLimit);
}

/** What this machine says about the Docker containers, the programs and the sessions at work. */
export interface MachineFacts {
  mounts: "unknown" | string[];
  containers: "unknown" | ContainerMounts[];
  programs: "unknown" | RunningProgram[];
  sessions: SessionRecord[];
}

/**
 * The machine's facts: the options' own (a test gives them), else read from this machine. One
 * home for what a worktree's verdict and a leftover folder's (`scan-parked.ts`) both ask.
 */
export function machineFactsOf(options: ScanOptions): MachineFacts & {
  processStartTime: typeof processStartTime;
  processIsGone: typeof processIsGone;
  platform: NodeJS.Platform;
  pidNamespace: string | null;
} {
  return {
    containers: options.facts?.containers ?? dockerMounts(),
    mounts: options.facts?.mounts ?? mountPoints(),
    programs: options.facts?.programs ?? runningPrograms(),
    sessions: options.facts?.sessions ?? liveSessions(options.claudeConfigDir),
    processStartTime: options.facts?.processStartTime ?? processStartTime,
    processIsGone: options.facts?.processIsGone ?? processIsGone,
    platform: options.facts?.platform ?? process.platform,
    pidNamespace:
      options.facts?.pidNamespace === undefined ? ownPidNamespace() : options.facts.pidNamespace,
  };
}

/** The machine's facts, read once for a whole scan (or one removal). */
function lookAt(repo: string, options: ScanOptions): MachineLook {
  return {
    ...machineFactsOf(options),
    parentOf: options.facts?.parentOf ?? parentOf,
    agentFinished:
      options.facts?.agentFinished ??
      ((agentId: string, worktreePath: string) =>
        agentFinished(agentId, worktreePath, options.claudeConfigDir)),
    ownerMode: options.ownerMode === true,
    env: options.env,
    idleLimit: options.idleLimit,
    label: options.against?.label ?? options.base,
    now: options.now ?? Date.now(),
    ref: options.against?.ref ?? `refs/remotes/origin/${options.base}`,
    replayer: replayerFor(repo, options.env),
  };
}

/**
 * Every worktree of the repo, judged: its commits against `against.ref`, or `origin/<base>`
 * without `against` — fetched fresh first (`fetchBase`).
 *
 * Throws when that ref is not known here: nothing can be judged against it.
 */
function lockLine(listed: ListedWorktree, look: MachineLook, onBase = false): string {
  const reason = listed.lockReason;
  if (reason === undefined) return "locked with `git worktree lock` (locker cannot be proved gone)";
  const lock = parseClaudeLock(reason);
  if (lock === null) return `locked: ${reason} (locker cannot be proved gone)`;
  if (lock.kind === "agent") {
    const gone = lockerGone(reason, look);
    if (gone)
      return `the session that locked it has ended, but builder ${lock.name} could not be proved finished; check its work, then \`git worktree unlock "${listed.path}"\` and \`${COMMAND} worktrees --remove "${listed.path}"\``;
    return `locked by live or unprovable Claude session's builder ${lock.name}; its lead removes it after the merge, or it goes when that session ends and it is proved finished`;
  }
  return `locked by live or unprovable Claude session ${lock.name}${onBase ? "; its work is on the base — leave it with Claude Code's ExitWorktree (remove), or close that session" : "; its locker is not proved gone"}`;
}

export function scanWorktrees(repo: string, options: ScanOptions): ScannedWorktree[] {
  const { env } = options;
  const againstRef = options.against?.ref ?? `refs/remotes/origin/${options.base}`;
  const againstLabel = options.against?.label ?? options.base;
  if (!runGit(repo, ["rev-parse", "--verify", "--quiet", againstRef], env).ok) {
    throw new Error(
      options.against === undefined
        ? `origin/${options.base} is not known here — run \`git fetch origin ${options.base}\` first`
        : `${againstLabel} is not known here`,
    );
  }
  const look = lookAt(repo, options);
  const all = listWorktrees(repo, env);
  const [main, ...others] = all;
  const scanned: ScannedWorktree[] =
    main === undefined ? [] : [{ idleMinutes: null, listed: main, state: "main" }];

  for (const listed of others) {
    if (listed.locked && (!existsSync(listed.path) || !releasableClaudeLock(listed, look))) {
      // Before "gone": a locked worktree may sit on a drive that is not connected.
      const onBase =
        (listed.lockReason ?? "").startsWith("claude session ") &&
        ["ancestor", "replay"].includes(workOnRef(repo, look.ref, listed.head, env, look.replayer));
      scanned.push({
        idleMinutes: idleMinutesOrNull(listed.path, look.now),
        listed,
        state: { finished: false, held: false, why: lockLine(listed, look, onBase) },
      });
      continue;
    }
    if (listed.prunable || !existsSync(listed.path)) {
      scanned.push({ idleMinutes: null, listed, state: "gone" });
      continue;
    }
    // Measured once here, and the same number the verdict is judged with.
    const idle = idleMinutesOrNull(listed.path, look.now);
    scanned.push({ idleMinutes: idle, listed, state: judgeOne(repo, listed, all, look, idle) });
  }
  return scanned;
}

/** One deadline for removing a worktree, and for an explicit removal waiting on another clean. */
export const REMOVAL_TIMEOUT_MS = 10 * 60_000;

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
  let all: ListedWorktree[];
  try {
    all = listWorktrees(repo, options.env);
  } catch {
    return { said: [`kept ${listed.path}: git could not list the worktrees`], status: "kept" };
  }
  const current = all.find((one) => samePath(one.path, listed.path));
  if (current === undefined || !existsSync(current.path)) {
    return {
      said: [`kept ${listed.path}: its folder is gone — \`${COMMAND} worktrees\` forgets it`],
      status: "kept",
    };
  }
  const look = lookAt(repo, options);
  if (current.locked && !releasableClaudeLock(current, look)) {
    return { said: [`kept ${current.path}: ${lockLine(current, look)}`], status: "kept" };
  }
  // Judge contents, mounts and programs before releasing even a stale lock.
  const fresh = judgeOne(repo, current, all, look, idleMinutesOrNull(current.path, look.now));
  if (!fresh.finished) {
    return {
      said: [`kept ${listed.path}: ${fresh.why}`],
      status: fresh.held ? "held" : "kept",
    };
  }
  let released = false;
  const keptAfterUnlock = (removal: Removal, path = current.path): Removal => {
    if (!released) return removal;
    const relocked = runGit(
      repo,
      ["worktree", "lock", "--reason", current.lockReason ?? "", path],
      options.env,
    );
    removal.said.push(
      relocked.ok
        ? `locked ${path} again, with the same reason`
        : `note: ${path} could not be locked again (${relocked.err}); its removal is not finished`,
    );
    return removal;
  };
  if (current.locked) {
    let check: ListedWorktree | undefined;
    try {
      check = listWorktrees(repo, options.env).find((one) => samePath(one.path, current.path));
    } catch {
      return {
        said: [`kept ${listed.path}: git could not revalidate its stale lock`],
        status: "kept",
      };
    }
    if (
      check === undefined ||
      check.head !== current.head ||
      check.branch !== current.branch ||
      check.lockReason !== current.lockReason ||
      !releasableClaudeLock(check, look)
    ) {
      return { said: [`kept ${listed.path}: lock state changed during removal`], status: "kept" };
    }
    const unlocked = runGit(repo, ["worktree", "unlock", current.path], options.env);
    if (!unlocked.ok) {
      return {
        said: [`kept ${current.path}: stale lock could not be unlocked (${unlocked.err})`],
        status: "kept",
      };
    }
    released = true;
  }
  // A folder an earlier removal already moved aside (D62) is not moved again: that would stack
  // a second mark on the first, and the record's folder could no longer be read from the name.
  const alreadyParked = isParkedWorktree(listed.path);
  const parked = alreadyParked ? listed.path : `${listed.path}-removing-${String(Date.now())}`;
  if (!alreadyParked) {
    const moved = runGit(repo, ["worktree", "move", listed.path, parked], options.env);
    if (!moved.ok) {
      // A worktree holding a submodule can never be moved, however long anyone waits: git
      // refuses those by its own rule, so the message says the way out, and no "try again".
      if (holdsSubmodule(listed.path, options.env)) {
        return keptAfterUnlock({
          said: [
            `kept ${listed.path}: it holds a git submodule, and git cannot move or remove such a ` +
              `worktree. Commit and push the work in it, delete the folder by hand, and run ` +
              `\`${COMMAND} worktrees\` again: a worktree whose folder is gone is forgotten.`,
          ],
          status: "kept",
        });
      }
      return keptAfterUnlock({
        said: [
          `kept ${listed.path}: a program may still work in it — a terminal, a background command, ` +
            `or an MCP server restarted while a session was in it (${moved.err})`,
        ],
        status: "held",
      });
    }
  }
  // A folder moved aside whose removal stopped halfway has lost tracked files to that removal,
  // and git refuses such a worktree without `--force` ("contains modified or untracked files").
  // Our own verdict already proved those deletions are all it holds (`hasChangesBeyondDeletions`),
  // so the force is limited to exactly this folder, after that proof, and to no other.
  const removed = runGit(
    repo,
    alreadyParked ? ["worktree", "remove", "--force", parked] : ["worktree", "remove", parked],
    options.env,
    REMOVAL_TIMEOUT_MS,
  );
  if (!removed.ok) {
    return keptAfterUnlock(
      {
        said: [
          alreadyParked
            ? `could not remove ${parked}: ${removed.err}`
            : `moved ${listed.path} to ${parked}, then could not remove it: ${removed.err}`,
        ],
        status: "failed",
      },
      parked,
    );
  }
  const said = [
    current.locked
      ? `unlocked stale Claude lock and removed ${listed.path}`
      : `removed ${listed.path}`,
  ];
  if (listed.branch !== null) {
    if (options.deleteBranch !== undefined) {
      said.push(options.deleteBranch(repo, listed.branch));
    } else {
      const outcome = tryDeleteBranch(repo, look.ref, look.label, listed.branch, options.env);
      // The held wording is for one case only: the ref lacks the branch's work, and a live
      // branch (named by the fresh verdict above) has it. git's own refusal keeps its words.
      said.push(
        outcome.kind === "not-on-ref" && fresh.heldBy !== undefined
          ? `kept branch ${listed.branch}: its work is held by ${fresh.heldBy}, not yet on ${refName(fresh.heldBy, look.label, options.against !== undefined)}`
          : branchOutcomeLine(listed.branch, look.label, outcome),
      );
    }
  }
  return { said, status: "removed" };
}

/**
 * Deletes a branch only when `ref` holds its work, so nothing on it is lost: every commit by
 * ancestry, or the work under another sha (a rebase merge), or the work a squash merge left on
 * the base (merging the branch into the base changes nothing), or the work through a merged
 * pull request; `label` is how a message calls that ref. git refuses while a worktree — even
 * one whose folder is gone and not yet pruned — still has the branch checked out.
 */
export function deleteBranchOnRef(
  repo: string,
  ref: string,
  label: string,
  branch: string,
  env: Env,
): string {
  return branchOutcomeLine(branch, label, tryDeleteBranch(repo, ref, label, branch, env));
}

/** What `tryDeleteBranch` did: deleted it, found commits `ref` lacks, or met git's own refusal. */
export type BranchOutcome =
  | { kind: "deleted" }
  | { kind: "not-on-ref" }
  | { kind: "git-error"; text: string };

/** The line a person reads for a branch's outcome. */
export function branchOutcomeLine(branch: string, label: string, outcome: BranchOutcome): string {
  if (outcome.kind === "deleted") return `deleted branch ${branch}`;
  if (outcome.kind === "not-on-ref") {
    return `kept branch ${branch}: it has commits that are not on ${label}`;
  }
  return `kept branch ${branch}: ${outcome.text}`;
}

/**
 * How a kept branch's line names the ref its work is not on. The default ref is `origin/<base>`,
 * whose label is the bare base name: when the holder carries that same name, say `origin/` so the
 * line does not read "held by main, not yet on main".
 */
function refName(holder: string, label: string, customRef: boolean): string {
  return !customRef && holder === label ? `origin/${label}` : label;
}

/** `deleteBranchOnRef`'s decision, as data. */
export function tryDeleteBranch(
  repo: string,
  ref: string,
  label: string,
  branch: string,
  env: Env,
): BranchOutcome {
  const ahead = runGit(repo, ["rev-list", "--count", `${ref}..refs/heads/${branch}`], env);
  if (!ahead.ok) {
    return { kind: "git-error", text: ahead.err || `git could not compare it with ${label}` };
  }
  if (ahead.out !== "0") {
    const head = runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], env);
    const sha = head.ok ? head.out.trim() : "";
    // The same answer the worktree's verdict gave, on the same branch: the branch goes only
    // when its work is on the ref.
    const elsewhere =
      COMMIT_SHA.test(sha) &&
      workOnBase(repo, ref, sha, branch, env, replayerFor(repo, env)) !== null;
    if (!elsewhere) return { kind: "not-on-ref" };
  }
  const deleted = runGit(repo, ["branch", "-D", branch], env);
  return deleted.ok ? { kind: "deleted" } : { kind: "git-error", text: deleted.err };
}

/** `deleteBranchOnRef` against `origin/<base>`: what `worktrees` asks. */
export function deleteMergedBranch(repo: string, base: string, branch: string, env: Env): string {
  return deleteBranchOnRef(repo, `refs/remotes/origin/${base}`, base, branch, env);
}

/** Forgets worktrees whose folder is gone. */
export function pruneWorktrees(repo: string, env: Env): void {
  runGit(repo, ["worktree", "prune"], env);
}
