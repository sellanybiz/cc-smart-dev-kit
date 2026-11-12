/**
 * Does a worktree hold uncommitted work that removing it would lose?
 *
 * `git status` lists every changed, staged, deleted and untracked file. Some of those are not
 * work only the folder has. A builder that never committed in its own folder, while its lead
 * committed the same files on the plan branch, leaves edits whose exact bytes are already on the
 * base. git still reads them as changes, because the folder's HEAD is the old commit.
 *
 * So uncommitted work counts as saved only when each piece of it is already in the history of
 * the ref (normally `origin/<base>`) after the folder's own HEAD, at the same path. "After HEAD"
 * is where the lead's commits are; a file put back to a version from before HEAD is a revert
 * someone made on purpose, and it keeps the folder.
 *   - each file in the folder that git reads as changed or untracked holds the exact bytes and
 *     file mode of a version that path had in some commit of that history. A path with a filter
 *     driver (`filter=` in `.gitattributes`, such as a notebook output stripper or Git LFS) is
 *     hashed as it is on disk, without the filter: a filter can drop bytes, and those bytes are
 *     the folder's alone. Line-ending conversion still applies, as checkout undoes it;
 *   - each staged version (the index) is such a version too;
 *   - each file the folder deleted, or a staged rename moved away, is gone from the ref as well.
 *
 * Anything else counts as unsaved: a conflict in progress, a symlink, a submodule, a nested
 * repository, a path git prints in a way this reader does not parse, or any git call that fails
 * or times out. "Unsaved" keeps the worktree, so every doubt keeps it.
 *
 * Ignored files are not here: `localFiles` (`local-files.ts`) judges those.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { runGit, runGitRaw } from "./git";
import type { Env } from "./run";

/** git's mode for a file that is not there: deleted from the index or the folder. */
const NO_FILE = "000000";
/** The two modes of a plain file. Symlinks (120000) and submodules (160000) never count as saved. */
const FILE_MODES = new Set(["100644", "100755"]);
/** Paths per git call, so a long list stays far below the system's argument limit. */
const PATHS_PER_CALL = 200;

/** What one `git status --porcelain=v2` entry asks of the ref's history. */
interface Wanted {
  /** Each path and the version (`<mode> <blob>`) it must have had in the ref's history. */
  versions: Array<{ path: string; version: string }>;
  /** Paths in the folder whose bytes must be hashed first: their version is not printed. */
  toHash: string[];
  /** Paths that must not exist on the ref. */
  absent: string[];
}

export interface UnsavedOptions {
  /**
   * Count each file the folder lacks as the removal's own work: a folder a removal moved aside
   * and could not finish (`-removing-`, D62) lost tracked files to that removal. Staged
   * deletions still need the ref to lack the file.
   */
  ownDeletions?: boolean;
}

/**
 * True when removing the folder would lose uncommitted work: something `git status` lists that
 * the history of `ref` does not already hold byte for byte. False for a clean folder.
 */
export function hasUnsavedChanges(
  folder: string,
  ref: string,
  env: Env,
  options: UnsavedOptions = {},
): boolean {
  return savedFingerprint(folder, ref, env, options) === null;
}

/**
 * The proof, kept for a second look: what the folder held when every piece of it proved saved
 * (`folderFingerprint`), or null when something is unsaved. A removal that forces git past its
 * own check compares it with `folderFingerprint` right before the removal, so a file written
 * or rewritten while the history was searched keeps the folder.
 */
export function savedFingerprint(
  folder: string,
  ref: string,
  env: Env,
  options: UnsavedOptions = {},
): null | string {
  const read = readFolder(folder, env, options);
  if (read === null) return null;
  const { wanted, versions, fingerprint } = read;
  if (!allAbsent(folder, ref, wanted.absent, env)) return null;
  return allInHistory(folder, ref, versions, env) ? fingerprint : null;
}

/**
 * What the folder holds now: `git status`, and the hash of each changed or untracked file in it.
 * Null when git cannot say or the status holds an entry that never counts as saved.
 */
