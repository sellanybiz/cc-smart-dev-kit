/**
 * The router's limit state file: `~/.local/state/cc-smart-dev-kit/gateway-state.json`.
 *
 * The router writes it; `cc-smart-dev-kit statusline` and the StopFailure hook read it. It says two
 * things, and never a key, a header value or a word of a request:
 *   - `limits`: the Claude models Anthropic last answered with the plan's usage limit
 *     (`planUsageLimit`), with the window that ran out and when it resets. A model is removed
 *     once Anthropic answers it again.
 *   - `fallbacks`: the model slots (`cc-smart-dev-kit-opus`, `cc-smart-dev-kit-fable`) answering from a
 *     fallback target now, because their model is at its limit.
 *
 * Why a file: when a request is refused for the limit, Claude Code's status line gets no new
 * usage numbers (a refused request's headers are not read), and the StopFailure hook's input
 * does not say which model hit it. The router saw the answer, so it writes it down.
 *
 * Pure: parsing and the "is it still current" rules. The router bundle imports it, so it
 * imports nothing that carries the plugin version.
 */

import { z } from "zod";

/** The longest a record without a reset time counts as current. */
export const NO_RESET_FRESH_MS = 15 * 60_000;

const limitSchema = z.object({
  claim: z.string().nullable(),
  /** Unix seconds; null when Anthropic named none. */
  resetsAt: z.number().nullable(),
  /** Milliseconds since the epoch: the last answer that said so. */
  seenAt: z.number(),
});

const fallbackSchema = z.object({
  /** Milliseconds: the last request the fallback answered. */
  lastAt: z.number(),
  model: z.string(),
  resetsAt: z.number().nullable(),
  /** Milliseconds: the first request the fallback answered, this time. */
  since: z.number(),
  /** The target that answered last, as the config spells it (`omniroute:…`). */
  target: z.string(),
});

const stateSchema = z.object({
  fallbacks: z.record(z.string(), fallbackSchema),
  limits: z.record(z.string(), limitSchema),
  version: z.literal(1),
});

export type LimitRecord = z.output<typeof limitSchema>;
export type FallbackRecord = z.output<typeof fallbackSchema>;
export type LimitState = z.output<typeof stateSchema>;

export function emptyLimitState(): LimitState {
  return { fallbacks: {}, limits: {}, version: 1 };
}

/** The file's text, as the router writes it. */
export function formatLimitState(state: LimitState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** The state from the file's text; null when it is not a state this version reads. */
export function parseLimitState(text: string): LimitState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // A file cut short or written by hand: the readers act as if there were none.
    return null;
  }
  const parsed = stateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * A reset time as the status line and the alert show it: `13:00` today, `Oct 18 22:46` on
 * another day, in `timeZone` (undefined: the machine's).
 */
export function formatClock(epochSec: number, nowMs: number, timeZone?: string): string {
  const at = new Date(epochSec * 1000);
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone,
  }).format(at);
  if (day(at) === day(new Date(nowMs))) return time;
  const date = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(at);
  return `${date} ${time}`;
}

/** Is this record current at `nowMs`? Until its reset; without one, for 15 minutes. */
function current(resetsAt: null | number, lastMs: number, nowMs: number): boolean {
  if (resetsAt !== null) return resetsAt * 1000 > nowMs;
  return nowMs - lastMs < NO_RESET_FRESH_MS;
}

/** The plan limits current at `nowMs`, by model. */
export function currentLimits(state: LimitState, nowMs: number): [string, LimitRecord][] {
  return Object.entries(state.limits)
    .filter(([, record]) => current(record.resetsAt, record.seenAt, nowMs))
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

/** The model slots on their fallback at `nowMs`, by slot. */
export function currentFallbacks(state: LimitState, nowMs: number): [string, FallbackRecord][] {
  return Object.entries(state.fallbacks)
    .filter(([, record]) => current(record.resetsAt, record.lastAt, nowMs))
    .sort(([a], [b]) => (a < b ? -1 : 1));
}
