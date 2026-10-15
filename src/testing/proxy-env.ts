/**
 * A fake HTTP proxy, and the proxy environment variables pointed at it, for the tests
 * that prove a key sent to a backend on this machine never goes through a proxy.
 *
 * Bun's `fetch` reads HTTP_PROXY, HTTPS_PROXY and ALL_PROXY (and NO_PROXY) each time it
 * runs, so a test sets them in this process and puts them back afterwards. Both servers
 * listen on free ports of the test's own, never on the live router's port.
 */

/** The variables a test changes: every name Bun reads for a proxy, in both cases. */
const PROXY_VARIABLES = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

/** A fake proxy on a free port: it counts each request it receives, and answers 502. */
export function fakeProxy(): { requests: string[]; stop(): void; url: string } {
  const requests: string[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req): Response {
      requests.push(`${req.method} ${req.url}`);
      return new Response("the fake proxy answered", { status: 502 });
    },
  });
  return {
    requests,
    stop: () => server.stop(true),
    url: `http://127.0.0.1:${server.port}`,
  };
}

/**
 * Sets one variable, or unsets it by setting it to "" (which `fetch` reads as unset).
 * Never `delete`: Bun 1.4.2's `fetch` does not see a `delete` from `process.env`, and
 * after one it sees no later value of that variable either (measured; the old value
 * stays in effect). So a variable a test unset stays in `process.env` as "".
 */
function setVariable(name: string, value: string | undefined): void {
  process.env[name] = value ?? "";
}

/**
 * Runs `body` with every proxy variable pointing at `proxyUrl` and no NO_PROXY, then puts
 * each variable back as it was (or unsets it), also when `body` throws.
 */
export async function withProxyEnv<T>(proxyUrl: string, body: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const name of PROXY_VARIABLES) saved.set(name, process.env[name]);
  try {
    for (const name of PROXY_VARIABLES) {
      setVariable(name, name.toLowerCase() === "no_proxy" ? undefined : proxyUrl);
    }
    return await body();
  } finally {
    for (const [name, value] of saved) setVariable(name, value);
  }
}
