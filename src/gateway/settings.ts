/**
 * The gateway's part of Claude Code's `settings.json`: the env keys `gateway on` sets and
 * `gateway off` takes back. They go through `applyManagedJson` as owned keys, so `restore`
 * undoes them too, and a key someone else set is never overwritten.
 *
 * **`off` sets the address, it does not remove the key** (GP5): a changed value reaches a
 * running Claude session within about a second, while a removed key never does — the session
 * keeps the address it last had (proved 2026-10-23, `.claude/research/2026-10-23-r6-proofs.md`
 * § P7). So the owned `env.ANTHROPIC_BASE_URL` is left holding Anthropic's own address, the
 * one value that means plain Claude on the person's own login (P1, the same value
 * `gateway project off` writes), and `restore` takes the key back later.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import {
  applyManagedJson,
  createdObjects,
  ForeignKeyError,
  formatKeyPath,
  getKey,
  type KeyPath,
  type ManagedJsonResult,
  ownedKeys,
  ownedRecords,
  ownership,
} from "../setup/managed-json";
import { parseUserJson } from "../setup/user-json";
import { realTarget } from "../setup/write";
import { DEFAULT_ANTHROPIC_BASE_URL } from "./config";
import { CLAUDE_FAMILIES, familyEnv } from "./targets";

/**
 * The env keys `gateway on` writes. No model is pinned: Claude Code sends each Claude
 * model's own id, and the router takes it to the slot of its family when that slot has a
 * chain (haiku → scout, sonnet → worker, opus, fable), or to Anthropic unchanged when it has
 * none. No `ANTHROPIC_AUTH_TOKEN`: without one, Claude Code sends the person's own login.
 *
 * `ENABLE_TOOL_SEARCH`: Claude Code 2.1.304 and later keep MCP tool search on behind a base
 * URL that is not Anthropic's, so this key is not needed there. It stays written for an older
 * Claude Code, which turned tool search off behind a gateway and sent every tool definition up
 * front (measured before 2.1.304: an Opus session started at 184K tokens through the router,
 * against 70K without it), and it says "on" on purpose: Anthropic expands the deferred tools
 * itself, and the router expands them for an affordable backend (`toolSearchForBackend` in
 * router.ts). https://code.claude.com/docs/en/env-vars
 */
export function gatewayEnv(port: number): Record<string, string> {
  return {
    ENABLE_TOOL_SEARCH: "true",
    ANTHROPIC_BASE_URL: routerBaseUrl(port),
  };
}

/**
 * The router's root URL on `port`: what `gateway on` writes and what a project's state names
 * (`project-state.ts`). One home, so the two can never disagree about the address.
 */
export function routerBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * The only host Claude Code allows Remote Control with, when `ANTHROPIC_BASE_URL` is set
 * (`docs/claude-code-contract.md` § The gateway). Read from Anthropic's own address, never typed.
 */
export const REMOTE_CONTROL_HOST: string = new URL(DEFAULT_ANTHROPIC_BASE_URL).host;

/** A base URL as it is compared: a trailing slash is the same address (`…/`). */
export function normalizedBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Whether a settings file's own `ANTHROPIC_BASE_URL` sends Claude Code to the router rather
 * than to Anthropic: the key is set and holds something other than Anthropic's own address.
 * Null — no key at all — is off, and so is Anthropic's address, the value `gateway off` and
 * `gateway project off` write (GP5, P1): "the key is set" no longer answers this question.
 * One home: the two hooks that decide whether the gateway is on
 * (`agent-guard.ts`, `stop-failure.ts`), the portal's facts and `restore`'s stage 1 all ask it.
 */
export function baseUrlPointsAtGateway(url: null | string): boolean {
  return url !== null && normalizedBaseUrl(url) !== DEFAULT_ANTHROPIC_BASE_URL;
}

/**
 * What a settings file's `env.ANTHROPIC_BASE_URL` needs for the gateway to be off, and whose
 * key it is (GP5):
 * - `write`: the key is cc-smart-dev-kit's and holds another address — set it to Anthropic's own,
 *   which a running session follows within about a second where a removed key never would.
 * - `same`: nothing to do — no key at all, or one that already holds Anthropic's own address.
 * - `theirs`: a key the person set, changed or removed since: never written, never removed.
 *   `present` says whether it is still in the file, so a command can name it.
 *
 * A **changed** value reaches a running Claude session within about a second, a **removed** key
 * never does (proved 2026-10-23, `.claude/research/2026-10-23-r6-proofs.md` § P7), so this is
 * what switches running sessions at once and keeps the key owned for `restore` to take back.
 */
