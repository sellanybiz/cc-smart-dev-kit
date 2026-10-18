import { join } from "node:path";
import { PLUGIN_ID } from "../build-info";
import { type WriteOutcome, writeManagedFile } from "./write";

export const LAUNCHER_NAME = "cc-smart-dev-kit";

/**
 * The launcher as a hook's shell string finds it: by its path under `$HOME`, never the bare
 * name, because Claude Code's hook processes get the PATH Claude Code was started with, and
 * that may lack `~/.local/bin` (an IDE, a desktop launcher). The shell expands `$HOME`, and
 * the quotes keep a home folder with a space one word. It holds on Windows too, where the
 * shell is Git Bash and sets `$HOME` (`docs/windows-hooks.md`).
 */
export const LAUNCHER_IN_SHELL = `"$HOME/.local/bin/${LAUNCHER_NAME}"`;

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
export function shellQuote(value: string): string {
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
# cc-smart-dev-kit launcher. Written by "cc-smart-dev-kit setup"; setup rewrites it, so do not edit it.
# It runs the cc-smart-dev-kit command from the installed version of the cc-smart-dev-kit plugin.
fail() {
  echo "cc-smart-dev-kit: $1 Run: claude plugin install ${PLUGIN_ID}" >&2
  exit 1
}
baked_bun=${shellQuote(bunPath)}
if [ -x "$baked_bun" ]; then
  bun="$baked_bun"
elif command -v bun >/dev/null 2>&1; then
  bun=$(command -v bun)
else
  echo "cc-smart-dev-kit: bun not found (not at $baked_bun, not on PATH). Install bun, then run: cc-smart-dev-kit setup" >&2
  exit 1
fi
config_dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
installed="$config_dir/plugins/installed_plugins.json"
[ -f "$installed" ] || fail "the cc-smart-dev-kit plugin is not installed."
# The lookup runs in this launcher's own folder (never the person's working folder): bun reads
# the working folder's bunfig.toml, and a project's preload could print another path — this
# very path decides which CLI runs. The plugin's own empty config cannot be used here: it sits
# in the folder this lookup has yet to find.
launcher_dir=$HOME/.local/bin
case $0 in */*) launcher_dir=\${0%/*} ;; esac
install_path=$(cd "$launcher_dir" && "$bun" -e '${FIND_INSTALL_JS}' -- "$installed" 2>/dev/null) || fail "the cc-smart-dev-kit plugin is not installed."
[ -n "$install_path" ] || fail "the cc-smart-dev-kit plugin is not installed."
[ -f "$install_path/dist/cli.js" ] || fail "the cc-smart-dev-kit plugin folder is missing: $install_path."
# --no-env-file: "cc-smart-dev-kit job run" hands its job exactly the environment it was given.
# --config: the plugin's own empty config, beside the CLI in the same version folder, so the
# working folder's bunfig.toml (a project's preload) never runs inside the command. An
# installed version older than that file (0.2.x, until migrate replaces it) has none: bun
# refuses a config path that does not exist, so the flag is left out then.
set -- "$install_path/dist/cli.js" "$@"
if [ -f "$install_path/bunfig.toml" ]; then
  set -- "--config=$install_path/bunfig.toml" "$@"
fi
exec "$bun" --no-env-file "$@"
`;
}

export interface InstallLauncherOptions {
  stateDir: string;
  /** The bun the launcher should use first: the one running setup (process.execPath). */
  bunPath: string;
  dryRun?: boolean;
}

/** Writes `<binDir>/cc-smart-dev-kit` (mode 755), with a backup when it changes. */
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
