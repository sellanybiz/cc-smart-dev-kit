/**
 * The router's limit state file: `~/.local/state/cc-smart-dev-kit/gateway-state.json`.
 *
 * The router writes it, and reads it once when it starts (a restart keeps what it saw);
 * `cc-smart-dev-kit statusline` and the StopFailure hook read it. It says two
 * things, and never a key, a header value or a word of a request:
 *   - `limits`: the Claude models Anthropic last answered with the plan's usage limit
 *     (`planUsageLimit`), with the window that ran out and when it resets. A model is removed
 *     once Anthropic answers it again.
 *   - `fallbacks`: the model slots (`cc-smart-dev-kit-opus`, `cc-smart-dev-kit-fable`) answering from a
 *     fallback target now, because their model is at its limit.
 *   - `breakers`: the slots whose every target is limited or down, so the router is holding
 *     their requests (`breaker` in the config decides whether it may), with each target's
 *     rest and how many requests are held. Optional: a reader that does not know it ignores
 *     it, and a file without it reads as no breaker open.
 *   - `seenClaude`: the Claude model ids Claude Code sent (the portal's "Claude login" list).
 *     The router writes it only when an id is new, and then reads the file first and changes
 *     only this field, so a change another program made to the rest stays.
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

/** One target of a slot whose breaker is open: why it does not answer, and until when. */
const breakerTargetSchema = z.object({
  /**
   * The HTTP status of its last failure, or null when it gave none (a network error, a
   * timeout before any answer).
   */
  status: z.int().nullable(),
  /** The target, as the config spells it (`omniroute:…`). */
  target: z.string(),
  /** Milliseconds since the epoch: when its rest ends and it may be asked again. */
  until: z.number(),
});

/**
 * A slot whose every target is limited or down: the router holds its requests, then asks
 * Claude Code to retry. The record is current while the router keeps it fresh (`lastAt`);
 * see `currentBreakers`.
 */
const breakerSchema = z.object({
  /** How many requests the breaker held since it opened (a count, not what waits now). */
  held: z.int().min(0),
  /** Milliseconds: the last request the breaker held or answered. */
  lastAt: z.number(),
  /** Milliseconds: when the breaker opened, this time. */
  since: z.number(),
  /** The slot's targets in use, each with the failure that rests it. */
  targets: z.array(breakerTargetSchema),
});

const stateSchema = z.object({
  /**
   * The slots whose every target is limited or down, so the router holds their requests.
   * Absent in a file an older router wrote: it reads as no breaker open. A reader that does
   * not know the field ignores it.
   */
  breakers: z.record(z.string(), breakerSchema).optional(),
  fallbacks: z.record(z.string(), fallbackSchema),
  limits: z.record(z.string(), limitSchema),
  /**
   * The Claude model ids Claude Code sent through the router, each with the last time
   * (milliseconds) the file was written for it: the "Claude login" group of the portal's
   * model list. Ids only, never a word of a request. Optional, so a file of 0.5.x reads.
   */
  seenClaude: z.record(z.string(), z.number()).optional(),
  version: z.literal(1),
});

/** The most Claude ids `seenClaude` keeps: the ones seen last. */
export const SEEN_CLAUDE_MAX = 50;

/**
 * Two `seenClaude` records as one: each id with its latest time, and only the
 * `SEEN_CLAUDE_MAX` ids seen last (a client that sends a new id each time cannot grow it).
 */
export function mergeSeenClaude(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> {
  const merged = new Map<string, number>(Object.entries(a));
  for (const [id, at] of Object.entries(b)) merged.set(id, Math.max(merged.get(id) ?? at, at));
  return Object.fromEntries(
    [...merged]
      .sort(([idA, atA], [idB, atB]) => atB - atA || (idA < idB ? -1 : 1))
      .slice(0, SEEN_CLAUDE_MAX),
  );
}

/**
 * The key a slot's `fallbacks` or `breakers` record goes under: the slot alone for the
 * machine's default, `<profile>/<slot>` for a request that came through a profile (owner
 * D29). A profile's chain is its own, so its breaker and its fallback record are its own
 * too; a target's rest is not keyed this way (a target that is down is down for every
 * profile), and neither is `limits`, because the Claude login, and so its plan limits, is one
 * for every profile.
 */
export function stateKeyFor(slot: string, profile: null | string): string {
  return profile === null ? slot : `${profile}/${slot}`;
}

/** The profile and slot a state key names (`stateKeyFor`); no `/`: the machine's default. */
export function scopeOfStateKey(key: string): { profile: null | string; slot: string } {
  const at = key.indexOf("/");
  return at === -1
    ? { profile: null, slot: key }
    : { profile: key.slice(0, at), slot: key.slice(at + 1) };
}

export type LimitRecord = z.output<typeof limitSchema>;
export type FallbackRecord = z.output<typeof fallbackSchema>;
export type BreakerTarget = z.output<typeof breakerTargetSchema>;
export type BreakerRecord = z.output<typeof breakerSchema>;
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

/**
 * The slots whose breaker is open at `nowMs`, by slot. A breaker has no end time to wait for:
 * a target's `until` is only when it may be asked again, and the breaker stays open until one
 * answers. So a record counts for 15 minutes after the router last touched it (`lastAt`), the
 * rule for a record without a reset time. A router that stopped or crashed with a breaker
 * open leaves its record behind, and this is what makes it go stale. The router therefore
 * refreshes `lastAt` while a breaker is open.
 */
export function currentBreakers(state: LimitState, nowMs: number): [string, BreakerRecord][] {
  return Object.entries(state.breakers ?? {})
    .filter(([, record]) => current(null, record.lastAt, nowMs))
    .sort(([a], [b]) => (a < b ? -1 : 1));
}
