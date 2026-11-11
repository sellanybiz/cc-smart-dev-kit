/**
 * The request history (D51): one row per routed `/v1/messages` request, in `bun:sqlite`,
 * written in the background and batched, never a word of the conversation.
 *
 * The writer's tests use a temp database; the router's use a collector or a real writer on a
 * temp file. Every expected value is written by hand.
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { type GatewayConfig, historyRetentionDays, parseConfig } from "./config";
import {
  createHistoryWriter,
  type HistoryRecorder,
  type HistoryRow,
  historyDbExists,
} from "./history";
import { historyKeys, historySeries, recentRequests, requestsSince } from "./history-read";
import { createRouter, type FetchLike, type RouterDeps, type UpstreamInit } from "./router";
import { GUARD_PROMPT } from "./targets";

const PORT = 47_812;
const START = Date.UTC(2026, 9, 22, 10, 0, 0);

/** A temp database path; nothing in the real state folder is touched. */
function historyFile(): string {
  return join(tempDir("history"), "history.db");
}

/** One finished request, as the router should hand it to the history. */
function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    at: START,
    breaker: null,
    cost: null,
    model: "claude-sonnet-5-5",
    ms: 12,
    nextTarget: null,
    profile: null,
    session: "sess-1",
    slot: "cc-smart-dev-kit-worker",
    status: 200,
    target: "claude-sonnet-5-5",
    tokens: null,
    ...overrides,
  };
}

/**
 * The version-1 table, exactly as 1.1.0 made it, with two rows already in it: what a 1.1.x
 * router keeps writing until `gateway setup` restarts it on the 1.2.0 copy.
 */
function schemaOneDatabase(file: string): void {
  const old = new Database(file, { create: true });
  old.run(`CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    session TEXT,
    model TEXT NOT NULL,
    slot TEXT,
    target TEXT NOT NULL,
    status INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    next_target TEXT,
    breaker TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    cost_usd REAL,
    cost_estimated INTEGER NOT NULL DEFAULT 0
  )`);
  old.run("CREATE INDEX requests_at ON requests(at)");
  old.run("CREATE INDEX requests_session_at ON requests(session, at)");
  old.run(
    `INSERT INTO requests (at, session, model, slot, target, status, ms, next_target, breaker,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_estimated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      START - 2000,
      "s-1",
      "old-one",
      "cc-smart-dev-kit-worker",
      "claude-sonnet-5-5",
      200,
      12,
      null,
      null,
      10,
      20,
      0,
      0,
      0.1,
      1,
    ],
  );
  old.run(
    `INSERT INTO requests (at, session, model, slot, target, status, ms, next_target, breaker,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_estimated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      START - 1000,
      null,
      "old-two",
      null,
      "anthropic",
      500,
      30,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0,
    ],
  );
  old.run("PRAGMA user_version = 1");
  old.close();
}

