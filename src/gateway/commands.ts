/**
 * `anymodel gateway <command>`: serve the router, see it, switch its slots, install it,
 * and turn it on or off for Claude Code.
 *
 *   serve     runs the router in this terminal (the systemd unit runs the copy instead).
 *   models    every model each backend offers, then the slot table.
 *   slot      checks each target and saves; the router uses it from its next request.
 *   status    router health, each backend, the slots, and what settings.json says.
 *   setup     makes the config if there is none (the key comes on stdin, never argv),
 *             puts the router copy and the systemd user unit in place, and starts it, or
 *             restarts it (after a yes) when one changed. Never touches Claude settings.
 *   on / off  sets or removes the gateway env keys in Claude Code's settings.
 *
 * API keys are masked in every output. The design: docs/gateway.md.
 */

import { existsSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { withLock } from "../setup/lock";
import { formatKeyPath, type ManagedJsonResult } from "../setup/managed-json";
import { listModels } from "./backends";
import {
  ConfigError,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_FIRST_BYTE_MS,
  DEFAULT_PORT,
  type GatewayConfig,
  loadConfigFile,
  messageOf,
  parseConfig,
  saveConfig,
} from "./config";
import { type HealthProbe, routerHealth } from "./health";
import { startRouter } from "./router";
import { type InstallOptions, installRouter, RESTART_WARNING, type Runner } from "./service";
import { maskKey, settingsReport, shownValue, turnOff, turnOn } from "./settings";
import { JUDGE_SLOT, parseTarget, slotKeyFromArg, type Target } from "./targets";

export const USAGE = `Usage: ${COMMAND} gateway <command>

Commands:
  status                 Router health, backends, slots, and the Claude Code settings.
  models                 Every model each backend offers, and the slots.
  slot <slot> <targets>  Set a slot's targets, in order. <slot>: scout, worker or judge.
                         e.g. slot worker omniroute:ollama-cloud/glm-5.3-flash,claude-sonnet-5-5
  slot judge off         Auto mode's safety check goes back to Claude.
  setup [--yes] [--backend-key-stdin <backend> | --no-backend-key]
                         Make the config (the key on stdin), install the router copy and
                         its systemd user unit, and start it. --yes: restart a running
                         router without asking (a restart cuts the answers in flight).
  on                     Point Claude Code at the router (every session on this machine).
  off                    Remove what "on" set. Restart the sessions afterwards.
  serve                  Run the router in this terminal.`;

/** What the commands need from the outside; a test passes its own. */
export interface GatewayContext {
  paths: CliPaths;
  /** The bun that runs the router copy: `process.execPath`. */
  bunPath: string;
  /** Its version: `Bun.version`. `setup` refuses one older than `MIN_BUN`. */
  bunVersion: string;
  /** The plugin's own `dist/router.js`. */
  bundle: string;
  runner: Runner;
  readStdin: () => Promise<string>;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  /** False where there is no systemd (macOS, Windows). */
  systemd: boolean;
  /**
   * Asks the router's health page and waits for it: `realProbe()` in use. A test passes
   * fakes, so it never reaches a port where a real router may run.
   */
  probe: HealthProbe;
}

/** The message when the service cannot run here. */
export const NEEDS_SYSTEMD = "the gateway service needs systemd (Linux) for now.";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Config: defaults, keys, slots ──────────────────────────────────────────────

/** Backends `setup` knows the address of. */
export const KNOWN_BACKENDS: Record<string, string> = {
  ollama: "https://ollama.com",
  omniroute: "http://127.0.0.1:20128",
};

/**
 * The slot table a new config gets; `gateway slot` changes it. DeepSeek first in each:
 * almost every subagent token is a cached re-read, and its cached input costs less than
 * GLM's (ollama.com/pricing). The ids are the ones OmniRoute's `/v1/models` lists, so
 * `gateway slot` can check them. No aliases: a project's own migration writes those.
 *
 * No judge slot: auto mode's safety checks stay on Claude, untouched, until the person
 * turns the judge on (`gateway slot judge <targets>`). A cheaper judge trades the checks'
 * quality for Claude usage: it can block good work, and a weak one can let a risky
 * command through.
 */
export function defaultConfig(omnirouteKey: string): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: { omniroute: { apiKey: omnirouteKey, baseUrl: "http://127.0.0.1:20128" } },
    port: DEFAULT_PORT,
    slots: {
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
    },
    timeouts: { firstByteMs: DEFAULT_FIRST_BYTE_MS },
    version: 1,
  };
}

