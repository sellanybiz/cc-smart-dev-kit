/**
 * The notifier hook: an alert when Claude needs the person, and when a turn ends or dies.
 * Machine-wide (`USER_HOOKS`): it reads no `cc-smart-dev-kit.json`, and its opt-in is the machine.
 *
 * Wired for one handler per event (`plugin/hooks/hooks.json`), so one alert per event:
 *   - `Notification`, matcher `permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|worker_permission_prompt`
 *     — the moments Claude asks for something. The idle wait (`idle_prompt`) is left out on
 *     purpose: the `Stop` notification already announced that finished turn.
 *   - `Stop` — the turn ended, with the turn's last answer as the message.
 *   - `PreToolUse` on `AskUserQuestion|ExitPlanMode` — Claude asks a question or shows a
 *     plan. Claude Code raises no `Notification` at that moment, so this covers it.
 *   - `PostToolUse` and `PostToolUseFailure` on the same tools, and `UserPromptSubmit` —
 *     that wait is over: the mark goes, nothing is shown.
 *   - `StopFailure` — the turn died on an error. A `rate_limit` stop is left to the StopFailure
 *     hook (the usage-limit alert) only when that hook will show one — a desktop, the gateway
 *     set up, a plan limit (`stopFailureWillAlert`); otherwise this hook alerts the way it does
 *     for any other error, on its own routes (the SSH terminal included). Never two alerts
 *     for one stop, and never none.
 *
 * One wait, one alert: while a question or plan waits, the permission prompt Claude Code may
 * raise about six seconds later is the same wait, not a new one, so a mark file holds from
 * the question until anything ends that wait. The `Notification` handler skips while the
 * mark is fresh. A "finished" alert for a turn another session started is skipped too
 * (`startedByPeer`), and a `StopFailure` alerts once per session per error until a turn ends
 * well.
 *
 * Three routes, one of them chosen per alert:
 *   - **the desktop**: `notify-send` on Linux (with a desktop to show it on), `osascript` on
 *     macOS, a PowerShell toast on Windows (`windowsToast`), and the freedesktop sound when
 *     `paplay` is there. Windows plays the sound of its own notification, so none is added.
 *   - **the SSH terminal**: with no desktop route here but a session over SSH
 *     (`SSH_CONNECTION` or `SSH_TTY`), the same alert goes to the terminal the person is
 *     looking at as OSC 777: through the hook's `terminalSequence` output field, which Claude
 *     Code writes out (and wraps for tmux itself) for the events whose answer it reads; for
 *     an event whose answer it does not read (`StopFailure`), or a Claude Code too old for
 *     the field, straight to a terminal device — `/dev/tty` first, and, where the hook has no
 *     controlling terminal at all (2.1.301: it fails with ENXIO), **the session's own
 *     device**, the pty Claude Code is attached to, found from its pid (`terminal.ts`). Both
 *     are wrapped for tmux here (`forTty`), and only one of them is ever written to.
 *   - **nothing**: no desktop route and not over SSH: silence, not a failure — a line on
 *     every turn would be noise.
 *
 * Inside Warp, Warp's own Claude Code plugin shows the finished turn, the question, the
 * permission prompt and the error itself, so ours stays quiet and plays only the sound
 * (Warp plays none on Linux); a question or an agent waiting may sit in a tab the person is
 * not looking at, so those stay ours (owner, 2026-10-11). Over plain SSH Warp's variables
 * are not forwarded, so the session gets our alert.
 *
 * **The workflow's alert settings** are read too (`alertsAt`, once per run, at the folder the
 * session is in): `alerts.events` says which of the four moments alert at all — a moment left
 * out is silence, for every event that would have shown it — and `alerts.sound` adds a sound
 * where the platform has one (macOS, and the SSH terminal's bell), on top of
 * `notify.json`'s own two. A settings file that cannot be read changes nothing here: the
 * alerts go on as they always did, with one line on stderr saying why.
 *
 * Every setting: `~/.claude/cc-smart-dev-kit/notify.json` (`readNotifyConfig`) and the
 * project's and person's workflow files (`src/workflow/alerts.ts`). A hook's output is read
 * only for the `terminalSequence` field here; every error is one short stderr line and exit
 * 0 — a notifier must never stop a session.
 */
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { oneLine } from "../gateway/plain-text";
import { notifyCommand } from "../update/apply";
import { alertsAt, type ResolvedAlerts } from "../workflow/alerts";
import type { AlertEvent } from "../workflow/schema";
import { type SoundName, soundArgv } from "./alert-sound";
import { startDetached } from "./detached";
import { type HookResult, SILENT } from "./io";
import type { Env } from "./run";
import { cleanSessionName } from "./session-name";
import { stopFailureWillAlert } from "./stop-failure";
import { lastAssistantText, lastCustomTitle, startedByPeer } from "./transcript";

