import { existsSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { type CliPaths, tildify } from "../cli/paths";
import { loadConfigFile, messageOf } from "../gateway/config";
import { backendFetch } from "../gateway/hosts";
import { maskedLine } from "../gateway/plain-text";
import { maskKey } from "../gateway/settings";
import { familySlotKey, parseTarget } from "../gateway/targets";
import { findUserInstall } from "../setup/installed-plugins";
import {
  applyManagedJson,
  getKey,
  isObject,
  type JsonObject,
  type KeyPath,
  type ManagedJsonResult,
  ownedRecords,
  ownership,
  readJsonObject,
} from "../setup/managed-json";
import { redactUrl } from "../setup/marketplace-access";
import { realTarget } from "../setup/write";
import { companionState, companions, comparableVersion } from "./companions";

/**
 * claude-mem (the memory plugin cc-smart-dev-kit depends on) summarises every session, by default
 * with Claude Haiku on the person's own Claude login. Its work is Haiku's, so it follows the
 * gateway's slot for Haiku, the scout (`familySlotKey("haiku")`), and nothing else: when the
 * person gave the scout a chain whose first target is a `<backend>:<model>`, setup points
 * claude-mem at that model, straight at its backend (OmniRoute by default, which speaks
 * OpenAI's format). A scout with no chain (a fresh `gateway setup` writes none), or one that
 * starts with a Claude model, leaves claude-mem on Claude, as it is.
 *
 * **No model of the plugin's own** (owner, 2026-10-17): setup writes no quota fallback.
 * claude-mem's own (`CLAUDE_MEM_QUOTA_FALLBACK_*`, its defaults or the person's values) stays
 * as it is. The two fallback keys 0.4.3 and earlier wrote (Claude Haiku, a fixed id) are taken
 * out again while they still hold cc-smart-dev-kit's value (`RETIRED_KEYS`); a value the
 * person set or changed stays.
 *
 * Five keys in `~/.claude-mem/settings.json`, owned through `applyManagedJson`, so a restore
 * takes them out and claude-mem is back on its own defaults. claude-mem writes every default
 * into that file on its first run, so a key that holds claude-mem's own default (`""`, or
 * `claude` for the provider) counts as "nobody chose it" and may be taken. Any other value is
 * the person's choice, also in a key cc-smart-dev-kit set before and the person changed since:
 * then setup changes none of the keys.
 */

export const CLAUDE_MEM_ID = "claude-mem@thedotmack";
/** The release that brought the openai-compatible provider and the quota fallback (its CHANGELOG). */
export const CLAUDE_MEM_MIN_VERSION = "13.29.0";
/**
 * The release that pins `pydantic<2.14` for its vector search: chroma-mcp 0.2.6 imports a
 * pydantic helper that pydantic 2.14.0 removed, so before it a fresh install's vector
 * search stays off (claude-mem's CHANGELOG, 13.35.0, #4595). doctor warns below it.
 */
export const CLAUDE_MEM_CHROMA_FIX_VERSION = "13.35.0";
/**
 * claude-mem's quota-fallback keys, which 0.4.3 and earlier set to a fixed Claude model. Never
 * written now; setup takes them out while they hold cc-smart-dev-kit's value, and leaves the
 * person's.
 */
export const RETIRED_KEYS = [
  "CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER",
  "CLAUDE_MEM_QUOTA_FALLBACK_MODEL",
] as const;

const API_KEY = "CLAUDE_MEM_OPENAI_COMPAT_API_KEY";
/** The person's own pool of keys. Never set by cc-smart-dev-kit; a pool there is their choice. */
const API_KEY_POOL = "CLAUDE_MEM_OPENAI_COMPAT_API_KEYS";
const PROVIDER = "CLAUDE_MEM_PROVIDER";

/** For each key: the values that mean "nobody chose this yet" (claude-mem's defaults). */
const UNCHOSEN: Readonly<Record<string, readonly string[]>> = {
  [PROVIDER]: ["", "claude"],
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: [""],
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: [""],
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: [""],
  [API_KEY]: [""],
};

const unchosen = (path: KeyPath, value: unknown) =>
  typeof value === "string" && (UNCHOSEN[path.at(-1) ?? ""] ?? []).includes(value);

/** The gateway's affordable model, as claude-mem reaches it. */
export interface AffordableTarget {
  /** The backend's name in gateway.json. */
  backend: string;
  /** Its OpenAI-compatible base: `<backend baseUrl>/v1`. */
  baseUrl: string;
  model: string;
  /** The backend's key from gateway.json. Never printed. */
  apiKey: string;
}

/**
 * The scout slot's first target in gateway.json, when it is an affordable `<backend>:<model>`
 * (claude-mem's work is Haiku's, and the scout is Haiku's slot), or why there is none: the
 * gateway is not set up, the scout has no chain, or its chain starts with a Claude model.
 */
export function gatewayAffordableTarget(
  gatewayConfigFile: string,
): { target: AffordableTarget } | { reason: string } {
  if (!existsSync(gatewayConfigFile)) return { reason: "the gateway is not set up" };
  let config: ReturnType<typeof loadConfigFile>;
  try {
    config = loadConfigFile(gatewayConfigFile);
  } catch (error) {
    return { reason: `gateway.json cannot be used (${messageOf(error)})` };
  }
  const slot = familySlotKey("haiku");
  const first = slot === null ? undefined : config.slots[slot]?.[0];
  if (slot === null || first === undefined) {
    return { reason: `${slot ?? "the scout slot"} has no chain` };
  }
  const parsed = parseTarget(first);
  if ("error" in parsed || parsed.target.kind !== "backend") {
    return { reason: `${slot} starts with ${first}, not an affordable model` };
  }
  const backend = config.backends[parsed.target.backend];
  if (backend === undefined) return { reason: `${first} names no backend in gateway.json` };
  return {
    target: {
      backend: parsed.target.backend,
      baseUrl: `${backend.baseUrl}/v1`,
      model: parsed.target.model,
      apiKey: backend.apiKey,
    },
  };
}

export interface ClaudeMemPlan {
  /** The keys to take out while they hold cc-smart-dev-kit's value (`RETIRED_KEYS`). */
  remove: KeyPath[];
  /** The keys to set, with their path (flat, or under `env` in an older file). */
  set: Array<readonly [KeyPath, string]>;
  target: AffordableTarget;
}

/**
 * What setup does for claude-mem:
 * - `plan`: the keys to set;
 * - `note`: a line that says why it does nothing (`null`: nothing to say: the gateway is
 *   not there, and claude-mem holds nothing of cc-smart-dev-kit's);
 * - `notInstalled`: claude-mem is not installed yet. Setup may install it (a companion
 *   step) and then plan again.
 */
export function claudeMemPlan(
  paths: CliPaths,
): { plan: ClaudeMemPlan } | { note: string | null } | { notInstalled: true } {
  const install = findUserInstall(paths.installedPluginsFile, CLAUDE_MEM_ID);
  if (install === null || !existsSync(install.installPath)) return { notInstalled: true };

  const file = paths.claudeMemSettingsFile;
  const short = tildify(file, paths.home);
  const left = (why: string) => ({ note: `! claude-mem settings left alone: ${why}` });
  let data: JsonObject;
  try {
    data = readJsonObject(file).data;
  } catch (error) {
    return left(messageOf(error));
  }
  // claude-mem reads its keys under "env" when "env" holds any (an older file).
  const env = data.env;
  const nested = isObject(env) && Object.keys(env).some((key) => key.startsWith("CLAUDE_MEM_"));
  const at = (key: string): KeyPath => (nested ? ["env", key] : [key]);
  const records = ownedRecords(paths.stateDir, realTarget(file));

  const affordable = gatewayAffordableTarget(paths.gatewayConfigFile);
  if ("reason" in affordable) {
    // cc-smart-dev-kit pointed claude-mem at a backend before, and there is no affordable model now.
    const provider = getKey(data, at(PROVIDER));
    if (provider.found && ownership(records, at(PROVIDER), provider) === "ours") {
      return {
        note: `! claude-mem still uses the backend ${COMMAND} set for it, but ${affordable.reason}. Run ${COMMAND} setup again once the scout slot starts with an affordable model, or ${COMMAND} restore to put claude-mem back on its own defaults.`,
      };
    }
    return { note: null };
  }

  const version = comparableVersion(install.version);
  if (version === null || Bun.semver.order(version, CLAUDE_MEM_MIN_VERSION) < 0) {
    // The companion check says it already, when plugin.json's range covers it: one note.
    const companion = companions().find((entry) => entry.id === CLAUDE_MEM_ID);
    const state = companion === undefined ? null : companionState(paths, companion).kind;
    if (state === "outside-range" || state === "unknown-version") return { note: null };
    return left(
      version === null
        ? `claude-mem's version ${install.version ?? "(none)"} is unknown, so cc-smart-dev-kit cannot tell whether it has what they need (${CLAUDE_MEM_MIN_VERSION} or newer). Run: claude plugin update ${CLAUDE_MEM_ID}`
        : `claude-mem ${install.version} is older than ${CLAUDE_MEM_MIN_VERSION}, which brought what they need. Run: claude plugin update ${CLAUDE_MEM_ID}`,
    );
  }

  // claude-mem rewrites a file that holds only "env" flat on its next start, and drops
  // any flat key written beside "env" then; a key cc-smart-dev-kit wrote there would be lost.
  if (nested && Object.keys(data).every((key) => key === "env")) {
    return left(
      `${short} is in claude-mem's old nested form, which claude-mem rewrites when it next starts. Start a Claude Code session, then run cc-smart-dev-kit setup again.`,
    );
  }

  const pool = getKey(data, at(API_KEY_POOL));
  if (pool.found && typeof pool.value === "string" && pool.value.trim() !== "") {
    return {
      note: `  claude-mem settings left alone: ${API_KEY_POOL} holds your own keys in ${short} (your choice)`,
    };
  }

  const target = affordable.target;
  const wanted: Record<string, string> = {
    [PROVIDER]: "openai-compatible",
    CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
    CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: target.baseUrl,
    CLAUDE_MEM_OPENAI_COMPAT_MODEL: target.model,
    [API_KEY]: target.apiKey,
  };

  // The person's own choice stands: one key set by them, and none of the keys change.
  // A key cc-smart-dev-kit set before and the person changed since is their choice too.
  for (const [key, value] of Object.entries(wanted)) {
    const path = at(key);
    const current = getKey(data, path);
    if (!current.found || current.value === value) continue;
    const whose = ownership(records, path, current, unchosen);
    if (whose === "ours" || (whose === "none" && unchosen(path, current.value))) continue;
    const shown = key === API_KEY ? "another key" : JSON.stringify(current.value);
    return {
      note: `  claude-mem settings left alone: ${key} is ${shown} in ${short} (your choice)`,
    };
  }
  return {
    plan: {
      remove: RETIRED_KEYS.map(at),
      set: Object.entries(wanted).map(([key, value]) => [at(key), value]),
      target,
    },
  };
}

/**
 * Does the backend answer what claude-mem will send: a chat completion for the model,
 * with this key, at `<base>/chat/completions` (claude-mem's custom preset adds
 * `/chat/completions` to its base URL)? One token, checked before anything is written,
 * so claude-mem is never left on a key, a model or an address that does not work. The
 * key never appears in what it returns.
 */
export async function checkAffordableTarget(
  target: AffordableTarget,
  timeoutMs = 30_000,
): Promise<string | null> {
  const url = `${target.baseUrl}/chat/completions`;
  const where = redactUrl(url);
  const hide = (text: string) =>
    target.apiKey === "" ? text : text.replaceAll(target.apiKey, maskKey(target.apiKey));
  let response: Response;
  try {
    // `backendFetch`: the key never goes through a proxy to a backend on this machine, and a
    // redirect is not followed with it (it reads as the answer that is not ok, below).
    response = await backendFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${target.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: "user", content: "Say OK." }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A fetch error's words come from outside: one line, the key masked.
    const said = maskedLine(messageOf(error), [target.apiKey], 200);
    return hide(`${target.backend} did not answer at ${where} (${said})`);
  }
  if (response.ok) {
    await response.body?.cancel();
    return null;
  }
  const status = response.status;
  let code: unknown;
  try {
    code = ((await response.json()) as { error?: { code?: unknown } } | null)?.error?.code;
  } catch {
    code = undefined;
  }
  if (status === 401 || status === 403) return `${target.backend} refused its key (HTTP ${status})`;
  if (status === 404 && code === "model_not_found") {
    return `${target.backend} does not serve the model ${target.model} (HTTP 404)`;
  }
  if (status === 404) return `${target.backend} has no OpenAI chat endpoint at ${where} (HTTP 404)`;
  return `${target.backend} answered HTTP ${status} to a one-token chat request for ${target.model} at ${where}`;
}

/** True for a claude-mem key path whose value must never be printed. */
export function isSecretPath(path: KeyPath): boolean {
  return path.at(-1) === API_KEY;
}

/** Writes (or, with `dryRun`, only checks) the plan's keys, and takes out the retired ones. */
export function applyClaudeMem(
  paths: CliPaths,
  plan: ClaudeMemPlan,
  dryRun: boolean,
): ManagedJsonResult {
  return applyManagedJson({
    file: paths.claudeMemSettingsFile,
    stateDir: paths.stateDir,
    set: plan.set,
    remove: plan.remove,
    dryRun,
    unchosen,
    secret: isSecretPath,
  });
}

/** A claude-mem value as setup may print it: the key masked. */
export function shownClaudeMemValue(path: KeyPath, value: unknown): string {
  if (value === undefined) return "(none)";
  if (isSecretPath(path) && typeof value === "string" && value !== "") {
    return JSON.stringify(maskKey(value));
  }
  return JSON.stringify(value);
}

/**
 * doctor's warning for a claude-mem older than CLAUDE_MEM_CHROMA_FIX_VERSION: its vector
 * search may not start. Null when it is not installed, or new enough, or its version is
 * not a version (the companion check reports those).
 */
export function claudeMemAdvice(paths: CliPaths): string | null {
  const install = findUserInstall(paths.installedPluginsFile, CLAUDE_MEM_ID);
  if (install === null || !existsSync(install.installPath)) return null;
  const version = comparableVersion(install.version);
  if (version === null || Bun.semver.order(version, CLAUDE_MEM_CHROMA_FIX_VERSION) >= 0) {
    return null;
  }
  return `${CLAUDE_MEM_ID} ${install.version} is older than ${CLAUDE_MEM_CHROMA_FIX_VERSION}: on a fresh install its vector search may not start (pydantic 2.14 broke chroma-mcp; ${CLAUDE_MEM_CHROMA_FIX_VERSION} pins pydantic below it). Run: claude plugin update ${CLAUDE_MEM_ID}`;
}