/**
 * Make the config, or set one backend's key in it. Creating one needs the `omniroute` key
 * (the default slots use it); with a config there, a key replaces that backend's key (a
 * known backend is added). Returns what it did, in words.
 *
 * `allowNone` (`setup --no-backend-key`, a machine whose key does not exist yet): no
 * config and no key is then not an error. Nothing is written: the router runs on
 * `emptyConfig()` (every slot on Claude) until the key creates the default config.
 * Writing a Claude-only file instead would keep Claude-only slots after the key came.
 *
 * `dryRun`: checks everything and writes nothing.
 */
export function ensureConfig(
  configPath: string,
  key: null | { backend: string; value: string },
  options: { allowNone?: boolean; dryRun?: boolean } = {},
): string {
  if (!existsSync(configPath)) {
    if (key === null && options.allowNone === true) {
      return `no config at ${configPath} yet: the router answers every slot on your own Claude login until the OmniRoute key is added (setup --backend-key-stdin omniroute)`;
    }
    if (key?.backend !== "omniroute") {
      throw new ConfigError(
        `no config at ${configPath}. Create it with the OmniRoute key on stdin: ${COMMAND} gateway setup --backend-key-stdin omniroute`,
      );
    }
    if (options.dryRun !== true) saveConfig(configPath, defaultConfig(key.value));
    return `created ${configPath} (mode 600)`;
  }
  const config = loadConfigFile(configPath);
  if (key === null) return `kept ${configPath}`;
  const existing = Object.hasOwn(config.backends, key.backend)
    ? config.backends[key.backend]
    : undefined;
  const baseUrl = existing?.baseUrl ?? KNOWN_BACKENDS[key.backend];
  if (baseUrl === undefined) {
    throw new ConfigError(
      `backend "${key.backend}" is unknown; add it to ${configPath} by hand first`,
    );
  }
  if (options.dryRun !== true) {
    saveConfig(configPath, {
      ...config,
      backends: { ...config.backends, [key.backend]: { apiKey: key.value, baseUrl } },
    });
  }
  return `set the key of backend "${key.backend}" (${maskKey(key.value)}) in ${configPath}`;
}

/**
 * The port the router listens on: the config's, or `DEFAULT_PORT` when there is no config
 * file (the router then runs `emptyConfig()`, every slot on Claude, on that port). A file
 * that is there but cannot be used throws: its port is unknown.
 */
export function configuredPort(configPath: string): number {
  return existsSync(configPath) ? loadConfigFile(configPath).port : DEFAULT_PORT;
}

/**
 * The config with one slot changed, after checking every target: it parses, its backend
 * exists, and its model is in that backend's list. `claude-…` targets are taken as they
 * are: Anthropic's list is not reachable without the person's login. `judge off` removes
 * the judge slot, so auto mode's checks go back to Claude; no other slot can be off:
 * Claude Code's haiku / sonnet names point at them. (A `claude-…` target in the judge slot
 * is no way back: the check's body is built for the model it names, and Claude Sonnet 5.5
 * refuses its `thinking: disabled` with a 400.)
 */
export function planSlotChange(
  config: GatewayConfig,
  slotArg: string,
  targetsText: string,
  modelsByBackend: Record<string, null | string[]>,
): { config: GatewayConfig; key: string; old: string[]; next: string[] } | { error: string } {
  const key = slotKeyFromArg(slotArg);
  if (key === null)
    return { error: `"${slotArg}" is not a slot name (scout, worker, judge, or anymodel-<name>)` };
  if (targetsText.trim() === "off") {
    if (key !== JUDGE_SLOT) {
      return { error: `only ${JUDGE_SLOT} can be off; give ${key} its targets instead` };
    }
    if (!Object.hasOwn(config.slots, key)) return { error: `${JUDGE_SLOT} is already off` };
    const slots = Object.fromEntries(Object.entries(config.slots).filter(([name]) => name !== key));
    // An alias may still point at the judge slot: the check says so.
    const checked = parseConfig({ ...config, slots });
    if ("error" in checked) return { error: checked.error };
    return { config: checked.config, key, next: [], old: config.slots[key] ?? [] };
  }
  const next = targetsText
    .split(",")
    .map((text) => text.trim())
    .filter((text) => text !== "");
  if (next.length === 0) return { error: "give at least one target" };
  for (const text of next) {
    const parsed = parseTarget(text);
    if ("error" in parsed) return { error: parsed.error };
    const target: Target = parsed.target;
    if (target.kind === "anthropic") continue;
    if (!Object.hasOwn(config.backends, target.backend)) {
      return { error: `"${text}": backend "${target.backend}" is not in the config` };
    }
    const models = Object.hasOwn(modelsByBackend, target.backend)
      ? modelsByBackend[target.backend]
      : undefined;
    if (models === undefined || models === null) {
      return {
        error: `"${text}": could not list the models of "${target.backend}", so it cannot be checked`,
      };
    }
    if (!models.includes(target.model)) {
      return {
        error: `"${text}": "${target.backend}" has no model "${target.model}" (see ${COMMAND} gateway models)`,
      };
    }
  }
  const changed = { ...config, slots: { ...config.slots, [key]: next } };
  const checked = parseConfig(changed);
  if ("error" in checked) return { error: checked.error };
  return { config: checked.config, key, next, old: config.slots[key] ?? [] };
}