/** The notification types that mean "Claude needs you", the ones `hooks.json` matches. */
export const NOTIFY_TYPES = [
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
  "worker_permission_prompt",
] as const;

/** The tools that mean "Claude asks you something", the ones `hooks.json` matches. */
export const ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"] as const;

/** What each notification type says when Claude Code's message is not usable. */
const TYPE_BODY: Readonly<Record<string, string>> = {
  agent_needs_input: "A background agent is waiting for you.",
  elicitation_dialog: "Claude asks you for input.",
  elicitation_url_dialog: "Claude asks you to open a page.",
  permission_prompt: "Claude is waiting for your permission.",
  worker_permission_prompt: "A background worker is waiting for your permission.",
};

/** The events that end a question's or a plan's wait; nothing is shown for them. */
export const WAIT_END_EVENTS = ["PostToolUse", "PostToolUseFailure", "UserPromptSubmit"] as const;

/** The longest text an alert shows (the desktop notifier and a terminal line both cut long ones). */
const MAX_TEXT = 180;

/** The longest title an alert carries. */
const MAX_TITLE = 80;

/** A question's or a plan's mark counts this long at most, so a wait that ended unrecorded never hides a later alert. */
export const ASK_MARK_MS = 10 * 60_000;

/** Claude Code writes the turn's last answer to the transcript just after the Stop event. */
export const TRANSCRIPT_FLUSH_MS = 300;

/** One alert to show. Every text is already one line, never empty, and capped. */
export interface Alert {
  body: string;
  /** The desktop keeps this one on screen, and its own Do Not Disturb does not hide it. */
  critical: boolean;
  title: string;
  /** The sound the desktop route plays for it; null: none. */
  sound: null | SoundName;
}

/**
 * The first Claude Code version with the hook output field `terminalSequence`: a hook's OSC
 * sequence is written to the session's terminal by Claude Code itself, which also works with
 * no controlling terminal. Older versions reject the unknown field.
 */
export const TERMINAL_SEQUENCE_MIN_VERSION = "2.1.141";

/**
 * The events whose hook output Claude Code reads, so `terminalSequence` reaches the terminal
 * there; every other event's answer is ignored and the hook writes a terminal device instead
 * (`/dev/tty`, then the session's own device: `terminalRoute`; docs/claude-code-contract.md,
 * proved live on 2.1.301).
 */
export const TERMINAL_SEQUENCE_EVENTS: readonly string[] = ["Notification", "PreToolUse", "Stop"];

/** Warp's own Claude Code plugin: its id, and the check its scripts make for the terminal. */
export const WARP_PLUGIN_ID = "warp@claude-code-warp";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A shown string: one line, controls gone, capped, with `fallback` when nothing is left. */
function shown(text: string, fallback: string): string {
  const line = oneLine(text, MAX_TEXT - 1, { mark: "…" });
  return line === "" ? fallback : line;
}

/** `kind · <the session's name>`; the name alone when the session has none. */
function titled(kind: string, label: null | string): string {
  const title = label === null ? kind : `${kind} · ${label}`;
  return oneLine(title, MAX_TITLE - 1, { mark: "…" });
}

