/**
 * A folder cc-smart-dev-kit owns whole: the portal's Next.js export, copied beside the portal's
 * own copy in `~/.local/share/cc-smart-dev-kit/portal-ui/` (D49, B6p).
 *
 * A folder is not a file, and `writeManagedFile` is about one file's text. So this module does
 * what that one does for a file, for a folder:
 *
 *   1. **The record comes first.** The folder's path goes into `<stateDir>/owned-folders.json`
 *      before the swap, so a crash right after it never leaves a folder `restore` cannot see.
 *   2. **A whole new folder beside the old one**, written file by file, never over the files a
 *      running server may be reading.
 *   3. **The swap**: the old folder is renamed aside, the new one renamed into its place, the
 *      old one removed. A reader sees the old folder or the new one, never half of one.
 *
 * It is build output, so there is **no backup**: `restore` removes the folder whole. That is why
 * the record is its own file and not a `changed.json` kind — a `changed.json` kind is read by
 * every cc-smart-dev-kit, and a running older CLI refuses one it does not know (the same rule as
 * the managed hook entries, `managed-hook.ts`).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { hostPlatform } from "../machine/host";
import { setFileMode } from "./file-mode";
import { atomicWrite, realTarget } from "./write";

/** The record of the folders cc-smart-dev-kit owns: `<stateDir>/owned-folders.json`. */
const OWNED_FOLDERS_FILE = "owned-folders.json";

/** Files are build output: readable by everyone, never executable unless the caller says so. */
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

/**
 * The file that marks a folder as one cc-smart-dev-kit made. A folder is replaced or removed
 * only while it holds this file: the record names a path, and a record that names any other
 * folder (a broken or edited `owned-folders.json`, a folder a person put at that path) must
 * never lead to a recursive delete of it.
 */
export const OWNED_FOLDER_MARK = ".cc-smart-dev-kit-owned";

const OWNED_FOLDER_MARK_TEXT =
  "cc-smart-dev-kit made this folder and replaces it whole; `cc-smart-dev-kit restore` removes it.\n";

/** True when `folder` holds the mark: cc-smart-dev-kit made it. */
function markedOwned(folder: string): boolean {
  return existsSync(join(folder, OWNED_FOLDER_MARK));
}

/** One folder write's outcome: `unchanged` writes nothing at all. */
export interface ManagedFolderResult {
  /** How many files the source holds. */
  files: number;
  outcome: "created" | "unchanged" | "updated";
}

export interface ManagedFolderOptions {
  /** Write nothing; answer what a real run would do. */
  dryRun?: boolean;
  /**
   * The mode of every file but the folder's own mark (`0o755` for a folder of scripts). Left
   * out: `0o644`, and a folder whose bytes match is `unchanged` whatever its modes are. Given:
   * a folder whose files have another mode is `updated` (except on Windows, where a mode is
   * no protection and `statSync` makes one up: `file-mode.ts`).
   */
  fileMode?: number;
  stateDir: string;
}

/** Every file under `folder`, as relative paths with `/`, sorted. */
function listFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

/** The SHA-256 of a file's bytes, base64: what "the same file" means here. */
function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("base64");
}

/**
 * True when `target` is ours and holds exactly the files of `source`, with the same bytes and,
 * when `mode` is given, the same mode on every file.
 */
function sameFolder(
  target: string,
  source: string,
  files: readonly string[],
  mode: number | undefined,
): boolean {
  if (!existsSync(target) || !markedOwned(target)) return false;
  const have = listFiles(target).filter((file) => file !== OWNED_FOLDER_MARK);
  if (have.length !== files.length || have.some((file, index) => file !== files[index])) {
    return false;
  }
  if (mode !== undefined && hostPlatform() !== "win32") {
    if (files.some((file) => (statSync(join(target, file)).mode & 0o777) !== mode)) return false;
  }
  return files.every((file) => hashFile(join(target, file)) === hashFile(join(source, file)));
}

/** The record file; a state folder that cannot be read is an error, as `changed.json` is. */
export function ownedFoldersFile(stateDir: string): string {
  return join(stateDir, OWNED_FOLDERS_FILE);
}

/** The real paths of the folders cc-smart-dev-kit owns, sorted. */
export function readOwnedFolders(stateDir: string): string[] {
  const file = ownedFoldersFile(stateDir);
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const folders = (parsed as { folders?: unknown } | null)?.folders;
  if (!Array.isArray(folders) || !folders.every((one) => typeof one === "string")) {
    throw new Error(`Invalid ${file}: expected { "folders": [<path>, …] }`);
  }
  return [...folders].sort();
}

