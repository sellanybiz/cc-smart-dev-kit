import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Backups live in the state folder, never beside the file: a settings file linked from a
 * dotfiles repo would get backups (with secrets in them) inside that repo, and a backup in
 * a bin folder would sit on PATH. Each file gets its own subfolder, named by its real path:
 * `<stateDir>/backups/<encodeURIComponent(real path)>/<name>.bak-anymodel-<UTC stamp>[-<n>][.absent|.mode-NNN]`.
 */
export const BACKUPS_DIR = "backups";
/** The middle of a backup's name: `<name>.bak-anymodel-<stamp>`. */
export const BACKUP_INFIX = ".bak-anymodel-";
/** A backup of a file that did not exist yet: restoring it removes the file. */
export const ABSENT_SUFFIX = ".absent";

/** The list of files setup changed, so restore knows where to look. */
const CHANGED_FILE = "changed.json";

/** How many symlinks realTarget follows before it gives up (a loop). */
const MAX_LINKS = 40;

/** A UTC stamp that sorts by time as text: 20261015T143005123Z. */
export function utcStamp(date = new Date()): string {
  return date.toISOString().replace(/[-:.]/g, "");
}

/**
 * The real path of `file`, with every symlink followed: a linked dotfile stays a link, and
 * its target gets the change. A file that does not exist yet gets the real path of its
 * folder (and a dangling link the path it points to), so the path stays the same once the
 * file exists.
 */