/** The session id as part of a file name; ids from outside never become a path. */
function sessionKey(value: unknown): string {
  const key = (typeof value === "string" ? value : "none").replace(/[^A-Za-z0-9-]/g, "");
  return key === "" ? "none" : key;
}

/** The folder the notifier's own state files live in: the session's runtime folder, else the temp folder. */
export function runtimeDir(env: Env): string {
  return env.XDG_RUNTIME_DIR || tmpdir();
}

/** Removes a state file. A file that will not go only means one alert may be skipped. */
function forget(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // Nothing to do about it: the mark only decides whether one alert is shown.
  }
}

/** True when a question or plan is waiting and was already alerted about. */
function markedWaiting(file: string, nowMs: number): boolean {
  try {
    return nowMs - statSync(file).mtimeMs < ASK_MARK_MS;
  } catch {
    // No mark, or it cannot be read: nothing is waiting.
    return false;
  }
}

/** Records that a question or plan is waiting now. */
function markWaiting(file: string): void {
  try {
    writeFileSync(file, `${Date.now()}\n`);
  } catch {
    // A mark that cannot be written only means a later alert may come twice.
  }
}

/** True when the session runs over SSH: the terminal the person looks at is elsewhere. */
export function isSsh(env: Env): boolean {
  return (env.SSH_CONNECTION ?? "") !== "" || (env.SSH_TTY ?? "") !== "";
}

/**
 * True when Warp is the terminal this session runs in — the two checks Warp's own plugin
 * makes: `TERM_PROGRAM` (a Warp tab; not forwarded over plain SSH) and the `WARP_*` pair (a
 * background session keeps those but loses `TERM_PROGRAM`).
 */
export function isWarpTerminal(env: Env): boolean {
  if ((env.TERM_PROGRAM ?? "").toLowerCase() === "warpterminal") return true;
  return (
    (env.WARP_CLI_AGENT_PROTOCOL_VERSION ?? "") !== "" && (env.WARP_CLIENT_VERSION ?? "") !== ""
  );
}

/** True when Claude Code has Warp's own plugin installed and on: it shows the alerts itself. */
export function warpPluginOn(claudeConfigDir: string): boolean {
  try {
    const settings: unknown = JSON.parse(
      readFileSync(join(claudeConfigDir, "settings.json"), "utf8"),
    );
    if (!isJsonObject(settings) || !isJsonObject(settings.enabledPlugins)) return false;
    if (settings.enabledPlugins[WARP_PLUGIN_ID] !== true) return false;
  } catch {
    // No readable settings: Warp's plugin is not known to be on, so ours shows the alert.
    return false;
  }
  try {
    const installed: unknown = JSON.parse(
      readFileSync(join(claudeConfigDir, "plugins", "installed_plugins.json"), "utf8"),
    );
    if (!isJsonObject(installed) || !isJsonObject(installed.plugins)) return false;
    const entries = installed.plugins[WARP_PLUGIN_ID];
    return Array.isArray(entries) && entries.length > 0;
  } catch {
    // No readable plugin list: as above, ours shows the alert rather than none.
    return false;
  }
}

/**
 * True when Warp's own plugin shows this alert itself: its hooks cover the finished turn, the
 * question, the plan, the permission prompt and the error. A question from another session or
 * a background agent waiting may sit in a tab the person is not looking at, and Warp shows
 * those only in its own window, so they stay ours (owner, 2026-10-11).
 */
export function warpShowsIt(event: string, input: Record<string, unknown>): boolean {
  if (event !== "Notification") return true;
  const type = typeof input.notification_type === "string" ? input.notification_type : "";
  return !(type.startsWith("elicitation") || type === "agent_needs_input");
}

