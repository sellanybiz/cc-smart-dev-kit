/**
 * The ONE Google Chrome every Claude session's Playwright shares — found when it runs,
 * started when it does not.
 *
 * Chrome lets exactly one process open a profile folder, and a login cannot be copied into
 * several browsers (a site that rotates its refresh token logs a second browser using an old
 * copy out everywhere). So all sessions drive one Chrome on one profile folder,
 * `<dataDir>/playwright`, and sign in once. The first session that needs the browser starts
 * it; it runs DETACHED, so it outlives that session; every later session finds it.
 *
 * HOW IT IS FOUND
 *   Chrome is started with `--remote-debugging-port=0`: it picks a free port and writes
 *   `DevToolsActivePort` into the profile folder — line 1 the port, line 2 the browser's
 *   WebSocket path (`/devtools/browser/<uuid>`, a secret: whoever knows it can drive the
 *   browser). The browser is alive when that port answers `GET /json/version` AND the
 *   WebSocket URL it names has the same path as the file. A port that now belongs to
 *   another program — after a crash or a power cut the file stays, and the port is handed
 *   out again — answers with a different path, or not at all, and reads as dead.
 *
 * ONE START AT A TIME
 *   Two sessions that start at the same moment must not start two Chromes. The starter holds
 *   a port on this machine (`hold-port.ts`) while it starts Chrome; a second starter waits
 *   for it and then finds the browser the first one started. The system frees the port
 *   however the starter ends — killed, or the machine losing power — so the lock cannot go
 *   stale.
 *
 * WHEN THE PROFILE IS OPEN BUT NOTHING ANSWERS
 *   A Chrome that is still running on the profile but did not answer cannot be reused, and a
 *   second Chrome on the same folder would hand over to it and exit. That is an error: for
 *   the shared Chrome itself (busy, starting or closing) it says to try again in a moment;
 *   for a Chrome with no debug port — one the person started by hand — it says what to
 *   close. The lock files a DEAD Chrome left behind are removed instead (macOS, Linux).
 *
 * 🔴 NEVER WRITE TO STDOUT. The launcher's stdout is the MCP protocol stream; everything
 * goes through `log` (stderr). Nothing here reads the environment: the profile folder and
 * the lock port are arguments, so a test points them at a temp folder.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { request } from "node:http";
import type { Server } from "node:net";
import { homedir, hostname } from "node:os";
import { join, win32 } from "node:path";

import { askHolder, holdPort } from "./hold-port";

const ACTIVE_PORT_FILE = "DevToolsActivePort";

/** The three files Chrome keeps in the profile folder while it runs (macOS, Linux). */
const CHROME_SINGLETONS = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

/** How long a started Chrome has to write its port file and answer. Cold starts take
 *  1–3 s; twenty is a deliberate bound for a slow disk, not a delay anyone waits out. */
const DEFAULT_LAUNCH_TIMEOUT_MS = 20_000;

/** A waiting starter outlasts the starter it waits for by this much, so the starter's
 *  own timeout (and its clear error) comes first. */
const LOCK_WAIT_SLACK_MS = 5000;

/** Polling the port file of a Chrome that is starting. Bounded by the launch timeout. */
const START_POLL_MS = 100;

/** Polling the lock another starter holds. Bounded by the lock wait. */
const LOCK_POLL_MS = 200;

/** A browser that does not answer `/json/version` in this long reads as dead. */
const PROBE_TIMEOUT_MS = 2000;

/** `/json/version` is a few hundred bytes; anything much bigger is not a Chrome. */
const MAX_VERSION_BYTES = 64 * 1024;

/** What a starter answers to whoever asks who holds the lock: a way to tell a starter
 *  from any other program on the lock's port, which answers another line or none. */
const LOCK_ANSWER_PREFIX = "starting the shared Playwright browser";