export function realTarget(file: string): string {
  let path = resolve(file);
  for (let links = 0; links <= MAX_LINKS; links += 1) {
    try {
      return realpathSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let isLink = false;
    try {
      isLink = lstatSync(path).isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!isLink) {
      const parent = dirname(path);
      return parent === path ? path : join(realTarget(parent), basename(path));
    }
    // A dangling link: follow it by hand to where the file will be.
    path = resolve(dirname(path), readlinkSync(path));
  }
  throw new Error(`${file}: too many symlinks (a loop?)`);
}

/** The permission bits of a file, or null when it does not exist. */
export function fileMode(file: string): number | null {
  return existsSync(file) ? statSync(file).mode & 0o7777 : null;
}

/** Writes `content` to a new temp file beside `file`, with `mode`, and fsyncs it. Returns its path. */
function writeTemp(file: string, content: string, mode: number): string {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.anymodel-tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    const fd = openSync(temp, "wx", mode);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // openSync's mode passes through the umask; set the bits we were asked for.
    chmodSync(temp, mode);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
  return temp;
}

/**
 * Writes `content` to `file` atomically: a temp file in the same folder, fsync, then rename.
 * A reader sees the old file or the new one, never half of one.
 *
 * `beforeRename` runs when the temp file is safely on disk, just before the rename. When
 * it throws, the temp file is removed and `file` stays as it was.
 */
export function atomicWrite(
  file: string,
  content: string,
  mode: number,
  beforeRename?: () => void,
): void {
  const temp = writeTemp(file, content, mode);
  try {
    beforeRename?.();
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

interface BackupName {
  name: string;
  stamp: string;
  counter: number;
  absent: boolean;
  /** The original mode, when the name records it (`.mode-755`: the file was executable). */
  mode: number | null;
}

function parseBackupName(base: string, name: string): BackupName | null {
  const prefix = `${base}${BACKUP_INFIX}`;
  if (!name.startsWith(prefix)) return null;
  const match = /^(\d{8}T\d{9}Z)(?:-(\d+))?(?:(\.absent)|\.mode-([0-7]{3,4}))?$/.exec(
    name.slice(prefix.length),
  );
  if (!match?.[1]) return null;
  return {
    name,
    stamp: match[1],
    counter: match[2] ? Number(match[2]) : 0,
    absent: match[3] !== undefined,
    mode: match[4] ? Number.parseInt(match[4], 8) : null,
  };
}

export interface Backup {
  path: string;
  /** A marker for "the file did not exist": restoring it removes the file. */
  absent: boolean;
  /** The mode the file had when it was backed up. */
  mode: number;
}

/** The folder that holds the backups of `file`: named by its real path. */
export function backupDir(stateDir: string, file: string): string {
  return join(stateDir, BACKUPS_DIR, encodeURIComponent(realTarget(file)));
}

/** Makes a folder only its owner can read (0700), whatever the umask. */
function makePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Every backup of `file`, oldest first. */
export function listBackups(stateDir: string, file: string): Backup[] {
  const dir = backupDir(stateDir, file);
  if (!existsSync(dir)) return [];
  const base = basename(realTarget(file));
  return readdirSync(dir)
    .map((name) => parseBackupName(base, name))
    .filter((backup): backup is BackupName => backup !== null)
    .sort((a, b) => (a.stamp === b.stamp ? a.counter - b.counter : a.stamp < b.stamp ? -1 : 1))
    .map((backup) => {
      const path = join(dir, backup.name);
      return { path, absent: backup.absent, mode: backup.mode ?? fileMode(path) ?? 0o600 };
    });
}

/**
 * Copies `file` to a new `target` that is never executable: a copy must never run as a
 * command. Returns the source's mode.
 */
export function copyNotExecutable(file: string, target: string): number {
  const mode = fileMode(file) ?? 0o600;
  const safeMode = mode & ~0o111;
  writeFileSync(target, readFileSync(file), { flag: "wx", mode: safeMode });
  chmodSync(target, safeMode); // the umask may have changed the bits
  return mode;
}

/**
 * Saves the current state of `file` in `<stateDir>/backups/` before a change.
 * - A missing file gets an empty `.absent` marker, so restore can remove the file again.
 * - A backup is never executable. When the file was, its mode goes into the name
 *   (`.mode-755`), so restore gives it back.
 */
export function backupFile(stateDir: string, file: string): string {
  const real = realTarget(file);
  const dir = backupDir(stateDir, real);
  const base = basename(real);
  const stamp = utcStamp();
  const mode = fileMode(real);
  const suffix =
    mode === null ? ABSENT_SUFFIX : (mode & 0o111) !== 0 ? `.mode-${mode.toString(8)}` : "";
  makePrivateDir(join(stateDir, BACKUPS_DIR));
  makePrivateDir(dir);
  // Two backups in the same millisecond get a counter, whatever their suffixes, so the
  // order stays clear: <stamp>, <stamp>-1, <stamp>-2 …
  const sameStamp = readdirSync(dir)
    .map((name) => parseBackupName(base, name))
    .filter((backup): backup is BackupName => backup?.stamp === stamp);
  const counter =
    sameStamp.length === 0 ? 0 : Math.max(...sameStamp.map((backup) => backup.counter)) + 1;
  const target = join(
    dir,
    `${base}${BACKUP_INFIX}${stamp}${counter === 0 ? "" : `-${counter}`}${suffix}`,
  );
  if (mode === null) {
    writeFileSync(target, "", { flag: "wx", mode: 0o600 });
  } else {
    copyNotExecutable(real, target);
  }
  return target;
}

/**
 * What anymodel changed in a file, so restore knows how to take it out again:
 * - `json-keys`: keys listed in owned.json; restore removes them and keeps the rest.
 * - `json-entries`: entries of a JSON string list, listed in owned-entries.json; restore
 *   removes them and keeps every other entry.
 * - `markdown-block`: one anymodel block; restore removes it and keeps the text around it.
 * - `whole-file`: the file is anymodel's (the launcher); restore puts back the baseline.
 */
export type ChangeKind = "json-keys" | "json-entries" | "markdown-block" | "whole-file";

export interface ChangedEntry {
  kinds: ChangeKind[];
  /** The first backup, made just before anymodel first changed the file. */
  baseline: string | null;
}

const CHANGE_KINDS: readonly ChangeKind[] = [
  "json-keys",
  "json-entries",
  "markdown-block",
  "whole-file",
];

function isChangedEntry(value: unknown): value is ChangedEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<ChangedEntry>;
  return (
    Array.isArray(entry.kinds) &&
    entry.kinds.every((kind) => CHANGE_KINDS.includes(kind)) &&
    (entry.baseline === null || typeof entry.baseline === "string")
  );
}

/** The files anymodel has changed, from `<stateDir>/changed.json`. */
export function readChanged(stateDir: string): Record<string, ChangedEntry> {
  const file = join(stateDir, CHANGED_FILE);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const files = (parsed as { files?: unknown } | null)?.files;
  if (
    typeof files !== "object" ||
    files === null ||
    !Object.values(files).every((entry) => isChangedEntry(entry))
  ) {
    throw new Error(`Invalid ${file}: expected { "files": { <path>: { kinds, baseline } } }`);
  }
  return files as Record<string, ChangedEntry>;
}

function writeChanged(stateDir: string, files: Record<string, ChangedEntry>): void {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  atomicWrite(
    join(stateDir, CHANGED_FILE),
    `${JSON.stringify({ files: sorted }, null, 2)}\n`,
    0o600,
  );
}

/** Records that `file` gets a change of `kind`. Returns true when `backup` became its baseline. */
function recordChange(stateDir: string, file: string, kind: ChangeKind, backup: string): boolean {
  const files = readChanged(stateDir);
  const entry = files[file];
  if (!entry) {
    files[file] = { kinds: [kind], baseline: backup };
    writeChanged(stateDir, files);
    return true;
  }
  if (!entry.kinds.includes(kind)) {
    entry.kinds.push(kind);
    writeChanged(stateDir, files);
  }
  return false;
}

/** Restore took everything of anymodel out of `file`: stop tracking it. */
export function forgetChange(stateDir: string, file: string): void {
  const files = readChanged(stateDir);
  if (!(file in files)) return;
  delete files[file];
  writeChanged(stateDir, files);
}

/** The file changed after we read it (Claude Code writes settings.json too). Nothing was written. */
export class ConcurrentChangeError extends Error {
  override name = "ConcurrentChangeError";
}

/**
 * Runs read-change-write `fn` again when another program changed the file in between,
 * up to `attempts` times, then fails with a clear message.
 */
export function retryOnConcurrentChange<T>(file: string, fn: () => T, attempts = 3): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      if (!(error instanceof ConcurrentChangeError) || attempt >= attempts) {
        if (error instanceof ConcurrentChangeError) {
          throw new ConcurrentChangeError(
            `${file} kept changing while anymodel tried to update it (${attempts} tries). ` +
              "Close the program that writes it (for example Claude Code), then run again.",
          );
        }
        throw error;
      }
    }
  }
}