/** The session's name for the alert's title: its own name, else its folder. */
export function sessionLabel(transcript: null | string, cwd: null | string): null | string {
  if (transcript !== null) {
    const named = lastCustomTitle(transcript);
    const clean = named === null ? null : cleanSessionName(named);
    if (clean !== null) return clean;
  }
  if (cwd === null) return null;
  const folder = basename(cwd);
  return folder === "" || folder === "." ? null : cleanSessionName(folder);
}

/** What one alert's decision reads besides the input. */
export interface AlertContext {
  /** The file that marks a question or a plan waiting. */
  mark: string;
  /** The file that remembers the last error this session alerted about. */
  failed: string;
  /** The session's name for the title. */
  label: null | string;
  nowMs: number;
  /** The session's transcript, when the input names one. */
  transcript: null | string;
  /**
   * True when this stop's usage-limit alert is the StopFailure hook's own
   * (`stopFailureWillAlert`): where it is, this hook stays quiet for a `rate_limit` stop.
   */
  limitAlertIsStopFailures: boolean;
}

/** Writes the mark for a question or a plan, and says what to show. */
function askAlert(input: Record<string, unknown>, ctx: AlertContext): Alert {
  markWaiting(ctx.mark);
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const toolInput = isJsonObject(input.tool_input) ? input.tool_input : {};
  if (tool === "ExitPlanMode") {
    return {
      body: "A plan is ready for your OK",
      critical: true,
      sound: "service-login",
      title: titled("Claude asks you", ctx.label),
    };
  }
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  const first = questions.find((question) => isJsonObject(question) && question !== null);
  const asked =
    (isJsonObject(first) && typeof first.question === "string" ? first.question : null) ??
    (typeof toolInput.question === "string" ? toolInput.question : null) ??
    "";
  return {
    body: shown(asked, "Claude has a question for you"),
    critical: true,
    sound: "service-login",
    title: titled("Claude asks you", ctx.label),
  };
}

/**
 * The alert this event asks for, or null when there is none: another event, an idle wait, a
 * waiting question already alerted about, or a turn another session started. The mark and
 * failed files are read and written here; the wait that ended was cleared before this.
 */
export function alertFor(
  input: Record<string, unknown>,
  event: string,
  ctx: AlertContext,
): Alert | null {
  switch (event) {
    case "StopFailure": {
      forget(ctx.mark);
      // The plan's usage limit is the StopFailure hook's alert where that hook will show one
      // (a desktop, the gateway set up, a plan limit — `stopFailureWillAlert`): never two
      // alerts for one stop. Where it has no route or no gateway, this hook alerts instead,
      // on its own routes. A short rate limit is no plan limit, so it is ours too.
      if (input.error === "rate_limit" && ctx.limitAlertIsStopFailures) return null;
      const key = typeof input.error === "string" ? input.error : "unknown";
      if (readFailed(ctx.failed) === key) return null;
      writeFailed(ctx.failed, key);
      const text =
        typeof input.last_assistant_message === "string"
          ? input.last_assistant_message
          : typeof input.message === "string"
            ? input.message
            : "";
      return {
        body: shown(text, "The turn ended with an error"),
        critical: true,
        sound: "dialog-warning",
        title: titled("Claude stopped", ctx.label),
      };
    }
    case "Stop": {
      forget(ctx.mark);
      forget(ctx.failed);
      // A Stop hook that made Claude continue fires Stop again: alert once.
      if (input.stop_hook_active === true) return null;
      // A turn another session started (a merge broadcast, a heads-up) ends silently.
      if (ctx.transcript !== null && startedByPeer(ctx.transcript)) return null;
      const answer = ctx.transcript === null ? null : waitThenLastAnswer(ctx.transcript);
      return {
        body: shown(answer ?? "", "Claude finished its turn."),
        critical: false,
        sound: "service-logout",
        title: titled("Claude finished", ctx.label),
      };
    }
    case "PreToolUse": {
      if (!(ASK_TOOLS as readonly string[]).includes(String(input.tool_name ?? ""))) return null;
      return askAlert(input, ctx);
    }
    case "Notification": {
      const type = typeof input.notification_type === "string" ? input.notification_type : "";
      if (!(NOTIFY_TYPES as readonly string[]).includes(type)) return null;
      if (markedWaiting(ctx.mark, ctx.nowMs)) return null;
      const message = typeof input.message === "string" ? input.message : "";
      return {
        body: shown(message, TYPE_BODY[type] ?? "Claude needs you."),
        critical: true,
        sound: "service-login",
        title: titled("Claude needs you", ctx.label),
      };
    }
    default:
      return null;
  }
}

