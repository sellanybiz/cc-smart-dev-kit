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
 *   on / off  sets the gateway's env keys, or points the address back at Anthropic.
 *
 * API keys are masked in every output. The design: docs/gateway.md.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { type Mark, type Out, plural } from "../cli/ui/out";
import { INTERRUPTED_EXIT, type Prompts } from "../cli/ui/prompt";
import type { Terminal } from "../cli/ui/terminal";
import { shellWord } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { atomicWrite, backupDir, backupFile } from "../setup/write";
import { checkBackendKey, listModels } from "./backends";
import { breakerStatusLines } from "./breaker";
import { chainProblem, chainToCheck, notSlotName, SLOT_WORDS, slotName } from "./commands-chains";
import { changeLines, gatewayOut, printChanges } from "./commands-out";
import { commandProfile, PROFILE_HELP, withoutOrphanProfileSwitches } from "./commands-profile";
import {
  commandProject,
  commandProjects,
  type KnownProject,
  type KnownProjects,
  PROJECT_HELP,
  PROJECTS_HELP,
  projectSourceWords,
  projectStateOf,
} from "./commands-project";
import {
  breakerOn,
  breakerWords,
  ConfigError,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_FIRST_BYTE_MS,
  DEFAULT_PORT,
  effortPin,
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
import {
  JUDGE_TEST_ACTION,
  judgeTestRequest,
  judgeVerdict,
  sendBackendTest,
  testJudgeTarget,
} from "./judge-test";
import { formatLimitState, parseLimitState } from "./limit-state";
import { createOmnirouteKey, probeOmniroute } from "./omniroute-key";
import { decisionWords, type ProjectGatewayState } from "./project-state";
import { effortPinForBackend, startRouter } from "./router";
import {
  checkRouterPort,
  type InstallOptions,
  installRouter,
  type RouterService,
  type RouterServiceKind,
  type Runner,
  systemdService,
} from "./service";
import { scheduledTaskService } from "./service-windows";
import {
  BASE_URL_KEY,
  baseUrlPointsAtGateway,
  gatewayEnv,
  maskKey,
  RETIRED_GATEWAY_ENV_KEYS,
  readGatewaySettings,
  retireOldModelKeys,
  settingsReport,
  shownValue,
  turnOff,
  turnOn,
} from "./settings";
import { askSetupQuestions, type SetupAnswers } from "./setup-questions";
import {
  BACKEND_EFFORT_LEVELS,
  type BackendEffort,
  FAMILY_SLOTS,
  formatTarget,
  isModelSlot,
  JUDGE_SLOT,
  parseTarget,
  slotKeyFromArg,
  WORKER_SLOT,
} from "./targets";

// The slot words and the chain checks moved to `commands-chains.ts` (the profile commands use
// them too); the portal and the tests still import them from here.
export { chainProblem, chainToCheck, SLOT_WORDS };

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
  effort <slot> <target> <level>|off
                         Pin a backend target's effort (${BACKEND_EFFORT_LEVELS.join(", ")}).
                         Tests the target before saving; off follows Claude Code again.
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
  off                    Point Claude Code back at Anthropic. The address key is set to
                         Anthropic's own address, so running sessions switch by themselves.
                         It stays owned, so "restore" takes it back later.
${PROJECT_HELP}
${PROJECTS_HELP}
${PROFILE_HELP}
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
   * Every kind of question (`src/cli/ui/prompt.ts`), for `gateway setup`'s questions; left out
   * when stdin is not a terminal (and by the portal), and then nothing is asked.
   */
  prompts?: null | Prompts;
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
  /**
   * The projects `gateway projects` lists: the portal's own list (`projectsList`) in use, read
   * when the command runs, with the project `folder` is in marked `current`; a test passes its
   * own, so none reads Claude Code's session records.
   */
  projects?: (folder: string) => Promise<KnownProjects>;
  /** Where a command's own lines go: `console.log` in use, a collector from the portal. */
  print: (line: string) => void;
  /**
   * The terminal those lines are drawn for (`currentTerminal`): set only when they go to this
   * process's own stdout. Left out (the portal's collector, a test), they are plain text.
   */
  term?: Terminal;
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
export function defaultConfig(
  omnirouteKey: string,
  baseUrl: string = KNOWN_BACKENDS.omniroute ?? "",
): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: { omniroute: { apiKey: omnirouteKey, baseUrl } },
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
 * `key.baseUrl` (setup's address question): the backend's address, saved with the key; left
 * out, the address in the config stays (or the one `setup` knows, for a new backend). A
 * changed address is backed up like a changed key.
 *
 * `dryRun`: checks everything and writes nothing.
 */
export function ensureConfig(
  configPath: string,
  key: null | SetupKey,
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
    if (options.dryRun !== true) saveConfig(configPath, defaultConfig(key.value, key.baseUrl));
    return `created ${configPath} (mode 600)`;
  }
  const config = loadConfigFile(configPath);
  if (key === null) return `kept ${configPath}`;
  const existing = Object.hasOwn(config.backends, key.backend)
    ? config.backends[key.backend]
    : undefined;
  const baseUrl = key.baseUrl ?? existing?.baseUrl ?? KNOWN_BACKENDS[key.backend];
  if (baseUrl === undefined) {
    throw new ConfigError(
      `backend "${key.backend}" is unknown; add it to ${configPath} by hand first`,
    );
  }
  if (options.dryRun !== true) {
    const changed =
      existing !== undefined && (existing.apiKey !== key.value || existing.baseUrl !== baseUrl);
    if (changed && options.stateDir !== undefined) {
      // A key (or an address) that is there and changes: keep the whole file as it was, so the
      // key it held can be read back (the person may only notice a wrong key days later, when
      // the slots fail).
      backupFile(options.stateDir, configPath);
    }
    saveConfig(configPath, {
      ...config,
      backends: { ...config.backends, [key.backend]: { apiKey: key.value, baseUrl } },
    });
  }
  const moved =
    existing !== undefined && existing.baseUrl !== baseUrl
      ? ` and its address to ${shownValue(baseUrl)}`
      : "";
  return `set the key of backend "${key.backend}" (${maskKey(key.value)})${moved} in ${configPath}`;
}

/** A backend key `setup` saves: the backend, the key, and the address the person answered. */
export interface SetupKey {
  backend: string;
  value: string;
  baseUrl?: string;
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
  /** The way to try again, when it is not the stdin flag (setup's questions). */
  again?: string;
}): string {
  return [
    `${options.backend} answered HTTP ${String(options.status)} for this key (${options.detail}, ${shownValue(options.baseUrl)}): it does not accept it.`,
    `Nothing was saved, and the key in ${options.configPath} is kept as it was.`,
    wantedKeyWords(options.backend),
    `Find or make it there, then run again: ${options.again ?? `${COMMAND} gateway setup --backend-key-stdin ${options.backend} < key-file`}`,
  ].join("\n");
}

