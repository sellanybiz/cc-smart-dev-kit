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
import {
  installRouter,
  RESTART_WARNING,
  renderUnit,
  STOP_WAIT_MS,
  stopRouter,
  UP_TO_DATE,
} from "./service";
import {
  FORBIDDEN_ENV_KEYS,
  GATEWAY_ENV_KEYS,
  gatewayEnv,
  maskKey,
  settingsReport,
  turnOff,
  turnOn,
} from "./settings";

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
      "anymodel-cheap": ["omniroute:glm-5.3-flash", "ollama:deepseek-v4.1-flash"],
      "anymodel-mixed": ["claude-sonnet-5-5", "omniroute:glm-5.3-flash"],
      "anymodel-scout": [
        "omniroute:glm-5.3-flash",
        "ollama:deepseek-v4.1-flash",
        "claude-sonnet-5-5",
      ],
      "anymodel-worker": ["claude-sonnet-5-5"],
    },
    timeouts: { firstByteMs: 1000 },
    version: 1,
  };
}

/** The env block `on` writes on port 20100, written out by hand. */
const ON_ENV = {
  ANTHROPIC_BASE_URL: "http://127.0.0.1:20100",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "anymodel-scout[1m]",
  ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION:
    "Cheap model for search and reading: the scout slot (anymodel gateway slot scout …)",
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Scout (cheap)",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "anymodel-worker[1m]",
  ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:
    "Cheap model for routine code and docs: the worker slot (anymodel gateway slot worker …)",
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Worker (cheap)",
  ENABLE_TOOL_SEARCH: "true",
};

// ─── Claude Code settings: on / off ─────────────────────────────────────────────

