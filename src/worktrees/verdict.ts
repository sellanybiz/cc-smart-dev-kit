/**
 * Which git worktrees are finished, and may be removed.
 *
 * Every session works in a worktree of its own beside the main checkout, and is meant to
 * remove it once its work is merged. Sessions forget, crash, or end before the merge, so
 * finished worktrees pile up beside the repo.
 *
 * A worktree is FINISHED when removing it can lose nothing and disturb no one:
 *   - no running Claude session works in it;
 *   - no program runs from inside it, and none works in it — a dev server started there is
 *     one (`machine-facts.ts`);
 *   - no Docker container, running or stopped, mounts files from inside it;
 *   - every commit on it is on `origin/<base>`;
 *   - git has not touched it for an hour — a worktree made a minute ago is not finished, its
 *     session simply has not moved into it yet;
 *   - nothing in it is uncommitted, untracked files included, and no ignored file that
 *     cannot come back (`localFiles` in `../hooks/local-files.ts`).
 *
 * Its ignored files go with it: dependency folders, build output, caches.
 *
 * The functions here take plain values and touch no disk, so they can be tested.
 * `scan.ts` gathers the facts and removes; `command.ts` is the command.
 */

/** What is known about one worktree before anyone asks git what is in it. */
export interface WorktreeFacts {
  /** Commits on it that `origin/<base>` does not have. */
  aheadOfBase: number;
  /** The branch it is judged against, for the messages. */
  base: string;
  /**
   * The Docker containers, running or stopped, that mount files from inside it
   * (`containersUsing`). "unknown" when Docker is installed but did not answer.
   */
  containers: "unknown" | string[];
  /** Minutes since git last wrote to it. */
  idleMinutes: number;
  /**
   * Another worktree that lives INSIDE this one — Claude Code puts its own under
   * `.claude/worktrees/`, and git's exclude file hides them from `git status`. Removing the
   * outer folder deletes it too.
   */
  innerWorktree: null | string;
  locked: boolean;
  /**
   * The file names of the programs running from inside it (`programsInside`). "unknown" when
   * the running programs could not be listed.
   */
  programs: "unknown" | string[];
  /** The running Claude session that works in it. */
  sessionName: null | string;
}

/** What git finds in a worktree — the slow part, asked last. */
export interface WorktreeContents {
  /** Ignored files that cannot be rebuilt: removing the folder loses them. */
  localFiles: string[];
  /** Changed or untracked files git sees. */
  uncommitted: boolean;
}

export type Verdict = { finished: false; why: string } | { finished: true };

/** How long git must have left a worktree alone before it counts as finished. */
export const IDLE_MINUTES = 60;

/**
 * May this worktree go? Each reason to keep it is checked in turn, and the first one found is
 * the answer. `contents` runs `git status` — the slow part — so it is asked last, and only
 * when everything else already says yes.
 *
 * `idleLimit` 0 is for a session removing the worktree it has just finished in: it says
 * itself that the work is done, so a recent touch is no reason to keep it.
 */
export function verdict(
  facts: WorktreeFacts,
  contents: () => WorktreeContents,
  idleLimit: number = IDLE_MINUTES,
): Verdict {
  if (facts.locked) return { finished: false, why: "locked with `git worktree lock`" };
  if (facts.sessionName !== null) {
    return { finished: false, why: `Claude session "${facts.sessionName}" works in it` };
  }
  if (facts.programs !== "unknown" && facts.programs.length > 0) {
    return { finished: false, why: programsWhy(facts.programs) };
  }
  if (facts.containers !== "unknown" && facts.containers.length > 0) {
    return { finished: false, why: containersWhy(facts.containers) };
  }
  if (facts.innerWorktree !== null) {
    return { finished: false, why: `another worktree lives inside it: ${facts.innerWorktree}` };
  }
  if (facts.aheadOfBase > 0) {
    const commits = facts.aheadOfBase === 1 ? "1 commit" : `${String(facts.aheadOfBase)} commits`;
    return { finished: false, why: `${commits} not on ${facts.base}` };
  }
  if (facts.idleMinutes < idleLimit) {
    return { finished: false, why: `git used it ${String(Math.floor(facts.idleMinutes))} min ago` };
  }
  if (facts.programs === "unknown") {
    return {
      finished: false,
      why: "the running programs could not be listed, so it is unknown whether one runs from its files",
    };
  }
  if (facts.containers === "unknown") {
    return {
      finished: false,
      why: "Docker did not answer, so it is unknown whether a container uses its files — start Docker and run again",
    };
  }
  const found = contents();
  if (found.uncommitted) return { finished: false, why: "uncommitted changes" };
  if (found.localFiles.length > 0) {
    const shown = found.localFiles.slice(0, 3).join(", ");
    const more =
      found.localFiles.length > 3 ? ` and ${String(found.localFiles.length - 3)} more` : "";
    return { finished: false, why: `local files git does not keep: ${shown}${more}` };
  }
  return { finished: true };
}

export function containersWhy(names: string[]): string {
  const shown = names
    .slice(0, 3)
    .map((name) => `"${name}"`)
    .join(", ");
  if (names.length === 1) return `Docker container ${shown} uses its files`;
  const more = names.length > 3 ? ` and ${String(names.length - 3)} more` : "";
  return `Docker containers ${shown}${more} use its files`;
}

export function programsWhy(names: string[]): string {
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${String(names.length - 3)} more` : "";
  return names.length === 1
    ? `a program runs from its files: ${shown}`
    : `programs run from its files: ${shown}${more}`;
}