describe("the history writer", () => {
  it("batches: a row is not in the file until the flush, and then all of them are", () => {
    const file = historyFile();
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => START,
      retentionDays: () => 90,
    });
    writer.record(row({ at: START - 3000, model: "m1" }));
    writer.record(row({ at: START - 2000, model: "m2" }));
    expect(writer.pending()).toBe(2);
    expect(historyDbExists(file)).toBe(false);

    writer.flush();
    expect(writer.pending()).toBe(0);
    const page = recentRequests(file, { limit: 10 });
    expect(page.rows.map((entry) => entry.model)).toEqual(["m2", "m1"]);
    writer.close();
  });

  it("writes the row's fields as they are: no prompt, no answer, no key", () => {
    const file = historyFile();
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => START,
      retentionDays: () => 90,
    });
    writer.record(
      row({
        breaker: "held",
        cost: { estimated: true, usd: 0.00745 },
        model: "claude-sonnet-5-5",
        ms: 42,
        nextTarget: "claude-sonnet-5-5",
        status: 500,
        target: "claude-sonnet-5-5",
        tokens: { cacheRead: 2000, cacheWrite: 100, input: 1000, output: 500 },
      }),
    );
    writer.flush();
    expect(recentRequests(file, { limit: 1 }).rows).toEqual([
      {
        at: START,
        breaker: "held",
        cacheReadTokens: 2000,
        cacheWriteTokens: 100,
        costEstimated: true,
        costUsd: 0.00745,
        id: 1,
        inputTokens: 1000,
        model: "claude-sonnet-5-5",
        ms: 42,
        profile: null,
        nextTarget: "claude-sonnet-5-5",
        outputTokens: 500,
        session: "sess-1",
        slot: "cc-smart-dev-kit-worker",
        status: 500,
        target: "claude-sonnet-5-5",
      },
    ]);
    writer.close();
  });

  it("flushes on its own timer, in the background", async () => {
    const file = historyFile();
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 5,
      log: () => {},
      now: () => START,
      retentionDays: () => 90,
    });
    writer.record(row());
    expect(historyDbExists(file)).toBe(false);
    await Bun.sleep(40);
    expect(recentRequests(file, { limit: 1 }).rows).toHaveLength(1);
    writer.close();
  });

  it("retentionDays 0 writes nothing at all: no file, no row", () => {
    const file = historyFile();
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => START,
      retentionDays: () => 0,
    });
    writer.record(row());
    writer.flush();
    expect(writer.pending()).toBe(0);
    expect(historyDbExists(file)).toBe(false);
    expect(writer.enabled()).toBe(false);
  });

  it("purges the rows past the retention, and keeps the rest", () => {
    const file = historyFile();
    const day = 24 * 60 * 60 * 1000;
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => START,
      retentionDays: () => 2,
    });
    writer.record(row({ at: START - 3 * day, model: "old" }));
    writer.record(row({ at: START - 1 * day, model: "kept" }));
    writer.flush();
    const page = recentRequests(file, { limit: 10 });
    expect(page.rows.map((entry) => entry.model)).toEqual(["kept"]);
    writer.close();
  });

  it("WAL, incremental auto-vacuum, and a schema version: the file's own settings", () => {
    const file = historyFile();
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => START,
      retentionDays: () => 90,
    });
    writer.record(row());
    writer.flush();
    writer.close();
    const db = new Database(file, { readonly: true });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA auto_vacuum").get()).toEqual({ auto_vacuum: 2 });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    db.close();
  });

  it("a database from schema 1 keeps every row: the profile column is added beside them", () => {
    const file = historyFile();
    schemaOneDatabase(file);

    // The writer opens it: the column is added, the two rows stay, and they read as the
    // machine's default (no profile).
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => START,
      retentionDays: () => 90,
    });
    writer.record(row({ at: START, model: "new-one", profile: "proj" }));
    writer.flush();
    writer.close();

    const page = recentRequests(file, { limit: 10 });
    expect(page.rows.map((entry) => [entry.model, entry.profile])).toEqual([
      ["new-one", "proj"],
      ["old-two", null],
      ["old-one", null],
    ]);
    const db = new Database(file, { readonly: true });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    db.close();
  });

  it("a write that fails is one log line, never a thrown error, and the rows stay bounded", () => {
    // The "file" is a folder: opening it as a database fails.
    const folder = tempDir("history-folder");
    const logs: string[] = [];
    const writer = createHistoryWriter({
      file: folder,
      flushAfterMs: 60_000,
      log: (line) => logs.push(line),
      now: () => START,
      retentionDays: () => 90,
    });
    expect(() => writer.record(row())).not.toThrow();
    expect(() => writer.flush()).not.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toStartWith("ERROR cannot write the request history:");
    // The same failure again is not said twice.
    writer.record(row());
    writer.flush();
    expect(logs).toHaveLength(1);
    writer.close();
  });
});

