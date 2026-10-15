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
import { installRouter, RESTART_WARNING, renderUnit, UP_TO_DATE } from "./service";
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
    "Cheap model for search and reading: the scout slot (cc-agentic gateway slot scout …)",
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Scout (cheap)",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "anymodel-worker[1m]",
  ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:
    "Cheap model for routine code and docs: the worker slot (cc-agentic gateway slot worker …)",
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
    return { file, stateDir: join(home, ".claude", "cc-agentic") };
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
      expect(readdirSync(join(file, "..")).sort()).toEqual(["cc-agentic", "settings.json"]);
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
      expect((caught as Error).message).toBe(
        `${file}: env.${key} is ${shown}, set by someone else. cc-agentic does not overwrite it. Remove it by hand if cc-agentic should manage it.`,
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
        "cc-agentic gateway setup --backend-key-stdin omniroute",
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
        '"omniroute:kimi-k3": "omniroute" has no model "kimi-k3" (see cc-agentic gateway models)',
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
  /** A home, the plugin's router bundle, and a fake systemctl that logs each call. */
  function machine() {
    const home = tempDir("gateway-install");
    const bundle = join(home, "plugin", "dist", "router.js");
    mkdirSync(join(home, "plugin", "dist"), { recursive: true });
    writeFileSync(bundle, "// router v1\n");
    const state = { active: false, fail: false };
    const events: string[] = [];
    const copyPath = join(home, ".local", "share", "anymodel", "router.js");
    const unitPath = join(home, ".config", "systemd", "user", "anymodel-router.service");
    const install = (options: {
      yes?: boolean;
      confirm?: ((question: string) => boolean) | null;
      dryRun?: boolean;
    }) =>
      installRouter({
        bunPath: "/opt/bun/bin/bun",
        bundle,
        copyPath,
        unitPath,
        home,
        stateDir: join(home, ".claude", "cc-agentic"),
        runner: (cmd) => {
          events.push(`$ ${cmd.join(" ")}`);
          if (state.fail) return { exitCode: 1, output: "Failed to connect to bus" };
          if (cmd[2] === "is-active") return { exitCode: state.active ? 0 : 3, output: "" };
          if (cmd[2] === "restart" || cmd[3] === "--now") state.active = true;
          return { exitCode: 0, output: "" };
        },
        say: (line) => events.push(line),
        yes: options.yes ?? false,
        confirm: options.confirm === undefined ? null : options.confirm,
        ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
      });
    return { home, bundle, copyPath, unitPath, state, events, install };
  }

  it("first install: copies the bundle, writes the unit, reloads, enables and starts it", () => {
    const m = machine();
    expect(m.install({})).toBe("installed");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      "+ ~/.local/share/anymodel/router.js: router copy created",
      "+ ~/.config/systemd/user/anymodel-router.service: unit created",
      "$ systemctl --user daemon-reload",
      "$ systemctl --user enable anymodel-router.service",
      "$ systemctl --user restart anymodel-router.service",
      "enabled and (re)started anymodel-router.service",
    ]);
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
    expect(statSync(m.copyPath).mode & 0o777).toBe(0o644);
    expect(readFileSync(m.unitPath, "utf8")).toContain(
      `\nExecStart="/opt/bun/bin/bun" --no-env-file "${m.copyPath}"\n`,
    );
  });

  it("again with nothing changed: no restart, only enable --now", () => {
    const m = machine();
    m.install({});
    m.events.length = 0;
    expect(m.install({})).toBe("up-to-date");
    expect(m.events).toEqual([
      "$ systemctl --user enable --now anymodel-router.service",
      UP_TO_DATE,
    ]);
    expect(UP_TO_DATE).toBe("router already up to date (no restart)");
    expect(readdirSync(join(m.home, ".local", "share", "anymodel"))).toEqual(["router.js"]);
  });

  it("a new bundle while the router runs: it warns, and without a yes or a terminal it changes nothing", () => {
    const m = machine();
    m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    m.events.length = 0;
    expect(m.install({})).toBe("declined");
    expect(m.events).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      RESTART_WARNING,
      "Nothing was changed. Run again with --yes to restart: cc-agentic gateway setup --yes",
    ]);
    expect(RESTART_WARNING).toBe(
      "anymodel-router is running. A restart cuts the answers in flight in running Claude sessions on this machine (Claude Code retries them).",
    );
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v1\n");
  });

  it("the person says no: nothing changes; yes: the new copy, then the restart", () => {
    const m = machine();
    m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    const asked: string[] = [];
    m.events.length = 0;
    expect(
      m.install({
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
      m.install({
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

  it("--yes restarts without asking", () => {
    const m = machine();
    m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    const result = m.install({
      yes: true,
      confirm: () => {
        throw new Error("asked although --yes was given");
      },
    });
    expect(result).toBe("installed");
    expect(m.events).toContain("$ systemctl --user restart anymodel-router.service");
    expect(readFileSync(m.copyPath, "utf8")).toBe("// router v2\n");
  });

  it("a dry run writes nothing and runs only the is-active question", () => {
    const m = machine();
    expect(m.install({ dryRun: true })).toBe("installed");
    expect(m.events).toEqual(["$ systemctl --user is-active --quiet anymodel-router.service"]);
    expect(existsSync(m.copyPath)).toBe(false);
    expect(existsSync(m.unitPath)).toBe(false);
  });

  it("install stops at the first failing command", () => {
    const m = machine();
    m.install({});
    writeFileSync(m.bundle, "// router v2\n");
    m.state.fail = true;
    m.events.length = 0;
    // is-active fails too (not active): the copy is written, then daemon-reload fails.
    expect(() => m.install({})).toThrow(
      "systemctl --user daemon-reload failed (exit 1):\nFailed to connect to bus",
    );
    expect(m.events.filter((event) => event.startsWith("$ "))).toEqual([
      "$ systemctl --user is-active --quiet anymodel-router.service",
      "$ systemctl --user daemon-reload",
    ]);
  });

  it("restore removes the copy and the unit that setup created", () => {
    const m = machine();
    m.install({});
    const results = restore(join(m.home, ".claude", "cc-agentic"));
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
        "# Written by `cc-agentic gateway setup`; edits here are overwritten by the next setup.",
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
