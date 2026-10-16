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

/** The registry and health `fetch`: the real `fetch` in use, a fake in a test. */
export type PortalFetch = HealthFetch;

export interface PortalContext {
  /** The plugin's own `dist/portal.js`: the copy the portal runs from is compared with it. */
  bundle: string;
  /** `Bun.version`, for the header. */
  bunVersion: string;
  /** This process's environment. `CLAUDECODE` refuses the command, not the server. */
  env: Record<string, string | undefined>;
  /** The real network, for the registry and the backend checks. */
  fetch: PortalFetch;
  /** The plugin's `instructions` folder, beside `dist/`. */
  instructionsSource: string;
  /** The system, through `src/machine/` (commands, the platform, the Warp app). */
  machine: Machine;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Opens a URL in the person's own browser; a test passes a recorder. */
  openBrowser: (url: string) => void;
  paths: CliPaths;
  /** Asks the router's health page: `realProbe()` in use, a fake in a test. */
  probe: HealthProbe;
  /** Runs `systemctl` and the plugin's commands. */
  runner: Runner;
  /** The plugin's own `dist/router.js`: `gateway setup` installs this one. */
  routerBundle: string;
  /** False where there is no systemd (macOS, Windows). */
  systemd: boolean;
  /** The full path of a command on PATH, or null. */
  which: (command: string) => null | string;
}

/** The `HealthFetch` a `PortalContext` gives a caller that wants one (`checkOmniroute`). */
export function healthFetch(ctx: PortalContext): HealthFetch {
  return (url, init) => ctx.fetch(url, init as RequestInit & { signal: AbortSignal });
}
