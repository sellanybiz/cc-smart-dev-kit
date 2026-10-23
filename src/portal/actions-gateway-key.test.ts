/**
 * The gateway's OmniRoute key from the portal (PK1): `gateway.key.save` (a key the person
 * pastes) and `gateway.key.make` (a key made with OmniRoute's dashboard password). Both run
 * `gateway setup` itself, in the portal's process, with the secret handed over as its stdin —
 * so every rule of setup's key path holds here too: the key is tested before it is saved, a
 * refused key changes nothing, an unanswered check saves only with the person's choice, a key
 * that changes is backed up first, and the password is never stored.
 *
 * A fake OmniRoute on a free port of this test answers the key check and the dashboard; a fake
 * `systemctl` (the runner) and a fake health probe stand in for the router's service, so no test
 * reaches a real router, OmniRoute or systemd.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { saveConfig } from "../gateway/config";
import { backupDir } from "../setup/write";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { tempDir } from "../testing/temp";
import { type ActionContext, portalOmnirouteContext, runAction } from "./actions";
import { testPortalContext } from "./api/test-context";

/** The key in the config before a test: the router's working key. */
const OLD_KEY = "omni_OLD_working_key_9z8y";
/** The key the person pastes, which the fake OmniRoute accepts. */
const GOOD_KEY = "omni_GOOD_pasted_key_7x6w";
/** A key the fake OmniRoute refuses with 401: a provider key pasted in the wrong place. */
const WRONG_KEY = "ollama_WRONG_provider_key_5v4u";
/** OmniRoute's dashboard password, and the key its `/api/keys` makes. */
const PASSWORD = "dashboard-PASSWORD-3t2s";
const MADE_KEY = "omni_MADE_by_dashboard_1r0q";

/**
 * A fake OmniRoute: `/v1/models` accepts GOOD_KEY, MADE_KEY and OLD_KEY and answers 401 to any
 * other; the dashboard's login takes PASSWORD and sets the session cookie; `/api/keys` makes
 * MADE_KEY, and its DELETE is recorded.
 */
function fakeOmniroute(): {
  deleted: string[];
  port: number;
  requests: string[];
  stop: () => void;
} {
  const deleted: string[] = [];
  const requests: string[] = [];
  const accepted = new Set([GOOD_KEY, MADE_KEY, OLD_KEY].map((key) => `Bearer ${key}`));
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/v1/models") {
        if (!accepted.has(request.headers.get("authorization") ?? "")) {
          return new Response("unauthorized", { status: 401 });
        }
        return Response.json({ data: [{ id: "glm-5.3-flash" }] });
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = (await request.json()) as { password?: string };
        if (body.password !== PASSWORD) return new Response("no", { status: 401 });
        return new Response("{}", {
          headers: { "set-cookie": "auth_token=session-1; Path=/; HttpOnly" },
        });
      }
      if (url.pathname === "/api/keys" && request.method === "POST") {
        return Response.json({ id: "key-1", key: MADE_KEY });
      }
      if (url.pathname.startsWith("/api/keys/") && request.method === "DELETE") {
        deleted.push(url.pathname.slice("/api/keys/".length));
        return new Response(null, { status: 204 });
      }
      return new Response("not here", { status: 404 });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  return { deleted, port: server.port ?? 0, requests, stop: () => server.stop(true) };
}

/** A port nothing listens on: OmniRoute is down. */
function closedPort(): number {
  const server = Bun.serve({ fetch: () => new Response(""), hostname: "127.0.0.1", port: 0 });
  const port = server.port ?? 0;
  server.stop(true);
  return port;
}

/** The router's port in every config here: the fake probe answers for it, nothing else does. */
const ROUTER_PORT = 20_197;

/**
 * A portal's action context with a gateway config whose OmniRoute is at `backendPort`, a plugin
 * folder with a router bundle, a fake `systemctl` and a router health page that answers.
 */
