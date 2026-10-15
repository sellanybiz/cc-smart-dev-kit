import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
import { gatewayChecks } from "../gateway/doctor";
import type { Runner } from "../gateway/service";
import { findUserInstall } from "../setup/installed-plugins";
import {
  copyDifferences,
  copyInstalled,
  instructionsBlockBody,
  instructionsNeedRefresh,
  instructionsOptedOut,
  readVersionStamp,
} from "../setup/instructions";
import { bakedBunPath, LAUNCHER_NAME, launcherScript } from "../setup/launcher";
import {
  canReadGitRemote,
  canReadHttp,
  marketplaceInstallLocation,
  marketplaceSource,
  redactUrl,
} from "../setup/marketplace-access";
import { type CliPaths, tildify } from "./paths";
import { instructionsPaths } from "./setup";

interface Check {
  ok: boolean;
  /** Information only: printed with `·`, never a failure. */
  info?: boolean;
  text: string;
}

/** Claude Code variables that also stop plugin updates, unless FORCE_AUTOUPDATE_PLUGINS is set. */
export const UPDATE_BLOCKING_VARS = [
  "DISABLE_AUTOUPDATER",
  "DISABLE_UPDATES",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
] as const;
export const FORCE_PLUGIN_UPDATES_VAR = "FORCE_AUTOUPDATE_PLUGINS";

/** The marketplace command that refreshes Claude Code's local copy of the marketplace. */
const MARKETPLACE_UPDATE_COMMAND = `claude plugin marketplace update ${MARKETPLACE}`;

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

function checkPlugin(paths: CliPaths): Check {
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
 * The launcher is compared with the script for the bun baked into it, not with the bun
 * running doctor: another bun on PATH is no reason to rewrite it.
 */
function checkLauncher(paths: CliPaths): Check {
  const launcher = join(paths.binDir, LAUNCHER_NAME);
  const where = tildify(launcher, paths.home);
  if (!existsSync(launcher))
    return { ok: false, text: `no launcher at ${where}. Run: anymodel setup` };
  if (!isExecutable(launcher)) {
    return { ok: false, text: `the launcher ${where} is not executable. Run: anymodel setup` };
  }
  const script = readFileSync(launcher, "utf8");
  const bun = bakedBunPath(script);
  if (bun === null || script !== launcherScript(bun)) {
    return { ok: false, text: `the launcher ${where} is out of date. Run: anymodel setup` };
  }
  if (!isExecutable(bun)) {
    return {
      ok: false,
      text: `the launcher's bun ${tildify(bun, paths.home)} is missing or not executable. Run: anymodel setup`,
    };
  }
  const result = run([launcher, "version"]);
  if (!result.ok)
    return { ok: false, text: `the launcher ${where} does not run: ${result.output}` };
  return { ok: true, text: `the launcher ${where} runs ${result.output}` };
}

/**
 * Can this machine read the marketplace's source? Updates need it.
 * Works for any git host, public or private, and needs no gh. Every URL is printed
 * without its password, token or query string.
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
      for (const url of source.urls) {
        const result = canReadGitRemote(url, env);
        if (result.ok) return { ok: true, text: `can read the marketplace at ${redactUrl(url)}` };
        failures.push(`${redactUrl(url)}: ${result.detail}`);
      }
      return {
        ok: false,
        text:
          `cannot read the marketplace (${failures.join("; ")}). ` +
          "Check your git access: an SSH key, or a git credential helper.",
      };
    }
  }
}

/** The `version` in the plugin manifest of the marketplace's local copy, or null. */
function marketplaceVersion(manifest: string): string | null {
  try {
    const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown } | null)
      ?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Is the installed version behind the marketplace's local copy? Then auto-update did not
 * install it (Claude Code's `autoUpdate` may refresh only the catalog). Null when there is
 * nothing to compare: no install, or no marketplace (other checks report those).
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
  const manifest = join(location, "plugin", ".claude-plugin", "plugin.json");
  const latest = marketplaceVersion(manifest);
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
  if (order < 0) {
    return {
      ok: false,
      text: `installed ${installed ?? "(no version)"}, marketplace has ${latest}. Run: ${PLUGIN_UPDATE_COMMAND}`,
    };
  }
  return { ok: true, text: `the installed version ${installed} is not behind the marketplace` };
}

function checkAutoUpdate(settings: Record<string, unknown> | null, paths: CliPaths): Check {
  const marketplaces = settings?.extraKnownMarketplaces as
    | Record<string, { autoUpdate?: unknown }>
    | undefined;
  return marketplaces?.[MARKETPLACE]?.autoUpdate === true
    ? { ok: true, text: "plugin auto-update is on" }
    : {
        ok: false,
        text: `plugin auto-update is off in ${tildify(paths.settingsFile, paths.home)}. Run: anymodel setup`,
      };
}

/** True when a variable is set to something other than empty, 0, false, no or off. */
function isSet(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

/**
 * Updates must not be switched off: each of UPDATE_BLOCKING_VARS also stops plugin
 * updates, unless FORCE_AUTOUPDATE_PLUGINS is set too. Claude Code reads them from its
 * environment and from the `env` of settings.json, so doctor looks in both.
 */
function checkUpdatesNotOff(
  settings: Record<string, unknown> | null,
  env: Env,
  paths: CliPaths,
): Check {
  const settingsEnv = (settings?.env ?? {}) as Record<string, unknown>;
  const where = (name: string) =>
    [
      isSet(env[name]) ? "your environment" : null,
      isSet(settingsEnv[name]) ? `the env of ${tildify(paths.settingsFile, paths.home)}` : null,
    ].filter((place): place is string => place !== null);
  if (where(FORCE_PLUGIN_UPDATES_VAR).length > 0) {
    return { ok: true, text: `plugin updates are on (${FORCE_PLUGIN_UPDATES_VAR} is set)` };
  }
  const blocking = UPDATE_BLOCKING_VARS.filter((name) => where(name).length > 0);
  if (blocking.length === 0) return { ok: true, text: "plugin updates are not switched off" };
  const named = blocking.map((name) => `${name} (in ${where(name).join(" and ")})`).join(", ");
  return {
    ok: false,
    text:
      `plugin updates are switched off: ${named} ${blocking.length === 1 ? "is" : "are"} set. ` +
      `Set ${FORCE_PLUGIN_UPDATES_VAR}=1 as well, or remove ${blocking.join(" and ")}.`,
  };
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
 * The instructions: installed, this plugin version's, and imported by the anymodel block. The
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
      text: "instructions: left out (anymodel setup --no-instructions). To add them: anymodel setup --instructions",
    };
  }
  if (!copyInstalled(where)) {
    return {
      ok: false,
      text: `the instructions are not installed in ${copy}. Run: anymodel setup`,
    };
  }
  const why = copyDifferences(where);
  if (instructionsNeedRefresh(where, VERSION)) {
    why.unshift(`written by ${readVersionStamp(paths.stateDir) ?? "an unknown version"}`);
  }
  if (why.length > 0) {
    return {
      ok: false,
      text: `the instructions copy ${copy} is not this plugin version's (${why.join("; ")}). Run: anymodel setup`,
    };
  }
  const text = existsSync(where.claudeMd) ? readFileSync(where.claudeMd, "utf8") : "";
  if (!text.includes(instructionsBlockBody(where.importPath))) {
    return {
      ok: false,
      text: `${claudeMd} does not import the instructions (its anymodel block is missing or changed). Run: anymodel setup`,
    };
  }
  return {
    ok: true,
    text: `the instructions copy ${copy} is this version's, and ${claudeMd} imports it`,
  };
}

