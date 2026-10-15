import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type CliPaths, tildify } from "../cli/paths";
import { withLock } from "./lock";
import {
  applyManagedMarkdown,
  BLOCK_BEGIN,
  removeManagedMarkdown,
  renderWithoutBlock,
} from "./managed-markdown";
import { createdByUs, type RestoreResult, restore } from "./restore";
import { atomicWrite, readChanged, realTarget, writeManagedFile } from "./write";

/**
 * The plugin's general instructions for Claude, installed as a managed copy and imported
 * from the user's CLAUDE.md:
 *
 *   plugin/instructions/**.md  --copy-->  <stateDir>/instructions/**.md
 *   <config dir>/CLAUDE.md     <-- one anymodel block: `@<copy>/core.md`
 *
 * Why a copy: the plugin's own folder has the version in its name and goes away after an
 * update, so an import cannot point into it. Every file of the copy is a whole file
 * anymodel owns (`whole-file` in changed.json), so `restore` removes it.
 *
 * Two small state files sit beside the copy, in the state folder (not in the copy, which
 * holds only what the plugin ships):
 *
 *   <stateDir>/no-instructions        the person's `setup --no-instructions`: later setups
 *                                     keep the instructions out until `--instructions`
 *   <stateDir>/instructions-version   the plugin version that last wrote the copy, so a
 *                                     newer version can tell that the copy is behind
 *
 * `restore` removes both (`forgetInstructionsState`).
 */

/** The always-on file. The block imports only this one; `optin/` is for a project to import. */
export const ALWAYS_ON_FILE = "core.md";

/** The stored `--no-instructions`: while it exists, setup keeps the instructions out. */
export function optOutFile(stateDir: string): string {
  return join(stateDir, "no-instructions");
}

/** The plugin version that last wrote the copy. */
export function versionStampFile(stateDir: string): string {
  return join(stateDir, "instructions-version");
}

/** True when the person chose `setup --no-instructions` and has not opted back in. */
export function instructionsOptedOut(stateDir: string): boolean {
  return existsSync(optOutFile(stateDir));
}

/** The version in the stamp, or null when there is none. */
export function readVersionStamp(stateDir: string): string | null {
  const file = versionStampFile(stateDir);
  if (!existsSync(file)) return null;
  const version = readFileSync(file, "utf8").trim();
  return version === "" ? null : version;
}

export interface InstructionsPaths {
  /** The plugin's instructions folder (`plugin/instructions`). */
  source: string;
  /** The managed copy: `<stateDir>/instructions`. */
  target: string;
  /** The user's CLAUDE.md in the config folder. */
  claudeMd: string;
  stateDir: string;
  /** How the block names the always-on file: `~/.claude/...` under HOME, else absolute. */
  importPath: string;
}

/** Where the instructions go, and how the `CLAUDE.md` block names them. */
export function instructionsPaths(paths: CliPaths, source: string): InstructionsPaths {
  const target = join(paths.stateDir, "instructions");
  return {
    source,
    target,
    // Not a field of cliPaths: only this file builds it, and the shared table holds the
    // paths more than one command uses.
    claudeMd: join(paths.claudeConfigDir, "CLAUDE.md"),
    stateDir: paths.stateDir,
    // `~/...` keeps a CLAUDE.md shared between machines (a dotfiles repo) right on each one.
    importPath: tildify(join(target, ALWAYS_ON_FILE), paths.home),
  };
}

/**
 * The plugin's `instructions/` folder, found from the folder of the bundle that runs
 * (`import.meta.dir`): `plugin/instructions` beside `dist/` on an installed machine, the
 * repo's `plugin/instructions` when the bundle runs from `src/entries/`.
 */
export function instructionsFolder(bundleDir: string): string {
  const beside = join(bundleDir, "..", "instructions");
  return existsSync(beside) ? beside : join(bundleDir, "..", "..", "plugin", "instructions");
}

/** One printed line of setup: `<mark> <file>: <what>`. */
export interface InstructionsLine {
  mark: "+" | "~" | "-" | "!";
  file: string;
  what: string;
}

/** The text between the block's markers. */
export function instructionsBlockBody(importPath: string): string {
  return [
    "<!-- Written by anymodel setup. `anymodel setup --no-instructions` takes it out. -->",
    `@${importPath}`,
  ].join("\n");
}

