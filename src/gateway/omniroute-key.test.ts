/**
 * OmniRoute's dashboard API, against a fake OmniRoute served by this test on a free port: the
 * key is made in OmniRoute itself when a machine has none, because asking a person to copy one
 * out of the dashboard is the step that went wrong live (2026-10-17 — they pasted a provider
 * key instead, OmniRoute answered 401 to everything, and every affordable subagent fell back to
 * Claude).
 *
 * The shapes pinned here come from the installed OmniRoute's own source, 3.8.51, read
 * 2026-10-17: `src/server/origin/publicOrigin.ts` (a mutation with NO Origin header passes:
 * `if (!origin) return { ok: true }`), the login route (body `{password}`, the `auth_token`
 * cookie, 401 for a wrong password) and `/api/keys` with `createKeySchema` (a name, `noLog`,
 * and the new key in the answer's `key`). No test reaches the real OmniRoute: every server here
 * is a fake on a free port, and the real one runs at 127.0.0.1:20128 on this machine.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import {
  createOmnirouteKey,
  omnirouteKeyName,
  probeOmniroute,
  sessionCookieFrom,
} from "./omniroute-key";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

interface Seen {
  body: unknown;
  cookie: null | string;
  method: string;
  origin: null | string;
  path: string;
}

/** A fake OmniRoute: the login, the key creation, and the model list the check uses. */
function fakeOmniRoute(
  options: {
    /** The dashboard password it takes (default: the one every test sends). */
    password?: string;
    /** What `/api/keys` answers with (default: 201 and a key). */
    keys?: { body: unknown; status: number };
    /** What the login answers instead of 200 + cookie. */
    login?: { body: unknown; status: number };
    /** Leave the `set-cookie` out of a successful login. */
    noCookie?: boolean;
  } = {},
) {
  const seen: Seen[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      let body: unknown = null;
      if (req.method === "POST") body = await req.json().catch(() => null);
      seen.push({
        body,
        cookie: req.headers.get("cookie"),
        method: req.method,
        origin: req.headers.get("origin"),
        path: url.pathname,
      });
      if (url.pathname === "/api/auth/login") {
        if (options.login !== undefined) {
          return Response.json(options.login.body, { status: options.login.status });
        }
        const sent = (body as { password?: unknown } | null)?.password;
        if (sent !== (options.password ?? "the-dashboard-password")) {
          return Response.json({ error: "Invalid password" }, { status: 401 });
        }
        return Response.json(
          { success: true },
          options.noCookie === true
            ? {}
            : {
                headers: { "set-cookie": "auth_token=session-abc; Path=/; HttpOnly; SameSite=Lax" },
              },
        );
      }
      if (url.pathname === "/api/keys") {
        if (options.keys !== undefined) {
          return Response.json(options.keys.body, { status: options.keys.status });
        }
        if (!(req.headers.get("cookie") ?? "").includes("auth_token=session-abc")) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        return Response.json(
          { id: "key-1", key: "omni-key-made-by-fake", name: "made" },
          { status: 201 },
        );
      }
      if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "m1" }] });
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${String(server.port)}`, seen };
}

/** A port nothing listens on: a server bound and stopped, so nothing answers there. */
function closedPort(): number {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = server.port as number;
  server.stop(true);
  return port;
}

describe("createOmnirouteKey", () => {
  test("logs in, then makes the key: no Origin header, and the session cookie", async () => {
    const omni = fakeOmniRoute();
    const made = await createOmnirouteKey({
      baseUrl: omni.baseUrl,
      password: "the-dashboard-password",
    });
    // The name is written here from node's own `hostname()`, never computed by the module.
    expect(made).toEqual({
      key: "omni-key-made-by-fake",
      kind: "created",
      name: `cc-smart-dev-kit-router-${hostname()}`,
    });
    // The two calls, in order, and nothing else.
    expect(omni.seen.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/auth/login",
      "POST /api/keys",
    ]);
    // OmniRoute judges a dashboard mutation by its Origin header: with one it must be
    // OmniRoute's own, or the CSRF token must come along. None is sent, so its CSRF check is
    // skipped for this local call.
    expect(omni.seen[0]?.origin).toBeNull();
    expect(omni.seen[1]?.origin).toBeNull();
    // The login carries the password and no cookie; the create carries the session cookie.
    expect(omni.seen[0]?.body).toEqual({ password: "the-dashboard-password" });
    expect(omni.seen[0]?.cookie).toBeNull();
    expect(omni.seen[1]?.cookie).toBe("auth_token=session-abc");
    // The key's name says which machine it is for, and noLog keeps the router's requests out of
    // OmniRoute's own call log (no prompt text of the person's lands there).
    const body = omni.seen[1]?.body as { name?: unknown; noLog?: unknown };
    expect(body.name).toBe(omnirouteKeyName());
    expect(body.noLog).toBe(true);
  });

  test("the name is the plugin's own, and one line whatever the host name is", () => {
    expect(omnirouteKeyName()).toStartWith("cc-smart-dev-kit-router-");
    expect(omnirouteKeyName("host with spaces")).toBe("cc-smart-dev-kit-router-host with spaces");
    expect(omnirouteKeyName("two\nlines")).toBe("cc-smart-dev-kit-router-two lines");
    expect(omnirouteKeyName("")).toBe("cc-smart-dev-kit-router");
  });

  test("a wrong dashboard password: refused, and no key is made", async () => {
    const omni = fakeOmniRoute({ password: "another-password" });
    expect(
      await createOmnirouteKey({ baseUrl: omni.baseUrl, password: "the-dashboard-password" }),
    ).toEqual({ detail: "OmniRoute rejected that dashboard password", kind: "refused" });
    expect(omni.seen.map((call) => call.path)).toEqual(["/api/auth/login"]);
  });

  test("no OmniRoute at all: no-answer, and the reason is the connection", async () => {
    const made = await createOmnirouteKey({
      baseUrl: `http://127.0.0.1:${String(closedPort())}`,
      password: "the-dashboard-password",
      timeoutMs: 1_000,
    });
    expect(made.kind).toBe("no-answer");
    if (made.kind === "no-answer") expect(made.detail.length).toBeGreaterThan(0);
  });

  test("a login that sets no cookie, and a create that answers no key: each fails clearly", async () => {
    const noCookie = fakeOmniRoute({ noCookie: true });
    expect(
      await createOmnirouteKey({ baseUrl: noCookie.baseUrl, password: "the-dashboard-password" }),
    ).toEqual({ detail: "the OmniRoute login set no auth_token cookie", kind: "failed" });

    const noKey = fakeOmniRoute({ keys: { body: { id: "key-1" }, status: 201 } });
    expect(
      await createOmnirouteKey({ baseUrl: noKey.baseUrl, password: "the-dashboard-password" }),
    ).toEqual({ detail: "the answer to creating the key held no key", kind: "failed" });

    const refusedKeys = fakeOmniRoute({
      keys: { body: { error: "Failed to create key" }, status: 500 },
    });
    const failed = await createOmnirouteKey({
      baseUrl: refusedKeys.baseUrl,
      password: "the-dashboard-password",
    });
    expect(failed.kind).toBe("failed");
    if (failed.kind === "failed")
      expect(failed.detail).toContain("creating the key answered HTTP 500");
  });

  test("OIDC-only, or no password set: OmniRoute's own reason is carried, as one line", async () => {
    const omni = fakeOmniRoute({
      login: {
        body: {
          error: "Password login is disabled when OIDC is active. Please sign in with OIDC.",
        },
        status: 403,
      },
    });
    const made = await createOmnirouteKey({ baseUrl: omni.baseUrl, password: "whatever" });
    expect(made.kind).toBe("failed");
    if (made.kind === "failed") {
      expect(made.detail).toBe(
        "the OmniRoute login answered HTTP 403: Password login is disabled when OIDC is active. Please sign in with OIDC.",
      );
    }
  });

  test("sessionCookieFrom: the cookie out of a set-cookie header, and nothing else", () => {
    expect(sessionCookieFrom("auth_token=abc; Path=/; HttpOnly; SameSite=Lax")).toBe("abc");
    expect(sessionCookieFrom("other=1; auth_token=abc.def-ghi; Path=/")).toBe("abc.def-ghi");
    expect(sessionCookieFrom("other=1; Path=/")).toBeNull();
    expect(sessionCookieFrom("auth_token=; Path=/")).toBeNull();
    expect(sessionCookieFrom(null)).toBeNull();
  });
});

describe("probeOmniroute", () => {
  test("an HTTP answer of any kind means a server is there, and no key is sent", async () => {
    const omni = fakeOmniRoute();
    expect(await probeOmniroute(omni.baseUrl)).toEqual({ kind: "answers" });
    expect(omni.seen[0]?.path).toBe("/v1/models");
    expect(omni.seen[0]?.cookie).toBeNull();
    expect(omni.seen[0]?.origin).toBeNull();
  });

  test("nothing listening: silent, with the reason", async () => {
    const probe = await probeOmniroute(`http://127.0.0.1:${String(closedPort())}`, {
      timeoutMs: 1_000,
    });
    expect(probe.kind).toBe("silent");
    if (probe.kind === "silent") expect(probe.detail.length).toBeGreaterThan(0);
  });
});