describe("the history's retention in the config", () => {
  function config(history: unknown): { config: GatewayConfig } | { error: string } {
    return parseConfig({
      backends: {},
      history,
      slots: {},
      version: 1,
    });
  }

  it("absent is 90 days; a set value is the person's; 0 turns it off", () => {
    const absent = config(undefined);
    if ("error" in absent) throw new Error(absent.error);
    expect(historyRetentionDays(absent.config)).toBe(90);
    const off = config({ retentionDays: 0 });
    if ("error" in off) throw new Error(off.error);
    expect(historyRetentionDays(off.config)).toBe(0);
    const week = config({ retentionDays: 7 });
    if ("error" in week) throw new Error(week.error);
    expect(historyRetentionDays(week.config)).toBe(7);
  });

  it("refuses a negative day, a fraction, and more than ten years", () => {
    expect(config({ retentionDays: -1 })).toHaveProperty("error");
    expect(config({ retentionDays: 1.5 })).toHaveProperty("error");
    expect(config({ retentionDays: 3651 })).toHaveProperty("error");
  });
});

// ─── The router's rows ────────────────────────────────────────────────────────────────

/** Every history row the router recorded, in order. */
function collector(): { recorder: HistoryRecorder; rows: HistoryRow[] } {
  const rows: HistoryRow[] = [];
  return {
    recorder: {
      enabled: () => true,
      record: (entry) => rows.push(entry),
    },
    rows,
  };
}

interface Call {
  body: null | string;
  headers: [string, string][];
  url: string;
}

/** A reply: a fixed response, or one built from the call. */
type Reply = Response | ((call: Call) => Response | Promise<Response>);

/** A fake upstream that answers from a script, one reply per call. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = (url: string, init: UpstreamInit) => {
    const call: Call = {
      body: init.body === null ? null : new TextDecoder().decode(init.body),
      headers: [...init.headers.entries()],
      url,
    };
    calls.push(call);
    const reply = replies[calls.length - 1];
    if (reply === undefined) throw new Error(`unexpected upstream call ${calls.length}`);
    return Promise.resolve(typeof reply === "function" ? reply(call) : reply);
  };
  return { calls, fetch };
}

function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: {},
    port: PORT,
    slots: { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] },
    timeouts: { firstByteMs: 1000 },
    version: 1,
    ...overrides,
  };
}

function request(options: {
  body: Record<string, unknown>;
  path?: string;
  session?: null | string;
  agent?: string;
}): Request {
  const headers = new Headers({
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    host: `127.0.0.1:${PORT}`,
  });
  if (options.session !== null && options.session !== undefined) {
    headers.set("x-claude-code-session-id", options.session);
  }
  if (options.agent !== undefined) headers.set("x-claude-code-agent-id", options.agent);
  return new Request(`http://127.0.0.1:${PORT}${options.path ?? "/v1/messages"}`, {
    body: JSON.stringify(options.body),
    headers,
    method: "POST",
  });
}

function message(model: string): Record<string, unknown> {
  return {
    max_tokens: 1024,
    messages: [{ content: "find the settings page", role: "user" }],
    model,
    stream: false,
  };
}

/** The router with fake upstreams and a history collector; `settled` waits for its background work. */
function routerWithHistory(
  replies: Reply[],
  options: {
    config?: GatewayConfig;
    history?: HistoryRecorder;
    now?: () => number;
  } = {},
) {
  const upstream = fakeFetch(replies);
  const background: Promise<void>[] = [];
  const logs: string[] = [];
  const config = options.config ?? testConfig();
  const deps: RouterDeps = {
    anthropicBaseUrl: "https://anthropic.test",
    background: (task) => {
      background.push(task);
    },
    configPath: "/tmp/gateway.json",
    fetch: upstream.fetch,
    getConfig: () => config,
    ...(options.history === undefined ? {} : { history: options.history }),
    log: (line) => logs.push(line),
    now: options.now ?? (() => START),
    port: PORT,
  };
  const raw = createRouter(deps);
  const settled = () => Promise.all(background.splice(0)).then(() => undefined);
  return { calls: upstream.calls, handle: raw, logs, settled };
}

