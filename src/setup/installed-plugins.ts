import { existsSync, readFileSync } from "node:fs";
import { PLUGIN_ID } from "../build-info";

export interface PluginInstall {
  installPath: string;
  version: string | null;
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
  if (!existsSync(installedPluginsFile)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(installedPluginsFile, "utf8"));
  } catch {
    return null;
  }
  const plugins = (parsed as { plugins?: Record<string, unknown> } | null)?.plugins;
  const entries = plugins?.[pluginId];
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
