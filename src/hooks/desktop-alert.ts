/**
 * The Linux desktop alert and the extras a real desktop can give it: a click that raises
 * the session's own terminal window, the alert leaving the screen for the notification
 * centre after a minute, one alert per session on screen, and the XFCE Do-Not-Disturb
 * setting keeping an ordinary alert's sound off.
 *
 * These are the desktop behaviours of the notification script this hook replaces, ported
 * so a machine that moves to the plugin loses nothing. Each runs only where the tool it
 * needs is there, and is skipped in silence otherwise (`doctor` names a missing tool as
 * information, never a failure):
 *
 *   - the click, and everything around it, need a notification that reports a click and a
 *     window to raise: the `gdbus` route (the freedesktop notification server itself), or
 *     a `notify-send` whose `--help` lists `--action` and `--wait`, together with
 *     `xdotool`;
 *   - the minute on screen and "one alert per session" need the notification's **id**,
 *     which only the `gdbus` route gives — `notify-send` never says which id it got;
 *   - the Do-Not-Disturb check is `xfconf-query`, XFCE's own setting.
 *
 * Everything that waits runs in the detached worker (`alert-worker`): the wait is a minute
 * long, and Claude Code must never wait for a hook (`hooks.md`). `src/hooks/notify.ts`
 * starts it for the alerts; `src/hooks/stop-failure.ts` for the usage-limit alert. The hook
 * itself only decides the worker is worth starting, and checks Do Not Disturb before it
 * plays the sound — a sound has no notification server to hold it back.
 *
 * Why the bus call and not `notify-send` for the click everywhere: on the setup this was
 * ported from, `notify-send` 0.8.8 answers "Actions are not supported" at run time although
 * the notification server lists them, so it never waits for a click (found on the older
 * script). The bus call is the route that works there. Every route is best-effort: a call
 * that fails falls back to the next one, and the last is the plain notification — exactly
 * today's alert, built by the one Linux sender (`notifyCommand`).
 *
 * No names of a person, a machine or a project here: the patterns `xdotool` is given are
 * published window classes, and every path comes from the environment or from `which`.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN } from "../build-info/names";
import { notifyCommand } from "../update/apply";
import type { Which } from "./alert-sound";
import type { Run, Runner } from "./stop-failure";

/** The freedesktop notification server: its well-known name, and its object path. */
export const NOTIFICATIONS_SERVICE = "org.freedesktop.Notifications";
export const NOTIFICATIONS_PATH = "/org/freedesktop/Notifications";

/** The themed icon the alerts carry, as the older notification script's were. */
export const ALERT_ICON = "utilities-terminal";

/**
 * How long an alert stays on screen before it moves to the notification centre: a minute,
 * the older notification script's own timeout (some servers never expire an urgent
 * notification themselves, so the worker closes this alert on the minute).
 */
export const ALERT_SCREEN_MS = 60_000;

/** How long one short program may take (a bus call, `xdotool`'s window walk). */
export const TOOL_TIMEOUT_MS = 5_000;

/**
 * The close reason that means the person clicked the alert: 2, "dismissed by the user"
 * (the older notification script's finding for this server family — a click anywhere on
 * the popup arrives so, while its buttons arrive as `ActionInvoked`; 1 is the expiry,
 * 3 a close by a call).
 */
export const CLICKED_CLOSE_REASON = 2;

/** The environment, as a hook sees it. */
type Env = Record<string, string | undefined>;

/**
 * True when this machine has a desktop an alert can be shown on: on Linux an X or Wayland
 * session (`DISPLAY` or `WAYLAND_DISPLAY`); macOS and Windows always have one. Without a
 * desktop — an SSH session, a headless machine — `notify-send` has no bus to show anything
 * on, and the terminal route (`notify.ts`) is the one that works.
 */
export function hasDesktop(platform: NodeJS.Platform, env: Env): boolean {
  if (platform !== "linux") return true;
  return (env.DISPLAY ?? "") !== "" || (env.WAYLAND_DISPLAY ?? "") !== "";
}

/** The desktop tools the extras are built from, each looked up on PATH. */
export interface DesktopTools {
  /** The freedesktop bus itself (`glib`): the notification server, directly. */
  gdbus: null | string;
  /** The notification client, where it can do the two flags (see `notifySendCapabilities`). */
  notifySend: null | string;
  /** Raising the session's window. */
  xdotool: null | string;
  /** XFCE's settings, where Do Not Disturb lives. */
  xfconfQuery: null | string;
}

