/**
 * `cc-smart-dev-kit gateway <command>`: serve the router, see it, switch its slots, install it,
 * and turn it on or off for Claude Code.
 *
 *   serve     runs the router in this terminal (the systemd unit runs the copy instead).
 *   models    every model each backend offers, then the slot table.
 *   slot      checks each target and saves; the router uses it from its next request.
 *   fallback  turns a slot's fallback switch on or off: may its next target answer?
 *   status    router health, each backend, the slots, and what settings.json says.
 *   setup     makes the config if there is none (the key comes on stdin, never argv),
 *             puts the router copy and the systemd user unit in place, and starts it, or
 *             restarts it (after a yes) when one changed. For a machine an older version
 *             set up, it also drops 0.4.x's hidden Claude step from a default chain and
 *             takes out 0.4.3's model keys from Claude Code's settings (only its own).
 *   on / off  sets or removes the gateway env keys in Claude Code's settings.
 *
 * API keys are masked in every output. The design: docs/gateway.md.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { createOut, type Out } from "../cli/ui/out";
import { currentTerminal } from "../cli/ui/terminal";
import { withLock } from "../setup/lock";
import { formatKeyPath, type ManagedJsonResult } from "../setup/managed-json";
import { atomicWrite, backupDir, backupFile } from "../setup/write";
import { checkBackendKey, listModels } from "./backends";
import { breakerStatusLines } from "./breaker";
import {
  breakerOn,
  breakerWords,
  ConfigError,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_FIRST_BYTE_MS,
  DEFAULT_PORT,
  fallbackOn,
  type GatewayConfig,
  historyRetentionDays,
  JUDGE_NEVER_HOLDS,
  judgeTargetTested,
  judgeTargetUsable,
  judgeTestProof,
  type KeptChain,
  keptChain,
  loadConfigFile,
  messageOf,
  parseConfig,
  saveConfig,
  workerJudgeTargets,
} from "./config";
import { type HealthFetch, type HealthProbe, routerHealth } from "./health";
import { HISTORY_RETENTION_DAYS, historyDbBytes, historyDbExists } from "./history";
import {
  bucketWords,
  DEFAULT_HISTORY_BY,
  DEFAULT_HISTORY_RANGE,
  HISTORY_BY,
  HISTORY_RANGES,
  type HistoryBy,
  type HistoryFilters,
  type HistoryRange,
  historySeries,
  historyWords,
} from "./history-read";
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
import {
  maskKey,
  retireOldModelKeys,
  settingsReport,
  shownValue,
  turnOff,
  turnOn,
} from "./settings";
import {
  FAMILY_SLOTS,
  formatTarget,
  isModelSlot,
  JUDGE_SLOT,
  parseTarget,
  SLOT_PREFIX,
  slotKeyFromArg,
  type Target,
  WORKER_SLOT,
} from "./targets";

export const USAGE = `Usage: ${COMMAND} gateway <command>

Commands:
  check                  One read-only question: does the gateway have an OmniRoute key the
                         backend accepts? 0 yes, 1 no key yet (OmniRoute answers, so one can
                         be made), 3 the backend could not be judged, 4 the key is refused.
  status                 Router health, backends, slots, and the Claude Code settings.
  history [range]        The request history: one row per routed request (never a prompt, a
                         tool or an answer). Range: ${HISTORY_RANGES.join(", ")}
                         (default ${DEFAULT_HISTORY_RANGE}). Requests, errors, tokens and the
                         estimated cost per target (the default), slot, model or session.
                         Filters: --slot <name>, --target <target>, --model <model>,
                         --session <id>, --errors. --by ${HISTORY_BY.join("|")} picks the grouping.
  models                 Every model each backend offers, and the slots.
  slot <slot> <targets>  Custom: set a slot's chain and use it. Any targets, in order, each
                         <backend>:<model> (see "models") or claude-<model>. <slot>: scout
                         (Haiku's work), worker (Sonnet's), opus, fable, or judge. The
                         first target answers; the next only while the slot's fallback is on.
                         A worker target is also given the judge test (see below); it is set
                         either way.
  slot judge <targets>   Your own judge for auto mode's safety checks, in the order you
                         give: a claude-<model> target as it is, any other target only after
                         it blocks a test check (a force push to main). Without it, Claude
                         judges every check first, and while Claude is limited or down the
                         worker targets that passed the same test judge in its place. A
                         weaker judge can block good work or let a risky command through,
                         and it reads the conversation.
  slot <slot> claude     Claude: that model is plain Claude again (the judge: Claude first,
                         and the worker's tested targets while Claude is limited). The chain
                         is saved, not in use. "off" says the same.
  slot <slot> custom     Use the saved chain again, with its fallback switch. A judge target
                         without a current test proof is tested first.
  slot <slot> clear      Delete the slot's chain, in use or saved.
  fallback <slot> on|off May the next target answer when the one before it fails or
                         rests? Off: only the first answers, and the rest stay saved.
                         On by default for scout, worker and judge; off for opus, fable.
                         "fallback judge off": Claude alone judges.
  breaker <slot> on|off  When every target of a slot is limited or down, may the router hold
                         the request for a while and then ask Claude Code to retry? Off: the
                         last answer goes back at once. On by default for scout, worker,
                         opus and fable. The judge never holds, so it has no switch.
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
   * Shows the question, then reads a secret on the terminal with no echo; left out when stdin is
   * not a terminal that can hide it. The prompts' `secret` in use (`src/cli/ui/prompt.ts`), so
   * nothing typed or pasted is shown on screen. Null: Ctrl+C.
   */
  readSecret?: (question: string) => Promise<null | string>;
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
 * The config a new machine gets: the OmniRoute backend and its key, and NO slot. Every slot
 * is off, so every Claude model stays plain Claude until the person gives a slot a chain
 * from the live model list (`gateway models`, then `gateway slot <slot> <targets>`, or the
 * portal's Slots page). No model is chosen for anyone here, and none is added behind a chain.
 * No aliases: a project's own migration writes those, and `migrate` writes the ones a
 * machine moving from 0.2.x's slot names needs.
 */
export function defaultConfig(omnirouteKey: string): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: { omniroute: { apiKey: omnirouteKey, baseUrl: "http://127.0.0.1:20128" } },
    port: DEFAULT_PORT,
    slots: {},
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
 * `emptyConfig()` (every slot off, so every model plain Claude) until the key creates the
 * default config.
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
      return `no config at ${configPath} yet: every slot is off, so every Claude model goes to Anthropic as Claude Code sent it, on your own login, until the OmniRoute key is added (setup --backend-key-stdin omniroute)`;
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
 * file (the router then runs `emptyConfig()`, every slot off, on that port). A file
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

/** The config with `modelSlots` (0.4.x only) left without any entry for `slot`. */
function withoutModelSlot(config: GatewayConfig, slot: string): GatewayConfig {
  const { modelSlots, ...rest } = config;
  const kept = Object.entries(modelSlots ?? {}).filter(([, named]) => named !== slot);
  return kept.length > 0 ? { ...rest, modelSlots: Object.fromEntries(kept) } : rest;
}

/**
 * The per-slot switches a person sets, each a `{"<slot>": true | false}` record in the config
 * (`fallback`, `breaker`). A switch with no entry for a slot means the slot's default.
 */
const SWITCH_FIELDS = ["breaker", "fallback"] as const;
type SwitchField = (typeof SWITCH_FIELDS)[number];

/**
 * The config with `slot`'s `field` switch set (`value`), or left to its default (null). The
 * field itself goes when no slot has an entry left.
 */
function withSwitch(
  config: GatewayConfig,
  field: SwitchField,
  slot: string,
  value: boolean | null,
): GatewayConfig {
  const kept = Object.entries(config[field] ?? {}).filter(([named]) => named !== slot);
  if (value !== null) kept.push([slot, value]);
  const next = { ...config };
  if (kept.length > 0) next[field] = Object.fromEntries(kept);
  else delete next[field];
  return next;
}

/** The config with every switch of `slot` back at its default: a slot with no chain has none. */
function withoutSwitches(config: GatewayConfig, slot: string): GatewayConfig {
  return SWITCH_FIELDS.reduce((next, field) => withSwitch(next, field, slot, null), config);
}

/**
 * The config checked after `slot`'s `field` switch is set to `now`. A value equal to what the
 * slot's default already means (`isOn`) is written as no entry, so a config stays free of
 * entries that say nothing.
 */
function setSwitch(
  current: GatewayConfig,
  field: SwitchField,
  isOn: (config: GatewayConfig, slot: string) => boolean,
  slot: string,
  now: boolean,
): { config: GatewayConfig } | { error: string } {
  const unset = withSwitch(current, field, slot, null);
  return parseConfig(isOn(unset, slot) === now ? unset : withSwitch(unset, field, slot, now));
}

/** The config with `slot`'s saved chain set (`value`), or with none (null); no empty field. */
function withKept(config: GatewayConfig, slot: string, value: KeptChain | null): GatewayConfig {
  const { kept, ...rest } = config;
  const entries = Object.entries(kept ?? {}).filter(([named]) => named !== slot);
  if (value !== null) entries.push([slot, value]);
  return entries.length > 0 ? { ...rest, kept: Object.fromEntries(entries) } : rest;
}

/** The config without `slot` in `slots`: nothing in use there, so it answers as Claude. */
function withoutSlot(config: GatewayConfig, slot: string): GatewayConfig {
  return {
    ...config,
    slots: Object.fromEntries(Object.entries(config.slots).filter(([name]) => name !== slot)),
  };
}

/** The fallback switch the person set for `slot`; undefined when it is at its default. */
function setFallback(config: GatewayConfig, slot: string): boolean | undefined {
  const set = config.fallback;
  return set !== undefined && Object.hasOwn(set, slot) ? set[slot] : undefined;
}

/**
 * The chain 0.4.x's `defaultConfig` wrote for the scout and the worker, exactly, in every
 * version that had one (read from the git history; 0.2.x's had the same targets under its old
 * slot names, which `migrate` renamed). Its last target is a Claude model the person never
 * chose: a hidden Claude step. Only ever compared, never written.
 */
const RETIRED_DEFAULT_CHAIN: readonly string[] = [
  "omniroute:ollama-cloud/deepseek-v4.1-flash",
  "omniroute:ollama-cloud/glm-5.3-flash",
  "claude-sonnet-5-5",
];

/** The slots that 0.4.x gave `RETIRED_DEFAULT_CHAIN`. */
const RETIRED_DEFAULT_SLOTS: readonly string[] = [
  "cc-smart-dev-kit-scout",
  "cc-smart-dev-kit-worker",
];

/**
 * The config without 0.4.x's hidden Claude step: a scout or worker chain that still equals
 * `RETIRED_DEFAULT_CHAIN` loses its last target. A chain the person changed in any way is
 * theirs, a Claude target included, and stays. `dropped` names each slot that changed.
 */
export function withoutRetiredDefaultClaude(config: GatewayConfig): {
  config: GatewayConfig;
  dropped: string[];
} {
  const dropped = RETIRED_DEFAULT_SLOTS.filter((slot) => {
    const chain = Object.hasOwn(config.slots, slot) ? config.slots[slot] : undefined;
    return (
      chain !== undefined &&
      chain.length === RETIRED_DEFAULT_CHAIN.length &&
      chain.every((target, index) => target === RETIRED_DEFAULT_CHAIN[index])
    );
  });
  if (dropped.length === 0) return { config, dropped };
  const slots = { ...config.slots };
  for (const slot of dropped) slots[slot] = RETIRED_DEFAULT_CHAIN.slice(0, -1);
  return { config: { ...config, slots }, dropped };
}

/**
 * What the portal of 0.5.x and before remembered in its own file (`portal.json`): the opus
 * and fable chains (`fallback`, by slot key; a version stored them by family name), the judge
 * chain, and the fallback switch each had. Read only by `gateway setup`, once per machine, to
 * move those chains into the config (`withPortalChains`); the portal keeps no slot state now.
 * The file stays on disk one release, so a rollback to 0.5.x still finds it.
 */
const portalMemorySchema = z.looseObject({
  fallback: z.record(z.string(), z.array(z.string())).optional(),
  judge: z.array(z.string()).optional(),
  switches: z.record(z.string(), z.boolean()).optional(),
  version: z.literal(1),
});

/**
 * The chains a 0.5.x `portal.json` remembered, by slot key, each with the fallback switch it
 * had when that differs from the slot's default. A chain is left out when it is empty or a
 * target does not parse. A file that is not one the portal wrote reads as none: nothing to
 * move.
 */
export function portalChains(text: string): Record<string, KeptChain> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not JSON: not a file the portal wrote, so there is nothing in it to move.
    return {};
  }
  const parsed = portalMemorySchema.safeParse(raw);
  if (!parsed.success) return {};
  const memory = parsed.data;
  const found: Record<string, string[]> = {};
  for (const [name, targets] of Object.entries(memory.fallback ?? {})) {
    const key = slotKeyFromArg(name);
    if (key !== null && isModelSlot(key)) found[key] = targets;
  }
  if (memory.judge !== undefined) found[JUDGE_SLOT] = memory.judge;
  const chains: Record<string, KeptChain> = {};
  for (const [key, targets] of Object.entries(found)) {
    // A `claude-…` target is fine anywhere now, the judge included (D44: a judge chain may
    // hold one, used as it is). Only a target that does not parse is left out.
    const usable =
      targets.length > 0 &&
      targets.every((text) => {
        const target = parseTarget(text);
        return "target" in target;
      });
    if (!usable) continue;
    const switches = memory.switches ?? {};
    const on = Object.hasOwn(switches, key) ? switches[key] : undefined;
    chains[key] = {
      targets: [...targets],
      ...(on === undefined || on === fallbackOn({}, key) ? {} : { fallback: on }),
    };
  }
  return chains;
}

