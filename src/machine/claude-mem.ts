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
  type OwnedRecord,
  ownedRecords,
  ownership,
  readJsonObject,
  samePath,
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
 * **claude-mem's two start blocks are off on every machine** (D23, owner 2026-10-21): work
 * state (its to-do list) and the memory-use block. Both are planned whenever claude-mem is
 * installed, whether or not the gateway is set up (`START_BLOCK_KEYS`).
 *
 * Seven keys in `~/.claude-mem/settings.json`, owned through `applyManagedJson`, so a restore
 * takes them out and claude-mem is back on its own defaults: the five provider keys, and the
 * two start blocks. claude-mem writes every default into that file on its first run, so a key
 * that holds claude-mem's own default (`""`, `claude` for the provider, `true` for a start
 * block) counts as "nobody chose it" and may be taken. Any other value is the person's choice,
 * also in a key cc-smart-dev-kit set before and the person changed since: then setup leaves
 * that one key as it is (the provider keys wait together; a start block waits alone).
 */

export const CLAUDE_MEM_ID = "claude-mem@thedotmack";
/** The release that brought the openai-compatible provider and the quota fallback (its CHANGELOG). */
export const CLAUDE_MEM_MIN_VERSION = "13.29.0";
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

/**
 * claude-mem's two start blocks (D23), off on every machine. Work state is claude-mem's
 * to-do list, which tells every session to use its `work_state_write` tool; the memory-use
 * block tells it how to use memories. Together they pass Claude Code's 10,000-character
 * hook output limit in about one start in six (measured over 14 days: 36 of 218 starts).
 * `CLAUDE_MEM_WORK_STATE_ENABLED` came in 13.36.0 and also removes the work_state tools;
 * `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED` came in 13.35.0. Setup plans both whatever the
 * version: an older claude-mem ignores a key it does not know, and `plugin.json` asks for
 * 13.36.0, so every machine that installs claude-mem has both.
 */
export const START_BLOCK_KEYS = [
  "CLAUDE_MEM_WORK_STATE_ENABLED",
  "CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED",
] as const;

/** The start-block key that decides whether sessions need Claude Code's own task tools. */
export const WORK_STATE_KEY = START_BLOCK_KEYS[0];

/** What setup writes into both start blocks: off. */
const START_BLOCK_OFF = "false";

/**
 * The user setting that turns on Claude Code's own task tools (its to-do list, `TaskCreate`
 * and the rest). The live proof on Claude Code 2.1.306: they are absent in `claude -p` and
 * foreground sessions on newer models, and present in background sessions; `1` turns them on
 * everywhere. With claude-mem's work state off, this is a session's to-do home.
 */
export const TODO_TOOLS_KEY = "CLAUDE_CODE_ENABLE_TODO_TOOLS";
export const TODO_TOOLS_VALUE = "1";

/** For each key: the values that mean "nobody chose this yet" (claude-mem's defaults). */
const UNCHOSEN: Readonly<Record<string, readonly string[]>> = {
  [PROVIDER]: ["", "claude"],
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: [""],
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: [""],
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: [""],
  [API_KEY]: [""],
  [START_BLOCK_KEYS[0]]: ["", "true"],
  [START_BLOCK_KEYS[1]]: ["", "true"],
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
  /** claude-mem's two start blocks, off (D23). Planned whenever claude-mem is installed. */
  startBlocks: Array<readonly [KeyPath, string]>;
  /**
   * The keys that point claude-mem at the gateway's affordable model, or null when they are
   * left alone (no affordable scout, an older claude-mem, a key of the person's).
   */
  provider: null | {
    target: AffordableTarget;
    set: Array<readonly [KeyPath, string]>;
  };
  /**
   * What the plan leaves alone, in setup's words: a `!` warning, or an information line that
   * starts with two spaces. Setup prints them before its changes.
   */
  notes: string[];
  /**
   * Work state is off (or goes off), so a session has no to-do list from claude-mem: setup
   * also turns on Claude Code's own task tools (`TODO_TOOLS_KEY` in the user settings' `env`).
   */
  todoTools: boolean;
}

/** One start block as `doctor` reads it. */
export interface StartBlockReading {
  key: string;
  /** The value in claude-mem's file; null: the key is not there (claude-mem's default applies). */
  value: string | null;
  /** Who set it: cc-smart-dev-kit's setup, the person, or nobody (claude-mem's default). */
  by: "setup" | "person" | "default";
}

