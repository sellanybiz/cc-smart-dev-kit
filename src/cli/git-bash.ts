/**
 * Git Bash on Windows: where it is, and whether the plugin can find it.
 *
 * On Windows the Bash tool and every shell-form hook run through **Git Bash** (Claude Code
 * passes the command to `bash`), and without Git for Windows Claude Code falls back to
 * PowerShell and a hook that needs bash errors visibly instead of running. The plugin's own
 * hooks are shell-form `.sh` commands on purpose, so Git Bash is what makes the guards work
 * there (`docs/claude-code-contract.md`). This module is the one place that answers "where is
 * it", so doctor tells the person the same thing Claude Code itself would find.
 *
 * The order and the rules are Claude Code's own (`docs/windows-setup.md`, and the Claude Code
 * docs on `CLAUDE_CODE_GIT_BASH_PATH`):
 *
 *   1. `CLAUDE_CODE_GIT_BASH_PATH` — but only when the file's name is `bash.exe`, `sh.exe`,
 *      `bash` or `sh` **and** the file is there. Anything else is ignored, with a warning,
 *      and the search goes on.
 *   2. `C:\Program Files\Git\bin\bash.exe`
 *   3. `C:\Program Files (x86)\Git\bin\bash.exe`
 *   4. beside the `git` on PATH: `<git folder>\..\bin\bash.exe` (the installer's layout)
 *
 * Every lookup takes its file checks as values, so a Linux or macOS test drives it with a
 * fake file system and the Windows rules are still exercised.
 */
import { win32 } from "node:path";

/** Claude Code's own override for where Git Bash is. Read, never written, by this plugin. */
export const GIT_BASH_VAR = "CLAUDE_CODE_GIT_BASH_PATH";

/** The names Claude Code accepts in `CLAUDE_CODE_GIT_BASH_PATH`. */
const ACCEPTED_NAMES = ["bash.exe", "sh.exe", "bash", "sh"];

/** Where Git for Windows puts Git Bash, in Claude Code's own order. */
export const GIT_BASH_INSTALLS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
] as const;

/** The file checks the search needs: a path that is there, and a command on PATH. */
export interface GitBashFacts {
  exists: (path: string) => boolean;
  which: (command: string) => null | string;
}

export interface GitBashLookup {
  /** `CLAUDE_CODE_GIT_BASH_PATH` was set to something Claude Code will ignore. */
  ignoredVariable: null | string;
  /** Git Bash's file, or null when it was not found anywhere. */
  path: null | string;
}

/** The last part of a Windows path (`C:\x\bash.exe` -> `bash.exe`). */
function baseName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part !== "") ?? path;
}

/** Is this what `CLAUDE_CODE_GIT_BASH_PATH` may hold: an accepted name, and the file is there. */
function variableIsUsable(value: string, facts: GitBashFacts): boolean {
  return ACCEPTED_NAMES.includes(baseName(value)) && facts.exists(value);
}

/** Where Git Bash is on this machine, and whether the override variable is being ignored. */
export function findGitBash(
  env: Record<string, string | undefined>,
  facts: GitBashFacts,
): GitBashLookup {
  const given = env[GIT_BASH_VAR] ?? "";
  if (given !== "" && variableIsUsable(given, facts)) {
    return { ignoredVariable: null, path: given };
  }
  const ignoredVariable = given === "" ? null : given;
  for (const install of GIT_BASH_INSTALLS) {
    if (facts.exists(install)) return { ignoredVariable, path: install };
  }
  const git = facts.which("git");
  if (git !== null) {
    // `C:\Program Files\Git\cmd\git.exe` -> `C:\Program Files\Git\bin\bash.exe`.
    const beside = win32.join(win32.dirname(git), "..", "bin", "bash.exe");
    if (facts.exists(beside)) return { ignoredVariable, path: beside };
  }
  return { ignoredVariable, path: null };
}

/** What doctor prints for one check: the shape `Check` in `doctor.ts` (`info`/`warn` optional). */
export interface GitBashCheck {
  ok: boolean;
  info?: boolean;
  text: string;
  warn?: boolean;
}

/**
 * doctor's Git Bash line: nothing at all off Windows, `✓` where it is found, `!` where the
 * override variable is being ignored, and `✗` with what to install where there is none.
 */
export function checkGitBash(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  facts: GitBashFacts,
): GitBashCheck | null {
  if (platform !== "win32") return null;
  const { ignoredVariable, path } = findGitBash(env, facts);
  const ignored =
    ignoredVariable === null
      ? null
      : `${GIT_BASH_VAR} is set to ${ignoredVariable}, which Claude Code ignores (it must name bash.exe, sh.exe, bash or sh, and the file must exist)`;
  if (path !== null) {
    return ignored === null
      ? { ok: true, text: `Git Bash is at ${path}, which the hooks and the Bash tool run through` }
      : {
          ok: true,
          warn: true,
          text: `Git Bash is at ${path}, which the hooks and the Bash tool run through — but ${ignored}. Remove it or point it at bash.exe.`,
        };
  }
  const found = ignored === null ? "" : ` (${ignored})`;
  return {
    ok: false,
    text:
      `Git Bash was not found${found}, and on Windows the plugin's hooks run through it: without it Claude Code uses PowerShell and a hook that needs bash errors instead of running. ` +
      "Install Git for Windows (https://git-scm.com/download/win), or set CLAUDE_CODE_GIT_BASH_PATH to bash.exe, then run: cc-smart-dev-kit doctor",
  };
}
