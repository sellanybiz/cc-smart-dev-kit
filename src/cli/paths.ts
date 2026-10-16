import { join } from "node:path";
import { type RouterPaths, routerPaths } from "../gateway/paths";

export interface CliPaths extends RouterPaths {
  claudeConfigDir: string;
  settingsFile: string;
  installedPluginsFile: string;
  /** Claude Code's list of added marketplaces, with where each comes from. */
  knownMarketplacesFile: string;
  /**
   * Claude Code's own user-scope config: `$CLAUDE_CONFIG_DIR/.claude.json`, else
   * `~/.claude.json`. It holds the user-scope MCP servers (`mcpServers`), which is where
   * `claude mcp add --scope user` writes them. Read only, to check and to remove: writing
   * it by hand would be a second writer of Claude Code's file.
   */
  userConfigFile: string;
  /** Where the launcher goes: `~/.local/bin`. */
  binDir: string;
  /** cc-smart-dev-kit's own state: lock, owned keys, changed files. */
  stateDir: string;
  /** What outlives a plugin version: `~/.local/share/cc-smart-dev-kit`. */
  dataDir: string;
  /** The shared Chrome's profile, one for the whole machine: `<dataDir>/playwright`. */
  browserProfileDir: string;
  /** Everything the browser saves: screenshots, snapshots, downloads (`<dataDir>/playwright-output`). */
  browserOutputDir: string;
  /** The init page the Playwright MCP loads for every tab: `<dataDir>/playwright-picker.js`. */
  browserPickerFile: string;
  /** The Serena context the plugin starts Serena with: `<dataDir>/serena/contexts/worktree.yml`. */
  serenaContextFile: string;
  /** The router's long-running copy: `~/.local/share/cc-smart-dev-kit/router.js`. */
  routerCopy: string;
  /**
   * The portal's own copy: `~/.local/share/cc-smart-dev-kit/portal.js`. The portal runs from
   * it, never from the plugin's version folder (Claude Code deletes an old one after an
   * update), and `restore` removes it like the router's copy.
   */
  portalCopy: string;
  /** What the portal remembers between pages: `<stateDir>/portal.json`. */
  portalStateFile: string;
  /** What the last OmniRoute update replaced: `<stateDir>/omniroute.json`. */
  omnirouteStateFile: string;
  /** The router's systemd user unit: `~/.config/systemd/user/cc-smart-dev-kit-router.service`. */
  routerUnitFile: string;
  /**
   * The Windows Scheduled Task's definition: `~/.local/share/cc-smart-dev-kit/router-task.xml`.
   * `gateway setup` writes it and registers the task from it (`src/gateway/service-windows.ts`).
   */
  routerTaskFile: string;
  /** claude-mem's settings: `$CLAUDE_MEM_DATA_DIR/settings.json`, else `~/.claude-mem/settings.json`. */
  claudeMemSettingsFile: string;
  /** The socket unit that holds the router's port: `~/.config/systemd/user/cc-smart-dev-kit-router.socket`. */
  routerSocketFile: string;
  /** The notifier's settings: `~/.claude/cc-smart-dev-kit/notify.json`. */
  notifyConfigFile: string;
  /** The tmux line's file: `~/.tmux.conf` (setup adds one managed line there). */
  tmuxConfFile: string;
  /** The Tavily key file an owner may write: `<config dir>/cc-smart-dev-kit/tavily.key` (0600). */
  tavilyKeyFile: string;
}

/**
 * Where Claude Code keeps the config of the folder it runs from. With `CLAUDE_CONFIG_DIR`
 * set, its own files (`.claude.json` included) live inside it; without, `.claude.json` sits
 * in the home folder, beside `~/.claude` (seen live, 2.1.301: `claude mcp add --scope user`
 * writes `$CLAUDE_CONFIG_DIR/.claude.json` when the variable is set, `~/.claude.json` when
 * it is not: `docs/claude-code-contract.md` § MCP servers).
 */
function userConfigFile(env: Record<string, string | undefined>, home: string): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir ? join(dir, ".claude.json") : join(home, ".claude.json");
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
    userConfigFile: userConfigFile(env, router.home),
    binDir: join(router.home, ".local", "bin"),
    stateDir: join(claudeConfigDir, "cc-smart-dev-kit"),
    dataDir: join(router.home, ".local", "share", "cc-smart-dev-kit"),
    browserProfileDir: join(router.home, ".local", "share", "cc-smart-dev-kit", "playwright"),
    browserOutputDir: join(router.home, ".local", "share", "cc-smart-dev-kit", "playwright-output"),
    browserPickerFile: join(
      router.home,
      ".local",
      "share",
      "cc-smart-dev-kit",
      "playwright-picker.js",
    ),
    serenaContextFile: join(
      router.home,
      ".local",
      "share",
      "cc-smart-dev-kit",
      "serena",
      "contexts",
      "worktree.yml",
    ),
    routerCopy: join(router.home, ".local", "share", "cc-smart-dev-kit", "router.js"),
    routerTaskFile: join(router.home, ".local", "share", "cc-smart-dev-kit", "router-task.xml"),
    portalCopy: join(router.home, ".local", "share", "cc-smart-dev-kit", "portal.js"),
    portalStateFile: join(claudeConfigDir, "cc-smart-dev-kit", "portal.json"),
    omnirouteStateFile: join(claudeConfigDir, "cc-smart-dev-kit", "omniroute.json"),
    routerUnitFile: join(
      router.home,
      ".config",
      "systemd",
      "user",
      "cc-smart-dev-kit-router.service",
    ),
    claudeMemSettingsFile: join(claudeMemDataDir(env, router.home), "settings.json"),
    routerSocketFile: join(
      router.home,
      ".config",
      "systemd",
      "user",
      "cc-smart-dev-kit-router.socket",
    ),
    notifyConfigFile: join(claudeConfigDir, "cc-smart-dev-kit", "notify.json"),
    tmuxConfFile: join(router.home, ".tmux.conf"),
    tavilyKeyFile: join(claudeConfigDir, "cc-smart-dev-kit", "tavily.key"),
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
