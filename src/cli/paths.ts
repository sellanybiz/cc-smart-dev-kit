import { homedir } from "node:os";
import { join } from "node:path";

export interface CliPaths {
  home: string;
  /** `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
  claudeConfigDir: string;
  settingsFile: string;
  installedPluginsFile: string;
  /** Claude Code's list of added marketplaces, with where each comes from. */
  knownMarketplacesFile: string;
  /** Where the launcher goes: `~/.local/bin`. */
  binDir: string;
  /** anymodel's own state: lock, owned keys, changed files. */
  stateDir: string;
  /** The gateway's config, with the backend keys: `~/.config/anymodel/gateway.json`. */
  gatewayConfigFile: string;
  /**
   * The router's limit state (plan limits seen, model slots on a fallback), which the status
   * line and the StopFailure hook read: `~/.local/state/anymodel/gateway-state.json`.
   */
  gatewayStateFile: string;
  /** The router's long-running copy: `~/.local/share/anymodel/router.js`. */
  routerCopy: string;
  /** The router's systemd user unit: `~/.config/systemd/user/anymodel-router.service`. */
  routerUnitFile: string;
  /** claude-mem's settings: `$CLAUDE_MEM_DATA_DIR/settings.json`, else `~/.claude-mem/settings.json`. */
  claudeMemSettingsFile: string;
}

/**
 * Every path the CLI touches, from HOME, CLAUDE_CONFIG_DIR and CLAUDE_MEM_DATA_DIR, so tests
 * can point it anywhere.
 */
export function cliPaths(env: Record<string, string | undefined> = process.env): CliPaths {
  const home = env.HOME || homedir();
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  return {
    home,
    claudeConfigDir,
    settingsFile: join(claudeConfigDir, "settings.json"),
    installedPluginsFile: join(claudeConfigDir, "plugins", "installed_plugins.json"),
    knownMarketplacesFile: join(claudeConfigDir, "plugins", "known_marketplaces.json"),
    binDir: join(home, ".local", "bin"),
    stateDir: join(claudeConfigDir, "anymodel"),
    gatewayConfigFile: join(home, ".config", "anymodel", "gateway.json"),
    gatewayStateFile: join(home, ".local", "state", "anymodel", "gateway-state.json"),
    routerCopy: join(home, ".local", "share", "anymodel", "router.js"),
    routerUnitFile: join(home, ".config", "systemd", "user", "anymodel-router.service"),
    claudeMemSettingsFile: join(claudeMemDataDir(env, home), "settings.json"),
  };
}

/** claude-mem's data folder: `CLAUDE_MEM_DATA_DIR` (a leading `~/` is the home folder), else `~/.claude-mem`. */
function claudeMemDataDir(env: Record<string, string | undefined>, home: string): string {
  const dir = env.CLAUDE_MEM_DATA_DIR;
  if (!dir) return join(home, ".claude-mem");
  if (dir === "~") return home;
  return dir.startsWith("~/") ? join(home, dir.slice(2)) : dir;
}

/** Shows a path with `~` for the home folder, to keep the output short. */
export function tildify(path: string, home: string): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
