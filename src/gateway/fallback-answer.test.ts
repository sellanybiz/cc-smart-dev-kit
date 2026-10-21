/**
 * Another target's answer for a Claude model, made safe to keep in a Claude conversation
 * (the owner's D6, 2026-10-17): a backend's thinking stays, its signature the router's mark;
 * redacted_thinking out, block indexes renumbered, never an empty message, tool_use ids
 * Claude takes. And the way back: a request to a Claude target loses exactly the marked
 * blocks. Every expected value is written by hand (the safe id: `printf 'functions.Read:0' |
 * sha256sum`, its first 24 characters).
 */
import { describe, expect, it } from "bun:test";
import {
  backendSignatureOf,
  cleanFallbackMessage,
  cleanFallbackResponse,
  cleanFallbackStream,
  EMPTY_ANSWER_TEXT,
  type FallbackChanges,
  holdsRouterMark,
  ROUTER_THINKING_MARK,
  routerSignature,
  safeToolUseId,
  thinkingForBackend,
  withoutRouterThinking,
} from "./fallback-answer";

const SAFE_ID = "toolu_cc-smart-dev-kit_9d4d98f9adde8d726e98af64";

/** A bare router mark: the fixed prefix, then a random UUID (written out by hand). */
const MARKED =
  /^cc-smart-dev-kit-router:thinking:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A bare mark's length: 33 for the prefix, 36 for the UUID. */
const BARE_LENGTH = 69;

/** A mark split in two: the bare mark, and what follows it (":" and the backend's own). */
function splitMark(signature: string): { bare: string; rest: string } {
  return { bare: signature.slice(0, BARE_LENGTH), rest: signature.slice(BARE_LENGTH) };
}

/** One event as an Anthropic stream writes it. */
function sse(name: string, data: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Push `text` through a stream cleaner in pieces of `size` bytes; the text that comes out. */
async function throughStream(
  text: string,
  size: number,
): Promise<{ changes: FallbackChanges | null; out: string }> {
  const bytes = new TextEncoder().encode(text);
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let start = 0; start < bytes.length; start += size) {
        controller.enqueue(bytes.slice(start, start + size));
      }
      controller.close();
    },
  });
  let changes: FallbackChanges | null = null;
  const out = await new Response(
    input.pipeThrough(
      cleanFallbackStream((done) => {
        changes = done;
      }),
    ),
  ).text();
  return { changes, out };
}

/** The mark each `signature` in `out` carries, in order (a stream's or a message's text). */
function marksIn(out: string): string[] {
  return [...out.matchAll(/"signature":"([^"]*)"/g)].map((match) => match[1] ?? "");
}

const START = sse("message_start", {
  message: { content: [], id: "msg_1", model: "glm-5.3-flash", role: "assistant" },
  type: "message_start",
});
const DELTA = sse("message_delta", {
  delta: { stop_reason: "end_turn" },
  type: "message_delta",
  usage: { output_tokens: 9 },
});
const STOP = sse("message_stop", { type: "message_stop" });

