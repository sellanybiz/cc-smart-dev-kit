/**
 * The Windows twin of the launcher: `cc-smart-dev-kit.cmd`, written beside the `sh` launcher
 * in `%USERPROFILE%\.local\bin` (setup writes both; `restore` removes both).
 *
 * Why a twin at all: `cmd.exe` and PowerShell do not run a `sh` script, so a person on
 * Windows could not run `cc-smart-dev-kit setup` at all. Git Bash does run the `sh` one, and
 * keeps running it — both do the same thing, so a session in either shell gets the command
 * (`docs/windows-setup.md`).
 *
 * What a launcher must do, in both forms:
 *   - find bun: the path setup baked in (`process.execPath`), else the usual Windows install
 *     folders, else `bun.exe` on PATH (a hook's or a service's PATH can be short);
 *   - find the installed plugin folder from Claude Code's `installed_plugins.json` (the same
 *     lookup `findUserInstall()` does in TypeScript — change one, change the others);
 *   - run `dist/cli.js` with `--no-env-file` and the plugin's own empty config
 *     (`bun-config.ts`), hand it every argument, and return its exit code.
 *
 * The script is plain `cmd` on purpose (no PowerShell, no Git Bash): it must work in a bare
 * `cmd.exe` too. The plugin lookup prints the folder into a temporary file and `set /p` reads
 * it back: a `for /f` over a command whose program path holds spaces (`C:\Program Files\…`)
 * is the classic `cmd` quoting trap.
 */
import { join } from "node:path";
import { PLUGIN_ID } from "../build-info";
import { BUN_CONFIG_NAME } from "./bun-config";
import type { InstallLauncherOptions } from "./launcher";
import { type WriteOutcome, writeManagedFile } from "./write";

export const LAUNCHER_CMD_NAME = "cc-smart-dev-kit.cmd";

/**
 * Finds the user-scope install of the plugin in installed_plugins.json (the last argument)
 * and prints its installPath. **Single quotes only**: the whole one-liner is one
 * double-quoted `cmd` argument, so a `"` inside it would end that argument early. `=>` and
 * `>` are avoided for the same reason. Mirrors findUserInstall() in installed-plugins.ts and
 * FIND_INSTALL_JS in launcher.ts.
 */
const FIND_INSTALL_JS = [
  "const f=process.argv[process.argv.length-1];",
  "const j=JSON.parse(require('fs').readFileSync(f,'utf8'));",
  `const e=((j&&j.plugins&&j.plugins['${PLUGIN_ID}'])||[]).find(function(x){`,
  "return x&&x.scope==='user'&&typeof x.installPath==='string';});",
  "if(!e)process.exit(1);",
  "process.stdout.write(e.installPath);",
].join("");

/** The line setup bakes into the `.cmd`, and the reader below. `set "baked_bun=<path>"`. */
const BAKED_LINE = /^set "baked_bun=(.*)"$/m;

/**
 * The bun path baked into a `.cmd` launcher by launcherCmdScript(), or null when the script
 * has no such line (not ours, or from another version).
 */
