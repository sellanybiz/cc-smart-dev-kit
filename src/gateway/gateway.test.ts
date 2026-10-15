/**
 * The AI gateway: router, targets and config.
 *
 * Ported from the project that wrote it, from its version in which the judge slot was on
 * by default. Names, paths and example text are renamed; every router assertion is kept.
 * The judge default is the one behaviour that changed (off now), and no assertion in this
 * file changed with it: the safety-check tests already ran on `config()`, which has no
 * judge slot, like a new config, and turn the judge on with `withJudge()`. What changed
 * with it: "with the judge off (the default), a safety check reaches Anthropic unchanged"
 * is new here, and in `commands.test.ts` the default slot table lost its `anymodel-judge`
 * row ("creates the config only with the OmniRoute key…"); the old project's assertion
 * about its own `guard` slot name, whose text said the judge was on, was not ported. New
 * since the port: the aliases tests, and "prompts stay as Claude Code wrote them".
 *
 * What it guards:
 *   - The person's own Claude login (`authorization: Bearer sk-ant-oat…`, and the account
 *     id in the body's `metadata`) reaches Anthropic only: never a cheap backend, on the
 *     first target, a fallback, or an explicit `<backend>:<model>`.
 *   - Claude traffic passes byte-for-byte: same URL, method, query, body bytes and
 *     headers, only hop-by-hop ones and `host` / `content-length` dropped.
 *   - Fallback moves on only before an answer reaches Claude Code, on the statuses the
 *     design names; an OmniRoute stream that opens with 200 and then reports an error
 *     in-band also moves on; the last target's answer is returned as it is.
 *   - Auto mode's safety check stays on Claude by default (a new config has no
 *     `anymodel-judge` slot): a `claude-…` one byte for byte, a slot-named one to the slot's
 *     Claude targets, and one whose name (an alias included) leads to no Claude target to
 *     Anthropic as it was sent. With a judge slot, which only the person turns on, every
 *     check in every session goes there.
 *   - Reasoning switched off reaches a cheap backend in a form OmniRoute reads.
 *   - Streams pass chunk by chunk, nothing held back once the first event is out.
 *   - Only this machine can use it (Host, Origin, JSON + anthropic-version).
 *   - A bad config never replaces a good one; a readable-by-others file is refused.
 *
 * Upstreams are fakes passed in as `fetch`; every call is recorded. No network.
 * Every expected value is written by hand.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  emptyConfig,
  type GatewayConfig,
  loadConfigFile,
  parseConfig,
  saveConfig,
  watchConfig,
} from "./config";
import {
  createRouter,
  maskSecrets,
  reasoningOffForBackend,
  requestForClaudeFallback,
  sseScanner,
  toolSearchForBackend,
  type UpstreamInit,
} from "./router";
import { cooldownSeconds, isAutoModeGuard, resolveRoute } from "./targets";

const PORT = 20100;
/** File modes are POSIX: this tooling runs on Linux and macOS only. */
const NO_POSIX_MODES = process.platform === "win32";
const TOKEN = "sk-ant-oat01-TESTTOKEN";
const CONFIG_PATH = "/home/someone/.config/anymodel/gateway.json";

function config(firstByteMs = 1000): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: {
      ollama: { apiKey: "ollama-key-abcdef", baseUrl: "https://ollama.test" },
      omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" },
    },
    port: PORT,
    slots: {
      "anymodel-cheap": ["omniroute:glm-5.3-flash", "ollama:deepseek-v4.1-flash"],
      "anymodel-mixed": ["claude-sonnet-5-5", "omniroute:glm-5.3-flash"],
      "anymodel-scout": [
        "omniroute:glm-5.3-flash",
        "ollama:deepseek-v4.1-flash",
        "claude-sonnet-5-5",
      ],
      "anymodel-worker": ["claude-sonnet-5-5"],
    },
    timeouts: { firstByteMs },
    version: 1,
  };
}

/** The headers Claude Code sends on the own login, plus every kind a proxy must drop. */
function clientHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "accept-encoding": "gzip, br",
    "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
    "anthropic-version": "2023-06-01",
    authorization: `Bearer ${TOKEN}`,
    connection: "keep-alive, x-drop-me",
    "content-length": "999",
    "content-type": "application/json",
    cookie: `sessionKey=${TOKEN}`,
    host: `127.0.0.1:${PORT}`,
    "keep-alive": "timeout=5",
    "proxy-authorization": "Basic cHJveHk=",
    te: "trailers",
    "user-agent": "claude-cli/2.1.299 (external, cli)",
    "x-api-key": TOKEN,
    "x-claude-code-session-id": "sess-1",
    "x-drop-me": "1",
    "x-stainless-retry-count": "0",
  };
}

function message(model: string): Record<string, unknown> {
  return {
    max_tokens: 1024,
    messages: [{ content: "find the settings page", role: "user" }],
    metadata: { user_id: `user_acct-42_${TOKEN}` },
    model,
    stream: true,
  };
}

function clientRequest(options: {
  body?: string;
  headers?: Record<string, null | string>;
  method?: string;
  path?: string;
  signal?: AbortSignal;
}): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries({ ...clientHeaders(), ...options.headers })) {
    if (value !== null) headers.set(name, value);
  }
  const method = options.method ?? "POST";
  return new Request(`http://127.0.0.1:${PORT}${options.path ?? "/v1/messages?beta=true"}`, {
    body: method === "GET" || method === "HEAD" ? null : (options.body ?? null),
    headers,
    method,
    signal: options.signal ?? null,
  });
}

interface Call {
  body: null | string;
  headers: [string, string][];
  method: string;
  signal: AbortSignal;
  url: string;
}

type Reply = (call: Call) => Promise<Response> | Response;

/** A fake `fetch` that answers from a script, one reply per call, and records each call. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = (url: string, init: UpstreamInit): Promise<Response> => {
    const call: Call = {
      body: init.body === null ? null : new TextDecoder().decode(init.body),
      headers: [...init.headers.entries()],
      method: init.method,
      signal: init.signal,
      url,
    };
    calls.push(call);
    const reply = replies[calls.length - 1];
    if (reply === undefined)
      return Promise.reject(new Error(`unexpected upstream call ${calls.length} to ${url}`));
    try {
      return Promise.resolve(reply(call));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  return { calls, fetch };
}

/**
 * The router with fake upstreams. `handle` also waits for the work the router does after
 * the answer (the error log lines, `RouterDeps.background`), so a test reads every log
 * line; `raw` is the router alone, for a test of what the client gets and when.
 */
function router(replies: Reply[], options: { config?: GatewayConfig; now?: () => number } = {}) {
  const upstream = fakeFetch(replies);
  const logs: string[] = [];
  const cfg = options.config ?? config();
  const background: Promise<void>[] = [];
  const raw = createRouter({
    // The config may only name api.anthropic.com; a fake comes in through the router.
    anthropicBaseUrl: "https://anthropic.test",
    background: (task) => {
      background.push(task);
    },
    configPath: CONFIG_PATH,
    fetch: upstream.fetch,
    getConfig: () => cfg,
    log: (line) => logs.push(line),
    now: options.now ?? (() => Date.UTC(2026, 9, 15, 10, 0, 0)),
    port: PORT,
  });
  const settled = () => Promise.all(background.splice(0)).then(() => undefined);
  const handle = async (req: Request): Promise<Response> => {
    const response = await raw(req);
    await settled();
    return response;
  };
  return { calls: upstream.calls, handle, logs, raw, settled };
}

/** A response whose body records whether it was cancelled. */
function trackedResponse(status: number, text: string, headers: Record<string, string> = {}) {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true;
    },
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
  return { response: new Response(body, { headers, status }), state };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * An upstream stream whose chunk N is sent only once gate N opens (gate 0 is open).
 * `sent()` says how many chunks the upstream has sent so far.
 */
function gatedStream(chunks: string[], headers: Record<string, string> = {}) {
  const gates = chunks.map(() => deferred());
  gates[0]?.resolve();
  let sent = 0;
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true;
    },
    async pull(controller) {
      const gate = gates[sent];
      if (gate === undefined) {
        controller.close();
        return;
      }
      await gate.promise;
      controller.enqueue(new TextEncoder().encode(chunks[sent]));
      sent += 1;
    },
  });
  return {
    open: (index: number) => gates[index]?.resolve(),
    response: new Response(body, {
      headers: { "content-type": "text/event-stream", ...headers },
      status: 200,
    }),
    sent: () => sent,
    state,
  };
}

/** Read one chunk, or fail the test if none comes within a second. */
async function readSoon(reader: {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("no chunk within 1 s"));
    }, 1000);
  });
  const step = await Promise.race([reader.read(), timeout]).finally(() => {
    clearTimeout(timer);
  });
  if (step.done) throw new Error("stream ended");
  return new TextDecoder().decode(step.value);
}

function cheapBodyFor(model: string): Record<string, unknown> {
  return {
    max_tokens: 1024,
    messages: [{ content: "find the settings page", role: "user" }],
    model,
    stream: true,
  };
}

const CHEAP_HEADERS_OMNI: [string, string][] = [
  ["accept", "application/json"],
  ["anthropic-version", "2023-06-01"],
  ["authorization", "Bearer omni-key-123456"],
  ["content-type", "application/json"],
  ["user-agent", "claude-cli/2.1.299 (external, cli)"],
  ["x-claude-code-session-id", "sess-1"],
];

/** Call `index`, or a failed test when there is none — never a skipped assertion. */
function nth(calls: Call[], index: number): Call {
  const call = calls[index];
  if (call === undefined) throw new Error(`no upstream call #${index + 1} (got ${calls.length})`);
  return call;
}

/** Fails when the test token shows up anywhere in a call to a cheap backend. */
function expectNoLogin(call: Call) {
  for (const [name, value] of call.headers) {
    expect(`${name}: ${value}`).not.toContain("TESTTOKEN");
  }
  expect(call.body ?? "").not.toContain("TESTTOKEN");
  expect(call.body ?? "").not.toContain("acct-42");
}

// ─── Claude traffic passes unchanged ────────────────────────────────────────────

describe("Claude traffic", () => {
  it("forwards a claude-* request byte for byte, dropping only hop-by-hop, host and content-length", async () => {
    // Odd spacing on purpose: a re-serialised body would lose it.
    const raw = `{"model":  "claude-opus-5-5", "metadata": {"user_id": "acct-42"},"max_tokens":5}`;
    const { calls, handle } = router([
      () =>
        new Response("upstream-bytes", {
          headers: {
            connection: "close",
            "content-encoding": "gzip",
            "keep-alive": "timeout=5",
            "request-id": "req_1",
          },
          status: 200,
        }),
    ]);
    const res = await handle(clientRequest({ body: raw }));

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(call?.method).toBe("POST");
    expect(call?.body).toBe(raw);
    expect(call?.headers).toEqual([
      ["accept", "application/json"],
      ["accept-encoding", "gzip, br"],
      ["anthropic-beta", "oauth-2025-04-20,interleaved-thinking-2025-05-14"],
      ["anthropic-version", "2023-06-01"],
      ["authorization", `Bearer ${TOKEN}`],
      ["content-type", "application/json"],
      ["cookie", `sessionKey=${TOKEN}`],
      ["user-agent", "claude-cli/2.1.299 (external, cli)"],
      ["x-api-key", TOKEN],
      ["x-claude-code-session-id", "sess-1"],
      ["x-stainless-retry-count", "0"],
    ]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("upstream-bytes");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("request-id")).toBe("req_1");
    expect(res.headers.get("connection")).toBeNull();
    expect(res.headers.get("keep-alive")).toBeNull();
  });

  it("sends a model it does not know to Anthropic unchanged", async () => {
    const raw = JSON.stringify(message("gpt-9"));
    const { calls, handle } = router([() => new Response("{}", { status: 404 })]);
    const res = await handle(clientRequest({ body: raw }));
    expect(res.status).toBe(404);
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      ["https://anthropic.test/v1/messages?beta=true", raw],
    ]);
  });

  it("forwards every other path to Anthropic: method, path and query unchanged", async () => {
    const { calls, handle } = router([
      () => new Response('{"data":[]}', { status: 200 }),
      () => new Response(null, { status: 204 }),
      () => new Response("ok", { status: 201 }),
    ]);
    const models = await handle(clientRequest({ method: "GET", path: "/v1/models?limit=5" }));
    const hello = await handle(clientRequest({ method: "HEAD", path: "/api/hello" }));
    // A POST that is not /v1/messages: not JSON, still forwarded as it came.
    const upload = await handle(
      clientRequest({
        body: "raw file bytes",
        headers: { "content-type": "text/plain" },
        path: "/v1/files",
      }),
    );
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["GET", "https://anthropic.test/v1/models?limit=5", null],
      ["HEAD", "https://anthropic.test/api/hello", null],
      ["POST", "https://anthropic.test/v1/files", "raw file bytes"],
    ]);
    expect([models.status, hello.status, upload.status]).toEqual([200, 204, 201]);
    expect(calls[0]?.headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
  });

  it("a request without a body goes on without one (no content-length: 0 on a DELETE)", async () => {
    const { calls, handle } = router([() => new Response(null, { status: 204 })]);
    const res = await handle(clientRequest({ method: "DELETE", path: "/v1/files/file_1" }));
    expect(res.status).toBe(204);
    expect(nth(calls, 0).method).toBe("DELETE");
    expect(nth(calls, 0).url).toBe("https://anthropic.test/v1/files/file_1");
    expect(nth(calls, 0).body).toBeNull();
  });

  it("Anthropic's own redirect passes to Claude Code unchanged", async () => {
    const { handle } = router([
      () => new Response(null, { headers: { location: "https://anthropic.test/v2" }, status: 307 }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("claude-opus-5-5")) }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://anthropic.test/v2");
  });

  it("a slot whose target is claude-* changes only the model", async () => {
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    await handle(clientRequest({ body: JSON.stringify(message("anymodel-worker")) }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      max_tokens: 1024,
      messages: [{ content: "find the settings page", role: "user" }],
      metadata: { user_id: `user_acct-42_${TOKEN}` },
      model: "claude-sonnet-5-5",
      stream: true,
    });
    expect(calls[0]?.headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
    expect(calls[0]?.headers).toContainEqual([
      "anthropic-beta",
      "oauth-2025-04-20,interleaved-thinking-2025-05-14",
    ]);
  });
});