/** The refusal when the backend could not be asked at all and `--save-unchecked` was not given. */
export function keyUncheckedMessage(options: {
  backend: string;
  baseUrl: string;
  configPath: string;
  detail: string;
  /** The way to try again, when it is not the stdin flag (setup's questions). */
  again?: string;
}): string {
  return [
    `could not ask ${options.backend} at ${shownValue(options.baseUrl)} whether it accepts this key (${options.detail}).`,
    `Nothing was saved, and the key in ${options.configPath} is kept as it was.`,
    options.again === undefined
      ? `Start ${options.backend} and run again, or save the key without checking it: ${COMMAND} gateway setup --backend-key-stdin ${options.backend} --save-unchecked < key-file`
      : `Start ${options.backend} and run again: ${options.again}`,
  ].join("\n");
}

/** A key made in OmniRoute and not saved yet: deleted again (`discardMadeKey`) unless it is. */
interface MadeKey {
  discard: () => Promise<{ detail: string; ok: boolean }>;
  id: null | string;
  name: string;
}

/** What a key's save needs from a command's context: the paths, the backend's fetch, the lines. */
export type KeyContext = Pick<GatewayContext, "apiFetch" | "paths" | "print">;

/** How to give a key by hand, in a refusal of the dashboard password, on a terminal. */
const GIVE_KEY_INSTEAD = `${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`;

/**
 * Makes a key in OmniRoute with its dashboard password (`createOmnirouteKey`), for setup's
 * `--omniroute-password` and the portal's "make a key". Throws setup's words when OmniRoute does
 * not answer, refuses the password, or makes no key; nothing is saved here. The key it returns is
 * TESTED next (`checkKeyToSave`), and deleted again (`discardMadeKey`) when it is not saved.
 * `giveKey`: how to give a key by hand instead, in the caller's own words.
 */
async function keyFromPassword(
  ctx: KeyContext,
  configPath: string,
  password: string,
  giveKey = GIVE_KEY_INSTEAD,
): Promise<{ key: SetupKey; made: MadeKey }> {
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
        `${wantedKeyWords("omniroute")}. If you already have that key, give it instead: ${giveKey}`,
      ].join("\n"),
    );
  }
  if (made.kind === "failed") {
    throw new Error(
      `${made.detail}. OmniRoute's dashboard password is the one you log in with; setup does not store it.`,
    );
  }
  ctx.print(`made the key "${made.name}" in OmniRoute (${maskKey(made.key)})`);
  // A key made and NOT saved (a backend that refuses it, an unchecked save without
  // `--save-unchecked`, any later failure) is deleted again in OmniRoute: a run that saved
  // nothing must not leave an unused key in the person's dashboard (premium review, 2026-10-17).
  return {
    key: { backend: "omniroute", value: made.key },
    made: { discard: made.discard, id: made.id, name: made.name },
  };
}

/**
 * Tests a key before it is saved (`checkBackendKey`): a 401/403 throws `keyRefusedMessage`, a
 * check that could not be made throws `keyUncheckedMessage` unless `saveUnchecked`. Returns why
 * the key is saved unchecked, or "" when its backend accepted it (or has no address to ask).
 * `again` / `againUnchecked`: how to try again after each refusal (the second defaults to the
 * first).
 */
async function checkKeyToSave(
  ctx: KeyContext,
  configPath: string,
  key: SetupKey,
  options: { again?: string; againUnchecked?: string; saveUnchecked: boolean },
): Promise<string> {
  const baseUrl =
    key.baseUrl ?? backendBaseUrl(configPath, key.backend) ?? KNOWN_BACKENDS[key.backend];
  if (baseUrl === undefined) return "";
  const check = await checkBackendKey(baseUrl, key.value, {
    ...(ctx.apiFetch === undefined ? {} : { fetch: ctx.apiFetch }),
  });
  const again = options.again === undefined ? {} : { again: options.again };
  if (check.kind === "refused") {
    throw new Error(
      keyRefusedMessage({
        backend: key.backend,
        baseUrl,
        configPath,
        detail: check.detail,
        status: check.status,
        ...again,
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
          ...(options.againUnchecked === undefined ? again : { again: options.againUnchecked }),
        }),
      );
    }
    return check.detail;
  }
  return "";
}

/**
 * The end of a run that made a key and does not save it: the key is deleted again in OmniRoute,
 * then `error` is thrown. A delete that fails names the key — its name and its OmniRoute id — so
 * the person can remove it by hand. With no key made, `error` is thrown as it is.
 */
async function discardMadeKey(made: MadeKey | null, error: unknown): Promise<never> {
  if (made === null) throw error;
  const gone = await made.discard();
  if (gone.ok) throw error;
  throw new Error(
    `${messageOf(error)}\n  ! the key this run made in OmniRoute could not be removed (${made.name}, id ${made.id ?? "unknown"}; ${gone.detail}): remove it in OmniRoute's dashboard by hand`,
  );
}

/** How many backups of one file there are: a save that made one says where it is. */
function backupCount(backups: string): number {
  return existsSync(backups) ? readdirSync(backups).length : 0;
}

/** The line after a key's save replaced the one that was there: where the old file is. */
function keyBackupLine(backups: string, home: string): string {
  return `  the file as it was before the change is in ${tildify(backups, home)}: copy it back to put the key that was there in place`;
}

/**
 * The warning after a key was saved without its backend accepting it (`--save-unchecked`). The
 * words alone: setup prints them as a `!` line, the portal in its warning colour.
 */
function uncheckedKeyWords(detail: string): string {
  return `the key was saved WITHOUT its backend accepting it (${detail}). Check it when the backend answers: ${COMMAND} gateway check`;
}

/** The refusal when a key is set on a machine with no gateway config: a first setup is setup's. */
const NOT_SET_UP_FOR_KEY = `The gateway is not set up on this machine yet, so there is no key to change: run ${COMMAND} gateway setup in a terminal first.`;

/**
 * Sets the OmniRoute key of a gateway that is set up, and nothing else: the portal's two key
 * actions (PK1). The same steps as `gateway setup --backend-key-stdin omniroute` and
 * `--omniroute-password`, in the same functions — a key made with the dashboard password
 * (`keyFromPassword`), tested before it is saved (`checkKeyToSave`), written under setup's lock
 * with a backup when it really changes (`ensureConfig`), and deleted again in OmniRoute when it
 * was made and is not saved (`discardMadeKey`). None of setup's other work: the router reads a
 * changed config by itself (`watchConfig`), so nothing is installed or restarted.
 *
 * Throws the refusal in setup's words, with `again` / `giveKey` saying how to try again where the
 * key came from. No line it prints and no refusal names the key or the password. `checked` is
 * false when the key was saved without OmniRoute accepting it; that warning is the first line.
 */