function printSlots(config: GatewayConfig): void {
  console.log("\nSlots (first that answers wins):");
  const keys = Object.keys(config.slots).sort();
  if (keys.length === 0) console.log("  (none)");
  for (const key of keys)
    console.log(`  ${key.padEnd(16)} ${(config.slots[key] ?? []).join(" → ")}`);
  if (!Object.hasOwn(config.slots, JUDGE_SLOT)) {
    console.log(`  ${JUDGE_SLOT.padEnd(16)} off: auto mode's safety checks go to Claude`);
  }
  const aliases = Object.entries(config.aliases).sort(([a], [b]) => (a < b ? -1 : 1));
  if (aliases.length > 0) {
    console.log("\nAliases (an old name, and what it means now):");
    for (const [name, to] of aliases) console.log(`  ${name.padEnd(16)} → ${to}`);
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────────

async function commandModels(ctx: GatewayContext): Promise<number> {
  const config = loadConfigFile(ctx.paths.gatewayConfigFile);
  for (const [name, backend] of Object.entries(config.backends)) {
    console.log(`\n${name}  ${shownValue(backend.baseUrl)}  (key ${maskKey(backend.apiKey)})`);
    const listed = await listModels(backend.baseUrl, backend.apiKey);
    if ("error" in listed) console.log(`  unreachable: ${listed.error}`);
    else if (listed.status !== 200) console.log(`  /v1/models answered HTTP ${listed.status}`);
    else {
      for (const model of [...listed.models].sort((a, b) => a.id.localeCompare(b.id))) {
        const context =
          model.contextLength === null
            ? ""
            : `  ${model.contextLength.toLocaleString("en-US")} tokens`;
        console.log(`  ${name}:${model.id}${context}`);
      }
    }
  }
  printSlots(config);
  console.log(
    "\nAny claude-<id> target (e.g. claude-sonnet-5-5) goes to Anthropic on your own Claude login.",
  );
  return 0;
}

async function commandSlot(ctx: GatewayContext, args: string[]): Promise<number> {
  const [slotArg, targets, ...extra] = args;
  if (slotArg === undefined || targets === undefined || extra.length > 0) {
    console.error(USAGE);
    return 2;
  }
  const configPath = ctx.paths.gatewayConfigFile;
  const config = loadConfigFile(configPath);
  // The model lists come from the network, so they are read before the lock.
  const modelsByBackend: Record<string, null | string[]> = {};
  for (const text of targets.split(",")) {
    const parsed = parseTarget(text);
    if (!("target" in parsed) || parsed.target.kind !== "backend") continue;
    const name = parsed.target.backend;
    const backend = Object.hasOwn(config.backends, name) ? config.backends[name] : undefined;
    if (backend === undefined || Object.hasOwn(modelsByBackend, name)) continue;
    const listed = await listModels(backend.baseUrl, backend.apiKey);
    modelsByBackend[name] =
      "models" in listed && listed.status === 200 ? listed.models.map((m) => m.id) : null;
  }
  const first = planSlotChange(config, slotArg, targets, modelsByBackend);
  if ("error" in first) throw new Error(first.error);
  // Read again and save inside the lock: another command may have changed the file since
  // (a key set by `gateway setup`, another slot), and its change must not be lost.
  const plan = await withLock(
    ctx.paths.stateDir,
    () => {
      const again = planSlotChange(loadConfigFile(configPath), slotArg, targets, modelsByBackend);
      if ("error" in again) throw new Error(again.error);
      saveConfig(configPath, again.config);
      return again;
    },
    { waitMs: 10_000 },
  );
  const now =
    plan.next.length === 0 ? "off (auto mode's safety check on Claude)" : plan.next.join(" → ");
  console.log(`${plan.key}: ${plan.old.join(" → ") || "(new)"}\n  now: ${now}`);
  console.log("The router uses it from its next request.");
  return 0;
}

function printOverrides(report: ReturnType<typeof settingsReport>): void {
  if (report.subagentOverrides.length > 0) {
    console.log(
      `  WARN ${report.subagentOverrides.join(", ")} set: every agent launched without a model runs on it, with the gateway possibly a cheap slot. Remove it by hand unless you want that.`,
    );
  }
  if (report.loginOverrides.length > 0) {
    console.log(
      `  WARN ${report.loginOverrides.join(", ")} set: that replaces your own Claude login. Remove it for the gateway.`,
    );
  }
}

async function commandStatus(ctx: GatewayContext): Promise<number> {
  let config: GatewayConfig | null = null;
  try {
    config = loadConfigFile(ctx.paths.gatewayConfigFile);
  } catch (error) {
    console.log(`config: ${messageOf(error)}`);
  }
  // Without a good config the router runs on the default port.
  const port = config?.port ?? DEFAULT_PORT;
  const health = await routerHealth(port, ctx.probe.fetch);
  if ("error" in health) console.log(`router: DOWN on 127.0.0.1:${port} (${health.error})`);
  else {
    const body = isJsonObject(health.body) ? health.body : {};
    console.log(
      `router: up on 127.0.0.1:${String(body.port)} for ${String(body.uptimeSec)} s, ${String(body.requests)} requests, ${String(body.fallbacks)} fallbacks`,
    );
    if (body.port !== port)
      console.log(`  WARN the config says port ${port}; restart the router to move it`);
    const cooling = isJsonObject(body.cooling) ? Object.entries(body.cooling) : [];
    for (const [target, seconds] of cooling)
      console.log(`  resting: ${target} for ${String(seconds)} s more`);
  }
  if (config !== null) {
    for (const [name, backend] of Object.entries(config.backends)) {
      const listed = await listModels(backend.baseUrl, backend.apiKey);
      const state = "error" in listed ? `unreachable (${listed.error})` : `HTTP ${listed.status}`;
      console.log(
        `backend ${name}: ${shownValue(backend.baseUrl)} key ${maskKey(backend.apiKey)} → ${state}`,
      );
    }
    printSlots(config);
  }
  const report = settingsReport(ctx.paths.settingsFile);
  console.log(
    `\nClaude Code (${tildify(ctx.paths.settingsFile, ctx.paths.home)}): ${report.baseUrl === null ? "gateway OFF (no ANTHROPIC_BASE_URL)" : `gateway ON → ${report.baseUrl}`}`,
  );
  printOverrides(report);
  return 0;
}

/** Parses `setup`'s options; null on a wrong option. */
function setupOptions(
  args: string[],
): { yes: boolean; keyBackend: null | string; noKey: boolean } | null {
  let yes = false;
  let keyBackend: null | string = null;
  let noKey = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes") yes = true;
    else if (arg === "--no-backend-key") noKey = true;
    else if (arg === "--backend-key-stdin") {
      const backend = args[index + 1];
      if (backend === undefined || backend.startsWith("--")) return null;
      keyBackend = backend;
      index += 1;
    } else return null;
  }
  if (noKey && keyBackend !== null) return null;
  return { yes, keyBackend, noKey };
}

async function commandSetup(ctx: GatewayContext, args: string[]): Promise<number> {
  const options = setupOptions(args);
  if (options === null) {
    console.error(USAGE);
    return 2;
  }
  if (!ctx.systemd) {
    console.error(NEEDS_SYSTEMD);
    return 1;
  }
  const { paths } = ctx;
  let key: null | { backend: string; value: string } = null;
  if (options.keyBackend !== null) {
    const value = (await ctx.readStdin()).trim();
    if (value === "") throw new Error("no key on stdin");
    key = { backend: options.keyBackend, value };
  }
  const configPath = paths.gatewayConfigFile;
  const install = (overrides: Partial<InstallOptions>): InstallOptions => ({
    bunPath: ctx.bunPath,
    bunVersion: ctx.bunVersion,
    bundle: ctx.bundle,
    copyPath: paths.routerCopy,
    unitPath: paths.routerUnitFile,
    home: paths.home,
    stateDir: paths.stateDir,
    port: configuredPort(configPath),
    probe: ctx.probe,
    runner: ctx.runner,
    say: (line) => console.log(line),
    yes: options.yes,
    confirm: ctx.confirm,
    ...overrides,
  });
  // Everything is checked, the port asked and the question answered, before the lock and
  // before any write.
  ensureConfig(configPath, key, { allowNone: options.noKey, dryRun: true });
  if ((await installRouter(install({ dryRun: true }))) === "declined") return 1;
  return withLock(
    paths.stateDir,
    async () => {
      const said = ensureConfig(configPath, key, { allowNone: options.noKey });
      console.log(said.replaceAll(configPath, tildify(configPath, paths.home)));
      // The question was answered above: the warning is not repeated, and nothing asks again.
      await installRouter(
        install({
          yes: true,
          confirm: null,
          say: (line) => {
            if (line !== RESTART_WARNING) console.log(line);
          },
        }),
      );
      if (settingsReport(paths.settingsFile).baseUrl === null) {
        console.log(
          `Claude Code does not use the gateway yet. Check it: ${COMMAND} gateway status. Then: ${COMMAND} gateway on.`,
        );
      }
      return 0;
    },
    { waitMs: 10_000 },
  );
}

function show(value: unknown): string {
  return value === undefined ? "(none)" : JSON.stringify(value);
}

function changeLines(result: ManagedJsonResult, home: string): string[] {
  return result.changes.map(
    (change) =>
      `~ ${tildify(result.file, home)}: ${formatKeyPath(change.path)}: ${show(change.before)} -> ${show(change.after)}`,
  );
}

async function commandOn(ctx: GatewayContext): Promise<number> {
  const { paths } = ctx;
  const port = configuredPort(paths.gatewayConfigFile);
  const health = await routerHealth(port, ctx.probe.fetch);
  if ("error" in health) {
    throw new Error(
      `the router does not answer on 127.0.0.1:${port} (${health.error}); every Claude request would fail. Run ${COMMAND} gateway setup first.`,
    );
  }
  const options = { settingsFile: paths.settingsFile, stateDir: paths.stateDir, port };
  // A read-only pass first: a key someone else set stops it before anything is written.
  turnOn({ ...options, dryRun: true });
  const result = await withLock(paths.stateDir, () => turnOn(options), { waitMs: 10_000 });
  if (result.changes.length === 0) {
    console.log("Nothing to change: the gateway is already on.");
  } else {
    console.log(changeLines(result, paths.home).join("\n"));
    console.log(
      `Done. The changed file has a backup in ${tildify(paths.stateDir, paths.home)}/backups/.`,
    );
    console.log(
      "Every Claude Code session on this machine, in every folder, uses the gateway from now on: its haiku / sonnet work (background titles and summaries too) goes to the cheap slots.",
    );
  }
  printOverrides(settingsReport(paths.settingsFile));
  return 0;
}

async function commandOff(ctx: GatewayContext): Promise<number> {
  const { paths } = ctx;
  const { result, foreign } = await withLock(
    paths.stateDir,
    () => turnOff({ settingsFile: paths.settingsFile, stateDir: paths.stateDir }),
    { waitMs: 10_000 },
  );
  if (result.changes.length === 0) {
    console.log(
      `Nothing to remove: ${COMMAND} set no gateway key in ${tildify(paths.settingsFile, paths.home)}.`,
    );
  } else {
    console.log(changeLines(result, paths.home).join("\n"));
    console.log("Restart each Claude session: removing a setting needs a restart.");
  }
  for (const key of foreign) {
    console.log(
      `  env.${key} stays: ${COMMAND} did not set it. Remove it by hand to turn the gateway off.`,
    );
  }
  return 0;
}

/** Runs `gateway <command>`; the exit code. */
export async function runGateway(args: string[], ctx: GatewayContext): Promise<number> {
  const [command, ...rest] = args;
  const noArgs = (run: () => Promise<number>): Promise<number> => {
    if (rest.length > 0) {
      console.error(USAGE);
      return Promise.resolve(2);
    }
    return run();
  };
  switch (command) {
    case "models":
      return noArgs(() => commandModels(ctx));
    case "slot":
      return commandSlot(ctx, rest);
    case "status":
      return noArgs(() => commandStatus(ctx));
    case "setup":
      return commandSetup(ctx, rest);
    case "on":
      return noArgs(() => commandOn(ctx));
    case "off":
      return noArgs(() => commandOff(ctx));
    case "serve":
      return noArgs(async () => {
        startRouter(ctx.paths.gatewayConfigFile);
        return 0;
      });
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    default:
      console.error(`Unknown gateway command: ${command}\n\n${USAGE}`);
      return 2;
  }
}
