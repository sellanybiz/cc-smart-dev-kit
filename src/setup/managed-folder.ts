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
 * A folder something else reads while it is rewritten (git reads the kit's hooks folder during a
 * commit) is written by `writeManagedFiles` instead: the same record and checks, but an update
 * rewrites each file in place (temp file and rename), so the folder is never missing.
 *
 * It is build output, so there is **no backup**: `restore` removes the folder whole. That is why
 * the record is its own file and not a `changed.json` kind — a `changed.json` kind is read by
 * every cc-smart-dev-kit, and a running older CLI refuses one it does not know (the same rule as
 * the managed hook entries, `managed-hook.ts`).
 */

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
  "cc-smart-dev-kit made this folder and writes every file in it; `cc-smart-dev-kit restore` removes it.\n";

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

/** What a folder is to hold: the names of its files, and the bytes of each. */
interface Content {
  /** Relative paths with `/`, sorted. */
  names: readonly string[];
  read: (name: string) => Buffer;
}

/** The files of the folder `source`, read when asked. */
function contentOfFolder(source: string): Content {
  return {
    names: listFiles(source),
    read: (name) => readFileSync(join(source, ...name.split("/"))),
  };
}

/** Files held in memory: their text, by name. */
function contentOfFiles(files: ReadonlyMap<string, string>): Content {
  return {
    names: [...files.keys()].sort(),
    read: (name) => Buffer.from(files.get(name) ?? ""),
  };
}

/**
 * True when `file` is there with exactly `bytes` and, when `mode` is given, that mode — except
 * on Windows, where a mode is no protection and `statSync` makes one up (`file-mode.ts`). The one
 * meaning of "the same file" for a folder's check and for an in-place rewrite.
 */
function sameFile(file: string, bytes: Buffer, mode: number | undefined): boolean {
  if (!existsSync(file)) return false;
  if (mode !== undefined && hostPlatform() !== "win32" && (statSync(file).mode & 0o777) !== mode) {
    return false;
  }
  return readFileSync(file).equals(bytes);
}

/**
 * True when `target` is ours and holds exactly the files of `content`, each the same
 * (`sameFile`).
 */
function sameFolder(target: string, content: Content, mode: number | undefined): boolean {
  const files = content.names;
  if (!existsSync(target) || !markedOwned(target)) return false;
  const have = listFiles(target).filter((file) => file !== OWNED_FOLDER_MARK);
  if (have.length !== files.length || have.some((file, index) => file !== files[index])) {
    return false;
  }
  return files.every((file) => sameFile(join(target, file), content.read(file), mode));
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

/** Writes `content` into the new folder `into`, each file with `mode`; the mark is never executable. */
function copyFolder(content: Content, into: string, mode: number): void {
  for (const file of content.names) {
    const to = join(into, ...file.split("/"));
    mkdirSync(dirname(to), { recursive: true, mode: DIR_MODE });
    writeFileSync(to, content.read(file), { mode });
    setFileMode(to, mode); // the umask may have changed the bits
  }
  // A folder with no file at all still exists as a folder.
  mkdirSync(into, { recursive: true, mode: DIR_MODE });
  writeFileSync(join(into, OWNED_FOLDER_MARK), OWNED_FOLDER_MARK_TEXT, { mode: FILE_MODE });
  setFileMode(join(into, OWNED_FOLDER_MARK), FILE_MODE);
}

/** How a folder that is there already is brought to the new content. */
type Update = "swap" | "in-place";

/**
 * The one writer behind `writeManagedFolder` and `writeManagedFiles`: the record, the check
 * that the folder is ours, the dry run, and a new folder built beside its place and renamed in.
 * Only an update differs: `swap` replaces the whole folder, `in-place` rewrites its files.
 */
function writeFolder(
  target: string,
  content: Content,
  options: ManagedFolderOptions,
  update: Update,
): ManagedFolderResult {
  const real = realTarget(target);
  const mode = options.fileMode ?? FILE_MODE;
  const count = content.names.length;
  if (sameFolder(real, content, options.fileMode)) {
    // A folder that is already right but unrecorded (a crash before the record): record it.
    if (!options.dryRun) recordOwnedFolder(options.stateDir, real);
    return { files: count, outcome: "unchanged" };
  }
  const hadOld = existsSync(real);
  const outcome = hadOld ? "updated" : "created";
  // A folder already at that path that cc-smart-dev-kit did not make is the person's: never
  // replaced or rewritten (a replace removes the old folder).
  if (hadOld && !markedOwned(real)) {
    throw new Error(
      `${real} is not a folder cc-smart-dev-kit made (it has no ${OWNED_FOLDER_MARK}): move it away, then run this again`,
    );
  }
  if (options.dryRun) return { files: count, outcome };
  recordOwnedFolder(options.stateDir, real);
  if (hadOld && update === "in-place") {
    rewriteFiles(real, content, options.fileMode);
    return { files: count, outcome };
  }
  const token = `${process.pid}-${crypto.randomUUID()}`;
  const temp = join(dirname(real), `.${basename(real)}.cc-smart-dev-kit-tmp-${token}`);
  const old = join(dirname(real), `.${basename(real)}.cc-smart-dev-kit-old-${token}`);
  try {
    copyFolder(content, temp, mode);
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
  return { files: count, outcome };
}

/**
 * Brings the files of the folder `real` (ours) to `content`, one file at a time: each is written
 * to a temp file beside it and renamed over it, so a reader sees the old file or the new one and
 * never a missing one; the folder itself is never renamed. Only a file that differs is written.
 * Files `content` does not hold go last, so the folder is complete while they are removed.
 */
function rewriteFiles(real: string, content: Content, mode: number | undefined): void {
  for (const name of content.names) {
    const file = join(real, ...name.split("/"));
    const bytes = content.read(name);
    if (sameFile(file, bytes, mode)) continue;
    // With no mode asked for, a file keeps the one it has (a new file gets the default).
    const keep = existsSync(file) ? statSync(file).mode & 0o777 : FILE_MODE;
    atomicWrite(file, bytes.toString("utf8"), mode ?? keep);
  }
  const wanted = new Set(content.names.map((name) => name.split("/")[0]));
  for (const entry of readdirSync(real)) {
    if (entry !== OWNED_FOLDER_MARK && !wanted.has(entry)) {
      rmSync(join(real, entry), { force: true, recursive: true });
    }
  }
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
  return writeFolder(target, contentOfFolder(source), options, "swap");
}

/**
 * `writeManagedFolder` for files held in memory (name to text), for a folder something else may
 * be using as it is rewritten: git reads the kit's hooks folder while a commit runs. A new
 * folder is built beside its place and renamed in, like the swap; an update rewrites each file
 * in place (`rewriteFiles`), so no moment has the folder missing or a name absent. A dry run
 * writes nothing at all, not even a temporary file.
 */
export function writeManagedFiles(
  target: string,
  files: ReadonlyMap<string, string>,
  options: ManagedFolderOptions,
): ManagedFolderResult {
  return writeFolder(target, contentOfFiles(files), options, "in-place");
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