function world(options: { backendPort: number; withConfig?: boolean }) {
  const home = tempDir("portal-key-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const plugin = tempDir("portal-key-plugin");
  mkdirSync(join(plugin, "dist"), { recursive: true });
  writeFileSync(join(plugin, "dist", "router.js"), "// the router bundle\n");
  if (options.withConfig !== false) {
    saveConfig(paths.gatewayConfigFile, {
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com",
      backends: {
        omniroute: { apiKey: OLD_KEY, baseUrl: `http://127.0.0.1:${options.backendPort}` },
      },
      port: ROUTER_PORT,
      slots: {},
      timeouts: { firstByteMs: 60_000 },
      version: 1,
    });
  }
  const ctx = testPortalContext(paths, { HOME: home }, () => Date.now(), {
    // The real network, for the fake OmniRoute on this test's own port.
    fetch: (url, init) => fetch(url, init),
    pluginFolder: () => ({ folder: plugin }),
    probe: {
      fetch: async (url) => {
        if (String(url).includes(`:${ROUTER_PORT}/__cc-smart-dev-kit/health`)) {
          return Response.json({ fallbacks: 0, ok: true, port: ROUTER_PORT, requests: 0 });
        }
        throw new Error("ConnectionRefused");
      },
      now: () => Date.now(),
      sleep: async () => undefined,
    },
    runner: (cmd) =>
      cmd[0] === "systemctl" ? { exitCode: 0, output: "" } : { exitCode: 1, output: "" },
    systemd: true,
  });
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow: fakeWorkflow(),
  };
  const configText = (): string => readFileSync(paths.gatewayConfigFile, "utf8");
  const backups = (): string[] => {
    const dir = backupDir(paths.stateDir, paths.gatewayConfigFile);
    return existsSync(dir) ? readdirSync(dir) : [];
  };
  return { action, backups, configText, home, paths };
}

/** Every file under `dir`, read as text: where a stored password would show. */
function everyFileText(dir: string): string {
  if (!existsSync(dir)) return "";
  let text = "";
  for (const name of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, name);
    if (statSync(path).isFile()) text += readFileSync(path, "utf8");
  }
  return text;
}

describe("gateway.key.save: a key the person pastes", () => {
  test("a key OmniRoute accepts is tested, backed up over the old one, and saved at mode 600", async () => {
    const omniroute = fakeOmniroute();
    const w = world({ backendPort: omniroute.port });
    try {
      const result = await runAction(
        "gateway.key.save",
        { confirm: true, key: `  ${GOOD_KEY}\n` },
        w.action,
      );
      expect(result.ok).toBe(true);
      // Tested first: the check is the backend's own model list, with the new key.
      expect(omniroute.requests).toContain("GET /v1/models");
      const saved = JSON.parse(w.configText()) as {
        backends: { omniroute: { apiKey: string } };
      };
      expect(saved.backends.omniroute.apiKey).toBe(GOOD_KEY);
      expect(statSync(w.paths.gatewayConfigFile).mode & 0o777).toBe(0o600);
      // The old key is kept in a backup, and the answer says where.
      expect(w.backups().length).toBe(1);
      const backup = readFileSync(
        join(backupDir(w.paths.stateDir, w.paths.gatewayConfigFile), w.backups()[0] ?? ""),
        "utf8",
      );
      expect(backup).toContain(OLD_KEY);
      const text = result.lines.join("\n");
      expect(text).toContain('set the key of backend "omniroute"');
      expect(text).toContain("the file as it was before the change is in");
      // The key itself is in no line.
      expect(text).not.toContain(GOOD_KEY);
      expect(text).not.toContain(OLD_KEY);
    } finally {
      omniroute.stop();
    }
  });

  test("a key OmniRoute refuses changes nothing, and says which key it wants", async () => {
    const omniroute = fakeOmniroute();
    const w = world({ backendPort: omniroute.port });
    try {
      const before = w.configText();
      const result = await runAction(
        "gateway.key.save",
        { confirm: true, key: WRONG_KEY },
        w.action,
      );
      expect(result.ok).toBe(false);
      const text = result.lines.join("\n");
      expect(text).toContain("omniroute answered HTTP 401 for this key");
      expect(text).toContain("Nothing was saved, and the key in");
      expect(text).toContain('"omniroute" wants an OmniRoute API key');
      expect(text).not.toContain(WRONG_KEY);
      expect(w.configText()).toBe(before);
      expect(w.backups()).toEqual([]);
    } finally {
      omniroute.stop();
    }
  });

  test("an OmniRoute that does not answer: nothing is saved without the choice; with it, the key is saved with a warning", async () => {
    const w = world({ backendPort: closedPort() });
    const before = w.configText();
    const refused = await runAction("gateway.key.save", { confirm: true, key: GOOD_KEY }, w.action);
    expect(refused.ok).toBe(false);
    expect(refused.lines.join("\n")).toContain("could not ask omniroute at");
    expect(refused.lines.join("\n")).toContain("Nothing was saved");
    expect(w.configText()).toBe(before);

    const saved = await runAction(
      "gateway.key.save",
      { confirm: true, key: GOOD_KEY, saveUnchecked: true },
      w.action,
    );
    expect(saved.ok).toBe(true);
    expect(saved.lines.join("\n")).toContain(
      "! the key was saved WITHOUT its backend accepting it",
    );
    expect(saved.lines.join("\n")).not.toContain(GOOD_KEY);
    expect(
      (JSON.parse(w.configText()) as { backends: { omniroute: { apiKey: string } } }).backends
        .omniroute.apiKey,
    ).toBe(GOOD_KEY);
  });

  test("a POST without the page's yes is refused, and OmniRoute is never asked", async () => {
    const omniroute = fakeOmniroute();
    const w = world({ backendPort: omniroute.port });
    try {
      const before = w.configText();
      const result = await runAction("gateway.key.save", { key: GOOD_KEY }, w.action);
      expect(result).toEqual({
        lines: ["Nothing was saved: the page's confirmation did not come with the request."],
        ok: false,
      });
      expect(omniroute.requests).toEqual([]);
      expect(w.configText()).toBe(before);
    } finally {
      omniroute.stop();
    }
  });

  test("an empty field, and a machine with no gateway set up, are refused in words", async () => {
    const omniroute = fakeOmniroute();
    try {
      const w = world({ backendPort: omniroute.port });
      const empty = await runAction("gateway.key.save", { confirm: true, key: "  " }, w.action);
      expect(empty).toEqual({ lines: ["Paste the OmniRoute API key first."], ok: false });

      const bare = world({ backendPort: omniroute.port, withConfig: false });
      const none = await runAction(
        "gateway.key.save",
        { confirm: true, key: GOOD_KEY },
        bare.action,
      );
      expect(none.ok).toBe(false);
      expect(none.lines).toEqual([
        "The gateway is not set up on this machine yet, so there is no key to change: run cc-smart-dev-kit gateway setup in a terminal first.",
      ]);
      expect(existsSync(bare.paths.gatewayConfigFile)).toBe(false);
      expect(omniroute.requests).toEqual([]);
    } finally {
      omniroute.stop();
    }
  });
});

