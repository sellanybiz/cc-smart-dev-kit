/**
 * The gateway's commands: the config helpers, the env keys `on` / `off` set in Claude
 * Code's settings (owned keys, through src/setup/), and the router service install.
 * Ported from the project that wrote the gateway; where the move changed the behaviour
 * (owned keys instead of overwriting, backups in the state folder, a copy instead of a
 * build, a question before a restart), the test says so.
 *
 * Every file goes into tempDir(); systemctl is a fake runner. Expected values by hand.
 */
import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ForeignKeyError, ownedKeys } from "../setup/managed-json";
import { restore } from "../setup/restore";
import { listBackups } from "../setup/write";
import { tempDir } from "../testing/temp";
import { parseModelList } from "./backends";
import { ensureConfig, planSlotChange } from "./commands";
import { type GatewayConfig, loadConfigFile } from "./config";
import type { HealthProbe } from "./health";
import { judgeTestRequest, judgeVerdict } from "./judge-test";
import {
  DRAIN_NOTE,
  installRouter,
  MOVE_WARNING,
  PORT_WARNING,
  RESTART_WARNING,
  renderSocket,
  renderUnit,
  routerServiceKind,
  SOCKET_CHANGED_WARNING,
  SOCKET_NAME,
  SOCKET_STOPPED_WARNING,
  STOP_WAIT_MS,
  socketPort,
  systemdService,
  UNIT_NAME,
  UP_TO_DATE,
} from "./service";
import {
  parseTaskFacts,
  renderTask,
  scheduledTaskService,
  TASK_RESTART_WARNING,
  taskFacts,
  taskRunsCopy,
  windowsAccount,
} from "./service-windows";
import {
  FORBIDDEN_ENV_KEYS,
  GATEWAY_ENV_KEYS,
  gatewayEnv,
  maskKey,
  ownedGatewayEnvKeys,
  settingsReport,
  turnOff,
  turnOn,
} from "./settings";
import { isAutoModeGuard } from "./targets";

const NO_POSIX_MODES = process.platform === "win32";

/** A made-up port for the fake probes: never the default one, where a real router may run. */
const FAKE_PORT = 20999;

/** What Bun's `fetch` throws when nothing listens on the port. */
function connectionRefused(): Error {
  return Object.assign(
    new TypeError("Unable to connect. Is the computer able to access the url?"),
    { code: "ConnectionRefused" },
  );
}

function config(): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: {
      ollama: { apiKey: "ollama-key-abcdef", baseUrl: "https://ollama.test" },
      omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" },
    },
    port: 20100,
    slots: {
      "cc-smart-dev-kit-affordable": ["omniroute:glm-5.3-flash", "ollama:deepseek-v4.1-flash"],
      "cc-smart-dev-kit-mixed": ["claude-sonnet-5-5", "omniroute:glm-5.3-flash"],
      "cc-smart-dev-kit-scout": [
        "omniroute:glm-5.3-flash",
        "ollama:deepseek-v4.1-flash",
        "claude-sonnet-5-5",
      ],
      "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"],
    },
    timeouts: { firstByteMs: 1000 },
    version: 1,
  };
}

/** The env block `on` writes on port 20100, written out by hand. */
const ON_ENV = {
  ANTHROPIC_BASE_URL: "http://127.0.0.1:20100",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "cc-smart-dev-kit-scout[1m]",
  ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION:
    "Affordable model for search and reading: the scout slot (cc-smart-dev-kit gateway slot scout …)",
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Scout (affordable)",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker[1m]",
  ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:
    "Affordable model for routine code and docs: the worker slot (cc-smart-dev-kit gateway slot worker …)",
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Worker (affordable)",
  ENABLE_TOOL_SEARCH: "true",
};

// ─── Claude Code settings: on / off ─────────────────────────────────────────────

describe("Claude Code settings: on / off", () => {
  const original = {
    env: { CLAUDE_CODE_SUBAGENT_MODEL: "cc-smart-dev-kit-worker[1m]", FOO: "1" },
    model: "opus",
    permissions: { allow: ["Bash(ls:*)"] },
  };

  /** A home with a settings file as Claude Code would have it (mode 644), and a state folder. */
  function seed(settings: unknown = original): { file: string; stateDir: string } {
    const home = tempDir("gateway-settings");
    mkdirSync(join(home, ".claude"), { recursive: true });
    const file = join(home, ".claude", "settings.json");
    if (settings !== null) {
      writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o644 });
      chmodSync(file, 0o644);
    }
    return { file, stateDir: join(home, ".claude", "cc-smart-dev-kit") };
  }

  it.skipIf(NO_POSIX_MODES)(
    "on: adds our env keys as owned keys, keeps the rest, backs up in the state folder, keeps the mode",
    () => {
      const { file, stateDir } = seed();
      const before = readFileSync(file, "utf8");
      const result = turnOn({ settingsFile: file, stateDir, port: 20100 });
      const text = readFileSync(file, "utf8");
      expect(text.endsWith("}\n")).toBe(true);
      expect(text).toContain('\n  "env": {\n');
      // Changed by the move: CLAUDE_CODE_SUBAGENT_MODEL is no longer removed. The gateway
      // never writes it; `status` warns about it instead.
      expect(JSON.parse(text)).toEqual({
        env: { CLAUDE_CODE_SUBAGENT_MODEL: "cc-smart-dev-kit-worker[1m]", FOO: "1", ...ON_ENV },
        model: "opus",
        permissions: { allow: ["Bash(ls:*)"] },
      });
      expect(result.written).toBe(true);
      expect(result.changes).toHaveLength(8);
      const backups = listBackups(stateDir, file);
      expect(backups).toHaveLength(1);
      expect(readFileSync(backups[0]?.path ?? "", "utf8")).toBe(before);
      // No backup beside the file: only the state folder, which holds them.
      expect(readdirSync(join(file, "..")).sort()).toEqual(["cc-smart-dev-kit", "settings.json"]);
      expect(statSync(file).mode & 0o777).toBe(0o644);
      expect(
        ownedKeys(stateDir, file)
          .map((path) => path.join("."))
          .sort(),
      ).toEqual([
        "env.ANTHROPIC_BASE_URL",
        "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
        "env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
        "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
        "env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
        "env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
        "env.ENABLE_TOOL_SEARCH",
      ]);
    },
  );

  it("on over a key someone else set: ForeignKeyError, the value masked, nothing written", () => {
    // Changed by the move: the old `on` replaced these values; now it never takes a key it
    // does not own. An older install's keys are cleared first (a project's migration).
    for (const [key, value, shown] of [
      ["ANTHROPIC_DEFAULT_SONNET_MODEL", "sk-ant-oat01-ABCDEFGH", "••••EFGH"],
      ["ANTHROPIC_BASE_URL", "https://user:hunter2-secret@proxy.example", "••••mple"],
      ["ENABLE_TOOL_SEARCH", "auto", "auto"],
      // The same value, set by someone else: still not ours, or `off` could not remove it.
      ["ENABLE_TOOL_SEARCH", "true", "true"],
    ] as const) {
      const { file, stateDir } = seed({ env: { [key]: value } });
      const before = readFileSync(file, "utf8");
      let caught: unknown = null;
      try {
        turnOn({ settingsFile: file, stateDir, port: 20100 });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForeignKeyError);
      // Changed on purpose: for ENABLE_TOOL_SEARCH, which many people set themselves, the
      // message says so, and what removing it does.
      const yourOwn =
        key === "ENABLE_TOOL_SEARCH"
          ? ' Many people set ENABLE_TOOL_SEARCH themselves; removing it by hand lets cc-smart-dev-kit gateway on manage it (it sets "true", and gateway off removes it again).'
          : "";
      expect((caught as Error).message).toBe(
        `${file}: env.${key} is ${shown}, set by someone else. cc-smart-dev-kit does not overwrite it. Remove it by hand if cc-smart-dev-kit should manage it.${yourOwn}`,
      );
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(existsSync(stateDir)).toBe(false);
    }
  });

  it("on never writes CLAUDE_CODE_SUBAGENT_MODEL, its _FORCE, or a login key or token", () => {
    const { file, stateDir } = seed(null);
    turnOn({ settingsFile: file, stateDir, port: 20100 });
    const written = JSON.parse(readFileSync(file, "utf8")) as { env: Record<string, string> };
    expect(written).toEqual({ env: ON_ENV });
    for (const key of [
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_SUBAGENT_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
    ]) {
      expect(Object.keys(written.env)).not.toContain(key);
      expect(GATEWAY_ENV_KEYS).not.toContain(key);
      expect(Object.keys(gatewayEnv(1234))).not.toContain(key);
    }
    expect([...FORBIDDEN_ENV_KEYS].sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_SUBAGENT_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
    ]);
  });

  it("off: removes exactly our keys; everything else stays (CLAUDE_CODE_SUBAGENT_MODEL too)", () => {
    const { file, stateDir } = seed();
    turnOn({ settingsFile: file, stateDir, port: 20100 });
    const { result, foreign } = turnOff({ settingsFile: file, stateDir });
    expect(result.changes.map((change) => change.path[1]).sort()).toEqual([
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
      "ENABLE_TOOL_SEARCH",
    ]);
    expect(foreign).toEqual([]);
    // Changed by the move: the old `off` also removed CLAUDE_CODE_SUBAGENT_MODEL. It is not
    // the gateway's key, so it stays.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(original);
    expect([...GATEWAY_ENV_KEYS].sort()).toEqual([
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
      "ENABLE_TOOL_SEARCH",
    ]);
  });

  it("every write keeps its own backup; the first, with the earlier values, is never replaced", () => {
    const { file, stateDir } = seed();
    const first = readFileSync(file, "utf8");
    turnOn({ settingsFile: file, stateDir, port: 20100 });
    const afterOn = readFileSync(file, "utf8");
    turnOff({ settingsFile: file, stateDir });
    turnOn({ settingsFile: file, stateDir, port: 20100 });
    const backups = listBackups(stateDir, file).map((backup) => readFileSync(backup.path, "utf8"));
    expect(backups).toEqual([first, afterOn, first]);
  });

  it("off with nothing of ours: writes nothing, and names a gateway key someone else set", () => {
    const { file, stateDir } = seed({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20100", FOO: "1" },
    });
    const before = readFileSync(file, "utf8");
    const { result, foreign } = turnOff({ settingsFile: file, stateDir });
    expect(result.written).toBe(false);
    expect(result.changes).toEqual([]);
    expect(foreign).toEqual(["ANTHROPIC_BASE_URL"]);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(stateDir)).toBe(false);
  });

  it("restore takes the gateway keys out again, and keeps everything else", () => {
    const { file, stateDir } = seed();
    const before = readFileSync(file, "utf8");
    turnOn({ settingsFile: file, stateDir, port: 20100 });
    const results = restore(stateDir);
    expect(results.map((result) => result.action)).toEqual(["cleaned"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(before));
  });

  it("ownedGatewayEnvKeys keeps only the keys that still hold our value: a changed one is theirs", () => {
    const { file, stateDir } = seed();
    turnOn({ settingsFile: file, stateDir, port: 20100 });
    expect(ownedGatewayEnvKeys(file, stateDir)).toEqual([
      "ENABLE_TOOL_SEARCH",
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    ]);
    // The person points Claude Code at their own gateway: that key is their choice now, and
    // restore's staging must stop counting it as a way running sessions reach the router.
    const changed = JSON.parse(readFileSync(file, "utf8")) as { env: Record<string, string> };
    changed.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:19999";
    writeFileSync(file, `${JSON.stringify(changed, null, 2)}\n`);
    expect(ownedGatewayEnvKeys(file, stateDir)).toEqual([
      "ENABLE_TOOL_SEARCH",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    ]);
    // Restore leaves it (theirs), takes ours out, and gives up the ownership of it.
    expect(restore(stateDir).map((result) => result.action)).toEqual(["cleaned"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      env: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:19999",
        CLAUDE_CODE_SUBAGENT_MODEL: "cc-smart-dev-kit-worker[1m]",
        FOO: "1",
      },
      model: "opus",
      permissions: { allow: ["Bash(ls:*)"] },
    });
    expect(ownedGatewayEnvKeys(file, stateDir)).toEqual([]);
  });

  it("status sees a key that would replace the own login, and a subagent model override", () => {
    const { file } = seed({
      apiKeyHelper: "x",
      env: {
        ANTHROPIC_AUTH_TOKEN: "t",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:20100",
        CLAUDE_CODE_SUBAGENT_MODEL: "cc-smart-dev-kit-worker",
        CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
      },
    });
    expect(settingsReport(file)).toEqual({
      baseUrl: "http://127.0.0.1:20100",
      loginOverrides: ["ANTHROPIC_AUTH_TOKEN", "apiKeyHelper"],
      subagentOverrides: ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"],
    });
  });
});