/** Each tool the desktop extras need, found on PATH or null. */
export function desktopTools(which: Which): DesktopTools {
  return {
    gdbus: which("gdbus"),
    notifySend: which("notify-send"),
    xdotool: which("xdotool"),
    xfconfQuery: which("xfconf-query"),
  };
}

/** What a `notify-send --help` output says that notify-send can do. */
export interface NotifySendCapabilities {
  actions: boolean;
  expire: boolean;
  wait: boolean;
}

/**
 * The flags `notify-send --help` lists. Only the flags are read here; whether the server
 * really honours an action is another thing (`notify-send` 0.8.8 lists them and still
 * answers "Actions are not supported" at run time on the setup this was ported from), so a
 * run that fails falls back to the next route rather than trusting the help.
 */
export function notifySendCapabilities(help: string): NotifySendCapabilities {
  return {
    actions: help.includes("--action"),
    expire: help.includes("--expire-time"),
    wait: help.includes("--wait"),
  };
}

/**
 * True when a click on the alert can be waited for on this machine: the `gdbus` route, or
 * a `notify-send` that lists both flags the wait needs. False: the hook keeps today's
 * plain notification (`notifyCommand`), which no worker improves on.
 */
export function canWaitForClick(tools: DesktopTools, capture: Runner): boolean {
  if (tools.gdbus !== null) return true;
  if (tools.notifySend === null) return false;
  const help = capture({ argv: [tools.notifySend, "--help"], timeoutMs: TOOL_TIMEOUT_MS });
  const capabilities = notifySendCapabilities(help.stdout);
  return capabilities.actions && capabilities.wait;
}

/**
 * True when XFCE's Do Not Disturb is on: an ordinary alert's sound stays off while it is
 * on, exactly as the older notification script did. An urgent alert sounds anyway (XFCE
 * shows those under Do Not Disturb too). No `xfconf-query`, or an answer that cannot be
 * read: false — the sound plays as always.
 */