/**
 * The config with each chain the portal remembered saved as `kept`, for a slot that has no
 * chain in `slots` and none in `kept`: the config wins on a clash. `moved` names each slot it
 * filled; a second run moves nothing.
 */
export function withPortalChains(
  config: GatewayConfig,
  remembered: Readonly<Record<string, KeptChain>>,
): { config: GatewayConfig; moved: string[] } {
  let next = config;
  const moved: string[] = [];
  for (const [key, chain] of Object.entries(remembered).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (Object.hasOwn(next.slots, key) || keptChain(next, key) !== null) continue;
    next = withKept(next, key, chain);
    moved.push(key);
  }
  return { config: next, moved };
}

/** The text of the portal's old memory file, or null when there is none to read. */
function portalMemoryText(path: string | undefined): null | string {
  if (path === undefined || !existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** The fields of the portal's old memory that held slot state: its one home before B0. */
const PORTAL_SLOT_FIELDS = ["fallback", "judge", "switches"] as const;

/**
 * The portal's old memory with its slot parts gone: `{"version": 1}`, and any field this
 * version does not know (kept, as everywhere). Null when the text is not a JSON object, or
 * already holds no slot part. After the migration no file holds a chain but `gateway.json`
 * (`slots` in use, `kept` saved), which is the bug this fixes at its root: two homes that
 * disagreed, and a slot change that sometimes did not save.
 */
export function withoutPortalSlots(text: string): null | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (!PORTAL_SLOT_FIELDS.some((field) => Object.hasOwn(body, field))) return null;
  const rest = Object.fromEntries(
    Object.entries(body).filter(
      ([key]) => !(PORTAL_SLOT_FIELDS as readonly string[]).includes(key),
    ),
  );
  return `${JSON.stringify(rest, null, 2)}\n`;
}

/**
 * `gateway setup`'s step for a config an older version wrote, saved only when something
 * changed, one line per slot it changed (none when nothing did):
 *   - 0.4.x's hidden Claude step goes (`withoutRetiredDefaultClaude`);
 *   - each chain 0.5.x's portal remembered in its own file (`portalStateFile`) is saved in
 *     the config as a chain not in use (`withPortalChains`), so `gateway slot <slot> custom`
 *     and the portal find it in the one place every command reads;
 *   - the portal's old file then loses its slot parts (`withoutPortalSlots`), so no chain has
 *     a second home to disagree with. The file itself stays one release, for a rollback.
 * With `stateDir`, a file this step changes is backed up first (`backupFile`).
 */
export function upgradeConfig(
  configPath: string,
  options: { dryRun?: boolean; portalStateFile?: string; stateDir?: string } = {},
): string[] {
  if (!existsSync(configPath)) return [];
  const { config: trimmed, dropped } = withoutRetiredDefaultClaude(loadConfigFile(configPath));
  const memory = portalMemoryText(options.portalStateFile);
  const { config, moved } = withPortalChains(trimmed, memory === null ? {} : portalChains(memory));
  const stripped = memory === null ? null : withoutPortalSlots(memory);
  if (options.dryRun !== true) {
    if (dropped.length + moved.length > 0) {
      if (options.stateDir !== undefined) backupFile(options.stateDir, configPath);
      saveConfig(configPath, config);
    }
    if (stripped !== null && options.portalStateFile !== undefined) {
      // Backed up too: a rollback can put the old file back by hand.
      if (options.stateDir !== undefined) {
        backupFile(options.stateDir, options.portalStateFile);
      }
      atomicWrite(options.portalStateFile, stripped, 0o600);
    }
  }
  return [
    ...dropped.map(
      (slot) =>
        `~ ${slot}: took out ${RETIRED_DEFAULT_CHAIN.at(-1)}, the Claude model 0.4.x put at the end of its default chain; no Claude model answers there unless you put one in (${COMMAND} gateway slot ${slotName(slot)} <targets>)`,
    ),
    ...moved.map(
      (slot) =>
        `~ ${slot}: the chain the portal remembered (${keptChain(config, slot)?.targets.join(" → ")}) is saved in the gateway config, not in use; to use it: ${COMMAND} gateway slot ${slotName(slot)} custom`,
    ),
  ];
}

/**
 * The words `gateway slot <slot> …` takes in place of a chain. None of them can be a target:
 * a target is `claude-<id>` or `<backend>:<model>`.
 */
export const SLOT_WORDS: Readonly<Record<"claude" | "clear" | "custom", readonly string[]>> = {
  /** No chain in use: the chain moves to `kept`. `off` is the word of 0.5.x and before. */
  claude: ["claude", "off"],
  /** Delete the chain, in use or saved. */
  clear: ["clear"],
  /** The saved chain in use again. */
  custom: ["custom"],
};

/** One slot change, planned: what it is, the config after it, and the chains before and after. */
export interface SlotPlan {
  /** `chain`: a new chain in use; `claude`, `custom`, `clear`: the words of `SLOT_WORDS`. */
  kind: "chain" | "claude" | "clear" | "custom";
  config: GatewayConfig;
  key: string;
  /** The chain in use before. */
  old: string[];
  /** The chain in use after; none when the slot answers as Claude. */
  next: string[];
}

/** Why a slot name cannot be used, in the words every slot command says it. */
function notSlotName(slotArg: string): string {
  return `"${slotArg}" is not a slot name (scout, worker, opus, fable, judge, or cc-smart-dev-kit-<name>)`;
}

/**
 * Why a chain cannot be used, or null when it can: each target parses, its backend exists,
 * and its model is in that backend's list. `claude-…` targets are taken as they are:
 * Anthropic's list is not reachable without the person's login. The portal's `slot.check`
 * asks it too, so a target typed on the Slots page is judged exactly as `gateway slot` would.
 */
export function chainProblem(
  config: GatewayConfig,
  targets: readonly string[],
  modelsByBackend: Readonly<Record<string, null | string[]>>,
): null | string {
  for (const text of targets) {
    const parsed = parseTarget(text);
    if ("error" in parsed) return parsed.error;
    const target: Target = parsed.target;
    if (target.kind === "anthropic") continue;
    if (!Object.hasOwn(config.backends, target.backend)) {
      return `"${text}": backend "${target.backend}" is not in the config`;
    }
    const models = Object.hasOwn(modelsByBackend, target.backend)
      ? modelsByBackend[target.backend]
      : undefined;
    if (models === undefined || models === null) {
      return `"${text}": could not list the models of "${target.backend}", so it cannot be checked`;
    }
    if (!models.includes(target.model)) {
      return `"${text}": "${target.backend}" has no model "${target.model}" (see ${COMMAND} gateway models)`;
    }
  }
  return null;
}

/** The planned config, checked as a whole (an alias that still points at the slot, say). */
function checkedPlan(
  plan: Omit<SlotPlan, "config">,
  config: GatewayConfig,
): SlotPlan | { error: string } {
  const checked = parseConfig(config);
  return "error" in checked ? { error: checked.error } : { ...plan, config: checked.config };
}

/**
 * The chain a slot change uses, for the checks before it: the targets given, or for `custom`,
 * the chain saved for the slot. None for the other words.
 */
export function chainToCheck(config: GatewayConfig, slotArg: string, text: string): string[] {
  const word = text.trim();
  if (SLOT_WORDS.custom.includes(word)) {
    const key = slotKeyFromArg(slotArg);
    return key === null ? [] : (keptChain(config, key)?.targets ?? []);
  }
  if (SLOT_WORDS.claude.includes(word) || SLOT_WORDS.clear.includes(word)) {
    return [];
  }
  return word
    .split(",")
    .map((target) => target.trim())
    .filter((target) => target !== "");
}

/**
 * The config with one slot changed. Every slot works the same way, with two modes
 * (`slotMode`): Custom, its chain in `slots`, in use; Claude, no chain in use (that model is
 * plain Claude; for the judge, Claude first, and the worker's tested targets while Claude is
 * limited or down). A switch to Claude never forgets the chain.
 *
 *   - `<targets>`: a new chain in use, after `chainProblem`'s checks. It replaces a saved one;
 *     the fallback switch saved with that one stays the slot's.
 *   - `claude` (or `off`): the chain moves to `kept`, with the fallback switch the person set.
 *     The judge's fallback switch stays where it is: with no judge chain it still says whether
 *     the worker's tested targets stand in while Claude is limited or down (D44). The breaker
 *     switch goes, as it did when a slot was turned off (the config refuses one for a slot with
 *     no chain).
 *   - `custom`: the saved chain moves back, with its switch, after the same checks a new chain
 *     gets; refused, with the reason, when nothing is saved.
 *   - `clear`: the chain is deleted, in use or saved, and its switch with it (the judge's
 *     fallback stays: it is not part of the chain).
 *
 * The judge takes no `claude-…` target (the config refuses it): a check's body is built for
 * the model it names, and Claude Sonnet 5.5 refused the older form's `thinking: disabled` with
 * a 400. The judge test proofs (`judgeTested`) are not touched here: new targets get theirs
 * only from the test, in `commandSlot` (`withJudgeProofs`), and a proof for a target no judge
 * or worker chain holds any more goes there too. `claude` and `custom` keep them: a saved
 * judge chain is used again only with a matching proof, which `commandSlot` makes by testing
 * each target that has none.
 *
 * A 0.4.x `modelSlots` entry for the slot goes on every change (it changes nothing any more,
 * and the config refuses one for a slot not in `slots`).
 */
export function planSlotChange(
  current: GatewayConfig,
  slotArg: string,
  targetsText: string,
  modelsByBackend: Record<string, null | string[]>,
): SlotPlan | { error: string } {
  const key = slotKeyFromArg(slotArg);
  if (key === null) return { error: notSlotName(slotArg) };
  const word = targetsText.trim();
  const old = current.slots[key] ?? [];
  const kept = keptChain(current, key);
  const name = slotName(key);
  const base = withoutModelSlot(current, key);

  if (SLOT_WORDS.claude.includes(word)) {
    if (old.length === 0) {
      return {
        error:
          kept === null
            ? `${key} is already Claude`
            : `${key} is already Claude; its chain is saved, not in use: ${kept.targets.join(" → ")} (to use it: ${COMMAND} gateway slot ${name} custom)`,
      };
    }
    // The judge's fallback switch stays: with no judge chain it still says whether the
    // worker's tested targets stand in while Claude is limited or down (D44). Every other
    // slot's switch travels with the chain, into `kept`.
    if (key === JUDGE_SLOT) {
      return checkedPlan(
        { key, kind: "claude", next: [], old },
        withKept(withoutSlot(base, key), key, { targets: old }),
      );
    }
    const fallback = setFallback(current, key);
    const saved: KeptChain = { targets: old, ...(fallback === undefined ? {} : { fallback }) };
    return checkedPlan(
      { key, kind: "claude", next: [], old },
      withKept(withoutSwitches(withoutSlot(base, key), key), key, saved),
    );
  }

  if (SLOT_WORDS.custom.includes(word)) {
    if (old.length > 0) return { error: `${key} is already Custom: ${old.join(" → ")}` };
    if (kept === null) {
      return {
        error: `${key} has no saved chain, so it stays Claude. Give it one: ${COMMAND} gateway slot ${name} <targets>`,
      };
    }
    const problem = chainProblem(current, kept.targets, modelsByBackend);
    if (problem !== null) {
      return { error: `${key}'s saved chain cannot be used: ${problem}` };
    }
    const back = withKept(
      { ...base, slots: { ...base.slots, [key]: [...kept.targets] } },
      key,
      null,
    );
    return checkedPlan(
      { key, kind: "custom", next: [...kept.targets], old },
      key === JUDGE_SLOT || kept.fallback === undefined
        ? back
        : withSwitch(back, "fallback", key, kept.fallback),
    );
  }

  if (SLOT_WORDS.clear.includes(word)) {
    if (old.length === 0 && kept === null) return { error: `${key} has no chain to clear` };
    // The judge's fallback switch is not part of its chain: it still says whether the
    // worker's tested targets stand in (D44). Every other slot's switches go with the chain.
    // A proof for a target no chain holds any more goes in `commandSlot` (`withJudgeProofs`).
    const cleared = withKept(
      key === JUDGE_SLOT ? withoutSlot(base, key) : withoutSwitches(withoutSlot(base, key), key),
      key,
      null,
    );
    return checkedPlan({ key, kind: "clear", next: [], old }, cleared);
  }

  const next = chainToCheck(current, slotArg, word);
  if (next.length === 0) return { error: "give at least one target" };
  const problem = chainProblem(current, next, modelsByBackend);
  if (problem !== null) return { error: problem };
  const replaced = withKept(base, key, null);
  // The switch saved with the chain this one replaces is the slot's own, set by the person.
  const withSavedSwitch =
    kept?.fallback !== undefined && setFallback(replaced, key) === undefined
      ? withSwitch(replaced, "fallback", key, kept.fallback)
      : replaced;
  return checkedPlan(
    { key, kind: "chain", next, old },
    { ...withSavedSwitch, slots: { ...withSavedSwitch.slots, [key]: next } },
  );
}

/**
 * The config with one slot's fallback switch set: on, its next target answers when the one
 * before it fails or rests; off, only its first. A slot that answers as Claude with a chain
 * saved (`kept`) keeps the switch with that chain, for when it is used again. A slot with no
 * chain at all has none to set, except the judge: with no chain of the person's own, its
 * switch says whether the worker's tested targets stand in while Claude is limited or down,
 * and off keeps Claude alone (D44). A value equal to the slot's default is written as no
 * entry (`fallbackOn`).
 */
export function planFallbackChange(
  current: GatewayConfig,
  slotArg: string,
  value: string,
): { config: GatewayConfig; key: string; now: boolean; was: boolean } | { error: string } {
  const key = slotKeyFromArg(slotArg);
  if (key === null) return { error: notSlotName(slotArg) };
  if (value !== "on" && value !== "off") return { error: `say on or off, not "${value}"` };
  const now = value === "on";
  if (key !== JUDGE_SLOT && !Object.hasOwn(current.slots, key)) {
    const kept = keptChain(current, key);
    if (kept === null) {
      return {
        error: `${key} has no chain, so it has nothing to fall back to. Give it one first: ${COMMAND} gateway slot ${slotName(key)} <targets>`,
      };
    }
    const { fallback: _was, ...targets } = kept;
    const checked = parseConfig(
      withKept(current, key, now === fallbackOn({}, key) ? targets : { ...targets, fallback: now }),
    );
    if ("error" in checked) return { error: checked.error };
    return { config: checked.config, key, now, was: kept.fallback ?? fallbackOn({}, key) };
  }
  const was = fallbackOn(current, key);
  const checked = setSwitch(current, "fallback", fallbackOn, key, now);
  if ("error" in checked) return { error: checked.error };
  return { config: checked.config, key, now, was };
}

/**
 * The config with one slot's breaker switch set: on, the router may hold a request while
 * every target the slot uses is limited or down, then ask Claude Code to retry; off, the
 * last answer goes back at once. The judge has no switch (`JUDGE_NEVER_HOLDS`), and a slot
 * with no chain has no request to hold. A value equal to the default (on) is written as no
 * entry (`breakerOn`).
 */
export function planBreakerChange(
  current: GatewayConfig,
  slotArg: string,
  value: string,
): { config: GatewayConfig; key: string; now: boolean; was: boolean } | { error: string } {
  const key = slotKeyFromArg(slotArg);
  if (key === null) {
    return {
      error: `"${slotArg}" is not a slot name (scout, worker, opus, fable, or cc-smart-dev-kit-<name>)`,
    };
  }
  if (key === JUDGE_SLOT) return { error: `${key}: ${JUDGE_NEVER_HOLDS}` };
  if (value !== "on" && value !== "off") return { error: `say on or off, not "${value}"` };
  if (!Object.hasOwn(current.slots, key)) {
    return {
      error: `${key} has no chain, so there is no request for the breaker to hold. Give it one first: ${COMMAND} gateway slot ${slotName(key)} <targets>`,
    };
  }
  const now = value === "on";
  const was = breakerOn(current, key);
  const checked = setSwitch(current, "breaker", breakerOn, key, now);
  if ("error" in checked) return { error: checked.error };
  return { config: checked.config, key, now, was };
}

/** A slot key's short name, as a person types it: `cc-smart-dev-kit-scout` → `scout`. */
function slotName(key: string): string {
  return key.startsWith(SLOT_PREFIX) ? key.slice(SLOT_PREFIX.length) : key;
}

/** What a slot with no chain in use means, in words. */
function claudeWords(config: GatewayConfig, key: string): string {
  if (key === JUDGE_SLOT) return `Claude: ${judgeDefaultWords(config)}`;
  const family = Object.hasOwn(FAMILY_SLOTS, key) ? FAMILY_SLOTS[key] : undefined;
  return family === undefined
    ? "Claude: no chain in use"
    : `Claude: ${family} goes to Anthropic as Claude Code sent it, on your own login`;
}

/** A chain saved, not in use, in words, with the command that uses it again. */
function keptWords(key: string, kept: KeptChain): string {
  const fallback = kept.fallback ?? fallbackOn({}, key);
  return `saved, not in use: ${kept.targets.join(" → ")}  (fallback ${fallback ? "on" : "off"}; to use it: ${COMMAND} gateway slot ${slotName(key)} custom)`;
}

/** The trade-off of a judge other than Claude, said wherever one is set or shown. */
export const JUDGE_WARNING =
  "a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action";

/** The worker chain's backend targets that have not passed the judge test, in its order. */
function untestedWorkerTargets(config: GatewayConfig): string[] {
  return (config.slots[WORKER_SLOT] ?? []).filter((text) => {
    const parsed = parseTarget(text);
    return (
      "target" in parsed && parsed.target.kind === "backend" && !judgeTargetTested(config, text)
    );
  });
}

/**
 * What the judge is, in words, while the person set no judge chain (owner D44): Claude
 * judges every check first, as it always did; while it is limited or down, the worker
 * chain's targets that passed the judge test judge in its place, as long as the judge's
 * fallback switch is on (it is, by default). One home for the words that `gateway status`,
 * `slot judge off`, `fallback judge` and `doctor` say.
 */
export function judgeDefaultWords(config: GatewayConfig): string {
  if (!fallbackOn(config, JUDGE_SLOT)) return "Claude judges every check, alone (fallback off)";
  const standIns = workerJudgeTargets(config).map(formatTarget);
  const untested = untestedWorkerTargets(config);
  if (standIns.length === 0) {
    return untested.length > 0
      ? `Claude judges every check, alone: no worker target has passed the judge test yet (${untested.join(", ")}; ${COMMAND} gateway setup tests them)`
      : "Claude judges every check, alone (the worker chain has no affordable target to stand in)";
  }
  return `Claude first; while Claude is limited or down: ${standIns.join(", ")} (fallback on)${untested.length > 0 ? `; not tested, so never judging: ${untested.join(", ")} (${COMMAND} gateway setup tests them)` : ""}`;
}

/** What a slot's fallback switch means for its chain, in words. */
function fallbackWords(config: GatewayConfig, key: string): string {
  const targets = config.slots[key] ?? [];
  if (fallbackOn(config, key)) return "fallback on";
  return targets.length > 1
    ? `fallback off: only ${targets[0]} answers; the rest are kept, not used`
    : "fallback off";
}

function printSlots(config: GatewayConfig, print: (line: string) => void): void {
  print(
    "\nSlots (Claude: plain Claude; Custom: the first target answers, the next one only while fallback is on):",
  );
  const known = [...Object.keys(FAMILY_SLOTS), JUDGE_SLOT];
  const keys = [
    ...known,
    ...[...new Set([...Object.keys(config.slots), ...Object.keys(config.kept ?? {})])]
      .filter((key) => !known.includes(key))
      .sort(),
  ];
  for (const key of keys) {
    const targets = config.slots[key];
    if (targets === undefined) {
      print(`  ${key.padEnd(16)} ${claudeWords(config, key)}`);
      const saved = keptChain(config, key);
      if (saved !== null) print(`    ${keptWords(key, saved)}`);
      // The worker's tested targets are judges while Claude cannot: the trade-off is shown.
      if (key === JUDGE_SLOT && fallbackOn(config, key) && workerJudgeTargets(config).length > 0) {
        print(`    ! ${JUDGE_WARNING}`);
      }
      continue;
    }
    const notes = [fallbackWords(config, key)];
    const breaker = breakerWords(config, key);
    if (breaker !== null) notes.push(breaker);
    if (key === JUDGE_SLOT) {
      const untested = targets.filter((target) => !judgeTargetUsable(config, target));
      notes.push(
        untested.length > 0
          ? `NOT TESTED, so ignored: ${untested.join(", ")}; run ${COMMAND} gateway slot judge <targets>`
          : "your own judge: it judges the checks in this order",
      );
    }
    print(`  ${key.padEnd(16)} Custom: ${targets.join(" → ")}  (${notes.join("; ")})`);
    if (key === JUDGE_SLOT) print(`    ! ${JUDGE_WARNING}`);
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
    "\nA claude-<model> target goes to Anthropic on your own Claude login: write the id as Anthropic names it.",
  );
  return 0;
}

/**
 * The config with the judge test proofs (`judgeTestProof`) it needs: one for each target
 * that passed, on the backend URL it passed on (a target whose backend moved since then
 * gets none), and the ones it already held for a target the judge chain or the worker chain
 * still has. A proof for any other target goes, so a target nothing uses must be tested
 * again when it comes back (D44: the worker chain's targets use `judgeTested` too). A saved
 * judge chain used again (`gateway slot judge custom`) keeps the proofs that still match,
 * because its targets are in `slots` again; only the rest are tested.
 */
export function withJudgeProofs(
  config: GatewayConfig,
  passed: Readonly<Record<string, string>>,
): GatewayConfig {
  const used = new Set([...(config.slots[JUDGE_SLOT] ?? []), ...(config.slots[WORKER_SLOT] ?? [])]);
  const proofs: Record<string, string> = {};
  for (const [target, proof] of Object.entries(config.judgeTested ?? {})) {
    if (used.has(target)) proofs[target] = proof;
  }
  for (const [target, url] of Object.entries(passed)) {
    // Another command may have taken the target out since it was tested.
    if (used.has(target)) proofs[target] = judgeTestProof(target, url);
  }
  const { judgeTested: _held, ...rest } = config;
  return Object.keys(proofs).length > 0 ? { ...rest, judgeTested: proofs } : rest;
}

/**
 * The judge test for the worker chain's backend targets that have no proof yet (owner D44):
 * with no judge chain of the person's own, the targets that pass judge auto mode's checks
 * while Claude is limited or down. Says each target that passed and each that failed, and
 * returns the backend URL each passing target passed on (for `withJudgeProofs`). A target
 * that fails is no error: the worker slot works as it did, and the target never judges.
 * The test reaches each target's backend with that backend's own key and nothing else
 * (`testJudgeTarget`, through `ctx.apiFetch` when a test passes one), never the router's
 * port. It can take a minute per target, so callers run it outside the lock.
 */
async function testWorkerTargets(
  ctx: GatewayContext,
  config: GatewayConfig,
): Promise<{ lines: string[]; passed: Record<string, string> }> {
  const lines: string[] = [];
  const passed: Record<string, string> = {};
  for (const text of config.slots[WORKER_SLOT] ?? []) {
    const parsed = parseTarget(text);
    if (!("target" in parsed) || parsed.target.kind !== "backend") continue;
    if (judgeTargetTested(config, text)) continue;
    const name = parsed.target.backend;
    const backend = Object.hasOwn(config.backends, name) ? config.backends[name] : undefined;
    if (backend === undefined) continue;
    const result = await testJudgeTarget(
      backend.baseUrl,
      backend.apiKey,
      parsed.target.model,
      ctx.apiFetch,
    );
    if (result.verdict === "block") {
      passed[text] = backend.baseUrl;
      lines.push(
        `judge test: ${text} blocked "${JUDGE_TEST_ACTION}": it judges auto mode's checks while Claude is limited or down`,
      );
    } else {
      lines.push(
        `judge test: ${text} did not block "${JUDGE_TEST_ACTION}" (${result.detail}): it never judges; the worker slot uses it as before`,
      );
    }
  }
  return { lines, passed };
}

/**
 * The trade-off lines after the worker chain or the judge's default changed: where the worker's
 * tested targets stand in for Claude, `JUDGE_WARNING` is said (D44: said wherever it is set).
 */
function sayStandInTradeOff(ctx: GatewayContext, config: GatewayConfig): void {
  if (
    !Object.hasOwn(config.slots, JUDGE_SLOT) &&
    fallbackOn(config, JUDGE_SLOT) &&
    workerJudgeTargets(config).length > 0
  ) {
    ctx.print(`! ${JUDGE_WARNING}`);
  }
}

/**
 * A slot turned off, or whose fallback switch went off, loses its fallback record in the
 * router's state file at once, so the status line stops showing it even before the router's
 * next request (the router drops it too, when it reads the changed config). A file that is
 * not there, or not readable, stays.
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

/** What a saved slot change did, in the lines `gateway slot` prints first. */
function slotChangeLines(plan: SlotPlan): string[] {
  const before =
    plan.old.length > 0 ? plan.old.join(" → ") : plan.kind === "chain" ? "(new)" : "Claude";
  const now =
    plan.next.length > 0
      ? `${plan.next.join(" → ")}  (${fallbackWords(plan.config, plan.key)})`
      : claudeWords(plan.config, plan.key);
  const lines = [`${plan.key}: ${before}`, `  now: ${now}`];
  const savedChain = keptChain(plan.config, plan.key);
  if (savedChain !== null) lines.push(`  ${keptWords(plan.key, savedChain)}`);
  if (plan.kind === "clear") lines.push("  No chain is saved for it now.");
  return lines;
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
  for (const text of chainToCheck(config, slotArg, targets)) {
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
  /** Each target that passed the test, and the backend URL it passed on. */
  const passed: Record<string, string> = {};
  if (first.key === JUDGE_SLOT && first.next.length > 0) {
    // A judge is never set untested, and there is no way to skip the test. A Claude target
    // needs none: Claude is the judge the test is measured against. A saved chain used again
    // keeps the proofs that still match; only a target without one is tested.
    for (const text of first.next) {
      if (first.kind === "custom" && judgeTargetTested(config, text)) continue;
      const parsed = parseTarget(text);
      if (!("target" in parsed)) continue;
      if (parsed.target.kind === "anthropic") {
        ctx.print(`judge: ${text} is Claude: no test needed; it judges as the model it names`);
        continue;
      }
      const backend = config.backends[parsed.target.backend];
      if (backend === undefined) continue;
      const result = await testJudgeTarget(
        backend.baseUrl,
        backend.apiKey,
        parsed.target.model,
        ctx.apiFetch,
      );
      if (result.verdict !== "block") {
        throw new Error(
          `${text} did not block the test check (${JUDGE_TEST_ACTION}): ${result.detail}. The judge was not set.`,
        );
      }
      passed[text] = backend.baseUrl;
      ctx.print(`judge test: ${text} blocked "${JUDGE_TEST_ACTION}"`);
    }
  }
  if (first.key === WORKER_SLOT && first.next.length > 0) {
    // The worker is set either way; its targets that block the test also judge while Claude
    // cannot (D44), and the ones that fail only never judge.
    const tested = await testWorkerTargets(ctx, first.config);
    for (const line of tested.lines) ctx.print(line);
    Object.assign(passed, tested.passed);
  }
  // Read again and save inside the lock: another command may have changed the file since
  // (a key set by `gateway setup`, another slot), and its change must not be lost.
  const plan = await withLock(
    ctx.paths.stateDir,
    () => {
      const again = planSlotChange(loadConfigFile(configPath), slotArg, targets, modelsByBackend);
      if ("error" in again) throw new Error(again.error);
      const saved =
        again.key === JUDGE_SLOT || again.key === WORKER_SLOT
          ? withJudgeProofs(again.config, passed)
          : again.config;
      // The chain tested above is the chain saved: one changed by another command meanwhile
      // (a saved judge chain, say) has targets no test here vouched for. A Claude target
      // needs none: Claude is the judge the test is measured against.
      const untested =
        again.key === JUDGE_SLOT
          ? again.next.filter((target) => !judgeTargetUsable(saved, target))
          : [];
      if (untested.length > 0) {
        throw new Error(
          `the judge chain changed while it was tested (${untested.join(", ")} has no test proof). Nothing was saved; run the command again.`,
        );
      }
      saveConfig(configPath, saved);
      if (again.next.length === 0) dropFallbackRecord(ctx.paths.gatewayStateFile, again.key);
      return { ...again, config: saved };
    },
    { waitMs: 10_000 },
  );
  for (const line of slotChangeLines(plan)) ctx.print(line);
  if (plan.next.length > 1 && !fallbackOn(plan.config, plan.key)) {
    ctx.print(
      `  To let the next target answer when ${plan.next[0]} fails or rests: ${COMMAND} gateway fallback ${slotName(plan.key)} on`,
    );
  }
  if (plan.key === JUDGE_SLOT && plan.next.length > 0) ctx.print(`! ${JUDGE_WARNING}`);
  // Where the judge is Claude first, the stand-ins it names are the ones that just changed.
  if (plan.key === WORKER_SLOT || (plan.key === JUDGE_SLOT && plan.next.length === 0)) {
    if (plan.key === WORKER_SLOT && !Object.hasOwn(plan.config.slots, JUDGE_SLOT)) {
      ctx.print(`  Auto mode's checks: ${judgeDefaultWords(plan.config)}`);
    }
    sayStandInTradeOff(ctx, plan.config);
  }
  ctx.print("The router uses it from its next request.");
  return 0;
}

async function commandFallback(ctx: GatewayContext, args: string[]): Promise<number> {
  const [slotArg, value, ...extra] = args;
  if (slotArg === undefined || value === undefined || extra.length > 0) {
    ctx.error(USAGE);
    return 2;
  }
  const configPath = ctx.paths.gatewayConfigFile;
  // Read again and save inside the lock, as `slot` does: another command's change stays.
  const plan = await withLock(
    ctx.paths.stateDir,
    () => {
      const planned = planFallbackChange(loadConfigFile(configPath), slotArg, value);
      if ("error" in planned) throw new Error(planned.error);
      saveConfig(configPath, planned.config);
      if (!planned.now) dropFallbackRecord(ctx.paths.gatewayStateFile, planned.key);
      return planned;
    },
    { waitMs: 10_000 },
  );
  const change = `${plan.key}: fallback ${plan.was ? "on" : "off"} → ${plan.now ? "on" : "off"}`;
  // The judge's switch is in use with no chain (it says whether the worker's tested targets
  // stand in), so only every other slot's switch waits in `kept`.
  const kept = plan.key === JUDGE_SLOT ? null : keptChain(plan.config, plan.key);
  if (kept !== null && !Object.hasOwn(plan.config.slots, plan.key)) {
    // A slot that answers as Claude: the switch waits with its saved chain.
    ctx.print(`${change}\n  ${claudeWords(plan.config, plan.key)}\n  ${keptWords(plan.key, kept)}`);
    ctx.print("  The switch is used with the chain, once the slot is Custom again.");
    ctx.print("The router uses it from its next request.");
    return 0;
  }
  const targets = plan.config.slots[plan.key] ?? [];
  if (plan.key === JUDGE_SLOT && targets.length === 0) {
    // No judge chain of the person's: the switch says whether the worker's tested targets
    // stand in while Claude is limited or down (D44).
    ctx.print(`${change}\n  ${judgeDefaultWords(plan.config)}`);
    ctx.print(
      plan.now
        ? "  The worker's tested targets answer when Claude is limited or down."
        : "  Only Claude judges; when it is limited or down, its error goes back to Claude Code.",
    );
    sayStandInTradeOff(ctx, plan.config);
  } else {
    ctx.print(`${change}\n  ${targets.join(" → ")}  (${fallbackWords(plan.config, plan.key)})`);
    ctx.print(
      plan.now
        ? "  The next target answers when the one before it fails or rests."
        : "  Only the first target answers; when it fails, its error goes back to Claude Code.",
    );
  }
  ctx.print("The router uses it from its next request.");
  return 0;
}

async function commandBreaker(ctx: GatewayContext, args: string[]): Promise<number> {
  const [slotArg, value, ...extra] = args;
  if (slotArg === undefined || value === undefined || extra.length > 0) {
    ctx.error(USAGE);
    return 2;
  }
  const configPath = ctx.paths.gatewayConfigFile;
  // Read again and save inside the lock, as `slot` does: another command's change stays.
  const plan = await withLock(
    ctx.paths.stateDir,
    () => {
      const planned = planBreakerChange(loadConfigFile(configPath), slotArg, value);
      if ("error" in planned) throw new Error(planned.error);
      saveConfig(configPath, planned.config);
      return planned;
    },
    { waitMs: 10_000 },
  );
  const targets = plan.config.slots[plan.key] ?? [];
  ctx.print(
    `${plan.key}: breaker ${plan.was ? "on" : "off"} → ${plan.now ? "on" : "off"}\n  ${targets.join(" → ")}  (${breakerWords(plan.config, plan.key) ?? ""})`,
  );
  ctx.print(
    plan.now
      ? "  While every target is limited or down, the request waits a little and then Claude Code is asked to retry."
      : "  While every target is limited or down, the last answer goes back to Claude Code at once.",
  );
  ctx.print("The router uses it from its next request.");
  return 0;
}

function printOverrides(
  report: ReturnType<typeof settingsReport>,
  print: (line: string) => void,
): void {
  if (report.subagentOverrides.length > 0) {
    print(
      `  ! ${report.subagentOverrides.join(", ")} set: every agent launched without a model runs on it, with the gateway possibly an affordable slot. Remove it by hand unless you want that.`,
    );
  }
  if (report.loginOverrides.length > 0) {
    print(
      `  ! ${report.loginOverrides.join(", ")} set: that replaces your own Claude login. Remove it for the gateway.`,
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
      ctx.print(`  ! the config says port ${port}; restart the router to move it`);
    const cooling = isJsonObject(body.cooling) ? Object.entries(body.cooling) : [];
    for (const [target, seconds] of cooling)
      ctx.print(`  resting: ${target} for ${String(seconds)} s more`);
    for (const line of breakerStatusLines(body.breakers, ctx.probe.now())) ctx.print(line);
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
  ctx.print(
    `history: ${historyWords({
      bytes: historyDbBytes(ctx.paths.historyDbFile),
      exists: historyDbExists(ctx.paths.historyDbFile),
      retentionDays: config === null ? HISTORY_RETENTION_DAYS : historyRetentionDays(config),
    })} in ${tildify(ctx.paths.historyDbFile, ctx.paths.home)}`,
  );
  return 0;
}

/** `gateway history`'s options; null on a wrong one. */
function historyOptions(args: string[]): {
  by: HistoryBy;
  filters: HistoryFilters;
  range: HistoryRange;
} | null {
  let by: HistoryBy = DEFAULT_HISTORY_BY;
  let range: HistoryRange = DEFAULT_HISTORY_RANGE;
  let ranged = false;
  const filters: HistoryFilters = {};
  const columns = ["slot", "target", "model", "session"] as const;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--by") {
      const value = args[index + 1];
      if (value === undefined || !(HISTORY_BY as readonly string[]).includes(value)) return null;
      by = value as HistoryBy;
      index += 1;
    } else if (arg.startsWith("--") && (columns as readonly string[]).includes(arg.slice(2))) {
      const column = arg.slice(2) as (typeof columns)[number];
      const value = args[index + 1];
      if (value === undefined || value === "") return null;
      filters[column] = value;
      index += 1;
    } else if (arg === "--errors") {
      filters.status = "error";
    } else if (arg.startsWith("--")) {
      return null;
    } else {
      if (ranged || !(HISTORY_RANGES as readonly string[]).includes(arg)) return null;
      range = arg as HistoryRange;
      ranged = true;
    }
  }
  return { by, filters, range };
}

/** A cost in dollars: cents from a dollar up, micro-dollars below it, and $0 for none. */
function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/**
 * The output module over the gateway's own print sink: the same words through `ctx.print` (the
 * portal hands its own), with colour and wrapping only when stdout is a terminal. A table is
 * printed through `ctx.print` as it is: its columns must not wrap.
 */
function gatewayOut(ctx: GatewayContext): Out {
  return createOut(currentTerminal(process.env, ctx.platform), {
    line: (text) => ctx.print(text),
    raw: () => undefined,
  });
}

/**
 * `gateway history`: the request history's totals by target, slot, model or session (D51).
 * The portal's history page reads the same module (`history-read.ts`) for its chart and its
 * recent-requests table; this view is the terminal's.
 */
async function commandHistory(ctx: GatewayContext, args: string[]): Promise<number> {
  const out = gatewayOut(ctx);
  const options = historyOptions(args);
  if (options === null) {
    ctx.error(USAGE);
    return 2;
  }
  let config: GatewayConfig | null = null;
  try {
    config = loadConfigFile(ctx.paths.gatewayConfigFile);
  } catch {
    // The history reads without the config: its own retention is all it needs, and 90 days
    // is the answer when there is no good config.
  }
  const retentionDays = config === null ? HISTORY_RETENTION_DAYS : historyRetentionDays(config);
  if (retentionDays <= 0) {
    out.say(
      `The request history is off (history.retentionDays: 0 in ${tildify(ctx.paths.gatewayConfigFile, ctx.paths.home)}): nothing is logged.`,
    );
    return 0;
  }
  const answer = historySeries(ctx.paths.historyDbFile, {
    by: options.by,
    filters: options.filters,
    range: options.range,
  });
  if (answer.series.length === 0) {
    out.say(
      historyDbExists(ctx.paths.historyDbFile)
        ? `No request in the last ${options.range} matched.`
        : `No request logged yet: ${tildify(ctx.paths.historyDbFile, ctx.paths.home)} is made by the router's first row.`,
    );
    return 0;
  }
  out.heading(
    `History, last ${options.range} (${bucketWords(answer.bucketMs)} buckets), by ${options.by}`,
  );
  out.say(
    "Cost is estimated: Claude at its list price, a backend at the price its own list gives.",
  );
  const header = [
    options.by,
    "requests",
    "errors",
    "input",
    "output",
    "cache read",
    "cache write",
    "cost",
    "peak p95",
  ];
  const rows = answer.series.map((series) => {
    const total = {
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      errors: 0,
      input: 0,
      output: 0,
      requests: 0,
    };
    let peakP95 = 0;
    for (const point of series.points) {
      total.requests += point.requests;
      total.errors += point.errors;
      total.input += point.inputTokens;
      total.output += point.outputTokens;
      total.cacheRead += point.cacheReadTokens;
      total.cacheWrite += point.cacheWriteTokens;
      total.cost += point.costUsd;
      peakP95 = Math.max(peakP95, point.p95Ms);
    }
    const count = (value: number) => value.toLocaleString("en-US");
    return [
      series.key,
      count(total.requests),
      count(total.errors),
      count(total.input),
      count(total.output),
      count(total.cacheRead),
      count(total.cacheWrite),
      formatUsd(total.cost),
      `${count(peakP95)} ms`,
    ];
  });
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((cells) => (cells[index] ?? "").length)),
  );
  ctx.print(
    header
      .map((title, index) =>
        index === 0 ? title.padEnd(widths[index] ?? 0) : title.padStart(widths[index] ?? 0),
      )
      .join("  ")
      .trimEnd(),
  );
  for (const cells of rows) {
    ctx.print(
      cells
        .map((cell, index) =>
          index === 0 ? cell.padEnd(widths[index] ?? 0) : cell.padStart(widths[index] ?? 0),
        )
        .join("  ")
        .trimEnd(),
    );
  }
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
  const value = await ctx.readSecret("OmniRoute's dashboard password");
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
  /** A key this run made in OmniRoute: deleted again unless the run saves it. */
  let discard: null | {
    discard: () => Promise<{ detail: string; ok: boolean }>;
    id: null | string;
    name: string;
  } = null;
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
  // The two steps for a machine an older version set up, read-only first: a config or a
  // settings file that cannot be read stops the setup here, before anything is written.
  upgradeConfig(configPath, { dryRun: true, portalStateFile: paths.portalStateFile });
  retireOldModelKeys({ dryRun: true, settingsFile: paths.settingsFile, stateDir: paths.stateDir });
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
    // A key setup made and does NOT save (a backend that refuses it, an unchecked save without
    // `--save-unchecked`, any later failure) is deleted again in OmniRoute: a run that saved
    // nothing must not leave an unused key in the person's dashboard (premium review,
    // 2026-10-17).
    discard = { discard: made.discard, id: made.id, name: made.name };
    ctx.print(`made the key "${made.name}" in OmniRoute (${maskKey(made.key)})`);
  }

  /**
   * Everything from the key check on runs inside this: a failure (a key the backend refuses, an
   * unchecked save without `--save-unchecked`, anything later) deletes the key this run made in
   * OmniRoute, and a delete that fails names it — its name and its OmniRoute id — so the person
   * can remove it by hand.
   */
  const discardKey = async (error: unknown): Promise<never> => {
    if (discard === null) throw error;
    const gone = await discard.discard();
    if (gone.ok) throw error;
    throw new Error(
      `${messageOf(error)}\n  ! the key this run made in OmniRoute could not be removed (${discard.name}, id ${discard.id ?? "unknown"}; ${gone.detail}): remove it in OmniRoute's dashboard by hand`,
    );
  };
  let code: number;
  try {
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

    code = await withLock(
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
        const keyBackedUp =
          key !== null && existsSync(backups) && readdirSync(backups).length > backupsBefore;
        // Under the lock, with the backup: the chains the old portal remembered move into the
        // config here, together with the router copy that reads them (a second run moves none).
        const upgraded = upgradeConfig(configPath, {
          portalStateFile: paths.portalStateFile,
          stateDir: paths.stateDir,
        });
        for (const line of upgraded) ctx.print(line);
        if (upgraded.length > 0) {
          ctx.print(
            `  the config as it was before these changes is in ${tildify(backups, paths.home)}`,
          );
        }
        const now = existsSync(configPath) ? loadConfigFile(configPath) : null;
        if (now !== null && Object.keys(now.slots).length === 0) {
          const saved = Object.keys(now.kept ?? {}).length;
          ctx.print(
            saved > 0
              ? `Every slot is Claude, so every Claude model stays plain Claude. ${String(saved)} saved chain(s) are not in use: ${COMMAND} gateway status lists them, and ${COMMAND} gateway slot <slot> custom uses one again.`
              : `Every slot is off, so every Claude model stays plain Claude. Pick the models yourself: ${COMMAND} gateway models, then ${COMMAND} gateway slot <slot> <targets> (or the portal's Slots page).`,
          );
        }
        if (keyBackedUp) {
          ctx.print(
            `  the file as it was before the change is in ${tildify(backups, paths.home)}: copy it back to put the key that was there in place`,
          );
        }
        if (unchecked !== "") {
          ctx.print(
            `  ! the key was saved WITHOUT its backend accepting it (${unchecked}). Check it when the backend answers: ${COMMAND} gateway check`,
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
        // 0.4.3's `haiku` / `sonnet` model keys, where cc-smart-dev-kit still owns them: with the
        // new router, a request that names a slot with no chain is refused.
        const retired = retireOldModelKeys({
          settingsFile: paths.settingsFile,
          stateDir: paths.stateDir,
        });
        if (retired.changes.length > 0) {
          ctx.print(changeLines(retired, paths.home).join("\n"));
          ctx.print(
            "Restart every open Claude session now: until it restarts, a session may still send haiku / sonnet work by the slot's old name.",
          );
        }
        if (settingsReport(paths.settingsFile).baseUrl === null) {
          ctx.print(
            `Claude Code does not use the gateway yet. Check it: ${COMMAND} gateway status. Then: ${COMMAND} gateway on.`,
          );
        }
        return 0;
      },
      { waitMs: 10_000 },
    );
  } catch (error) {
    // The key this run made is not saved: it must not stay in OmniRoute unused.
    return await discardKey(error);
  }
  // After the try, never inside it: the key is saved by now, and a failure here must not
  // delete it again. This step catches its own.
  if (code === 0) await proveWorkerTargets(ctx);
  return code;
}

