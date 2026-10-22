/**
 * The person's Chrome, started by the plugin when the first browser call finds none running.
 *
 * WHY THIS EXISTS
 *   Extension mode opens the connect page by handing its URL to Chrome — and when Chrome is not
 *   running, `@playwright/mcp` starts it itself (`cdpRelay.ts`, `_openConnectPageInBrowser`):
 *   detached, with `stdio: "ignore"`, and with no check of whether it came up. A session started by
 *   the Claude daemon has no `DISPLAY` (measured 2026-10-23: `XDG_SESSION_TYPE=tty`), so Chrome
 *   died in under a second, its words went into the ignored pipe, and the MCP waited its full
 *   30-second deadline — a restart left the browser broken until a person opened Chrome by hand.
 *   So the launcher starts Chrome ITSELF, before the MCP, and waits for Chrome's own singleton
 *   lock. When that cannot work it fails at once with one line naming the one step.
 *
 * WHAT A STARTED CHROME NEEDS
 *   A display. `desktopEnvironment` answers with the variables a program needs to open a window:
 *   this session's own when it has them; otherwise (Linux) the ones the person's graphical session
 *   imported into the systemd user manager (`systemctl --user show-environment`), which a
 *   background session does not inherit but a started Chrome can use. Nothing is guessed: no
 *   display anywhere is a plain refusal, never a start that dies unseen.
 *
 * WHAT IT NEVER DOES
 *   It reads no Chrome file and writes none (`.claude/rules/browser.md`): it only asks Chrome's own
 *   `SingletonLock`/`lockfile` question (`chromeMayBeRunning`) whether a Chrome is up. The profile
 *   is the person's own, and the launched Chrome is the executable `chrome.ts` already found.
 *
 * NOTHING HERE READS THE ENVIRONMENT
 *   The environment is an argument, and the system call is a dep, so a test never sees the
 *   machine's own display (`.claude/rules/browser.md`).
 */

import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import { type ChromeDeps, chromeMayBeRunning } from "./chrome";

/**
 * How long a started Chrome gets to take its singleton lock. Chrome's own second-instance handoff
 * waits on that lock, so a Chrome that has it can receive the connect page. A cold Chrome after a
 * restart normally takes a second or two; this is the ceiling, and a Chrome past it is one line.
 */
export const CHROME_START_LIMIT_MS = 15_000;

/** How often the readiness question is asked while that limit runs: a readiness gate, not a retry. */
const CHROME_READY_POLL_MS = 200;

/**
 * How long the desktop lookup may take. `systemctl --user show-environment` answers in
 * milliseconds; a wedged user manager must become "no display" (one line), never a silent wait.
 */
export const DESKTOP_LOOKUP_LIMIT_MS = 5_000;

/**
 * The variables a program needs to open a window on the person's desktop, and nothing else: a
 * full user-manager environment merged into a child would be a second, stale environment.
 */
const DESKTOP_VARIABLES = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;

/** Where a desktop's variables came from. */
export interface DesktopEnvironment {
  /** False when nothing this machine can reach opens a window for this session. */
  display: boolean;
  /** The variables, ready to merge over the child's own environment (empty keys left out). */
  vars: Record<string, string>;
  /**
   * `session`: this process's own display variables; `user-manager`: the person's graphical
   * session's; `platform`: none are needed (macOS, Windows); `none`: no display anywhere.
   */
  source: "session" | "user-manager" | "platform" | "none";
}

/** A command's exit code and combined output, as `Machine.run` answers. */
type RunCommand = (argv: string[]) => { exitCode: number; output: string };

/**
 * The desktop lookup's own command: the same shape as `Machine.run`, with its own short ceiling,
 * because the launcher runs it before it starts anything and a person is waiting for a line.
 */
export function runDesktopLookup(
  argv: string[],
  env: Record<string, string | undefined>,
  limitMs: number = DESKTOP_LOOKUP_LIMIT_MS,
): { exitCode: number; output: string } {
  try {
    const result = Bun.spawnSync(argv, {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: limitMs,
    });
    return {
      // A command killed at the limit has no exit code: it answered nothing, which is no display.
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  } catch (error) {
    return { exitCode: 127, output: error instanceof Error ? error.message : String(error) };
  }
}

/** `KEY=VALUE` lines from `systemctl --user show-environment`. */
function parseEnvironment(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) vars[line.slice(0, at)] = line.slice(at + 1);
  }
  return vars;
}

