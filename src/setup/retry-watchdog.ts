/**
 * Claude Code's retry watchdog, on by default for the person's own sessions (D56).
 *
 * With `CLAUDE_CODE_RETRY_WATCHDOG=1`, a session that meets a limited or failing model waits
 * and retries ("Retrying in …"; Esc cancels) instead of failing. Proved on Claude Code 2.1.306:
 * Claude Code reads the variable from a settings file's `env`, it retries past 11 requests,
 * and with `…_USAGE_LIMIT_RECHECK_MS` it checks again whether a usage limit was lifted.
 *
 * D56 (the owner, 2026-10-23): setup turns it on without a question, with or without a
 * terminal and with `--yes`, unless the person said no before (`retryWatchdogDeclinedFile`)
 * or set a value of their own. What that means is said in one line setup prints
 * (`RETRY_WATCHDOG_ON_NOTE`), not in a question:
 *   - every Claude session on the machine waits instead of failing;
 *   - a `claude -p` script can wait until a model answers;
 *   - a usage limit that resets more than 24 hours away ends the wait
 *     (`…_MAX_USAGE_LIMIT_WAIT_MS`): a weekly limit can reset days away, and Claude Code's
 *     own automatic continue refuses a wait past 24 h for that reason;
 *   - a 5-hour limit, and a model that is down or overloaded, are still waited out with no
 *     limit (no `…_MAX_WAIT_MS`: the owner chose "keep waiting", D42).
 *
 * The three keys go under `env` in the user's `settings.json` as owned keys, through
 * `applyManagedJson` (`src/cli/setup.ts`): a value the person set themselves is never taken
 * (`ForeignKeyError`), and `restore` removes ours.
 */

import { existsSync } from "node:fs";
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

/** The variable that ends a wait when a usage limit's reset is further away than the cap, in ms. */
export const RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_ENV =
  "CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS";
/** 24 hours (D56): a limit that resets further away ends the wait instead of holding a script for days. */
export const RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS = 86_400_000;

/** The owned keys, in settings.json, with the values setup writes (settings `env` values are strings). */
export const RETRY_WATCHDOG_KEY: KeyPath = ["env", RETRY_WATCHDOG_ENV];
export const RETRY_WATCHDOG_RECHECK_KEY: KeyPath = ["env", RETRY_WATCHDOG_RECHECK_ENV];
export const RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_KEY: KeyPath = [
  "env",
  RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_ENV,
];
export const RETRY_WATCHDOG_SETTINGS: ReadonlyArray<readonly [KeyPath, string]> = [
  [RETRY_WATCHDOG_KEY, RETRY_WATCHDOG_VALUE],
  [RETRY_WATCHDOG_RECHECK_KEY, String(RETRY_WATCHDOG_RECHECK_MS)],
  [RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_KEY, String(RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS)],
];

/** The flags of `setup`: on (and forget an earlier "no"), and off again (remembered as a "no"). */
export const RETRY_WATCHDOG_FLAG = "--retry-watchdog";
export const NO_RETRY_WATCHDOG_FLAG = "--no-retry-watchdog";

/** Says the person answered "no" (or ran `--no-retry-watchdog`): setup does not turn it on. */
export function retryWatchdogDeclinedFile(stateDir: string): string {
  return join(stateDir, "retry-watchdog-declined");
}

/** True when that "no" is on file: setup leaves the watchdog off. */
export function retryWatchdogDeclined(stateDir: string): boolean {
  return existsSync(retryWatchdogDeclinedFile(stateDir));
}

/**
 * What setup says when it turns the watchdog on (D56): one `·` line, so a person knows what
 * every session on the machine now does, and how to undo it.
 */
export const RETRY_WATCHDOG_ON_NOTE =
  `retry watchdog: on, so every Claude session on this machine waits and retries at a limit ` +
  'instead of failing ("Retrying in …"; Esc cancels); a limit that resets more than 24 hours ' +
  `away ends the wait; a \`claude -p\` script can wait until a model answers; to turn it off: ${COMMAND} setup ${NO_RETRY_WATCHDOG_FLAG}`;

/** What setup says when a "no" on file holds it off, and how to change that. */
export const RETRY_WATCHDOG_DECLINED_NOTE = `retry watchdog: off because you said no; ${COMMAND} setup ${RETRY_WATCHDOG_FLAG} turns it on`;

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

/**
 * True when no watchdog key in the settings is the person's own: none is there, or every one
 * is there with the value an earlier setup wrote and still in `owned.json`. Setup may then
 * turn the watchdog on, and add a key an older version did not write (D56's cap). A key of
 * the person's own, also one they removed after setup wrote it, is theirs: leave it alone.
 */
export function retryWatchdogKeysOurs(paths: RetryWatchdogPaths): boolean {
  const data = readJsonObject(paths.settingsFile).data;
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  return RETRY_WATCHDOG_SETTINGS.every(([path]) => {
    const current = getKey(data, path);
    const whose = ownership(records, path, current);
    // A key that is not in the file: ours to add only while setup never wrote it.
    return current.found ? whose === "ours" : whose === "none";
  });
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
