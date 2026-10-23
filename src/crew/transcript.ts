/**
 * What a crew session's own transcript says about its context use, and the window it is measured
 * against.
 *
 * **Where the transcript is.** Claude Code writes a session's conversation to
 * `<config>/projects/<project folder>/<session id>.jsonl`, and the project folder's name is the
 * folder's path with every character but a letter or a digit made a `-`
 * (`projectFolderName`, the one home). A crew session works in its own worktree, so its transcript is
 * under the worktree's folder.
 *
 * **What the context use is.** The last reply's `usage`: the tokens it sent
 * (`input_tokens`), the ones it cached (`cache_creation_input_tokens`) and the ones it read back
 * (`cache_read_input_tokens`) — the whole prompt the next turn carries.
 *
 * **The window.** This module reads the use, not the window: the window of the model that
 * wrote the reply comes from `context-window.ts`, its one home — Claude Code's own number when
 * the status line recorded one, the kit's table otherwise, and a backend's own list for a bare
 * backend model. A model whose window the kit cannot know has no percentage, and so no hand-off
 * line on context (the time lines still apply).
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectFolderName } from "../sessions/saved-sessions";

/** How much of the transcript's tail is read: the last replies, and nothing older. */
const TAIL_BYTES = 256 * 1024;

/** The transcript of the session `sessionId` that works in `folder`. */
export function transcriptFile(projectsDir: string, folder: string, sessionId: string): string {
  return join(projectsDir, projectFolderName(folder), `${sessionId}.jsonl`);
}

/** How many tokens the last reply's prompt carried. */
export interface ContextUse {
  /** The tokens of the last reply's prompt: input, cache written and cache read. */
  tokens: number;
  /** The model that wrote that reply. */
  model: null | string;
  /** When the transcript was last written, in ms; null when it cannot be read. */
  changedAtMs: null | number;
}

/** The numbers of one assistant record, or null when it carries none. */
function usageOf(record: unknown): null | { model: null | string; tokens: number } {
  if (typeof record !== "object" || record === null) return null;
  const message = (record as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const usage = (message as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const numbers = usage as Record<string, unknown>;
  const model = (message as { model?: unknown }).model;
  return {
    model: typeof model === "string" && model !== "" ? model : null,
    tokens:
      numberOf(numbers.input_tokens) +
      numberOf(numbers.cache_creation_input_tokens) +
      numberOf(numbers.cache_read_input_tokens),
  };
}

/** A number, or 0 when the value is not one. */
function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The context the last reply of the transcript in `file` used, and when the file was last
 * written. Null when the file is not there, cannot be read, or holds no reply with a usage —
 * then the kit knows nothing about the crew session's context and says nothing.
 */
export function contextUseOf(file: string): ContextUse | null {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const bytes = Buffer.alloc(size - from);
    let filled = 0;
    while (filled < bytes.length) {
      const read = readSync(fd, bytes, filled, bytes.length - filled, from + filled);
      if (read === 0) break;
      filled += read;
    }
    const lines = bytes.subarray(0, filled).toString("utf8").split("\n");
    // The last whole line may be cut by the tail: the line before it is still whole.
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim() ?? "";
      if (line === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = usageOf(parsed);
      if (usage === null) continue;
      return { changedAtMs: changedAt(file), model: usage.model, tokens: usage.tokens };
    }
    return null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** When a file was last written, in ms; null when it cannot be read. */
export function changedAt(file: string): null | number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The share of the window the context use is, in percent (0 to 100); null when the window is
 * unknown or the use is nothing.
 */
export function contextPercent(use: ContextUse, window: null | number): null | number {
  if (window === null || window <= 0 || use.tokens <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((use.tokens / window) * 100)));
}
