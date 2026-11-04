/**
 * What the plugin reads from the tail of Claude Code's transcript — one home, for the hooks
 * that need it:
 *   - the session's own model (the StopFailure usage-limit alert, the Agent guard);
 *   - the session's name (the notifier names the session in its alert);
 *   - the turn's last answer (the notifier's "finished" message);
 *   - who started the turn (the notifier stays quiet for a turn another session started);
 *   - the session's own file changes and its runs of the project's fast check (the
 *     verification gate, `verify-gate.ts`);
 *   - Stop feedback already given (the verification gate and keep-going guard).
 *
 * Claude Code writes a session's conversation to
 * `<config>/projects/<project folder>/<session id>.jsonl`. Only the file's tail is read: a
 * session's transcript grows to megabytes, and a hook has a 10 s timeout.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** How much of a transcript's end the hooks read. */
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The words Claude Code writes before a blocked stop's reason in the transcript. */
export const STOP_FEEDBACK = "Stop hook feedback:";

/** Stop-feedback texts in one entry, from string content or content blocks. */
export function stopFeedbackTexts(entry: unknown): string[] {
  if (!isJsonObject(entry) || !isJsonObject(entry.message)) return [];
  const content = entry.message.content;
  const texts =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.flatMap((block) =>
            isJsonObject(block) && typeof block.text === "string" ? [block.text] : [],
          )
        : [];
  return texts.filter((text) => text.includes(STOP_FEEDBACK));
}

/** The names of the `tool_use` blocks in one entry's message, in order. */
function toolUseNames(entry: Record<string, unknown>): string[] {
  const content = isJsonObject(entry.message) ? entry.message.content : undefined;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    isJsonObject(block) && block.type === "tool_use" && typeof block.name === "string"
      ? [block.name]
      : [],
  );
}

/**
 * True when the transcript's tail already holds Stop feedback with `text` in it (a hook's own
 * reason), and the session called none of the `resetBy` tools after it. The feedback counts
 * only as Claude Code writes it: a `user` entry of the session itself. A sidechain entry is a
 * subagent's own conversation, and an assistant entry that merely quotes the words is no
 * feedback. A call of a `resetBy` tool after the feedback (new subagent work) makes it count as
 * not given, so a later stall in the same state earns a new reminder. Only a line that names the
 * feedback or a tool call is parsed. False when the file cannot be read.
 */
export function stopFeedbackGiven(
  transcriptPath: string,
  text: string,
  resetBy: readonly string[],
): boolean {
  const lines = tailLines(transcriptPath);
  if (lines === null) return false;
  let given = false;
  for (const line of lines) {
    if (!line.includes(STOP_FEEDBACK) && !line.includes('"tool_use"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // The tail may start or end with a partial entry.
    }
    if (!isJsonObject(entry) || entry.isSidechain === true) continue;
    if (entry.type === "user" && stopFeedbackTexts(entry).some((said) => said.includes(text))) {
      given = true;
    } else if (given && toolUseNames(entry).some((name) => resetBy.includes(name))) {
      given = false;
    }
  }
  return given;
}

/**
 * The transcript's last `bytes` bytes (default `TRANSCRIPT_TAIL_BYTES`), one line per entry.
 * The first line may be cut by the tail and the last one may be half written; the readers
 * skip those. `bytes` is for a reader that needs more of the session than a model or a title
 * does (`verify-gate`: one turn's edits and its check runs). Null when the file cannot be read.
 */
export function tailLines(
  transcriptPath: string,
  bytes: number = TRANSCRIPT_TAIL_BYTES,
): null | string[] {
  let text: string;
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, bytes);
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
  return text.split("\n");
}

/** Every line from the end backwards, parsed; the ones that are not JSON objects are skipped. */
function* entriesFromEnd(lines: string[]): Generator<Record<string, unknown>> {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // The first line may be cut by the tail, the last one half written.
      continue;
    }
    if (isJsonObject(entry)) yield entry;
  }
}

/**
 * The last Claude model that answered in this transcript (`message.model` of its last
 * `assistant` line that names a `claude-…` model): the session's own model. A fallback's
 * answer names the backend's model and Claude Code's own error lines name none, so both are
 * passed over; so is a sidechain line (`isSidechain`), which is a subagent's own
 * conversation — the model it ran on says nothing about the session's. Only the file's last
 * 512 KB is read. Null when there is none, or no file.
 */
