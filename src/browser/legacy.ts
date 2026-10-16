/**
 * What version 0.3.0's shared browser left on a machine — and the lines `doctor` and `setup`
 * answer with. Nothing here deletes, moves or changes anything.
 *
 * WHAT 0.3.0 KEPT
 *   0.3.0 drove ONE Chrome of its own, started detached on the profile folder
 *   `<dataDir>/playwright` with `--remote-debugging-port=0`, and wrote its init page
 *   `<dataDir>/playwright-picker.js` beside it. 0.4.0 uses the person's own Chrome
 *   (`docs/design.md` § The browser) and reads neither. Two consequences outlive the upgrade:
 *   - the profile folder may hold signed-in cookies, and the plugin does not delete a person's
 *     browser data by itself (owner, 2026-10-16), so it is left on disk for them to remove;
 *   - a Chrome that 0.3.0 started runs DETACHED: it outlives the session that started it, and
 *     its debug port talks over 127.0.0.1 with no authentication, so any program on this
 *     machine can drive that signed-in browser until it is closed.
 *
 * WHERE THE CHECK RUNS
 *   Only on a machine that carries a trace of 0.3.0's browser: the profile folder, or the picker
 *   file. With neither, 0.3.0's browser never ran here, there is no old Chrome to look for, and
 *   the process list is not read at all — so a test's world, and a machine that never ran 0.3.0,
 *   never touch the host. The picker alone still counts: 0.3.0's launcher wrote it before it
 *   started Chrome, and a Chrome keeps running when its profile folder is deleted by hand.
 *
 * DETECTION IS READ ONLY, PER PLATFORM, AND NO `wmic` (deprecated)
 *   Linux reads `/proc/<pid>/cmdline`; macOS asks `ps -ww -axo pid=,command=`; Windows asks a
 *   read-only PowerShell `Get-CimInstance Win32_Process` for `ProcessId` and `CommandLine`. The
 *   `-ww` is deliberate: with output that is not a terminal `ps` leaves the width undefined, and
 *   a Chrome's command line is well over a thousand characters (0.3.0's own `chromeCommandLineOn`
 *   measured the same). A listing that cannot be read says the answer is unknown — NEVER "none".
 *
 * ONE PID, NOT A DOZEN
 *   Chrome gives every child process (renderer, gpu, utility) the same `--user-data-dir` and a
 *   `--type=` switch; the browser process itself has no `--type=`, and it ends its children when
 *   it is closed, so that is the pid these lines name.
 *
 * THE PICKER IS NAMED, IN THE PROFILE'S OWN LINE
 *   `<dataDir>/playwright-picker.js` is harmless by itself, so it could be left silent. It is
 *   named anyway, in the same line and the same command as the profile: one line and one paste
 *   remove everything 0.3.0's browser left, and a person who removes the folder and not the file
 *   would otherwise have to be told again later.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CliPaths, tildify } from "../cli/paths";
import type { Runner } from "../gateway/service";

/** The shared profile folder 0.3.0 kept under the data folder: `<dataDir>/playwright`. */
const LEGACY_PROFILE_NAME = "playwright";
/** The init page 0.3.0 wrote beside it: `<dataDir>/playwright-picker.js`. */
const LEGACY_PICKER_NAME = "playwright-picker.js";

/** Where 0.3.0 kept the shared profile and its init page, under the data folder. */
export function legacyBrowserPaths(paths: Pick<CliPaths, "dataDir">): {
  /** `<dataDir>/playwright-picker.js` — harmless, and removable with the profile. */
  picker: string;
  /** `<dataDir>/playwright` — the Chrome profile, which may hold signed-in cookies. */
  profile: string;
} {
  return {
    picker: join(paths.dataDir, LEGACY_PICKER_NAME),
    profile: join(paths.dataDir, LEGACY_PROFILE_NAME),
  };
}

/** One running process: its pid and its whole command line (empty when it has none). */
export interface ProcessCommandLine {
  command: string;
  pid: number;
}

/** Lists the running processes' command lines — `null` when they cannot be listed. */
export type ProcessReader = () => null | ProcessCommandLine[];