/**
 * `gateway setup`'s last step (owner D44): the judge test for the worker chain's backend
 * targets that have no proof, so the ones that pass can judge auto mode's checks while
 * Claude is limited or down. It runs once the router is in place and outside the lock (a
 * test can take a minute per target); the proofs are saved under the lock, into the config
 * as it is then. A failure of this step is said in one line and never fails the setup: the
 * router works without it, and the next setup tries again.
 */
async function proveWorkerTargets(ctx: GatewayContext): Promise<void> {
  const configPath = ctx.paths.gatewayConfigFile;
  try {
    if (!existsSync(configPath)) return;
    const tested = await testWorkerTargets(ctx, loadConfigFile(configPath));
    for (const line of tested.lines) ctx.print(line);
    if (Object.keys(tested.passed).length === 0) return;
    const saved = await withLock(
      ctx.paths.stateDir,
      () => {
        const next = withJudgeProofs(loadConfigFile(configPath), tested.passed);
        saveConfig(configPath, next);
        return next;
      },
      { waitMs: 10_000 },
    );
    sayStandInTradeOff(ctx, saved);
  } catch (error) {
    ctx.print(
      `! the judge test of the worker's targets could not finish (${messageOf(error)}). Run ${COMMAND} gateway setup again to retry it.`,
    );
  }
}

