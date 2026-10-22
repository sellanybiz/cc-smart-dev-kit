/**
 * What a crew session's branch changed against the base it started from: the files it touched, the
 * lines it added and removed, and the ones its brief did not name.
 *
 * **One reader, one home.** The numbers come from `git diff --numstat -z --no-renames <base>
 * HEAD` in the crew session's own worktree: one record per file, `added<TAB>deleted<TAB>path<NUL>`.
 * `-z` keeps a path with a space, a quote or a line break whole; `--no-renames` makes a renamed
 * file its two paths (the old one gone, the new one added), so every record is one plain path.
 * A binary file shows `-` for both counts: it counts as a file, with no lines. Nothing is
 * measured here: this module only reads git's own output.
 *
 * **A diff git cannot give is an error, never "nothing changed"**: a report that says no file
 * changed because the base was gone would mislead the lead's gate (D22).
 */
import { runGit } from "../hooks/git";
import type { Env } from "./context";

/** How long one git call may take (a `diff`). */
const GIT_TIMEOUT_MS = 20_000;

/** One changed file, as git's numstat counts it. */
export interface DiffFile {
  /** The lines added; null for a binary file, whose lines cannot be counted. */
  added: null | number;
  /** The lines removed; null for a binary file. */
  deleted: null | number;
  /** The path, as git names it. */
  path: string;
}

/** What a diff against the base found. */
export interface DiffFacts {
  /** Every changed file, in git's own order. */
  byFile: DiffFile[];
  /** The files that changed. */
  files: number;
  /** The lines added. */
  insertions: number;
  /** The lines removed. */
  deletions: number;
  /** Each changed file's path, as git names it. */
  paths: string[];
}

/** A diff git could not give, with git's own words. */
export class DiffError extends Error {
  override name = "DiffError";
}

/**
 * One record of `git diff --numstat -z`: the lines added, the lines removed, and the path. A
 * binary file shows `-` for both counts, which reads as null: it is a changed file whose lines
 * cannot be counted, never a file that changed no line.
 */
function numstatRecord(record: string): DiffFile | null {
  const found = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(record);
  if (found?.[1] === undefined || found[2] === undefined || found[3] === undefined) return null;
  return {
    added: found[1] === "-" ? null : Number(found[1]),
    deleted: found[2] === "-" ? null : Number(found[2]),
    path: found[3],
  };
}

/**
 * What `base`..`HEAD` changed in `folder`: the counts, the paths and each file's own counts.
 * Throws `DiffError` when git cannot give the diff (no git, a base that is gone, a folder that
 * is no worktree), or prints a record this reader cannot read.
 */
export function diffAgainstBase(folder: string, baseSha: string, env: Env): DiffFacts {
  const run = runGit(
    folder,
    ["diff", "--numstat", "-z", "--no-renames", baseSha, "HEAD"],
    env,
    GIT_TIMEOUT_MS,
  );
  if (!run.ok) {
    throw new DiffError(
      `git diff ${baseSha.slice(0, 7)}..HEAD failed in ${folder}: ${run.err === "" ? "no reason given" : run.err}`,
    );
  }
  let insertions = 0;
  let deletions = 0;
  const byFile: DiffFile[] = [];
  for (const record of run.out.split("\0")) {
    if (record === "") continue;
    const one = numstatRecord(record);
    if (one === null) {
      throw new DiffError(`git diff printed a record this reader cannot read: ${record}`);
    }
    insertions += one.added ?? 0;
    deletions += one.deleted ?? 0;
    byFile.push(one);
  }
  return {
    byFile,
    deletions,
    files: byFile.length,
    insertions,
    paths: byFile.map((one) => one.path),
  };
}

/**
 * The changed files the brief did not name: the ones no pattern of the brief's `--files` list
 * matches. A pattern is a glob (`src/crew/**`); a pattern with no wildcard names a file or a
 * folder, and a folder names everything under it.
 *
 * **A brief that names no file names no boundary:** nothing is outside it, so the list is empty
 * and the report says nothing about files. (The lead reads the changed count for the size of the
 * change.)
 */
export function outsideBrief(paths: readonly string[], patterns: readonly string[]): string[] {
  if (patterns.length === 0) return [];
  const globs = patterns.map((pattern) => new Bun.Glob(pattern));
  return paths.filter(
    (path) =>
      !patterns.some((pattern, index) => matchesPattern(path, pattern, globs[index] as Bun.Glob)),
  );
}

/** True when `path` is the file or is under the folder `pattern` names. */
function matchesPattern(path: string, pattern: string, glob: Bun.Glob): boolean {
  if (path === pattern) return true;
  if (pattern.endsWith("/")) return path.startsWith(pattern);
  if (!/[*?[\]{}]/.test(pattern)) return path.startsWith(`${pattern}/`);
  return glob.match(path);
}