/** The turn's last answer, after the short wait for Claude Code to finish writing it. */
function waitThenLastAnswer(transcript: string): null | string {
  Bun.sleepSync(TRANSCRIPT_FLUSH_MS);
  return lastAssistantText(transcript);
}

/** The last error key this session alerted about, or null. */
function readFailed(file: string): null | string {
  try {
    const text = readFileSync(file, "utf8").trim();
    return text === "" ? null : text;
  } catch {
    // No record yet: nothing was alerted about.
    return null;
  }
}

/** Remembers the error key this session alerted about. */
function writeFailed(file: string, key: string): void {
  try {
    writeFileSync(file, key);
  } catch {
    // A record that cannot be written only means a repeat error may alert again.
  }
}

/** How the sequence reaches the session's terminal. */
export type TerminalRoute = "field" | "field-if-no-tty" | "tty";

/**
 * How this event's alert should reach the terminal:
 *   - `field`: the hook's answer carries `terminalSequence` (Claude Code 2.1.141+) and Claude
 *     Code writes it to the session's terminal itself. This is the route for a session with no
 *     controlling terminal, and the one that reaches a tmux pane the same way.
 *   - `field-if-no-tty`: Claude Code's version is not in the environment (2.1.301 does not set
 *     `CLAUDE_CODE_VERSION` for hooks). `/dev/tty` is tried first — it is the route an older
 *     Claude Code needs, which rejects the unknown field — and the field is the fallback for a
 *     hook that has no terminal at all. Proved live: on 2.1.301 `/dev/tty` fails with ENXIO
 *     (Claude Code gives a hook no controlling terminal), so the field carries the alert.
 *   - `tty`: this event's answer is not read, or the version is known to be too old for the
 *     field: `/dev/tty` first, and the session's own terminal device when the hook has no
 *     controlling terminal (`writeSessionTerminal`; only one of the two is ever written to).
 *     Both are POSIX devices and neither exists on Windows (`ttyDevice`), so there this route
 *     writes nothing: the desktop toast is the alert's way out (docs/windows-notify.md).
 */
export function terminalRoute(event: string, env: Env): TerminalRoute {
  if (!TERMINAL_SEQUENCE_EVENTS.includes(event)) return "tty";
  const raw = env.CLAUDE_CODE_VERSION;
  if (raw === undefined || raw === "") return "field-if-no-tty";
  return versionAtLeast(raw, TERMINAL_SEQUENCE_MIN_VERSION) ? "field" : "tty";
}

/** True when `raw` (a version text) is at least `min` (a dotted version). No version: false. */
export function versionAtLeast(raw: null | string | undefined, min: string): boolean {
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(raw ?? "");
  if (found === null) return false;
  const parts = [1, 2, 3].map((index) => Number(found[index]));
  const least = min.split(".").map(Number);
  for (const [index, want] of least.entries()) {
    const have = parts[index] ?? 0;
    if (have !== want) return have > want;
  }
  return true;
}

/** The alert as a terminal escape sequence: OSC 777, `ESC ] 777 ; notify ; <title> ; <body> BEL`. */
export function notifySequence(title: string, body: string): string {
  // The fields are separated by `;`, and a terminal reads the body as everything after the
  // title: a `;` in the title would push the body into it, so it becomes a comma. The body
  // is the last field and keeps its own `;`.
  return `\u001b]777;notify;${title.replaceAll(";", ",")};${body}\u0007`;
}

