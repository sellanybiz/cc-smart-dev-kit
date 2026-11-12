/**
 * Makes git's own activity in a test worktree look old: the epoch of every entry in its HEAD
 * log (what `idleMinutesOrNull` reads, `src/hooks/worktree-leftovers.ts`) and the file times
 * of its index, HEAD and HEAD log. Backdating only the file times is not enough: the idle
 * time comes from the log's last entry, because `git reflog expire` rewrites the file.
 */
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { worktreeAdminDir } from "../hooks/git";

/** The worktree's own folder in the main repository's `.git/worktrees/`. */
export function worktreeAdmin(worktree: string): string {
  const admin = worktreeAdminDir(worktree);
  if (admin === null) throw new Error(`${worktree} has no readable .git file`);
  return admin;
}

/** Makes git's own activity in `worktree` `minutes` old (an hour and a half by default). */
export function makeWorktreeIdle(worktree: string, minutes = 90): void {
  const admin = worktreeAdmin(worktree);
  const old = new Date(Date.now() - minutes * 60_000);
  const log = join(admin, "logs", "HEAD");
  writeFileSync(
    log,
    readFileSync(log, "utf8").replace(
      / \d+ ([+-]\d{4})\t/g,
      ` ${Math.floor(old.getTime() / 1000)} $1\t`,
    ),
  );
  for (const file of ["index", "HEAD", join("logs", "HEAD")]) {
    try {
      utimesSync(join(admin, file), old, old);
    } catch {
      // Not every worktree has every file.
    }
  }
}