/**
 * claude-mem's settings file as a plan reads it: the file's object, where its keys go (the
 * old nested `env` form when that is what holds them), and the keys cc-smart-dev-kit owns.
 */
function readClaudeMemSettings(paths: CliPaths):
  | {
      data: JsonObject;
      at: (key: string) => KeyPath;
      records: OwnedRecord[];
      short: string;
    }
  | { problem: string } {
  const file = paths.claudeMemSettingsFile;
  const short = tildify(file, paths.home);
  let data: JsonObject;
  try {
    data = readJsonObject(file).data;
  } catch {
    return {
      problem: `${short} cannot be read (it is not valid JSON, or not a JSON object). Fix it by hand, then run ${COMMAND} setup again.`,
    };
  }
  const env = data.env;
  // claude-mem reads its keys under "env" when "env" holds any (an older file).
  const nested = isObject(env) && Object.keys(env).some((key) => key.startsWith("CLAUDE_MEM_"));
  return {
    data,
    at: (key: string): KeyPath => (nested ? ["env", key] : [key]),
    records: ownedRecords(paths.stateDir, realTarget(file)),
    short,
  };
}

/**
 * The two start blocks as they are now: what each holds, and who set it. Null when claude-mem
 * is not installed; a `problem` when its settings file cannot be read. `doctor` prints it.
 */
export function readStartBlocks(paths: CliPaths): StartBlockReading[] | { problem: string } | null {
  const install = findUserInstall(paths.installedPluginsFile, CLAUDE_MEM_ID);
  if (install === null || !existsSync(install.installPath)) return null;
  const read = readClaudeMemSettings(paths);
  if ("problem" in read) return read;
  return START_BLOCK_KEYS.map((key) => {
    const path = read.at(key);
    const current = getKey(read.data, path);
    if (!current.found) return { key, value: null, by: "default" };
    const value = typeof current.value === "string" ? current.value : null;
    const record = read.records.find((entry) => samePath(entry.path, path));
    if (record !== undefined) {
      // A record with no value is the claim made just before a write: it counts as ours.
      const ours =
        record.sha256 === undefined &&
        (Object.hasOwn(record, "value") ? Bun.deepEquals(record.value, current.value) : true);
      return { key, value, by: ours ? "setup" : "person" };
    }
    return {
      key,
      value,
      // Not in the file's own default form (a value that is not a string, say): the person's.
      by: unchosen(path, current.value) ? "default" : "person",
    };
  });
}