describe("Claude Code settings: on / off", () => {
  const original = {
    env: { CLAUDE_CODE_SUBAGENT_MODEL: "anymodel-worker[1m]", FOO: "1" },
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
    return { file, stateDir: join(home, ".claude", "anymodel") };
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
        env: { CLAUDE_CODE_SUBAGENT_MODEL: "anymodel-worker[1m]", FOO: "1", ...ON_ENV },
        model: "opus",
        permissions: { allow: ["Bash(ls:*)"] },
      });
      expect(result.written).toBe(true);
      expect(result.changes).toHaveLength(8);
      const backups = listBackups(stateDir, file);
      expect(backups).toHaveLength(1);
      expect(readFileSync(backups[0]?.path ?? "", "utf8")).toBe(before);
      // No backup beside the file: only the state folder, which holds them.
      expect(readdirSync(join(file, "..")).sort()).toEqual(["anymodel", "settings.json"]);
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
          ? ' Many people set ENABLE_TOOL_SEARCH themselves; removing it by hand lets anymodel gateway on manage it (it sets "true", and gateway off removes it again).'
          : "";
      expect((caught as Error).message).toBe(
        `${file}: env.${key} is ${shown}, set by someone else. anymodel does not overwrite it. Remove it by hand if anymodel should manage it.${yourOwn}`,
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

  it("status sees a key that would replace the own login, and a subagent model override", () => {
    const { file } = seed({
      apiKeyHelper: "x",
      env: {
        ANTHROPIC_AUTH_TOKEN: "t",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:20100",
        CLAUDE_CODE_SUBAGENT_MODEL: "anymodel-worker",
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
      const path = join(tempDir("gateway-setup"), ".config", "anymodel", "gateway.json");
      expect(() => ensureConfig(path, null)).toThrow(
        "anymodel gateway setup --backend-key-stdin omniroute",
      );
      ensureConfig(path, { backend: "omniroute", value: "omni-key-123456" });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      // DeepSeek first in both slots, GLM second, Claude Sonnet last; ids as OmniRoute's
      // /v1/models lists them. Changed by the move: no judge slot. Auto mode's safety
      // check stays on Claude until the person turns the judge on.
      expect(loadConfigFile(path).slots).toEqual({
        "anymodel-scout": [
          "omniroute:ollama-cloud/deepseek-v4.1-flash",
          "omniroute:ollama-cloud/glm-5.3-flash",
          "claude-sonnet-5-5",
        ],
        "anymodel-worker": [
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
    const path = join(tempDir("gateway-dry"), ".config", "anymodel", "gateway.json");
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
        '"omniroute:kimi-k3": "omniroute" has no model "kimi-k3" (see anymodel gateway models)',
    });
    expect(planSlotChange(cfg, "worker", "nobody:x", models)).toEqual({
      error: '"nobody:x": backend "nobody" is not in the config',
    });
    expect(planSlotChange(cfg, "worker", "ollama:x", models)).toEqual({
      error: '"ollama:x": could not list the models of "ollama", so it cannot be checked',
    });
    expect(planSlotChange(cfg, "Scout!", "claude-sonnet-5-5", models)).toEqual({
      error: '"Scout!" is not a slot name (scout, worker, judge, or anymodel-<name>)',
    });
    // `judge off`: the way back to Claude. config() has no judge slot yet.
    expect(planSlotChange(cfg, "judge", "off", models)).toEqual({
      error: "anymodel-judge is already off",
    });
    const judged = planSlotChange(cfg, "judge", "omniroute:deepseek-v4.1-flash", models);
    if (!("config" in judged)) throw new Error(judged.error);
    expect(judged.config.slots["anymodel-judge"]).toEqual(["omniroute:deepseek-v4.1-flash"]);
    const off = planSlotChange(judged.config, "judge", " off ", models);
    if (!("config" in off)) throw new Error(off.error);
    expect(off.old).toEqual(["omniroute:deepseek-v4.1-flash"]);
    expect(off.next).toEqual([]);
    expect(Object.keys(off.config.slots).sort()).toEqual([
      "anymodel-cheap",
      "anymodel-mixed",
      "anymodel-scout",
      "anymodel-worker",
    ]);
    expect(planSlotChange(cfg, "worker", "off", models)).toEqual({
      error: "only anymodel-judge can be off; give anymodel-worker its targets instead",
    });
    const ok = planSlotChange(cfg, "worker", "omniroute:glm-5.3-flash, claude-sonnet-5-5", models);
    if (!("config" in ok)) throw new Error(ok.error);
    expect(ok.key).toBe("anymodel-worker");
    expect(ok.old).toEqual(["claude-sonnet-5-5"]);
    expect(ok.config.slots["anymodel-worker"]).toEqual([
      "omniroute:glm-5.3-flash",
      "claude-sonnet-5-5",
    ]);
  });

  it("slot judge off is refused while an alias still points at the judge slot", () => {
    const cfg = { ...config(), aliases: { "old-judge": "anymodel-judge" } };
    cfg.slots = { ...cfg.slots, "anymodel-judge": ["omniroute:glm-5.3-flash"] };
    const off = planSlotChange(cfg, "judge", "off", {});
    expect("error" in off && off.error).toContain(
      'alias "old-judge" points at slot "anymodel-judge", which is not in slots',
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
    const path = join(tempDir("gateway-nokey"), ".config", "anymodel", "gateway.json");
    expect(ensureConfig(path, null, { allowNone: true })).toBe(
      `no config at ${path} yet: the router answers every slot on your own Claude login until the OmniRoute key is added (setup --backend-key-stdin omniroute)`,
    );
    expect(existsSync(path)).toBe(false);
    // Without the flag it still refuses, so a forgotten key is not silent.
    expect(() => ensureConfig(path, null)).toThrow("no config at");
    // The key later creates the full default config, not a Claude-only one.
    ensureConfig(path, { backend: "omniroute", value: "omni-key-123456" }, { allowNone: true });
    expect(loadConfigFile(path).slots["anymodel-worker"]).toEqual([
      "omniroute:ollama-cloud/deepseek-v4.1-flash",
      "omniroute:ollama-cloud/glm-5.3-flash",
      "claude-sonnet-5-5",
    ]);
  });
});

// ─── The router service: copy, unit, systemctl ──────────────────────────────────

describe("router service install", () => {
  /**
   * A home, the plugin's router bundle, a fake systemctl that logs each call, and a fake
   * health probe on a made-up port: the router answers there while the unit is active
   * (`port.answers`), and another program holds it when `port.taken`. Its clock moves only
   * when the code sleeps. No network.
   */
  function machine() {
    const home = tempDir("gateway-install");
    const bundle = join(home, "plugin", "dist", "router.js");
    mkdirSync(join(home, "plugin", "dist"), { recursive: true });
    writeFileSync(bundle, "// router v1\n");
    /** `idle`: what `is-active` says while the unit is not active. */
    const state = { active: false, fail: false, idle: "activating" };
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
    const stateDir = join(home, ".claude", "anymodel");
    const marker = join(stateDir, "restart-pending");
    const copyPath = join(home, ".local", "share", "anymodel", "router.js");
    const unitPath = join(home, ".config", "systemd", "user", "anymodel-router.service");
    const install = (options: {
      yes?: boolean;
      confirm?: ((question: string) => boolean) | null;
      dryRun?: boolean;
      bunVersion?: string;
    }) =>
      installRouter({
        bunPath: "/opt/bun/bin/bun",
        bunVersion: options.bunVersion ?? "1.4.3",
        bundle,
        copyPath,
        unitPath,
        home,
        stateDir,
        port: FAKE_PORT,
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
          if (cmd[2] === "is-active") {
            const word = state.active ? "active" : state.idle;
            return { exitCode: state.active ? 0 : 3, output: cmd[3] === "--quiet" ? "" : word };
          }
          if (cmd[2] === "restart" || cmd[3] === "--now") state.active = true;
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

  // Changed on purpose: a unit that is not active is asked its state once more before the
  // restart (the `is-active` line without --quiet), to say when it still drains.
  it("first install: copies the bundle, writes the unit, reloads, enables and starts it", async () => {
    const m = machine();
    expect(await m.install({})).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      "+ ~/.local/share/anymodel/router.js: router copy created",
      "+ ~/.config/systemd/user/anymodel-router.service: unit created",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable anymodel-router.service",
      "$ systemctl --user is-active anymodel-router.service",
      "$ systemctl --user restart anymodel-router.service",
      "enabled and (re)started anymodel-router.service",
    ]);
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
    expect(statSync(m.copyPath).mode & 0o777).toBe(0o644);
    expect(readFileSync(m.unitPath, "utf8")).toContain(
      `\nExecStart="/opt/bun/bin/bun" --no-env-file "${m.copyPath}"\n`,
    );
  });

  it("a bun older than 1.4.3: refused first, with nothing asked, written or run", async () => {
    const m = machine();
    for (const dryRun of [true, false]) {
      await expect(m.install({ bunVersion: "1.4.2", dryRun, yes: true })).rejects.toThrow(
        "anymodel needs Bun ≥ 1.4.3; this is 1.4.2 (/opt/bun/bin/bun). The router is not installed. Upgrade this Bun, then run: anymodel gateway setup",
      );
    }
    expect(m.events).toEqual([]);
    expect(m.probed).toEqual([]);
    expect(existsSync(m.copyPath)).toBe(false);
    expect(existsSync(m.unitPath)).toBe(false);
    expect(existsSync(m.marker)).toBe(false);
  });

  it("right after restore, the old router still draining: it says it waits, then restarts", async () => {
    const m = machine();
    // restore's `stop --no-block` returned at once; the old router finishes its answers.
    m.state.idle = "deactivating";
    expect(await m.install({})).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      "+ ~/.local/share/anymodel/router.js: router copy created",
      "+ ~/.config/systemd/user/anymodel-router.service: unit created",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable anymodel-router.service",
      "$ systemctl --user is-active anymodel-router.service",
      "waiting for the old router to finish its answers (up to 120 s)",
      "$ systemctl --user restart anymodel-router.service",
      "enabled and (re)started anymodel-router.service",
    ]);
  });

  it("again with nothing changed: no restart, only enable --now", async () => {
    const m = machine();
    await m.install({});
    m.events.length = 0;
    expect(await m.install({})).toBe("up-to-date");
    expect(m.events).toEqual([
      "$ systemctl --user enable --now anymodel-router.service",
      UP_TO_DATE,
    ]);
    expect(UP_TO_DATE).toBe("router already up to date (no restart)");
    expect(readdirSync(join(m.home, ".local", "share", "anymodel"))).toEqual(["router.js"]);
  });

  it("a new bundle while the router runs: it warns, and without a yes or a terminal it changes nothing", async () => {
    const m = machine();
    await m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    m.events.length = 0;
    expect(await m.install({})).toBe("declined");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      RESTART_WARNING,
      "Nothing was changed. Run again with --yes to restart: anymodel gateway setup --yes",
    ]);
    expect(RESTART_WARNING).toBe(
      "anymodel-router is running. A restart cuts the answers in flight in running Claude sessions on this machine (Claude Code retries them).",
    );
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
  });

  it("the person says no: nothing changes; yes: the new copy, then the restart", async () => {
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
    expect(asked).toEqual(["Restart anymodel-router now?", "Restart anymodel-router now?"]);
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      RESTART_WARNING,
      "~ ~/.local/share/anymodel/router.js: router copy updated",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable anymodel-router.service",
      "restarting anymodel-router",
      "$ systemctl --user restart anymodel-router.service",
      "enabled and (re)started anymodel-router.service",
    ]);
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v2\n");
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
    expect(m.events).toContain("$ systemctl --user restart anymodel-router.service");
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v2\n");
  });

  it("a dry run writes nothing and runs only the is-active question", async () => {
    const m = machine();
    expect(await m.install({ dryRun: true })).toBe("installed");
    expect(m.events).toEqual(["$ systemctl --user is-active --quiet anymodel-router.service"]);
    expect(existsSync(m.copyPath)).toBe(false);
    expect(existsSync(m.unitPath)).toBe(false);
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
      "$ systemctl --user is-active --quiet anymodel-router.service",
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
      expect(m.events).toEqual([]);
      expect(m.probed).toEqual([`http://127.0.0.1:${FAKE_PORT}/__anymodel/health`]);
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
      expect(m.events).toEqual([]);
      expect(existsSync(m.stateDir)).toBe(false);
    }
    const slow = machine();
    slow.port.timeout = true;
    await expect(slow.install({ yes: true })).rejects.toThrow(NOT_OURS);
    expect(slow.events).toEqual([]);
    expect(existsSync(slow.copyPath)).toBe(false);
  });

  it("the marker is there from before the copy until the restarted router answers, then gone", async () => {
    const m = machine();
    expect(await m.install({})).toBe("installed");
    // Changed on purpose: the second is-active, before the restart (see "first install").
    expect(m.markerAt).toEqual([
      "is-active: no marker, no copy",
      "daemon-reload: marker, copy",
      "enable: marker, copy",
      "is-active: marker, copy",
      "restart: marker, copy",
    ]);
    expect(existsSync(m.marker)).toBe(false);
    expect(m.events.at(-1)).toBe("enabled and (re)started anymodel-router.service");
  });

  it("a router that never answers after the restart: an error naming the unit's state and its log; the marker stays", async () => {
    const m = machine();
    m.port.answers = false;
    await expect(m.install({})).rejects.toThrow(
      `anymodel-router.service did not answer on 127.0.0.1:${FAKE_PORT} within 5 s of the restart (systemctl --user is-active: active). See why: journalctl --user -u anymodel-router -n 30. Then run anymodel gateway setup again.`,
    );
    expect(existsSync(m.marker)).toBe(true);
    // It waited 5 s by its clock, asking every 200 ms, and no longer.
    expect(m.clock.now).toBe(Date.UTC(2026, 9, 15, 10, 0, 5));
    expect(m.events.at(-1)).toBe("$ systemctl --user is-active anymodel-router.service");
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
      "$ systemctl --user is-active --quiet anymodel-router.service",
      RESTART_WARNING,
      "Nothing was changed. Run again with --yes to restart: anymodel gateway setup --yes",
    ]);
    expect(existsSync(m.marker)).toBe(true);
    m.events.length = 0;
    expect(await m.install({ yes: true })).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      RESTART_WARNING,
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable anymodel-router.service",
      "restarting anymodel-router",
      "$ systemctl --user restart anymodel-router.service",
      "enabled and (re)started anymodel-router.service",
    ]);
    expect(existsSync(m.marker)).toBe(false);
    // Up to date and no marker: the shortcut again.
    m.events.length = 0;
    expect(await m.install({})).toBe("up-to-date");
  });

  it("restore removes the copy and the unit that setup created", async () => {
    const m = machine();
    await m.install({});
    const results = restore(join(m.home, ".claude", "anymodel"));
    expect(results.map((result) => [result.file, result.action]).sort()).toEqual(
      [
        [m.unitPath, "removed"],
        [m.copyPath, "removed"],
      ].sort(),
    );
    expect(existsSync(m.copyPath)).toBe(false);
    expect(existsSync(m.unitPath)).toBe(false);
  });

  it("the unit file, as written", () => {
    expect(renderUnit("/opt/bun/bin/bun", "/home/user/.local/share/anymodel/router.js")).toBe(
      [
        "# anymodel-router: the local AI gateway for Claude Code (127.0.0.1 only).",
        "# Written by `anymodel gateway setup`; edits here are overwritten by the next setup.",
        "# It runs a copy of the router, never a file in the plugin's version folder.",
        "# Its config: ~/.config/anymodel/gateway.json.",
        "",
        "[Unit]",
        "Description=anymodel-router: local AI gateway for Claude Code (127.0.0.1 only)",
        "StartLimitIntervalSec=0",
        "",
        "[Service]",
        "Type=simple",
        'ExecStart="/opt/bun/bin/bun" --no-env-file "/home/user/.local/share/anymodel/router.js"',
        "WorkingDirectory=%h",
        "Restart=always",
        "RestartSec=2",
        "KillMode=mixed",
        "TimeoutStopSec=120",
        "UMask=0077",
        "NoNewPrivileges=true",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    );
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
   */
  function stopMachine(options: {
    heldPolls: number;
    failOn?: string;
    other?: boolean;
    unit?: string;
  }) {
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
    return { clock, events, probe, runner, waited: () => clock.now - start };
  }

  const HEALTH = `probe http://127.0.0.1:${FAKE_PORT}/__anymodel/health`;
  const IS_ACTIVE = "$ systemctl --user is-active anymodel-router.service";
  const DISABLE = "$ systemctl --user disable anymodel-router.service";
  const STOP = "$ systemctl --user stop --no-block anymodel-router.service";

  // Changed on purpose, in the tests below that list the calls: the unit's state is asked
  // first (IS_ACTIVE), so the port is waited for only while the unit itself runs.
  it("disables, stops without waiting for the drain, then asks the port until it is refused", async () => {
    const m = stopMachine({ heldPolls: 3 });
    expect(await stopRouter(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    // Never `disable --now`: that waits up to TimeoutStopSec while the drain runs.
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH, HEALTH, HEALTH, HEALTH]);
    // Three held answers, a 200 ms rest after each, then the refusal.
    expect(m.waited()).toBe(600);
  });

  it("a port that is free at once: one probe, no rest", async () => {
    const m = stopMachine({ heldPolls: 0 });
    expect(await stopRouter(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH]);
    expect(m.waited()).toBe(0);
  });

  it("a unit that is still deactivating (an earlier stop) is waited for like a running one", async () => {
    const m = stopMachine({ heldPolls: 2, unit: "deactivating" });
    expect(await stopRouter(m.runner, FAKE_PORT, m.probe)).toEqual({ kind: "closed" });
    expect(m.events).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH, HEALTH, HEALTH]);
    expect(m.waited()).toBe(400);
  });

  it("the port answers, but not as this router (a 404): no wait, the reason given back", async () => {
    const m = stopMachine({ heldPolls: Number.POSITIVE_INFINITY, other: true });
    expect(await stopRouter(m.runner, FAKE_PORT, m.probe)).toEqual({
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
      expect(await stopRouter(m.runner, FAKE_PORT, m.probe)).toEqual({
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
    await expect(stopRouter(m.runner, FAKE_PORT, m.probe)).rejects.toThrow(
      `anymodel-router.service is disabled and was told to stop, but 127.0.0.1:${FAKE_PORT} still takes connections after 15 s. Nothing else was restored. See why: systemctl --user status anymodel-router (and ss -ltnp for another program on the port). Then run anymodel restore again.`,
    );
    expect(m.events.slice(0, 4)).toEqual([IS_ACTIVE, DISABLE, STOP, HEALTH]);
    // The whole 15 s by its clock, in 200 ms rests, and not longer: 75 rests, 76 probes.
    expect(m.waited()).toBe(15_000);
    expect(m.events.filter((event) => event === HEALTH)).toHaveLength(76);
  });

  it("an unknown port (null): the stop is sent, nothing is asked", async () => {
    const m = stopMachine({ heldPolls: 0 });
    expect(await stopRouter(m.runner, null, m.probe)).toEqual({ kind: "no-port" });
    expect(m.events).toEqual([DISABLE, STOP]);
  });

  it("a failing systemctl stops it before anything else", async () => {
    const m = stopMachine({ failOn: "disable", heldPolls: 0 });
    await expect(stopRouter(m.runner, FAKE_PORT, m.probe)).rejects.toThrow(
      "systemctl --user disable anymodel-router.service failed (exit 1):\nFailed to connect to bus",
    );
    expect(m.events).toEqual([IS_ACTIVE, DISABLE]);
  });
});