function show(value: unknown): string {
  return value === undefined ? "(none)" : JSON.stringify(value);
}

/**
 * `gateway check`'s exit codes. One read-only question — does the gateway have an OmniRoute key
 * the backend accepts? — for the installer, which asks for a key only when the answer says the
 * gateway is not working (`install.sh`, `install.ps1`).
 *
 *   0  the key in the config works (the backend accepts it)
 *   1  there is no OmniRoute key yet, and an OmniRoute answers: one can be made (dashboard
 *      password) or given (an API key)
 *   3  it could not be judged: NO OmniRoute answers (a machine with no config and no OmniRoute
 *      is this case, never 0 — there is nothing to work with), the config cannot be read, or
 *      the backend did not answer. Never a refusal, and the installer asks for nothing
 *   4  the key in the config is one the backend refuses
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
      "Every Claude Code session on this machine, in every folder, uses the gateway from now on: each Claude model's work (background titles and summaries too) goes to the slot of its family when that slot has a chain, and to Anthropic unchanged when it has none.",
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
    case "fallback":
      return commandFallback(ctx, rest);
    case "breaker":
      return commandBreaker(ctx, rest);
    case "status":
      return noArgs(() => commandStatus(ctx));
    case "history":
      return commandHistory(ctx, rest);
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