/** What the legacy check asks of the machine. `platform` is required; the rest default. */
export interface LegacyBrowserDeps {
  /** True when a path exists. */
  exists?: (path: string) => boolean;
  /** The platform whose process listing applies. */
  platform: NodeJS.Platform;
  /** The running processes' command lines. Default: the real listing for `platform`. */
  processes?: ProcessReader;
  /** Runs a command and captures its output: macOS's `ps`, Windows' PowerShell. */
  run?: Runner;
}

/** One fact about what 0.3.0 left: the words both `doctor` and `setup` print. */
export interface LegacyBrowserFact {
  /** `warn`: it is still there. `info`: whether it is still there could not be read. */
  kind: "info" | "warn";
  text: string;
}

/**
 * The pid and command line of every running process: Linux's `/proc/<pid>/cmdline`, macOS's
 * `ps -ww -axo pid=,command=`, Windows' read-only `Get-CimInstance Win32_Process` query. `null`
 * on a platform whose processes this plugin cannot list, and when the listing fails — which the
 * callers report as "could not check", never as "none".
 */
export function processCommandLines(
  platform: NodeJS.Platform,
  run?: Runner,
): null | ProcessCommandLine[] {
  if (platform === "linux") return linuxProcessCommandLines();
  if (platform === "darwin") {
    return run === undefined ? null : parsedLines(run(["ps", "-ww", "-axo", "pid=,command="]));
  }
  if (platform === "win32") {
    return run === undefined
      ? null
      : parsedLines(run(["powershell", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_LIST]));
  }
  return null;
}

/**
 * The listing's own shape, which `ps` and the PowerShell query both print: `<pid><space><the
 * whole command line>`, one a line. A pid without a command line (a system process) is skipped,
 * and a non-zero exit is `null` — the answer is unknown, never an empty list.
 */
function parsedLines(result: { exitCode: number; output: string }): null | ProcessCommandLine[] {
  if (result.exitCode !== 0) return null;
  const processes: ProcessCommandLine[] = [];
  for (const line of result.output.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "") continue;
    const space = text.indexOf(" ");
    if (space === -1) continue;
    const pid = Number(text.slice(0, space));
    const command = text.slice(space + 1).trim();
    if (Number.isInteger(pid) && pid > 0 && command !== "") processes.push({ command, pid });
  }
  return processes;
}

/** Prints `<pid><space><command line>` for every running process, in UTF-8. Read only. */
const WINDOWS_LIST =
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
  "Get-CimInstance Win32_Process | Where-Object CommandLine | " +
  'ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }';

/**
 * The same shape, from `/proc` (Linux): each process's command line is its arguments joined by
 * NUL bytes. `null` when `/proc` itself cannot be listed. A pid whose file cannot be read is
 * skipped: it ended, or it is not this user's to read.
 */
function linuxProcessCommandLines(): null | ProcessCommandLine[] {
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return null;
  }
  const processes: ProcessCommandLine[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const args = readFileSync(join("/proc", name, "cmdline"))
        .toString("utf8")
        .split("\0")
        .filter((arg) => arg !== "");
      if (args.length > 0) processes.push({ command: args.join(" "), pid: Number(name) });
    } catch {
      // The process ended between the listing and this read.
    }
  }
  return processes;
}

/** The switch 0.3.0 started its Chrome with. */
const USER_DATA_DIR = "--user-data-dir=";

/**
 * Does this command line name the legacy profile as its `--user-data-dir`? Chrome may quote the
 * value when the home folder has a space in it, so the quotes come off first; the value has to
 * END there — a folder whose name begins with the same text (`playwright-output`) and a folder
 * BELOW it are both another folder.
 */
