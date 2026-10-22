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
  message.name === "state" ||
  message.name === "crew" ||
  actionResult(message, "slot.") ||
  actionResult(message, "switch");

export const SLOTS_REFRESH: RefreshOn = (message) =>
  message.name === "state" || actionResult(message, "slot.") || actionResult(message, "switch");

export const HEALTH_REFRESH: RefreshOn = ["state"];

export const NEEDS_REFRESH: RefreshOn = (message) =>
  message.name === "crew" ||
  message.name === "update" ||
  message.name === "doctor" ||
  message.name === "state" ||
  actionResult(message, "crew.") ||
  actionResult(message, "update.");

export const MACHINE_REFRESH: RefreshOn = (message) =>
  message.name === "update" ||
  message.name === "doctor" ||
  actionResult(message, "update.") ||
  actionResult(message, "companion.") ||
  actionResult(message, "omniroute.") ||
  actionResult(message, "browser.");

export const UPDATE_REFRESH: RefreshOn = (message) =>
  message.name === "update" || actionResult(message, "update.") || actionResult(message, "switch");

export const WORKTREES_REFRESH: RefreshOn = (message) =>
  actionResult(message, "worktrees.") || actionResult(message, "crew.rm");

function settingsChanged(message: LiveMessage): boolean {
  return actionResult(message, "workflow.") || actionResult(message, "project.");
}

/** Settings and its Projects tab: a work-flow change, and any `project.*` result (an add, a write). */
export const SETTINGS_REFRESH: RefreshOn = settingsChanged;

/**
 * A project's page: what changes Settings, and a crew event or result too — a crew branch
 * starts, ends or is stopped, so the page asks again. The server keeps its branch answer for
 * `PROJECT_BRANCHES_CACHE_MS` (`src/portal/api/projects.ts`), so the verdicts the page draws
 * after such an event are at most a minute old, not the verdict of that moment.
 */
export const PROJECT_REFRESH: RefreshOn = (message) =>
  settingsChanged(message) || message.name === "crew" || actionResult(message, "crew.");

export const GUARDS_REFRESH: RefreshOn = ["guard-ask"];

/** Work and a crew page: a crew event, and a crew action's result. */
export const CREW_REFRESH: RefreshOn = (message) =>
  message.name === "crew" || actionResult(message, "crew.");

/** The request history and its table: each routed request is a new row. */
export const HISTORY_REFRESH: RefreshOn = ["recent"];
