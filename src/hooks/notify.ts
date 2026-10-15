/**
 * The notifier hook: a desktop notification when Claude needs the person, and when a turn
 * ends. Machine-wide (`USER_HOOKS`): it reads no `anymodel.json`, and its opt-in is the
 * machine — a notifier on PATH and a terminal that does not notify by itself.
 *
 * Wired on two events (one handler each, so one notification per event):
 *   - `Notification`, matcher `permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input`
 *     — the moments Claude asks for something. The idle wait (`idle_prompt`) is left out on
 *     purpose: the `Stop` notification already announced that finished turn, and a second
 *     alert for one wait is noise (owner, 2026-10-13).
 *   - `Stop` — the turn ended.
 *
 * **Inside Warp, nothing** (`TERM_PROGRAM=WarpTerminal`): Warp's own Claude Code plugin shows
 * a finished turn, a question and a permission request itself (a pop-up in its window while it
 * is in front, a desktop notification while it is not), so ours would be the second alert for
 * one event. **With no notifier on PATH, nothing**: `notify-send` on Linux, `osascript` on
 * macOS, and one stderr line elsewhere — the same selection `src/update/` uses for its own
 * notification, and the same rule: one notification per event, never two.
 *
 * A hook's output is ignored here (Claude Code reads nothing of `Notification` or `Stop`
 * besides context), and every error is one short stderr line and exit 0: a notifier must
 * never stop a session.
 */
import { spawn } from "node:child_process";
import { notifyCommand } from "../update/apply";
import { type HookResult, SILENT } from "./io";
import type { Env } from "./run";

/** The notification types that mean "Claude needs you", the ones `hooks.json` matches. */
export const NOTIFY_TYPES = [
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
  "worker_permission_prompt",
] as const;

/** One notification to show. */
export interface Notice {
  body: string;
  title: string;
}

/** What each notification type says when Claude Code's message is not usable. */
const TYPE_BODY: Readonly<Record<string, string>> = {
  agent_needs_input: "A background agent is waiting for you.",
  elicitation_dialog: "Claude asks you for input.",
  elicitation_url_dialog: "Claude asks you to open a page.",
  permission_prompt: "Claude is waiting for your permission.",
  worker_permission_prompt: "A background worker is waiting for your permission.",
};

/** The longest text a notification shows (`notify-send` and osascript both cut long ones). */
const MAX_TEXT = 180;

function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/** A shown string: one line, never empty, capped. */
function shown(text: string, fallback: string): string {
  const line = oneLine(text);
  if (line === "") return fallback;
  return line.length <= MAX_TEXT ? line : `${line.slice(0, MAX_TEXT - 1)}…`;
}

/** True inside the Warp terminal, whose own plugin notifies (Warp sets TERM_PROGRAM). */
export function isWarp(env: Env): boolean {
  return (env.TERM_PROGRAM ?? "").toLowerCase() === "warpterminal";
}

/**
 * The notification this hook input asks for, or null when there is none: another event, an
 * idle wait, or inside Warp (whose plugin notifies itself).
 */
export function noticeFor(input: unknown, event: string, env: Env): Notice | null {
  if (isWarp(env)) return null;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const fields = input as Record<string, unknown>;
  if (event === "Stop") {
    return { body: "Claude finished its turn.", title: "Claude Code" };
  }
  if (event !== "Notification") return null;
  const type = typeof fields.notification_type === "string" ? fields.notification_type : "";
  if (!(NOTIFY_TYPES as readonly string[]).includes(type)) return null;
  const message = typeof fields.message === "string" ? fields.message : "";
  const title = typeof fields.title === "string" ? fields.title : "";
  return {
    body: shown(message, TYPE_BODY[type] ?? "Claude needs you."),
    title: shown(title, "Claude Code"),
  };
}

/** One program run, fire and forget: what the notification is shown with. */
export type NotifyRunner = (argv: string[]) => void;

/**
 * The real runner: the notifier starts detached from the hook, which does not wait for it. A
 * notification that waits for a click (or a slow daemon) must not hold the hook, and Claude
 * Code exits after a `Stop` hook in `claude -p`: the detached program still shows it.
 */
export const spawnNotify: NotifyRunner = (argv) => {
  const [file, ...args] = argv;
  if (file === undefined) return;
  try {
    const child = spawn(file, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => {
      console.error(`anymodel notify: could not show the notification: ${error.message}`);
    });
    child.unref();
  } catch (error) {
    console.error(`anymodel notify: ${error instanceof Error ? error.message : error}`);
  }
};

export interface NotifyDeps {
  env: Env;
  platform: NodeJS.Platform;
  /** Finds a program on PATH (the real one: `Bun.which` with the hook's PATH). */
  which: (command: string) => null | string;
  run: NotifyRunner;
}

/**
 * The hook's work: show the notification for this event, or stay quiet. At most one program
 * run per event. No notifier on this machine, or another platform: silence, not a failure —
 * a line on every turn would be noise. Anything that goes wrong is one short line on stderr,
 * and the session goes on.
 */
export function notifyHook(input: unknown, event: string, deps: NotifyDeps): HookResult {
  const notice = noticeFor(input, event, deps.env);
  if (notice === null) return SILENT;
  const argv = notifyCommand(notice.body, deps.platform, deps.which, notice.title);
  if (argv === null) return SILENT;
  deps.run(argv);
  return SILENT;
}
