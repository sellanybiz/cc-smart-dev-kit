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
 * Sets one variable, or removes it. `fetch` sees a `delete` from Bun 1.4.3 on (before,
 * it kept the old value: oven-sh/bun#42692), and anymodel needs that Bun (`MIN_BUN`).
 */
function setVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** The variables that name a proxy, in both cases: all but NO_PROXY. */
export const EVERY_PROXY = PROXY_VARIABLES.filter((name) => name.toLowerCase() !== "no_proxy");

/**
 * Runs `body` with the variables in `names` (default: every one that names a proxy)
 * pointing at `proxyUrl`, and every other proxy variable and NO_PROXY removed. Then puts
 * each variable back as it was, also when `body` throws.
 */
export async function withProxyEnv<T>(
  proxyUrl: string,
  body: () => Promise<T>,
  names: readonly string[] = EVERY_PROXY,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const name of PROXY_VARIABLES) saved.set(name, process.env[name]);
  try {
    for (const name of PROXY_VARIABLES) {
      setVariable(name, names.includes(name) ? proxyUrl : undefined);
    }
    return await body();
  } finally {
    for (const [name, value] of saved) setVariable(name, value);
  }
}
