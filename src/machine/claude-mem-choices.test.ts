/**
 * PM1: claude-mem's route, key and quota fallback, set by the person from the portal. Each
 * write is owned (restore takes it out), keeps the file at mode 600, never shows the key, and
 * is the person's: a later setup leaves it as it is.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { restore } from "../setup/restore";
import { tempDir } from "../testing/temp";
import { applyClaudeMem, CHOICES_FILE, claudeMemPlan } from "./claude-mem";
import {
  chooseFallback,
  chooseKey,
  chooseRoute,
  readClaudeMemFacts,
  type TargetCheck,
} from "./claude-mem-choices";

/** The gateway's own key for its OmniRoute backend: no answer, line or record may hold it. */
const GATEWAY_KEY = "sk-gateway-PLANTED-0001";
/** A key the person pastes. */
const OWN_KEY = "sk-own-PLANTED-0002";
const BACKEND_URL = "http://127.0.0.1:18434";

/** claude-mem's settings.json as 13.40.0 seeds it on its first run (the keys that matter). */
const SEEDED = {
  CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_MEM_PROVIDER: "claude",
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEYS: "",
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
  CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
  CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "",
  CLAUDE_MEM_WORK_STATE_ENABLED: "true",
  CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "true",
};

interface Options {
  version?: string | null;
  installed?: boolean;
  settings?: unknown;
  /** A gateway with an OmniRoute backend; `scout` gives its scout slot an affordable chain. */
  gateway?: "none" | "plain" | "scout";
}

