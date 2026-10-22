/**
 * Which machine a URL's host is: this one (loopback) or another.
 *
 * - **A key sent to this machine never goes through a proxy** (`directIfLoopback`). Bun's
 *   `fetch` sends a request through HTTP_PROXY / HTTPS_PROXY / ALL_PROXY unless NO_PROXY
 *   lists the host, and the request carries a backend's key: a proxy would see it. A
 *   request to a remote backend, and every request to Anthropic, keep the environment's
 *   proxy settings: a company proxy in front of the internet is normal there.
 *
 * The host is `URL.hostname` as the WHATWG URL parser writes it: an IPv4 address in four
 * decimal parts (it turns `0x7f.1` and `2130706433` into `127.0.0.1`), an IPv6 address in
 * brackets with lowercase hex groups, a name in lowercase.
 *
 * Imported by the router bundle: nothing here may import the version (`src/build-info`).
 */

/** The four parts of a dotted IPv4 address, or null. */
function ipv4Parts(host: string): null | number[] {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

/** The eight 16-bit groups of a bracketed IPv6 address, or null. */
function ipv6Groups(host: string): null | number[] {
  if (!host.startsWith("[") || !host.endsWith("]")) return null;
  const halves = host.slice(1, -1).split("::");
  if (halves.length > 2) return null;
  const groupsOf = (text: string): null | number[] => {
    if (text === "") return [];
    const parts = text.split(":");
    if (!parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return null;
    return parts.map((part) => Number.parseInt(part, 16));
  };
  const head = groupsOf(halves[0] ?? "");
  const tail = groupsOf(halves[1] ?? "");
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return [...head, ...Array<number>(halves.length === 1 ? 0 : missing).fill(0), ...tail];
}

/** The IPv4 address an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) stands for, or null. */
function mappedIpv4(groups: number[]): null | number[] {
  if (!groups.slice(0, 5).every((group) => group === 0) || groups[5] !== 0xffff) return null;
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

/** The host without the one trailing dot a fully qualified name may carry, in lowercase. */
function normalHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/**
 * True when `hostname` (a `URL.hostname`) is this machine: 127.0.0.0/8, ::1, `localhost`, and
 * any name under `.localhost` (RFC 6761 § 6.3 keeps those names on the loopback address; on a
 * machine whose resolver does not, the request fails here instead of reaching a proxy).
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = normalHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = ipv4Parts(host);
  if (v4 !== null) return v4[0] === 127;
  const v6 = ipv6Groups(host);
  if (v6 === null) return false;
  const mapped = mappedIpv4(v6);
  if (mapped !== null) return mapped[0] === 127;
  return v6.slice(0, 7).every((group) => group === 0) && v6[7] === 1;
}

/**
 * The `fetch` options that send a request to `url` straight, never through a proxy, when
 * its host is this machine (`isLoopbackHost`): `{ proxy: false }`. `{}` for any other
 * host, which keeps the environment's proxy settings.
 *
 * Bun honours `proxy: false` from 1.4.3 on (oven-sh/bun#42692), so cc-smart-dev-kit needs that
 * Bun (`MIN_BUN`). An older Bun ignores it and sends the request to HTTP_PROXY.
 */
export function directIfLoopback(url: string): { proxy?: false } {
  const parsed = URL.parse(url);
  if (parsed === null || !isLoopbackHost(parsed.hostname)) return {};
  return { proxy: false };
}

/** What `backendFetch` adds to every request's options. */
export interface BackendFetchOptions {
  proxy?: false;
  redirect: "manual";
}

/**
 * The one way to send a request that carries a secret to a backend: its key, OmniRoute's
 * dashboard password, or the session cookie that password bought. Two options, always:
 *   - `directIfLoopback(url)`: a backend on this machine is reached straight, never through
 *     a proxy from the environment, which would see the secret;
 *   - `redirect: "manual"`: a redirect is never followed, so the secret never travels to the
 *     address an answer names. The caller sees the 3xx as an answer that is not ok.
 * `fetchImpl` is the caller's own `fetch` (a test passes a fake); it gets both options. A test
 * (`proxy.test.ts` › "backendFetch is the only way") fails on any `fetch` call in `src/` that
 * sends an `authorization` or `x-api-key` header some other way.
 */
export function backendFetch<Init extends RequestInit>(
  url: string,
  init: Init,
  fetchImpl: (url: string, init: Init & BackendFetchOptions) => Promise<Response> = (
    target,
    options,
  ) => fetch(target, options),
): Promise<Response> {
  return fetchImpl(url, { ...init, redirect: "manual", ...directIfLoopback(url) });
}