function writeOwnedFolders(stateDir: string, folders: readonly string[]): void {
  mkdirSync(stateDir, { recursive: true });
  atomicWrite(
    ownedFoldersFile(stateDir),
    `${JSON.stringify({ folders: [...folders].sort() }, null, 2)}\n`,
    0o600,
  );
}

/** Records `folder` as owned, before its first write. Returns true when the record changed. */
function recordOwnedFolder(stateDir: string, folder: string): boolean {
  const folders = readOwnedFolders(stateDir);
  if (folders.includes(folder)) return false;
  writeOwnedFolders(stateDir, [...folders, folder]);
  return true;
}

/** Drops `folder` from the record: it is gone, so there is nothing to restore. */
function forgetOwnedFolder(stateDir: string, folder: string): void {
  const folders = readOwnedFolders(stateDir);
  if (!folders.includes(folder)) return;
  writeOwnedFolders(
    stateDir,
    folders.filter((one) => one !== folder),
  );
}

/** Copies `source`'s files into the new folder `into`, each with `mode`; the mark is never executable. */
function copyFolder(source: string, into: string, files: readonly string[], mode: number): void {
  for (const file of files) {
    const to = join(into, ...file.split("/"));
    mkdirSync(dirname(to), { recursive: true, mode: DIR_MODE });
    writeFileSync(to, readFileSync(join(source, ...file.split("/"))), { mode });
    setFileMode(to, mode); // the umask may have changed the bits
  }
  // A folder with no file at all still exists as a folder.
  mkdirSync(into, { recursive: true, mode: DIR_MODE });
  writeFileSync(join(into, OWNED_FOLDER_MARK), OWNED_FOLDER_MARK_TEXT, { mode: FILE_MODE });
  setFileMode(join(into, OWNED_FOLDER_MARK), FILE_MODE);
}

/**
 * Writes `source` into `target` as a folder cc-smart-dev-kit owns, atomically: a new folder
 * beside the old one, then the swap. The same files with the same bytes write nothing.
 *
 * A failure leaves the old folder as it was, and throws: the caller decides whether its work
 * can go on without the new folder.
 */
export function writeManagedFolder(
  target: string,
  source: string,
  options: ManagedFolderOptions,
): ManagedFolderResult {
  const real = realTarget(target);
  const files = listFiles(source);
  if (sameFolder(real, source, files, options.fileMode)) {
    // A folder that is already right but unrecorded (a crash before the record): record it.
    if (!options.dryRun) recordOwnedFolder(options.stateDir, real);
    return { files: files.length, outcome: "unchanged" };
  }
  const outcome = existsSync(real) ? "updated" : "created";
  // A folder already at that path that cc-smart-dev-kit did not make is the person's: never
  // replaced (a replace removes the old folder).
  if (outcome === "updated" && !markedOwned(real)) {
    throw new Error(
      `${real} is not a folder cc-smart-dev-kit made (it has no ${OWNED_FOLDER_MARK}): move it away, then run this again`,
    );
  }
  if (options.dryRun) return { files: files.length, outcome };
  recordOwnedFolder(options.stateDir, real);
  const token = `${process.pid}-${crypto.randomUUID()}`;
  const temp = join(dirname(real), `.${basename(real)}.cc-smart-dev-kit-tmp-${token}`);
  const old = join(dirname(real), `.${basename(real)}.cc-smart-dev-kit-old-${token}`);
  try {
    copyFolder(source, temp, files, options.fileMode ?? FILE_MODE);
    const hadOld = existsSync(real);
    if (hadOld) renameSync(real, old);
    try {
      renameSync(temp, real);
    } catch (error) {
      // Put the old folder back. The rename of the new one failed, so nothing holds its name.
      if (hadOld && !existsSync(real)) renameSync(old, real);
      throw error;
    }
    if (hadOld) rmSync(old, { force: true, recursive: true });
  } catch (error) {
    rmSync(temp, { force: true, recursive: true });
    rmSync(old, { force: true, recursive: true });
    throw error;
  }
  return { files: files.length, outcome };
}

/**
 * Removes a folder cc-smart-dev-kit owns whole, and its record. No backup: it is build output,
 * and the next start copies it again. Returns true when a folder was there.
 */
export function removeManagedFolder(target: string, stateDir: string): boolean {
  const real = realTarget(target);
  // Only a folder that holds the mark is removed: a record naming any other folder is
  // dropped, and that folder is left exactly as it is.
  const ours = existsSync(real) && markedOwned(real);
  if (ours) rmSync(real, { force: true, recursive: true });
  forgetOwnedFolder(stateDir, real);
  return ours;
}
