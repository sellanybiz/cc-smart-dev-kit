/**
 * The clean itself: remove every finished worktree of a scan, with its branch, and forget the
 * ones whose folder is gone. The one home of that pass. `worktrees --clean` (`command.ts`)
 * prints each line it says; the background clean (`auto-clean.ts`) collects the same lines
 * and keeps the report. Neither judges anything here: the scan's verdict (`scan.ts`,
 * `verdict.ts`) decides, and `removeWorktree` judges the folder again right before it moves
 * it, so a removal never acts on a stale scan.
 */
import { basename } from "node:path";
import { realPath } from "../hooks/git";
import { holdPort } from "../machine/hold-port";
import { LOCK_PORTS } from "../ports";
import {
  type DeleteOptions,
  deleteMergedBranch,
  forgottenLine,
  pruneWorktrees,
  removeWorktree,
  type ScannedWorktree,
} from "./scan";
import { finishStrays, type StrayFolder, type StrayPass, strayParkedFolders } from "./scan-parked";

export { forgottenLine } from "./scan";

/** What holds the clean's machine-wide lock: closing it lets go (a listening `Server`). */
export interface CleanLock {
  close(): unknown;
}

export type CleanLockResult = { lock: CleanLock } | { taken: true } | { error: string };

/** Keep contention separate from a port failure for explicit removal. */
export async function takeCleanLock(): Promise<CleanLockResult> {
  const hold = await holdPort(LOCK_PORTS.worktreesClean);
  return "held" in hold ? { lock: hold.held } : hold;
}

/** The machine-wide lock of a clean, or null when it cannot be taken. */
export async function holdCleanLock(): Promise<null | CleanLock> {
  const hold = await takeCleanLock();
  return "lock" in hold ? hold.lock : null;
}

/** Can the clean take this worktree: finished, or its folder is gone (so git forgets it). */
export function canGo(worktree: ScannedWorktree): boolean {
  return (
    worktree.state === "gone" || (typeof worktree.state === "object" && worktree.state.finished)
  );
}

/** One worktree the clean removed. */
export interface RemovedWorktree {
  /** The branch it was on, or null for a detached worktree. */
  branch: string | null;
  /** The folder's name. */
  name: string;
  /** The folder it was in. */
  path: string;
  /** Why it was finished, in the verdict's words. */
  why: string;
}

/** One worktree the clean left, and the verdict's reason. */
export interface KeptWorktree {
  name: string;
  path: string;
  why: string;
}

export interface CleanReport {
  /** Worktrees moved aside whose folder git could not then remove; each says where it is now. */
  failed: KeptWorktree[];
  /** Worktrees whose folder was gone, forgotten by `git worktree prune`. */
  forgotten: string[];
  /** Every worktree that is not finished, with the reason. */
  kept: KeptWorktree[];
  /** Worktrees whose folder (and, when its work is on the base, branch) went. */
  removed: RemovedWorktree[];
}

/** The verdict's reason for taking a worktree, or the plain one when it had no commits ahead. */
function whyFinished(worktree: ScannedWorktree, base: string): string {
  const { state } = worktree;
  if (typeof state === "object" && state.finished && state.note !== null) return state.note;
  return `every commit is on ${base}`;
}

/**
 * Removes every worktree of `scanned` that can go, then forgets those whose folder is gone,
 * and says each step through `say` (the lines `worktrees --clean` prints). Never forces: a
 * worktree the fresh verdict keeps (a session, a program, a change) stays, and `said` has
 * why. `judged` is the options the scan ran with; its `recorded` keeps the branches an open
 * task records (`tryDeleteBranch`).
 */
export function cleanFinished(
  repo: string,
  scanned: ScannedWorktree[],
  judged: DeleteOptions,
  say: (line: string) => void,
): CleanReport {
  const going = scanned.filter(canGo);
  const removed: RemovedWorktree[] = [];
  const kept: KeptWorktree[] = [];
  const failed: KeptWorktree[] = [];
  for (const worktree of going) {
    if (worktree.state === "gone") continue;
    say(`removing ${worktree.listed.path} …`);
    const removal = removeWorktree(repo, worktree.listed, judged);
    for (const said of removal.said) say(`  ${said}`);
    const name = basename(worktree.listed.path);
    if (removal.status === "removed") {
      removed.push({
        branch: worktree.listed.branch,
        name,
        path: worktree.listed.path,
        why: whyFinished(worktree, judged.against?.label ?? judged.base),
      });
    } else if (removal.status === "failed") {
      // Moved aside, then git could not finish: the folder is at the path the line names.
      failed.push({
        name,
        path: worktree.listed.path,
        why: removal.said[0] ?? removal.status,
      });
    } else {
      // The fresh verdict kept it: a session, a program or a change appeared since the scan.
      const prefix = `kept ${worktree.listed.path}: `;
      const said = removal.said[0] ?? removal.status;
      kept.push({
        name,
        path: worktree.listed.path,
        why: said.startsWith(prefix) ? said.slice(prefix.length) : said,
      });
    }
  }
  pruneWorktrees(repo, judged.env);
  const forgotten: string[] = [];
  for (const worktree of going) {
    if (worktree.state !== "gone") continue;
    forgotten.push(worktree.listed.path);
    say(forgottenLine(worktree.listed.path));
    if (worktree.listed.branch !== null) {
      say(
        `  ${deleteMergedBranch(repo, judged.base, worktree.listed.branch, judged.env, judged.recorded)}`,
      );
    }
  }
  for (const worktree of scanned) {
    const { state } = worktree;
    if (typeof state === "object" && !state.finished) {
      kept.push({
        name: basename(worktree.listed.path),
        path: worktree.listed.path,
        why: state.why,
      });
    }
  }
  return { failed, forgotten, kept, removed };
}

/** What `cleanWithStrays` did: the clean's report, and the leftover folders it finished or kept. */
export interface CleanWithStraysReport {
  report: CleanReport;
  strays: StrayPass;
}

/**
 * The whole clean, one home for both callers (`worktrees --clean` and the background clean):
 * read the leftover folders a removal moved aside that git no longer lists, remove the finished
 * worktrees, read the leftovers again, and finish the union of both lists.
 *
 * Both reads are needed. Strays are looked for next to the worktrees git lists, so a folder
 * beside a worktree this clean removes is found only by the read BEFORE (while it is listed), and
 * a folder a removal parks and then fails to delete during this clean exists only for the read
 * AFTER. The second read also searches the folders the scan's worktrees stood in, because the
 * removed worktree is no longer listed to point there. A caller that already read the first list
 * (to show it) hands it in as `before`.
 */
export function cleanWithStrays(
  repo: string,
  scanned: ScannedWorktree[],
  judged: DeleteOptions,
  say: (line: string) => void,
  before: readonly StrayFolder[] = strayParkedFolders(
    repo,
    judged.env,
    scanned.map((worktree) => worktree.listed),
  ),
): CleanWithStraysReport {
  const report = cleanFinished(repo, scanned, judged, say);
  const after = strayParkedFolders(
    repo,
    judged.env,
    scanned.map((worktree) => worktree.listed),
  );
  const union = new Map<string, StrayFolder>();
  for (const stray of [...before, ...after]) union.set(realPath(stray.path), stray);
  return { report, strays: finishStrays(repo, judged, say, [...union.values()]) };
}