// ─── Setup, slot and models helpers ─────────────────────────────────────────────

describe("setup, slot and models helpers", () => {
  it.skipIf(NO_POSIX_MODES)(
    "creates the config only with the OmniRoute key; adds a known backend's key later",
    () => {
      const path = join(tempDir("gateway-setup"), ".config", "cc-smart-dev-kit", "gateway.json");
      expect(() => ensureConfig(path, null)).toThrow(
        "cc-smart-dev-kit gateway setup --backend-key-stdin omniroute",
      );
      ensureConfig(path, { backend: "omniroute", value: "omni-key-123456" });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      // DeepSeek first in both slots, GLM second, Claude Sonnet last; ids as OmniRoute's
      // /v1/models lists them. Changed by the move: no judge slot. Auto mode's safety
      // check stays on Claude until the person turns the judge on.
      expect(loadConfigFile(path).slots).toEqual({
        "cc-smart-dev-kit-scout": [
          "omniroute:ollama-cloud/deepseek-v4.1-flash",
          "omniroute:ollama-cloud/glm-5.3-flash",
          "claude-sonnet-5-5",
        ],
        "cc-smart-dev-kit-worker": [
          "omniroute:ollama-cloud/deepseek-v4.1-flash",
          "omniroute:ollama-cloud/glm-5.3-flash",
          "claude-sonnet-5-5",
        ],
      });
      expect(loadConfigFile(path).aliases).toEqual({});
      const said = ensureConfig(path, { backend: "ollama", value: "ollama-key-abcdef" });
      expect(said).toBe(`set the key of backend "ollama" (••••cdef) in ${path}`);
      expect(loadConfigFile(path).backends).toEqual({
        ollama: { apiKey: "ollama-key-abcdef", baseUrl: "https://ollama.com" },
        omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" },
      });
    },
  );

  it("a dry run checks and writes nothing", () => {
    const path = join(tempDir("gateway-dry"), ".config", "cc-smart-dev-kit", "gateway.json");
    expect(
      ensureConfig(path, { backend: "omniroute", value: "omni-key-123456" }, { dryRun: true }),
    ).toBe(`created ${path} (mode 600)`);
    expect(existsSync(path)).toBe(false);
  });

  it("slot: checks each target against the backend's model list", () => {
    const cfg = config();
    const models = { ollama: null, omniroute: ["glm-5.3-flash", "deepseek-v4.1-flash"] };
    expect(planSlotChange(cfg, "worker", "omniroute:kimi-k3", models)).toEqual({
      error:
        '"omniroute:kimi-k3": "omniroute" has no model "kimi-k3" (see cc-smart-dev-kit gateway models)',
    });
    expect(planSlotChange(cfg, "worker", "nobody:x", models)).toEqual({
      error: '"nobody:x": backend "nobody" is not in the config',
    });
    expect(planSlotChange(cfg, "worker", "ollama:x", models)).toEqual({
      error: '"ollama:x": could not list the models of "ollama", so it cannot be checked',
    });
    expect(planSlotChange(cfg, "Scout!", "claude-sonnet-5-5", models)).toEqual({
      error:
        '"Scout!" is not a slot name (scout, worker, judge, opus, fable, or cc-smart-dev-kit-<name>)',
    });
    // `judge off`: the way back to Claude. config() has no judge slot yet.
    expect(planSlotChange(cfg, "judge", "off", models)).toEqual({
      error: "cc-smart-dev-kit-judge is already off",
    });
    const judged = planSlotChange(cfg, "judge", "omniroute:deepseek-v4.1-flash", models);
    if (!("config" in judged)) throw new Error(judged.error);
    expect(judged.config.slots["cc-smart-dev-kit-judge"]).toEqual([
      "omniroute:deepseek-v4.1-flash",
    ]);
    const off = planSlotChange(judged.config, "judge", " off ", models);
    if (!("config" in off)) throw new Error(off.error);
    expect(off.old).toEqual(["omniroute:deepseek-v4.1-flash"]);
    expect(off.next).toEqual([]);
    expect(Object.keys(off.config.slots).sort()).toEqual([
      "cc-smart-dev-kit-affordable",
      "cc-smart-dev-kit-mixed",
      "cc-smart-dev-kit-scout",
      "cc-smart-dev-kit-worker",
    ]);
    expect(planSlotChange(cfg, "worker", "off", models)).toEqual({
      error:
        "only cc-smart-dev-kit-judge, cc-smart-dev-kit-opus and cc-smart-dev-kit-fable can be off; give cc-smart-dev-kit-worker its targets instead",
    });
    const ok = planSlotChange(cfg, "worker", "omniroute:glm-5.3-flash, claude-sonnet-5-5", models);
    if (!("config" in ok)) throw new Error(ok.error);
    expect(ok.key).toBe("cc-smart-dev-kit-worker");
    expect(ok.old).toEqual(["claude-sonnet-5-5"]);
    expect(ok.config.slots["cc-smart-dev-kit-worker"]).toEqual([
      "omniroute:glm-5.3-flash",
      "claude-sonnet-5-5",
    ]);
  });

  it("slot judge off is refused while an alias still points at the judge slot", () => {
    const cfg = { ...config(), aliases: { "old-judge": "cc-smart-dev-kit-judge" } };
    cfg.slots = { ...cfg.slots, "cc-smart-dev-kit-judge": ["omniroute:glm-5.3-flash"] };
    const off = planSlotChange(cfg, "judge", "off", {});
    expect("error" in off && off.error).toContain(
      'alias "old-judge" points at slot "cc-smart-dev-kit-judge", which is not in slots',
    );
  });

  it("models: reads ids and context length from a /v1/models answer", () => {
    expect(
      parseModelList({
        data: [
          { context_length: 1_000_000, id: "glm-5.3-flash" },
          { id: "kimi-k3" },
          { name: "x" },
        ],
      }),
    ).toEqual([
      { contextLength: 1_000_000, id: "glm-5.3-flash" },
      { contextLength: null, id: "kimi-k3" },
    ]);
  });

  it("masks keys", () => {
    expect(maskKey("omni-key-123456")).toBe("••••3456");
    expect(maskKey("short")).toBe("••••");
  });

  it("setup --no-backend-key: no config and no key is allowed, and writes nothing", () => {
    const path = join(tempDir("gateway-nokey"), ".config", "cc-smart-dev-kit", "gateway.json");
    expect(ensureConfig(path, null, { allowNone: true })).toBe(
      `no config at ${path} yet: the router answers every slot on your own Claude login until the OmniRoute key is added (setup --backend-key-stdin omniroute)`,
    );
    expect(existsSync(path)).toBe(false);
    // Without the flag it still refuses, so a forgotten key is not silent.
    expect(() => ensureConfig(path, null)).toThrow("no config at");
    // The key later creates the full default config, not a Claude-only one.
    ensureConfig(path, { backend: "omniroute", value: "omni-key-123456" }, { allowNone: true });
    expect(loadConfigFile(path).slots["cc-smart-dev-kit-worker"]).toEqual([
      "omniroute:ollama-cloud/deepseek-v4.1-flash",
      "omniroute:ollama-cloud/glm-5.3-flash",
      "claude-sonnet-5-5",
    ]);
  });
});

