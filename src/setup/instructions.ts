import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  applyManagedMarkdown,
  BLOCK_BEGIN,
  removeManagedMarkdown,
  renderWithoutBlock,
} from "./managed-markdown";
import { createdByUs, type RestoreResult, restore } from "./restore";
import { readChanged, realTarget, writeManagedFile } from "./write";

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
 */

/** The always-on file. The block imports only this one; `optin/` is for a project to import. */
export const ALWAYS_ON_FILE = "core.md";

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
 * Installs or refreshes the managed copy, then the block that imports it. A file the plugin
 * no longer ships is taken out of the copy. Only a real change writes, and prints a line.
 */
export function installInstructions(paths: InstructionsPaths, dryRun: boolean): InstructionsLine[] {
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
  return lines;
}