/** Anthropic's non-streaming answer, with the usage the history reads. */
function answerWithUsage(): Response {
  return Response.json({
    content: [{ text: "done", type: "text" }],
    id: "msg_1",
    type: "message",
    usage: {
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 2000,
      input_tokens: 1000,
      output_tokens: 500,
    },
  });
}

describe("the router's request history", () => {
  it("records validated agent ids and in-band failures without changing the HTTP status", async () => {
    const history = collector();
    const replies = [
      () => Response.json({ type: "message", stop_reason: "refusal" }),
      () =>
        new Response('data: {"type":"error"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      answerWithUsage,
    ];
    const { handle, settled } = routerWithHistory(replies, { history: history.recorder });
    for (const agent of ["agent-1", "bad id", "a".repeat(129)]) {
      const response = await handle(
        request({ body: message("claude-sonnet-5-5"), session: "sess-1", agent }),
      );
      expect(response.status).toBe(200);
      await response.text();
      await settled();
    }
    expect(history.rows.map(({ agent, outcome, status }) => [agent, outcome, status])).toEqual([
      ["agent-1", "refused", 200],
      [null, "stream_error", 200],
      [null, null, 200],
    ]);
  });

  it("a body that fails after its headers records stream_error, not a whole 200 answer", async () => {
    const history = collector();
    const { handle, settled } = routerWithHistory(
      [
        () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new Error("cut connection"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ],
      { history: history.recorder },
    );
    const response = await handle(
      request({ body: message("claude-sonnet-5-5"), session: "sess-1" }),
    );
    await expect(response.text()).rejects.toThrow("cut connection");
    await settled();
    expect(history.rows.map(({ status, outcome }) => [status, outcome])).toEqual([
      [200, "stream_error"],
    ]);
  });

  it("an HTTP 529 error keeps outcome null", async () => {
    const history = collector();
    const { handle, settled } = routerWithHistory(
      [() => Response.json({ type: "error" }, { status: 529 })],
      { history: history.recorder },
    );
    await (await handle(request({ body: message("claude-sonnet-5-5") }))).text();
    await settled();
    expect(history.rows.map(({ status, outcome }) => [status, outcome])).toEqual([[529, null]]);
  });

  it("a client cancel mid-stream records a failed 200 answer", async () => {
    const history = collector();
    const { handle, settled } = routerWithHistory(
      [
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"type":"message_start"}\n\n'));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ],
      { history: history.recorder },
    );
    const response = await handle(request({ body: message("claude-sonnet-5-5") }));
    if (response.body === null) throw new Error("expected a streaming response");
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await settled();
    expect(history.rows.map(({ status, outcome }) => [status, outcome])).toEqual([
      [200, "stream_error"],
    ]);
  });

  it("a broken gzip body records a failed 200 answer", async () => {
    const history = collector();
    const { handle, settled } = routerWithHistory(
      [
        () =>
          new Response(new Uint8Array([31, 139, 8, 0, 1]), {
            headers: { "content-type": "text/event-stream", "content-encoding": "gzip" },
          }),
      ],
      { history: history.recorder },
    );
    await (await handle(request({ body: message("claude-sonnet-5-5") }))).arrayBuffer();
    await settled();
    expect(history.rows.map(({ status, outcome }) => [status, outcome])).toEqual([
      [200, "stream_error"],
    ]);
  });

  it.each([false, true])("a stream needs message_stop to count as whole (%s)", async (stopped) => {
    const history = collector();
    const body =
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n' +
      (stopped ? 'data: {"type":"message_stop"}\n\n' : "");
    const { handle, settled } = routerWithHistory(
      [() => new Response(body, { headers: { "content-type": "text/event-stream" } })],
      { history: history.recorder },
    );
    await (await handle(request({ body: message("claude-sonnet-5-5") }))).text();
    await settled();
    expect(history.rows.map(({ status, outcome }) => [status, outcome])).toEqual([
      [200, stopped ? null : "stream_error"],
    ]);
  });

  it("one row per routed request: its exact fields, its tokens and its cost", async () => {
    const history = collector();
    let clock = START;
    const { handle, settled } = routerWithHistory(
      [
        () => {
          // The answer takes 42 ms of the fake clock.
          clock = START + 42;
          return answerWithUsage();
        },
      ],
      { history: history.recorder, now: () => clock },
    );
    const response = await handle(
      request({ body: message("claude-sonnet-5-5"), session: "sess-1" }),
    );
    // The answer's bytes are not read yet: nothing is written, so the request never waited.
    expect(history.rows).toEqual([]);
    await response.text();
    await settled();
    expect(history.rows).toEqual([
      {
        agent: null,
        outcome: null,
        at: START,
        breaker: null,
        // Sonnet 5.5 list price: (1000×2 + 500×10 + 2000×0.2 + 100×2.5) / 1,000,000.
        cost: { estimated: true, usd: 0.00765 },
        model: "claude-sonnet-5-5",
        ms: 42,
        nextTarget: null,
        profile: null,
        session: "sess-1",
        slot: "cc-smart-dev-kit-worker",
        status: 200,
        target: "claude-sonnet-5-5",
        tokens: { cacheRead: 2000, cacheWrite: 100, input: 1000, output: 500 },
      },
    ]);
  });

  it("a request under a profile's path writes the profile in its row; a plain one writes none", async () => {
    const history = collector();
    const config = testConfig({
      profiles: { proj: { slots: { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] } } },
    });
    const { handle, settled } = routerWithHistory([answerWithUsage, answerWithUsage], {
      config,
      history: history.recorder,
    });
    const profiled = await handle(
      request({ body: message("claude-sonnet-5-5"), path: "/p/proj/v1/messages", session: "s" }),
    );
    await profiled.text();
    const plain = await handle(request({ body: message("claude-sonnet-5-5"), session: "s" }));
    await plain.text();
    await settled();
    expect(history.rows.map((entry) => [entry.profile, entry.target])).toEqual([
      ["proj", "claude-sonnet-5-5"],
      [null, "claude-sonnet-5-5"],
    ]);
  });

  it("a streamed answer: the start's counts stand, and the last message_delta's output wins", async () => {
    const history = collector();
    const sse = [
      "event: message_start",
      'data: {"message":{"id":"msg_1","type":"message","usage":{"cache_creation_input_tokens":0,"cache_read_input_tokens":500,"input_tokens":1234,"output_tokens":1}},"type":"message_start"}',
      "",
      "event: message_delta",
      'data: {"delta":{"stop_reason":"end_turn"},"type":"message_delta","usage":{"output_tokens":7}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
      "",
    ].join("\n");
    const chunks = [sse.slice(0, 60), sse.slice(60)];
    const { handle, settled } = routerWithHistory(
      [
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
      ],
      { history: history.recorder },
    );
    const response = await handle(
      request({ body: message("claude-sonnet-5-5"), session: "sess-1" }),
    );
    expect(await response.text()).toBe(sse);
    await settled();
    expect(history.rows[0]?.tokens).toEqual({
      cacheRead: 500,
      cacheWrite: 0,
      input: 1234,
      output: 7,
    });
    expect(history.rows[0]?.cost).toEqual({
      estimated: true,
      // (1234×2 + 7×10 + 500×0.2) / 1,000,000 = 0.002638: Sonnet 5.5's cache read is $0.20.
      usd: 0.002638,
    });
  });

  it("a compressed answer: the client gets its bytes as they came, the row its tokens", async () => {
    const history = collector();
    const sse = [
      "event: message_start",
      'data: {"message":{"usage":{"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"input_tokens":10,"output_tokens":1}},"type":"message_start"}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","usage":{"output_tokens":20}}',
      "",
      "",
    ].join("\n");
    const gzipped = new Uint8Array(
      await new Response(
        new Blob([sse]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    const { handle, settled } = routerWithHistory(
      [
        () =>
          new Response(gzipped, {
            headers: { "content-encoding": "gzip", "content-type": "text/event-stream" },
            status: 200,
          }),
      ],
      { history: history.recorder },
    );
    const response = await handle(
      request({ body: message("claude-sonnet-5-5"), session: "sess-1" }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(gzipped);
    await settled();
    expect(history.rows[0]?.tokens).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      input: 10,
      output: 20,
    });
  });

  it("a fallback: the row names the target that answered next", async () => {
    const history = collector();
    const config = testConfig({
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:1" } },
      // The next target answers only with the slot's fallback switch on (off by default, D66).
      fallback: { "cc-smart-dev-kit-worker": true },
      slots: { "cc-smart-dev-kit-worker": ["omniroute:m1", "claude-sonnet-5-5"] },
    });
    const { handle, settled } = routerWithHistory(
      [() => new Response("nope", { status: 500 }), answerWithUsage()],
      { config, history: history.recorder },
    );
    const response = await handle(
      request({ body: message("claude-sonnet-5-5"), session: "sess-1" }),
    );
    await response.text();
    await settled();
    expect(history.rows[0]).toMatchObject({
      nextTarget: "claude-sonnet-5-5",
      status: 200,
      target: "claude-sonnet-5-5",
    });
  });

  it("no row for count_tokens, none for a safety check, none for another path", async () => {
    const history = collector();
    const config = testConfig({ slots: {} });
    const { handle, settled } = routerWithHistory(
      [answerWithUsage, answerWithUsage, answerWithUsage, answerWithUsage],
      { config, history: history.recorder },
    );
    await (
      await handle(
        request({ body: message("claude-sonnet-5-5"), path: "/v1/messages/count_tokens" }),
      )
    ).text();
    await (
      await handle(
        request({
          body: {
            max_tokens: 64,
            messages: [{ content: "git push --force", role: "user" }],
            model: "claude-sonnet-5-5",
            stream: false,
            system: GUARD_PROMPT,
          },
          session: "sess-1",
        }),
      )
    ).text();
    await (
      await handle(request({ body: message("claude-sonnet-5-5"), path: "/v1/models" }))
    ).text();
    expect(history.rows).toEqual([]);
    // The one ordinary request is a row.
    await (await handle(request({ body: message("claude-sonnet-5-5"), session: "sess-1" }))).text();
    await settled();
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]?.model).toBe("claude-sonnet-5-5");
  });

  it("the log that is off records nothing, and reads no answer", async () => {
    const rows: HistoryRow[] = [];
    const off: HistoryRecorder = { enabled: () => false, record: (entry) => rows.push(entry) };
    const { handle, settled } = routerWithHistory([answerWithUsage()], { history: off });
    await (await handle(request({ body: message("claude-sonnet-5-5"), session: "sess-1" }))).text();
    await settled();
    expect(rows).toEqual([]);
  });

  it("a session id that is not one is not stored", async () => {
    const history = collector();
    const { handle, settled } = routerWithHistory([answerWithUsage()], {
      history: history.recorder,
    });
    await (
      await handle(request({ body: message("claude-sonnet-5-5"), session: "bad id with spaces" }))
    ).text();
    await settled();
    expect(history.rows[0]?.session).toBeNull();
  });
});

describe("the request history never holds the conversation", () => {
  it("the database file has no prompt, no answer, no key", async () => {
    const file = historyFile();
    const writer = createHistoryWriter({
      file,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => START,
      retentionDays: () => 90,
    });
    const history: HistoryRecorder = {
      enabled: () => true,
      record: (entry) => writer.record(entry),
    };
    const secret = "sk-ant-oat-SECRET-TOKEN";
    const prompt = "find the settings page and delete every file";
    const { handle, settled } = routerWithHistory(
      [
        () =>
          Response.json({
            content: [{ text: "the answer's own words, never logged", type: "text" }],
            usage: { input_tokens: 1, output_tokens: 2 },
          }),
      ],
      { history },
    );
    const response = await handle(
      request({
        body: {
          max_tokens: 1024,
          messages: [{ content: prompt, role: "user" }],
          model: "claude-sonnet-5-5",
          stream: false,
          system: `a system text with ${secret}`,
        },
        session: "sess-1",
      }),
    );
    await response.text();
    await settled();
    writer.flush();
    writer.close();
    // A closed WAL database checkpoints into the main file; read both, just in case.
    const bytes = [file, `${file}-wal`]
      .flatMap((path) => {
        try {
          return [readFileSync(path).toString("latin1")];
        } catch {
          return [];
        }
      })
      .join("\n");
    expect(bytes).not.toContain(prompt);
    expect(bytes).not.toContain("the answer's own words");
    expect(bytes).not.toContain(secret);
    expect(bytes).toContain("claude-sonnet-5-5");
    expect(bytes).toContain("sess-1");
  });

  it("a write error is one log line and the request still succeeds", async () => {
    const logs: string[] = [];
    const writer = createHistoryWriter({
      // A folder: no database can open there.
      file: tempDir("history-folder-router"),
      flushAfterMs: 1,
      log: (line) => logs.push(line),
      now: () => START,
      retentionDays: () => 90,
    });
    const { handle } = routerWithHistory([answerWithUsage()], { history: writer });
    const response = await handle(
      request({ body: message("claude-sonnet-5-5"), session: "sess-1" }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("done");
    await Bun.sleep(30);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toStartWith("ERROR cannot write the request history:");
    writer.close();
  });
});

describe("the readers on a schema-1 database (a 1.1.x router still writes it)", () => {
  // After the background self-update the portal and the CLI are 1.2.0, while the running router
  // stays 1.1.x until `gateway setup`: it keeps the file at schema 1, and the readers open it
  // read-only, so they cannot add the column. They read its rows as the machine's default.

  it("recentRequests reads every row with no profile, and a profile filter matches none", () => {
    const file = historyFile();
    schemaOneDatabase(file);
    const page = recentRequests(file, { limit: 10 });
    expect(page.rows.map((entry) => [entry.model, entry.profile])).toEqual([
      ["old-two", null],
      ["old-one", null],
    ]);
    expect(recentRequests(file, { filters: { profile: "proj" }, limit: 10 })).toEqual({
      nextCursor: null,
      rows: [],
    });
    const worker = recentRequests(file, {
      filters: { slot: "cc-smart-dev-kit-worker" },
      limit: 10,
    });
    expect(worker.rows.map((entry) => entry.model)).toEqual(["old-one"]);
  });

  it("historySeries groups the rows, and a profile filter matches none", () => {
    const file = historyFile();
    schemaOneDatabase(file);
    const answer = historySeries(file, { by: "target", now: START, range: "1h" });
    expect(
      answer.series.map((series) => [
        series.key,
        series.points.reduce((sum, point) => sum + point.requests, 0),
        series.points.reduce((sum, point) => sum + point.errors, 0),
      ]),
    ).toEqual([
      ["anthropic", 1, 1],
      ["claude-sonnet-5-5", 1, 0],
    ]);
    const filtered = historySeries(file, {
      by: "target",
      filters: { profile: "proj" },
      now: START,
      range: "1h",
    });
    expect(filtered.series).toEqual([]);
  });

  it("historyKeys and requestsSince read it as they read schema 2", () => {
    const file = historyFile();
    schemaOneDatabase(file);
    expect(historyKeys(file, { now: START, range: "1h" })).toEqual({
      models: ["old-one", "old-two"],
      sessions: ["s-1"],
      slots: ["cc-smart-dev-kit-worker"],
      targets: ["anthropic", "claude-sonnet-5-5"],
    });
    expect(requestsSince(file, { from: START - 1500 })).toBe(1);
  });

  it("a read never migrates the file: it stays at schema 1, with no profile column", () => {
    const file = historyFile();
    schemaOneDatabase(file);
    recentRequests(file, { filters: { profile: "proj" }, limit: 10 });
    historySeries(file, { by: "slot", filters: { profile: "proj" }, now: START, range: "1h" });
    const db = new Database(file, { readonly: true });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    const columns = db.query("PRAGMA table_info(requests)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain("profile");
    db.close();
  });
});