// ─── The login never reaches a cheap backend ───────────────────────────────────

describe("cheap backends never see the Claude login", () => {
  it("first target: allow-listed headers and its own key only; no metadata", async () => {
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    // The query (`?beta=true`) is Anthropic's; the backend gets the path alone.
    expect(calls[0]?.url).toBe("http://omni.test/v1/messages");
    expect(calls[0]?.headers).toEqual(CHEAP_HEADERS_OMNI);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual(cheapBodyFor("glm-5.3-flash"));
    expectNoLogin(nth(calls, 0));
  });

  it("fallback target: the same, with the second backend's key", async () => {
    const { calls, handle } = router([
      () => new Response("busy", { status: 429 }),
      () => new Response("{}", { status: 200 }),
    ]);
    await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    expect(calls.map((c) => c.url)).toEqual([
      "http://omni.test/v1/messages",
      "https://ollama.test/v1/messages",
    ]);
    expect(calls[1]?.headers).toContainEqual(["authorization", "Bearer ollama-key-abcdef"]);
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual(cheapBodyFor("deepseek-v4.1-flash"));
    for (const call of calls) expectNoLogin(call);
  });

  it("explicit <backend>:<model>: that backend alone, no fallback, no login", async () => {
    const { calls, handle } = router([() => new Response("down", { status: 503 })]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("ollama:kimi-k3")) }));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("down");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ollama.test/v1/messages");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual(cheapBodyFor("kimi-k3"));
    expectNoLogin(nth(calls, 0));
  });
});

// ─── Fallback ───────────────────────────────────────────────────────────────────