describe("gateway.key.make: a key made with OmniRoute's dashboard password", () => {
  test("makes a key in OmniRoute, tests and saves it, and stores no password", async () => {
    const omniroute = fakeOmniroute();
    const w = world({ backendPort: omniroute.port });
    try {
      const result = await runAction(
        "gateway.key.make",
        { confirm: true, password: PASSWORD },
        w.action,
      );
      expect(result.ok).toBe(true);
      expect(omniroute.requests.slice(0, 3)).toEqual([
        "POST /api/auth/login",
        "POST /api/keys",
        "GET /v1/models",
      ]);
      // The key it made is saved; it was not deleted again.
      expect(
        (JSON.parse(w.configText()) as { backends: { omniroute: { apiKey: string } } }).backends
          .omniroute.apiKey,
      ).toBe(MADE_KEY);
      expect(omniroute.deleted).toEqual([]);
      const text = result.lines.join("\n");
      expect(text).toContain('made the key "cc-smart-dev-kit-router-');
      expect(text).not.toContain(MADE_KEY);
      expect(text).not.toContain(PASSWORD);
      // The password is in no file the kit wrote: not the config, not a backup, not a state file.
      expect(everyFileText(w.home)).not.toContain(PASSWORD);
    } finally {
      omniroute.stop();
    }
  });

  test("a wrong password changes nothing and says what to do", async () => {
    const omniroute = fakeOmniroute();
    const w = world({ backendPort: omniroute.port });
    try {
      const before = w.configText();
      const result = await runAction(
        "gateway.key.make",
        { confirm: true, password: "not-it" },
        w.action,
      );
      expect(result.ok).toBe(false);
      const text = result.lines.join("\n");
      expect(text).toContain("OmniRoute rejected that dashboard password");
      expect(text).toContain("Nothing was saved");
      expect(w.configText()).toBe(before);
      expect(omniroute.requests).toEqual(["POST /api/auth/login"]);
    } finally {
      omniroute.stop();
    }
  });

  test("without the page's yes, or with no password, nothing is asked of OmniRoute", async () => {
    const omniroute = fakeOmniroute();
    const w = world({ backendPort: omniroute.port });
    try {
      const unconfirmed = await runAction("gateway.key.make", { password: PASSWORD }, w.action);
      expect(unconfirmed).toEqual({
        lines: ["Nothing was saved: the page's confirmation did not come with the request."],
        ok: false,
      });
      const empty = await runAction("gateway.key.make", { confirm: true }, w.action);
      expect(empty).toEqual({
        lines: ["Type OmniRoute's dashboard password first."],
        ok: false,
      });
      expect(omniroute.requests).toEqual([]);
    } finally {
      omniroute.stop();
    }
  });
});
