/**
 * The state folder's JSONL records: one JSON line per event, appended by a hook, kept small
 * the way the plain-text logs are (`LOG_MAX_BYTES`, the one size rule in
 * `src/update/state.ts`).
 *
 * Two records use it: the guards' asks (`ask-log.ts`, `guard-asks.jsonl`) and each
 * subagent's cost (`agent-usage.ts`, `agent-usage.jsonl`). The cut keeps the newer half of a
 * file that grew past the size rule, on a whole line, as a temp file and a rename, so a
 * reader never sees half a file.
 */

import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWrite } from "../setup/write";
import { LOG_MAX_BYTES } from "../update/state";

/**
 * Cuts the record back to its newer half, on a whole line, when it grew past the size rule.
 * A file that is not there, or cannot be read, is left alone: the append tries on.
 */
export function cutBack(file: string): void {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size <= LOG_MAX_BYTES) return;
  const text = readFileSync(file, "utf8");
  const keep = text.slice(text.length - LOG_MAX_BYTES / 2);
  atomicWrite(file, keep.slice(keep.indexOf("\n") + 1), 0o600);
}

/**
 * Appends one value as a line, all of it in one write: the folder made (mode 0700), the file
 * cut back first, the line mode 0600. Throws when the file cannot be written: the hook turns
 * that into one stderr line, and its answer is not changed.
 */
export function appendJsonLine(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  cutBack(file);
  appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}