/**
 * A sequence inside tmux's passthrough wrapper: `ESC Ptmux;` + the sequence with every ESC
 * doubled + `ESC \`. tmux forwards a wrapped sequence from a pane to the terminal beyond it
 * (a plain OSC 777 from a pane is dropped), and only while `allow-passthrough` allows it
 * (`all`: even from a window the person is not looking at, which `cc-smart-dev-kit setup` writes
 * into `~/.tmux.conf`).
 *
 * This wrapper is for the `/dev/tty` route only. A `terminalSequence` in the hook's answer
 * must be the bare sequence: Claude Code wraps it for tmux itself, and rejects a wrapped one
 * (the field's allowlist is OSC 0/1/2/9/99/777 and BEL; proved live on 2.1.301,
 * docs/claude-code-contract.md).
 */
export function tmuxPassthrough(sequence: string): string {
  return `\u001bPtmux;${sequence.replaceAll("\u001b", "\u001b\u001b")}\u001b\\`;
}

/**
 * The sequence as `/dev/tty` must receive it: inside tmux, wrapped once here, because
 * Claude Code is not the one writing it (older versions, whose hooks may still have a
 * terminal).
 */
export function forTty(sequence: string, env: Env): string {
  return (env.TMUX ?? "") === "" ? sequence : tmuxPassthrough(sequence);
}

/** The notifier's settings, from `~/.claude/cc-smart-dev-kit/notify.json`. */
export interface NotifyConfig {
  /** Play the freedesktop sound with a desktop notification. Default: on. */
  desktopSound: boolean;
  /** Send a terminal bell after an SSH alert. Default: off — the alert itself is the signal. */
  sshBell: boolean;
}

/** Every setting's default; a file that is missing, broken or holds another kind keeps them. */
export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = { desktopSound: true, sshBell: false };

/** The settings from `file`: a broken or missing file, and every other value, means the defaults. */
export function readNotifyConfig(file: string): NotifyConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // No file yet, or a broken one: the defaults, and never a failure — the person may not
    // have written one at all.
    return DEFAULT_NOTIFY_CONFIG;
  }
  if (!isJsonObject(parsed)) return DEFAULT_NOTIFY_CONFIG;
  return {
    desktopSound: typeof parsed.desktopSound === "boolean" ? parsed.desktopSound : true,
    sshBell: parsed.sshBell === true,
  };
}

/** One program run, fire and forget: what the alert is shown with. */
export type NotifyRunner = (argv: string[]) => void;

/**
 * The real runner for `platform`: the notifier starts detached from the hook, which does not
 * wait for it. A notification that waits for a click (or a slow daemon) must not hold the
 * hook, and Claude Code exits after a `Stop` hook in `claude -p`: the detached program still
 * shows it. On Windows that takes the `cmd /c start` trampoline — a detached child dies with
 * its hook there (`detached.ts`).
 */
export function spawnNotifyFor(platform: NodeJS.Platform): NotifyRunner {
  return (argv) => {
    startDetached(platform, argv, {
      onError: (message) =>
        console.error(`cc-smart-dev-kit notify: could not show the notification: ${message}`),
    });
  };
}

export interface NotifyDeps {
  env: Env;
  platform: NodeJS.Platform;
  /** Finds a program on PATH (the real one: `Bun.which` with the hook's PATH). */
  which: (command: string) => null | string;
  /** Starts a program detached: the notifier, the sound. */
  run: NotifyRunner;
  /** The plugin's paths: the Claude config folder, and `notify.json`. */
  paths: CliPaths;
  /** The clock, for the mark that keeps one wait from alerting twice. */
  nowMs: number;
  /** Writes one sequence to the session's terminal (`/dev/tty`); false when there is none. */
  writeTerminal: (sequence: string) => boolean;
  /**
   * Writes one sequence to the session's **own** terminal device (the pty Claude Code is
   * attached to, `sessionTerminalDevice`); false when there is none, or it is not this
   * user's. This is the route for an event whose answer Claude Code does not read, on a
   * Claude Code whose hook has no controlling terminal (`/dev/tty` fails with ENXIO there).
   */
  writeSessionTerminal: (sequence: string) => boolean;
}

