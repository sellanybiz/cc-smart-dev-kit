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
import { VERSION } from "../build-info";
import { cliPaths } from "../cli/paths";
import { addCrewQuestion, createCrew, type NewCrew, readCrew } from "../crew/store";
import { upgradeConfig } from "../gateway/commands";
import { loadConfigFile, saveConfig } from "../gateway/config";
import { createHistoryWriter, type HistoryRow } from "../gateway/history";
import { askLogFile } from "../hooks/ask-log";
import { currentFileHolder } from "../jobs/store";
import type { Machine } from "../machine/machine";
import { parseCcSmartDevKitConfig } from "../project/config";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { git, tempDir } from "../testing/temp";
import { isOlder } from "../update/check";
import { updateFiles, writeHeldMajor } from "../update/state";
import { ACTION_NAMES, type DoctorSource, portalOmnirouteContext } from "./actions";
import { NO_SESSION_RECORDS } from "./api/projects";
import { PORTAL_CSS, PORTAL_JS, THEME_JS } from "./assets";
import type { PortalContext } from "./context";
import { omnirouteRow } from "./facts";
import { LiveHub, PING_MS } from "./live/hub";
import { switchButton } from "./page";
import type { PluginFolder } from "./plugin-folder";
import { startPortal } from "./server";
import { autoModeCard } from "./views";
import { type ProjectInitAnswers, type WorkflowAdapter, workflowAdapter } from "./workflow-adapter";

/** Real SHA-256 values in base64 (of "", "foo"), written by hand: `csp.json` takes only hashes. */
const ATTR_HASH = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const ELEM_HASH = "LCa0a2j/xo/5m0U8HTBBNBNCLXBkg7+g+YpeiGJm564=";

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
  /**
   * A user name and password in the backend's address (`user:pass@`): a URL can carry a
   * credential there, and no page may show it.
   */
  backendUserinfo?: string;
  /** A doctor source of this test's own, for the cases a real folder cannot produce. */
  doctor?: DoctorSource;
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
  projectFiles?: { config?: string; localSettings?: string; settings?: string };
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
  /** True: the portal finds git on its PATH (the real one), and nothing else. */
  gitOnPath?: boolean;
  /** More environment for the portal (a fake `claude` and its PATH, a config folder). */
  env?: Record<string, string>;
  /**
   * The Next.js export's folder (D49). Left out: none is served, and the server-rendered
   * pages answer as they always did; `null` says the same in words.
   */
  staticFolder?: null | string;
  /**
   * The router's journal lines this machine's `journalctl --user -u cc-smart-dev-kit-router -o
   * json` answers, OLDEST FIRST as the real one prints them. One minute apart, from 09:00 UTC.
   */
  journal?: { level: "ERROR" | "INFO" | "WARN"; text: string }[];
  /** The workflow module behind the adapter; a fake by default, never a real file or repo. */
  workflow?: WorkflowAdapter;
  withConfig?: boolean;
  /** The clock the portal reads; a test that asserts exact history buckets fixes it. */
  now?: () => number;
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
    if (options.projectFiles.localSettings !== undefined) {
      writeFileSync(
        join(cwd, ".claude", "settings.local.json"),
        options.projectFiles.localSettings,
      );
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
      backends: {
        omniroute: {
          apiKey: KEY,
          baseUrl: `http://${options.backendUserinfo === undefined ? "" : `${options.backendUserinfo}@`}127.0.0.1:${options.backendPort}`,
        },
      },
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
    env: {
      HOME: home,
      ...(options.noGit === true ? { PATH: "/nonexistent" } : {}),
      ...options.env,
    },
    fetch: async (url, init) => {
      if (String(url).includes("registry.npmjs.org")) return registry();
      // The fake backend on a free port of this test; never the live router's port.
      return fetch(url, init);
    },
    machine,
    now: options.now ?? (() => Date.now()),
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
    runner: (cmd) => {
      if (options.systemd !== true) return { exitCode: 1, output: `no ${cmd[0]} here` };
      if (cmd[0] === "systemctl") return { exitCode: 0, output: "" };
      // The router's journal, as `journalctl -o json` prints it: one JSON object per line, in
      // the journal's own order (oldest first). `__REALTIME_TIMESTAMP` is microseconds.
      if (cmd[0] === "journalctl") {
        const at = Date.UTC(2026, 9, 17, 9, 0, 0);
        const lines = (options.journal ?? []).map((one, index) =>
          JSON.stringify({
            __REALTIME_TIMESTAMP: String((at + index * 60_000) * 1000),
            MESSAGE: `${one.level} ${one.text}`,
            PRIORITY: one.level === "ERROR" ? "3" : one.level === "WARN" ? "4" : "6",
          }),
        );
        return { exitCode: 0, output: lines.join("\n") };
      }
      return { exitCode: 1, output: `no ${cmd[0]} here` };
    },
    // No system folders of the host: a real `/usr/lib/node_modules/omniroute` is not this test.
    systemFolders: [],
    systemd: options.systemd === true,
    // No program on PATH, unless the test needs git itself (the auto-mode rules are read
    // from the project's checkout).
    which: (name) => (options.gitOnPath === true && name === "git" ? Bun.which("git") : null),
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
    port: 0,
    // No poller in a test: the live stream's sources are driven by their own test
    // (`src/portal/live/sources.test.ts`), so no timer runs beside an assertion here.
    livePollMs: 0,
    ...(options.staticFolder === undefined
      ? { staticFolder: null }
      : { staticFolder: options.staticFolder }),
    workflow: options.workflow ?? fakeWorkflow(),
  });

  const call = async (
    path: string,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
      method?: string;
    } = {},
  ): Promise<{ body: string; headers: Headers; status: number }> => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`http://127.0.0.1:${portal.port}${path}`, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers,
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    });
    return { body: await response.text(), headers: response.headers, status: response.status };
  };
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
    csrfOf,
    ctx,
    /** The folder the portal was started in: the project its Project card is about. */
    cwd,
    home,
    /** The context the server's actions use for OmniRoute (`portalOmnirouteContext`). */
    omnirouteCtx: () => portalOmnirouteContext(ctx),
    paths,
    portal,
    post,
  };
}

// ── The door ────────────────────────────────────────────────────────────────────