/** Only the desktop's variables, with empty values left out (an empty `DISPLAY` is no display). */
function desktopVars(from: Record<string, string | undefined>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of DESKTOP_VARIABLES) {
    const value = from[key];
    if (value !== undefined && value !== "") vars[key] = value;
  }
  return vars;
}

/**
 * The variables a started Chrome needs, from the first source that has them:
 *
 *   1. this session's own environment — a session in the person's terminal has them;
 *   2. on Linux, the systemd user manager's — the graphical session imports `DISPLAY`/
 *      `WAYLAND_DISPLAY` there, and a session the Claude daemon starts does not have them
 *      (measured 2026-10-23: the daemon's `XDG_SESSION_TYPE=tty`, the manager's `DISPLAY=:10.0`);
 *   3. on macOS and Windows: `platform` — no variable is needed for a window there;
 *   4. nothing: `display: false`, and the caller says the one step.
 */
export function desktopEnvironment(
  env: Record<string, string | undefined>,
  options: { platform: NodeJS.Platform; run?: RunCommand },
): DesktopEnvironment {
  const own = desktopVars(env);
  if (own.DISPLAY !== undefined || own.WAYLAND_DISPLAY !== undefined) {
    return { display: true, source: "session", vars: own };
  }
  if (options.platform !== "linux") return { display: true, source: "platform", vars: own };
  const answer = options.run?.(["systemctl", "--user", "show-environment"]);
  if (answer !== undefined && answer.exitCode === 0) {
    const manager = desktopVars(parseEnvironment(answer.output));
    if (manager.DISPLAY !== undefined || manager.WAYLAND_DISPLAY !== undefined) {
      return { display: true, source: "user-manager", vars: manager };
    }
  }
  return { display: false, source: "none", vars: own };
}

/**
 * The exact `argv` of a Chrome the plugin starts: the executable `chrome.ts` found, the profile's
 * FOLDER name (`--profile-directory`, the same answer the MCP is told), and the two flags that
 * keep a first-run bubble from standing in front of the connect page.
 */