export function folderFingerprint(
  folder: string,
  env: Env,
  options: UnsavedOptions = {},
): null | string {
  return readFolder(folder, env, options)?.fingerprint ?? null;
}

function readFolder(
  folder: string,
  env: Env,
  options: UnsavedOptions,
): {
  wanted: Wanted;
  versions: Array<{ path: string; version: string }>;
  fingerprint: string;
} | null {
  const status = runGitRaw(
    folder,
    ["--no-optional-locks", "status", "--porcelain=v2", "-z", "--untracked-files=all"],
    env,
  );
  if (!status.ok) return null;
  const wanted = readStatus(status.out, folder, options.ownDeletions === true);
  if (wanted === null) return null;
  const hashed = hashFiles(folder, wanted.toHash, env);
  if (hashed === null) return null;
  const fingerprint = [status.out, ...hashed.map((item) => `${item.path}\0${item.version}`)].join(
    "\0\0",
  );
  return { wanted, versions: [...wanted.versions, ...hashed], fingerprint };
}

/**
 * Reads `git status --porcelain=v2 -z`. Null when an entry is a conflict, a symlink or a
 * submodule, or cannot be read: each of those counts as unsaved.
 */
function readStatus(out: string, folder: string, ownDeletions: boolean): Wanted | null {
  const wanted: Wanted = { versions: [], toHash: [], absent: [] };
  const entries = out.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? "";
    if (entry === "") continue;
    const kind = entry[0];
    if (kind === "?") {
      const path = entry.slice(2);
      if (!isPlainFile(join(folder, path))) return null;
      wanted.toHash.push(path);
      continue;
    }
    if (kind !== "1" && kind !== "2") return null;
    // 1 XY sub mH mI mW hH hI path
    // 2 XY sub mH mI mW hH hI Xscore path, then the path it came from as the next entry
    const fields = entry.split(" ");
    const fixed = kind === "1" ? 8 : 9;
    if (fields.length <= fixed) return null;
    const [, xy = "", sub = "", , modeIndex = "", modeFolder = "", , hashIndex = ""] = fields;
    const path = fields.slice(fixed).join(" ");
    if (sub !== "N...") return null;
    const staged = xy[0] !== ".";
    const inFolder = xy[1] !== ".";
    if (staged && !wantVersion(wanted, path, modeIndex, hashIndex)) return null;
    if (inFolder) {
      if (modeFolder === NO_FILE) {
        if (!ownDeletions) wanted.absent.push(path);
      } else if (FILE_MODES.has(modeFolder) && isPlainFile(join(folder, path))) {
        wanted.toHash.push(path);
      } else return null;
    }
    if (kind === "2") {
      index++;
      const from = entries[index];
      if (from === undefined || from === "") return null;
      // A rename took this path away. Recreated in the folder, it is an entry of its own.
      if (!isPresent(join(folder, from))) wanted.absent.push(from);
    }
  }
  return wanted;
}

/** Adds the version a staged path must have had; false for a mode that never counts as saved. */
function wantVersion(wanted: Wanted, path: string, mode: string, hash: string): boolean {
  if (mode === NO_FILE) {
    wanted.absent.push(path);
    return true;
  }
  if (!FILE_MODES.has(mode)) return false;
  wanted.versions.push({ path, version: `${mode} ${hash}` });
  return true;
}

function isPlainFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function isPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The mode git gives a plain file in the folder, read from its execute bit. */
function fileMode(path: string): string {
  return (lstatSync(path).mode & 0o111) !== 0 ? "100755" : "100644";
}

/**
 * Each file's version as git would store it: its mode, and its blob. A path with a filter driver
 * is hashed on its bytes as they are (`--no-filters`); any other path goes through
 * `.gitattributes` the way `git add` would, so line endings match. Null when git cannot say.
 */
function hashFiles(
  folder: string,
  paths: string[],
  env: Env,
): Array<{ path: string; version: string }> | null {
  const filtered = filteredPaths(folder, paths, env);
  if (filtered === null) return null;
  const plain = paths.filter((path) => !filtered.has(path));
  const raw = paths.filter((path) => filtered.has(path));
  const versions: Array<{ path: string; version: string }> = [];
  for (const [list, flags] of [
    [plain, []],
    [raw, ["--no-filters"]],
  ] as const) {
    const hashed = hashChunks(folder, list, flags, env);
    if (hashed === null) return null;
    versions.push(...hashed);
  }
  return versions;
}

