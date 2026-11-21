/**
 * The files in a worktree that git does not keep and that removing the worktree would lose.
 *
 * `git worktree remove` (without `--force`) refuses a worktree with changed or untracked
 * files, but deletes ignored files without a word: a `.env.local` edited after the copy, a
 * local notes file, a key. So the plugin asks git for the ignored files too
 * (`git status --porcelain --ignored`), and drops only what is safe to lose:
 *
 * - what comes back by itself — dependency folders, build output, caches — and the logs a
 *   tool or an app writes as it runs: a `logs/` folder, a `.log` file (`REBUILDABLE`);
 * - a file the main checkout holds byte for byte at the same place (a `.worktreeinclude`
 *   copy nobody changed): the main checkout keeps it;
 * - a regular file still present in main whose time shows an untouched setup copy;
 * - a folder git names as one entry whose every file is one of the above.
 *
 * Everything else counts, because nobody can say whether someone still needs it.
 */
import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
} from "node:fs";
import { join } from "node:path";
import { loadCcSmartDevKitConfig } from "../project/config";
import { CONFIG_PATH } from "../project/resolve";
import { reflogEntryTime, runGit, worktreeAdminDir } from "./git";
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
  // Supabase CLI cmd/root.go checkUpgrade/shouldFetchRelease writes this version-check
  // cache when missing (read 2026-10-24); internal/utils/misc.go names CliVersionPath:
  // https://github.com/supabase/cli/blob/develop/apps/cli-go/cmd/root.go
  // Never exempt its parent: .temp also holds project-ref and pooler-url link state.
  /(?:^|\/)supabase\/\.temp\/cli-latest$/,
  // Caches.
  /(?:^|\/)(?:\.cache|\.vite|\.eslintcache|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.hypothesis|\.terraform|\.dart_tool)\/?$/,
  /\.(?:tsbuildinfo|pyc|pyo)$/,
  /(?:^|\/)\.DS_Store$/,
  /(?:^|\/)Thumbs\.db$/,
  // Next.js writes this file on every dev start and build, and its own header says not to
  // edit it. A file only: a folder of that name is read, never taken whole.
  /(?:^|\/)next-env\.d\.ts$/,
  // Package manager logs.
  /(?:^|\/)(?:npm-debug|yarn-debug|yarn-error|pnpm-debug|lerna-debug)\.log/,
  // Logs: a `logs/` folder and a `.log` file, at any depth. Only what git ignores is judged
  // here, so a tracked file of either name is never at stake.
  /(?:^|\/)logs\/$/,
  /\.log$/,
];

/** How many files of one ignored folder are compared with the main checkout before giving up. */
const MAX_COMPARED = 2000;

// Claude Code copies include files after `git worktree add`, using copyFile or a new
// stream + rename, without restoring mtime (2.1.322). Allow that copy step two minutes.
const INCLUDE_COPY_SLACK_MS = 120_000;
const FIRST_REFLOG_BYTES = 4096;

/** The earliest setup witness survives reflog expiry and `git worktree move`. */
function setupTime(worktree: string): number | null {
  const admin = worktreeAdminDir(worktree);
  if (admin === null) return null;
  const times: number[] = [];
  try {
    const time = lstatSync(join(admin, "commondir")).mtimeMs;
    if (Number.isFinite(time)) times.push(time);
  } catch {
    // A missing witness grants nothing; the first reflog entry may still prove setup.
  }
  try {
    const fd = openSync(join(admin, "logs", "HEAD"), "r");
    try {
      // Only the first entry matters. A later checkout, reset or reflog rewrite is not setup.
      const buffer = Buffer.alloc(FIRST_REFLOG_BYTES);
      const size = readSync(fd, buffer, 0, buffer.length, 0);
      const text = buffer.toString("utf8", 0, size);
      const end = text.indexOf("\n");
      if (end !== -1 || size < buffer.length) {
        const time = reflogEntryTime(end === -1 ? text : text.slice(0, end));
        if (time !== null) times.push(time);
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // An unreadable or malformed log grants nothing; commondir may still prove setup.
  }
  return times.length === 0 ? null : Math.min(...times);
}

/** Only regular files present in main can be untouched setup copies; never links or folders. */
function untouchedCopy(worktree: string, mainCheckout: string, entry: string): boolean {
  try {
    const here = lstatSync(join(worktree, entry));
    if (!here.isFile() || !lstatSync(join(mainCheckout, entry)).isFile()) return false;
    const setup = setupTime(worktree);
    return setup !== null && here.mtimeMs <= setup + INCLUDE_COPY_SLACK_MS;
  } catch {
    return false;
  }
}

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
 * Project patterns only widen the disposable ignored-entry rule. A missing or unusable
 * project file proves nothing safe, so keep the built-in policy in that case.
 */
export function projectRebuildable(mainCheckout: string | null): Bun.Glob[] {
  if (mainCheckout === null) return [];
  try {
    const patterns =
      loadCcSmartDevKitConfig(join(mainCheckout, CONFIG_PATH))?.worktrees?.rebuildable ?? [];
    return patterns.map((pattern) => new Bun.Glob(`**/${pattern}`));
  } catch {
    // Invalid or too-new config grants no additional permission to lose local files.
    return [];
  }
}

/** The one disposable-entry policy, shared by removal and explicit archival. */
export function safeIgnoredEntry(
  worktree: string,
  mainCheckout: string | null,
  entry: string,
): boolean {
  return safeEntry(worktree, mainCheckout, entry, projectRebuildable(mainCheckout));
}

/** Judge an entry using the project patterns already read for this walk. */
export function safeEntry(
  worktree: string,
  mainCheckout: string | null,
  entry: string,
  patterns: readonly Bun.Glob[],
): boolean {
  if (patterns.some((pattern) => pattern.match(entry))) return true;
  if (REBUILDABLE.some((pattern) => pattern.test(entry))) {
    if (!entry.endsWith("/cli-latest")) return true;
    try {
      if (lstatSync(join(worktree, entry)).isFile()) return true;
    } catch {
      return false;
    }
  }
  return (
    mainCheckout !== null &&
    (sameAsMain(worktree, mainCheckout, entry) || untouchedCopy(worktree, mainCheckout, entry))
  );
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
  patterns: readonly Bun.Glob[] = projectRebuildable(mainCheckout),
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
  const safe = (entry: string): boolean => safeEntry(worktree, mainCheckout, entry, patterns);
  // Git reports a folder that holds only ignored files as one entry (`server/` for a
  // `server/logs/` and a `server/vitest.log`). Such a folder is safe only when every entry
  // inside it is, judged one by one, so exempting one cache never exempts changed link state
  // beside it. Bound the walk and keep unreadable files and links, just as the main-copy
  // comparison does.
  const onlySafeInside = (entry: string): boolean => {
    if (!entry.endsWith("/")) return false;
    let budget = MAX_COMPARED;
    const visit = (path: string): boolean => {
      if (--budget < 0) return false;
      try {
        if (!lstatSync(join(worktree, path)).isDirectory()) return safe(path);
        // A folder is named the way git names one, ending in `/`: `logs/` matches inside too, and
        // a file's pattern (`.log`) never takes a folder whole.
        const folder = `${path.replace(/\/$/, "")}/`;
        return (
          safe(folder) ||
          readdirSync(join(worktree, path)).every((name) => visit(`${folder}${name}`))
        );
      } catch {
        return false;
      }
    };
    return visit(entry);
  };
  return parseIgnored(status.out).filter((entry) => !safe(entry) && !onlySafeInside(entry));
}