/**
 * The switches Chrome is started with: the ones Playwright 1.63 gives a Chrome it launches
 * itself with a persistent profile, so the profile behaves exactly as it did when each
 * session launched its own (source: `chromiumSwitches` in playwright-core 1.63, plus what
 * its Chromium launcher adds).
 *
 * Left out on purpose:
 *   --disable-extensions        Playwright MCP drops it for its persistent profile.
 *   --remote-debugging-pipe     replaced by the port below: sessions come and go, a pipe
 *                               belongs to the one process that started the browser.
 *   --headless and its friends  this browser is visible; a person signs in in it.
 *   --no-sandbox                the MCP does not pass it for Google Chrome either.
 *
 * The ones that matter most:
 *   --password-store=basic and --use-mock-keychain
 *     Chrome encrypts cookies with a key it keeps in the system keychain. Without these two
 *     switches a profile written with them cannot be read: every saved login is lost.
 *   --disable-background-timer-throttling, --disable-backgrounding-occluded-windows,
 *   --disable-renderer-backgrounding
 *     Every session works in a window of its own, and most are behind other windows.
 *     Without these three Chrome slows down or freezes a page nobody can see, and a
 *     screenshot or a click in it stalls.
 */
const CHROME_SWITCHES: readonly string[] = [
  "--disable-field-trial-config",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-back-forward-cache",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-extensions-with-background-pages",
  "--disable-component-update",
  "--no-default-browser-check",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-edgeupdater",
  `--disable-features=${[
    "AvoidUnnecessaryBeforeUnloadCheckSync",
    "DestroyProfileOnBrowserClose",
    "DialMediaRouteProvider",
    "GlobalMediaControls",
    "HttpsUpgrades",
    "LensOverlay",
    "MediaRouter",
    "PaintHolding",
    "ThirdPartyStoragePartitioning",
    "BlockOriginHeaderModificationOnRedirect",
    "Translate",
    "AutoDeElevate",
    "OptimizationHints",
    "msForceBrowserSignIn",
    "msEdgeUpdateLaunchServicesPreferredVersion",
  ].join(",")}`,
  "--enable-features=CDPScreenshotNewSurface",
  "--allow-pre-commit-input",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-renderer-backgrounding",
  "--disable-updater-scheduler",
  "--force-color-profile=srgb",
  "--metrics-recording-only",
  "--no-first-run",
  "--password-store=basic",
  "--use-mock-keychain",
  "--no-service-autorun",
  "--export-tagged-pdf",
  "--disable-search-engine-choice-screen",
  "--unsafely-disable-devtools-self-xss-warnings",
  "--edge-skip-compat-layer-relaunch",
  "--disable-infobars",
  "--disable-sync",
  // The Chromium launcher adds it for every launch (software WebGL when there is no GPU).
  "--enable-unsafe-swiftshader",
];

/**
 * The arguments Chrome is started with for the shared profile: Playwright's own switches
 * (`CHROME_SWITCHES`), the profile folder, a debug port Chrome picks itself, and
 * `about:blank` as the start page. That start-up window belongs to no session: it keeps
 * Chrome open when every session window closes, and it is where a person signs in.
 */
export function chromeArgs(profileDir: string): string[] {
  return [
    ...CHROME_SWITCHES,
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "about:blank",
  ];
}

/** Where Google Chrome is installed on this platform, in the order they are tried. */
export function chromeCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      // A Chrome installed for one user only. The home folder, not %LOCALAPPDATA%: no
      // script here reads the environment.
      win32.join(home, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  return ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
}

/** The Google Chrome executable on this machine, or `null` when none is installed.
 *  Every argument can be replaced, for a test; the default is this machine. */
export function findChrome(
  where: { exists?: (path: string) => boolean; home?: string; platform?: NodeJS.Platform } = {},
): null | string {
  const exists = where.exists ?? existsSync;
  return (
    chromeCandidates(where.platform ?? process.platform, where.home ?? homedir()).find((path) =>
      exists(path),
    ) ?? null
  );
}

/** How a Chrome we started ended. */
export type ChromeExit =
  | {
      code: null | number;
      kind: "exit";
      signal: null | string;
    } /** The process could not be started at all (no such file, no permission). */
  | { kind: "error"; message: string };

/** A Chrome this launcher started. */
export interface ChromeProcess {
  /** Settles when the process ends or could not start. Never rejects. */
  exited: Promise<ChromeExit>;
  pid: number | undefined;
}

/** What `ensureSharedBrowser` asks of the machine — replaced in tests. */
export interface SystemProbe {
  /** The command line of a running process (macOS, Linux); `""` when there is none. */
  commandLine: (pid: number) => string;
  /** Is a process with this pid running? */
  isAlive: (pid: number) => boolean;
  /** Windows: open the profile's `lockfile` for reading and writing, and close it again.
   *  Throws as the system does when Chrome has it open. */
  openLockfile: (file: string) => void;
}

