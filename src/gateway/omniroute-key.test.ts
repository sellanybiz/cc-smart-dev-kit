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
    /** What `DELETE /api/keys/<id>` answers instead of 200. */
    deleteStatus?: number;
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
      // `DELETE /api/keys/<id>`: OmniRoute's own removal, the one its dashboard uses. The cookie
      // is required, as for every other dashboard call.
      if (url.pathname.startsWith("/api/keys/") && req.method === "DELETE") {
        if (!(req.headers.get("cookie") ?? "").includes("auth_token=session-abc")) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        if (options.deleteStatus !== undefined) {
          return Response.json({ error: "no" }, { status: options.deleteStatus });
        }
        return Response.json({ ok: true });
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
    // The name is written here from node's own `hostname()`, never computed by the module, and
    // the id and the `discard` come with the key (the caller deletes a key it does not save).
    expect(made).toEqual({
      discard: expect.any(Function),
      id: "key-1",
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

  test("GW hunch 9: a login that answers a redirect is not followed, so the password stays put", async () => {
    const elsewhere: string[] = [];
    const thief: Bun.Server<undefined> = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req): Promise<Response> {
        elsewhere.push(`${req.method} ${await req.text()}`);
        return Response.json({ success: true });
      },
    });
    servers.push(thief);
    const redirecting: Bun.Server<undefined> = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(null, {
          headers: { location: `http://127.0.0.1:${String(thief.port)}/collect` },
          status: 307,
        }),
    });
    servers.push(redirecting);
    const made = await createOmnirouteKey({
      baseUrl: `http://127.0.0.1:${String(redirecting.port)}`,
      password: "the-dashboard-password",
    });
    expect(made).toEqual({ detail: "the OmniRoute login answered HTTP 307", kind: "failed" });
    expect(elsewhere).toEqual([]);
  });

  test("GW-6: OmniRoute's own error words are shown masked and on one line", async () => {
    const omni = fakeOmniRoute({
      login: {
        body: { error: "no session for the-dashboard-password\n\u001b[2Jforged line" },
        status: 500,
      },
    });
    expect(
      await createOmnirouteKey({ baseUrl: omni.baseUrl, password: "the-dashboard-password" }),
    ).toEqual({
      // The escape character is a space: its `[2J` is plain text, and clears no screen.
      detail: "the OmniRoute login answered HTTP 500: no session for ****word [2Jforged line",
      kind: "failed",
    });
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

  test("a no-answer error of several lines is shown as one line, the reason only", async () => {
    // A fetch error's words come from outside: Bun's own message can carry a path and a cause
    // on their own lines, and the callers put the detail inside one sentence.
    const multiLine = new Error(
      "Unable to connect to 127.0.0.1:20128\n\npath: http://127.0.0.1:20128/api/auth/login\r\ncause: ECONNREFUSED",
    );
    const made = await createOmnirouteKey({
      baseUrl: "http://127.0.0.1:20128",
      fetch: async () => {
        throw multiLine;
      },
      password: "the-dashboard-password",
    });
    expect(made).toEqual({
      detail:
        "Unable to connect to 127.0.0.1:20128 path: http://127.0.0.1:20128/api/auth/login cause: ECONNREFUSED",
      kind: "no-answer",
    });
    // The keyless probe's own silent detail is the same kind of text, shown in one line too.
    expect(
      await probeOmniroute("http://127.0.0.1:20128", {
        fetch: async () => {
          throw multiLine;
        },
      }),
    ).toEqual({
      detail:
        "Unable to connect to 127.0.0.1:20128 path: http://127.0.0.1:20128/api/auth/login cause: ECONNREFUSED",
      kind: "silent",
    });
  });

  test("a no-answer when the key is made: one line too, with the session masked", async () => {
    const omni = fakeOmniRoute();
    const made = await createOmnirouteKey({
      baseUrl: omni.baseUrl,
      password: "the-dashboard-password",
      fetch: (url, init) => {
        if (String(url).endsWith("/api/keys")) {
          throw new Error("creating the key failed\ncookie auth_token=session-abc\nsecond line");
        }
        return fetch(url, init as RequestInit);
      },
    });
    expect(made.kind).toBe("no-answer");
    if (made.kind === "no-answer") {
      expect(made.detail).toBe("creating the key failed cookie auth_token=**** second line");
      expect(made.detail).not.toContain("session-abc");
    }
  });

  test("a no-answer longer than 300 characters is cut to one line of 300", async () => {
    const made = await createOmnirouteKey({
      baseUrl: "http://127.0.0.1:20128",
      fetch: async () => {
        throw new Error("a long reason from outside ".repeat(40).trim());
      },
      password: "the-dashboard-password",
    });
    expect(made.kind).toBe("no-answer");
    if (made.kind === "no-answer") {
      expect(made.detail).toHaveLength(300);
      expect(made.detail.startsWith("a long reason from outside a long reason")).toBe(true);
    }
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

  test("a key that is not saved is deleted again, with the session cookie", async () => {
    // A run that saved nothing must not leave an unused key in the person's OmniRoute
    // (premium review, 2026-10-17).
    const omni = fakeOmniRoute();
    const made = await createOmnirouteKey({
      baseUrl: omni.baseUrl,
      password: "the-dashboard-password",
    });
    if (made.kind !== "created") throw new Error("the key was not made");
    expect(await made.discard()).toEqual({ detail: "", ok: true });
    const removed = omni.seen.at(-1);
    expect(removed?.method).toBe("DELETE");
    expect(removed?.path).toBe("/api/keys/key-1");
    expect(removed?.cookie).toBe("auth_token=session-abc");
    expect(removed?.origin).toBeNull();

    // A delete OmniRoute refuses: the reason comes back, so the caller can name the key.
    const refusing = fakeOmniRoute({ deleteStatus: 500 });
    const second = await createOmnirouteKey({
      baseUrl: refusing.baseUrl,
      password: "the-dashboard-password",
    });
    if (second.kind !== "created") throw new Error("the key was not made");
    const refused = await second.discard();
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain("HTTP 500");
  });

  test("an answer with no id: nothing can be deleted, and the caller is told", async () => {
    const omni = fakeOmniRoute({ keys: { body: { key: "omni-key-no-id" }, status: 201 } });
    const made = await createOmnirouteKey({
      baseUrl: omni.baseUrl,
      password: "the-dashboard-password",
    });
    if (made.kind !== "created") throw new Error("the key was not made");
    expect(made.id).toBeNull();
    const gone = await made.discard();
    expect(gone.ok).toBe(false);
    expect(gone.detail).toContain("no id");
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