/** The memory files Claude Code loads from a project folder. */
const PROJECT_MEMORY_FILES = ["CLAUDE.md", join(".claude", "CLAUDE.md"), "CLAUDE.local.md"];

/**
 * The `@~/…` or `@/…` imports of a CLAUDE.md that point into an anymodel instructions copy
 * (a path with `/anymodel/instructions/` in it), outside code. Claude Code does not read an
 * import inside a code span or a fenced block, so neither does this.
 */
export function anymodelImports(text: string): string[] {
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
      if (path.includes("/anymodel/instructions/")) found.push(path);
    }
  }
  return found;
}

/**
 * The project's CLAUDE.md imports an anymodel file that is missing: it loads nothing, with
 * no error from Claude Code. Claude Code reads the memory files of the current folder and
 * every folder above it, so doctor looks in the same places. No line when none of them
 * imports an anymodel file. A missing file is `·` information when the person chose
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
      for (const path of anymodelImports(text)) {
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
      text: `${list}, which is missing: it loads nothing while the instructions are left out here. To add them: anymodel setup --instructions`,
    };
  }
  return {
    ok: false,
    text: `${list}, which is missing: it loads nothing. Run: anymodel setup`,
  };
}

/** Where doctor finds the plugin's instructions, and the folder it was started in. */
export interface DoctorLocal {
  /** The plugin's `instructions` folder, beside `dist/`. */
  instructionsSource: string;
  /** The current folder: its CLAUDE.md files (and those above it) are checked for imports. */
  cwd: string;
}

/** What the gateway checks need: the plugin's router bundle, a command runner, systemd or not. */
export interface DoctorGateway {
  bundle: string;
  runner: Runner;
  systemd: boolean;
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
    ? { ok: true, text: `Bun ${bun.version} at ${where} (anymodel needs ≥ ${MIN_BUN})` }
    : { ok: false, text: `${tooOld} Upgrade this Bun, then run: ${COMMAND} doctor` };
}

/**
 * Prints one ✓ or ✗ line per check, and `·` for information (the gateway, when it was never
 * set up, is optional). Exit code 1 when any check fails.
 *
 * On a Bun older than `MIN_BUN` the gateway checks are skipped: they send the backend key,
 * and that Bun would send it through a proxy from the environment.
 */
export async function runDoctor(
  paths: CliPaths,
  env: Env,
  gateway: DoctorGateway,
  local: DoctorLocal,
  bun: DoctorBun,
): Promise<number> {
  const settings = readSettings(paths.settingsFile);
  const runtime = checkBun(bun, paths);
  const skipped: Check = {
    ok: true,
    info: true,
    text: "gateway: not checked on this Bun (its checks send the backend key)",
  };
  const checks = [
    runtime,
    checkPlugin(paths),
    checkInstalledVersion(paths),
    checkLauncher(paths),
    checkInstructions(paths, local.instructionsSource),
    checkProjectImports(paths, local.cwd),
    await checkMarketplaceAccess(paths, env),
    checkAutoUpdate(settings, paths),
    checkUpdatesNotOff(settings, env, paths),
    checkNameClash(settings),
    checkOldPlugin(settings, paths),
    ...(runtime.ok ? await gatewayChecks({ paths, ...gateway }) : [skipped]),
  ].filter((check): check is Check => check !== null);
  for (const check of checks) {
    console.log(`${check.info ? "·" : check.ok ? "✓" : "✗"} ${check.text}`);
  }
  return checks.every((check) => check.ok) ? 0 : 1;
}