export interface SharedBrowserOptions {
  /** The home folder, for a Chrome installed for one user (Windows). Default: this user's. */
  homeDir?: string;
  /** Extra Chrome switches, after the standard ones (`--headless=new` for a machine with no desktop). */
  extraArgs?: readonly string[];
  /** A Chrome that does not answer after this long failed to start. */
  launchTimeoutMs?: number;
  /** The port that is the start lock (`LOCK_PORTS.browserStart`). */
  lockPort: number;
  /** A starter that waits for another one gives up after this long. */
  lockWaitMs?: number;
  /** Where progress goes. Never stdout. */
  log: (line: string) => void;
  pathExists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
  /** The shared profile folder — `<dataDir>/playwright`. */
  profileDir: string;
  /** How Chrome is started, and in which folder it works (the profile folder, which exists
   *  by then). The default starts it detached. */
  spawnChrome?: (executable: string, args: readonly string[], cwd: string) => ChromeProcess;
  system?: SystemProbe;
}

function errorCode(err: unknown): string | undefined {
  return err instanceof Error && "code" in err ? String(err.code) : undefined;
}

/** A length of time as a person reads it: 20 s, 0.3 s. */
function seconds(ms: number): string {
  return String(ms / 1000);
}

/** A pause between two looks at something that changes by itself. Always bounded by a
 *  deadline at the call site; never a way to wait out a race. */
function pause(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/** Is a process with this pid running? `EPERM` means it exists but is not ours. */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) === "EPERM";
  }
}

/** macOS and Linux only — Windows has no `ps`, and never reaches this. `-ww`: with
 *  output that is not a terminal, procps leaves the width undefined, and a Chrome's
 *  command line is well over a thousand characters. */
function commandLine(pid: number): string {
  try {
    return execFileSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    // `ps` exits 1 for a pid that no longer exists: nothing runs there, so no command line.
    if (err instanceof Error && "status" in err && err.status === 1) return "";
    throw err;
  }
}

/** The system the launcher runs on. */
export const realSystem: SystemProbe = {
  commandLine,
  isAlive,
  openLockfile: (file) => {
    closeSync(openSync(file, "r+"));
  },
};

interface ActivePort {
  path: string;
  port: number;
}

/** The port and WebSocket path Chrome wrote, or `null` for no file or half a file. */
function readActivePort(profileDir: string): ActivePort | null {
  let text: string;
  try {
    text = readFileSync(join(profileDir, ACTIVE_PORT_FILE), "utf8");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
  const [portLine, pathLine] = text.split(/\r?\n/);
  const port = Number(portLine);
  const path = pathLine?.trim() ?? "";
  // Chrome writes the port first and the path after it: a file read in between has no path.
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  if (!path.startsWith("/devtools/browser/")) return null;
  return { path, port };
}

/** The path of the WebSocket URL a Chrome on this port reports, or `null` when nothing
 *  that looks like a Chrome answers. `node:http`, not `fetch`: a plain request that goes
 *  straight to this machine, whatever proxy the environment names. */
function readReportedPath(port: number): Promise<null | string> {
  return new Promise((done) => {
    const req = request(
      { host: "127.0.0.1", method: "GET", path: "/json/version", port, timeout: PROBE_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          done(null);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_VERSION_BYTES) {
            req.destroy();
            done(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          done(reportedPath(Buffer.concat(chunks).toString("utf8")));
        });
        res.on("error", () => {
          done(null);
        });
      },
    );
    // A listener that never answers is not a Chrome we can use.
    req.on("timeout", () => {
      req.destroy();
    });
    req.on("error", () => {
      done(null);
    });
    req.end();
  });
}

function reportedPath(body: string): null | string {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // Not JSON: some other program answers on this port.
    return null;
  }
  if (typeof json !== "object" || json === null || !("webSocketDebuggerUrl" in json)) return null;
  const url = json.webSocketDebuggerUrl;
  if (typeof url !== "string" || !URL.canParse(url)) return null;
  return new URL(url).pathname;
}

interface LiveBrowser {
  port: number;
  /** `ws://127.0.0.1:<port><path>` — secret, never logged. */
  url: string;
}

/** The browser the port file names, when it is alive; `null` otherwise. A port that now
 *  belongs to another program answers with another path (or not like a Chrome at all). */
