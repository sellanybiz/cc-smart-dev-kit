/**
 * PM1: claude-mem's route, key and quota fallback, set by the person from the portal. Each
 * write is owned (restore takes it out), keeps the file at mode 600, never shows the key, and
 * is the person's: a later setup leaves it as it is.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { applyManagedJson, ownedRecords } from "../setup/managed-json";
import { restore } from "../setup/restore";
import { listBackups, realTarget } from "../setup/write";
import { tempDir } from "../testing/temp";
import { applyClaudeMem, CHOICES_FILE, claudeMemPlan, forgetClaudeMemChoices } from "./claude-mem";
import {
  chooseFallback,
  chooseKey,
  chooseRoute,
  followSetup,
  readClaudeMemFacts,
  restoreTakenOver,
  type TargetCheck,
  takeOver,
} from "./claude-mem-choices";

/** The gateway's own key for its OmniRoute backend: no answer, line or record may hold it. */
const GATEWAY_KEY = "sk-gateway-PLANTED-0001";
/** A key the person pastes. */
const OWN_KEY = "sk-own-PLANTED-0002";
const BACKEND_URL = "http://127.0.0.1:18434";
/** The gateway's second backend, and its own key. */
const OTHER_KEY = "sk-other-PLANTED-0003";
const OTHER_URL = "http://127.0.0.1:18435";

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
        backends: {
          omniroute: { apiKey: GATEWAY_KEY, baseUrl: BACKEND_URL },
          // A second backend, with its own key: a route that moves must never take the first's.
          other: { apiKey: OTHER_KEY, baseUrl: OTHER_URL },
        },
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
      backends: ["omniroute", "other"],
      blocked: {
        fix: "claude plugin update claude-mem@thedotmack",
        text: "claude-mem 13.20.0 is older than 13.29.0, which brought the openai-compatible provider and the fallback.",
      },
      current: null,
      file: "~/.claude-mem/settings.json",
      handKeys: [],
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
          claudeModel: "claude-haiku-4-5-20251001",
          idle: "It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider.",
          model: null,
          provider: "claude",
          refusedByHand: false,
          source: "default",
          target: null,
        },
        key: { pool: false, refusedByHand: false, source: "default", state: "none" },
        route: {
          address: null,
          kind: "claude",
          model: "claude-haiku-4-5-20251001",
          provider: "claude",
          refusedByHand: false,
          source: "default",
          target: null,
        },
      },
      file: "~/.claude-mem/settings.json",
      handKeys: [],
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
      claudeModel: null,
      idle: null,
      model: null,
      provider: "off",
      refusedByHand: false,
      source: "default",
      target: null,
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
      refusedByHand: false,
      source: "setup",
      target: "omniroute:scout/model",
    });
    expect(facts.current?.key).toEqual({
      pool: false,
      refusedByHand: false,
      source: "setup",
      state: "gateway",
    });
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
    expect(facts.handKeys).toEqual([
      "CLAUDE_MEM_PROVIDER",
      "CLAUDE_MEM_OPENAI_COMPAT_BASE_URL",
      "CLAUDE_MEM_OPENAI_COMPAT_MODEL",
      "CLAUDE_MEM_OPENAI_COMPAT_API_KEY",
      "CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER",
    ]);
    expect(facts.current).toEqual({
      fallback: {
        claudeModel: null,
        idle: null,
        model: null,
        provider: "gemini",
        refusedByHand: true,
        source: "hand",
        target: null,
      },
      key: { pool: true, refusedByHand: true, source: "hand", state: "other" },
      route: {
        address: "https://models.example.com/v1",
        kind: "backend",
        model: "their-model",
        provider: "openai-compatible",
        refusedByHand: true,
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
        "claude-mem reads its settings each time it uses them: its next summaries go to glm/flash on omniroute.",
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "claude" -> "openai-compatible"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_PRESET: "" -> "custom"',
        `~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "" -> "${BACKEND_URL}/v1"`,
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "" -> "glm/flash"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "" -> "••••0001"',
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
      refusedByHand: false,
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
    expect(result).toEqual({
      lines: [
        'Nothing was saved: CLAUDE_MEM_OPENAI_COMPAT_MODEL is "their-model" in ~/.claude-mem/settings.json, set by hand. Change it there, or remove it there to set it here.',
      ],
      ok: false,
    });
    expect(w.settingsText()).toBe(before);
    // The person's own key by hand: named as masked, never whole.
    const keyed = machine({
      settings: {
        ...SEEDED,
        CLAUDE_MEM_PROVIDER: "openai-compatible",
        CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${BACKEND_URL}/v1`,
        CLAUDE_MEM_OPENAI_COMPAT_MODEL: "m",
        CLAUDE_MEM_OPENAI_COMPAT_API_KEY: OWN_KEY,
      },
    });
    const refused = await chooseKey(keyed.paths, { kind: "gateway" }, keyed.check());
    expect(refused).toEqual({
      lines: [
        'Nothing was saved: CLAUDE_MEM_OPENAI_COMPAT_API_KEY is "••••0002" in ~/.claude-mem/settings.json, set by hand. Change it there, or remove it there to set it here.',
      ],
      ok: false,
    });
    // A refused write sends no request at all: the refusal comes before the tiny chat.
    expect(keyed.checks).toEqual([]);
    expect(w.checks).toEqual([]);
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
        // The fallback is Claude too, so claude-mem ignores it: the person hears that before it
        // waits for a fallback that cannot come (Low 8).
        "! claude-mem's fallback is Claude, the same as the route now, so claude-mem ignores it: choose the fallback again, or off.",
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
    expect(result.lines[1]).toBe(
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
    // Only memory-use goes off; work state and the route stay untouched.
    expect(w.settings()).toEqual({
      ...before,
      CLAUDE_MEM_WORK_STATE_ENABLED: "true",
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

  test("PM1: after restore, setup, and a new scout model, setup follows the scout: the old choice never comes back", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    // What `cc-smart-dev-kit restore` does: the owned keys out, and the choices with them.
    restore(w.paths.stateDir);
    expect(forgetClaudeMemChoices(w.paths.stateDir)).toBe(join(w.paths.stateDir, CHOICES_FILE));
    // setup writes the scout's values: the same provider and preset the old choice held.
    w.setup();
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("scout/model");
    // The scout moves on: the next setup follows it.
    const config = JSON.parse(readFileSync(w.paths.gatewayConfigFile, "utf8"));
    config.slots["cc-smart-dev-kit-scout"] = ["omniroute:scout/next"];
    writeFileSync(w.paths.gatewayConfigFile, JSON.stringify(config), { mode: 0o600 });
    const plan = w.setup();
    expect(plan.notes).toEqual([]);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("scout/next");
  });
});

describe("PM1: back to setup", () => {
  test("D68: following the scout leaves an old work-state claim alone", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    applyManagedJson({
      file: w.paths.claudeMemSettingsFile,
      stateDir: w.paths.stateDir,
      set: [[["CLAUDE_MEM_WORK_STATE_ENABLED"], "false"]],
      unchosen: () => true,
    });
    await followSetup(w.paths, w.check());
    expect(w.settings().CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
    expect(ownedRecords(w.paths.stateDir, w.paths.claudeMemSettingsFile)).toContainEqual({
      path: ["CLAUDE_MEM_WORK_STATE_ENABLED"],
      value: "false",
    });
  });
  test("PM1: the person's choices are forgotten, and setup's own step puts the scout's model back", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    await chooseFallback(w.paths, { kind: "claude", model: "claude-sonnet-5-5" }, w.check());
    const result = await followSetup(w.paths, w.check());
    expect(result).toEqual({
      lines: [
        "Your choices are forgotten: setup decides claude-mem's route again, from the scout slot.",
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "glm/flash" -> "scout/model"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-sonnet-5-5" -> (none)',
      ],
      ok: true,
    });
    expect(w.checks.at(-1)?.model).toBe("scout/model");
    // The fallback provider held claude-mem's own default already: it is not the person's now.
    expect(readClaudeMemFacts(w.paths).current).toMatchObject({
      fallback: { provider: "claude", source: "default" },
      route: { source: "setup", target: "omniroute:scout/model" },
    });
    // The start blocks are setup's own step: left as they were.
    expect(w.settings().CLAUDE_MEM_WORK_STATE_ENABLED).toBe("true");
    // A later setup has nothing of the person's to leave alone.
    expect(w.setup().notes).toEqual([]);
  });
});

describe("PM1: a route that moves between backends, and a change while the check runs", () => {
  test("PM1: from one backend to another, the key follows the backend: the first's key never goes to the second", async () => {
    const w = machine({ settings: SEEDED });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "a" }, w.check());
    const result = await chooseRoute(
      w.paths,
      { backend: "other", kind: "backend", model: "b" },
      w.check(),
    );
    expect(result.ok).toBe(true);
    expect(w.checks.at(-1)).toEqual({
      apiKey: OTHER_KEY,
      backend: "other",
      baseUrl: `${OTHER_URL}/v1`,
      model: "b",
    });
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OTHER_KEY);
    expect(readClaudeMemFacts(w.paths).current?.key.state).toBe("gateway");
  });

  test("PM1: a key the person pasted moves with the route: it is theirs, not a gateway key", async () => {
    const w = machine({ settings: SEEDED });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "a" }, w.check());
    await chooseKey(w.paths, { key: OWN_KEY, kind: "other" }, w.check());
    await chooseRoute(w.paths, { backend: "other", kind: "backend", model: "b" }, w.check());
    expect(w.checks.at(-1)?.apiKey).toBe(OWN_KEY);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
  });

  test("PM1: the settings change while the check runs (another tab pastes a key): nothing is written", async () => {
    const w = machine({ settings: SEEDED });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "a" }, w.check());
    const pasteMeanwhile: TargetCheck = async () => {
      await chooseKey(w.paths, { key: OWN_KEY, kind: "other" }, w.check());
      return null;
    };
    const result = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "b" },
      pasteMeanwhile,
    );
    expect(result).toEqual({
      lines: [
        "Nothing was saved: claude-mem's settings changed while the kit checked the model (another tab, setup, or claude-mem itself). Look at the card again, then choose again.",
      ],
      ok: false,
    });
    // The other tab's key stays; the model stays as it was.
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("a");
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
        "claude-mem uses the key you pasted for omniroute. It is in claude-mem's file, readable only by you, and never shown again.",
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "••••0001" -> "••••0002"',
      ],
      ok: true,
    });
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    expect(w.mode()).toBe(0o600);
    expect(w.stateText()).not.toContain("PLANTED");
    expect(readClaudeMemFacts(w.paths).current?.key).toEqual({
      pool: false,
      refusedByHand: false,
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
  test("PM1: off before 13.37.0 is the empty value (claude-mem refuses `off` there), and reads as off", async () => {
    const w = machine({ settings: SEEDED, version: "13.36.0" });
    const result = await chooseFallback(w.paths, { kind: "off" }, w.check());
    expect(result.ok).toBe(true);
    expect(w.settings().CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("");
    expect(readClaudeMemFacts(w.paths).current?.fallback).toEqual({
      claudeModel: null,
      idle: null,
      model: null,
      provider: "off",
      refusedByHand: false,
      source: "portal",
      target: null,
    });
  });

  test("PM1: off, then setup: the person's fallback stays (setup takes out only its own)", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    const result = await chooseFallback(w.paths, { kind: "off" }, w.check());
    expect(result).toEqual({
      lines: [
        "claude-mem has no fallback now: while its provider is limited, it waits.",
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude" -> "off"',
      ],
      ok: true,
    });
    const plan = w.setup();
    expect(plan.remove).toEqual([["CLAUDE_MEM_QUOTA_FALLBACK_MODEL"]]);
    expect(w.settings().CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("off");
    expect(readClaudeMemFacts(w.paths).current?.fallback).toEqual({
      claudeModel: null,
      idle: null,
      model: null,
      provider: "off",
      refusedByHand: false,
      source: "portal",
      target: null,
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
        "While its route's provider is limited, claude-mem uses claude-sonnet-5-5 on your own Claude login.",
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "" -> "claude-sonnet-5-5"',
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

  test("PM1: a backend fallback on the Claude route holds the compat keys, after the chat", async () => {
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
    expect(result.lines[0]).toBe(
      "While its route's provider is limited, claude-mem sends its summaries to glm/flash on omniroute.",
    );
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_PROVIDER: "claude",
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "glm/flash",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openai-compatible",
    });
    expect(readClaudeMemFacts(w.paths).current?.fallback).toMatchObject({
      idle: null,
      provider: "openai-compatible",
      target: "omniroute:glm/flash",
    });
    // The Claude route names no backend: the address and the model are the fallback's.
    expect(readClaudeMemFacts(w.paths).current?.route).toMatchObject({
      address: null,
      target: null,
    });
    // The route becomes a backend, so the compat keys are the route's now and this fallback
    // can never take over: the write says so, and the card reads it as idle.
    const route = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "m" },
      w.check(),
    );
    expect(route.lines.at(-1)).toBe(
      "! claude-mem's fallback is on the route's own provider now, so claude-mem ignores it: choose the fallback again, or off.",
    );
    expect(readClaudeMemFacts(w.paths).current?.fallback.idle).toBe(
      "It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider.",
    );
    // Choosing the fallback again moves it to claude-mem's OpenRouter setup, at the same
    // backend: MS1's own test above reads every key of it.
    expect(
      (
        await chooseFallback(
          w.paths,
          { backend: "omniroute", kind: "backend", model: "x" },
          w.check(),
        )
      ).ok,
    ).toBe(true);
    expect(w.settings().CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("openrouter");
  });
});

describe("MS1: the fallback can be another backend model, on any route", () => {
  test("MS1: on a backend route, the fallback takes claude-mem's OpenRouter provider, at the same backend", async () => {
    const w = machine({ settings: SEEDED });
    await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "route/model" },
      w.check(),
    );
    const result = await chooseFallback(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "fallback/model" },
      w.check(),
    );
    expect(w.checks.at(-1)).toEqual({
      apiKey: GATEWAY_KEY,
      backend: "omniroute",
      baseUrl: `${BACKEND_URL}/v1`,
      model: "fallback/model",
    });
    expect(result).toEqual({
      lines: [
        "While its route's provider is limited, claude-mem sends its summaries to fallback/model on omniroute.",
        `~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENROUTER_BASE_URL: (none) -> "${BACKEND_URL}/v1"`,
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENROUTER_MODEL: (none) -> "fallback/model"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENROUTER_API_KEY: (none) -> "••••0001"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude" -> "openrouter"',
      ],
      ok: true,
    });
    // The route's own keys are untouched: the two providers reach the same backend apart.
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "route/model",
      CLAUDE_MEM_OPENROUTER_API_KEY: GATEWAY_KEY,
      CLAUDE_MEM_OPENROUTER_BASE_URL: `${BACKEND_URL}/v1`,
      CLAUDE_MEM_OPENROUTER_MODEL: "fallback/model",
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openrouter",
    });
    const facts = readClaudeMemFacts(w.paths);
    expect(facts.current?.fallback).toMatchObject({
      idle: null,
      model: null,
      provider: "openrouter",
      source: "portal",
      target: "omniroute:fallback/model",
    });
    expect(facts.current?.route).toMatchObject({
      model: "route/model",
      target: "omniroute:route/model",
    });
    expect(JSON.stringify(facts)).not.toContain("PLANTED");
    // The key is a secret here too: the file is the person's alone, and no record holds it.
    expect(w.mode()).toBe(0o600);
    expect(w.stateText()).not.toContain("PLANTED");
  });

  test("MS1: on the Claude route the fallback keeps the compat keys, as before", async () => {
    const w = machine({ settings: SEEDED });
    const result = await chooseFallback(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    expect(result.ok).toBe(true);
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "glm/flash",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openai-compatible",
    });
    expect(w.settings().CLAUDE_MEM_OPENROUTER_BASE_URL).toBeUndefined();
    expect(readClaudeMemFacts(w.paths).current?.fallback).toMatchObject({
      provider: "openai-compatible",
      target: "omniroute:glm/flash",
    });
  });

  test("MS1: a hand-set OpenRouter address is never taken: refused in words, nothing checked", async () => {
    const w = machine({
      settings: {
        ...SEEDED,
        CLAUDE_MEM_OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        CLAUDE_MEM_OPENROUTER_MODEL: "their/model",
      },
    });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "m" }, w.check());
    const before = w.settingsText();
    expect(
      await chooseFallback(
        w.paths,
        { backend: "omniroute", kind: "backend", model: "x" },
        w.check(),
      ),
    ).toEqual({
      lines: [
        'Nothing was saved: CLAUDE_MEM_OPENROUTER_BASE_URL is "https://openrouter.ai/api/v1" in ~/.claude-mem/settings.json, set by hand. Change it there, or remove it there to set it here.',
      ],
      ok: false,
    });
    expect(w.settingsText()).toBe(before);
  });

  test("MS1: the compat fallback goes idle when the route takes its provider, and says so", async () => {
    const w = machine({ settings: SEEDED });
    await chooseFallback(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    const result = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "route/model" },
      w.check(),
    );
    expect(result.lines.at(-1)).toBe(
      "! claude-mem's fallback is on the route's own provider now, so claude-mem ignores it: choose the fallback again, or off.",
    );
    expect(readClaudeMemFacts(w.paths).current?.fallback).toMatchObject({
      idle: "It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider.",
      provider: "openai-compatible",
    });
  });

  test("MS1: off, and Claude, are unchanged on a backend route", async () => {
    const w = machine({ settings: SEEDED });
    await chooseRoute(w.paths, { backend: "omniroute", kind: "backend", model: "m" }, w.check());
    expect((await chooseFallback(w.paths, { kind: "off" }, w.check())).ok).toBe(true);
    expect(w.settings().CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("off");
    expect(
      await chooseFallback(w.paths, { kind: "claude", model: "claude-haiku-5-5" }, w.check()),
    ).toEqual({
      lines: [
        "While its route's provider is limited, claude-mem uses claude-haiku-5-5 on your own Claude login.",
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "off" -> "claude"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "" -> "claude-haiku-5-5"',
      ],
      ok: true,
    });
  });
});

describe("MS1: the take-over, and what restore puts back", () => {
  /** claude-mem pointed at OmniRoute by hand, as the owner's own machine is. */
  const BY_HAND = {
    ...SEEDED,
    CLAUDE_MEM_OPENAI_COMPAT_API_KEY: OWN_KEY,
    CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${BACKEND_URL}/v1`,
    CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
    CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
    CLAUDE_MEM_PROVIDER: "openai-compatible",
  };

  test("MS1: a refused change succeeds after the take-over, and the file did not change", async () => {
    const w = machine({ settings: BY_HAND });
    expect(
      await chooseRoute(
        w.paths,
        { backend: "omniroute", kind: "backend", model: "glm/flash" },
        w.check(),
      ),
    ).toEqual({
      lines: [
        'Nothing was saved: CLAUDE_MEM_OPENAI_COMPAT_MODEL is "their-model" in ~/.claude-mem/settings.json, set by hand. Change it there, or remove it there to set it here.',
      ],
      ok: false,
    });
    const before = w.settingsText();
    expect(await takeOver(w.paths)).toEqual({
      lines: [
        "The take-over recorded 5 values of claude-mem's as cc-smart-dev-kit's: each stays exactly as it is until you pick another.",
        '  ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "openai-compatible"',
        '  ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom"',
        `  ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "${BACKEND_URL}/v1"`,
        '  ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model"',
        '  ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "••••0002"',
        "restore puts them back.",
        "A key's value is never written down: restore leaves your key as it is while it is still yours. Once cc-smart-dev-kit replaced it, restore keeps the kit's key only with the address it was written for. Where your address comes back, your key comes back with it, from the backup of your file; with no backup that holds it, the kit's key is removed.",
      ],
      ok: true,
    });
    // Nothing in claude-mem's file changed, and no record holds the key.
    expect(w.settingsText()).toBe(before);
    expect(w.stateText()).not.toContain("PLANTED");
    expect(readClaudeMemFacts(w.paths).handKeys).toEqual([]);
    // Now the route changes through the ordinary chooser.
    const result = await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    expect(result.ok).toBe(true);
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "glm/flash",
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: OWN_KEY,
      CLAUDE_MEM_PROVIDER: "openai-compatible",
    });
    // The person's own key stayed theirs: the chat ran with it.
    expect(w.checks.at(-1)?.apiKey).toBe(OWN_KEY);
  });

  test("MS1: restore puts the taken-over values back; a key the kit never replaced stays", async () => {
    const w = machine({ settings: BY_HAND });
    await takeOver(w.paths);
    await chooseRoute(
      w.paths,
      { backend: "omniroute", kind: "backend", model: "glm/flash" },
      w.check(),
    );
    // What `cc-smart-dev-kit restore` does: the take-over's values back first, then its pass.
    const back = await restoreTakenOver(w.paths);
    restore(w.paths.stateDir);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("their-model");
    expect(back).toEqual({
      lines: [
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model" (yours again)',
        "~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: yours again (still the key you set)",
      ],
      ok: true,
    });
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: OWN_KEY,
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${BACKEND_URL}/v1`,
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
      CLAUDE_MEM_PROVIDER: "openai-compatible",
    });
    // Nothing of cc-smart-dev-kit's is left in it, and a second restore changes nothing.
    expect(ownedRecords(w.paths.stateDir, realTarget(w.paths.claudeMemSettingsFile))).toEqual([]);
    expect(restore(w.paths.stateDir)).toEqual([]);
    expect(await restoreTakenOver(w.paths)).toEqual({ lines: [], ok: true });
  });

  test("MS1: a key cc-smart-dev-kit replaced since stays too, and restore names its backup", async () => {
    const w = machine({ settings: BY_HAND });
    await takeOver(w.paths);
    // The person picks another key through the kit: cc-smart-dev-kit writes this one.
    const picked = "sk-picked-PLANTED-0003";
    expect(await chooseKey(w.paths, { key: picked, kind: "other" }, w.check())).toMatchObject({
      ok: true,
    });
    const back = await restoreTakenOver(w.paths);
    // The key the kit wrote stays: the older one cannot be written back (its value was never kept),
    // so the line names the backup whose copy still holds it — the path only, never the key.
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(picked);
    const line = back.lines.find((one) => one.includes("CLAUDE_MEM_OPENAI_COMPAT_API_KEY"));
    expect(line).toMatch(
      /^! ~\/\.claude-mem\/settings\.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: cc-smart-dev-kit replaced it after the take-over; the key you set before is in the backup at ~\/\.claude\/cc-smart-dev-kit\/backups\//,
    );
    expect(line).not.toContain(picked);
    expect(line).not.toContain(OWN_KEY);
    // The claim is gone: nothing of ours is left to remove.
    expect(ownedRecords(w.paths.stateDir, realTarget(w.paths.claudeMemSettingsFile))).toEqual([]);
  });

  describe("RV6: after restore, the key in the file belongs to the address in the file", () => {
    const KEY = "CLAUDE_MEM_OPENAI_COMPAT_API_KEY";
    const ADDRESS = "CLAUDE_MEM_OPENAI_COMPAT_BASE_URL";

    /** The route moved to another backend: the kit wrote that backend's address AND its key. */
    async function movedToOther() {
      const w = machine({ settings: BY_HAND });
      await takeOver(w.paths);
      await chooseRoute(w.paths, { backend: "other", kind: "backend", model: "b" }, w.check());
      expect(w.settings()).toMatchObject({ [KEY]: OTHER_KEY, [ADDRESS]: `${OTHER_URL}/v1` });
      return w;
    }

    /** Takes every backup away: nothing is left to read the person's own key from. */
    function noBackups(w: ReturnType<typeof machine>) {
      rmSync(join(w.paths.stateDir, "backups"), { force: true, recursive: true });
    }

    test("the person's own key is put back with their address, from the kit's own backup", async () => {
      const w = await movedToOther();
      const back = await restoreTakenOver(w.paths);
      // The pair is whole: their address and the key they set for it, never the other backend's.
      expect(w.settings()).toMatchObject({ [KEY]: OWN_KEY, [ADDRESS]: `${BACKEND_URL}/v1` });
      const line = back.lines.find((one) => one.includes(KEY));
      expect(line).toMatch(
        /^~ ~\/\.claude-mem\/settings\.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: yours again \(the key you set before, put back from the backup at ~\/\.claude\/cc-smart-dev-kit\/backups\//,
      );
      expect(line).not.toContain(OWN_KEY);
      expect(line).not.toContain(OTHER_KEY);
      expect(ownedRecords(w.paths.stateDir, realTarget(w.paths.claudeMemSettingsFile))).toEqual([]);
      // Nothing of ours is left in it: the restore's own pass changes nothing more, and the
      // file is forgotten, so a second restore has nothing to say.
      expect(restore(w.paths.stateDir).map((one) => one.action)).toEqual(["unchanged"]);
      expect(restore(w.paths.stateDir)).toEqual([]);
      expect(w.settings()).toMatchObject({ [KEY]: OWN_KEY, [ADDRESS]: `${BACKEND_URL}/v1` });
    });

    test("no backup holds their key: the kit's key goes, and their address is left with none", async () => {
      const w = await movedToOther();
      noBackups(w);
      const back = await restoreTakenOver(w.paths);
      expect(w.settings()[ADDRESS]).toBe(`${BACKEND_URL}/v1`);
      expect(w.settings()[KEY]).toBeUndefined();
      const line = back.lines.find((one) => one.includes(KEY));
      expect(line).toBe(
        "! ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: removed: cc-smart-dev-kit wrote it for another address than yours, and no backup is known to hold the key you set before (earlier copies, if any, are in the backups folder).",
      );
      expect(ownedRecords(w.paths.stateDir, realTarget(w.paths.claudeMemSettingsFile))).toEqual([]);
    });

    test("a key the person typed in the portal for the other address goes too", async () => {
      const w = await movedToOther();
      // The person types a key for that backend's address: still not a key for their own address.
      const typed = "sk-typed-PLANTED-0004";
      expect(await chooseKey(w.paths, { key: typed, kind: "other" }, w.check())).toMatchObject({
        ok: true,
      });
      expect(w.settings()[KEY]).toBe(typed);
      noBackups(w);
      const back = await restoreTakenOver(w.paths);
      expect(w.settings()[ADDRESS]).toBe(`${BACKEND_URL}/v1`);
      expect(w.settings()[KEY]).toBeUndefined();
      expect(back.lines.join("\n")).not.toContain(typed);
    });

    test("the gateway's config unreadable changes nothing: the record says what the kit wrote", async () => {
      const w = await movedToOther();
      writeFileSync(w.paths.gatewayConfigFile, "{ not json");
      await restoreTakenOver(w.paths);
      expect(w.settings()).toMatchObject({ [KEY]: OWN_KEY, [ADDRESS]: `${BACKEND_URL}/v1` });
    });

    /** The person edits the address by hand, back to the one they had. */
    function addressByHand(w: ReturnType<typeof machine>, address: string) {
      writeFileSync(
        w.paths.claudeMemSettingsFile,
        JSON.stringify({ ...w.settings(), [ADDRESS]: address }, null, 2),
      );
    }

    test("an address the person set back by hand does not keep the other backend's key", async () => {
      const w = await movedToOther();
      addressByHand(w, `${BACKEND_URL}/v1`);
      const back = await restoreTakenOver(w.paths);
      // The kit's key was written for the other address: their own comes back, from the backup.
      expect(w.settings()).toMatchObject({ [KEY]: OWN_KEY, [ADDRESS]: `${BACKEND_URL}/v1` });
      expect(back.lines.find((one) => one.includes(KEY))).toMatch(/put back from the backup at /);
    });

    test("the same with no backup: the kit's key goes, never left beside their address", async () => {
      const w = await movedToOther();
      addressByHand(w, `${BACKEND_URL}/v1`);
      noBackups(w);
      await restoreTakenOver(w.paths);
      expect(w.settings()[ADDRESS]).toBe(`${BACKEND_URL}/v1`);
      expect(w.settings()[KEY]).toBeUndefined();
    });

    test("an address the person set to a third one is theirs, and so is the key beside it", async () => {
      const w = await movedToOther();
      addressByHand(w, "https://third.example/v1");
      await restoreTakenOver(w.paths);
      // Restore does not touch an address the person chose; it cannot say the key is not for it.
      expect(w.settings()).toMatchObject({
        [KEY]: OTHER_KEY,
        [ADDRESS]: "https://third.example/v1",
      });
    });

    test("the OpenRouter pair is judged the same way", async () => {
      const own = "sk-own-PLANTED-0005";
      const w = machine({
        settings: {
          ...BY_HAND,
          CLAUDE_MEM_OPENROUTER_API_KEY: own,
          CLAUDE_MEM_OPENROUTER_BASE_URL: "https://openrouter.example/api/v1",
          CLAUDE_MEM_OPENROUTER_MODEL: "their/model",
          CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openrouter",
        },
      });
      await takeOver(w.paths);
      await chooseFallback(
        w.paths,
        { backend: "other", kind: "backend", model: "fallback/model" },
        w.check(),
      );
      expect(w.settings()).toMatchObject({
        CLAUDE_MEM_OPENROUTER_API_KEY: OTHER_KEY,
        CLAUDE_MEM_OPENROUTER_BASE_URL: `${OTHER_URL}/v1`,
      });
      await restoreTakenOver(w.paths);
      expect(w.settings()).toMatchObject({
        CLAUDE_MEM_OPENROUTER_API_KEY: own,
        CLAUDE_MEM_OPENROUTER_BASE_URL: "https://openrouter.example/api/v1",
      });
    });

    test("a backup that cannot be read is passed over: an older one holds their key", async () => {
      const w = await movedToOther();
      // A second write makes a newer backup; it is then lost to a bad write.
      await chooseKey(w.paths, { key: "sk-typed-PLANTED-0004", kind: "other" }, w.check());
      const backups = listBackups(w.paths.stateDir, realTarget(w.paths.claudeMemSettingsFile));
      expect(backups.length).toBeGreaterThan(1);
      writeFileSync(backups.at(-1)?.path ?? "", "{ not json");
      await restoreTakenOver(w.paths);
      expect(w.settings()).toMatchObject({ [KEY]: OWN_KEY, [ADDRESS]: `${BACKEND_URL}/v1` });
    });

    test("a key that changed while restore ran is reported as it is, not as put back", async () => {
      const w = await movedToOther();
      const typed = "sk-typed-PLANTED-0006";
      let played = false;
      const back = await restoreTakenOver(w.paths, {
        // Another program writes a key between the read and the write: the writer starts again.
        onBeforeWrite: () => {
          if (played) return;
          played = true;
          writeFileSync(
            w.paths.claudeMemSettingsFile,
            JSON.stringify({ ...w.settings(), [KEY]: typed }, null, 2),
          );
        },
      });
      // The claim goes, the new key is theirs and stays; the line says what really happened.
      expect(w.settings()[KEY]).toBe(typed);
      expect(back.lines.find((one) => one.includes(KEY))).toBe(
        "~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: changed while restore ran; left as it is, and yours.",
      );
      expect(ownedRecords(w.paths.stateDir, realTarget(w.paths.claudeMemSettingsFile))).toEqual([]);
    });

    test("the key put back keeps the file at 600", async () => {
      const w = await movedToOther();
      chmodSync(w.paths.claudeMemSettingsFile, 0o644);
      await restoreTakenOver(w.paths);
      expect(w.settings()[KEY]).toBe(OWN_KEY);
      expect(w.mode()).toBe(0o600);
    });

    test("a key that does belong to their address stays, as the kit wrote it", async () => {
      const w = machine({ settings: BY_HAND });
      await takeOver(w.paths);
      // A key typed for the address the person already had: the address never moved.
      const typed = "sk-typed-PLANTED-0004";
      await chooseKey(w.paths, { key: typed, kind: "other" }, w.check());
      const back = await restoreTakenOver(w.paths);
      expect(w.settings()).toMatchObject({ [KEY]: typed, [ADDRESS]: `${BACKEND_URL}/v1` });
      expect(back.lines.find((one) => one.includes(KEY))).toMatch(
        /^! ~\/\.claude-mem\/settings\.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: cc-smart-dev-kit replaced it after the take-over; the key you set before is in the backup at /,
      );
    });
  });

  test("MS1: a taken-over key stays only while its address is the backend's this write goes to", async () => {
    const w = machine({ settings: BY_HAND });
    await takeOver(w.paths);
    // The same backend's address: the key stays the person's, and the chat runs with it.
    expect(
      await chooseRoute(
        w.paths,
        { backend: "omniroute", kind: "backend", model: "glm/flash" },
        w.check(),
      ),
    ).toMatchObject({ ok: true });
    expect(w.checks.at(-1)?.apiKey).toBe(OWN_KEY);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OWN_KEY);
    // Another host's address: the person's key must not be sent there. The gateway's key for that
    // backend takes its place, and the chat runs with that one.
    expect(
      await chooseRoute(w.paths, { backend: "other", kind: "backend", model: "b" }, w.check()),
    ).toMatchObject({ ok: true });
    expect(w.checks.at(-1)).toMatchObject({ apiKey: OTHER_KEY, baseUrl: `${OTHER_URL}/v1` });
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(OTHER_KEY);
  });

  test("MS1: a taken-over key removed since has nothing to give back", async () => {
    const w = machine({ settings: BY_HAND });
    await takeOver(w.paths);
    // The person removes the key by hand, after the take-over.
    const settings = { ...w.settings() };
    delete settings.CLAUDE_MEM_OPENAI_COMPAT_API_KEY;
    writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(settings, null, 2));
    const back = await restoreTakenOver(w.paths);
    expect(w.settings().CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBeUndefined();
    expect(back.lines).toContain(
      "! ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: not in the file any more; the take-over's claim on it is dropped.",
    );
    expect(ownedRecords(w.paths.stateDir, realTarget(w.paths.claudeMemSettingsFile))).toEqual([]);
  });

  test("MS1: the take-over leaves setup's own values, and a key of ours, alone", async () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    w.setup();
    // setup's own route: nothing is the person's, so there is nothing to take over.
    expect(await takeOver(w.paths)).toEqual({
      lines: [
        "Nothing to take over: every value claude-mem holds in ~/.claude-mem/settings.json is cc-smart-dev-kit's own, or claude-mem's own default.",
      ],
      ok: true,
    });
    // After take-over, setup still disables memory-use and leaves the person's route alone.
    const hand = machine({
      settings: { ...SEEDED, CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model" },
    });
    await takeOver(hand.paths);
    expect(hand.setup().provider).toBeNull();
    expect(hand.settings()).toMatchObject({
      CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "false",
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
      CLAUDE_MEM_WORK_STATE_ENABLED: "true",
    });
  });

  test("MS2: the take-over records exactly the keys the card names, and no other", async () => {
    // A Claude route with an OpenRouter fallback set by hand: no choice writes the OpenRouter
    // three on this route, so the card names the fallback provider alone, and asks for that one.
    const w = machine({
      settings: {
        ...SEEDED,
        CLAUDE_MEM_OPENROUTER_API_KEY: OWN_KEY,
        CLAUDE_MEM_OPENROUTER_BASE_URL: `${BACKEND_URL}/v1`,
        CLAUDE_MEM_OPENROUTER_MODEL: "their-model",
        CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openrouter",
      },
    });
    expect(readClaudeMemFacts(w.paths).handKeys).toEqual(["CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER"]);
    const taken = await takeOver(w.paths);
    expect(taken.lines.slice(0, 2)).toEqual([
      "The take-over recorded one value of claude-mem's as cc-smart-dev-kit's: each stays exactly as it is until you pick another.",
      '  ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "openrouter"',
    ]);
    // On a backend route the OpenRouter three are the fallback's to write: named then, still
    // the person's until they are asked for again.
    expect(
      await chooseRoute(
        w.paths,
        { backend: "omniroute", kind: "backend", model: "glm/flash" },
        w.check(),
      ),
    ).toMatchObject({ ok: true });
    expect(readClaudeMemFacts(w.paths).handKeys).toEqual([
      "CLAUDE_MEM_OPENROUTER_BASE_URL",
      "CLAUDE_MEM_OPENROUTER_MODEL",
      "CLAUDE_MEM_OPENROUTER_API_KEY",
    ]);
    expect(
      (
        await chooseFallback(
          w.paths,
          { backend: "omniroute", kind: "backend", model: "glm/flash" },
          w.check(),
        )
      ).ok,
    ).toBe(false);
    expect(w.settings().CLAUDE_MEM_OPENROUTER_API_KEY).toBe(OWN_KEY);
  });

  test("MS2: a key setup wrote and the person removed is claude-mem's default, not by hand", () => {
    const w = machine({ settings: SEEDED, gateway: "scout" });
    w.setup();
    const settings = { ...w.settings() };
    delete settings.CLAUDE_MEM_OPENAI_COMPAT_API_KEY;
    writeFileSync(w.paths.claudeMemSettingsFile, JSON.stringify(settings, null, 2));
    const facts = readClaudeMemFacts(w.paths);
    expect(facts.handKeys).toEqual([]);
    expect(facts.current?.key).toMatchObject({ refusedByHand: false, source: "default" });
    expect(facts.current?.route.refusedByHand).toBe(false);
  });

  test("MS1: a take-over writes nothing when claude-mem cannot be set at all", async () => {
    const w = machine({ installed: false });
    expect(await takeOver(w.paths)).toEqual({
      lines: ["claude-mem is not installed, so there is nothing to set."],
      ok: false,
    });
  });
});

describe("MS1: the Claude fallback's own model, and who a hand value refuses", () => {
  test("MS1: an empty fallback model reads as claude-mem's own Claude model, never as none", () => {
    const w = machine({ settings: SEEDED });
    expect(readClaudeMemFacts(w.paths).current?.fallback.claudeModel).toBe(
      "claude-haiku-4-5-20251001",
    );
    // With none of the two set, claude-mem's own built-in default applies: nothing is named.
    const bare = machine({ settings: { ...SEEDED, CLAUDE_MEM_MODEL: "" } });
    expect(readClaudeMemFacts(bare.paths).current?.fallback.claudeModel).toBeNull();
    // The person's own fallback model wins over claude-mem's.
    const chosen = machine({
      settings: { ...SEEDED, CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-sonnet-5-5" },
    });
    expect(readClaudeMemFacts(chosen.paths).current?.fallback.claudeModel).toBe(
      "claude-sonnet-5-5",
    );
    // Not a Claude fallback: nothing to name.
    const gemini = machine({
      settings: { ...SEEDED, CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "gemini" },
    });
    expect(readClaudeMemFacts(gemini.paths).current?.fallback.claudeModel).toBeNull();
  });

  test("MS1: per choice, whether a hand-set value refuses it, and the keys it names", async () => {
    const w = machine({ settings: { ...SEEDED, CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model" } });
    const facts = readClaudeMemFacts(w.paths);
    expect(facts.handKeys).toEqual(["CLAUDE_MEM_OPENAI_COMPAT_MODEL"]);
    expect(facts.current?.route.refusedByHand).toBe(true);
    expect(facts.current?.fallback.refusedByHand).toBe(true);
    expect(facts.current?.key.refusedByHand).toBe(false);
    // Nothing of the person's: every choice is open, and no key is named.
    const open = readClaudeMemFacts(machine({ settings: SEEDED }).paths);
    expect(open.handKeys).toEqual([]);
    expect(open.current?.route.refusedByHand).toBe(false);
    expect(open.current?.key.refusedByHand).toBe(false);
    expect(open.current?.fallback.refusedByHand).toBe(false);
    // A hand-set key on the OpenRouter side refuses the fallback alone — on the route that
    // leaves that provider to it. (On the Claude route the fallback holds the compat keys, so
    // their values are what the person's hand refuses.)
    const backend = machine({ settings: SEEDED });
    await chooseRoute(
      backend.paths,
      { backend: "omniroute", kind: "backend", model: "route/model" },
      backend.check(),
    );
    writeFileSync(
      backend.paths.claudeMemSettingsFile,
      JSON.stringify(
        { ...backend.settings(), CLAUDE_MEM_OPENROUTER_MODEL: "their/model" },
        null,
        2,
      ),
    );
    const openrouter = readClaudeMemFacts(backend.paths);
    expect(openrouter.handKeys).toEqual(["CLAUDE_MEM_OPENROUTER_MODEL"]);
    expect(openrouter.current?.fallback.refusedByHand).toBe(true);
    expect(openrouter.current?.route.refusedByHand).toBe(false);
    expect(openrouter.current?.key.refusedByHand).toBe(false);
  });
});

describe("MS1: what a later setup does to a taken-over value", () => {
  test("MS1: it leaves the person's route and their fallback exactly as they are", async () => {
    const w = machine({
      gateway: "scout",
      settings: {
        ...SEEDED,
        CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${BACKEND_URL}/v1`,
        CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
        CLAUDE_MEM_PROVIDER: "openai-compatible",
        CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-sonnet-x",
      },
    });
    // Before the take-over, setup leaves the whole file alone: the values are the person's.
    expect(w.setup().provider).toBeNull();
    expect(await takeOver(w.paths)).toMatchObject({ ok: true });
    // After it too: a plain setup must never pick a model for the person, nor take a taken-over
    // fallback out with the retired keys.
    const plan = w.setup();
    expect(plan.provider).toBeNull();
    // The fallback provider holds claude-mem's own default ("claude"), which nobody chose, so
    // setup still retires it as it always did. The person's fallback model is not touched.
    expect(plan.remove).toEqual([["CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER"]]);
    expect(w.settings()).toMatchObject({
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "their-model",
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-sonnet-x",
    });
    // The taken values read as the person's, not as setup's.
    expect(readClaudeMemFacts(w.paths).current?.route.source).toBe("portal");
    expect(w.settings().CLAUDE_MEM_WORK_STATE_ENABLED).toBe("true");
  });
});