describe("the door", () => {
  test("there is no sign-in (D9): a page load from this machine is served, and it hands out no cookie", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const first = await world.call("/");
      expect(first.status).toBe(200);
      // No token, no session, no cookie: the door is the network rules and the CSRF token.
      expect(first.headers.get("set-cookie")).toBe(null);
      expect(first.body).toContain('name="ccsdk-csrf"');
      expect(first.body).not.toContain("ccsdk_portal");
      // The second load is served too: nothing is one-time any more.
      expect((await world.call("/")).status).toBe(200);
      // And the address carries no secret.
      expect(world.portal.url).toBe(`http://127.0.0.1:${world.portal.port}/`);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("every page is served to this machine, and the assets with them", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      for (const path of ["/", "/slots", "/health", "/machine", "/settings", "/privacy"]) {
        expect((await world.call(path)).status).toBe(200);
      }
      expect((await world.call("/assets/portal.css")).status).toBe(200);
      expect((await world.call("/assets/portal.js")).status).toBe(200);
      expect((await world.call("/assets/theme.js")).status).toBe(200);
      // Only the files the page needs: an invented asset is refused like a stranger.
      expect((await world.call("/assets/anything.js")).status).toBe(403);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("PB-9: another page cannot load anything of the portal's", async () => {
    // A page on another 127.0.0.1 port is the SAME site, so without `Sec-Fetch-Site` its
    // `<img src>` was served. A browser says where a request comes from in that header.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const sub = (site: string) => ({ "sec-fetch-mode": "no-cors", "sec-fetch-site": site });
      for (const site of ["same-site", "cross-site"]) {
        expect((await world.call("/", { headers: sub(site) })).status).toBe(403);
        expect((await world.call("/assets/portal.css", { headers: sub(site) })).status).toBe(403);
      }
      // The portal's own page asks same-origin; a typed address or a bookmark asks with none;
      // a request with no such header is not from a browser that sends it.
      expect((await world.call("/assets/portal.css", { headers: sub("same-origin") })).status).toBe(
        200,
      );
      expect((await world.call("/", { headers: sub("none") })).status).toBe(200);
      expect((await world.call("/")).status).toBe(200);
      // A link the person follows from another page is a navigation, and it is served.
      expect(
        (
          await world.call("/", {
            headers: { "sec-fetch-mode": "navigate", "sec-fetch-site": "same-site" },
          })
        ).status,
      ).toBe(200);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a Host that is not exactly ours is refused: where DNS rebinding stops", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
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

  test("a POST with the token but no Origin is refused", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
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
      const response = await world.call("/api/switch");
      expect(response.status).toBe(405);
      expect(response.body).toContain("An action is a POST");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a route that is not ours is a 404 page, and holds nothing of the machine", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const response = await world.call("/nowhere");
      expect(response.status).toBe(404);
      expect(response.body).toContain("This page is not here.");
      expect(response.body).toContain("cc-smart-dev-kit portal");
      expect(response.body).not.toContain("ccsdk-csrf");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the health answer names the portal, its pid and its version; a POST to it changes nothing", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const answer = await world.call("/healthz");
      expect(answer.status).toBe(200);
      expect(answer.headers.get("content-type")).toContain("application/json");
      expect(JSON.parse(answer.body)).toEqual({
        app: "cc-smart-dev-kit-portal",
        ok: true,
        pid: process.pid,
        version: VERSION,
      });
      // It is a read: no method but GET is answered, and it carries no page.
      expect((await world.call("/healthz", { method: "POST" })).status).toBe(403);
      // The same network rules judge it: a foreign Host never reaches it.
      expect((await world.call("/healthz", { headers: { host: "evil.example" } })).status).toBe(
        403,
      );
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a Host or Origin that is not ours stays the plain word, never a page", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
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
      const page = await world.call("/");
      expect(page.body).toContain('<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">');
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
      const first = await world.call("/");
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
    // With an OmniRoute installed, so its own card and its own facts are drawn too — and a
    // password in the backend's address (PB-7): the Overview's dashboard link took it raw.
    const world = await open({
      backendPort: backend.port,
      backendUserinfo: "planted-user:PLANTED_PASSWORD",
      omniroute: "3.8.51",
    });
    try {
      const first = await world.call("/");
      for (const path of ["/", "/slots", "/health", "/machine", "/settings", "/privacy"]) {
        const page = await world.call(path);
        expect(page.body).not.toContain(KEY);
        // The masked form may appear; the whole key never does, nor the address's password.
        expect(page.body).not.toContain("PLANTED");
        expect(page.body).not.toContain("planted-user");
      }
      // PB-7: the dashboard link is still there, at the address without its credential.
      expect((await world.call("/")).body).toContain(
        `href="http://127.0.0.1:${backend.port}/" rel="noreferrer">OmniRoute dashboard`,
      );
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

  test("PB hunch 3: a backend's own error text is masked before a page or an answer holds it", async () => {
    // A backend that echoes the key it was sent: in a model list that is not JSON (the parser's
    // message quotes it), and in a chat's error body. Both reached a page as they came.
    let echo: "chat" | "models" = "models";
    const server = Bun.serve({
      fetch: (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/v1/models") {
          if (echo === "models") return new Response(`${KEY} is not a key of ours`);
          return Response.json({ data: [{ id: "glm-5.3-flash" }] });
        }
        return new Response(`{"error":"bad key ${KEY}"}`, { status: 500 });
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    const world = await open({ backendPort: server.port ?? 0 });
    try {
      await world.call("/");
      for (const path of ["/slots", "/health"]) {
        const page = await world.call(path);
        // The reason is still there for the person to act on, without the key in it.
        expect(page.body).toContain("JSON Parse error");
        expect(page.body).not.toContain(KEY);
        expect(page.body).not.toContain("PLANTED");
      }
      expect((await world.call("/")).body).not.toContain("PLANTED");
      const csrf = await world.csrfOf();
      const listed = await world.post(
        "slot.test",
        { slot: "worker", targets: ["omniroute:glm-5.3-flash"] },
        csrf,
      );
      expect(listed.body).toContain("JSON Parse error");
      expect(listed.body).not.toContain("PLANTED");
      echo = "chat";
      const chatted = await world.post(
        "slot.test",
        { slot: "worker", targets: ["omniroute:glm-5.3-flash"] },
        csrf,
      );
      expect(chatted.body).toContain("answered HTTP 500");
      expect(chatted.body).not.toContain("PLANTED");
    } finally {
      world.portal.stop();
      server.stop(true);
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
    expect(PORTAL_JS).toContain(
      "The portal is not answering. Check cc-smart-dev-kit portal status.",
    );
    // Nothing cleans a token out of the URL any more: there is no token (D9).
    expect(PORTAL_JS).not.toContain("replaceState");
    expect(PORTAL_JS).not.toContain("?t=");
  });

  test("each page renders its own heading, and the header says the router is up", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
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
        expect(page.body).toContain("Any program or account on this machine can open it");
        expect(page.body).toContain("It stays up while Claude Code runs");
        expect(page.body).toContain(`Bun 1.4.3`);
      }
      expect((await world.call("/")).body).toContain("Router running");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the log is NEWEST FIRST on both pages, with the times as they are", async () => {
    // Live, 2026-10-17 (the owner): the log read top down as the journal prints it — oldest
    // first — so the newest line, the one a person opens the page for, sat at the bottom.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      journal: [
        { level: "INFO", text: "the oldest line" },
        { level: "INFO", text: "a middle line" },
        { level: "WARN", text: "a warning in the middle" },
        { level: "ERROR", text: "the newest line" },
      ],
      systemd: true,
    });
    try {
      await world.call("/");
      const health = await world.call("/health");
      expect(health.status).toBe(200);
      const log = health.body.slice(health.body.indexOf('id="log-h"'));
      const order = [
        log.indexOf("the oldest line"),
        log.indexOf("a middle line"),
        log.indexOf("a warning in the middle"),
        log.indexOf("the newest line"),
      ];
      expect(order.every((at) => at >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => b - a));
      // The times are the journal's own (one minute apart, from 09:00), shown as they are —
      // `13:52:07`, or the date and the time when the line is not today — and they run the
      // same way as the lines: newest first.
      const times = [...log.matchAll(/<span class="muted">([^<]+)<\/span>/g)].map(
        (match) => match[1] ?? "",
      );
      expect(times).toHaveLength(4);
      expect(times.map((time) => time.slice(-5))).toEqual(["09:03", "09:02", "09:01", "09:00"]);

      // The Overview's "Latest warnings": the newest of them first, and only the newest three.
      const overview = await world.call("/");
      const warnings = overview.body.slice(overview.body.indexOf('id="warn-h"'));
      const warnOrder = [
        warnings.indexOf("a warning in the middle"),
        warnings.indexOf("the newest line"),
      ];
      expect(warnOrder.every((at) => at >= 0)).toBe(true);
      const [firstWarn = -1, secondWarn = -1] = warnOrder;
      expect(firstWarn).toBeGreaterThan(secondWarn);
      expect(warnings).not.toContain("the oldest line");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("no gateway config yet: the page that says what to run", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, withConfig: false });
    try {
      await world.call("/");
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
      await world.call("/");

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
      await world.call("/");

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
      await world.call("/");
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
        await world.call("/");

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
      await world.call("/");

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
      await world.call("/");
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

  test("the Claude login group also lists the ids the router saw Claude Code send", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // The state file the router writes: an id Claude Code sent, and a hand-edited key that
      // is not a Claude id (a page must not offer it).
      mkdirSync(dirname(world.paths.gatewayStateFile), { recursive: true });
      writeFileSync(
        world.paths.gatewayStateFile,
        JSON.stringify({
          fallbacks: {},
          limits: {},
          seenClaude: { "claude-opus-6-0": 1, "ignore-me-not-a-claude-id": 2 },
          version: 1,
        }),
        { mode: 0o600 },
      );
      const slots = await world.call("/slots");
      expect(slots.body).toContain("Claude login");
      expect(slots.body).toContain("claude-opus-6-0");
      expect(slots.body).not.toContain("ignore-me-not-a-claude-id");
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
      await world.call("/");
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
  test('every action a page may send is one the server runs: none answers "is not an action"', async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const csrf = await world.csrfOf();
      // An empty body: each action refuses its own missing inputs in words, and runs nothing
      // that changes the machine. `doctor.run` is the server's own, and runs a real pass.
      for (const name of ACTION_NAMES) {
        if (name === "doctor.run" || name === "router.restart" || name.startsWith("omniroute.")) {
          continue;
        }
        if (name === "update.check" || name === "update.install" || name === "browser.setup") {
          continue;
        }
        if (name === "switch" || name === "worktrees.clean" || name === "automode.apply") {
          continue;
        }
        const answer = JSON.parse((await world.post(name, {}, csrf)).body) as { lines: string[] };
        expect(answer.lines.join(" ")).not.toContain("is not an action");
      }
      // And a name that is not on the list is refused in those words.
      const unknown = JSON.parse((await world.post("slot.nope", {}, csrf)).body) as {
        lines: string[];
      };
      expect(unknown.lines).toEqual(['"slot.nope" is not an action.']);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a save over a chain that changed since the page read it is refused, and writes nothing", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const csrf = await world.csrfOf();
      const read = JSON.parse((await world.call("/api/slots")).body) as {
        slots: { mode: string; name: string; stamp: string; targets: { target: string }[] }[];
      };
      const worker = read.slots.find((one) => one.name === "worker");
      expect(worker?.mode).toBe("custom");
      const stamp = worker?.stamp ?? "";
      expect(stamp).toMatch(/^[0-9a-f]{16}$/);
      // Another tab saves first: the stamp the first page holds is now old.
      const other = await world.post(
        "slot.save",
        { slot: "worker", stamp, targets: ["omniroute:deepseek-v4.1-flash"] },
        csrf,
      );
      expect(JSON.parse(other.body).ok).toBe(true);
      const stale = await world.post(
        "slot.save",
        { slot: "worker", stamp, targets: ["omniroute:glm-5.3-flash"] },
        csrf,
      );
      expect(stale.status).toBe(400);
      expect(JSON.parse(stale.body).lines[0]).toBe(
        "This slot's chain changed since the page read it (another tab, or the command line), so nothing was saved.",
      );
      expect(
        loadConfigFile(world.paths.gatewayConfigFile).slots["cc-smart-dev-kit-worker"],
      ).toEqual(["omniroute:deepseek-v4.1-flash"]);
      // A stamp that is not a string is no chain's stamp either.
      const odd = await world.post(
        "slot.save",
        { slot: "worker", stamp: 7, targets: ["omniroute:glm-5.3-flash"] },
        csrf,
      );
      expect(odd.status).toBe(400);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the Slots answer says each slot's mode, its saved chain, and its breaker switch", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const csrf = await world.csrfOf();
      await world.post("slot.mode", { mode: "claude", slot: "worker" }, csrf);
      const off = await world.post("slot.breaker", { on: false, slot: "scout" }, csrf);
      expect(JSON.parse(off.body).ok).toBe(true);
      const slots = JSON.parse((await world.call("/api/slots")).body) as {
        slots: {
          breaker: boolean;
          kept: null | { fallback: boolean; targets: { target: string }[] };
          mode: string;
          name: string;
          role: string;
          targets: unknown[];
        }[];
      };
      const byName = Object.fromEntries(slots.slots.map((one) => [one.name, one]));
      expect(byName.worker?.mode).toBe("claude");
      expect(byName.worker?.role).toBe("affordable");
      expect(byName.worker?.targets).toEqual([]);
      expect(byName.worker?.kept?.targets.map((one) => one.target)).toEqual([
        "omniroute:deepseek-v4.1-flash",
        "claude-sonnet-5-5",
      ]);
      expect(byName.scout?.breaker).toBe(false);
      expect(byName.judge?.breaker).toBe(false);
      expect(loadConfigFile(world.paths.gatewayConfigFile).breaker).toEqual({
        "cc-smart-dev-kit-scout": false,
      });
      // The judge has no breaker switch: the command line's own refusal, in its words.
      const judge = await world.post("slot.breaker", { on: true, slot: "judge" }, csrf);
      expect(JSON.parse(judge.body).ok).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a typed target is checked as `gateway slot` checks it, before it joins a draft", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const csrf = await world.csrfOf();
      const check = async (target: string) =>
        JSON.parse((await world.post("slot.check", { target }, csrf)).body) as {
          lines: string[];
          ok: boolean;
        };
      expect(await check("omniroute:glm-5.3-flash")).toEqual({
        lines: ["omniroute:glm-5.3-flash: its backend lists it."],
        ok: true,
      });
      expect(await check("claude-opus-5-5")).toEqual({
        lines: ["claude-opus-5-5: on your own Claude login."],
        ok: true,
      });
      expect(await check("omnirout:glm-5.3")).toEqual({
        lines: [
          '"omnirout:glm-5.3": backend "omnirout" is not in the config. The config names: omniroute.',
        ],
        ok: false,
      });
      const missing = await check("omniroute:no-such-model");
      expect(missing.ok).toBe(false);
      expect(missing.lines[0]).toContain('"omniroute" has no model "no-such-model"');
      expect((await check("")).ok).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the hold switch really holds and resumes, and the page shows the CLI's own lines", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
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
      await world.call("/");
      const csrf = await world.csrfOf();
      const on = await world.post("switch", { name: "gateway", on: true }, csrf);
      const answer = JSON.parse(on.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      expect(answer.lines.join("\n")).toContain("ANTHROPIC_BASE_URL");
      const settings = JSON.parse(readFileSync(world.paths.settingsFile, "utf8")) as {
        env: Record<string, string>;
      };
      expect(settings.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:20199");
      // No model is pinned: Claude Code sends each model's own id, the router finds its slot.
      expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
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
      await world.call("/");
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

  test("opus saves a chain of one backend target, the CLI's own rule, as scout would", async () => {
    // Seen live: a person added omniroute:ollama-cloud/glm-5.3-flash to the opus slot, and
    // Save was refused ("start with the opus model itself").
    const backend = fakeBackend(["ollama-cloud/glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
      const csrf = await world.csrfOf();
      const saved = await world.post(
        "slot.save",
        { slot: "opus", targets: ["omniroute:ollama-cloud/glm-5.3-flash"] },
        csrf,
      );
      const answer = JSON.parse(saved.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      expect(answer.lines).toEqual([
        "cc-smart-dev-kit-opus: (new)",
        "  now: omniroute:ollama-cloud/glm-5.3-flash  (fallback off)",
        "The router uses it from its next request.",
      ]);
      const config = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        modelSlots?: unknown;
        slots: Record<string, string[]>;
      };
      expect(config.slots["cc-smart-dev-kit-opus"]).toEqual([
        "omniroute:ollama-cloud/glm-5.3-flash",
      ]);
      expect(config.modelSlots).toBeUndefined();
      // The slots page then shows it like any slot: no special first row, no plan-limit words.
      const slots = await world.call("/slots");
      expect(slots.body).not.toContain("the Claude model itself");
      expect(slots.body).not.toContain("plan limit");
      expect(PORTAL_JS).not.toContain("the Claude model itself");
      expect(PORTAL_JS).toContain("kept, not used: this slot's fallback is off");
      expect(PORTAL_JS).toContain("answers if the one above fails or rests");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a slot's fallback switch: set through `gateway fallback`, its state on the Slots page", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
      const csrf = await world.csrfOf();
      const saved = await world.post(
        "slot.save",
        { slot: "opus", targets: ["omniroute:glm-5.3-flash", "omniroute:deepseek-v4.1-flash"] },
        csrf,
      );
      expect(JSON.parse(saved.body).ok).toBe(true);
      // Off by default for opus: the page says so, and its switch turns it on.
      const before = await world.call("/slots");
      expect(before.body).toContain("&quot;opus&quot;:false");
      expect(before.body).toContain('data-fallback-for="opus" hidden');
      const on = await world.post("slot.fallback", { on: true, slot: "opus" }, csrf);
      const answer = JSON.parse(on.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      expect(answer.lines[0]).toBe("cc-smart-dev-kit-opus: fallback off → on");
      const config = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        fallback?: Record<string, boolean>;
      };
      expect(config.fallback).toEqual({ "cc-smart-dev-kit-opus": true });
      const after = await world.call("/slots");
      expect(after.body).toContain("&quot;opus&quot;:true");
      // A slot with no chain has nothing to fall back to: the CLI refuses it, in its words.
      const refused = await world.post("slot.fallback", { on: true, slot: "fable" }, csrf);
      expect(refused.status).toBe(400);
      expect(JSON.parse(refused.body).lines.join("\n")).toContain(
        "cc-smart-dev-kit-fable has no chain, so it has nothing to fall back to",
      );
      const bad = await world.post("slot.fallback", { on: "yes", slot: "opus" }, csrf);
      expect(bad.status).toBe(400);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("testing a chain answers per target, and a Claude target says what it cannot do", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
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
      await world.call("/");
      const csrf = await world.csrfOf();
      const refused = await world.post("switch", { name: "judge", on: true }, csrf);
      expect(refused.status).toBe(400);
      const answer = JSON.parse(refused.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(false);
      expect(answer.lines[0]).toBe("No judge chain is saved, so the switch cannot turn one on.");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      // What the restart costs, with no hidden Claude step behind a slot.
      expect(page.body).toContain(
        "While it restarts, a request to an OmniRoute target fails: a slot with its fallback on moves to its next target, if it has one; any other slot answers with that error.",
      );
      expect(page.body).not.toContain("Claude answers, on your own login");
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
      await world.call("/");
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
      await world.call("/");
      const page = await world.call("/machine");
      expect(page.body).toContain("Not installed here");
      expect(page.body).toContain("bun add -g omniroute");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the opus and fable switch puts the opus chain back after Off, under the slot key", async () => {
    // The bug, found by reading the code: `rememberChain` stored the chain under the family
    // ("opus") and the switch read it under the slot key ("cc-smart-dev-kit-opus"), so
    // Off then On turned nothing on — and answered ok: true about it.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
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
      const off = await world.post("switch", { name: "models", on: false }, csrf);
      expect(JSON.parse(off.body).ok).toBe(true);
      const gone = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      expect(gone.slots["cc-smart-dev-kit-opus"]).toBeUndefined();
      // On puts exactly that chain back.
      const again = await world.post("switch", { name: "models", on: true }, csrf);
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

  test("the opus and fable switch is off, and says so, when nothing was turned on", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
      const csrf = await world.csrfOf();
      const answer = await world.post("switch", { name: "models", on: true }, csrf);
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

  test("an off scout or worker shows its switch's own default on the Slots page, not off", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
      const csrf = await world.csrfOf();
      const off = await world.post(
        "slot.save",
        { slot: "worker", targets: ["omniroute:glm-5.3-flash"] },
        csrf,
      );
      expect(JSON.parse(off.body).ok).toBe(true);
      // The CLI turns worker off; the page must not read that as "fallback off".
      const config = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        slots: Record<string, string[]>;
      };
      delete config.slots["cc-smart-dev-kit-worker"];
      writeFileSync(world.paths.gatewayConfigFile, JSON.stringify(config, null, 2), {
        mode: 0o600,
      });
      const slots = await world.call("/slots");
      expect(slots.body).toContain("&quot;worker&quot;:true");
      // Opus has no chain either, and its default is off.
      expect(slots.body).toContain("&quot;opus&quot;:false");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the opus and fable switch, Off then On, puts back the fallback switch with the chain", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
      const csrf = await world.csrfOf();
      const saved = await world.post(
        "slot.save",
        { slot: "opus", targets: ["omniroute:glm-5.3-flash", "omniroute:deepseek-v4.1-flash"] },
        csrf,
      );
      expect(JSON.parse(saved.body).ok).toBe(true);
      const on = await world.post("slot.fallback", { on: true, slot: "opus" }, csrf);
      expect(JSON.parse(on.body).ok).toBe(true);
      const read = () =>
        JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
          fallback?: Record<string, boolean>;
          slots: Record<string, string[]>;
        };
      expect(read().fallback).toEqual({ "cc-smart-dev-kit-opus": true });
      expect(
        JSON.parse((await world.post("switch", { name: "models", on: false }, csrf)).body).ok,
      ).toBe(true);
      expect(read().fallback).toBeUndefined();
      const back = await world.post("switch", { name: "models", on: true }, csrf);
      const answer = JSON.parse(back.body) as { lines: string[]; ok: boolean };
      expect(answer.ok).toBe(true);
      expect(read().slots["cc-smart-dev-kit-opus"]).toEqual([
        "omniroute:glm-5.3-flash",
        "omniroute:deepseek-v4.1-flash",
      ]);
      expect(read().fallback).toEqual({ "cc-smart-dev-kit-opus": true });
      // The switch moves the slot back to Custom, with the fallback it was saved with.
      expect(answer.lines).toContain(
        "  now: omniroute:glm-5.3-flash → omniroute:deepseek-v4.1-flash  (fallback on)",
      );
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  // The owner's bug, 2026-10-22: a slot change made here sometimes did not save. A chain had
  // two homes — `portal.json`'s remembered chains and switches, and `gateway.json` — and the
  // two could disagree. These four tests would have caught it, and hold the one home in place.
  test("owner bug: a slot saved through the portal is in gateway.json, and a fresh read shows it", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const csrf = await world.csrfOf();
      const saved = await world.post(
        "slot.save",
        {
          slot: "worker",
          targets: ["omniroute:glm-5.3-flash", "omniroute:deepseek-v4.1-flash"],
        },
        csrf,
      );
      expect(JSON.parse(saved.body).ok).toBe(true);
      const off = await world.post("slot.fallback", { on: false, slot: "worker" }, csrf);
      expect(JSON.parse(off.body).ok).toBe(true);
      // The one home: the config, read fresh by the same reader every command uses
      // (`gateway status`, `doctor`, the router).
      const config = loadConfigFile(world.paths.gatewayConfigFile);
      expect(config.slots["cc-smart-dev-kit-worker"]).toEqual([
        "omniroute:glm-5.3-flash",
        "omniroute:deepseek-v4.1-flash",
      ]);
      expect(config.fallback).toEqual({ "cc-smart-dev-kit-worker": false });
      // The portal keeps no copy of its own: no `portal.json` was made.
      expect(existsSync(world.paths.portalStateFile)).toBe(false);
      // And the page shows that chain next.
      const slots = await world.call("/slots");
      expect(slots.body).toContain(
        "&quot;worker&quot;:[&quot;omniroute:glm-5.3-flash&quot;,&quot;omniroute:deepseek-v4.1-flash&quot;]",
      );
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("owner bug: Claude and back to Custom from the portal returns the exact chain", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const csrf = await world.csrfOf();
      await world.post(
        "slot.save",
        { slot: "worker", targets: ["omniroute:glm-5.3-flash", "omniroute:deepseek-v4.1-flash"] },
        csrf,
      );
      await world.post("slot.fallback", { on: false, slot: "worker" }, csrf);
      // To Claude: the chain and its switch move to `kept`.
      const toClaude = await world.post("slot.mode", { mode: "claude", slot: "worker" }, csrf);
      expect(JSON.parse(toClaude.body).ok).toBe(true);
      const off = loadConfigFile(world.paths.gatewayConfigFile);
      expect(off.slots).not.toHaveProperty("cc-smart-dev-kit-worker");
      expect(off.kept).toEqual({
        "cc-smart-dev-kit-worker": {
          fallback: false,
          targets: ["omniroute:glm-5.3-flash", "omniroute:deepseek-v4.1-flash"],
        },
      });
      expect(off).not.toHaveProperty("fallback");
      // Back to Custom: the very same chain, with the switch it was saved with.
      const toCustom = await world.post("slot.mode", { mode: "custom", slot: "worker" }, csrf);
      expect(JSON.parse(toCustom.body).ok).toBe(true);
      const back = loadConfigFile(world.paths.gatewayConfigFile);
      expect(back.slots["cc-smart-dev-kit-worker"]).toEqual([
        "omniroute:glm-5.3-flash",
        "omniroute:deepseek-v4.1-flash",
      ]);
      expect(back.fallback).toEqual({ "cc-smart-dev-kit-worker": false });
      expect(back).not.toHaveProperty("kept");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("owner bug: a chain set from a terminal while the portal is open is what the portal shows", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // The old portal's memory, with a stale chain for the worker: it must change nothing.
      mkdirSync(dirname(world.paths.portalStateFile), { recursive: true });
      writeFileSync(
        world.paths.portalStateFile,
        JSON.stringify({
          fallback: { "cc-smart-dev-kit-worker": ["omniroute:stale-model"] },
          judge: [],
          switches: {},
          version: 1,
        }),
      );
      // A terminal ran `gateway slot worker …`: the CLI's own save path, outside the portal.
      const config = loadConfigFile(world.paths.gatewayConfigFile);
      config.slots["cc-smart-dev-kit-worker"] = ["omniroute:glm-5.3-flash"];
      saveConfig(world.paths.gatewayConfigFile, config);
      const csrf = await world.csrfOf();
      // The page shows the config's chain, never the old memory's.
      const slots = await world.call("/slots");
      expect(slots.body).toContain("&quot;worker&quot;:[&quot;omniroute:glm-5.3-flash&quot;]");
      expect(slots.body).not.toContain("omniroute:stale-model");
      // An action on another slot leaves it alone, and never writes the old memory.
      const before = readFileSync(world.paths.portalStateFile, "utf8");
      const switched = await world.post("switch", { name: "models", on: false }, csrf);
      expect(JSON.parse(switched.body).ok).toBe(true);
      expect(
        loadConfigFile(world.paths.gatewayConfigFile).slots["cc-smart-dev-kit-worker"],
      ).toEqual(["omniroute:glm-5.3-flash"]);
      expect(readFileSync(world.paths.portalStateFile, "utf8")).toBe(before);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("owner bug: after the migration, portal.json holds no slot parts and nothing reads them", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // The 0.5.x portal memory, and `gateway setup`'s migration step on these paths.
      mkdirSync(dirname(world.paths.portalStateFile), { recursive: true });
      writeFileSync(
        world.paths.portalStateFile,
        JSON.stringify({
          fallback: { "cc-smart-dev-kit-opus": ["omniroute:glm-5.3-flash"] },
          judge: [],
          switches: { "cc-smart-dev-kit-opus": true },
          version: 1,
        }),
      );
      const lines = upgradeConfig(world.paths.gatewayConfigFile, {
        portalStateFile: world.paths.portalStateFile,
        stateDir: world.paths.stateDir,
      });
      expect(lines).toHaveLength(1);
      // The file stays, with no slot part in it.
      expect(JSON.parse(readFileSync(world.paths.portalStateFile, "utf8"))).toEqual({ version: 1 });
      // The chain is in gateway.json, saved and not in use.
      expect(loadConfigFile(world.paths.gatewayConfigFile).kept).toEqual({
        "cc-smart-dev-kit-opus": { fallback: true, targets: ["omniroute:glm-5.3-flash"] },
      });
      // Nothing reads the old file: the Overview shows the chain from the config, saved.
      const overview = await world.call("/");
      expect(overview.body).toContain("saved, not in use: omniroute:glm-5.3-flash");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the judge switch, Off then On, puts back the judge's fallback switch too", async () => {
    const backend = fakeBackend(["glm-5.3-flash", "deepseek-v4.1-flash"], {
      chat: "<block>yes</block>",
    });
    const world = await open({ backendPort: backend.port });
    try {
      await world.call("/");
      const csrf = await world.csrfOf();
      const saved = await world.post(
        "slot.save",
        { slot: "judge", targets: ["omniroute:glm-5.3-flash", "omniroute:deepseek-v4.1-flash"] },
        csrf,
      );
      expect(JSON.parse(saved.body).ok).toBe(true);
      // Off is the judge's non-default switch since D44 (on is the default, so "on" would be
      // written as no entry and there would be nothing to put back).
      expect(
        JSON.parse((await world.post("slot.fallback", { on: false, slot: "judge" }, csrf)).body).ok,
      ).toBe(true);
      expect(
        JSON.parse((await world.post("switch", { name: "judge", on: false }, csrf)).body).ok,
      ).toBe(true);
      const again = await world.post("switch", { name: "judge", on: true }, csrf);
      expect(JSON.parse(again.body).ok).toBe(true);
      const config = JSON.parse(readFileSync(world.paths.gatewayConfigFile, "utf8")) as {
        fallback?: Record<string, boolean>;
      };
      expect(config.fallback).toEqual({ "cc-smart-dev-kit-judge": false });
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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

  test("PB-3: the trust rules are written only as shown", async () => {
    // The page drew the rules, and the click re-read the project's file: a rule added in
    // between (by a session, in the folder the portal runs in) was written without anyone
    // seeing it. The write now carries the hash of what the page showed.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const config = (rules: string[]) => `${JSON.stringify({ autoMode: rules }, null, 2)}\n`;
    const world = await open({
      backendPort: backend.port,
      gitOnPath: true,
      projectFiles: { config: config(["Rule one"]) },
    });
    const projectFile = join(world.cwd, ".claude", "cc-smart-dev-kit.json");
    /** The write button's body, as the page's script sends it. */
    const shownBody = (page: string): unknown => {
      const found = /data-action="automode\.apply" data-body="([^"]+)"/.exec(page)?.[1] ?? "";
      return JSON.parse(found.replaceAll("&quot;", '"'));
    };
    try {
      await world.call("/");
      const csrf = await world.csrfOf();
      const first = await world.call("/machine");
      // The CLI's own lines: `+` for a rule that goes in.
      expect(first.body).toContain(
        '<span class="mark">+</span><span class="wrap-any">Rule one</span>',
      );
      const body = shownBody(first.body);
      // A rule added after the page was drawn: the old click writes nothing.
      writeFileSync(projectFile, config(["Rule one", "Rule two"]));
      const stale = await world.post("automode.apply", body, csrf);
      expect(JSON.parse(stale.body)).toEqual({
        lines: [
          "The trust rules changed since this page showed them, so nothing was written. Read them again on the page, then write them.",
        ],
        ok: false,
      });
      expect(existsSync(world.paths.settingsFile)).toBe(false);
      // A hand-made POST with no hash at all writes nothing either.
      const bare = await world.post("automode.apply", { confirm: true }, csrf);
      expect(JSON.parse(bare.body).ok).toBe(false);
      expect(existsSync(world.paths.settingsFile)).toBe(false);
      // What the page shows now is what gets written.
      const second = await world.call("/machine");
      expect(second.body).toContain('<span class="wrap-any">Rule two</span>');
      const written = await world.post("automode.apply", shownBody(second.body), csrf);
      expect(JSON.parse(written.body).ok).toBe(true);
      const settings = JSON.parse(readFileSync(world.paths.settingsFile, "utf8"));
      expect(settings.autoMode.environment).toEqual(["$defaults", "Rule one", "Rule two"]);
      // A rule the project drops is shown as the `-` line the command line prints, and goes.
      writeFileSync(projectFile, config(["Rule two"]));
      const third = await world.call("/machine");
      expect(third.body).toContain(
        '<span class="mark">-</span><span class="wrap-any">Rule one</span>',
      );
      expect(
        JSON.parse((await world.post("automode.apply", shownBody(third.body), csrf)).body).ok,
      ).toBe(true);
      expect(
        JSON.parse(readFileSync(world.paths.settingsFile, "utf8")).autoMode.environment,
      ).toEqual(["$defaults", "Rule two"]);
      // Nothing left to change: the card says so, and offers no button.
      const done = await world.call("/machine");
      expect(done.body).not.toContain('data-action="automode.apply"');
      expect(done.body).toContain("Your user settings already hold these rules.");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("PB improvement 1: a switch's id and action are escaped like every other value", () => {
    // Every caller passes a fixed word today; the helper must not rely on that.
    const odd = '"><img src=x>';
    for (const disabled of [false, true]) {
      const html = switchButton({ action: odd, disabled, id: odd, label: "x", on: false });
      expect(html).not.toContain(odd);
      expect(html).toContain('aria-labelledby="&quot;&gt;&lt;img src=x&gt;"');
    }
    expect(switchButton({ action: odd, id: "a", label: "x", on: true })).toContain(
      'data-action="&quot;&gt;&lt;img src=x&gt;"',
    );
  });

  test("PB-3: the card says when a worktree's rules are not the main checkout's", () => {
    const card = autoModeCard({
      added: ["Rule one"],
      differsFrom: "/home/user/my-app/.claude/cc-smart-dev-kit.json",
      from: "/home/user/my-app-wt-1/.claude/cc-smart-dev-kit.json",
      hash: "h",
      removed: [],
      settings: "/home/user/.claude/settings.json",
    });
    expect(card).toContain(
      "This worktree's file is not the same as the main checkout's (<span class=\"mono\">/home/user/my-app/.claude/cc-smart-dev-kit.json</span>). The rules below come from this worktree's file.",
    );
  });

  test("a project's own folder is where the auto-mode rules come from", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // A project that asks for one rule, in the folder the portal was started in.
      mkdirSync(join(world.paths.stateDir, "..", "..", "unused"), { recursive: true });
      await world.call("/");
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
    worktrees: { base: "integration" },
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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

  test("D16: a setting that cannot work with another is a ! line under its row, with the fix", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    // `openPr: draft` with `autoPush` off (the default): the pull request waits for the push.
    const workflow = fakeWorkflow({ resolved: { openPr: { source: "personal", value: "draft" } } });
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: PROJECT_CONFIG },
      workflow,
    });
    try {
      const page = await world.call("/settings");
      expect(page.status).toBe(200);
      expect(page.body).toContain(
        "! openPr opens a pull request, but autoPush is off: the git guard asks before the push that pull request needs, so it waits for you every time. Fix: turn autoPush on (`cc-smart-dev-kit workflow set autoPush true`), or set openPr off (`cc-smart-dev-kit workflow set openPr off`).",
      );
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
    // ...and on a phone the button goes under the code, so a short command is never cut.
    expect(PORTAL_CSS).toContain(".codebox.oneline { flex-wrap: wrap; }");
  });

  test("a machine with no git says the fact in words, not the spawner's own", async () => {
    // The Settings page showed "Executable not found in $PATH: \"git\"" — a raw runtime error
    // standing in for "this project's own values cannot be read". The fact stays; the words are
    // a person's.
    const world = await open({ backendPort: 0, withConfig: false, noGit: true });
    try {
      await world.call("/");
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
    guards: { guardMainFolder: false, jobRoute: true, sessionNames: false },
    protectedBranches: ["main"],
    ...overrides,
  };
}

/** The same answers, over the fake's own defaults: what the plan is really made from. */
const MERGED_ANSWERS: ProjectInitAnswers = {
  base: "trunk",
  bases: { "fix/": "main" },
  guards: { guardMainFolder: false, jobRoute: true, sessionNames: false },
  protectedBranches: ["main"],
  workflow: { openPr: "draft" },
};

describe("the project card", () => {
  test("nothing set up yet: the line, the button, and the form behind it", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const workflow = fakeWorkflow();
    const world = await open({ backendPort: backend.port, projectFiles: {}, workflow });
    try {
      await world.call("/");
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
      await world.call("/");
      const page = await world.call("/machine");
      expect(page.body).not.toContain("not set up");
      // The base field, the base rows, the protected chips and the guards.
      expect(page.body).toContain('id="f-base"');
      expect(page.body).toContain('data-base-prefix value="hotfix/"');
      expect(page.body).toContain('data-protected-name value="integration"');
      expect(page.body).toContain('data-form-switch="guardMainFolder"');
      // The preview: the plan's own text, Claude Code's baseRef line, and the note.
      expect(page.body).toContain("&quot;base&quot;: &quot;integration&quot;");
      expect(page.body).toContain("worktree.baseRef: &quot;head&quot;");
      expect(page.body).toContain(
        "1 line, added inside the existing file. Nothing else there changes.",
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
      await world.call("/");
      const csrf = await world.csrfOf();
      const cases: [Record<string, unknown>, string][] = [
        [{ base: "" }, "The base branch is needed: it is the branch a new worktree starts from."],
        [{ bases: { hotfix: "main" } }, '"hotfix" is not prefix=base: the prefix ends with "/".'],
        [{ protectedBranches: [7] }, "The protected branches must be a list of branch names."],
        [{ guards: { guardMainFolder: true } }, "guards.sessionNames is true or false."],
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
      await world.call("/");
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
          defaultBranch: "main",
          existing: PROJECT_CONFIG,
          existingLocalSettings: null,
          existingSettings: null,
          root: world.cwd,
        },
      ]);
      // The answer is that plan, exactly: the two file names, the file's own text, and
      // Claude Code's baseRef line (the base, trunk, is not the repo's default branch).
      expect(body.preview).toEqual({
        changed: true,
        diff: ['+ worktrees.base: "trunk"'],
        file: join(world.cwd, ".claude", "cc-smart-dev-kit.json"),
        localSettings: {
          adds: [],
          changed: false,
          file: join(world.cwd, ".claude", "settings.local.json"),
          lines: [],
          removes: [],
          text: "{}\n",
        },
        notes: [],
        settings: {
          adds: ['worktree.baseRef: "head"'],
          changed: true,
          file: join(world.cwd, ".claude", "settings.json"),
          lines: ['+ worktree.baseRef: "head"'],
          removes: [],
          text: '{\n  "worktree": {\n    "baseRef": "head"\n  }\n}\n',
        },
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
      await world.call("/");
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
        `+ ${join(world.cwd, ".claude", "settings.json")}`,
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
      const csrf = await world.csrfOf();
      const bodies: [string, unknown][] = [
        ["workflow.set", { key: "openPr", value: "draft" }],
        ["project.preview", { answers: formAnswers() }],
        ["project.write", { answers: formAnswers(), confirm: true }],
      ];
      for (const [action, body] of bodies) {
        // A page that is not ours.
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

/** A project's file with everything the 0.4.0 core reads. */
const FULL_PROJECT_CONFIG = `${JSON.stringify(
  {
    requires: ">=0.3",
    worktrees: {
      base: "integration",
      bases: { "release/": "main" },
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
  test("a project file with a workflow policy and bases", async () => {
    // No fake here: `workflowAdapter` is the real module, so this one test proves the portal
    // reads a 0.4.0 project's file — `workflow` and `worktrees.bases` —
    // through the CLI's own code. It runs git in the temp repo, and never `gh`: the test's
    // environment has no PATH for it.
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: FULL_PROJECT_CONFIG },
      workflow: workflowAdapter,
    });
    try {
      await world.call("/");
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

      // The card's form starts from the project's own file: its base row.
      const machine = await world.call("/machine");
      expect(machine.status).toBe(200);
      expect(machine.body).toContain('data-base-prefix value="release/"');
      expect(machine.body).toContain('data-base-value value="main"');
      // The preview is the CLI's own plan with the file's fields in it: the policy it keeps,
      // the bases, and Claude Code's baseRef line (integration is not the repo's default branch).
      expect(machine.body).toContain("&quot;workflow&quot;: {");
      expect(machine.body).toContain("&quot;release/&quot;: &quot;main&quot;");
      expect(machine.body).toContain("+ worktree.baseRef: &quot;head&quot;");
      expect(machine.body).not.toContain("No line is added to .claude/settings.json.");
      // Nothing to take out of the personal settings file: its box stays closed.
      expect(machine.body).toContain("<div data-preview-local-box hidden>");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("D20: a file the retired engine left fields in: the card's write takes them, and its hook lines, out", async () => {
    // The file does not load (every hook would ask), but the card still offers its form: the
    // same plan as `project init`, through the real module, is the fix.
    const config = `${JSON.stringify(
      { worktrees: { base: "integration", prefix: "app-wt-", engine: "own" } },
      null,
      2,
    )}\n`;
    const local = `${JSON.stringify({
      hooks: {
        SubagentStop: [
          {
            hooks: [
              {
                type: "command",
                command: '"$HOME/.local/bin/cc-smart-dev-kit" hook subagent-stop',
              },
            ],
          },
        ],
      },
    })}\n`;
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config, localSettings: local },
      workflow: workflowAdapter,
    });
    try {
      await world.call("/");
      const machine = await world.call("/machine");
      expect(machine.status).toBe(200);
      expect(machine.body).not.toContain("cannot be read");
      expect(machine.body).toContain("data-project-form data-files-hash=");
      expect(machine.body).toContain(
        "the plugin&#39;s worktree engine was retired in 1.0.0: worktrees.prefix, worktrees.engine and its hook line go, because Claude Code&#39;s own worktrees need none",
      );
      expect(machine.body).toContain("<div data-preview-local-box>");
      expect(machine.body).toContain(
        "- hooks.SubagentStop: &quot;$HOME/.local/bin/cc-smart-dev-kit&quot; hook subagent-stop",
      );
      const csrf = await world.csrfOf();
      const hash = /data-files-hash="([^"]+)"/.exec(machine.body)?.[1] ?? "";
      const yes = await world.post(
        "project.write",
        { answers: formAnswers({ base: "integration" }), confirm: true, previewHash: hash },
        csrf,
      );
      expect(JSON.parse(yes.body).ok).toBe(true);
      const file = join(world.cwd, ".claude", "cc-smart-dev-kit.json");
      expect(parseCcSmartDevKitConfig(readFileSync(file, "utf8"), file).worktrees).toEqual({
        base: "integration",
        bases: { "fix/": "main" },
      });
      expect(readFileSync(join(world.cwd, ".claude", "settings.local.json"), "utf8")).toBe("{}\n");
      // Loaded again, the card is the plain set-up one.
      expect((await world.call("/machine")).body).not.toContain("retired");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await world.call("/");
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
      await linux.call("/");
      const page = await linux.call("/machine");
      expect(page.body).toContain("mode 600: readable only by you");
    } finally {
      linux.portal.stop();
    }
    // Windows has no `chmod`: what keeps that file to one person is the ACL of the profile
    // folder it sits in, and the same paragraph must not claim a mode there.
    const windows = await open({ backendPort: 0, withConfig: false, platform: "win32" });
    try {
      await windows.call("/");
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
      await world.call("/");
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

// ── The JSON API and the live stream (B6b) ─────────────────────────────────────

/** A queued crew session of this test's project, as the store writes one. */
function crewFixture(repo: string): NewCrew {
  return {
    base: null,
    baseRef: "main",
    branch: "crew/K-contracts",
    effort: "xhigh",
    files: ["src/crew/store.ts"],
    id: "crew-K-contracts",
    kind: "schema",
    lastLine: null,
    leadName: "LEAD my-app master-plan",
    leadSessionId: "11111111-1111-4111-8111-111111111111",
    memoryMb: null,
    model: { named: "opus", resolved: "claude-opus-5-5", slot: null, tier: "opus" },
    name: "C my-app K contracts",
    permissionMode: "auto",
    phase: "K",
    plan: ".claude/plans/master-plan.md",
    pr: null,
    questions: [],
    reportPath: null,
    repo,
    sessionId: null,
    shortId: null,
    slug: "contracts",
    state: "queued",
    waitsFor: [],
    worktree: `${repo}/.claude/worktrees/crew-K-contracts`,
  };
}

/** One job record file, as the heavy-job store writes one: its own holder, and the queue's
 *  record inside. The holder is this test's own process, so the lease is alive. */
function holderRecord(gb: number, what: string): string {
  return JSON.stringify({
    gb,
    holder: currentFileHolder(),
    record: JSON.stringify({
      checkout: "/home/user/my-app",
      gb,
      kind: "build",
      person: "my-host",
      pid: process.pid,
      since: Date.UTC(2026, 9, 22, 10, 0, 0),
      v: 1,
      what,
    }),
    store: 1,
  });
}

describe("the JSON API", () => {
  test("every read is a GET behind the door: a foreign Origin, a wrong Host and cross-site are refused", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // Every read route this version has, with a query each one accepts.
      const paths = [
        "/api/overview",
        "/api/slots",
        "/api/health",
        "/api/machine",
        "/api/settings",
        "/api/projects",
        "/api/projects/no-such-project",
        "/api/work",
        "/api/crew/crew-K-contracts",
        "/api/flow?range=1d",
        "/api/needs",
        "/api/guard-asks?hook=git-guard",
        "/api/worktrees",
        "/api/update",
        "/api/jobs",
        "/api/history?range=1h&by=slot",
        "/api/requests?cursor=x",
        "/events",
      ];
      for (const path of paths) {
        expect(
          (await world.call(path, { headers: { origin: "http://evil.example" } })).status,
        ).toBe(403);
        expect((await world.call(path, { headers: { host: "evil.example" } })).status).toBe(403);
        expect(
          (await world.call(path, { headers: { "sec-fetch-site": "cross-site" } })).status,
        ).toBe(403);
      }
      // Same-origin, as the portal's own page sends: served.
      const page = await world.call("/api/overview", {
        headers: { "sec-fetch-site": "same-origin" },
      });
      expect(page.status).toBe(200);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("an action is still a POST: a GET on a write path is 405, on an unknown API path too", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      expect((await world.call("/api/switch")).status).toBe(405);
      expect((await world.call("/api/not-a-read")).status).toBe(405);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("overview: the page's own facts, the queue at a glance, and never a key", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const response = await world.call("/api/overview");
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body.configured).toBe(true);
      expect(body.error).toBe(null);
      expect((body.slots as unknown[]).length).toBe(5);
      expect(body.switches).toMatchObject({ gateway: false, judge: false, models: false });
      expect(body.jobs).toEqual({
        budgetGb: expect.any(Number),
        heldGb: expect.any(Number),
        waiting: expect.any(Number),
      });
      expect((body.router as { up: boolean }).up).toBe(true);
      // The planted key never reaches any answer.
      expect(response.body).not.toContain(KEY);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("slots: the chains, the live models and the switches", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const body = JSON.parse((await world.call("/api/slots")).body) as {
        chains: Record<string, string[]>;
        models: { id: string }[];
        switches: { models: boolean };
      };
      expect(body.chains.scout).toEqual(["omniroute:glm-5.3-flash", "claude-sonnet-5-5"]);
      expect(body.models.map((one) => one.id)).toContain("omniroute:glm-5.3-flash");
      expect(body.switches.models).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("health: the router and the log's own note where there is no journal", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const body = JSON.parse((await world.call("/api/health")).body) as {
        log: { note: null | string };
        router: { up: boolean };
      };
      expect(body.router.up).toBe(true);
      expect(body.log.note).toBe("no systemd here, so there is no journal to read");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("machine, settings, projects and update answer without a gateway too", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      const machine = JSON.parse((await world.call("/api/machine")).body) as Record<
        string,
        unknown
      >;
      expect(Object.keys(machine).sort()).toEqual([
        "autoMode",
        "browser",
        "companions",
        "doctor",
        "jobs",
        "omniroute",
        "project",
        "updates",
        "warp",
      ]);
      const settings = JSON.parse((await world.call("/api/settings")).body) as {
        error: null | string;
        rows: unknown[];
      };
      expect(settings.error).toBe(null);
      expect(Array.isArray(settings.rows)).toBe(true);
      const projects = JSON.parse((await world.call("/api/projects")).body) as {
        note: null | string;
        projects: unknown[];
      };
      // No Claude Code session records in this temp home: the list is empty, and says why.
      expect(projects.projects).toEqual([]);
      expect(projects.note).toBe(NO_SESSION_RECORDS);
      const update = JSON.parse((await world.call("/api/update")).body) as {
        held: null;
        installed: null;
        summary: string;
      };
      expect(update.held).toBe(null);
      expect(update.installed).toBe(null);
      expect(typeof update.summary).toBe("string");
    } finally {
      world.portal.stop();
    }
  });

  test("a page that needs the gateway says it is not set up, in a typed answer", async () => {
    const world = await open({ backendPort: 0, withConfig: false });
    try {
      for (const path of ["/api/overview", "/api/slots", "/api/health"]) {
        const body = JSON.parse((await world.call(path)).body) as {
          configured: boolean;
          error: string;
          router?: { up: boolean };
        };
        expect(body.configured).toBe(false);
        expect(body.error).toBe("the gateway is not set up");
        // The pages that draw a router pill say it is down; Slots has no pill.
        if (path !== "/api/slots") expect(body.router?.up).toBe(false);
      }
    } finally {
      world.portal.stop();
    }
  });

  test("jobs: the queue's exact shape, one held and one waiting", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      mkdirSync(join(world.home, ".config", "cc-smart-dev-kit"), { recursive: true });
      writeFileSync(
        join(world.home, ".config", "cc-smart-dev-kit", "jobs.json"),
        `${JSON.stringify({ budgetGb: 10 })}\n`,
      );
      const jobs = join(world.home, ".local", "share", "cc-smart-dev-kit", "jobs");
      mkdirSync(join(jobs, "leases"), { recursive: true });
      mkdirSync(join(jobs, "tickets"), { recursive: true });
      writeFileSync(join(jobs, "leases", "job-1.json"), holderRecord(4, "bunx tsc --noEmit"));
      writeFileSync(join(jobs, "tickets", "job-2.json"), holderRecord(3, "next build"));
      const body = JSON.parse((await world.call("/api/jobs")).body) as {
        budgetGb: number;
        freeGb: null | number;
        keptGb: number;
        memoryGb: number;
        stores: {
          budgetGb: number;
          freeGb: number;
          held: Record<string, unknown>[];
          waiting: Record<string, unknown>[];
          where: string;
        }[];
      };
      expect(body.budgetGb).toBe(10);
      expect(body.keptGb).toBe(22);
      expect(typeof body.memoryGb).toBe("number");
      expect(body.stores).toHaveLength(1);
      expect(body.stores[0]?.where).toBe("machine");
      expect(body.stores[0]?.budgetGb).toBe(10);
      expect(body.stores[0]?.freeGb).toBe(6);
      expect(body.stores[0]?.held).toEqual([
        {
          command: "bunx tsc --noEmit",
          folder: "/home/user/my-app",
          gb: 4,
          kind: "build",
          pid: process.pid,
          since: "2026-10-22T10:00:00.000Z",
          user: "my-host",
        },
      ]);
      expect(body.stores[0]?.waiting).toEqual([
        {
          command: "next build",
          folder: "/home/user/my-app",
          gb: 3,
          kind: "build",
          pid: process.pid,
          since: "2026-10-22T10:00:00.000Z",
          user: "my-host",
        },
      ]);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("work and a crew page: the lead's crew, its question, and the page's own fields", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, projectFiles: {} });
    try {
      await createCrew(world.paths.stateDir, crewFixture(world.cwd), Date.now());
      await addCrewQuestion(
        world.paths.stateDir,
        world.cwd,
        "crew-K-contracts",
        {
          options: ["Use SQLite", "Use a file"],
          question: "Where should the history live?",
          recommended: 1,
        },
        Date.now(),
      );
      const work = JSON.parse((await world.call("/api/work")).body) as {
        crew: { id: string; question: { options: string[]; recommended: number } | null }[];
        lead: null;
        sessions: unknown[];
      };
      expect(work.crew).toHaveLength(1);
      expect(work.crew[0]?.id).toBe("crew-K-contracts");
      expect(work.crew[0]?.question).toMatchObject({
        options: ["Use SQLite", "Use a file"],
        recommended: 1,
      });

      const page = await world.call("/api/crew/crew-K-contracts");
      expect(page.status).toBe(200);
      const crew = JSON.parse(page.body) as {
        brief: null;
        crew: { id: string };
        diff: { error: null | string };
        events: { type: string }[];
        mergeCheck: { kind: string };
        report: null;
        reviews: unknown[];
      };
      expect(crew.crew.id).toBe("crew-K-contracts");
      expect(crew.brief).toBe(null);
      // The record's creation and the question it asked: its log, newest last.
      expect(crew.events.map((one) => one.type)).toEqual(["created", "question"]);
      expect(crew.diff.error).toContain("no base");
      expect(crew.mergeCheck.kind).toBe("refused");
      expect(crew.report).toBe(null);
      expect(crew.reviews).toEqual([]);

      // A crew session the store does not know is a typed 404.
      const missing = await world.call("/api/crew/nobody");
      expect(missing.status).toBe(404);
      expect(JSON.parse(missing.body).error).toContain("no crew session");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("needs: a crew question, doctor's failures, an open breaker and a held major", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      doctor: () => ({
        browser: realBrowserDoctorDeps(worldMachine(), tempDir("home")),
        bun: { path: process.execPath, version: Bun.version },
        gateway: {
          bundle: join(worldPluginFolder(), "dist", "router.js"),
          machine: worldMachine(),
          runner: () => ({ exitCode: 0, output: "" }),
          service: "none",
        },
        live: null,
        local: {
          cwd: tempDir("cwd"),
          instructionsSource: join(worldPluginFolder(), "instructions"),
        },
        project: null,
      }),
      projectFiles: {},
    });
    try {
      await createCrew(world.paths.stateDir, crewFixture(world.cwd), Date.now());
      await addCrewQuestion(
        world.paths.stateDir,
        world.cwd,
        "crew-K-contracts",
        { options: ["Yes", "No"], question: "Merge it?", recommended: 1 },
        Date.now(),
      );
      mkdirSync(dirname(world.paths.gatewayStateFile), { recursive: true });
      writeFileSync(
        world.paths.gatewayStateFile,
        JSON.stringify({
          breakers: {
            "cc-smart-dev-kit-worker": {
              held: 3,
              lastAt: Date.now(),
              since: Date.now() - 60_000,
              targets: [{ status: 429, target: "omniroute:x", until: Date.now() + 30_000 }],
            },
          },
          fallbacks: {},
          limits: {},
          version: 1,
        }),
      );
      writeHeldMajor(updateFiles(world.paths.stateDir), {
        at: "2026-10-20T09:00:00.000Z",
        from: "1.0.0",
        notes: ["it refuses old fields"],
        version: "2.0.0",
      });
      const body = JSON.parse((await world.call("/api/needs")).body) as {
        breaker: { held: number; slot: string } | null;
        crew: { question: string }[];
        doctor: { failures: unknown[] };
        permissions: unknown[];
        update: { notes: string[]; version: string } | null;
      };
      expect(body.crew[0]?.question).toBe("Merge it?");
      expect(body.breaker?.slot).toBe("cc-smart-dev-kit-worker");
      expect(body.breaker?.held).toBe(3);
      expect(body.update).toMatchObject({ notes: ["it refuses old fields"], version: "2.0.0" });
      expect(Array.isArray(body.doctor.failures)).toBe(true);
      expect(Array.isArray(body.permissions)).toBe(true);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("the guard log: masked, filtered and with its totals", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      mkdirSync(world.paths.stateDir, { recursive: true });
      const ask = (hook: string, reason: string, at: number) =>
        JSON.stringify({ at, hook, reason, session: "s1", tool: "Bash" });
      writeFileSync(
        askLogFile(world.paths.stateDir),
        `${[ask("git-guard", "push to main", 1), ask("merge-guard", "merge without review token=omni_PLANTED_SECRET_a1b2", 2), ask("git-guard", "force push", 3)].join("\n")}\n`,
      );
      const all = JSON.parse((await world.call("/api/guard-asks")).body) as {
        asks: { hook: string; reason: string }[];
        byHook: Record<string, number>;
        kept: number;
      };
      expect(all.byHook).toEqual({ "git-guard": 2, "merge-guard": 1 });
      // Newest first, and the key a reason quoted is masked before a page sees it (its last
      // four characters stay, as `maskedLine` masks: enough to tell keys apart, never a key).
      expect(all.asks.map((one) => one.reason)).toEqual([
        "force push",
        "merge without review token=****a1b2",
        "push to main",
      ]);
      expect(JSON.stringify(all)).not.toContain(KEY);
      expect(all.kept).toBe(3);
      const filtered = JSON.parse(
        (await world.call("/api/guard-asks?hook=git-guard&limit=1")).body,
      ) as { asks: { reason: string }[]; kept: number };
      expect(filtered.asks.map((one) => one.reason)).toEqual(["force push"]);
      expect(filtered.kept).toBe(1);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("worktrees: every worktree's verdict against the base", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      env: { PATH: process.env.PATH ?? "" },
      projectFiles: {},
    });
    try {
      // A commit, so git has a HEAD and the worktree can be judged.
      writeFileSync(join(world.cwd, "README.md"), "readme\n");
      git(world.cwd, "add", "README.md");
      git(world.cwd, "commit", "-q", "-m", "init");
      const body = JSON.parse((await world.call("/api/worktrees")).body) as {
        base: string;
        note: null | string;
        worktrees: { kind: string; path: string }[];
      };
      expect(body.base).toBe("main");
      // The temp repo has no origin: the answer says it judged against the local base.
      expect(body.note).toContain("judges against the local main");
      expect(body.worktrees[0]?.kind).toBe("main");
      expect(body.worktrees[0]?.path).toBe(world.cwd);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("flow: the report for the range, and the kept window said when the range is longer", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const oneDay = JSON.parse((await world.call("/api/flow?range=1d")).body) as {
        note: null | string;
        range: string;
        report: { sessions: unknown[] };
      };
      expect(oneDay.range).toBe("1d");
      expect(oneDay.report.sessions).toEqual([]);
      expect(oneDay.note).toBe(null);
      const long = JSON.parse((await world.call("/api/flow?range=30d")).body) as {
        note: null | string;
      };
      expect(long.note).toContain("keeps 8 days");
      expect((await world.call("/api/flow?range=nope")).status).toBe(400);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("/api/history/keys: the values each filter can take in the range, from H1's database", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      // A machine that never logged a request has no value to offer.
      expect(JSON.parse((await world.call("/api/history/keys")).body)).toEqual({
        models: [],
        sessions: [],
        slots: [],
        targets: [],
      });
      const now = Date.now();
      const writer = createHistoryWriter({
        file: world.paths.historyDbFile,
        flushAfterMs: 0,
        log: () => undefined,
        retentionDays: () => 90,
      });
      const row = (overrides: Partial<HistoryRow>): HistoryRow => ({
        at: now - 60_000,
        breaker: null,
        cost: null,
        model: "claude-sonnet-5-5",
        ms: 100,
        nextTarget: null,
        session: "session-a",
        slot: "cc-smart-dev-kit-worker",
        status: 200,
        target: "omniroute:glm-5.3-flash",
        tokens: null,
        ...overrides,
      });
      writer.record(row({}));
      writer.record(
        row({ session: null, slot: "cc-smart-dev-kit-scout", target: "claude-haiku-5-5" }),
      );
      // Older than the range asked: not one of its values.
      writer.record(row({ at: now - 3 * 86_400_000, model: "claude-opus-5-5" }));
      writer.close();
      expect(JSON.parse((await world.call("/api/history/keys?range=1d")).body)).toEqual({
        models: ["claude-sonnet-5-5"],
        sessions: ["session-a"],
        slots: ["cc-smart-dev-kit-scout", "cc-smart-dev-kit-worker"],
        targets: ["claude-haiku-5-5", "omniroute:glm-5.3-flash"],
      });
      expect((await world.call("/api/history/keys?range=2d")).status).toBe(400);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("/api/facts is the frame's facts: the version, the portal's own port, the router", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      expect(JSON.parse((await world.call("/api/facts")).body)).toEqual({
        platform: "linux",
        portalPort: world.portal.port,
        router: { port: 20_199, up: true },
        version: VERSION,
      });
    } finally {
      world.portal.stop();
    }
    const bare = await open({ backendPort: backend.port, withConfig: false });
    try {
      // No config names a router: none is claimed, and no port is invented.
      expect(JSON.parse((await bare.call("/api/facts")).body).router).toBe(null);
    } finally {
      bare.portal.stop();
      backend.stop();
    }
  });

  test("history: H1's own buckets, series, filters, and a missing database is empty", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    // A fixed clock on a bucket boundary, so every expected bucket is written by hand.
    const NOW = Date.UTC(2026, 9, 22, 10, 0, 0);
    const MIN = 60_000;
    const world = await open({ backendPort: backend.port, now: () => NOW });
    const writer = createHistoryWriter({
      file: world.paths.historyDbFile,
      flushAfterMs: 60_000,
      log: () => {},
      now: () => NOW,
      retentionDays: () => 90,
    });
    const row = (overrides: Partial<HistoryRow>): HistoryRow => ({
      at: NOW,
      breaker: null,
      cost: null,
      model: "claude-haiku-5-5",
      ms: 100,
      nextTarget: null,
      session: "s1",
      slot: "cc-smart-dev-kit-worker",
      status: 200,
      target: "omniroute:glm",
      tokens: null,
      ...overrides,
    });
    // Four rows: two in one minute bucket one target shares, one scout row, one newest row.
    const rows: HistoryRow[] = [
      row({
        at: NOW - 10 * MIN,
        cost: { estimated: true, usd: 0.001 },
        ms: 100,
        tokens: { cacheRead: 1000, cacheWrite: 20, input: 10, output: 5 },
      }),
      row({ at: NOW - 10 * MIN + 30_000, ms: 300, status: 500 }),
      row({
        at: NOW - 9 * MIN,
        cost: { estimated: false, usd: 0.0001 },
        model: "claude-sonnet-5-5",
        ms: 50,
        session: "s2",
        slot: "cc-smart-dev-kit-scout",
        target: "claude-sonnet-5-5",
        tokens: { cacheRead: 0, cacheWrite: 0, input: 7, output: 3 },
      }),
      row({
        at: NOW - 5 * MIN,
        breaker: "held",
        model: "claude-opus-5-5",
        ms: 200,
        nextTarget: "claude-sonnet-5-5",
        session: null,
        tokens: { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 },
      }),
    ];
    try {
      for (const one of rows) writer.record(one);
      writer.flush();

      interface Bucket {
        cacheReadTokens: number;
        cacheWriteTokens: number;
        costUsd: number;
        errors: number;
        inputTokens: number;
        outputTokens: number;
        p50Ms: number;
        p95Ms: number;
        requests: number;
        t: number;
      }
      const history = JSON.parse((await world.call("/api/history?range=1h&by=target")).body) as {
        available: boolean;
        bucketMs: number;
        by: string;
        note: null | string;
        range: string;
        series: { key: string; points: Bucket[] }[];
      };
      expect(history.available).toBe(true);
      expect(history.bucketMs).toBe(MIN);
      expect(history.by).toBe("target");
      expect(history.range).toBe("1h");
      expect(history.note).toBe(null);
      expect(history.series.map((series) => series.key)).toEqual([
        "claude-sonnet-5-5",
        "omniroute:glm",
      ]);
      const glm = history.series.find((series) => series.key === "omniroute:glm");
      // Every bucket of the hour is there, the empty ones as zeros.
      expect(glm?.points).toHaveLength(61);
      expect(glm?.points[0]?.t).toBe(NOW - 60 * MIN);
      // Two requests in the same minute: 100 ms and 300 ms, one of them an error.
      expect(glm?.points.find((point) => point.t === NOW - 10 * MIN)).toEqual({
        cacheReadTokens: 1000,
        cacheWriteTokens: 20,
        costUsd: 0.001,
        errors: 1,
        inputTokens: 10,
        outputTokens: 5,
        p50Ms: 100,
        p95Ms: 300,
        requests: 2,
        t: NOW - 10 * MIN,
      });
      expect(glm?.points.find((point) => point.t === NOW - 5 * MIN)).toMatchObject({
        cacheReadTokens: 0,
        costUsd: 0,
        errors: 0,
        inputTokens: 1,
        outputTokens: 1,
        p50Ms: 200,
        p95Ms: 200,
        requests: 1,
        t: NOW - 5 * MIN,
      });
      expect(glm?.points.find((point) => point.t === NOW - 9 * MIN)).toMatchObject({
        requests: 0,
        errors: 0,
      });

      // One filter: the worker's own rows only (three of the four).
      const filtered = JSON.parse(
        (await world.call("/api/history?range=1h&by=target&slot=cc-smart-dev-kit-worker")).body,
      ) as { series: { key: string; points: Bucket[] }[] };
      expect(filtered.series.map((series) => series.key)).toEqual(["omniroute:glm"]);
      expect(filtered.series[0]?.points.reduce((sum, point) => sum + point.requests, 0)).toBe(3);
      // `status=error`: the one 500.
      const errors = JSON.parse(
        (await world.call("/api/history?range=1h&by=target&status=error")).body,
      ) as { series: { points: Bucket[] }[] };
      expect(errors.series[0]?.points.reduce((sum, point) => sum + point.requests, 0)).toBe(1);
      // `by=slot`: the two slots, not the targets.
      const bySlot = JSON.parse((await world.call("/api/history?range=1h&by=slot")).body) as {
        series: { key: string }[];
      };
      expect(bySlot.series.map((series) => series.key)).toEqual([
        "cc-smart-dev-kit-scout",
        "cc-smart-dev-kit-worker",
      ]);

      // A bad range, grouping or status is a typed refusal.
      expect((await world.call("/api/history?range=nope")).status).toBe(400);
      expect((await world.call("/api/history?by=nope")).status).toBe(400);
      expect((await world.call("/api/history?status=nope")).status).toBe(400);
      expect((await world.call("/api/requests?cursor=abc")).status).toBe(400);

      interface Request {
        at: number;
        costUsd: null | number;
        held: boolean;
        latencyMs: number;
        model: string;
        nextTarget: null | string;
        session: null | string;
        slot: null | string;
        status: number;
        target: string;
        tokens: { cacheRead: number; cacheWrite: number; input: number; output: number };
      }
      // The newest first, two at a time; the cursor is the id of the page's last row.
      const pageOne = JSON.parse((await world.call("/api/requests?limit=2")).body) as {
        available: boolean;
        cursor: null | string;
        note: null | string;
        requests: Request[];
      };
      expect(pageOne.available).toBe(true);
      expect(pageOne.note).toBe(null);
      expect(pageOne.requests.map((one) => one.at)).toEqual([NOW - 5 * MIN, NOW - 9 * MIN]);
      expect(pageOne.cursor).toBe("3");
      expect(pageOne.requests[0]).toEqual({
        at: NOW - 5 * MIN,
        costUsd: null,
        held: true,
        latencyMs: 200,
        model: "claude-opus-5-5",
        nextTarget: "claude-sonnet-5-5",
        session: null,
        slot: "cc-smart-dev-kit-worker",
        status: 200,
        target: "omniroute:glm",
        tokens: { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 },
      });
      const pageTwo = JSON.parse((await world.call("/api/requests?limit=2&cursor=3")).body) as {
        cursor: null | string;
        requests: Request[];
      };
      expect(pageTwo.requests.map((one) => one.at)).toEqual([
        NOW - 10 * MIN + 30_000,
        NOW - 10 * MIN,
      ]);
      // A full page carries the cursor of its last row, even when nothing older is left: the
      // page after it is the empty one, and says there is no more.
      expect(pageTwo.cursor).toBe("1");
      const pageThree = JSON.parse((await world.call("/api/requests?limit=2&cursor=1")).body) as {
        cursor: null | string;
        requests: Request[];
      };
      expect(pageThree.requests).toEqual([]);
      expect(pageThree.cursor).toBe(null);
      // The same filters as the chart, and the cost a row carries.
      const worker = JSON.parse(
        (await world.call("/api/requests?slot=cc-smart-dev-kit-worker")).body,
      ) as { requests: Request[] };
      expect(worker.requests.map((one) => one.at)).toEqual([
        NOW - 5 * MIN,
        NOW - 10 * MIN + 30_000,
        NOW - 10 * MIN,
      ]);
      expect(worker.requests[2]?.costUsd).toBe(0.001);
      const onlyErrors = JSON.parse((await world.call("/api/requests?status=error")).body) as {
        requests: Request[];
      };
      expect(onlyErrors.requests.map((one) => one.status)).toEqual([500]);
    } finally {
      writer.close();
      world.portal.stop();
      backend.stop();
    }
  });

  test("history: no database yet is the empty answer, never an error", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const history = JSON.parse((await world.call("/api/history?range=1d&by=slot")).body) as {
        available: boolean;
        note: null | string;
        series: unknown[];
      };
      expect(history.available).toBe(true);
      expect(history.series).toEqual([]);
      expect(history.note).toContain("no request has been logged yet");
      const requests = JSON.parse((await world.call("/api/requests")).body) as {
        available: boolean;
        cursor: null;
        note: null | string;
        requests: unknown[];
      };
      expect(requests).toEqual({
        available: true,
        cursor: null,
        note: "no request has been logged yet: the router writes one row per request, and this machine has none",
        requests: [],
      });
      expect(existsSync(world.paths.historyDbFile)).toBe(false);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

/** A stream reader as these tests use it: `read` and `cancel` (Bun's own reader has more). */
interface StreamReader {
  cancel: () => Promise<void>;
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}

/** Reads a stream until `needle` appears, or the time runs out. */
async function readStreamUntil(
  reader: StreamReader,
  needle: string,
  timeoutMs = 1_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const until = Date.now() + timeoutMs;
  while (!text.includes(needle) && Date.now() < until) {
    const read = await Promise.race([
      reader.read(),
      Bun.sleep(Math.max(1, until - Date.now())).then(() => ({ done: true, value: undefined })),
    ]);
    if (read.done) break;
    if (read.value !== undefined) text += decoder.decode(read.value, { stream: true });
  }
  return text;
}

/** Reads a stream to its end, or until the time runs out. */
async function readToEnd(reader: StreamReader, timeoutMs = 1_000): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const read = await Promise.race([
      reader.read(),
      Bun.sleep(Math.max(1, until - Date.now())).then(() => ({ done: true, value: undefined })),
    ]);
    if (read.done) break;
    if (read.value !== undefined) text += decoder.decode(read.value, { stream: true });
  }
  return text;
}

describe("the live stream", () => {
  test("eight streams, then 429; a closed one gives its place back", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    const base = `http://127.0.0.1:${world.portal.port}`;
    const stream = () => fetch(`${base}/events`, { headers: { "sec-fetch-site": "same-origin" } });
    const responses: Response[] = [];
    try {
      for (let index = 0; index < 8; index += 1) responses.push(await stream());
      expect(responses.every((one) => one.status === 200)).toBe(true);
      const refused = await stream();
      expect(refused.status).toBe(429);
      expect(JSON.parse(await refused.text()).error).toContain("8 streams");
      await responses[0]?.body?.cancel();
      // The server drops a cancelled stream; the next connection is served.
      await Bun.sleep(20);
      const again = await stream();
      expect(again.status).toBe(200);
      await again.body?.cancel();
    } finally {
      for (const response of responses) await response.body?.cancel().catch(() => undefined);
      world.portal.stop();
      backend.stop();
    }
  });

  test("Last-Event-ID replays through the server, and closing tells the page the portal is going", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    const base = `http://127.0.0.1:${world.portal.port}`;
    try {
      const first = await fetch(`${base}/events`, {
        headers: { "sec-fetch-site": "same-origin" },
      });
      expect(first.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      const reader = first.body?.getReader();
      if (reader === undefined) throw new Error("no body");
      const hello = await readStreamUntil(reader, "event: hello");
      const id = /id: ([^\n]+)/.exec(hello)?.[1] ?? "";
      expect(id.startsWith(`${world.portal.live.runId}:`)).toBe(true);
      await reader.cancel();
      world.portal.live.publish("jobs", { heldGb: 4 });
      const again = await fetch(`${base}/events`, {
        headers: { "last-event-id": id, "sec-fetch-site": "same-origin" },
      });
      const next = again.body?.getReader();
      if (next === undefined) throw new Error("no body");
      const text = await readStreamUntil(next, "event: hello");
      expect(text).toContain("event: jobs");
      expect(text).toContain('"heldGb":4');
      // The portal stops for a new version: every stream is told before it ends.
      world.portal.stop();
      const rest = await readToEnd(next);
      expect(rest).toContain("event: closing");
    } finally {
      backend.stop();
    }
  });

  test("a ping is sent on a stream with nothing else to say", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    const base = `http://127.0.0.1:${world.portal.port}`;
    try {
      // The server's own interval is the hub's (15 s); its hub test drives it at 10 ms. Here
      // the same hub, at 5 ms, proves the format the page reads.
      expect(PING_MS).toBe(15_000);
      const local = new LiveHub({ now: () => 1, pingMs: 5 });
      const opened = local.open(new Request(`${base}/events`));
      if (opened.kind !== "opened") throw new Error("refused");
      const pingReader = opened.response.body?.getReader();
      if (pingReader === undefined) throw new Error("no body");
      expect(await readStreamUntil(pingReader, "event: ping", 1_000)).toContain("event: ping");
      await pingReader.cancel();
      local.stop();
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a doctor pass, an update check and an action's result go out on the stream", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    const base = `http://127.0.0.1:${world.portal.port}`;
    try {
      const stream = await fetch(`${base}/events`, {
        headers: { "sec-fetch-site": "same-origin" },
      });
      const reader = stream.body?.getReader();
      if (reader === undefined) throw new Error("no body");
      await readStreamUntil(reader, "event: hello");
      // The Machine page runs the doctor pass (once) and the server publishes it.
      expect((await world.call("/machine")).status).toBe(200);
      expect(await readStreamUntil(reader, "event: doctor")).toContain('"checks"');
      // An action publishes its own result, and the update check its new state.
      const csrf = await world.csrfOf();
      const checked = await world.post("update.check", {}, csrf);
      // No plugin is installed in this test's temp home, so the check's own answer may be a
      // refusal; the point is that its result reaches the stream either way.
      expect([200, 400]).toContain(checked.status);
      const after = await readStreamUntil(reader, "event: update");
      expect(after).toContain('"action":"update.check"');
      expect(after).toContain('"last"');
      await reader.cancel();
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

describe("the Next.js export, served", () => {
  /** A small export folder: one page with a head, one under a folder, a chunk, and hashes. */
  function exportFixture(): string {
    const folder = tempDir("export");
    writeFileSync(
      join(folder, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"><title>Portal</title></head><body><div id="root"></div></body></html>',
    );
    mkdirSync(join(folder, "work"));
    writeFileSync(
      join(folder, "work", "index.html"),
      "<html><head></head><body>work</body></html>",
    );
    mkdirSync(join(folder, "_next", "static", "chunks"), { recursive: true });
    writeFileSync(join(folder, "_next", "static", "chunks", "app.js"), "console.log(1);\n");
    writeFileSync(
      join(folder, "csp.json"),
      JSON.stringify({ styleAttr: [ATTR_HASH], styleElem: [ELEM_HASH] }),
    );
    return folder;
  }

  test("the pages, the trailing slash, the chunk, and the CSRF meta with the export's policy", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, staticFolder: exportFixture() });
    try {
      const root = await world.call("/");
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(root.body).toContain('<meta name="ccsdk-csrf"');
      expect(root.headers.get("content-security-policy")).toContain(
        `style-src 'self' 'sha256-${ELEM_HASH}'`,
      );
      expect(root.headers.get("content-security-policy")).toContain(
        `style-src-attr 'unsafe-hashes' 'sha256-${ATTR_HASH}'`,
      );
      expect(root.body).toContain('<div id="root">');
      // A page under a folder answers with and without the trailing slash.
      expect((await world.call("/work")).body).toContain("work");
      expect((await world.call("/work/")).body).toContain("work");
      // The build output is served like the assets: no CSRF meta in it.
      const chunk = await world.call("/_next/static/chunks/app.js");
      expect(chunk.status).toBe(200);
      expect(chunk.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(chunk.body).not.toContain("ccsdk-csrf");
      // A route the export does not have falls back to the server-rendered page; an unknown
      // one is the portal's 404 page.
      expect((await world.call("/health")).body).toContain("cc-smart-dev-kit");
      expect((await world.call("/nowhere")).status).toBe(404);
      // The door still holds on the export's files.
      expect((await world.call("/", { headers: { host: "evil.example" } })).status).toBe(403);
      expect(
        (
          await world.call("/_next/static/chunks/app.js", {
            headers: { "sec-fetch-site": "cross-site" },
          })
        ).status,
      ).toBe(403);
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

describe("owner bug: lag", () => {
  test("a slow action never blocks the server: a page answers while it runs, and the stream shows its steps", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const fake = tempDir("slow-claude");
    const bin = join(fake, "bin");
    mkdirSync(bin, { recursive: true });
    const log = join(fake, "claude.log");
    writeFileSync(
      join(bin, "claude"),
      [
        "#!/bin/sh",
        `echo "$*" >> '${log}'`,
        'case "$*" in',
        '  "plugin marketplace update cc-smart-dev-kit") sleep 1; echo refreshed ;;',
        "  *) echo updated ;;",
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const world = await open({
      backendPort: backend.port,
      env: { PATH: `${bin}:/usr/bin:/bin` },
    });
    try {
      // A machine with 1.0.0 installed and 1.1.0 in the marketplace's copy: `update.install`
      // runs two `claude plugin` commands, the first taking a second.
      const plugins = join(world.home, ".claude", "plugins");
      const copy = join(plugins, "marketplaces", "cc-smart-dev-kit");
      mkdirSync(join(copy, "plugin", ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(copy, "plugin", ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "cc-smart-dev-kit", version: "1.1.0" }),
      );
      writeFileSync(
        join(plugins, "installed_plugins.json"),
        JSON.stringify({
          plugins: {
            "cc-smart-dev-kit@cc-smart-dev-kit": [
              { installPath: join(plugins, "cache", "v1.0.0"), scope: "user", version: "1.0.0" },
            ],
          },
          version: 2,
        }),
      );
      writeFileSync(
        join(plugins, "known_marketplaces.json"),
        JSON.stringify({
          "cc-smart-dev-kit": {
            installLocation: copy,
            source: { path: copy, source: "directory" },
          },
        }),
      );
      const csrf = await world.csrfOf();
      // A page that is open while the action runs: its stream shows the action's steps.
      const base = `http://127.0.0.1:${world.portal.port}`;
      const stream = await fetch(`${base}/events`, {
        headers: { "sec-fetch-site": "same-origin" },
      });
      const reader = stream.body?.getReader();
      if (reader === undefined) throw new Error("no body");
      await readStreamUntil(reader, "event: hello");

      let settled = false;
      const started = performance.now();
      const action = world.post("update.install", {}, csrf).finally(() => {
        settled = true;
      });
      // A short pause inside a one-second action: a wide margin, so the page request below
      // lands while the action is really in flight. With the old `Bun.spawnSync` the loop was
      // blocked here, and this sleep could not even finish until the action had.
      await Bun.sleep(100);
      expect(existsSync(log)).toBe(true);
      expect(settled).toBe(false);
      // A page request answers at once, while the action waits on the child.
      const pageStarted = performance.now();
      const page = await world.call("/");
      const pageMs = performance.now() - pageStarted;
      expect(page.status).toBe(200);
      expect(pageMs).toBeLessThan(500);
      expect(settled).toBe(false);
      // The action's progress is on the stream, not only in its answer.
      const progress = await readStreamUntil(reader, "event: action");
      expect(progress).toContain('"action":"update.install"');
      const result = await action;
      expect(result.status).toBe(200);
      expect(JSON.parse(result.body).ok).toBe(true);
      // The action really took its second: the page above answered in a fraction of it.
      expect(performance.now() - started).toBeGreaterThanOrEqual(900);
      await reader.cancel();
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});

describe("the new actions (D52)", () => {
  test("each refuses an input it cannot act on, and says what is missing", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port });
    try {
      const csrf = await world.csrfOf();
      const answer = await world.post("crew.answer", { crew: "", answer: "" }, csrf);
      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.body).lines).toEqual(["Pick the crew session and write an answer."]);
      for (const action of ["crew.stop", "crew.resume", "crew.rm"]) {
        const refused = await world.post(action, {}, csrf);
        expect(refused.status).toBe(400);
        expect(JSON.parse(refused.body).ok).toBe(false);
      }
      const clean = await world.post("worktrees.clean", {}, csrf);
      expect(clean.status).toBe(400);
      expect(JSON.parse(clean.body).lines[0]).toContain("confirmation");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("a crew command runs the CLI's own code: an unknown crew session is its refusal", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({ backendPort: backend.port, projectFiles: {} });
    try {
      const csrf = await world.csrfOf();
      const stopped = await world.post("crew.stop", { crew: "nobody" }, csrf);
      expect(stopped.status).toBe(400);
      expect(JSON.parse(stopped.body).lines.join(" ")).toContain(
        'no crew session of this repository is "nobody"',
      );
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });

  test("crew.answer records the answer as the person, with no Claude Code session", async () => {
    const backend = fakeBackend(["glm-5.3-flash"]);
    const world = await open({
      backendPort: backend.port,
      projectFiles: { config: JSON.stringify({ workflow: { crew: { enabled: true } } }) },
    });
    try {
      const record = { ...crewFixture(world.cwd), state: "blocked" };
      await createCrew(world.paths.stateDir, record, Date.now());
      await addCrewQuestion(
        world.paths.stateDir,
        world.cwd,
        "crew-K-contracts",
        { options: ["Use SQLite", "Use a file"], question: "Where?", recommended: 1 },
        Date.now(),
      );
      const csrf = await world.csrfOf();
      const answered = await world.post(
        "crew.answer",
        { answer: "Use SQLite", crew: "crew-K-contracts" },
        csrf,
      );
      expect(answered.status).toBe(200);
      const body = JSON.parse(answered.body) as { lines: string[]; ok: boolean };
      expect(body.ok).toBe(true);
      // The CLI's own line, with the message the lead sends the crew session.
      expect(body.lines.join("\n")).toContain("answered C my-app K contracts");
      expect(body.lines.join("\n")).toContain("SendMessage");
      const after = readCrew(world.paths.stateDir, world.cwd, "crew-K-contracts");
      expect(after?.questions[0]?.answer).toBe("Use SQLite");
    } finally {
      world.portal.stop();
      backend.stop();
    }
  });
});