describe("the router's mark", () => {
  it("D6: a fixed prefix with a ':' in it (never in base64 or base64url), then a fresh UUID each time", () => {
    expect(ROUTER_THINKING_MARK).toBe("cc-smart-dev-kit-router:thinking:");
    const one = routerSignature();
    const two = routerSignature();
    expect(one).toMatch(MARKED);
    expect(two).toMatch(MARKED);
    expect(one).not.toBe(two);
  });

  it("D6: a mark carries the backend's own signature after a ':', exactly; backendSignatureOf reads it back, whatever it holds", () => {
    for (const own of ["EqQBCgIYAhIM1gbcDa9GJwZA2b+/=", "", "a:b::c", ":", "sig with spaces"]) {
      const mark = routerSignature(own);
      const { bare, rest } = splitMark(mark);
      expect(bare).toMatch(MARKED);
      expect(rest).toBe(`:${own}`);
      expect(backendSignatureOf(mark)).toEqual({ own });
    }
  });

  it("D6: backendSignatureOf: a bare mark (an older router's, or a block the backend sent unsigned) carries none; text that is not ours is not a mark", () => {
    const bare = `${ROUTER_THINKING_MARK}11111111-1111-4111-8111-111111111111`;
    expect(backendSignatureOf(bare)).toBeNull();
    // Not a UUID after the prefix, or no ':' right after it: the router's, but carrying none.
    expect(backendSignatureOf(`${ROUTER_THINKING_MARK}not-a-uuid:sig`)).toBeNull();
    expect(backendSignatureOf(`${bare}${bare}:sig`)).toBeNull();
    expect(backendSignatureOf("EqQBCgIYAhIM")).toBeUndefined();
    expect(backendSignatureOf("")).toBeUndefined();
  });

  it("D6: holdsRouterMark finds the prefix in a body's bytes, and nothing else", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(holdsRouterMark(encode(`{"signature":"${routerSignature()}"}`))).toBe(true);
    // Anthropic's signatures are base64: they never hold the prefix.
    expect(holdsRouterMark(encode('{"signature":"EqQBCgIYAhIM1gbcDa9GJwZA2b+/="}'))).toBe(false);
    expect(holdsRouterMark(encode("cc-smart-dev-kit-router:thinkin"))).toBe(false);
  });
});

describe("a whole answer", () => {
  it("D6: thinking stays with the router's mark; redacted_thinking goes; text and tools stay; a bad tool_use id is made safe", () => {
    const answer = {
      content: [
        { signature: "made-up", thinking: "Let me think.", type: "thinking" },
        { data: "abc", type: "redacted_thinking" },
        { text: "Reading it.", type: "text" },
        { id: "functions.Read:0", input: { path: "a.ts" }, name: "Read", type: "tool_use" },
        { id: "toolu_ok-1", input: {}, name: "Bash", type: "tool_use" },
      ],
      id: "msg_1",
      model: "glm-5.3-flash",
      role: "assistant",
      stop_reason: "tool_use",
      type: "message",
    };
    const result = cleanFallbackMessage(answer);
    expect(result.changes).toEqual({ ids: 1, marked: 1, redacted: 1 });
    const signature = marksIn(JSON.stringify(result.message))[0] ?? "";
    expect(splitMark(signature).bare).toMatch(MARKED);
    expect(splitMark(signature).rest).toBe(":made-up");
    expect(result.message).toEqual({
      content: [
        { signature, thinking: "Let me think.", type: "thinking" },
        { text: "Reading it.", type: "text" },
        { id: SAFE_ID, input: { path: "a.ts" }, name: "Read", type: "tool_use" },
        { id: "toolu_ok-1", input: {}, name: "Bash", type: "tool_use" },
      ],
      id: "msg_1",
      model: "glm-5.3-flash",
      role: "assistant",
      stop_reason: "tool_use",
      type: "message",
    });
    // The answer it came from is not changed in place.
    expect(answer.content[0]).toEqual({
      signature: "made-up",
      thinking: "Let me think.",
      type: "thinking",
    });
  });

  it("D6: a thinking block with no signature at all gets the bare mark; an empty one is carried as empty", () => {
    const answer = { content: [{ thinking: "hmm", type: "thinking" }], type: "message" };
    const result = cleanFallbackMessage(answer);
    expect(result.changes).toEqual({ ids: 0, marked: 1, redacted: 0 });
    expect(marksIn(JSON.stringify(result.message))[0]).toMatch(MARKED);
    const empty = cleanFallbackMessage({
      content: [{ signature: "", thinking: "hmm", type: "thinking" }],
      type: "message",
    });
    expect(splitMark(marksIn(JSON.stringify(empty.message))[0] ?? "").rest).toBe(":");
  });

  it("D6: an answer of thinking only stays thinking (the request to Claude fills it); one of redacted_thinking only gets one text block", () => {
    const thinkingOnly = cleanFallbackMessage({
      content: [{ signature: "x", thinking: "hmm", type: "thinking" }],
      role: "assistant",
      type: "message",
    });
    expect(thinkingOnly.message).toEqual({
      content: [
        {
          signature: marksIn(JSON.stringify(thinkingOnly.message))[0],
          thinking: "hmm",
          type: "thinking",
        },
      ],
      role: "assistant",
      type: "message",
    });
    expect(
      cleanFallbackMessage({
        content: [{ data: "abc", type: "redacted_thinking" }],
        role: "assistant",
        type: "message",
      }).message,
    ).toEqual({
      content: [{ text: "(The fallback model answered with thinking only.)", type: "text" }],
      role: "assistant",
      type: "message",
    });
    expect(EMPTY_ANSWER_TEXT).toBe("(The fallback model answered with thinking only.)");
  });

  it("an answer with nothing to change is the same object; anything else passes", () => {
    const plain = { content: [{ text: "hi", type: "text" }], type: "message" };
    expect(cleanFallbackMessage(plain).message).toBe(plain);
    expect(cleanFallbackMessage("text").message).toBe("text");
    // An empty answer the backend sent is not ours to fill.
    const empty = { content: [], type: "message" };
    expect(cleanFallbackMessage(empty).message).toBe(empty);
  });

  it("safeToolUseId: a good id stays; a bad one becomes the same safe id every time", () => {
    expect(safeToolUseId("toolu_01ABC-x_9")).toBe("toolu_01ABC-x_9");
    expect(safeToolUseId("functions.Read:0")).toBe(SAFE_ID);
    expect(safeToolUseId("functions.Read:0")).toBe(SAFE_ID);
    expect(safeToolUseId("")).toMatch(/^toolu_cc-smart-dev-kit_[0-9a-f]{24}$/);
  });
});

