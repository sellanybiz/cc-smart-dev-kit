/**
 * A model slot's fallback answer, made safe to keep in a Claude conversation: thinking
 * blocks out, block indexes renumbered, never an empty message, tool_use ids Claude takes.
 * Every expected value is written by hand (the safe id: `printf 'functions.Read:0' |
 * sha256sum`, its first 24 characters).
 */
import { describe, expect, it } from "bun:test";
import {
  cleanFallbackMessage,
  cleanFallbackResponse,
  cleanFallbackStream,
  EMPTY_ANSWER_TEXT,
  type FallbackChanges,
  safeToolUseId,
} from "./fallback-answer";

const SAFE_ID = "toolu_anymodel_9d4d98f9adde8d726e98af64";

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

describe("a whole answer", () => {
  it("thinking and redacted_thinking blocks go; text and tools stay; a bad tool_use id is made safe", () => {
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
    expect(cleanFallbackMessage(answer)).toEqual({
      changes: { ids: 1, thinking: 2 },
      message: {
        content: [
          { text: "Reading it.", type: "text" },
          { id: SAFE_ID, input: { path: "a.ts" }, name: "Read", type: "tool_use" },
          { id: "toolu_ok-1", input: {}, name: "Bash", type: "tool_use" },
        ],
        id: "msg_1",
        model: "glm-5.3-flash",
        role: "assistant",
        stop_reason: "tool_use",
        type: "message",
      },
    });
  });

  it("an answer of thinking only gets one text block: Anthropic refuses an empty message", () => {
    const answer = {
      content: [{ signature: "x", thinking: "hmm", type: "thinking" }],
      role: "assistant",
      type: "message",
    };
    expect(cleanFallbackMessage(answer).message).toEqual({
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
    expect(safeToolUseId("")).toMatch(/^toolu_anymodel_[0-9a-f]{24}$/);
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
      content_block: { data: "abc", type: "redacted_thinking" },
      index: 2,
      type: "content_block_start",
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

  /** What Claude Code must get: no thinking, the text at 0, the tool at 1 with a safe id. */
  const EXPECTED = [
    START,
    ": a heartbeat comment\n\n",
    sse("ping", { type: "ping" }),
    sse("content_block_start", {
      content_block: { text: "", type: "text" },
      index: 0,
      type: "content_block_start",
    }),
    sse("content_block_delta", {
      delta: { text: "Reading it.", type: "text_delta" },
      index: 0,
      type: "content_block_delta",
    }),
    sse("content_block_stop", { index: 0, type: "content_block_stop" }),
    sse("content_block_start", {
      content_block: { id: SAFE_ID, input: {}, name: "Read", type: "tool_use" },
      index: 1,
      type: "content_block_start",
    }),
    sse("content_block_delta", {
      delta: { partial_json: '{"path":"a.ts"}', type: "input_json_delta" },
      index: 1,
      type: "content_block_delta",
    }),
    sse("content_block_stop", { index: 1, type: "content_block_stop" }),
    DELTA,
    STOP,
  ].join("");

  it("thinking blocks' events go, later indexes stay 0, 1, …, whatever the chunk sizes", async () => {
    for (const size of [1, 7, 64, 100_000]) {
      const { changes, out } = await throughStream(THINKING_AND_TEXT, size);
      expect(out).toBe(EXPECTED);
      expect(changes).toEqual({ ids: 1, thinking: 2 });
    }
  });

  it("CRLF line ends are read as well", async () => {
    const crlf = THINKING_AND_TEXT.replaceAll("\n", "\r\n");
    const { out } = await throughStream(crlf, 5);
    expect(out).not.toContain("thinking");
    expect(out).toContain('"index":1,"type":"content_block_start"');
  });

  it("an answer of thinking only gets one text block before message_delta", async () => {
    const onlyThinking = [
      START,
      sse("content_block_start", {
        content_block: { thinking: "", type: "thinking" },
        index: 0,
        type: "content_block_start",
      }),
      sse("content_block_stop", { index: 0, type: "content_block_stop" }),
      DELTA,
      STOP,
    ].join("");
    const { out } = await throughStream(onlyThinking, 9);
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
    expect(changes).toEqual({ ids: 0, thinking: 0 });
  });
});

describe("the answer as Claude Code gets it", () => {
  const ANSWER = JSON.stringify({
    content: [
      { signature: "s", thinking: "t", type: "thinking" },
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
    expect(seen).toEqual([{ ids: 0, thinking: 1 }]);
  });

  it("an encoding it cannot read, an error answer, or another type: as it came", async () => {
    const odd = new Response(ANSWER, {
      headers: { "content-encoding": "compress", "content-type": "application/json" },
    });
    const kept = cleanFallbackResponse(odd, () => undefined);
    expect(kept.response).toBe(odd);
    expect(kept.note).toBe(
      'its answer is "compress" encoded, which the router cannot read: thinking blocks were not removed',
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
