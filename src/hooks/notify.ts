/**
 * The notifier hook: an alert when Claude needs the person, and when a turn ends or dies.
 * Machine-wide (`USER_HOOKS`): it reads no `cc-smart-dev-kit.json`, and its opt-in is the machine.
 *
 * Wired for one handler per event (`plugin/hooks/hooks.json`), so one alert per event:
 *   - `Notification`, matcher `permission_prompt|elicitation_dialog|elicitation_url_dialog|worker_permission_prompt`
 *     (`PLUGIN_NOTIFY_TYPES`) — the moments a session's own process asks for something. The
 *     idle wait (`idle_prompt`) is left out on purpose: the `Stop` notification already
 *     announced that finished turn. Agent view's own `agent_needs_input` and
 *     `agent_completed` (`AGENT_VIEW_TYPES`) are raised in the list's process, which runs no
 *     plugin hooks: `cc-smart-dev-kit setup` wires them in the person's user settings
 *     through `cc-smart-dev-kit hook notify` (`src/setup/user-notify-hook.ts`). The code
 *     accepts both lists (`NOTIFY_TYPES`), so either wiring gets the same handling.
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
 *   - **the desktop**: `notify-send` on Linux (with a desktop to show it on) — and, where
 *     the installed launcher and one of the desktop's own tools are there, the detached
 *     `alert-worker` in its place: it waits for a click that raises the session's terminal
 *     window, keeps one alert per session on screen, and moves the alert to the
 *     notification centre after a minute (`desktop-alert.ts`: the extras the older
 *     notification script had, ported) — `osascript` on macOS, a PowerShell toast on
 *     Windows (`windowsToast`), and the freedesktop sound when `paplay` is there, with
 *     XFCE's Do Not Disturb silencing an ordinary alert's sound. Windows plays the sound
 *     of its own notification, so none is added.
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
 * (Warp plays none on Linux); a question, an agent waiting or agent view's finished/failed
 * alert may sit in a tab the person is not looking at (and Warp's plugin has no
 * `agent_completed`), so those stay ours (owner, 2026-10-11). Over SSH Warp's variables are
 * not forwarded, so the session gets our alert — in Warp's own agent format when the far end
 * is Warp (`farEndIsWarp`): Warp shows its popup while it is in front, and a desktop
 * notification with a sound while it is not (proved live on a Windows PC reached over SSH,
 * `docs/claude-code-contract.md`). The plain OSC 777 gives a silent Windows notification only.
 *
 * A background session (`CLAUDE_JOB_DIR`, `background-session.ts`) shows no alert of its own:
 * it inherits the daemon's display and terminal variables, so its alerts would go to the wrong
 * place. Agent view alerts for it while the list is open (`agent_needs_input`,
 * `agent_completed`), and those alerts carry no session name of their own: the hook input is
 * the list's, not the background session's.
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
import { inBackgroundSession } from "./background-session";
import {
  canWaitForClick,
  desktopTools,
  dndOn,
  hasDesktop,
  type NotifyTarget,
  notifyWorkerAlert,
} from "./desktop-alert";
import { startDetached } from "./detached";
import { type HookResult, SILENT } from "./io";
import { AGENT_VIEW_TYPES, NOTIFY_TYPES } from "./notify-types";
import type { Env } from "./run";
import { cleanSessionName } from "./session-name";
import { ALERT_WORKER_COMMAND, type Runner, stopFailureWillAlert } from "./stop-failure";
import { lastAssistantText, lastCustomTitle, startedByPeer } from "./transcript";

/**
 * The types and the two matchers live in `notify-types.ts`, which imports nothing: this
 * module reaches `cli/setup` through `src/workflow/`, which imports the managed user hook,
 * so a constant defined here would sit in an import cycle. Re-exported here because the
 * hook's own code, its tests and `doctor` read them from this module.
 */
export {
  AGENT_VIEW_MATCHER,
  AGENT_VIEW_TYPES,
  NOTIFY_MATCHER,
  NOTIFY_TYPES,
  PLUGIN_NOTIFY_TYPES,
} from "./notify-types";

/** The tools that mean "Claude asks you something", the ones `hooks.json` matches. */
export const ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"] as const;

/** What agent view's `agent_completed` says when its message is not usable. */
const AGENT_FINISHED_BODY = "A background session finished.";
const AGENT_FAILED_BODY = "A background session failed.";