/** The desktop's own notifier command, or null: no desktop route on this machine. */
function desktopCommand(alert: Alert, deps: NotifyDeps): null | string[] {
  // On Linux a desktop notification needs a desktop (`DISPLAY`: X, or a Wayland session that
  // sets it). Without one — an SSH session, a headless machine — `notify-send` has no bus to
  // show anything on, so the terminal route is the one that works. Windows always has a
  // desktop, so its route is the toast `notifyCommand` builds, whenever PowerShell is there.
  if (deps.platform === "linux" && (deps.env.DISPLAY ?? "") === "") return null;
  return notifyCommand(alert.body, deps.platform, deps.which, alert.title, alert.critical);
}

/**
 * Plays the alert's sound on the desktop route, detached, when this machine has a player and
 * a sound is wanted. A sound is wanted when either the person turned it on in
 * `notify.json` (`desktopSound`, on by default — today's behaviour) or the project or the
 * person asked for one in the workflow (`alerts.sound`). Which program plays it, and on
 * which platform: `alert-sound.ts`.
 */
function playSound(
  alert: Alert,
  deps: NotifyDeps,
  config: NotifyConfig,
  alerts: ResolvedAlerts,
): void {
  if (alert.sound === null || !(config.desktopSound || alerts.sound.value)) return;
  const argv = soundArgv(alert.sound, deps.platform, deps.which);
  if (argv !== null) deps.run(argv);
}

/**
 * The alert moment a hook event is, for `alerts.events`. Only the events `alertFor` accepts
 * reach this, so it maps by the event alone — which notification types and which tools count
 * is decided in one place (`alertFor`, and `hooks.json`).
 */
export const ALERT_EVENT_OF: Readonly<Record<string, AlertEvent>> = {
  Notification: "needs-you",
  PreToolUse: "question",
  Stop: "finished",
  StopFailure: "failed",
};

/**
 * The hook's work: show the alert for this event, or stay quiet. At most one alert per
 * event. Anything that goes wrong is one short line on stderr (the entry), and the session
 * goes on.
 */
