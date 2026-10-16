/**
 * Where the plugin's own files are while the portal runs.
 *
 * The portal runs from a copy in `~/.local/share/cc-smart-dev-kit/portal.js`, so a path made at
 * startup says nothing about the plugin: `import.meta.dir` in the copy resolves beside it, and
 * the parent's own folder is the version folder Claude Code deletes after an update.
 *
 * So every plugin file — `dist/router.js`, `instructions/`, `hooks/hooks.json` — is resolved
 * from the folder Claude Code records as the installed version, read fresh each time it is
 * needed, with the folder the parent passed (`--plugin-dir`) as the fallback while it still
 * exists. During a long run the installed version can change (an update) or go (an uninstall):
 * the resolution then says so in words, and the action that needed it stops.
 */

import { existsSync } from "node:fs";
import { findUserInstall } from "../setup/installed-plugins";

/** The plugin's own folder, or why there is none to use. */
export type PluginFolder = { folder: string } | { error: string };

/**
 * The plugin's folder as it is now: the version Claude Code records as installed, else `fallback`
 * (the folder the parent passed on `--plugin-dir`, or the one this bundle sits in) while that
 * exists. A record whose folder is gone — half an update — falls back too.
 */
export function resolvePluginFolder(
  installedPluginsFile: string,
  fallback: string | null,
): PluginFolder {
  const installed = findUserInstall(installedPluginsFile);
  if (installed !== null && existsSync(installed.installPath)) {
    return { folder: installed.installPath };
  }
  if (fallback !== null && existsSync(fallback)) return { folder: fallback };
  return {
    error:
      "the plugin's own folder is gone, and Claude Code records no installed version: an update or an uninstall removed it while this portal was running. Nothing can be restarted or checked from here. Stop the portal (Ctrl+C) and start it again.",
  };
}
