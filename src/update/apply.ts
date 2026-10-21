/**
 * Installs a newer cc-smart-dev-kit the way a person would: `claude plugin marketplace update
 * <marketplace>`, then, when the refreshed copy holds a newer version, `claude plugin
 * update <plugin>@<marketplace> --scope user`. Nothing else: it never restarts the router,
 * a service or a session. A new router version still needs `cc-smart-dev-kit gateway setup`,
 * which asks first. A new major version goes only on the caller's word (`onMajor`, D33).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, MARKETPLACE, PLUGIN, PLUGIN_ID } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { TOAST_SHELL, windowsToastArgv } from "../hooks/windows-toast";
import { gitEnv } from "../project/git-env";
import { findUserInstall } from "../setup/installed-plugins";
import {
  marketplaceCopyVersion,
  marketplaceInstallLocation,
  redactUrlsIn,
} from "../setup/marketplace-access";
import { isOlder } from "./check";
import { isNewMajor, readMajorNotes } from "./major";

type Env = Record<string, string | undefined>;

/** The longest one `claude plugin …` command may take (a clone can take a while). */
export const CLAUDE_TIMEOUT_MS = 180_000;

/** Runs a command; `output` is what it printed (empty when it printed to the terminal). */
export type CommandRunner = (argv: string[]) => { exitCode: number; output: string };

export interface ApplyResult {
  ok: boolean;
  /**
   * Not a failure: Claude Code was busy with the same marketplace copy (its own refresh
   * held git's `index.lock`), so nothing was done; the next check tries again.
   */
  busy?: boolean;
  /** The installed version before and after. */
  before: null | string;
  after: null | string;
  /** Why it failed, in words, URLs without credentials; empty when it did not. */
  detail: string;
  /** A new major version the caller held (`onMajor` said no): nothing was installed. */
  held?: MajorStep;
}

/** A step to a new major version, found in the refreshed marketplace copy. */
export interface MajorStep {
  /** The installed version (null: not recorded). */
  from: null | string;
  /** The major version in the copy. */
  to: string;
  /** Why it is a major step, from the new version's own notes (`./major.ts`). */
  notes: string[];
}

/** The two commands, as a person would type them. */
export const MARKETPLACE_REFRESH = ["plugin", "marketplace", "update", MARKETPLACE];
export const PLUGIN_UPDATE = ["plugin", "update", PLUGIN_ID, "--scope", "user"];

/** What a skipped update says when Claude Code held the marketplace copy's git lock. */
export const BUSY_DETAIL =
  "Claude Code was refreshing the same marketplace (git's index.lock was taken); the next check tries again";

/**
 * Refreshes the marketplace, then updates the plugin when the copy holds a newer version.
 * `claude` is the path of the claude command (null: not found on PATH). `say` gets one
 * line before each command. When that version is a new major one, `onMajor` decides first:
 * true installs it, false holds it (`held`, `ok`, nothing installed).
 *
 * A failed command's last output line goes into `detail` (the log, `update-check.json`,
 * `doctor`, a session's `systemMessage`), so every URL in it is shown without its
 * credentials. Output that names git's `index.lock` means Claude Code's own marketplace
 * refresh ran at the same moment: `busy`, not a failure.
 */
export function applyUpdate(
  paths: CliPaths,
  claude: null | string,
  run: CommandRunner,
  say: (line: string) => void,
  onMajor: (step: MajorStep) => boolean,
): ApplyResult {
  const before = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  const fail = (detail: string): ApplyResult => ({ after: before, before, detail, ok: false });
  if (claude === null) return fail("the claude command is not on PATH");

  const step = (args: string[]): ApplyResult | null => {
    say(`claude ${args.join(" ")}`);
    const result = run([claude, ...args]);
    if (result.exitCode === 0) return null;
    if (result.output.includes("index.lock")) {
      return { after: before, before, busy: true, detail: BUSY_DETAIL, ok: false };
    }
    const last = redactUrlsIn(result.output.trim().split("\n").at(-1)?.trim() ?? "");
    return fail(
      `claude ${args.join(" ")} failed (exit ${result.exitCode})${last ? `: ${last}` : ""}`,
    );
  };

  const refreshed = step(MARKETPLACE_REFRESH);
  if (refreshed !== null) return refreshed;
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  const inCopy = location === null ? null : marketplaceCopyVersion(location, PLUGIN).version;
  if (inCopy !== null && isOlder(before, inCopy)) {
    if (isNewMajor(before, inCopy)) {
      const major: MajorStep = {
        from: before,
        notes: readMajorNotes(location, before, inCopy),
        to: inCopy,
      };
      if (!onMajor(major)) return { after: before, before, detail: "", held: major, ok: true };
    }
    const updated = step(PLUGIN_UPDATE);
    if (updated !== null) return updated;
  }
  const after = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  return { after, before, detail: "", ok: true };
}

