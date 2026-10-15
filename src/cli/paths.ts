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
  /** The router's long-running copy: `~/.local/share/anymodel/router.js`. */
  routerCopy: string;
  /** The router's systemd user unit: `~/.config/systemd/user/anymodel-router.service`. */
  routerUnitFile: string;
}

/** Every path the CLI touches, from HOME and CLAUDE_CONFIG_DIR, so tests can point it anywhere. */
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
    routerCopy: join(home, ".local", "share", "anymodel", "router.js"),
    routerUnitFile: join(home, ".config", "systemd", "user", "anymodel-router.service"),
  };
}

/** Shows a path with `~` for the home folder, to keep the output short. */
export function tildify(path: string, home: string): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
