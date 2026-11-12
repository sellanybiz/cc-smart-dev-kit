/**
 * Installs a newer cc-smart-dev-kit the way a person would: `claude plugin marketplace update
 * <marketplace>`, then, when the refreshed copy holds a newer version, `claude plugin
 * update <plugin>@<marketplace> --scope user`. Nothing else: it never restarts the router,
 * a service or a session. A new router version still needs `cc-smart-dev-kit gateway setup`,
 * which asks first. A new major version goes only on the caller's word (`onMajor`, D33).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, DEPENDENCIES, MARKETPLACE, PLUGIN, PLUGIN_ID } from "../build-info";
import { type Dependency, readManifestDependencies } from "../build-info/manifest";
import { isOlder } from "../build-info/semver";
import type { CheckFailed } from "../cli/check";
import type { CliPaths } from "../cli/paths";
import {
  companionCheck,
  companionInstall,
  companions,
  MARKETPLACE_SOURCES,
  versionState,
} from "../machine/companions";
import { gitEnv } from "../project/git-env";
import { findUserInstall } from "../setup/installed-plugins";
import {
  marketplaceCopyVersion,
  marketplaceInstallLocation,
  redactUrlsIn,
} from "../setup/marketplace-access";
import { isNewMajor, readMajorNotes } from "./major";

type Env = Record<string, string | undefined>;

/** The longest one `claude plugin …` command may take (a clone can take a while). */
export const CLAUDE_TIMEOUT_MS = 180_000;

/**
 * Runs a command; `output` is what it printed (empty when it printed to the terminal). It may
 * be async: the portal's runner spawns the child without blocking its server (B6b), and the
 * command line's own runner stays synchronous. `env` adds variables to the child's own
 * environment (a caller that needs one, such as the MCP checks' `MCP_TIMEOUT`); a runner that
 * sets the environment itself ignores it.
 */
export type CommandRunner = (
  argv: string[],
  env?: Record<string, string>,
) => { exitCode: number; output: string } | Promise<{ exitCode: number; output: string }>;

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
export async function applyUpdate(
  paths: CliPaths,
  claude: null | string,
  run: CommandRunner,
  say: (line: string) => void,
  onMajor: (step: MajorStep) => boolean,
): Promise<ApplyResult> {
  const before = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  const fail = (detail: string): ApplyResult => ({ after: before, before, detail, ok: false });
  if (claude === null) return fail("the claude command is not on PATH");

  const step = async (args: string[]): Promise<ApplyResult | null> => {
    say(`claude ${args.join(" ")}`);
    const result = await run([claude, ...args]);
    if (result.exitCode === 0) return null;
    if (result.output.includes("index.lock")) {
      return { after: before, before, busy: true, detail: BUSY_DETAIL, ok: false };
    }
    const last = redactUrlsIn(result.output.trim().split("\n").at(-1)?.trim() ?? "");
    return fail(
      `claude ${args.join(" ")} failed (exit ${result.exitCode})${last ? `: ${last}` : ""}`,
    );
  };

  const refreshed = await step(MARKETPLACE_REFRESH);
  if (refreshed !== null) return refreshed;
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  const copy = location === null ? null : marketplaceCopyVersion(location, PLUGIN);
  const inCopy = copy?.version ?? null;
  if (location !== null && copy !== null && inCopy !== null && isOlder(before, inCopy)) {
    if (isNewMajor(before, inCopy)) {
      const major: MajorStep = {
        from: before,
        notes: readMajorNotes(location, before, inCopy),
        to: inCopy,
      };
      if (!onMajor(major)) return { after: before, before, detail: "", held: major, ok: true };
    }
    const behind = companionsBehind(paths, neededDependencies(copy.manifest));
    if (behind.length > 0) return fail(companionsBehindDetail(inCopy, behind));
    const updated = await step(PLUGIN_UPDATE);
    if (updated !== null) return updated;
  }
  const after = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  return { after, before, detail: "", ok: true };
}

/**
 * The companion plugins the version in the marketplace copy needs: its own plugin.json's
 * `dependencies`, read after the refresh, because a new version may raise a range this one
 * does not know. This version's own list when that file cannot be read.
 */
function neededDependencies(manifest: string): readonly Dependency[] {
  try {
    return readManifestDependencies(manifest);
  } catch {
    return DEPENDENCIES;
  }
}

/**
 * Each installed companion whose version the new version's range does not take: Claude Code
 * then refuses the update (`Dependency … does not satisfy`), and `update` would only fail again
 * the same way. Doctor's line for each (`companionCheck`), with the fix it names.
 *
 * A companion that is not installed is left out: when its marketplace is added, Claude Code
 * installs it with the update, and doctor names it with its own fix either way. So is a
 * dependency from a marketplace this version does not know: the new version's setup adds it.
 */
export function companionsBehind(
  paths: CliPaths,
  dependencies: readonly Dependency[],
): CheckFailed[] {
  const known = dependencies.filter((dependency) =>
    Object.hasOwn(MARKETPLACE_SOURCES, dependency.marketplace),
  );
  return companions(known).flatMap((companion) => {
    const install = companionInstall(paths, companion);
    if (install === null) return [];
    const check = companionCheck(companion, versionState(companion, install.version));
    return check.ok ? [] : [check];
  });
}

/** Why the update stopped before `claude plugin update`, in one line with its fix. */
export function companionsBehindDetail(version: string, behind: readonly CheckFailed[]): string {
  const fixes = [...new Set(behind.map((check) => check.fix))];
  return `${PLUGIN} ${shownVersion(version)} was not installed, because of a companion plugin it needs: ${behind.map((check) => check.text).join("; ")}. First run: ${fixes.join(", then ")}`;
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
export const ROUTER_SETUP_HINT = `its router changed: to run it, ${COMMAND} gateway setup (it asks before the restart); a machine set up before Claude became the default runs ${COMMAND} setup once first, which moves it`;

/** A version safe to show in command output: else a plain word. */
function shownVersion(version: null | string): string {
  return version !== null && /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : "a new version";
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
        // The background check runs with no console of its own on Windows.
        windowsHide: true,
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
