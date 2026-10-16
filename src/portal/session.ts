/**
 * One run of the portal: its one-time link token, the session it hands out, and the clock
 * that closes it.
 *
 *   - **The link token** is made when the portal starts, printed in the URL, and accepted
 *     once. It is exchanged for the session cookie on the first load; from then on the URL
 *     carries nothing secret.
 *   - **The session cookie** is a second secret, made at the exchange. It lives in the
 *     portal's memory only: stopping the portal kills every session, and nothing is written
 *     to disk.
 *   - **The CSRF token** is a third, handed to the page in a meta tag. A POST must carry it.
 *   - **Idle.** Thirty minutes without a request and the portal stops by itself. A portal
 *     left open on an unlocked screen is a way into every Claude session on the machine, so
 *     it does not stay open by itself.
 *
 * Everything is a value here, and the randomness and the clock come from outside, so a test
 * drives the whole life of a session without waiting for a real one.
 */

/** Thirty minutes: how long the portal lives with nothing asking it anything. */
export const IDLE_MS = 30 * 60_000;

export interface PortalSession {
  /** The cookie's value, once the token was exchanged; null before. */
  cookie: null | string;
  /** The token a POST must carry, handed to every page. */
  csrf: string;
  /** Milliseconds since the epoch of the last request. */
  lastAt: number;
  /** The one-time link token, until it is exchanged; null after. */
  token: null | string;
}

/** The bytes behind a secret: 32 of them, so guessing is out of the question. */
export type Random = (bytes: number) => Buffer;

/** A fresh run: a link token, a CSRF token, and nothing else yet. */
export function createSession(random: Random, nowMs: number): PortalSession {
  return {
    cookie: null,
    csrf: random(32).toString("base64url"),
    lastAt: nowMs,
    token: random(32).toString("base64url"),
  };
}

/**
 * The first load: the one-time token becomes the session cookie. Null when the token is
 * not this portal's, or was already used — a link works once, in one browser.
 */
export function exchangeToken(
  session: PortalSession,
  token: null | string,
  random: Random,
  nowMs: number,
): null | string {
  if (session.token === null || token === null || token !== session.token) return null;
  session.token = null;
  session.cookie = random(32).toString("base64url");
  session.lastAt = nowMs;
  return session.cookie;
}

/** A request happened: the idle clock starts again. */
export function touch(session: PortalSession, nowMs: number): void {
  session.lastAt = nowMs;
}

/** True when nothing has asked the portal anything for `idleMs`. */
export function isIdle(session: PortalSession, nowMs: number, idleMs = IDLE_MS): boolean {
  return nowMs - session.lastAt >= idleMs;
}
