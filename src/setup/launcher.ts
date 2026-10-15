import { join } from "node:path";
import { PLUGIN_ID } from "../build-info";
import { type WriteOutcome, writeManagedFile } from "./write";

export const LAUNCHER_NAME = "anymodel";

/**
 * Finds the user-scope install of the plugin in installed_plugins.json (the last argument)
 * and prints its installPath. Plain JS in double quotes only: it sits inside sh single quotes.
 * Mirrors findUserInstall() in installed-plugins.ts.
 */
const FIND_INSTALL_JS = [
  "const f=process.argv[process.argv.length-1];",
  'const j=JSON.parse(require("fs").readFileSync(f,"utf8"));',
  `const e=((j&&j.plugins&&j.plugins["${PLUGIN_ID}"])||[]).find(x=>x&&x.scope==="user"&&typeof x.installPath==="string");`,
  "if(!e)process.exit(1);",
  "process.stdout.write(e.installPath);",
].join("");

/** Quotes a value for sh: single quotes, with each ' written as '\''. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The bun path baked into a launcher script by launcherScript(), or null when the script
 * has no such line (not ours, or from another version). The reverse of shellQuote.
 */
export function bakedBunPath(script: string): string | null {
  const match = /^baked_bun=('(?:[^']|'\\'')*')$/m.exec(script);
  if (!match?.[1]) return null;
  return match[1].slice(1, -1).replaceAll("'\\''", "'");
}

/**
 * The stable launcher: a POSIX sh script that runs the CLI of whichever plugin version
 * Claude Code has installed now. It stays valid across plugin updates.
 *
 * `bunPath` is the bun that ran setup (process.execPath). The script uses it first, so it
 * also works where PATH has no bun (systemd units, cron); then bun from PATH.
 */
export function launcherScript(bunPath: string): string {
  return `#!/bin/sh
# anymodel launcher. Written by "anymodel setup"; setup rewrites it, so do not edit it.
# It runs the anymodel command from the installed version of the anymodel plugin.
fail() {
  echo "anymodel: $1 Run: claude plugin install ${PLUGIN_ID}" >&2
  exit 1
}
baked_bun=${shellQuote(bunPath)}
if [ -x "$baked_bun" ]; then
  bun="$baked_bun"
elif command -v bun >/dev/null 2>&1; then
  bun=$(command -v bun)
else
  echo "anymodel: bun not found (not at $baked_bun, not on PATH). Install bun, then run: anymodel setup" >&2
  exit 1
fi
config_dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
installed="$config_dir/plugins/installed_plugins.json"
[ -f "$installed" ] || fail "the anymodel plugin is not installed."
install_path=$("$bun" -e '${FIND_INSTALL_JS}' -- "$installed" 2>/dev/null) || fail "the anymodel plugin is not installed."
[ -n "$install_path" ] || fail "the anymodel plugin is not installed."
[ -f "$install_path/dist/cli.js" ] || fail "the anymodel plugin folder is missing: $install_path."
# --no-env-file: "anymodel job run" hands its job exactly the environment it was given.
exec "$bun" --no-env-file "$install_path/dist/cli.js" "$@"
`;
}

export interface InstallLauncherOptions {
  stateDir: string;
  /** The bun the launcher should use first: the one running setup (process.execPath). */
  bunPath: string;
  dryRun?: boolean;
}

/** Writes `<binDir>/anymodel` (mode 755), with a backup when it changes. */
export function installLauncher(
  binDir: string,
  options: InstallLauncherOptions,
): { path: string; outcome: WriteOutcome } {
  const path = join(binDir, LAUNCHER_NAME);
  const { outcome } = writeManagedFile(path, launcherScript(options.bunPath), {
    stateDir: options.stateDir,
    kind: "whole-file",
    mode: 0o755,
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
  });
  return { path, outcome };
}
