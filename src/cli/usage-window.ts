/**
 * Claude Code's plan-usage windows: the one reader of `rate_limits.five_hour` and
 * `rate_limits.seven_day`, and the state file the status line records them in (D54; the 7-day
 * window since 2.2.0).
 *
 * The numbers exist in one place only: the JSON Claude Code passes to the status line command
 * on stdin, filled from Anthropic's `anthropic-ratelimit-unified-5h-*` / `-7d-*` headers
 * (`docs/claude-code-contract.md` § Usage limits). Nothing else on the machine is told them —
 * not the router's state file, not a transcript, no hook input — so the status line writes them
 * down when it reads them. The portal reads the 5-hour window back for its plan-usage number
 * (`planWindow`, `src/portal/facts.ts`). No hook reads it: Claude is not told the plan's usage.
 *
 * The file is `<stateDir>/usage-window.json`, mode 600, the kit's own state:
 * `{"fiveHour": {"percent": 87, "resetsAt": 1792600800}, "sevenDay": {…}, "readAt": "2026-10-23T…"}`.
 * Each window is there only when the last input carried it: Claude Code sends each one on its
 * own, and drops a window once its `resets_at` passes. A file a kit before 2.2.0 wrote holds
 * `fiveHour` alone, and still reads. It is written only when the numbers change, so `readAt` is
 * when they were last seen, not how fresh they are. A window whose `resetsAt` has passed
 * measured a window that is over: it reads as unknown — never as its old number. A reading
 * with no reset time at all is unknown once it is older than the window's own span: that is
 * the longest it could describe.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite } from "../setup/write";
import type { CliPaths } from "./paths";

/** The window Claude Code calls the plan's 5-hour window. */
export const FIVE_HOUR_WINDOW = "five_hour";

/** The window Claude Code calls the plan's 7-day window. */
export const SEVEN_DAY_WINDOW = "seven_day";

/** The 5-hour window's own span: a reading with no reset time is no reading past it. */
export const WINDOW_SPAN_MS = 5 * 60 * 60_000;

/** The 7-day window's own span, for the same rule. */
export const SEVEN_DAY_SPAN_MS = 7 * 24 * 60 * 60_000;

/** One window of the status line input: the share used, and when it resets (Unix seconds). */
export interface UsageWindow {
  percent: number;
  resetsAt: null | number;
}

/** The two windows the file can hold, by their names in it. */
export type UsageWindowName = "fiveHour" | "sevenDay";

/**
 * Both windows the file records, each null when it holds none, or none that is current; and
 * when the status line last saw them change (`readAt`, ms; null with no file or no readable time).
 */
export type UsageWindows = Record<UsageWindowName, UsageWindow | null> & { readAt: null | number };

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One window's numbers from a status line input; null when the input gives none. */
export function windowOf(input: unknown, name: string): UsageWindow | null {
  if (!isJsonObject(input)) return null;
  const limits = input.rate_limits;
  if (!isJsonObject(limits)) return null;
  const entry = limits[name];
  if (!isJsonObject(entry) || typeof entry.used_percentage !== "number") return null;
  return {
    percent: entry.used_percentage,
    resetsAt: typeof entry.resets_at === "number" ? entry.resets_at : null,
  };
}

/** The 5-hour window of a status line input; null when it gives none. */
export function fiveHourWindow(input: unknown): UsageWindow | null {
  return windowOf(input, FIVE_HOUR_WINDOW);
}

/** The file the status line records the windows in. */
export function usageWindowFile(paths: CliPaths): string {
  return join(paths.stateDir, "usage-window.json");
}

const windowSchema = z.object({ percent: z.number(), resetsAt: z.number().nullable() });

/**
 * The record as written; loose, so a field a newer kit adds stays. Each window is optional: a
 * file before 2.2.0 holds `fiveHour` alone, and an input may carry either window alone.
 */
const storedSchema = z.looseObject({
  fiveHour: windowSchema.optional(),
  readAt: z.string(),
  sevenDay: windowSchema.optional(),
});

type Stored = z.infer<typeof storedSchema>;

/** What the file holds, or null when there is none or it cannot be read. */
function readStored(file: string): null | Stored {
  if (!existsSync(file)) return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    // A file that cannot be read is no reading: the guard does not hold on a guess.
    return null;
  }
}

/** True when two readings of one window say the same: both missing, or the same numbers. */
function sameWindow(a: UsageWindow | null | undefined, b: UsageWindow | null): boolean {
  if (a === undefined || a === null) return b === null;
  return b !== null && a.percent === b.percent && a.resetsAt === b.resetsAt;
}

/**
 * Records the windows a status line just read. Nothing when the input has neither (an API key,
 * or a refused request: Claude Code sends no `rate_limits` then), and nothing when the numbers
 * are the ones already stored. The share rises with almost every reply, so expect one small
 * write per reply while a session works; it is far cheaper than the command's own start. A
 * write that fails throws; the status line catches it and prints.
 */
export function recordUsageWindow(paths: CliPaths, input: unknown, nowMs: number): void {
  const fiveHour = fiveHourWindow(input);
  const sevenDay = windowOf(input, SEVEN_DAY_WINDOW);
  if (fiveHour === null && sevenDay === null) return;
  const file = usageWindowFile(paths);
  const stored = readStored(file);
  if (
    stored !== null &&
    sameWindow(stored.fiveHour, fiveHour) &&
    sameWindow(stored.sevenDay, sevenDay)
  ) {
    return;
  }
  const record = {
    ...(fiveHour === null ? {} : { fiveHour }),
    ...(sevenDay === null ? {} : { sevenDay }),
    readAt: new Date(nowMs).toISOString(),
  };
  atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`, 0o600);
}

/**
 * A stored window as of `nowMs`: null when it is missing, or the window it measured is over
 * (a number from a window that is over is no number now). A reading with no reset time is over
 * once it is older than the window's own span: with identical numbers nothing rewrites the
 * file, so `readAt` is its only age.
 */
function currentWindow(
  window: UsageWindow | undefined,
  readAt: string,
  spanMs: number,
  nowMs: number,
): UsageWindow | null {
  if (window === undefined) return null;
  if (window.resetsAt !== null) return window.resetsAt * 1000 <= nowMs ? null : window;
  const read = Date.parse(readAt);
  return Number.isFinite(read) && nowMs - read > spanMs ? null : window;
}

/** Both recorded windows, as of `nowMs` (`currentWindow`'s rule for each). */
export function readUsageWindows(paths: CliPaths, nowMs: number): UsageWindows {
  const stored = readStored(usageWindowFile(paths));
  if (stored === null) return { fiveHour: null, readAt: null, sevenDay: null };
  const readAt = Date.parse(stored.readAt);
  return {
    fiveHour: currentWindow(stored.fiveHour, stored.readAt, WINDOW_SPAN_MS, nowMs),
    readAt: Number.isFinite(readAt) ? readAt : null,
    sevenDay: currentWindow(stored.sevenDay, stored.readAt, SEVEN_DAY_SPAN_MS, nowMs),
  };
}

/**
 * The last recorded 5-hour window, as of `nowMs`; null when there is none, it cannot be read,
 * or the window it measured is over.
 */
export function readUsageWindow(paths: CliPaths, nowMs: number): UsageWindow | null {
  return readUsageWindows(paths, nowMs).fiveHour;
}
