import { existsSync, readFileSync } from "node:fs";
import { applyManagedJson, formatKeyPath, ownedKeys } from "./managed-json";
import { removeManagedMarkdown } from "./managed-markdown";
import {
  ABSENT_SUFFIX,
  type ChangedEntry,
  forgetChange,
  listBackups,
  readChanged,
  removeManagedFile,
  writeManagedFile,
} from "./write";

export interface RestoreResult {
  file: string;
  /**
   * - `restored`: a file cc-agentic owns whole is back as it was before cc-agentic.
   * - `removed`: cc-agentic had created the file; it is gone again.
   * - `cleaned`: cc-agentic's keys or block are out; everything else stayed.
   * - `unchanged`: nothing of cc-agentic was left in it.
   * - `no-backup`: the backup from before cc-agentic is missing; the file was left alone.
   */
  action: "restored" | "removed" | "cleaned" | "unchanged" | "no-backup";
  /** What was taken out: key paths, or "the cc-agentic block". */
  details: string[];
  /** The backup of the file's state just before this restore changed it. */
  savedAs?: string;
}

/** The baseline is an `.absent` marker: the file did not exist before cc-agentic. */
function createdByUs(entry: ChangedEntry): boolean {
  return entry.baseline?.endsWith(ABSENT_SUFFIX) ?? false;
}

function restoreWholeFile(file: string, entry: ChangedEntry, stateDir: string): RestoreResult {
  const baseline = listBackups(file).find((backup) => backup.path === entry.baseline);
  if (!baseline) return { file, action: "no-backup", details: [] };
  if (baseline.absent) {
    if (!existsSync(file)) return { file, action: "unchanged", details: [] };
    return { file, action: "removed", details: [], savedAs: removeManagedFile(file) };
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
      const result = applyManagedJson({ file, stateDir, remove: keys });
      details.push(...result.changes.map((change) => formatKeyPath(change.path)));
      savedAs ??= result.backup;
    }
  }
  if (entry.kinds.includes("markdown-block")) {
    const result = removeManagedMarkdown({ file, stateDir });
    if (result.outcome !== "unchanged") details.push("the cc-agentic block");
    savedAs ??= result.backup;
  }

  // cc-agentic created the file, and only an empty shell of ours is left: remove it.
  if (createdByUs(entry) && isEmpty(file)) {
    const backup = removeManagedFile(file);
    return { file, action: "removed", details, savedAs: savedAs ?? backup };
  }
  if (details.length === 0) return { file, action: "unchanged", details };
  return { file, action: "cleaned", details, ...(savedAs && { savedAs }) };
}

/**
 * Removes everything cc-agentic added, and keeps everything else:
 * - JSON files: the keys cc-agentic owns are removed (they did not exist before, because
 *   cc-agentic never overwrites a key it does not own). Keys others added stay.
 * - Markdown files: the cc-agentic block is removed; the text around it stays.
 * - Files cc-agentic owns whole (the launcher): back to the state before cc-agentic's first
 *   change, or removed when cc-agentic created them.
 * Each change makes a backup first. Afterwards the file is no longer tracked, so a second
 * restore changes nothing.
 */
export function restore(stateDir: string): RestoreResult[] {
  return Object.entries(readChanged(stateDir)).map(([file, entry]) => {
    const result = entry.kinds.includes("whole-file")
      ? restoreWholeFile(file, entry, stateDir)
      : restorePartly(file, entry, stateDir);
    if (result.action !== "no-backup") forgetChange(stateDir, file);
    return result;
  });
}