function machine(options: Options = {}) {
  const home = tempDir("claude-mem-choices");
  const configDir = join(home, ".claude");
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  if (options.installed !== false) {
    const installPath = join(home, "plugins", "claude-mem");
    mkdirSync(installPath, { recursive: true });
    writeFileSync(
      paths.installedPluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "claude-mem@thedotmack": [
            {
              scope: "user",
              installPath,
              version: options.version === undefined ? "13.40.0" : options.version,
            },
          ],
        },
      }),
    );
  }
  if (options.settings !== undefined) {
    mkdirSync(dirname(paths.claudeMemSettingsFile), { recursive: true });
    writeFileSync(paths.claudeMemSettingsFile, JSON.stringify(options.settings, null, 2), {
      mode: 0o644,
    });
  }
  const gateway = options.gateway ?? "plain";
  if (gateway !== "none") {
    mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
    writeFileSync(
      paths.gatewayConfigFile,
      JSON.stringify({
        version: 1,
        backends: { omniroute: { apiKey: GATEWAY_KEY, baseUrl: BACKEND_URL } },
        slots: gateway === "scout" ? { "cc-smart-dev-kit-scout": ["omniroute:scout/model"] } : {},
      }),
      { mode: 0o600 },
    );
  }
  const checks: Array<{ apiKey: string; backend: string; baseUrl: string; model: string }> = [];
  /** The tiny chat, played: it records what it was asked and answers as told. */
  const check =
    (answer: string | null = null): TargetCheck =>
    async (target) => {
      checks.push({ ...target });
      return answer;
    };
  const settings = () => JSON.parse(readFileSync(paths.claudeMemSettingsFile, "utf8"));
  const settingsText = () => readFileSync(paths.claudeMemSettingsFile, "utf8");
  const mode = () => statSync(paths.claudeMemSettingsFile).mode & 0o777;
  const stateText = () =>
    ["owned.json", CHOICES_FILE]
      .map((name) => {
        try {
          return readFileSync(join(paths.stateDir, name), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
  /** setup's own claude-mem step: plan, then write. */
  const setup = () => {
    const planned = claudeMemPlan(paths);
    if (!("plan" in planned)) throw new Error("no plan");
    applyClaudeMem(paths, planned.plan, false);
    return planned.plan;
  };
  return { check, checks, home, mode, paths, settings, settingsText, setup, stateText };
}

describe("PM1: what the card reads", () => {
  test("PM1: claude-mem not installed, too old, unreadable or in its old form: blocked, with the fix", () => {
    expect(readClaudeMemFacts(machine({ installed: false }).paths)).toMatchObject({
      blocked: {
        fix: "claude plugin install claude-mem@thedotmack",
        text: "claude-mem is not installed, so there is nothing to set.",
      },
      current: null,
      version: null,
    });
    expect(readClaudeMemFacts(machine({ settings: SEEDED, version: "13.20.0" }).paths)).toEqual({
      backends: ["omniroute"],
      blocked: {
        fix: "claude plugin update claude-mem@thedotmack",
        text: "claude-mem 13.20.0 is older than 13.29.0, which brought the openai-compatible provider and the fallback.",
      },
      current: null,
      file: "~/.claude-mem/settings.json",
      minVersion: "13.29.0",
      version: "13.20.0",
    });
    const broken = machine();
    mkdirSync(dirname(broken.paths.claudeMemSettingsFile), { recursive: true });
    writeFileSync(broken.paths.claudeMemSettingsFile, "{ not json");
    expect(readClaudeMemFacts(broken.paths).blocked).toEqual({
      fix: null,
      text: "~/.claude-mem/settings.json cannot be read (it is not valid JSON, or not a JSON object). Fix it by hand, then run cc-smart-dev-kit setup again.",
    });
    expect(
      readClaudeMemFacts(machine({ settings: { env: { CLAUDE_MEM_PROVIDER: "claude" } } }).paths)
        .blocked?.text,
    ).toBe(
      "~/.claude-mem/settings.json is in claude-mem's old nested form, which claude-mem rewrites when it next starts. Start a Claude Code session, then come back.",
    );
  });

  test("PM1: claude-mem's own defaults: Claude, no key, the Claude fallback that never takes over", () => {
    const w = machine({ settings: SEEDED, gateway: "none" });
    expect(readClaudeMemFacts(w.paths)).toEqual({
      backends: null,
      blocked: null,
      current: {
        fallback: {
          idle: "It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider.",
          model: null,
          provider: "claude",
          source: "default",
        },
        key: { pool: false, source: "default", state: "none" },
        route: {
          address: null,
          kind: "claude",
          model: "claude-haiku-4-5-20251001",
          provider: "claude",
          source: "default",
          target: null,
        },
      },
      file: "~/.claude-mem/settings.json",
      minVersion: "13.29.0",
      version: "13.40.0",
    });
  });

  test("PM1: before 13.37.0 an empty fallback means none, not Claude", () => {
    const w = machine({
      settings: { ...SEEDED, CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "" },
      version: "13.36.0",
    });
    expect(readClaudeMemFacts(w.paths).current?.fallback).toEqual({
      idle: null,
      model: null,
      provider: "off",
      source: "default",
    });
  });

  test("PM1: a route setup wrote from the scout reads as setup's, the key as the gateway's", () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    w.setup();
    const facts = readClaudeMemFacts(w.paths);
    expect(facts.current?.route).toEqual({
      address: `${BACKEND_URL}/v1`,
      kind: "backend",
      model: "scout/model",
      provider: "openai-compatible",
      source: "setup",
      target: "omniroute:scout/model",
    });
    expect(facts.current?.key).toEqual({ pool: false, source: "setup", state: "gateway" });
    expect(JSON.stringify(facts)).not.toContain("PLANTED");
  });

  test("PM1: the person's own values by hand read as theirs, and their key as another one", () => {
    const w = machine({
      settings: {
        ...SEEDED,
        CLAUDE_MEM_PROVIDER: "openai-compatible",
        CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "https://user:pass@models.example.com/v1?key=x",
        CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
        CLAUDE_MEM_OPENAI_COMPAT_API_KEY: OWN_KEY,
        CLAUDE_MEM_OPENAI_COMPAT_API_KEYS: "sk-a sk-b",
        CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "gemini",
      },
    });
    const facts = readClaudeMemFacts(w.paths);
    expect(facts.current).toEqual({
      fallback: { idle: null, model: null, provider: "gemini", source: "hand" },
      key: { pool: true, source: "hand", state: "other" },
      route: {
        address: "https://models.example.com/v1",
        kind: "backend",
        model: "their-model",
        provider: "openai-compatible",
        source: "hand",
        target: null,
      },
    });
    const text = JSON.stringify(facts);
    expect(text).not.toContain("PLANTED");
    expect(text).not.toContain("pass@");
    expect(text).not.toContain("sk-a");
  });
});

describe("PM1: the route", () => {
  test("PM1: a backend model: one tiny chat with the gateway's key, then the five keys, owned, mode 600", async () => {
    const w = machine({ settings: SEEDED });
    const result = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    expect(w.checks).toEqual([
      {
        apiKey: GATEWAY_KEY,
        backend: "omniroute",
        baseUrl: `${BACKEND_URL}/v1`,
        model: "glm/flash",
      },
    ]);
    expect(result).toEqual({
      lines: [
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "claude" -> "openai-compatible"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_PRESET: "" -> "custom"',
        `~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "" -> "${BACKEND_URL}/v1"`,
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "" -> "glm/flash"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "" -> "••••0001"',
        "claude-mem reads its settings each time it uses them: its next summaries go to glm/flash on omniroute.",
      ],
      ok: true,
    });
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${BACKEND_URL}/v1`,
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "glm/flash",
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: GATEWAY_KEY,
    });
    // The key went in: the file is the person's alone now (it was 644).
    expect(w.mode()).toBe(0o600);
    // The records keep the key's hash, never the key.
    expect(w.stateText()).not.toContain("PLANTED");
    expect(readClaudeMemFacts(w.paths).current?.route.source).toBe("portal");
    expect(readClaudeMemFacts(w.paths).current?.key).toEqual({
      pool: false,
      source: "portal",
      state: "gateway",
    });
  });

  test("PM1: the tiny chat fails: nothing is written", async () => {
    const w = machine({ settings: SEEDED });
    const before = w.settingsText();
    const result = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check("omniroute refused its key (HTTP 401)"),
    );
    expect(result).toEqual({
      lines: ["Nothing was saved: omniroute refused its key (HTTP 401)."],
      ok: false,
    });
    expect(w.settingsText()).toBe(before);
    expect(w.stateText().trim()).toBe("");
  });

  test("PM1: a backend the gateway does not have, or no gateway at all: refused in words", async () => {
    const w = machine({ settings: SEEDED });
    expect(
      await chooseRoute(w.paths, { backend: "nope", kind: "backend", model: "m" }, w.check()),
    ).toEqual({ lines: ['The gateway has no backend named "nope".'], ok: false });
    const bare = machine({ settings: SEEDED, gateway: "none" });
    expect(
      await chooseRoute(bare.paths, { backend: "omniroute", kind: "backend", model: "m" }),
    ).toEqual({
      lines: ["The gateway is not set up, so it has no backend for claude-mem to use."],
      ok: false,
    });
    expect(w.checks).toEqual([]);
  });

  test("PM1: a value the person set by hand is never overwritten", async () => {
    const w = machine({ settings: { ...SEEDED, CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model" } });
    const before = w.settingsText();
    const result = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain(
      'CLAUDE_MEM_OPENAI_COMPAT_MODEL is "their-model", set by someone else.',
    );
    expect(result.lines[1]).toBe(
      "That value is yours, set in ~/.claude-mem/settings.json by hand: change it there, or remove it to set it here.",
    );
    expect(w.settingsText()).toBe(before);
  });

  test("PM1: the person's own key stays when the route moves, and the chat uses it", async () => {
    const w = machine({ settings: { ...SEEDED, CLAUDE_MEM_OPENAI_COMPAT_API_KEY: OWN_KEY } });
    const result = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    expect(result.ok).toBe(true);
    expect(w.checks[0]?.apiKey).toBe(OWN_KEY);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    expect(result.lines.join("\n")).not.toContain("PLANTED");
  });

  test("PM1: Claude, chosen as claude-mem seeded it: recorded as the person's, and setup leaves it", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    const result = await chooseRoute(w.paths, { kind: "claude" }, w.check());
    expect(result).toEqual({
      lines: [
        "claude-mem already uses that: nothing to change. claude-mem reads its settings each time it uses them: its next summaries go to Claude, on your own Claude login.",
      ],
      ok: true,
    });
    expect(readClaudeMemFacts(w.paths).current?.route.source).toBe("portal");
    // The scout has an affordable model, yet setup leaves the provider keys: the person chose.
    const plan = w.setup();
    expect(plan.provider).toBeNull();
    expect(plan.notes).toEqual([
      "  claude-mem settings left alone: you chose CLAUDE_MEM_PROVIDER in the portal (your choice)",
    ]);
    expect(w.settings().CLAUDE_MEM_PROVIDER).toBe("claude");
  });

  test("PM1: Claude over setup's route: setup's next run leaves the person's Claude", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    w.setup();
    expect(w.settings().CLAUDE_MEM_PROVIDER).toBe("openai-compatible");
    const result = await chooseRoute(w.paths, { kind: "claude" }, w.check());
    expect(result.lines[0]).toBe(
      '~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "openai-compatible" -> "claude"',
    );
    const before = w.settingsText();
    expect(w.setup().provider).toBeNull();
    expect(w.settingsText()).toBe(before);
  });
});

describe("PM1: setup and restore after a portal write", () => {
  test("PM1: setup after a backend route leaves the person's five keys, also with another scout", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    const before = w.settings();
    const plan = w.setup();
    expect(plan.provider).toBeNull();
    // The start blocks are setup's own, and still go off; the route is untouched.
    expect(w.settings()).toEqual({
      ...before,
      CLAUDE_MEM_WORK_STATE_ENABLED: "false",
      CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "false",
    });
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("glm/flash");
  });

  test("PM1: restore takes the person's portal writes out, and the next setup follows the scout again", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    restore(w.paths.stateDir);
    // The owned keys are gone: claude-mem is back on its own defaults for them.
    const after = w.settings();
    expect(after.CLAUDE_MEM_PROVIDER).toBeUndefined();
    expect(after.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBeUndefined();
    expect(after.CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBeUndefined();
    expect(after.CLAUDE_MEM_MODEL).toBe("claude-haiku-4-5-20251001");
    // The old choice no longer counts: setup plans the scout's model again.
    const planned = claudeMemPlan(w.paths);
    expect("plan" in planned && planned.plan.provider?.target.model).toBe("scout/model");
  });

  test("PM1: a Claude choice restore took out no longer counts when claude-mem seeds its default again", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    w.setup();
    await chooseRoute(w.paths, { kind: "claude" }, w.check());
    restore(w.paths.stateDir);
    // claude-mem's next start writes its own default back: the value the person chose.
    writeFileSync(
      w.paths.claudeMemSettingsFile,
      JSON.stringify({ ...w.settings(), CLAUDE_MEM_PROVIDER: "claude" }, null, 2),
    );
    expect(readClaudeMemFacts(w.paths).current?.route.source).toBe("default");
    const planned = claudeMemPlan(w.paths);
    expect("plan" in planned && planned.plan.provider?.target.model).toBe("scout/model");
  });
});

describe("PM1: the key", () => {
  test("PM1: a pasted key: checked, written mode 600, never shown, and only its hash kept", async () => {
    const w = machine({ settings: SEEDED });
    await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    const result = await chooseKey(w.paths, { key: ` ${OWN_KEY} `, kind: "other" }, w.check());
    expect(w.checks.at(-1)).toEqual({
      apiKey: OWN_KEY,
      backend: "omniroute",
      baseUrl: `${BACKEND_URL}/v1`,
      model: "glm/flash",
    });
    expect(result).toEqual({
      lines: [
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "••••0001" -> "••••0002"',
        "claude-mem uses the key you pasted for omniroute. It is in claude-mem's file, readable only by you, and never shown again.",
      ],
      ok: true,
    });
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    expect(w.mode()).toBe(0o600);
    expect(w.stateText()).not.toContain("PLANTED");
    expect(readClaudeMemFacts(w.paths).current?.key).toEqual({
      pool: false,
      source: "portal",
      state: "other",
    });
    // Back to the gateway's own key.
    const back = await chooseKey(w.paths, { kind: "gateway" }, w.check());
    expect(back.ok).toBe(true);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(GATEWAY_KEY);
    expect(back.lines.join("\n")).not.toContain("PLANTED");
  });

  test("PM1: a key with spaces, an empty one, or no backend model yet: refused, nothing written", async () => {
    const w = machine({ settings: SEEDED });
    expect(await chooseKey(w.paths, { key: OWN_KEY, kind: "other" }, w.check())).toEqual({
      lines: ["claude-mem has no backend model yet, so a key has nothing to open: pick one first."],
      ok: false,
    });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "m" }, w.check());
    const before = w.settingsText();
    for (const key of ["", "sk-one sk-two"]) {
      expect(await chooseKey(w.paths, { key, kind: "other" }, w.check())).toEqual({
        lines: [
          "The key was not saved: paste one key, on one line with no spaces, at most 512 characters.",
        ],
        ok: false,
      });
    }
    expect(w.settingsText()).toBe(before);
  });

  test("PM1: the gateway's key for an address that is not a gateway backend: refused", async () => {
    const w = machine({
      settings: {
        ...SEEDED,
        CLAUDE_MEM_PROVIDER: "openai-compatible",
        CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "https://models.example.com/v1",
        CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
      },
    });
    expect(await chooseKey(w.paths, { kind: "gateway" }, w.check())).toEqual({
      lines: [
        "claude-mem's address is not one of the gateway's backends, so the gateway holds no key for it: paste its key instead.",
      ],
      ok: false,
    });
  });

  test("PM1: a refused key is not saved, and the refusal never holds it", async () => {
    const w = machine({ settings: SEEDED });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "m" }, w.check());
    const before = w.settingsText();
    const result = await chooseKey(
      w.paths,
      { key: OWN_KEY, kind: "other" },
      w.check("omniroute refused its key (HTTP 401)"),
    );
    expect(result).toEqual({
      lines: ["The key was not saved: omniroute refused its key (HTTP 401)."],
      ok: false,
    });
    expect(w.settingsText()).toBe(before);
  });
});

describe("PM1: the quota fallback", () => {
  test("PM1: off, then setup: the person's fallback stays (setup takes out only its own)", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    const result = await chooseFallback(w.paths, { kind: "off" }, w.check());
    expect(result).toEqual({
      lines: [
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude" -> "off"',
        "claude-mem has no fallback now: while its provider is limited, it waits.",
      ],
      ok: true,
    });
    const plan = w.setup();
    expect(plan.remove).toEqual([["CLAUDE_MEM_QUOTA_FALLBACK_MODEL"]]);
    expect(w.settings().CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("off");
    expect(readClaudeMemFacts(w.paths).current?.fallback).toEqual({
      idle: null,
      model: null,
      provider: "off",
      source: "portal",
    });
  });

  test("PM1: Claude as the fallback of Claude is refused; of a backend route it is written with its model", async () => {
    const w = machine({ settings: SEEDED });
    expect(await chooseFallback(w.paths, { kind: "claude", model: null }, w.check())).toEqual({
      lines: [
        "claude-mem's route is Claude already, so Claude cannot be its fallback: pick a backend model, or off.",
      ],
      ok: false,
    });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "m" }, w.check());
    const result = await chooseFallback(
      w.paths,
      { kind: "claude", model: "claude-sonnet-5-5" },
      w.check(),
    );
    expect(result).toEqual({
      lines: [
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "" -> "claude-sonnet-5-5"',
        "While its route's provider is limited, claude-mem uses claude-sonnet-5-5 on your own Claude login.",
      ],
      ok: true,
    });
    // Setup after it: the chosen fallback is the person's, also the Claude value 0.4.3 wrote.
    const before = w.settingsText();
    const plan = w.setup();
    expect(plan.remove).toEqual([]);
    expect(JSON.parse(w.settingsText()).CLAUDE_MEM_QUOTA_FALLBACK_MODEL).toBe("claude-sonnet-5-5");
    expect(JSON.parse(before).CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("claude");
  });

  test("PM1: a backend fallback needs the Claude route; on it, the compat keys go in after the chat", async () => {
    const w = machine({ settings: SEEDED });
    const result = await chooseFallback(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    expect(w.checks).toEqual([
      {
        apiKey: GATEWAY_KEY,
        backend: "omniroute",
        baseUrl: `${BACKEND_URL}/v1`,
        model: "glm/flash",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.lines.at(-1)).toBe(
      "While its route's provider is limited, claude-mem sends its summaries to glm/flash on omniroute.",
    );
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_PROVIDER: "claude",
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "glm/flash",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openai-compatible",
    });
    expect(readClaudeMemFacts(w.paths).current?.fallback.idle).toBeNull();
    // On a backend route, a backend fallback is refused: claude-mem has one compat backend.
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "m" }, w.check());
    expect(
      await chooseFallback(
        w.paths,
        { backend: "omniroute", kind: "backend", model: "x" },
        w.check(),
      ),
    ).toEqual({
      lines: [
        "claude-mem has one OpenAI-compatible backend, and its route uses it: the fallback can be Claude, or off.",
      ],
      ok: false,
    });
    expect(readClaudeMemFacts(w.paths).current?.fallback.idle).toBe(
      "It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider.",
    );
  });
});