describe("a streamed answer", () => {
  const THINKING_AND_TEXT = [
    START,
    sse("content_block_start", {
      content_block: { thinking: "", type: "thinking" },
      index: 0,
      type: "content_block_start",
    }),
    sse("content_block_delta", {
      delta: { thinking: "Let me think.", type: "thinking_delta" },
      index: 0,
      type: "content_block_delta",
    }),
    sse("content_block_delta", {
      delta: { signature: "made-up", type: "signature_delta" },
      index: 0,
      type: "content_block_delta",
    }),
    sse("content_block_stop", { index: 0, type: "content_block_stop" }),
    ": a heartbeat comment\n\n",
    sse("ping", { type: "ping" }),
    sse("content_block_start", {
      content_block: { data: "abc", type: "redacted_thinking" },
      index: 1,
      type: "content_block_start",
    }),
    sse("content_block_stop", { index: 1, type: "content_block_stop" }),
    sse("content_block_start", {
      content_block: { text: "", type: "text" },
      index: 2,
      type: "content_block_start",
    }),
    sse("content_block_delta", {
      delta: { text: "Reading it.", type: "text_delta" },
      index: 2,
      type: "content_block_delta",
    }),
    sse("content_block_stop", { index: 2, type: "content_block_stop" }),
    sse("content_block_start", {
      content_block: { id: "functions.Read:0", input: {}, name: "Read", type: "tool_use" },
      index: 3,
      type: "content_block_start",
    }),
    sse("content_block_delta", {
      delta: { partial_json: '{"path":"a.ts"}', type: "input_json_delta" },
      index: 3,
      type: "content_block_delta",
    }),
    sse("content_block_stop", { index: 3, type: "content_block_stop" }),
    DELTA,
    STOP,
  ].join("");

  /**
   * What Claude Code must get: the thinking at 0, its start with the bare mark and its one
   * signature_delta (just before its stop, as Anthropic sends it) with that mark carrying the
   * backend's "made-up"; no redacted_thinking; the text at 1, the tool at 2 with a safe id.
   */
  const expected = (mark: string) =>
    [
      START,
      sse("content_block_start", {
        // The mark comes after the backend's own fields: the start had no signature.
        content_block: { thinking: "", type: "thinking", signature: mark },
        index: 0,
        type: "content_block_start",
      }),
      sse("content_block_delta", {
        delta: { thinking: "Let me think.", type: "thinking_delta" },
        index: 0,
        type: "content_block_delta",
      }),
      sse("content_block_delta", {
        delta: { signature: `${mark}:made-up`, type: "signature_delta" },
        index: 0,
        type: "content_block_delta",
      }),
      sse("content_block_stop", { index: 0, type: "content_block_stop" }),
      ": a heartbeat comment\n\n",
      sse("ping", { type: "ping" }),
      sse("content_block_start", {
        content_block: { text: "", type: "text" },
        index: 1,
        type: "content_block_start",
      }),
      sse("content_block_delta", {
        delta: { text: "Reading it.", type: "text_delta" },
        index: 1,
        type: "content_block_delta",
      }),
      sse("content_block_stop", { index: 1, type: "content_block_stop" }),
      sse("content_block_start", {
        content_block: { id: SAFE_ID, input: {}, name: "Read", type: "tool_use" },
        index: 2,
        type: "content_block_start",
      }),
      sse("content_block_delta", {
        delta: { partial_json: '{"path":"a.ts"}', type: "input_json_delta" },
        index: 2,
        type: "content_block_delta",
      }),
      sse("content_block_stop", { index: 2, type: "content_block_stop" }),
      DELTA,
      STOP,
    ].join("");

  it("D6: a streamed thinking block stays, marked at its start and in one signature_delta; redacted_thinking goes; indexes stay 0, 1, …, whatever the chunk sizes", async () => {
    for (const size of [1, 7, 64, 100_000]) {
      const { changes, out } = await throughStream(THINKING_AND_TEXT, size);
      const marks = marksIn(out);
      expect(marks).toHaveLength(2);
      expect(marks[0]).toMatch(MARKED);
      expect(marks[1]).toBe(`${marks[0]}:made-up`);
      expect(out).toBe(expected(marks[0] ?? ""));
      expect(changes).toEqual({ ids: 1, marked: 1, redacted: 1 });
    }
  });

  it("D6: interleaved thinking with tool calls: each thinking block gets its own mark, even one the backend gave no signature", async () => {
    const block = (index: number, type: string, extra: Record<string, unknown>) =>
      sse("content_block_start", {
        content_block: { type, ...extra },
        index,
        type: "content_block_start",
      });
    const stop = (index: number) =>
      sse("content_block_stop", { index, type: "content_block_stop" });
    const interleaved = [
      START,
      block(0, "thinking", { signature: "", thinking: "" }),
      stop(0),
      block(1, "tool_use", { id: "toolu_a", input: {}, name: "Read" }),
      stop(1),
      block(2, "thinking", { thinking: "" }),
      sse("content_block_delta", {
        delta: { signature: "x", type: "signature_delta" },
        index: 2,
        type: "content_block_delta",
      }),
      stop(2),
      block(3, "tool_use", { id: "toolu_b", input: {}, name: "Bash" }),
      stop(3),
      DELTA,
      STOP,
    ].join("");
    const { changes, out } = await throughStream(interleaved, 11);
    const marks = marksIn(out);
    expect(marks).toHaveLength(4);
    expect(marks[0]).toMatch(MARKED);
    expect(marks[2]).toMatch(MARKED);
    // Start and delta of one block share a mark; the two blocks differ. The first had no
    // signature_delta: it carries "", what Claude Code would hold. The second carries "x".
    expect(marks[1]).toBe(`${marks[0]}:`);
    expect(marks[3]).toBe(`${marks[2]}:x`);
    expect(marks[2]).not.toBe(marks[0] ?? "");
    expect(out).toContain('"index":1,"type":"content_block_start"');
    expect(out).toContain('"index":3,"type":"content_block_start"');
    expect(changes).toEqual({ ids: 0, marked: 2, redacted: 0 });
  });

  it("D6: a signature in several deltas: held until the stop, and the last one carried, as Claude Code keeps it", async () => {
    const delta = (signature: string) =>
      sse("content_block_delta", {
        delta: { signature, type: "signature_delta" },
        index: 0,
        type: "content_block_delta",
      });
    const several = [
      START,
      sse("content_block_start", {
        content_block: { signature: "from-the-start", thinking: "", type: "thinking" },
        index: 0,
        type: "content_block_start",
      }),
      delta("first:part"),
      sse("content_block_delta", {
        delta: { thinking: "Thinking.", type: "thinking_delta" },
        index: 0,
        type: "content_block_delta",
      }),
      delta("Eq:last+/="),
      sse("content_block_stop", { index: 0, type: "content_block_stop" }),
      DELTA,
      STOP,
    ].join("");
    for (const size of [1, 13, 100_000]) {
      const { out } = await throughStream(several, size);
      const marks = marksIn(out);
      expect(marks).toHaveLength(2);
      expect(marks[0]).toMatch(MARKED);
      expect(marks[1]).toBe(`${marks[0]}:Eq:last+/=`);
      expect(out).not.toContain("first:part");
      expect(out).not.toContain("from-the-start");
      // One signature_delta, right before the stop.
      expect(out.match(/signature_delta/g)).toHaveLength(1);
      expect(out.indexOf("signature_delta")).toBeGreaterThan(out.indexOf("Thinking."));
    }
  });

  it("D6: a stream cut mid-thinking: the block's start carries the bare mark (Claude Code stores a block only at its stop)", async () => {
    const cut = [
      START,
      sse("content_block_start", {
        content_block: { thinking: "", type: "thinking" },
        index: 0,
        type: "content_block_start",
      }),
      sse("content_block_delta", {
        delta: { thinking: "Half a tho", type: "thinking_delta" },
        index: 0,
        type: "content_block_delta",
      }),
    ].join("");
    const { changes, out } = await throughStream(cut, 5);
    const marks = marksIn(out);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatch(MARKED);
    expect(out).toContain("Half a tho");
    expect(changes).toEqual({ ids: 0, marked: 1, redacted: 0 });
  });

  it("CRLF line ends are read as well", async () => {
    const crlf = THINKING_AND_TEXT.replaceAll("\n", "\r\n");
    const { out } = await throughStream(crlf, 5);
    expect(out).not.toContain("redacted_thinking");
    // The backend's own delta is gone; only the mark carries its signature.
    expect(out).not.toContain('"signature":"made-up"');
    expect(marksIn(out)[1]).toBe(`${marksIn(out)[0]}:made-up`);
    expect(out).toContain('"index":1,"type":"content_block_start"');
  });

  it("D6: an answer of redacted_thinking only gets one text block before message_delta", async () => {
    const onlyRedacted = [
      START,
      sse("content_block_start", {
        content_block: { data: "abc", type: "redacted_thinking" },
        index: 0,
        type: "content_block_start",
      }),
      sse("content_block_stop", { index: 0, type: "content_block_stop" }),
      DELTA,
      STOP,
    ].join("");
    const { out } = await throughStream(onlyRedacted, 9);
    expect(out).toBe(
      [
        START,
        sse("content_block_start", {
          content_block: { text: "", type: "text" },
          index: 0,
          type: "content_block_start",
        }),
        sse("content_block_delta", {
          delta: { text: "(The fallback model answered with thinking only.)", type: "text_delta" },
          index: 0,
          type: "content_block_delta",
        }),
        sse("content_block_stop", { index: 0, type: "content_block_stop" }),
        DELTA,
        STOP,
      ].join(""),
    );
  });

  it("a stream with nothing to change passes byte for byte, a cut-off last event too", async () => {
    const plain = [
      START,
      sse("content_block_start", {
        content_block: { text: "", type: "text" },
        index: 0,
        type: "content_block_start",
      }),
      "data: not json\n\n",
      "event: message_stop\ndata: {",
    ].join("");
    const { changes, out } = await throughStream(plain, 3);
    expect(out).toBe(plain);
    expect(changes).toEqual({ ids: 0, marked: 0, redacted: 0 });
  });
});

