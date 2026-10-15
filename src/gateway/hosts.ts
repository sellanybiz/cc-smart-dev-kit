/**
 * Which machine a URL's host is: this one (loopback), a private network, or the internet.
 * Two uses:
 *
 * - **A key sent to this machine never goes through a proxy** (`directIfLoopback`). Bun's
 *   `fetch` sends a request through HTTP_PROXY / HTTPS_PROXY / ALL_PROXY unless NO_PROXY
 *   lists the host, and the request carries a backend's key: a proxy would see it. A
 *   request to a remote backend, and every request to Anthropic, keep the environment's
 *   proxy settings: a company proxy in front of the internet is normal there.
 * - **`anymodel search --fetch` refuses a local or private address** (`privateHostKind`):
 *   the URL goes to a third-party fetch provider, which cannot reach it, and the name
 *   would leave this machine for nothing.
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

/** What kind of non-public IPv4 address this is, or null for a public one. */
function ipv4Kind([a = 0, b = 0]: number[]): null | string {
  if (a === 127) return "a loopback address";
  if (a === 0) return "an unspecified address";
  if (a === 169 && b === 254) return "a link-local address";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return "a private address";
  }
  return null;
}

/** True when `hostname` (a `URL.hostname`) is this machine: 127.0.0.0/8, ::1, `localhost`. */
export function isLoopbackHost(hostname: string): boolean {
  const host = normalHost(hostname);
  if (host === "localhost") return true;
  const v4 = ipv4Parts(host);
  if (v4 !== null) return v4[0] === 127;
  const v6 = ipv6Groups(host);
  if (v6 === null) return false;
  const mapped = mappedIpv4(v6);
  if (mapped !== null) return mapped[0] === 127;
  return v6.slice(0, 7).every((group) => group === 0) && v6[7] === 1;
}

/**
 * What kind of local or private host `hostname` (a `URL.hostname`) is, in words for a
 * message ("a loopback address"); null for a host on the internet. Local or private:
 * loopback (127.0.0.0/8, ::1, `localhost` and `*.localhost`), unspecified (0.0.0.0/8,
 * ::), link-local (169.254.0.0/16, fe80::/10), private (10.0.0.0/8, 172.16.0.0/12,
 * 192.168.0.0/16, fc00::/7), an IPv4-mapped IPv6 address of any of those, and a private
 * name: one with no dot (`intranet`), or under `.local`, `.internal` or `.home.arpa`.
 */
export function privateHostKind(hostname: string): null | string {
  const host = normalHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return "a loopback name";
  const v4 = ipv4Parts(host);
  if (v4 !== null) return ipv4Kind(v4);
  const v6 = ipv6Groups(host);
  if (v6 !== null) {
    const mapped = mappedIpv4(v6);
    if (mapped !== null) return ipv4Kind(mapped);
    if (isLoopbackHost(host)) return "a loopback address";
    if (v6.every((group) => group === 0)) return "an unspecified address";
    const first = v6[0] ?? 0;
    if ((first & 0xffc0) === 0xfe80) return "a link-local address";
    if ((first & 0xfe00) === 0xfc00) return "a private address";
    return null;
  }
  if (host.startsWith("[")) return null;
  if (!host.includes(".")) return "a private host name";
  if (/\.(local|internal|home\.arpa)$/.test(host)) return "a private host name";
  return null;
}

/**
 * The `fetch` options that send a request to `url` straight, never through a proxy, when
 * its host is this machine (`isLoopbackHost`): `{ proxy: false }`. `{}` for any other
 * host, which keeps the environment's proxy settings.
 *
 * Bun honours `proxy: false` from 1.4.3 on (oven-sh/bun#42692), so anymodel needs that
 * Bun (`MIN_BUN`). An older Bun ignores it and sends the request to HTTP_PROXY.
 */
export function directIfLoopback(url: string): { proxy?: false } {
  const parsed = URL.parse(url);
  if (parsed === null || !isLoopbackHost(parsed.hostname)) return {};
  return { proxy: false };
}
