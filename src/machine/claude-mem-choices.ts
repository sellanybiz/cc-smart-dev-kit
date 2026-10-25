import { existsSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { type GatewayConfig, loadConfigFile } from "../gateway/config";
import { backendAddress } from "../gateway/settings";
import { findUserInstall } from "../setup/installed-plugins";
import { withLock } from "../setup/lock";
import {
  applyManagedJson,
  ForeignKeyError,
  formatKeyPath,
  getKey,
  hashOf,
  type JsonObject,
  type KeyPath,
  type ManagedJsonResult,
  type OwnedRecord,
  ownedRecords,
  ownership,
  readJsonObject,
  samePath,
} from "../setup/managed-json";
import { listBackups, realTarget } from "../setup/write";
import {
  type AffordableTarget,
  API_KEY,
  API_KEY_POOL,
  applyClaudeMem,
  BASE_URL,
  type ChoiceRecord,
  CLAUDE_FALLBACK_SINCE,
  CLAUDE_MEM_ID,
  CLAUDE_MEM_MIN_VERSION,
  CLAUDE_MODEL,
  CLAUDE_PROVIDER,
  type ClaudeMemPlan,
  type ClaudeMemSettings,
  CUSTOM_PRESET,
  checkAffordableTarget,
  claudeMemPlan,
  compatBaseUrl,
  FALLBACK_MODEL,
  FALLBACK_OFF,
  FALLBACK_PROVIDER,
  isOldNestedForm,
  isPersonsChoice,
  isSecretPath,
  MODEL,
  OPENAI_COMPATIBLE,
  OPENROUTER,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  OPENROUTER_KEYS,
  OPENROUTER_MODEL,
  PRESET,
  PROVIDER,
  PROVIDER_KEYS,
  readChoices,
  readClaudeMemSettings,
  shownClaudeMemValue,
  unchosen,
  writeChoices,
} from "./claude-mem";
import { comparableVersion } from "./companions";

/**
 * claude-mem's route and model, its key and its quota fallback, as the person sets them from
 * the portal's Machine page (PM1, owner 2026-10-23). setup follows the scout slot on its own
 * (`claude-mem.ts`); this is the person choosing, so the value is theirs:
 *
 *   - every write goes through `applyManagedJson` (backup, atomic write, setup's lock), with the
 *     key named `secret`, so the file stays mode 600 and no answer, log or error ever holds it;
 *   - each written key is owned, so `restore` takes it out, and recorded in `CHOICES_FILE`, so
 *     a later `setup` leaves it as the person's (`isPersonsChoice`);
 *   - a key the person set by hand in claude-mem's file is never overwritten (`ForeignKeyError`,
 *     in words): they change it there, or remove it to set it here;
 *   - a route, a key or a fallback that sends work to a backend is checked first with one tiny
 *     chat (`checkAffordableTarget`), so claude-mem is never left on a model, a key or an
 *     address that does not answer. Nothing is written when it fails.
 *
 * **A backend fallback needs a provider the route does not hold.** claude-mem ignores a
 * fallback whose provider is the route's own, so a route already on `openai-compatible` takes
 * claude-mem's OpenRouter setup instead, pointed at the same backend and model
 * (`fallbackProviderFor`). Both reach the same endpoint: claude-mem appends `/chat/completions`
 * to that address exactly as its custom preset does. A person who really uses OpenRouter keeps
 * their own address there, and it is refused like any other hand-set value.
 *
 * claude-mem reads its settings file each time it uses it (13.40.0's `loadFromFile`), so a
 * change needs no restart. Its facts, read in its own 13.40.0 `worker-service.cjs`:
 *   - an empty `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` means Claude: `A1()` answers
 *     `e===""?"claude":…`;
 *   - a fallback whose provider equals the route's never takes over: `E4e(t)` answers
 *     `r===null||r===t||!ybr(r)||qC(r,e)?null:r`, and `BE` then keeps the route's provider;
 *   - `CLAUDE_MEM_QUOTA_FALLBACK_MODEL` is applied to a Claude fallback alone
 *     (`applyQuotaFallbackModel` returns unless the provider is `claude`); empty, claude-mem's
 *     own `CLAUDE_MEM_MODEL` runs instead;
 *   - the OpenRouter provider reads `CLAUDE_MEM_OPENROUTER_BASE_URL`, `_MODEL` and
 *     `_API_KEY` (`t4e`), needs that key (`E1` answers `!!t4e(t).apiKey`), and sends to
 *     `bI(baseUrl)` — the address with `/chat/completions` on it.
 * Also from claude-mem 13.40.0: the settings defaults and `validateSettings` (which accepts
 * `openrouter` as a fallback provider whatever the route is), and its CHANGELOG (13.29.0
 * brought the openai-compatible provider and the fallback; 13.37.0 made Claude its default).
 */

/** Who put a value there. */
export type ClaudeMemSource =
  /** claude-mem's own default: the key is missing, or holds what claude-mem seeded. */
  | "default"
  /** cc-smart-dev-kit's setup, following the scout slot. */
  | "setup"
  /** The person, from the portal. */
  | "portal"
  /** The person, by hand in claude-mem's file (or a value setup wrote and they changed). */
  | "hand";

/** claude-mem's state, as the Machine page's card reads it. Never holds the key. */
export interface ClaudeMemFacts {
  /** claude-mem's settings file, with `~` for the home folder. */
  file: string;
  /** The installed version; null when claude-mem is not installed or its version is unknown. */
  version: null | string;
  /** The oldest claude-mem that has what the card sets. */
  minVersion: string;
  /**
   * Why the card cannot set anything now (not installed, too old, a file it cannot read or in
   * claude-mem's old form), with the command that fixes it; null when it can.
   */
  blocked: null | { fix: null | string; text: string };
  /** The values now; null when `blocked` says why they cannot be read. */
  current: null | ClaudeMemCurrent;
  /** The gateway's backends by name; null when the gateway is not set up (no backend to pick). */
  backends: null | string[];
  /**
   * The keys set by hand that refuse a choice now (`refusedByHand`), by name, never with a
   * value. Empty when nothing is the person's to give up. The take-over records them as the
   * kit's, and `restore` puts them back.
   */
  handKeys: string[];
}

/** claude-mem's values now, each with where it came from. */
export interface ClaudeMemCurrent {
  route: {
    /** Claude on the person's login, an OpenAI-compatible backend, or another provider. */
    kind: "backend" | "claude" | "other";
    /** claude-mem's own provider value (`claude`, `openai-compatible`, `gemini`, …). */
    provider: string;
    /** `<backend>:<model>` when claude-mem's address is a gateway backend's; else null. */
    target: null | string;
    /** The backend's model, or claude-mem's Claude model on the Claude route. */
    model: null | string;
    /** The backend's address, without a user name, password, query or fragment. */
    address: null | string;
    source: ClaudeMemSource;
    /** True when a change here is refused now because one of its keys is set by hand. */
    refusedByHand: boolean;
  };
  key: {
    /**
     * The OpenAI-compatible key: none, the same key the gateway holds for that backend, or
     * another one. Never the key itself.
     */
    state: "gateway" | "none" | "other";
    /** True when the person's own key pool is set too (claude-mem tries the key first). */
    pool: boolean;
    source: ClaudeMemSource;
    /** True when a change here is refused now because the key is set by hand. */
    refusedByHand: boolean;
  };
  fallback: {
    /** The provider that takes over while the route's is limited, or `off`, as claude-mem reads it. */
    provider: string;
    /** A Claude fallback's model as the person set it; null when claude-mem's own applies. */
    model: null | string;
    /**
     * The Claude model a Claude fallback really runs on: the person's fallback model, else
     * claude-mem's own Claude model (`CLAUDE_MEM_MODEL`). Null when neither is set (claude-mem's
     * built-in default applies), and null for a fallback that is not Claude.
     */
    claudeModel: null | string;
    /** A backend fallback's `<backend>:<model>`, when its address is a gateway backend's. */
    target: null | string;
    /** Why it can never take over now (the same provider as the route); null when it can. */
    idle: null | string;
    source: ClaudeMemSource;
    /** True when a change here is refused now because one of its keys is set by hand. */
    refusedByHand: boolean;
  };
}

/** What one write found, in lines the page shows. */
export interface ChoiceResult {
  ok: boolean;
  lines: string[];
}

/** Where claude-mem's summaries go: Claude on the person's login, or a gateway backend's model. */
export type RouteChoice = { kind: "claude" } | { kind: "backend"; backend: string; model: string };

/** claude-mem's key: the one the gateway holds for that backend, or one the person pastes. */
export type KeyChoice = { kind: "gateway" } | { kind: "other"; key: string };

/** claude-mem's quota fallback: off, Claude (its own model, or one named), or a backend model. */
export type FallbackChoice =
  | { kind: "off" }
  | { kind: "claude"; model: null | string }
  | { kind: "backend"; backend: string; model: string };

/** The tiny chat a backend choice is checked with; a test hands in its own. */
export type TargetCheck = (target: AffordableTarget) => Promise<string | null>;

/** The longest key the card takes: a pasted key, never a document. */
const KEY_MAX = 512;

/** The settings, or the words for why the card cannot read or set them. */
function readReady(
  paths: CliPaths,
):
  | { blocked: NonNullable<ClaudeMemFacts["blocked"]>; version: null | string }
  | { read: ClaudeMemSettings; version: string } {
  const install = findUserInstall(paths.installedPluginsFile, CLAUDE_MEM_ID);
  if (install === null || !existsSync(install.installPath)) {
    return {
      blocked: {
        fix: `claude plugin install ${CLAUDE_MEM_ID}`,
        text: "claude-mem is not installed, so there is nothing to set.",
      },
      version: null,
    };
  }
  const version = comparableVersion(install.version);
  if (version === null || Bun.semver.order(version, CLAUDE_MEM_MIN_VERSION) < 0) {
    return {
      blocked: {
        fix: `claude plugin update ${CLAUDE_MEM_ID}`,
        text:
          version === null
            ? `claude-mem's version ${install.version ?? "(none)"} is unknown, so the kit cannot tell whether it has the openai-compatible provider and the fallback (${CLAUDE_MEM_MIN_VERSION} or newer).`
            : `claude-mem ${install.version} is older than ${CLAUDE_MEM_MIN_VERSION}, which brought the openai-compatible provider and the fallback.`,
      },
      version: install.version,
    };
  }
  const read = readClaudeMemSettings(paths);
  if ("problem" in read) return { blocked: { fix: null, text: read.problem }, version };
  if (isOldNestedForm(read.data)) {
    return {
      blocked: {
        fix: null,
        text: `${read.short} is in claude-mem's old nested form, which claude-mem rewrites when it next starts. Start a Claude Code session, then come back.`,
      },
      version,
    };
  }
  return { read, version };
}

/** The gateway's config, or null when it is not set up or cannot be read. */
function gatewayConfig(paths: CliPaths): GatewayConfig | null {
  if (!existsSync(paths.gatewayConfigFile)) return null;
  try {
    return loadConfigFile(paths.gatewayConfigFile);
  } catch {
    return null;
  }
}

/** A string key's value; "" when it is missing or not a string. */
function textOf(read: ClaudeMemSettings, key: string): string {
  const current = getKey(read.data, read.at(key));
  return typeof current.value === "string" ? current.value : "";
}

/** Who put this key's value there. */
function sourceOf(read: ClaudeMemSettings, key: string): ClaudeMemSource {
  if (isPersonsChoice(read, key)) return "portal";
  const path = read.at(key);
  const current = getKey(read.data, path);
  // A missing key is claude-mem's own default, whoever wrote it before: one setup wrote and the
  // person removed holds nothing to refuse a choice with (`handRefusal` refuses found keys only).
  if (!current.found) return "default";
  const whose = ownership(read.records, path, current, unchosen);
  if (whose === "ours") return unchosen(path, current.value) ? "default" : "setup";
  if (whose === "none" && unchosen(path, current.value)) return "default";
  return "hand";
}

/** The gateway backend whose OpenAI-compatible address claude-mem's base URL is, if any. */
function backendAt(
  config: GatewayConfig | null,
  baseUrl: string,
): null | { name: string; apiKey: string } {
  if (config === null || baseUrl === "") return null;
  const wanted = baseUrl.replace(/\/+$/, "");
  for (const [name, backend] of Object.entries(config.backends)) {
    if (compatBaseUrl(backend.baseUrl) === wanted) return { apiKey: backend.apiKey, name };
  }
  return null;
}

/**
 * The fallback provider claude-mem uses: its value, or the default for an empty one — Claude
 * since 13.37.0, none before it.
 */
function fallbackProvider(read: ClaudeMemSettings, version: string): string {
  const value = textOf(read, FALLBACK_PROVIDER);
  if (value !== "") return value;
  return Bun.semver.order(version, CLAUDE_FALLBACK_SINCE) >= 0 ? CLAUDE_PROVIDER : FALLBACK_OFF;
}

/** The route's provider: claude-mem dispatches an empty one to Claude. */
function routeProvider(read: ClaudeMemSettings): string {
  return textOf(read, PROVIDER) || CLAUDE_PROVIDER;
}

/**
 * The provider a backend fallback uses. claude-mem ignores a fallback whose provider is the
 * route's own (its worker answers no fallback when the two are equal), so a route already on
 * `openai-compatible` takes the OpenRouter setup and everything else takes the
 * OpenAI-compatible one — each pointed at the same backend, with the same model.
 */
function fallbackProviderFor(route: string): string {
  return route === OPENAI_COMPATIBLE ? OPENROUTER : OPENAI_COMPATIBLE;
}

/**
 * The keys the person set by hand in claude-mem's file that some choice really writes now, by
 * name, in one order. These are what a choice refuses now, and exactly what a take-over records
 * — the card and the command name these before the take-over asks. One home, so the three always
 * agree. claude-mem's OpenRouter three refuse nothing while no choice takes them (on a route not
 * on the compat provider the fallback holds the compat keys), so naming or taking them would be
 * untrue; they are named once a route change makes them the fallback's.
 */
function handSetKeys(read: ClaudeMemSettings): string[] {
  const refused = keysPerChoice(routeProvider(read));
  const writable = new Set([...refused.fallback, ...refused.key, ...refused.route]);
  return [...PROVIDER_KEYS, ...OPENROUTER_KEYS, FALLBACK_PROVIDER, FALLBACK_MODEL].filter(
    (one) => writable.has(one) && sourceOf(read, one) === "hand",
  );
}

/**
 * The keys each choice may write, so a value set by hand names the choices it refuses. The
 * compat four belong to the route while the route is on that provider and to the fallback
 * otherwise (`fallbackProviderFor`), so one hand-set value refuses one of the two — never both
 * by accident. The OpenRouter three are the fallback's alone; the key choice writes the compat
 * key only, as `chooseKey` does.
 */
function keysPerChoice(route: string): Record<"fallback" | "key" | "route", readonly string[]> {
  return {
    fallback: [
      ...(route === OPENAI_COMPATIBLE
        ? OPENROUTER_KEYS
        : ([PRESET, BASE_URL, MODEL, API_KEY] as const)),
      FALLBACK_MODEL,
      FALLBACK_PROVIDER,
    ],
    key: [API_KEY],
    route: PROVIDER_KEYS,
  };
}

/** claude-mem's state for the Machine page. Reads files only; never holds the key. */
export function readClaudeMemFacts(paths: CliPaths): ClaudeMemFacts {
  const config = gatewayConfig(paths);
  const ready = readReady(paths);
  const base = {
    backends: config === null ? null : Object.keys(config.backends).sort(),
    file: tildify(paths.claudeMemSettingsFile, paths.home),
    handKeys: [] as string[],
    minVersion: CLAUDE_MEM_MIN_VERSION,
  };
  if ("blocked" in ready) {
    return { ...base, blocked: ready.blocked, current: null, version: ready.version };
  }
  const { read, version } = ready;
  const provider = routeProvider(read);
  const kind =
    provider === CLAUDE_PROVIDER ? "claude" : provider === OPENAI_COMPATIBLE ? "backend" : "other";
  const baseUrl = textOf(read, BASE_URL);
  const backend = backendAt(config, baseUrl);
  const compatModel = textOf(read, MODEL);
  const key = textOf(read, API_KEY);
  const fallback = fallbackProvider(read, version);
  const fallbackModel = textOf(read, FALLBACK_MODEL);
  const claudeModel = textOf(read, CLAUDE_MODEL);
  // claude-mem has two OpenAI-shaped setups, each with its own address and model: the
  // OpenAI-compatible five (the route's, or a Claude route's fallback) and the OpenRouter three
  // (the fallback's, on a route that is already on the compat provider).
  const compatTarget =
    backend !== null && compatModel !== "" ? `${backend.name}:${compatModel}` : null;
  const openRouterBackend = backendAt(config, textOf(read, OPENROUTER_BASE_URL));
  const openRouterModel = textOf(read, OPENROUTER_MODEL);
  const openRouterTarget =
    openRouterBackend !== null && openRouterModel !== ""
      ? `${openRouterBackend.name}:${openRouterModel}`
      : null;
  const refused = keysPerChoice(provider);
  // The hand-set keys some choice really writes now — and so the choices a change to which is
  // refused.
  const handKeys = handSetKeys(read);
  const refusedByHand = (keys: readonly string[]): boolean =>
    keys.some((one) => handKeys.includes(one));
  return {
    ...base,
    blocked: null,
    current: {
      fallback: {
        claudeModel: fallback === CLAUDE_PROVIDER ? fallbackModel || claudeModel || null : null,
        idle:
          fallback === provider && fallback !== FALLBACK_OFF
            ? "It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider."
            : null,
        model: fallback === CLAUDE_PROVIDER && fallbackModel !== "" ? fallbackModel : null,
        provider: fallback,
        refusedByHand: refusedByHand(refused.fallback),
        source: sourceOf(read, FALLBACK_PROVIDER),
        target:
          fallback === OPENAI_COMPATIBLE
            ? compatTarget
            : fallback === OPENROUTER
              ? openRouterTarget
              : null,
      },
      key: {
        pool: textOf(read, API_KEY_POOL).trim() !== "",
        refusedByHand: refusedByHand(refused.key),
        source: sourceOf(read, API_KEY),
        state:
          key === "" ? "none" : backend !== null && backend.apiKey === key ? "gateway" : "other",
      },
      route: {
        address: kind === "claude" || baseUrl === "" ? null : backendAddress(baseUrl),
        kind,
        model: kind === "claude" ? claudeModel || null : compatModel === "" ? null : compatModel,
        provider,
        refusedByHand: refusedByHand(refused.route),
        source: sourceOf(read, kind === "backend" ? MODEL : PROVIDER),
        target: kind === "backend" ? compatTarget : null,
      },
    },
    handKeys,
    version,
  };
}

/**
 * The key a backend route or fallback uses: the person's own key when they set one (from the
 * portal, or by hand), else the gateway's own key for that backend — as setup uses it. `set`
 * is false when the key stays as it is. A key that is one of the gateway's own backend keys is
 * never "the person's own": it follows the backend, so moving from backend `a` to `b` never
 * sends `a`'s key to `b`.
 */
function keyFor(
  read: ClaudeMemSettings,
  keyName: string,
  gatewayKey: string,
  gatewayKeys: readonly string[],
  backendBaseUrl: string,
): { key: string; set: boolean } {
  const current = textOf(read, keyName);
  const source = sourceOf(read, keyName);
  // A key the kit took over holds a value it never wrote (`takeOver`), so it stays the person's:
  // a route change must not send their key away, nor replace it with a backend's own.
  const taken = read.records.some(
    (record) => record.taken === true && samePath(record.path, read.at(keyName)),
  );
  if (
    current !== "" &&
    !gatewayKeys.includes(current) &&
    (taken || source === "portal" || source === "hand")
  ) {
    // A taken-over key was set for one address. It stays the person's only while that address is
    // the backend's this write goes to; a route change to another backend takes the gateway's key
    // for that backend instead, so the person's key is never sent to another host.
    if (!taken || textOf(read, pairedAddress(keyName)) === compatBaseUrl(backendBaseUrl)) {
      return { key: current, set: false };
    }
  }
  return { key: gatewayKey, set: true };
}

/** The address a provider's key belongs to: the compat five's and the OpenRouter three's. */
function pairedAddress(keyName: string): string {
  return keyName === OPENROUTER_API_KEY ? OPENROUTER_BASE_URL : BASE_URL;
}

/** A backend's model as one of claude-mem's OpenAI-shaped providers takes it. */
interface ProviderKeys {
  set: Array<readonly [string, string]>;
  target: AffordableTarget;
}

/** The keys that point claude-mem's OpenAI-compatible provider at one gateway backend's model. */
function compatKeys(read: ClaudeMemSettings, backend: GatewayBackend, model: string): ProviderKeys {
  const baseUrl = compatBaseUrl(backend.baseUrl);
  const key = keyFor(read, API_KEY, backend.apiKey, backend.allKeys, backend.baseUrl);
  return {
    set: [
      [PRESET, CUSTOM_PRESET],
      [BASE_URL, baseUrl],
      [MODEL, model],
      ...(key.set ? [[API_KEY, key.key] as const] : []),
    ],
    target: { apiKey: key.key, backend: backend.name, baseUrl, model },
  };
}

/**
 * The keys that point claude-mem's OpenRouter provider at one gateway backend's model: the
 * same address and model the compat keys would hold, under that provider's own names. claude-mem
 * appends `/chat/completions` to the address, so both reach the backend's own endpoint.
 */
function openRouterKeys(
  read: ClaudeMemSettings,
  backend: GatewayBackend,
  model: string,
): ProviderKeys {
  const baseUrl = compatBaseUrl(backend.baseUrl);
  const key = keyFor(read, OPENROUTER_API_KEY, backend.apiKey, backend.allKeys, backend.baseUrl);
  return {
    set: [
      [OPENROUTER_BASE_URL, baseUrl],
      [OPENROUTER_MODEL, model],
      ...(key.set ? [[OPENROUTER_API_KEY, key.key] as const] : []),
    ],
    target: { apiKey: key.key, backend: backend.name, baseUrl, model },
  };
}

/** The keys one backend fallback writes, for the provider its route leaves free. */
function fallbackKeys(
  read: ClaudeMemSettings,
  backend: GatewayBackend,
  model: string,
  route: string,
): ProviderKeys {
  return fallbackProviderFor(route) === OPENROUTER
    ? openRouterKeys(read, backend, model)
    : compatKeys(read, backend, model);
}

/** A gateway backend by name, with its address and key, or the words for why there is none. */
function gatewayBackend(
  paths: CliPaths,
  name: string,
): { backend: GatewayBackend } | { why: string } {
  const config = gatewayConfig(paths);
  if (config === null) {
    return { why: "The gateway is not set up, so it has no backend for claude-mem to use." };
  }
  const backend = config.backends[name];
  if (backend === undefined) return { why: `The gateway has no backend named "${name}".` };
  return {
    backend: {
      allKeys: Object.values(config.backends).map((one) => one.apiKey),
      apiKey: backend.apiKey,
      baseUrl: backend.baseUrl,
      name,
    },
  };
}

/** One gateway backend as claude-mem uses it, and every backend key the gateway holds. */
interface GatewayBackend {
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Every backend's key: none of them is ever the person's own key (`keyFor`). */
  allKeys: string[];
}

/** One line per change, in setup's own words (`~ file: KEY: before -> after`), the key masked. */
function changeLines(result: ManagedJsonResult, short: string): string[] {
  return result.changes.map(
    (change) =>
      `~ ${short}: ${formatKeyPath(change.path)}: ${shownClaudeMemValue(change.path, change.before)} -> ${shownClaudeMemValue(change.path, change.after)}`,
  );
}

/**
 * The refusal of a write over a value the person set by hand (theirs: the kit never
 * overwrites it), in their words; null when every key may be set. Each chooser asks it before
 * its tiny chat, so a refused write sends no request at all.
 */
function handRefusal(
  read: ClaudeMemSettings,
  set: ReadonlyArray<readonly [string, string]>,
): ChoiceResult | null {
  for (const [key, value] of set) {
    const path = read.at(key);
    const current = getKey(read.data, path);
    if (current.found && current.value !== value && sourceOf(read, key) === "hand") {
      return {
        lines: [
          `Nothing was saved: ${key} is ${shownClaudeMemValue(path, current.value)} in ${read.short}, set by hand. Change it there, or remove it there to set it here.`,
        ],
        ok: false,
      };
    }
  }
  return null;
}

/** The keys a choice is planned from: the route's, the key's and the fallback's. */
const PLANNED_FROM = [
  ...PROVIDER_KEYS,
  FALLBACK_PROVIDER,
  FALLBACK_MODEL,
  ...OPENROUTER_KEYS,
] as const;

/** What a chooser read, to compare under the lock: the planned-from keys' values. */
function plannedFrom(read: ClaudeMemSettings): unknown[] {
  return PLANNED_FROM.map((key) => getKey(read.data, read.at(key)));
}

/** The refusal when claude-mem's settings changed between the chooser's read and the write. */
const CHANGED_MEANWHILE =
  "Nothing was saved: claude-mem's settings changed while the kit checked the model (another tab, setup, or claude-mem itself). Look at the card again, then choose again.";

/**
 * Writes the person's choice under setup's lock: the settings again, `applyManagedJson`, then
 * the choices file. The values the choice was planned from (`before`, the chooser's read) must
 * still be there: a tiny chat can take 30 seconds, and a write planned on an older file (the
 * key another tab pasted meanwhile) would undo a change unseen. A key the person set by hand
 * stops it in words, with nothing written.
 */
async function save(
  paths: CliPaths,
  before: ClaudeMemSettings,
  set: ReadonlyArray<readonly [string, string]>,
  done: string,
): Promise<ChoiceResult> {
  return withLock(paths.stateDir, () => {
    const ready = readReady(paths);
    if ("blocked" in ready) return { lines: [ready.blocked.text], ok: false };
    const { read } = ready;
    if (!Bun.deepEquals(plannedFrom(read), plannedFrom(before), true)) {
      return { lines: [CHANGED_MEANWHILE], ok: false };
    }
    const wanted: Array<readonly [KeyPath, string]> = set.map(([key, value]) => [
      read.at(key),
      value,
    ]);
    const theirs = handRefusal(read, set);
    if (theirs !== null) return theirs;
    let result: ManagedJsonResult;
    try {
      result = applyManagedJson({
        file: paths.claudeMemSettingsFile,
        set: wanted,
        stateDir: paths.stateDir,
        secret: isSecretPath,
        unchosen,
      });
    } catch (error) {
      if (!(error instanceof ForeignKeyError)) throw error;
      // Only a race with another program's write gets here (the checks above agree with
      // `applyManagedJson`'s own rules). Its text quotes a value as it is (an address with its
      // password, say): it never reaches a page; these words do.
      return { lines: [CHANGED_MEANWHILE], ok: false };
    }
    recordChoices(paths, wanted);
    const lines = changeLines(result, read.short);
    return {
      lines:
        lines.length === 0
          ? [`claude-mem already uses that: nothing to change. ${done}`]
          : [done, ...lines],
      ok: true,
    };
  });
}

/**
 * Records each written key as the person's choice: a copy of the record `applyManagedJson`
 * just kept (owned), or, for claude-mem's own default chosen as it was (nothing written, so
 * nothing owned), the value with `owned: false`.
 */
function recordChoices(paths: CliPaths, wanted: ReadonlyArray<readonly [KeyPath, unknown]>): void {
  const file = realTarget(paths.claudeMemSettingsFile);
  const owned = ownedRecords(paths.stateDir, file);
  const chosen: ChoiceRecord[] = [];
  for (const [path, value] of wanted) {
    const record = owned.find((entry) => samePath(entry.path, path));
    if (record !== undefined) chosen.push({ ...record, owned: true });
    else if (unchosen(path, value)) chosen.push({ owned: false, path: [...path], value });
    // Else the file held this value already, set by the person by hand: it is theirs anyway.
  }
  const kept = readChoices(paths.stateDir, file).filter(
    (entry) => !wanted.some(([path]) => samePath(path, entry.path)),
  );
  writeChoices(paths.stateDir, file, [...kept, ...chosen]);
}

/** The line every write ends with: what leaves the machine now, and that no restart is needed. */
function routeLine(where: string): string {
  return `claude-mem reads its settings each time it uses them: its next summaries go to ${where}.`;
}

/**
 * Sets where claude-mem's summaries go. Claude: the provider key alone. A backend model: the
 * five provider keys, after one tiny chat with the key it will use (the person's own key when
 * they set one, else the gateway's own key for that backend).
 */
export async function chooseRoute(
  paths: CliPaths,
  choice: RouteChoice,
  check: TargetCheck = checkAffordableTarget,
): Promise<ChoiceResult> {
  const ready = readReady(paths);
  if ("blocked" in ready) return { lines: [ready.blocked.text], ok: false };
  if (choice.kind === "claude") {
    const result = await save(
      paths,
      ready.read,
      [[PROVIDER, CLAUDE_PROVIDER]],
      routeLine("Claude, on your own Claude login"),
    );
    // A Claude fallback under a Claude route never takes over, just as a backend fallback under its
    // own provider does not: claude-mem then has no fallback at all. Say it, rather than let the
    // person wait for one that cannot come (`readClaudeMemFacts` reports the same, as `idle`).
    if (result.ok && fallbackProvider(ready.read, ready.version) === CLAUDE_PROVIDER) {
      result.lines.push(
        "! claude-mem's fallback is Claude, the same as the route now, so claude-mem ignores it: choose the fallback again, or off.",
      );
    }
    return result;
  }
  const found = gatewayBackend(paths, choice.backend);
  if ("why" in found) return { lines: [found.why], ok: false };
  const keys = compatKeys(ready.read, found.backend, choice.model);
  const set = [[PROVIDER, OPENAI_COMPATIBLE] as const, ...keys.set];
  const theirs = handRefusal(ready.read, set);
  if (theirs !== null) return theirs;
  const problem = await check(keys.target);
  if (problem !== null) return { lines: [`Nothing was saved: ${problem}.`], ok: false };
  const result = await save(
    paths,
    ready.read,
    set,
    routeLine(`${choice.model} on ${choice.backend}`),
  );
  // A fallback on the provider the route now uses never takes over: claude-mem then has no
  // fallback at all, and its own keys are the route's now. Say it, rather than let the person
  // wait for one that cannot come (`readClaudeMemFacts` reports the same, as `idle`).
  if (result.ok && fallbackProvider(ready.read, ready.version) === OPENAI_COMPATIBLE) {
    result.lines.push(
      "! claude-mem's fallback is on the route's own provider now, so claude-mem ignores it: choose the fallback again, or off.",
    );
  }
  return result;
}

/**
 * Sets claude-mem's OpenAI-compatible key, for the address and model it uses now: the
 * gateway's own key for that backend, or one the person pasted. One tiny chat with it first;
 * the key is never printed, and a refusal names the backend, never the key.
 */
export async function chooseKey(
  paths: CliPaths,
  choice: KeyChoice,
  check: TargetCheck = checkAffordableTarget,
): Promise<ChoiceResult> {
  const ready = readReady(paths);
  if ("blocked" in ready) return { lines: [ready.blocked.text], ok: false };
  const { read } = ready;
  const baseUrl = textOf(read, BASE_URL);
  const model = textOf(read, MODEL);
  if (baseUrl === "" || model === "") {
    return {
      lines: ["claude-mem has no backend model yet, so a key has nothing to open: pick one first."],
      ok: false,
    };
  }
  const backend = backendAt(gatewayConfig(paths), baseUrl);
  let key: string;
  if (choice.kind === "gateway") {
    if (backend === null) {
      return {
        lines: [
          "claude-mem's address is not one of the gateway's backends, so the gateway holds no key for it: paste its key instead.",
        ],
        ok: false,
      };
    }
    key = backend.apiKey;
  } else {
    key = choice.key.trim();
    if (key === "" || key.length > KEY_MAX || /\s/.test(key)) {
      return {
        lines: [
          `The key was not saved: paste one key, on one line with no spaces, at most ${KEY_MAX} characters.`,
        ],
        ok: false,
      };
    }
  }
  const name = backend?.name ?? "claude-mem's backend";
  const set = [[API_KEY, key] as const];
  const theirs = handRefusal(read, set);
  if (theirs !== null) return theirs;
  const problem = await check({ apiKey: key, backend: name, baseUrl, model });
  if (problem !== null) return { lines: [`The key was not saved: ${problem}.`], ok: false };
  return save(
    paths,
    read,
    set,
    choice.kind === "gateway"
      ? `claude-mem uses the gateway's own key for ${name}.`
      : `claude-mem uses the key you pasted for ${name}. It is in claude-mem's file, readable only by you, and never shown again.`,
  );
}

/**
 * Sets claude-mem's quota fallback: off (claude-mem waits for its route's provider), Claude (its
 * own Claude model, or one named), or a backend model. A fallback that is the route's own
 * provider never takes over, so a Claude fallback needs a route that is not Claude, and a
 * backend fallback needs a backend the route's provider does not already hold: it takes
 * claude-mem's OpenRouter setup while the route is on the OpenAI-compatible one, and the other
 * way round (`fallbackProviderFor`). Either way it reaches the same backend and model.
 */
export async function chooseFallback(
  paths: CliPaths,
  choice: FallbackChoice,
  check: TargetCheck = checkAffordableTarget,
): Promise<ChoiceResult> {
  const ready = readReady(paths);
  if ("blocked" in ready) return { lines: [ready.blocked.text], ok: false };
  const { read } = ready;
  const route = routeProvider(read);
  if (choice.kind === "off") {
    // `off` came in 13.37.0, with Claude as the empty value's meaning; before it, claude-mem
    // refuses `off` (its `validateSettings`) and an empty value is what means none.
    const off = Bun.semver.order(ready.version, CLAUDE_FALLBACK_SINCE) >= 0 ? FALLBACK_OFF : "";
    return save(
      paths,
      read,
      [[FALLBACK_PROVIDER, off]],
      "claude-mem has no fallback now: while its provider is limited, it waits.",
    );
  }
  if (choice.kind === "claude") {
    if (route === CLAUDE_PROVIDER) {
      return {
        lines: [
          "claude-mem's route is Claude already, so Claude cannot be its fallback: pick a backend model, or off.",
        ],
        ok: false,
      };
    }
    return save(
      paths,
      read,
      [
        [FALLBACK_PROVIDER, CLAUDE_PROVIDER],
        [FALLBACK_MODEL, choice.model ?? ""],
      ],
      `While its route's provider is limited, claude-mem uses ${choice.model ?? "its own Claude model"} on your own Claude login.`,
    );
  }
  const found = gatewayBackend(paths, choice.backend);
  if ("why" in found) return { lines: [found.why], ok: false };
  // A route on the compat provider leaves the OpenRouter setup free, and a fallback on the
  // route's own provider never takes over (claude-mem's own rule): so the fallback moves to
  // the other of the two, at the same backend and model.
  const provider = fallbackProviderFor(route);
  const keys = fallbackKeys(read, found.backend, choice.model, route);
  const set = [...keys.set, [FALLBACK_PROVIDER, provider] as const];
  const theirs = handRefusal(read, set);
  if (theirs !== null) return theirs;
  const problem = await check(keys.target);
  if (problem !== null) return { lines: [`Nothing was saved: ${problem}.`], ok: false };
  return save(
    paths,
    read,
    set,
    `While its route's provider is limited, claude-mem sends its summaries to ${choice.model} on ${choice.backend}.`,
  );
}

/**
 * Hands claude-mem back to setup: forgets the person's portal choices, then runs setup's own
 * claude-mem step for the provider keys and the retired fallback keys (`claudeMemPlan`, the
 * same tiny chat before a backend write, `applyClaudeMem`), so claude-mem follows the scout
 * slot again and its fallback goes back to claude-mem's own default. The start blocks are
 * left to `setup` itself: turning them off also turns Claude Code's own task tools on, in
 * another file. A value the person set by hand stays theirs, as it does for setup.
 */
export async function followSetup(
  paths: CliPaths,
  check: TargetCheck = checkAffordableTarget,
): Promise<ChoiceResult> {
  const ready = readReady(paths);
  if ("blocked" in ready) return { lines: [ready.blocked.text], ok: false };
  await withLock(paths.stateDir, () =>
    writeChoices(paths.stateDir, realTarget(paths.claudeMemSettingsFile), []),
  );
  const planned = claudeMemPlan(paths);
  if (!("plan" in planned)) {
    return {
      lines: [
        "note" in planned && planned.note !== null
          ? planned.note
          : "claude-mem is not installed, so there is nothing to set.",
      ],
      ok: false,
    };
  }
  const lines: string[] = [];
  let plan: ClaudeMemPlan = { ...planned.plan, startBlocks: [] };
  if (plan.provider !== null) {
    const problem = await check(plan.provider.target);
    if (problem !== null) {
      lines.push(`claude-mem's route left as it is: ${problem}.`);
      plan = { ...plan, provider: null };
    }
  }
  const result = await withLock(paths.stateDir, () => applyClaudeMem(paths, plan, false));
  const short = tildify(paths.claudeMemSettingsFile, paths.home);
  return {
    lines: [
      "Your choices are forgotten: setup decides claude-mem's route again, from the scout slot.",
      ...lines,
      ...plan.notes.map((note) => note.trim()),
      ...changeLines(result, short),
    ],
    ok: true,
  };
}

/**
 * What the take-over tells the person about their key, before and after they agree: the one text
 * the command (`take-over`) and the take-over's own answer print.
 */
export const TAKE_OVER_KEY_NOTE = `A key's value is never written down: restore leaves your key as it is while it is still yours. Once ${COMMAND} replaced it, restore keeps the kit's key only with the address it was written for. Where your address comes back, your key comes back with it, from the backup of your file; with no backup that holds it, the kit's key is removed.`;

/**
 * **The take-over** (D63, owner 2026-10-24): records the values the person set by hand in
 * claude-mem's file as cc-smart-dev-kit's own, so the route, the key and the fallback may change
 * from the kit or the portal. It is the person's to ask for, never part of a `setup` run: a
 * value by hand that cc-smart-dev-kit never wrote is theirs until they give it up (`handRefusal`).
 *
 * - **Nothing in claude-mem's file changes.** Each value stays exactly as it is until the person
 *   picks another; the writer records the claim alone (`applyManagedJson`'s `claim`), with the
 *   value the key held, so `restore` puts that value back (`restoreTakenOver`) rather than
 *   removing a value cc-smart-dev-kit never wrote.
 * - **A key's value is never written down**, `owned.json` keeping only its hash: a taken-over key
 *   has no value to put back, so `restore` leaves it exactly as it is while it is still the
 *   person's. Once cc-smart-dev-kit replaced it, the key stays only next to the address it was
 *   written for, and otherwise the person's own comes back from the kit's backup (`restoreTakenOver`).
 * - **The keys it takes are the ones that refuse a choice now** (`handSetKeys`), exactly the keys
 *   the card and the command name before it asks: of the route's five, claude-mem's OpenRouter
 *   three and the quota fallback's two, those a choice writes on this route. A key that already holds
 *   cc-smart-dev-kit's own value, or claude-mem's own default, is left alone.
 */
export async function takeOver(paths: CliPaths): Promise<ChoiceResult> {
  const ready = readReady(paths);
  if ("blocked" in ready) return { lines: [ready.blocked.text], ok: false };
  const { read } = ready;
  const claims: Array<readonly [KeyPath, unknown]> = [];
  for (const key of handSetKeys(read)) {
    const path = read.at(key);
    const current = getKey(read.data, path);
    if (!current.found) continue;
    claims.push([path, current.value]);
  }
  if (claims.length === 0) {
    return {
      lines: [
        `Nothing to take over: every value claude-mem holds in ${read.short} is ${COMMAND}'s own, or claude-mem's own default.`,
      ],
      ok: true,
    };
  }
  return withLock(paths.stateDir, () => {
    // The writer checks each value under the lock and skips one that moved meanwhile: a value
    // that is not the one read is never claimed, so nothing is taken over unseen.
    const result = applyManagedJson({
      claim: claims,
      file: paths.claudeMemSettingsFile,
      secret: isSecretPath,
      stateDir: paths.stateDir,
      unchosen,
    });
    const taken: KeyPath[] = [];
    const moved: string[] = [];
    for (const [path] of claims) {
      if (result.skipped.some((one) => samePath(one.path, path))) moved.push(formatKeyPath(path));
      else taken.push(path);
    }
    if (taken.length === 0) return { lines: [CHANGED_MEANWHILE], ok: false };
    // The taken keys are the person's choices too, not only the kit's own records: a later
    // `setup` follows the scout slot otherwise and would plan its model over theirs, and take a
    // taken-over fallback out with `RETIRED_KEYS` (`isPersonsChoice` is what stops both).
    recordChoices(
      paths,
      taken.map((path) => [path, getKey(read.data, path).value] as const),
    );
    const short = tildify(paths.claudeMemSettingsFile, paths.home);
    return {
      lines: [
        `The take-over recorded ${taken.length === 1 ? "one value" : `${taken.length} values`} of claude-mem's as ${COMMAND}'s: each stays exactly as it is until you pick another.`,
        ...taken.map(
          (path) =>
            `  ${short}: ${formatKeyPath(path)}: ${shownClaudeMemValue(path, getKey(read.data, path).value)}`,
        ),
        "restore puts them back.",
        TAKE_OVER_KEY_NOTE,
        ...moved.map(
          (key) =>
            `! claude-mem's settings changed while the take-over ran, so ${key} is left as it is: run the take-over again.`,
        ),
      ],
      ok: true,
    };
  });
}

/**
 * The newest backup of claude-mem's settings file whose copy of `path` still holds the value the
 * take-over recorded: the copy made just before cc-smart-dev-kit replaced the key. Null when no
 * backup proves it (the copy's value must hash to `wasSha256`, so it is exactly what the person
 * had). The value comes with the path because a restore may put it back; it is never printed.
 */
function backupHoldingTakenKey(
  paths: CliPaths,
  file: string,
  path: KeyPath,
  wasSha256: string,
): null | { backup: string; value: unknown } {
  const backups = listBackups(paths.stateDir, file);
  // Newest first: the copy from just before the replacement is the last one that still holds it.
  for (let index = backups.length - 1; index >= 0; index -= 1) {
    const backup = backups[index];
    if (backup === undefined || backup.absent) continue;
    try {
      const { data } = readJsonObject(backup.path);
      const current = getKey(data, path);
      if (current.found && hashOf(current.value) === wasSha256) {
        return { backup: backup.path, value: current.value };
      }
    } catch {
      // A backup that cannot be read proves nothing: go on to the next one.
    }
  }
  return null;
}

/**
 * Does the key the kit wrote still belong to the address this restore leaves in the file?
 * A key is written for an address (`keyFor`: a taken-over key follows its address, a gateway key
 * follows its backend), and a restore that sets the address back to the person's own, or takes
 * it away with the kit's other keys, would pair the key with a host it was never made for.
 *
 * It answers from the kit's own records and the file, never from `gateway.json`, which may be
 * gone or unreadable. Yes when the kit never wrote the address, and when the address already
 * holds the value it will get back (the kit never changed it). No when the kit changed it and
 * restore changes it back, and also when the kit changed it and the person set it back to the
 * value they had by hand: the kit's key was written for the address the kit set, not for that
 * one. An address the person set to some third value is theirs, and the key beside it is left.
 */
function keyKeepsItsAddress(records: OwnedRecord[], data: JsonObject, keyPath: KeyPath): boolean {
  const addressPath = [...keyPath.slice(0, -1), pairedAddress(keyPath.at(-1) ?? "")];
  const held = records.find((record) => samePath(record.path, addressPath));
  if (held === undefined) return true;
  const current = getKey(data, addressPath);
  if (ownership(records, addressPath, current) === "ours") {
    return held.was !== undefined && Bun.deepEquals(current.value, held.was, true);
  }
  // Changed by the person since the kit wrote it (an "ours" record holds what the file holds, so
  // a changed one is never the value the kit left): back to what they had, it is not the address
  // the kit's key was written for.
  return !(
    current.found &&
    held.was !== undefined &&
    Bun.deepEquals(current.value, held.was, true)
  );
}

/** What a restore does with one taken-over secret, from what it holds now. */
type SecretPlan =
  /** Not in the file any more: the person's own removal; only the claim goes. */
  | { kind: "gone" }
  /** Still the key the person set: the claim goes, the key stays. */
  | { kind: "still-yours" }
  /** Another key than both the person's and the kit's: theirs; only the claim goes. */
  | { kind: "changed" }
  /** The kit replaced it, for the address that stays: the key stays, and the line names the backup. */
  | { kind: "kit-kept"; backup: null | string }
  /** The kit replaced it for an address that goes back: the person's own key comes back. */
  | { kind: "give-back"; backup: string; value: unknown }
  /** Same, and no backup holds their key: the kit's key goes, so no key is left at a wrong address. */
  | { kind: "withdraw" };

function planSecret(
  paths: CliPaths,
  file: string,
  records: OwnedRecord[],
  data: JsonObject,
  record: OwnedRecord & { wasSha256: string },
): SecretPlan {
  const current = getKey(data, record.path);
  if (!current.found) return { kind: "gone" };
  const hash = hashOf(current.value);
  if (hash === record.wasSha256) return { kind: "still-yours" };
  if (record.sha256 === undefined || hash !== record.sha256) return { kind: "changed" };
  const earlier = backupHoldingTakenKey(paths, file, record.path, record.wasSha256);
  if (keyKeepsItsAddress(records, data, record.path)) {
    return { kind: "kit-kept", backup: earlier?.backup ?? null };
  }
  return earlier === null
    ? { kind: "withdraw" }
    : { kind: "give-back", backup: earlier.backup, value: earlier.value };
}

/** What one taken-over secret's key became, as the one line `restore` prints. Never the value. */
function secretRestoreLine(
  paths: CliPaths,
  short: string,
  record: OwnedRecord,
  plan: SecretPlan,
): string {
  const path = formatKeyPath(record.path);
  switch (plan.kind) {
    case "gone":
      return `! ${short}: ${path}: not in the file any more; the take-over's claim on it is dropped.`;
    case "still-yours":
      return `~ ${short}: ${path}: yours again (still the key you set)`;
    case "changed":
      return `~ ${short}: ${path}: changed since the take-over; yours again.`;
    case "kit-kept":
      // The person picked another key through the kit: the older value cannot be written back
      // here, so the current key stays and the line names the copy that still holds the earlier one.
      return plan.backup === null
        ? `! ${short}: ${path}: cc-smart-dev-kit replaced it after the take-over, so the key you set before is not in the file any more; earlier copies are in the backups folder.`
        : `! ${short}: ${path}: cc-smart-dev-kit replaced it after the take-over; the key you set before is in the backup at ${tildify(plan.backup, paths.home)}.`;
    case "give-back":
      return `~ ${short}: ${path}: yours again (the key you set before, put back from the backup at ${tildify(plan.backup, paths.home)})`;
    case "withdraw":
      return `! ${short}: ${path}: removed: cc-smart-dev-kit wrote it for another address than yours, and no backup is known to hold the key you set before (earlier copies, if any, are in the backups folder).`;
  }
}

/**
 * Puts a take-over back, and nothing else: what `runRestore` calls **before** its own pass
 * (`src/cli/restore.ts`). For each key the take-over recorded, the claim goes and the value is
 * the person's again: a plain value gets the value it held then (`applyManagedJson`'s `release`),
 * and a secret's value was never kept, so what it gets depends on what it holds now (`SecretPlan`):
 *
 * - still the key the person set, removed or changed since: left exactly as it is, the claim goes;
 * - replaced by the kit **for the address that stays**: left as the kit wrote it, and the line
 *   names the backup that holds the person's earlier one — the path only, never the key;
 * - replaced by the kit **for an address this restore changes back** (a route that moved to a
 *   gateway backend, say): the key must belong to the address in the file, so the person's own
 *   key comes back from the kit's backup, whose copy hashes to the one the take-over recorded;
 *   when no backup holds it, the kit's key is removed (`withdraw`) and the address is left with
 *   none. A gateway backend's key never sits next to the person's address, and neither does a key
 *   typed in the portal for another one.
 *
 * It runs first because `restore` takes the records out with the keys, and what a key was taken
 * over with lives in the record. Returns the lines it wrote; none when there was nothing to put
 * back.
 */
export async function restoreTakenOver(
  paths: CliPaths,
  /** Tests only: `applyManagedJson`'s own seam, to play another program's write. */
  hooks: { onBeforeWrite?: () => void } = {},
): Promise<ChoiceResult> {
  const file = paths.claudeMemSettingsFile;
  const records = ownedRecords(paths.stateDir, realTarget(file));
  const plain = records.filter((record) => record.was !== undefined);
  // A taken-over secret: its value was never kept, so its hash stands in for it (`wasSha256`).
  const secret = records.filter(
    (record): record is OwnedRecord & { wasSha256: string } =>
      record.was === undefined && record.taken === true && record.wasSha256 !== undefined,
  );
  if (plain.length === 0 && secret.length === 0) return { lines: [], ok: true };
  const short = tildify(file, paths.home);
  // Each secret's plan comes from the file as the writer will read it. An unreadable file has no
  // plans, and the writer below reports it in its own words (the caller prints one `!` line).
  let before: JsonObject | null = null;
  try {
    before = readJsonObject(file).data;
  } catch {
    // The writer reads the same file next and throws; not reported twice.
  }
  const plans = secret.map((record) => ({
    plan: before === null ? null : planSecret(paths, file, records, before, record),
    record,
  }));
  // No lock of its own: `runRestore` calls this inside the lock it already holds, and a second
  // `withLock` on the same state folder would wait for the first and give up.
  const result = applyManagedJson({
    file,
    release: [
      ...plain.map((record) => [record.path, record.was] as const),
      // The person's own key back; no value for every other plan: the claim goes and the key
      // stays as it is (a secret's value is never kept).
      ...plans
        .filter(({ plan }) => plan?.kind !== "withdraw")
        .map(({ plan, record }) =>
          plan?.kind === "give-back"
            ? ([record.path, plan.value] as const)
            : ([record.path, undefined] as const),
        ),
    ],
    secret: isSecretPath,
    stateDir: paths.stateDir,
    unchosen,
    withdraw: plans
      .filter(({ plan }) => plan?.kind === "withdraw")
      .map(({ record }) => record.path),
    ...(hooks.onBeforeWrite && { onBeforeWrite: hooks.onBeforeWrite }),
  });
  // A secret's line comes from its plan, and from what the writer really did. The writer starts
  // again when another program wrote the file meanwhile, and a key that moved then is the
  // person's, left as it is: a put-back or a removal is reported only when the writer made that
  // change. No value is printed, not even masked, so a secret's change is never listed above.
  const lines = result.changes
    .filter((change) => !isSecretPath(change.path))
    .map(
      (change) =>
        `~ ${short}: ${formatKeyPath(change.path)}: ${shownClaudeMemValue(change.path, change.after)} (yours again)`,
    );
  for (const { plan, record } of plans) {
    if (plan === null) continue;
    const wrote =
      plan.kind !== "give-back" && plan.kind !== "withdraw"
        ? true
        : result.changes.some((change) => samePath(change.path, record.path));
    lines.push(
      wrote
        ? secretRestoreLine(paths, short, record, plan)
        : `~ ${short}: ${formatKeyPath(record.path)}: changed while restore ran; left as it is, and yours.`,
    );
  }
  return { lines, ok: true };
}