export async function setOmnirouteKey(
  ctx: KeyContext,
  given: { key: string } | { password: string },
  options: { again: string; againUnchecked: string; giveKey: string; saveUnchecked: boolean },
): Promise<{ checked: boolean }> {
  const { paths } = ctx;
  const configPath = paths.gatewayConfigFile;
  if (!existsSync(configPath)) throw new Error(NOT_SET_UP_FOR_KEY);
  // The config is read before OmniRoute is asked anything: one that cannot be used stops here.
  loadConfigFile(configPath);
  /** The address the key is checked at: it must still be the config's when the key is saved. */
  const omnirouteAt = (): string | undefined =>
    backendBaseUrl(configPath, "omniroute") ?? KNOWN_BACKENDS.omniroute;
  const checkedAt = omnirouteAt();
  let made: MadeKey | null = null;
  let key: SetupKey = { backend: "omniroute", value: "key" in given ? given.key : "" };
  if ("password" in given) {
    const fromPassword = await keyFromPassword(ctx, configPath, given.password, options.giveKey);
    key = fromPassword.key;
    made = fromPassword.made;
  }
  try {
    const unchecked = await checkKeyToSave(ctx, configPath, key, {
      again: options.again,
      againUnchecked: options.againUnchecked,
      saveUnchecked: options.saveUnchecked,
    });
    await withLock(
      paths.stateDir,
      async () => {
        // Again under the lock, where nothing else writes: a config `restore` removed meanwhile
        // is not made again here (`ensureConfig` would create one), and a key checked at one
        // address is never saved for another one a terminal's setup gave meanwhile.
        if (!existsSync(configPath)) throw new Error(NOT_SET_UP_FOR_KEY);
        if (omnirouteAt() !== checkedAt) {
          throw new Error(
            `OmniRoute's address in ${configPath} changed while the key was checked. Nothing was saved: try again.`,
          );
        }
        const backups = backupDir(paths.stateDir, configPath);
        const backupsBefore = backupCount(backups);
        const said = ensureConfig(configPath, key, { stateDir: paths.stateDir });
        // The warning first: a page shows a result's first line, and this one must be seen.
        if (unchecked !== "") ctx.print(uncheckedKeyWords(unchecked));
        ctx.print(said.replaceAll(configPath, tildify(configPath, paths.home)));
        if (backupCount(backups) > backupsBefore) ctx.print(keyBackupLine(backups, paths.home));
      },
      { waitMs: 10_000 },
    );
    return { checked: unchecked === "" };
  } catch (error) {
    return await discardMadeKey(made, error);
  }
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

/** Pins travel with their chain; omit empty records when a target leaves. */
function withEffort(
  config: GatewayConfig,
  slot: string,
  pins: Record<string, BackendEffort> | undefined,
): GatewayConfig {
  const effort = { ...config.effort };
  delete effort[slot];
  if (pins !== undefined && Object.keys(pins).length > 0) effort[slot] = pins;
  const next = { ...config };
  if (Object.keys(effort).length === 0) delete next.effort;
  else next.effort = effort;
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
 * The words `gateway slot <slot> …` takes in place of a chain are `SLOT_WORDS`
 * (`commands-chains.ts`, one home with the profile's slots). One slot change, planned: what it
 * is, the config after it, and the chains before and after.
 */
export interface SlotPlan {
  /** `chain`: a new chain in use; `claude`, `custom`, `clear`: the words of `SLOT_WORDS`. */
  kind: "chain" | "claude" | "clear" | "custom";
  config: GatewayConfig;
  key: string;
  /** The chain in use before. */
  old: string[];
  /** The chain in use after; none when the slot answers as Claude. */
  next: string[];
  /**
   * Profiles whose fallback or breaker switch for this slot went with its last chain (they had no
   * chain of their own for it): the config refuses a switch on a slot with no chain.
   */
  profiles?: string[];
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
  const pins = current.effort?.[key] ?? kept?.effort;
  const base = withEffort(withoutModelSlot(current, key), key, undefined);

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
        withKept(withoutSlot(base, key), key, {
          targets: old,
          ...(pins === undefined ? {} : { effort: pins }),
        }),
      );
    }
    const fallback = setFallback(current, key);
    const saved: KeptChain = {
      targets: old,
      ...(fallback === undefined ? {} : { fallback }),
      ...(pins === undefined ? {} : { effort: pins }),
    };
    const orphaned = withoutOrphanProfileSwitches(
      withKept(withoutSwitches(withoutSlot(base, key), key), key, saved),
      key,
    );
    return checkedPlan(
      { key, kind: "claude", next: [], old, profiles: orphaned.profiles },
      orphaned.config,
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
      withEffort({ ...base, slots: { ...base.slots, [key]: [...kept.targets] } }, key, kept.effort),
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
    const orphaned = withoutOrphanProfileSwitches(
      withKept(
        key === JUDGE_SLOT ? withoutSlot(base, key) : withoutSwitches(withoutSlot(base, key), key),
        key,
        null,
      ),
      key,
    );
    return checkedPlan(
      { key, kind: "clear", next: [], old, profiles: orphaned.profiles },
      orphaned.config,
    );
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
    withEffort(
      { ...withSavedSwitch, slots: { ...withSavedSwitch.slots, [key]: next } },
      key,
      Object.fromEntries(Object.entries(pins ?? {}).filter(([target]) => next.includes(target))),
    ),
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
  return `saved, not in use: ${chainWithEffort(kept.targets, kept.effort)}  (fallback ${fallback ? "on" : "off"}; to use it: ${COMMAND} gateway slot ${slotName(key)} custom)`;
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

/**
 * Every slot and alias: headings and the judge's warning through `out`; the rows through
 * `print` as they are, because their names are padded into a column that must not wrap.
 */
function printSlots(config: GatewayConfig, out: Out, print: (line: string) => void): void {
  out.blank();
  out.heading(
    "Slots (Claude: plain Claude; Custom: the first target answers, the next one only while fallback is on):",
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
        out.line("warn", JUDGE_WARNING, { indent: 4 });
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
    print(
      `  ${key.padEnd(16)} Custom: ${chainWithEffort(targets, config.effort?.[key])}  (${notes.join("; ")})`,
    );
    if (key === JUDGE_SLOT) out.line("warn", JUDGE_WARNING, { indent: 4 });
  }
  const aliases = Object.entries(config.aliases).sort(([a], [b]) => (a < b ? -1 : 1));
  if (aliases.length > 0) {
    out.blank();
    out.heading("Aliases (an old name, and what it means now):");
    for (const [name, to] of aliases) print(`  ${name.padEnd(16)} → ${to}`);
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────────

async function commandModels(ctx: GatewayContext): Promise<number> {
  const out = gatewayOut(ctx);
  const config = loadConfigFile(ctx.paths.gatewayConfigFile);
  for (const [name, backend] of Object.entries(config.backends)) {
    out.blank();
    out.heading(`${name}  ${shownValue(backend.baseUrl)}  (key ${maskKey(backend.apiKey)})`);
    const listed = await listModels(backend.baseUrl, backend.apiKey);
    if ("error" in listed) out.line("fail", `unreachable: ${listed.error}`, { indent: 2 });
    else if (listed.status !== 200) {
      out.line("fail", `/v1/models answered HTTP ${listed.status}`, { indent: 2 });
    } else {
      for (const model of [...listed.models].sort((a, b) => a.id.localeCompare(b.id))) {
        const context =
          model.contextLength === null
            ? ""
            : `  ${model.contextLength.toLocaleString("en-US")} tokens`;
        ctx.print(`  ${name}:${model.id}${context}`);
      }
    }
  }
  printSlots(config, out, ctx.print);
  out.blank();
  out.say(
    "A claude-<model> target goes to Anthropic on your own Claude login: write the id as Anthropic names it.",
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
): Promise<{ lines: { mark: Mark; text: string }[]; passed: Record<string, string> }> {
  const lines: { mark: Mark; text: string }[] = [];
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
      lines.push({
        mark: "ok",
        text: `judge test: ${text} blocked "${JUDGE_TEST_ACTION}": it judges auto mode's checks while Claude is limited or down`,
      });
    } else {
      lines.push({
        mark: "info",
        text: `judge test: ${text} did not block "${JUDGE_TEST_ACTION}" (${result.detail}): it never judges; the worker slot uses it as before`,
      });
    }
  }
  return { lines, passed };
}

/**
 * Whether the worker's tested targets stand in for Claude as the judge, after the worker chain
 * or the judge's default changed: then the caller says `JUDGE_WARNING` (D44: said wherever it
 * is set).
 */
function standInTradeOff(config: GatewayConfig): boolean {
  return (
    !Object.hasOwn(config.slots, JUDGE_SLOT) &&
    fallbackOn(config, JUDGE_SLOT) &&
    workerJudgeTargets(config).length > 0
  );
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

/** The verdict of every command that changes a slot: the config is read at each request. */
const ROUTER_TAKES_IT = "The router uses it from its next request.";

/** A slot's change: its first line marked `~`, the lines under it as they are (indented). */
function printSlotChange(out: Out, lines: readonly string[]): void {
  const [first, ...rest] = lines;
  if (first !== undefined) out.line("changed", first);
  for (const line of rest) out.say(line.trimStart(), line.length - line.trimStart().length);
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
  const out = gatewayOut(ctx);
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
        out.line(
          "info",
          `judge: ${text} is Claude: no test needed; it judges as the model it names`,
        );
        continue;
      }
      const backend = config.backends[parsed.target.backend];
      if (backend === undefined) continue;
      const result = await testJudgeTarget(
        backend.baseUrl,
        backend.apiKey,
        parsed.target.model,
        ctx.apiFetch,
        effortPin(first.config, first.key, text),
      );
      if (result.verdict !== "block") {
        throw new Error(
          `${text} did not block the test check (${JUDGE_TEST_ACTION}): ${result.detail}. The judge was not set.`,
        );
      }
      passed[text] = backend.baseUrl;
      out.line("ok", `judge test: ${text} blocked "${JUDGE_TEST_ACTION}"`);
    }
  }
  if (first.key === WORKER_SLOT && first.next.length > 0) {
    // The worker is set either way; its targets that block the test also judge while Claude
    // cannot (D44), and the ones that fail only never judge.
    const tested = await testWorkerTargets(ctx, first.config);
    for (const line of tested.lines) out.line(line.mark, line.text);
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
  printSlotChange(out, slotChangeLines(plan));
  if (plan.profiles !== undefined && plan.profiles.length > 0) {
    out.line(
      "info",
      `profile ${plan.profiles.join(", ")}: its fallback and breaker switches for ${plan.key} went with the chain (the profile has none of its own)`,
    );
  }
  if (plan.key === JUDGE_SLOT && plan.next.length > 0) out.line("warn", JUDGE_WARNING);
  // Where the judge is Claude first, the stand-ins it names are the ones that just changed.
  if (plan.key === WORKER_SLOT || (plan.key === JUDGE_SLOT && plan.next.length === 0)) {
    if (plan.key === WORKER_SLOT && !Object.hasOwn(plan.config.slots, JUDGE_SLOT)) {
      out.say(`Auto mode's checks: ${judgeDefaultWords(plan.config)}`, 2);
    }
    if (standInTradeOff(plan.config)) out.line("warn", JUDGE_WARNING);
  }
  out.verdict("ok", ROUTER_TAKES_IT);
  if (plan.next.length > 1 && !fallbackOn(plan.config, plan.key)) {
    out.next([
      {
        command: `${COMMAND} gateway fallback ${slotName(plan.key)} on`,
        text: `To let the next target answer when ${plan.next[0]} fails or rests:`,
      },
    ]);
  }
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
  const out = gatewayOut(ctx);
  const change = `${plan.key}: fallback ${plan.was ? "on" : "off"} → ${plan.now ? "on" : "off"}`;
  // The judge's switch is in use with no chain (it says whether the worker's tested targets
  // stand in), so only every other slot's switch waits in `kept`.
  const kept = plan.key === JUDGE_SLOT ? null : keptChain(plan.config, plan.key);
  if (kept !== null && !Object.hasOwn(plan.config.slots, plan.key)) {
    // A slot that answers as Claude: the switch waits with its saved chain.
    printSlotChange(out, [
      change,
      `  ${claudeWords(plan.config, plan.key)}`,
      `  ${keptWords(plan.key, kept)}`,
    ]);
    out.verdict("ok", "Saved with the chain: the switch is used once the slot is Custom again.");
    return 0;
  }
  const targets = plan.config.slots[plan.key] ?? [];
  if (plan.key === JUDGE_SLOT && targets.length === 0) {
    // No judge chain of the person's: the switch says whether the worker's tested targets
    // stand in while Claude is limited or down (D44).
    printSlotChange(out, [
      change,
      `  ${judgeDefaultWords(plan.config)}`,
      plan.now
        ? "  The worker's tested targets answer when Claude is limited or down."
        : "  Only Claude judges; when it is limited or down, its error goes back to Claude Code.",
    ]);
    if (standInTradeOff(plan.config)) out.line("warn", JUDGE_WARNING);
  } else {
    printSlotChange(out, [
      change,
      `  ${targets.join(" → ")}  (${fallbackWords(plan.config, plan.key)})`,
      plan.now
        ? "  The next target answers when the one before it fails or rests."
        : "  Only the first target answers; when it fails, its error goes back to Claude Code.",
    ]);
  }
  out.verdict("ok", ROUTER_TAKES_IT);
  return 0;
}

/** The chain's display, shared by status and an effort change. */
export function chainWithEffort(
  targets: readonly string[],
  pins: Readonly<Record<string, BackendEffort>> = {},
): string {
  return targets
    .map((target) => `${target}${Object.hasOwn(pins, target) ? ` [effort ${pins[target]}]` : ""}`)
    .join(" → ");
}

/** Refuse before any network request or write. */
function effortTarget(config: GatewayConfig, slot: string, target: string) {
  const key = slotKeyFromArg(slot);
  if (key === null) throw new Error(notSlotName(slot));
  const parsed = parseTarget(target);
  if ("error" in parsed) throw new Error(parsed.error);
  if (parsed.target.kind === "anthropic")
    throw new Error(
      "a Claude target cannot pin effort: Anthropic gets only the fields its model refuses changed",
    );
  if (!Object.hasOwn(config.slots, key) || !config.slots[key]?.includes(target))
    throw new Error(`${target} is not in ${key}'s chain`);
  const backend = config.backends[parsed.target.backend];
  if (backend === undefined) throw new Error(`backend ${parsed.target.backend} is not configured`);
  return { backend, key, model: parsed.target.model };
}

async function commandEffort(ctx: GatewayContext, args: string[]): Promise<number> {
  const [slot, target, level, ...extra] = args;
  if (slot === undefined || target === undefined || level === undefined || extra.length > 0) {
    ctx.error(USAGE);
    return 2;
  }
  const parsed = z.enum(BACKEND_EFFORT_LEVELS).safeParse(level);
  if (level !== "off" && !parsed.success)
    throw new Error(`effort must be ${BACKEND_EFFORT_LEVELS.join(", ")}, or off`);
  const pin = parsed.success ? parsed.data : undefined;
  const path = ctx.paths.gatewayConfigFile;
  const before = loadConfigFile(path);
  const checked = effortTarget(before, slot, target);
  if (pin !== undefined) {
    const result = await sendBackendTest(
      checked.backend.baseUrl,
      checked.backend.apiKey,
      effortPinForBackend(judgeTestRequest(checked.model), pin),
      ctx.apiFetch,
    );
    if ("error" in result)
      throw new Error(`${target} refused effort ${pin}: ${result.error}. Nothing was saved.`);
    if (checked.key === JUDGE_SLOT && judgeVerdict(result.body).verdict !== "block")
      throw new Error(
        `${target} did not block the judge test at effort ${pin}. Nothing was saved.`,
      );
  }
  const now = await withLock(
    ctx.paths.stateDir,
    () => {
      const config = loadConfigFile(path);
      const current = effortTarget(config, slot, target);
      if (
        current.backend.baseUrl !== checked.backend.baseUrl ||
        current.backend.apiKey !== checked.backend.apiKey ||
        JSON.stringify(config.slots[current.key]) !== JSON.stringify(before.slots[checked.key]) ||
        effortPin(config, current.key, target) !== effortPin(before, checked.key, target)
      ) {
        throw new Error(
          "the backend, chain or effort changed while testing. Nothing was saved; try again.",
        );
      }
      const pins = { ...config.effort?.[current.key] };
      if (pin === undefined) delete pins[target];
      else pins[target] = pin;
      const next = withEffort(config, current.key, pins);
      saveConfig(path, next);
      return next;
    },
    { waitMs: 10_000 },
  );
  const out = gatewayOut(ctx);
  out.line(
    "ok",
    `${checked.key}: ${chainWithEffort(now.slots[checked.key] ?? [], now.effort?.[checked.key])}`,
  );
  out.verdict("ok", ROUTER_TAKES_IT);
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
  const out = gatewayOut(ctx);
  printSlotChange(out, [
    `${plan.key}: breaker ${plan.was ? "on" : "off"} → ${plan.now ? "on" : "off"}`,
    `  ${targets.join(" → ")}  (${breakerWords(plan.config, plan.key) ?? ""})`,
    plan.now
      ? "  While every target is limited or down, the request waits a little and then Claude Code is asked to retry."
      : "  While every target is limited or down, the last answer goes back to Claude Code at once.",
  ]);
  out.verdict("ok", ROUTER_TAKES_IT);
  return 0;
}

function printOverrides(report: ReturnType<typeof settingsReport>, out: Out): void {
  if (report.subagentOverrides.length > 0) {
    out.line(
      "warn",
      `${report.subagentOverrides.join(", ")} set: every agent launched without a model runs on it, with the gateway possibly an affordable slot. Remove it by hand unless you want that.`,
      { indent: 2 },
    );
  }
  if (report.loginOverrides.length > 0) {
    out.line(
      "warn",
      `${report.loginOverrides.join(", ")} set: that replaces your own Claude login. Remove it for the gateway.`,
      { indent: 2 },
    );
  }
}

async function commandStatus(ctx: GatewayContext): Promise<number> {
  const out = gatewayOut(ctx);
  const configPath = ctx.paths.gatewayConfigFile;
  // No config is a gateway nobody set up yet, which is no failure: it is optional.
  const setUp = existsSync(configPath);
  let config: GatewayConfig | null = null;
  if (!setUp) out.line("info", `config: none yet (no ${tildify(configPath, ctx.paths.home)})`);
  else {
    try {
      config = loadConfigFile(configPath);
    } catch (error) {
      out.line("fail", `config: ${messageOf(error)}`);
    }
  }
  // Without a good config the router runs on the default port.
  const port = config?.port ?? DEFAULT_PORT;
  const health = await routerHealth(port, ctx.probe.fetch);
  if ("error" in health && !setUp) {
    // Nothing installed it yet: the verdict names setup, the one step.
    out.line("info", `router: DOWN on 127.0.0.1:${port} (${health.error})`);
  } else if ("error" in health) {
    out.line("fail", `router: DOWN on 127.0.0.1:${port} (${health.error})`, {
      detail: [`${COMMAND} gateway setup`],
      fix: "setup starts it again",
    });
  } else {
    const body = isJsonObject(health.body) ? health.body : {};
    out.line(
      "ok",
      `router: up on 127.0.0.1:${String(body.port)} for ${String(body.uptimeSec)} s, ${String(body.requests)} requests, ${String(body.fallbacks)} fallbacks`,
    );
    if (body.port !== port) {
      out.line("warn", `the config says port ${port}; restart the router to move it`, {
        indent: 2,
      });
    }
    const cooling = isJsonObject(body.cooling) ? Object.entries(body.cooling) : [];
    for (const [target, seconds] of cooling) {
      out.line("info", `resting: ${target} for ${String(seconds)} s more`, { indent: 2 });
    }
    for (const line of breakerStatusLines(body.breakers, ctx.probe.now())) {
      out.line("warn", line.trimStart(), { indent: 2 });
    }
  }
  let backendsAnswer = true;
  if (config !== null) {
    for (const [name, backend] of Object.entries(config.backends)) {
      const listed = await listModels(backend.baseUrl, backend.apiKey);
      const state = "error" in listed ? `unreachable (${listed.error})` : `HTTP ${listed.status}`;
      const answers = !("error" in listed) && listed.status === 200;
      if (!answers) backendsAnswer = false;
      out.line(
        answers ? "ok" : "fail",
        `backend ${name}: ${shownValue(backend.baseUrl)} key ${maskKey(backend.apiKey)} → ${state}`,
      );
    }
    printSlots(config, out, ctx.print);
  }
  const report = settingsReport(ctx.paths.settingsFile);
  // `gateway off` leaves Anthropic's own address in the file (GP5), so "the key is set" is not
  // the question: `baseUrlPointsAtGateway` answers whether Claude Code goes through a gateway.
  const pointsAtGateway = baseUrlPointsAtGateway(report.baseUrl);
  out.blank();
  out.line(
    "info",
    `Claude Code (${tildify(ctx.paths.settingsFile, ctx.paths.home)}): ${
      pointsAtGateway
        ? `gateway ON → ${report.baseUrl}`
        : `gateway OFF (${report.baseUrl === null ? "no ANTHROPIC_BASE_URL" : report.baseUrl})`
    }`,
  );
  // A base URL that is not this router's (a port moved, a value set by hand) fails every
  // session that uses it, while the router itself answers. Anthropic's own address is not one
  // of those: it is a session that uses plain Claude, on the person's own login.
  const routerUrl = gatewayEnv(port).ANTHROPIC_BASE_URL;
  const pointsElsewhere = config !== null && pointsAtGateway && report.baseUrl !== routerUrl;
  if (pointsElsewhere) {
    out.line("warn", `that is not this router's address (${routerUrl})`, {
      detail: [`${COMMAND} gateway on`],
      fix: "point Claude Code at this router",
      indent: 2,
    });
  }
  printOverrides(report, out);
  out.line(
    "info",
    `history: ${historyWords({
      bytes: historyDbBytes(ctx.paths.historyDbFile),
      exists: historyDbExists(ctx.paths.historyDbFile),
      retentionDays: config === null ? HISTORY_RETENTION_DAYS : historyRetentionDays(config),
    })} in ${tildify(ctx.paths.historyDbFile, ctx.paths.home)}`,
  );
  // One verdict, the worst finding first; each fix is on its own line above.
  if (!setUp) {
    out.verdict("info", "The gateway is not set up.");
    out.next([{ command: `${COMMAND} gateway setup`, text: "Set it up:" }]);
  } else if (config === null) out.verdict("fail", "The gateway's config cannot be read.");
  else if ("error" in health) out.verdict("fail", "The router does not answer.");
  else if (pointsElsewhere) {
    out.verdict("warn", "Claude Code points at another address than this router.");
  } else if (!backendsAnswer) {
    out.verdict("warn", "The router answers, and a backend does not.");
  } else if (!pointsAtGateway) {
    out.verdict("info", "The router answers, and Claude Code does not use it.");
    out.next([
      {
        command: `${COMMAND} gateway on`,
        text: "Point every Claude Code session on this machine at it:",
      },
    ]);
  } else out.verdict("ok", "The gateway is on, and its router and backends answer.");
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
    "Cost is estimated: Claude at its list price, a backend at the price its own list gives. A request with no price is counted in the last column and adds nothing to cost.",
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
    "no price",
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
      unpriced: 0,
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
      // A row with no price is counted here, never added to `cost` as $0 (F1).
      total.unpriced += point.unpriced;
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
      count(total.unpriced),
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
 * Empty means the person gave nothing: setup stops before it writes anything. Null: Ctrl+C at
 * the question.
 */
async function omniroutePassword(ctx: GatewayContext, fromStdin: boolean): Promise<null | string> {
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
  // Ctrl+C: the caller stops, and says so.
  if (value === null) return null;
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
  let key: null | SetupKey = null;
  let password: null | string = null;
  /** The answers to the questions on a terminal; null when nothing was asked. */
  let answers: null | SetupAnswers = null;
  /** A key this run made in OmniRoute: deleted again unless the run saves it. */
  let discard: MadeKey | null = null;
  if (options.keyBackend !== null) {
    const value = (await ctx.readStdin()).trim();
    if (value === "") throw new Error("no key on stdin");
    key = { backend: options.keyBackend, value };
  }
  if (options.omniroutePassword || options.omniroutePasswordStdin) {
    password = await omniroutePassword(ctx, options.omniroutePasswordStdin);
    if (password === null) {
      ctx.error(STOPPED);
      return INTERRUPTED_EXIT;
    }
  }
  // On a terminal, with no flag that answers them: every question first, the changes after.
  const asks =
    ctx.prompts !== undefined &&
    ctx.prompts !== null &&
    !options.yes &&
    !options.noKey &&
    options.keyBackend === null &&
    !options.omniroutePassword &&
    !options.omniroutePasswordStdin;
  if (asks && ctx.prompts) {
    // The port first, as everywhere in setup: nobody answers questions for a port another
    // program holds, and OmniRoute is not called for it.
    await checkRouterPort({
      port: configuredPort(configPath),
      probe: ctx.probe,
      runner: ctx.runner,
      service,
    });
    const asked = await askSetupQuestions(ctx.prompts, setupFacts(ctx));
    if ("stopped" in asked) {
      ctx.error(STOPPED);
      return INTERRUPTED_EXIT;
    }
    if ("error" in asked) throw new Error(asked.error);
    answers = asked.answers;
    const saved = savedOmniroute(configPath);
    const value = answers.key ?? saved?.apiKey;
    // Enter kept the saved key at the saved address: there is no key to check or save.
    if (value !== undefined && (answers.key !== null || saved?.baseUrl !== answers.baseUrl)) {
      key = { backend: OMNIROUTE, baseUrl: answers.baseUrl, value };
    }
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
    const made = await keyFromPassword(ctx, configPath, password);
    key = made.key;
    discard = made.made;
  }

  let code: number;
  try {
    /** Why a key was saved without its backend accepting it, for the closing line. Empty: checked. */
    const unchecked =
      key === null
        ? ""
        : await checkKeyToSave(ctx, configPath, key, {
            saveUnchecked: options.saveUnchecked,
            ...(answers === null ? {} : { again: SETUP_AGAIN }),
          });

    code = await withLock(
      paths.stateDir,
      async () => {
        // How many backups the config already has, so the line below is said only when THIS run
        // made one — `ensureConfig` backs the file up only when the key really changes.
        const backups = backupDir(paths.stateDir, configPath);
        const backupsBefore = backupCount(backups);
        const said = ensureConfig(configPath, key, {
          allowNone: options.noKey,
          stateDir: paths.stateDir,
        });
        ctx.print(said.replaceAll(configPath, tildify(configPath, paths.home)));
        const keyBackedUp = key !== null && backupCount(backups) > backupsBefore;
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
        if (answers !== null) saveAnsweredChains(ctx, answers);
        const now = existsSync(configPath) ? loadConfigFile(configPath) : null;
        if (now !== null && Object.keys(now.slots).length === 0) {
          const saved = Object.keys(now.kept ?? {}).length;
          ctx.print(
            saved > 0
              ? `Every slot is Claude, so every Claude model stays plain Claude. ${String(saved)} saved chain(s) are not in use: ${COMMAND} gateway status lists them, and ${COMMAND} gateway slot <slot> custom uses one again.`
              : `Every slot is off, so every Claude model stays plain Claude. Pick the models yourself: ${COMMAND} gateway models, then ${COMMAND} gateway slot <slot> <targets> (or the portal's Slots page).`,
          );
        }
        if (keyBackedUp) ctx.print(keyBackupLine(backups, paths.home));
        if (unchecked !== "") ctx.print(`  ! ${uncheckedKeyWords(unchecked)}`);
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
        if (
          !baseUrlPointsAtGateway(settingsReport(paths.settingsFile).baseUrl) &&
          answers?.turnOn !== true
        ) {
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
    return await discardMadeKey(discard, error);
  }
  // After the try, never inside it: the key is saved by now, and a failure here must not
  // delete it again. This step catches its own.
  if (code === 0) await proveWorkerTargets(ctx);
  if (code === 0 && answers?.turnOn === true) return await commandOn(ctx);
  return code;
}

/** How to try setup's questions again: the stdin flag would check the key at the old address. */
const SETUP_AGAIN = `${COMMAND} gateway setup (on this terminal it asks the address and the key again)`;

/** What `setup` says when the person stopped it at a question (Ctrl+C): exit 130. */
const STOPPED = "Stopped. Nothing was changed.";

/** The backend `setup` asks about, makes a key in and saves the address of. */
const OMNIROUTE = "omniroute";

/** OmniRoute's address and key in the config; null with no config, or no OmniRoute in it. */
function savedOmniroute(configPath: string): null | { apiKey: string; baseUrl: string } {
  if (!existsSync(configPath)) return null;
  const { backends } = loadConfigFile(configPath);
  return Object.hasOwn(backends, OMNIROUTE) ? (backends[OMNIROUTE] ?? null) : null;
}

/**
 * The facts `setup`'s questions are asked from (`askSetupQuestions`): the config as it is now,
 * the live model list through the context's own fetch (a test's fake, so no test reaches a real
 * OmniRoute), and `planSlotChange`'s checks for a chain, against the address and key answered.
 */
function setupFacts(ctx: GatewayContext): Parameters<typeof askSetupQuestions>[1] {
  const configPath = ctx.paths.gatewayConfigFile;
  const config = existsSync(configPath) ? loadConfigFile(configPath) : null;
  return {
    backend: OMNIROUTE,
    label: "OmniRoute",
    saved: savedOmniroute(configPath),
    hasConfig: config !== null,
    defaultBaseUrl: KNOWN_BACKENDS[OMNIROUTE] ?? "",
    slots: Object.entries(FAMILY_SLOTS).map(([key, family]) => ({
      chain: config?.slots[key] ?? [],
      family,
      key,
      name: slotName(key),
    })),
    claudeWords: SLOT_WORDS.claude,
    listModels: async ({ apiKey, baseUrl }) => {
      const listed = await listModels(baseUrl, apiKey, LIST_MODELS_TIMEOUT_MS, ctx.apiFetch);
      if ("error" in listed) return { reason: listed.error };
      if (listed.status !== 200) return { reason: `HTTP ${String(listed.status)}` };
      return { ids: listed.models.map((model) => model.id) };
    },
    checkChain: (slot, text, ids, backend) => {
      const base = config ?? defaultConfig(backend.apiKey, backend.baseUrl);
      const answered = { apiKey: backend.apiKey, baseUrl: backend.baseUrl };
      const withBackend = { ...base, backends: { ...base.backends, [OMNIROUTE]: answered } };
      const plan = planSlotChange(withBackend, slot, text, { [OMNIROUTE]: ids });
      return "error" in plan ? plan.error : null;
    },
    gatewayOn: baseUrlPointsAtGateway(settingsReport(ctx.paths.settingsFile).baseUrl),
    keyFlags: `${COMMAND} gateway setup --backend-key-stdin ${OMNIROUTE} < key-file, or --omniroute-password`,
    pickLater: `${COMMAND} gateway models, then ${COMMAND} gateway slot <slot> <targets>`,
    print: ctx.print,
  };
}

/** How long setup waits for OmniRoute's model list before it asks no slot question. */
const LIST_MODELS_TIMEOUT_MS = 10_000;

/**
 * The chains answered at setup's questions, saved under setup's lock into the config as it is
 * then (the key and the address are in it by now). Each is planned again here: a chain another
 * command made impossible since the question is said in one line and left as it is, never a
 * failed setup.
 */
function saveAnsweredChains(ctx: GatewayContext, answers: SetupAnswers): void {
  const configPath = ctx.paths.gatewayConfigFile;
  for (const [slot, text] of Object.entries(answers.chains)) {
    const plan = planSlotChange(loadConfigFile(configPath), slot, text, {
      [OMNIROUTE]: answers.ids,
    });
    if ("error" in plan) {
      ctx.print(`! ${slot} stays as it was: ${plan.error}`);
      continue;
    }
    // A proof for a target no worker or judge chain holds any more goes, as with `gateway
    // slot`; the worker's new targets get theirs from `proveWorkerTargets`, after the lock.
    const next = plan.key === WORKER_SLOT ? withJudgeProofs(plan.config, {}) : plan.config;
    saveConfig(configPath, next);
    if (plan.next.length === 0) dropFallbackRecord(ctx.paths.gatewayStateFile, plan.key);
    for (const line of slotChangeLines({ ...plan, config: next })) ctx.print(line);
  }
  const now = loadConfigFile(configPath);
  const judge = now.slots[JUDGE_SLOT] ?? [];
  const untested = judge.filter((target) => !judgeTargetUsable(now, target));
  if (untested.length > 0) {
    ctx.print(
      `! the judge chain's ${untested.join(", ")} has no test for ${OMNIROUTE}'s address now, so Claude judges until it is tested: ${COMMAND} gateway slot judge ${judge.join(",")}`,
    );
  }
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
    for (const line of tested.lines) ctx.print(line.text);
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
    // Setup's own report is plain lines with their marks written in.
    if (standInTradeOff(saved)) ctx.print(`! ${JUDGE_WARNING}`);
  } catch (error) {
    ctx.print(
      `! the judge test of the worker's targets could not finish (${messageOf(error)}). Run ${COMMAND} gateway setup again to retry it.`,
    );
  }
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
  const out = gatewayOut(ctx);
  // The installer puts the one line of a 0 or a 3 into its own line (`install.sh`,
  // `install.ps1`), so those stay one line; a 1 or a 4 carries its fix.
  const passwordSetup = `${COMMAND} gateway setup --omniroute-password`;
  const configPath = paths.gatewayConfigFile;
  /** No key anywhere: OmniRoute's own address decides whether one can be made. */
  const noKeyYet = async (why: string): Promise<number> => {
    const address = KNOWN_BACKENDS.omniroute ?? "";
    const probe = await probeOmniroute(address, {
      ...(ctx.apiFetch === undefined ? {} : { fetch: ctx.apiFetch }),
    });
    if (probe.kind === "silent") {
      out.line(
        "info",
        `${why}, and OmniRoute does not answer at ${address} (${probe.detail}): the gateway needs OmniRoute first`,
      );
      return CHECK_CODES.unchecked;
    }
    out.line("fail", `${why}, and OmniRoute answers at ${address}`, {
      detail: [passwordSetup],
      fix: "let setup make the router's key with OmniRoute's dashboard password",
    });
    return CHECK_CODES.needsKey;
  };

  if (!existsSync(configPath))
    return noKeyYet(`the gateway has no config yet (no ${tildify(configPath, paths.home)})`);
  let config: GatewayConfig;
  try {
    config = loadConfigFile(configPath);
  } catch (error) {
    out.line("info", `the gateway could not be checked: ${messageOf(error)}`);
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
    out.line(
      "ok",
      `the gateway's OmniRoute key is accepted (${shownValue(backend.baseUrl)}, HTTP ${String(check.status)})`,
    );
    return CHECK_CODES.works;
  }
  if (check.kind === "refused") {
    // The backend answered, so it is there: the key in the file is what needs replacing.
    out.line(
      "fail",
      `OmniRoute refused the key in ${tildify(configPath, paths.home)} (HTTP ${String(check.status)}): it is not an OmniRoute API key`,
      {
        detail: [
          `${COMMAND} gateway setup --backend-key-stdin omniroute < key-file`,
          passwordSetup,
        ],
        fix: "give a new one, or let setup make one with OmniRoute's dashboard password",
      },
    );
    return CHECK_CODES.refused;
  }
  out.line("info", `the gateway could not be checked: ${check.detail}`);
  return CHECK_CODES.unchecked;
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
  const out = gatewayOut(ctx);
  if (result.changes.length === 0) {
    out.verdict("ok", "Nothing to change: the gateway is already on.");
  } else {
    printChanges(out, result, paths.home);
    out.verdict(
      "ok",
      `Done. The changed file has a backup in ${tildify(paths.stateDir, paths.home)}/backups/.`,
    );
    out.say(
      "Every Claude Code session on this machine, in every folder, uses the gateway from now on: each Claude model's work (background titles and summaries too) goes to the slot of its family when that slot has a chain, and to Anthropic unchanged when it has none.",
    );
  }
  printOverrides(settingsReport(paths.settingsFile), out);
  return 0;
}

/**
 * A project whose own files keep it on the router: the line `gateway off` prints, with the
 * command that turns it off. The state is the project's own choice (`projectStateOf`, the one
 * reader `gateway project status` and the doctor use), never its effective value: a project
 * with no key follows this machine, and this machine is now off.
 */
interface StayingProject {
  project: KnownProject;
  view: ProjectGatewayState;
}

/**
 * The projects whose own value still points at the router after the machine's gateway keys are
 * gone. Empty when the caller wired no project list (the portal's collector, a test); a list
 * that cannot be read is said once as information — the machine's keys are already off, and
 * no project line is guessed.
 */
async function projectsStillOn(ctx: GatewayContext): Promise<StayingProject[]> {
  if (ctx.projects === undefined) return [];
  let list: KnownProjects;
  try {
    list = await ctx.projects(process.cwd());
  } catch (error) {
    gatewayOut(ctx).line(
      "info",
      `the projects list could not be read (${messageOf(error)}), so projects of yours were not checked`,
    );
    return [];
  }
  return list.projects
    .map((project) => ({ project, view: projectStateOf(ctx, project.root) }))
    .filter((one) => one.view.choice.state === "on");
}

async function commandOff(ctx: GatewayContext): Promise<number> {
  const { paths } = ctx;
  const { result, foreign, switched } = await withLock(
    paths.stateDir,
    () => turnOff({ settingsFile: paths.settingsFile, stateDir: paths.stateDir }),
    { waitMs: 10_000 },
  );
  const out = gatewayOut(ctx);
  printChanges(out, result, paths.home);
  // A key of the person's own that already holds Anthropic's address sends every session
  // exactly where `off` would: it routes nothing, and "the gateway is not all off" would be
  // untrue (`baseUrlPointsAtGateway`, GP5). A file that cannot be read counts as routing.
  let ownAddressRoutes = true;
  try {
    ownAddressRoutes = baseUrlPointsAtGateway(readGatewaySettings(paths.settingsFile).baseUrl);
  } catch {
    ownAddressRoutes = true;
  }
  // ENABLE_TOOL_SEARCH routes nothing, and many people set it themselves: theirs to keep.
  const routing = foreign.filter(
    (key) => key !== "ENABLE_TOOL_SEARCH" && !(key === BASE_URL_KEY && !ownAddressRoutes),
  );
  for (const key of foreign) {
    if (key === BASE_URL_KEY && !ownAddressRoutes) {
      out.line(
        "info",
        `env.${key} stays: ${COMMAND} did not set it, and it already points at Anthropic`,
      );
      continue;
    }
    if (!routing.includes(key)) {
      out.line("info", `env.${key} stays: ${COMMAND} did not set it, and it routes nothing`);
      continue;
    }
    out.line("warn", `env.${key} stays: ${COMMAND} did not set it`, {
      fix: "remove it by hand to turn the gateway off",
    });
  }
  // This machine's value is gone, but a project's own `on` still sends its sessions to the
  // router: name each one, and the command that turns it off too (GP4a).
  const staying = await projectsStillOn(ctx);
  for (const { project, view } of staying) {
    out.line(
      "warn",
      `${tildify(project.root, paths.home)} stays on: ${decisionWords(view.choice)}  · from ${projectSourceWords(view.choice, paths.home, view)}`,
      { fix: `${COMMAND} gateway project off --folder ${shellWord(project.root)}` },
    );
  }
  if (routing.length > 0) {
    out.verdict(
      "warn",
      `The gateway is not all off: ${plural(routing.length, "key stays", "keys stay")} that ${COMMAND} did not set.`,
    );
  } else if (staying.length > 0) {
    out.verdict(
      "warn",
      `The gateway is off on this machine; ${plural(staying.length, "project still points", "projects still point")} at the router (above).`,
    );
  } else if (result.changes.length === 0) {
    // Nothing moved: this machine was never on, or it is off already (the address key holds
    // Anthropic's own value — the very thing `off` writes, GP5).
    out.verdict(
      "ok",
      settingsReport(paths.settingsFile).baseUrl === null
        ? `Nothing to change: ${COMMAND} set no gateway key in ${tildify(paths.settingsFile, paths.home)}.`
        : "Nothing to change: the gateway is already off.",
    );
  } else {
    out.verdict("ok", "Done. The gateway is off.");
    if (switched) {
      out.say(
        "Every running Claude session switches to Anthropic by itself, within about a second: the address is changed, not removed. A session started from now on uses your own Claude login.",
      );
    }
    // Removals a running session does not follow: it keeps whatever it started with. The
    // tool-search key routes nothing; a retired model key sends the old slot name to Anthropic,
    // which does not know it, so the session fails until it restarts.
    const removed = result.changes.filter((change) => change.after === undefined);
    if (removed.some((change) => change.path[1] === "ENABLE_TOOL_SEARCH")) {
      out.next([
        "env.ENABLE_TOOL_SEARCH is removed, and applies at each session's next restart: it routes nothing.",
      ]);
    }
    if (removed.some((change) => RETIRED_GATEWAY_ENV_KEYS.includes(change.path[1] as string))) {
      out.next([
        "The retired model keys are removed, and apply at each session's next restart: until then a running session sends its slot name to Anthropic and fails.",
      ]);
    }
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
    case "effort":
      return commandEffort(ctx, rest);
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
    case "project":
      return commandProject(ctx, rest, USAGE);
    case "projects":
      return commandProjects(ctx, rest, USAGE);
    case "profile":
      return commandProfile(ctx, rest, USAGE);
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
