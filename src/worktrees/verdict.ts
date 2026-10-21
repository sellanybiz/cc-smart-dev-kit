/**
 * Which git worktrees are finished, and may be removed.
 *
 * Every session works in a worktree of its own, and is meant to remove it once its work is
 * merged. Claude Code makes them under `<repo>/.claude/worktrees/`. Sessions forget, crash, or
 * end before the merge, so finished worktrees pile up.
 *
 * A worktree is FINISHED when removing it can lose nothing and disturb no one:
 *   - no running Claude session works in it;
 *   - no program runs from inside it, and none works in it — a dev server started there is
 *     one (`machine-facts.ts`);
 *   - no Docker container, running or stopped, mounts files from inside it;
 *   - every commit on it is on `origin/<base>`, or merging it into the base changes nothing
 *     (a squash or a rebase merge leaves the work there under a commit of its own);
 *   - git has not touched it for an hour — a worktree made a minute ago is not finished, its
 *     session simply has not moved into it yet;
 *   - nothing in it is uncommitted, untracked files included, and no ignored file that
 *     cannot come back (`localFiles` in `../hooks/local-files.ts`).
 *
 * Its ignored files go with it: dependency folders, build output, caches.
 *
 * The functions here take plain values and touch no disk, so they can be tested.
 * `scan.ts` gathers the facts and removes; `command.ts` is the command.
 *
 * ONE OTHER JUDGMENT NAMES THE SAME QUESTIONS: `judgeWorktree`
 * (`src/hooks/worktree-leftovers.ts`), for the SessionStart note. It checks the same things
 * EXCEPT the machine's facts (Docker containers, running programs) — a session start must
 * stay quick, and listing those can wait seconds. The two agree on everything else, and the
 * difference is safe because the note removes nothing: it sends the person to
 * `cc-smart-dev-kit worktrees --clean`, which judges every worktree again, here.
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
   * How the commits ahead are on the base branch anyway, or null when they are not known to
   * be there. A merge that rebases, cherry-picks or squashes leaves the work on the base
   * under a commit of its own, so the base's own history says nothing about it
   * (`scan.ts` replays the branch onto the base, and asks `git cherry` and the pull request).
   */
  mergedBy: MergedBy | null;
  /**
   * The version of git on this machine when it is too old to replay a branch onto the base
   * (`MIN_MERGE_TREE_GIT`), so the reason can say why the work could not be proven to be on
   * the base. Null when git is new enough, or when its version cannot be read.
   */
  gitTooOld: string | null;
  /**
   * The file names of the programs running from inside it (`programsInside`). "unknown" when
   * the running programs could not be listed.
   */
  programs: "unknown" | string[];
  /** The running Claude session that works in it. */
  sessionName: null | string;
}

/**
 * How the work on a worktree is on the base branch although its own commits are not ancestors
 * of it: "cherry" — `git cherry` finds every commit there under another sha (a rebase or a
 * cherry-pick merge); "replay" — merging the branch into the base changes nothing, so the
 * base already holds the work (a squash merge leaves ONE commit of its own on the base, and
 * none of the branch's); "pull request" — its pull request is merged, and the branch holds
 * nothing more than what it merged.
 */
export type MergedBy = "cherry" | "pull request" | "replay";

/**
 * The git version that added `git merge-tree --write-tree` (git 2.38): the mode that says
 * what a merge comes out as, without a checkout. An older git cannot replay a branch onto
 * the base, so a squash merge cannot be seen on it and the worktree is kept.
 */
export const MIN_MERGE_TREE_GIT = "2.38.0";

/** What git finds in a worktree — the slow part, asked last. */
export interface WorktreeContents {
  /** Ignored files that cannot be rebuilt: removing the folder loses them. */
  localFiles: string[];
  /** Changed or untracked files git sees. */
  uncommitted: boolean;
}

export type Verdict =
  | {
      finished: false;
      /**
       * True when something may stop on its own — a program, a container, a session, a touch
       * a minute ago — so judging this worktree again later is worth it. False: the work in
       * it is not finished, and trying again changes nothing until that changes.
       */
      held: boolean;
      why: string;
    }
  /** `note` says why its commits ahead are on the base anyway, or null when there are none. */
  | { finished: true; note: string | null };

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
  if (facts.locked) {
    return { finished: false, held: false, why: "locked with `git worktree lock`" };
  }
  if (facts.sessionName !== null) {
    return {
      finished: false,
      held: true,
      why: `Claude session "${facts.sessionName}" works in it`,
    };
  }
  if (facts.programs !== "unknown" && facts.programs.length > 0) {
    return { finished: false, held: true, why: programsWhy(facts.programs) };
  }
  if (facts.containers !== "unknown" && facts.containers.length > 0) {
    return { finished: false, held: true, why: containersWhy(facts.containers) };
  }
  if (facts.innerWorktree !== null) {
    return {
      finished: false,
      held: false,
      why: `another worktree lives inside it: ${facts.innerWorktree}`,
    };
  }
  if (facts.aheadOfBase > 0 && facts.mergedBy === null) {
    const commits = facts.aheadOfBase === 1 ? "1 commit" : `${String(facts.aheadOfBase)} commits`;
    // A git too old to replay the branch onto the base cannot see a squash merge, so the
    // reason says so: the work may well be on the base, but nothing here can prove it.
    const tooOld =
      facts.gitTooOld === null
        ? ""
        : ` (git ${facts.gitTooOld} is too old to replay it onto ${facts.base}: git ${MIN_MERGE_TREE_GIT} or newer is needed)`;
    return { finished: false, held: false, why: `${commits} not on ${facts.base}${tooOld}` };
  }
  if (facts.idleMinutes < idleLimit) {
    return {
      finished: false,
      held: true,
      why: `git used it ${String(Math.floor(facts.idleMinutes))} min ago`,
    };
  }
  if (facts.programs === "unknown") {
    return {
      finished: false,
      held: true,
      why: "the running programs could not be listed, so it is unknown whether one runs from its files",
    };
  }
  if (facts.containers === "unknown") {
    return {
      finished: false,
      held: true,
      why: "Docker did not answer, so it is unknown whether a container uses its files — start Docker and run again",
    };
  }
  const found = contents();
  if (found.uncommitted) return { finished: false, held: false, why: "uncommitted changes" };
  if (found.localFiles.length > 0) {
    const shown = found.localFiles.slice(0, 3).join(", ");
    const more =
      found.localFiles.length > 3 ? ` and ${String(found.localFiles.length - 3)} more` : "";
    return {
      finished: false,
      held: false,
      why: `local files git does not keep: ${shown}${more}`,
    };
  }
  return { finished: true, note: mergedNote(facts) };
}

/**
 * Why the commits ahead are on the base anyway, as the line a person reads, or null when the
 * worktree has none: a removal takes the folder of a branch whose work is elsewhere, and the
 * line says where.
 */
function mergedNote(facts: WorktreeFacts): string | null {
  if (facts.mergedBy === null) return null;
  if (facts.mergedBy === "cherry") return `every commit is on ${facts.base} under another sha`;
  if (facts.mergedBy === "replay") return `merging it into ${facts.base} changes nothing`;
  return "its pull request is merged";
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
