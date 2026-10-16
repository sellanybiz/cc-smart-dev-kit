/**
 * The portal, running: its door, its pages and its actions.
 *
 * The portal binds a free port of this test's own (`port: 0`) and is driven with `fetch`;
 * the backend it reads is a fake HTTP server on another free port. Never the live router's
 * port (the port guard refuses it), never the person's real `~/.claude`, never a real
 * OmniRoute or registry — the registry is an injected `fetch` that answers from a string.
 *
 * Each security rule is one test, and each was watched failing with its rule broken.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLAUDE_CODE_PROFILE, PLAYWRIGHT_EXTENSION_ID } from "../browser/chrome";
import { realBrowserDoctorDeps } from "../browser/doctor";
import { cliPaths } from "../cli/paths";
import { saveConfig } from "../gateway/config";
import type { Machine } from "../machine/machine";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { git, tempDir } from "../testing/temp";
import { isOlder } from "../update/check";
import { type DoctorSource, portalOmnirouteContext } from "./actions";
import { PORTAL_CSS, PORTAL_JS, THEME_JS } from "./assets";
import type { PortalContext } from "./context";
import { omnirouteRow } from "./facts";
import type { PluginFolder } from "./plugin-folder";
import { startPortal } from "./server";
import { IDLE_MS } from "./session";
import { type ProjectInitAnswers, type WorkflowAdapter, workflowAdapter } from "./workflow-adapter";

/** The key planted in the config: no page may ever hold it. */
const KEY = "omni_PLANTED_SECRET_a1b2";

/**
 * A fake backend, on a free port of this test: `/v1/models` and one tiny chat. `chat` is what
 * the chat answers: "ready" for the model path's check, `<block>yes</block>` for the judge's
 * force-push test (the answer the router reads a judge's verdict from).
 */
function fakeBackend(
  models: string[],
  options: { chat?: string } = {},
): { port: number; stop: () => void; chats: string[] } {
  const chats: string[] = [];
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/models") {
        return Response.json({ data: models.map((id) => ({ context_length: 200_000, id })) });
      }
      const body = (await request.json()) as { model?: string };
      chats.push(body.model ?? "");
      const chat = options.chat ?? "ready";
      // Both answer shapes: `choices` is what `probeModel` reads (the model path's check),
      // `content` is what the judge's force-push test reads (an Anthropic-shaped answer).
      return Response.json({
        choices: [{ message: { content: chat } }],
        content: [{ text: chat, type: "text" }],
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  return {
    chats,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}

/** The repo's `plugin/` folder: what a doctor source needs, and nothing of a real machine. */
function worldPluginFolder(): string {
  return join(import.meta.dir, "..", "..", "plugin");
}

/** A Machine that answers nothing and changes nothing: enough for a doctor source. */
function worldMachine(): Machine {
  return {
    arch: "x64",
    confirm: null,
    exists: () => false,
    fetchText: async () => "",
    macApp: "/Applications/Warp.app",
    osRelease: () => 'NAME="Ubuntu"\n',
    platform: "linux",
    run: (argv) => ({ exitCode: 0, output: `ran ${argv.join(" ")}` }),
    runOnTerminal: () => 0,
    spawnDetached: () => undefined,
    which: () => null,
  };
}

const registry = (): Response =>
  Response.json({
    time: { "3.9.0": new Date(Date.now() - 4 * 86_400_000).toISOString() },
    versions: { "3.9.0": {} },
  });

/** A portal on a free port, with a temp home, a temp project and a fake backend. */
async function open(options: {
  backendPort: number;
  /** A doctor source of this test's own, for the cases a real folder cannot produce. */
  doctor?: DoctorSource;
  idleMs?: number;
  omniroute?: string;
  /** True: a systemd user unit runs that OmniRoute, the way the gateway's setup leaves one. */
  omnirouteUnit?: boolean;
  /** A plugin folder of this test's own, for the "the folder is gone" case. */
  pluginFolder?: () => PluginFolder;
  /** Runs while the router's health page is asked: a test that changes the config mid-request. */
  onProbe?: () => void;
  /**
   * The portal's own folder is a git repo with these files in `.claude/` — the Project card's
   * world. Left out, it is a plain temp folder (no git project), which is what the other
   * pages need.
   */
  projectFiles?: { config?: string; settings?: string };
  /**
   * The platform the portal believes it runs on (`machine.platform`): the Browser card's token
   * paragraph says something different on Windows, where a file has no mode.
   */
  platform?: NodeJS.Platform;
  /**
   * True: a machine with no git on its PATH at all (a Windows box without Git for Windows, a
   * container). The project's own values cannot be read there, and the page says why in words.
   */
  noGit?: boolean;
  /** True where the test's machine has systemd (the router restart needs it). */
  systemd?: boolean;
  /** The workflow module behind the adapter; a fake by default, never a real file or repo. */
  workflow?: WorkflowAdapter;
  withConfig?: boolean;
}) {
  const home = tempDir("portal");
  const cwd = tempDir("portal-project");
  if (options.projectFiles !== undefined) {
    // A repo of this test's own, so `resolveProject` reads a real checkout — and never the
    // repo this test runs from.
    git(cwd, "init", "-q", "-b", "main");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    if (options.projectFiles.config !== undefined) {
      writeFileSync(join(cwd, ".claude", "cc-smart-dev-kit.json"), options.projectFiles.config);
    }
    if (options.projectFiles.settings !== undefined) {
      writeFileSync(join(cwd, ".claude", "settings.json"), options.projectFiles.settings);
    }
  }
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  // The plugin's own folder, as a machine really has it: the repo's `plugin/` here.
  const pluginFolder = join(import.meta.dir, "..", "..", "plugin");
  if (options.omniroute !== undefined) {
    // A global Bun install of OmniRoute, the way one really sits on a machine.
    const folder = join(home, ".bun", "install", "global", "node_modules", "omniroute");
    mkdirSync(join(folder, "bin"), { recursive: true });
    writeFileSync(
      join(folder, "package.json"),
      `${JSON.stringify({ bin: { omniroute: "bin/omniroute.mjs" }, name: "omniroute", version: options.omniroute })}\n`,
    );
    writeFileSync(join(folder, "bin", "omniroute.mjs"), "// the program\n");
    if (options.omnirouteUnit === true) {
      const units = dirname(paths.routerUnitFile);
      mkdirSync(units, { recursive: true });
      writeFileSync(
        join(units, "omniroute.service"),
        `[Service]\nExecStart=/usr/bin/env bun ${join(folder, "bin", "omniroute.mjs")}\n`,
      );
    }
  }
  if (options.withConfig !== false) {
    saveConfig(paths.gatewayConfigFile, {
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com",
      backends: { omniroute: { apiKey: KEY, baseUrl: `http://127.0.0.1:${options.backendPort}` } },
      port: 20_199,
      slots: {
        "cc-smart-dev-kit-scout": ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"],
        "cc-smart-dev-kit-worker": ["omniroute:deepseek-v4.1-flash", "claude-sonnet-5-5"],
      },
      timeouts: { firstByteMs: 60_000 },
      version: 1,
    });
  }
  const machine: Machine = {
    arch: "x64",
    confirm: null,
    // Real existence, under this test's temp home: the browser's card reads Chrome's profile
    // folder and the token file through it, and every path it builds starts at `home`. The
    // Chrome CANDIDATES are system paths — read-only checks, nothing is opened.
    exists: (path) => existsSync(path),
    fetchText: async () => "",
    macApp: "/Applications/Warp.app",
    osRelease: () => 'NAME="Ubuntu"\n',
    platform: options.platform ?? "linux",
    run: (argv) => ({ exitCode: 0, output: `ran ${argv.join(" ")}` }),
    runOnTerminal: () => 0,
    spawnDetached: () => undefined,
    which: () => null,
  };
  const ctx: PortalContext = {
    bunVersion: "1.4.3",
    // A PATH that is not there, so `git` really cannot be found: without a PATH at all the
    // spawner falls back to its own and finds it.
    env: { HOME: home, ...(options.noGit === true ? { PATH: "/nonexistent" } : {}) },
    fetch: async (url, init) => {
      if (String(url).includes("registry.npmjs.org")) return registry();
      // The fake backend on a free port of this test; never the live router's port.
      return fetch(url, init);
    },
    machine,
    now: () => Date.now(),
    openBrowser: () => undefined,
    paths,
    // The plugin's own folder, as the portal resolves it at each action: the real one in this
    // repo, so a router restart and the doctor checks read real files without touching a
    // machine. A test that wants the "folder is gone" case passes its own.
    pluginFolder: options.pluginFolder ?? (() => ({ folder: pluginFolder })),
    probe: {
      // The router's health page: up, so `gateway on` and the header both work.
      fetch: async (url) => {
        options.onProbe?.();
        if (String(url).includes("/__cc-smart-dev-kit/health")) {
          return Response.json({
            fallbacks: 0,
            ok: true,
            port: 20_199,
            requests: 0,
            uptimeSec: 5,
          });
        }
        throw new Error("ConnectionRefused");
      },
      now: () => Date.now(),
      sleep: async () => undefined,
    },
    // A machine with systemd: the fake systemctl answers. Without it, every command is
    // refuted, as it is on a machine that has no such program.
    runner: (cmd) =>
      options.systemd === true && cmd[0] === "systemctl"
        ? { exitCode: 0, output: "" }
        : { exitCode: 1, output: `no ${cmd[0]} here` },
    // No system folders of the host: a real `/usr/lib/node_modules/omniroute` is not this test.
    systemFolders: [],
    systemd: options.systemd === true,
    which: () => null,
  };
  const portal = await startPortal(ctx, {
    cwd,
    doctor:
      options.doctor ??
      (() => ({
        browser: realBrowserDoctorDeps(machine, paths.home),
        bun: { path: process.execPath, version: Bun.version },
        gateway: {
          bundle: join(pluginFolder, "dist", "router.js"),
          machine,
          runner: ctx.runner,
          service: options.systemd === true ? "systemd" : "none",
        },
        live: null,
        local: { cwd, instructionsSource: join(pluginFolder, "instructions") },
        project: null,
      })),
    ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
    port: 0,
    workflow: options.workflow ?? fakeWorkflow(),
  });

  let cookie = "";
  let token = new URL(portal.url).searchParams.get("t") ?? "";
  const call = async (
    path: string,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
      method?: string;
      /** Never send the session cookie: what a browser that never held one sends. */
      noCookie?: boolean;
    } = {},
  ): Promise<{ body: string; headers: Headers; status: number }> => {
    const headers: Record<string, string> = { ...init.headers };
    if (!init.noCookie && cookie !== "" && headers.cookie === undefined) headers.cookie = cookie;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`http://127.0.0.1:${portal.port}${path}`, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers,
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    });
    const set = response.headers.get("set-cookie");
    if (set !== null) cookie = set.split(";")[0] ?? "";
    return { body: await response.text(), headers: response.headers, status: response.status };
  };
  /** The first load: the link's token becomes the session cookie. */
  const enter = async () => call(`/?t=${token}`);
  /** The page's own tokens, read out of the HTML the way the browser script does. */
  const csrfOf = async (): Promise<string> => {
    const page = await call("/");
    return /name="ccsdk-csrf" content="([^"]+)"/.exec(page.body)?.[1] ?? "";
  };
  const post = (action: string, body: unknown, csrf: string) =>
    call(`/api/${action}`, {
      body,
      headers: { origin: `http://127.0.0.1:${portal.port}`, "x-ccsdk-csrf": csrf },
    });
  return {
    call,
    cookieNow: () => cookie,
    csrfOf,
    ctx,
    /** The folder the portal was started in: the project its Project card is about. */
    cwd,
    enter,
    home,
    /** The context the server's actions use for OmniRoute (`portalOmnirouteContext`). */
    omnirouteCtx: () => portalOmnirouteContext(ctx),
    paths,
    portal,
    post,
    setToken: (value: string) => {
      token = value;
    },
    token: () => token,
  };
}

