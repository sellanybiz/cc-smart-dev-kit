import { join } from "node:path";
import { type RouterPaths, routerPaths } from "../gateway/paths";

export interface CliPaths extends RouterPaths {
  claudeConfigDir: string;
  settingsFile: string;
  installedPluginsFile: string;
  /** Claude Code's list of added marketplaces, with where each comes from. */
  knownMarketplacesFile: string;
  /** Where the launcher goes: `~/.local/bin`. */
  binDir: string;
  /** anymodel's own state: lock, owned keys, changed files. */
  stateDir: string;
  /** The router's long-running copy: `~/.local/share/anymodel/router.js`. */
  routerCopy: string;
  /** The router's systemd user unit: `~/.config/systemd/user/anymodel-router.service`. */
  routerUnitFile: string;
  /** claude-mem's settings: `$CLAUDE_MEM_DATA_DIR/settings.json`, else `~/.claude-mem/settings.json`. */
  claudeMemSettingsFile: string;
  /** The socket unit that holds the router's port: `~/.config/systemd/user/anymodel-router.socket`. */
  routerSocketFile: string;
}

/**
 * Every path the CLI touches, from HOME, CLAUDE_CONFIG_DIR and CLAUDE_MEM_DATA_DIR, so tests
 * can point it anywhere. The router's two paths come from `src/gateway/paths.ts`: the router
 * bundle reads that module, and no CLI path may reach it.
 */
export function cliPaths(env: Record<string, string | undefined> = process.env): CliPaths {
  const router = routerPaths(env);
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR || join(router.home, ".claude");
  return {
    ...router,
    claudeConfigDir,
    settingsFile: join(claudeConfigDir, "settings.json"),
    installedPluginsFile: join(claudeConfigDir, "plugins", "installed_plugins.json"),
    knownMarketplacesFile: join(claudeConfigDir, "plugins", "known_marketplaces.json"),
    binDir: join(router.home, ".local", "bin"),
    stateDir: join(claudeConfigDir, "anymodel"),
    routerCopy: join(router.home, ".local", "share", "anymodel", "router.js"),
    routerUnitFile: join(router.home, ".config", "systemd", "user", "anymodel-router.service"),
    claudeMemSettingsFile: join(claudeMemDataDir(env, router.home), "settings.json"),
    routerSocketFile: join(router.home, ".config", "systemd", "user", "anymodel-router.socket"),
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
