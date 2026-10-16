/**
 * The router's OmniRoute API key, made in OmniRoute itself when the machine has none.
 *
 * The router needs a key for the `omniroute` backend, and a person who has just installed
 * OmniRoute has none yet. Asking them to open the dashboard, make a key, copy it and paste it
 * is the step that went wrong live (2026-10-17): they pasted a provider key instead, OmniRoute
 * answered 401 to everything, and every affordable subagent fell back to Claude. So setup can
 * make the key itself, with the one secret only the person has: the OmniRoute DASHBOARD
 * password. It never asks for, and never stores, that password.
 *
 * THE FLOW (three requests to the local OmniRoute, and nothing else):
 *   1. `POST /api/auth/login` with `{"password":"…"}`. It answers with the `auth_token` cookie.
 *   2. `POST /api/keys` with the cookie, `{"name":"cc-smart-dev-kit-router-<hostname>","noLog":true}`,
 *      which answers 201 with the new key in `.key`. `noLog` keeps the router's requests out of
 *      OmniRoute's call log, so no prompt text of the person's lands there. No `allowedConnections`:
 *      that takes connection ids the plugin does not read, and OmniRoute's default is what the
 *      router wants.
 *   3. the caller then tests the key with `checkBackendKey` (the same gate every key goes
 *      through) and saves it.
 *
 * NO `Origin` HEADER, ON PURPOSE. OmniRoute judges a mutation that carries a dashboard session:
 * with an `Origin` it must be one of OmniRoute's own public origins, or the CSRF token from
 * `x-omniroute-csrf` must be sent; a request with NO Origin header passes
 * (`validateBrowserMutationOrigin`, `src/server/origin/publicOrigin.ts`: "if (!origin) return
 * { ok: true }"). This is a local program asking, not a browser, so it sends none.
 *
 * WHERE THESE FACTS COME FROM: the installed OmniRoute's own source, version 3.8.51, read on
 * 2026-10-17 — `src/server/origin/publicOrigin.ts` (the Origin rule),
 * `dist/.build/next/server/app/api/auth/login/route.js` (`loginSchema`, the `auth_token` cookie,
 * 401 for a wrong password, 429 after 5 in 15 minutes), and the `/api/keys` route with
 * `src/shared/validation/schemas/keys.ts` (`createKeySchema`: `name` required, `noLog` optional;
 * the answer carries `key` and `id`, status 201). A project's own migration helper for the same
 * OmniRoute version reads the same way.
 *
 * The key is returned to the caller and never printed, logged or put in a message.
 */

import { hostname } from "node:os";
import { messageOf } from "./config";
import type { HealthFetch } from "./health";
import { directIfLoopback } from "./hosts";
import { oneLine } from "./plain-text";

/** The dashboard paths, as OmniRoute 3.8.51 has them. */
export const LOGIN_PATH = "/api/auth/login";
export const KEYS_PATH = "/api/keys";
/** The OpenAI-compatible model list: the one keyless request the liveness probe makes. */
export const MODELS_PATH = "/v1/models";

/** The name the key gets: one per machine, so a person can tell them apart in the dashboard. */
export const KEY_NAME_PREFIX = "cc-smart-dev-kit-router";

/** The cookie the dashboard session lives in. */
const SESSION_COOKIE = "auth_token";

/** How long one dashboard request may take. */
export const DASHBOARD_TIMEOUT_MS = 10_000;

export function omnirouteKeyName(host: string = hostname()): string {
  // A host name is not a secret, but it is text from outside: one line, and short.
  const clean = oneLine(host, 60);
  return clean === "" ? KEY_NAME_PREFIX : `${KEY_NAME_PREFIX}-${clean}`;
}

export type OmnirouteKeyResult =
  /** A key was made. It is the caller's to test, save and never print. */
  | { key: string; kind: "created"; name: string }
  /** OmniRoute did not answer at all (it is not installed, or not running). */
  | { detail: string; kind: "no-answer" }
  /** It answered and did not take the password. */
  | { detail: string; kind: "refused" }
  /** It answered something else (no password configured, OIDC-only, a failure). */
  | { detail: string; kind: "failed" };

/** How long the "is an OmniRoute there" question may take. */
export const PROBE_TIMEOUT_MS = 2_000;

