/**
 * The paths the router bundle reads, and nothing else.
 *
 * `src/entries/router.ts` becomes `plugin/dist/router.js`, and a changed router.js makes
 * every machine restart its router (`.claude/rules/bundles-and-releases.md`). So this
 * module holds only what the router entry and the router itself read — the gateway's
 * config, the router's limit state and its safety-check counts — never a path the command
 * line alone uses. A CLI path added here would change router.js without the router
 * changing; a path the router never reads is not a reason to restart it on every machine.
 * Every other path lives in `src/cli/paths.ts`, which takes these from here (one home per
 * path).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { hostPlatform } from "../machine/host";

/**
 * The home folder: `$HOME` when set, else the OS's.
 *
 * On Windows `HOME` is undefined (Bun and Node: `USERPROFILE` holds it), so `USERPROFILE`
 * answers there. Under Git Bash `HOME` *is* set — Git Bash exports it — so Git Bash, the
 * command line and this module agree on one folder, which is why the plugin keeps the
 * POSIX layout (`~/.local/bin`, `~/.local/share`, `~/.config`) on Windows too:
 * `%USERPROFILE%\.local\bin` and so on (`docs/windows-setup.md`).
 *
 * `USERPROFILE` is read only on Windows: a Linux or macOS run whose environment happens to
 * carry it keeps the same folder as before.
 */
function homeDir(env: Record<string, string | undefined> = process.env): string {
  if (env.HOME) return env.HOME;
  if (hostPlatform(env) === "win32" && env.USERPROFILE) return env.USERPROFILE;
  return homedir();
}

/** The paths the router reads; `src/cli/paths.ts` adds the command's own. */
export interface RouterPaths {
  home: string;
  /** The gateway's config, with the backend keys: `~/.config/cc-smart-dev-kit/gateway.json`. */
  gatewayConfigFile: string;
  /**
   * The router's limit state (plan limits seen, model slots on a fallback), which the status
   * line and the StopFailure hook read: `~/.local/state/cc-smart-dev-kit/gateway-state.json`.
   */
  gatewayStateFile: string;
  /**
   * The auto-mode safety checks the router counted, by day, which `cc-smart-dev-kit usage`
   * reads: `~/.local/state/cc-smart-dev-kit/safety-checks.json` (`safety-checks.ts`).
   */
  safetyChecksFile: string;
}

/**
 * The router's paths, from HOME, so tests can point it anywhere.
 */
export function routerPaths(env: Record<string, string | undefined> = process.env): RouterPaths {
  const home = homeDir(env);
  return {
    home,
    gatewayConfigFile: join(home, ".config", "cc-smart-dev-kit", "gateway.json"),
    gatewayStateFile: join(home, ".local", "state", "cc-smart-dev-kit", "gateway-state.json"),
    safetyChecksFile: join(home, ".local", "state", "cc-smart-dev-kit", "safety-checks.json"),
  };
}