export function lastClaudeModel(transcriptPath: string): null | string {
  const lines = tailLines(transcriptPath);
  if (lines === null) return null;
  for (const entry of entriesFromEnd(lines)) {
    if (entry.isSidechain === true) continue;
    if (entry.type !== "assistant" || !isJsonObject(entry.message)) continue;
    const model = entry.message.model;
    if (typeof model === "string" && model.startsWith("claude-")) return model;
  }
  return null;
}

/**
 * The session's name, as the transcript records it: the newest `customTitle` (what `/rename`
 * and a `sessionTitle` answer write), cleaned like every other session name. Null when the
 * session has none.
 */
export function lastCustomTitle(transcriptPath: string): null | string {
  const lines = tailLines(transcriptPath);
  if (lines === null) return null;
  for (const entry of entriesFromEnd(lines)) {
    const title = entry.customTitle;
    if (typeof title === "string" && title.trim() !== "") return title;
  }
  return null;
}

/**
 * The last answer's own text: the `text` blocks of the transcript's last `assistant` entry
 * that carries `message.content`, joined. Null when there is none (no answer yet, or a
 * transcript that cannot be read).
 */
export function lastAssistantText(transcriptPath: string): null | string {
  const lines = tailLines(transcriptPath);
  if (lines === null) return null;
  for (const entry of entriesFromEnd(lines)) {
    if (entry.type !== "assistant" || !isJsonObject(entry.message)) continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    return content
      .filter(
        (block): block is { text: string } =>
          isJsonObject(block) && block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join(" ");
  }
  return null;
}

/**
 * True when another session started this turn — a merge broadcast, a heads-up — so its end
 * is not the person's news (owner, 2026-10-13: one alert per session that answered "nothing
 * for me" is noise). Claude Code records who started a turn in the transcript:
 *   - `turnOrigin: "peer"` on the turn's start record: another session;
 *   - `origin.senderTaskId`: a helper agent of this session (alert as before);
 *   - `attachment.humanTurn: true`: a prompt the person typed into the running turn (alert).
 * A compaction summary copies its turn's origin, so it is passed over; the real start stays
 * in the file. Anything unclear (no such record, an unreadable file) is false: the alert is
 * shown.
 */
export function startedByPeer(transcriptPath: string): boolean {
  const lines = tailLines(transcriptPath);
  if (lines === null) return false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!line.includes('"turnOrigin"') && !line.includes('"humanTurn":true')) continue;
    if (line.includes('"isCompactSummary":true')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isJsonObject(entry)) continue;
    const attachment = isJsonObject(entry.attachment) ? entry.attachment : null;
    const origin = isJsonObject(entry.origin) ? entry.origin : null;
    if (attachment?.humanTurn === true) return false;
    if (origin !== null && origin.senderTaskId !== null && origin.senderTaskId !== undefined) {
      return false;
    }
    return entry.turnOrigin === "peer";
  }
  return false;
}

/**
 * How much of a transcript's start is read for the brief. The brief is the first line; a
 * brief longer than this is not one a person wrote, and the hook stays silent.
 */
export const BRIEF_HEAD_BYTES = 1024 * 1024;

/** A message's text: its `content` as a string, or its text blocks joined by a newline. */
function messageText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter(
      (block): block is { text: string } =>
        isJsonObject(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * The text of a transcript's first `user` entry: a subagent's brief. Only the file's first
 * `BRIEF_HEAD_BYTES` are read; a line that is not JSON is skipped. Null when the file cannot be
 * read or holds no such entry there.
 */
export function firstPromptText(transcriptPath: string): string | null {
  let text: string;
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const buffer = Buffer.alloc(BRIEF_HEAD_BYTES);
      const read = readSync(fd, buffer, 0, BRIEF_HEAD_BYTES, 0);
      text = buffer.subarray(0, read).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // A line cut by the read's end, or one that is not JSON at all.
      continue;
    }
    if (!isJsonObject(entry) || entry.type !== "user" || !isJsonObject(entry.message)) continue;
    return messageText(entry.message.content);
  }
  return null;
}
