/**
 * `cc-smart-dev-kit gateway <command>`: serve the router, see it, switch its slots, install it,
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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { withLock } from "../setup/lock";
import { formatKeyPath, type ManagedJsonResult } from "../setup/managed-json";
import { atomicWrite, backupDir, backupFile } from "../setup/write";
import { checkBackendKey, listModels } from "./backends";
import {
  ConfigError,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_FIRST_BYTE_MS,
  DEFAULT_PORT,
  type GatewayConfig,
  judgeTargetTested,
  judgeTestProof,
  loadConfigFile,
  messageOf,
  parseConfig,
  saveConfig,
} from "./config";
import { type HealthFetch, type HealthProbe, routerHealth } from "./health";
import { JUDGE_TEST_ACTION, testJudgeTarget } from "./judge-test";
import { formatLimitState, parseLimitState } from "./limit-state";
import { createOmnirouteKey, probeOmniroute } from "./omniroute-key";
import { startRouter } from "./router";
import {
  type InstallOptions,
  installRouter,
  type RouterService,
  type RouterServiceKind,
  type Runner,
  systemdService,
} from "./service";
import { scheduledTaskService } from "./service-windows";
import { maskKey, settingsReport, shownValue, turnOff, turnOn } from "./settings";
import {
  isModelSlot,
  JUDGE_SLOT,
  MODEL_SLOTS,
  parseTarget,
  slotKeyFromArg,
  type Target,
} from "./targets";

export const USAGE = `Usage: ${COMMAND} gateway <command>

Commands:
  check                  One read-only question: does the gateway have an OmniRoute key the
                         backend accepts? 0 yes, 1 no key yet (OmniRoute answers, so one can
                         be made), 3 the backend could not be judged, 4 the key is refused.
  status                 Router health, backends, slots, and the Claude Code settings.
  models                 Every model each backend offers, and the slots.
  slot <slot> <targets>  Set a slot's targets, in order. <slot>: scout, worker, judge,
                         opus or fable.
                         e.g. slot worker omniroute:ollama-cloud/glm-5.3-flash,claude-sonnet-5-5
  slot opus claude-opus-5-5,<target>[,<target>]
                         Opus goes to Anthropic unchanged; only at the plan's usage limit
                         the next target answers. The same for fable (claude-fable-5-1).
  slot judge <targets>   A fallback judge for auto mode's safety check, used only when
                         Claude cannot answer it. Each target must first block a test
                         check (a force push to main), or it is not set.
  slot <judge|opus|fable> off
                         Turn that fallback off.
  setup [--yes] [--backend-key-stdin <backend> | --omniroute-password-stdin
        | --omniroute-password | --no-backend-key] [--save-unchecked]
                         Make the config (the key on stdin), install the router copy and
                         the service that runs it (a systemd user unit on Linux, a
                         per-user Scheduled Task on Windows), and start it. --yes:
                         restart a running router without asking.
                         A key given on stdin is TESTED against its backend before it is
                         saved: a 401 or 403 refuses it and keeps the key in place.
                         --omniroute-password-stdin: OmniRoute's dashboard password on
                         stdin; setup makes the router's OmniRoute key itself.
                         --omniroute-password: ask for it on the terminal, with no echo.
                         --save-unchecked: save a key the backend could not be asked about
                         (it is down, or answers something else).
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
  /** Every secret that arrives on stdin (`--backend-key-stdin`, `--omniroute-password-stdin`). */
  readStdin: () => Promise<string>;
  /**
   * Asks for a secret on the terminal, with no echo; left out when stdin is not a terminal that
   * can hide it. `readSecretLine` in use, so nothing typed or pasted is shown on screen.
   */
  readSecret?: () => Promise<null | string>;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  /**
   * The fetch every extra network call of a command uses — the key check (`checkBackendKey`),
   * OmniRoute's dashboard (`createOmnirouteKey`) and the OmniRoute liveness probe
   * (`probeOmniroute`). The real `fetch` in use; a test passes a fake, so no test reaches a real
   * backend.
   */
  apiFetch?: HealthFetch;
  /** The service this machine can run the router under (`routerServiceKind`). */
  service: RouterServiceKind;
  /** Windows: the account the Scheduled Task runs as (`MACHINE\user`). */
  account: null | string;
  /** This machine's platform (`process.platform`): the words of a refusal, nothing else. */
  platform: NodeJS.Platform;
  /** Where a command's own lines go: `console.log` in use, a collector from the portal. */
  print: (line: string) => void;
  /** Where a refusal or a usage line goes: `console.error` in use. */
  error: (line: string) => void;
  /**
   * Asks the router's health page and waits for it: `realProbe()` in use. A test passes
   * fakes, so it never reaches a port where a real router may run.
   */
  probe: HealthProbe;
}

