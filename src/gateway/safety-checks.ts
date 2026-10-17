/**
 * Auto mode's safety checks, counted: `~/.local/state/cc-smart-dev-kit/safety-checks.json`.
 *
 * Claude Code's auto mode judges every shell command or network action with a separate
 * request (the router recognises it as the safety check, `isAutoModeGuard` in
 * `targets.ts`). Each one is a model call: it costs tokens, and nobody sees the bill.
 * So the router counts them, by local day: how many went through, how many Anthropic
 * answered and how many the judge slot, and the input, output and cache
 * tokens each answer's `usage` reported (`message_start` / `message_delta` on a stream,
 * the body's `usage` otherwise). `cc-smart-dev-kit usage` reads this file
 * (`src/cli/usage.ts`), today and the seven days before it.
 *
 * The file is small (one line per day, the newest `SAFETY_CHECK_DAYS` kept) and holds no
 * prompt, no answer and no key: four numbers and three counts per day.
 *
 * What the counts cannot say: whether these tokens count against a Pro, Max or Team
 * plan's limit. Anthropic's docs say they count for Enterprise and API accounts; for the
 * others it is not confirmed. `README.md` § The usage limit says so too.
 *
 * Pure: the day keys, the file, and the reading of an answer's tokens. The router bundle
 * imports it, so it imports nothing that carries the plugin version.
 */

import { z } from "zod";

/** How many days the file keeps. Older days are dropped as the router writes. */
export const SAFETY_CHECK_DAYS = 30;

/** The days `cc-smart-dev-kit usage` shows: today and the seven before it. */
export const SAFETY_CHECK_WINDOW_DAYS = 8;

const countSchema = z.object({
  cacheRead: z.number(),
  cacheWrite: z.number(),
  /** How many checks this side answered. */
  checks: z.number(),
  input: z.number(),
  /** The final count: the last `message_delta`'s on a stream. */
  output: z.number(),
});

const daySchema = z.object({
  anthropic: countSchema,
  /** Every safety-check request the router handled that day, answered or not. */
  checks: z.number(),
  fallback: countSchema,
});

const stateSchema = z.object({
  /** `YYYY-MM-DD` in the machine's own time zone → that day's counts. */
  days: z.record(z.string(), daySchema),
  version: z.literal(1),
});

/** The tokens one answer reported in its `usage`. */
export interface CheckTokens {
  /** Tokens served from Anthropic's prompt cache (`cache_read_input_tokens`). */
  cacheRead: number;
  /** Tokens written into that cache (`cache_creation_input_tokens`). */
  cacheWrite: number;
  /** Tokens sent (`input_tokens`). */
  input: number;
  /** Tokens written (`output_tokens`). */
  output: number;
}

/** One side's checks that day, with the tokens its answers reported. */
export interface CheckCount extends CheckTokens {
  /** How many checks this side answered. */
  checks: number;
}

/** One local day. */
export type CheckDay = z.output<typeof daySchema>;

export type SafetyCheckState = z.output<typeof stateSchema>;

/** Who answered a safety check: Anthropic, or a target of the judge slot (`fallback`, the name the file has kept since 0.3). */
export type CheckSide = "anthropic" | "fallback";

export function emptySafetyChecks(): SafetyCheckState {
  return { days: {}, version: 1 };
}