// ─── The router service: copy, unit, systemctl ──────────────────────────────────

describe("router service install", () => {
  /**
   * A home, the plugin's router bundle, a fake systemctl that logs each call and keeps the
   * state of the service and of its socket apart, and a fake health probe on a made-up
   * port: the router answers there while the service is active (`port.answers`), another
   * program holds it when `port.taken`, and no answer comes in time when `port.timeout`
   * (a socket whose router is down holds the connection). Its clock moves only when the
   * code sleeps. No network.
   */
  function machine() {
    const home = tempDir("gateway-install");
    const bundle = join(home, "plugin", "dist", "router.js");
    mkdirSync(join(home, "plugin", "dist"), { recursive: true });
    writeFileSync(bundle, "// router v1\n");
    /** `idle`: what `is-active` says of the service while it is not active. */
    /** `failOn`: the one systemctl command (`start`, …) that fails, as systemd's job would. */
    const state = { active: false, fail: false, failOn: "", idle: "inactive", socket: false };
    const port: {
      answers: boolean;
      reply: (() => Response) | null;
      taken: boolean;
      timeout: boolean;
    } = { answers: true, reply: null, taken: false, timeout: false };
    /** At each systemctl call: is the restart-pending marker there, and the copy? */
    const markerAt: string[] = [];
    const clock = { now: Date.UTC(2026, 9, 15, 10, 0, 0) };
    const probed: string[] = [];
    const events: string[] = [];
    const stateDir = join(home, ".claude", "cc-smart-dev-kit");
    const marker = join(stateDir, "restart-pending");
    const copyPath = join(home, ".local", "share", "cc-smart-dev-kit", "router.js");
    const unitPath = join(home, ".config", "systemd", "user", "cc-smart-dev-kit-router.service");
    const socketPath = join(home, ".config", "systemd", "user", "cc-smart-dev-kit-router.socket");
    const install = (options: {
      yes?: boolean;
      confirm?: ((question: string) => boolean) | null;
      dryRun?: boolean;
      bunVersion?: string;
      port?: number;
    }) =>
      installRouter({
        bunPath: "/opt/bun/bin/bun",
        bunVersion: options.bunVersion ?? "1.4.3",
        bundle,
        copyPath,
        home,
        stateDir,
        port: options.port ?? FAKE_PORT,
        service: systemdService({ socketPath, unitPath }),
        probe: {
          fetch: async (url) => {
            probed.push(url);
            if (port.timeout) throw new DOMException("The operation timed out.", "TimeoutError");
            if (port.taken) return new Response("not found", { status: 404 });
            if (port.reply !== null) return port.reply();
            if (state.active && port.answers) return Response.json({ ok: true, port: FAKE_PORT });
            throw connectionRefused();
          },
          now: () => clock.now,
          sleep: async (ms) => {
            clock.now += ms;
          },
        },
        runner: (cmd) => {
          events.push(`$ ${cmd.join(" ")}`);
          markerAt.push(
            `${cmd[2]}: ${existsSync(marker) ? "marker" : "no marker"}, ${existsSync(copyPath) ? "copy" : "no copy"}`,
          );
          if (state.fail) return { exitCode: 1, output: "Failed to connect to bus" };
          if (cmd[2] === state.failOn || cmd.slice(2).join(" ") === state.failOn) {
            return { exitCode: 1, output: "Job for cc-smart-dev-kit-router.socket failed.\n" };
          }
          const names = cmd.slice(3).filter((arg) => !arg.startsWith("--"));
          if (cmd[2] === "is-active") {
            const active = names[0]?.endsWith(".socket") ? state.socket : state.active;
            const word = active
              ? "active"
              : names[0]?.endsWith(".socket")
                ? "inactive"
                : state.idle;
            return { exitCode: active ? 0 : 3, output: cmd[3] === "--quiet" ? "" : word };
          }
          const starts = cmd[2] === "start" || cmd[2] === "restart" || cmd[3] === "--now";
          for (const name of names) {
            const on = starts ? true : cmd[2] === "stop" ? false : null;
            if (on === null) continue;
            if (name.endsWith(".socket")) state.socket = on;
            else state.active = on;
          }
          return { exitCode: 0, output: "" };
        },
        say: (line) => events.push(line),
        yes: options.yes ?? false,
        confirm: options.confirm === undefined ? null : options.confirm,
        ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
      });
    return {
      home,
      bundle,
      copyPath,
      unitPath,
      socketPath,
      state,
      port,
      clock,
      probed,
      events,
      install,
      marker,
      markerAt,
      stateDir,
    };
  }

  const ENABLED =
    "enabled and (re)started cc-smart-dev-kit-router.service and cc-smart-dev-kit-router.socket";

  it("first install: the copy, the unit and the socket; reload, enable, then start both", async () => {
    const m = machine();
    expect(await m.install({})).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      "+ ~/.local/share/cc-smart-dev-kit/router.js: router copy created",
      "+ ~/.config/systemd/user/cc-smart-dev-kit-router.service: unit created",
      "+ ~/.config/systemd/user/cc-smart-dev-kit-router.socket: socket unit created",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      // Nothing runs, so nothing is stopped; the port is asked once, then both start.
      "$ systemctl --user is-active cc-smart-dev-kit-router.service",
      "$ systemctl --user reset-failed cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user start cc-smart-dev-kit-router.socket",
      "$ systemctl --user start cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
    expect(statSync(m.copyPath).mode & 0o777).toBe(0o644);
    expect(readFileSync(m.unitPath, "utf8")).toContain(
      `\nExecStart="/opt/bun/bin/bun" --no-env-file "${m.copyPath}"\n`,
    );
    expect(readFileSync(m.socketPath, "utf8")).toBe(renderSocket(FAKE_PORT));
    expect(statSync(m.socketPath).mode & 0o777).toBe(0o644);
  });

  it("a bun older than 1.4.3: refused first, with nothing asked, written or run", async () => {
    const m = machine();
    for (const dryRun of [true, false]) {
      await expect(m.install({ bunVersion: "1.4.2", dryRun, yes: true })).rejects.toThrow(
        "cc-smart-dev-kit needs Bun ≥ 1.4.3; this is 1.4.2 (/opt/bun/bin/bun). The router is not installed. Upgrade this Bun, then run: cc-smart-dev-kit gateway setup",
      );
    }
    expect(m.events).toEqual([]);
    expect(m.probed).toEqual([]);
    expect(existsSync(m.copyPath)).toBe(false);
    expect(existsSync(m.unitPath)).toBe(false);
    expect(existsSync(m.marker)).toBe(false);
  });

  it("right after restore, the old router still draining: it says it waits, stops it without blocking, then starts both", async () => {
    const m = machine();
    // restore's `stop --no-block` returned at once; the old router finishes its answers.
    m.state.idle = "deactivating";
    expect(await m.install({})).toBe("installed");
    expect(m.events.slice(5)).toEqual([
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user is-active cc-smart-dev-kit-router.service",
      "waiting for the old router to finish its answers (up to 120 s)",
      "$ systemctl --user stop --no-block cc-smart-dev-kit-router.service",
      "$ systemctl --user reset-failed cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user start cc-smart-dev-kit-router.socket",
      "$ systemctl --user start cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
  });

  it("again with nothing changed and the socket open: no restart, only enable --now", async () => {
    const m = machine();
    await m.install({});
    m.events.length = 0;
    expect(await m.install({})).toBe("up-to-date");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user enable --now cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      UP_TO_DATE,
    ]);
    expect(UP_TO_DATE).toBe("router already up to date (no restart)");
    expect(readdirSync(join(m.home, ".local", "share", "cc-smart-dev-kit"))).toEqual(["router.js"]);
  });

  it("a new bundle while the router runs on its socket: the restart warning says new requests wait; no yes, no change", async () => {
    const m = machine();
    await m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    m.events.length = 0;
    expect(await m.install({})).toBe("declined");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      RESTART_WARNING,
      "Nothing was changed. Run again with --yes to restart: cc-smart-dev-kit gateway setup --yes",
    ]);
    expect(RESTART_WARNING).toBe(
      "cc-smart-dev-kit-router is running. A restart lets its answers in flight finish first (up to 120 s; a longer one is cut, and Claude Code retries it). New requests wait in its socket meanwhile; none fails.",
    );
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
  });

  it("the person says no: nothing changes; yes: the new copy, then a restart of the service alone (the socket stays open)", async () => {
    const m = machine();
    await m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    const asked: string[] = [];
    m.events.length = 0;
    expect(
      await m.install({
        confirm: (question) => {
          asked.push(question);
          return false;
        },
      }),
    ).toBe("declined");
    expect(m.events.at(-1)).toBe("Nothing was changed.");
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
    m.events.length = 0;
    expect(
      await m.install({
        confirm: (question) => {
          asked.push(question);
          return true;
        },
      }),
    ).toBe("installed");
    expect(asked).toEqual([
      "Restart cc-smart-dev-kit-router now?",
      "Restart cc-smart-dev-kit-router now?",
    ]);
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      RESTART_WARNING,
      "~ ~/.local/share/cc-smart-dev-kit/router.js: router copy updated",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "restarting cc-smart-dev-kit-router (new requests wait in its socket)",
      "$ systemctl --user restart cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v2\n");
    // Never a stop or restart of the socket: it holds the port the whole time.
    expect(m.events.some((event) => /(stop|restart).*\.socket/.test(event))).toBe(false);
  });

  it("the move from the older unit (no socket, the router holds the port): its own warning, then stop without blocking, the port closes, both start", async () => {
    const m = machine();
    // The older setup: a copy and a unit without a socket, and the router running.
    mkdirSync(join(m.home, ".config", "systemd", "user"), { recursive: true });
    mkdirSync(join(m.home, ".local", "share", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(m.copyPath, "// router v0\n");
    writeFileSync(m.unitPath, "[Service]\nExecStart=/opt/bun/bin/bun old\n");
    m.state.active = true;
    expect(await m.install({})).toBe("declined");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      MOVE_WARNING,
      "Nothing was changed. Run again with --yes to restart: cc-smart-dev-kit gateway setup --yes",
    ]);
    expect(MOVE_WARNING).toBe(
      "cc-smart-dev-kit-router is running without its socket unit. This setup moves it to one, so later restarts refuse no request. This restart cannot: until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).",
    );
    m.events.length = 0;
    m.probed.length = 0;
    expect(await m.install({ yes: true })).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      MOVE_WARNING,
      "~ ~/.local/share/cc-smart-dev-kit/router.js: router copy updated",
      "~ ~/.config/systemd/user/cc-smart-dev-kit-router.service: unit updated",
      "+ ~/.config/systemd/user/cc-smart-dev-kit-router.socket: socket unit created",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user is-active cc-smart-dev-kit-router.service",
      DRAIN_NOTE,
      // Not a blocking stop: it would wait the whole drain. The old router closes its
      // port at SIGTERM; the start waits for its drain in systemd.
      "$ systemctl --user stop --no-block cc-smart-dev-kit-router.service",
      "$ systemctl --user reset-failed cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user start cc-smart-dev-kit-router.socket",
      "$ systemctl --user start cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
    // Asked first (ours), then after the start. No wait for the port between: systemd
    // starts the socket only once the old router's stop has finished.
    expect(m.probed).toEqual([
      `http://127.0.0.1:${FAKE_PORT}/__cc-smart-dev-kit/health`,
      `http://127.0.0.1:${FAKE_PORT}/__cc-smart-dev-kit/health`,
    ]);
  });

  it("a socket that cannot open: said, with where to look; the router starts without it and binds the port itself", async () => {
    const m = machine();
    // systemd fails the start when the socket cannot bind its port.
    m.state.failOn = "start cc-smart-dev-kit-router.socket";
    expect(await m.install({})).toBe("installed");
    expect(m.events.slice(-4)).toEqual([
      "$ systemctl --user start cc-smart-dev-kit-router.socket",
      `systemctl --user start cc-smart-dev-kit-router.socket failed (exit 1): Job for cc-smart-dev-kit-router.socket failed. Starting cc-smart-dev-kit-router without its socket: the router binds 127.0.0.1:${FAKE_PORT} itself, and until the socket opens, a restart refuses new requests while the old router drains. Is another program on that port? See: ss -ltnp, and journalctl --user -u cc-smart-dev-kit-router.socket -n 30. Then run cc-smart-dev-kit gateway setup again.`,
      "$ systemctl --user start cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
    // The router answered: the marker goes. `doctor` still names the closed socket.
    expect(existsSync(m.marker)).toBe(false);
  });

  it("a socket that cannot open and a router that cannot bind either: the error names the unit's log; the marker stays", async () => {
    const m = machine();
    m.state.failOn = "start cc-smart-dev-kit-router.socket";
    m.port.answers = false;
    await expect(m.install({})).rejects.toThrow(
      `cc-smart-dev-kit-router.service did not answer on 127.0.0.1:${FAKE_PORT} within 5 s of the restart`,
    );
    expect(existsSync(m.marker)).toBe(true);
  });

  it("a stopped socket whose unit file is there: its own warning (not the move's), then it opens again", async () => {
    const m = machine();
    await m.install({});
    // Stopped by hand, or closed by systemd after the router hit its start limit.
    m.state.socket = false;
    m.events.length = 0;
    expect(await m.install({ yes: true })).toBe("installed");
    expect(SOCKET_STOPPED_WARNING).toBe(
      "cc-smart-dev-kit-router is running, but its socket is not open: the router holds the port itself. This setup opens the socket again, so later restarts refuse no request. This restart cannot: until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).",
    );
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      SOCKET_STOPPED_WARNING,
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user is-active cc-smart-dev-kit-router.service",
      DRAIN_NOTE,
      "$ systemctl --user stop --no-block cc-smart-dev-kit-router.service",
      "$ systemctl --user reset-failed cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user start cc-smart-dev-kit-router.socket",
      "$ systemctl --user start cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
  });

  it("a socket unit that changed on the same port: its own warning (not the port's)", async () => {
    const m = machine();
    await m.install({});
    // An older text of the same socket unit (a later version changed the template).
    writeFileSync(m.socketPath, renderSocket(FAKE_PORT).replace("NoDelay=true\n", ""));
    m.events.length = 0;
    expect(await m.install({})).toBe("declined");
    expect(SOCKET_CHANGED_WARNING).toBe(
      "cc-smart-dev-kit-router is running, and its socket unit changed, so the socket closes and opens again. Until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).",
    );
    expect(m.events.slice(2, 3)).toEqual([SOCKET_CHANGED_WARNING]);
  });

  it("a changed port: the socket is reopened on it (stop the service without blocking, stop the socket, start both)", async () => {
    const m = machine();
    await m.install({});
    m.events.length = 0;
    expect(await m.install({ port: FAKE_PORT + 1, yes: true })).toBe("installed");
    expect(PORT_WARNING).toBe(
      "cc-smart-dev-kit-router is running, and its socket moves to a new port. Until the old router has finished its answers in flight (up to 120 s), new requests fail (Claude Code retries them).",
    );
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      PORT_WARNING,
      "~ ~/.config/systemd/user/cc-smart-dev-kit-router.socket: socket unit updated",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user is-active cc-smart-dev-kit-router.service",
      DRAIN_NOTE,
      "$ systemctl --user stop --no-block cc-smart-dev-kit-router.service",
      "$ systemctl --user stop cc-smart-dev-kit-router.socket",
      "$ systemctl --user reset-failed cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "$ systemctl --user start cc-smart-dev-kit-router.socket",
      "$ systemctl --user start cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
    expect(socketPort(readFileSync(m.socketPath, "utf8"))).toBe(FAKE_PORT + 1);
  });

  it("--yes restarts without asking", async () => {
    const m = machine();
    await m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    const result = await m.install({
      yes: true,
      confirm: () => {
        throw new Error("asked although --yes was given");
      },
    });
    expect(result).toBe("installed");
    expect(m.events).toContain("$ systemctl --user restart cc-smart-dev-kit-router.service");
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v2\n");
  });

  it("a dry run writes nothing and runs only the is-active questions", async () => {
    const m = machine();
    expect(await m.install({ dryRun: true })).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
    ]);
    expect(existsSync(m.copyPath)).toBe(false);
    expect(existsSync(m.unitPath)).toBe(false);
    expect(existsSync(m.socketPath)).toBe(false);
  });

  it("install stops at the first failing command", async () => {
    const m = machine();
    await m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    m.state.fail = true;
    m.events.length = 0;
    // is-active fails too (not active): the copy is written, then daemon-reload fails.
    await expect(m.install({})).rejects.toThrow(
      "systemctl --user daemon-reload failed (exit 1):\nFailed to connect to bus",
    );
    expect(m.events.filter((event) => event.startsWith("$ "))).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      "$ systemctl --user daemon-reload",
    ]);
  });

  // ─── The port, and the restart-pending marker ────────────────────────────────

  const NOT_OURS = `port ${FAKE_PORT} is used by another program (an older router? stop it first)`;

  it("a port another program holds: refused before any question or write; the dry run too", async () => {
    for (const dryRun of [false, true]) {
      const m = machine();
      m.port.taken = true;
      await expect(m.install({ dryRun, yes: true })).rejects.toThrow(NOT_OURS);
      // Changed on purpose: the socket is asked too: an open socket of ours is not "another program".
      expect(m.events).toEqual([
        "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      ]);
      expect(m.probed).toEqual([`http://127.0.0.1:${FAKE_PORT}/__cc-smart-dev-kit/health`]);
      expect(existsSync(m.copyPath)).toBe(false);
      expect(existsSync(m.unitPath)).toBe(false);
      expect(existsSync(m.stateDir)).toBe(false);
    }
  });

  it("a 200 that is not this router's health, or no answer in time: refused the same way", async () => {
    for (const reply of [
      () => new Response("<html>hello</html>", { status: 200 }),
      () => Response.json({ ok: false }),
      () => Response.json({ status: "ok" }),
    ]) {
      const m = machine();
      m.port.reply = reply;
      await expect(m.install({ yes: true })).rejects.toThrow(NOT_OURS);
      expect(m.events).toEqual([
        "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      ]);
      expect(existsSync(m.stateDir)).toBe(false);
    }
    const slow = machine();
    slow.port.timeout = true;
    await expect(slow.install({ yes: true })).rejects.toThrow(NOT_OURS);
    expect(slow.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
    ]);
    expect(existsSync(slow.copyPath)).toBe(false);
  });

  it("no answer in time while our socket is open: its router is down, not another program; setup goes on", async () => {
    const m = machine();
    await m.install({});
    // The socket holds the connection, and no router takes it (a crash loop, say).
    m.port.timeout = true;
    m.events.length = 0;
    writeFileSync(m.bundle, "// router v2\n");
    m.state.active = false;
    m.state.idle = "activating";
    await expect(m.install({ yes: true })).rejects.toThrow(
      `cc-smart-dev-kit-router.service did not answer on 127.0.0.1:${FAKE_PORT} within 5 s of the restart`,
    );
    // It wrote the new copy and restarted the service; only the answer never came.
    expect(m.events).toContain("~ ~/.local/share/cc-smart-dev-kit/router.js: router copy updated");
    expect(m.events).toContain("$ systemctl --user restart cc-smart-dev-kit-router.service");
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v2\n");
  });

  it("the marker is there from before the copy until the restarted router answers, then gone", async () => {
    const m = machine();
    expect(await m.install({})).toBe("installed");
    expect(m.markerAt).toEqual([
      "is-active: no marker, no copy",
      "is-active: no marker, no copy",
      "daemon-reload: marker, copy",
      "enable: marker, copy",
      "is-active: marker, copy",
      "reset-failed: marker, copy",
      "start: marker, copy",
      "start: marker, copy",
    ]);
    expect(existsSync(m.marker)).toBe(false);
    expect(m.events.at(-1)).toBe(ENABLED);
  });

  it("a router that never answers after the restart: an error naming the unit's state and its log; the marker stays", async () => {
    const m = machine();
    m.port.answers = false;
    await expect(m.install({})).rejects.toThrow(
      `cc-smart-dev-kit-router.service did not answer on 127.0.0.1:${FAKE_PORT} within 5 s of the restart (systemctl --user is-active: active). See why: journalctl --user -u cc-smart-dev-kit-router -n 30. Then run cc-smart-dev-kit gateway setup again.`,
    );
    expect(existsSync(m.marker)).toBe(true);
    // It waited 5 s by its clock, asking every 200 ms, and no longer.
    expect(m.clock.now).toBe(Date.UTC(2026, 9, 15, 10, 0, 5));
    expect(m.events.at(-1)).toBe("$ systemctl --user is-active cc-smart-dev-kit-router.service");
  });

  it("a re-run that finds the marker restarts though nothing changed (asking first), and clears it", async () => {
    const m = machine();
    m.port.answers = false;
    await expect(m.install({})).rejects.toThrow("did not answer");
    m.port.answers = true;
    m.events.length = 0;
    // The files are up to date, but the marker says the restart never finished.
    expect(await m.install({})).toBe("declined");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      RESTART_WARNING,
      "Nothing was changed. Run again with --yes to restart: cc-smart-dev-kit gateway setup --yes",
    ]);
    expect(existsSync(m.marker)).toBe(true);
    m.events.length = 0;
    expect(await m.install({ yes: true })).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.socket",
      "$ systemctl --user is-active --quiet cc-smart-dev-kit-router.service",
      RESTART_WARNING,
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
      "restarting cc-smart-dev-kit-router (new requests wait in its socket)",
      "$ systemctl --user restart cc-smart-dev-kit-router.service",
      ENABLED,
    ]);
    expect(existsSync(m.marker)).toBe(false);
    // Up to date and no marker: the shortcut again.
    m.events.length = 0;
    expect(await m.install({})).toBe("up-to-date");
  });

  it("restore removes the copy and the two units that setup created", async () => {
    const m = machine();
    await m.install({});
    const results = restore(join(m.home, ".claude", "cc-smart-dev-kit"));
    expect(results.map((result) => [result.file, result.action]).sort()).toEqual(
      [
        [m.unitPath, "removed"],
        [m.socketPath, "removed"],
        [m.copyPath, "removed"],
      ].sort(),
    );
    expect(existsSync(m.copyPath)).toBe(false);
    expect(existsSync(m.unitPath)).toBe(false);
    expect(existsSync(m.socketPath)).toBe(false);
  });

  it("the unit file, as written", () => {
    expect(
      renderUnit("/opt/bun/bin/bun", "/home/user/.local/share/cc-smart-dev-kit/router.js"),
    ).toBe(
      [
        "# cc-smart-dev-kit-router: the local AI gateway for Claude Code (127.0.0.1 only).",
        "# Written by `cc-smart-dev-kit gateway setup`; edits here are overwritten by the next setup.",
        "# It runs a copy of the router, never a file in the plugin's version folder.",
        "# Its config: ~/.config/cc-smart-dev-kit/gateway.json. Its port: cc-smart-dev-kit-router.socket.",
        "",
        "[Unit]",
        "Description=cc-smart-dev-kit-router: local AI gateway for Claude Code (127.0.0.1 only)",
        "Wants=cc-smart-dev-kit-router.socket",
        "After=cc-smart-dev-kit-router.socket",
        "StartLimitIntervalSec=60",
        "StartLimitBurst=5",
        "",
        "[Service]",
        "Type=simple",
        'ExecStart="/opt/bun/bin/bun" --no-env-file "/home/user/.local/share/cc-smart-dev-kit/router.js"',
        "WorkingDirectory=%h",
        "RuntimeDirectory=cc-smart-dev-kit-router",
        "RuntimeDirectoryMode=0700",
        "Restart=always",
        "RestartSec=2",
        "KillMode=mixed",
        "TimeoutStopSec=120",
        "UMask=0077",
        "NoNewPrivileges=true",
        "",
        "[Install]",
        "WantedBy=default.target",
        "Also=cc-smart-dev-kit-router.socket",
        "",
      ].join("\n"),
    );
  });

  it("the socket unit, as written, and the port read back from it", () => {
    const text = renderSocket(20100);
    expect(text).toBe(
      [
        "# cc-smart-dev-kit-router: the socket of the local AI gateway for Claude Code (127.0.0.1 only).",
        "# Written by `cc-smart-dev-kit gateway setup`; edits here are overwritten by the next setup.",
        "# systemd holds the router's port, so a request waits while the router restarts.",
        "",
        "[Unit]",
        "Description=cc-smart-dev-kit-router socket: holds 127.0.0.1:20100 across router restarts",
        "",
        "[Socket]",
        "ListenStream=127.0.0.1:20100",
        "NoDelay=true",
        "",
        "[Install]",
        "WantedBy=sockets.target",
        "",
      ].join("\n"),
    );
    expect(socketPort(text)).toBe(20100);
    expect(socketPort("[Socket]\nListenStream=0.0.0.0:20100\n")).toBe(null);
    for (const bad of [0, 65_536, 1.5, Number.NaN]) {
      expect(() => renderSocket(bad)).toThrow("not a port");
    }
  });

  it("a path with a quote, a backslash or a % cannot go into the unit file", () => {
    expect(() => renderUnit('/opt/b"un', "/x")).toThrow("cannot put");
    expect(() => renderUnit("/opt/bun", "/x\\y")).toThrow("cannot put");
    expect(() => renderUnit("/opt/bun", "/x%h")).toThrow("cannot put");
  });
});

