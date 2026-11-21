/**
 * What git leaves in a worktree while a bisect, a rebase, a `git am`, a merge, a cherry-pick or a
 * revert is unfinished. The one home of that list, read two ways:
 *
 * - the worktree's verdict keeps the folder (`inProgressWhy`): removing it would throw the
 *   operation away, whatever else says the work is finished;
 * - a branch delete keeps the branch (`branchInProgressWhy`): a bisect and a rebase leave HEAD
 *   detached, so the worktree list does not show the branch, yet they return to it. `git branch
 *   -D` reads their files; `git update-ref -d` does not.
 *
 * Some operations leave a folder, not one file: `git am` stopped in the middle of a series leaves
 * `rebase-apply/` with no `head-name`, and a cherry-pick or revert series whose conflicting
 * commit was committed by hand leaves only `sequencer/`. The folder itself is the marker; the
 * `head-name` files stay, to name the branch a rebase returns to.
 *
 * Each marker sits in the worktree's own git folder, which only `git rev-parse --git-path` names.
 * One call asks for all of them. What git or the disk cannot answer keeps: nothing proves that
 * no operation is running.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runGit } from "../hooks/git";
import type { Env } from "../hooks/run";

interface Operation {
  /** The marker, relative to the worktree's git folder. */
  path: string;
  /** A file (its text may name the branch) or a folder (it is there or not). */
  kind: "file" | "folder";
  /** What a person calls it, for the reason. */
  what: string;
  /** True when the file holds the name of the branch the operation returns to. */
  namesBranch: boolean;
}

/** The markers, in the order a reason names them: the most telling first. */
const OPERATIONS: readonly Operation[] = [
  { kind: "file", namesBranch: true, path: "BISECT_START", what: "a bisect" },
  { kind: "file", namesBranch: true, path: "rebase-merge/head-name", what: "a rebase" },
  { kind: "file", namesBranch: true, path: "rebase-apply/head-name", what: "a rebase" },
  { kind: "file", namesBranch: false, path: "rebase-apply/applying", what: "a git am" },
  { kind: "folder", namesBranch: false, path: "rebase-merge", what: "a rebase" },
  { kind: "folder", namesBranch: false, path: "rebase-apply", what: "a rebase or a git am" },
  { kind: "file", namesBranch: false, path: "MERGE_HEAD", what: "a merge" },
  { kind: "file", namesBranch: false, path: "CHERRY_PICK_HEAD", what: "a cherry-pick" },
  { kind: "file", namesBranch: false, path: "REVERT_HEAD", what: "a revert" },
  {
    kind: "folder",
    namesBranch: false,
    path: "sequencer",
    what: "a cherry-pick or revert series",
  },
];

/** One operation that is running: what it is, and the branch it returns to (when its file says). */
interface Running {
  what: string;
  branch: string | null;
}

type Read = { state: "read"; running: Running[] } | { state: "unreadable"; why: string };

/** What is unfinished in `worktree`, or why that cannot be said. A folder that is gone has none. */
function readInProgress(worktree: string, env: Env): Read {
  if (!existsSync(worktree)) return { running: [], state: "read" };
  const located = runGit(
    worktree,
    ["rev-parse", ...OPERATIONS.flatMap((operation) => ["--git-path", operation.path])],
    env,
  );
  if (!located.ok) return { state: "unreadable", why: located.err };
  const paths = located.out.split(/\r?\n/);
  if (paths.length !== OPERATIONS.length) {
    return {
      state: "unreadable",
      why: `git named ${String(paths.length)} paths, not ${String(OPERATIONS.length)}`,
    };
  }
  const running: Running[] = [];
  for (const [index, operation] of OPERATIONS.entries()) {
    const marker = resolve(worktree, paths[index] ?? "");
    let text = "";
    try {
      // A folder marker only has to be there; a file marker's text may name the branch.
      if (operation.kind === "folder") statSync(marker);
      else text = readFileSync(marker, "utf8");
    } catch (error) {
      // Only a marker that is not there proves the operation is not running; any other failure
      // (a permission, a disk error) proves nothing.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      const why = error instanceof Error ? error.message : String(error);
      return { state: "unreadable", why: `${marker} cannot be read (${why})` };
    }
    running.push({ branch: operation.namesBranch ? text.trim() : null, what: operation.what });
  }
  return { running, state: "read" };
}

/**
 * Why the worktree must stay: an operation of git's is unfinished in it, in words (`a bisect is
 * in progress`). Null when none is. When git cannot say, the worktree stays and the reason says so.
 */
export function inProgressWhy(worktree: string, env: Env): string | null {
  const read = readInProgress(worktree, env);
  if (read.state === "unreadable") {
    return `git could not say whether a bisect, rebase, git am, merge, cherry-pick or revert is in progress in it (${read.why}), so it is kept`;
  }
  const first = read.running[0];
  return first === undefined ? null : `${first.what} is in progress`;
}

/**
 * Why a branch must stay for this worktree, or null: the worktree is bisecting or rebasing it.
 * What git or the disk cannot answer keeps the branch.
 */
export function branchInProgressWhy(worktree: string, branch: string, env: Env): string | null {
  const read = readInProgress(worktree, env);
  if (read.state === "unreadable") {
    return `${read.why} in ${worktree}, so it is not proved that nothing there bisects or rebases it`;
  }
  const returnsToIt = read.running.some(
    (one) => one.branch === branch || one.branch === `refs/heads/${branch}`,
  );
  return returnsToIt ? `a worktree is bisecting or rebasing it, at ${worktree}` : null;
}
