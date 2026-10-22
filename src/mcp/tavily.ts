/**
 * The Tavily key: where it comes from, and how Claude Code gets it.
 *
 * The remote Tavily MCP server needs a key on every request. The key is never written into
 * a registration (`~/.claude.json` would hold it, and a process list would show it): the
 * registration carries `Bearer ${TAVILY_API_KEY}`, which Claude Code fills in at connect time.
 * It fills it from the process environment AND from the `env` of the settings files — the
 * user's `settings.json`, a `--settings` file, a managed one — which is the map its MCP config
 * expansion is handed (`userSettings`/`flagSettings`/`policySettings` `.env`, read in the
 * installed 2.1.302; the expansion itself takes the process environment and that map). So the
 * key has to BE in one of those places, and that is what this module arranges:
 *
 *   1. `TAVILY_API_KEY` in the environment, set by the person: they manage it, and setup
 *      changes nothing (`source: "environment"`).
 *   2. else a key the PERSON put in the settings' own `env`: nothing to write either
 *      (`source: "settings"`). It is a key Claude Code really uses — the same map it expands
 *      the header from.
 *   3. else the key file `<config dir>/cc-smart-dev-kit/tavily.key`: setup copies it into
 *      the user's `settings.json` `env` as an OWNED SECRET key — masked in output, kept as
 *      a SHA-256 in `owned.json`, and the settings file left at mode 600 — so every Claude
 *      Code session (and the MCP servers it starts) has it. `restore` removes that key.
 *   4. else the copy setup wrote on an earlier run, when the key file is gone since: it is
 *      still a working key, so it stays (`source: "settings"`).
 *   5. none of these: no Tavily server; setup says how to add the key.
 *
 * Which value is setup's own copy is told by its hash in `owned.json`, never by where it was
 * found (ST-3): Claude Code hands the settings' `env` to its own Bash tool, so a setup run in
 * a session sees that copy in its environment too — read as the person's key, it made setup
 * remove the copy. And a copy of an older key must give way to a key file that holds a new
 * one, so the copy counts as the key file's, never as a key of the person's in the settings.
 *
 * The key itself is never printed, by any command, and never logged. A key file that others
 * can read is refused on Linux and macOS (the message names the file, never its content); on
 * Windows the profile's ACL is what protects it, and no file is refused over its bits.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { hostPlatform } from "../machine/host";
import { isOwnerOnly } from "../setup/file-mode";
import { isObject, isOwnedValue, type KeyPath } from "../setup/managed-json";
import { readUserJson } from "../setup/user-json";

/** The settings key the key is written to, for Claude Code's `${TAVILY_API_KEY}`. */
export const TAVILY_ENV_KEY = "TAVILY_API_KEY";

/** Where in `settings.json` setup writes its copy of the key (an owned secret key). */
export const TAVILY_KEY_PATH: KeyPath = ["env", TAVILY_ENV_KEY];

/** Where the key came from. */
export type TavilyKeySource = "environment" | "file" | "settings";

export type TavilyKey =
  /** The environment already has it: nothing for setup to write. */
  | { source: "environment" }
  /** The settings' own `env` has it: Claude Code reads it there, so nothing to write either. */
  | { source: "settings" }
  /** The key file has it: setup writes it into the settings as an owned secret key. */
  | { source: "file"; value: string }
  /** No usable key: the reason says what to do (never a value). */
  | { source: "none"; reason: string };

/**
 * The value of `name` in the `env` of this settings file, when it is a non-empty string; else
 * null. A file that does not read is no key either, never an error: setup's own pass reports it.
 * The value is only compared, never printed.
 */
export function settingsEnvValue(file: string, name: string): null | string {
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = readUserJson(file);
  } catch {
    return null;
  }
  const env = isObject(parsed) ? parsed.env : undefined;
  const value = isObject(env) ? env[name] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * True when `value` is the copy of the key setup wrote into the settings (its hash in
 * `owned.json`). An `owned.json` that cannot be read tells nothing, so nothing is setup's copy
 * then — the key is read as before ST-3, and setup's own pass reports the broken record.
 */
function isSetupsCopy(paths: CliPaths, value: string): boolean {
  try {
    return isOwnedValue(paths.stateDir, paths.settingsFile, TAVILY_KEY_PATH, value);
  } catch {
    return false;
  }
}

/**
 * The Tavily key, in the order the module's comment gives. Never prints a value: the reason
 * for a refusal names the file and what to do.
 */
export function readTavilyKey(
  paths: CliPaths,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = hostPlatform(),
): TavilyKey {
  const fromEnv = env[TAVILY_ENV_KEY] ?? "";
  if (fromEnv !== "" && !isSetupsCopy(paths, fromEnv)) return { source: "environment" };
  // The settings' own `env`: the key Claude Code expands `Bearer ${TAVILY_API_KEY}` from, so a
  // machine whose key lives ONLY there has a working Tavily server and nothing to write
  // (premium review, 2026-10-17: setup used to register no server at all then, while the
  // installer had already stopped asking for a key).
  const inSettings = settingsEnvValue(paths.settingsFile, TAVILY_ENV_KEY);
  const copyOnly = inSettings !== null && isSetupsCopy(paths, inSettings);
  if (inSettings !== null && !copyOnly) return { source: "settings" };
  const fromFile = readKeyFile(paths, platform);
  // Setup's own copy gives way to the key file; with no usable key file it is still a working
  // key, and stays (M2).
  if (fromFile.source === "none" && copyOnly) return { source: "settings" };
  return fromFile;
}

/**
 * The key file's key, or why there is none.
 *
 * What "only its owner may read" means comes from `isOwnerOnly`: the mode says it on Linux
 * and macOS, and on Windows the mode says nothing — the profile's ACL protects the file, so
 * no key file is refused there. That is also why only the refusal off Windows names `chmod`.
 */
function readKeyFile(paths: CliPaths, platform: NodeJS.Platform): TavilyKey {
  if (!existsSync(paths.tavilyKeyFile)) {
    return {
      source: "none",
      reason:
        `no ${TAVILY_ENV_KEY} in the environment, in the settings, or in a key file: put the key there` +
        `${platform === "win32" ? "" : " (chmod 600)"}, or set the variable, then run setup again`,
    };
  }
  let mode: number;
  let text: string;
  try {
    mode = statSync(paths.tavilyKeyFile).mode & 0o7777;
    text = readFileSync(paths.tavilyKeyFile, "utf8");
  } catch (error) {
    return {
      source: "none",
      reason: `${paths.tavilyKeyFile} cannot be read (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (!isOwnerOnly(mode, platform)) {
    return {
      source: "none",
      reason:
        `${paths.tavilyKeyFile} is readable by others (mode ${mode.toString(8)}): ` +
        `run \`chmod 600 ${paths.tavilyKeyFile}\`, then setup again`,
    };
  }
  const value = text.trim();
  if (value === "") {
    return { source: "none", reason: `${paths.tavilyKeyFile} is empty; write the key into it` };
  }
  return { source: "file", value };
}
