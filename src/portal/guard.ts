/**
 * The portal's door. Every request passes these before anything is read or changed.
 *
 * The portal is a web page on the person's own machine that can change every Claude session
 * on it. A browser is a hostile place: any page the person visits, and any program on the
 * machine, can send requests to `127.0.0.1`. So the rules are the strict ones, and they are
 * pure functions here, one home, tested on their own:
 *
 *   1. **`Host` exactly ours.** A page at `evil.example` can point its DNS at 127.0.0.1 and
 *      reach the portal (DNS rebinding); the browser then sends `Host: evil.example`. Only
 *      `127.0.0.1:<port>` and `localhost:<port>` pass, so that page gets a 403.
 *   2. **No foreign `Origin`.** A request that carries an `Origin` header carries it because
 *      a page made it. Only our own two origins pass, on any method.
 *   3. **A session cookie, or the one-time token.** Nothing else is served.
 *   4. **A POST carries our CSRF token.** The cookie alone is never enough: `SameSite=Strict`
 *      stops most cross-site sends, and this stops the rest (and a same-site page that is
 *      not ours). The token comes with the page and is compared in constant time.
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

/**
 * The cookie's value in a `Cookie` header, or null. Only the value is taken; everything
 * after the first `;` is another cookie's.
 */
export function cookieValue(header: null | string, name: string): null | string {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() !== name) continue;
    return part.slice(at + 1).trim();
  }
  return null;
}

/** The `Set-Cookie` value that hands the session to the browser. */
export function sessionCookie(name: string, value: string): string {
  // No `Secure`: this is http on 127.0.0.1, and a `Secure` cookie would never be stored.
  // `HttpOnly`: a script on the page cannot read it. `SameSite=Strict`: no other site's
  // request carries it. `Path=/`: the whole portal, and nothing else (there is nothing else
  // on this origin).
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/`;
}

/**
 * The cookie this portal's session lives in, for one port: `ccsdk_portal_20150`. The port is
 * in the name because a cookie carries no port: the browser sends every `127.0.0.1` cookie to
 * every port on `127.0.0.1`. Without it, a second portal on another port overwrote the first
 * one's session (and its own), and neither page could hold a session while the other ran.
 */
export function cookieName(port: number): string {
  return `${COOKIE_BASE}_${port}`;
}

/** The base of the session cookie's name (`cookieName` adds the port). */
export const COOKIE_BASE = "ccsdk_portal";
export const CSRF_HEADER = "x-ccsdk-csrf";

/** Why a request was refused, in one word. */
export type Refusal = "csrf" | "host" | "origin" | "session";

/** What the door says about one request. */
export type Admission =
  /** Serve it: a live session, and — for a POST — the token that came with a page of ours. */
  | { kind: "admits" }
  /**
   * The first load with the one-time token: hand out the session cookie and serve the page.
   * Only a GET may do this, and only with a token that was never used.
   */
  | { kind: "exchange" }
  | { kind: "refused"; reason: Refusal };

/**
 * The two rules that hold for **every** request, before anything is looked at: the `Host`
 * must be ours (else a page at `evil.example` that points its DNS here reaches the portal),
 * and an `Origin`, when there is one, must be ours too.
 */
export function networkAllowed(
  host: null | string,
  origin: null | string,
  port: number,
): null | Refusal {
  if (!hostAllowed(host, port)) return "host";
  if (origin !== null && !originAllowed(origin, port)) return "origin";
  return null;
}

/**
 * The whole door for one request, in the order the rules are checked. `tokenValid` is the
 * caller's answer to "is this a GET whose `?t=` is this portal's unused one-time token?".
 *
 * A POST must carry an `Origin` of ours — a browser always sends one for a POST, same-origin
 * or not, so a POST without one did not come from a page of this portal — **and** the CSRF
 * token that came with a page of ours. The cookie alone never changes anything.
 */
export function admit(options: {
  cookie: null | string;
  csrf: null | string;
  expectedCsrf: null | string;
  host: null | string;
  method: string;
  origin: null | string;
  port: number;
  session: null | string;
  tokenValid: boolean;
}): Admission {
  const network = networkAllowed(options.host, options.origin, options.port);
  if (network !== null) return { kind: "refused", reason: network };
  if (secretsMatch(options.cookie, options.session)) {
    if (options.method !== "POST") return { kind: "admits" };
    if (!originAllowed(options.origin, options.port)) {
      return { kind: "refused", reason: "origin" };
    }
    return secretsMatch(options.csrf, options.expectedCsrf)
      ? { kind: "admits" }
      : { kind: "refused", reason: "csrf" };
  }
  if (options.method === "GET" && options.tokenValid) return { kind: "exchange" };
  return { kind: "refused", reason: "session" };
}
