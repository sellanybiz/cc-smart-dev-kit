/**
 * A backend on this machine is reached straight, never through a proxy: the request
 * carries the backend's key, and a proxy from HTTP_PROXY / HTTPS_PROXY / ALL_PROXY would
 * see it. Every request with a key goes through one helper, `backendFetch`
 * (`src/gateway/hosts.ts`), and the last test here fails on a `fetch` in `src/` that sends a
 * key header any other way: a hand-kept list of callers is how the judge test and
 * claude-mem's check were missed (GW-1, ST-1). The calls that carry a key are tested
 * against a fake proxy: the model list (`listModels`), the router's forward to an affordable
 * backend, the judge test and claude-mem's check, once with every proxy variable set
 * (HTTP_PROXY is the one an `http://` backend meets), once with ALL_PROXY alone (the
 * fallback Bun uses when HTTP_PROXY is unset). `proxy: false` does it, with no NO_PROXY
 * help: Bun 1.4.3 and later (`MIN_BUN`). On Bun 1.4.2 these tests fail.
 *
 * Every server is a fake on a free port of this test (never the live router's 20100).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkAffordableTarget } from "../machine/claude-mem";
import { EVERY_PROXY, fakeProxy, withProxyEnv } from "../testing/proxy-env";
import { listModels } from "./backends";
import type { GatewayConfig } from "./config";
import { testJudgeTarget } from "./judge-test";
import { createRouter } from "./router";

/** The router's own port, as its Host check sees it. No test connects to it. */
const ROUTER_PORT = 20999;
const KEY = "omni_live_SENTINEL_0123456789";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A fake OmniRoute: the model list, and one answer to a message. Records each request. */
function fakeBackend() {
  const calls: { authorization: null | string; path: string }[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req): Response {
      const path = new URL(req.url).pathname;
      calls.push({ authorization: req.headers.get("authorization"), path });
      if (path === "/v1/models") return Response.json({ data: [{ id: "m1" }] });
      if (path === "/v1/chat/completions") return Response.json({ choices: [] });
      // A message, and the judge test's verdict in it.
      return Response.json({
        content: [{ text: "<block>yes</block> a force push", type: "text" }],
        id: "msg_1",
        model: "m1",
        role: "assistant",
        stop_reason: "end_turn",
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}`, calls };
}

/** A proxy that saw no request, after a control fetch proved the variables are in effect. */
async function provenProxy(backendUrl: string) {
  const proxy = fakeProxy();
  servers.push(proxy);
  return {
    proxy,
    /** A plain fetch to the backend goes through the proxy: the setup works. */
    control: async () => {
      await fetch(`${backendUrl}/control`).then((response) => response.text());
      expect(proxy.requests.length).toBe(1);
      proxy.requests.length = 0;
    },
  };
}

describe.each([
  ["every proxy variable", EVERY_PROXY],
  ["ALL_PROXY alone", ["ALL_PROXY"]],
] as const)("a proxy in the environment: %s", (_, names) => {
  it("the model list: straight to a backend on this machine, never through the proxy", async () => {
    const backend = fakeBackend();
    const { control, proxy } = await provenProxy(backend.baseUrl);
    const listed = await withProxyEnv(
      proxy.url,
      async () => {
        await control();
        return listModels(backend.baseUrl, KEY);
      },
      names,
    );
    expect(listed).toEqual({ models: [{ contextLength: null, id: "m1" }], status: 200 });
    expect(proxy.requests).toEqual([]);
    // The control went to the proxy: the backend saw only the model list.
    expect(backend.calls).toEqual([{ authorization: `Bearer ${KEY}`, path: "/v1/models" }]);
  });

  it("the router's forward: straight to a backend on this machine, never through the proxy", async () => {
    const backend = fakeBackend();
    const { control, proxy } = await provenProxy(backend.baseUrl);
    const config: GatewayConfig = {
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com",
      backends: { omniroute: { apiKey: KEY, baseUrl: backend.baseUrl } },
      port: ROUTER_PORT,
      slots: { "cc-smart-dev-kit-scout": ["omniroute:m1"] },
      timeouts: { firstByteMs: 5000 },
      version: 1,
    };
    const logs: string[] = [];
    const handle = createRouter({
      configPath: "/home/user/.config/cc-smart-dev-kit/gateway.json",
      // The real fetch, as `startRouter` passes it: what it does with a proxy is the test.
      fetch: (url, init) => fetch(url, init),
      getConfig: () => config,
      log: (line) => logs.push(line),
      now: () => Date.now(),
      port: ROUTER_PORT,
    });
    const response = await withProxyEnv(
      proxy.url,
      async () => {
        await control();
        return handle(
          new Request(`http://127.0.0.1:${ROUTER_PORT}/v1/messages`, {
            body: JSON.stringify({
              max_tokens: 16,
              messages: [{ content: "hi", role: "user" }],
              model: "cc-smart-dev-kit-scout",
            }),
            headers: {
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
              host: `127.0.0.1:${ROUTER_PORT}`,
            },
            method: "POST",
          }),
        );
      },
      names,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe("msg_1");
    expect(proxy.requests).toEqual([]);
    expect(backend.calls).toEqual([{ authorization: `Bearer ${KEY}`, path: "/v1/messages" }]);
  });

  it("GW-1: the judge test never sends the key through a proxy", async () => {
    const backend = fakeBackend();
    const { control, proxy } = await provenProxy(backend.baseUrl);
    const verdict = await withProxyEnv(
      proxy.url,
      async () => {
        await control();
        return testJudgeTarget(backend.baseUrl, KEY, "m1");
      },
      names,
    );
    expect(verdict).toEqual({ detail: "blocked it", verdict: "block" });
    expect(proxy.requests).toEqual([]);
    expect(backend.calls).toEqual([{ authorization: `Bearer ${KEY}`, path: "/v1/messages" }]);
  });

  it("ST-1: claude-mem's check of its target never sends the key through a proxy", async () => {
    const backend = fakeBackend();
    const { control, proxy } = await provenProxy(backend.baseUrl);
    const problem = await withProxyEnv(
      proxy.url,
      async () => {
        await control();
        return checkAffordableTarget({
          apiKey: KEY,
          backend: "omniroute",
          baseUrl: `${backend.baseUrl}/v1`,
          model: "m1",
        });
      },
      names,
    );
    expect(problem).toBeNull();
    expect(proxy.requests).toEqual([]);
    expect(backend.calls).toEqual([
      { authorization: `Bearer ${KEY}`, path: "/v1/chat/completions" },
    ]);
  });
});