/**
 * The paths `.gitattributes` gives a filter driver or `ident` (which rewrites `$Id: …$` to
 * `$Id$`): both drop bytes on the way in. Null when git cannot say.
 */
function filteredPaths(folder: string, paths: string[], env: Env): Set<string> | null {
  const filtered = new Set<string>();
  for (const chunk of chunks(paths)) {
    const run = runGitRaw(folder, ["check-attr", "-z", "filter", "ident", "--", ...chunk], env);
    if (!run.ok) return null;
    // <path> NUL <attribute> NUL <value> NUL, for each path and attribute
    const parts = run.out.split("\0");
    for (let at = 0; at + 2 < parts.length; at += 3) {
      const value = parts[at + 2];
      if (value !== "unspecified" && value !== "unset") filtered.add(parts[at] ?? "");
    }
  }
  return filtered;
}

function hashChunks(
  folder: string,
  paths: string[],
  flags: readonly string[],
  env: Env,
): Array<{ path: string; version: string }> | null {
  const versions: Array<{ path: string; version: string }> = [];
  for (const chunk of chunks(paths)) {
    const run = runGit(folder, ["hash-object", ...flags, "--", ...chunk], env);
    if (!run.ok) return null;
    const hashes = run.out.split("\n");
    if (hashes.length !== chunk.length) return null;
    for (const [at, path] of chunk.entries()) {
      try {
        versions.push({ path, version: `${fileMode(join(folder, path))} ${hashes[at]}` });
      } catch {
        return null;
      }
    }
  }
  return versions;
}

/** True when none of the paths exists on the ref. */
function allAbsent(folder: string, ref: string, paths: string[], env: Env): boolean {
  for (const chunk of chunks(paths)) {
    const run = runGitRaw(
      folder,
      ["--literal-pathspecs", "ls-tree", "-r", "-z", "--name-only", ref, "--", ...chunk],
      env,
    );
    if (!run.ok) return false;
    const onRef = new Set(run.out.split("\0"));
    if (chunk.some((path) => onRef.has(path))) return false;
  }
  return true;
}

/**
 * True when each path had its version in some commit of the ref's history that the folder's HEAD
 * does not have. `git log --raw` prints the version each commit gave a path; a merge's own
 * resolution shows against its first parent, and the first commit against nothing (`--root`).
 */
function allInHistory(
  folder: string,
  ref: string,
  versions: Array<{ path: string; version: string }>,
  env: Env,
): boolean {
  const paths = [...new Set(versions.map((item) => item.path))];
  const seen = new Set<string>();
  for (const chunk of chunks(paths)) {
    const run = runGitRaw(
      folder,
      [
        "--literal-pathspecs",
        "log",
        "--format=",
        "--raw",
        "-z",
        "--no-abbrev",
        "--no-renames",
        "--root",
        "--diff-merges=first-parent",
        ref,
        "--not",
        "HEAD",
        "--",
        ...chunk,
      ],
      env,
    );
    if (!run.ok) return false;
    const tokens = run.out.split("\0");
    for (let at = 0; at < tokens.length - 1; at++) {
      const meta = (tokens[at] ?? "").replace(/^\n+/, "");
      if (!meta.startsWith(":")) continue;
      // :<old mode> <new mode> <old blob> <new blob> <status>, then the path
      const [, newMode, , newBlob] = meta.slice(1).split(" ");
      const path = tokens[at + 1] ?? "";
      seen.add(`${path}\0${newMode} ${newBlob}`);
      at++;
    }
  }
  return versions.every((item) => seen.has(`${item.path}\0${item.version}`));
}

function chunks(paths: string[]): string[][] {
  const out: string[][] = [];
  for (let at = 0; at < paths.length; at += PATHS_PER_CALL) {
    out.push(paths.slice(at, at + PATHS_PER_CALL));
  }
  return out;
}
