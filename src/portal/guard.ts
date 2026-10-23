/**
 * The portal's door. Every request passes these before anything is read or changed.
 *
 * The portal is a web page on the person's own machine that can change every Claude session
 * on it. A browser is a hostile place: any page the person visits can send requests to
 * `127.0.0.1`. So the rules are the strict ones, and they are pure functions here, one home,
 * tested on their own:
 *
 *   1. **`Host` exactly ours.** A page at `evil.example` can point its DNS at 127.0.0.1 and
 *      reach the portal (DNS rebinding); the browser then sends `Host: evil.example`. Only
 *      `127.0.0.1:<port>` and `localhost:<port>` pass, so that page gets a 403.
 *   2. **No foreign `Origin`.** A request that carries an `Origin` header carries it because
 *      a page made it. Only our own two origins pass, on any method. **And no other page's
 *      load:** a browser names where a request comes from in `Sec-Fetch-Site`. Anything but a
 *      navigation must be `same-origin` (our own page) or `none` (the person typed it): a page
 *      on another `127.0.0.1` port is the SAME site, so its `<img>` was served.
 *   3. **A POST carries our CSRF token.** `SameSite` cookies are gone with the session (D9),
 *      so the token that came with a page of ours is the whole rule for a change: it stops
 *      another site's form and a same-site page that is not ours. It is compared in constant
 *      time.
 *
 * There is **no sign-in** (D9): any page load from a browser on this machine is served, so
 * any program and any user account on this machine — a Claude session using `curl` included —
 * can read and change what the portal shows. That is the owner's trade-off, written down in
 * `.claude/rules/portal.md`; the rules above are what still stops another website and DNS
 * rebinding, which is what a browser can be tricked into.
 *
 * A `Content-Security-Policy` with no `unsafe-inline` and no address outside this machine is
 * served with every answer: no script of ours may be inline, no font may come from the
 * internet, and the page may talk to nothing but the portal.
 */

import { timingSafeEqual } from "node:crypto";

/** What `Content-Security-Policy` says, on every answer. */
export const CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "script-src 'self'",
  "style-src 'self'",
].join("; ");

/** The headers every answer carries, whatever it is. */
export function securityHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": CSP,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

/** The host names a request may carry. `localhost` is the same machine, by definition. */
const ALLOWED_HOSTS = ["127.0.0.1", "localhost"];

/**
 * True when a `Host` header is exactly this portal's. The port must match too: a request to
 * another port that reached us means the browser was told a different address.
 */
export function hostAllowed(host: null | string, port: number): boolean {
  if (host === null) return false;
  return ALLOWED_HOSTS.some((name) => host === `${name}:${port}`);
}

/** True when an `Origin` header is one of this portal's two. */
export function originAllowed(origin: null | string, port: number): boolean {
  if (origin === null) return false;
  return ALLOWED_HOSTS.some((name) => origin === `http://${name}:${port}`);
}

/** True when two secrets are the same, compared without leaking where they differ. */
export function secretsMatch(a: null | string, b: null | string): boolean {
  if (a === null || b === null) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The bytes behind a secret: 32 of them, so guessing is out of the question. */
export type Random = (bytes: number) => Buffer;

/** The header a POST carries the page's CSRF token in. */
export const CSRF_HEADER = "x-ccsdk-csrf";

/**
 * The CSRF token made once when the portal starts, and embedded in every page it serves. It
 * lives in this process's memory only: stopping the portal makes every page's copy dead.
 */
export function createCsrf(random: Random): string {
  return random(32).toString("base64url");
}

/** Why a request was refused, in one word. */
export type Refusal = "csrf" | "host" | "origin" | "site";

/** What a browser says about where a request comes from (`Sec-Fetch-Site`, `Sec-Fetch-Mode`). */
export interface FetchMetadata {
  mode: null | string;
  site: null | string;
}

/**
 * True when a browser's own word on where a request comes from lets it in: a navigation (the
 * person followed a link, or opened the printed one), or anything from our own page
 * (`same-origin`) or from no page at all (`none`: typed, a bookmark). A request with no
 * `Sec-Fetch-Site` is not from a browser that sends it (every current one does): the other
 * rules judge it.
 */
export function fetchSiteAllowed(meta: FetchMetadata): boolean {
  if (meta.site === null || meta.mode === "navigate") return true;
  return meta.site === "same-origin" || meta.site === "none";
}

/** What the door says about one request. */
export type Admission = { kind: "admits" } | { kind: "refused"; reason: Refusal };

/**
 * The rules that hold for **every** request, before anything is looked at: the `Host` must be
 * ours (else a page at `evil.example` that points its DNS here reaches the portal), an
 * `Origin`, when there is one, must be ours too, and no other page may load anything of ours
 * (`fetchSiteAllowed`).
 */
export function networkAllowed(
  host: null | string,
  origin: null | string,
  port: number,
  fetchMeta: FetchMetadata,
): null | Refusal {
  if (!hostAllowed(host, port)) return "host";
  if (origin !== null && !originAllowed(origin, port)) return "origin";
  if (!fetchSiteAllowed(fetchMeta)) return "site";
  return null;
}

/**
 * The whole door for one request, in the order the rules are checked. A page load is admitted
 * once the network rules pass: there is no session to hold any more (D9).
 *
 * A POST must carry an `Origin` of ours — a browser always sends one for a POST, same-origin
 * or not, so a POST without one did not come from a page of this portal — **and** the CSRF
 * token that came with a page of ours. Nothing else changes anything.
 */
export function admit(options: {
  csrf: null | string;
  expectedCsrf: string;
  fetchMeta: FetchMetadata;
  host: null | string;
  method: string;
  origin: null | string;
  port: number;
}): Admission {
  const network = networkAllowed(options.host, options.origin, options.port, options.fetchMeta);
  if (network !== null) return { kind: "refused", reason: network };
  if (options.method !== "POST") return { kind: "admits" };
  if (!originAllowed(options.origin, options.port)) {
    return { kind: "refused", reason: "origin" };
  }
  return secretsMatch(options.csrf, options.expectedCsrf)
    ? { kind: "admits" }
    : { kind: "refused", reason: "csrf" };
}