function namesLegacyProfile(command: string, profile: string): boolean {
  const plain = command.replace(/["']/g, "");
  const wanted = `${USER_DATA_DIR}${profile}`;
  for (let at = plain.indexOf(wanted); at !== -1; at = plain.indexOf(wanted, at + 1)) {
    const after = plain[at + wanted.length];
    if (after === undefined || after === " ") return true;
  }
  return false;
}

/** How this platform's shell removes files: one exact command, for the paths given. */
function removeCommand(paths: string[], platform: NodeJS.Platform): string {
  return platform === "win32"
    ? `Remove-Item -Recurse -Force ${paths.map((path) => `'${path}'`).join(",")}`
    : `rm -rf ${paths.join(" ")}`;
}

/** How this platform ends a process that has no window to close (0.3.0 could run headless). */
function killCommand(pid: number, platform: NodeJS.Platform): string {
  return platform === "win32" ? `taskkill /PID ${String(pid)} /F` : `kill ${String(pid)}`;
}

/**
 * The line for the profile folder — and the picker beside it, when that is there too. Both
 * commands name the paths as the platform's shell takes them: `rm -rf ~/…` on macOS and Linux,
 * PowerShell's `Remove-Item` with the full path on Windows (`~` means nothing there, and
 * `tildify` leaves a Windows path alone for the same reason).
 */
function leftoverLine(
  profile: string,
  picker: null | string,
  platform: NodeJS.Platform,
  home: string,
): string {
  const shown = (path: string) => tildify(path, home);
  const andPicker =
    picker === null ? "" : `, and its file picker is at ${shown(picker)} (harmless on its own)`;
  const it = picker === null ? "it" : "them";
  return (
    `the 0.3.0 shared browser's profile is still at ${shown(profile)} and may hold sign-ins${andPicker}. ` +
    `Nothing reads ${it} now. Delete ${it} yourself when you no longer need the sign-ins: ` +
    removeCommand(
      (picker === null ? [profile] : [profile, picker]).map((path) => shown(path)),
      platform,
    )
  );
}

/** The line for the Chrome that 0.3.0 started and that is still running. */
function runningLine(
  first: number,
  others: number[],
  profile: string,
  platform: NodeJS.Platform,
  home: string,
): string {
  const pids = [first, ...others];
  const named = pids.map((pid) => String(pid)).join(", ");
  return (
    `the 0.3.0 shared Chrome is still running (pid${pids.length === 1 ? "" : "s"} ${named}, ` +
    `--user-data-dir=${tildify(profile, home)}). Its debug port has no password, so any program ` +
    `on this machine can drive that signed-in browser: close it (every window; a headless one ` +
    `has none), or run: ${killCommand(first, platform)}`
  );
}

/** The line for a process listing that could not be read: the answer is unknown, never "none". */
function unknownLine(profile: string, home: string): string {
  return (
    `cannot read this machine's process list, so whether the 0.3.0 shared Chrome is still running ` +
    `with --user-data-dir=${tildify(profile, home)} is unknown: if that Chrome is open, close it`
  );
}

/**
 * What 0.3.0 left on this machine, in the words `doctor` prints (`!` for a warning, `·` when the
 * answer could not be read) and `cc-smart-dev-kit setup` prints as information. Nothing when
 * 0.3.0's browser never ran here — and then no process is listed.
 */
export function legacyBrowserFacts(
  paths: Pick<CliPaths, "dataDir" | "home">,
  deps: LegacyBrowserDeps,
): LegacyBrowserFact[] {
  const exists = deps.exists ?? existsSync;
  const { picker, profile } = legacyBrowserPaths(paths);
  const profileThere = exists(profile);
  const pickerThere = exists(picker);
  if (!profileThere && !pickerThere) return [];
  const facts: LegacyBrowserFact[] = [];
  if (profileThere) {
    facts.push({
      kind: "warn",
      text: leftoverLine(profile, pickerThere ? picker : null, deps.platform, paths.home),
    });
  }
  const listing = (deps.processes ?? (() => processCommandLines(deps.platform, deps.run)))();
  if (listing === null) {
    facts.push({ kind: "info", text: unknownLine(profile, paths.home) });
    return facts;
  }
  const pids = listing
    .filter((process) => !process.command.includes("--type="))
    .filter((process) => namesLegacyProfile(process.command, profile))
    .map((process) => process.pid);
  const [first, ...others] = pids;
  if (first !== undefined) {
    facts.push({
      kind: "warn",
      text: runningLine(first, others, profile, deps.platform, paths.home),
    });
  }
  return facts;
}