// ─── The router service: stop, for restore ──────────────────────────────────────

describe("router service stop", () => {
  /**
   * A fake systemctl and a fake probe on a made-up port. `unit` is what
   * `systemctl --user is-active` says before the stop (default `active`). The port answers
   * as this router for `heldPolls` probes after the stop was sent (Infinity: it never lets
   * go), then refuses; with `other`, another program answers there (a 404, not a health
   * answer). Every call goes into one `events` list, so the order is the assertion. The
   * clock moves only when the code sleeps. No network.
   *
   * The units' files live in a temp folder: `stopRouter` stops only the units whose files
   * are there (`stopUnits`), so `files` leaves one or both out on purpose.
   */
  function stopMachine(options: {
    heldPolls: number;
    failOn?: string;
    other?: boolean;
    unit?: string;
    files?: string[];
  }) {
    const dir = tempDir("router-units");
    for (const name of options.files ?? [UNIT_NAME, SOCKET_NAME]) {
      writeFileSync(join(dir, name), "# a unit\n");
    }
    const names = { dir, socket: SOCKET_NAME, unit: UNIT_NAME };
    const events: string[] = [];
    const start = Date.UTC(2026, 9, 15, 10, 0, 0);
    const clock = { now: start };
    let stopSent = false;
    let polls = 0;
    const unit = options.unit ?? "active";
    const runner = (cmd: string[]) => {
      events.push(`$ ${cmd.join(" ")}`);
      if (cmd[2] === options.failOn) return { exitCode: 1, output: "Failed to connect to bus" };
      if (cmd[2] === "is-active") {
        const word = stopSent ? "inactive" : unit;
        return { exitCode: word === "active" ? 0 : 3, output: `${word}\n` };
      }
      if (cmd[2] === "stop") stopSent = true;
      return { exitCode: 0, output: "" };
    };
    const probe = {
      fetch: async (url: string) => {
        events.push(`probe ${url}`);
        if (options.other === true) return new Response("not found", { status: 404 });
        if (!stopSent) return Response.json({ ok: true, port: FAKE_PORT });
        polls += 1;
        if (polls <= options.heldPolls) return Response.json({ ok: true, port: FAKE_PORT });
        throw connectionRefused();
      },
      now: () => clock.now,
      sleep: async (ms: number) => {
        clock.now += ms;
      },
    };
    const service = systemdService({
      socketPath: join(dir, SOCKET_NAME),
      unitPath: join(dir, UNIT_NAME),
    });
    return { clock, events, names, probe, runner, service, waited: () => clock.now - start };
  }

  const HEALTH = `probe http://127.0.0.1:${FAKE_PORT}/__cc-smart-dev-kit/health`;
  const IS_ACTIVE = "$ systemctl --user is-active cc-smart-dev-kit-router.service";
  // Both units in one call each: the socket must not reopen the router between them.
  const DISABLE =
    "$ systemctl --user disable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service";
  const STOP =
    "$ systemctl --user stop --no-block cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service";

  // Changed on purpose, in the tests below that list the calls: the unit's state is asked
  // first (IS_ACTIVE), so the port is waited for only while the unit itself runs.
  it("disables, stops without waiting for the drain, then asks the port until it is refused", async () => {
    const m = stopMachine({ heldPolls: 3 });
    expect(await m.service.stop(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    // Never `disable --now`: that waits up to TimeoutStopSec while the drain runs.
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH, HEALTH, HEALTH, HEALTH]);
    // Three held answers, a 200 ms rest after each, then the refusal.
    expect(m.waited()).toBe(600);
  });

  it("a port that is free at once: one probe, no rest", async () => {
    const m = stopMachine({ heldPolls: 0 });
    expect(await m.service.stop(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH]);
    expect(m.waited()).toBe(0);
  });

  it("a unit that is still deactivating (an earlier stop) is waited for like a running one", async () => {
    const m = stopMachine({ heldPolls: 2, unit: "deactivating" });
    expect(await m.service.stop(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH, HEALTH, HEALTH]);
    expect(m.waited()).toBe(400);
  });

  it("the port answers, but not as this router (a 404): no wait, the reason given back", async () => {
    const m = stopMachine({ heldPolls: Number.POSITIVE_INFINITY, other: true });
    expect(await m.service.stop(m.runner, FAKE_PORT, m.probe)).toEqual({
      detail: "HTTP 404",
      kind: "other",
    });
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH]);
    expect(m.waited()).toBe(0);
  });

  it("a unit that was not running (crash-looping) while a router it did not start holds the port: no wait", async () => {
    // A `gateway serve` started by hand answers the health page; the unit cannot bind.
    for (const unit of ["activating", "failed", "inactive"]) {
      const m = stopMachine({ heldPolls: Number.POSITIVE_INFINITY, unit });
      expect(await m.service.stop(m.runner, FAKE_PORT, m.probe)).toEqual({
        kind: "not-running",
        state: unit,
      });
      expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP]);
      expect(m.waited()).toBe(0);
    }
  });

  it("a port still held after 15 s: a clear error, after the stop was sent", async () => {
    const m = stopMachine({ heldPolls: Number.POSITIVE_INFINITY });
    expect(STOP_WAIT_MS).toBe(15_000);
    await expect(m.service.stop(m.runner, FAKE_PORT, m.probe)).rejects.toThrow(
      `cc-smart-dev-kit-router.service is disabled and was told to stop, but 127.0.0.1:${FAKE_PORT} still takes connections after 15 s. Nothing else was restored. See why: systemctl --user status cc-smart-dev-kit-router (and ss -ltnp for another program on the port). Then run cc-smart-dev-kit restore again.`,
    );
    expect(m.events.slice(0, 4)).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH]);
    // The whole 15 s by its clock, in 200 ms rests, and not longer: 75 rests, 76 probes.
    expect(m.waited()).toBe(15_000);
    expect(m.events.filter((event) => event === HEALTH)).toHaveLength(76);
  });

  it("an unknown port (null): the stop is sent, nothing is asked", async () => {
    const m = stopMachine({ heldPolls: 0 });
    expect(await m.service.stop(m.runner, null, m.probe)).toEqual({ kind: "no-port" });
    expect(m.events).toEqual([DISABLE, STOP]);
  });

  it("a failing systemctl stops it before anything else", async () => {
    const m = stopMachine({ failOn: "disable", heldPolls: 0 });
    await expect(m.service.stop(m.runner, FAKE_PORT, m.probe)).rejects.toThrow(
      "systemctl --user disable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service failed (exit 1):\nFailed to connect to bus",
    );
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP]);
  });

  it("a machine from before the socket unit: the service is stopped, and the missing socket never fails it", async () => {
    // The move from 0.2.x: `anymodel-router.service` and no socket file at all. Stopping the
    // socket unit too would fail with "Unit … does not exist" and stop the restore.
    const m = stopMachine({ files: [UNIT_NAME], heldPolls: 0 });
    expect(await m.service.stop(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    expect(m.events).toEqual([
      IS_ACTIVE,
      "$ systemctl --user disable cc-smart-dev-kit-router.service",
      "$ systemctl --user stop --no-block cc-smart-dev-kit-router.service",
      HEALTH,
    ]);
  });

  it("neither unit's file is there: nothing is sent to systemctl, and no port is waited for", async () => {
    // An old setup whose unit files are gone: `is-active` says inactive (a unit that is not
    // there is never "active"), so there is no router of the unit's to wait for.
    const m = stopMachine({ files: [], heldPolls: 0, unit: "inactive" });
    expect(await m.service.stop(m.runner, FAKE_PORT, m.probe)).toEqual({
      kind: "not-running",
      state: "inactive",
    });
    expect(m.events).toEqual([IS_ACTIVE]);
  });
});