export function cmdBakedBunPath(script: string): string | null {
  const match = BAKED_LINE.exec(script);
  // A Windows path cannot hold a `"`, so the last one on the line is the closing quote.
  return match?.[1]?.replace(/"$/, "") ?? null;
}

/**
 * A path as it goes into `set "baked_bun=…"`: the quotes around the whole assignment keep
 * spaces in the path, and a `"` inside would end it early (a Windows path cannot hold one).
 */
function cmdQuote(value: string): string {
  return value.replaceAll('"', "");
}

/**
 * The Windows launcher: a `cmd` script that runs the CLI of whichever plugin version Claude
 * Code has installed now. It stays valid across plugin updates, like the `sh` one.
 *
 * `bunPath` is the bun that ran setup (process.execPath) — on Windows the native path
 * (`C:\Users\…\bun.exe`), which is exactly what `cmd` wants.
 */
export function launcherCmdScript(bunPath: string): string {
  return `@echo off
rem cc-smart-dev-kit launcher for Windows, for cmd and PowerShell. Written by "cc-smart-dev-kit setup"; setup rewrites it, so do not edit it.
rem It runs the cc-smart-dev-kit command from the installed version of the cc-smart-dev-kit plugin.
rem Under Git Bash run the "cc-smart-dev-kit" file beside this one instead: Git Bash runs that one, not this.
setlocal
set "baked_bun=${cmdQuote(bunPath)}"
set "bun="
if exist "%baked_bun%" set "bun=%baked_bun%"
if not defined bun if exist "%USERPROFILE%\\.bun\\bin\\bun.exe" set "bun=%USERPROFILE%\\.bun\\bin\\bun.exe"
if not defined bun if defined BUN_INSTALL if exist "%BUN_INSTALL%\\bin\\bun.exe" set "bun=%BUN_INSTALL%\\bin\\bun.exe"
if not defined bun for %%I in (bun.exe) do set "bun=%%~$PATH:I"
if defined bun goto found_bun
echo cc-smart-dev-kit: bun not found (not at %baked_bun%, not on PATH). Install bun, then run: cc-smart-dev-kit setup 1>&2
exit /b 1
:found_bun
set "config_dir=%CLAUDE_CONFIG_DIR%"
if not defined config_dir set "config_dir=%USERPROFILE%\\.claude"
set "installed=%config_dir%\\plugins\\installed_plugins.json"
if not exist "%installed%" goto not_installed
set "answer_dir=%TEMP%"
if not defined answer_dir set "answer_dir=%config_dir%"
set "answer=%answer_dir%\\cc-smart-dev-kit-lookup-%RANDOM%%RANDOM%.txt"
"%bun%" -e "${FIND_INSTALL_JS}" -- "%installed%" > "%answer%" 2>nul
if not errorlevel 1 goto looked_up
if exist "%answer%" del "%answer%" >nul 2>&1
goto not_installed
:looked_up
set "install_path="
set /p install_path=<"%answer%"
del "%answer%" >nul 2>&1
if not defined install_path goto not_installed
if not exist "%install_path%\\dist\\cli.js" goto missing_folder
rem --no-env-file: "cc-smart-dev-kit job run" hands its job exactly the environment it was given.
rem --config: the plugin's own empty config, beside the CLI in the same version folder, so the
rem working folder's bunfig.toml (a project's preload) never runs inside the command. An
rem installed version older than that file (0.2.x, until migrate replaces it) has none: bun
rem refuses a config path that does not exist, so the flag is left out then.
set "config="
if exist "%install_path%\\${BUN_CONFIG_NAME}" set "config=--config="%install_path%\\${BUN_CONFIG_NAME}""
"%bun%" --no-env-file %config% "%install_path%\\dist\\cli.js" %*
exit /b %ERRORLEVEL%
:missing_folder
echo cc-smart-dev-kit: the cc-smart-dev-kit plugin folder is missing: %install_path%. Run: claude plugin install ${PLUGIN_ID} 1>&2
exit /b 1
:not_installed
echo cc-smart-dev-kit: the cc-smart-dev-kit plugin is not installed. Run: claude plugin install ${PLUGIN_ID} 1>&2
exit /b 1
`;
}

/**
 * How to run the `.cmd`: a `.cmd` is not an executable, so `Bun.spawn` cannot start one —
 * `cmd.exe` must (`docs/windows-setup.md`, and `docs/claude-code-contract.md` on the hook
 * side). Used by doctor, which runs the launcher it checks.
 */
export function launcherCmdArgv(cmdPath: string, args: string[]): string[] {
  return ["cmd.exe", "/c", cmdPath, ...args];
}

/** Writes `<binDir>/cc-smart-dev-kit.cmd`, with a backup when it changes. Windows only. */
export function installLauncherCmd(
  binDir: string,
  options: InstallLauncherOptions,
): { path: string; outcome: WriteOutcome } {
  const path = join(binDir, LAUNCHER_CMD_NAME);
  const { outcome } = writeManagedFile(path, launcherCmdScript(options.bunPath), {
    stateDir: options.stateDir,
    kind: "whole-file",
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
  });
  return { path, outcome };
}