describe("the answer as Claude Code gets it", () => {
  const ANSWER = JSON.stringify({
    content: [
      { data: "r", type: "redacted_thinking" },
      { text: "Done.", type: "text" },
    ],
    type: "message",
  });

  it("a gzip JSON answer: read, cleaned, sent without content-encoding or content-length", async () => {
    const gzipped = Bun.gzipSync(new TextEncoder().encode(ANSWER));
    const seen: FallbackChanges[] = [];
    const { note, response } = cleanFallbackResponse(
      new Response(gzipped, {
        headers: {
          "content-encoding": "gzip",
          "content-length": String(gzipped.length),
          "content-type": "application/json",
          "request-id": "req_1",
        },
        status: 200,
      }),
      (changes) => seen.push(changes),
    );
    expect(note).toBeNull();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("request-id")).toBe("req_1");
    expect(await response.text()).toBe(
      '{"content":[{"text":"Done.","type":"text"}],"type":"message"}',
    );
    expect(seen).toEqual([{ ids: 0, marked: 0, redacted: 1 }]);
  });

  it("an encoding it cannot read, an error answer, or another type: as it came", async () => {
    const odd = new Response(ANSWER, {
      headers: { "content-encoding": "compress", "content-type": "application/json" },
    });
    const kept = cleanFallbackResponse(odd, () => undefined);
    expect(kept.response).toBe(odd);
    expect(kept.note).toBe(
      'its answer is "compress" encoded, which the router cannot read: its thinking blocks were not marked as the router\'s',
    );
    const error = new Response(ANSWER, {
      headers: { "content-type": "application/json" },
      status: 400,
    });
    expect(cleanFallbackResponse(error, () => undefined).response).toBe(error);
    const html = new Response(ANSWER, { headers: { "content-type": "text/html" } });
    expect(cleanFallbackResponse(html, () => undefined).response).toBe(html);
  });

  it("a JSON answer with nothing to change keeps its bytes", async () => {
    const spaced = '{ "content": [ { "text": "hi", "type": "text" } ], "type": "message" }';
    const { response } = cleanFallbackResponse(
      new Response(spaced, { headers: { "content-type": "application/json" } }),
      () => undefined,
    );
    expect(await response.text()).toBe(spaced);
  });
});

