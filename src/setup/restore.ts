import { existsSync, readdirSync, readFileSync, rmdirSync } from "node:fs";
import { dirname } from "node:path";
import { isStrictlyInside } from "../path-compare";
import { removeAllOwnedEntries } from "./managed-entries";
import { removeAllManagedHooks } from "./managed-hook";
import { applyManagedJson, createdObjects, formatKeyPath, ownedKeys } from "./managed-json";
import { removeManagedLines } from "./managed-line";
import { removeManagedMarkdown } from "./managed-markdown";
import {
  ABSENT_SUFFIX,
  type ChangedEntry,
  forgetChange,
  listBackups,
  readChanged,
  realTarget,
  removeManagedFile,
  writeManagedFile,
} from "./write";

export interface RestoreResult {
  file: string;
  /**
   * - `restored`: a file cc-smart-dev-kit owns whole is back as it was before cc-smart-dev-kit.
   * - `removed`: cc-smart-dev-kit had created the file; it is gone again.
   * - `cleaned`: cc-smart-dev-kit's keys or block are out; everything else stayed.
   * - `unchanged`: nothing of cc-smart-dev-kit was left in it.
   * - `no-backup`: the backup from before cc-smart-dev-kit is missing; the file was left alone.
   */
  action: "restored" | "removed" | "cleaned" | "unchanged" | "no-backup";
  /** What was taken out: key paths, or "the cc-smart-dev-kit block". */
  details: string[];
  /** The backup of the file's state just before this restore changed it. */
  savedAs?: string;
}

/** The baseline is an `.absent` marker: the file did not exist before cc-smart-dev-kit. */
export function createdByUs(entry: ChangedEntry): boolean {
  return entry.baseline?.endsWith(ABSENT_SUFFIX) ?? false;
}

function restoreWholeFile(file: string, entry: ChangedEntry, stateDir: string): RestoreResult {
  const baseline = listBackups(stateDir, file).find((backup) => backup.path === entry.baseline);
  if (!baseline) return { file, action: "no-backup", details: [] };
  if (baseline.absent) {
    if (!existsSync(file)) return { file, action: "unchanged", details: [] };
    return { file, action: "removed", details: [], savedAs: removeManagedFile(stateDir, file) };
  }
  const result = writeManagedFile(file, readFileSync(baseline.path, "utf8"), {
    stateDir,
    kind: "whole-file",
    mode: baseline.mode,
  });
  if (result.outcome === "unchanged") return { file, action: "unchanged", details: [] };
  return {
    file,
    action: "restored",
    details: [],
    ...(result.backup && { savedAs: result.backup }),
  };
}

/** True when nothing but an empty object or empty text is left. */
function isEmpty(file: string): boolean {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8").trim();
  return text === "" || text === "{}";
}

function restorePartly(file: string, entry: ChangedEntry, stateDir: string): RestoreResult {
  const details: string[] = [];
  let savedAs: string | null = null;

  if (entry.kinds.includes("json-keys")) {
    const keys = ownedKeys(stateDir, file);
    if (keys.length > 0) {
      // `createdObject`: an object cc-smart-dev-kit created and this removal emptied (the `env`
      // its own keys made, say) goes with its last key; one the person had stays.
      const result = applyManagedJson({
        file,
        stateDir,
        remove: keys,
        createdObject: createdObjects(stateDir, file),
      });
      details.push(...result.changes.map((change) => formatKeyPath(change.path)));
      savedAs ??= result.backup;
    }
  }
  if (entry.kinds.includes("json-entries")) {
    const result = removeAllOwnedEntries(stateDir, file);
    details.push(...result.removed.map((removed) => `the entry ${JSON.stringify(removed)}`));
    savedAs ??= result.backup;
  }
  if (entry.kinds.includes("markdown-block")) {
    const result = removeManagedMarkdown({ file, stateDir });
    if (result.outcome !== "unchanged") details.push("the cc-smart-dev-kit block");
    savedAs ??= result.backup;
  }
  if (entry.kinds.includes("file-line")) {
    // Only the exact lines cc-smart-dev-kit added: a line the person changed or removed since
    // stays, and a file whose lines are all gone reports nothing.
    const result = removeManagedLines({ file, lines: entry.lines ?? [], stateDir });
    for (const line of result.removed) details.push(`the line ${JSON.stringify(line)}`);
    savedAs ??= result.backup;
  }

  // cc-smart-dev-kit created the file, and only an empty shell of ours is left: remove it.
  if (createdByUs(entry) && isEmpty(file)) {
    const backup = removeManagedFile(stateDir, file);
    return { file, action: "removed", details, savedAs: savedAs ?? backup };
  }
  if (details.length === 0) return { file, action: "unchanged", details };
  return { file, action: "cleaned", details, ...(savedAs && { savedAs }) };
}

