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
 * **The window.** The kit knows no backend's window (`gateway.json` holds none), and Claude
 * Code's own is 200 000 tokens, or 1 000 000 for a model whose name carries the `[1m]` suffix
 * (`docs/gateway.md`). A model the kit does not know has an unknown window: no percentage, and
 * so no hand-off line on context (the time lines still apply).
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_FAMILIES, claudeFamily } from "../gateway/targets";
import { projectFolderName } from "../sessions/saved-sessions";

/** Claude Code's own context window, in tokens. */
export const CLAUDE_CONTEXT_WINDOW = 200_000;

/** The window of a model whose name carries the `[1m]` suffix, in tokens. */
export const CLAUDE_CONTEXT_WINDOW_1M = 1_000_000;

/** How much of the transcript's tail is read: the last replies, and nothing older. */
const TAIL_BYTES = 256 * 1024;

/**
 * The window of `model`, in tokens, or null when the kit does not know it. A Claude model — an
 * id (`claude-sonnet-5-5`), or the family name a crew session is launched with (`sonnet`) — has
 * 200 000 tokens, or 1 000 000 with the `[1m]` suffix; anything else is a backend whose window
 * the kit does not hold.
 *
 * A family name may really have a larger window than this (Claude Code decides it, and the kit
 * cannot read it): the guess is the smaller one, so a crew session hands off early, never late.
 */
export function contextWindowOf(model: string): null | number {
  const name = model.trim().toLowerCase();
  if (name.endsWith("[1m]")) return CLAUDE_CONTEXT_WINDOW_1M;
  if ((CLAUDE_FAMILIES as readonly string[]).includes(name) || claudeFamily(name) !== null) {
    return CLAUDE_CONTEXT_WINDOW;
  }
  return null;
}

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
