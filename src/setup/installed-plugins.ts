import { existsSync, readFileSync } from "node:fs";
import { PLUGIN_ID } from "../build-info";

export interface PluginInstall {
  installPath: string;
  version: string | null;
}

/** One install of a plugin, of any scope, as `installed_plugins.json` records it. */
export interface PluginInstallRecord {
  installPath: string;
  /** The project folder a `project` or `local` install belongs to; null for a `user` one. */
  projectPath: null | string;
  /** `user`, `project` or `local` (Claude Code's own word). */
  scope: string;
}

/** The `plugins` object of Claude Code's `installed_plugins.json`; null when it cannot be read. */
function pluginsRecord(installedPluginsFile: string): Record<string, unknown> | null {
  if (!existsSync(installedPluginsFile)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(installedPluginsFile, "utf8"));
  } catch {
    return null;
  }
  const plugins = (parsed as { plugins?: unknown } | null)?.plugins;
  return typeof plugins === "object" && plugins !== null && !Array.isArray(plugins)
    ? (plugins as Record<string, unknown>)
    : null;
}

/**
 * The user-scope install of a plugin (by default cc-smart-dev-kit@cc-smart-dev-kit) from Claude Code's
 * `installed_plugins.json`,
 * or null when there is none. The launcher script repeats this lookup in plain JS
 * (it must work without this code) — keep the two in step.
 */
export function findUserInstall(
  installedPluginsFile: string,
  pluginId: string = PLUGIN_ID,
): PluginInstall | null {
  const entries = pluginsRecord(installedPluginsFile)?.[pluginId];
  if (!Array.isArray(entries)) return null;
  const entry = entries.find(
    (candidate): candidate is { installPath: string; version?: unknown } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { scope?: unknown }).scope === "user" &&
      typeof (candidate as { installPath?: unknown }).installPath === "string",
  );
  if (!entry) return null;
  return {
    installPath: entry.installPath,
    version: typeof entry.version === "string" ? entry.version : null,
  };
}

/**
 * Every install of the plugin named `pluginName`, from any marketplace (the ids
 * `<pluginName>@<marketplace>`) and of any scope, in the file's order; empty when there is none
 * or the file cannot be read. A Workflow named `<plugin>:<name>` names the plugin this way, with
 * no marketplace.
 */
export function installsOfPlugin(
  installedPluginsFile: string,
  pluginName: string,
): PluginInstallRecord[] {
  const plugins = pluginsRecord(installedPluginsFile);
  if (plugins === null) return [];
  const out: PluginInstallRecord[] = [];
  for (const [id, entries] of Object.entries(plugins)) {
    const at = id.lastIndexOf("@");
    if ((at === -1 ? id : id.slice(0, at)) !== pluginName || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const { installPath, projectPath, scope } = entry as Record<string, unknown>;
      if (typeof installPath !== "string" || typeof scope !== "string") continue;
      out.push({
        installPath,
        projectPath: typeof projectPath === "string" ? projectPath : null,
        scope,
      });
    }
  }
  return out;
}
