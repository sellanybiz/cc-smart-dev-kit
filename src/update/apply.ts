/**
 * Installs a newer anymodel the way a person would: `claude plugin marketplace update
 * <marketplace>`, then, when the refreshed copy holds a newer version, `claude plugin
 * update <plugin>@<marketplace> --scope user`. Nothing else: it never restarts the router,
 * a service or a session. A new router version still needs `anymodel gateway setup`,
 * which asks first.
 */

import { MARKETPLACE, PLUGIN, PLUGIN_ID } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { findUserInstall } from "../setup/installed-plugins";
import { marketplaceCopyVersion, marketplaceInstallLocation } from "../setup/marketplace-access";
import { isOlder } from "./check";

type Env = Record<string, string | undefined>;

/** The longest one `claude plugin …` command may take (a clone can take a while). */
export const CLAUDE_TIMEOUT_MS = 180_000;

/** Runs a command; `output` is what it printed (empty when it printed to the terminal). */
export type CommandRunner = (argv: string[]) => { exitCode: number; output: string };

export interface ApplyResult {
  ok: boolean;
  /** The installed version before and after. */
  before: null | string;
  after: null | string;
  /** Why it failed, in words; empty when it did not. */
  detail: string;
}

/** The two commands, as a person would type them. */
export const MARKETPLACE_REFRESH = ["plugin", "marketplace", "update", MARKETPLACE];
export const PLUGIN_UPDATE = ["plugin", "update", PLUGIN_ID, "--scope", "user"];

/**
 * Refreshes the marketplace, then updates the plugin when the copy holds a newer version.
 * `claude` is the path of the claude command (null: not found on PATH). `say` gets one
 * line before each command.
 */
export function applyUpdate(
  paths: CliPaths,
  claude: null | string,
  run: CommandRunner,
  say: (line: string) => void,
): ApplyResult {
  const before = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  const fail = (detail: string): ApplyResult => ({ after: before, before, detail, ok: false });
  if (claude === null) return fail("the claude command is not on PATH");

  const step = (args: string[]): null | string => {
    say(`claude ${args.join(" ")}`);
    const result = run([claude, ...args]);
    if (result.exitCode === 0) return null;
    const last = result.output.trim().split("\n").at(-1)?.trim();
    return `claude ${args.join(" ")} failed (exit ${result.exitCode})${last ? `: ${last}` : ""}`;
  };

  const refreshed = step(MARKETPLACE_REFRESH);
  if (refreshed !== null) return fail(refreshed);
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  const inCopy = location === null ? null : marketplaceCopyVersion(location, PLUGIN).version;
  if (isOlder(before, inCopy)) {
    const updated = step(PLUGIN_UPDATE);
    if (updated !== null) return fail(updated);
  }
  const after = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  return { after, before, detail: "", ok: true };
}

/** A version safe to put in a notification and a shell-free argv: else a plain word. */
function shownVersion(version: null | string): string {
  return version !== null && /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : "a new version";
}

/** The notification's text. */
export function installedText(version: null | string): string {
  return `${PLUGIN} ${shownVersion(version)} installed; restart Claude sessions to load it`;
}

/**
 * The command that shows a desktop notification here, or null when there is none:
 * `notify-send` on Linux, `osascript` on macOS.
 */
export function notifyCommand(
  text: string,
  platform: NodeJS.Platform,
  which: (command: string) => null | string,
): null | string[] {
  if (platform === "linux") {
    const notifySend = which("notify-send");
    return notifySend === null ? null : [notifySend, PLUGIN, text];
  }
  if (platform === "darwin") {
    const osascript = which("osascript");
    // `text` holds only fixed words and a checked version: no quote can end the string.
    return osascript === null
      ? null
      : [osascript, "-e", `display notification ${JSON.stringify(text)} with title "${PLUGIN}"`];
  }
  return null;
}

/** The real runner for the background: output captured, a timeout, stdin closed. */
export function capturingRunner(env: Env): CommandRunner {
  return (argv) => {
    try {
      const result = Bun.spawnSync(argv, {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: CLAUDE_TIMEOUT_MS,
      });
      return {
        exitCode: result.exitCode ?? 1,
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
      };
    } catch (error) {
      return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
    }
  };
}
