import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type BrowserDoctorDeps, browserChecks } from "../browser/doctor";
import {
  bunTooOld,
  COMMAND,
  MARKETPLACE,
  MARKETPLACE_ADD_COMMAND,
  MIN_BUN,
  PLUGIN,
  PLUGIN_ID,
  PLUGIN_INSTALL_COMMAND,
  PLUGIN_UPDATE_COMMAND,
  VERSION,
} from "../build-info";
import { messageOf } from "../gateway/config";
import { gatewayChecks } from "../gateway/doctor";
import type { RouterServiceKind, Runner } from "../gateway/service";
import { hasDesktop } from "../hooks/desktop-alert";
import {
  readStartBlocks,
  START_BLOCK_KEYS,
  type StartBlockReading,
  TODO_TOOLS_KEY,
  TODO_TOOLS_VALUE,
  WORK_STATE_KEY,
} from "../machine/claude-mem";
import { companionChecks, pluginEnabled } from "../machine/companions";
import type { Machine } from "../machine/machine";
import { warpCheck } from "../machine/warp";
import { type McpDoctorDeps, mcpChecks } from "../mcp/doctor";
import { omnirouteDoctorLine } from "../omniroute/commands";
import type { RegistryFetch } from "../omniroute/registry";
import { AUTO_UPDATE_KEY, type AutoUpdateState, autoUpdateState } from "../setup/auto-update";
import { findUserInstall } from "../setup/installed-plugins";
import {
  copyDifferences,
  copyInstalled,
  instructionsBlockBody,
  instructionsNeedRefresh,
  instructionsOptedOut,
  instructionsPaths,
  readVersionStamp,
} from "../setup/instructions";
import { bakedBunPath, LAUNCHER_NAME, launcherScript } from "../setup/launcher";
import {
  cmdBakedBunPath,
  LAUNCHER_CMD_NAME,
  launcherCmdArgv,
  launcherCmdScript,
} from "../setup/launcher-cmd";
import { formatKeyPath, getKey, ownedRecords, ownership } from "../setup/managed-json";
import {
  canReadGitRemote,
  canReadHttp,
  type GitFailureCause,
  gitFailureCause,
  githubRepoInUrl,
  marketplaceAccessAdvice,
  marketplaceCopyVersion,
  marketplaceInstallLocation,
  marketplaceSource,
  redactUrl,
} from "../setup/marketplace-access";
import { retryWatchdogLine, retryWatchdogState } from "../setup/retry-watchdog";
import {
  TMUX_LINE,
  TMUX_MIN_VERSION,
  TMUX_NOW_COMMAND,
  tmuxLineIn,
  tmuxPassthroughOf,
} from "../setup/tmux";
import { USER_NOTIFY_COMMAND, userNotifyHookState } from "../setup/user-notify-hook";
import { realTarget } from "../setup/write";
import { isOlder } from "../update/check";
import { isNewMajor, majorHeldDetail, readMajorNotes } from "../update/major";
import { FORCE_PLUGIN_UPDATES_VAR, updateOptOuts } from "../update/opt-out";
import {
  heldSince,
  readLastCheck,
  runningSessions,
  UNREACHABLE_FAILS_AFTER_HOURS,
  updateFiles,
} from "../update/state";
import { checkGitBash } from "./git-bash";
import { type LiveDeps, parseClaudeVersion, readLiveRecord, runLiveCheck } from "./live-check";
import { type CliPaths, tildify } from "./paths";
import { projectChecks } from "./project-checks";

/** One line of the report. What `doctor` prints, and what the portal's Machine page shows. */
export interface Check {
  ok: boolean;
  /** Information only: printed with `·`, never a failure. */
  info?: boolean;
  /** A warning: printed with `!`, never a failure. */
  warn?: boolean;
  /**
   * Which part of the report the line belongs to. Only the browser's lines carry it, because the
   * portal draws those on the Browser card and leaves them out of the Doctor card's list: one
   * home per line, and the same words a person reads in `cc-smart-dev-kit doctor`.
   */
  section?: "browser";
  text: string;
}

/** The marketplace command that refreshes Claude Code's local copy of the marketplace. */
export const MARKETPLACE_UPDATE_COMMAND = `claude plugin marketplace update ${MARKETPLACE}`;

type Env = Record<string, string | undefined>;

