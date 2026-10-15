/**
 * The session's own model, read from the tail of Claude Code's transcript — one home, for
 * the two hooks that need it: the StopFailure usage-limit alert (which model hit the limit)
 * and the Agent guard (a `fork` subagent runs on the session's model).
 *
 * Claude Code writes a session's conversation to
 * `<config>/projects/<project folder>/<session id>.jsonl`; each `type: "assistant"` line
 * carries `message.model` (docs/claude-code-contract.md). Only the file's tail is read: a
 * session's transcript grows to megabytes, and a hook has a 10 s timeout.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** How much of a transcript's end the hook reads for the session's model. */
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The last Claude model that answered in this transcript (`message.model` of its last
 * `assistant` line that names a `claude-…` model): the session's own model. A fallback's
 * answer names the backend's model and Claude Code's own error lines name none, so both are
 * passed over. Only the file's last 512 KB is read. Null when there is none, or no file.
 */
export function lastClaudeModel(transcriptPath: string): null | string {
  let text: string;
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    // No transcript, or not readable: the caller falls back to its own default.
    return null;
  }
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!line.includes('"assistant"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // The first line may be cut by the tail, the last one half written.
      continue;
    }
    if (!isJsonObject(entry) || entry.type !== "assistant" || !isJsonObject(entry.message)) {
      continue;
    }
    const model = entry.message.model;
    if (typeof model === "string" && model.startsWith("claude-")) return model;
  }
  return null;
}