export interface ManagedWriteOptions {
  stateDir: string;
  /** What this write changes, for restore. */
  kind: ChangeKind;
  /** The mode of a file that does not exist yet. An existing file keeps its own mode. */
  newFileMode?: number;
  /** Force this mode even on an existing file (the launcher must stay executable). */
  mode?: number;
  dryRun?: boolean;
  /**
   * The exact text the caller read (null: the file did not exist). When the file holds
   * something else now, nothing is written and ConcurrentChangeError is thrown.
   */
  expectedContent?: string | null;
  /** Tests only: runs just before the last compare, to play another program's write. */
  onBeforeCompare?: () => void;
}

export type WriteOutcome = "unchanged" | "created" | "updated";

export interface WriteResult {
  outcome: WriteOutcome;
  /** The backup made before the write, or null when nothing was written. */
  backup: string | null;
}

/** The file's text now, or null when it does not exist. */
function readCurrent(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/**
 * The one way anymodel changes a file: when the content differs, back it up, record it
 * for restore, and write it atomically. Same content: nothing is written at all.
 *
 * The steps, in this order:
 * 1. the backup, then the record in changed.json (the first time, with that backup as the
 *    baseline). The record comes before the write: a crash right after the rename must not
 *    leave a change that restore never sees. A record whose write never happened is
 *    harmless: restore finds the file as it was and reports it unchanged.
 * 2. the temp file, written and fsynced;
 * 3. with `expectedContent`: the file on disk is compared with the text the caller read;
 * 4. the rename, at once.
 * Steps 3 and 4 sit next to each other, which narrows the window in which another
 * program's write could be lost. It does not close it.
 */
export function writeManagedFile(
  file: string,
  content: string,
  options: ManagedWriteOptions,
): WriteResult {
  const target = realTarget(file);
  const currentMode = fileMode(target);
  const current = currentMode === null ? null : readFileSync(target, "utf8");
  const checkUnchanged = (now: string | null) => {
    if (options.expectedContent !== undefined && now !== options.expectedContent) {
      throw new ConcurrentChangeError(`${target} changed after anymodel read it.`);
    }
  };
  // An early check too: no backup and no temp file when the file changed already.
  if (!options.dryRun) checkUnchanged(current);
  const wantedMode = options.mode ?? currentMode ?? options.newFileMode ?? 0o600;
  if (current === content && currentMode === wantedMode) {
    return { outcome: "unchanged", backup: null };
  }
  const outcome: WriteOutcome = currentMode === null ? "created" : "updated";
  if (options.dryRun) return { outcome, backup: null };
  const backup = backupFile(options.stateDir, target);
  const isBaseline = recordChange(options.stateDir, target, options.kind, backup);
  try {
    atomicWrite(target, content, wantedMode, () => {
      options.onBeforeCompare?.();
      checkUnchanged(readCurrent(target));
    });
  } catch (error) {
    // Nothing was written. A backup that is not the baseline is only clutter now.
    if (!isBaseline && existsSync(backup)) unlinkSync(backup);
    throw error;
  }
  return { outcome, backup };
}

/** Removes a file anymodel created, after a backup of it. Returns the backup's path. */
export function removeManagedFile(stateDir: string, file: string): string {
  const backup = backupFile(stateDir, file);
  unlinkSync(file);
  return backup;
}