describe("fallback", () => {
  const scout = () => clientRequest({ body: JSON.stringify(message("anymodel-scout")) });
  const mixed = () => clientRequest({ body: JSON.stringify(message("anymodel-mixed")) });

  it("429 → next, and the discarded body is cancelled", async () => {
    const busy = trackedResponse(429, "busy");
    const { calls, handle, logs } = router([
      () => busy.response,
      () => new Response("answer", { status: 200 }),
    ]);
    const res = await handle(scout());
    expect(await res.text()).toBe("answer");
    expect(calls).toHaveLength(2);
    expect(busy.state.cancelled).toBe(true);
    expect(logs.at(-1)).toBe(
      "2026-10-15T10:00:00.000Z POST /v1/messages anymodel-scout → ollama:deepseek-v4.1-flash 200 0ms fallbacks=1",
    );
  });

  it("503 → next", async () => {
    const { calls, handle } = router([
      () => new Response("x", { status: 503 }),
      () => new Response("ok"),
    ]);
    expect((await handle(scout())).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("network error → next", async () => {
    const { calls, handle } = router([
      () => {
        throw new TypeError("fetch failed: connection refused");
      },
      () => new Response("ok"),
    ]);
    expect(await (await handle(scout())).text()).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("a cheap backend that is not last: 400 and 401 move on, with a warning", async () => {
    const bad = trackedResponse(400, "reasoning history rejected");
    const { calls, handle, logs } = router([
      () => bad.response,
      () => new Response("no key", { status: 401 }),
      () => new Response("claude answer"),
    ]);
    const res = await handle(scout());
    expect(await res.text()).toBe("claude answer");
    expect(calls.map((c) => c.url)).toEqual([
      "http://omni.test/v1/messages",
      "https://ollama.test/v1/messages",
      "https://anthropic.test/v1/messages?beta=true",
    ]);
    expect(bad.state.cancelled).toBe(true);
    expect(logs).toContain(
      "WARN omniroute:glm-5.3-flash answered 400; trying the next target — reasoning history rejected",
    );
    expect(logs).toContain(
      "WARN ollama:deepseek-v4.1-flash answered 401; trying the next target — no key",
    );
  });

  it("Anthropic's 400 and 401 are the answer: returned unchanged, nothing else tried", async () => {
    for (const status of [400, 401]) {
      const { calls, handle } = router([
        () => new Response(`{"type":"error","status":${status}}`, { status }),
        () => new Response("must not be used"),
      ]);
      const res = await handle(mixed());
      expect(res.status).toBe(status);
      expect(await res.text()).toBe(`{"type":"error","status":${status}}`);
      expect(calls).toHaveLength(1);
    }
  });

  it("Anthropic's 429 moves on", async () => {
    const { calls, handle } = router([
      () => new Response("busy", { status: 429 }),
      () => new Response("cheap"),
    ]);
    expect(await (await handle(mixed())).text()).toBe("cheap");
    expect(calls.map((c) => c.url)).toEqual([
      "https://anthropic.test/v1/messages?beta=true",
      "http://omni.test/v1/messages",
    ]);
  });

  it("the last target's answer is returned whatever it is; its retry-after made whole seconds", async () => {
    const { calls, handle } = router([
      () => new Response("x", { status: 503 }),
      () => new Response('{"error":"bad"}', { headers: { "retry-after": "1.5" }, status: 400 }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"bad"}');
    expect(res.headers.get("retry-after")).toBe("2");
    expect(calls).toHaveLength(2);
  });

  // Changed on purpose: the log keeps 300 characters now (it was 200), so a long error
  // reason from Anthropic fits; the expected lengths grew by 100 each. The padding is
  // `a.` / `b.` now (it was one long run of `a` / `b`): a run of 32 or more letters looks
  // like a key, and the log masks it (`maskSecrets`).
  it("logs the upstream's reason (first 300 characters); the last target's body still reaches the client whole", async () => {
    const reason = `{"error":{"message":"Input exceeds context window of this model (limit 128000)","pad":"${"a.".repeat(150)}"}}`;
    const lastBody = `{"error":"rejected",\n"detail":"${"b.".repeat(200)}"}`;
    const { handle, logs } = router([
      () => new Response(reason, { status: 413 }),
      () => new Response(lastBody, { status: 400 }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(lastBody);
    expect(logs).toContain(
      `WARN omniroute:glm-5.3-flash answered 413; trying the next target — {"error":{"message":"Input exceeds context window of this model (limit 128000)","pad":"${"a.".repeat(106)}a`,
    );
    expect(logs).toContain(
      `WARN ollama:deepseek-v4.1-flash answered 400; returned as it is — {"error":"rejected", "detail":"${"b.".repeat(134)}b`,
    );
  });

  it("a cheap backend's redirect is never passed on: 502, and the Location stays with the router", async () => {
    const { handle, logs } = router([
      () => new Response("x", { status: 503 }),
      () => new Response("moved", { headers: { location: "https://evil.test/" }, status: 302 }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }));
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({
      error: {
        message:
          "anymodel-router: ollama:deepseek-v4.1-flash answered a redirect (302); not passed on",
        type: "api_error",
      },
      type: "error",
    });
    expect(logs).toContain(
      "WARN ollama:deepseek-v4.1-flash answered a redirect (302); refused — moved",
    );
  });

  it("an explicit <backend>:<model> redirect is refused the same way", async () => {
    const { handle } = router([
      () => new Response(null, { headers: { location: "https://evil.test/" }, status: 301 }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("ollama:kimi-k3")) }));
    expect(res.status).toBe(502);
  });

  it("retry-after as an HTTP date: whole seconds for the client, and the target rests that long", async () => {
    const { handle } = router([
      () => new Response("x", { status: 503 }),
      () =>
        new Response("slow down", {
          headers: { "retry-after": "Thu, 15 Oct 2026 10:01:30 GMT" },
          status: 429,
        }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    const health: unknown = await (
      await handle(clientRequest({ method: "GET", path: "/__anymodel/health" }))
    ).json();
    expect(health).toMatchObject({
      cooling: { "ollama:deepseek-v4.1-flash": 90, "omniroute:glm-5.3-flash": 30 },
    });
  });

  // Reworked: a gzip answer is now decompressed for the log (the test with real gzip is in
  // "error answers are logged, keys masked"). What stays: an encoding the router cannot
  // read is named, and a body that is not what its encoding says is named so; the client
  // gets the bytes whole either way.
  it("a compressed error answer it cannot read is logged as such, and still reaches the client whole", async () => {
    const { handle, logs } = router([
      () => new Response("x", { status: 503 }),
      () =>
        new Response("COMPRESSED-BYTES", {
          headers: { "content-encoding": "compress" },
          status: 400,
        }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }));
    expect(res.headers.get("content-encoding")).toBe("compress");
    expect(await res.text()).toBe("COMPRESSED-BYTES");
    expect(logs).toContain(
      "WARN ollama:deepseek-v4.1-flash answered 400; returned as it is — (compress body)",
    );

    const broken = router([
      () => new Response("x", { status: 503 }),
      () => new Response("NOT-GZIP", { headers: { "content-encoding": "gzip" }, status: 400 }),
    ]);
    const res2 = await broken.handle(
      clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }),
    );
    expect(await res2.text()).toBe("NOT-GZIP");
    expect(
      broken.logs.some((line) =>
        line.startsWith(
          "WARN ollama:deepseek-v4.1-flash answered 400; returned as it is — (gzip body unreadable: ",
        ),
      ),
    ).toBe(true);
  });

  it("firstByteMs applies only to a streaming request to a cheap target with another behind it", async () => {
    const late = (text: string) => () =>
      new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(new Response(text));
        }, 120);
      });
    // Anthropic directly, streaming: no deadline.
    const direct = router([late("anthropic, late")], { config: config(30) });
    const a = await direct.handle(
      clientRequest({ body: JSON.stringify(message("claude-opus-5-5")) }),
    );
    expect(await a.text()).toBe("anthropic, late");
    // A non-streaming request to the first of two backends: no deadline.
    const quiet = router([late("first backend, late")], { config: config(30) });
    const b = await quiet.handle(
      clientRequest({ body: JSON.stringify({ ...message("anymodel-cheap"), stream: false }) }),
    );
    expect(await b.text()).toBe("first backend, late");
    expect(quiet.calls).toHaveLength(1);
    // The last target of a streaming request: no deadline.
    const lastOne = router([() => new Response("x", { status: 503 }), late("last, late")], {
      config: config(30),
    });
    const c = await lastOne.handle(
      clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }),
    );
    expect(await c.text()).toBe("last, late");
  });

  it("every target failing with no answer → 502 in Anthropic's error shape", async () => {
    const refuse = () => {
      throw new TypeError("connection refused");
    };
    const { calls, handle } = router([refuse, refuse, refuse]);
    const res = await handle(scout());
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(3);
    const body: unknown = await res.json();
    expect(body).toEqual({
      error: {
        message:
          "anymodel-router: no target for anymodel-scout answered (omniroute:glm-5.3-flash: connection refused; ollama:deepseek-v4.1-flash: connection refused; claude-sonnet-5-5: connection refused)",
        type: "api_error",
      },
      type: "error",
    });
  });

  it("no response headers within firstByteMs → the call is aborted and the next target answers", async () => {
    let firstSignal: AbortSignal | undefined;
    const { calls, handle } = router(
      [
        (call) => {
          firstSignal = call.signal;
          // Never answers, and ignores the abort: the router must not wait on it.
          return new Promise<Response>(() => undefined);
        },
        () => new Response("second"),
      ],
      { config: config(50) },
    );
    const res = await handle(scout());
    expect(await res.text()).toBe("second");
    expect(calls).toHaveLength(2);
    expect(firstSignal?.aborted).toBe(true);
  });
});

// ─── Streams ────────────────────────────────────────────────────────────────────

// ─── Tool search for cheap backends ─────────────────────────────────────────────

describe("tool search", () => {
  const readTool = { description: "read a file", input_schema: { type: "object" }, name: "Read" };
  const toolSearch = {
    description: "find deferred tools",
    input_schema: { type: "object" },
    name: "ToolSearch",
  };
  const playwright = {
    defer_loading: true,
    description: "open a page",
    input_schema: { type: "object" },
    name: "mcp__playwright__browser_navigate",
  };
  const database = {
    defer_loading: true,
    description: "run sql",
    input_schema: { type: "object" },
    name: "mcp__database__run_query",
  };
  const notDeferred = { defer_loading: false, input_schema: { type: "object" }, name: "Grep" };

  function toolSearchBody(model: string): Record<string, unknown> {
    return {
      max_tokens: 1024,
      messages: [
        { content: "open the settings page", role: "user" },
        {
          content: [
            { id: "toolu_1", input: { query: "browser" }, name: "ToolSearch", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [
            {
              content: [
                { text: "Found 1 tool", type: "text" },
                { tool_name: "mcp__playwright__browser_navigate", type: "tool_reference" },
              ],
              tool_use_id: "toolu_1",
              type: "tool_result",
            },
            { text: "go on", type: "text" },
          ],
          role: "user",
        },
      ],
      metadata: { user_id: "acct-42" },
      model,
      tools: [readTool, toolSearch, playwright, database, notDeferred],
    };
  }

  it("a backend gets found tools as plain definitions, the rest of the deferred ones dropped", async () => {
    const { calls, handle } = router([() => new Response("{}")]);
    await handle(clientRequest({ body: JSON.stringify(toolSearchBody("anymodel-cheap")) }));
    expect(JSON.parse(nth(calls, 0).body ?? "")).toEqual({
      max_tokens: 1024,
      messages: [
        { content: "open the settings page", role: "user" },
        {
          content: [
            { id: "toolu_1", input: { query: "browser" }, name: "ToolSearch", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [
            {
              content: [
                { text: "Found 1 tool", type: "text" },
                { text: "Tool loaded: mcp__playwright__browser_navigate", type: "text" },
              ],
              tool_use_id: "toolu_1",
              type: "tool_result",
            },
            { text: "go on", type: "text" },
          ],
          role: "user",
        },
      ],
      model: "glm-5.3-flash",
      tools: [
        { description: "read a file", input_schema: { type: "object" }, name: "Read" },
        {
          description: "find deferred tools",
          input_schema: { type: "object" },
          name: "ToolSearch",
        },
        {
          description: "open a page",
          input_schema: { type: "object" },
          name: "mcp__playwright__browser_navigate",
        },
        { defer_loading: false, input_schema: { type: "object" }, name: "Grep" },
      ],
    });
  });

  it("leaves a string tool_result and a tool_reference outside a tool_result alone", () => {
    const body = {
      messages: [
        {
          content: [
            { content: "plain text answer", tool_use_id: "toolu_1", type: "tool_result" },
            { tool_name: "Stray", type: "tool_reference" },
          ],
          role: "user",
        },
      ],
      tools: [{ defer_loading: true, name: "Stray" }, { name: "Read" }],
    };
    expect(toolSearchForBackend(body)).toEqual({
      messages: [
        {
          content: [
            { content: "plain text answer", tool_use_id: "toolu_1", type: "tool_result" },
            { tool_name: "Stray", type: "tool_reference" },
          ],
          role: "user",
        },
      ],
      // Only a reference inside a tool_result loads a tool: "Stray" stays deferred, so dropped.
      tools: [{ name: "Read" }],
    });
  });

  it("Anthropic gets the same bytes, defer_loading and tool_reference untouched", async () => {
    const raw = JSON.stringify(toolSearchBody("claude-opus-5-5"));
    const { calls, handle } = router([() => new Response("{}")]);
    await handle(clientRequest({ body: raw }));
    expect(nth(calls, 0).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(nth(calls, 0).body).toBe(raw);
  });

  it("a claude-* slot target keeps tool search as it is too: only the model changes", async () => {
    const { calls, handle } = router([() => new Response("{}")]);
    await handle(clientRequest({ body: JSON.stringify(toolSearchBody("anymodel-worker")) }));
    expect(JSON.parse(nth(calls, 0).body ?? "")).toEqual({
      ...toolSearchBody("anymodel-worker"),
      model: "claude-sonnet-5-5",
    });
  });
});

// ─── Auto mode's safety check ───────────────────────────────────────────────────

describe("auto mode's safety check", () => {
  /** The older form Claude Code 2.1.x sends (captured 2026-10-15), with a short prompt. */
  function guardBody(): Record<string, unknown> {
    return {
      max_tokens: 64,
      messages: [
        {
          content: [
            {
              text: '<transcript>\n{"Bash":"git push --force origin main"}\n</transcript>\n',
              type: "text",
            },
          ],
          role: "user",
        },
      ],
      metadata: { user_id: `user_acct-42_${TOKEN}` },
      model: "claude-sonnet-5",
      stop_sequences: ["</severity>"],
      system: [
        { text: "x-anthropic-billing-header: cc_version=2.1.299", type: "text" },
        {
          cache_control: { ttl: "1h", type: "ephemeral" },
          text: "You are a security monitor for autonomous AI coding agents.\n\n## Context",
          type: "text",
        },
      ],
      thinking: { type: "disabled" },
    };
  }

  /** The newer form (captured 2026-10-15): a slot name, no thinking field, `<block>` answers. */
  function slotGuardBody(model: string): Record<string, unknown> {
    const body: Record<string, unknown> = {
      ...guardBody(),
      max_tokens: 2112,
      model,
      stop_sequences: ["</block>"],
    };
    delete body.thinking;
    return body;
  }

  const ANTHROPIC_URL = "https://anthropic.test/v1/messages?beta=true";

  it("the older form (a claude-* model) reaches Anthropic byte for byte, on the own login", async () => {
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    const sent = JSON.stringify(guardBody());
    await handle(clientRequest({ body: sent }));
    expect(calls.map((c) => c.url)).toEqual([ANTHROPIC_URL]);
    expect(calls[0]?.body).toBe(sent);
    expect(calls[0]?.headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
  });

  it("the newer form on a slot goes to that slot's Claude target only, never a cheap backend", async () => {
    // config()'s anymodel-scout: GLM, DeepSeek, then Claude Sonnet 5.5. With `[1m]`, as sent.
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    const body = slotGuardBody("anymodel-scout[1m]");
    await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(calls.map((c) => c.url)).toEqual([ANTHROPIC_URL]);
    expect(calls[0]?.headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
    // Only the model changes: no output_config, no thinking field added.
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ ...body, model: "claude-sonnet-5-5" });
  });

  it("a check is never translated for its Claude target: only the model changes, on messages and count_tokens", async () => {
    // Fields requestForClaudeFallback would change for Claude Sonnet 5.5 on any other
    // request. Auto mode stays as Claude Code ships it: the check keeps them all.
    const body = {
      ...slotGuardBody("anymodel-scout"),
      output_config: { effort: "max" },
      temperature: 0,
      thinking: { type: "disabled" },
      tool_choice: { type: "any" },
      top_p: 0.5,
    };
    const { calls, handle, logs } = router([() => new Response("{}"), () => new Response("{}")]);
    await handle(clientRequest({ body: JSON.stringify(body) }));
    await handle(
      clientRequest({ body: JSON.stringify(body), path: "/v1/messages/count_tokens?beta=true" }),
    );
    expect(calls.map((c) => c.url)).toEqual([
      ANTHROPIC_URL,
      "https://anthropic.test/v1/messages/count_tokens?beta=true",
    ]);
    const expected = JSON.stringify({ ...body, model: "claude-sonnet-5-5" });
    expect(nth(calls, 0).body).toBe(expected);
    expect(nth(calls, 1).body).toBe(expected);
    expect(logs.filter((line) => line.startsWith("translated for "))).toEqual([]);
  });

  it("count_tokens for a check on a cheap-first slot: its Claude target, not a 404", async () => {
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    const res = await handle(
      clientRequest({
        body: JSON.stringify(slotGuardBody("anymodel-scout")),
        path: "/v1/messages/count_tokens?beta=true",
      }),
    );
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      "https://anthropic.test/v1/messages/count_tokens?beta=true",
    ]);
  });

  it("its Claude target failing is the answer: the cheap target behind it is not tried", async () => {
    // config()'s anymodel-mixed: Claude Sonnet 5.5, then GLM.
    const { calls, handle } = router([() => new Response("down", { status: 503 })]);
    const res = await handle(
      clientRequest({ body: JSON.stringify(slotGuardBody("anymodel-mixed")) }),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("down");
    expect(calls.map((c) => c.url)).toEqual([ANTHROPIC_URL]);
  });

  it("a slot with no Claude target: Anthropic gets it as it came and refuses it; no cheap backend", async () => {
    // config()'s anymodel-cheap: GLM and DeepSeek only.
    const { calls, handle } = router([() => new Response("not found", { status: 404 })]);
    const sent = JSON.stringify(slotGuardBody("anymodel-cheap"));
    const res = await handle(clientRequest({ body: sent }));
    expect(res.status).toBe(404);
    expect(calls.map((c) => c.url)).toEqual([ANTHROPIC_URL]);
    expect(calls[0]?.body).toBe(sent);
  });

  it("a slot request with another system prompt still goes to the cheap targets", async () => {
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    const body = {
      ...slotGuardBody("anymodel-scout"),
      system: [{ text: "You are Claude Code.", type: "text" }],
    };
    await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(calls.map((c) => c.url)).toEqual(["http://omni.test/v1/messages"]);
    expectNoLogin(nth(calls, 0));
  });

  it("is recognised by its system prompt on a claude-* model or a slot, as a string or a block", () => {
    const prompt = "You are a security monitor for autonomous AI coding agents.";
    expect(isAutoModeGuard({ model: "claude-sonnet-5", system: prompt })).toBe(true);
    expect(isAutoModeGuard({ model: "claude-sonnet-5", system: [{ text: prompt }] })).toBe(true);
    expect(isAutoModeGuard({ model: "anymodel-worker[1m]", system: prompt })).toBe(true);
    // The prompt only in a message (a person pasting it) is not the safety check.
    expect(
      isAutoModeGuard({ messages: [{ content: prompt, role: "user" }], model: "claude-sonnet-5" }),
    ).toBe(false);
    // An explicit backend is someone's own test.
    expect(isAutoModeGuard({ model: "omniroute:deepseek-v4.1-flash", system: prompt })).toBe(false);
    expect(isAutoModeGuard({ model: "claude-sonnet-5", system: [null, 7, { text: 7 }] })).toBe(
      false,
    );
  });

  it("the log line marks the check, though its newer form carries a slot's name", async () => {
    const { handle, logs } = router([() => new Response("{}", { status: 200 })]);
    await handle(clientRequest({ body: JSON.stringify(slotGuardBody("anymodel-worker[1m]")) }));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(
      "POST /v1/messages anymodel-worker[1m] (safety check) → claude-sonnet-5-5 200",
    );
  });

  it("an ordinary slot request with no thinking field keeps the backend's default reasoning", async () => {
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual(cheapBodyFor("glm-5.3-flash"));
  });

  // ─── The judge slot: every check, every session  ─────────────

  function withJudge(firstByteMs = 1000): GatewayConfig {
    const cfg = config(firstByteMs);
    return {
      ...cfg,
      slots: {
        ...cfg.slots,
        "anymodel-judge": ["ollama:deepseek-v4.1-flash", "omniroute:glm-5.3-flash"],
      },
    };
  }

  const ok = () => new Response("{}", { status: 200 });
  const OLLAMA_URL = "https://ollama.test/v1/messages";

  it("with a judge slot, a Claude session's check goes there: reasoning off, no login", async () => {
    const { calls, handle, logs } = router([ok], { config: withJudge() });
    await handle(clientRequest({ body: JSON.stringify(guardBody()) }));
    expect(calls.map((c) => c.url)).toEqual([OLLAMA_URL]);
    const check: unknown = JSON.parse(calls[0]?.body ?? "");
    expect(check).toMatchObject({
      max_tokens: 64,
      model: "deepseek-v4.1-flash",
      output_config: { effort: "none" },
      stop_sequences: ["</severity>"],
      thinking: { type: "disabled" },
    });
    expect(check).not.toHaveProperty("metadata");
    expectNoLogin(nth(calls, 0));
    expect(logs[0]).toContain(
      "claude-sonnet-5 (safety check) [judge] → ollama:deepseek-v4.1-flash 200",
    );
  });

  it("the newer form too, with reasoning off though it sends no thinking field", async () => {
    const { calls, handle } = router([ok], { config: withJudge() });
    await handle(clientRequest({ body: JSON.stringify(slotGuardBody("anymodel-worker[1m]")) }));
    expect(calls.map((c) => c.url)).toEqual([OLLAMA_URL]);
    const check: unknown = JSON.parse(calls[0]?.body ?? "");
    expect(check).toMatchObject({
      model: "deepseek-v4.1-flash",
      output_config: { effort: "none" },
    });
    expect(check).not.toHaveProperty("thinking");
  });

  it("the judge's fallback answers when the first does not; Claude is never tried", async () => {
    const { calls, handle } = router([() => new Response("busy", { status: 503 }), ok], {
      config: withJudge(),
    });
    const res = await handle(clientRequest({ body: JSON.stringify(guardBody()) }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([OLLAMA_URL, "http://omni.test/v1/messages"]);
  });

  it("a judge that hangs gets the deadline though the check does not stream; the next judge answers", async () => {
    let firstSignal: AbortSignal | undefined;
    const { calls, handle } = router(
      [
        (call) => {
          firstSignal = call.signal;
          // Never answers, and ignores the abort: the router must not wait on it.
          return new Promise<Response>(() => undefined);
        },
        ok,
      ],
      { config: withJudge(50) },
    );
    const res = await handle(clientRequest({ body: JSON.stringify(guardBody()) }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([OLLAMA_URL, "http://omni.test/v1/messages"]);
    expect(firstSignal?.aborted).toBe(true);
  });

  it("the judge slot takes no claude-… target: the check's body would get a 400", () => {
    const cfg = withJudge();
    const parsed = parseConfig({
      ...cfg,
      slots: {
        ...cfg.slots,
        "anymodel-judge": ["ollama:deepseek-v4.1-flash", "claude-sonnet-5-5"],
      },
    });
    expect("error" in parsed && parsed.error).toContain(
      'anymodel-judge takes no claude-… target; use "anymodel gateway slot judge off" to put the checks on Claude',
    );
  });

  it("a request that offers tools is never taken for the check, whatever its system prompt", () => {
    const prompt = "You are a security monitor for autonomous AI coding agents.";
    expect(
      isAutoModeGuard({ model: "claude-opus-5-5", system: prompt, tools: [{ name: "Bash" }] }),
    ).toBe(false);
    expect(isAutoModeGuard({ model: "claude-opus-5-5", system: prompt, tools: [] })).toBe(true);
  });

  it("count_tokens for a check with a judge slot: 404, nothing reaches Claude", async () => {
    const { calls, handle } = router([], { config: withJudge() });
    const res = await handle(
      clientRequest({
        body: JSON.stringify(guardBody()),
        path: "/v1/messages/count_tokens?beta=true",
      }),
    );
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("a judge slot changes nothing else: an ordinary Claude request goes byte for byte", async () => {
    const { calls, handle } = router([ok], { config: withJudge() });
    const sent = JSON.stringify(message("claude-opus-5-5"));
    await handle(clientRequest({ body: sent }));
    expect(calls.map((c) => c.url)).toEqual([ANTHROPIC_URL]);
    expect(calls[0]?.body).toBe(sent);
  });

  it("an explicit <backend>:<model> with the check's prompt is someone's test: its own route", async () => {
    const { calls, handle } = router([ok], { config: withJudge() });
    const body = { ...guardBody(), model: "omniroute:glm-5.3-flash" };
    await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(calls.map((c) => c.url)).toEqual(["http://omni.test/v1/messages"]);
    expect(JSON.parse(calls[0]?.body ?? "")).toMatchObject({ model: "glm-5.3-flash" });
  });
});

// ─── Reasoning off, for a cheap backend ─────────────────────────────────────────

describe("reasoning off", () => {
  it("thinking disabled and no effort → effort none; other output_config fields kept", () => {
    expect(reasoningOffForBackend({ thinking: { type: "disabled" } })).toEqual({
      output_config: { effort: "none" },
      thinking: { type: "disabled" },
    });
    expect(
      reasoningOffForBackend({ output_config: { format: "json" }, thinking: { type: "disabled" } }),
    ).toEqual({
      output_config: { effort: "none", format: "json" },
      thinking: { type: "disabled" },
    });
  });

  it("an effort already named, or thinking on, stays as it is", () => {
    const named = { output_config: { effort: "high" }, thinking: { type: "disabled" } };
    expect(reasoningOffForBackend(named)).toEqual({
      output_config: { effort: "high" },
      thinking: { type: "disabled" },
    });
    const adaptive = { thinking: { type: "adaptive" } };
    expect(reasoningOffForBackend(adaptive)).toEqual({ thinking: { type: "adaptive" } });
    expect(reasoningOffForBackend({ max_tokens: 5 })).toEqual({ max_tokens: 5 });
  });

  // Rewritten on purpose (it was "a claude-* slot target gets thinking as it was"): Claude
  // Sonnet 5.5 answers 400 to `thinking: disabled`, so a slot that reached it with that
  // field failed. Kept from the old test: no effort is added for a Claude target.
  it("a claude-* slot target gets reasoning off in the form it accepts: no effort added", async () => {
    const { calls, handle } = router([() => new Response("{}", { status: 200 })]);
    const body = { ...message("anymodel-mixed"), thinking: { type: "disabled" } };
    await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(calls[0]?.url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      ...body,
      model: "claude-sonnet-5-5",
      thinking: { type: "between_tools" },
    });
  });
});

describe("a slot's Claude target: only the fields it refuses change", () => {
  /** A slot request as Claude Code builds it, with every field a Claude target may refuse. */
  function refusedBody(model: string): Record<string, unknown> {
    return {
      max_tokens: 2048,
      messages: [
        { content: "Summarise   the diff.\n\nKeep it short.", role: "user" },
        {
          content: [
            { signature: "sig-1", thinking: "", type: "thinking" },
            { text: "Reading it.", type: "text" },
          ],
          role: "assistant",
        },
        { content: "Go on.", role: "user" },
      ],
      metadata: { user_id: "acct-42" },
      model,
      output_config: { effort: "xhigh", format: { type: "json_schema" } },
      stream: true,
      system: [
        { cache_control: { type: "ephemeral" }, text: "You are Claude Code.", type: "text" },
      ],
      temperature: 0,
      thinking: { type: "disabled" },
      tool_choice: { disable_parallel_tool_use: true, type: "tool", name: "Read" },
      tools: [{ description: "read a file", input_schema: { type: "object" }, name: "Read" }],
      top_k: 40,
      top_p: 0.9,
    };
  }

  it("Claude Sonnet 5.5: each refused field gets the nearest value it accepts", () => {
    const body = refusedBody("anymodel-worker");
    const before = JSON.stringify(body);
    const out = requestForClaudeFallback(body, "claude-sonnet-5-5");
    expect(out.body).toEqual({
      max_tokens: 2048,
      messages: body.messages,
      metadata: { user_id: "acct-42" },
      model: "anymodel-worker",
      output_config: { effort: "high", format: { type: "json_schema" } },
      stream: true,
      system: body.system,
      thinking: { type: "between_tools" },
      tool_choice: { disable_parallel_tool_use: true, type: "auto" },
      tools: body.tools,
    });
    expect(out.changes).toEqual([
      "thinking disabled -> between_tools",
      "effort xhigh -> high",
      "tool_choice tool -> auto",
      "temperature left out",
      "top_p left out",
      "top_k left out",
    ]);
    // The input is not changed in place.
    expect(JSON.stringify(body)).toBe(before);
  });

  it("system, messages and tools stay byte-identical, and the fields keep their order", () => {
    const body = refusedBody("anymodel-worker");
    const out = requestForClaudeFallback(body, "claude-sonnet-5-5").body;
    expect(JSON.stringify(out.system)).toBe(
      '[{"cache_control":{"type":"ephemeral"},"text":"You are Claude Code.","type":"text"}]',
    );
    expect(JSON.stringify(out.messages)).toBe(
      '[{"content":"Summarise   the diff.\\n\\nKeep it short.","role":"user"},{"content":[{"signature":"sig-1","thinking":"","type":"thinking"},{"text":"Reading it.","type":"text"}],"role":"assistant"},{"content":"Go on.","role":"user"}]',
    );
    expect(JSON.stringify(out.tools)).toBe(
      '[{"description":"read a file","input_schema":{"type":"object"},"name":"Read"}]',
    );
    expect(Object.keys(out)).toEqual([
      "max_tokens",
      "messages",
      "metadata",
      "model",
      "output_config",
      "stream",
      "system",
      "thinking",
      "tool_choice",
      "tools",
    ]);
  });

  it("Claude Opus 5.5 always thinks: disabled thinking is left out, the effort kept", () => {
    const out = requestForClaudeFallback(refusedBody("anymodel-worker"), "claude-opus-5-5");
    expect(out.body).not.toHaveProperty("thinking");
    expect(out.body.output_config).toEqual({ effort: "xhigh", format: { type: "json_schema" } });
    expect(out.changes[0]).toBe("thinking disabled -> left out (always on)");
  });

  it("Claude Opus 5.5 with no effort named: thinking off becomes effort low, the nearest to no thinking", () => {
    const out = requestForClaudeFallback(
      {
        model: "anymodel-worker",
        output_config: { format: { type: "json_schema" } },
        thinking: { type: "disabled" },
      },
      "claude-opus-5-5",
    );
    expect(out.body).toEqual({
      model: "anymodel-worker",
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(out.changes).toEqual([
      "thinking disabled -> left out (always on)",
      "effort low (nearest to thinking off)",
    ]);
    // No output_config at all: one is added with the effort alone.
    expect(
      requestForClaudeFallback(
        { model: "anymodel-worker", thinking: { type: "disabled" } },
        "claude-opus-5-5",
      ).body,
    ).toEqual({ model: "anymodel-worker", output_config: { effort: "low" } });
    // Sonnet 5.5 keeps its own rule: between_tools, no effort added.
    expect(
      requestForClaudeFallback(
        { model: "anymodel-worker", thinking: { type: "disabled" } },
        "claude-sonnet-5-5",
      ).body,
    ).toEqual({ model: "anymodel-worker", thinking: { type: "between_tools" } });
  });

  it("a target written with [1m] gets its model's rules", () => {
    const out = requestForClaudeFallback(
      { model: "anymodel-worker", thinking: { type: "disabled" } },
      "claude-sonnet-5-5[1m]",
    );
    expect(out.body).toEqual({ model: "anymodel-worker", thinking: { type: "between_tools" } });
    expect(out.changes).toEqual(["thinking disabled -> between_tools"]);
  });

  it("a thinking budget becomes adaptive, its display kept; tool_choice any becomes auto", () => {
    const out = requestForClaudeFallback(
      {
        model: "anymodel-worker",
        thinking: { budget_tokens: 4000, display: "summarized", type: "enabled" },
        tool_choice: { type: "any" },
      },
      "claude-sonnet-5-5",
    );
    expect(out.body).toEqual({
      model: "anymodel-worker",
      thinking: { display: "summarized", type: "adaptive" },
      tool_choice: { type: "auto" },
    });
    expect(out.changes).toEqual([
      "thinking enabled (budget) -> adaptive",
      "tool_choice any -> auto",
    ]);
  });

  it("what a target accepts stays as it is: the same object back, no changes", () => {
    const accepted = {
      model: "anymodel-worker",
      output_config: { effort: "low" },
      temperature: 1,
      thinking: { type: "adaptive" },
      tool_choice: { type: "auto" },
    };
    expect(requestForClaudeFallback(accepted, "claude-sonnet-5-5")).toEqual({
      body: accepted,
      changes: [],
    });
    expect(requestForClaudeFallback(accepted, "claude-sonnet-5-5").body).toBe(accepted);
    // A model with no rules in the table: unchanged, whatever it carries.
    const body = refusedBody("anymodel-worker");
    expect(requestForClaudeFallback(body, "claude-sonnet-5").body).toBe(body);
  });

  it("a slot falling back to Claude Sonnet 5.5 sends between_tools; the cheap targets got the body unchanged by it", async () => {
    // config()'s anymodel-scout: GLM, DeepSeek, then Claude Sonnet 5.5. Both cheap ones 503.
    const busy = () => new Response("busy", { status: 503 });
    const { calls, handle, logs } = router([
      busy,
      busy,
      () => new Response("{}"),
      busy,
      busy,
      () => new Response("{}"),
    ]);
    const body = { ...message("anymodel-scout"), thinking: { type: "disabled" } };
    const res = await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(res.status).toBe(200);
    // The cheap targets: their own translations only, `thinking` as Claude Code sent it.
    expect(JSON.parse(nth(calls, 0).body ?? "")).toEqual({
      ...cheapBodyFor("glm-5.3-flash"),
      output_config: { effort: "none" },
      thinking: { type: "disabled" },
    });
    expect(JSON.parse(nth(calls, 1).body ?? "")).toEqual({
      ...cheapBodyFor("deepseek-v4.1-flash"),
      output_config: { effort: "none" },
      thinking: { type: "disabled" },
    });
    // Claude: the login, `model`, and between_tools; the rest as sent, metadata included.
    expect(nth(calls, 2).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(nth(calls, 2).headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
    expect(nth(calls, 2).body).toBe(
      JSON.stringify({ ...body, model: "claude-sonnet-5-5", thinking: { type: "between_tools" } }),
    );
    // Logged once per kind of change, not on every request.
    await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(logs.filter((line) => line.startsWith("translated for "))).toEqual([
      "translated for claude-sonnet-5-5: thinking disabled -> between_tools (requestForClaudeFallback; logged once per kind)",
    ]);
  });

  it("a claude-* request is never translated: Anthropic gets the bytes as sent", async () => {
    const { calls, handle } = router([() => new Response("{}")]);
    const sent = JSON.stringify(refusedBody("claude-sonnet-5-5"));
    await handle(clientRequest({ body: sent }));
    expect(nth(calls, 0).body).toBe(sent);
  });
});

describe("error answers are logged, keys masked", () => {
  const mixed = () => clientRequest({ body: JSON.stringify(message("anymodel-mixed")) });

  it("Anthropic's 400 for a slot's Claude target: logged with its reason, returned unchanged", async () => {
    const reason =
      '{"type":"error","error":{"type":"invalid_request_error","message":"\\"thinking.type.disabled\\" is not supported for this model."}}';
    const { handle, logs } = router([() => new Response(reason, { status: 400 })]);
    const res = await handle(mixed());
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(reason);
    expect(logs).toContain(`WARN claude-sonnet-5-5 answered 400; returned as it is — ${reason}`);
  });

  it("a claude-* request's 4xx / 5xx from Anthropic is logged too", async () => {
    const { handle, logs } = router([
      () => new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }),
    ]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("claude-opus-5-5")) }));
    expect(res.status).toBe(529);
    // Changed on purpose (it was `logs[0]`): the WARN line is written in the background,
    // once the client has its answer, so it now comes after the request's own line.
    expect(logs).toEqual([
      "2026-10-15T10:00:00.000Z POST /v1/messages claude-opus-5-5 → anthropic 529 0ms fallbacks=0",
      'WARN anthropic answered 529 — {"type":"error","error":{"type":"overloaded_error"}}',
    ]);
    // A 2xx is not.
    const ok = router([() => new Response("{}")]);
    await ok.handle(clientRequest({ body: JSON.stringify(message("claude-opus-5-5")) }));
    expect(ok.logs.filter((line) => line.startsWith("WARN"))).toEqual([]);
  });

  it("keys in an error answer are masked: sk-…, Bearer, key-named fields, long tokens", () => {
    expect(
      maskSecrets(
        'invalid x-api-key sk-ant-api03-SECRETSECRETSECRETabcd; Authorization: Bearer omni-key-123456 {"api_key":"plain-value","request_id":"req_011ABC"} token 0123456789abcdefghijklmnopqrstuvWXYZ',
      ),
    ).toBe(
      'invalid x-api-key sk-****abcd; Authorization: Bearer **** {"api_key":"****","request_id":"req_011ABC"} token ****WXYZ',
    );
  });

  it("the logged reason is masked and cut at 300 characters", async () => {
    const reason = `{"error":{"message":"bad key sk-live-SECRETSECRET9999","pad":"${"c".repeat(20)} ${"d ".repeat(200)}"}}`;
    const { handle, logs } = router([() => new Response(reason, { status: 401 })]);
    await handle(mixed());
    const line = logs.find((entry) => entry.startsWith("WARN claude-sonnet-5-5 answered 401"));
    expect(line).toBe(
      // 49 + 21 + 230 = 300 characters.
      `WARN claude-sonnet-5-5 answered 401; returned as it is — {"error":{"message":"bad key sk-****9999","pad":"${"c".repeat(20)} ${"d ".repeat(115)}`,
    );
    expect(line).not.toContain("SECRET");
  });

  it("a gzip error answer is read for the log, and still reaches the client as sent", async () => {
    const reason = '{"error":{"message":"prompt is too long"}}';
    const gzipped = Bun.gzipSync(new TextEncoder().encode(reason));
    const { handle, logs } = router([
      () => new Response(gzipped, { headers: { "content-encoding": "gzip" }, status: 400 }),
    ]);
    const res = await handle(mixed());
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(gzipped);
    expect(logs).toContain(`WARN claude-sonnet-5-5 answered 400; returned as it is — ${reason}`);
  });

  // ─── The log never stalls the router ─────────────────────────────────────────

  /** One `"`, then "key " over and over: the old field pattern backtracked on it for seconds. */
  const ADVERSARIAL = `"${"key ".repeat(16_384)}`;

  it("masking never stalls: a 64 KB adversarial text masks in well under 50 ms", () => {
    expect(ADVERSARIAL.length).toBe(65_537);
    const start = performance.now();
    maskSecrets(ADVERSARIAL);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("a large adversarial error answer: its WARN line is ready in well under 50 ms, cut to its start", async () => {
    // 512 KB in one chunk: what a gzip answer of a few KB can grow to.
    const big = ADVERSARIAL.repeat(8);
    const { handle, logs } = router([() => new Response(big, { status: 400 })]);
    const start = performance.now();
    const res = await handle(mixed());
    expect(performance.now() - start).toBeLessThan(50);
    expect(await res.text()).toBe(big);
    const line = logs.find((entry) => entry.startsWith("WARN claude-sonnet-5-5 answered 400"));
    // The snippet: its first 300 characters.
    expect(line).toBe(
      `WARN claude-sonnet-5-5 answered 400; returned as it is — "${"key ".repeat(74)}key`,
    );
  });

  it("a slow error body never delays the client's answer: the WARN line comes once the body does", async () => {
    const reason = '{"error":{"message":"slow reason"}}';
    const gate = deferred();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await gate.promise;
        controller.enqueue(new TextEncoder().encode(reason));
        controller.close();
      },
    });
    const { logs, raw, settled } = router([() => new Response(body, { status: 400 })]);
    const res = await raw(mixed());
    // The answer is here before its body sent a byte, and nothing is logged about it yet.
    expect(res.status).toBe(400);
    expect(logs.filter((line) => line.startsWith("WARN"))).toEqual([]);
    gate.resolve();
    expect(await res.text()).toBe(reason);
    await settled();
    expect(logs).toContain(`WARN claude-sonnet-5-5 answered 400; returned as it is — ${reason}`);
  });

  // ─── What is masked, and what stays readable ─────────────────────────────────

  it("short secrets after a key-like name are masked: header, JSON-escaped and query forms", () => {
    expect(maskSecrets("'x-api-key': 'abc123short'")).toBe("'x-api-key': '****'");
    expect(maskSecrets("x-api-key: shortkey99")).toBe("x-api-key: ****");
    expect(maskSecrets('{\\"api_key\\": \\"shortkey99\\"}')).toBe('{\\"api_key\\": \\"****\\"}');
    expect(maskSecrets("api_key=sk_live_abc&x=1")).toBe("api_key=****&x=1");
    // 12 characters or more: its last four stay, like every other masked secret.
    expect(maskSecrets("token=ghp_short1234")).toBe("token=****1234");
    // Words after a name with no `:` or `=` are prose, not a value.
    expect(maskSecrets("your api key does not exist")).toBe("your api key does not exist");
  });

  it("the exact secrets the router holds are masked, short ones and JSON-escaped ones too", () => {
    expect(maskSecrets("the backend key k9sh was refused", ["k9sh"])).toBe(
      "the backend key **** was refused",
    );
    // A key with a quote and a backslash, as a JSON string shows it, and inside a JSON
    // string inside a JSON string.
    const odd = 'ab"cd\\ef';
    expect(maskSecrets('{"message":"bad ab\\"cd\\\\ef"}', [odd])).toBe('{"message":"bad ****"}');
    expect(maskSecrets('"{\\"message\\":\\"bad ab\\\\\\"cd\\\\\\\\ef\\"}"', [odd])).toBe(
      '"{\\"message\\":\\"bad ****\\"}"',
    );
    // Too short to mask without wrecking the text: left to the patterns.
    expect(maskSecrets("a b c", ["a"])).toBe("a b c");
  });

  it("a backend's own key, and the request's x-api-key and authorization, never reach the log", async () => {
    const cfg = config();
    const backends = {
      ...cfg.backends,
      omniroute: { apiKey: "k9sh-omni", baseUrl: "http://omni.test" },
    };
    const { handle, logs } = router(
      [
        () => new Response('{"error":{"message":"key k9sh-omni is wrong"}}', { status: 401 }),
        () => new Response("{}"),
        () =>
          new Response('{"error":{"message":"plainlogin42 or oauthlogin77 refused"}}', {
            status: 401,
          }),
      ],
      { config: { ...cfg, backends } },
    );
    await handle(clientRequest({ body: JSON.stringify(message("anymodel-cheap")) }));
    await handle(
      clientRequest({
        body: JSON.stringify(message("claude-opus-5-5")),
        headers: { authorization: "Bearer oauthlogin77", "x-api-key": "plainlogin42" },
      }),
    );
    expect(logs).toContain(
      'WARN omniroute:glm-5.3-flash answered 401; trying the next target — {"error":{"message":"key **** is wrong"}}',
    );
    // 12 characters each: their last four stay, as for every masked secret that long.
    expect(logs).toContain(
      'WARN anthropic answered 401 — {"error":{"message":"****in42 or ****in77 refused"}}',
    );
    for (const line of logs) {
      expect(line).not.toContain("k9sh");
      expect(line).not.toContain("plainlogin42");
      expect(line).not.toContain("oauthlogin77");
    }
  });

  it("names stay readable: an MCP tool name with __ and a UUID; a 40-character random key is still masked", () => {
    const key = "Zx8Kq2Lm9Np4Rs7Tv1Wy5Ab3Cd6Ef0Gh2Jk4Mn8P";
    expect(key).toHaveLength(40);
    expect(
      maskSecrets(
        `tool mcp__plugin_example__search_everything_in_the_repository failed; request 3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c; key ${key}`,
      ),
    ).toBe(
      "tool mcp__plugin_example__search_everything_in_the_repository failed; request 3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c; key ****Mn8P",
    );
  });

  it("an email address in an error answer is masked", () => {
    expect(maskSecrets('{"message":"someone.else+x@example.co.uk has no access"}')).toBe(
      '{"message":"****@**** has no access"}',
    );
  });

  // ─── Which answers are logged, and how often ─────────────────────────────────

  it("a corrupt gzip error answer: exactly one WARN line, and the client still gets it as sent", async () => {
    // A gzip header, then bytes that are no deflate stream.
    const corrupt = new Uint8Array([
      0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0x03, 0xff, 0xff, 0xff, 0xff,
    ]);
    const { handle, logs } = router([
      () => new Response(corrupt, { headers: { "content-encoding": "gzip" }, status: 400 }),
    ]);
    const res = await handle(mixed());
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(corrupt);
    // The cancel of the log's copy settles once the client's copy is read: give it the turn.
    await Bun.sleep(20);
    const warns = logs.filter((line) => line.startsWith("WARN"));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toStartWith(
      "WARN claude-sonnet-5-5 answered 400; returned as it is — (gzip body unreadable: ",
    );
  });

  it("straight to Anthropic, only /v1/messages and count_tokens answers are logged", async () => {
    const { handle, logs } = router([
      () => new Response('{"error":{"message":"no such model"}}', { status: 404 }),
      () => new Response('{"error":{"message":"bad count"}}', { status: 400 }),
    ]);
    const models = await handle(clientRequest({ method: "GET", path: "/v1/models/nope" }));
    expect(models.status).toBe(404);
    expect(logs.filter((line) => line.startsWith("WARN"))).toEqual([]);
    await handle(
      clientRequest({
        body: JSON.stringify(message("claude-opus-5-5")),
        path: "/v1/messages/count_tokens",
      }),
    );
    expect(logs.filter((line) => line.startsWith("WARN"))).toEqual([
      'WARN anthropic answered 400 — {"error":{"message":"bad count"}}',
    ]);
  });
});

describe("streaming", () => {
  it("passes each chunk on as it comes: the first is readable before the upstream sends the second", async () => {
    const upstream = gatedStream(["event: a\n\n", "event: b\n\n", "event: c\n\n"]);
    const { handle } = router([() => upstream.response]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("claude-opus-5-5")) }));
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error("no body");
    expect(await readSoon(reader)).toBe("event: a\n\n");
    expect(upstream.sent()).toBe(1);
    upstream.open(1);
    expect(await readSoon(reader)).toBe("event: b\n\n");
    upstream.open(2);
    expect(await readSoon(reader)).toBe("event: c\n\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("OmniRoute's early 200: heartbeat, then an error event → the next target answers", async () => {
    // A third chunk that never comes: the connection is still open when the router gives up on it.
    const early = gatedStream([
      ": keepalive\n\n",
      'event: error\ndata: {"type":"error"}\n\n',
      "event: never\n\n",
    ]);
    early.open(1);
    const { calls, handle } = router([() => early.response, () => new Response("from ollama")]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    expect(await res.text()).toBe("from ollama");
    expect(calls).toHaveLength(2);
    expect(early.state.cancelled).toBe(true);
  });

  it("OmniRoute's early 200: heartbeat, then message_start → streamed from the start, nothing lost", async () => {
    const chunks = [
      ": keepalive\n\n",
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n',
    ];
    const upstream = gatedStream(chunks);
    upstream.open(1);
    const { calls, handle } = router([() => upstream.response]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    // Handed over before the upstream sent its third chunk: nothing waits for the end.
    expect(upstream.sent()).toBe(2);
    expect(res.status).toBe(200);
    upstream.open(2);
    expect(await res.text()).toBe(chunks.join(""));
    expect(calls).toHaveLength(1);
  });

  it("OmniRoute's early 200 with only heartbeats until firstByteMs → the next target answers", async () => {
    const stalled = gatedStream([": keepalive\n\n", "event: message_start\ndata: {}\n\n"]);
    const { calls, handle } = router([() => stalled.response, () => new Response("next")], {
      config: config(50),
    });
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    expect(await res.text()).toBe("next");
    expect(calls).toHaveLength(2);
    expect(stalled.state.cancelled).toBe(true);
  });

  it("a stream that ends before its first event → next target, and the target does not rest", async () => {
    const short = gatedStream([": keepalive\n\n"]);
    const { handle, logs } = router([() => short.response, () => new Response("next")]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    expect(await res.text()).toBe("next");
    expect(logs).toContain(
      "WARN omniroute:glm-5.3-flash failed (the stream ended before its first event); trying the next target",
    );
    const health: unknown = await (
      await handle(clientRequest({ method: "GET", path: "/__anymodel/health" }))
    ).json();
    expect(health).toMatchObject({ cooling: {} });
  });

  it("the client hanging up before the headers: 499, no fallback, no WARN, nothing rests", async () => {
    const client = new AbortController();
    const { calls, handle, logs } = router([
      (call) => {
        const pending = new Promise<Response>((_, reject) => {
          call.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
        client.abort();
        return pending;
      },
      () => new Response("must not be used"),
    ]);
    const res = await handle(
      clientRequest({ body: JSON.stringify(message("anymodel-scout")), signal: client.signal }),
    );
    expect(res.status).toBe(499);
    expect(calls).toHaveLength(1);
    expect(logs.filter((line) => line.startsWith("WARN"))).toEqual([]);
    expect(logs.at(-1)).toBe(
      "2026-10-15T10:00:00.000Z POST /v1/messages anymodel-scout → omniroute:glm-5.3-flash 499 0ms fallbacks=0",
    );
    const health: unknown = await (
      await handle(clientRequest({ method: "GET", path: "/__anymodel/health" }))
    ).json();
    expect(health).toMatchObject({ cooling: {}, fallbacks: 0 });
  });

  it("the client hanging up during the hold: 499, the target being tried logged, nothing rests", async () => {
    const client = new AbortController();
    const { calls, handle, logs } = router([
      (call) => {
        const body = new ReadableStream<Uint8Array>({
          pull() {
            // The router has read the heartbeat and waits for more: hang up now.
            client.abort();
          },
          start(controller) {
            call.signal.addEventListener("abort", () => {
              controller.error(new Error("aborted"));
            });
            controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
      () => new Response("must not be used"),
    ]);
    const res = await handle(
      clientRequest({ body: JSON.stringify(message("anymodel-scout")), signal: client.signal }),
    );
    expect(res.status).toBe(499);
    expect(calls).toHaveLength(1);
    expect(logs.filter((line) => line.startsWith("WARN"))).toEqual([]);
    expect(logs.at(-1)).toBe(
      "2026-10-15T10:00:00.000Z POST /v1/messages anymodel-scout → omniroute:glm-5.3-flash 499 0ms fallbacks=0",
    );
    const health: unknown = await (
      await handle(clientRequest({ method: "GET", path: "/__anymodel/health" }))
    ).json();
    expect(health).toMatchObject({ cooling: {} });
  });

  it("the scanner: comments and ping decide nothing; an error data line is an error", () => {
    const one = sseScanner();
    expect(one.push(": hb\n\nevent: ping\ndata: {}\n\n")).toBeNull();
    expect(one.push("event: message_start\r\ndata: {}\r\n\r\n")).toBe("event");
    const two = sseScanner();
    expect(two.push('data: {"type":"error","error":{}}\n')).toBeNull();
    expect(two.push("\n")).toBe("error");
  });
});

// ─── Cooldown ───────────────────────────────────────────────────────────────────

describe("cooldown", () => {
  it("rests a target for its retry-after, shows it in health, then tries it again", async () => {
    let now = Date.UTC(2026, 9, 15, 10, 0, 0);
    const { calls, handle, logs } = router(
      [
        () => new Response("busy", { headers: { "retry-after": "120" }, status: 429 }),
        () => new Response("ollama 1"),
        () => new Response("ollama 2"),
        () => new Response("omni again"),
      ],
      { now: () => now },
    );
    const scout = () => clientRequest({ body: JSON.stringify(message("anymodel-scout")) });
    expect(await (await handle(scout())).text()).toBe("ollama 1");

    now += 60_000;
    expect(await (await handle(scout())).text()).toBe("ollama 2");
    expect(calls.map((c) => c.url)).toEqual([
      "http://omni.test/v1/messages",
      "https://ollama.test/v1/messages",
      "https://ollama.test/v1/messages",
    ]);
    expect(logs.at(-1)).toBe(
      "2026-10-15T10:01:00.000Z POST /v1/messages anymodel-scout → ollama:deepseek-v4.1-flash 200 0ms fallbacks=0 skipped=1",
    );
    const health: unknown = await (
      await handle(clientRequest({ method: "GET", path: "/__anymodel/health" }))
    ).json();
    expect(health).toMatchObject({ cooling: { "omniroute:glm-5.3-flash": 60 } });

    now += 61_000;
    expect(await (await handle(scout())).text()).toBe("omni again");
    expect(calls.at(-1)?.url).toBe("http://omni.test/v1/messages");
  });

  it("never skips the last target of a slot, even while it rests", async () => {
    let now = Date.UTC(2026, 9, 15, 10, 0, 0);
    const { calls, handle } = router(
      [
        () => new Response("busy", { status: 429 }),
        () => new Response("down", { status: 503 }),
        () => new Response("ollama answers"),
      ],
      { now: () => now },
    );
    const cheap = () => clientRequest({ body: JSON.stringify(message("anymodel-cheap")) });
    expect((await handle(cheap())).status).toBe(503);
    now += 10_000;
    expect(await (await handle(cheap())).text()).toBe("ollama answers");
    expect(calls.map((c) => c.url)).toEqual([
      "http://omni.test/v1/messages",
      "https://ollama.test/v1/messages",
      "https://ollama.test/v1/messages",
    ]);
  });

  it("how long a target rests", () => {
    expect(cooldownSeconds(429, null)).toBe(60);
    expect(cooldownSeconds(429, 5)).toBe(5);
    expect(cooldownSeconds(503, null)).toBe(30);
    expect(cooldownSeconds(529, 100_000)).toBe(600);
    expect(cooldownSeconds(null, null)).toBe(30);
    expect(cooldownSeconds(400, null)).toBeNull();
    expect(cooldownSeconds(401, 30)).toBeNull();
  });
});

// ─── count_tokens, guard, bad input ─────────────────────────────────────────────

describe("count_tokens", () => {
  it("a slot whose first target is a backend → 404 in Anthropic's shape, no upstream call", async () => {
    const { calls, handle } = router([]);
    const res = await handle(
      clientRequest({
        body: JSON.stringify(message("anymodel-scout")),
        path: "/v1/messages/count_tokens?beta=true",
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        message: "count_tokens is not available for anymodel-scout; Claude Code estimates instead",
        type: "not_found_error",
      },
      type: "error",
    });
    expect(calls).toHaveLength(0);
  });

  it("a slot whose first target is Claude → forwarded with the model set", async () => {
    const { calls, handle } = router([() => new Response('{"input_tokens":12}')]);
    const res = await handle(
      clientRequest({
        body: JSON.stringify(message("anymodel-mixed")),
        path: "/v1/messages/count_tokens?beta=true",
      }),
    );
    expect(await res.text()).toBe('{"input_tokens":12}');
    expect(calls[0]?.url).toBe("https://anthropic.test/v1/messages/count_tokens?beta=true");
    expect(JSON.parse(calls[0]?.body ?? "")).toMatchObject({ model: "claude-sonnet-5-5" });
  });
});

describe("local-only guard", () => {
  const cases: [string, Record<string, null | string>][] = [
    ["a foreign Host", { host: `evil.test:${PORT}` }],
    ["the right host on another port", { host: "127.0.0.1:9999" }],
    ["an Origin header (a web page)", { origin: "https://evil.test" }],
    ["a non-JSON content type", { "content-type": "text/plain" }],
    ["no anthropic-version", { "anthropic-version": null }],
  ];
  for (const [name, headers] of cases) {
    it(`refuses ${name} with 403 and calls nothing`, async () => {
      const { calls, handle } = router([() => new Response("must not be called")]);
      const res = await handle(
        clientRequest({ body: JSON.stringify(message("claude-opus-5-5")), headers }),
      );
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });
  }

  it("refuses an Origin on every path, not only /v1/messages", async () => {
    const { calls, handle } = router([]);
    const res = await handle(
      clientRequest({
        headers: { origin: "https://evil.test" },
        method: "GET",
        path: "/v1/models",
      }),
    );
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("accepts localhost:<port>", async () => {
    const { calls, handle } = router([() => new Response("ok")]);
    const res = await handle(
      clientRequest({
        body: JSON.stringify(message("claude-opus-5-5")),
        headers: { host: `localhost:${PORT}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("health answers with counts and slots, and no key", async () => {
    const { handle } = router([() => new Response("ok")]);
    await handle(clientRequest({ body: JSON.stringify(message("claude-opus-5-5")) }));
    const res = await handle(clientRequest({ method: "GET", path: "/__anymodel/health" }));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      cooling: {},
      fallbacks: 0,
      ok: true,
      port: 20100,
      requests: 1,
      slots: {
        "anymodel-cheap": ["omniroute:glm-5.3-flash", "ollama:deepseek-v4.1-flash"],
        "anymodel-mixed": ["claude-sonnet-5-5", "omniroute:glm-5.3-flash"],
        "anymodel-scout": [
          "omniroute:glm-5.3-flash",
          "ollama:deepseek-v4.1-flash",
          "claude-sonnet-5-5",
        ],
        "anymodel-worker": ["claude-sonnet-5-5"],
      },
      uptimeSec: 0,
    });
    expect(text).not.toContain("key-");
  });
});

describe("bad input", () => {
  it("a body that is not JSON → 400 in Anthropic's shape, no upstream call", async () => {
    const { calls, handle } = router([]);
    for (const body of ["{not json", "[1,2]"]) {
      const res = await handle(clientRequest({ body }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { message: "the request body is not a JSON object", type: "invalid_request_error" },
        type: "error",
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("an anymodel-… name that no slot has → 400 naming the config file, no upstream call", async () => {
    const { calls, handle } = router([]);
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-nope")) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        message: `anymodel-router: "anymodel-nope" is not a slot in ${CONFIG_PATH} (slots: anymodel-cheap, anymodel-mixed, anymodel-scout, anymodel-worker)`,
        type: "invalid_request_error",
      },
      type: "error",
    });
    expect(calls).toHaveLength(0);
  });

  it("routes by name: [1m] suffix, unknown backend prefix, claude-*", () => {
    const routeConfig = {
      backends: { omniroute: {} },
      slots: { "anymodel-scout": ["claude-sonnet-5-5"] },
    };
    expect(resolveRoute("anymodel-scout[1m]", routeConfig)).toEqual({
      kind: "slot",
      slot: "anymodel-scout",
      targets: [{ kind: "anthropic", model: "claude-sonnet-5-5" }],
    });
    expect(resolveRoute("nobody:model-x", routeConfig)).toEqual({ kind: "anthropic" });
    expect(resolveRoute("omniroute:model-x", routeConfig)).toEqual({
      kind: "explicit",
      target: { backend: "omniroute", kind: "backend", model: "model-x" },
    });
    expect(resolveRoute("claude-haiku-5-5", routeConfig)).toEqual({ kind: "anthropic" });
    expect(resolveRoute(undefined, routeConfig)).toEqual({ kind: "anthropic" });
  });
});

// ─── Config file ────────────────────────────────────────────────────────────────

describe("config file", () => {
  let dir = "";
  beforeEach(() => {
    dir = tempDir("gateway-config");
  });

  const fileJson = (slots: Record<string, string[]>) =>
    JSON.stringify({
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128/" } },
      slots,
      version: 1,
    });

  function write(path: string, text: string, mtimeSec: number) {
    writeFileSync(path, text, { mode: 0o600 });
    chmodSync(path, 0o600);
    utimesSync(path, mtimeSec, mtimeSec);
  }

  it("fills the defaults and strips a trailing slash", () => {
    const parsed = parseConfig(
      JSON.parse(fileJson({ "anymodel-scout": ["omniroute:glm-5.3-flash"] })),
    );
    expect(parsed).toEqual({
      config: {
        // New since the move: no aliases unless the file names some.
        aliases: {},
        anthropicBaseUrl: "https://api.anthropic.com",
        backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
        port: 20100,
        slots: { "anymodel-scout": ["omniroute:glm-5.3-flash"] },
        timeouts: { firstByteMs: 60000 },
        version: 1,
      },
    });
  });

  it("refuses any anthropicBaseUrl but Anthropic's: the own login may go nowhere else", () => {
    const raw = { backends: {}, slots: {}, version: 1 };
    expect("error" in parseConfig({ ...raw, anthropicBaseUrl: "https://evil.test" })).toBe(true);
    expect(parseConfig({ ...raw, anthropicBaseUrl: "https://api.anthropic.com" })).toMatchObject({
      config: { anthropicBaseUrl: "https://api.anthropic.com" },
    });
  });

  it("rejects a target naming a backend that is not configured, and a slot without targets", () => {
    const unknown = parseConfig(
      JSON.parse(fileJson({ "anymodel-scout": ["ollama:glm-5.3-flash"] })),
    );
    expect("error" in unknown && unknown.error).toContain(
      'names backend "ollama", which is not in backends',
    );
    const empty = parseConfig(JSON.parse(fileJson({ "anymodel-scout": [] })));
    expect("error" in empty).toBe(true);
  });

  it.skipIf(NO_POSIX_MODES)("refuses a file the group or others can read, naming chmod 600", () => {
    const path = join(dir, "gateway.json");
    write(path, fileJson({ "anymodel-scout": ["claude-sonnet-5-5"] }), 1000);
    chmodSync(path, 0o640);
    expect(() => loadConfigFile(path)).toThrow(`Run: chmod 600 ${path}`);
  });

  it.skipIf(NO_POSIX_MODES)(
    "saves with mode 600, atomically (no temp file left), and reads back the same",
    () => {
      const path = join(dir, "sub", "gateway.json");
      const parsed = parseConfig(JSON.parse(fileJson({ "anymodel-scout": ["claude-sonnet-5-5"] })));
      if (!("config" in parsed)) throw new Error(parsed.error);
      saveConfig(path, parsed.config);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readdirSync(join(dir, "sub"))).toEqual(["gateway.json"]);
      expect(loadConfigFile(path)).toEqual(parsed.config);
    },
  );

  it("a bad edit keeps the last good config and logs one error; a good edit takes over", () => {
    const path = join(dir, "gateway.json");
    const logs: string[] = [];
    write(path, fileJson({ "anymodel-scout": ["claude-sonnet-5-5"] }), 1000);
    const source = watchConfig(path, (line) => logs.push(line));
    expect(source.get().slots).toEqual({ "anymodel-scout": ["claude-sonnet-5-5"] });

    write(path, "{ broken", 2000);
    expect(source.get().slots).toEqual({ "anymodel-scout": ["claude-sonnet-5-5"] });
    expect(source.get().slots).toEqual({ "anymodel-scout": ["claude-sonnet-5-5"] });
    expect(logs.filter((line) => line.startsWith("ERROR"))).toHaveLength(1);

    write(path, fileJson({ "anymodel-scout": ["claude-haiku-5-5"] }), 3000);
    expect(source.get().slots).toEqual({ "anymodel-scout": ["claude-haiku-5-5"] });
  });

  it("no file at start: both slots on Claude Sonnet, says so once, and picks the file up later", () => {
    const path = join(dir, "gateway.json");
    const logs: string[] = [];
    const source = watchConfig(path, (line) => logs.push(line));
    expect(source.get().slots).toEqual({
      "anymodel-scout": ["claude-sonnet-5-5"],
      "anymodel-worker": ["claude-sonnet-5-5"],
    });
    expect(source.get().port).toBe(20100);
    expect(source.loaded()).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(
      "every haiku / sonnet call answers on claude-sonnet-5-5 (your own Claude login) until it is fixed",
    );
    write(path, fileJson({ "anymodel-scout": ["claude-sonnet-5-5"] }), 1000);
    expect(source.get().slots).toEqual({ "anymodel-scout": ["claude-sonnet-5-5"] });
    expect(source.loaded()).toBe(true);
  });
});

describe("no config: Claude Code keeps working", () => {
  it("a slot call answers on the own login through Claude Sonnet, not a 400", async () => {
    const { calls, handle } = router([() => new Response("sonnet")], { config: emptyConfig() });
    const res = await handle(clientRequest({ body: JSON.stringify(message("anymodel-scout")) }));
    expect(await res.text()).toBe("sonnet");
    expect(nth(calls, 0).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(JSON.parse(nth(calls, 0).body ?? "")).toMatchObject({ model: "claude-sonnet-5-5" });
  });

  it.skipIf(NO_POSIX_MODES)("a refused file is picked up after chmod 600 alone", () => {
    const dir = tempDir("gateway-chmod");
    {
      const path = join(dir, "gateway.json");
      writeFileSync(
        path,
        JSON.stringify({
          backends: {},
          slots: { "anymodel-scout": ["claude-haiku-5-5"] },
          version: 1,
        }),
      );
      chmodSync(path, 0o644);
      utimesSync(path, 1000, 1000);
      const source = watchConfig(path, () => undefined);
      expect(source.loaded()).toBe(false);
      chmodSync(path, 0o600);
      // Same content, same modification time: only the mode (and change time) moved.
      expect(statSync(path).mtimeMs).toBe(1_000_000);
      expect(source.get().slots).toEqual({ "anymodel-scout": ["claude-haiku-5-5"] });
      expect(source.loaded()).toBe(true);
    }
  });
});

// ─── Aliases: an old model name reaches its new slot ────────────────────────────

describe("aliases", () => {
  function aliased(aliases: Record<string, string>, extra: Partial<GatewayConfig> = {}) {
    return { ...config(), aliases, ...extra };
  }

  it("an old name reaches its slot ([1m] too); the alias is logged once per name", async () => {
    const { calls, handle, logs } = router(
      [() => new Response("{}"), () => new Response("{}"), () => new Response("{}")],
      { config: aliased({ "old-cheap": "anymodel-cheap", "old-other": "anymodel-cheap" }) },
    );
    await handle(clientRequest({ body: JSON.stringify(message("old-cheap[1m]")) }));
    await handle(clientRequest({ body: JSON.stringify(message("old-cheap")) }));
    await handle(clientRequest({ body: JSON.stringify(message("old-other")) }));
    // anymodel-cheap's first target is omniroute:glm-5.3-flash.
    expect(calls.map((call) => call.url)).toEqual([
      "http://omni.test/v1/messages",
      "http://omni.test/v1/messages",
      "http://omni.test/v1/messages",
    ]);
    expect(JSON.parse(nth(calls, 0).body ?? "")).toEqual(cheapBodyFor("glm-5.3-flash"));
    expectNoLogin(nth(calls, 0));
    expect(logs.filter((line) => line.startsWith("alias "))).toEqual([
      "alias old-cheap → anymodel-cheap (from the config's aliases; logged once per name)",
      "alias old-other → anymodel-cheap (from the config's aliases; logged once per name)",
    ]);
  });

  it("an alias to a claude-… target: Anthropic gets the body with only the model changed", async () => {
    const { calls, handle } = router([() => new Response("{}")], {
      config: aliased({ "old-model": "claude-sonnet-5-5" }),
    });
    const body = message("old-model");
    await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(nth(calls, 0).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(nth(calls, 0).body).toBe(JSON.stringify({ ...body, model: "claude-sonnet-5-5" }));
    expect(nth(calls, 0).headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
  });

  it("an alias to a claude-… target: a request that is not the check gets the fields that model refuses translated", async () => {
    const { calls, handle, logs } = router([() => new Response("{}"), () => new Response("{}")], {
      config: aliased({ "old-model": "claude-sonnet-5-5" }),
    });
    // Built by Claude Code for a name it does not know: it may carry `thinking: disabled`.
    const body = { ...message("old-model"), thinking: { type: "disabled" } };
    await handle(clientRequest({ body: JSON.stringify(body) }));
    expect(nth(calls, 0).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(nth(calls, 0).body).toBe(
      JSON.stringify({ ...body, model: "claude-sonnet-5-5", thinking: { type: "between_tools" } }),
    );
    expect(nth(calls, 0).headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
    expect(logs).toContain(
      "translated for claude-sonnet-5-5: thinking disabled -> between_tools (requestForClaudeFallback; logged once per kind)",
    );
    // count_tokens too: a forced tool_choice is refused there as well.
    const counted = {
      messages: message("old-model").messages,
      model: "old-model",
      thinking: { type: "disabled" },
      tool_choice: { type: "any" },
    };
    await handle(
      clientRequest({ body: JSON.stringify(counted), path: "/v1/messages/count_tokens" }),
    );
    expect(nth(calls, 1).url).toBe("https://anthropic.test/v1/messages/count_tokens");
    expect(nth(calls, 1).body).toBe(
      JSON.stringify({
        ...counted,
        model: "claude-sonnet-5-5",
        thinking: { type: "between_tools" },
        tool_choice: { type: "auto" },
      }),
    );
  });

  it("an alias to a claude-… target: the safety check under it changes only the model", async () => {
    const { calls, handle, logs } = router([() => new Response("{}")], {
      config: aliased({ "old-model": "claude-sonnet-5-5" }),
    });
    const check = {
      max_tokens: 64,
      messages: [{ content: "<transcript>git push --force</transcript>", role: "user" }],
      model: "old-model",
      system: "You are a security monitor for autonomous AI coding agents.",
      thinking: { type: "disabled" },
    };
    await handle(clientRequest({ body: JSON.stringify(check) }));
    expect(nth(calls, 0).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(nth(calls, 0).body).toBe(JSON.stringify({ ...check, model: "claude-sonnet-5-5" }));
    expect(logs.filter((line) => line.startsWith("translated for "))).toEqual([]);
  });

  it("an alias to <backend>:<model> goes to that backend alone, without the login", async () => {
    const { calls, handle } = router([() => new Response("{}")], {
      config: aliased({ "old-model": "ollama:deepseek-v4.1-flash" }),
    });
    await handle(clientRequest({ body: JSON.stringify(message("old-model")) }));
    expect(calls.map((call) => call.url)).toEqual(["https://ollama.test/v1/messages"]);
    expect(JSON.parse(nth(calls, 0).body ?? "")).toEqual(cheapBodyFor("deepseek-v4.1-flash"));
    expectNoLogin(nth(calls, 0));
  });

  it("the safety check under an old name is still the safety check: the judge takes it", async () => {
    const judged = aliased(
      { "old-worker": "anymodel-worker" },
      { slots: { ...config().slots, "anymodel-judge": ["ollama:deepseek-v4.1-flash"] } },
    );
    const { calls, handle, logs } = router([() => new Response("{}")], { config: judged });
    const check = {
      max_tokens: 2112,
      messages: [{ content: "<transcript>rm -rf build</transcript>", role: "user" }],
      model: "old-worker[1m]",
      system: "You are a security monitor for autonomous AI coding agents.",
    };
    await handle(clientRequest({ body: JSON.stringify(check) }));
    expect(calls.map((call) => call.url)).toEqual(["https://ollama.test/v1/messages"]);
    expect(logs.at(-1)).toBe(
      "2026-10-15T10:00:00.000Z POST /v1/messages old-worker[1m] (safety check) [judge] → ollama:deepseek-v4.1-flash 200 0ms fallbacks=0",
    );
  });

  /** Auto mode's safety check, newer form, under `model`. */
  function aliasedCheck(model: string): Record<string, unknown> {
    return {
      max_tokens: 2112,
      messages: [{ content: "<transcript>git push --force</transcript>", role: "user" }],
      metadata: { user_id: `user_acct-42_${TOKEN}` },
      model,
      system: "You are a security monitor for autonomous AI coding agents.",
    };
  }

  it("judge off: a check under an alias to <backend>:<model> never reaches it; Anthropic gets the bytes as sent", async () => {
    const { calls, handle, logs } = router([() => new Response("{}")], {
      config: aliased({ "old-worker": "omniroute:glm-5.3-flash" }),
    });
    const sent = JSON.stringify(aliasedCheck("old-worker[1m]"));
    await handle(clientRequest({ body: sent }));
    expect(calls.map((call) => call.url)).toEqual(["https://anthropic.test/v1/messages?beta=true"]);
    expect(nth(calls, 0).body).toBe(sent);
    expect(nth(calls, 0).headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
    expect(logs.at(-1)).toBe(
      "2026-10-15T10:00:00.000Z POST /v1/messages old-worker[1m] (safety check) → anthropic 200 0ms fallbacks=0",
    );
  });

  it("an old name in the aliases is a name the check can carry; without the alias it is not", () => {
    const check = aliasedCheck("old-worker[1m]");
    expect(isAutoModeGuard(check, { "old-worker": "omniroute:glm-5.3-flash" })).toBe(true);
    expect(isAutoModeGuard(check)).toBe(false);
    expect(isAutoModeGuard(check, { "other-name": "anymodel-worker" })).toBe(false);
  });

  it("judge on: the same check goes to the judge", async () => {
    const judged = aliased(
      { "old-worker": "omniroute:glm-5.3-flash" },
      { slots: { ...config().slots, "anymodel-judge": ["ollama:deepseek-v4.1-flash"] } },
    );
    const { calls, handle } = router([() => new Response("{}")], { config: judged });
    await handle(clientRequest({ body: JSON.stringify(aliasedCheck("old-worker[1m]")) }));
    expect(calls.map((call) => call.url)).toEqual(["https://ollama.test/v1/messages"]);
    expectNoLogin(nth(calls, 0));
  });

  it("a request under that alias that is not the check still goes to the backend", async () => {
    const { calls, handle } = router([() => new Response("{}")], {
      config: aliased({ "old-worker": "omniroute:glm-5.3-flash" }),
    });
    await handle(clientRequest({ body: JSON.stringify(message("old-worker[1m]")) }));
    expect(calls.map((call) => call.url)).toEqual(["http://omni.test/v1/messages"]);
    expect(JSON.parse(nth(calls, 0).body ?? "")).toEqual(cheapBodyFor("glm-5.3-flash"));
    expectNoLogin(nth(calls, 0));
  });

  it("judge off: a check under an alias to a slot with no Claude target goes to Anthropic as sent", async () => {
    // config()'s anymodel-cheap: GLM and DeepSeek only.
    const { calls, handle } = router([() => new Response("not found", { status: 404 })], {
      config: aliased({ "old-cheap": "anymodel-cheap" }),
    });
    const sent = JSON.stringify(aliasedCheck("old-cheap"));
    const res = await handle(clientRequest({ body: sent }));
    expect(res.status).toBe(404);
    expect(calls.map((call) => call.url)).toEqual(["https://anthropic.test/v1/messages?beta=true"]);
    expect(nth(calls, 0).body).toBe(sent);
  });

  it("judge off: a check under an alias to a slot with a Claude target, or to claude-…, reaches Claude with only the model changed", async () => {
    const { calls, handle } = router([() => new Response("{}"), () => new Response("{}")], {
      config: aliased({ "old-model": "claude-opus-5-5", "old-scout": "anymodel-scout" }),
    });
    const scout = aliasedCheck("old-scout[1m]");
    await handle(clientRequest({ body: JSON.stringify(scout) }));
    const model = aliasedCheck("old-model");
    await handle(clientRequest({ body: JSON.stringify(model) }));
    // config()'s anymodel-scout: GLM, DeepSeek, then Claude Sonnet 5.5: only the last.
    expect(calls.map((call) => call.url)).toEqual([
      "https://anthropic.test/v1/messages?beta=true",
      "https://anthropic.test/v1/messages?beta=true",
    ]);
    expect(nth(calls, 0).body).toBe(JSON.stringify({ ...scout, model: "claude-sonnet-5-5" }));
    expect(nth(calls, 1).body).toBe(JSON.stringify({ ...model, model: "claude-opus-5-5" }));
  });

  it("a name with no alias is not touched: claude-* and unknown names go to Anthropic as they came", async () => {
    const { calls, handle, logs } = router([() => new Response("{}"), () => new Response("{}")], {
      config: aliased({ "old-cheap": "anymodel-cheap" }),
    });
    const claude = JSON.stringify(message("claude-opus-5-5"));
    const unknown = JSON.stringify(message("old-cheapish"));
    await handle(clientRequest({ body: claude }));
    await handle(clientRequest({ body: unknown }));
    expect(calls.map((call) => call.body)).toEqual([claude, unknown]);
    expect(logs.filter((line) => line.startsWith("alias "))).toEqual([]);
  });

  it("an alias to an alias is an error at load: no chain, no loop", () => {
    const base = { backends: {}, slots: { "anymodel-scout": ["claude-sonnet-5-5"] }, version: 1 };
    const loop = parseConfig({ ...base, aliases: { a: "b", b: "a" } });
    expect("error" in loop && loop.error).toContain(
      'alias "a" points at "b", which is an alias too; point it at a slot or a model',
    );
    expect("error" in loop && loop.error).toContain(
      'alias "b" points at "a", which is an alias too; point it at a slot or a model',
    );
    const self = parseConfig({ ...base, aliases: { a: "a" } });
    expect("error" in self && self.error).toContain(
      'alias "a" points at "a", which is an alias too',
    );
    const chain = parseConfig({ ...base, aliases: { a: "b", b: "anymodel-scout" } });
    expect("error" in chain && chain.error).toContain(
      'alias "a" points at "b", which is an alias too',
    );
    // An alias whose name is also a valid target: only the alias-to-alias rule sees it.
    const shaped = parseConfig({
      ...base,
      aliases: { a: "omniroute:m1", "omniroute:m1": "anymodel-scout" },
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
    });
    expect("error" in shaped && shaped.error).toBe(
      '✖ alias "a" points at "omniroute:m1", which is an alias too; point it at a slot or a model\n  → at aliases.a',
    );
    expect(parseConfig({ ...base, aliases: { a: "anymodel-scout", b: "anymodel-scout" } })).toEqual(
      {
        config: {
          aliases: { a: "anymodel-scout", b: "anymodel-scout" },
          anthropicBaseUrl: "https://api.anthropic.com",
          backends: {},
          port: 20100,
          slots: { "anymodel-scout": ["claude-sonnet-5-5"] },
          timeouts: { firstByteMs: 60000 },
          version: 1,
        },
      },
    );
  });

  it("an alias must name a configured slot or a usable target, and may not shadow a slot or a claude-… name", () => {
    const base = {
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
      slots: { "anymodel-scout": ["claude-sonnet-5-5"] },
      version: 1,
    };
    const error = (aliases: Record<string, string>) => {
      const parsed = parseConfig({ ...base, aliases });
      return "error" in parsed ? parsed.error : "no error";
    };
    expect(error({ old: "anymodel-worker" })).toContain(
      'alias "old" points at slot "anymodel-worker", which is not in slots',
    );
    expect(error({ old: "ollama:glm-5.3-flash" })).toContain(
      'alias "old" names backend "ollama", which is not in backends',
    );
    expect(error({ old: "nonsense" })).toContain(
      'alias "old": "nonsense" is neither claude-<id> nor <backend>:<model>',
    );
    expect(error({ "anymodel-scout": "claude-haiku-5-5" })).toContain(
      'alias "anymodel-scout" has the name of a slot; a slot cannot be an alias too',
    );
    expect(error({ "claude-sonnet-5": "anymodel-scout" })).toContain(
      'alias "claude-sonnet-5": a claude-… name cannot be an alias',
    );
    expect(error({ "old[1m]": "anymodel-scout" })).toContain(
      'alias "old[1m]": write it without [1m]; the router looks names up without it',
    );
    expect(error({ old: "omniroute:glm-5.3-flash", older: "claude-haiku-5-5" })).toBe("no error");
  });

  it("the plugin ships no aliases: a config without the field has none", () => {
    expect(emptyConfig().aliases).toEqual({});
    const parsed = parseConfig({ backends: {}, slots: {}, version: 1 });
    expect("config" in parsed && parsed.config.aliases).toEqual({});
  });
});

// ─── No prompt text is ever changed ─────────────────────────────────────────────

describe("prompts stay as Claude Code wrote them", () => {
  /** Every kind of prompt text: system blocks, user and assistant text, a tool result. */
  function promptBody(model: string): Record<string, unknown> {
    return {
      max_tokens: 4096,
      messages: [
        { content: "Fix the bug in parser.ts.  Keep   the spacing.", role: "user" },
        {
          content: [
            { text: "Reading the file first.", type: "text" },
            { id: "toolu_1", input: { path: "parser.ts" }, name: "Read", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [
            { content: "export function parse() {}", tool_use_id: "toolu_1", type: "tool_result" },
            { text: "Now fix it.", type: "text" },
          ],
          role: "user",
        },
      ],
      model,
      stream: true,
      system: [
        { text: "x-anthropic-billing-header: cc_version=2.1.299", type: "text" },
        {
          cache_control: { type: "ephemeral" },
          text: "You are Claude Code.\n\n# Rules",
          type: "text",
        },
      ],
      thinking: { type: "disabled" },
      tools: [{ input_schema: { type: "object" }, name: "Read" }],
    };
  }

  it("a claude-* request reaches Anthropic as the same bytes with the same headers", async () => {
    const { calls, handle } = router([() => new Response("{}")]);
    const sent = JSON.stringify(promptBody("claude-opus-5-5"));
    await handle(clientRequest({ body: sent }));
    expect(nth(calls, 0).body).toBe(sent);
    expect(nth(calls, 0).headers).toEqual([
      ["accept", "application/json"],
      ["accept-encoding", "gzip, br"],
      ["anthropic-beta", "oauth-2025-04-20,interleaved-thinking-2025-05-14"],
      ["anthropic-version", "2023-06-01"],
      ["authorization", `Bearer ${TOKEN}`],
      ["content-type", "application/json"],
      ["cookie", `sessionKey=${TOKEN}`],
      ["user-agent", "claude-cli/2.1.299 (external, cli)"],
      ["x-api-key", TOKEN],
      ["x-claude-code-session-id", "sess-1"],
      ["x-stainless-retry-count", "0"],
    ]);
  });

  it("with the judge off (the default), a safety check reaches Anthropic unchanged", async () => {
    const check = {
      max_tokens: 64,
      messages: [{ content: "<transcript>git push --force</transcript>", role: "user" }],
      model: "claude-sonnet-5",
      system: [
        { text: "You are a security monitor for autonomous AI coding agents.", type: "text" },
      ],
      thinking: { type: "disabled" },
    };
    // config() has no judge slot, like a new config.
    const { calls, handle } = router([() => new Response("{}"), () => new Response("{}")]);
    const older = JSON.stringify(check);
    await handle(clientRequest({ body: older }));
    expect(nth(calls, 0).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(nth(calls, 0).body).toBe(older);
    expect(nth(calls, 0).headers).toContainEqual(["authorization", `Bearer ${TOKEN}`]);
    expect(nth(calls, 0).headers).toContainEqual([
      "anthropic-beta",
      "oauth-2025-04-20,interleaved-thinking-2025-05-14",
    ]);
    // The newer form, under the worker slot's name: Anthropic does not know the slot name,
    // so `model` becomes the slot's Claude target; every other byte stays.
    const newer = {
      max_tokens: 2112,
      messages: check.messages,
      model: "anymodel-worker",
      system: check.system,
    };
    await handle(clientRequest({ body: JSON.stringify(newer) }));
    expect(nth(calls, 1).url).toBe("https://anthropic.test/v1/messages?beta=true");
    expect(nth(calls, 1).body).toBe(JSON.stringify({ ...newer, model: "claude-sonnet-5-5" }));
  });

  it("a cheap backend gets the system prompt and every message's text exactly as sent", async () => {
    const { calls, handle } = router([() => new Response("{}")]);
    const body = promptBody("anymodel-cheap");
    await handle(clientRequest({ body: JSON.stringify(body) }));
    const sent = JSON.parse(nth(calls, 0).body ?? "") as Record<string, unknown>;
    expect(sent.system).toEqual([
      { text: "x-anthropic-billing-header: cc_version=2.1.299", type: "text" },
      {
        cache_control: { type: "ephemeral" },
        text: "You are Claude Code.\n\n# Rules",
        type: "text",
      },
    ]);
    expect(sent.messages).toEqual(body.messages);
    // The only other differences are the named translations: the model, reasoning off.
    expect(sent.model).toBe("glm-5.3-flash");
    expect(sent.output_config).toEqual({ effort: "none" });
  });

  it("the two translations change no prompt text: only the tool_reference block becomes its named text", () => {
    // promptBody, plus what tool search adds: a ToolSearch answer with a tool_reference
    // block, and a deferred tool it names.
    const base = promptBody("anymodel-cheap");
    const searchResult = {
      content: [
        { text: "Found 1 tool.  Spacing kept.", type: "text" },
        { tool_name: "mcp__browser__navigate", type: "tool_reference" },
      ],
      tool_use_id: "toolu_2",
      type: "tool_result",
    };
    const navigate = {
      defer_loading: true,
      description: "Open a page.  As written.",
      input_schema: { type: "object" },
      name: "mcp__browser__navigate",
    };
    const body: Record<string, unknown> = {
      ...base,
      messages: [
        ...(base.messages as unknown[]),
        { content: [searchResult, { text: "Go on.", type: "text" }], role: "user" },
      ],
      tools: [...(base.tools as unknown[]), navigate],
    };
    const translated = reasoningOffForBackend(toolSearchForBackend(body), { absentIsOff: true });

    // Every system block and every message byte-identical, but that one block.
    expect(JSON.stringify(translated.system)).toBe(JSON.stringify(base.system));
    expect(JSON.stringify(translated.messages)).toBe(
      JSON.stringify([
        { content: "Fix the bug in parser.ts.  Keep   the spacing.", role: "user" },
        {
          content: [
            { text: "Reading the file first.", type: "text" },
            { id: "toolu_1", input: { path: "parser.ts" }, name: "Read", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [
            { content: "export function parse() {}", tool_use_id: "toolu_1", type: "tool_result" },
            { text: "Now fix it.", type: "text" },
          ],
          role: "user",
        },
        {
          content: [
            {
              content: [
                { text: "Found 1 tool.  Spacing kept.", type: "text" },
                { text: "Tool loaded: mcp__browser__navigate", type: "text" },
              ],
              tool_use_id: "toolu_2",
              type: "tool_result",
            },
            { text: "Go on.", type: "text" },
          ],
          role: "user",
        },
      ]),
    );
    // The named tool is a plain definition now; its words are as written.
    expect(translated.tools).toEqual([
      { input_schema: { type: "object" }, name: "Read" },
      {
        description: "Open a page.  As written.",
        input_schema: { type: "object" },
        name: "mcp__browser__navigate",
      },
    ]);
    // The input is not changed in place.
    expect(body.tools).toEqual([...(base.tools as unknown[]), navigate]);
  });
});