export function notifyHook(input: unknown, event: string, deps: NotifyDeps): HookResult {
  if (!isJsonObject(input)) return SILENT;
  // Only Claude Code in a terminal: the desktop app notifies by itself and the VS Code
  // extension marks its tab. CLAUDE_CODE_ENTRYPOINT is what Claude Code sets for itself
  // ("cli" in a terminal, "sdk-cli" in `claude -p`, where nobody watches a terminal), and a
  // missing one counts as the terminal rather than silencing every alert.
  if ((deps.env.CLAUDE_CODE_ENTRYPOINT ?? "cli") !== "cli") return SILENT;

  const session = sessionKey(input.session_id);
  const dir = runtimeDir(deps.env);
  const mark = join(dir, `cc-smart-dev-kit-notify-asked-${session}`);
  const failed = join(dir, `cc-smart-dev-kit-notify-failed-${session}`);
  if ((WAIT_END_EVENTS as readonly string[]).includes(event)) {
    // The wait that had a question or a plan at its centre is over: its mark goes, so the
    // next one starts clean. Nothing is shown for these events.
    forget(mark);
    return SILENT;
  }

  const transcript = typeof input.transcript_path === "string" ? input.transcript_path : null;
  const cwd = typeof input.cwd === "string" ? input.cwd : null;
  // Asked only for a limit stop: the StopFailure hook shows that alert itself where it can,
  // and this hook must not be the second one (or, where it cannot, the missing one).
  const limitAlertIsStopFailures =
    event === "StopFailure" && input.error === "rate_limit"
      ? stopFailureWillAlert(input, {
          env: deps.env,
          nowMs: deps.nowMs,
          paths: deps.paths,
          platform: deps.platform,
          which: deps.which,
        })
      : false;
  const alert = alertFor(input, event, {
    failed,
    label: sessionLabel(transcript, cwd),
    limitAlertIsStopFailures,
    mark,
    nowMs: deps.nowMs,
    transcript,
  });
  if (alert === null) return SILENT;

  // The alerts' own settings, once per run, at the folder the session is in: which moments
  // alert, and whether a sound goes with them. Read only here, where there is an alert to
  // show; a file that cannot be read keeps today's behaviour and says so on stderr.
  const here = alertsAt(deps.paths, cwd, deps.env);
  const kind = ALERT_EVENT_OF[event];
  if (kind !== undefined && !here.alerts.events.value.includes(kind)) {
    // The person asked for no alert at this moment. The mark written above goes with it: a
    // question with no alert must not hide the permission prompt that follows it, which is
    // the same wait and may be a moment the person does want to hear about.
    if (event === "PreToolUse") forget(mark);
    return withProblem(SILENT, here.problem);
  }

  const config = readNotifyConfig(deps.paths.notifyConfigFile);
  const argv = desktopCommand(alert, deps);
  if (isWarpTerminal(deps.env) && warpPluginOn(deps.paths.claudeConfigDir)) {
    if (warpShowsIt(event, input)) {
      // Warp's own plugin shows this one itself, in its window while it is in front and as
      // its own notification while it is not; ours would be the second alert for one event.
      // The sound is still ours, where there is a desktop to play it on: Warp plays none on
      // Linux (its sound setting is macOS-only).
      if (argv !== null) playSound(alert, deps, config, here.alerts);
      return withProblem(SILENT, here.problem);
    }
  }

  if (argv !== null) {
    playSound(alert, deps, config, here.alerts);
    deps.run(argv);
    return withProblem(SILENT, here.problem);
  }

  if (!isSsh(deps.env)) return withProblem(SILENT, here.problem);
  // The same alert, into the terminal the person is looking at, as OSC 777. The field
  // carries the bare sequence: Claude Code writes it out, and wraps it for tmux itself.
  const sequence =
    config.sshBell || here.alerts.sound.value
      ? `${notifySequence(alert.title, alert.body)}\u0007`
      : notifySequence(alert.title, alert.body);
  const route = terminalRoute(event, deps.env);
  if (route === "field") return withProblem(fieldAnswer(sequence), here.problem);
  const onTty = forTty(sequence, deps.env);
  if (route === "tty") {
    // This event's answer is not read (StopFailure), or the Claude Code is too old for the
    // field: `/dev/tty` first — the route an older Claude Code needs, wrapped for tmux here
    // — and, when the hook has no controlling terminal (2.1.301: ENXIO), the session's own
    // terminal device, which is the pty Claude Code runs on (`writeSessionTerminal`).
    // Never both: one alert.
    if (deps.writeTerminal(onTty)) return withProblem(SILENT, here.problem);
    deps.writeSessionTerminal(onTty);
    return withProblem(SILENT, here.problem);
  }
  // The version is not known: /dev/tty, or the field when the hook has no terminal at all.
  return deps.writeTerminal(onTty)
    ? withProblem(SILENT, here.problem)
    : withProblem(fieldAnswer(sequence), here.problem);
}

/** The hook's answer that has Claude Code write the sequence to the session's terminal. */
function fieldAnswer(sequence: string): HookResult {
  return { stdout: JSON.stringify({ terminalSequence: sequence }) };
}

/**
 * The answer with the alert settings' own line on stderr, when reading them fell back to the
 * defaults. A hook's stderr is one short line: an answer that already says something keeps it.
 */
function withProblem(result: HookResult, problem: null | string): HookResult {
  if (problem === null || result.stderr !== undefined) return result;
  return { ...result, stderr: problem };
}
