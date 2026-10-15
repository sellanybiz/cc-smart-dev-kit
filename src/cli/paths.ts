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
  /** cc-agentic's own state: lock, owned keys, changed files. */
  stateDir: string;
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
    stateDir: join(claudeConfigDir, "cc-agentic"),
  };
}

/** Shows a path with `~` for the home folder, to keep the output short. */
export function tildify(path: string, home: string): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