/**
 * Removes everything cc-smart-dev-kit added, and keeps everything else:
 * - JSON files: the keys cc-smart-dev-kit owns are removed while they still hold the value
 *   cc-smart-dev-kit wrote (they did not exist before, or held a program's own default, because
 *   cc-smart-dev-kit never overwrites a key someone chose). A key the person changed since stays,
 *   and so do keys others added. The list entries cc-smart-dev-kit owns are taken out; other
 *   entries stay.
 * - Markdown files: the cc-smart-dev-kit block is removed; the text around it stays.
 * - Files cc-smart-dev-kit owns whole (the launcher): back to the state before cc-smart-dev-kit's first
 *   change, or removed when cc-smart-dev-kit created them.
 * Each change makes a backup first. Afterwards the file is no longer tracked, so a second
 * restore changes nothing.
 *
 * `except`: files (their real paths, as `changed.json` records them) left as they are and
 * still tracked, for a later restore. `restore` uses it for the router's copy and unit
 * while running sessions still use the router.
 *
 * `only`: restore just these files (real paths); every other file stays as it is and
 * still tracked. `setup --no-instructions` uses it for the instructions and their block.
 *
 * A removed file leaves no empty folder behind inside the state folder (the instructions'
 * folders); a folder outside it is never touched.
 */
export function restore(
  stateDir: string,
  options: { except?: string[]; only?: string[] } = {},
): RestoreResult[] {
  const except = new Set(options.except ?? []);
  const only = options.only === undefined ? null : new Set(options.only);
  // The managed hook entries have their own record (`owned-hooks.json`), never a
  // changed.json kind, so an older running cc-smart-dev-kit never meets a kind it refuses
  // (`managed-hook.ts`). Their details join the same file's line as the keys below.
  const hooks = new Map(
    removeAllManagedHooks(stateDir, { except, only }).map((result) => [result.file, result]),
  );
  const entries = Object.entries(readChanged(stateDir)).filter(
    ([file]) => !except.has(file) && (only === null || only.has(file)),
  );
  const results = entries.map(([file, entry]) => {
    const result = entry.kinds.includes("whole-file")
      ? restoreWholeFile(file, entry, stateDir)
      : restorePartly(file, entry, stateDir);
    const hook = hooks.get(file);
    if (hook !== undefined) {
      hooks.delete(file);
      for (const where of hook.removed) result.details.push(`the hook entry in ${where}`);
      if (hook.backup !== null) result.savedAs ??= hook.backup;
      if (result.action === "unchanged" && hook.removed.length > 0) result.action = "cleaned";
    }
    if (result.action !== "no-backup") forgetChange(stateDir, file);
    if (result.action === "removed") removeEmptyFolders(file, stateDir);
    return result;
  });
  // A file whose only managed change was the hook entry: its own line.
  for (const [file, hook] of hooks) {
    results.push({
      file,
      action: hook.removed.length > 0 ? "cleaned" : "unchanged",
      details: hook.removed.map((where) => `the hook entry in ${where}`),
      ...(hook.backup !== null && { savedAs: hook.backup }),
    });
  }
  return results;
}

/**
 * Removes the folders above `file` that are empty now, up to (not including) the state
 * folder. A folder outside the state folder, or one with anything in it, stays.
 */
function removeEmptyFolders(file: string, stateDir: string): void {
  const root = realTarget(stateDir);
  let dir = dirname(file);
  // `isStrictlyInside`, not a `${root}/` prefix: on Windows the paths have `\` (ST-6).
  while (isStrictlyInside(dir, root) && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}
