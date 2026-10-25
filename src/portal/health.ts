/**
 * The portal's health answer, and the probe that tells this portal apart from every other
 * program on its port: `cc-smart-dev-kit portal` (starting it when it is not there), the
 * session-start part (the same), `portal status` and `portal stop`, and `doctor`'s portal
 * line.
 *
 * The answer is one small JSON object, served at `GET /healthz` through the same door as
 * every route (Host, Origin, `Sec-Fetch-Site`; no CSRF, because it changes nothing):
 *
 *   { "app": "cc-smart-dev-kit-portal", "ok": true, "pid": 1234, "version": "1.1.0" }
 *
 * The `app` marker is what makes a probe safe: a port held by any other program — even one
 * that answers HTTP — is `other` and is never touched. `pid` is how `portal stop` and a
 * version hand-over end the right process: the one that gave this answer.
 *
 * Every caller takes its `fetch`, clock and sleep from outside, so a test drives each case
 * without a real port.
 */

import { type HealthFetch, isConnectionRefused, loopbackFetch } from "../gateway/health";

/** The portal's own name in its health answer: never another program's. */
export const PORTAL_APP = "cc-smart-dev-kit-portal";

/** Where the answer lives. A person never needs it; the commands and the hook do. */
export const PORTAL_HEALTH_PATH = "/healthz";

/** How long a probe waits for the answer before it calls the port `other`. */
export const PORTAL_PROBE_TIMEOUT_MS = 1_000;

/** How often a start or a stop looks again while it waits. */
export const PORTAL_POLL_MS = 100;

/** How long a start waits for the portal to answer. */
export const PORTAL_START_WAIT_MS = 5_000;

/** How long a stop waits for the port to be free. */
export const PORTAL_STOP_WAIT_MS = 5_000;

/** The body of the health answer. */
export interface PortalHealth {
  app: string;
  ok: true;
  pid: number;
  version: string;
}

/** The answer this portal gives. */
export function healthAnswer(version: string, pid: number): PortalHealth {
  return { app: PORTAL_APP, ok: true, pid, version };
}

/**
 * The portal behind a health answer, or null when the answer is not ours: a URL of ours with
 * another program's answer, or one whose fields are not the right kinds.
 */
export function readHealth(body: unknown): null | { pid: number; version: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.app !== PORTAL_APP || value.ok !== true) return null;
  if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid < 1) return null;
  if (typeof value.version !== "string" || value.version === "") return null;
  return { pid: value.pid, version: value.version };
}

/** Who holds the portal's port. */
export type PortalState =
  /** Our portal answers: the pid serving it, and the version it runs. */
  | { kind: "ours"; pid: number; version: string }
  /** Something answers, and it is not this portal (or it does not answer at all in time). */
  | { kind: "other" }
  /** Nothing listens: the connection was refused. */
  | { kind: "free" };

/** The `fetch`, clock and sleep a probe uses; a test passes fakes. */
export interface PortalProbe {
  fetch: HealthFetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** The real network and clock. */
export function realPortalProbe(): PortalProbe {
  return {
    fetch: loopbackFetch,
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
  };
}

/**
 * Tests only: what the portal probe answers, without touching a port. A test that runs the
 * CLI as its own process sets `free`, `other`, or `ours:<version>:<pid>`, so `doctor`'s portal
 * line is the same on every machine — a developer's running portal never changes it. The
 * same pattern as `CC_SMART_DEV_KIT_TEST_HOST` (`src/machine/host.ts`); unset, the real probe
 * is used.
 */
export const TEST_PORTAL_VAR = "CC_SMART_DEV_KIT_TEST_PORTAL";

/** The state a test named in `TEST_PORTAL_VAR`, or null when it named none. */
export function testPortalState(env: Record<string, string | undefined>): null | PortalState {
  const text = env[TEST_PORTAL_VAR];
  if (text === undefined) return null;
  if (text === "free") return { kind: "free" };
  if (text === "other") return { kind: "other" };
  const ours = /^ours:([^:]+):(\d+)$/.exec(text);
  if (ours === null) return null;
  return { kind: "ours", pid: Number(ours[2]), version: ours[1] ?? "" };
}

/** The address of the health answer on this port. */
export function portalHealthUrl(port: number): string {
  return `http://127.0.0.1:${port}${PORTAL_HEALTH_PATH}`;
}

/**
 * Who holds the port. A connection the system refuses is `free`; any other failure — a
 * timeout, a reset — is `other`, because something is there to fail that way; a successful
 * answer is `ours` only when it carries the portal's own marker.
 */
export async function probePortal(
  port: number,
  probe: PortalProbe,
  timeoutMs = PORTAL_PROBE_TIMEOUT_MS,
): Promise<PortalState> {
  let body: unknown;
  try {
    const response = await probe.fetch(portalHealthUrl(port), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { kind: "other" };
    }
    body = await response.json();
  } catch (error) {
    return isConnectionRefused(error) ? { kind: "free" } : { kind: "other" };
  }
  const ours = readHealth(body);
  return ours === null ? { kind: "other" } : { kind: "ours", ...ours };
}

/**
 * Looks again until the port is what the caller waits for (`ours` after a start, `free`
 * after a stop), or `waitMs` passes; the last answer either way. A short pause between
 * looks keeps a slow start from costing a busy loop.
 */
export async function waitForPortal(
  port: number,
  probe: PortalProbe,
  wanted: "free" | "ours",
  waitMs: number,
): Promise<PortalState> {
  const until = probe.now() + waitMs;
  let state = await probePortal(port, probe);
  while (state.kind !== wanted && probe.now() < until) {
    await probe.sleep(PORTAL_POLL_MS);
    state = await probePortal(port, probe);
  }
  return state;
}
