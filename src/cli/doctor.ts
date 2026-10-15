import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MARKETPLACE,
  MARKETPLACE_ADD_COMMAND,
  PLUGIN,
  PLUGIN_ID,
  PLUGIN_INSTALL_COMMAND,
  PLUGIN_UPDATE_COMMAND,
} from "../build-info";
import { findUserInstall } from "../setup/installed-plugins";
import { bakedBunPath, LAUNCHER_NAME, launcherScript } from "../setup/launcher";
import {
  canReadGitRemote,
  canReadHttp,
  marketplaceInstallLocation,
  marketplaceSource,
  redactUrl,
} from "../setup/marketplace-access";
import { type CliPaths, tildify } from "./paths";

interface Check {
  ok: boolean;
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
    return { ok: false, text: `no launcher at ${where}. Run: cc-agentic setup` };
  if (!isExecutable(launcher)) {
    return { ok: false, text: `the launcher ${where} is not executable. Run: cc-agentic setup` };
  }
  const script = readFileSync(launcher, "utf8");
  const bun = bakedBunPath(script);
  if (bun === null || script !== launcherScript(bun)) {
    return { ok: false, text: `the launcher ${where} is out of date. Run: cc-agentic setup` };
  }
  if (!isExecutable(bun)) {
    return {
      ok: false,
      text: `the launcher's bun ${tildify(bun, paths.home)} is missing or not executable. Run: cc-agentic setup`,
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
        text: `plugin auto-update is off in ${tildify(paths.settingsFile, paths.home)}. Run: cc-agentic setup`,
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

/** Prints one ✓ or ✗ line per check. Exit code 1 when any check fails. */
export async function runDoctor(paths: CliPaths, env: Env = process.env): Promise<number> {
  const settings = readSettings(paths.settingsFile);
  const checks = [
    checkPlugin(paths),
    checkInstalledVersion(paths),
    checkLauncher(paths),
    await checkMarketplaceAccess(paths, env),
    checkAutoUpdate(settings, paths),
    checkUpdatesNotOff(settings, env, paths),
    checkNameClash(settings),
  ].filter((check): check is Check => check !== null);
  for (const check of checks) console.log(`${check.ok ? "✓" : "✗"} ${check.text}`);
  return checks.every((check) => check.ok) ? 0 : 1;
}