export function dndOn(tools: DesktopTools, capture: Runner): boolean {
  if (tools.xfconfQuery === null) return false;
  const run = capture({
    argv: [tools.xfconfQuery, "-c", "xfce4-notifyd", "-p", "/do-not-disturb"],
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  return run.exitCode === 0 && run.stdout.trim() === "true";
}

/** What the desktop alert needs about the session it is for. */
export interface NotifyTarget {
  /** The project folder's name: a VS Code window's title carries it. */
  folder: string;
  /** The session's name (`notify.ts`'s label): a Warp window's title carries it. */
  name: string;
  /** `TERM_PROGRAM`: `vscode` and `WarpTerminal` have windows found by class and title. */
  program: string;
  /** The session id as part of a file name; already cleaned by the caller. */
  session: string;
  /** The session's own terminal window (`WINDOWID`), when the terminal sets it. */
  windowId: string;
}

/** The window the alert would raise, as the worker receives it. */
export interface WindowHint {
  folder: string;
  name: string;
  program: string;
  windowId: string;
}

/** The payload kind, so the worker tells the notifier's alert from the usage-limit one. */
export const NOTIFY_ALERT_KIND = "notify";

/** The notifier's alert, as the detached worker behind a click receives it. */
export interface NotifyWorkerAlert {
  body: string;
  /** The alert is urgent: the desktop keeps it on screen, and Do Not Disturb does not hide it. */
  critical: boolean;
  kind: typeof NOTIFY_ALERT_KIND;
  session: string;
  title: string;
  window: WindowHint;
}

/** The worker's argument for this alert: the wire shape, built by the hook. */
export function notifyWorkerAlert(
  alert: { body: string; critical: boolean; title: string },
  target: NotifyTarget,
): NotifyWorkerAlert {
  return {
    body: alert.body,
    critical: alert.critical,
    kind: NOTIFY_ALERT_KIND,
    session: target.session,
    title: alert.title,
    window: {
      folder: target.folder,
      name: target.name,
      program: target.program,
      windowId: target.windowId,
    },
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string field of a parsed payload, or empty. */
function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The alert from the worker's argument; null when it is not one. The window id must be
 * digits: it reaches `xdotool` as one argument (never a shell), and anything else is a hint
 * that cannot name a window anyway.
 */
export function parseNotifyWorkerAlert(argument: string): NotifyWorkerAlert | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argument);
  } catch {
    // Not from the hook: nothing to show.
    return null;
  }
  if (!isJsonObject(parsed) || parsed.kind !== NOTIFY_ALERT_KIND) return null;
  if (typeof parsed.title !== "string" || typeof parsed.body !== "string") return null;
  const window = isJsonObject(parsed.window) ? parsed.window : {};
  const windowId = stringOf(window.windowId);
  return {
    body: parsed.body,
    critical: parsed.critical === true,
    kind: NOTIFY_ALERT_KIND,
    session: stringOf(parsed.session),
    title: parsed.title,
    window: {
      folder: stringOf(window.folder),
      name: stringOf(window.name),
      program: stringOf(window.program),
      windowId: /^[0-9]+$/.test(windowId) ? windowId : "",
    },
  };
}

/** A `gdbus call` to the notification server. */
export function busCallArgv(gdbus: string, method: string, args: string[]): string[] {
  return [
    gdbus,
    "call",
    "--session",
    "--dest",
    NOTIFICATIONS_SERVICE,
    "--object-path",
    NOTIFICATIONS_PATH,
    "--method",
    `${NOTIFICATIONS_SERVICE}.${method}`,
    // `--` ends gdbus's own options before the arguments: the expiry argument is `-1`, and
    // gdbus reads a leading `-` as an unknown option and refuses the whole call without it
    // (seen live on glib 2.88).
    "--",
    ...args,
  ];
}

/** GVariant text for a string argument: single-quoted, with a `'` inside doubled. */
export function gvariantString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Markup characters escaped (`&` first): servers that read a body as markup show a
 * message with `<` in it literally instead of dropping it as a broken tag (the older
 * notification script escaped its body the same way).
 */
export function escapedMarkup(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The `CloseNotification` call: what moves an alert off the screen into the centre. */
export function closeCallArgv(gdbus: string, id: number): string[] {
  return busCallArgv(gdbus, "CloseNotification", [String(id)]);
}

/**
 * The `Notify` call: the freedesktop `(susssasa{sv}i)` signature, with the alert's words.
 * The urgency hint is 2 for an urgent alert (the server keeps it on screen and shows it
 * under Do Not Disturb) and 1 otherwise. The expiry is -1 — the server's own default — and
 * the worker closes the alert itself on the minute (the older notification script's own
 * behaviour: some servers never expire an urgent one).
 */
export function notifyCallArgv(
  gdbus: string,
  alert: { body: string; critical: boolean; title: string },
  actions: boolean,
): string[] {
  return busCallArgv(gdbus, "Notify", [
    gvariantString(PLUGIN),
    "0",
    gvariantString(ALERT_ICON),
    gvariantString(escapedMarkup(alert.title)),
    gvariantString(escapedMarkup(alert.body)),
    actions ? "['default', 'Open', 'dismiss', 'Dismiss']" : "[]",
    `{'urgency': <byte ${alert.critical ? 2 : 1}>}`,
    "-1",
  ]);
}

/**
 * The notification server's capabilities, from its `GetCapabilities` answer; null when the
 * call could not be made (no bus, no server). The capabilities decide the action buttons:
 * one the server does not list is not sent.
 */
export function serverCapabilities(gdbus: string, capture: Runner): null | string[] {
  const run = capture({
    argv: busCallArgv(gdbus, "GetCapabilities", []),
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  if (run.exitCode !== 0) return null;
  return [...run.stdout.matchAll(/'([^']*)'/g)].map((found) => found[1] ?? "");
}

/** The notification id in a `Notify` reply (`(uint32 42,)`); null when there is none. */
export function notifiedId(reply: { exitCode: null | number; stdout: string }): null | number {
  if (reply.exitCode !== 0) return null;
  const found = /uint32\s+(\d+)/.exec(reply.stdout);
  return found === null ? null : Number(found[1]);
}

/** The action a monitor line reports for our id, or null: `ActionInvoked (uint32 42, 'default')`. */
export function actionOf(line: string, id: number): null | string {
  const found = /ActionInvoked\s*\(uint32\s+(\d+),\s*'([^']*)'\)/.exec(line);
  if (found === null || Number(found[1]) !== id) return null;
  return found[2] ?? "";
}

/** The close reason a monitor line reports for our id, or null: `NotificationClosed (uint32 42, uint32 2)`. */
export function closedReasonOf(line: string, id: number): null | number {
  const found = /NotificationClosed\s*\(uint32\s+(\d+),\s*uint32\s+(\d+)\)/.exec(line);
  if (found === null || Number(found[1]) !== id) return null;
  return Number(found[2]);
}

/**
 * The record of the notification this session has on screen — one alert per session, so
 * old ones neither pile up nor steal focus (the older script's rule). The session id is
 * cleaned here too: it becomes part of a path, and ids from outside never do.
 */
export function shownStateFile(stateDir: string, session: string): string {
  const key = session.replace(/[^A-Za-z0-9-]/g, "");
  return join(stateDir, `cc-smart-dev-kit-notify-shown-${key === "" ? "none" : key}`);
}

/** The notification id the session has on screen, or null. */
function readShownId(file: string): null | number {
  try {
    const value = readFileSync(file, "utf8").trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  } catch {
    // No record, or one that cannot be read: this session has no alert on screen.
    return null;
  }
}

/** Remembers the notification id this session has on screen. */
function writeShownId(file: string, id: number): void {
  try {
    writeFileSync(file, String(id));
  } catch {
    // A record that cannot be written only means the next alert may leave this one on
    // screen as well.
  }
}

/** Forgets it, but only while it is still ours: a newer alert's id stays. */
function forgetShownId(file: string, id: number): void {
  try {
    if (readShownId(file) === id) rmSync(file, { force: true });
  } catch {
    // Nothing to do about it: the next alert replaces whatever record is there.
  }
}

/** Every window of a class, with its title: `xdotool search --class`, then each window's name. */
function windowsOfClass(
  xdotool: string,
  pattern: string,
  capture: Runner,
): Array<{ id: string; title: string }> {
  const search: Run = { argv: [xdotool, "search", "--class", pattern], timeoutMs: TOOL_TIMEOUT_MS };
  let found = capture(search);
  // xdotool 3.20160805 stops on BadWindow when any window closes while it walks the window
  // tree; the walk itself is fine a moment later (the older notification script found this,
  // and it is why this runs exactly once more — never more).
  if (found.stdout.trim() === "") found = capture(search);
  return found.stdout
    .split(/\s+/)
    .filter((id) => /^[0-9]+$/.test(id))
    .map((id) => ({
      id,
      title: capture({
        argv: [xdotool, "getwindowname", id],
        timeoutMs: TOOL_TIMEOUT_MS,
      }).stdout.trim(),
    }));
}

/**
 * VS Code's window for this folder: its title is `<file> - <folder> - Visual Studio Code`,
 * and the first VS Code window when none names the folder. A VS Code started from a
 * terminal inherits that terminal's `WINDOWID`, so this comes before the window id, as in
 * the older notification script; windows whose title does not end in "Visual Studio Code"
 * are Electron's hidden helper windows.
 */
function vscodeWindow(xdotool: string, folder: string, capture: Runner): null | string {
  const named = windowsOfClass(xdotool, "^(code|com\\.microsoft\\.vscode)$", capture).filter(
    ({ title }) => title.endsWith("Visual Studio Code"),
  );
  const wanted =
    folder === "" ? undefined : named.find(({ title }) => title.includes(` ${folder} - `));
  const window = wanted ?? named[0];
  return window === undefined ? null : window.id;
}

/**
 * Warp's window: the one whose title (its current tab's) names the session, else the
 * first. Warp sets no `WINDOWID`, and its tabs cannot be picked from outside.
 */
function warpWindow(xdotool: string, name: string, capture: Runner): null | string {
  const found = windowsOfClass(xdotool, "^dev\\.warp\\.Warp$", capture);
  const wanted = name === "" ? undefined : found.find(({ title }) => title.includes(name));
  const window = wanted ?? found[0];
  return window === undefined ? null : window.id;
}

/**
 * The `xdotool` command that raises the session's own window; null when there is nothing
 * to name: no `xdotool`, or no window id and a terminal whose window cannot be found by
 * class and title. Only the window is raised — the older script also selected the right
 * tab inside XFCE Terminal through the desktop's accessibility service (AT-SPI), which
 * needs a client this plugin does not carry (`docs/design.md` § The notifier).
 */
export function raiseArgv(hint: WindowHint, tools: DesktopTools, capture: Runner): null | string[] {
  const xdotool = tools.xdotool;
  if (xdotool === null) return null;
  const program = hint.program.toLowerCase();
  if (program === "vscode") {
    const window = vscodeWindow(xdotool, hint.folder, capture);
    return window === null ? null : [xdotool, "windowactivate", window];
  }
  if (program === "warpterminal") {
    const window = warpWindow(xdotool, hint.name, capture);
    return window === null ? null : [xdotool, "windowactivate", window];
  }
  // Every other terminal (XFCE Terminal among them) sets WINDOWID in the session's
  // environment; without it there is no window to name.
  return hint.windowId === "" ? null : [xdotool, "windowactivate", hint.windowId];
}

/**
 * The `notify-send` alert: the same words, an `Open` button (the default action a click on
 * the popup triggers) and a `Dismiss` one, the urgency, and — where its help lists them —
 * the expiry that moves it to the centre and the wait for a click.
 */
export function notifySendAlertArgv(
  send: string,
  alert: { body: string; critical: boolean; title: string },
  capabilities: NotifySendCapabilities,
  screenMs: number,
): string[] {
  return [
    send,
    `--app-name=${PLUGIN}`,
    `--icon=${ALERT_ICON}`,
    `--urgency=${alert.critical ? "critical" : "normal"}`,
    "--action=default=Open",
    "--action=dismiss=Dismiss",
    ...(capabilities.expire ? [`--expire-time=${screenMs}`] : []),
    ...(capabilities.wait ? ["--wait"] : []),
    alert.title,
    alert.body,
  ];
}

/** A program whose stdout is read line by line while it runs (the bus signal monitor). */
export interface Watched {
  stop: () => void;
}

/** Starts one; its lines reach `onLine` until `stop`. */
export type Watch = (argv: string[], onLine: (line: string) => void) => Watched;

/**
 * A one-shot gate: a callback opens it once, and the promise in `waited` takes the first
 * answer. The click wait needs exactly this — the click, the close and the minute race,
 * and the first one decides.
 */
function gate(): { open: (value: boolean) => void; waited: Promise<boolean> } {
  let done = false;
  let release: (value: boolean) => void = () => undefined;
  const waited = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  return {
    open: (value) => {
      if (done) return;
      done = true;
      release(value);
    },
    waited,
  };
}

/** What the desktop alert's worker reads from this machine; a test passes its own. */
export interface DesktopAlertDeps {
  /** Runs a short program and captures its stdout (a bus call, `xdotool`). */
  capture: Runner;
  /** How long the alert stays on screen (a test passes a moment of its own). */
  screenMs: number;
  /** The clock, for the `notify-send` route's "a click or the expiry?" (a test passes its own). */
  nowMs: () => number;
  /** Waits; the minute on screen. */
  sleep: (ms: number) => Promise<void>;
  /** Where the per-session "on screen" record lives (`XDG_RUNTIME_DIR`, else the temp folder). */
  stateDir: string;
  /** Starts the bus signal monitor. */
  watch: Watch;
  /** Finds a program on PATH. */
  which: Which;
}

/** What the worker did: shown, raised the window on a click, or nothing. */
export type DesktopAlertOutcome = "no notifier" | "raised" | "shown";

/** Raises the session's window, best-effort: whatever goes wrong, nothing else happens. */
function raise(alert: NotifyWorkerAlert, deps: DesktopAlertDeps): void {
  const argv = raiseArgv(alert.window, desktopTools(deps.which), deps.capture);
  if (argv !== null) deps.capture({ argv, timeoutMs: TOOL_TIMEOUT_MS });
}

/**
 * Shows the alert through the bus and waits for the click: the server's own notification,
 * with the two buttons when it lists actions, one alert per session (the previous one is
 * closed first), the minute on screen, and the window raised on a click. Null when the bus
 * route could not show it (no bus, no server), and the next route tries.
 */
async function throughBus(
  alert: NotifyWorkerAlert,
  gdbus: string,
  deps: DesktopAlertDeps,
): Promise<null | DesktopAlertOutcome> {
  const capabilities = serverCapabilities(gdbus, deps.capture);
  if (capabilities === null) return null;
  const stateFile = shownStateFile(deps.stateDir, alert.session);
  const previous = readShownId(stateFile);
  if (previous !== null) {
    // One alert per session: the previous one leaves now (its own worker sees it close
    // without a click and ends without raising anything).
    deps.capture({ argv: closeCallArgv(gdbus, previous), timeoutMs: TOOL_TIMEOUT_MS });
  }
  const reply = deps.capture({
    argv: notifyCallArgv(gdbus, alert, capabilities.includes("actions")),
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  const id = notifiedId(reply);
  if (id === null) return null;
  writeShownId(stateFile, id);
  try {
    return await waitForClick(alert, id, gdbus, deps);
  } finally {
    forgetShownId(stateFile, id);
  }
}

/**
 * Waits for the click, and closes the alert on the minute. The signals are the server's:
 * an action (the `Open` button), or the close — a click on the popup itself arrives as
 * `dismissed` (reason 2), which the older notification script read as "open" too.
 */
async function waitForClick(
  alert: NotifyWorkerAlert,
  id: number,
  gdbus: string,
  deps: DesktopAlertDeps,
): Promise<DesktopAlertOutcome> {
  const click = gate();
  const monitor = deps.watch(
    [gdbus, "monitor", "--session", "--dest", NOTIFICATIONS_SERVICE],
    (line) => {
      const action = actionOf(line, id);
      if (action !== null) {
        click.open(action === "default");
        return;
      }
      const reason = closedReasonOf(line, id);
      if (reason !== null) click.open(reason === CLICKED_CLOSE_REASON);
    },
  );
  const raced = await Promise.race([
    click.waited.then((open) => ({ minute: false, open })),
    deps.sleep(deps.screenMs).then(() => ({ minute: true, open: false })),
  ]);
  monitor.stop();
  if (raced.minute) {
    // The minute is up: the alert leaves the screen, and the notification centre keeps it.
    deps.capture({ argv: closeCallArgv(gdbus, id), timeoutMs: TOOL_TIMEOUT_MS });
    return "shown";
  }
  if (!raced.open) return "shown";
  raise(alert, deps);
  return "raised";
}

/**
 * Shows the alert through `notify-send`, where that can wait for a click: null when it
 * cannot (the help does not list the flags, or the run fails — "Actions are not
 * supported"), and the caller falls back to the plain notification.
 */
async function throughNotifySend(
  alert: NotifyWorkerAlert,
  send: string,
  deps: DesktopAlertDeps,
): Promise<null | DesktopAlertOutcome> {
  const help = deps.capture({ argv: [send, "--help"], timeoutMs: TOOL_TIMEOUT_MS });
  const capabilities = notifySendCapabilities(help.stdout);
  if (!(capabilities.actions && capabilities.wait)) return null;
  const before = deps.nowMs();
  const asked = deps.capture({
    argv: notifySendAlertArgv(send, alert, capabilities, deps.screenMs),
    timeoutMs: deps.screenMs + TOOL_TIMEOUT_MS,
  });
  if (asked.exitCode !== 0) return null;
  const action = asked.stdout.trim();
  // A click on the popup itself arrives as no action at all, and it can only come before
  // the expiry: the expiry is what ends the wait by itself, and raising a window then would
  // be wrong. `notify-send` says nothing about which of the two it was, so a return inside
  // the minute (`TOOL_TIMEOUT_MS` of room for the server's clock against ours) counts as
  // the click — the same reading as the older script's, which the bus route gets exactly.
  const clicked =
    action === "default" ||
    (action === "" && !asked.timedOut && deps.nowMs() - before < deps.screenMs - TOOL_TIMEOUT_MS);
  if (!clicked) return "shown";
  raise(alert, deps);
  return "raised";
}

/**
 * The worker's whole job for the notifier's alert: the bus route where it is there, else
 * `notify-send` with the flags that wait, else the plain notification — never nothing
 * while a notifier is installed. "no notifier" tells the caller to say the words on stderr.
 */
export async function runDesktopAlert(
  alert: NotifyWorkerAlert,
  deps: DesktopAlertDeps,
): Promise<DesktopAlertOutcome> {
  const tools = desktopTools(deps.which);
  if (tools.gdbus !== null) {
    const outcome = await throughBus(alert, tools.gdbus, deps);
    if (outcome !== null) return outcome;
  }
  if (tools.notifySend !== null) {
    const outcome = await throughNotifySend(alert, tools.notifySend, deps);
    if (outcome !== null) return outcome;
  }
  const plain = notifyCommand(alert.body, "linux", deps.which, alert.title, alert.critical);
  if (plain === null) return "no notifier";
  deps.capture({ argv: plain, timeoutMs: TOOL_TIMEOUT_MS });
  return "shown";
}