export type OffAddress =
  | { kind: "write"; value: string }
  | { kind: "same" }
  | { kind: "theirs"; present: boolean };

/**
 * Reads one settings file and answers `OffAddress` for it. A file that cannot be read answers
 * `same`: the managed write that follows reports the file's own error in its own words
 * (`applyManagedJson`), which a restore knows how to say.
 */
export function offAddressOf(file: string, stateDir: string): OffAddress {
  let settings: Record<string, unknown>;
  try {
    settings = readSettings(file);
  } catch {
    return { kind: "same" };
  }
  const records = ownedRecords(stateDir, realTarget(file));
  const current = getKey(settings, BASE_URL_PATH);
  const ours = ownership(records, BASE_URL_PATH, current) === "ours";
  if (!current.found) {
    // A key that is not in the file any more is the person's: never put back. `ownership`
    // answers "changed" for a missing key whatever the record says, so this is always theirs.
    return { kind: "theirs", present: false };
  }
  if (normalizedBaseUrl(String(current.value)) === DEFAULT_ANTHROPIC_BASE_URL) {
    return ours ? { kind: "same" } : { kind: "theirs", present: true };
  }
  return ours
    ? { kind: "write", value: DEFAULT_ANTHROPIC_BASE_URL }
    : { kind: "theirs", present: true };
}

/**
 * Env keys `gateway on` wrote up to 0.4.3: they pointed the `haiku` and `sonnet` names at the
 * scout and worker slot names. With them, a slot with no chain could not be plain Claude (the
 * request names the slot, not a Claude model), so `gateway on` removes the ones cc-smart-dev-kit
 * still owns, and `gateway off` and `restore` treat them as the gateway's own keys.
 */
export const RETIRED_GATEWAY_ENV_KEYS: readonly string[] = [
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
];

/**
 * Env keys the gateway must never write.
 * - `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`: they replace the person's own login.
 * - `CLAUDE_CODE_SUBAGENT_MODEL`: an agent launched without `model` (a reviewer, say)
 *   would silently run on it, possibly an affordable slot. Without it, a forgotten `model` falls
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

/** Every env key `gateway on` sets. */
export const GATEWAY_ENV_KEYS: readonly string[] = Object.keys(gatewayEnv(20100));

/**
 * Every env key the gateway writes: the ones `on` sets, and the ones it once set. `turnOff`
 * removes all of them but the address, which it sets to Anthropic's own instead (GP5).
 */
const GATEWAY_ENV_KEYS_ALL: readonly string[] = [...GATEWAY_ENV_KEYS, ...RETIRED_GATEWAY_ENV_KEYS];

/** Settings that move every agent launched without `model` onto one model. `status` warns. */
const SUBAGENT_OVERRIDE_ENV = ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"];

/** Settings that would replace the person's own login with a key or a helper. */
const LOGIN_OVERRIDE_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

const envPath = (key: string): KeyPath => ["env", key];

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The settings file as an object; `{}` when there is none. Throws on a file that is not one.
 * Read as `applyManagedJson` reads one: an empty file is `{}`, and a byte order mark an editor
 * put first is skipped — so the reader and the writer agree about the same file.
 */
function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = parseUserJson(text);
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

/**
 * A backend's address with nothing secret left in it: no user name or password, no query and
 * no fragment — a key can ride in any of them (`?key=…`), and the router never needs one there:
 * it adds its paths to the address. Null when the text is not a URL, so nothing of it is shown.
 * What a page may show or link to (the OmniRoute dashboard), without its last slash.
 */
export function backendAddress(baseUrl: string): null | string {
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * A backend's address as a person reads it: `backendAddress`, then its key in the masked form.
 * One home, because two callers show it — `omniroute status` and the portal's pages — and
 * neither may print a whole key.
 */
export function shownBackendUrl(baseUrl: string, apiKey: string): string {
  const masked = maskKey(apiKey);
  const address = backendAddress(baseUrl);
  return address === null ? `(key ${masked})` : `${address} (key ${masked})`;
}

/** A settings value as output may show it: anything that looks like a key or a credential is masked. */
export function shownValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(text)) return maskKey(text);
  return /^sk-|[A-Za-z0-9_-]{32,}/.test(text) ? maskKey(text) : text;
}

