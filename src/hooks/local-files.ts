/**
 * The files in a worktree that git does not keep and that removing the worktree would lose.
 *
 * `git worktree remove` (without `--force`) refuses a worktree with changed or untracked
 * files, but deletes ignored files without a word: a `.env.local` edited after the copy, a
 * local notes file, a key. So the plugin asks git for the ignored files too
 * (`git status --porcelain --ignored`), and drops only what is safe to lose:
 *
 * - what comes back by itself: dependency folders, build output, caches, logs
 *   (`REBUILDABLE`);
 * - a file the main checkout holds byte for byte at the same place (a `.worktreeinclude`
 *   copy nobody changed): the main checkout keeps it.
 *
 * Everything else counts, because nobody can say whether someone still needs it.
 */
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "./git";
import type { Env } from "./run";

/**
 * Ignored entries that come back by themselves, as `git status --ignored` names them (a
 * folder ends in `/`), at any depth: dependency folders, build output, caches and logs of
 * the common tool chains.
 */
export const REBUILDABLE: readonly RegExp[] = [
  // Dependency folders.
  /(?:^|\/)(?:node_modules|bower_components|jspm_packages|\.venv|venv|\.tox|\.nox|\.bundle|\.gradle|\.pnpm-store|\.yarn\/cache)\/$/,
  // Build output.
  /(?:^|\/)(?:dist|build|out|target|coverage|\.next|\.nuxt|\.output|\.svelte-kit|\.turbo|\.vercel|\.parcel-cache|\.angular|storybook-static|test-results|playwright-report|htmlcov|\.nyc_output)\/$/,
  // Caches.
  /(?:^|\/)(?:\.cache|\.vite|\.eslintcache|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.hypothesis|\.terraform|\.dart_tool)\/?$/,
  /\.(?:tsbuildinfo|pyc|pyo)$/,
  /(?:^|\/)\.DS_Store$/,
  /(?:^|\/)Thumbs\.db$/,
  // Package manager logs.
  /(?:^|\/)(?:npm-debug|yarn-debug|yarn-error|pnpm-debug|lerna-debug)\.log/,
];

/** How many files of one ignored folder are compared with the main checkout before giving up. */
const MAX_COMPARED = 2000;

/** The entries `git status --porcelain -z --ignored` marks ignored (`!! path`). */
export function parseIgnored(porcelain: string): string[] {
  return porcelain
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3));
}

/**
 * True when `path` in the worktree and the same path in the main checkout hold the same
 * thing: the same bytes, the same link target, or (a folder) the same files, every one.
 * Anything it cannot read, or a folder too big to compare, is not the same.
 */
export function sameAsMain(worktree: string, mainCheckout: string, path: string): boolean {
  let budget = MAX_COMPARED;
  const same = (relative: string): boolean => {
    if (--budget < 0) return false;
    const here = join(worktree, relative);
    const there = join(mainCheckout, relative);
    try {
      const a = lstatSync(here);
      const b = lstatSync(there);
      if (a.isSymbolicLink() || b.isSymbolicLink()) {
        return (
          a.isSymbolicLink() && b.isSymbolicLink() && readlinkSync(here) === readlinkSync(there)
        );
      }
      if (a.isDirectory()) {
        return b.isDirectory() && readdirSync(here).every((entry) => same(join(relative, entry)));
      }
      return (
        a.isFile() &&
        b.isFile() &&
        a.size === b.size &&
        readFileSync(here).equals(readFileSync(there))
      );
    } catch {
      return false;
    }
  };
  return same(path.replace(/\/$/, ""));
}

/**
 * The ignored files and folders in `worktree` that removing it would lose, as git names
 * them (a folder ends in `/`). Null when git cannot list them: then nothing is proved safe.
 * `mainCheckout` null (a bare repo): no copy can be matched.
 */
export function localFiles(
  worktree: string,
  mainCheckout: string | null,
  env: Env,
): string[] | null {
  // `--untracked-files=normal`: an ignored folder is one entry, not every file in it (and a
  // `status.showUntrackedFiles` setting does not change that).
  const status = runGit(
    worktree,
    [
      "--no-optional-locks",
      "status",
      "--porcelain",
      "-z",
      "--ignored=traditional",
      "--untracked-files=normal",
    ],
    env,
    30_000,
  );
  if (!status.ok) return null;
  return parseIgnored(status.out).filter(
    (entry) =>
      !REBUILDABLE.some((pattern) => pattern.test(entry)) &&
      !(mainCheckout !== null && sameAsMain(worktree, mainCheckout, entry)),
  );
}