/**
 * True when the running router copy differs from the installed version's router: the new
 * version's router runs only after `gateway setup`. False without a gateway (no copy).
 */
export function routerNeedsSetup(paths: CliPaths): boolean {
  const install = findUserInstall(paths.installedPluginsFile);
  if (install === null || !existsSync(paths.routerCopy)) return false;
  const bundle = join(install.installPath, "dist", "router.js");
  return (
    existsSync(bundle) && readFileSync(bundle, "utf8") !== readFileSync(paths.routerCopy, "utf8")
  );
}

/** Said after an update whose router changed. */
export const ROUTER_SETUP_HINT = `its router changed: to run it, ${COMMAND} gateway setup (it asks before the restart)`;

/**
 * Said after an update when agent view's user-level notification hook is missing: only a
 * person's `setup` writes it (a background update never runs setup), so the next update says
 * so rather than leaving agent view silent.
 */
export const NOTIFY_HOOK_SETUP_HINT = `agent view's notification hook is missing: ${COMMAND} setup writes it`;

/** A version safe to put in a notification and a shell-free argv: else a plain word. */
function shownVersion(version: null | string): string {
  return version !== null && /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : "a new version";
}

/** The notification's text, with a hint for each thing the update left for a person's setup. */
export function installedText(
  version: null | string,
  routerChanged = false,
  notifyHookMissing = false,
): string {
  const text = `${PLUGIN} ${shownVersion(version)} installed; restart Claude sessions to load it`;
  const hints = [
    ...(routerChanged ? [ROUTER_SETUP_HINT] : []),
    ...(notifyHookMissing ? [NOTIFY_HOOK_SETUP_HINT] : []),
  ];
  return hints.length === 0 ? text : `${text}; ${hints.join("; ")}`;
}

/**
 * The command that shows a desktop notification here, or null when there is none:
 * `notify-send` on Linux, `osascript` on macOS, and a PowerShell toast on Windows
 * (`windowsToastArgv`: the title and the text cannot change the program). `title` is the
 * notification's summary (the plugin's name by default). `critical` asks the desktop to
 * keep the notification on screen (and show it even under Do Not Disturb): for the alerts
 * where the person must act — a Windows reminder toast for the same reason.
 */
export function notifyCommand(
  text: string,
  platform: NodeJS.Platform,
  which: (command: string) => null | string,
  title: string = PLUGIN,
  critical = false,
): null | string[] {
  if (platform === "linux") {
    const notifySend = which("notify-send");
    return notifySend === null
      ? null
      : [notifySend, ...(critical ? ["--urgency=critical"] : []), title, text];
  }
  if (platform === "darwin") {
    const osascript = which("osascript");
    // `text` holds only fixed words and a checked version: no quote can end the string.
    return osascript === null
      ? null
      : [
          osascript,
          "-e",
          `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`,
        ];
  }
  if (platform === "win32") {
    const powershell = which(TOAST_SHELL);
    return powershell === null ? null : windowsToastArgv(powershell, title, text, critical);
  }
  return null;
}

/**
 * The environment and folder every `claude plugin …` command (and the detached check)
 * runs with: no git variable that points git at another repo (`gitEnv`: a hook started
 * from inside a git hook may carry GIT_DIR or GIT_INDEX_FILE, and Claude Code's own git
 * would then work on that repo), and the home folder, never the session's project, so
 * no project's settings or `.git` come into play.
 */
export function commandContext(
  env: Env,
  home: string,
): { cwd: string; env: Record<string, string> } {
  return { cwd: home, env: gitEnv(env) };
}

/** The real runner for the background: output captured, a timeout, stdin closed. */
export function capturingRunner(env: Env, home: string): CommandRunner {
  const context = commandContext(env, home);
  return (argv) => {
    try {
      const result = Bun.spawnSync(argv, {
        ...context,
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
