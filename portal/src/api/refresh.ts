/**
 * Which live events make each resource read again: one home, so a page and the header's
 * count of the same resource agree. A `reset` always does (`useResource`).
 *
 * A read is what the page's own answer costs the server: the Overview and Health ask every
 * backend for its model list, so they read again when the gateway's state file changes, not on
 * every routed request — the Overview adds the `recent` events to what it shows instead.
 */

import type { RefreshOn } from "./hooks";
import type { LiveMessage } from "./stream";

/** True for an action's result (not one of its progress lines) whose name starts with `prefix`. */
export function actionResult(message: LiveMessage, prefix: string): boolean {
  return (
    message.name === "action" && message.data.action.startsWith(prefix) && "ok" in message.data
  );
}

export const OVERVIEW_REFRESH: RefreshOn = (message) =>
  message.name === "state" || actionResult(message, "slot.") || actionResult(message, "switch");

export const SLOTS_REFRESH: RefreshOn = (message) =>
  message.name === "state" || actionResult(message, "slot.") || actionResult(message, "switch");

export const HEALTH_REFRESH: RefreshOn = (message) =>
  message.name === "state" || actionResult(message, "router.");

export const NEEDS_REFRESH: RefreshOn = (message) =>
  message.name === "update" ||
  message.name === "doctor" ||
  message.name === "state" ||
  actionResult(message, "update.");

export const MACHINE_REFRESH: RefreshOn = (message) =>
  message.name === "update" ||
  message.name === "doctor" ||
  actionResult(message, "update.") ||
  actionResult(message, "companion.") ||
  actionResult(message, "omniroute.") ||
  actionResult(message, "browser.") ||
  actionResult(message, "claudemem.") ||
  actionResult(message, "gateway.key.");

export const UPDATE_REFRESH: RefreshOn = (message) =>
  message.name === "update" || actionResult(message, "update.") || actionResult(message, "switch");

export const WORKTREES_REFRESH: RefreshOn = (message) => actionResult(message, "worktrees.");

function settingsChanged(message: LiveMessage): boolean {
  return actionResult(message, "workflow.") || actionResult(message, "project.");
}

/** Settings and its Projects tab: a work-flow change, and any `project.*` result (an add, a write). */
export const SETTINGS_REFRESH: RefreshOn = settingsChanged;

export const PROJECT_REFRESH: RefreshOn = (message) => settingsChanged(message);

export const WORKFLOW_CARD_REFRESH: RefreshOn = settingsChanged;

export const GATEWAY_CARD_REFRESH: RefreshOn = (message) =>
  settingsChanged(message) || actionResult(message, "slot.") || actionResult(message, "switch");

export const TASKS_REFRESH: RefreshOn = (message) =>
  message.name === "tasks" || settingsChanged(message);

export const GUARDS_REFRESH: RefreshOn = ["guard-ask"];

/** Saved-session changes. */
export const WORK_REFRESH: RefreshOn = (message) =>
  message.name === "guard-ask" || actionResult(message, "sessions.");

/** The request history and its table: each routed request is a new row. */
export const HISTORY_REFRESH: RefreshOn = ["recent"];