// ─── The model slots and the judge test ─────────────────────────────────────────

describe("slot opus / fable", () => {
  const models = { omniroute: ["glm-5.3-flash", "deepseek-v4.1-flash"] };

  it("turns a model slot on: the model first, then its fallbacks; modelSlots keyed by the real id", () => {
    const plan = planSlotChange(
      config(),
      "opus",
      "claude-opus-5-5,omniroute:glm-5.3-flash",
      models,
    );
    if (!("config" in plan)) throw new Error(plan.error);
    expect(plan.key).toBe("cc-smart-dev-kit-opus");
    expect(plan.old).toEqual([]);
    expect(plan.config.slots["cc-smart-dev-kit-opus"]).toEqual([
      "claude-opus-5-5",
      "omniroute:glm-5.3-flash",
    ]);
    expect(plan.config.modelSlots).toEqual({ "claude-opus-5-5": "cc-smart-dev-kit-opus" });
    const fable = planSlotChange(
      plan.config,
      "fable",
      "claude-fable-5-1,omniroute:deepseek-v4.1-flash",
      models,
    );
    if (!("config" in fable)) throw new Error(fable.error);
    expect(fable.config.modelSlots).toEqual({
      "claude-fable-5-1": "cc-smart-dev-kit-fable",
      "claude-opus-5-5": "cc-smart-dev-kit-opus",
    });
  });

  it("off removes the slot and its modelSlots entry; with none left, no modelSlots field at all", () => {
    const on = planSlotChange(config(), "opus", "claude-opus-5-5,omniroute:glm-5.3-flash", models);
    if (!("config" in on)) throw new Error(on.error);
    const off = planSlotChange(on.config, "opus", "off", models);
    if (!("config" in off)) throw new Error(off.error);
    expect(off.next).toEqual([]);
    expect(Object.keys(off.config.slots)).not.toContain("cc-smart-dev-kit-opus");
    expect(off.config).not.toHaveProperty("modelSlots");
    expect(planSlotChange(config(), "fable", "off", models)).toEqual({
      error: "cc-smart-dev-kit-fable is already off",
    });
  });

  it("refuses a model slot that does not start with its own model, or has no fallback", () => {
    expect(planSlotChange(config(), "opus", "omniroute:glm-5.3-flash", models)).toEqual({
      error:
        "cc-smart-dev-kit-opus: start with the opus model itself, e.g. cc-smart-dev-kit gateway slot opus claude-opus-5-5,omniroute:<model>",
    });
    expect(
      planSlotChange(config(), "fable", "claude-opus-5-5,omniroute:glm-5.3-flash", models),
    ).toEqual({
      error:
        "cc-smart-dev-kit-fable: start with the fable model itself, e.g. cc-smart-dev-kit gateway slot fable claude-fable-5-1,omniroute:<model>",
    });
    expect(planSlotChange(config(), "opus", "claude-opus-5-5", models)).toEqual({
      error: "cc-smart-dev-kit-opus: give the fallback targets after claude-opus-5-5",
    });
    expect(planSlotChange(config(), "opus", "claude-opus-5-5,omniroute:kimi", models)).toEqual({
      error:
        '"omniroute:kimi": "omniroute" has no model "kimi" (see cc-smart-dev-kit gateway models)',
    });
  });

  it("a new model id replaces the old entry for the same slot", () => {
    const on = planSlotChange(config(), "opus", "claude-opus-5-5,omniroute:glm-5.3-flash", models);
    if (!("config" in on)) throw new Error(on.error);
    const moved = planSlotChange(
      on.config,
      "opus",
      "claude-opus-6-0,omniroute:glm-5.3-flash",
      models,
    );
    if (!("config" in moved)) throw new Error(moved.error);
    expect(moved.config.modelSlots).toEqual({ "claude-opus-6-0": "cc-smart-dev-kit-opus" });
  });
});

