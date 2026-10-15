/**
 * The gateway's part of Claude Code's `settings.json`: the env keys `gateway on` sets and
 * `gateway off` removes. They go through `applyManagedJson` as owned keys, so `restore`
 * undoes them too, and a key someone else set is never overwritten.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import {
  applyManagedJson,
  ForeignKeyError,
  formatKeyPath,
  type KeyPath,
  type ManagedJsonResult,
  ownedKeys,
} from "../setup/managed-json";
import { realTarget } from "../setup/write";

/**
 * The env keys `gateway on` writes. Opus and Fable stay unpinned, so they are real Claude.
 * No `ANTHROPIC_AUTH_TOKEN`: without one, Claude Code sends the person's own login.
 *
 * `ENABLE_TOOL_SEARCH`: with a base URL that is not Anthropic's, Claude Code turns MCP tool
 * search off and sends every tool definition up front (measured: an Opus session started
 * at 184K tokens through the router, against 70K without it). On `true` the tools stay
 * deferred; Anthropic expands them itself, and the router expands them for a cheap backend
 * (`toolSearchForBackend` in router.ts). https://code.claude.com/docs/en/env-vars
 */
export function gatewayEnv(port: number): Record<string, string> {
  return {
    ENABLE_TOOL_SEARCH: "true",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "anymodel-scout[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION: `Cheap model for search and reading: the scout slot (${COMMAND} gateway slot scout …)`,
    ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Scout (cheap)",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "anymodel-worker[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION: `Cheap model for routine code and docs: the worker slot (${COMMAND} gateway slot worker …)`,
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Worker (cheap)",
  };
}

/**
 * Env keys the gateway must never write.
 * - `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`: they replace the person's own login.
 * - `CLAUDE_CODE_SUBAGENT_MODEL`: an agent launched without `model` (a reviewer, say)
 *   would silently run on it, possibly a cheap slot. Without it, a forgotten `model` falls
 *   back to the main model: dearer, never a worse review.
 * - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`: it overrides the `model` of every Agent call, so a
 *   review could not stay on Claude.
 */
export const FORBIDDEN_ENV_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
] as const;

/** Every env key `gateway on` sets and `gateway off` removes. */
export const GATEWAY_ENV_KEYS: readonly string[] = Object.keys(gatewayEnv(20100));

/** Settings that move every agent launched without `model` onto one model. `status` warns. */
const SUBAGENT_OVERRIDE_ENV = ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"];

/** Settings that would replace the person's own login with a key or a helper. */
const LOGIN_OVERRIDE_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

const envPath = (key: string): KeyPath => ["env", key];

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The settings file as an object; `{}` when there is none. Throws on a file that is not one. */
function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it by hand, then run again.`);
  }
  if (!isJsonObject(parsed)) throw new Error(`${path} is not a JSON object; not touching it`);
  const env = parsed.env;
  if (env !== undefined && !isJsonObject(env))
    throw new Error(`${path} has an "env" that is not an object`);
  return parsed;
}

/** A key as output may show it: the last four characters at most. */
export function maskKey(key: string): string {
  return key.length >= 12 ? `••••${key.slice(-4)}` : "••••";
}

/** A settings value as output may show it: anything that looks like a key or a credential is masked. */
export function shownValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(text)) return maskKey(text);
  return /^sk-|[A-Za-z0-9_-]{32,}/.test(text) ? maskKey(text) : text;
}

/**
 * Throws ForeignKeyError when a gateway key is in the settings and cc-agentic does not own
 * it, also when it already has the wanted value: then `gateway off` could not remove it,
 * and the gateway would stay half on. An older install, or the person, set it; they remove
 * it (a project's migration does it for its machines). The value is masked.
 */
export function assertNoForeignGatewayKeys(settingsFile: string, stateDir: string): void {
  const env = readSettings(settingsFile).env;
  if (!isJsonObject(env)) return;
  const owned = ownedKeys(stateDir, realTarget(settingsFile));
  const isOwned = (key: string) =>
    owned.some((path) => path.length === 2 && path[0] === "env" && path[1] === key);
  for (const key of GATEWAY_ENV_KEYS) {
    if (!Object.hasOwn(env, key) || isOwned(key)) continue;
    throw new ForeignKeyError(
      `${settingsFile}: ${formatKeyPath(envPath(key))} is ${shownValue(env[key])}, set by someone else. ` +
        `${COMMAND} does not overwrite it. Remove it by hand if ${COMMAND} should manage it.`,
    );
  }
}

/** Sets the gateway env keys as owned keys. Throws ForeignKeyError on a key that is not ours. */
export function turnOn(options: {
  settingsFile: string;
  stateDir: string;
  port: number;
  dryRun?: boolean;
}): ManagedJsonResult {
  assertNoForeignGatewayKeys(options.settingsFile, options.stateDir);
  const set = Object.entries(gatewayEnv(options.port)).map(
    ([key, value]) => [envPath(key), value] as const,
  );
  for (const [path] of set) {
    if (FORBIDDEN_ENV_KEYS.some((key) => path[1] === key)) {
      throw new Error(`the gateway never writes ${formatKeyPath(path)}`);
    }
  }
  return applyManagedJson({
    file: options.settingsFile,
    stateDir: options.stateDir,
    set,
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
  });
}

/**
 * Removes the gateway env keys cc-agentic owns. A gateway key someone else set stays, and
 * is returned in `foreign`, so the output can name it.
 */
export function turnOff(options: { settingsFile: string; stateDir: string; dryRun?: boolean }): {
  result: ManagedJsonResult;
  foreign: string[];
} {
  const env = readSettings(options.settingsFile).env;
  const result = applyManagedJson({
    file: options.settingsFile,
    stateDir: options.stateDir,
    remove: GATEWAY_ENV_KEYS.map(envPath),
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
  });
  const foreign = result.skipped
    .map((skip) => skip.path[1])
    .filter(
      (key): key is string => key !== undefined && isJsonObject(env) && Object.hasOwn(env, key),
    );
  return { result, foreign };
}

/** What Claude Code's settings say about the gateway: names only, never a value. */
export function settingsReport(settingsPath: string): {
  baseUrl: null | string;
  loginOverrides: string[];
  subagentOverrides: string[];
} {
  const settings = readSettings(settingsPath);
  const env = isJsonObject(settings.env) ? settings.env : {};
  const baseUrl =
    typeof env.ANTHROPIC_BASE_URL === "string" ? shownValue(env.ANTHROPIC_BASE_URL) : null;
  const loginOverrides = LOGIN_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  if (Object.hasOwn(settings, "apiKeyHelper")) loginOverrides.push("apiKeyHelper");
  const subagentOverrides = SUBAGENT_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  return { baseUrl, loginOverrides, subagentOverrides };
}
