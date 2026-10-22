/**
 * Claude Code's retry watchdog, offered for the person's own sessions (D42).
 *
 * With `CLAUDE_CODE_RETRY_WATCHDOG=1`, a session that meets a limited or failing model waits
 * and retries ("Retrying in …"; Esc cancels) instead of failing. Proved on Claude Code 2.1.306:
 * Claude Code reads the variable from a settings file's `env`, it retries past 11 requests,
 * and with `…_USAGE_LIMIT_RECHECK_MS` it checks again whether a usage limit was lifted.
 *
 * It is the only way the lead's own subagents survive a limit, so `setup` offers it once
 * (default no). The trade-offs are said in the question (`RETRY_WATCHDOG_QUESTION`):
 *   - every Claude session on the machine waits instead of failing;
 *   - a `claude -p` script can hang until a model answers;
 *   - there is no time limit: this module writes no `…_MAX_WAIT_MS` and no
 *     `…_MAX_USAGE_LIMIT_WAIT_MS` (the owner chose "keep waiting", D42).
 *
 * The two keys go under `env` in the user's `settings.json` as owned keys, through
 * `applyManagedJson` (`src/cli/setup.ts`): a value the person set themselves is never taken
 * (`ForeignKeyError`), and `restore` removes ours.
 */

import { join } from "node:path";
import { COMMAND } from "../build-info";
import { getKey, type KeyPath, ownedRecords, ownership, readJsonObject } from "./managed-json";
import { realTarget } from "./write";

/** The variable that turns the watchdog on, and the value setup writes. */
export const RETRY_WATCHDOG_ENV = "CLAUDE_CODE_RETRY_WATCHDOG";
export const RETRY_WATCHDOG_VALUE = "1";

/** The variable for how soon a usage limit is checked again, in ms (Claude Code accepts 60000 to 10800000). */
export const RETRY_WATCHDOG_RECHECK_ENV = "CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS";
/** Five minutes: the shortest gap between checks of whether a limit was lifted early. */
export const RETRY_WATCHDOG_RECHECK_MS = 300_000;

/** The owned keys, in settings.json, with the values setup writes (settings `env` values are strings). */
export const RETRY_WATCHDOG_KEY: KeyPath = ["env", RETRY_WATCHDOG_ENV];
export const RETRY_WATCHDOG_RECHECK_KEY: KeyPath = ["env", RETRY_WATCHDOG_RECHECK_ENV];
export const RETRY_WATCHDOG_SETTINGS: ReadonlyArray<readonly [KeyPath, string]> = [
  [RETRY_WATCHDOG_KEY, RETRY_WATCHDOG_VALUE],
  [RETRY_WATCHDOG_RECHECK_KEY, String(RETRY_WATCHDOG_RECHECK_MS)],
];

/** The flags of `setup`: on without the question, and off again (remembered as a "no"). */
export const RETRY_WATCHDOG_FLAG = "--retry-watchdog";
export const NO_RETRY_WATCHDOG_FLAG = "--no-retry-watchdog";

/** Says the person answered "no" (or ran `--no-retry-watchdog`): setup does not ask again. */
export function retryWatchdogDeclinedFile(stateDir: string): string {
  return join(stateDir, "retry-watchdog-declined");
}

/** The question setup asks, in a terminal only. */
export const RETRY_WATCHDOG_QUESTION =
  "Make Claude Code wait and retry, instead of failing, when a model is limited or down? " +
  'Every Claude session on this machine then waits ("Retrying in …"; Esc cancels) with no time limit, ' +
  "a `claude -p` script can hang until a model answers, and the lead's own subagents survive a limit only this way.";

/**
 * Where it stands in the settings' `env`:
 * - `off`: the watchdog key is not there;
 * - `ours`: it is there, and it is setup's own;
 * - `yours`: it is there, set by the person (or changed since setup set it) to a value that turns it on;
 * - `disabled`: it is there, set by the person to a value that leaves it off.
 */
export type RetryWatchdogState = "disabled" | "off" | "ours" | "yours";

/** Claude Code's own truthy words for a switch variable. */
function turnsOn(value: unknown): boolean {
  return ["1", "on", "true", "yes"].includes(String(value).trim().toLowerCase());
}

export interface RetryWatchdogPaths {
  settingsFile: string;
  stateDir: string;
}

/** Reads where it stands. Throws when the settings file is not valid JSON. */
export function retryWatchdogState(paths: RetryWatchdogPaths): RetryWatchdogState {
  const current = getKey(readJsonObject(paths.settingsFile).data, RETRY_WATCHDOG_KEY);
  if (!current.found) return "off";
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  if (ownership(records, RETRY_WATCHDOG_KEY, current) === "ours") return "ours";
  return turnsOn(current.value) ? "yours" : "disabled";
}

/** True when either key is in the settings' `env` at all (the person has made a choice: do not ask). */
export function retryWatchdogKeysPresent(settingsFile: string): boolean {
  const data = readJsonObject(settingsFile).data;
  return RETRY_WATCHDOG_SETTINGS.some(([path]) => getKey(data, path).found);
}

/** What `doctor` says for each state; none of them is a failure. */
export function retryWatchdogLine(state: RetryWatchdogState, settingsFile: string): string {
  const turnOn = `to turn it on, run: ${COMMAND} setup ${RETRY_WATCHDOG_FLAG}`;
  switch (state) {
    case "ours":
      return `retry watchdog: on (set by ${COMMAND}): a session waits and retries at a limit; turn it off with: ${COMMAND} setup ${NO_RETRY_WATCHDOG_FLAG}`;
    case "yours":
      return `retry watchdog: on (your own ${RETRY_WATCHDOG_ENV} in ${settingsFile})`;
    case "disabled":
      return `retry watchdog: off (your own ${RETRY_WATCHDOG_ENV} in ${settingsFile} leaves it off; change it by hand to turn it on)`;
    case "off":
      return `retry watchdog: off, so a session fails at a limit instead of waiting; ${turnOn}`;
  }
}