describe("a request on its way to a Claude target", () => {
  const MARK_A = `${ROUTER_THINKING_MARK}11111111-1111-4111-8111-111111111111`;
  const MARK_B = `${ROUTER_THINKING_MARK}22222222-2222-4222-8222-222222222222`;

  it("D6: exactly the marked thinking blocks leave the assistant messages; system, text, tool_use, tool_result and an Anthropic-signed block stay", () => {
    const body = {
      max_tokens: 4096,
      messages: [
        { content: "Fix it.", role: "user" },
        {
          content: [
            { signature: MARK_A, thinking: "The backend thought.", type: "thinking" },
            { text: "Reading.", type: "text" },
            { id: "toolu_1", input: { path: "a.ts" }, name: "Read", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [{ content: "export {}", tool_use_id: "toolu_1", type: "tool_result" }],
          role: "user",
        },
        {
          content: [
            { signature: "EqQBCgIYAhIM", thinking: "Claude thought.", type: "thinking" },
            { text: "Done.", type: "text" },
          ],
          role: "assistant",
        },
        { content: `quoting ${MARK_B} in a user's words`, role: "user" },
      ],
      model: "claude-opus-5-5",
      system: [{ text: "You are Claude Code.", type: "text" }],
      thinking: { type: "adaptive" },
    };
    const result = withoutRouterThinking(body);
    expect(result.removed).toBe(1);
    expect(result.filled).toBe(0);
    expect(result.body).toEqual({
      max_tokens: 4096,
      messages: [
        { content: "Fix it.", role: "user" },
        {
          content: [
            { text: "Reading.", type: "text" },
            { id: "toolu_1", input: { path: "a.ts" }, name: "Read", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [{ content: "export {}", tool_use_id: "toolu_1", type: "tool_result" }],
          role: "user",
        },
        {
          content: [
            { signature: "EqQBCgIYAhIM", thinking: "Claude thought.", type: "thinking" },
            { text: "Done.", type: "text" },
          ],
          role: "assistant",
        },
        { content: `quoting ${MARK_B} in a user's words`, role: "user" },
      ],
      model: "claude-opus-5-5",
      system: [{ text: "You are Claude Code.", type: "text" }],
      thinking: { type: "adaptive" },
    });
    // The body it came from is not changed in place; an untouched message is the same object.
    expect(body.messages[1]?.content).toHaveLength(3);
    expect(result.body.messages).not.toBe(body.messages);
    expect(Array.isArray(result.body.messages) && result.body.messages[3]).toBe(body.messages[3]);
  });

  it("D6: a body with nothing marked is the same object; a block marked in a user message, or a redacted_thinking, is not ours to touch", () => {
    const plain = {
      messages: [
        { content: [{ signature: MARK_A, thinking: "pasted", type: "thinking" }], role: "user" },
        { content: [{ data: MARK_B, type: "redacted_thinking" }], role: "assistant" },
        { content: "go on", role: "user" },
      ],
      model: "claude-opus-5-5",
    };
    const result = withoutRouterThinking(plain);
    expect(result.body).toBe(plain);
    expect(result.removed).toBe(0);
    const noMessages = { model: "claude-opus-5-5" };
    expect(withoutRouterThinking(noMessages).body).toBe(noMessages);
  });

  it("D6: an assistant message left empty gets one text block (Anthropic refuses an empty one); the final assistant message is left as it is", () => {
    const body = {
      messages: [
        { content: "Fix it.", role: "user" },
        {
          content: [
            { signature: MARK_A, thinking: "one", type: "thinking" },
            { signature: MARK_B, thinking: "two", type: "thinking" },
          ],
          role: "assistant",
        },
        { content: "go on", role: "user" },
        {
          content: [{ signature: MARK_B, thinking: "three", type: "thinking" }],
          role: "assistant",
        },
      ],
      model: "claude-haiku-4-5",
    };
    const result = withoutRouterThinking(body);
    expect(result.removed).toBe(3);
    expect(result.filled).toBe(1);
    expect(result.body).toEqual({
      messages: [
        { content: "Fix it.", role: "user" },
        {
          content: [{ text: "(The fallback model answered with thinking only.)", type: "text" }],
          role: "assistant",
        },
        { content: "go on", role: "user" },
        { content: [], role: "assistant" },
      ],
      model: "claude-haiku-4-5",
    });
  });
});

describe("a request on its way to a backend (thinkingForBackend)", () => {
  const UUID_A = "11111111-1111-4111-8111-111111111111";
  const UUID_B = "22222222-2222-4222-8222-222222222222";
  const UUID_C = "33333333-3333-4333-8333-333333333333";

  it("D6: each marked block gets back exactly the signature its backend wrote, a ':' in it or empty; nothing else changes", () => {
    const body = {
      max_tokens: 100,
      messages: [
        { content: "Fix it.", role: "user" },
        {
          content: [
            {
              signature: `${ROUTER_THINKING_MARK}${UUID_A}:Eq:x+/=:`,
              thinking: "one",
              type: "thinking",
            },
            { text: "Reading.", type: "text" },
            { id: "toolu_1", input: { path: "a.ts" }, name: "Read", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [{ content: "ok", tool_use_id: "toolu_1", type: "tool_result" }],
          role: "user",
        },
        {
          content: [
            { signature: `${ROUTER_THINKING_MARK}${UUID_B}:`, thinking: "two", type: "thinking" },
            { signature: "EqAnthropicSigned", thinking: "", type: "thinking" },
            { data: "EmwK", type: "redacted_thinking" },
          ],
          role: "assistant",
        },
        { content: "go on", role: "user" },
      ],
      model: "glm-5.3-flash",
      system: "Be brief.",
    };
    const result = thinkingForBackend(body);
    expect(result.restored).toBe(2);
    expect(result.bare).toBe(0);
    expect(JSON.stringify(result.body)).toBe(
      JSON.stringify({
        max_tokens: 100,
        messages: [
          { content: "Fix it.", role: "user" },
          {
            content: [
              { signature: "Eq:x+/=:", thinking: "one", type: "thinking" },
              { text: "Reading.", type: "text" },
              { id: "toolu_1", input: { path: "a.ts" }, name: "Read", type: "tool_use" },
            ],
            role: "assistant",
          },
          {
            content: [{ content: "ok", tool_use_id: "toolu_1", type: "tool_result" }],
            role: "user",
          },
          {
            content: [
              { signature: "", thinking: "two", type: "thinking" },
              { signature: "EqAnthropicSigned", thinking: "", type: "thinking" },
              { data: "EmwK", type: "redacted_thinking" },
            ],
            role: "assistant",
          },
          { content: "go on", role: "user" },
        ],
        model: "glm-5.3-flash",
        system: "Be brief.",
      }),
    );
    // Not changed in place; untouched messages are the same objects.
    expect(body.messages[1]?.content).toHaveLength(3);
    expect(result.body.messages).not.toBe(body.messages);
    expect(Array.isArray(result.body.messages) && result.body.messages[2]).toBe(body.messages[2]);
  });

  it("D6: a bare mark (an older router's, or a block its backend sent unsigned) goes without a signature, as the backend sent it", () => {
    const result = thinkingForBackend({
      messages: [
        {
          content: [
            { signature: `${ROUTER_THINKING_MARK}${UUID_C}`, thinking: "old", type: "thinking" },
            { text: "Done.", type: "text" },
          ],
          role: "assistant",
        },
        { content: "next", role: "user" },
      ],
    });
    expect(result.bare).toBe(1);
    expect(result.restored).toBe(0);
    expect(result.body).toEqual({
      messages: [
        {
          content: [
            { thinking: "old", type: "thinking" },
            { text: "Done.", type: "text" },
          ],
          role: "assistant",
        },
        { content: "next", role: "user" },
      ],
    });
  });

  it("D6: with nothing marked, the same object; a mark in a user message is not ours to touch", () => {
    const plain = {
      messages: [
        {
          content: [
            {
              signature: `${ROUTER_THINKING_MARK}${UUID_A}:pasted`,
              thinking: "p",
              type: "thinking",
            },
          ],
          role: "user",
        },
        { content: [{ signature: "EqSigned", thinking: "", type: "thinking" }], role: "assistant" },
      ],
    };
    expect(thinkingForBackend(plain)).toEqual({ bare: 0, body: plain, restored: 0 });
    expect(thinkingForBackend(plain).body).toBe(plain);
    const noMessages = { model: "glm-5.3-flash" };
    expect(thinkingForBackend(noMessages).body).toBe(noMessages);
  });

  it("D6: an answer and its way back: the backend's own signature, through the mark, comes back as it was", () => {
    for (const own of ["made-up", "", "Eq:with:colons+/=="]) {
      const { message } = cleanFallbackMessage({
        content: [{ signature: own, thinking: "t", type: "thinking" }],
        role: "assistant",
        type: "message",
      });
      const content =
        typeof message === "object" && message !== null && "content" in message
          ? message.content
          : null;
      expect(marksIn(JSON.stringify(content))[0]).not.toBe(own);
      const back = thinkingForBackend({ messages: [{ content, role: "assistant" }] });
      expect(back.body).toEqual({
        messages: [
          { content: [{ signature: own, thinking: "t", type: "thinking" }], role: "assistant" },
        ],
      });
    }
  });
});
