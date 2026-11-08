/**
 * What the portal needs from outside itself, in one place.
 *
 * Every part of it — the pages, the actions, the server — takes this, so a test builds one
 * with fakes and drives the whole portal on a free port of its own, with temp paths and a
 * fake `systemctl`. Nothing else in `src/portal/` reads `process.env`, `homedir()` or a
 * global `fetch`: it can only reach the machine through here.
 */

import type { CliPaths } from "../cli/paths";
import type { HealthFetch, HealthProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import type { Machine } from "../machine/machine";
import type { PluginFolder } from "./plugin-folder";

/** The registry and health `fetch`: `loopbackFetch` in use (a service on this machine is reached straight, a registry as `fetch` does), a fake in a test. */
export type PortalFetch = HealthFetch;

/** What a read command answered: its exit code, and its stdout and stderr together. */
export interface CommandAnswer {
  exitCode: number;
  output: string;
}

/**
 * Runs a **read** command off the server's event loop (`Bun.spawn`, never `spawnSync`): the
 * router's journal (`journalctl`), its listener's state (`systemctl is-active`), `claude mcp
 * get`. A page load asks these, and a synchronous spawn froze every page, every action and the
 * live stream for as long as the command ran (B6e measured `journalctl -n 200` at 20–65 ms).
 * The actions' own changing commands keep `runner`. `env` adds variables to the child's own
 * environment (the MCP checks' `MCP_TIMEOUT`).
 */
export type ReadRunner = (cmd: string[], env?: Record<string, string>) => Promise<CommandAnswer>;

export interface PortalContext {
  /** `Bun.version`, for the header. */
  bunVersion: string;
  /** This process's environment. `CLAUDECODE` refuses the command, not the server. */
  env: Record<string, string | undefined>;
  /** The real network, for the registry and the backend checks. */
  fetch: PortalFetch;
  /** The system, through `src/machine/` (commands and the platform). */
  machine: Machine;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Opens a URL in the person's own browser; a test passes a recorder. */
  openBrowser: (url: string) => void;
  paths: CliPaths;
  /**
   * The plugin's own folder **as it is now**: Claude Code's installed version, else the folder
   * the parent passed on `--plugin-dir` (`plugin-folder.ts`). Every plugin file — the router
   * bundle, the instructions, `hooks.json` — is read from it at the moment it is needed, never
   * from a path made at startup: the portal runs from a copy, and the version folder it started
   * in can change or vanish during a 30-minute run.
   */
  pluginFolder: () => PluginFolder;
  /** Asks the router's health page: `realProbe()` in use, a fake in a test. */
  probe: HealthProbe;
  /** Runs what a page or the live stream reads, without blocking the server (`ReadRunner`). */
  runRead: ReadRunner;
  /** Runs `systemctl` and the plugin's commands. */
  runner: Runner;
  /**
   * The folders outside the home a global OmniRoute may sit in (`SYSTEM_PACKAGE_FOLDERS` by
   * default). A test passes none, so it never finds the machine's own OmniRoute.
   */
  systemFolders?: readonly string[] | undefined;
  /** False where there is no systemd (macOS, Windows). */
  systemd: boolean;
  /** The full path of a command on PATH, or null. */
  which: (command: string) => null | string;
}

/** The `HealthFetch` a `PortalContext` gives a caller that wants one (`checkOmniroute`). */
export function healthFetch(ctx: PortalContext): HealthFetch {
  return (url, init) => ctx.fetch(url, init as RequestInit & { signal: AbortSignal });
}
