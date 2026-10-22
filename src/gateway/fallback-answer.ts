/**
 * An answer another target gave for a Claude model's request, made safe to keep in a Claude
 * conversation; and the way back, a request on its way to a Claude target.
 *
 * WHY (the owner's D6, 2026-10-17, "thinking stays visible"; from 2026-10-15 until then,
 * thinking blocks were removed from such answers)
 *   A slot reached by a Claude model's family may answer from another model: a backend, or
 *   another Claude model. Claude Code stores that answer in the conversation and sends it
 *   back on every later turn. Once a Claude model answers that conversation again, Anthropic
 *   checks the `signature` of every `thinking` block there, and refuses one it cannot verify:
 *   400 "Invalid `signature` in `thinking` block" (the signature "was truncated, altered, or
 *   sent back empty", platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting).
 *   A backend's block is one (GLM through OmniRoute signs with an empty or made-up string).
 *   So the person sees a backend's reasoning, and a Claude model never gets it:
 *   - In a BACKEND's answer, each `thinking` block stays, its `signature` replaced by the
 *     router's mark, which carries the backend's own signature (`routerSignature`). In a
 *     stream the block's start carries the bare mark, the backend's own `signature_delta`
 *     events are held back, and one `signature_delta` with the whole mark comes just before
 *     the block's stop, the shape Anthropic itself streams. The signature it carries is the
 *     one Claude Code would have stored: Claude Code 2.1.306 (read in its binary) sets a
 *     thinking block's signature to "" at its start and to each `signature_delta` in turn
 *     (Anthropic's SDK takes each delta the same way), so the last delta wins, and none
 *     leaves "". Claude Code stores a block only at its stop, so a stream cut mid-thinking
 *     stores no block.
 *   - A backend's `redacted_thinking` block goes: nobody can read its encrypted `data` (the
 *     person sees nothing, and a Claude model refuses it), so keeping it would only cost a
 *     400. The later blocks' `index` values are
 *     renumbered so they stay 0, 1, 2 … (a stream); an answer left with no block gets one
 *     text block, `EMPTY_ANSWER_TEXT`.
 *   - A `tool_use` id that Anthropic would refuse (it wants `^[a-zA-Z0-9_-]+$`) gets one it
 *     takes (`safeToolUseId`). Claude Code answers with the id it was given, so the history
 *     only ever holds the safe id: nothing needs mapping back.
 *   - On a request to ANY Claude target, exactly the blocks with the router's mark leave the
 *     assistant messages (`withoutRouterThinking`); an assistant message left with no block
 *     gets the one text block, since Anthropic refuses an empty message other than the last.
 *     A request to a BACKEND keeps them, with each block's own signature given back
 *     (`thinkingForBackend`): the backend gets the history it would get with no router in
 *     between, so a backend that checks its own signatures (a Claude model behind it) still
 *     takes it.
 *   - An answer from another CLAUDE model is not touched here: Anthropic drops a block the
 *     target model cannot read, without an error (the troubleshooting page above: "A block
 *     from a model the target model can't read never produces this error: the API drops it").
 * Nothing else changes: not a word of a text block, not a tool's input, never `system`.
 *
 * Pure, for the router bundle: no import that carries the plugin version.
 */

import { createHash, randomUUID } from "node:crypto";

/**
 * The start of every `signature` the router writes on a backend's thinking block. FIXED: it
 * is stored in people's conversations, so a new spelling (even for a renamed plugin) would
 * leave every older mark unknown. It holds `:`, which is in neither base64 alphabet (A-Z a-z
 * 0-9 `+` `/` `=`, or `-` `_` for the URL-safe one), and Anthropic's signatures are base64
 * text ("EqQBCgIYAhIM…" in its docs): no signature Anthropic issues can start with it. Plain
 * ASCII that `JSON.stringify` never escapes, so a body's bytes hold it as written here.
 */
export const ROUTER_THINKING_MARK = "cc-smart-dev-kit-router:thinking:";

/** The random part of a mark: a UUID, always 36 characters, never a `:` in it. */
const MARK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MARK_ID_LENGTH = 36;

/**
 * The router's mark, made unique: the fixed prefix, a random UUID, then `:` and the
 * backend's own signature exactly as it sent it (any text, `:` and "" included). With no
 * signature (`undefined`), the bare mark: the prefix and the UUID alone. The UUID's fixed
 * length is what makes it unambiguous: whatever follows its 36 characters and the one `:`
 * is the backend's signature (`backendSignatureOf`).
 */
export function routerSignature(own?: string): string {
  return carrying(`${ROUTER_THINKING_MARK}${randomUUID()}`, own);
}

/** A bare mark, carrying the backend's own signature when there is one. */
function carrying(mark: string, own: string | undefined): string {
  return own === undefined ? mark : `${mark}:${own}`;
}