export function chromeLaunchArgv(chrome: string, profileDirName: string): string[] {
  return [
    chrome,
    `--profile-directory=${profileDirName}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
}

/** A Chrome this plugin started, as the caller must see it. */
export interface StartedChrome {
  /** Its exit code, when it exits; a Chrome that stays up never resolves here. */
  exited: Promise<number>;
  /** Stops it, for the one case that a started Chrome never came up. */
  kill: (signal: NodeJS.Signals) => void;
  /** The last lines Chrome wrote to stderr, for the one plain line (its own words). */
  stderr: () => string;
  /**
   * The caller needs nothing more from this child's log (it came up): let its file go. The browser
   * itself is untouched — it outlives this process, and its next stderr write has a file to go to.
   */
  release?: () => void;
}

/** Starts Chrome detached: `env` is its whole environment, and its stdout is nobody's. */
export type StartChrome = (argv: string[], env: Record<string, string>) => StartedChrome;

/**
 * The real start: its own process group (it outlives this process, as the person's browser does),
 * its stderr kept for the failure line. The stderr goes to a FILE, never a pipe: the started Chrome
 * outlives this process, and a pipe whose reader has gone would fail its next stderr write — the
 * person's own browser must never die from our plumbing.
 */
export const realStartChrome: StartChrome = (argv, env) => {
  const log = join(tmpdir(), `${COMMAND}-chrome-${randomUUID()}.log`);
  let fd: number | null = null;
  try {
    fd = openSync(log, "w", 0o600);
  } catch {
    fd = null; // No log file is no reason not to start the browser; the line says the exit code.
  }
  const child = Bun.spawn(argv, {
    detached: true,
    env,
    stdio: ["ignore", "ignore", fd ?? "ignore"],
  });
  child.unref();
  let said = "";
  /** Chrome's own last words, read off its file. */
  const read = () => {
    try {
      said = readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .slice(-2)
        .join(" ");
    } catch {
      said = "";
    }
  };
  const release = () => {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
      fd = null;
    }
    try {
      // On Windows an open file cannot be removed while Chrome holds it: a failed removal leaves a
      // small log in the temp folder, which is not worth a note to the person.
      unlinkSync(log);
    } catch {}
  };
  return {
    exited: child.exited.then((code) => {
      read();
      release();
      return code;
    }),
    kill: (signal) => child.kill(signal),
    stderr: () => said,
    release,
  };
};

/** The one step every refusal names: the person opens their own Chrome, once. */
function openYourself(profileDirName: string): string {
  return (
    `Open Google Chrome with the "${profileDirName}" profile on your desktop, ` +
    `then start a new session`
  );
}

/** Chrome could not be started, in one line: what happened, and the one step. */
export function chromeStartFailedMessage(profileDirName: string, detail: string): string {
  return `Google Chrome ${detail}, so the browser cannot connect. ${openYourself(profileDirName)}.`;
}

/** No reachable desktop at all, in one line: what happened, and the one step. */
export function noDisplayMessage(profileDirName: string): string {
  return (
    `this session has no desktop display, so Google Chrome cannot open a window, and the browser ` +
    `cannot connect. ${openYourself(profileDirName)}.`
  );
}

/** What these questions ask of the machine; `platform` and `home` live in `chrome`. */
export interface ChromeStartDeps {
  chrome: ChromeDeps & { home: string; platform: NodeJS.Platform };
  /** This process's environment: the started Chrome inherits it, as any program it starts does. */
  env?: Record<string, string | undefined>;
  /** The person's desktop, from `desktopEnvironment`. */
  desktop: () => DesktopEnvironment;
  startChrome: StartChrome;
  /** The whole wait for a started Chrome; a test makes it short. */
  limitMs?: number;
  /** Waits between the readiness questions; a test hands in its own. */
  sleep?: (ms: number) => Promise<void>;
}

export type ChromeStartResult =
  | { ok: true; started: boolean }
  /** The one line for the person: what is wrong, and the one step that fixes it. */
  | { ok: false; why: string };

/**
 * Makes sure a Chrome runs on the profile's folder, starting it when none does:
 *
 *   - already running (Chrome's own lock names a live pid): nothing is started;
 *   - not running: the found Chrome is started with the profile, on the person's desktop, and the
 *     call goes on once Chrome's singleton lock is there — the state in which Playwright's own
 *     handoff of the connect page works;
 *   - no display, a spawn that throws, a Chrome that exits at once (its own stderr in the line),
 *     or one that is not up within `CHROME_START_LIMIT_MS`: `ok: false` with the one plain line.
 *     No retry, and no 30-second wait ending in the MCP's generic message.
 */
export async function ensureChromeRunning(
  ready: { chrome: string; profileDirName: string; userDataDir: string },
  deps: ChromeStartDeps,
): Promise<ChromeStartResult> {
  const running = () => chromeMayBeRunning(ready.userDataDir, deps.chrome.platform, deps.chrome);
  if (running()) return { ok: true, started: false };

  const desktop = deps.desktop();
  if (!desktop.display) return { ok: false, why: noDisplayMessage(ready.profileDirName) };

  // The session's own environment, with the desktop's variables on top: HOME and PATH reach the
  // started Chrome as they reach any program this process starts.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(deps.env ?? {})) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, desktop.vars);
  let child: StartedChrome;
  try {
    child = deps.startChrome(chromeLaunchArgv(ready.chrome, ready.profileDirName), env);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      why: chromeStartFailedMessage(ready.profileDirName, `could not be started (${said})`),
    };
  }

  const limitMs = deps.limitMs ?? CHROME_START_LIMIT_MS;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadline = Date.now() + limitMs;
  for (;;) {
    if (running()) {
      child.release?.();
      return { ok: true, started: true };
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      child.kill("SIGTERM");
      return {
        ok: false,
        why: chromeStartFailedMessage(
          ready.profileDirName,
          `did not come up within ${String(limitMs / 1000)} s`,
        ),
      };
    }
    const exited = await Promise.race([
      child.exited.then(
        (code) => code,
        () => -1,
      ),
      sleep(Math.min(CHROME_READY_POLL_MS, left)).then(() => null),
    ]);
    if (exited !== null) {
      // Chrome's own second-instance path: a launch that finds another Chrome hands it the page
      // and exits 0. The lock that made it exit is the one this call wanted, so ask once more
      // before failing — the person opening Chrome, or another session starting it, is a success.
      if (running()) {
        child.release?.();
        return { ok: true, started: true };
      }
      const said = child.stderr().trim();
      const detail = `exited at once (code ${String(exited)}${said === "" ? "" : `: ${said}`})`;
      return { ok: false, why: chromeStartFailedMessage(ready.profileDirName, detail) };
    }
  }
}
