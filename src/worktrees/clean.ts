/**
 * The clean itself: remove every finished worktree of a scan, with its branch, and forget the
 * ones whose folder is gone. The one home of that pass. `worktrees --clean` (`command.ts`)
 * prints each line it says; the background clean (`auto-clean.ts`) collects the same lines
 * and keeps the report. Neither judges anything here: the scan's verdict (`scan.ts`,
 * `verdict.ts`) decides, and `removeWorktree` judges the folder again right before it moves
 * it, so a removal never acts on a stale scan.
 */
import type { Server } from "node:net";
import { basename } from "node:path";
import { holdPort } from "../machine/hold-port";
import { LOCK_PORTS } from "../ports";
import {
  deleteMergedBranch,
  pruneWorktrees,
  removeWorktree,
  type ScannedWorktree,
  type ScanOptions,
} from "./scan";

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

/** What holds the clean's machine-wide lock: closing it lets go (a listening `Server`). */
export interface CleanLock {
  close(): unknown;
}

/** The machine-wide lock of a clean, or null when another clean holds it. */
export async function holdCleanLock(): Promise<null | Server> {
  const hold = await holdPort(LOCK_PORTS.worktreesClean);
  return "held" in hold ? hold.held : null;
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
 * why. `judged` is the options the scan ran with.
 */
export function cleanFinished(
  repo: string,
  scanned: ScannedWorktree[],
  judged: ScanOptions,
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
      say(`  ${deleteMergedBranch(repo, judged.base, worktree.listed.branch, judged.env)}`);
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