/**
 * The backend's own signature a mark carries: `{ own }`, "" included. Null for a bare mark
 * (the backend sent none, or an older router marked it) and for text after the prefix that
 * is not a mark this router writes. Undefined: not the router's mark at all.
 */
export function backendSignatureOf(signature: string): { own: string } | null | undefined {
  if (!signature.startsWith(ROUTER_THINKING_MARK)) return undefined;
  const rest = signature.slice(ROUTER_THINKING_MARK.length);
  if (!MARK_ID.test(rest.slice(0, MARK_ID_LENGTH))) return null;
  if (rest.length === MARK_ID_LENGTH || rest[MARK_ID_LENGTH] !== ":") return null;
  return { own: rest.slice(MARK_ID_LENGTH + 1) };
}

/** The block types a backend's answer loses. */
const DROPPED_BLOCKS = new Set(["redacted_thinking"]);

/** The ids Anthropic accepts for a `tool_use` block. */
const TOOL_USE_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * The one text block of an answer, or of an assistant message on its way to Claude, that
 * held only blocks the router removed. Anthropic refuses an assistant message with no
 * content block (other than the last message), and a text block with no text in it.
 */
export const EMPTY_ANSWER_TEXT = "(The fallback model answered with thinking only.)";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `thinking` block whose signature carries the router's mark. */
function isRouterThinking(block: unknown): boolean {
  return (
    isJsonObject(block) &&
    block.type === "thinking" &&
    typeof block.signature === "string" &&
    block.signature.startsWith(ROUTER_THINKING_MARK)
  );
}

/**
 * Do these bytes hold the router's mark anywhere? A cheap first look before a body is
 * parsed again: a hit may be a person's words that quote it, which `withoutRouterThinking`
 * keeps.
 */
export function holdsRouterMark(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(
    ROUTER_THINKING_MARK,
  );
}

/**
 * A request body for a Claude target, without the router's own thinking blocks: exactly the
 * `thinking` blocks marked by `routerSignature`, and only in assistant messages. A message
 * left with no block gets one text block (`EMPTY_ANSWER_TEXT`), except the last message,
 * which Anthropic lets be empty. Every other field, message and block is kept as it was, in
 * its order; with nothing marked, the same object comes back. `removed` and `filled` count.
 */
export function withoutRouterThinking(body: Record<string, unknown>): {
  body: Record<string, unknown>;
  filled: number;
  removed: number;
} {
  const messages = body.messages;
  if (!Array.isArray(messages)) return { body, filled: 0, removed: 0 };
  let removed = 0;
  let filled = 0;
  const out = messages.map((message: unknown, at: number) => {
    if (!isJsonObject(message) || message.role !== "assistant") return message;
    if (!Array.isArray(message.content)) return message;
    const content = message.content.filter((block: unknown) => !isRouterThinking(block));
    if (content.length === message.content.length) return message;
    removed += message.content.length - content.length;
    if (content.length === 0 && at < messages.length - 1) {
      filled += 1;
      content.push({ text: EMPTY_ANSWER_TEXT, type: "text" });
    }
    return { ...message, content };
  });
  if (removed === 0) return { body, filled, removed };
  return { body: { ...body, messages: out }, filled, removed };
}

/**
 * A request body for a BACKEND, with each of the router's thinking blocks given back the
 * signature that backend wrote: the one translation of a request's thinking blocks on the
 * way to a backend (`.claude/rules/gateway.md`). A block whose mark carries a signature gets
 * exactly it, "" included; a bare mark (the backend sent no signature, or an older router
 * marked it) loses its `signature` field, as the backend sent it. Only `thinking` blocks in
 * assistant messages whose signature starts with the mark; every other field, message and
 * block is kept, in its order. With nothing marked, the same object comes back. `restored`
 * and `bare` count.
 */
export function thinkingForBackend(body: Record<string, unknown>): {
  bare: number;
  body: Record<string, unknown>;
  restored: number;
} {
  const messages = body.messages;
  if (!Array.isArray(messages)) return { bare: 0, body, restored: 0 };
  let restored = 0;
  let bare = 0;
  const out = messages.map((message: unknown) => {
    if (!isJsonObject(message) || message.role !== "assistant") return message;
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((block: unknown) => {
      if (!isJsonObject(block) || !isRouterThinking(block)) return block;
      changed = true;
      const carried = backendSignatureOf(String(block.signature));
      if (carried) {
        restored += 1;
        return { ...block, signature: carried.own };
      }
      bare += 1;
      const { signature: _mark, ...unsigned } = block;
      return unsigned;
    });
    return changed ? { ...message, content } : message;
  });
  if (restored === 0 && bare === 0) return { bare, body, restored };
  return { bare, body: { ...body, messages: out }, restored };
}

/**
 * A `tool_use` id Anthropic accepts: the id itself when it already is one, else the same
 * one every time for the same id (`toolu_cc-smart-dev-kit_` and 24 hex characters of its SHA-256).
 */