async function liveBrowser(profileDir: string): Promise<LiveBrowser | null> {
  const active = readActivePort(profileDir);
  if (active === null) return null;
  const reported = await readReportedPath(active.port);
  if (reported !== active.path) return null;
  return { port: active.port, url: `ws://127.0.0.1:${String(active.port)}${active.path}` };
}

/** Which Chrome opened the profile, from the `SingletonLock` it left (macOS, Linux).
 *
 *  Chrome writes the lock as a symlink whose TARGET is `<hostname>-<pid>`. A lock from
 *  another host cannot be checked from here, so it is reported as foreign and the
 *  profile is left alone. */
function chromeLock(
  dir: string,
): { kind: "foreign"; target: string } | { kind: "none" } | { kind: "pid"; pid: number } {
  let target: string;
  try {
    target = readlinkSync(join(dir, "SingletonLock"));
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { kind: "none" };
    throw err;
  }
  const cut = target.lastIndexOf("-");
  const host = target.slice(0, cut);
  const pid = Number(target.slice(cut + 1));
  if (cut <= 0 || host !== hostname() || !Number.isInteger(pid)) return { kind: "foreign", target };
  return { kind: "pid", pid };
}

/** The command line of the Chrome that has THIS profile open — it names the folder in its
 *  arguments — or `null` when the pid is no such Chrome. Alive is not enough: after a power
 *  cut the pid in a leftover lock is handed to some unrelated process, and the profile
 *  would read as busy for as long as that one lives. */
function chromeCommandLineOn(pid: number, profileDir: string, system: SystemProbe): null | string {
  if (!system.isAlive(pid)) return null;
  const line = system.commandLine(pid);
  return line.includes(profileDir) ? line : null;
}

/**
 * Windows: Chrome writes no `SingletonLock`. It keeps a file named `lockfile` open in the
 * profile folder for as long as it runs, and Windows refuses a second open of it (EBUSY).
 * The file is gone when Chrome exits — or is killed.
 */
function isWindowsProfileOpen(
  dir: string,
  system: SystemProbe,
  log: (line: string) => void,
): boolean {
  try {
    system.openLockfile(join(dir, "lockfile"));
    return false;
  } catch (err) {
    const code = errorCode(err);
    if (code === "ENOENT") return false;
    if (code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") {
      log(`cannot read ${dir}'s Chrome lock (${code ?? "unknown error"}) — treating it as open`);
    }
    return true;
  }
}

/**
 * Does a running Chrome have this profile folder open? `doctor` asks before it reports the
 * browser, and a caller that would remove a profile asks first: a session may still run its
 * Chrome there. A lock from another computer counts as open — nothing here can tell.
 */
export function isProfileInUse(
  dir: string,
  platform: NodeJS.Platform,
  system: SystemProbe,
  log: (line: string) => void,
): boolean {
  if (platform === "win32") return isWindowsProfileOpen(dir, system, log);
  const lock = chromeLock(dir);
  if (lock.kind === "none") return false;
  if (lock.kind === "foreign") return true;
  return chromeCommandLineOn(lock.pid, dir, system) !== null;
}

/** Remove the lock files a dead Chrome left behind: one such file once made every session
 *  read "in use" for days. */
function clearDeadChromeLock(dir: string, pid: number, log: (line: string) => void): void {
  for (const name of CHROME_SINGLETONS) {
    try {
      unlinkSync(join(dir, name));
    } catch (err) {
      if (errorCode(err) !== "ENOENT") throw err;
    }
  }
  log(
    `cleared a stale Chrome lock in ${dir} — pid ${String(pid)} is no longer a Chrome using this profile`,
  );
}

/**
 * Called holding the start lock, when no browser answered: throw when a Chrome that is
 * still running has the profile open (it cannot be reused, and a second Chrome on the same
 * folder would hand over to it and exit); clear the lock files a dead Chrome left.
 *
 * Such a Chrome is one of two kinds, and the message says which. The SHARED Chrome itself
 * can fail to answer within the probe's two seconds — busy, starting after a starter died,
 * or closing after its last window — and its command line has `--remote-debugging-port`
 * (`chromeArgs`): the person waits a moment; closing it would end every session's browser.
 * Any other Chrome — one started by hand, with no debug port — has to be closed. Windows has
 * no command line to tell them apart: one message covers both.
 */
