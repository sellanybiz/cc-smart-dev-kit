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
import type { KnownProjects } from "../gateway/commands-project";
import { messageOf } from "../gateway/config";
import { gatewayChecks } from "../gateway/doctor";
import { loopbackFetch } from "../gateway/health";
import type { RouterServiceKind, Runner } from "../gateway/service";
import { hasDesktop } from "../hooks/desktop-alert";
import { heavyJobChecks } from "../jobs/doctor";
import {
  MEMORY_USE_KEY,
  readClaudeMemSettings,
  readStartBlocks,
  START_BLOCK_KEYS,
  type StartBlockReading,
  TODO_TOOLS_KEY,
  WORK_STATE_KEY,
} from "../machine/claude-mem";
import { companionChecks, pluginEnabled } from "../machine/companions";
import type { Machine } from "../machine/machine";
import { warpCheck } from "../machine/warp";
import { type McpDoctorDeps, mcpChecks } from "../mcp/doctor";
import { omnirouteDoctorLine } from "../omniroute/commands";
import type { RegistryFetch } from "../omniroute/registry";
import type { PortalState } from "../portal/health";
import { DEFAULT_PORTAL_PORT } from "../ports";
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
import { formatKeyPath, getKey } from "../setup/managed-json";
import {
  canReadGitRemoteAsync,
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
import { maxSubagentsLine, maxSubagentsState } from "../setup/max-subagents";
import { retryWatchdogLine, retryWatchdogState } from "../setup/retry-watchdog";
import { TASK_ALLOW_PATH, TASK_DENY_PATH } from "../setup/task-tools";
import {
  TMUX_LINE,
  TMUX_MIN_VERSION,
  TMUX_NOW_COMMAND,
  tmuxLineIn,
  tmuxPassthroughOf,
} from "../setup/tmux";
import { readUserJson } from "../setup/user-json";
import { USER_NOTIFY_COMMAND, userNotifyHookState } from "../setup/user-notify-hook";
import { RETIRED_TASK_TOOLS, TASK_TOOLS_ALLOW_RULE } from "../tasks/words";
import { openWorkDb, WORK_SCHEMA_VERSION, workDbFile } from "../tasks/work/db";
import type { CommandRunner } from "../update/apply";
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
import {
  CHECK_GROUPS,
  type Check,
  type CheckGroup,
  type CheckStatus,
  checkStatus,
  FIX_LABEL,
  groupTitle,
} from "./check";
import { checkGitBash } from "./git-bash";
import { type LiveDeps, parseClaudeVersion, readLiveRecord, runLiveCheck } from "./live-check";
import { type CliPaths, tildify } from "./paths";
import { projectChecks } from "./project-checks";
import { type Mark, markText, type Out, plural } from "./ui/out";
import type { Terminal } from "./ui/terminal";

/** The fix most checks name: setup puts the plugin's files back in place. */
const SETUP_FIX = `${COMMAND} setup`;

export type { Check } from "./check";

/** The marketplace command that refreshes Claude Code's local copy of the marketplace. */
export const MARKETPLACE_UPDATE_COMMAND = `claude plugin marketplace update ${MARKETPLACE}`;

type Env = Record<string, string | undefined>;

function readSettings(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    // The one reader of a JSON file a person may have edited: it skips a byte order mark that
    // an editor on Windows writes, which `JSON.parse` refuses. Setup reads the same file with
    // it, so doctor and setup can never disagree about a key (`src/setup/user-json.ts`).
    const parsed: unknown = readUserJson(file);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * How a read command runs for `doctor` itself: `Bun.spawnSync`, answered where it stands
 * (the launcher's `version`, the old launcher's). A caller off the server's event loop
 * (the portal's Machine page) passes its own asynchronous runner (`DoctorOptions.read`,
 * `Bun.spawn`) and never freezes a page on one (`.claude/rules/portal.md`).
 */
const syncRead: CommandRunner = (argv) => {
  try {
    const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    return { exitCode: result.exitCode ?? 1, output };
  } catch (error) {
    return { exitCode: 127, output: error instanceof Error ? error.message : String(error) };
  }
};

/** This plugin itself: installed, its folder there, and turned on in the user settings. */
export function checkPlugin(paths: CliPaths): Check {
  const install = findUserInstall(paths.installedPluginsFile);
  if (!install) {
    return {
      ok: false,
      text: `the ${PLUGIN_ID} plugin is not installed`,
      fix: PLUGIN_INSTALL_COMMAND,
    };
  }
  const where = tildify(install.installPath, paths.home);
  if (!existsSync(install.installPath)) {
    return {
      ok: false,
      text: `the plugin folder is missing: ${where}`,
      fix: PLUGIN_INSTALL_COMMAND,
    };
  }
  // Installed is not on: Claude Code loads only a plugin whose `enabledPlugins` entry is
  // true, and a person who turned this one off (or whose install predates the entry) gets no
  // hook, no skill and no command from it. `pluginEnabled` is the same reader doctor uses for
  // the companions, so the two can never disagree about one settings file.
  if (!pluginEnabled(paths, PLUGIN_ID)) {
    return {
      ok: false,
      text: `${PLUGIN_ID} ${install.version ?? "(no version)"} is installed, but the user settings turn it off: none of its hooks, skills or commands run`,
      fix: `claude plugin enable ${PLUGIN_ID}`,
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
async function checkLauncher(
  paths: CliPaths,
  platform: NodeJS.Platform,
  read: CommandRunner,
): Promise<Check[]> {
  const win = platform === "win32";
  const launcher = join(paths.binDir, LAUNCHER_NAME);
  const where = tildify(launcher, paths.home);
  if (!existsSync(launcher))
    return [{ ok: false, text: `no launcher at ${where}`, fix: SETUP_FIX }];
  if (!win && !isExecutable(launcher)) {
    return [
      {
        ok: false,
        text: `the launcher ${where} is not executable`,
        fix: SETUP_FIX,
      },
    ];
  }
  const script = readFileSync(launcher, "utf8");
  const bun = bakedBunPath(script);
  if (bun === null || script !== launcherScript(bun)) {
    return [{ ok: false, text: `the launcher ${where} is out of date`, fix: SETUP_FIX }];
  }
  if (!isUsableBun(bun, platform)) {
    return [
      {
        ok: false,
        text: `the launcher's bun ${tildify(bun, paths.home)} is missing or not executable`,
        fix: SETUP_FIX,
      },
    ];
  }
  if (win)
    return [
      await checkLauncherCmd(paths, where, read),
      { ok: true, text: `the launcher ${where} is in place (Git Bash runs it)` },
    ];
  const result = await read([launcher, "version"]);
  if (result.exitCode !== 0)
    return [
      { ok: false, text: `the launcher ${where} does not run: ${result.output}`, fix: SETUP_FIX },
    ];
  return [{ ok: true, text: `the launcher ${where} runs ${result.output}` }];
}

/**
 * The Windows launcher's own check: the `.cmd` is there, is this version's, and runs. It is
 * started through `cmd.exe` — a `.cmd` is not an executable, so `Bun.spawn` cannot start one
 * (`launcherCmdArgv`).
 */
async function checkLauncherCmd(
  paths: CliPaths,
  shLauncher: string,
  read: CommandRunner,
): Promise<Check> {
  const cmd = join(paths.binDir, LAUNCHER_CMD_NAME);
  const where = tildify(cmd, paths.home);
  if (!existsSync(cmd)) {
    return {
      ok: false,
      text: `no Windows launcher at ${where}, so cmd and PowerShell cannot run ${COMMAND} (Git Bash runs ${shLauncher})`,
      fix: SETUP_FIX,
    };
  }
  const script = readFileSync(cmd, "utf8");
  const bun = cmdBakedBunPath(script);
  if (bun === null || script !== launcherCmdScript(bun)) {
    return {
      ok: false,
      text: `the Windows launcher ${where} is out of date`,
      fix: SETUP_FIX,
    };
  }
  if (!isUsableBun(bun, "win32")) {
    return {
      ok: false,
      text: `the Windows launcher's bun ${tildify(bun, paths.home)} is missing or not executable`,
      fix: SETUP_FIX,
    };
  }
  const result = await read(launcherCmdArgv(cmd, ["version"]));
  if (result.exitCode !== 0)
    return {
      ok: false,
      text: `the Windows launcher ${where} does not run: ${result.output}`,
      fix: SETUP_FIX,
    };
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
        text: `the ${MARKETPLACE} marketplace is not added`,
        fix: MARKETPLACE_ADD_COMMAND,
      };
    case "unknown":
      return {
        ok: false,
        text: `cannot check the marketplace source (${source.type})`,
        fix: `remove the marketplace (claude plugin marketplace remove ${MARKETPLACE}), then add it again: ${MARKETPLACE_ADD_COMMAND}`,
      };
    case "local":
      return existsSync(source.path)
        ? { ok: true, text: `the marketplace folder ${tildify(source.path, paths.home)} exists` }
        : {
            ok: false,
            text: `the marketplace folder is missing: ${source.path}`,
            fix: `put the folder back, or remove the marketplace (claude plugin marketplace remove ${MARKETPLACE}) and add it again: ${MARKETPLACE_ADD_COMMAND}`,
          };
    case "http": {
      const url = redactUrl(source.url);
      const result = await canReadHttp(source.url);
      return result.ok
        ? { ok: true, text: `can read the marketplace at ${url}` }
        : {
            ok: false,
            text: `cannot read the marketplace at ${url}: ${result.detail}`,
            fix: `check this machine's network and that the URL opens, then run: ${COMMAND} doctor`,
          };
    }
    case "git": {
      const failures: string[] = [];
      let cause: GitFailureCause = "unknown";
      let repo: string | null = null;
      for (const url of source.urls) {
        const result = await canReadGitRemoteAsync(url, env);
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
        text: `cannot read the marketplace (${failures.join("; ")})`,
        fix:
          advice === "" ? "check your git access: an SSH key, or a git credential helper" : advice,
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
      text: `the ${MARKETPLACE} marketplace has no local copy`,
      fix: MARKETPLACE_UPDATE_COMMAND,
    };
  }
  const { manifest, version: latest } = marketplaceCopyVersion(location, PLUGIN);
  if (latest === null) {
    return {
      ok: false,
      text: `cannot read the version in ${tildify(manifest, paths.home)}`,
      fix: MARKETPLACE_UPDATE_COMMAND,
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
      fix: PLUGIN_UPDATE_COMMAND,
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
      text: `installed ${installed ?? "(no version)"}, marketplace has ${latest}`,
      fix: PLUGIN_UPDATE_COMMAND,
    };
  }
  return {
    ok: true,
    text: `the installed version ${installed} is up to date with the marketplace`,
  };
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
    return {
      ok: false,
      text: `cannot read Claude Code's plugin auto-update: ${messageOf(error)}`,
      fix: `make ${settingsFile} valid JSON again, then run: ${COMMAND} doctor`,
    };
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
        text: `Claude Code's own plugin auto-update is on (${key} is true in ${settingsFile}, set by an older setup): ${risk}`,
        fix: SETUP_FIX,
      };
    case "yours":
      return {
        ok: false,
        text: `Claude Code's own plugin auto-update is on (${key} is true in ${settingsFile}, not set by ${COMMAND}): ${risk}`,
        fix: `remove that key from ${settingsFile} by hand, then run: ${COMMAND} setup`,
      };
    case "known":
      return {
        ok: false,
        text: `Claude Code's own plugin auto-update is on (its own record, ${tildify(paths.knownMarketplacesFile, paths.home)}, says so): ${risk}`,
        fix: SETUP_FIX,
      };
  }
}

/**
 * Claude Code's own subagent cap (`src/setup/max-subagents.ts`) is a choice, never a failure:
 * one `·` line says how many subagents a session runs at once, and whose value that is.
 */
function checkMaxSubagents(paths: CliPaths): Check {
  const file = tildify(paths.settingsFile, paths.home);
  try {
    return {
      ok: true,
      info: true,
      text: maxSubagentsLine(maxSubagentsState(paths.settingsFile, paths.stateDir), file),
    };
  } catch (error) {
    return {
      ok: true,
      info: true,
      text: `max subagents: not checked, ${file} cannot be read: ${messageOf(error)}`,
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
  if (blocking.length === 0) return { ok: true, text: "plugin updates are on" };
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
    text: `plugin updates are switched off: ${named} ${names.length === 1 ? "is" : "are"} set, so the background update skips them too`,
    fix: `set ${FORCE_PLUGIN_UPDATES_VAR}=1 as well, or remove ${names.join(" and ")}`,
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
          text: `background update: the last check, ${last.at}, failed: ${last.detail}. The log: ${log}`,
          fix: `${COMMAND} update`,
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
        text: `another plugin named ${PLUGIN} is enabled: ${clashes.join(", ")}`,
        fix: clashes.map((id) => `claude plugin disable ${id}`).join(", then "),
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
async function checkOldPlugin(
  settings: Record<string, unknown> | null,
  paths: CliPaths,
  read: CommandRunner,
): Promise<Check | null> {
  const plugins = settings?.enabledPlugins;
  const enabled = isJsonObject(plugins) && plugins[OLD_PLUGIN_ID] === true;
  if (!existsSync(join(paths.claudeConfigDir, OLD_NAME))) {
    if (!enabled) return null;
    return {
      ok: false,
      text: `the old plugin ${OLD_PLUGIN_ID} is still enabled: two copies of the same hooks would run`,
      fix: `claude plugin uninstall ${OLD_PLUGIN_ID}`,
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
  const canRun =
    existsSync(launcher) &&
    isExecutable(launcher) &&
    (await read([launcher, "version"])).exitCode === 0;
  return {
    ok: false,
    text: `the old plugin ${OLD_PLUGIN_ID} (before 0.2.0) left ${left.join(", ")}`,
    fix: canRun
      ? `run \`${OLD_NAME} restore\` first, then \`${then}`
      : `its launcher cannot run, so remove by hand ${short(launcher)} and "${OLD_NAME}" under extraKnownMarketplaces in ${short(paths.settingsFile)}; then run \`${then}`,
  };
}

/**
 * The instructions: installed, this plugin version's, and imported by the cc-smart-dev-kit block. The
 * copy's files are compared with the plugin's; only a difference fails. A stamp that names
 * another version (`instructionsNeedRefresh`, the same test the refresh after an update uses)
 * while every file matches is state, not a fault: the line passes and says so, because `setup`
 * then rewrites only the stamp, which it never prints. A stored `--no-instructions` is
 * information, never a failure.
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
      text: `the instructions are not installed in ${copy}`,
      fix: SETUP_FIX,
    };
  }
  const why = copyDifferences(where);
  const stamp = readVersionStamp(paths.stateDir);
  const stampLags = instructionsNeedRefresh(where, VERSION);
  if (why.length > 0) {
    if (stampLags) why.unshift(`written by ${stamp ?? "an unknown version"}`);
    return {
      ok: false,
      text: `the instructions copy ${copy} is not this plugin version's (${why.join("; ")})`,
      fix: SETUP_FIX,
    };
  }
  const text = existsSync(where.claudeMd) ? readFileSync(where.claudeMd, "utf8") : "";
  if (!text.includes(instructionsBlockBody(where.importPath))) {
    return {
      ok: false,
      text: `${claudeMd} does not import the instructions (its ${COMMAND} block is missing or changed)`,
      fix: SETUP_FIX,
    };
  }
  const lag = stampLags
    ? ` (its stamp says ${stamp ?? "no version"} until the next session start or ${COMMAND} setup)`
    : "";
  return {
    ok: true,
    text: `the instructions copy ${copy} is this version's${lag}, and ${claudeMd} imports it`,
  };
}

/**
 * The last live check (`doctor --live`), as information. Nothing when it never ran, so a
 * machine that never asked for it sees no line. When the installed Claude Code is not the
 * one it passed on, the line says to run it again.
 */
async function checkLiveRecord(paths: CliPaths, read: CommandRunner): Promise<Check | null> {
  const record = readLiveRecord(paths.stateDir);
  if (record === null) return null;
  const now = parseClaudeVersion((await read(["claude", "--version"])).output);
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
    text: `${list}, which is missing: it loads nothing`,
    fix: SETUP_FIX,
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
 * D75: both start blocks stay off. A person's contrary choice is information.
 * An unreadable file is a warning: doctor cannot judge it.
 */
function claudeMemStartBlocksCheck(
  paths: CliPaths,
  readings: StartBlockReading[] | { problem: string },
): Check {
  if ("problem" in readings) return { ok: true, warn: true, text: readings.problem };
  const base = `claude-mem's start blocks in ${tildify(paths.claudeMemSettingsFile, paths.home)}: ${readings.map(describeStartBlock).join(", ")}`;
  const memory = readings.find((reading) => reading.key === MEMORY_USE_KEY);
  const work = readings.find((reading) => reading.key === WORK_STATE_KEY);
  const reasons: string[] = [];
  if (memory && memory.value !== "false" && memory.by !== "person") {
    reasons.push(
      ". The memory-use block must be off so the kit owns instruction routing; it still points at work_state_write",
    );
  }
  if (work && work.value !== "false" && work.by !== "person") {
    reasons.push(". Work state must be off so the kit owns the task list");
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      text: `${base}${reasons.join("")}`,
      fix: SETUP_FIX,
    };
  }
  // Only a person's choice contrary to the kit's aim needs an information mark.
  return {
    ok: true,
    ...(((memory?.by === "person" && memory.value !== "false") ||
      (work?.by === "person" && work.value !== "false")) && { info: true }),
    text: base,
  };
}

/**
 * D75: the kit's tools are trusted and the two built-in lists are hidden.
 * Check every machine, independently of claude-mem's settings.
 */
export function taskToolsCheck(paths: CliPaths): Check {
  const data = readSettings(paths.settingsFile) ?? {};
  const allow = getKey(data, TASK_ALLOW_PATH).value;
  const deny = getKey(data, TASK_DENY_PATH).value;
  const missing = RETIRED_TASK_TOOLS.filter((tool) => !Array.isArray(deny) || !deny.includes(tool));
  const reasons: string[] = [];
  if (!Array.isArray(allow) || !allow.includes(TASK_TOOLS_ALLOW_RULE))
    reasons.push(`missing allow rule ${TASK_TOOLS_ALLOW_RULE}`);
  if (missing.length > 0) reasons.push(`missing deny rules ${missing.join(", ")}`);
  return reasons.length > 0
    ? { ok: false, text: `task tools: ${reasons.join("; ")}`, fix: SETUP_FIX }
    : {
        ok: true,
        text: "task tools: the kit's tools are allowed and the built-in task lists are hidden",
      };
}

/**
 * D68's opt-in key, still in the settings after setup withdrew its own copy: the person's, so
 * information only. The deny entries hide Claude Code's task tools whatever it says.
 */
export function oldTodoToolsKeyCheck(paths: CliPaths): Check | null {
  const path = ["env", TODO_TOOLS_KEY];
  if (!getKey(readSettings(paths.settingsFile) ?? {}, path).found) return null;
  return {
    ok: true,
    info: true,
    text: `${tildify(paths.settingsFile, paths.home)}: ${formatKeyPath(path)} is yours and no longer used; it can go, the kit's own task list replaced Claude Code's`,
  };
}

export function taskStoreChecks(paths: CliPaths): Check[] {
  const file = workDbFile(paths);
  if (!existsSync(file)) return [{ ok: true, info: true, text: "task work store: not made yet" }];
  // No snapshots of the store exist (not in this release), so the one step that always works:
  // set the file aside, and the next write makes a new, empty store.
  const brokenFix = `move ${tildify(file, paths.home)} aside, with its -wal and -shm files; the next task call starts an empty store (project task files are in git and stay)`;
  try {
    const db = openWorkDb(file, { mode: "hook" });
    try {
      const version =
        db.sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ??
        0;
      const schema: Check =
        version > WORK_SCHEMA_VERSION
          ? {
              ok: true,
              warn: true,
              text: `task work store: schema ${version} is newer than ${WORK_SCHEMA_VERSION}`,
              fix: `${COMMAND} update`,
            }
          : version === WORK_SCHEMA_VERSION
            ? { ok: true, text: `task work store: schema ${version} is current` }
            : {
                ok: false,
                text: `task work store: schema ${version} needs migration`,
                fix: `${COMMAND} task list`,
              };
      const integrity = db.sqlite
        .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
        .all();
      return [
        schema,
        integrity.length === 1 && integrity[0]?.integrity_check === "ok"
          ? { ok: true, text: "task work store: integrity check is ok" }
          : {
              ok: false,
              text: "task work store: integrity check failed",
              fix: brokenFix,
            },
      ];
    } finally {
      db.close();
    }
  } catch (error) {
    return [
      {
        ok: false,
        text: `task work store cannot be read: ${messageOf(error)}`,
        fix: brokenFix,
      },
    ];
  }
}

/** Start blocks and model work outside the note-taker route, when claude-mem is installed. */
export function claudeMemChecks(paths: CliPaths): Check[] {
  const readings = readStartBlocks(paths);
  if (readings === null) return [];
  const checks = [claudeMemStartBlocksCheck(paths, readings)];
  const read = readClaudeMemSettings(paths);
  if ("problem" in read) return checks;
  const key = "CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH";
  const setting = getKey(read.data, read.at(key));
  const off = setting.value === "false" || setting.value === false;
  checks.push({
    ok: true,
    info: true,
    text: off
      ? `claude-mem's My Work auto-refresh is off in ${read.short}; it will not launch logged-in agents outside the note-taker route`
      : `claude-mem's My Work auto-refresh is on${setting.found ? "" : " (default)"}. It can run logged-in agents outside the note-taker route shown by the kit. To turn it off: set ${key} to "false" in ${read.short}`,
  });
  return checks;
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
    health: loopbackFetch,
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
async function checkTmux(
  paths: CliPaths,
  env: Env,
  machine: Machine,
  read: CommandRunner,
): Promise<Check[]> {
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
  if ((env.TMUX ?? "") !== "" && (await tmuxPassthroughOf(read)) !== "all") {
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
        ? `agent view's notification hook in ${where} does not run ${USER_NOTIFY_COMMAND}, so agent view's alerts never reach the notifier`
        : `agent view's notification hook is missing from ${where}, so agent view's alerts never arrive`,
    fix: SETUP_FIX,
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
  /**
   * How the gateway checks' own reads run (the router service's state, what holds its port).
   * Default: `runner`. The portal passes its asynchronous runner (`ReadRunner`): the Machine
   * page shows these checks, and a page load must never freeze on `systemctl`
   * (`.claude/rules/portal.md`).
   */
  read?: CommandRunner;
  /** The service this machine can run the router under (`routerServiceKind`). */
  service: RouterServiceKind;
  /** Asks the system about Warp (its package manager); a test passes fakes. */
  machine: Machine;
  /**
   * The projects `gateway projects` lists — the portal's own `projectsList`, wired by the
   * entry (`src/entries/cli.ts`, `src/entries/portal.ts`) so the doctor's per-project lines
   * read the same list as the command and the Projects page.
   */
  projects?: (folder: string) => Promise<KnownProjects>;
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
    : {
        ok: false,
        text: tooOld.replace(/\.$/, ""),
        fix: `upgrade this Bun (bun upgrade), then run: ${COMMAND} doctor`,
      };
}

/** The portal's line: what runs, its address, and what to do when it cannot. */
export function checkPortal(state: PortalState, port: number = DEFAULT_PORTAL_PORT): Check {
  const address = `http://127.0.0.1:${port}/`;
  if (state.kind === "free") {
    return {
      info: true,
      ok: true,
      text: `the portal is not running; it starts with the next Claude Code session, or now: ${COMMAND} portal`,
    };
  }
  if (state.kind === "other") {
    return {
      ok: false,
      text: `another program holds 127.0.0.1:${port}, so the portal cannot start`,
      fix: `stop that program, then run: ${COMMAND} portal`,
    };
  }
  const running = `the portal is running at ${address} (version ${state.version}, process ${state.pid})`;
  if (state.version === VERSION) return { ok: true, text: running };
  if (isOlder(state.version, VERSION)) {
    return {
      ok: true,
      text: `${running}; the next Claude Code session restarts it onto ${VERSION}`,
      warn: true,
    };
  }
  return {
    ok: true,
    text: `${running}, newer than this install (${VERSION}); it is left as it is`,
  };
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
  /**
   * Asks the portal's health route (`probePortal`): whether it runs, on which version, and
   * whether another program holds its port. Null or left out: no portal line (a test about
   * another part, or a machine where the portal is not this code's business).
   */
  portal?: null | (() => PortalState | Promise<PortalState>);
  /** Check the project of this folder (`project-checks.ts`); null: no project checks. */
  project: DoctorProject | null;
  /**
   * How `doctor`'s own reads run: the launcher's `version`, the old launcher's, Warp's package
   * manager. Default: the command line's `Bun.spawnSync`. The portal passes its asynchronous
   * runner (`ReadRunner`), because it shows this pass on the Machine page and a page load must
   * never freeze on one (`Bun.spawnSync`) — `.claude/rules/portal.md`.
   */
  read?: CommandRunner;
  /** Also run the live check (`doctor --live`), which starts real Claude Code sessions. */
  live: LiveDeps | null;
}

/** What `doctor` runs for one group of its report. */
interface GroupRun {
  group: CheckGroup;
  run: () => Promise<Check[]>;
}

/**
 * Every group of checks, in the order the report prints them, each run only when asked: so
 * `runDoctor` can say which group it is checking while that group runs (UX-4), and print each
 * group as soon as it is done.
 *
 * On a Bun older than `MIN_BUN` the gateway checks are skipped: they send the backend key,
 * and that Bun would send it through a proxy from the environment.
 */
function doctorGroups(
  paths: CliPaths,
  env: Env,
  { browser, bun, gateway, local, mcp, portal, project, read, live }: DoctorOptions,
): GroupRun[] {
  const settings = readSettings(paths.settingsFile);
  const runtime = checkBun(bun, paths);
  const machine = gateway.machine;
  /** How `doctor`'s own reads run: the command line's synchronous one, or the caller's. */
  const readCommand = read ?? syncRead;
  const present = (checks: (Check | null)[]) =>
    checks.filter((check): check is Check => check !== null);
  const groups: { group: CheckGroup; run: () => Check[] | Promise<Check[]> }[] = [
    {
      group: "plugin",
      run: async () =>
        present([
          runtime,
          checkPlugin(paths),
          checkInstalledVersion(paths),
          ...(portal == null ? [] : [checkPortal(await portal())]),
          ...(await checkLauncher(paths, machine.platform, readCommand)),
          checkGitBash(machine.platform, env, machine),
          checkInstructions(paths, local.instructionsSource),
          taskToolsCheck(paths),
          ...taskStoreChecks(paths),
          oldTodoToolsKeyCheck(paths),
          checkNameClash(settings),
          await checkOldPlugin(settings, paths, readCommand),
        ]),
    },
    {
      group: "updates",
      run: async () => [
        await checkMarketplaceAccess(paths, env),
        checkAutoUpdate(paths),
        checkUpdatesNotOff(settings, env, paths),
        ...checkSelfUpdate(paths),
      ],
    },
    {
      group: "companions",
      run: async () => [
        ...companionChecks(paths),
        ...claudeMemChecks(paths),
        await warpCheck(machine, paths, readCommand),
      ],
    },
    {
      group: "mcp",
      run: () => (mcp == null ? [] : mcpChecks(paths, mcp, env, local.cwd)),
    },
    { group: "browser", run: () => (browser == null ? [] : browserChecks(paths, browser)) },
    {
      group: "alerts",
      run: async () => [
        checkUserNotifyHook(paths),
        ...(await checkTmux(paths, env, machine, readCommand)),
        ...checkDesktopExtras(machine.platform, env, machine),
        checkRetryWatchdog(paths),
        checkMaxSubagents(paths),
        ...heavyJobChecks(paths),
      ],
    },
    {
      group: "project",
      run: async () =>
        present([
          checkProjectImports(paths, local.cwd),
          ...(project === null
            ? []
            : await projectChecks(project.cwd, env, paths, project.pluginHooksFile)),
        ]),
    },
    {
      group: "gateway",
      run: async () => [
        ...(runtime.ok
          ? await gatewayChecks({ paths, folder: local.cwd, ...gateway })
          : [
              {
                ok: true,
                info: true,
                text: "gateway: not checked on this Bun (its checks send the backend key)",
              } satisfies Check,
            ]),
        ...(await omnirouteCheck(paths, env, gateway)),
      ],
    },
    {
      group: "live",
      run: async () =>
        live === null
          ? present([await checkLiveRecord(paths, readCommand)])
          : runLiveCheck(paths, env, live),
    },
  ];
  return groups.map(({ group, run }) => ({
    group,
    run: async () => (await run()).map((check) => ({ ...check, group })),
  }));
}

/**
 * Every check, in order, and nothing printed, each with its `group`. `runDoctor` prints them;
 * the portal's Machine page shows the same list, so the two can never disagree about a machine.
 */
export async function doctorChecks(
  paths: CliPaths,
  env: Env,
  options: DoctorOptions,
): Promise<Check[]> {
  const checks: Check[] = [];
  for (const { run } of doctorGroups(paths, env, options)) checks.push(...(await run()));
  return checks;
}

/** A check's status as a mark of `out.ts`. */
function markOf(check: Check): Mark {
  return checkStatus(check);
}

/** A check's mark as the portal and `checkLine` show it: always the Unicode one. */
export function checkMark(check: Check): string {
  return markText(UNICODE_TERMINAL, markOf(check));
}

/** The terminal the portal's words and `checkLine` are made for: Unicode, no colour, no wrap. */
const UNICODE_TERMINAL: Terminal = {
  color: false,
  rich: false,
  unicode: true,
  width: Number.POSITIVE_INFINITY,
};

/** One check on one line, its fix after it: the portal's list, and a test's way to read one. */
export function checkLine(check: Check): string {
  const fix = check.fix === undefined ? "" : ` ${FIX_LABEL} ${check.fix}`;
  return `${checkMark(check)} ${check.text}${fix}`;
}

/** How many checks of each status a list holds. */
export type CheckCounts = Record<CheckStatus, number>;

export function countChecks(checks: readonly Check[]): CheckCounts {
  const counts: CheckCounts = { fail: 0, info: 0, ok: 0, warn: 0 };
  for (const check of checks) counts[checkStatus(check)] += 1;
  return counts;
}

/** What a group holds, in words: "1 to fix, 4 passed, 1 note". */
export function groupSummary(counts: CheckCounts): string {
  return [
    counts.fail > 0 ? `${counts.fail} to fix` : null,
    counts.warn > 0 ? plural(counts.warn, "warning", "warnings") : null,
    counts.ok > 0 ? `${counts.ok} passed` : null,
    counts.info > 0 ? plural(counts.info, "note", "notes") : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

/** A group's own mark: its worst line. A group of notes only is a note. */
function groupMark(counts: CheckCounts): Mark {
  if (counts.fail > 0) return "fail";
  if (counts.warn > 0) return "warn";
  return counts.ok > 0 ? "ok" : "info";
}

/**
 * The lines a group shows under its own line. A group with a failure or a warning opens: every
 * line, so the cause is read with what passed around it. A group that passed folds: only its
 * notes, which say something a person may act on. `--verbose` opens every group.
 */
function shownLines(checks: readonly Check[], counts: CheckCounts, verbose: boolean): Check[] {
  const open = verbose || counts.fail > 0 || counts.warn > 0;
  return open ? [...checks] : checks.filter((check) => checkStatus(check) === "info");
}

/** The report's last line: what the whole run found, in words. */
export function doctorVerdict(counts: CheckCounts): { mark: Mark; text: string } {
  if (counts.fail > 0) {
    const warnings = counts.warn > 0 ? `, ${plural(counts.warn, "warning", "warnings")}` : "";
    return {
      mark: "fail",
      text: `${counts.fail} to fix, ${counts.ok} passed${warnings}. Run each ${FIX_LABEL} line above, then: ${COMMAND} doctor`,
    };
  }
  if (counts.warn > 0) {
    return {
      mark: "warn",
      text: `Nothing to fix: ${counts.ok} passed, and ${plural(counts.warn, "warning", "warnings")} to read above.`,
    };
  }
  return { mark: "ok", text: `Everything works: ${counts.ok} checks passed.` };
}

/** What `doctor --json` prints. `format` goes up when a field changes meaning. */
export interface DoctorReport {
  format: 1;
  version: string;
  ok: boolean;
  counts: CheckCounts;
  groups: {
    id: CheckGroup;
    title: string;
    status: CheckStatus;
    checks: { status: CheckStatus; text: string; fix?: string }[];
  }[];
}

/** The JSON report of a run, for a program: the installers read it (UX-19). */
export function doctorReport(
  results: readonly { group: CheckGroup; checks: Check[] }[],
): DoctorReport {
  const all = results.flatMap((result) => result.checks);
  const counts = countChecks(all);
  return {
    format: 1,
    version: VERSION,
    ok: counts.fail === 0,
    counts,
    groups: results
      .filter((result) => result.checks.length > 0)
      .map((result) => ({
        id: result.group,
        title: groupTitle(result.group),
        status: checkStatus(worst(result.checks)),
        checks: result.checks.map((check) => ({
          status: checkStatus(check),
          text: check.text,
          ...(check.fix === undefined ? {} : { fix: check.fix }),
        })),
      })),
  };
}

/** The check that says most about a group: a failure, then a warning, then a pass, then a note. */
function worst(checks: readonly Check[]): Check {
  const order: CheckStatus[] = ["fail", "warn", "ok", "info"];
  return [...checks].sort(
    (a, b) => order.indexOf(checkStatus(a)) - order.indexOf(checkStatus(b)),
  )[0] as Check;
}

/** The options `doctor` takes; `help.ts`'s doctor text explains each. */
export const DOCTOR_FLAGS: readonly string[] = ["--json", "--live", "--verbose"];

/** How `doctor` was asked to print. */
export interface DoctorPrint {
  /** Print the JSON report only (`--json`). */
  json: boolean;
  /** Open every group (`--verbose`). */
  verbose: boolean;
}

/**
 * Runs every check and prints the report: a heading, one line per group — a passing group
 * folds to that line and its notes — each failure with its `Fix:` line, then one verdict line.
 * Each group prints as soon as it is done, and a rich terminal shows which group is running
 * (UX-4, UX-5). `--json` prints the report as JSON and nothing else. Exit code 1 when any check
 * fails.
 */
export async function runDoctor(
  paths: CliPaths,
  env: Env,
  options: DoctorOptions,
  out: Out,
  print: DoctorPrint = { json: false, verbose: false },
): Promise<number> {
  const titleWidth = Math.max(...CHECK_GROUPS.map((entry) => entry.title.length));
  const results: { group: CheckGroup; checks: Check[] }[] = [];
  let folded = 0;
  if (!print.json) {
    out.heading(`${COMMAND} ${VERSION}: checking this machine`);
    out.blank();
  }
  for (const { group, run } of doctorGroups(paths, env, options)) {
    const checks = await out.progress(`${groupTitle(group)}…`, run);
    results.push({ group, checks });
    if (print.json || checks.length === 0) continue;
    const counts = countChecks(checks);
    const shown = shownLines(checks, counts, print.verbose);
    folded += checks.length - shown.length;
    out.group(
      {
        mark: groupMark(counts),
        summary: groupSummary(counts),
        title: groupTitle(group),
        titleWidth,
      },
      shown.map((check) => ({
        fix: check.fix,
        mark: markOf(check),
        text: check.text,
      })),
    );
  }
  const counts = countChecks(results.flatMap((result) => result.checks));
  if (print.json) {
    out.json(doctorReport(results));
  } else {
    const verdict = doctorVerdict(counts);
    out.blank();
    out.verdict(verdict.mark, verdict.text);
    if (folded > 0)
      out.say(`To see the ${folded} lines that passed too: ${COMMAND} doctor --verbose`);
  }
  return counts.fail === 0 ? 0 : 1;
}
