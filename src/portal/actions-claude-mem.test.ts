/**
 * PM1: the claude-mem card's three actions. Each refuses without the page's confirmation, takes
 * a model only through the slot picker's own check (the backend must list it), checks a backend
 * with one tiny chat before it writes, and never sends the key back in an answer.
 *
 * A fake backend on a free port of this test stands in for OmniRoute; never the live router.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { saveConfig } from "../gateway/config";
import { fakeDefaults, fakeWorkflow } from "../testing/fake-workflow";
import { tempDir } from "../testing/temp";
import { type ActionContext, portalOmnirouteContext, runAction } from "./actions";
import { testPortalContext } from "./api/test-context";

/** The gateway's key for its backend: no answer may hold it. */
const GATEWAY_KEY = "omni_PLANTED_gateway_0001";
/** A key the person pastes: no answer may hold it either. */
const OWN_KEY = "sk-PLANTED-own-key-0002";

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

/** A backend that lists `models` and answers every chat; it records the key each chat carried. */
function fakeBackend(models: string[]): { port: number; chats: { key: string; model: string }[] } {
  const chats: { key: string; model: string }[] = [];
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/models") {
        return Response.json({ data: models.map((id) => ({ context_length: 200_000, id })) });
      }
      const body = (await request.json()) as { model?: string };
      chats.push({
        key: (request.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
        model: body.model ?? "",
      });
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  stops.push(() => server.stop(true));
  return { chats, port: server.port ?? 0 };
}

/** claude-mem as 13.40.0 seeds its file. */
const SEEDED = {
  CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_MEM_PROVIDER: "claude",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
  CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "",
  CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
};

/** A temp home with claude-mem installed, its seeded file, and (by default) a gateway. */
function world(options: { gateway?: boolean } = {}) {
  const backend = fakeBackend(["glm/flash", "glm/pro"]);
  const home = tempDir("portal-claude-mem");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const installPath = join(home, "plugins", "claude-mem");
  mkdirSync(installPath, { recursive: true });
  mkdirSync(dirname(paths.installedPluginsFile), { recursive: true });
  writeFileSync(
    paths.installedPluginsFile,
    JSON.stringify({
      plugins: {
        "claude-mem@thedotmack": [{ installPath, scope: "user", version: "13.40.0" }],
      },
      version: 2,
    }),
  );
  mkdirSync(dirname(paths.claudeMemSettingsFile), { recursive: true });
  writeFileSync(paths.claudeMemSettingsFile, JSON.stringify(SEEDED, null, 2));
  if (options.gateway !== false) {
    saveConfig(paths.gatewayConfigFile, {
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com",
      backends: {
        omniroute: { apiKey: GATEWAY_KEY, baseUrl: `http://127.0.0.1:${backend.port}` },
      },
      port: 20_199,
      slots: {},
      timeouts: { firstByteMs: 60_000 },
      version: 1,
    });
  }
  const ctx = testPortalContext(paths, { HOME: home }, () => Date.now());
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow: fakeWorkflow(),
  };
  const settingsText = () => readFileSync(paths.claudeMemSettingsFile, "utf8");
  const run = async (name: string, body: Record<string, unknown>) => {
    const result = await runAction(name, body, action);
    // No answer ever holds a key, whatever it says.
    expect(JSON.stringify(result)).not.toContain("PLANTED");
    return result;
  };
  return { backend, paths, run, settingsText };
}

