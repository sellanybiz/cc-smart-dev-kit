/**
 * Reading the safety-check counts the router wrote. `safety-checks.ts` holds their shape, their
 * local days and their arithmetic; this is the file side of it, in one home for both readers —
 * the CLI's `usage` (`src/cli/usage.ts`) and the portal's Usage page (F6).
 *
 * Read only. A file that is not there, or holds no state this version reads, is null: a count
 * is never guessed from a file that gave none.
 */

import { readFileSync } from "node:fs";
import {
  type CheckDay,
  localDay,
  parseSafetyCheckState,
  recentCheckDays,
  type SafetyCheckState,
} from "./safety-checks";

const DAY_MS = 86_400_000;

/** The safety-check counts the router wrote; null when there are none to read. */
export function readSafetyChecks(file: string): null | SafetyCheckState {
  try {
    return parseSafetyCheckState(readFileSync(file, "utf8"));
  } catch {
    // Not there — the gateway is not set up, or no session has run with auto mode on — or not
    // readable. Either way nothing was counted, and the reader says so rather than a zero.
    return null;
  }
}

/**
 * How many local days a window covers: the day it starts in, through today, both ends counted.
 * A one-day window read at midday covers yesterday's afternoon and this morning, so two days; an
 * hour at half past midnight reaches into yesterday and covers two as well.
 */
export function windowDays(nowMs: number, windowMs: number, timeZone?: string): number {
  const first = Date.parse(localDay(nowMs - windowMs, timeZone));
  const last = Date.parse(localDay(nowMs, timeZone));
  return Math.max(1, Math.round((last - first) / DAY_MS) + 1);
}

/** One window's safety checks: the local days it covers that the file still holds, and their sums. */
export interface CheckWindow {
  /** How many Anthropic answered. */
  anthropic: number;
  /** Every check of those days, whoever answered it. */
  checks: number;
  /** The days the window covers that the file holds, newest first. */
  days: [string, CheckDay][];
  /** How many a target of the judge slot answered (the file's own name for that, `fallback`). */
  fallback: number;
}

/**
 * The safety checks of the local days a window covers. The file keeps `SAFETY_CHECK_DAYS` days,
 * so a longer window reads only the days still there: `days` says which, and the page can say so.
 */
export function safetyCheckWindow(
  state: null | SafetyCheckState,
  options: { nowMs: number; timeZone?: string; windowMs: number },
): CheckWindow {
  const days =
    state === null
      ? []
      : recentCheckDays(
          state,
          options.nowMs,
          windowDays(options.nowMs, options.windowMs, options.timeZone),
          options.timeZone,
        );
  const total = (side: "anthropic" | "fallback"): number =>
    days.reduce((sum, [, day]) => sum + day[side].checks, 0);
  return {
    anthropic: total("anthropic"),
    checks: days.reduce((sum, [, day]) => sum + day.checks, 0),
    days,
    fallback: total("fallback"),
  };
}
