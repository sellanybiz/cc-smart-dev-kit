import { existsSync } from "node:fs";
import { type CliPaths, tildify } from "../cli/paths";
import { listModels } from "../gateway/backends";
import { loadConfigFile, messageOf } from "../gateway/config";
import { maskKey } from "../gateway/settings";
import { parseTarget } from "../gateway/targets";
import { findUserInstall } from "../setup/installed-plugins";
import {
  applyManagedJson,
  getKey,
  isObject,
  type KeyPath,
  type ManagedJsonResult,
  ownedKeys,
  readJsonObject,
} from "../setup/managed-json";
import { realTarget } from "../setup/write";
import { comparableVersion } from "./companions";

/**
 * claude-mem (the memory plugin anymodel depends on) summarises every session, by default
 * with Claude Haiku on the person's own Claude login. When the anymodel gateway is set
 * up, setup points claude-mem at the gateway's cheap model instead, straight at its
 * backend (OmniRoute by default, which speaks OpenAI's format), with Claude Haiku as
 * claude-mem's quota fallback: when the cheap model cannot answer, claude-mem goes back to
 * Claude.
 *
 * Seven keys in `~/.claude-mem/settings.json`, owned through `applyManagedJson`, so a
 * restore takes them out and claude-mem is back on its own defaults. claude-mem writes
 * every default into that file on its first run, so a key that holds claude-mem's own
 * default (`""`, or `claude` for the two providers) counts as "nobody chose it" and may be
 * taken. Any other value is the person's choice: then setup changes none of the keys.
 */

export const CLAUDE_MEM_ID = "claude-mem@thedotmack";
/** The release that brought the openai-compatible provider and the quota fallback (its CHANGELOG). */
export const CLAUDE_MEM_MIN_VERSION = "13.29.0";
/** claude-mem's quota fallback: Claude, with claude-mem's own default model, named exactly. */
export const FALLBACK_PROVIDER = "claude";
export const FALLBACK_MODEL = "claude-haiku-4-5-20251001";

const API_KEY = "CLAUDE_MEM_OPENAI_COMPAT_API_KEY";

/** For each key: the values that mean "nobody chose this yet" (claude-mem's defaults). */
const UNCHOSEN: Readonly<Record<string, readonly string[]>> = {
  CLAUDE_MEM_PROVIDER: ["", "claude"],
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: [""],
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: [""],
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: [""],
  [API_KEY]: [""],
  CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: ["", "claude"],
  CLAUDE_MEM_QUOTA_FALLBACK_MODEL: [""],
};

/** The gateway's cheap model, as claude-mem reaches it. */
export interface CheapTarget {
  /** The backend's name in gateway.json. */
  backend: string;
  /** Its OpenAI-compatible base: `<backend baseUrl>/v1`. */
  baseUrl: string;
  model: string;
  /** The backend's key from gateway.json. Never printed. */
  apiKey: string;
}

/**
 * The first cheap target of the scout slot (else the worker slot) in gateway.json, or why
 * there is none. The scout is the cheapest slot, the one made for background work.
 */
export function gatewayCheapTarget(
  gatewayConfigFile: string,
): { target: CheapTarget } | { reason: string } {
  if (!existsSync(gatewayConfigFile)) return { reason: "the gateway is not set up" };
  let config: ReturnType<typeof loadConfigFile>;
  try {
    config = loadConfigFile(gatewayConfigFile);
  } catch (error) {
    return { reason: `gateway.json cannot be used (${messageOf(error)})` };
  }
  for (const slot of ["anymodel-scout", "anymodel-worker"]) {
    for (const text of config.slots[slot] ?? []) {
      const parsed = parseTarget(text);
      if ("error" in parsed || parsed.target.kind !== "backend") continue;
      const backend = config.backends[parsed.target.backend];
      if (backend === undefined) continue;
      return {
        target: {
          backend: parsed.target.backend,
          baseUrl: `${backend.baseUrl}/v1`,
          model: parsed.target.model,
          apiKey: backend.apiKey,
        },
      };
    }
  }
  return { reason: "no slot in gateway.json has a cheap target" };
}

export interface ClaudeMemPlan {
  /** The keys to set, with their path (flat, or under `env` in an older file). */
  set: Array<readonly [KeyPath, string]>;
  target: CheapTarget;
}