describe("PM1: the claude-mem actions", () => {
  test("PM1: every write refuses without the page's confirmation, and writes nothing", async () => {
    const w = world();
    const before = w.settingsText();
    const refused = {
      lines: ["Nothing was saved: the page's confirmation did not come with the request."],
      ok: false,
    };
    expect(await w.run("claudemem.route", { target: "omniroute:glm/flash" })).toEqual(refused);
    expect(await w.run("claudemem.key", { key: OWN_KEY, use: "other" })).toEqual(refused);
    expect(await w.run("claudemem.fallback", { target: "off" })).toEqual(refused);
    expect(await w.run("claudemem.follow", {})).toEqual({
      lines: ["Nothing was changed: the page's confirmation did not come with the request."],
      ok: false,
    });
    expect(w.settingsText()).toBe(before);
    expect(w.backend.chats).toEqual([]);
  });

  test("PM1: empty bodies say what is missing", async () => {
    const w = world();
    expect(await w.run("claudemem.route", {})).toEqual({
      lines: ['Pick "claude" or a model from the list.'],
      ok: false,
    });
    expect(await w.run("claudemem.key", {})).toEqual({
      lines: ['Say which key: "gateway" or "other".'],
      ok: false,
    });
    expect(await w.run("claudemem.fallback", {})).toEqual({
      lines: ['Pick "off", "claude" or a model from the list.'],
      ok: false,
    });
  });

  test("PM1: a model the backend does not list is refused by the slot picker's check, before any chat", async () => {
    const w = world();
    const before = w.settingsText();
    const result = await w.run("claudemem.route", {
      confirm: true,
      target: "omniroute:typed-free",
    });
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([
      '"omniroute:typed-free": "omniroute" has no model "typed-free" (see cc-smart-dev-kit gateway models)',
    ]);
    expect(await w.run("claudemem.route", { confirm: true, target: "nope:m" })).toEqual({
      lines: ['"nope:m": backend "nope" is not in the config. The config names: omniroute.'],
      ok: false,
    });
    expect(w.backend.chats).toEqual([]);
    expect(w.settingsText()).toBe(before);
  });

  test("PM1: a listed model: one chat with the gateway's key, then claude-mem's keys", async () => {
    const w = world();
    const result = await w.run("claudemem.route", {
      confirm: true,
      target: "omniroute:glm/flash",
    });
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toBe(
      "claude-mem reads its settings each time it uses them: its next summaries go to glm/flash on omniroute.",
    );
    expect(w.backend.chats).toEqual([{ key: GATEWAY_KEY, model: "glm/flash" }]);
    const settings = JSON.parse(w.settingsText());
    expect(settings.CLAUDE_MEM_PROVIDER).toBe("openai-compatible");
    expect(settings.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("glm/flash");
    expect(settings.CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(GATEWAY_KEY);
  });

  test("PM1: a pasted key is checked with a chat, saved, and never sent back", async () => {
    const w = world();
    await w.run("claudemem.route", { confirm: true, target: "omniroute:glm/flash" });
    const result = await w.run("claudemem.key", { confirm: true, key: OWN_KEY, use: "other" });
    expect(result.ok).toBe(true);
    expect(w.backend.chats.at(-1)).toEqual({ key: OWN_KEY, model: "glm/flash" });
    expect(JSON.parse(w.settingsText()).CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    // Back to the gateway's own key.
    expect((await w.run("claudemem.key", { confirm: true, use: "gateway" })).ok).toBe(true);
    expect(JSON.parse(w.settingsText()).CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(GATEWAY_KEY);
  });

  test("PM1: the fallback: a Claude model from the list, off, and claude as the route itself", async () => {
    const w = world();
    expect(await w.run("claudemem.fallback", { confirm: true, target: "claude" })).toEqual({
      lines: [
        "claude-mem's route is Claude already, so Claude cannot be its fallback: pick a backend model, or off.",
      ],
      ok: false,
    });
    await w.run("claudemem.route", { confirm: true, target: "omniroute:glm/flash" });
    const claude = await w.run("claudemem.fallback", {
      confirm: true,
      target: "claude-sonnet-5-5",
    });
    expect(claude.ok).toBe(true);
    expect(JSON.parse(w.settingsText()).CLAUDE_MEM_QUOTA_FALLBACK_MODEL).toBe("claude-sonnet-5-5");
    expect((await w.run("claudemem.fallback", { confirm: true, target: "off" })).ok).toBe(true);
    expect(JSON.parse(w.settingsText()).CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("off");
    // Back to Claude for the route: the Claude route needs no backend and no chat.
    const chats = w.backend.chats.length;
    expect((await w.run("claudemem.route", { confirm: true, target: "claude" })).ok).toBe(true);
    expect(w.backend.chats.length).toBe(chats);
    // A Claude model is not a route: the route is "claude", on claude-mem's own Claude model.
    expect(await w.run("claudemem.route", { confirm: true, target: "claude-sonnet-5-5" })).toEqual({
      lines: [
        'claude-sonnet-5-5 is a Claude model: pick "claude" for the Claude route (claude-mem\'s own Claude model).',
      ],
      ok: false,
    });
  });

  test("PM1: no gateway: a backend route is refused in words, the Claude route still works", async () => {
    const w = world({ gateway: false });
    expect(
      await w.run("claudemem.route", { confirm: true, target: "omniroute:glm/flash" }),
    ).toEqual({
      lines: ["The gateway is not set up, so it has no backend for claude-mem to use."],
      ok: false,
    });
    expect((await w.run("claudemem.route", { confirm: true, target: "claude" })).ok).toBe(true);
    expect(existsSync(w.paths.gatewayConfigFile)).toBe(false);
  });
});
