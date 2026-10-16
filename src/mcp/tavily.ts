/**
 * The Tavily key: where it comes from, and how Claude Code gets it.
 *
 * The remote Tavily MCP server needs a key on every request. The key is never written into
 * a registration (`~/.claude.json` would hold it, and a process list would show it): the
 * registration carries `Bearer ${TAVILY_API_KEY}`, which Claude Code fills in from its own
 * environment at connect time. So the key has to BE in that environment, and that is what
 * this module arranges:
 *
 *   1. `TAVILY_API_KEY` in the environment already: the person manages it, and setup
 *      changes nothing (`source: "environment"`).
 *   2. else the key file `<config dir>/cc-smart-dev-kit/tavily.key`: setup copies it into
 *      the user's `settings.json` `env` as an OWNED SECRET key — masked in output, kept as
 *      a SHA-256 in `owned.json`, and the settings file left at mode 600 — so every Claude
 *      Code session (and the MCP servers it starts) has it. `restore` removes that key.
 *   3. neither: no Tavily server; setup says how to add the key.
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
export type TavilyKeySource = "environment" | "file";

export type TavilyKey =
  /** The environment already has it: nothing for setup to write. */
  | { source: "environment" }
  /** The key file has it: setup writes it into the settings as an owned secret key. */
  | { source: "file"; value: string }
  /** No usable key: the reason says what to do (never a value). */
  | { source: "none"; reason: string };

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
  if (!existsSync(paths.tavilyKeyFile)) {
    return {
      source: "none",
      reason:
        `no ${TAVILY_ENV_KEY} in the environment, and no key file: put the key there` +
        `${platform === "win32" ? "" : " (chmod 600)"} or set the variable, then run setup again`,
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