/** The message when the service cannot run here: no systemd to run its units. */
export const NEEDS_SYSTEMD = "the gateway service needs systemd (Linux) for now.";

/** The same, on Windows without PowerShell (it ships with every Windows 10/11). */
export const NEEDS_POWERSHELL =
  "the gateway service needs PowerShell, and this machine has none: with no PowerShell and no systemd, there is no way to run the router here.";

/**
 * The service this machine runs the router under, from the context: systemd's units on
 * Linux, a per-user Scheduled Task on Windows.
 */
export function routerService(ctx: {
  paths: CliPaths;
  service: RouterServiceKind;
  runner: Runner;
  account: null | string;
}): RouterService {
  const { paths } = ctx;
  return ctx.service === "scheduled-task"
    ? scheduledTaskService({
        account: ctx.account,
        runner: ctx.runner,
        taskPath: paths.routerTaskFile,
      })
    : systemdService({ socketPath: paths.routerSocketFile, unitPath: paths.routerUnitFile });
}

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
 * `gateway slot` can check them. No aliases: a project's own migration writes those, and
 * `migrate` writes the ones a machine moving from 0.2.x's slot names needs.
 *
 * No judge slot and no model slots: auto mode's safety checks stay on Claude, untouched,
 * and with no fallback judge Claude Code asks the person when Claude cannot answer. The
 * person may set a fallback judge (`gateway slot judge <targets>`, tested first): a more affordable
 * judge can block good work, and a weak one can let a risky command through.
 */