/**
 * What setup does for claude-mem: a plan, or a line that says why it does nothing
 * (`null`: nothing to say: claude-mem or the gateway is not there).
 */
export function claudeMemPlan(paths: CliPaths): { plan: ClaudeMemPlan } | { note: string | null } {
  const install = findUserInstall(paths.installedPluginsFile, CLAUDE_MEM_ID);
  if (install === null || !existsSync(install.installPath)) return { note: null };
  const cheap = gatewayCheapTarget(paths.gatewayConfigFile);
  if ("reason" in cheap) return { note: null };
  const version = comparableVersion(install.version);
  if (version === null || Bun.semver.order(version, CLAUDE_MEM_MIN_VERSION) < 0) {
    return {
      note: `! claude-mem settings left alone: claude-mem ${install.version ?? "(no version)"} is older than ${CLAUDE_MEM_MIN_VERSION}, which brought what they need. Run: claude plugin update ${CLAUDE_MEM_ID}`,
    };
  }

  const file = paths.claudeMemSettingsFile;
  let data: Record<string, unknown>;
  try {
    data = readJsonObject(file).data;
  } catch (error) {
    return { note: `! claude-mem settings left alone: ${messageOf(error)}` };
  }
  // An older file keeps claude-mem's keys under "env" (claude-mem reads them there).
  const env = data.env;
  const nested = isObject(env) && Object.keys(env).some((key) => key.startsWith("CLAUDE_MEM_"));
  const at = (key: string): KeyPath => (nested ? ["env", key] : [key]);
  const target = cheap.target;
  const wanted: Record<string, string> = {
    CLAUDE_MEM_PROVIDER: "openai-compatible",
    CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
    CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: target.baseUrl,
    CLAUDE_MEM_OPENAI_COMPAT_MODEL: target.model,
    [API_KEY]: target.apiKey,
    CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: FALLBACK_PROVIDER,
    CLAUDE_MEM_QUOTA_FALLBACK_MODEL: FALLBACK_MODEL,
  };

  // The person's own choice stands: one key set by them, and none of the keys change.
  const owned = ownedKeys(paths.stateDir, realTarget(file));
  const isOwned = (path: KeyPath) =>
    owned.some((entry) => entry.length === path.length && entry.every((s, i) => s === path[i]));
  for (const [key, value] of Object.entries(wanted)) {
    const current = getKey(data, at(key));
    if (!current.found || current.value === value || isOwned(at(key))) continue;
    if (typeof current.value === "string" && (UNCHOSEN[key] ?? []).includes(current.value)) {
      continue;
    }
    const shown = key === API_KEY ? "another key" : JSON.stringify(current.value);
    return {
      note: `  claude-mem settings left alone: ${key} is ${shown} in ${tildify(file, paths.home)} (your choice)`,
    };
  }
  return { plan: { set: Object.entries(wanted).map(([key, value]) => [at(key), value]), target } };
}

/**
 * Does the backend answer this key, and list the model? Checked before anything is
 * written, so claude-mem is never left on a key or a model that does not work.
 */
export async function checkCheapTarget(target: CheapTarget): Promise<string | null> {
  const base = target.baseUrl.replace(/\/v1$/, "");
  const answer = await listModels(base, target.apiKey);
  if ("error" in answer) return `${target.backend} did not answer (${answer.error})`;
  if (answer.status !== 200) return `${target.backend} refused its key (HTTP ${answer.status})`;
  if (!answer.models.some((model) => model.id === target.model)) {
    return `${target.backend} does not list the model ${target.model}`;
  }
  return null;
}

/** True for a claude-mem key path whose value must never be printed. */
export function isSecretPath(path: KeyPath): boolean {
  return path.at(-1) === API_KEY;
}

/** Writes (or, with `dryRun`, only checks) the plan's keys. */
export function applyClaudeMem(
  paths: CliPaths,
  plan: ClaudeMemPlan,
  dryRun: boolean,
): ManagedJsonResult {
  return applyManagedJson({
    file: paths.claudeMemSettingsFile,
    stateDir: paths.stateDir,
    set: plan.set,
    dryRun,
    unchosen: (path, value) =>
      typeof value === "string" && (UNCHOSEN[path.at(-1) ?? ""] ?? []).includes(value),
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