/**
 * The gateway env keys cc-smart-dev-kit owns in the settings file AND still holds the value cc-smart-dev-kit
 * wrote: a key the person changed or removed since is theirs (the record holds a value, and
 * the file holds another one, or no key at all), and `restore` leaves it. A record with no
 * value (an `owned.json` from before values were kept, or the claim written just before a
 * write) counts as ours, whatever the key holds. While one of them points at the router
 * (`baseUrlPointsAtGateway`), running Claude sessions may still send every request to it.
 */
export function ownedGatewayEnvKeys(settingsFile: string, stateDir: string): string[] {
  const settings = currentSettings(settingsFile);
  if (settings === null) {
    // Unreadable (restore reports the file's own error a moment later): every gateway key
    // cc-smart-dev-kit recorded counts as still in use. The conservative answer for the one
    // caller: it decides whether a running router may be stopped at once, and a key that is
    // there but cannot be read must keep every session working.
    const owned = ownedKeys(stateDir, realTarget(settingsFile));
    return GATEWAY_ENV_KEYS_ALL.filter((key) =>
      owned.some((path) => path.length === 2 && path[0] === "env" && path[1] === key),
    );
  }
  const records = ownedRecords(stateDir, realTarget(settingsFile));
  return GATEWAY_ENV_KEYS_ALL.filter(
    (key) => ownership(records, envPath(key), getKey(settings, envPath(key))) === "ours",
  );
}

/**
 * The settings file's object as it is now, for the ownership check above, or null when it
 * cannot be read (not JSON, not an object, an `env` that is not one).
 */
function currentSettings(settingsFile: string): null | Record<string, unknown> {
  try {
    return readSettings(settingsFile);
  } catch {
    return null;
  }
}

/**
 * Throws ForeignKeyError when a gateway key is in the settings and cc-smart-dev-kit does not own
 * it, also when it already has the wanted value: then `gateway off` could not take it back,
 * and the gateway would stay half on. An older install, or the person, set it; they remove
 * it (a project's migration does it for its machines). The value is masked.
 *
 * This check is by key path (`ownedKeys`), not by value like `ownedGatewayEnvKeys`: a key
 * cc-smart-dev-kit set and the person changed since still counts as owned here, and the write itself
 * refuses it with the message for that case (it was changed after cc-smart-dev-kit set it).
 */
export function assertNoForeignGatewayKeys(settingsFile: string, stateDir: string): void {
  const env = readSettings(settingsFile).env;
  if (!isJsonObject(env)) return;
  const owned = ownedKeys(stateDir, realTarget(settingsFile));
  const owns = (key: string) =>
    owned.some((path) => path.length === 2 && path[0] === "env" && path[1] === key);
  for (const key of GATEWAY_ENV_KEYS) {
    if (!Object.hasOwn(env, key) || owns(key)) continue;
    // Many people set ENABLE_TOOL_SEARCH themselves, for their own reasons: say so.
    const yourOwn =
      key === "ENABLE_TOOL_SEARCH"
        ? ` Many people set ENABLE_TOOL_SEARCH themselves; removing it by hand lets ${COMMAND} gateway on manage it (it sets "true", and gateway off removes it again).`
        : "";
    throw new ForeignKeyError(
      `${settingsFile}: ${formatKeyPath(envPath(key))} is ${shownValue(env[key])}, set by someone else. ` +
        `${COMMAND} does not overwrite it. Remove it by hand if ${COMMAND} should manage it.${yourOwn}`,
    );
  }
}

/**
 * Sets the gateway env keys as owned keys, and removes the retired ones cc-smart-dev-kit still
 * owns (`RETIRED_GATEWAY_ENV_KEYS`; one the person set or changed stays). Throws
 * ForeignKeyError on a key that is not ours.
 */
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
    remove: RETIRED_GATEWAY_ENV_KEYS.map(envPath),
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
  });
}

