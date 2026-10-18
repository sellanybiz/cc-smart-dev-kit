/**
 * The notification types the notifier handles, and the two matchers that wire them — one
 * home, imported by the notifier (`notify.ts`), by `setup`'s user-level hook
 * (`src/setup/user-notify-hook.ts`) and by `doctor`. This module imports nothing: the hook's
 * own module reaches `cli/setup` through `src/workflow/`, which imports the managed entry, so
 * a constant defined there would sit in an import cycle.
 *
 * Two wirings feed the same code:
 *   - `PLUGIN_NOTIFY_TYPES`: raised by a session's own process, wired in
 *     `plugin/hooks/hooks.json` (`NOTIFY_MATCHER`).
 *   - `AGENT_VIEW_TYPES`: raised by agent view (`claude agents`), which runs only the hooks
 *     in settings files, so `cc-smart-dev-kit setup` writes them as a user-level hook
 *     (`AGENT_VIEW_MATCHER`; `src/setup/user-notify-hook.ts`).
 */

/**
 * The notification types a session's own process raises, the ones `plugin/hooks/hooks.json`
 * matches: the moments Claude asks for something.
 */
export const PLUGIN_NOTIFY_TYPES = [
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "worker_permission_prompt",
] as const;

/**
 * The notification types agent view (`claude agents`, the list of sessions) raises for the
 * sessions it shows, in its own process: `agent_needs_input` while one waits, and
 * `agent_completed` when one finished or failed. The hook input is the list's own session and
 * folder, so these carry no session name of their own (the message names the session), and
 * the per-session question mark (the list's session, not the background one) says nothing
 * about them. `agent_needs_input` also comes from a session's own process — a teammate's setup
 * question, auto mode's classifier notice (Claude Code's hooks page) — and its input carries
 * no sign of which: both get this handling, so that one loses its `· <session>` and its mark.
 */
export const AGENT_VIEW_TYPES = ["agent_needs_input", "agent_completed"] as const;

/**
 * Every notification type the code accepts: the plugin's own wiring and the user-level one
 * together. `alertFor` reads the list, so either wiring's input is handled the same way.
 */
export const NOTIFY_TYPES = [...PLUGIN_NOTIFY_TYPES, ...AGENT_VIEW_TYPES] as const;

/** The matcher `plugin/hooks/hooks.json` wires for the plugin's own Notification handler. */
export const NOTIFY_MATCHER = PLUGIN_NOTIFY_TYPES.join("|");

/** The matcher of the user-level Notification hook `setup` writes for agent view. */
export const AGENT_VIEW_MATCHER = AGENT_VIEW_TYPES.join("|");
