import { existsSync } from "node:fs";
import { type CliPaths, tildify } from "../cli/paths";
import { type GatewayConfig, loadConfigFile, messageOf } from "../gateway/config";
import { backendAddress } from "../gateway/settings";
import { findUserInstall } from "../setup/installed-plugins";
import { withLock } from "../setup/lock";
import {
  applyManagedJson,
  ForeignKeyError,
  formatKeyPath,
  getKey,
  type KeyPath,
  type ManagedJsonResult,
  ownedRecords,
  ownership,
  samePath,
} from "../setup/managed-json";
import { realTarget } from "../setup/write";
import {
  type AffordableTarget,
  API_KEY,
  API_KEY_POOL,
  BASE_URL,
  type ChoiceRecord,
  CLAUDE_FALLBACK_SINCE,
  CLAUDE_MEM_ID,
  CLAUDE_MEM_MIN_VERSION,
  CLAUDE_MODEL,
  CLAUDE_PROVIDER,
  type ClaudeMemSettings,
  CUSTOM_PRESET,
  checkAffordableTarget,
  compatBaseUrl,
  FALLBACK_MODEL,
  FALLBACK_OFF,
  FALLBACK_PROVIDER,
  isOldNestedForm,
  isPersonsChoice,
  isSecretPath,
  MODEL,
  OPENAI_COMPATIBLE,
  PRESET,
  PROVIDER,
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
 * claude-mem reads its settings file each time it uses it (13.40.0's `loadFromFile`), so a
 * change needs no restart. Its facts: claude-mem 13.40.0's own source (`worker-service.cjs`,
 * the settings defaults and `validateSettings`) and its CHANGELOG (13.29.0 brought the
 * openai-compatible provider and the fallback; 13.37.0 made Claude the fallback's default).
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
  };
  fallback: {
    /** The provider that takes over while the route's is limited, or `off`, as claude-mem reads it. */
    provider: string;
    /** A Claude fallback's model; null: claude-mem's own Claude model. */
    model: null | string;
    /** A backend fallback's `<backend>:<model>`, when its address is a gateway backend's. */
    target: null | string;
    /** Why it can never take over now (the same provider as the route); null when it can. */
    idle: null | string;
    source: ClaudeMemSource;
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
  const whose = ownership(read.records, path, current, unchosen);
  if (whose === "ours") return unchosen(path, current.value) ? "default" : "setup";
  if (whose === "none" && (!current.found || unchosen(path, current.value))) return "default";
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

/** claude-mem's state for the Machine page. Reads files only; never holds the key. */
export function readClaudeMemFacts(paths: CliPaths): ClaudeMemFacts {
  const config = gatewayConfig(paths);
  const ready = readReady(paths);
  const base = {
    backends: config === null ? null : Object.keys(config.backends).sort(),
    file: tildify(paths.claudeMemSettingsFile, paths.home),
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
  // claude-mem has one OpenAI-compatible setup: the route's, or a Claude route's fallback.
  const compatTarget =
    backend !== null && compatModel !== "" ? `${backend.name}:${compatModel}` : null;
  return {
    ...base,
    blocked: null,
    current: {
      fallback: {
        idle:
          fallback === provider && fallback !== FALLBACK_OFF
            ? "It is the same provider as the route, so claude-mem has no fallback: it waits for the route's provider."
            : null,
        model: fallbackModel === "" ? null : fallbackModel,
        provider: fallback,
        source: sourceOf(read, FALLBACK_PROVIDER),
        target: fallback === OPENAI_COMPATIBLE ? compatTarget : null,
      },
      key: {
        pool: textOf(read, API_KEY_POOL).trim() !== "",
        source: sourceOf(read, API_KEY),
        state:
          key === "" ? "none" : backend !== null && backend.apiKey === key ? "gateway" : "other",
      },
      route: {
        address: kind === "claude" || baseUrl === "" ? null : backendAddress(baseUrl),
        kind,
        model:
          kind === "claude"
            ? textOf(read, CLAUDE_MODEL) || null
            : compatModel === ""
              ? null
              : compatModel,
        provider,
        source: sourceOf(read, kind === "backend" ? MODEL : PROVIDER),
        target: kind === "backend" ? compatTarget : null,
      },
    },
    version,
  };
}

/**
 * The key a backend route or fallback uses: the person's own key when they set one (from the
 * portal, or by hand), else the gateway's own key for that backend — as setup uses it. `set`
 * is false when the key stays as it is.
 */
function keyFor(read: ClaudeMemSettings, gatewayKey: string): { key: string; set: boolean } {
  const current = textOf(read, API_KEY);
  const source = sourceOf(read, API_KEY);
  if (current !== "" && (source === "portal" || source === "hand")) {
    return { key: current, set: false };
  }
  return { key: gatewayKey, set: true };
}

/** The keys that point claude-mem's OpenAI-compatible provider at one gateway backend's model. */
function compatKeys(
  read: ClaudeMemSettings,
  backend: { name: string; baseUrl: string; apiKey: string },
  model: string,
): { set: Array<readonly [string, string]>; target: AffordableTarget } {
  const baseUrl = compatBaseUrl(backend.baseUrl);
  const key = keyFor(read, backend.apiKey);
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

/** A gateway backend by name, with its address and key, or the words for why there is none. */
function gatewayBackend(
  paths: CliPaths,
  name: string,
): { backend: { name: string; baseUrl: string; apiKey: string } } | { why: string } {
  const config = gatewayConfig(paths);
  if (config === null) {
    return { why: "The gateway is not set up, so it has no backend for claude-mem to use." };
  }
  const backend = config.backends[name];
  if (backend === undefined) return { why: `The gateway has no backend named "${name}".` };
  return { backend: { apiKey: backend.apiKey, baseUrl: backend.baseUrl, name } };
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

/**
 * Writes the person's choice under setup's lock: the settings again (another program may have
 * changed them since the check), `applyManagedJson`, then the choices file. A key the person
 * set by hand stops it in words, with nothing written.
 */
async function save(
  paths: CliPaths,
  set: ReadonlyArray<readonly [string, string]>,
  done: string,
): Promise<ChoiceResult> {
  return withLock(paths.stateDir, () => {
    const ready = readReady(paths);
    if ("blocked" in ready) return { lines: [ready.blocked.text], ok: false };
    const { read } = ready;
    const wanted: Array<readonly [KeyPath, string]> = set.map(([key, value]) => [
      read.at(key),
      value,
    ]);
    // Again under the lock: the file may have changed since the chooser looked.
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
      // The error names a secret as "a secret": it never holds the key.
      return {
        lines: [
          `Nothing was saved: ${messageOf(error)}`,
          `That value is yours, set in ${read.short} by hand: change it there, or remove it to set it here.`,
        ],
        ok: false,
      };
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
function recordChoices(paths: CliPaths, wanted: ReadonlyArray<readonly [KeyPath, string]>): void {
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
    return save(
      paths,
      [[PROVIDER, CLAUDE_PROVIDER]],
      routeLine("Claude, on your own Claude login"),
    );
  }
  const found = gatewayBackend(paths, choice.backend);
  if ("why" in found) return { lines: [found.why], ok: false };
  const keys = compatKeys(ready.read, found.backend, choice.model);
  const set = [[PROVIDER, OPENAI_COMPATIBLE] as const, ...keys.set];
  const theirs = handRefusal(ready.read, set);
  if (theirs !== null) return theirs;
  const problem = await check(keys.target);
  if (problem !== null) return { lines: [`Nothing was saved: ${problem}.`], ok: false };
  return save(paths, set, routeLine(`${choice.model} on ${choice.backend}`));
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
    set,
    choice.kind === "gateway"
      ? `claude-mem uses the gateway's own key for ${name}.`
      : `claude-mem uses the key you pasted for ${name}. It is in claude-mem's file, readable only by you, and never shown again.`,
  );
}

/**
 * Sets claude-mem's quota fallback: off (claude-mem waits for its route's provider), Claude (its
 * own Claude model, or one named), or a backend model. claude-mem has one OpenAI-compatible
 * setup, so a backend fallback needs the Claude route, and a Claude fallback needs a route that
 * is not Claude: a fallback that is the route's own provider never takes over.
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
    return save(
      paths,
      [[FALLBACK_PROVIDER, FALLBACK_OFF]],
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
      [
        [FALLBACK_PROVIDER, CLAUDE_PROVIDER],
        [FALLBACK_MODEL, choice.model ?? ""],
      ],
      `While its route's provider is limited, claude-mem uses ${choice.model ?? "its own Claude model"} on your own Claude login.`,
    );
  }
  if (route === OPENAI_COMPATIBLE) {
    return {
      lines: [
        "claude-mem has one OpenAI-compatible backend, and its route uses it: the fallback can be Claude, or off.",
      ],
      ok: false,
    };
  }
  const found = gatewayBackend(paths, choice.backend);
  if ("why" in found) return { lines: [found.why], ok: false };
  const keys = compatKeys(read, found.backend, choice.model);
  const set = [...keys.set, [FALLBACK_PROVIDER, OPENAI_COMPATIBLE] as const];
  const theirs = handRefusal(read, set);
  if (theirs !== null) return theirs;
  const problem = await check(keys.target);
  if (problem !== null) return { lines: [`Nothing was saved: ${problem}.`], ok: false };
  return save(
    paths,
    set,
    `While its route's provider is limited, claude-mem sends its summaries to ${choice.model} on ${choice.backend}.`,
  );
}
