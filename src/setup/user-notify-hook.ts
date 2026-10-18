import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { AGENT_VIEW_MATCHER } from "../hooks/notify-types";
import { LAUNCHER_IN_SHELL } from "./launcher";
import {
  applyManagedHook,
  type HookEntry,
  isHookEntry,
  type ManagedHookResult,
  runsPluginNotify,
} from "./managed-hook";

/**
 * The one user-level Claude Code hook `cc-smart-dev-kit setup` manages: agent view
 * (`claude agents`, the list of sessions) raises `Notification` with `agent_needs_input` and
 * `agent_completed` in its own process, and runs only the hooks in settings files — never a
 * plugin's `hooks.json` (proved live on Claude Code 2.1.302, `docs/claude-code-contract.md`).
 * So these two types reach the notifier only through an entry in the person's user settings
 * (`paths.settingsFile`), and that entry is this one.
 *
 * The command runs the stable launcher, never the plugin's version folder: an update deletes
 * the old folder, and the user hook would then point at nothing. The entry and its command
 * are defined once, here; `doctor` reads the same entry to check it.
 */

/** The `hook` subcommand that runs the notifier (`cc-smart-dev-kit hook notify`). */
export const USER_NOTIFY_HOOK_NAME = "notify";

/** The entry's timeout, in seconds: the notifier's own hook timeout. */
export const USER_NOTIFY_TIMEOUT = 10;

/** The command the user-level hook runs: the launcher, so it survives a plugin update. */
export const USER_NOTIFY_COMMAND = `${LAUNCHER_IN_SHELL} hook ${USER_NOTIFY_HOOK_NAME}`;

/** The entry setup manages in Claude Code's user settings. */
export const USER_NOTIFY_ENTRY: HookEntry = {
  matcher: AGENT_VIEW_MATCHER,
  hooks: [{ type: "command", command: USER_NOTIFY_COMMAND, timeout: USER_NOTIFY_TIMEOUT }],
};

/**
 * True when a command runs `cc-smart-dev-kit hook notify` through the launcher — as setup
 * writes it, or as a person edits it (another timeout, a redirection). The launcher may be
 * the bare name or a path to it; the quotes around it are optional.
 */
export function runsHookNotify(command: string): boolean {
  const escaped = COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[\\s/"'])${escaped}["']?\\s+hook\\s+${USER_NOTIFY_HOOK_NAME}(\\s|;|$)`,
  ).test(command);
}

/**
 * The managed hook after a person edited it: the same matcher and the same command, in
 * another shape. It is theirs now — setup leaves it and claims nothing (`managed-hook.ts`).
 */
export function isEditedNotify(entry: HookEntry): boolean {
  return entry.matcher === AGENT_VIEW_MATCHER && entry.hooks.some((h) => runsHookNotify(h.command));
}

/**
 * A hand-written entry setup replaces instead of adding a second: the same matcher and EVERY
 * handler running THIS plugin's own `dist/notify.js` (in practice exactly one). That is the
 * shape a manual test leaves behind, and its path lives in a version folder an update deletes.
 * An entry that also runs something else is partly the person's: setup never replaces it.
 */
export function isHandWrittenNotify(entry: HookEntry): boolean {
  return (
    entry.matcher === AGENT_VIEW_MATCHER &&
    entry.hooks.length > 0 &&
    entry.hooks.every((handler) => runsPluginNotify(handler.command))
  );
}

/** Makes the managed entry exactly `USER_NOTIFY_ENTRY`; every other hook entry stays. */
export function applyUserNotifyHook(paths: CliPaths, dryRun: boolean): ManagedHookResult {
  return applyManagedHook({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    event: "Notification",
    entry: USER_NOTIFY_ENTRY,
    replaces: isHandWrittenNotify,
    ownEdited: isEditedNotify,
    dryRun,
  });
}

/**
 * What the person's settings say about the managed entry:
 * - `current`: the exact managed entry is there;
 * - `edited`: the person's own version of it (the same matcher and command, edited) — it
 *   still runs, so it is information, never a failure;
 * - `elsewhere`: a hook with the same matcher that runs something else (an older hand-written
 *   copy, or the person's own);
 * - `missing`: no hook with that matcher at all.
 * A file that cannot be read, or a list of another shape, counts as missing.
 */
export type UserNotifyHookState = "current" | "edited" | "elsewhere" | "missing";

export function userNotifyHookState(file: string): UserNotifyHookState {
  if (!existsSync(file)) return "missing";
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "missing";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "missing";
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) return "missing";
  const list = (hooks as Record<string, unknown>).Notification;
  if (!Array.isArray(list)) return "missing";
  if (list.some((entry) => Bun.deepEquals(entry, USER_NOTIFY_ENTRY, true))) return "current";
  const entries = list.filter(isHookEntry);
  if (entries.some((entry) => isEditedNotify(entry))) return "edited";
  return entries.some((entry) => entry.matcher === AGENT_VIEW_MATCHER) ? "elsewhere" : "missing";
}