export function defaultConfig(omnirouteKey: string): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: { omniroute: { apiKey: omnirouteKey, baseUrl: "http://127.0.0.1:20128" } },
    port: DEFAULT_PORT,
    slots: {
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
 * `stateDir`: when a key REPLACES one that is already there, the file is backed up first
 * (`backupFile`, the one backup helper: `<stateDir>/backups/`, never beside the file — the
 * config holds API keys). The caller says where that backup is. A key that does not change
 * gets no backup: nothing is being replaced. `setup` refuses a key its backend rejects before
 * this is ever called, so a backup here is a key that was checked (or saved unchecked).
 *
 * `dryRun`: checks everything and writes nothing.
 */
export function ensureConfig(
  configPath: string,
  key: null | { backend: string; value: string },
  options: { allowNone?: boolean; dryRun?: boolean; stateDir?: string } = {},
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
    if (existing !== undefined && existing.apiKey !== key.value && options.stateDir !== undefined) {
      // A key that is there and changes: keep the whole file as it was, so the key it held can
      // be read back (the person may only notice a wrong key days later, when the slots fail).
      backupFile(options.stateDir, configPath);
    }
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
 * The base URL a key for `backend` would be saved under: the one the config already has for
 * that backend, else the address `setup` knows (`KNOWN_BACKENDS`). Null when there is neither —
 * `ensureConfig` refuses such a backend in the same words.
 */
export function backendBaseUrl(configPath: string, backend: string): null | string {
  if (existsSync(configPath)) {
    const config = loadConfigFile(configPath);
    const existing = Object.hasOwn(config.backends, backend) ? config.backends[backend] : undefined;
    if (existing !== undefined) return existing.baseUrl;
  }
  return KNOWN_BACKENDS[backend] ?? null;
}

/**
 * Which key a backend wants, in words, for a refusal. Not a guess: OmniRoute's own dashboard
 * key and a provider's key are different credentials, and pasting a provider key where the
 * router's own was asked for is exactly what broke a machine live (2026-10-17) — every
 * affordable subagent answered on Claude until the right key was read back out of OmniRoute.
 */
export function wantedKeyWords(backend: string): string {
  if (backend === "omniroute") {
    return `"${backend}" wants an OmniRoute API key: the key the router itself uses, made in OmniRoute's own dashboard (its API keys page). A provider key — an Ollama Cloud key, say — is a different credential and OmniRoute refuses it`;
  }
  if (backend === "ollama") {
    return `"${backend}" wants an Ollama API key, from ollama.com (your account's API keys)`;
  }
  return `"${backend}" wants a key made by that backend itself`;
}

/** The refusal when the backend says the key that was just given is not one of its own. */
export function keyRefusedMessage(options: {
  backend: string;
  baseUrl: string;
  configPath: string;
  detail: string;
  status: number;
}): string {
  return [
    `${options.backend} answered HTTP ${String(options.status)} for this key (${options.detail}, ${shownValue(options.baseUrl)}): it does not accept it.`,
    `Nothing was saved, and the key in ${options.configPath} is kept as it was.`,
    wantedKeyWords(options.backend),
    `Find or make it there, then run again: ${COMMAND} gateway setup --backend-key-stdin ${options.backend} < key-file`,
  ].join("\n");
}

/** The refusal when the backend could not be asked at all and `--save-unchecked` was not given. */
export function keyUncheckedMessage(options: {
  backend: string;
  baseUrl: string;
  configPath: string;
  detail: string;
}): string {
  return [
    `could not ask ${options.backend} at ${shownValue(options.baseUrl)} whether it accepts this key (${options.detail}).`,
    `Nothing was saved, and the key in ${options.configPath} is kept as it was.`,
    `Start ${options.backend} and run again, or save the key without checking it: ${COMMAND} gateway setup --backend-key-stdin ${options.backend} --save-unchecked < key-file`,
  ].join("\n");
}

/**
 * The config with one slot changed, after checking every target: it parses, its backend
 * exists, and its model is in that backend's list. `claude-…` targets are taken as they
 * are: Anthropic's list is not reachable without the person's login. `judge off` removes
 * the judge slot, so auto mode's checks go back to Claude; no other slot can be off:
 * Claude Code's haiku / sonnet names point at them. (A `claude-…` target in the judge slot
 * is no way back: the check's body is built for the model it names, and Claude Sonnet 5.5
 * refuses its `thinking: disabled` with a 400.)
 *
 * A judge change drops every judge test proof (`judgeTested`): `judge off` needs none, and
 * new targets get theirs only from the test, in `commandSlot` (`withJudgeProofs`).
 */
export function planSlotChange(
  current: GatewayConfig,
  slotArg: string,
  targetsText: string,
  modelsByBackend: Record<string, null | string[]>,
): { config: GatewayConfig; key: string; old: string[]; next: string[] } | { error: string } {
  const key = slotKeyFromArg(slotArg);
  if (key === null) {
    return {
      error: `"${slotArg}" is not a slot name (scout, worker, judge, opus, fable, or cc-smart-dev-kit-<name>)`,
    };
  }
  const { judgeTested: _proofs, ...withoutProofs } = current;
  const config = key === JUDGE_SLOT ? withoutProofs : current;
  const model = isModelSlot(key);
  // The model slots' entries in `modelSlots`, without this slot's.
  const otherModelSlots = Object.fromEntries(
    Object.entries(config.modelSlots ?? {}).filter(([, slot]) => slot !== key),
  );
  /** The config with `modelSlots` written only when it has an entry: absent is the default. */
  const withModelSlots = (base: GatewayConfig, entries: Record<string, string>): GatewayConfig => {
    const { modelSlots: _old, ...rest } = base;
    return Object.keys(entries).length > 0 ? { ...rest, modelSlots: entries } : rest;
  };
  if (targetsText.trim() === "off") {
    if (key !== JUDGE_SLOT && !model) {
      return {
        error: `only ${JUDGE_SLOT}, cc-smart-dev-kit-opus and cc-smart-dev-kit-fable can be off; give ${key} its targets instead`,
      };
    }
    if (!Object.hasOwn(config.slots, key)) return { error: `${key} is already off` };
    const slots = Object.fromEntries(Object.entries(config.slots).filter(([name]) => name !== key));
    // An alias may still point at the slot: the check says so.
    const checked = parseConfig(withModelSlots({ ...config, slots }, otherModelSlots));
    if ("error" in checked) return { error: checked.error };
    return { config: checked.config, key, next: [], old: config.slots[key] ?? [] };
  }
  const next = targetsText
    .split(",")
    .map((text) => text.trim())
    .filter((text) => text !== "");
  if (next.length === 0) return { error: "give at least one target" };
  if (model) {
    // The first target is the Claude model the slot is for, sent unchanged; the rest answer
    // only at its plan usage limit.
    const first = next[0] ?? "";
    const family = MODEL_SLOTS[key] ?? "";
    if (!first.startsWith("claude-") || !first.includes(`-${family}-`)) {
      return {
        error: `${key}: start with the ${family} model itself, e.g. ${COMMAND} gateway slot ${family} ${family === "opus" ? "claude-opus-5-5" : "claude-fable-5-1"},omniroute:<model>`,
      };
    }
    if (next.length < 2) return { error: `${key}: give the fallback targets after ${first}` };
  }
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
  const slots = { ...config.slots, [key]: next };
  const changed = model
    ? withModelSlots({ ...config, slots }, { ...otherModelSlots, [next[0] ?? ""]: key })
    : { ...config, slots };
  const checked = parseConfig(changed);
  if ("error" in checked) return { error: checked.error };
  return { config: checked.config, key, next, old: config.slots[key] ?? [] };
}

function printSlots(config: GatewayConfig, print: (line: string) => void): void {
  print("\nSlots (first that answers wins):");
  const keys = Object.keys(config.slots).sort();
  if (keys.length === 0) print("  (none)");
  for (const key of keys) {
    const untested = (config.slots[key] ?? []).filter(
      (target) => !judgeTargetTested(config, target),
    );
    const note =
      key === JUDGE_SLOT
        ? untested.length > 0
          ? `  (NOT TESTED, so ignored: ${untested.join(", ")}; run ${COMMAND} gateway slot judge <targets>)`
          : "  (only when Claude cannot answer a check)"
        : isModelSlot(key)
          ? "  (the rest only at the plan's usage limit)"
          : "";
    print(`  ${key.padEnd(16)} ${(config.slots[key] ?? []).join(" → ")}${note}`);
  }
  if (!Object.hasOwn(config.slots, JUDGE_SLOT)) {
    print(
      `  ${JUDGE_SLOT.padEnd(16)} off: auto mode's safety checks go to Claude, and to no one else`,
    );
  }
  for (const [slot, family] of Object.entries(MODEL_SLOTS).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!Object.values(config.modelSlots ?? {}).includes(slot)) {
      print(`  ${slot.padEnd(16)} off: ${family} goes to Anthropic unchanged`);
    }
  }
  const aliases = Object.entries(config.aliases).sort(([a], [b]) => (a < b ? -1 : 1));
  if (aliases.length > 0) {
    print("\nAliases (an old name, and what it means now):");
    for (const [name, to] of aliases) print(`  ${name.padEnd(16)} → ${to}`);
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────────

async function commandModels(ctx: GatewayContext): Promise<number> {
  const config = loadConfigFile(ctx.paths.gatewayConfigFile);
  for (const [name, backend] of Object.entries(config.backends)) {
    ctx.print(`\n${name}  ${shownValue(backend.baseUrl)}  (key ${maskKey(backend.apiKey)})`);
    const listed = await listModels(backend.baseUrl, backend.apiKey);
    if ("error" in listed) ctx.print(`  unreachable: ${listed.error}`);
    else if (listed.status !== 200) ctx.print(`  /v1/models answered HTTP ${listed.status}`);
    else {
      for (const model of [...listed.models].sort((a, b) => a.id.localeCompare(b.id))) {
        const context =
          model.contextLength === null
            ? ""
            : `  ${model.contextLength.toLocaleString("en-US")} tokens`;
        ctx.print(`  ${name}:${model.id}${context}`);
      }
    }
  }
  printSlots(config, ctx.print);
  ctx.print(
    "\nAny claude-<id> target (e.g. claude-sonnet-5-5) goes to Anthropic on your own Claude login.",
  );
  return 0;
}

/**
 * The config with a judge test proof (`judgeTestProof`) for each target that passed, on
 * the backend URL it passed on: a target whose backend moved since then gets none.
 */
export function withJudgeProofs(
  config: GatewayConfig,
  passed: Readonly<Record<string, string>>,
): GatewayConfig {
  const proofs = Object.fromEntries(
    Object.entries(passed).map(([target, url]) => [target, judgeTestProof(target, url)]),
  );
  return Object.keys(proofs).length > 0 ? { ...config, judgeTested: proofs } : config;
}

/**
 * A slot turned off loses its fallback record in the router's state file at once, so the
 * status line stops showing it even before the router's next request (the router drops it
 * too, when it reads the changed config). A file that is not there, or not readable, stays.
 */
function dropFallbackRecord(statePath: string, slot: string): void {
  let state: ReturnType<typeof parseLimitState>;
  try {
    state = parseLimitState(readFileSync(statePath, "utf8"));
  } catch {
    // No state file: nothing to drop.
    return;
  }
  if (state === null || !Object.hasOwn(state.fallbacks, slot)) return;
  delete state.fallbacks[slot];
  atomicWrite(statePath, formatLimitState(state), 0o600);
}

async function commandSlot(ctx: GatewayContext, args: string[]): Promise<number> {
  const [slotArg, targets, ...extra] = args;
  if (slotArg === undefined || targets === undefined || extra.length > 0) {
    ctx.error(USAGE);
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
  /** Each judge target that passed the test, and the backend URL it passed on. */
  const passed: Record<string, string> = {};
  if (first.key === JUDGE_SLOT && first.next.length > 0) {
    // A judge is never set untested, and there is no way to skip the test.
    for (const text of first.next) {
      const parsed = parseTarget(text);
      if (!("target" in parsed) || parsed.target.kind !== "backend") continue;
      const backend = config.backends[parsed.target.backend];
      if (backend === undefined) continue;
      const result = await testJudgeTarget(backend.baseUrl, backend.apiKey, parsed.target.model);
      if (result.verdict !== "block") {
        throw new Error(
          `${text} did not block the test check (${JUDGE_TEST_ACTION}): ${result.detail}. The judge was not set.`,
        );
      }
      passed[text] = backend.baseUrl;
      ctx.print(`judge test: ${text} blocked "${JUDGE_TEST_ACTION}"`);
    }
  }
  // Read again and save inside the lock: another command may have changed the file since
  // (a key set by `gateway setup`, another slot), and its change must not be lost.
  const plan = await withLock(
    ctx.paths.stateDir,
    () => {
      const again = planSlotChange(loadConfigFile(configPath), slotArg, targets, modelsByBackend);
      if ("error" in again) throw new Error(again.error);
      saveConfig(
        configPath,
        again.key === JUDGE_SLOT ? withJudgeProofs(again.config, passed) : again.config,
      );
      if (again.next.length === 0) dropFallbackRecord(ctx.paths.gatewayStateFile, again.key);
      return again;
    },
    { waitMs: 10_000 },
  );
  const now =
    plan.next.length > 0
      ? plan.next.join(" → ")
      : plan.key === JUDGE_SLOT
        ? "off (auto mode's safety check on Claude, and on no one else)"
        : `off (${MODEL_SLOTS[plan.key] ?? plan.key} goes to Anthropic unchanged)`;
  ctx.print(`${plan.key}: ${plan.old.join(" → ") || "(new)"}\n  now: ${now}`);
  ctx.print("The router uses it from its next request.");
  return 0;
}

function printOverrides(
  report: ReturnType<typeof settingsReport>,
  print: (line: string) => void,
): void {
  if (report.subagentOverrides.length > 0) {
    print(
      `  WARN ${report.subagentOverrides.join(", ")} set: every agent launched without a model runs on it, with the gateway possibly an affordable slot. Remove it by hand unless you want that.`,
    );
  }
  if (report.loginOverrides.length > 0) {
    print(
      `  WARN ${report.loginOverrides.join(", ")} set: that replaces your own Claude login. Remove it for the gateway.`,
    );
  }
}

async function commandStatus(ctx: GatewayContext): Promise<number> {
  let config: GatewayConfig | null = null;
  try {
    config = loadConfigFile(ctx.paths.gatewayConfigFile);
  } catch (error) {
    ctx.print(`config: ${messageOf(error)}`);
  }
  // Without a good config the router runs on the default port.
  const port = config?.port ?? DEFAULT_PORT;
  const health = await routerHealth(port, ctx.probe.fetch);
  if ("error" in health) ctx.print(`router: DOWN on 127.0.0.1:${port} (${health.error})`);
  else {
    const body = isJsonObject(health.body) ? health.body : {};
    ctx.print(
      `router: up on 127.0.0.1:${String(body.port)} for ${String(body.uptimeSec)} s, ${String(body.requests)} requests, ${String(body.fallbacks)} fallbacks`,
    );
    if (body.port !== port)
      ctx.print(`  WARN the config says port ${port}; restart the router to move it`);
    const cooling = isJsonObject(body.cooling) ? Object.entries(body.cooling) : [];
    for (const [target, seconds] of cooling)
      ctx.print(`  resting: ${target} for ${String(seconds)} s more`);
    const limited = isJsonObject(body.limited) ? Object.entries(body.limited) : [];
    for (const [model, seconds] of limited) {
      ctx.print(
        `  at its plan usage limit: ${model}; its model slot answers from a fallback, and asks it again in ${String(seconds)} s`,
      );
    }
  }
  if (config !== null) {
    for (const [name, backend] of Object.entries(config.backends)) {
      const listed = await listModels(backend.baseUrl, backend.apiKey);
      const state = "error" in listed ? `unreachable (${listed.error})` : `HTTP ${listed.status}`;
      ctx.print(
        `backend ${name}: ${shownValue(backend.baseUrl)} key ${maskKey(backend.apiKey)} → ${state}`,
      );
    }
    printSlots(config, ctx.print);
  }
  const report = settingsReport(ctx.paths.settingsFile);
  ctx.print(
    `\nClaude Code (${tildify(ctx.paths.settingsFile, ctx.paths.home)}): ${report.baseUrl === null ? "gateway OFF (no ANTHROPIC_BASE_URL)" : `gateway ON → ${report.baseUrl}`}`,
  );
  printOverrides(report, ctx.print);
  return 0;
}

/** Parses `setup`'s options; null on a wrong option. */
function setupOptions(args: string[]): {
  yes: boolean;
  keyBackend: null | string;
  noKey: boolean;
  omniroutePassword: boolean;
  omniroutePasswordStdin: boolean;
  saveUnchecked: boolean;
} | null {
  let yes = false;
  let keyBackend: null | string = null;
  let noKey = false;
  let omniroutePassword = false;
  let omniroutePasswordStdin = false;
  let saveUnchecked = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes") yes = true;
    else if (arg === "--no-backend-key") noKey = true;
    else if (arg === "--save-unchecked") saveUnchecked = true;
    else if (arg === "--omniroute-password") omniroutePassword = true;
    else if (arg === "--omniroute-password-stdin") omniroutePasswordStdin = true;
    else if (arg === "--backend-key-stdin") {
      const backend = args[index + 1];
      if (backend === undefined || backend.startsWith("--")) return null;
      keyBackend = backend;
      index += 1;
    } else return null;
  }
  if (noKey && (keyBackend !== null || omniroutePassword || omniroutePasswordStdin)) return null;
  if (keyBackend !== null && (omniroutePassword || omniroutePasswordStdin)) return null;
  if (omniroutePassword && omniroutePasswordStdin) return null;
  // `--save-unchecked` only says something about a key that is actually given.
  if (saveUnchecked && keyBackend === null && !omniroutePassword && !omniroutePasswordStdin) {
    return null;
  }
  return {
    keyBackend,
    noKey,
    omniroutePassword,
    omniroutePasswordStdin,
    saveUnchecked,
    yes,
  };
}

/**
 * The OmniRoute dashboard password: from stdin (`--omniroute-password-stdin`, the way the
 * installer hands it over), or asked on the terminal with no echo (`--omniroute-password`).
 * Empty means the person gave nothing: setup stops before it writes anything.
 */
async function omniroutePassword(ctx: GatewayContext, fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    const value = (await ctx.readStdin()).trim();
    if (value === "") throw new Error("no OmniRoute dashboard password on stdin");
    return value;
  }
  if (ctx.readSecret === undefined) {
    throw new Error(
      "this terminal cannot hide what you type, so the password would be shown on screen. Give it on stdin instead: " +
        `${COMMAND} gateway setup --omniroute-password-stdin < password-file`,
    );
  }
  const value = await ctx.readSecret();
  if (value === null) throw new Error("nothing was read (Ctrl+C)");
  if (value === "") throw new Error("no OmniRoute dashboard password was given");
  return value;
}

async function commandSetup(ctx: GatewayContext, args: string[]): Promise<number> {
  const options = setupOptions(args);
  if (options === null) {
    ctx.error(USAGE);
    return 2;
  }
  if (ctx.service === "none") {
    ctx.error(ctx.platform === "win32" ? NEEDS_POWERSHELL : NEEDS_SYSTEMD);
    return 1;
  }
  const { paths } = ctx;
  const service = routerService(ctx);
  const configPath = paths.gatewayConfigFile;
  let key: null | { backend: string; value: string } = null;
  let password: null | string = null;
  if (options.keyBackend !== null) {
    const value = (await ctx.readStdin()).trim();
    if (value === "") throw new Error("no key on stdin");
    key = { backend: options.keyBackend, value };
  }
  if (options.omniroutePassword || options.omniroutePasswordStdin) {
    password = await omniroutePassword(ctx, options.omniroutePasswordStdin);
  }
  const install = (overrides: Partial<InstallOptions>): InstallOptions => ({
    bunPath: ctx.bunPath,
    bunVersion: ctx.bunVersion,
    bundle: ctx.bundle,
    copyPath: paths.routerCopy,
    home: paths.home,
    stateDir: paths.stateDir,
    port: configuredPort(configPath),
    probe: ctx.probe,
    runner: ctx.runner,
    say: ctx.print,
    service,
    yes: options.yes,
    confirm: ctx.confirm,
    ...(ctx.account === null ? {} : { account: ctx.account }),
    ...overrides,
  });
  // Everything is checked, the port asked and the question answered, before the lock and
  // before any write. With a dashboard password the key does not exist yet (it is made below,
  // once the port is settled): the read-only pass allows a missing config, and the real write
  // creates it with the key that comes out of OmniRoute.
  ensureConfig(configPath, key, {
    allowNone: options.noKey || password !== null,
    dryRun: true,
  });
  // The port question comes before the backend is called at all: a port another program holds
  // refuses the setup, and no key is made or checked for nothing.
  if ((await installRouter(install({ dryRun: true }))) === "declined") return 1;

  // A key the person gave, or one setup makes in OmniRoute with the dashboard password. Either
  // way it is TESTED before it is saved: a wrong key must never replace a working one.
  if (password !== null) {
    const baseUrl = backendBaseUrl(configPath, "omniroute") ?? KNOWN_BACKENDS.omniroute ?? "";
    const made = await createOmnirouteKey({
      baseUrl,
      ...(ctx.apiFetch === undefined ? {} : { fetch: ctx.apiFetch }),
      password,
    });
    if (made.kind === "no-answer") {
      throw new Error(
        `OmniRoute does not answer at ${shownValue(baseUrl)} (${made.detail}). The gateway needs OmniRoute first: install and start it there, then run this again.`,
      );
    }
    if (made.kind === "refused") {
      throw new Error(
        [
          `${made.detail}. Nothing was saved, and the key in ${configPath} is kept as it was.`,
          `${wantedKeyWords("omniroute")}. If you already have that key, give it instead: ${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`,
        ].join("\n"),
      );
    }
    if (made.kind === "failed") {
      throw new Error(
        `${made.detail}. OmniRoute's dashboard password is the one you log in with; setup does not store it.`,
      );
    }
    key = { backend: "omniroute", value: made.key };
    ctx.print(`made the key "${made.name}" in OmniRoute (${maskKey(made.key)})`);
  }

  /** Why a key was saved without its backend accepting it, for the closing line. Empty: checked. */
  let unchecked = "";
  if (key !== null) {
    const baseUrl = backendBaseUrl(configPath, key.backend) ?? KNOWN_BACKENDS[key.backend];
    if (baseUrl !== undefined) {
      const check = await checkBackendKey(baseUrl, key.value, {
        ...(ctx.apiFetch === undefined ? {} : { fetch: ctx.apiFetch }),
      });
      if (check.kind === "refused") {
        throw new Error(
          keyRefusedMessage({
            backend: key.backend,
            baseUrl,
            configPath,
            detail: check.detail,
            status: check.status,
          }),
        );
      }
      if (check.kind === "unchecked") {
        if (!options.saveUnchecked) {
          throw new Error(
            keyUncheckedMessage({
              backend: key.backend,
              baseUrl,
              configPath,
              detail: check.detail,
            }),
          );
        }
        unchecked = check.detail;
      }
    }
  }

  return withLock(
    paths.stateDir,
    async () => {
      // How many backups the config already has, so the line below is said only when THIS run
      // made one — `ensureConfig` backs the file up only when the key really changes.
      const backups = backupDir(paths.stateDir, configPath);
      const backupsBefore = existsSync(backups) ? readdirSync(backups).length : 0;
      const said = ensureConfig(configPath, key, {
        allowNone: options.noKey,
        stateDir: paths.stateDir,
      });
      ctx.print(said.replaceAll(configPath, tildify(configPath, paths.home)));
      if (key !== null && existsSync(backups) && readdirSync(backups).length > backupsBefore) {
        ctx.print(
          `  the file as it was before the change is in ${tildify(backups, paths.home)}: copy it back to put the key that was there in place`,
        );
      }
      if (unchecked !== "") {
        ctx.print(
          `  WARN the key was saved WITHOUT its backend accepting it (${unchecked}). Check it when the backend answers: ${COMMAND} gateway check`,
        );
      }
      // The question was answered above: the warning is not repeated, and nothing asks again.
      await installRouter(
        install({
          yes: true,
          confirm: null,
          say: (line) => {
            if (!service.warnings.includes(line)) ctx.print(line);
          },
        }),
      );
      if (settingsReport(paths.settingsFile).baseUrl === null) {
        ctx.print(
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

/**
 * `gateway check`'s exit codes. One read-only question — does the gateway have an OmniRoute key
 * the backend accepts? — for the installer, which asks for a key only when the answer says the
 * gateway is not working (`install.sh`, `install.ps1`).
 *
 *   0  the key works (or the gateway is not set up and needs no key: a machine with no config
 *      and no OmniRoute is told that, and nothing is asked)
 *   1  there is no OmniRoute key yet, and an OmniRoute answers: one can be made (dashboard
 *      password) or given (an API key)
 *   3  it could not be judged: no OmniRoute answers, the config cannot be read, or the backend
 *      did not answer. Never a refusal, and the installer asks for nothing
 *   4  the key in the config is one OmniRoute refuses (HTTP 401 or 403): a new key is the fix
 */
export const CHECK_CODES = { needsKey: 1, refused: 4, unchecked: 3, works: 0 } as const;

/**
 * The question, answered in one line and an exit code. It asks the backend only — never the
 * router's port: this runs where a person's sessions may be using the router, and in a test
 * where the default port may belong to a real one.
 */
async function commandCheck(ctx: GatewayContext): Promise<number> {
  const { paths } = ctx;
  const configPath = paths.gatewayConfigFile;
  /** No key anywhere: OmniRoute's own address decides whether one can be made. */
  const noKeyYet = async (why: string): Promise<number> => {
    const address = KNOWN_BACKENDS.omniroute ?? "";
    const probe = await probeOmniroute(address, {
      ...(ctx.apiFetch === undefined ? {} : { fetch: ctx.apiFetch }),
    });
    if (probe.kind === "silent") {
      ctx.print(
        `· ${why}, and OmniRoute does not answer at ${address} (${probe.detail}): the gateway needs OmniRoute first`,
      );
      return CHECK_CODES.unchecked;
    }
    ctx.print(
      `✗ ${why}, and OmniRoute answers at ${address}: ${COMMAND} gateway setup can make the router's key with OmniRoute's dashboard password`,
    );
    return CHECK_CODES.needsKey;
  };

  if (!existsSync(configPath))
    return noKeyYet(`the gateway has no config yet (no ${tildify(configPath, paths.home)})`);
  let config: GatewayConfig;
  try {
    config = loadConfigFile(configPath);
  } catch (error) {
    ctx.print(`· the gateway could not be checked: ${messageOf(error)}`);
    return CHECK_CODES.unchecked;
  }
  const backend = Object.hasOwn(config.backends, "omniroute")
    ? config.backends.omniroute
    : undefined;
  if (backend === undefined) {
    return noKeyYet(
      `the gateway has no OmniRoute key yet (${tildify(configPath, paths.home)} names no omniroute backend)`,
    );
  }
  const check = await checkBackendKey(backend.baseUrl, backend.apiKey, {
    ...(ctx.apiFetch === undefined ? {} : { fetch: ctx.apiFetch }),
  });
  if (check.kind === "accepted") {
    ctx.print(
      `✓ the gateway's OmniRoute key is accepted (${shownValue(backend.baseUrl)}, HTTP ${String(check.status)})`,
    );
    return CHECK_CODES.works;
  }
  if (check.kind === "refused") {
    // The backend answered, so it is there: the key in the file is what needs replacing.
    ctx.print(
      `✗ OmniRoute refused the key in ${tildify(configPath, paths.home)} (HTTP ${String(check.status)}): it is not an OmniRoute API key. Give a new one: ${COMMAND} gateway setup --backend-key-stdin omniroute < key-file (or let setup make one with OmniRoute's dashboard password)`,
    );
    return CHECK_CODES.refused;
  }
  ctx.print(`· the gateway could not be checked: ${check.detail}`);
  return CHECK_CODES.unchecked;
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
    ctx.print("Nothing to change: the gateway is already on.");
  } else {
    ctx.print(changeLines(result, paths.home).join("\n"));
    ctx.print(
      `Done. The changed file has a backup in ${tildify(paths.stateDir, paths.home)}/backups/.`,
    );
    ctx.print(
      "Every Claude Code session on this machine, in every folder, uses the gateway from now on: its haiku / sonnet work (background titles and summaries too) goes to the affordable slots.",
    );
  }
  printOverrides(settingsReport(paths.settingsFile), ctx.print);
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
    ctx.print(
      `Nothing to remove: ${COMMAND} set no gateway key in ${tildify(paths.settingsFile, paths.home)}.`,
    );
  } else {
    ctx.print(changeLines(result, paths.home).join("\n"));
    ctx.print("Restart each Claude session: removing a setting needs a restart.");
  }
  for (const key of foreign) {
    ctx.print(
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
      ctx.error(USAGE);
      return Promise.resolve(2);
    }
    return run();
  };
  switch (command) {
    case "check":
      return noArgs(() => commandCheck(ctx));
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
        await startRouter(ctx.paths);
        return 0;
      });
    case undefined:
    case "help":
    case "--help":
    case "-h":
      ctx.print(USAGE);
      return 0;
    default:
      ctx.error(`Unknown gateway command: ${command}\n\n${USAGE}`);
      return 2;
  }
}
