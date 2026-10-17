/**
 * An answer another target gave for a Claude model's request, made safe to keep in a Claude
 * conversation.
 *
 * WHY (the owner's yes, 2026-10-15, first for a model slot's fallback; since 0.5.0 for every
 * answer another target gives to a request that named a Claude model)
 *   A slot reached by a Claude model's family may answer from another model: a backend, or
 *   another Claude model. Claude Code stores that answer in the conversation and sends it
 *   back on every later turn. Once the Claude model answers that conversation again, it
 *   checks the signature of every `thinking` block in the history. A block another model
 *   wrote (GLM through OmniRoute answers with a `thinking` block whose signature is made up,
 *   and a `redacted_thinking` block) fails that check: Anthropic answers 400 "Invalid `signature` in `thinking`
 *   block", and resending the same history never clears it
 *   (platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting). The session
 *   is stuck. So, for those answers only (never the model's own):
 *   - `thinking` and `redacted_thinking` blocks are removed, and the later blocks'
 *     `index` values renumbered so they stay 0, 1, 2 … (a stream);
 *   - an answer left with no block gets one text block, `EMPTY_ANSWER_TEXT`: Anthropic
 *     refuses an assistant message with no content, and an empty text block too;
 *   - a `tool_use` id that Anthropic would refuse (it wants `^[a-zA-Z0-9_-]+$`) gets one it
 *     takes (`safeToolUseId`). Claude Code answers with the id it was given, so the history
 *     only ever holds the safe id: nothing needs mapping back.
 * Nothing else changes: not a word of a text block, not a tool's input. A request is never
 * touched here; Claude requests stay byte for byte.
 *
 * Pure, for the router bundle: no import that carries the plugin version.
 */

import { createHash } from "node:crypto";

/** The block types a fallback answer loses. */
const DROPPED_BLOCKS = new Set(["redacted_thinking", "thinking"]);

/** The ids Anthropic accepts for a `tool_use` block. */
const TOOL_USE_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * The one text block of a fallback answer that held thinking only. Anthropic refuses an
 * assistant message with no content block, and a text block with no text in it.
 */
export const EMPTY_ANSWER_TEXT = "(The fallback model answered with thinking only.)";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A `tool_use` id Anthropic accepts: the id itself when it already is one, else the same
 * one every time for the same id (`toolu_cc-smart-dev-kit_` and 24 hex characters of its SHA-256).
 */
