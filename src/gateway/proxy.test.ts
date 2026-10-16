/**
 * A backend on this machine is reached straight, never through a proxy: the request
 * carries the backend's key, and a proxy from HTTP_PROXY / HTTPS_PROXY / ALL_PROXY would
 * see it. The gateway's two calls that carry a key are tested here: the model list
 * (`listModels`) and the router's forward to an affordable backend: once with every proxy
 * variable set (HTTP_PROXY is the one an `http://` backend meets), once with ALL_PROXY
 * alone (the fallback Bun uses when HTTP_PROXY is unset). `proxy: false` does it, with no
 * NO_PROXY help: Bun 1.4.3 and later (`MIN_BUN`). On Bun 1.4.2 both tests fail.
 *
 * Every server is a fake on a free port of this test (never the live router's 20100).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { EVERY_PROXY, fakeProxy, withProxyEnv } from "../testing/proxy-env";
import { listModels } from "./backends";
import type { GatewayConfig } from "./config";
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
      return Response.json({
        content: [{ text: "hello", type: "text" }],
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
});