function readSettings(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function run(argv: string[]): { ok: boolean; output: string } {
  try {
    const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    return { ok: result.exitCode === 0, output };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

/** This plugin itself: installed, its folder there, and turned on in the user settings. */
export function checkPlugin(paths: CliPaths): Check {
  const install = findUserInstall(paths.installedPluginsFile);
  if (!install) {
    return {
      ok: false,
      text: `the ${PLUGIN_ID} plugin is not installed. Run: ${PLUGIN_INSTALL_COMMAND}`,
    };
  }
  const where = tildify(install.installPath, paths.home);
  if (!existsSync(install.installPath)) {
    return {
      ok: false,
      text: `the plugin folder is missing: ${where}. Run: ${PLUGIN_INSTALL_COMMAND}`,
    };
  }
  // Installed is not on: Claude Code loads only a plugin whose `enabledPlugins` entry is
  // true, and a person who turned this one off (or whose install predates the entry) gets no
  // hook, no skill and no command from it. `pluginEnabled` is the same reader doctor uses for
  // the companions, so the two can never disagree about one settings file.
  if (!pluginEnabled(paths, PLUGIN_ID)) {
    return {
      ok: false,
      text: `${PLUGIN_ID} ${install.version ?? "(no version)"} is installed, but the user settings turn it off: none of its hooks, skills or commands run. Run: claude plugin enable ${PLUGIN_ID}`,
    };
  }
  return {
    ok: true,
    text: `${PLUGIN_ID} ${install.version ?? "(no version)"} is installed at ${where}`,
  };
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this bun there? On Windows there is no execute bit to check: a `.exe` runs by being
 * there, so existence is the whole question (and `accessSync(X_OK)` does not answer it the
 * same way everywhere).
 */
function isUsableBun(bun: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? existsSync(bun) : isExecutable(bun);
}

/**
 * The launcher is compared with the script for the bun baked into it, not with the bun
 * running doctor: another bun on PATH is no reason to rewrite it.
 *
 * Windows has two launchers that run the same thing: the `sh` script, which Git Bash and the
 * project-wired hooks run, and its `.cmd` twin, which cmd and PowerShell run
 * (`launcher-cmd.ts`). Both carry the same baked bun, and each is compared with its own
 * script. The `sh` one cannot be started on Windows (no shell will run it there), so its
 * "does it run" question is answered by the `.cmd`; the mode and the execute bit mean nothing
 * on Windows either.
 */
function checkLauncher(paths: CliPaths, platform: NodeJS.Platform): Check[] {
  const win = platform === "win32";
  const launcher = join(paths.binDir, LAUNCHER_NAME);
  const where = tildify(launcher, paths.home);
  if (!existsSync(launcher))
    return [{ ok: false, text: `no launcher at ${where}. Run: cc-smart-dev-kit setup` }];
  if (!win && !isExecutable(launcher)) {
    return [
      {
        ok: false,
        text: `the launcher ${where} is not executable. Run: cc-smart-dev-kit setup`,
      },
    ];
  }
  const script = readFileSync(launcher, "utf8");
  const bun = bakedBunPath(script);
  if (bun === null || script !== launcherScript(bun)) {
    return [
      { ok: false, text: `the launcher ${where} is out of date. Run: cc-smart-dev-kit setup` },
    ];
  }
  if (!isUsableBun(bun, platform)) {
    return [
      {
        ok: false,
        text: `the launcher's bun ${tildify(bun, paths.home)} is missing or not executable. Run: cc-smart-dev-kit setup`,
      },
    ];
  }
  if (win)
    return [
      checkLauncherCmd(paths, where),
      { ok: true, text: `the launcher ${where} is in place (Git Bash runs it)` },
    ];
  const result = run([launcher, "version"]);
  if (!result.ok)
    return [{ ok: false, text: `the launcher ${where} does not run: ${result.output}` }];
  return [{ ok: true, text: `the launcher ${where} runs ${result.output}` }];
}

/**
 * The Windows launcher's own check: the `.cmd` is there, is this version's, and runs. It is
 * started through `cmd.exe` — a `.cmd` is not an executable, so `Bun.spawn` cannot start one
 * (`launcherCmdArgv`).
 */
function checkLauncherCmd(paths: CliPaths, shLauncher: string): Check {
  const cmd = join(paths.binDir, LAUNCHER_CMD_NAME);
  const where = tildify(cmd, paths.home);
  if (!existsSync(cmd)) {
    return {
      ok: false,
      text: `no Windows launcher at ${where}, so cmd and PowerShell cannot run cc-smart-dev-kit (Git Bash runs ${shLauncher}). Run: cc-smart-dev-kit setup`,
    };
  }
  const script = readFileSync(cmd, "utf8");
  const bun = cmdBakedBunPath(script);
  if (bun === null || script !== launcherCmdScript(bun)) {
    return {
      ok: false,
      text: `the Windows launcher ${where} is out of date. Run: cc-smart-dev-kit setup`,
    };
  }
  if (!isUsableBun(bun, "win32")) {
    return {
      ok: false,
      text: `the Windows launcher's bun ${tildify(bun, paths.home)} is missing or not executable. Run: cc-smart-dev-kit setup`,
    };
  }
  const result = run(launcherCmdArgv(cmd, ["version"]));
  if (!result.ok)
    return { ok: false, text: `the Windows launcher ${where} does not run: ${result.output}` };
  return { ok: true, text: `the Windows launcher ${where} runs ${result.output}` };
}

/**
 * Can this machine read the marketplace's source? Updates need it.
 * Works for any git host, public or private, and needs no gh. Every URL is printed
 * without its password, token or query string.
 *
 * A failure that names one of the two causes a person can act on says which it is, and how to
 * fix it (the same lines the two installers print): ssh to GitHub refused — add the same
 * marketplace over HTTPS — or an account that may not read the repository — ask its owner for
 * access. Any other failure keeps the line this check always had.
 */
async function checkMarketplaceAccess(paths: CliPaths, env: Env): Promise<Check> {
  const source = marketplaceSource(paths.knownMarketplacesFile, MARKETPLACE, env);
  switch (source.kind) {
    case "missing":
      return {
        ok: false,
        text: `the ${MARKETPLACE} marketplace is not added. Run: ${MARKETPLACE_ADD_COMMAND}`,
      };
    case "unknown":
      return { ok: false, text: `cannot check the marketplace source (${source.type})` };
    case "local":
      return existsSync(source.path)
        ? { ok: true, text: `the marketplace folder ${tildify(source.path, paths.home)} exists` }
        : { ok: false, text: `the marketplace folder is missing: ${source.path}` };
    case "http": {
      const url = redactUrl(source.url);
      const result = await canReadHttp(source.url);
      return result.ok
        ? { ok: true, text: `can read the marketplace at ${url}` }
        : { ok: false, text: `cannot read the marketplace at ${url}: ${result.detail}` };
    }
    case "git": {
      const failures: string[] = [];
      let cause: GitFailureCause = "unknown";
      let repo: string | null = null;
      for (const url of source.urls) {
        const result = canReadGitRemote(url, env);
        if (result.ok) return { ok: true, text: `can read the marketplace at ${redactUrl(url)}` };
        failures.push(`${redactUrl(url)}: ${result.detail}`);
        // The cause comes from EVERYTHING git said (`output`): the line that names it —
        // "Permission denied (publickey)", "Repository not found" — is not the last one, and the
        // detail printed above is. And `<owner>/<repo>` when a GitHub URL carries one: the fix
        // lines name the repository; a source on another host gets what we can say.
        if (cause === "unknown") cause = gitFailureCause(result.output);
        if (repo === null) repo = githubRepoInUrl(url);
      }
      const advice = marketplaceAccessAdvice(cause, repo);
      return {
        ok: false,
        text:
          `cannot read the marketplace (${failures.join("; ")}). ` +
          (advice === ""
            ? "Check your git access: an SSH key, or a git credential helper."
            : advice),
      };
    }
  }
}

/**
 * Is the installed version behind the marketplace's local copy? Then the self-update did not
 * install it. A new major version is not behind in that sense: it waits for the person's
 * `update` (D33), an information line. Null when there is nothing to compare: no install, or
 * no marketplace (other checks report those).
 */
function checkInstalledVersion(paths: CliPaths): Check | null {
  const install = findUserInstall(paths.installedPluginsFile);
  if (!install) return null;
  if (marketplaceSource(paths.knownMarketplacesFile, MARKETPLACE).kind === "missing") return null;
  const location = marketplaceInstallLocation(paths.knownMarketplacesFile, MARKETPLACE);
  if (location === null) {
    return {
      ok: false,
      text: `the ${MARKETPLACE} marketplace has no local copy. Run: ${MARKETPLACE_UPDATE_COMMAND}`,
    };
  }
  const { manifest, version: latest } = marketplaceCopyVersion(location, PLUGIN);
  if (latest === null) {
    return {
      ok: false,
      text: `cannot read the version in ${tildify(manifest, paths.home)}. Run: ${MARKETPLACE_UPDATE_COMMAND}`,
    };
  }
  const installed = install.version;
  let order: number;
  try {
    order = installed === null ? -1 : Bun.semver.order(installed, latest);
  } catch {
    return {
      ok: false,
      text: `cannot compare the installed version ${installed} with the marketplace's ${latest}`,
    };
  }
  if (order < 0 && isNewMajor(installed, latest)) {
    // A major version waits for the person's `update` (D33): information, never a failure.
    // Never "claude plugin update" here: that would skip the hold and its one-time steps.
    return {
      ok: true,
      info: true,
      text: `installed ${installed}; ${majorHeldDetail(latest, readMajorNotes(location, installed, latest))}`,
    };
  }
  if (order < 0) {
    return {
      ok: false,
      text: `installed ${installed ?? "(no version)"}, marketplace has ${latest}. Run: ${PLUGIN_UPDATE_COMMAND}`,
    };
  }
  return { ok: true, text: `the installed version ${installed} is not behind the marketplace` };
}

/**
 * Claude Code's own plugin auto-update must be off for this marketplace (D39): it knows nothing
 * of the major hold (D33), so it would install a major version by itself. The kit's own check
 * updates the plugin. Why only an explicit `false` turns it off: `src/setup/auto-update.ts`.
 */
function checkAutoUpdate(paths: CliPaths): Check {
  const settingsFile = tildify(paths.settingsFile, paths.home);
  const key = formatKeyPath(AUTO_UPDATE_KEY);
  const risk = "a major version would install with no hold";
  let state: AutoUpdateState;
  try {
    state = autoUpdateState(paths);
  } catch (error) {
    return { ok: false, text: `cannot read Claude Code's plugin auto-update: ${messageOf(error)}` };
  }
  switch (state) {
    case "off":
      return {
        ok: true,
        text: `Claude Code's own plugin auto-update is off: ${COMMAND}'s own check updates the plugin`,
      };
    case "ours":
      return {
        ok: false,
        text: `Claude Code's own plugin auto-update is on (${key} is true in ${settingsFile}, set by an older setup): ${risk}. Run: ${COMMAND} setup`,
      };
    case "yours":
      return {
        ok: false,
        text: `Claude Code's own plugin auto-update is on (${key} is true in ${settingsFile}, not set by ${COMMAND}): ${risk}. Remove that key from ${settingsFile} by hand, then run: ${COMMAND} setup`,
      };
    case "known":
      return {
        ok: false,
        text: `Claude Code's own plugin auto-update is on (its own record, ${tildify(paths.knownMarketplacesFile, paths.home)}, says so): ${risk}. Run: ${COMMAND} setup`,
      };
  }
}

/**
 * Claude Code's retry watchdog (D42, `src/setup/retry-watchdog.ts`) is a choice, never a
 * failure: one `·` line says whether a session waits and retries at a limit, and how to turn it on.
 */
function checkRetryWatchdog(paths: CliPaths): Check {
  try {
    const state = retryWatchdogState(paths);
    return {
      ok: true,
      info: true,
      text: retryWatchdogLine(state, tildify(paths.settingsFile, paths.home)),
    };
  } catch (error) {
    return {
      ok: true,
      info: true,
      text: `retry watchdog: not checked, ${tildify(paths.settingsFile, paths.home)} cannot be read: ${messageOf(error)}`,
    };
  }
}

/**
 * Updates must not be switched off: each of UPDATE_BLOCKING_VARS (`src/update/opt-out.ts`)
 * also stops plugin updates, Claude Code's and cc-smart-dev-kit's background update alike, unless
 * FORCE_AUTOUPDATE_PLUGINS is set too. Claude Code reads them from its environment and
 * from the `env` of settings.json, so doctor looks in both.
 */
function checkUpdatesNotOff(
  settings: Record<string, unknown> | null,
  env: Env,
  paths: CliPaths,
): Check {
  const fromSettings = (settings?.env ?? {}) as Record<string, unknown>;
  const { blocking, forced } = updateOptOuts(env, fromSettings);
  if (forced) {
    return { ok: true, text: `plugin updates are on (${FORCE_PLUGIN_UPDATES_VAR} is set)` };
  }
  if (blocking.length === 0) return { ok: true, text: "plugin updates are not switched off" };
  const settingsPlace = `the env of ${tildify(paths.settingsFile, paths.home)}`;
  const named = blocking
    .map((v) => {
      const places = [v.inEnv ? "your environment" : null, v.inSettings ? settingsPlace : null];
      return `${v.name} (in ${places.filter((place) => place !== null).join(" and ")})`;
    })
    .join(", ");
  const names = blocking.map((v) => v.name);
  return {
    ok: false,
    text:
      `plugin updates are switched off: ${named} ${names.length === 1 ? "is" : "are"} set, so the background update skips them too. ` +
      `Set ${FORCE_PLUGIN_UPDATES_VAR}=1 as well, or remove ${names.join(" and ")}.`,
  };
}

/**
 * The self-update (`src/update/`): a hold, the last background check, and running
 * sessions that loaded an older version than the one installed now. A hold and a check
 * still to come are information; only a failed check is a ✗.
 */
function checkSelfUpdate(paths: CliPaths): Check[] {
  const files = updateFiles(paths.stateDir);
  const checks: Check[] = [];
  const since = heldSince(files);
  if (since !== null) {
    checks.push({
      ok: true,
      info: true,
      text: `background updates are on hold (since ${since}). To resume: ${COMMAND} update --resume`,
    });
  }
  const last = readLastCheck(files);
  const log = tildify(files.log, paths.home);
  if (last === null) {
    checks.push({
      ok: true,
      info: true,
      text: "background update: no check yet (a new Claude session checks, at most once an hour)",
    });
  } else {
    switch (last.result) {
      case "up-to-date":
        checks.push({
          ok: true,
          text: `background update: last check ${last.at}: ${last.detail} is the newest`,
        });
        break;
      case "updated":
        checks.push({
          ok: true,
          text: `background update: last check ${last.at}: installed ${last.detail}`,
        });
        break;
      case "checking":
        checks.push({
          ok: true,
          info: true,
          text: `background update: a check started at ${last.at} (${log})`,
        });
        break;
      case "skipped":
        checks.push({
          ok: true,
          info: true,
          text: `background update: last check ${last.at}: skipped: ${last.detail}`,
        });
        break;
      case "unreachable":
        checks.push({
          ok: true,
          info: true,
          text: `background update: last check ${last.at}: ${last.detail}, since ${last.since ?? last.at}. It counts as a failure only after ${UNREACHABLE_FAILS_AFTER_HOURS} h in a row. To look now: ${COMMAND} update --check`,
        });
        break;
      case "failed":
        checks.push({
          ok: false,
          text: `background update: the last check, ${last.at}, failed: ${last.detail}. The log: ${log}. To try now: ${COMMAND} update`,
        });
        break;
    }
  }
  const installed = findUserInstall(paths.installedPluginsFile)?.version ?? null;
  const older = runningSessions(files).filter((session) => isOlder(session.version, installed));
  if (older.length > 0) {
    const versions = [...new Set(older.map((session) => session.version))].sort().join(", ");
    checks.push({
      ok: true,
      info: true,
      text: `${older.length} running Claude session${older.length === 1 ? "" : "s"} loaded ${PLUGIN} ${versions}; ${installed} is installed. Restart ${older.length === 1 ? "it" : "them"} to load it.`,
    });
  }
  return checks;
}

function checkNameClash(settings: Record<string, unknown> | null): Check {
  const enabled = (settings?.enabledPlugins ?? {}) as Record<string, unknown>;
  const clashes = Object.entries(enabled)
    .filter(([id, on]) => on === true && id.startsWith(`${PLUGIN}@`) && id !== PLUGIN_ID)
    .map(([id]) => id);
  return clashes.length === 0
    ? { ok: true, text: `no other enabled plugin is named ${PLUGIN}` }
    : {
        ok: false,
        text: `another plugin named ${PLUGIN} is enabled: ${clashes.join(", ")}. Disable it.`,
      };
}

/**
 * This plugin's id before version 0.2.0, when it was called `cc` in the `cc-agentic`
 * marketplace. The one place the old names stay: both enabled means two copies of the same
 * hooks run.
 */
export const OLD_PLUGIN_ID = "cc@cc-agentic";
/** The old marketplace's name, which was also the old command and the old state folder's. */
const OLD_NAME = "cc-agentic";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `key` is a key of the object at `field` of `data`. */
function hasEntry(data: Record<string, unknown> | null, field: string | null, key: string) {
  const node = field === null ? data : data?.[field];
  return isJsonObject(node) && Object.hasOwn(node, key);
}

/**
 * What the old plugin (before 0.2.0) left behind.
 *
 * Without its state folder (`<config folder>/cc-agentic`), only an enabled old plugin is
 * reported, as before: two copies of the same hooks would run. With it, the old `setup`
 * ran on this machine, so any of these is a leftover: the old plugin enabled or
 * installed, its launcher `~/.local/bin/cc-agentic`, `extraKnownMarketplaces.cc-agentic`
 * in settings.json, or the marketplace in Claude Code's list. The order to clear them:
 * the old `restore` first (it removes what the old setup wrote), while its launcher still
 * runs; then the plugin; then the marketplace. A launcher that cannot run cannot restore,
 * so the two things the old setup wrote are named for removal by hand.
 */
function checkOldPlugin(settings: Record<string, unknown> | null, paths: CliPaths): Check | null {
  const plugins = settings?.enabledPlugins;
  const enabled = isJsonObject(plugins) && plugins[OLD_PLUGIN_ID] === true;
  if (!existsSync(join(paths.claudeConfigDir, OLD_NAME))) {
    if (!enabled) return null;
    return {
      ok: false,
      text: `the old plugin ${OLD_PLUGIN_ID} is still enabled: two copies of the same hooks would run. Run: claude plugin uninstall ${OLD_PLUGIN_ID}`,
    };
  }
  const short = (path: string) => tildify(path, paths.home);
  const launcher = join(paths.binDir, OLD_NAME);
  const left = [
    enabled ? "the plugin enabled" : null,
    hasEntry(readSettings(paths.installedPluginsFile), "plugins", OLD_PLUGIN_ID)
      ? "the plugin installed"
      : null,
    existsSync(launcher) ? `its launcher ${short(launcher)}` : null,
    hasEntry(settings, "extraKnownMarketplaces", OLD_NAME)
      ? `extraKnownMarketplaces.${OLD_NAME} in ${short(paths.settingsFile)}`
      : null,
    hasEntry(readSettings(paths.knownMarketplacesFile), null, OLD_NAME)
      ? `the ${OLD_NAME} marketplace`
      : null,
  ].filter((thing): thing is string => thing !== null);
  if (left.length === 0) return null;
  const then = `claude plugin uninstall ${OLD_PLUGIN_ID}\`, then \`claude plugin marketplace remove ${OLD_NAME}\``;
  const canRun = existsSync(launcher) && isExecutable(launcher) && run([launcher, "version"]).ok;
  const steps = canRun
    ? `Run \`${OLD_NAME} restore\` first, then \`${then}.`
    : `Its launcher cannot run, so remove by hand ${short(launcher)} and "${OLD_NAME}" under extraKnownMarketplaces in ${short(paths.settingsFile)}; then run \`${then}.`;
  return {
    ok: false,
    text: `the old plugin ${OLD_PLUGIN_ID} (before 0.2.0) left ${left.join(", ")}. ${steps}`,
  };
}

/**
 * The instructions: installed, this plugin version's, and imported by the cc-smart-dev-kit block. The
 * copy is compared two ways: its version stamp (`instructionsNeedRefresh`, the same test the
 * refresh after an update uses) and its files against the plugin's. A stored
 * `--no-instructions` is information, never a failure.
 */
function checkInstructions(paths: CliPaths, source: string): Check {
  const where = instructionsPaths(paths, source);
  const copy = `${tildify(where.target, paths.home)}/`;
  const claudeMd = tildify(where.claudeMd, paths.home);
  if (instructionsOptedOut(paths.stateDir)) {
    return {
      ok: true,
      info: true,
      text: "instructions: left out (cc-smart-dev-kit setup --no-instructions). To add them: cc-smart-dev-kit setup --instructions",
    };
  }
  if (!copyInstalled(where)) {
    return {
      ok: false,
      text: `the instructions are not installed in ${copy}. Run: cc-smart-dev-kit setup`,
    };
  }
  const why = copyDifferences(where);
  if (instructionsNeedRefresh(where, VERSION)) {
    why.unshift(`written by ${readVersionStamp(paths.stateDir) ?? "an unknown version"}`);
  }
  if (why.length > 0) {
    return {
      ok: false,
      text: `the instructions copy ${copy} is not this plugin version's (${why.join("; ")}). Run: cc-smart-dev-kit setup`,
    };
  }
  const text = existsSync(where.claudeMd) ? readFileSync(where.claudeMd, "utf8") : "";
  if (!text.includes(instructionsBlockBody(where.importPath))) {
    return {
      ok: false,
      text: `${claudeMd} does not import the instructions (its cc-smart-dev-kit block is missing or changed). Run: cc-smart-dev-kit setup`,
    };
  }
  return {
    ok: true,
    text: `the instructions copy ${copy} is this version's, and ${claudeMd} imports it`,
  };
}

/**
 * The last live check (`doctor --live`), as information. Nothing when it never ran, so a
 * machine that never asked for it sees no line. When the installed Claude Code is not the
 * one it passed on, the line says to run it again.
 */
function checkLiveRecord(paths: CliPaths): Check | null {
  const record = readLiveRecord(paths.stateDir);
  if (record === null) return null;
  const now = parseClaudeVersion(run(["claude", "--version"]).output);
  if (now !== null && now !== record.claudeCode) {
    return {
      ok: true,
      info: true,
      text: `the live check last passed on Claude Code ${record.claudeCode}; this machine has ${now}. Run: cc-smart-dev-kit doctor --live`,
    };
  }
  return {
    ok: true,
    info: true,
    text: `the live check passed on Claude Code ${record.claudeCode} (plugin ${record.plugin})`,
  };
}

/** The memory files Claude Code loads from a project folder. */
const PROJECT_MEMORY_FILES = ["CLAUDE.md", join(".claude", "CLAUDE.md"), "CLAUDE.local.md"];

/**
 * The `@~/…` or `@/…` imports of a CLAUDE.md that point into a cc-smart-dev-kit instructions copy
 * (a path with `/cc-smart-dev-kit/instructions/` in it), outside code. Claude Code does not read an
 * import inside a code span or a fenced block, so neither does this.
 */
export function ccSmartDevKitImports(text: string): string[] {
  const found: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const outsideCode = line.replace(/`[^`]*`/g, " ");
    for (const match of outsideCode.matchAll(/(?:^|\s)@((?:~\/|\/)\S+)/g)) {
      const path = match[1] ?? "";
      if (path.includes("/cc-smart-dev-kit/instructions/")) found.push(path);
    }
  }
  return found;
}

/**
 * The project's CLAUDE.md imports a cc-smart-dev-kit file that is missing: it loads nothing, with
 * no error from Claude Code. Claude Code reads the memory files of the current folder and
 * every folder above it, so doctor looks in the same places. No line when none of them
 * imports a cc-smart-dev-kit file. A missing file is `·` information when the person chose
 * `--no-instructions` (the project wants them, this machine left them out), else ✗.
 */
function checkProjectImports(paths: CliPaths, cwd: string): Check | null {
  const short = (path: string) => tildify(path, paths.home);
  const imports: { from: string; path: string; file: string }[] = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    for (const name of PROJECT_MEMORY_FILES) {
      const from = join(dir, name);
      // The config folder's own CLAUDE.md is checked by the instructions check.
      if (from === join(paths.claudeConfigDir, "CLAUDE.md") || !existsSync(from)) continue;
      let text: string;
      try {
        text = readFileSync(from, "utf8");
      } catch {
        continue;
      }
      for (const path of ccSmartDevKitImports(text)) {
        const file = path.startsWith("~/") ? join(paths.home, path.slice(2)) : path;
        imports.push({ from, path, file });
      }
    }
    if (dirname(dir) === dir) break;
  }
  if (imports.length === 0) return null;
  const missing = imports.filter((entry) => !existsSync(entry.file));
  if (missing.length === 0) {
    const names = imports.map((entry) => entry.path).join(", ");
    return { ok: true, text: `the project's CLAUDE.md imports ${names}, and it is there` };
  }
  const list = missing.map((entry) => `${short(entry.from)} imports ${entry.path}`).join("; ");
  if (instructionsOptedOut(paths.stateDir)) {
    return {
      ok: true,
      info: true,
      text: `${list}, which is missing: it loads nothing while the instructions are left out here. To add them: cc-smart-dev-kit setup --instructions`,
    };
  }
  return {
    ok: false,
    text: `${list}, which is missing: it loads nothing. Run: cc-smart-dev-kit setup`,
  };
}

/** Where doctor finds the plugin's instructions, and the folder it was started in. */
export interface DoctorLocal {
  /** The plugin's `instructions` folder, beside `dist/`. */
  instructionsSource: string;
  /** The current folder: its CLAUDE.md files (and those above it) are checked for imports. */
  cwd: string;
}

/** The two start blocks' names, as doctor says them. One per key in `START_BLOCK_KEYS`. */
const START_BLOCK_NAMES: Readonly<Record<string, string>> = {
  [START_BLOCK_KEYS[0]]: "work state",
  [START_BLOCK_KEYS[1]]: "memory-use block",
};

/** How one start block reads: its name, whether it is on, and who set it. */
function describeStartBlock(reading: StartBlockReading): string {
  const name = START_BLOCK_NAMES[reading.key] ?? reading.key;
  const state = reading.value === "false" ? "off" : "on";
  const by =
    reading.by === "setup"
      ? `set by ${COMMAND} setup`
      : reading.by === "person"
        ? "your choice"
        : "claude-mem's default";
  return `${name} is ${state} (${by})`;
}

/**
 * D23: claude-mem's two start blocks (its to-do list and its memory-use block), off. Both
 * on (or one, with nobody having chosen it) is a ✗ that names setup: together they pass
 * Claude Code's hook output limit in about one start in six. A value the person set is
 * information, never a failure. An unreadable file is a warning: doctor cannot judge it.
 */
function claudeMemStartBlocksCheck(
  paths: CliPaths,
  readings: StartBlockReading[] | { problem: string },
): Check {
  if ("problem" in readings) return { ok: true, warn: true, text: readings.problem };
  const base = `claude-mem's start blocks in ${tildify(paths.claudeMemSettingsFile, paths.home)}: ${readings.map(describeStartBlock).join(", ")}`;
  const unset = readings.filter((reading) => reading.value !== "false" && reading.by !== "person");
  if (unset.length > 0) {
    return {
      ok: false,
      text: `${base}. Together they overflow Claude Code's start context in about one start in six. Run: ${COMMAND} setup`,
    };
  }
  // Both off, or one left on by the person: their machine, their call. Information only.
  return {
    ok: true,
    ...(readings.some((reading) => reading.value !== "false") && { info: true }),
    text: base,
  };
}

/**
 * D23: Claude Code's own task tools, the to-do home of a session while claude-mem's work
 * state is off. Checked only while that is off; with work state on, claude-mem's own list
 * is there and this setting changes nothing.
 */
function claudeMemTodoToolsCheck(
  paths: CliPaths,
  readings: StartBlockReading[] | { problem: string },
): Check | null {
  if ("problem" in readings) return null;
  const workState = readings.find((reading) => reading.key === WORK_STATE_KEY);
  if (workState?.value !== "false") return null;
  const path = ["env", TODO_TOOLS_KEY];
  const current = getKey(readSettings(paths.settingsFile) ?? {}, path);
  const key = formatKeyPath(path);
  const file = tildify(paths.settingsFile, paths.home);
  if (current.found && Bun.deepEquals(current.value, TODO_TOOLS_VALUE)) {
    return {
      ok: true,
      text: `Claude Code's task tools are on for sessions: ${key} is ${JSON.stringify(TODO_TOOLS_VALUE)} in ${file}`,
    };
  }
  if (!current.found) {
    return {
      ok: false,
      text: `Claude Code's task tools are off for sessions: ${key} is not set in ${file}, so a session has no to-do list while claude-mem's work state is off. Run: ${COMMAND} setup`,
    };
  }
  // A value the person set is theirs: information, never a failure.
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  const ours = ownership(records, path, current) === "ours";
  return {
    ok: true,
    info: true,
    text: `Claude Code's task tools are off for sessions: ${key} is ${JSON.stringify(current.value)} in ${file} (${ours ? `set by ${COMMAND} setup` : "your choice"}), so a session has no to-do list while claude-mem's work state is off`,
  };
}

/** D23's lines: all `!` or `·`, except a gap setup fills. */
export function claudeMemChecks(paths: CliPaths): Check[] {
  const readings = readStartBlocks(paths);
  const todoTools = readings === null ? null : claudeMemTodoToolsCheck(paths, readings);
  return [
    ...(readings === null ? [] : [claudeMemStartBlocksCheck(paths, readings)]),
    ...(todoTools === null ? [] : [todoTools]),
  ];
}

/**
 * OmniRoute: one `·` line, and only when a newer release has been out for three days. Never
 * a failure — when to update is the person's choice, and the update restarts the model path.
 * Nothing when it is not installed, or when the registry cannot be read.
 */
async function omnirouteCheck(paths: CliPaths, env: Env, gateway: DoctorGateway): Promise<Check[]> {
  const line = await omnirouteDoctorLine({
    confirm: null,
    env,
    health: (url, init) => fetch(url, init),
    now: () => Date.now(),
    paths,
    registry: gateway.fetch ?? ((url, init) => fetch(url, init)),
    runner: gateway.runner,
    say: () => undefined,
    sleep: (ms) => Bun.sleep(ms),
    // A test passes its own folders: the host's `/usr/lib/node_modules` may hold an OmniRoute
    // that has nothing to do with the test, which would then read the real registry.
    systemFolders: gateway.systemFolders,
    systemd: gateway.service === "systemd",
    which: gateway.machine.which,
  });
  return line === null ? [] : [{ info: true, ok: true, text: line.text }];
}

/**
 * tmux: an alert from a pane reaches the terminal the person is looking at only with tmux
 * 3.3 or newer and its passthrough allowed (`all`, so a window the person is not looking at
 * works too), which is why `cc-smart-dev-kit setup` writes one managed line into `~/.tmux.conf` and
 * `restore` takes it out. Both lines are information (`·`), never failures: tmux is
 * optional, and so is this.
 */
function checkTmux(paths: CliPaths, env: Env, machine: Machine): Check[] {
  // Windows has no tmux, and setup manages `~/.tmux.conf` only where it is installed:
  // information, never a failure (`docs/windows-setup.md`).
  if (machine.platform === "win32") {
    return [
      {
        info: true,
        ok: true,
        text: "tmux: not on Windows, so no passthrough line is managed there",
      },
    ];
  }
  if (machine.which("tmux") === null) return [];
  const checks: Check[] = [];
  const conf = tildify(paths.tmuxConfFile, paths.home);
  if (!tmuxLineIn(paths.tmuxConfFile)) {
    checks.push({
      info: true,
      ok: true,
      text: `${conf} has no "${TMUX_LINE}" line, so tmux drops an alert from a pane. To add it: ${COMMAND} setup`,
    });
  }
  if ((env.TMUX ?? "") !== "" && tmuxPassthroughOf(machine.run) !== "all") {
    checks.push({
      info: true,
      ok: true,
      text: `tmux: alerts are not passed through (its allow-passthrough is not all). To apply it now: ${TMUX_NOW_COMMAND} (a restart works too); it needs tmux ${TMUX_MIN_VERSION} or newer`,
    });
  }
  return checks;
}

/**
 * The user-level `Notification` hook setup writes for agent view: Claude Code's list of
 * sessions runs only the hooks in settings files, never a plugin's `hooks.json`, so its
 * `agent_needs_input` and `agent_completed` alerts reach the notifier only through this
 * entry (`src/setup/user-notify-hook.ts`, `docs/claude-code-contract.md`).
 */
export function checkUserNotifyHook(paths: CliPaths): Check {
  const where = tildify(paths.settingsFile, paths.home);
  const state = userNotifyHookState(paths.settingsFile);
  if (state === "current") {
    return {
      ok: true,
      text: `agent view's notification hook is set in ${where}: ${USER_NOTIFY_COMMAND}`,
    };
  }
  if (state === "edited") {
    // The person's own version of the managed hook: it still runs the notifier, so it is
    // information, never a failure (an owned key the person changed is theirs, too).
    return {
      ok: true,
      info: true,
      text: `agent view's notification hook in ${where} was edited since setup wrote it; it still runs ${USER_NOTIFY_COMMAND}, and cc-smart-dev-kit leaves it alone`,
    };
  }
  return {
    ok: false,
    text:
      state === "elsewhere"
        ? `agent view's notification hook in ${where} does not run ${USER_NOTIFY_COMMAND}, so agent view's alerts never reach the notifier. Run: ${COMMAND} setup`
        : `agent view's notification hook is missing from ${where}, so agent view's alerts never arrive. Run: ${COMMAND} setup`,
  };
}

/**
 * The Linux desktop extras the notifier can use (`src/hooks/desktop-alert.ts`): a click on
 * an alert that raises the session's terminal window, the alert's minute on screen, one
 * alert per session, and the XFCE Do-Not-Disturb check. Each is skipped in silence when
 * its tool is missing, so doctor names the missing tool — as information (`·`), never a
 * failure: a desktop without them still shows every alert, exactly as before.
 *
 * The Do-Not-Disturb line is for an XFCE session only (`xfconf-query` is XFCE's own
 * tool, and no other desktop has that setting to miss); everything else is looked up on
 * any Linux desktop.
 */
function checkDesktopExtras(platform: NodeJS.Platform, env: Env, machine: Machine): Check[] {
  if (platform !== "linux" || !hasDesktop(platform, env)) return [];
  const checks: Check[] = [];
  if (machine.which("gdbus") === null) {
    checks.push({
      info: true,
      ok: true,
      text: "gdbus is not installed (glib's libglib2.0-bin provides it): a desktop alert has no minute on screen, and two alerts of one session can stay there together",
    });
  }
  if (machine.which("xdotool") === null) {
    checks.push({
      info: true,
      ok: true,
      text: "xdotool is not installed: a click on a desktop alert cannot raise the session's terminal window",
    });
  }
  if (
    (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().includes("xfce") &&
    machine.which("xfconf-query") === null
  ) {
    checks.push({
      info: true,
      ok: true,
      text: "xfconf-query is not installed: an alert's sound plays while XFCE's Do Not Disturb is on",
    });
  }
  return checks;
}

/** What the gateway checks need: the plugin's router bundle, a runner, and this machine's service. */
export interface DoctorGateway {
  bundle: string;
  runner: Runner;
  /** The service this machine can run the router under (`routerServiceKind`). */
  service: RouterServiceKind;
  /** Asks the system about Warp (its package manager); a test passes fakes. */
  machine: Machine;
  /**
   * Asks the npm registry whether a newer OmniRoute is out. The real `fetch` by default; a
   * test passes a fake, so it never reaches the network.
   */
  fetch?: RegistryFetch;
  /**
   * The folders outside the home a global OmniRoute may sit in. The machine's own by default
   * (`SYSTEM_PACKAGE_FOLDERS`); a test passes none, so a real `/usr/lib/node_modules/omniroute`
   * cannot make its run read the real registry or report a machine that is not its own.
   */
  systemFolders?: readonly string[] | undefined;
}

/** The Bun running doctor (through the launcher, the bun baked into it). */
export interface DoctorBun {
  /** Its file: `process.execPath`. */
  path: string;
  /** `Bun.version`. */
  version: string;
}

/** Is the Bun running doctor new enough? `MIN_BUN` says why it matters. */
function checkBun(bun: DoctorBun, paths: CliPaths): Check {
  const where = tildify(bun.path, paths.home);
  const tooOld = bunTooOld(bun.version, where);
  return tooOld === null
    ? { ok: true, text: `Bun ${bun.version} at ${where} (cc-smart-dev-kit needs ≥ ${MIN_BUN})` }
    : { ok: false, text: `${tooOld} Upgrade this Bun, then run: ${COMMAND} doctor` };
}

/** The project `doctor` checks: the folder it runs in, and the plugin's hooks.json. */
export interface DoctorProject {
  cwd: string;
  pluginHooksFile: string;
}

export interface DoctorOptions {
  /** The Bun running doctor (through the launcher, the bun baked into it). */
  bun: DoctorBun;
  /**
   * The browser's own checks (`src/browser/doctor.ts`): Chrome, the `claude-code` profile, the
   * Playwright extension in it, the token, and the registration. A test hands in a temp home;
   * null or left out: no browser lines.
   */
  browser?: BrowserDoctorDeps | null;
  gateway: DoctorGateway;
  /** Where the plugin's instructions are, and the folder doctor was started in. */
  local: DoctorLocal;
  /** Check the MCP servers setup registers (`mcp/doctor.ts`); null or left out: no MCP checks. */
  mcp?: McpDoctorDeps | null;
  /** Check the project of this folder (`project-checks.ts`); null: no project checks. */
  project: DoctorProject | null;
  /** Also run the live check (`doctor --live`), which starts real Claude Code sessions. */
  live: LiveDeps | null;
}

/**
 * Every check, in order, and nothing printed. `runDoctor` prints them; the portal's Machine
 * page shows the same list, so the two can never disagree about a machine.
 *
 * On a Bun older than `MIN_BUN` the gateway checks are skipped: they send the backend key,
 * and that Bun would send it through a proxy from the environment.
 */
export async function doctorChecks(
  paths: CliPaths,
  env: Env,
  { browser, bun, gateway, local, mcp, project, live }: DoctorOptions,
): Promise<Check[]> {
  const settings = readSettings(paths.settingsFile);
  const runtime = checkBun(bun, paths);
  const mcpDeps = mcp ?? null;
  const skipped: Check = {
    ok: true,
    info: true,
    text: "gateway: not checked on this Bun (its checks send the backend key)",
  };
  const gitBash = checkGitBash(gateway.machine.platform, env, gateway.machine);
  const checks = [
    runtime,
    checkPlugin(paths),
    checkInstalledVersion(paths),
    ...checkLauncher(paths, gateway.machine.platform),
    gitBash,
    checkInstructions(paths, local.instructionsSource),
    checkProjectImports(paths, local.cwd),
    await checkMarketplaceAccess(paths, env),
    checkAutoUpdate(paths),
    checkRetryWatchdog(paths),
    checkUpdatesNotOff(settings, env, paths),
    ...checkSelfUpdate(paths),
    checkNameClash(settings),
    checkOldPlugin(settings, paths),
    ...companionChecks(paths),
    ...claudeMemChecks(paths),
    ...(mcpDeps === null ? [] : mcpChecks(paths, mcpDeps, env, local.cwd)),
    ...(browser == null ? [] : browserChecks(paths, browser)),
    warpCheck(gateway.machine, paths),
    ...checkTmux(paths, env, gateway.machine),
    checkUserNotifyHook(paths),
    ...checkDesktopExtras(gateway.machine.platform, env, gateway.machine),
    ...(project === null ? [] : projectChecks(project.cwd, env, paths, project.pluginHooksFile)),
    ...(runtime.ok ? await gatewayChecks({ paths, ...gateway }) : [skipped]),
    ...(await omnirouteCheck(paths, env, gateway)),
    live === null ? checkLiveRecord(paths) : null,
    ...(live === null ? [] : runLiveCheck(paths, env, live)),
  ].filter((check): check is Check => check !== null);
  return checks;
}

/** One check's line, as `doctor` prints it and the portal's page shows its mark. */
export function checkLine(check: Check): string {
  return `${check.warn === true ? "!" : check.info === true ? "·" : check.ok ? "✓" : "✗"} ${check.text}`;
}

/**
 * Prints one ✓ or ✗ line per check, `·` for information (the gateway, when it was never
 * set up, is optional) and `!` for a warning. Exit code 1 when any check fails.
 */
export async function runDoctor(
  paths: CliPaths,
  env: Env,
  options: DoctorOptions,
): Promise<number> {
  const checks = await doctorChecks(paths, env, options);
  for (const check of checks) console.log(checkLine(check));
  return checks.every((check) => check.ok) ? 0 : 1;
}
