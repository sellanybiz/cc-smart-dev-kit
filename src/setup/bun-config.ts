/**
 * How the plugin starts bun inside a person's folder.
 *
 * Every run of one of the plugin's own bundles gets two flags: `--no-env-file` (bun would load
 * the working folder's `.env` files into it, and a command or hook must see the environment it
 * was given) and `--config=<the plugin's own empty config>` (bun would otherwise read the
 * working folder's `bunfig.toml`, and a project's `preload` would run its own code inside the
 * plugin). The config is a file the plugin ships, empty, in its own folder: not `/dev/null`,
 * which is a device path and not something the plugin owns.
 *
 * The flag pair is spelled in one place here and in one place per language that cannot import
 * it: `plugin/bin/cc-smart-dev-kit-bun.sh` and `plugin/bin/cc-smart-dev-kit` (hand-written sh),
 * and the two launcher scripts — `src/setup/launcher.ts` (hand-written sh) and
 * `src/setup/launcher-cmd.ts` (hand-written `cmd`) — which name the installed version's own
 * config, not known before those scripts run.
 */

import { basename, join } from "node:path";

/** The plugin's own Bun config, beside `dist/` and `bin/`: an empty file it ships. */
export const BUN_CONFIG_NAME = "bunfig.toml";

/** That config's path inside a plugin folder. */
export function bunConfigPath(pluginDir: string): string {
  return join(pluginDir, BUN_CONFIG_NAME);
}

/** `--config=<that config>`: the second of the two flags every plugin bun run gets. */
export function bunConfigArg(pluginDir: string): string {
  return `--config=${bunConfigPath(pluginDir)}`;
}

/**
 * The plugin's own folder beside the bundle or script that is running: `plugin/`, beside
 * `dist/`, or the repo's `plugin/` when the same code runs from source (a test, or
 * `bun src/entries/cli.ts`).
 */
export function pluginFolderBeside(importDir: string): string {
  return basename(importDir) === "dist"
    ? join(importDir, "..")
    : join(importDir, "..", "..", "plugin");
}