/**
 * Removes only the retired model keys (`RETIRED_GATEWAY_ENV_KEYS`) cc-smart-dev-kit still owns
 * with the value it wrote: `gateway setup` runs it, the step every machine runs after an
 * update, so a machine whose settings still send `haiku` / `sonnet` work to a slot by name
 * stops doing that even before `gateway on`. A key the person set or changed stays. With no
 * settings file, nothing is written.
 */
export function retireOldModelKeys(options: {
  settingsFile: string;
  stateDir: string;
  dryRun?: boolean;
}): ManagedJsonResult {
  return applyManagedJson({
    file: options.settingsFile,
    stateDir: options.stateDir,
    remove: RETIRED_GATEWAY_ENV_KEYS.map(envPath),
    createdObject: createdObjects(options.stateDir, options.settingsFile),
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
  });
}

/**
 * Turns the gateway off: removes the keys cc-smart-dev-kit owns, and **writes Anthropic's own
 * address into `env.ANTHROPIC_BASE_URL` instead of removing it** (`offAddressOf`, GP5), so
 * every running session switches to Anthropic within about a second — a removed key would wait
 * for each session's restart. `switched` says whether that write happened in this call. A
 * gateway key someone else set stays, and is returned in `foreign`, so the output can name it.
 */
export function turnOff(options: { settingsFile: string; stateDir: string; dryRun?: boolean }): {
  result: ManagedJsonResult;
  foreign: string[];
  switched: boolean;
} {
  const env = readSettings(options.settingsFile).env;
  const address = offAddressOf(options.settingsFile, options.stateDir);
  const result = applyManagedJson({
    file: options.settingsFile,
    stateDir: options.stateDir,
    ...(address.kind === "write" ? { set: [[BASE_URL_PATH, address.value] as const] } : {}),
    // The address key is **written, never removed** (GP5): its value is the switch, so a file
    // that already holds Anthropic's own address is left exactly as it is, and a key the person
    // set, changed or removed is theirs and stays theirs (`applyManagedJson` skips it).
    remove: GATEWAY_ENV_KEYS_ALL.filter((key) => key !== BASE_URL_KEY).map(envPath),
    // Gateway setup created the `env` these keys live in, when the settings had none: an
    // `env` this removal empties goes with them. One the person had stays.
    createdObject: createdObjects(options.stateDir, options.settingsFile),
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
  });
  const foreign = [
    ...result.skipped
      .map((skip) => skip.path[1])
      .filter(
        (key): key is string => key !== undefined && isJsonObject(env) && Object.hasOwn(env, key),
      ),
    ...(address.kind === "theirs" && address.present ? [BASE_URL_KEY] : []),
  ];
  return {
    foreign,
    result,
    // The only `set` this call makes is the address: a change with a value after it is that write.
    switched:
      address.kind === "write" && result.changes.some((change) => change.after !== undefined),
  };
}

/**
 * Which of the `foreign` keys `turnOff` returned still send a session away from Anthropic. A key
 * of the person's own that already holds Anthropic's address sends every session exactly where
 * `off` would: it routes nothing, and "the gateway is not all off" would be untrue
 * (`baseUrlPointsAtGateway`, GP5). A file that cannot be read counts as routing.
 * `ENABLE_TOOL_SEARCH` routes nothing either, and many people set it themselves. One home:
 * `gateway off` and the setup step that turns the gateway off both ask it.
 */
export function foreignRouting(
  foreign: readonly string[],
  settingsFile: string,
): { routing: string[]; ownAddressRoutes: boolean } {
  let ownAddressRoutes = true;
  try {
    ownAddressRoutes = baseUrlPointsAtGateway(readGatewaySettings(settingsFile).baseUrl);
  } catch {
    ownAddressRoutes = true;
  }
  const routing = foreign.filter(
    (key) => key !== "ENABLE_TOOL_SEARCH" && !(key === BASE_URL_KEY && !ownAddressRoutes),
  );
  return { routing, ownAddressRoutes };
}

/**
 * One of Claude Code's own model keys, and the value it holds. The kit never writes these keys
 * (`FORBIDDEN_ENV_KEYS` covers the subagent ones); it reads them only to warn: a project file
 * that names a slot or a backend target there sends that name past the gateway's slots
 * (`doctor`, GP4a). A value is a model name, never a secret.
 */
export interface ModelKeyFact {
  /** The key as a person reads it: `model`, `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`. */
  key: string;
  value: string;
}