describe("the judge test", () => {
  it("is a check the router recognises: its prompt, no tools, the force push, reasoning off", () => {
    const request = judgeTestRequest("deepseek-v4.1-flash");
    expect(isAutoModeGuard({ ...request, model: "cc-smart-dev-kit-judge" })).toBe(true);
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("thinking");
    expect(request).not.toHaveProperty("metadata");
    expect(request).toMatchObject({
      model: "deepseek-v4.1-flash",
      output_config: { effort: "none" },
      stop_sequences: ["</block>"],
    });
    expect(JSON.stringify(request.messages)).toContain(
      '{\\"Bash\\":\\"git push --force origin main\\"}',
    );
  });

  it("reads the verdict: <block>yes blocks, <block>no allows, anything else is unclear", () => {
    const answer = (text: string) => ({ content: [{ text, type: "text" }] });
    expect(judgeVerdict(answer("<block>yes</block> force push to main"))).toEqual({
      detail: "blocked it",
      verdict: "block",
    });
    expect(judgeVerdict(answer("Thinking... <block> YES"))).toEqual({
      detail: "blocked it",
      verdict: "block",
    });
    expect(judgeVerdict(answer("<block>no</block> fine"))).toEqual({
      detail: "let it run",
      verdict: "allow",
    });
    expect(judgeVerdict(answer("I would block this."))).toEqual({
      detail: "the answer has no <block>yes or <block>no",
      verdict: "unclear",
    });
    expect(judgeVerdict({ error: "x" })).toEqual({
      detail: "no content in the answer",
      verdict: "unclear",
    });
  });
});