/** The file's text, as the router writes it. */
export function formatSafetyCheckState(state: SafetyCheckState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** The state from the file's text; null when it is not a state this version reads. */
export function parseSafetyCheckState(text: string): SafetyCheckState | null {
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
 * The local calendar day of a time, `YYYY-MM-DD`, in `timeZone` (undefined: the machine's).
 * The day a check belongs to is the person's day, not UTC's: an evening's work in Dubai is
 * one day, not two.
 */
export function localDay(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(new Date(ms));
}

/** A `YYYY-MM-DD` key moved `days` back: whole days of a calendar, which always has 24 hours. */
function dayBefore(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The newest days the state holds, newest first: today and the `count - 1` before it. */
export function recentCheckDays(
  state: SafetyCheckState,
  nowMs: number,
  count: number,
  timeZone?: string,
): [string, CheckDay][] {
  const today = localDay(nowMs, timeZone);
  const wanted = new Set(Array.from({ length: count }, (_, back) => dayBefore(today, back)));
  return Object.entries(state.days)
    .filter(([day]) => wanted.has(day))
    .sort(([a], [b]) => (a < b ? 1 : -1));
}

/** The day's record, made when the day is first counted. */
function dayRecord(state: SafetyCheckState, day: string): CheckDay {
  const existing = state.days[day];
  if (existing !== undefined) return existing;
  const fresh: CheckDay = {
    anthropic: { cacheRead: 0, cacheWrite: 0, checks: 0, input: 0, output: 0 },
    checks: 0,
    fallback: { cacheRead: 0, cacheWrite: 0, checks: 0, input: 0, output: 0 },
  };
  state.days[day] = fresh;
  return fresh;
}

/** Drops the days past `keep`, oldest first, so the file cannot grow past a month. */
function pruneSafetyChecks(state: SafetyCheckState, keep = SAFETY_CHECK_DAYS): void {
  const days = Object.keys(state.days).sort();
  for (const day of days.slice(0, Math.max(0, days.length - keep))) delete state.days[day];
}

/**
 * One safety-check request, counted on its day. `side` is who answered it: null when no
 * answer reached Claude Code (a target that failed, a client that hung up).
 */
export function recordSafetyCheck(
  state: SafetyCheckState,
  day: string,
  side: CheckSide | null,
): void {
  const record = dayRecord(state, day);
  record.checks += 1;
  if (side !== null) record[side].checks += 1;
  pruneSafetyChecks(state);
}

/**
 * The tokens one answer reported, added to the day it belongs to. A day that is gone
 * (pruned while a long answer streamed) takes nothing.
 */
export function addCheckTokens(
  state: SafetyCheckState,
  day: string,
  side: CheckSide,
  tokens: CheckTokens,
): void {
  const count = state.days[day]?.[side];
  if (count === undefined) return;
  count.cacheRead += tokens.cacheRead;
  count.cacheWrite += tokens.cacheWrite;
  count.input += tokens.input;
  count.output += tokens.output;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `usage` field as a token count; null when the answer did not report one (absent, or
 * not a number). Never guessed: a wrong count in this file is worse than no count. */
function tokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/** The four counts of a `usage` object; null when it named none of them. */
function tokensOf(usage: unknown): CheckTokens | null {
  if (!isJsonObject(usage)) return null;
  const input = tokenCount(usage.input_tokens);
  const output = tokenCount(usage.output_tokens);
  const cacheRead = tokenCount(usage.cache_read_input_tokens);
  const cacheWrite = tokenCount(usage.cache_creation_input_tokens);
  if (input === null && output === null && cacheRead === null && cacheWrite === null) return null;
  return {
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
    input: input ?? 0,
    output: output ?? 0,
  };
}

/** The `data` payload of every server-sent event in `text`. */
function eventData(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /, ""));
    if (data.length > 0) out.push(data.join("\n"));
  }
  return out;
}

/**
 * The tokens an answer's body reported, or null when it reported none.
 *
 * `streaming`: a server-sent event stream. Anthropic sends the input and cache counts
 * once, in `message_start` (its `usage` hangs on the `message` object, and its
 * `output_tokens` is a partial 1), and the output count again — the final, cumulative
 * one — in each `message_delta`. So input and cache come from the start, the output from
 * the last delta (the start's when no delta arrived, a stream cut short). A field that is
 * not there, or not a number, means the answer did not report it.
 */
export function checkUsageFromAnswer(text: string, streaming: boolean): CheckTokens | null {
  if (!streaming) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: an error page, a half-written body — no usage to read.
      return null;
    }
    return tokensOf(isJsonObject(body) ? body.usage : undefined);
  }
  let start: CheckTokens | null = null;
  let output: number | null = null;
  for (const data of eventData(text)) {
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      // A half-written event (the stream was cut inside it): it decides nothing.
      continue;
    }
    if (!isJsonObject(event)) continue;
    if (event.type === "message_start" && isJsonObject(event.message)) {
      start = tokensOf(event.message.usage) ?? start;
    }
    if (event.type === "message_delta") {
      output =
        tokenCount(isJsonObject(event.usage) ? event.usage.output_tokens : undefined) ?? output;
    }
  }
  if (start === null && output === null) return null;
  return {
    ...(start ?? { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 }),
    output: output ?? start?.output ?? 0,
  };
}