// ─── backendFetch is the only way ──────────────────────────────────────────────

/** The index of the character that closes the bracket at `open`, past strings and templates. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let at = open; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === '"' || char === "'" || char === "`") {
      at = stringEnd(text, at);
      continue;
    }
    const want = pairs[char];
    if (want !== undefined) stack.push(want);
    else if (char === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return at;
    }
  }
  return text.length;
}

/** The index of the quote that ends the string or template literal starting at `start`. */
function stringEnd(text: string, start: number): number {
  const quote = text.charAt(start);
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "\\") at += 1;
    else if (char === quote) return at;
    else if (quote === "`" && char === "$" && text.charAt(at + 1) === "{") {
      at = closing(text, at + 1);
    }
  }
  return text.length;
}

/** A header that carries a key, written as a property (any case, quoted or not), and its value's first character. */
const KEY_HEADER_PROPERTY = /["']?(?:authorization|x-api-key)["']?\s*:\s*(\S)/gi;

/** Words in a `fetch` call's arguments that say it sends a key. */
const KEY_WORDS = /authorization|x-api-key|apiKey|bearer|RequestHeaders/i;

/**
 * Every place in `src/` (tests and test helpers left out) that sends a key header without
 * `backendFetch`, as `<file>: <what>`:
 *   - a key header written as a property, with a value from the program (a template or a
 *     name; a plain string literal, like an MCP registration's `${VAR}` placeholder, holds no
 *     key), anywhere but inside a `backendFetch(` call's arguments;
 *   - a call of a `fetch` (`fetch`, `fetchImpl`, `deps.fetch`, …) whose arguments name a key.
 * Read from Bun's own transpile of each file, which has no comments: a comment that quotes a
 * header is not a request.
 */
function keyFetchesOutsideBackendFetch(): string[] {
  const root = join(import.meta.dir, "..");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const found: string[] = [];
  for (const file of new Bun.Glob("**/*.ts").scanSync(root)) {
    if (file.endsWith(".test.ts") || file.startsWith("testing/")) continue;
    // A macro import (`src/build-info/`) runs at build time; read here, it is a plain import.
    const source = readFileSync(join(root, file), "utf8").replace(
      /\bwith\s*\{\s*type:\s*"macro"\s*\}/g,
      "",
    );
    const code = transpiler.transformSync(source);
    const allowed: [number, number][] = [];
    for (const call of code.matchAll(/\bbackendFetch\s*\(/g)) {
      const open = call.index + call[0].length - 1;
      allowed.push([open, closing(code, open)]);
    }
    for (const header of code.matchAll(KEY_HEADER_PROPERTY)) {
      if (header[1] === '"' || header[1] === "'") continue;
      const at = header.index;
      if (allowed.some(([from, to]) => at > from && at < to)) continue;
      found.push(`${file}: ${header[0].replace(/\s+/g, " ")}`);
    }
    for (const call of code.matchAll(/([\w$.]*fetch[\w$]*)\s*\(/gi)) {
      const name = call[1] ?? "";
      if (/(?:^|\.)backendFetch$/.test(name)) continue;
      if (/\bfunction\s*$/.test(code.slice(Math.max(0, call.index - 12), call.index))) continue;
      const open = call.index + call[0].length - 1;
      const args = code.slice(open, closing(code, open) + 1);
      if (KEY_WORDS.test(args)) found.push(`${file}: ${name}(…) names a key`);
    }
  }
  return found;
}

describe("backendFetch is the only way", () => {
  it("GW-1, ST-1: no fetch in src/ sends an authorization or x-api-key header outside backendFetch", () => {
    expect(keyFetchesOutsideBackendFetch()).toEqual([]);
  });
});