function claimProfile(
  dir: string,
  platform: NodeJS.Platform,
  system: SystemProbe,
  log: (line: string) => void,
): void {
  if (platform === "win32") {
    // A leftover `lockfile` stops nothing on Windows: there is nothing to clear.
    if (isWindowsProfileOpen(dir, system, log)) {
      throw new Error(
        `A Chrome has ${dir} open, but it does not answer on its debug port. If it is the shared ` +
          `browser, it may be busy, starting or closing: use the browser again in a moment. If ` +
          `it keeps happening, or it is a Chrome without a debug port, close that Chrome ` +
          `window, then use the browser again.`,
      );
    }
    return;
  }
  const lock = chromeLock(dir);
  if (lock.kind === "none") return;
  if (lock.kind === "foreign") {
    throw new Error(
      `The Chrome lock in ${dir} (${lock.target}) was made on another computer, so this one ` +
        `cannot tell whether that Chrome still runs. If it does, close it; if it does not, ` +
        `delete SingletonLock, SingletonCookie and SingletonSocket in that folder. Then use the browser again.`,
    );
  }
  const running = chromeCommandLineOn(lock.pid, dir, system);
  if (running === null) {
    clearDeadChromeLock(dir, lock.pid, log);
    return;
  }
  if (running.includes("--remote-debugging-port")) {
    throw new Error(
      `The shared Chrome (pid ${String(lock.pid)}) has ${dir} open but did not answer on its ` +
        `debug port. It may be busy, starting or closing: use the browser again in a moment. ` +
        `Only if it keeps happening, close that Chrome (every session's browser windows close ` +
        `with it), then use the browser again.`,
    );
  }
  throw new Error(
    `A Chrome has ${dir} open without its debug port (pid ${String(lock.pid)}). ` +
      `Close that Chrome window, then use the browser again.`,
  );
}

/**
 * Starts Chrome so that it outlives this process: its own process group, no pipes to this
 * process, and not counted when this process waits to exit.
 *
 * `cwd` is the folder Chrome works in. Never leave it to be inherited: the launcher often
 * runs inside a git worktree (a session started there, or an MCP server restarted while its
 * session was in one), and the shared Chrome lives for days — and a process working in a
 * folder keeps a worktree from being moved or removed.
 */
export function spawnDetachedChrome(
  executable: string,
  args: readonly string[],
  cwd: string,
): ChromeProcess {
  const child = spawn(executable, [...args], { cwd, detached: true, stdio: "ignore" });
  const exited = new Promise<ChromeExit>((done) => {
    child.on("error", (err) => {
      done({ kind: "error", message: err.message });
    });
    child.on("exit", (code, signal) => {
      done({ code, kind: "exit", signal });
    });
  });
  child.unref();
  return { exited, pid: child.pid };
}

/** What taking the start lock came to: the lock itself, or the browser that the starter
 *  holding it brought up in the meantime. */
type StartLock = { browser: LiveBrowser } | { lock: Server };

/**
 * Take the start lock, or find the browser the starter that holds it brought up.
 * Another starter holding it is waited for, up to `waitMs`.
 */
async function takeStartLock(
  profileDir: string,
  lockPort: number,
  waitMs: number,
): Promise<StartLock> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const hold = await holdPort(lockPort, `${LOCK_ANSWER_PREFIX} (pid ${String(process.pid)})`);
    if ("held" in hold) return { lock: hold.held };
    if ("error" in hold) {
      throw new Error(
        `Cannot take the browser start lock on port ${String(lockPort)} (${hold.error}). ` +
          `Another program may keep that port; the Playwright launcher needs it free.`,
      );
    }

    const holder = await askHolder(lockPort);
    // `null`: it was let go between the two calls. Anything but our own line: not a
    // starter, so some other program keeps it, for as long as it runs — waiting would
    // never end well.
    if (holder !== null && !holder.startsWith(LOCK_ANSWER_PREFIX)) {
      const port = String(lockPort);
      throw new Error(
        `Port ${port} is held by a program that is not the Playwright launcher, so the shared ` +
          `browser cannot start: it needs that port for its start lock. Find the program ` +
          `(Linux: ss -ltnp | grep ${port}; macOS: lsof -i :${port}) and stop it, then use the browser again.`,
      );
    }

    const browser = await liveBrowser(profileDir);
    if (browser !== null) return { browser };
    if (Date.now() >= deadline) {
      throw new Error(
        `Another session has been starting the shared browser for over ${seconds(waitMs)} s ` +
          `and it is not ready. Use the browser again in a moment.`,
      );
    }
    await pause(LOCK_POLL_MS);
  }
}

