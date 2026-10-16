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
 *   1. `TAVILY_API_KEY` in the environment already: the person manages it, and setup
 *      changes nothing (`source: "environment"`).
 *   2. else the same key in the settings' own `env` (a person who set it there, or a copy
 *      setup wrote on an earlier run): nothing to write either (`source: "settings"`). It is
 *      a key Claude Code really uses — the same map it expands the header from.
 *   3. else the key file `<config dir>/cc-smart-dev-kit/tavily.key`: setup copies it into
 *      the user's `settings.json` `env` as an OWNED SECRET key — masked in output, kept as
 *      a SHA-256 in `owned.json`, and the settings file left at mode 600 — so every Claude
 *      Code session (and the MCP servers it starts) has it. `restore` removes that key.
 *   4. none of the three: no Tavily server; setup says how to add the key.
 *
 * The key itself is never printed, by any command, and never logged. A key file that others
 * can read is refused on Linux and macOS (the message names the file, never its content); on
 * Windows the profile's ACL is what protects it, and no file is refused over its bits.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { hostPlatform } from "../machine/host";
import { isOwnerOnly } from "../setup/file-mode";

/** The settings key the key is written to, for Claude Code's `${TAVILY_API_KEY}`. */
export const TAVILY_ENV_KEY = "TAVILY_API_KEY";

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

/** Is `name` set to a non-empty string in the `env` of this settings file? No value is read. */
export function settingsHasEnvKey(file: string, name: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const env = (parsed as { env?: unknown } | null)?.env;
    if (typeof env !== "object" || env === null || Array.isArray(env)) return false;
    const value = (env as Record<string, unknown>)[name];
    return typeof value === "string" && value.trim() !== "";
  } catch {
    return false;
  }
}

/**
 * The Tavily key, from the environment or the key file. Never prints a value: the reason
 * for a refusal names the file and what to do.
 *
 * What "only its owner may read" means comes from `isOwnerOnly`: the mode says it on Linux
 * and macOS, and on Windows the mode says nothing — the profile's ACL protects the file, so
 * no key file is refused there. That is also why only the refusal off Windows names `chmod`.
 */
export function readTavilyKey(
  paths: CliPaths,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = hostPlatform(),
): TavilyKey {
  if ((env[TAVILY_ENV_KEY] ?? "") !== "") return { source: "environment" };
  // The settings' own `env`: the key Claude Code expands `Bearer ${TAVILY_API_KEY}` from, so a
  // machine whose key lives ONLY there has a working Tavily server and nothing to write
  // (premium review, 2026-10-17: setup used to register no server at all then, while the
  // installer had already stopped asking for a key).
  if (settingsHasEnvKey(paths.settingsFile, TAVILY_ENV_KEY)) return { source: "settings" };
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