/**
 * A settings file's gateway facts as they are written, for a reader that must compare the URL
 * itself — the project's effective-state reader (`project-state.ts`), which tells this
 * machine's router from another gateway's address. Never for output: `settingsReport` masks.
 * Throws when the file cannot be read (the caller reports it; the readers here never do).
 * `baseUrlProblem`: the key is there and is not a text with something in it, so no URL can be
 * read from it — `settingsReport` still says "none", as before; the project reader reports it.
 */
export function readGatewaySettings(settingsPath: string): {
  baseUrl: null | string;
  baseUrlProblem: null | string;
  loginOverrides: string[];
  /** Claude Code's own model keys the file sets, in one fixed order: `model` first, then each
   * family's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`. */
  modelKeys: ModelKeyFact[];
  subagentOverrides: string[];
} {
  const settings = readSettings(settingsPath);
  const env = isJsonObject(settings.env) ? settings.env : {};
  const held = env.ANTHROPIC_BASE_URL;
  const usable = typeof held === "string" && held.trim() !== "";
  const baseUrlProblem =
    Object.hasOwn(env, "ANTHROPIC_BASE_URL") && !usable
      ? `${settingsPath}: env.ANTHROPIC_BASE_URL is not a text with an address in it`
      : null;
  const loginOverrides = LOGIN_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  if (Object.hasOwn(settings, "apiKeyHelper")) loginOverrides.push("apiKeyHelper");
  const subagentOverrides = SUBAGENT_OVERRIDE_ENV.filter((key) => Object.hasOwn(env, key));
  // Claude Code's own model keys, read for the doctor's warning: a slot key or a backend target
  // here reaches past the gateway's slots. Read as they are written; a value that is not a text
  // names no model.
  const modelKeys: ModelKeyFact[] = [];
  if (typeof settings.model === "string" && settings.model.trim() !== "") {
    modelKeys.push({ key: "model", value: settings.model });
  }
  for (const family of CLAUDE_FAMILIES) {
    const key = familyEnv(family);
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "")
      modelKeys.push({ key: `env.${key}`, value });
  }
  return {
    baseUrl: usable ? held : null,
    baseUrlProblem,
    loginOverrides,
    modelKeys,
    subagentOverrides,
  };
}

/** What Claude Code's settings say about the gateway, as output may show them: names only, never a value. */
export function settingsReport(settingsPath: string): {
  baseUrl: null | string;
  loginOverrides: string[];
  subagentOverrides: string[];
} {
  const { baseUrl, loginOverrides, subagentOverrides } = readGatewaySettings(settingsPath);
  return {
    baseUrl: baseUrl === null ? null : shownValue(baseUrl),
    loginOverrides,
    subagentOverrides,
  };
}

/** The one key a project's state is: `env.ANTHROPIC_BASE_URL` of one of its settings files. */
export const BASE_URL_KEY = "ANTHROPIC_BASE_URL";

/** The key path the gateway's address lives at, in Claude Code's own settings: `env.…`. */
export const BASE_URL_PATH: KeyPath = ["env", BASE_URL_KEY];

/**
 * Sets `env.ANTHROPIC_BASE_URL` in a project's settings file, as an owned key (D29, GP2):
 * `applyManagedJson` backs the file up, records the key in `owned.json` so `restore` takes it
 * back, and refuses a key someone else set. The caller checks the chain's login overrides and
 * a foreign URL first (`planProjectChange`), so a refusal here names only the managed rule.
 */
export function setGatewayBaseUrl(options: {
  file: string;
  stateDir: string;
  value: string;
}): ManagedJsonResult {
  return applyManagedJson({
    file: options.file,
    stateDir: options.stateDir,
    set: [[BASE_URL_PATH, options.value]],
  });
}

/**
 * Removes `env.ANTHROPIC_BASE_URL` from a project's settings file, only while cc-smart-dev-kit
 * owns it and it still holds the value it wrote: a value the person set or changed stays. An
 * `env` cc-smart-dev-kit created goes with its last key; one the person had stays.
 */
export function clearGatewayBaseUrl(options: {
  file: string;
  stateDir: string;
}): ManagedJsonResult {
  return applyManagedJson({
    file: options.file,
    stateDir: options.stateDir,
    remove: [BASE_URL_PATH],
    createdObject: createdObjects(options.stateDir, options.file),
  });
}
