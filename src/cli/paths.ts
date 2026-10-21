import { join, sep } from "node:path";
import { type RouterPaths, routerPaths } from "../gateway/paths";

export interface CliPaths extends RouterPaths {
  claudeConfigDir: string;
  settingsFile: string;
  installedPluginsFile: string;
  /** Claude Code's list of added marketplaces, with where each comes from. */
  knownMarketplacesFile: string;
  /** Claude Code's saved sessions: `<config folder>/projects/<folder>/<session id>.jsonl`. */
  projectsDir: string;
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
  /** Everything the browser saves: screenshots, snapshots, downloads (`<dataDir>/playwright-output`). */
  browserOutputDir: string;
  /**
   * The Playwright extension's token, mode 0600: it is what connects the MCP to the person's own
   * Chrome without an approval page (`src/browser/token.ts`).
   */
  browserTokenFile: string;
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
  /** This person's workflow defaults: `~/.config/cc-smart-dev-kit/workflow.json` (0600). */
  workflowConfigFile: string;
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
 *
 * **Windows keeps this same layout, under `%USERPROFILE%`** (`homeDir()` in
 * `src/gateway/paths.ts`): Claude Code's own folder is `%USERPROFILE%\.claude`, the
 * launcher is `%USERPROFILE%\.local\bin\cc-smart-dev-kit` (and its `.cmd` twin beside it),
 * the state is `%USERPROFILE%\.claude\cc-smart-dev-kit`, the data
 * `%USERPROFILE%\.local\share\cc-smart-dev-kit`, the gateway's config
 * `%USERPROFILE%\.config\cc-smart-dev-kit\gateway.json`. Deliberately not `%APPDATA%` or
 * `%LOCALAPPDATA%`: Git Bash's `$HOME`, PowerShell and this module then name one folder,
 * and `tildify` keeps working. The reasoning and what it costs:
 * `docs/windows-setup.md`.
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
    projectsDir: join(claudeConfigDir, "projects"),
    userConfigFile: userConfigFile(env, router.home),
    binDir: join(router.home, ".local", "bin"),
    stateDir: join(claudeConfigDir, "cc-smart-dev-kit"),
    dataDir: join(router.home, ".local", "share", "cc-smart-dev-kit"),
    browserOutputDir: join(router.home, ".local", "share", "cc-smart-dev-kit", "playwright-output"),
    browserTokenFile: join(
      router.home,
      ".config",
      "cc-smart-dev-kit",
      "playwright-extension.token",
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
    workflowConfigFile: join(router.home, ".config", "cc-smart-dev-kit", "workflow.json"),
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

/**
 * Shows a path with `~` for the home folder, to keep the output short. The rest keeps its own
 * separators: on Windows a path under the home folder goes on with `\` (`~\.claude\x`).
 */
export function tildify(path: string, home: string): string {
  const rest = path.slice(home.length);
  return path === home || (path.startsWith(home) && (rest.startsWith("/") || rest.startsWith(sep)))
    ? `~${rest}`
    : path;
}