export function safeToolUseId(id: string): string {
  if (TOOL_USE_ID.test(id)) return id;
  return `toolu_cc-smart-dev-kit_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
}

/** What `cleanFallbackMessage` changed, for the log. */
export interface FallbackChanges {
  /** `tool_use` ids replaced by `safeToolUseId`. */
  ids: number;
  /** `thinking` / `redacted_thinking` blocks removed. */
  thinking: number;
}

/** A content block with a safe `tool_use` id; the same object when it had one. */
function withSafeId(block: Record<string, unknown>, changes: FallbackChanges) {
  if (block.type !== "tool_use" || typeof block.id !== "string") return block;
  const id = safeToolUseId(block.id);
  if (id === block.id) return block;
  changes.ids += 1;
  return { ...block, id };
}

/**
 * A whole (not streamed) fallback answer: `{"type":"message","content":[…]}`, cleaned.
 * Anything else comes back as it is. `changes` says what changed (all zero: nothing).
 */
export function cleanFallbackMessage(message: unknown): {
  changes: FallbackChanges;
  message: unknown;
} {
  const changes: FallbackChanges = { ids: 0, thinking: 0 };
  if (!isJsonObject(message) || !Array.isArray(message.content)) return { changes, message };
  const content: unknown[] = [];
  for (const block of message.content) {
    if (isJsonObject(block) && typeof block.type === "string" && DROPPED_BLOCKS.has(block.type)) {
      changes.thinking += 1;
      continue;
    }
    content.push(isJsonObject(block) ? withSafeId(block, changes) : block);
  }
  if (changes.thinking === 0 && changes.ids === 0) return { changes, message };
  if (content.length === 0) content.push({ text: EMPTY_ANSWER_TEXT, type: "text" });
  return { changes, message: { ...message, content } };
}

/** One server-sent event as text, with its trailing blank line. */
function eventText(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The end of the first event in `text` (after its blank line), or -1 when none is whole. */
function eventEnd(text: string): number {
  const match = /\r?\n\r?\n/.exec(text);
  return match === null ? -1 : match.index + match[0].length;
}

/** The `event:` name and the joined `data:` of one event; null data when there is none. */
function parseEvent(text: string): { data: null | string; name: null | string } {
  let name: null | string = null;
  const data: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") name = value;
    if (field === "data") data.push(value);
  }
  return { data: data.length === 0 ? null : data.join("\n"), name };
}

/**
 * A streamed fallback answer, cleaned event by event (the rules at the top of this file).
 * An event split over network chunks is held until it is whole; every other event passes
 * as its own bytes. `onDone` gets what changed when the stream ends.
 */
export function cleanFallbackStream(
  onDone: (changes: FallbackChanges) => void = () => undefined,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const changes: FallbackChanges = { ids: 0, thinking: 0 };
  /** The block indexes the upstream used for a removed block. */
  const dropped = new Set<number>();
  let kept = 0;
  let filled = false;
  let buffer = "";

  /** The index Claude Code sees: the upstream's, less the removed blocks before it. */
  const renumber = (index: number) => {
    let below = 0;
    for (const gone of dropped) if (gone < index) below += 1;
    return index - below;
  };

  /** The event's text as Claude Code gets it: the same, changed, or "" (removed). */
  const clean = (text: string): string => {
    const { data, name } = parseEvent(text);
    if (data === null) return text;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      // Not JSON: not a block event; it passes as it came.
      return text;
    }
    if (!isJsonObject(event) || typeof event.type !== "string") return text;
    const label = name ?? event.type;
    if (event.type === "message_delta" || event.type === "message_stop") {
      // Every block was thinking: one text block, so the message is not empty.
      if (kept > 0 || dropped.size === 0 || filled) return text;
      filled = true;
      return [
        eventText("content_block_start", {
          content_block: { text: "", type: "text" },
          index: 0,
          type: "content_block_start",
        }),
        eventText("content_block_delta", {
          delta: { text: EMPTY_ANSWER_TEXT, type: "text_delta" },
          index: 0,
          type: "content_block_delta",
        }),
        eventText("content_block_stop", { index: 0, type: "content_block_stop" }),
        text,
      ].join("");
    }
    const isBlock =
      event.type === "content_block_start" ||
      event.type === "content_block_delta" ||
      event.type === "content_block_stop";
    if (!isBlock || typeof event.index !== "number") return text;
    const index = event.index;
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (isJsonObject(block) && typeof block.type === "string" && DROPPED_BLOCKS.has(block.type)) {
        dropped.add(index);
        changes.thinking += 1;
        return "";
      }
      kept += 1;
      const safe = isJsonObject(block) ? withSafeId(block, changes) : block;
      const next = renumber(index);
      if (next === index && safe === block) return text;
      return eventText(label, { ...event, content_block: safe, index: next });
    }
    if (dropped.has(index)) return "";
    const next = renumber(index);
    return next === index ? text : eventText(label, { ...event, index: next });
  };

  const drain = (controller: TransformStreamDefaultController<Uint8Array>) => {
    for (;;) {
      const end = eventEnd(buffer);
      if (end === -1) return;
      const out = clean(buffer.slice(0, end));
      buffer = buffer.slice(end);
      if (out !== "") controller.enqueue(encoder.encode(out));
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) {
      buffer += decoder.decode();
      drain(controller);
      // A last event with no blank line after it: passed on as it came.
      if (buffer !== "") controller.enqueue(encoder.encode(buffer));
      onDone(changes);
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      drain(controller);
    },
  });
}

/** A `content-encoding` the router can undo, as `DecompressionStream` names it. */
function decoding(encoding: string): Bun.CompressionFormat | null | "identity" {
  switch (encoding.trim().toLowerCase()) {
    case "":
    case "identity":
      return "identity";
    case "gzip":
    case "x-gzip":
      return "gzip";
    case "deflate":
      return "deflate";
    case "br":
      return "brotli";
    case "zstd":
      return "zstd";
    default:
      return null;
  }
}

/**
 * A fallback's 2xx answer, cleaned (`cleanFallbackMessage`, `cleanFallbackStream`), as
 * Claude Code gets it. A compressed body is decompressed first, and goes on without
 * `content-encoding`; `content-length` goes too, since the length changes. An answer it
 * cannot read (an encoding it does not know) comes back as it is, and `note` says so for
 * the log; another content type, or an error answer, comes back as it is. `onChanged`
 * gets what changed, when anything did.
 */
export function cleanFallbackResponse(
  response: Response,
  onChanged: (changes: FallbackChanges) => void,
): { note: null | string; response: Response } {
  if (!response.ok || response.body === null) return { note: null, response };
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  const stream = type.includes("text/event-stream");
  if (!stream && !type.includes("json")) return { note: null, response };
  const encoding = response.headers.get("content-encoding") ?? "";
  const format = decoding(encoding);
  if (format === null) {
    return {
      note: `its answer is "${encoding.slice(0, 40)}" encoded, which the router cannot read: thinking blocks were not removed`,
      response,
    };
  }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  const plain =
    format === "identity"
      ? response.body
      : response.body.pipeThrough(new DecompressionStream(format));
  const report = (changes: FallbackChanges) => {
    if (changes.thinking > 0 || changes.ids > 0) onChanged(changes);
  };
  const init = { headers, status: response.status, statusText: response.statusText };
  if (stream) {
    return {
      note: null,
      response: new Response(plain.pipeThrough(cleanFallbackStream(report)), init),
    };
  }
  // A whole answer: read, cleaned, and written again only when something changed.
  const cleaned = new Response(plain).arrayBuffer().then((bytes) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // Not JSON after all: Claude Code gets the bytes as they came.
      return new Uint8Array(bytes);
    }
    const result = cleanFallbackMessage(parsed);
    report(result.changes);
    return result.changes.thinking > 0 || result.changes.ids > 0
      ? new TextEncoder().encode(JSON.stringify(result.message))
      : new Uint8Array(bytes);
  });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      controller.enqueue(await cleaned);
      controller.close();
    },
  });
  return { note: null, response: new Response(body, init) };
}
