/**
 * The router's health page and port, asked on this machine: `gateway status`, `gateway on`,
 * `gateway setup` (before it writes anything, and after the restart), `doctor`, and `restore`
 * (until the stopped router lets go of its port).
 *
 * Every caller takes the `fetch` (and, to wait, the clock) from outside, so a test passes
 * fakes and never reaches a real port: a router may be running on the default one.
 */

import { messageOf } from "./config";
import { HEALTH_PATH } from "./router";

/** The part of `fetch` the health checks use. */
export type HealthFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** What `gateway setup` needs to ask the port and wait for the router; a test passes fakes. */
export interface HealthProbe {
  fetch: HealthFetch;
  /** Milliseconds since the epoch. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** The real network and clock. */
export function realProbe(): HealthProbe {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}${HEALTH_PATH}`;
}

/** The router's own health answer, with a short timeout; the reason in words when there is none. */
export async function routerHealth(
  port: number,
  fetchImpl: HealthFetch = (url, init) => fetch(url, init),
): Promise<{ body: unknown } | { error: string }> {
  try {
    const response = await fetchImpl(healthUrl(port), { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) {
      await response.body?.cancel();
      return { error: `HTTP ${response.status}` };
    }
    return { body: await response.json() };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/**
 * True when nothing listens on the port: the connection was refused. Bun's `fetch` says so
 * with `code: "ConnectionRefused"`; Node's with `ECONNREFUSED`.
 */
function isConnectionRefused(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ConnectionRefused" || error.code === "ECONNREFUSED";
}

/**
 * Who holds the port:
 *   - `free`: the connection was refused, nothing listens;
 *   - `ours`: the health page answered 200 with `ok: true`, this router;
 *   - `other`: anything else (another program, an older router, no answer in time).
 */
export async function probeRouterPort(
  port: number,
  fetchImpl: HealthFetch,
  timeoutMs = 2_000,
): Promise<{ state: "free" } | { state: "ours" } | { detail: string; state: "other" }> {
  let response: Response;
  try {
    response = await fetchImpl(healthUrl(port), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isConnectionRefused(error)) return { state: "free" };
    return { detail: messageOf(error), state: "other" };
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return { detail: `HTTP ${response.status}`, state: "other" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // Not JSON: some other program answers on this port.
    return { detail: `not a health answer (${messageOf(error)})`, state: "other" };
  }
  return isJsonObject(body) && body.ok === true
    ? { state: "ours" }
    : { detail: "not this router's health answer", state: "other" };
}

/**
 * Waits while this router still answers on `port`, for up to `waitMs` by the probe's
 * clock. How it ends:
 *   - `free`: nothing listens any more (a connection is refused). A stopping router closes
 *     its port at once and drains the answers in flight after that, so a free port means
 *     it takes no new request;
 *   - `other`: something that is not this router answers there (another program, or no
 *     answer in time): nothing of ours to wait for, so it stops asking;
 *   - `held`: this router still answered when the time ran out.
 */
export async function waitWhileRouterAnswers(
  port: number,
  probe: HealthProbe,
  waitMs: number,
): Promise<{ state: "free" } | { detail: string; state: "other" } | { state: "held" }> {
  const deadline = probe.now() + waitMs;
  for (;;) {
    const result = await probeRouterPort(port, probe.fetch, 1_000);
    if (result.state !== "ours") return result;
    if (probe.now() >= deadline) return { state: "held" };
    await probe.sleep(200);
  }
}

/**
 * Waits until the router answers its health page on `port`, for up to `waitMs` by the
 * probe's clock. True once it does; false when the time ran out first.
 */
export async function waitForRouter(
  port: number,
  probe: HealthProbe,
  waitMs = 5_000,
): Promise<boolean> {
  const deadline = probe.now() + waitMs;
  for (;;) {
    const result = await probeRouterPort(port, probe.fetch, 1_000);
    if (result.state === "ours") return true;
    if (probe.now() >= deadline) return false;
    await probe.sleep(200);
  }
}