/** What each notification type says when Claude Code's message is not usable. */
const TYPE_BODY: Readonly<Record<string, string>> = {
  agent_completed: AGENT_FINISHED_BODY,
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
  /** The moment it is, for `workflow.alerts.events`: `alertFor` sets it with the words. */
  moment: AlertEvent;
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

/** Warp's agent alert: the address after OSC 777's `notify`, and the protocol version it carries. */
export const WARP_AGENT_TITLE = "warp://cli-agent";
export const WARP_AGENT_PROTOCOL = 1;

/** The name Warp gives itself: in `TERM_PROGRAM` in a Warp tab, and in `LC_TERMINAL` as a client sends it over ssh. */
const WARP_TERMINAL_NAME = "warpterminal";

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
  if ((env.TERM_PROGRAM ?? "").toLowerCase() === WARP_TERMINAL_NAME) return true;
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
 * those only in its own window, so they stay ours (owner, 2026-10-11). Agent view's finished
 * or failed alert is ours too: Warp's plugin has no `agent_completed`.
 */
export function warpShowsIt(event: string, input: Record<string, unknown>): boolean {
  if (event !== "Notification") return true;
  const type = typeof input.notification_type === "string" ? input.notification_type : "";
  return !(
    type.startsWith("elicitation") || (AGENT_VIEW_TYPES as readonly string[]).includes(type)
  );
}

/**
 * The event Warp's agent format carries for this alert. One mapping: `warpAgentSequence` uses
 * it. **Never `agent_needs_input`**: Warp showed only a tab badge for it and no popup, while
 * `permission_request` showed the popup (proved live on Windows Warp, 2026-10-19), so every
 * wait and question goes as `permission_request`.
 */
export function warpEventOf(alert: Alert): string {
  if (alert.moment === "finished") return "stop";
  if (alert.moment === "failed") return "stop_failure";
  return "permission_request";
}

/**
 * The alert in Warp's own agent format, for a session whose far end is Warp: OSC 777 with
 * `warp://cli-agent` and a JSON object — `{v, agent, event, session_id, cwd, project}`, then
 * the event's own fields: `response` for a stop, `response` and, only when the input names a
 * real error, `error_type`, for a failure, `summary` for a wait or a question. Every wait and
 * question carries `permission_request`: the event Warp showed a popup for, where
 * `agent_needs_input` gave only a tab badge (proved live 2026-10-19, `warpEventOf`). Warp
 * shows its popup while it is in front, and a desktop notification with a sound while it is
 * not (proved live over SSH from a pane without Warp's shell integration, `docs/claude-code-contract.md`). The body
 * is already one line without control characters (`shown`), and `JSON.stringify` escapes what
 * is left.
 */
export function warpAgentSequence(alert: Alert, input: Record<string, unknown>): string {
  const cwd = typeof input.cwd === "string" ? input.cwd : "";
  const event = warpEventOf(alert);
  const payload: Record<string, unknown> = {
    v: WARP_AGENT_PROTOCOL,
    agent: "claude",
    event,
    session_id: typeof input.session_id === "string" ? input.session_id : "",
    cwd,
    project: cwd === "" ? "" : basename(cwd),
  };
  if (event === "stop" || event === "stop_failure") payload.response = alert.body;
  else payload.summary = alert.body;
  // Warp shows `error_type` as a prefix of the text ("unknown: …"), so it carries only a real
  // StopFailure reason: an `agent_completed` failure names none, and "unknown" would show.
  if (event === "stop_failure" && typeof input.error === "string" && input.error !== "") {
    payload.error_type = input.error;
  }
  return `\u001b]777;notify;${WARP_AGENT_TITLE};${JSON.stringify(payload)}\u0007`;
}

/**
 * True when the terminal at the far end of an SSH session is Warp. The session's own
 * environment says so when it can: Warp in this session (`isWarpTerminal`); a terminal that
 * names itself in `TERM_PROGRAM` (VS Code says `vscode`) — tmux's own `tmux` says nothing
 * about the far end, so it decides nothing; or `LC_TERMINAL`, which an SSH client sends with
 * `SetEnv` and the server's sshd lets through with its usual `AcceptEnv LANG LC_*` (the
 * convention iTerm2 uses too, so only `WarpTerminal` counts). With none of them, the person's
 * own fallback setting decides (`notify.json`'s `sshWarp`).
 */
export function farEndIsWarp(env: Env, config: NotifyConfig): boolean {
  if (isWarpTerminal(env)) return true;
  const program = env.TERM_PROGRAM ?? "";
  if (program !== "" && program.toLowerCase() !== "tmux") return false;
  const client = env.LC_TERMINAL ?? "";
  if (client !== "") return client.toLowerCase() === WARP_TERMINAL_NAME;
  return config.sshWarp;
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
      moment: "question",
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
    moment: "question",
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
        moment: "failed",
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
        moment: "finished",
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
      const agentView = (AGENT_VIEW_TYPES as readonly string[]).includes(type);
      // Agent view raises these in the list's own process, with the list's session and
      // folder: the per-session question mark is not about them.
      if (!agentView && markedWaiting(ctx.mark, ctx.nowMs)) return null;
      const message = typeof input.message === "string" ? input.message : "";
      if (type === "agent_completed") {
        // The list says which it was in one word: "<label> finished" or "<label> failed".
        const failed = message.endsWith(" failed");
        return {
          body: shown(message, failed ? AGENT_FAILED_BODY : AGENT_FINISHED_BODY),
          critical: failed,
          moment: failed ? "failed" : "finished",
          sound: failed ? "dialog-warning" : "service-logout",
          title: titled(failed ? "Claude stopped" : "Claude finished", null),
        };
      }
      return {
        body: shown(message, TYPE_BODY[type] ?? "Claude needs you."),
        critical: true,
        moment: "needs-you",
        sound: "service-login",
        title: titled("Claude needs you", agentView ? null : ctx.label),
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
export type TerminalRoute = "device-then-field" | "field" | "field-if-no-tty" | "tty";

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
 *   - `device-then-field`: agent view's own alerts (`AGENT_VIEW_TYPES`). They come from the
 *     list (`claude agents`), which reads the field but never writes it out — only a session's
 *     conversation view sets up that writer (2.1.302, docs/claude-code-contract.md) — so the
 *     devices come first, as for `tty`: the list's own pty is where its alert lands
 *     (`CLAUDE_PID` is the list's pid). With no device (a host without `/proc`), the field
 *     still carries the alert a session's own `agent_needs_input` raises. One write either way.
 */
export function terminalRoute(event: string, env: Env, notificationType = ""): TerminalRoute {
  if (!TERMINAL_SEQUENCE_EVENTS.includes(event)) return "tty";
  if (
    event === "Notification" &&
    (AGENT_VIEW_TYPES as readonly string[]).includes(notificationType)
  ) {
    return "device-then-field";
  }
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
  /**
   * The fallback for an SSH session whose far end names no terminal: treat it as Warp and
   * send Warp's agent format. Default: off. `LC_TERMINAL=WarpTerminal` decides by itself,
   * so this is only for a server whose sshd does not forward it.
   */
  sshWarp: boolean;
}

/** Every setting's default; a file that is missing, broken or holds another kind keeps them. */
export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  desktopSound: true,
  sshBell: false,
  sshWarp: false,
};

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
    sshWarp: parsed.sshWarp === true,
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
  /** Runs a short program now and captures its stdout: the Do Not Disturb check, and the
   * decision that a click can be waited for. Never a program that waits. */
  capture: Runner;
  /** The plugin's paths: the Claude config folder, and `notify.json`. */
  paths: CliPaths;
  /**
   * The installed launcher (`~/.local/bin/cc-smart-dev-kit`), when setup wrote it: the
   * worker that waits for a click runs from the installed version, never from this hook's
   * version folder, which an update may delete while it waits.
   */
  launcher: null | string;
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

/**
 * The one-alert-per-session key of agent view's alert: the list's session plus the background
 * session the message names ("<label> needs your input…", "<label> finished" or "<label>
 * failed"), so one background session's alert never closes another's on the desktop, while a
 * session's "finished" still replaces its own "needs your input".
 */
export function agentViewKey(session: string, message: string): string {
  const named = message.replace(/ (?:needs your input(?:: [\s\S]*)?|finished|failed)$/, "");
  return `${session}-${Bun.hash(named).toString(36)}`;
}

/**
 * What the desktop alert needs about this session (the worker's window hint): its folder
 * and name for a VS Code or Warp window, the terminal's own `WINDOWID`, and the session id
 * for the one-alert-per-session record.
 */
function desktopTarget(
  deps: NotifyDeps,
  cwd: null | string,
  label: null | string,
  session: string,
): NotifyTarget {
  return {
    folder: cwd === null ? "" : basename(cwd),
    name: label ?? "",
    program: deps.env.TERM_PROGRAM ?? "",
    session,
    windowId: deps.env.WINDOWID ?? "",
  };
}

/**
 * The desktop's own notifier command, or null: no desktop route on this machine (`notify.ts`
 * § The routes).
 *
 * On Linux this is the **detached worker** where it can do better than a plain
 * notification — wait for a click, raise the session's window, close the alert on the
 * minute — and today's plain `notify-send` everywhere else (`notifyCommand`). Without one
 * of the two tools the worker needs (`canWaitForClick`) there is nothing to wait for, and
 * the direct notification stays: one sender either way, never both. macOS and Windows are
 * unchanged (`osascript`, the PowerShell toast).
 */
function desktopCommand(alert: Alert, deps: NotifyDeps, target: NotifyTarget): null | string[] {
  if (deps.platform === "linux") {
    if (!hasDesktop(deps.platform, deps.env)) return null;
    if (deps.launcher !== null && canWaitForClick(desktopTools(deps.which), deps.capture)) {
      return [
        deps.launcher,
        ALERT_WORKER_COMMAND,
        JSON.stringify(notifyWorkerAlert(alert, target)),
      ];
    }
  }
  return notifyCommand(alert.body, deps.platform, deps.which, alert.title, alert.critical);
}

/**
 * Plays the alert's sound on the desktop route, detached, when this machine has a player and
 * a sound is wanted. A sound is wanted when either the person turned it on in
 * `notify.json` (`desktopSound`, on by default — today's behaviour) or the project or the
 * person asked for one in the workflow (`alerts.sound`). Which program plays it, and on
 * which platform: `alert-sound.ts`.
 *
 * XFCE's Do Not Disturb silences an ordinary alert's sound (an urgent one sounds anyway —
 * XFCE shows those under Do Not Disturb too): the older notification script's own check,
 * `xfconf-query` reading `/do-not-disturb` (`desktop-alert.ts`). The popup itself is the
 * notification server's business: under Do Not Disturb it stays off the screen and the
 * centre keeps it, so the alert is not lost.
 */
function playSound(
  alert: Alert,
  deps: NotifyDeps,
  config: NotifyConfig,
  alerts: ResolvedAlerts,
): void {
  if (alert.sound === null || !(config.desktopSound || alerts.sound.value)) return;
  if (
    !alert.critical &&
    deps.platform === "linux" &&
    dndOn(desktopTools(deps.which), deps.capture)
  ) {
    return;
  }
  const argv = soundArgv(alert.sound, deps.platform, deps.which);
  if (argv !== null) deps.run(argv);
}

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
  // A background session shows no alert of its own: it inherits the daemon's display and
  // terminal variables, so its alerts would go to the wrong place. Agent view alerts for it
  // while the list is open (`background-session.ts`).
  if (inBackgroundSession(deps.env)) return SILENT;

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
  const label = sessionLabel(transcript, cwd);
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
    label,
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
  if (!here.alerts.events.value.includes(alert.moment)) {
    // The person asked for no alert at this moment. The mark written above goes with it: a
    // question with no alert must not hide the permission prompt that follows it, which is
    // the same wait and may be a moment the person does want to hear about.
    if (event === "PreToolUse") forget(mark);
    return withProblem(SILENT, here.problem);
  }

  const config = readNotifyConfig(deps.paths.notifyConfigFile);
  const type = typeof input.notification_type === "string" ? input.notification_type : "";
  const agentView =
    event === "Notification" && (AGENT_VIEW_TYPES as readonly string[]).includes(type);
  const desktopKey = agentView
    ? agentViewKey(session, typeof input.message === "string" ? input.message : "")
    : session;
  const argv = desktopCommand(alert, deps, desktopTarget(deps, cwd, label, desktopKey));
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
  // The same alert, into the terminal the person is looking at. With Warp at the far end it
  // goes in Warp's own agent format: Warp shows its popup while it is in front, and a desktop
  // notification with a sound while it is not — it decides the sound itself, so no extra BEL
  // goes with it. Every other far end gets OSC 777, with the bell when a setting asks for one.
  // The field carries the bare sequence: Claude Code writes it out, and wraps it for tmux
  // itself.
  let sequence: string;
  if (farEndIsWarp(deps.env, config)) {
    sequence = warpAgentSequence(alert, input);
  } else {
    const plain = notifySequence(alert.title, alert.body);
    sequence = config.sshBell || here.alerts.sound.value ? `${plain}\u0007` : plain;
  }
  const route = terminalRoute(event, deps.env, type);
  if (route === "field") return withProblem(fieldAnswer(sequence), here.problem);
  const onTty = forTty(sequence, deps.env);
  if (route === "tty" || route === "device-then-field") {
    // This event's answer is not read (StopFailure), the Claude Code is too old for the
    // field, or the alert is agent view's (the list never writes the field out): `/dev/tty`
    // first — the route an older Claude Code needs, wrapped for tmux here — and, when the
    // hook has no controlling terminal (2.1.301: ENXIO), the session's own terminal device,
    // which is the pty Claude Code runs on (`writeSessionTerminal`). Never both: one alert.
    if (deps.writeTerminal(onTty)) return withProblem(SILENT, here.problem);
    if (deps.writeSessionTerminal(onTty)) return withProblem(SILENT, here.problem);
    // No device at all: agent view's type takes the field, which a session's own
    // `agent_needs_input` still has written out.
    return route === "device-then-field"
      ? withProblem(fieldAnswer(sequence), here.problem)
      : withProblem(SILENT, here.problem);
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