/**
 * Is an OmniRoute answering at this address? ONE keyless request (`GET /v1/models`): any HTTP
 * answer means a server is there and reads the request, and no answer at all means OmniRoute is
 * not running (or lives somewhere else). No key is sent, so nothing secret leaves the machine.
 *
 * This is the question the installer asks BEFORE it asks a person for their dashboard password:
 * on a machine with no OmniRoute there is nothing to log in to, and the person is told that
 * instead of being asked for a secret that cannot be used.
 */
export async function probeOmniroute(
  baseUrl: string,
  options: { fetch?: HealthFetch; timeoutMs?: number } = {},
): Promise<{ kind: "answers" } | { detail: string; kind: "silent" }> {
  const url = `${baseUrl.replace(/\/+$/, "")}${MODELS_PATH}`;
  const doFetch = options.fetch ?? ((target: string, init: RequestInit) => fetch(target, init));
  try {
    const response = await doFetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
      ...directIfLoopback(url),
    });
    await response.body?.cancel();
    return { kind: "answers" };
  } catch (error) {
    return { detail: messageOf(error), kind: "silent" };
  }
}

/** The `auth_token` cookie out of a `set-cookie` header, or null. */
export function sessionCookieFrom(setCookie: null | string): null | string {
  if (setCookie === null) return null;
  for (const part of setCookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE && value.length > 0) {
      const cookie = value.join("=").trim();
      if (cookie !== "") return cookie;
    }
  }
  return null;
}

/** OmniRoute's own `error` field of an answer, as one safe line (never quotes a secret). */
async function errorOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    const error = body?.error;
    const text = typeof error === "string" ? error : "";
    return text === "" ? "" : oneLine(text, 160);
  } catch {
    return "";
  }
}

/**
 * Makes one OmniRoute API key with the dashboard password. `fetch` is injectable so no test
 * reaches a real OmniRoute; every request carries `directIfLoopback` (a local program is never
 * reached through a proxy from the environment). The password and the session cookie go into no
 * message, no log and no error.
 */
export async function createOmnirouteKey(options: {
  baseUrl: string;
  fetch?: HealthFetch;
  host?: string;
  password: string;
  timeoutMs?: number;
}): Promise<OmnirouteKeyResult> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DASHBOARD_TIMEOUT_MS;
  const loginUrl = `${base}${LOGIN_PATH}`;
  let login: Response;
  try {
    login = await doFetch(loginUrl, {
      body: JSON.stringify({ password: options.password }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      ...directIfLoopback(loginUrl),
    });
  } catch (error) {
    return { detail: messageOf(error), kind: "no-answer" };
  }
  if (login.status === 401) {
    await login.body?.cancel();
    return { detail: "OmniRoute rejected that dashboard password", kind: "refused" };
  }
  if (!login.ok) {
    const said = await errorOf(login);
    return {
      detail: `the OmniRoute login answered HTTP ${login.status}${said === "" ? "" : `: ${said}`}`,
      kind: "failed",
    };
  }
  const session = sessionCookieFrom(login.headers.get("set-cookie"));
  await login.body?.cancel();
  if (session === null) {
    return { detail: "the OmniRoute login set no auth_token cookie", kind: "failed" };
  }

  const name = omnirouteKeyName(options.host);
  const keysUrl = `${base}${KEYS_PATH}`;
  let created: Response;
  try {
    created = await doFetch(keysUrl, {
      body: JSON.stringify({ name, noLog: true }),
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${session}` },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      ...directIfLoopback(keysUrl),
    });
  } catch (error) {
    return { detail: messageOf(error), kind: "no-answer" };
  }
  if (!created.ok) {
    const said = await errorOf(created);
    return {
      detail: `creating the key answered HTTP ${created.status}${said === "" ? "" : `: ${said}`}`,
      kind: "failed",
    };
  }
  let key: unknown;
  try {
    key = ((await created.json()) as { key?: unknown } | null)?.key;
  } catch (error) {
    return {
      detail: `the answer to creating the key was not JSON (${messageOf(error)})`,
      kind: "failed",
    };
  }
  if (typeof key !== "string" || key.trim() === "") {
    return { detail: "the answer to creating the key held no key", kind: "failed" };
  }
  return { key: key.trim(), kind: "created", name };
}