/** How a start-block value is named in a note: JSON, so `"true"` reads as the string it is. */
function shownStartBlock(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * The two start blocks, planned off. claude-mem's own default (`"true"` or `""`) counts as
 * unchosen, so setup may take it. Any other value is the person's: it stays, and the note
 * says so. A value setup wrote before and the person changed since is theirs too — also
 * `"true"`, which is how the README's way back on reads, so setup must never undo it.
 */
function planStartBlocks(
  read: { data: JsonObject; at: (key: string) => KeyPath; records: OwnedRecord[]; short: string },
  notes: string[],
): Array<readonly [KeyPath, string]> {
  const planned: Array<readonly [KeyPath, string]> = [];
  for (const key of START_BLOCK_KEYS) {
    const path = read.at(key);
    const current = getKey(read.data, path);
    if (!current.found || Bun.deepEquals(current.value, START_BLOCK_OFF)) {
      planned.push([path, START_BLOCK_OFF]);
      continue;
    }
    const record = read.records.find((entry) => samePath(entry.path, path));
    // A value setup wrote before and the person changed since is theirs, whatever it is.
    const theirs = record !== undefined && Object.hasOwn(record, "value");
    // claude-mem seeded its own default ("true" or ""): nobody chose it, so setup may take it.
    if (!theirs && unchosen(path, current.value)) {
      planned.push([path, START_BLOCK_OFF]);
      continue;
    }
    notes.push(
      `! claude-mem settings left alone: ${key} is ${shownStartBlock(current.value)} in ${read.short} (your choice)`,
    );
  }
  return planned;
}

/**
 * The provider keys, or null with the reason in `notes`. Nothing here writes without an
 * affordable scout target, a claude-mem new enough for the provider, a file in the flat form,
 * no key pool of the person's, and no other value of theirs among the five keys.
 */
function planProvider(
  paths: CliPaths,
  install: { version: string | null },
  read: { data: JsonObject; at: (key: string) => KeyPath; records: OwnedRecord[]; short: string },
  notes: string[],
): ClaudeMemPlan["provider"] {
  const affordable = gatewayAffordableTarget(paths.gatewayConfigFile);
  if ("reason" in affordable) {
    // cc-smart-dev-kit pointed claude-mem at a backend before, and there is no affordable model now.
    const provider = getKey(read.data, read.at(PROVIDER));
    if (provider.found && ownership(read.records, read.at(PROVIDER), provider) === "ours") {
      notes.push(
        `! claude-mem still uses the backend ${COMMAND} set for it, but ${affordable.reason}. Run ${COMMAND} setup again once the scout slot starts with an affordable model, or ${COMMAND} restore to put claude-mem back on its own defaults.`,
      );
    }
    return null;
  }

  const version = comparableVersion(install.version);
  if (version === null || Bun.semver.order(version, CLAUDE_MEM_MIN_VERSION) < 0) {
    // The companion check says it already, when plugin.json's range covers it: one note.
    const companion = companions().find((entry) => entry.id === CLAUDE_MEM_ID);
    const state = companion === undefined ? null : companionState(paths, companion).kind;
    if (state !== "outside-range" && state !== "unknown-version") {
      notes.push(
        `! claude-mem settings left alone: ${
          version === null
            ? `claude-mem's version ${install.version ?? "(none)"} is unknown, so cc-smart-dev-kit cannot tell whether it has what they need (${CLAUDE_MEM_MIN_VERSION} or newer). Run: claude plugin update ${CLAUDE_MEM_ID}`
            : `claude-mem ${install.version} is older than ${CLAUDE_MEM_MIN_VERSION}, which brought what they need. Run: claude plugin update ${CLAUDE_MEM_ID}`
        }`,
      );
    }
    return null;
  }

  const pool = getKey(read.data, read.at(API_KEY_POOL));
  if (pool.found && typeof pool.value === "string" && pool.value.trim() !== "") {
    notes.push(
      `  claude-mem settings left alone: ${API_KEY_POOL} holds your own keys in ${read.short} (your choice)`,
    );
    return null;
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
    const path = read.at(key);
    const current = getKey(read.data, path);
    if (!current.found || current.value === value) continue;
    const whose = ownership(read.records, path, current, unchosen);
    if (whose === "ours" || (whose === "none" && unchosen(path, current.value))) continue;
    const shown = key === API_KEY ? "another key" : JSON.stringify(current.value);
    notes.push(
      `  claude-mem settings left alone: ${key} is ${shown} in ${read.short} (your choice)`,
    );
    return null;
  }
  return {
    target,
    set: Object.entries(wanted).map(([key, value]) => [read.at(key), value] as const),
  };
}

/**
 * What setup does for claude-mem:
 * - `plan`: the keys to set (the two start blocks, and the provider keys when a plan has them);
 * - `note`: a line that says why it leaves the whole file alone (it cannot be read, or it is
 *   in claude-mem's old nested form);
 * - `notInstalled`: claude-mem is not installed yet. Setup may install it (a companion
 *   step) and then plan again.
 */
export function claudeMemPlan(
  paths: CliPaths,
): { plan: ClaudeMemPlan } | { note: string | null } | { notInstalled: true } {
  const install = findUserInstall(paths.installedPluginsFile, CLAUDE_MEM_ID);
  if (install === null || !existsSync(install.installPath)) return { notInstalled: true };

  const read = readClaudeMemSettings(paths);
  if ("problem" in read) return { note: `! claude-mem settings left alone: ${read.problem}` };
  const left = (why: string) => ({ note: `! claude-mem settings left alone: ${why}` });

  // claude-mem rewrites a file that holds only "env" flat on its next start, and drops
  // any flat key written beside "env" then; an owned key written under "env" would lose its
  // path in the rewrite. So the whole file waits for that one start.
  if (isObject(read.data.env) && Object.keys(read.data).every((key) => key === "env")) {
    return left(
      `${read.short} is in claude-mem's old nested form, which claude-mem rewrites when it next starts. Start a Claude Code session, then run cc-smart-dev-kit setup again.`,
    );
  }

  const notes: string[] = [];
  const startBlocks = planStartBlocks(read, notes);
  const provider = planProvider(paths, install, read, notes);
  return {
    plan: {
      remove: RETIRED_KEYS.map(read.at),
      startBlocks,
      provider,
      notes,
      todoTools: startBlocks.some(([path]) => path.at(-1) === WORK_STATE_KEY),
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
    set: [...plan.startBlocks, ...(plan.provider?.set ?? [])],
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
