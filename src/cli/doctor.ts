import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MARKETPLACE,
  MARKETPLACE_ADD_COMMAND,
  PLUGIN,
  PLUGIN_ID,
  PLUGIN_INSTALL_COMMAND,
} from "../build-info";
import { findUserInstall } from "../setup/installed-plugins";
import { LAUNCHER_NAME, launcherScript } from "../setup/launcher";
import { canReadGitRemote, canReadHttp, marketplaceSource } from "../setup/marketplace-access";
import { type CliPaths, tildify } from "./paths";

interface Check {
  ok: boolean;
  text: string;
}

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

function checkLauncher(paths: CliPaths): Check {
  const launcher = join(paths.binDir, LAUNCHER_NAME);
  const where = tildify(launcher, paths.home);
  if (!existsSync(launcher))
    return { ok: false, text: `no launcher at ${where}. Run: cc-agentic setup` };
  try {
    accessSync(launcher, constants.X_OK);
  } catch {
    return { ok: false, text: `the launcher ${where} is not executable. Run: cc-agentic setup` };
  }
  if (readFileSync(launcher, "utf8") !== launcherScript(process.execPath)) {
    return { ok: false, text: `the launcher ${where} is out of date. Run: cc-agentic setup` };
  }
  const result = run([launcher, "version"]);
  if (!result.ok)
    return { ok: false, text: `the launcher ${where} does not run: ${result.output}` };
  return { ok: true, text: `the launcher ${where} runs ${result.output}` };
}

/**
 * Can this machine read the marketplace's source? Updates need it.
 * Works for any git host, public or private, and needs no gh.
 */
async function checkMarketplaceAccess(paths: CliPaths): Promise<Check> {
  const source = marketplaceSource(paths.knownMarketplacesFile, MARKETPLACE);
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
      const result = await canReadHttp(source.url);
      return result.ok
        ? { ok: true, text: `can read the marketplace at ${source.url}` }
        : { ok: false, text: `cannot read the marketplace at ${source.url}: ${result.detail}` };
    }
    case "git": {
      const failures: string[] = [];
      for (const url of source.urls) {
        const result = canReadGitRemote(url);
        if (result.ok) return { ok: true, text: `can read the marketplace at ${url}` };
        failures.push(`${url}: ${result.detail}`);
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
export async function runDoctor(paths: CliPaths): Promise<number> {
  const settings = readSettings(paths.settingsFile);
  const checks = [
    checkPlugin(paths),
    checkLauncher(paths),
    await checkMarketplaceAccess(paths),
    checkAutoUpdate(settings, paths),
    checkNameClash(settings),
  ];
  for (const check of checks) console.log(`${check.ok ? "✓" : "✗"} ${check.text}`);
  return checks.every((check) => check.ok) ? 0 : 1;
}