describe("the router as a Windows Scheduled Task", () => {
  /** `<` and `&` back, as Task Scheduler un-escapes the XML it reads. */
  function unescapeXml(text: string): string {
    return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  }

  /**
   * A Windows machine, driven from Linux: a fake `powershell` answers the task queries from
   * `state`, logs each call's short name in `actions`, and reads the task's definition file
   * back on `register` — so what the driver sees is what setup wrote there. No real Task
   * Scheduler, no PowerShell, no network: the probe answers while the task runs, and nothing
   * listens while it does not.
   */
  function taskMachine() {
    const home = tempDir("gateway-task");
    const bundle = join(home, "plugin", "dist", "router.js");
    mkdirSync(join(home, "plugin", "dist"), { recursive: true });
    writeFileSync(bundle, "// router v1\n");
    const dataDir = join(home, ".local", "share", "cc-smart-dev-kit");
    const copyPath = join(dataDir, "router.js");
    const taskPath = join(dataDir, "router-task.xml");
    const stateDir = join(home, ".claude", "cc-smart-dev-kit");
    const marker = join(stateDir, "restart-pending");
    const state: {
      action: null | { arguments: string; execute: string; workingDirectory: string };
      lastResult: null | number;
      registered: boolean;
      taskState: string;
    } = { action: null, lastResult: 267011, registered: false, taskState: "Ready" };
    /** Something that is not this router answers on the port (`gateway serve` by hand). */
    const port = { other: false };
    const actions: string[] = [];
    const scripts: string[] = [];
    const probed: string[] = [];
    const events: string[] = [];
    const clock = { now: Date.UTC(2026, 9, 16, 10, 0, 0) };
    const runner = (cmd: string[]) => {
      const script = cmd.at(-1) ?? "";
      scripts.push(script);
      if (script.includes("Get-ScheduledTaskInfo")) {
        actions.push("query");
        if (!state.registered) return { exitCode: 0, output: "registered=false\n" };
        const action = state.action;
        return {
          exitCode: 0,
          output: [
            "registered=true",
            `state=${state.taskState}`,
            `last=${String(state.lastResult)}`,
            `execute=${action?.execute ?? ""}`,
            `arguments=${action?.arguments ?? ""}`,
            `working=${action?.workingDirectory ?? ""}`,
            "",
          ].join("\n"),
        };
      }
      if (script.startsWith("Register-ScheduledTask")) {
        actions.push("register");
        const xml = readFileSync(taskPath, "utf8");
        const pick = (tag: string) =>
          unescapeXml(new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? "");
        state.action = {
          arguments: pick("Arguments"),
          execute: pick("Command"),
          workingDirectory: pick("WorkingDirectory"),
        };
        state.registered = true;
        state.taskState = "Ready";
        return { exitCode: 0, output: "" };
      }
      if (script.startsWith("Start-ScheduledTask")) {
        actions.push("start");
        state.taskState = "Running";
        return { exitCode: 0, output: "" };
      }
      if (script.startsWith("Stop-ScheduledTask")) {
        actions.push("stop");
        state.taskState = "Ready";
        return { exitCode: 0, output: "" };
      }
      if (script.startsWith("Unregister-ScheduledTask")) {
        actions.push("unregister");
        state.registered = false;
        state.taskState = "Ready";
        return { exitCode: 0, output: "" };
      }
      actions.push(`unknown: ${script}`);
      return { exitCode: 0, output: "" };
    };
    const probe: HealthProbe = {
      fetch: async (url) => {
        probed.push(url);
        if (port.other) return new Response("not found", { status: 404 });
        if (state.taskState === "Running") return Response.json({ ok: true, port: FAKE_PORT });
        throw connectionRefused();
      },
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
    };
    const account = "MACHINE\\user";
    const service = () => scheduledTaskService({ account, runner, taskPath });
    const install = (options: {
      confirm?: ((question: string) => boolean) | null;
      dryRun?: boolean;
      yes?: boolean;
    }) =>
      installRouter({
        account,
        bunPath: "/opt/bun/bin/bun",
        bunVersion: "1.4.3",
        bundle,
        confirm: options.confirm === undefined ? null : options.confirm,
        copyPath,
        home,
        port: FAKE_PORT,
        probe,
        runner,
        say: (line) => events.push(line),
        service: service(),
        stateDir,
        yes: options.yes ?? false,
        ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
      });
    return {
      actions,
      bundle,
      copyPath,
      events,
      home,
      install,
      marker,
      port,
      probe,
      probed,
      runner,
      scripts,
      service,
      state,
      stateDir,
      taskPath,
    };
  }

  const STARTED = "registered and (re)started the task cc-smart-dev-kit-router";
  const RESTARTING =
    "restarting the task cc-smart-dev-kit-router (new requests are refused until it answers)";

  it("first install: the copy, the definition, the task registered from it, then started", async () => {
    const m = taskMachine();
    expect(await m.install({})).toBe("installed");
    expect(m.actions).toEqual(["query", "query", "register", "start"]);
    expect(m.events).toEqual([
      "+ ~/.local/share/cc-smart-dev-kit/router.js: router copy created",
      "+ ~/.local/share/cc-smart-dev-kit/router-task.xml: task created",
      STARTED,
    ]);
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
    // The definition is registered from the file it was written to, by name.
    expect(m.scripts[2]).toBe(
      `Register-ScheduledTask -TaskName 'cc-smart-dev-kit-router' -Xml (Get-Content -Raw -Encoding UTF8 -LiteralPath '${m.taskPath}') -Force | Out-Null`,
    );
    expect(m.scripts[3]).toBe(`Start-ScheduledTask -TaskName 'cc-smart-dev-kit-router'`);
    // What the fake read back out of that file: what Windows holds is what setup wrote.
    expect(m.state.action).toEqual({
      arguments: `--no-env-file "${m.copyPath}"`,
      execute: "/opt/bun/bin/bun",
      workingDirectory: m.home,
    });
    expect(m.state.taskState).toBe("Running");
    expect(existsSync(m.marker)).toBe(false);
    // The port is asked before anything, then once for the router to answer.
    expect(m.probed).toEqual([
      `http://127.0.0.1:${FAKE_PORT}/__cc-smart-dev-kit/health`,
      `http://127.0.0.1:${FAKE_PORT}/__cc-smart-dev-kit/health`,
    ]);
  });

  it("nothing changed: the task is left alone, and the router is not restarted", async () => {
    const m = taskMachine();
    await m.install({});
    m.actions.length = 0;
    m.events.length = 0;
    expect(await m.install({})).toBe("up-to-date");
    // The task's state, whether it runs what setup writes, and its state again: nothing else.
    expect(m.actions).toEqual(["query", "query", "query"]);
    expect(m.events).toEqual([UP_TO_DATE]);
    // Nothing runs: the task is registered again (Windows holds no entry for it) and started.
    m.state.taskState = "Ready";
    m.actions.length = 0;
    m.events.length = 0;
    expect(await m.install({})).toBe("installed");
    expect(m.actions).toEqual(["query", "query", "query", "register", "start"]);
    expect(m.events).toEqual([STARTED]);
  });

  it("the task Windows holds runs another program: setup registers the one it writes", async () => {
    const m = taskMachine();
    await m.install({});
    // Someone re-pointed the task by hand (or an older version wrote it).
    m.state.action = {
      arguments: '--no-env-file "C:\\somewhere\\other.js"',
      execute: "C:\\other\\bun.exe",
      workingDirectory: "C:\\other",
    };
    m.actions.length = 0;
    m.events.length = 0;
    expect(await m.install({ yes: true })).toBe("installed");
    expect(m.actions).toEqual(["query", "query", "query", "register", "stop", "start"]);
    expect(m.state.action?.execute).toBe("/opt/bun/bin/bun");
  });

  it("a changed copy with a running router: the warning, no restart without a yes, then the restart", async () => {
    const m = taskMachine();
    await m.install({});
    writeFileSync(m.copyPath, "// router v2\n");
    m.actions.length = 0;
    m.events.length = 0;
    expect(await m.install({})).toBe("declined");
    // Said plainly, before the question: Windows loses the socket's promise.
    expect(m.events).toEqual([
      TASK_RESTART_WARNING,
      "Nothing was changed. Run again with --yes to restart: cc-smart-dev-kit gateway setup --yes",
    ]);
    expect(m.actions).toEqual(["query", "query"]);
    // Nothing was written: the file is still what the test put there, never the bundle.
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v2\n");

    m.actions.length = 0;
    m.events.length = 0;
    expect(await m.install({ yes: true })).toBe("installed");
    // Registered again, the running router stopped, its port waited for, then started.
    expect(m.actions).toEqual(["query", "query", "register", "stop", "start"]);
    expect(m.events).toEqual([
      TASK_RESTART_WARNING,
      "~ ~/.local/share/cc-smart-dev-kit/router.js: router copy updated",
      RESTARTING,
      STARTED,
    ]);
    // The copy is the bundle's now: that is what the restart was for.
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
    expect(m.state.taskState).toBe("Running");
  });

  it("the port still answering after the stop: the restart stops with the reason, nothing started", async () => {
    const m = taskMachine();
    await m.install({});
    writeFileSync(m.copyPath, "// router v2\n");
    // Something holds the port on purpose: `waitWhileRouterAnswers` never sees it free.
    m.probe.fetch = async (url) => {
      m.probed.push(url);
      return Response.json({ ok: true, port: FAKE_PORT });
    };
    m.actions.length = 0;
    await expect(m.install({ yes: true })).rejects.toThrow(
      `the task cc-smart-dev-kit-router was stopped, but 127.0.0.1:${FAKE_PORT} still answers after 5 s, so the new router cannot bind it. Nothing was started. Stop what holds that port, then run: cc-smart-dev-kit gateway setup`,
    );
    expect(m.actions).toEqual(["query", "query", "register", "stop"]);
    // The marker stays: `doctor` says a setup did not finish, and the next one restarts.
    expect(existsSync(m.marker)).toBe(true);
  });

  it("the router does not answer after the start: the error names the task's state and its result", async () => {
    const m = taskMachine();
    await m.install({});
    writeFileSync(m.copyPath, "// router v2\n");
    // The task starts, but another program answers on the port, never this router.
    m.port.other = true;
    await expect(m.install({ yes: true })).rejects.toThrow(
      `the router did not answer on 127.0.0.1:${FAKE_PORT} within 5 s of the task's start (the task cc-smart-dev-kit-router is Running, last run result 267011). See why: stop the task cc-smart-dev-kit-router (\`Stop-ScheduledTask -TaskName cc-smart-dev-kit-router\`) and run \`cc-smart-dev-kit gateway serve\` in a terminal: a task has no console, so the router's log goes nowhere else. Then run: cc-smart-dev-kit gateway setup again.`,
    );
  });

  it("stop, for restore: the router is stopped, the task removed, and the port waited for", async () => {
    const m = taskMachine();
    await m.install({});
    m.actions.length = 0;
    expect(await m.service().stop(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    expect(m.actions).toEqual(["query", "stop", "unregister"]);
    expect(m.state.registered).toBe(false);
    expect(m.state.taskState).toBe("Ready");
  });

  it("a task that is not running, and a machine with no task at all", async () => {
    const m = taskMachine();
    await m.install({});
    m.state.taskState = "Ready";
    m.actions.length = 0;
    // A task that is not running is removed all the same: it must not start at logon again.
    expect(await m.service().stop(m.runner, FAKE_PORT, m.probe)).toEqual({
      kind: "not-running",
      state: "Ready",
    });
    expect(m.actions).toEqual(["query", "unregister"]);

    const none = taskMachine();
    expect(await none.service().stop(none.runner, FAKE_PORT, none.probe)).toEqual({
      kind: "not-running",
      state: "not registered",
    });
    expect(none.actions).toEqual(["query"]);
  });

  it("this machine's service, from the platform and what is on PATH", () => {
    const powershell = () => "/usr/bin/powershell";
    const nothing = () => null;
    expect(routerServiceKind("win32", powershell)).toBe("scheduled-task");
    // No PowerShell anywhere: no service this plugin installs.
    expect(routerServiceKind("win32", nothing)).toBe("none");
    expect(routerServiceKind("linux", powershell)).toBe("systemd");
    expect(routerServiceKind("linux", nothing)).toBe("none");
    expect(routerServiceKind("darwin", powershell)).toBe("none");
  });

  it("the Windows account the task runs as, from the environment", () => {
    expect(windowsAccount({ USERDOMAIN: "MACHINE", USERNAME: "me" })).toBe("MACHINE\\me");
    expect(windowsAccount({ USERNAME: "me" })).toBe("me");
    expect(windowsAccount({ USERDOMAIN: "MACHINE" })).toBe(null);
    expect(windowsAccount({})).toBe(null);
  });

  it("Task Scheduler's answer: its own state names, its last result, and the action", () => {
    const running = parseTaskFacts(
      [
        "registered=true",
        "state=Running",
        "last=0",
        "execute=C:\\bun\\bun.exe",
        'arguments=--no-env-file "C:\\Users\\me\\.local\\share\\cc-smart-dev-kit\\router.js"',
        "working=C:\\Users\\me",
        "",
      ].join("\r\n"),
    );
    expect(running).toEqual({
      action: {
        arguments: '--no-env-file "C:\\Users\\me\\.local\\share\\cc-smart-dev-kit\\router.js"',
        execute: "C:\\bun\\bun.exe",
        workingDirectory: "C:\\Users\\me",
      },
      lastResult: 0,
      registered: true,
      state: "Running",
    });
    expect(taskRunsCopy(running, "C:\\Users\\me\\.local\\share\\cc-smart-dev-kit\\router.js")).toBe(
      true,
    );
    // Case differs between programs on Windows: the same file is the same copy.
    expect(taskRunsCopy(running, "c:\\users\\ME\\.local\\share\\cc-smart-dev-kit\\router.js")).toBe(
      true,
    );
    expect(taskRunsCopy(running, "C:\\elsewhere\\router.js")).toBe(false);
    expect(parseTaskFacts("registered=true\nstate=Ready\nlast=267011\n").lastResult).toBe(267011);
    expect(parseTaskFacts("registered=false\n")).toEqual({
      action: null,
      lastResult: null,
      registered: false,
      state: "not registered",
    });
    // A PowerShell that refuses: the error says what it said, and never a key.
    expect(() => taskFacts(() => ({ exitCode: 1, output: "Access is denied." }))).toThrow(
      "could not ask Windows about the task cc-smart-dev-kit-router (exit 1): Access is denied.",
    );
  });

  it("the definition the task is registered from, written out by hand", () => {
    expect(
      renderTask({
        account: "MACHINE\\me",
        bunPath: "C:\\bun\\bun.exe",
        copyPath: "C:\\Users\\me\\.local\\share\\cc-smart-dev-kit\\router.js",
        home: "C:\\Users\\me",
        port: 20100,
      }),
    ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!-- cc-smart-dev-kit-router: the local CC gateway for Claude Code (127.0.0.1 only).
     Written by \`cc-smart-dev-kit gateway setup\`; it is registered as a Scheduled Task with
     \`Register-ScheduledTask -Xml\`. The next setup overwrites it; edits here are lost. -->
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Local CC gateway for Claude Code (127.0.0.1:20100 only). Written by \`cc-smart-dev-kit gateway setup\`.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>MACHINE\\me</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>MACHINE\\me</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\bun\\bun.exe</Command>
      <Arguments>--no-env-file "C:\\Users\\me\\.local\\share\\cc-smart-dev-kit\\router.js"</Arguments>
      <WorkingDirectory>C:\\Users\\me</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`);
    // A `&` in a path is Task Scheduler's own markup: escaped, never written raw.
    expect(
      renderTask({
        account: "MACHINE\\me",
        bunPath: "C:\\b&b\\bun.exe",
        copyPath: "C:\\router.js",
        home: "C:\\Users\\me",
        port: 20100,
      }),
    ).toContain("<Command>C:\\b&amp;b\\bun.exe</Command>");
    // A quote would end the argument that carries the copy's path, and a control character
    // no quoting can carry: refused, as a unit file refuses both.
    expect(() =>
      renderTask({
        account: "MACHINE\\me",
        bunPath: 'C:\\b"un\\bun.exe',
        copyPath: "C:\\router.js",
        home: "C:\\Users\\me",
        port: 20100,
      }),
    ).toThrow('cannot put "C:\\\\b\\"un\\\\bun.exe" in the task\'s definition');
    expect(() =>
      renderTask({
        account: "MACHINE\\me",
        bunPath: "C:\\bun\\bun.exe",
        copyPath: "C:\\route\nr.js",
        home: "C:\\Users\\me",
        port: 20100,
      }),
    ).toThrow("cannot put");
  });

  it("with no account in the environment, Windows is asked once, and its answer is kept", () => {
    const asked: string[] = [];
    const service = scheduledTaskService({
      account: null,
      runner: (cmd) => {
        asked.push(cmd.at(-1) ?? "");
        return { exitCode: 0, output: "OTHERBOX\\them\n" };
      },
      taskPath: "/tmp/router-task.xml",
    });
    const input = {
      bunPath: "/opt/bun/bin/bun",
      copyPath: "/opt/router.js",
      home: "/home/them",
      port: 20100,
      probe: { fetch: async () => new Response(), now: () => 0, sleep: async () => undefined },
      say: () => undefined,
    };
    expect(service.definitions(input)[0]?.text).toContain("<UserId>OTHERBOX\\them</UserId>");
    // Asked once: the next definition uses the answer it already has.
    expect(service.definitions(input)[0]?.text).toContain("<UserId>OTHERBOX\\them</UserId>");
    expect(asked).toEqual(["[System.Security.Principal.WindowsIdentity]::GetCurrent().Name"]);
  });
});