/** Every `.md` file under `source`, as paths relative to it with `/`, sorted. */
export function listInstructionFiles(source: string): string[] {
  if (!existsSync(source)) {
    throw new Error(
      `The plugin's instructions folder is missing: ${source}. Reinstall the plugin.`,
    );
  }
  const files = readdirSync(source, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
  if (!files.includes(ALWAYS_ON_FILE)) {
    throw new Error(
      `The plugin's instructions folder has no ${ALWAYS_ON_FILE}: ${source}. Reinstall the plugin.`,
    );
  }
  return files;
}

/** The files of the managed copy that changed.json tracks (real paths). */
function trackedCopies(target: string, stateDir: string): string[] {
  const root = `${realTarget(target)}/`;
  return Object.keys(readChanged(stateDir)).filter((file) => file.startsWith(root));
}

function lineOf(result: RestoreResult, block: boolean): InstructionsLine | null {
  switch (result.action) {
    case "removed":
      return { mark: "-", file: result.file, what: "removed" };
    case "restored":
      return { mark: "~", file: result.file, what: "back as it was before anymodel" };
    case "cleaned":
      return { mark: "~", file: result.file, what: block ? "anymodel block removed" : "cleaned" };
    case "no-backup":
      return {
        mark: "!",
        file: result.file,
        what: "the backup from before anymodel is missing; left alone",
      };
    case "unchanged":
      return null;
  }
}

/** True when setup installed the copy: changed.json tracks at least one of its files. */
export function copyInstalled(paths: InstructionsPaths): boolean {
  return trackedCopies(paths.target, paths.stateDir).length > 0;
}

/**
 * Does the copy need the plugin's `version`? Only a copy that is installed and not opted out,
 * whose stamp is missing or names another version. Reads files only, never writes. The
 * refresh after an update and `doctor` both ask it.
 */
export function instructionsNeedRefresh(paths: InstructionsPaths, version: string): boolean {
  if (instructionsOptedOut(paths.stateDir)) return false;
  if (!copyInstalled(paths)) return false;
  return readVersionStamp(paths.stateDir) !== version;
}

/**
 * How the copy differs from the plugin's files, one entry each: `<file> is missing`,
 * `<file> differs`, `<file> is not shipped any more`. Empty when they match.
 */
export function copyDifferences(paths: InstructionsPaths): string[] {
  const files = listInstructionFiles(paths.source);
  const out: string[] = [];
  for (const name of files) {
    const copy = join(paths.target, name);
    if (!existsSync(copy)) out.push(`${name} is missing`);
    else if (readFileSync(copy, "utf8") !== readFileSync(join(paths.source, name), "utf8")) {
      out.push(`${name} differs`);
    }
  }
  const root = `${realTarget(paths.target)}/`;
  const wanted = new Set(files.map((name) => realTarget(join(paths.target, name))));
  for (const file of trackedCopies(paths.target, paths.stateDir)) {
    if (!wanted.has(file) && existsSync(file)) {
      out.push(`${file.slice(root.length)} is not shipped any more`);
    }
  }
  return out;
}

/**
 * Records or clears the person's choice. `optOut` true: setup keeps the instructions out from
 * now on. Returns the line to print, or null when the choice is already stored that way.
 */
export function setInstructionsOptOut(
  stateDir: string,
  optOut: boolean,
  dryRun: boolean,
): InstructionsLine | null {
  const file = optOutFile(stateDir);
  if (optOut === existsSync(file)) return null;
  if (!dryRun) {
    if (optOut) {
      atomicWrite(
        file,
        "Written by `anymodel setup --no-instructions`. While this file is here, setup leaves the instructions out. `anymodel setup --instructions` removes it.\n",
        0o644,
      );
    } else {
      rmSync(file, { force: true });
    }
  }
  return optOut
    ? {
        mark: "+",
        file,
        what: "setup leaves the instructions out from now on (`anymodel setup --instructions` brings them back)",
      }
    : { mark: "-", file, what: "removed: setup installs the instructions again" };
}

/**
 * Forgets both state files (the stored opt-out and the version stamp), for `restore`. Returns
 * the opt-out file when it was there, so restore can say the choice is gone.
 */
export function forgetInstructionsState(stateDir: string): string | null {
  const optOut = optOutFile(stateDir);
  const had = existsSync(optOut);
  rmSync(optOut, { force: true });
  rmSync(versionStampFile(stateDir), { force: true });
  return had ? optOut : null;
}

/** Takes tracked copies out: removed when anymodel created them, else back to their baseline. */
function removeCopies(files: string[], stateDir: string, dryRun: boolean): InstructionsLine[] {
  if (files.length === 0) return [];
  if (dryRun) {
    const changed = readChanged(stateDir);
    return files
      .filter((file) => existsSync(file))
      .map((file) => {
        const entry = changed[file];
        return entry !== undefined && createdByUs(entry)
          ? { mark: "-", file, what: "removed" }
          : { mark: "~", file, what: "back as it was before anymodel" };
      });
  }
  return restore(stateDir, { only: files })
    .map((result) => lineOf(result, false))
    .filter((line): line is InstructionsLine => line !== null);
}

/**
 * Installs or refreshes the managed copy only, and stamps it with `version`. A file the plugin
 * no longer ships is taken out of the copy. Only a real change writes, and prints a line; the
 * stamp is state, never printed.
 */
function installCopy(
  paths: InstructionsPaths,
  dryRun: boolean,
  version: string,
): InstructionsLine[] {
  const lines: InstructionsLine[] = [];
  const files = listInstructionFiles(paths.source);
  const wanted = new Set<string>();
  for (const name of files) {
    const file = join(paths.target, name);
    wanted.add(realTarget(file));
    const result = writeManagedFile(file, readFileSync(join(paths.source, name), "utf8"), {
      stateDir: paths.stateDir,
      kind: "whole-file",
      mode: 0o644,
      dryRun,
    });
    if (result.outcome !== "unchanged") {
      lines.push({
        mark: result.outcome === "created" ? "+" : "~",
        file,
        what: result.outcome,
      });
    }
  }
  const stale = trackedCopies(paths.target, paths.stateDir).filter((file) => !wanted.has(file));
  lines.push(
    ...removeCopies(stale, paths.stateDir, dryRun).map((line) => ({
      ...line,
      what: `${line.what} (the plugin no longer ships it)`,
    })),
  );
  if (!dryRun && readVersionStamp(paths.stateDir) !== version) {
    atomicWrite(versionStampFile(paths.stateDir), `${version}\n`, 0o644);
  }
  return lines;
}

/**
 * Brings the copy up to `version` after a plugin update, and does nothing else: no block, no
 * other setup step, no question. It does nothing when the person opted out, when setup never
 * installed the copy, or when the stamp already names `version` (`instructionsNeedRefresh`).
 * Runs inside the state folder's lock; with `dryRun`, it only reports and takes no lock.
 */
export async function refreshInstructionsCopy(
  paths: InstructionsPaths,
  version: string,
  options: { dryRun?: boolean; waitMs?: number } = {},
): Promise<InstructionsLine[]> {
  // Checked before the lock too: a machine that never ran setup gets no state folder.
  if (!instructionsNeedRefresh(paths, version)) return [];
  if (options.dryRun) return installCopy(paths, true, version);
  return withLock(
    paths.stateDir,
    () => (instructionsNeedRefresh(paths, version) ? installCopy(paths, false, version) : []),
    { waitMs: options.waitMs ?? 10_000 },
  );
}

/**
 * Installs or refreshes the managed copy (stamped with `version`), then the block that
 * imports it. Only a real change writes, and prints a line.
 */
export function installInstructions(
  paths: InstructionsPaths,
  dryRun: boolean,
  version: string,
): InstructionsLine[] {
  const lines = installCopy(paths, dryRun, version);

  // The block last: it never imports a file that is not there yet.
  const before = existsSync(paths.claudeMd) ? readFileSync(paths.claudeMd, "utf8") : null;
  const block = applyManagedMarkdown({
    file: paths.claudeMd,
    stateDir: paths.stateDir,
    body: instructionsBlockBody(paths.importPath),
    dryRun,
  });
  if (block.outcome === "created") {
    lines.push({ mark: "+", file: paths.claudeMd, what: "created, with the anymodel block" });
  } else if (block.outcome === "updated") {
    const had = before?.includes(BLOCK_BEGIN) ?? false;
    lines.push({
      mark: "~",
      file: paths.claudeMd,
      what: had ? "anymodel block updated" : "anymodel block added",
    });
  }
  return lines;
}

/**
 * Takes the instructions out: first the block (so nothing imports a missing file), then the
 * managed copy. A CLAUDE.md that anymodel created, with nothing else in it, is removed.
 */
export function removeInstructions(paths: InstructionsPaths, dryRun: boolean): InstructionsLine[] {
  const lines: InstructionsLine[] = [];
  const claudeMd = realTarget(paths.claudeMd);
  const text = existsSync(claudeMd) ? readFileSync(claudeMd, "utf8") : null;
  const entry = readChanged(paths.stateDir)[claudeMd];

  if (text?.includes(BLOCK_BEGIN)) {
    if (dryRun) {
      const empty = renderWithoutBlock(text, claudeMd).trim() === "";
      lines.push(
        entry !== undefined && createdByUs(entry) && empty
          ? { mark: "-", file: claudeMd, what: "removed" }
          : { mark: "~", file: claudeMd, what: "anymodel block removed" },
      );
    } else if (entry !== undefined) {
      for (const result of restore(paths.stateDir, { only: [claudeMd] })) {
        const line = lineOf(result, true);
        if (line) lines.push(line);
      }
    } else {
      // A block with no record (the state folder was cleared): take the block out only.
      removeManagedMarkdown({ file: claudeMd, stateDir: paths.stateDir });
      lines.push({ mark: "~", file: claudeMd, what: "anymodel block removed" });
    }
  }
  lines.push(...removeCopies(trackedCopies(paths.target, paths.stateDir), paths.stateDir, dryRun));
  if (!dryRun) rmSync(versionStampFile(paths.stateDir), { force: true });
  return lines;
}