/** Wait for a Chrome we started to write its port file and answer on it. */
async function waitForBrowser(
  chrome: ChromeProcess,
  profileDir: string,
  platform: NodeJS.Platform,
  timeoutMs: number,
): Promise<LiveBrowser> {
  const state: { exit: ChromeExit | null } = { exit: null };
  void chrome.exited.then((exit) => {
    state.exit = exit;
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const browser = await liveBrowser(profileDir);
    if (browser !== null) return browser;

    if (state.exit !== null) {
      if (state.exit.kind === "error") {
        throw new Error(`Chrome could not be started: ${state.exit.message}.`);
      }
      const how =
        state.exit.signal === null
          ? `code ${String(state.exit.code)}`
          : `signal ${state.exit.signal}`;
      throw new Error(
        `Chrome exited (${how}) before its debug port was ready. ` +
          (platform === "linux"
            ? `On Linux the usual cause is no display: Chrome needs a desktop session. `
            : ``) +
          `Another Chrome that already had ${profileDir} open also ends a new one this way.`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Chrome did not open its debug port within ${seconds(timeoutMs)} s. ` +
          `It may still be starting: use the browser again in a moment. If it keeps failing, ` +
          `close every Chrome window that uses ${profileDir}.`,
      );
    }
    await pause(START_POLL_MS);
  }
}

/**
 * The WebSocket URL of the shared Chrome's browser endpoint
 * (`ws://127.0.0.1:<port>/devtools/browser/<id>`), starting Chrome first when it is not
 * running.
 *
 *   1. A live browser is reused.
 *   2. Otherwise the start lock is taken — or, when another starter holds it, waited for,
 *      and the browser it starts is used.
 *   3. Holding the lock: a Chrome that is still running on the profile without a debug
 *      port is an error; a dead Chrome's lock files are removed.
 *   4. Chrome is started detached, and waited for until it answers.
 *   5. The lock is released on every path.
 *
 * Throws an Error whose message says what to do. The URL is a secret: do not log it.
 */
export async function ensureSharedBrowser(options: SharedBrowserOptions): Promise<string> {
  const { log, lockPort, profileDir } = options;
  const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const lockWaitMs = options.lockWaitMs ?? launchTimeoutMs + LOCK_WAIT_SLACK_MS;
  const platform = options.platform ?? process.platform;
  const system = options.system ?? realSystem;
  const spawnChrome = options.spawnChrome ?? spawnDetachedChrome;

  const running = await liveBrowser(profileDir);
  if (running !== null) return running.url;

  const home = options.homeDir ?? homedir();
  const executable = findChrome({ exists: options.pathExists ?? existsSync, home, platform });
  if (executable === null) {
    throw new Error(
      `Google Chrome is not installed where this launcher looks. Checked: ` +
        `${chromeCandidates(platform, home).join(", ")}. Install Google Chrome, then use the browser again.`,
    );
  }

  const taken = await takeStartLock(profileDir, lockPort, lockWaitMs);
  if ("browser" in taken) return taken.browser.url;

  try {
    // Another starter may have finished between our look and the lock.
    const started = await liveBrowser(profileDir);
    if (started !== null) return started.url;

    claimProfile(profileDir, platform, system, log);

    mkdirSync(profileDir, { recursive: true });
    // The last Chrome's file: its port may be reused, and it would pass for the new one.
    rmSync(join(profileDir, ACTIVE_PORT_FILE), { force: true });

    log(`starting Chrome (${executable}) on ${profileDir}`);
    // Chrome works in the profile folder, not in wherever this launcher happens to be.
    const chrome = spawnChrome(
      executable,
      [...chromeArgs(profileDir), ...(options.extraArgs ?? [])],
      profileDir,
    );
    const browser = await waitForBrowser(chrome, profileDir, platform, launchTimeoutMs);
    log(`Chrome is ready (pid ${String(chrome.pid)}, debug port ${String(browser.port)})`);
    return browser.url;
  } finally {
    // The port is free at once; a connection still open on it is cut off by
    // `hold-port.ts` within a second, and nobody waits for that.
    taken.lock.close();
  }
}