// ── The door ────────────────────────────────────────────────────────────────────

describe("the door", () => {
  test("the one-time link works once, and hands out the session cookie", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const first = await world.enter();
      expect(first.status).toBe(200);
      const set = first.headers.get("set-cookie") ?? "";
      // HttpOnly: a script on the page cannot read it. SameSite=Strict: no other site's
      // request carries it. Path=/: this origin only. Not Secure: this is http on 127.0.0.1,
      // and a Secure cookie would never be stored. The port is in the name, because a cookie
      // has none and the browser sends every 127.0.0.1 cookie to every port on 127.0.0.1.
      expect(set).toContain(`ccsdk_portal_${world.portal.port}=`);
      expect(set).toContain("HttpOnly");
      expect(set).toContain("SameSite=Strict");
      expect(set).toContain("Path=/");
      expect(set).not.toContain("Secure");
      // The token worked once. The same link, opened in a browser that never held the session
      // (a second browser, a shared link), is dead — and says so, on the page that holds no
      // fact about this machine.
      const again = await world.call(`/?t=${world.token()}`, { noCookie: true });
      expect(again.status).toBe(403);
      expect(again.body).toContain("This link has expired.");
      expect(again.body).toContain("cc-smart-dev-kit portal");
      expect(again.body).not.toContain("ccsdk-csrf");
      expect(again.body).not.toContain("Router");
      // And the session the first load handed out still works.
      expect((await world.call("/")).status).toBe(200);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a page with no session is refused, and only the assets are free", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      for (const path of ["/", "/slots", "/health", "/machine", "/settings", "/privacy"]) {
        expect((await world.call(path)).status).toBe(403);
      }
      // The page cannot draw without these, so they need no session — and only these.
      expect((await world.call("/assets/portal.css")).status).toBe(200);
      expect((await world.call("/assets/portal.js")).status).toBe(200);
      expect((await world.call("/assets/theme.js")).status).toBe(200);
      expect((await world.call("/assets/anything.js")).status).toBe(403);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a Host that is not exactly ours is refused: where DNS rebinding stops", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      expect((await world.call("/", { headers: { host: "evil.example" } })).status).toBe(403);
      expect(
        (await world.call("/", { headers: { host: `evil.example:${world.portal.port}` } })).status,
      ).toBe(403);
      // Another port than this portal's is not ours either.
      expect((await world.call("/", { headers: { host: "127.0.0.1:12345" } })).status).toBe(403);
      // `localhost` is this machine, by definition, and passes.
      expect(
        (await world.call("/", { headers: { host: `localhost:${world.portal.port}` } })).status,
      ).toBe(200);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a foreign Origin is refused, on a page and on an action", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      expect((await world.call("/", { headers: { origin: "http://evil.example" } })).status).toBe(
        403,
      );
      const csrf = await world.csrfOf();
      const foreign = await world.call("/api/switch", {
        body: { name: "hold", on: true },
        headers: { origin: "http://evil.example", "x-ccsdk-csrf": csrf },
      });
      expect(foreign.status).toBe(403);
      expect(existsSync(join(world.paths.stateDir, "update-hold"))).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a POST without the token that came with the page is refused, and changes nothing", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const noToken = await world.call("/api/switch", {
        body: { name: "hold", on: true },
        headers: { origin: `http://127.0.0.1:${world.portal.port}` },
      });
      expect(noToken.status).toBe(403);
      const wrongToken = await world.post("switch", { name: "hold", on: true }, "not-the-token");
      expect(wrongToken.status).toBe(403);
      expect(existsSync(join(world.paths.stateDir, "update-hold"))).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a POST with the cookie and the token but no Origin is refused", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      // A browser sends `Origin` on every POST, same-origin or not, so a POST without one did
      // not come from a page of this portal: a command line or another program sent it.
      const response = await world.call("/api/switch", {
        body: { name: "hold", on: true },
        headers: { "x-ccsdk-csrf": csrf },
      });
      expect(response.status).toBe(403);
      expect(existsSync(join(world.paths.stateDir, "update-hold"))).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("an action is a POST: a GET never changes anything", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const response = await world.call("/api/switch");
      expect(response.status).toBe(405);
      expect(response.body).toContain("An action is a POST");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a route that is not ours, with a live session, is the expired page", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const response = await world.call("/nowhere");
      expect(response.status).toBe(404);
      expect(response.body).toContain("This link has expired.");
      expect(response.body).toContain("cc-smart-dev-kit portal");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the five-second reload does not count as activity: the portal still stops", async () => {
    // An open Health tab reloaded itself every five seconds, and every reload was an admitted
    // GET that touched the idle clock — so the portal never stopped while the tab was open.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, idleMs: 200 });
    try {
      await world.enter();
      // The tab keeps reloading itself for well over twice the idle window. The polling runs
      // for as long as the watch below: if a reload counted as activity, `finished` would
      // never resolve while the polls keep coming, and the watch would end on "never".
      const until = Date.now() + 1_200;
      const polling = (async () => {
        while (Date.now() < until) {
          try {
            await world.call("/?auto=1");
          } catch {
            // The portal stopped mid-poll: that is what this test wants to see.
            return;
          }
          await Bun.sleep(30);
        }
      })();
      const outcome = await Promise.race([
        world.portal.finished,
        Bun.sleep(1_300).then(() => "never" as const),
      ]);
      await polling;
      expect(outcome).toBe("idle");
      // And the page's own script asks with the marker, and only while the tab is visible.
      expect(PORTAL_JS).toContain('location.pathname + "?auto=1"');
      expect(PORTAL_JS).toContain("document.hidden");
      expect(PORTAL_JS).toContain("visibilitychange");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the expired page is served to the person, and a stranger still gets one word", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // A cookie from a portal that stopped: the person's own browser, no session.
      const stale = await world.call("/", { headers: { cookie: "ccsdk_portal_1=stale" } });
      expect(stale.status).toBe(403);
      expect(stale.body).toContain("This link has expired.");
      expect(stale.body).toContain("Run this in your own terminal");
      // No fact about this machine may be on it: no version, no port, no token.
      expect(stale.body).not.toContain("ccsdk-csrf");
      expect(stale.body).not.toContain("Router running");
      expect(stale.body).not.toContain("Bun 1.4.3");
      // A Host or Origin that is not ours stays the plain word: that request is not the person.
      const foreign = await world.call("/", { headers: { host: "evil.example" } });
      expect(foreign.status).toBe(403);
      expect(foreign.body).toBe("Forbidden");
      const badOrigin = await world.call("/", { headers: { origin: "http://evil.example" } });
      expect(badOrigin.body).toBe("Forbidden");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the page's own icon is served from the portal, so no /favicon.ico is asked for", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const icon = await world.call("/assets/icon.svg");
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
      expect(icon.body).toContain("<svg");
      // The policy that covers it, and the link in every page's head.
      expect(icon.headers.get("content-security-policy")).toContain("img-src 'self' data:");
      const page = await world.enter();
      expect(page.body).toContain('<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">');
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("thirty minutes with no request and the portal stops: the cookie dies with it", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, idleMs: 200 });
    try {
      await world.enter();
      expect(IDLE_MS).toBe(30 * 60_000);
      expect(await world.portal.finished).toBe("idle");
      await expect(world.call("/")).rejects.toThrow();
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

// ── What every answer carries ───────────────────────────────────────────────────

describe("every answer", () => {
  test("the strict policy, and no inline anything", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const first = await world.enter();
      const csp = first.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("unsafe-inline");
      expect(first.headers.get("x-content-type-options")).toBe("nosniff");
      expect(first.headers.get("referrer-policy")).toBe("no-referrer");
      expect(first.headers.get("cache-control")).toBe("no-store");
      for (const path of ["/", "/slots", "/health", "/machine", "/settings", "/privacy"]) {
        const page = await world.call(path);
        expect(page.headers.get("content-security-policy")).toBe(csp);
        // No script without a `src`, no `on*=` handler, and no `style` attribute: the policy
        // allows none of them, so none may be in the markup.
        expect([...page.body.matchAll(/<script(?![^>]*\ssrc=)/g)].length).toBe(0);
        expect([...page.body.matchAll(/\son[a-z]+="/g)].length).toBe(0);
        expect([...page.body.matchAll(/\sstyle="/g)].length).toBe(0);
        // Nothing from the internet: no web font, no address but this machine's.
        expect(page.body).not.toContain("fonts.googleapis.com");
        expect([...page.body.matchAll(/https?:\/\/(?!127\.0\.0\.1|localhost)/g)].length).toBe(0);
      }
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a key is never sent to a page", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    // With an OmniRoute installed, so its own card and its own facts are drawn too.
    const world = await open({ backendPort: backend.port, omniroute: "3.8.51" });
    try {
      const first = await world.enter();
      for (const path of ["/", "/slots", "/health", "/machine", "/settings", "/privacy"]) {
        const page = await world.call(path);
        expect(page.body).not.toContain(KEY);
        // The masked form may appear; the whole key never does.
        expect(page.body).not.toContain("PLANTED");
      }
      expect(first.body).not.toContain(KEY);
      // A JSON action answer holds none either: the testing action reads the backend with
      // that key and answers details about it.
      const tested = await world.post(
        "slot.test",
        { slot: "worker", targets: ["omniroute:glm-5.3-flash"] },
        await world.csrfOf(),
      );
      expect(tested.body).not.toContain(KEY);
      expect(tested.body).not.toContain("PLANTED");
      expect(JSON.parse(tested.body).ok).toBe(true);
      // And the config file itself still holds it: nothing was rewritten.
      expect(readFileSync(world.paths.gatewayConfigFile, "utf8")).toContain(KEY);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("both browser scripts really are JavaScript, not a broken string", async () => {
    // The two scripts are template literals in `assets.ts`: a stray backtick in a comment ends
    // the string early and the browser gets a script that cannot run. TypeScript cannot see
    // inside the string, so this compiles it the way a browser would.
    expect(() => new Function(PORTAL_JS)).not.toThrow();
    expect(() => new Function(THEME_JS)).not.toThrow();
    // And what they are made of: the four theme/portal jobs are still there.
    expect(PORTAL_JS).toContain("data-theme-toggle");
    expect(THEME_JS).toContain("cc-smart-dev-kit-theme");
  });

  test("the page script's own pieces, as the text they are", async () => {
    // The repo has no DOM to run the page's script in (no jsdom, and a new dependency needs
    // the owner's yes), so these are checked as text. Both were found in a browser: `say()`
    // handed an Array to `appendChild`, which throws — lines 2+ never showed, and the reload
    // after a successful Save never ran — and a fetch that never answered left the button on
    // "Working…" forever.
    expect(PORTAL_JS).toContain(
      "for (var i = 0; i < rest.length; i += 1) more.appendChild(rest[i]);",
    );
    expect(PORTAL_JS).not.toContain("more.appendChild(lines(");
    expect(PORTAL_JS).toContain("The portal is not running. Run cc-smart-dev-kit portal again.");
  });

  test("each page renders its own heading, and the header says the router is up", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const headings: [string, string][] = [
        ["/", "Overview"],
        ["/slots", "Slots"],
        ["/health", "Health"],
        ["/machine", "Machine"],
        ["/settings", "Settings"],
        ["/privacy", "How the portal stays private"],
      ];
      for (const [path, heading] of headings) {
        const page = await world.call(path);
        expect(page.status).toBe(200);
        expect(page.body).toContain(`<h1>${heading}</h1>`);
        expect(page.body).toContain("For you, not for Claude");
        expect(page.body).toContain("It stops after 30 minutes with no activity");
        expect(page.body).toContain(`Bun 1.4.3`);
      }
      expect((await world.call("/")).body).toContain("Router running");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("no gateway config yet: the page that says what to run", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, withConfig: false });
    try {
      await world.enter();
      const page = await world.call("/");
      expect(page.status).toBe(200);
      expect(page.body).toContain("The gateway is not set up.");
      expect(page.body).toContain("cc-smart-dev-kit gateway setup --backend-key-stdin omniroute");
      expect(page.body).toContain("Open Machine");
      // A config that was never made is "not set up", not a file to read: no path, no error.
      expect(page.body).not.toContain("The gateway config cannot be read");
      // The header names no router port it cannot know.
      expect(page.body).toContain("Gateway not set up");
      expect(page.body).not.toContain("Router not answering");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("no gateway config: Machine and the privacy page render, and doctor says what is missing", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    // An OmniRoute is installed here, so its card shows its own table: the Backend line is
    // the part of that card the config decides.
    const world = await open({ backendPort: backend.port, omniroute: "3.9.9", withConfig: false });
    try {
      await world.enter();

      // Machine is the page that must work exactly when there is no gateway: doctor first.
      const machine = await world.call("/machine");
      expect(machine.status).toBe(200);
      expect(machine.body).toContain("<title>cc-smart-dev-kit — Machine</title>");
      expect(machine.body).toContain("<h1>Machine</h1>");
      for (const heading of [
        "Updates",
        "Heavy-job queue",
        "Companions",
        "Warp terminal",
        "OmniRoute",
        "Doctor",
      ]) {
        expect(machine.body).toContain(`${heading}</h2>`);
      }
      // Doctor's own line about the gateway is information (`·`), never a failure.
      expect(machine.body).toContain("gateway: not set up (optional)");
      // The one card that needs the config says so, with the command that fixes it.
      expect(machine.body).toContain("<h2>The gateway is not set up</h2>");
      expect(machine.body).toContain(
        "cc-smart-dev-kit gateway setup --backend-key-stdin omniroute",
      );
      // The OmniRoute card's Backend line names no config it does not have, and never a port.
      expect(machine.body).toContain(
        '<span class="label">Backend</span><span class="value mono small">the gateway is not set up</span>',
      );
      expect(machine.body).not.toContain("Router not answering");

      // The privacy page needs no gateway either, and invents no router port.
      const privacy = await world.call("/privacy");
      expect(privacy.status).toBe(200);
      expect(privacy.body).toContain("<h1>How the portal stays private</h1>");
      expect(privacy.body).toContain("no router answers here (the gateway is not set up)");
      expect(privacy.body).not.toContain("the router on");

      // Overview, Slots and Health do need it: they keep the page that says so, pointing here.
      for (const path of ["/", "/slots", "/health"]) {
        const page = await world.call(path);
        expect(page.status).toBe(200);
        expect(page.body).toContain("The gateway is not set up.");
        expect(page.body).toContain('href="/machine"');
      }
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a gateway config that is there but unreadable: the config's own problem is named", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, withConfig: false });
    try {
      // A `gateway.json` a hand edit left broken (mode 600: the mode is not the problem here).
      mkdirSync(dirname(world.paths.gatewayConfigFile), { recursive: true });
      writeFileSync(world.paths.gatewayConfigFile, "{ broken\n", { mode: 0o600 });
      await world.enter();

      const machine = await world.call("/machine");
      expect(machine.status).toBe(200);
      expect(machine.body).toContain("<h2>The gateway config cannot be read</h2>");
      expect(machine.body).toContain("is not valid JSON. Fix it by hand.");
      const overview = await world.call("/");
      expect(overview.body).toContain("The gateway config cannot be read:");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the config is read once per request: a change while the router is asked cannot split a page", async () => {
    // The shell's facts read the config, then ask the router's health page. A second read
    // after that could see a config a hand edit (or another command) just changed: the page
    // would carry the shell's router and the new error at once. One read per request means
    // the whole page agrees with what it started from.
    const backend = fakeBackend(["glm-5.3-flash"]);
    let arm = false;
    const world = await open({
      backendPort: backend.port,
      onProbe: () => {
        if (!arm) return;
        arm = false;
        writeFileSync(world.paths.gatewayConfigFile, "{ broken\n");
      },
    });
    try {
      await world.enter();
      arm = true;
      const page = await world.call("/");
      expect(page.status).toBe(200);
      expect(page.body).toContain("Router running");
      expect(page.body).not.toContain("The gateway is not set up.");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test.skipIf(process.getuid?.() === 0)(
    "a gateway config others cannot read (mode 000) is an error to fix, never 'not set up'",
    async () => {
      // `readFileSync` on a mode-000 file is EACCES. Only ENOENT means "never set up": the
      // person must see the config's own problem, not a page telling them to run the command
      // they already ran.
      const backend = fakeBackend(["glm-5.3-flash"]);
      const world = await open({ backendPort: backend.port, withConfig: false });
      try {
        mkdirSync(dirname(world.paths.gatewayConfigFile), { recursive: true });
        writeFileSync(world.paths.gatewayConfigFile, "{}\\n");
        chmodSync(world.paths.gatewayConfigFile, 0o000);
        await world.enter();

        const machine = await world.call("/machine");
        expect(machine.status).toBe(200);
        expect(machine.body).toContain("<h2>The gateway config cannot be read</h2>");
        expect(machine.body).not.toContain("<h2>The gateway is not set up</h2>");
        // The pages that need the config keep the page that says so — with the config's own
        // error in it, never the plain "never set up" one (`configExists` told the two apart).
        const overview = await world.call("/");
        expect(overview.body).toContain("The gateway config cannot be read:");
        expect(overview.body).toContain("Nothing here can change until it is fixed.");
      } finally {
        world.portal.stop();
        backend.stop();
      }
    },
  );

  test("a gateway config that is a folder (EISDIR) is an error to fix, never 'not set up'", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, withConfig: false });
    try {
      mkdirSync(world.paths.gatewayConfigFile, { recursive: true });
      await world.enter();

      const machine = await world.call("/machine");
      expect(machine.status).toBe(200);
      expect(machine.body).toContain("<h2>The gateway config cannot be read</h2>");
      expect(machine.body).not.toContain("<h2>The gateway is not set up</h2>");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the slots page lists what the backend really offers, and the Claude models too", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const slots = await world.call("/slots");
      expect(slots.body).toContain("omniroute:glm-5.3-flash");
      expect(slots.body).toContain("omniroute:deepseek-v4.1-flash");
      expect(slots.body).toContain("200K");
      expect(slots.body).toContain("claude-sonnet-5-5");
      expect(slots.body).toContain("Claude login");
      expect(slots.body).toContain("The force-push test. There is no skip.");
      // Prices are not invented: the page says where they live instead.
      expect(slots.body).toContain("prices and image support are in OmniRoute's own catalog");
      // Nothing has been tested yet. The chain itself is drawn by the page's script from these
      // two attributes, so they are what the server must get right: an empty `data-tested` and
      // every target in `data-chains`. The script's own mark for that case is "Not tested yet."
      expect(slots.body).toContain('data-tested="{}"');
      expect(PORTAL_JS).toContain("Not tested yet.");
      // The judge's own note is there but closed, and so is the save question: the CSS keeps a
      // `hidden` element hidden even where a class says `display: flex`.
      expect(slots.body).toContain("data-judge-note hidden");
      expect(slots.body).toContain("data-confirm-save hidden");
      expect(PORTAL_CSS).toContain("[hidden] { display: none !important; }");
      // The page head's own top space: `main` carries `.wrap` too, whose class rule beat the
      // element rule below it, so the h1 sat ~12px under the privacy strip.
      expect(PORTAL_CSS).toContain(
        "main.wrap { display: flex; flex-direction: column; gap: 28px; padding-top: 32px; padding-bottom: 48px; }",
      );
      // A phone header: three rows instead of six, and the five links in equal columns at
      // least 96px wide (two rows of them at 390px), each still 44px tall.
      expect(PORTAL_CSS).toContain("@media (max-width: 640px)");
      expect(PORTAL_CSS).toContain("grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))");
      expect(PORTAL_CSS).toContain(".theme { order: 2; margin-left: auto; }");
      expect(PORTAL_CSS).toContain(".chips { order: 3; width: 100%; }");
      const overview = await world.call("/");
      expect(overview.body).toContain('class="row theme"');
      expect(overview.body).toContain('class="row chips"');
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("every hook the browser script requires is in the markup", async () => {
    // The page's script reaches for these without a guard (they are what the page is), so a
    // missing one is a `TypeError` in the browser and a dead page. Found live, once.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const slots = await world.call("/slots");
      for (const hook of [
        "data-slots",
        "data-slot=",
        "data-chains=",
        "data-tested=",
        "data-chain",
        "data-models",
        "data-save",
        "data-test",
        "data-confirm-save",
        "data-confirm-yes",
        "data-confirm-no",
        "data-find",
        "data-out",
      ]) {
        expect(slots.body).toContain(hook);
      }
      // The switch rows, the log filter, the meters and the theme button.
      const overview = await world.call("/");
      for (const hook of ["data-theme-toggle", 'data-action="switch"', 'data-out-for="switch"']) {
        expect(overview.body).toContain(hook);
      }
      const health = await world.call("/health");
      for (const hook of ["data-live", "data-pause", "data-only-warn"]) {
        expect(health.body).toContain(hook);
      }
      const machine = await world.call("/machine");
      for (const hook of [
        'data-action="update.check"',
        'data-action="doctor.run"',
        'data-out-for="update.check"',
      ]) {
        expect(machine.body).toContain(hook);
      }
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

// ── The actions ─────────────────────────────────────────────────────────────────

describe("the actions", () => {
  test("the hold switch really holds and resumes, and the page shows the CLI's own lines", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const on = await world.post("switch", { name: "hold", on: true }, csrf);
      expect(on.status).toBe(200);
      // The command line's own words (`cc-smart-dev-kit update --hold`), never a second copy.
      expect(JSON.parse(on.body)).toEqual({
        lines: [
          "Background updates are on hold: a new Claude session no longer checks for a newer cc-smart-dev-kit. To resume: cc-smart-dev-kit update --resume",
        ],
        ok: true,
      });
      expect(existsSync(join(world.paths.stateDir, "update-hold"))).toBe(true);
      const off = await world.post("switch", { name: "hold", on: false }, csrf);
      const resumed = JSON.parse(off.body) as { lines: string[]; ok: boolean };
      expect(resumed.ok).toBe(true);
      expect(resumed.lines.join("\n")).toContain(
        "Background updates resume: a new Claude session checks for a newer cc-smart-dev-kit, at most once an hour",
      );
      expect(existsSync(join(world.paths.stateDir, "update-hold"))).toBe(false);
      // A second resume says there was nothing to resume — still the CLI's line.
      const again = await world.post("switch", { name: "hold", on: false }, csrf);
      expect(JSON.parse(again.body)).toEqual({
        lines: ["Background updates were not on hold."],
        ok: true,
      });
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the gateway switch runs `gateway on`, which writes the owned keys itself", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const on = await world.post("switch", { name: "gateway", on: true }, csrf);
      const answer = JSON.parse(on.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      expect(answer.lines.join("\n")).toContain("ANTHROPIC_BASE_URL");
      const settings = JSON.parse(readFileSync(world.paths.settingsFile, "utf8")) as {
        env: Record<string, string>;
      };
      expect(settings.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:20199");
      expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("cc-smart-dev-kit-scout[1m]");
      // And off removes exactly what on wrote.
      const off = await world.post("switch", { name: "gateway", on: false }, csrf);
      expect(JSON.parse(off.body).ok).toBe(true);
      const after = JSON.parse(readFileSync(world.paths.settingsFile, "utf8")) as {
        env?: Record<string, string>;
      };
      expect(after.env?.ANTHROPIC_BASE_URL).toBeUndefined();
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("saving a slot writes the config with the CLI's own checks, and remembers it", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const saved = await world.post(
        "slot.save",
        { slot: "worker", targets: ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"] },
        csrf,
      );
      expect(JSON.parse(saved.body).ok).toBe(true);
      const config = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(config.slots["cc-smart-dev-kit-worker"]).toEqual([
        "omniroute:glm-5.3-flash",
        "claude-sonnet-5-5",
      ]);
      // A model the backend does not list is refused, in the command line's own words.
      const bad = await world.post(
        "slot.save",
        { slot: "scout", targets: ["omniroute:not-a-model"] },
        csrf,
      );
      expect(bad.status).toBe(400);
      expect(JSON.parse(bad.body).lines.join("\n")).toContain(
        '"omniroute:not-a-model": "omniroute" has no model "not-a-model"',
      );
      const unchanged = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(unchanged.slots["cc-smart-dev-kit-scout"]).toEqual([
        "omniroute:glm-5.3-flash",
        "claude-sonnet-5-5",
      ]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("testing a chain answers per target, and a Claude target says what it cannot do", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const tested = await world.post(
        "slot.test",
        { slot: "worker", targets: ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"] },
        csrf,
      );
      const answer = JSON.parse(tested.body) as {
        ok: boolean;
        results: { detail: string; target: string; verdict: string }[];
      };
      expect(answer.ok).toBe(true);
      expect(answer.results).toEqual([
        {
          detail: 'glm-5.3-flash answered "ready"',
          target: "omniroute:glm-5.3-flash",
          verdict: "good",
        },
        {
          detail:
            "on your own Claude login: the portal cannot send a request with it, and never holds one",
          target: "claude-sonnet-5-5",
          verdict: "good",
        },
      ]);
      expect(backend.chats).toEqual(["glm-5.3-flash"]);
      // A target the backend does not list fails, and the chain cannot be saved.
      const bad = await world.post(
        "slot.test",
        { slot: "worker", targets: ["omniroute:not-a-model"] },
        csrf,
      );
      const refused = JSON.parse(bad.body) as { ok: boolean; results: { verdict: string }[] };
      expect(refused.ok).toBe(false);
      expect(refused.results[0]?.verdict).toBe("bad");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the judge switch refuses with nothing tested, naming the way to make one", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const refused = await world.post("switch", { name: "judge", on: true }, csrf);
      expect(refused.status).toBe(400);
      const answer = JSON.parse(refused.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(false);
      expect(answer.lines[0]).toBe(
        "No tested judge chain is saved, so the switch cannot turn one on.",
      );
      expect(answer.lines[1]).toContain("Go to Slots, pick judge");
      // Nothing was written to the config.
      const config = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(config.slots["cc-smart-dev-kit-judge"]).toBeUndefined();
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a router restart reads the router bundle from the plugin folder it resolves now", async () => {
    // The bug this fixes, found live: the portal runs from a copy in
    // `~/.local/share/cc-smart-dev-kit/`, where `dist/router.js` does not exist, so
    // "Restart the router" threw ENOENT. The folder is resolved at the moment of the action.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const plugin = tempDir("portal-plugin");
    mkdirSync(join(plugin, "dist"), { recursive: true });
    writeFileSync(join(plugin, "dist", "router.js"), "// the resolved router bundle\n");
    const world = await open({
      backendPort: backend.port,
      pluginFolder: () => ({ folder: plugin }),
      systemd: true,
    });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const restarted = await world.post("router.restart", {}, csrf);
      expect(restarted.status).toBe(200);
      expect(JSON.parse(restarted.body).ok).toBe(true);
      // `gateway setup` copied that folder's bundle: the file it installs is the proof that
      // the path was resolved, not made at startup.
      expect(readFileSync(world.paths.routerCopy, "utf8")).toBe("// the resolved router bundle\n");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("with no plugin folder left, the restart says so in words and runs nothing", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const gone = "the plugin's own folder is gone, and Claude Code records no installed version.";
    const world = await open({
      backendPort: backend.port,
      pluginFolder: () => ({ error: gone }),
      systemd: true,
    });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const restarted = await world.post("router.restart", {}, csrf);
      expect(restarted.status).toBe(400);
      expect(JSON.parse(restarted.body)).toEqual({ lines: [gone], ok: false });
      // Nothing was installed, and no unit file was written.
      expect(existsSync(world.paths.routerCopy)).toBe(false);
      expect(existsSync(world.paths.routerUnitFile)).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("an unknown action, and an unknown switch, are refused in words", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const unknown = await world.post("nope", {}, csrf);
      expect(unknown.status).toBe(400);
      expect(JSON.parse(unknown.body).lines).toEqual(['"nope" is not an action.']);
      const wrongSwitch = await world.post("switch", { name: "everything", on: true }, csrf);
      expect(JSON.parse(wrongSwitch.body).lines).toEqual(['"everything" is not a switch.']);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a thrown page is a plain 500, and the next load runs the doctor pass again", async () => {
    // Two bugs in one place. Bun's own error page names the source file and the line (and a
    // stack holds this machine's paths); and a failed pass left `state.doctorRun` set, so every
    // later load of the Machine page waited on the same rejected promise — broken until a
    // restart.
    const backend = fakeBackend(["glm-5.3-flash"]);
    let runs = 0;
    const world = await open({
      backendPort: backend.port,
      doctor: () => {
        runs += 1;
        if (runs === 1) throw new Error("the doctor source broke");
        return {
          bun: { path: process.execPath, version: Bun.version },
          gateway: {
            bundle: join(worldPluginFolder(), "dist", "router.js"),
            machine: worldMachine(),
            runner: () => ({ exitCode: 1, output: "" }),
            service: "none",
          },
          live: null,
          local: { cwd: "/tmp", instructionsSource: join(worldPluginFolder(), "instructions") },
          project: null,
        };
      },
    });
    try {
      await world.enter();
      const failed = await world.call("/machine");
      expect(failed.status).toBe(500);
      expect(failed.body).toContain("Internal Server Error");
      // The one word carries the same headers as everything else, and never the stack.
      expect(failed.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(failed.headers.get("x-content-type-options")).toBe("nosniff");
      expect(failed.headers.get("cache-control")).toBe("no-store");
      expect(failed.body).not.toContain("the doctor source broke");
      // The next load runs the pass again, and the page is whole.
      const page = await world.call("/machine");
      expect(page.status).toBe(200);
      expect(page.body).toContain("The same checks as");
      expect(runs).toBe(2);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("running doctor again shows the same checks the command line would print", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const ran = await world.post("doctor.run", {}, csrf);
      expect(ran.status).toBe(200);
      const answer = JSON.parse(ran.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      expect(answer.lines.join("\n")).toContain(
        `Bun ${Bun.version} at ${process.execPath} (cc-smart-dev-kit needs ≥ 1.4.3)`,
      );
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the auto-mode rules need the in-page yes, and write nothing without it", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const no = await world.post("automode.apply", {}, csrf);
      expect(JSON.parse(no.body).lines).toEqual([
        "The rules were not confirmed, so nothing was written.",
      ]);
      expect(existsSync(world.paths.settingsFile)).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the Machine page runs doctor once and shows it, and the OmniRoute card is real", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, omniroute: "3.8.51" });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.status).toBe(200);
      expect(page.body).toContain("The same checks as");
      expect(page.body).toContain("Heavy-job queue");
      // The OmniRoute card: what is installed, and the newest release the injected registry
      // offered. Never the real registry, never a real install.
      expect(page.body).toContain("OmniRoute");
      expect(page.body).toContain("Newest, 3 days old");
      expect(page.body).toContain("3.8.51");
      expect(page.body).toContain("3.9.0");
      expect(page.body).toContain("Update to 3.9.0");
      expect(page.body).toContain("Claude answers, on your own login");
      // No unit runs it here: the card must not promise a restart and a check it cannot do.
      expect(page.body).toContain("No user unit runs OmniRoute here");
      expect(page.body).not.toContain("The update restarts");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("with a user unit running OmniRoute, the card names the unit the update restarts", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      omniroute: "3.8.51",
      omnirouteUnit: true,
    });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.body).toContain("The update restarts omniroute.service");
      expect(page.body).not.toContain("No user unit runs OmniRoute here");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("with no OmniRoute installed, the card says how to install one", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.body).toContain("Not installed here");
      expect(page.body).toContain("bun add -g omniroute");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the fallback switch puts the opus chain back after Off, under the slot key", async () => {
    // The bug, found by reading the code: `rememberChain` stored the chain under the family
    // ("opus") and `switchFallback` read it under the slot key ("cc-smart-dev-kit-opus"), so
    // Off then On turned nothing on — and answered ok: true about it.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const saved = await world.post(
        "slot.save",
        { slot: "opus", targets: ["claude-opus-5-5", "omniroute:glm-5.3-flash"] },
        csrf,
      );
      expect(JSON.parse(saved.body).ok).toBe(true);
      const on = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(on.slots["cc-smart-dev-kit-opus"]).toEqual([
        "claude-opus-5-5",
        "omniroute:glm-5.3-flash",
      ]);
      const off = await world.post("switch", { name: "fallback", on: false }, csrf);
      expect(JSON.parse(off.body).ok).toBe(true);
      const gone = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(gone.slots["cc-smart-dev-kit-opus"]).toBeUndefined();
      // On puts exactly that chain back.
      const again = await world.post("switch", { name: "fallback", on: true }, csrf);
      const answer = JSON.parse(again.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      const back = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(back.slots["cc-smart-dev-kit-opus"]).toEqual([
        "claude-opus-5-5",
        "omniroute:glm-5.3-flash",
      ]);
      // The other family has nothing saved, and that is said, not invented.
      expect(answer.lines.join("\n")).toContain("No saved chain for fable");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the fallback switch is off, and says so, when nothing was turned on", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const answer = await world.post("switch", { name: "fallback", on: true }, csrf);
      expect(answer.status).toBe(400);
      const body = JSON.parse(answer.body) as { lines: string[]; ok: boolean };
      expect(body.ok).toBe(false);
      expect(body.lines.join("\n")).toContain("Nothing was turned on, so the switch is still off.");
      expect(body.lines.join("\n")).toContain("No saved chain for fable or opus");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the judge switch remembers a chain the command line set before it turns it off", async () => {
    // A chain set from the terminal was lost by one Off: the switch had nothing to turn on.
    const backend = fakeBackend(["glm-5.3-flash"], { chat: "<block>yes</block>" });
    const world = await open({ backendPort: backend.port });
    try {
      // As `gateway slot judge` leaves it: written into the config, with a test proof.
      const config = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      config.slots["cc-smart-dev-kit-judge"] = ["omniroute:glm-5.3-flash"];
      writeFileSync(world.paths.gatewayConfigFile, JSON.stringify(config, null, 2), {
        mode: 0o600,
      });
      await world.enter();
      const csrf = await world.csrfOf();
      const off = await world.post("switch", { name: "judge", on: false }, csrf);
      expect(JSON.parse(off.body).ok).toBe(true);
      const gone = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(gone.slots["cc-smart-dev-kit-judge"]).toBeUndefined();
      const on = await world.post("switch", { name: "judge", on: true }, csrf);
      const answer = JSON.parse(on.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      const back = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(back.slots["cc-smart-dev-kit-judge"]).toEqual(["omniroute:glm-5.3-flash"]);
      // `gateway slot judge` ran its own force-push test on the way back.
      expect(answer.lines.join("\n")).toContain("blocked");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("testing a judge chain: a Claude target is allowed and never used, a backend must block", async () => {
    const backend = fakeBackend(["glm-5.3-flash"], { chat: "<block>yes</block>" });
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const tested = await world.post(
        "slot.test",
        { slot: "judge", targets: ["claude-opus-5-5", "omniroute:glm-5.3-flash"] },
        csrf,
      );
      const answer = JSON.parse(tested.body) as {
        lines: string[];
        ok: boolean;
        results: { detail: string; target: string; verdict: string }[];
      };
      expect(answer.ok).toBe(true);
      expect(answer.results).toEqual([
        {
          detail:
            "on your own Claude login: the router uses a judge target only after it passed the force-push test, so this one is ignored, exactly as the command line ignores it",
          target: "claude-opus-5-5",
          verdict: "good",
        },
        {
          detail: "blocked it",
          target: "omniroute:glm-5.3-flash",
          verdict: "blocked",
        },
      ]);
      expect(answer.lines.join("\n")).toContain(
        "Every backend target blocked the test check. You can save this chain.",
      );
      // The page's Save rule follows the command line's: only a backend target has to show
      // blocked ✓, and the note that says so lives on the judge slot alone.
      expect(PORTAL_JS).toContain('target.indexOf("claude-") !== 0');
      const slots = await world.call("/slots");
      expect(slots.body).toContain("Save stays off until every one of them shows blocked");
      expect(slots.body).toContain("data-judge-note hidden");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("only a companion this kit knows can be turned on from the page", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const refused = await world.post("companion.enable", { id: "evil@somewhere" }, csrf);
      expect(refused.status).toBe(400);
      const body = JSON.parse(refused.body) as { lines: string[]; ok: boolean };
      expect(body.ok).toBe(false);
      expect(body.lines[0]).toContain('"evil@somewhere" is not one of this kit\'s companions');
      // A known one is enabled through the same `claude plugin enable` the CLI prints.
      const known = await world.post(
        "companion.enable",
        { id: "frontend-design@claude-plugins-official" },
        csrf,
      );
      expect(JSON.parse(known.body)).toEqual({
        lines: ["frontend-design@claude-plugins-official is on."],
        ok: true,
      });
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the Machine page's OmniRoute row never holds the backend's key", async () => {
    // The row used to carry the whole facts object, whose `backend` holds the key: nothing on
    // the page drew it, but it reached the view, and a JSON answer would have carried it.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, omniroute: "3.8.51" });
    try {
      const row = await omnirouteRow(world.omnirouteCtx(), isOlder);
      expect(JSON.stringify(row)).not.toContain(KEY);
      expect(JSON.stringify(row)).not.toContain("PLANTED");
      // And the address it shows is the masked one.
      expect(row.backend).toContain("(key ••••a1b2)");
      expect(row.install?.version).toBe("3.8.51");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the Machine page shows the Warp commands to copy, and never runs them", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.status).toBe(200);
      expect(page.body).toContain("Warp terminal");
      expect(page.body).toContain("cc-smart-dev-kit setup --warp");
      expect(page.body).toContain("cc-smart-dev-kit setup --remove-warp");
      // Nothing here calls an action: both need sudo, so they are only ever copied.
      expect(page.body).not.toContain('data-action="warp');
      expect(page.body).toContain("which this page never runs");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a project's own folder is where the auto-mode rules come from", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // A project that asks for one rule, in the folder the portal was started in.
      mkdirSync(join(world.paths.stateDir, "..", "..", "unused"), { recursive: true });
      await world.enter();
      const csrf = await world.csrfOf();
      const applied = await world.post("automode.apply", { confirm: true }, csrf);
      // The temp project is not a git checkout, so there is nothing to copy — and the answer
      // says exactly that instead of writing anything.
      expect(JSON.parse(applied.body).lines).toEqual([
        "This folder is not inside a git project, so there is nothing to copy.",
      ]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

// ── The Settings page ───────────────────────────────────────────────────────────

/** The project's own file, as a real one looks; its base is what the auto-merge rule names. */
const PROJECT_CONFIG = `${JSON.stringify(
  {
    requires: ">=0.3",
    worktrees: { base: "integration", prefix: "app-wt-", setup: ["bun", "install"] },
    protectedBranches: ["main", "integration"],
  },
  null,
  2,
)}\n`;

describe("the settings page", () => {
  test("the design's rows, each saying where its value comes from", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow: fakeWorkflow({
        resolved: {
          autoCommit: { source: "personal", value: true },
          deleteBranch: { source: "project", value: true },
          openPr: { source: "personal", value: "ready" },
        },
      }),
    });
    try {
      await world.enter();
      const page = await world.call("/settings");
      expect(page.status).toBe(200);
      // The three cards, in the design's words and order.
      expect(page.body).toContain('<h2 id="flow-h">Work flow</h2>');
      expect(page.body).toContain('<h2 id="alerts-h">Alerts</h2>');
      expect(page.body).toContain('<h2 id="switches-h">Switches</h2>');
      // Rows: the label and its own help line, word for word.
      expect(page.body).toContain(">Auto commit<");
      expect(page.body).toContain("Commit each finished, reviewed step without asking.");
      expect(page.body).toContain("Off: never. Draft: open it as a draft the team can look at.");
      expect(page.body).toContain(
        "A second read of the whole change before it leaves this computer: one premium second opinion.",
      );
      expect(page.body).toContain("Which events alert you.");
      expect(page.body).toContain("No new kit version installs until you turn this off again.");
      // The three source tags, with the values the resolver gave.
      expect(page.body).toContain('<span class="src personal">yours</span>');
      expect(page.body).toContain('<span class="src project">this project</span>');
      expect(page.body).toContain('<span class="src default">default</span>');
      expect(page.body).toContain('aria-checked="true"');
      // The footer rule, once.
      expect(page.body).toContain("Your choices are saved on this computer for every project.");
      // Every row carries a control the page can send: the keys are the module's own.
      expect(page.body).toContain("&quot;key&quot;:&quot;autoCommit&quot;");
      expect(page.body).toContain('data-events="alerts.events"');
      expect(page.body).toContain('data-setting="alerts.usagePercent"');
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a row the project sets is read-only here, and says where to change it", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow: fakeWorkflow({ resolved: { deleteBranch: { source: "project", value: true } } }),
    });
    try {
      await world.enter();
      const page = await world.call("/settings");
      // The switch is drawn with its value and its label, and nothing invites a change.
      expect(page.body).toContain('aria-labelledby="set-del" class="switch" disabled');
      expect(page.body).toContain("change it in the project");
      expect(page.body).toContain('href="/machine#project"');
      expect(page.body).toContain('class="small bold projectlink"');
      // No action anywhere carries a project row's key: the page cannot send one.
      expect(page.body).not.toContain("&quot;key&quot;:&quot;deleteBranch&quot;");
      // A row nobody sets stays changeable, right beside it.
      expect(page.body).toContain("&quot;key&quot;:&quot;autoCommit&quot;");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("changing a value writes it through the module, with the key the row shows", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({ backendPort: backend.port, workflow });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const answer = await world.post("workflow.set", { key: "openPr", value: "draft" }, csrf);
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body).ok).toBe(true);
      expect(workflow.calls.writePersonalSetting).toEqual([{ key: "openPr", value: "draft" }]);
      // The module's own line is what the page shows.
      expect(JSON.parse(answer.body).lines).toEqual(["~ your own defaults: openPr = draft"]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a value outside the row's own set is refused in words, and nothing is written", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({ backendPort: backend.port, workflow });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const cases: [string, unknown, string][] = [
        ["openPr", "whenever", "openPr is one of off, draft, ready"],
        ["mergeMethod", "fast-forward", "mergeMethod is one of merge, squash, rebase"],
        ["alerts.usagePercent", 140, "alerts.usagePercent is a whole number 1-100"],
        ["alerts.usagePercent", "85", "alerts.usagePercent is a whole number 1-100"],
        ["alerts.events", [], "alerts.events is a list of needs-you, question, finished, failed"],
        ["alerts.events", ["needs-you", "needs-you"], "alerts.events: an event is listed twice"],
        ["alerts.events", ["finished", "later"], "alerts.events: unknown later"],
        ["autoCommit", "yes", "autoCommit is true or false"],
        ["switches.statusLine", 1, "switches.statusLine is true or false"],
        ["not-a-setting", true, '"not-a-setting" is not a setting this page shows.'],
      ];
      for (const [key, value, why] of cases) {
        const answer = await world.post("workflow.set", { key, value }, csrf);
        expect(answer.status).toBe(400);
        const body = JSON.parse(answer.body);
        expect(body.ok).toBe(false);
        expect(body.lines[0]).toContain(why);
      }
      expect(workflow.calls.writePersonalSetting).toEqual([]);
      expect(workflow.calls.writeProjectSetting).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a project-owned switch is written into the project's file, after the page's yes", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow,
    });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      // No confirmation: nothing is written, and the answer says so.
      const no = await world.post("workflow.set", { key: "switches.jobRoute", value: true }, csrf);
      expect(JSON.parse(no.body).ok).toBe(false);
      expect(workflow.calls.writeProjectSetting).toEqual([]);
      expect(workflow.calls.writePersonalSetting).toEqual([]);
      // Confirmed: the project's own writer, with the folder the portal runs in.
      const yes = await world.post(
        "workflow.set",
        { confirm: true, key: "switches.jobRoute", value: true },
        csrf,
      );
      expect(JSON.parse(yes.body).ok).toBe(true);
      // The project's own writer, with the folder the portal runs in and the portal's own
      // environment: git inside it never reads `process.env`.
      expect(workflow.calls.writeProjectSetting).toEqual([
        { cwd: world.cwd, env: world.ctx.env, key: "switches.jobRoute", value: true },
      ]);
      expect(workflow.calls.writePersonalSetting).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a project-owned switch without a project file is refused, not written elsewhere", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({ backendPort: backend.port, workflow });
    try {
      await world.enter();
      const answer = await world.post(
        "workflow.set",
        { confirm: true, key: "switches.sessionNames", value: true },
        await world.csrfOf(),
      );
      expect(JSON.parse(answer.body).ok).toBe(false);
      expect(JSON.parse(answer.body).lines[0]).toContain(
        "has no .claude/cc-smart-dev-kit.json yet",
      );
      expect(workflow.calls.writeProjectSetting).toEqual([]);
      expect(workflow.calls.writePersonalSetting).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the auto-merge row carries the rule box, word for word, with the project's base", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow({
      autoMerge: true,
      resolved: { autoMerge: { source: "personal", value: true } },
    });
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow,
    });
    try {
      await world.enter();
      const page = await world.call("/settings");
      expect(page.body).toContain(
        "Only into the project's integration branch (integration here), after CI is green and the review is done. Never main, a release branch or production: those always ask you.",
      );
      // The module's own rule decided the line under it, with the repository's default branch.
      expect(page.body).toContain(
        "On this project, a pull request into integration may be merged by itself, once CI is green and the review is done.",
      );
      expect(workflow.calls.autoMergeAllowed).toEqual([
        { defaultBranch: "main", prBase: "integration" },
      ]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a broken file of the person's own is a notice in words, never an invented value", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const broken = fakeWorkflow();
    const world = await open({
      backendPort: backend.port,
      workflow: {
        ...broken,
        resolveWorkflow: () => {
          throw new Error(
            "Invalid /home/someone/.config/cc-smart-dev-kit/workflow.json: openPr: Invalid option",
          );
        },
      },
    });
    try {
      await world.enter();
      const page = await world.call("/settings");
      expect(page.status).toBe(200);
      expect(page.body).toContain("The workflow settings cannot be read:");
      expect(page.body).toContain("workflow.json: openPr: Invalid option");
      // Not one row: a value it cannot read is never shown as a default.
      expect(page.body).not.toContain(">Auto commit<");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a project file that cannot be read is named, never read as silence", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: "{ not json" },
      workflow: fakeWorkflow(),
    });
    try {
      await world.enter();
      const page = await world.call("/settings");
      expect(page.status).toBe(200);
      // The rows draw from the person's own defaults — with the reason said out loud, so no
      // row claims `default` for a value the project really sets.
      expect(page.body).toContain("No project&#39;s own values here: Invalid");
      expect(page.body).toContain(">Auto commit<");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("no gateway config: the Settings page draws, and invents no port", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, withConfig: false });
    try {
      await world.enter();
      const page = await world.call("/settings");
      expect(page.status).toBe(200);
      expect(page.body).toContain("Gateway not set up");
      expect(page.body).toContain("Hold self-updates");
      expect(page.body).not.toContain("127.0.0.1:20199");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

// ── The shape of the pages ──────────────────────────────────────────────────────

describe("the shape of the pages", () => {
  test("every page is drawn by the one header, with one theme toggle in it", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.enter();
      for (const route of ["/", "/slots", "/health", "/machine", "/settings", "/privacy"]) {
        const page = await world.call(route);
        expect(page.status).toBe(200);
        expect((page.body.match(/<header class="top">/g) ?? []).length).toBe(1);
        expect((page.body.match(/data-theme-toggle/g) ?? []).length).toBe(1);
        for (const href of ["/", "/slots", "/health", "/machine", "/settings"]) {
          expect(page.body).toContain(`href="${href}"`);
        }
      }
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the stylesheet carries the fixes the measurements asked for", () => {
    // Each line here is one defect the owner saw in a screenshot, and each is a rule a browser
    // reads — there is no DOM in this test to lay a page out in, so the rule itself is what is
    // checked, with the measurement that asked for it.
    //
    // 1. The theme toggle wrapped onto a second line at 1440 (040-settings-1440-dark.png): the
    //    header is a grid at desktop widths, and the links take the free column, so the toggle
    //    cannot be pushed out of the row.
    expect(PORTAL_CSS).toContain("grid-template-columns: auto auto minmax(0, 1fr) auto");
    expect(PORTAL_CSS).toContain("justify-content: flex-end; }\n}");
    // 2. An empty answer box left a band at the bottom of every Settings card: it is not there
    //    at all until the script fills it, and the row above keeps no separator.
    expect(PORTAL_CSS).toContain("[data-out-for]:empty, [data-out]:empty { display: none; }");
    expect(PORTAL_CSS).toContain(".card.list > *:has(+ .foot:empty) { border-bottom: 0; }");
    // 3. Two touch targets were under 44px: the protected branch's ✕ (36 wide) and the link
    //    under a row the project sets (about 20 tall).
    expect(PORTAL_CSS).not.toContain("min-width: 36px");
    expect(PORTAL_CSS).toContain(".btn.icon { min-width: 44px;");
    expect(PORTAL_CSS).toContain(
      ".setrow .projectlink { display: inline-flex; align-items: center; min-height: 44px; }",
    );
    // 4. The doctor's checks stay a grid, but a long path wraps inside its own column instead
    //    of widening it: the mark's column is fixed and the text column may shrink to nothing.
    expect(PORTAL_CSS).toContain("grid-template-columns: 16px minmax(0, 1fr)");
    // 5. The guide is one column, numbered, with the address in a box of its own.
    expect(PORTAL_CSS).toContain("ol.guide");
    // A box with no file name is one row, the Copy button beside the code, not above it.
    expect(PORTAL_CSS).toContain(".codebox.oneline { display: flex;");
  });

  test("a machine with no git says the fact in words, not the spawner's own", async () => {
    // The Settings page showed "Executable not found in $PATH: \"git\"" — a raw runtime error
    // standing in for "this project's own values cannot be read". The fact stays; the words are
    // a person's.
    const world = await open({ backendPort: 0, withConfig: false, noGit: true });
    try {
      await world.enter();
      const settings = await world.call("/settings");
      expect(settings.status).toBe(200);
      expect(settings.body).toContain(
        "git was not found, so this project&#39;s own values cannot be read",
      );
      expect(settings.body).not.toContain("Executable not found");
      const machine = await world.call("/machine");
      expect(machine.body).toContain("The project cannot be read:");
      expect(machine.body).toContain("git was not found");
      expect(machine.body).not.toContain("Executable not found");
    } finally {
      world.portal.stop();
    }
  });
});

// ── The Project card on Machine ─────────────────────────────────────────────────

/** The form's answers, as the page's own script collects them. */
function formAnswers(overrides: Record<string, unknown> = {}) {
  return {
    base: "trunk",
    bases: { "fix/": "main" },
    engine: "own",
    guards: { guardMainFolder: false, jobRoute: true, sessionNames: false },
    prefix: "wt-",
    protectedBranches: ["main"],
    setup: ["npm", "ci"],
    ...overrides,
  };
}

/** The same answers, over the fake's own defaults: what the plan is really made from. */
const MERGED_ANSWERS: ProjectInitAnswers = {
  base: "trunk",
  bases: { "fix/": "main" },
  engine: "own",
  guards: { guardMainFolder: false, jobRoute: true, sessionNames: false },
  prefix: "wt-",
  protectedBranches: ["main"],
  setup: ["npm", "ci"],
  workflow: { openPr: "draft" },
};

describe("the project card", () => {
  test("nothing set up yet: the line, the button, and the form behind it", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({ backendPort: backend.port, projectFiles: {}, workflow });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.status).toBe(200);
      expect(page.body).toContain('<span class="muted bold">not set up</span>');
      expect(page.body).toContain(
        "No <code>.claude/cc-smart-dev-kit.json</code>: the project's guards and worktree hooks are off here.",
      );
      expect(page.body).toContain("data-setup-show");
      expect(page.body).toContain("Set up this project");
      // The form is there — the page's script reveals it — but closed, and its first values
      // are the ones the module's own detection gave, never a word this page made up.
      expect(page.body).toContain("data-project-form hidden");
      expect(page.body).toContain('value="integration"');
      expect(workflow.calls.projectInitDefaults).toEqual([{ root: world.cwd }]);
      // The plan is drawn from the answers, and nothing is written to make a preview.
      expect(workflow.calls.planProjectInit.length).toBe(1);
      expect(workflow.calls.applyProjectInit).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a project that is set up: the form, filled from the project's own file", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG, settings: '{\n  "hooks": {}\n}\n' },
      workflow,
    });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.body).not.toContain("not set up");
      // The three fields, the base rows, the protected chips, the guards and the engine.
      expect(page.body).toContain('id="f-base"');
      expect(page.body).toContain('data-base-prefix value="hotfix/"');
      expect(page.body).toContain('data-protected-name value="integration"');
      expect(page.body).toContain('data-form-switch="guardMainFolder"');
      expect(page.body).toContain('aria-pressed="true" data-engine-value="plugin"');
      // The preview: the plan's own text, the three lines the settings file gets, and the note.
      expect(page.body).toContain("&quot;base&quot;: &quot;integration&quot;");
      expect(page.body).toContain(
        "&quot;command&quot;: &quot;cc-smart-dev-kit hook worktree&quot;",
      );
      expect(page.body).toContain(
        "3 lines, added inside the existing file. Nothing else there changes.",
      );
      expect(page.body).toContain("Write the files");
      expect(page.body).toContain("Cancel");
      expect(page.body).toContain(
        "This writes two files in the repo. Commit them like any change: the team shares one setup.",
      );
      // The card read the project through the module, in the project's own folder.
      expect(workflow.calls.projectInitDefaults).toEqual([{ root: world.cwd }]);
      expect(workflow.calls.resolveWorkflow).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the form's answers are checked, in words, before anything is planned", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow,
    });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const cases: [Record<string, unknown>, string][] = [
        [{ base: "" }, "The base branch is needed: it is the branch a new worktree starts from."],
        [{ prefix: "app/wt-" }, "The worktree folder prefix cannot hold / or"],
        [{ bases: { hotfix: "main" } }, '"hotfix" is not prefix=base: the prefix ends with "/".'],
        [{ setup: [] }, 'The setup command must be words, like "bun install".'],
        [{ protectedBranches: [7] }, "The protected branches must be a list of branch names."],
        [{ guards: { guardMainFolder: true } }, "guards.sessionNames is true or false."],
        [{ engine: "git" }, 'The worktree engine is "plugin" or "own".'],
      ];
      for (const [override, why] of cases) {
        const answer = await world.post(
          "project.preview",
          { answers: formAnswers(override) },
          csrf,
        );
        expect(answer.status).toBe(400);
        expect(JSON.parse(answer.body).lines[0]).toContain(why);
      }
      expect(workflow.calls.planProjectInit).toEqual([]);
      expect(workflow.calls.applyProjectInit).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the preview is the module's own plan, made from the form over the project's defaults", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow({
      defaults: {
        answers: { ...fakeDefaults().answers, workflow: { openPr: "draft" } },
      },
    });
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow,
    });
    try {
      await world.enter();
      const answer = await world.post(
        "project.preview",
        { answers: formAnswers() },
        await world.csrfOf(),
      );
      expect(answer.status).toBe(200);
      const body = JSON.parse(answer.body);
      expect(body.ok).toBe(true);
      // Written by hand: the form's fields, over the workflow policy the project's file holds
      // — the browser never sends that one, and could not change it if it did.
      expect(workflow.calls.planProjectInit).toEqual([
        {
          answers: MERGED_ANSWERS,
          existing: PROJECT_CONFIG,
          existingSettings: null,
          root: world.cwd,
        },
      ]);
      // The answer is that plan, exactly: the two file names, the file's own text, and no
      // lines for an engine of the project's own.
      expect(body.preview).toEqual({
        changed: true,
        diff: ['+ worktrees.base: "trunk"'],
        file: join(world.cwd, ".claude", "cc-smart-dev-kit.json"),
        hookLines: [],
        notes: [],
        removedLines: [],
        settingsChanged: false,
        settingsFile: join(world.cwd, ".claude", "settings.json"),
        settingsText: "\n",
        text: `${JSON.stringify(MERGED_ANSWERS, null, 2)}\n`,
      });
      // A preview is a plan: nothing was written.
      expect(workflow.calls.applyProjectInit).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("writing asks first, calls the module's own write once, and commits nothing", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({ backendPort: backend.port, projectFiles: {}, workflow });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      // Without the page's own yes, nothing is written.
      const no = await world.post("project.write", { answers: formAnswers() }, csrf);
      expect(JSON.parse(no.body).ok).toBe(false);
      expect(workflow.calls.applyProjectInit).toEqual([]);
      // With it: one call, the same plan, under the one state folder backups go in. The hash
      // is the one the page planned against (`project.preview`'s answer, or the form).
      const onPage =
        /data-files-hash="([^"]+)"/.exec((await world.call("/machine")).body)?.[1] ?? "";
      expect(onPage).not.toBe("");
      const hash = JSON.parse(
        (await world.post("project.preview", { answers: formAnswers() }, csrf)).body,
      ).filesHash;
      expect(hash).toBe(onPage);
      const yes = await world.post(
        "project.write",
        { answers: formAnswers(), confirm: true, previewHash: hash },
        csrf,
      );
      expect(yes.status).toBe(200);
      expect(JSON.parse(yes.body).ok).toBe(true);
      expect(workflow.calls.applyProjectInit.length).toBe(1);
      const call = workflow.calls.applyProjectInit[0];
      expect(call?.options).toEqual({ stateDir: world.paths.stateDir });
      expect(call?.plan.file).toBe(join(world.cwd, ".claude", "cc-smart-dev-kit.json"));
      expect(JSON.parse(yes.body).lines).toEqual([
        `+ ${join(world.cwd, ".claude", "cc-smart-dev-kit.json")}`,
        "Commit both files with the project: the team shares one setup.",
      ]);
      // The portal itself never writes the repo: the module does, and this test's module is a
      // fake — so the file is still not there.
      expect(existsSync(join(world.cwd, ".claude", "cc-smart-dev-kit.json"))).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a write on a stale preview is refused, and nothing is written", async () => {
    // The form holds the whole file it would write — the protected branches, the bases, the
    // guards — so a field filled in from a plan made before someone else edited the project's
    // file would write their change away, silently. The page sends back the hash its preview
    // carried, and a file that changed since is refused.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow,
    });
    const configFile = join(world.cwd, ".claude", "cc-smart-dev-kit.json");
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const preview = JSON.parse(
        (await world.post("project.preview", { answers: formAnswers() }, csrf)).body,
      ) as { filesHash: string };
      expect(typeof preview.filesHash).toBe("string");

      // Someone else (or another session) edits the project's file.
      writeFileSync(configFile, `${PROJECT_CONFIG.trimEnd()}\n\n`);
      const refused = await world.post(
        "project.write",
        { answers: formAnswers(), confirm: true, previewHash: preview.filesHash },
        csrf,
      );
      expect(refused.status).toBe(400);
      expect(JSON.parse(refused.body).lines).toEqual([
        "The project's files changed since the preview — preview again.",
      ]);
      expect(workflow.calls.applyProjectInit).toEqual([]);
      // Nothing was written: the file is the one the other person left.
      expect(readFileSync(configFile, "utf8")).toBe(`${PROJECT_CONFIG.trimEnd()}\n\n`);

      // A fresh preview matches again, and the write goes through.
      const again = JSON.parse(
        (await world.post("project.preview", { answers: formAnswers() }, csrf)).body,
      ) as { filesHash: string };
      expect(again.filesHash).not.toBe(preview.filesHash);
      const written = await world.post(
        "project.write",
        { answers: formAnswers(), confirm: true, previewHash: again.filesHash },
        csrf,
      );
      expect(JSON.parse(written.body).ok).toBe(true);
      expect(workflow.calls.applyProjectInit.length).toBe(1);

      // And a write that carries no hash at all — a hand-made POST — is refused the same way.
      const bare = await world.post(
        "project.write",
        { answers: formAnswers(), confirm: true },
        csrf,
      );
      expect(JSON.parse(bare.body).lines[0]).toContain("changed since the preview");
      expect(workflow.calls.applyProjectInit.length).toBe(1);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("an engine of the project's own shows the settings lines it takes back out", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    // The project's own file says `"own"`: that is the form's first answer, and the plan the
    // page draws from it is the one that takes the plugin's lines back out.
    const workflow = fakeWorkflow({
      defaults: { answers: { ...fakeDefaults().answers, engine: "own" } },
    });
    const world = await open({
      backendPort: backend.port,
      projectFiles: {
        config: PROJECT_CONFIG,
        settings:
          '{\n  "hooks": {\n    "WorktreeCreate": [{ "hooks": [{ "type": "command", "command": "$HOME/.local/bin/cc-smart-dev-kit hook worktree-create", "timeout": 600 }] }]\n  }\n}\n',
      },
      workflow,
    });
    try {
      await world.enter();
      const page = await world.call("/machine");
      // The preview box shows what the file loses, a "-" line the way a diff reads, and the
      // note under it counts the removal — the same sentence the preview's answer carries.
      expect(page.body).toContain(
        "- WorktreeCreate: cc-smart-dev-kit hook worktree-create (timeout 600 s)",
      );
      expect(page.body).toContain(
        "1 line removed, the plugin&#39;s own hooks. Nothing else there changes.",
      );
      // The plugin's added lines are not shown for this engine: they are what goes out.
      expect(page.body).not.toContain("WorktreeCreate: $HOME/.local/bin");
      expect(workflow.calls.planProjectInit[0]?.answers.engine).toBe("own");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the preview follows the typing, and a preview that works clears the last refusal", () => {
    // The text boxes asked only on `change` (a box losing the focus), so the plan sat still
    // while the words changed. A pause in the typing (300 ms) now asks the same server route;
    // the server stays the only builder of the plan.
    expect(PORTAL_JS).toContain("var PREVIEW_TYPING_MS = 300;");
    expect(PORTAL_JS).toContain('form.addEventListener("input"');
    expect(PORTAL_JS).toContain('node.type !== "text"');
    expect(PORTAL_JS).toContain(
      "typing = setTimeout(function () { typing = null; ask(); }, PREVIEW_TYPING_MS);",
    );
    expect(PORTAL_JS).toContain('post("/api/project.preview"');
    // A finished edit cancels a pause still waiting, so one edit is one answer.
    expect(PORTAL_JS).toContain("var settled = function () {");
    expect(PORTAL_JS).toContain(
      'form.addEventListener("change", function () { settled(); ask(); });',
    );
    // And the form's own status box is cleared by a preview that worked: a refusal from an
    // earlier edit must not sit under a plan that is fine now.
    expect(PORTAL_JS).toContain('writeOut.textContent = "";');
    expect(PORTAL_JS).toContain('writeOut.className = "";');
    // The write takes the hash with it, and the form carries the first one.
    expect(PORTAL_JS).toContain("body.previewHash = filesHash;");
    expect(PORTAL_JS).toContain('form.getAttribute("data-files-hash")');
  });

  test("a folder that is not a git project says so, and offers no form", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({ backendPort: backend.port, workflow });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.status).toBe(200);
      expect(page.body).toContain("The project cannot be read:");
      expect(page.body).toContain("this folder is not inside a git project");
      expect(page.body).not.toContain("data-setup-show");
      expect(workflow.calls.projectInitDefaults).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the new routes and actions are behind the same door", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow,
    });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const bodies: [string, unknown][] = [
        ["workflow.set", { key: "openPr", value: "draft" }],
        ["project.preview", { answers: formAnswers() }],
        ["project.write", { answers: formAnswers(), confirm: true }],
      ];
      for (const [action, body] of bodies) {
        // A browser that never held the session.
        const fresh = await world.call(`/api/${action}`, {
          body,
          headers: { origin: `http://127.0.0.1:${world.portal.port}`, "x-ccsdk-csrf": csrf },
          noCookie: true,
        });
        expect(fresh.status).toBe(403);
        // A page that is not ours, with a session that is.
        const foreign = await world.call(`/api/${action}`, {
          body,
          headers: { origin: "http://evil.example", "x-ccsdk-csrf": csrf },
        });
        expect(foreign.status).toBe(403);
        // Our own page, but without the token that came with it.
        const noToken = await world.call(`/api/${action}`, {
          body,
          headers: { origin: `http://127.0.0.1:${world.portal.port}` },
        });
        expect(noToken.status).toBe(403);
      }
      // Not one of the refused calls reached the module.
      expect(workflow.calls.writePersonalSetting).toEqual([]);
      expect(workflow.calls.writeProjectSetting).toEqual([]);
      expect(workflow.calls.planProjectInit).toEqual([]);
      expect(workflow.calls.applyProjectInit).toEqual([]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

// ── The real workflow module ────────────────────────────────────────────────────

/** A project's file with everything the 0.4.0 core reads: the policy, the bases, the engine. */
const FULL_PROJECT_CONFIG = `${JSON.stringify(
  {
    requires: ">=0.3",
    worktrees: {
      base: "integration",
      prefix: "app-wt-",
      setup: ["bun", "install"],
      bases: { "release/": "main" },
      engine: "own",
    },
    protectedBranches: ["main", "integration"],
    sessionNames: true,
    jobs: { route: true },
    workflow: { autoCommit: true, openPr: "draft", alerts: { sound: true } },
  },
  null,
  2,
)}\n`;

describe("the real workflow module", () => {
  test("a project file with a workflow policy, bases and an engine", async () => {
    // No fake here: `workflowAdapter` is the real module, so this one test proves the portal
    // reads a 0.4.0 project's file — `workflow`, `worktrees.bases` and `worktrees.engine` —
    // through the CLI's own code. It runs git in the temp repo, and never `gh`: the test's
    // environment has no PATH for it.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: FULL_PROJECT_CONFIG },
      workflow: workflowAdapter,
    });
    try {
      await world.enter();
      const settings = await world.call("/settings");
      expect(settings.status).toBe(200);
      // The project's file parsed, so there is no "no project's own values" line.
      expect(settings.body).not.toContain("No project&#39;s own values here");
      // Every row the file sets is the project's, read-only here, with the file's own value:
      // `autoCommit: true`, `openPr: "draft"`, `alerts.sound: true`, `sessionNames: true` and
      // `jobs.route: true`.
      expect(settings.body).toContain('<span class="src project">this project</span>');
      for (const row of ["set-commit", "set-names", "set-jobs", "set-sound"]) {
        expect(settings.body).toContain(
          `role="switch" aria-checked="true" aria-labelledby="${row}" class="switch" disabled`,
        );
      }
      expect(settings.body).toContain(
        '<button type="button" aria-pressed="true" disabled>Draft</button>',
      );

      // The card's form starts from the project's own file: its base row, and its engine.
      const machine = await world.call("/machine");
      expect(machine.status).toBe(200);
      expect(machine.body).toContain('data-base-prefix value="release/"');
      expect(machine.body).toContain('data-base-value value="main"');
      expect(machine.body).toContain('aria-pressed="true" data-engine-value="own"');
      // The preview is the CLI's own plan with the file's fields in it: the policy it keeps,
      // the bases, and the engine of the project's own (so no line is added to the settings).
      expect(machine.body).toContain("&quot;workflow&quot;: {");
      expect(machine.body).toContain("&quot;release/&quot;: &quot;main&quot;");
      expect(machine.body).toContain("&quot;engine&quot;: &quot;own&quot;");
      expect(machine.body).toContain("No line is added to .claude/settings.json.");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

// ── The Browser card ────────────────────────────────────────────────────────────

describe("the browser card", () => {
  test("it carries the guide, the setup button, a masked token field, and doctor's own lines", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      await world.enter();
      const page = await world.call("/machine");
      expect(page.status).toBe(200);
      expect(page.body).toContain('id="browser"');
      expect(page.body).toContain("Set up the browser");
      expect(page.body).toContain('data-action="browser.setup"');
      // The field is masked, and it starts empty: the stored token is never on a page.
      expect(page.body).toContain('type="password"');
      expect(page.body).toContain("data-token-input");
      expect(page.body).toContain("data-token-save");
      // The same words as `browser setup`: the steps, and the address to switch file URLs on.
      expect(page.body).toContain("Allow access to file URLs");
      expect(page.body).toContain("chrome://extensions/?id=");
      expect(page.body).toContain("browser token");
      // Doctor's browser lines are here (this machine has a Chrome, but not the profile yet),
      // and NOT repeated in the Doctor card's list.
      expect(page.body).toContain("the Chrome profile &quot;claude-code&quot; is not in");
      expect(
        (page.body.match(/the Chrome profile &quot;claude-code&quot; is not in/g) ?? []).length,
      ).toBe(1);
    } finally {
      world.portal.stop();
    }
  });

  test("saving a token writes the same file the command writes, and never echoes it", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const token = `${"A".repeat(40)}_-b`;
      const saved = await world.post(
        "browser.token",
        { token: `PLAYWRIGHT_MCP_EXTENSION_TOKEN=${token}` },
        csrf,
      );
      expect(saved.status).toBe(200);
      expect(JSON.parse(saved.body)).toEqual({
        lines: [
          `+ ${world.paths.browserTokenFile}: the browser token is set (mode 600)`,
          "Start a new Claude session (or restart the running one) to use it.",
        ],
        ok: true,
      });
      expect(saved.body).not.toContain(token);
      expect(readFileSync(world.paths.browserTokenFile, "utf8")).toBe(`${token}\n`);
      expect(statSync(world.paths.browserTokenFile).mode & 0o777).toBe(0o600);

      // The page says a token is set, and still holds no value.
      const page = await world.call("/machine");
      expect(page.body).toContain("a token is set");
      expect(page.body).not.toContain(token);
    } finally {
      world.portal.stop();
    }
  });

  test("a token that is not the extension's is refused, and nothing is written", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const refused = await world.post("browser.token", { token: "half-a-token" }, csrf);
      // A refused action answers 400, with its own lines — the same shape as every action.
      expect(refused.status).toBe(400);
      const answer = JSON.parse(refused.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(false);
      expect(answer.lines[0]).toContain("not saved");
      expect(answer.lines[0]).toContain("43");
      expect(existsSync(world.paths.browserTokenFile)).toBe(false);
    } finally {
      world.portal.stop();
    }
  });

  test("the setup button runs browser setup in the profile, and prints the steps that are left", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      const ran = await world.post("browser.setup", {}, csrf);
      const answer = JSON.parse(ran.body) as { lines: string[]; ok: boolean };
      const lines = answer.lines.join("\n");
      // Chrome is opened on the Web Store page in the claude-code profile (the fake machine
      // records the call and starts nothing), and the guide follows.
      expect(lines).toContain("--profile-directory=claude-code");
      expect(lines).toContain("--new-window");
      expect(lines).toContain("Allow access to file URLs");
      expect(lines).toContain("browser token");
    } finally {
      world.portal.stop();
    }
  });

  test("the five steps are one numbered list, each address in a copy box of its own", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      await world.enter();
      const page = await world.call("/machine");
      // One column, numbered: never the doctor's two-column `.checks` grid, which read the
      // steps left, right, left, right, numbered none of them, and squeezed the last one
      // ("Save it.", "✓ done") into a sliver of a column (the owner's screenshots,
      // 040-browser-1440-light.png and 040-browser-390-light.png).
      expect(page.body).toContain('<ol class="guide">');
      const guide = /<ol class="guide">([\s\S]*?)<\/ol>/.exec(page.body)?.[1] ?? "";
      expect(guide).not.toBe("");
      expect(guide).not.toContain('class="checks"');
      // Five steps, each one an item of its own, in the guide's own order.
      const steps = [...guide.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1] ?? "");
      expect(steps.length).toBe(5);
      expect(steps[0]).toContain("Add to Chrome");
      expect(steps[1]).toContain("Allow access to file URLs");
      expect(steps[4]).toContain("Save it:");
      // The address the person has to paste is on a line of its own, in a code box with a Copy
      // button — not inline in a sentence, where the narrow column broke it mid-word.
      expect(guide).toContain(
        "<pre data-guide-2>chrome://extensions/?id=mmlmfjhmonkocbjadbfplnigmagldckm</pre>",
      );
      expect(guide).toContain('data-copy-node="[data-guide-2]"');
      // The last step's command is in a box of the same kind, and the box holds the command
      // alone, so its Copy button copies something a terminal can run.
      expect(guide).toContain("<pre data-guide-5>cc-smart-dev-kit browser token</pre>");
      // The old shape — an inline code element under a `<br>`, inside the doctor's grid — is
      // gone from the whole page.
      expect(page.body).not.toContain('<ol class="checks">');
      expect(page.body).not.toContain('class="mono wrap-any">chrome://');
    } finally {
      world.portal.stop();
    }
  });

  test("a step this machine can check says so, after its sentence", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      await world.enter();
      // The profile with the extension in it, file URLs on, and a token saved: the three steps
      // the machine can answer for are done, and the guide says so where the step is read.
      const profile = join(world.home, ".config", "google-chrome", CLAUDE_CODE_PROFILE);
      mkdirSync(join(profile, "Extensions", PLAYWRIGHT_EXTENSION_ID, "1.0"), { recursive: true });
      writeFileSync(
        join(profile, "Preferences"),
        JSON.stringify({
          extensions: { settings: { [PLAYWRIGHT_EXTENSION_ID]: { newAllowFileAccess: true } } },
        }),
      );
      mkdirSync(dirname(world.paths.browserTokenFile), { recursive: true });
      writeFileSync(world.paths.browserTokenFile, `${"A".repeat(43)}\n`, { mode: 0o600 });

      const page = await world.call("/machine");
      const guide = /<ol class="guide">([\s\S]*?)<\/ol>/.exec(page.body)?.[1] ?? "";
      const steps = [...guide.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1] ?? "");
      // The sentence first, then its own ✓ done, and never the other way round.
      expect(steps[0]).toContain("Add to Chrome");
      expect(steps[0]).toContain('<span class="ok">✓ done</span>');
      expect(steps[0]?.indexOf("Add to Chrome")).toBeLessThan(steps[0]?.indexOf("✓ done") ?? -1);
      expect(steps[1]).toContain("✓ done");
      expect(steps[4]).toContain("✓ done");
      // The two steps a person does by hand carry no mark: nothing checks the pinning.
      expect(steps[2]).not.toContain("✓ done");
      expect(steps[3]).not.toContain("✓ done");
      expect(page.body).toContain("It is set up.");
    } finally {
      world.portal.stop();
    }
  });

  test("every Copy button reaches its own box: the selector is an attribute, not a tag name", async () => {
    // Written for a bug: the button carried `data-copy-node="data-preview-file"`, and
    // `querySelector("data-preview-file")` looks for an element whose TAG is that name. It
    // matched nothing, so the button returned before copying and did nothing at all — on the
    // Project card's two previews, and on every step of the guide.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
    });
    try {
      await world.enter();
      const pages = await Promise.all([world.call("/machine"), world.call("/settings")]);
      let copies = 0;
      for (const page of pages) {
        for (const [, selector] of page.body.matchAll(/data-copy-node="([^"]+)"/g)) {
          copies += 1;
          const attribute = selector ?? "";
          expect(attribute.startsWith("[data-")).toBe(true);
          expect(attribute.endsWith("]")).toBe(true);
          // And the box it names is on the same page.
          expect(page.body).toContain(`${attribute.slice(1, -1)}>`);
        }
      }
      // The guide's two addresses and commands, and the Project card's two previews.
      expect(copies).toBeGreaterThanOrEqual(4);
      expect(PORTAL_JS).toContain('document.querySelector(button.getAttribute("data-copy-node"))');
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the token file's protection is said in words true on this platform", async () => {
    const linux = await open({ backendPort: 0, withConfig: false });
    try {
      await linux.enter();
      const page = await linux.call("/machine");
      expect(page.body).toContain("mode 600: readable only by you");
    } finally {
      linux.portal.stop();
    }
    // Windows has no `chmod`: what keeps that file to one person is the ACL of the profile
    // folder it sits in, and the same paragraph must not claim a mode there.
    const windows = await open({ backendPort: 0, withConfig: false, platform: "win32" });
    try {
      await windows.enter();
      const page = await windows.call("/machine");
      expect(page.body).toContain("in your own user profile, where only you can read it");
      expect(page.body).not.toContain("(mode 600)");
    } finally {
      windows.portal.stop();
    }
  });

  test("an empty paste with a token saved is not an alarm: the token is unchanged", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      await world.enter();
      const csrf = await world.csrfOf();
      // No token yet: nothing was saved and the browser does not work, so it stays a refusal.
      const none = await world.post("browser.token", { token: "" }, csrf);
      const noneBody = JSON.parse(none.body) as { lines: string[]; tone?: string };
      expect(noneBody.tone).toBeUndefined();
      expect(noneBody.lines[0]).toContain("The token was not saved");

      const token = "B".repeat(43);
      expect((await world.post("browser.token", { token }, csrf)).status).toBe(200);
      const empty = await world.post("browser.token", { token: "   " }, csrf);
      // The fact, not an alarm: "the token was not saved" would read as though the saved one
      // had gone, when nothing happened at all.
      expect(JSON.parse(empty.body)).toEqual({
        lines: ["Nothing was pasted, so the saved token is unchanged."],
        ok: false,
        tone: "info",
      });
      expect(empty.body).not.toContain(token);
      expect(readFileSync(world.paths.browserTokenFile, "utf8")).toBe(`${token}\n`);
      // And the page draws that tone in its own class, never the failure one.
      expect(PORTAL_JS).toContain('tone === "info" ? "status-info" : "status-bad"');
      expect(PORTAL_CSS).toContain(".status-info");
    } finally {
      world.portal.stop();
    }
  });

  test("the card is behind the same door as everything else", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      // No session: the action is refused, and nothing is written.
      const refused = await world.call("/api/browser.token", { body: { token: "A".repeat(43) } });
      expect(refused.status).toBe(403);
      expect(existsSync(world.paths.browserTokenFile)).toBe(false);
    } finally {
      world.portal.stop();
    }
  });
});