export function safeToolUseId(id: string): string {
  if (TOOL_USE_ID.test(id)) return id;
  return `toolu_cc-smart-dev-kit_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
}

/** What `cleanFallbackMessage` / `cleanFallbackStream` changed, for the log. */
export interface FallbackChanges {
  /** `tool_use` ids replaced by `safeToolUseId`. */
  ids: number;
  /** `thinking` blocks kept, their signature now the router's mark. */
  marked: number;
  /** `redacted_thinking` blocks removed. */
  redacted: number;
}

function noChanges(): FallbackChanges {
  return { ids: 0, marked: 0, redacted: 0 };
}

function changedAny(changes: FallbackChanges): boolean {
  return changes.ids > 0 || changes.marked > 0 || changes.redacted > 0;
}

/** A content block with a safe `tool_use` id; the same object when it had one. */
function withSafeId(block: Record<string, unknown>, changes: FallbackChanges) {
  if (block.type !== "tool_use" || typeof block.id !== "string") return block;
  const id = safeToolUseId(block.id);
  if (id === block.id) return block;
  changes.ids += 1;
  return { ...block, id };
}

/** Is this a block a backend's answer loses? */
function isDropped(block: unknown): boolean {
  return isJsonObject(block) && typeof block.type === "string" && DROPPED_BLOCKS.has(block.type);
}

/**
 * A backend's whole (not streamed) answer: `{"type":"message","content":[…]}`, cleaned.
 * Anything else comes back as it is. `changes` says what changed (all zero: nothing).
 */
export function cleanFallbackMessage(message: unknown): {
  changes: FallbackChanges;
  message: unknown;
} {
  const changes = noChanges();
  if (!isJsonObject(message) || !Array.isArray(message.content)) return { changes, message };
  const content: unknown[] = [];
  for (const block of message.content) {
    if (isDropped(block)) {
      changes.redacted += 1;
      continue;
    }
    if (isJsonObject(block) && block.type === "thinking") {
      changes.marked += 1;
      const own = typeof block.signature === "string" ? block.signature : undefined;
      content.push({ ...block, signature: routerSignature(own) });
      continue;
    }
    content.push(isJsonObject(block) ? withSafeId(block, changes) : block);
  }
  if (!changedAny(changes)) return { changes, message };
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
 * A backend's streamed answer, cleaned event by event (the rules at the top of this file).
 * An event split over network chunks is held until it is whole; every other event passes
 * as its own bytes. `onDone` gets what changed when the stream ends.
 */
export function cleanFallbackStream(
  onDone: (changes: FallbackChanges) => void = () => undefined,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const changes = noChanges();
  /** The block indexes the upstream used for a removed block. */
  const dropped = new Set<number>();
  /**
   * Each open thinking block, by the upstream's index: the bare mark it started with, and
   * the backend's own signature so far as Claude Code would hold it ("" at the start, then
   * the last `signature_delta`).
   */
  const thinking = new Map<number, { mark: string; own: string }>();
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
      // Every block was removed: one text block, so the message is not empty.
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
    const next = renumber(index);
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (isDropped(block)) {
        dropped.add(index);
        changes.redacted += 1;
        return "";
      }
      kept += 1;
      if (isJsonObject(block) && block.type === "thinking") {
        const mark = routerSignature();
        thinking.set(index, { mark, own: "" });
        changes.marked += 1;
        return eventText(label, {
          ...event,
          content_block: { ...block, signature: mark },
          index: next,
        });
      }
      const safe = isJsonObject(block) ? withSafeId(block, changes) : block;
      if (next === index && safe === block) return text;
      return eventText(label, { ...event, content_block: safe, index: next });
    }
    if (dropped.has(index)) return "";
    const open = thinking.get(index);
    if (open !== undefined && event.type === "content_block_delta") {
      // The backend's own signature: held, and carried by the one mark sent before the stop.
      const delta = event.delta;
      if (isJsonObject(delta) && delta.type === "signature_delta") {
        if (typeof delta.signature === "string") open.own = delta.signature;
        return "";
      }
    }
    const passed = next === index ? text : eventText(label, { ...event, index: next });
    if (open === undefined || event.type !== "content_block_stop") return passed;
    thinking.delete(index);
    return (
      eventText("content_block_delta", {
        delta: { signature: carrying(open.mark, open.own), type: "signature_delta" },
        index: next,
        type: "content_block_delta",
      }) + passed
    );
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
 * A backend's 2xx answer, cleaned (`cleanFallbackMessage`, `cleanFallbackStream`), as
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
      note: `its answer is "${encoding.slice(0, 40)}" encoded, which the router cannot read: its thinking blocks were not marked as the router's`,
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
    if (changedAny(changes)) onChanged(changes);
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
    return changedAny(result.changes)
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
