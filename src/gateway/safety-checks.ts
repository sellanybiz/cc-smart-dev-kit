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
import type { HistoryOutcome } from "./history";

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

/**
 * How much of an answer's JSON body is kept to read its `usage`: a whole answer's usage is a
 * few hundred bytes at its end. Past this, the answer's tokens are not read (a check is still
 * counted, a history row says no usage): a surprising answer cannot grow the router's memory.
 */
export const CHECK_USAGE_MAX_BYTES = 256 * 1024;

/**
 * The most characters of one server-sent event the reader holds while it waits for the
 * event's end. A usage event is far smaller; a content event past this is not one, and is
 * dropped (the client still got its bytes).
 */
const EVENT_MAX_CHARS = 64 * 1024;

const EMPTY_TOKENS: CheckTokens = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };

/** Where the next complete server-sent event ends, and how long its separator is. */
function nextEventEnd(text: string): { at: number; length: number } | null {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { at: crlf, length: 4 };
  return lf === -1 ? null : { at: lf, length: 2 };
}

/**
 * An answer's `usage`, read from bytes as they go by, so an answer of any size is read
 * without keeping it: this is how a history row gets the tokens of a long streamed answer
 * (`router.ts`'s `observedAnswer`). Two shapes, as `checkUsageFromAnswer` describes:
 *   - streaming: each server-sent event is read as it ends; a count the last `message_delta`
 *     reports wins over the `message_start` one, field by field. An event larger than
 *     `EVENT_MAX_CHARS` is not a usage event and is dropped; a stream cut inside an event
 *     leaves that event unread, as the text parser does.
 *   - not streaming: the JSON body is kept, up to `CHECK_USAGE_MAX_BYTES`; a larger body
 *     reports no tokens.
 */
export class AnswerUsageReader {
  private readonly decoder = new TextDecoder();
  private readonly streaming: boolean;
  private partial = "";
  private body = "";
  private tooBig = false;
  private start: CheckTokens | null = null;
  private failure: HistoryOutcome | null = null;

  /** Read after tokens(), which also finishes the last event or JSON body. */
  outcome(): HistoryOutcome | null {
    return this.failure;
  }

  private noteOutcome(value: unknown): void {
    if (!isJsonObject(value)) return;
    if (value.type === "error") this.failure = "stream_error";
    else if (
      this.failure === null &&
      (value.stop_reason === "refusal" ||
        (isJsonObject(value.delta) && value.delta.stop_reason === "refusal") ||
        (isJsonObject(value.message) && value.message.stop_reason === "refusal"))
    )
      this.failure = "refused";
  }
  /** The counts the last `message_delta` named; a field it did not name is not here. */
  private delta: Partial<CheckTokens> = {};

  constructor(streaming: boolean) {
    this.streaming = streaming;
  }

  /** One chunk of the answer's bytes, as the client got them (decoded here). */
  push(chunk: Uint8Array): void {
    if (this.streaming) {
      this.partial += this.decoder.decode(chunk, { stream: true });
      this.scan();
      return;
    }
    if (this.tooBig) return;
    this.body += this.decoder.decode(chunk, { stream: true });
    if (this.body.length > CHECK_USAGE_MAX_BYTES) {
      this.tooBig = true;
      this.body = "";
    }
  }

  /** The counts read so far; null when the answer reported none (or was too large). */
  tokens(): CheckTokens | null {
    if (!this.streaming) {
      if (this.tooBig) return null;
      this.body += this.decoder.decode();
      let parsed: unknown;
      try {
        parsed = JSON.parse(this.body);
      } catch {
        // Not JSON: an error page, a half-written body — no usage to read.
        return null;
      }
      this.noteOutcome(parsed);
      return tokensOf(isJsonObject(parsed) ? parsed.usage : undefined);
    }
    this.partial += this.decoder.decode();
    this.scan();
    // A last event with no blank line after it is an event too (the text parser reads it).
    if (this.partial.trim() !== "") this.readEvent(this.partial);
    this.partial = "";
    if (this.start === null && Object.keys(this.delta).length === 0) return null;
    const start = this.start ?? EMPTY_TOKENS;
    return {
      cacheRead: this.delta.cacheRead ?? start.cacheRead,
      cacheWrite: this.delta.cacheWrite ?? start.cacheWrite,
      input: this.delta.input ?? start.input,
      output: this.delta.output ?? start.output,
    };
  }

  /** Reads every complete event in `partial`, and drops one grown past a usage event's size. */
  private scan(): void {
    for (;;) {
      const end = nextEventEnd(this.partial);
      if (end === null) break;
      const event = this.partial.slice(0, end.at);
      this.partial = this.partial.slice(end.at + end.length);
      this.readEvent(event);
    }
    if (this.partial.length > EVENT_MAX_CHARS) this.partial = "";
  }

  /**
   * The counts one `message_delta` names, over the ones a delta before it named: the last
   * delta's word wins, field by field. A field this event does not name is **not** a zero —
   * Anthropic's own `message_delta` often names only `output_tokens`, and reading that as a
   * zero would wipe the input count the start gave.
   */
  private mergeDelta(usage: unknown): void {
    if (!isJsonObject(usage)) return;
    const named: [keyof CheckTokens, unknown][] = [
      ["cacheRead", usage.cache_read_input_tokens],
      ["cacheWrite", usage.cache_creation_input_tokens],
      ["input", usage.input_tokens],
      ["output", usage.output_tokens],
    ];
    for (const [field, value] of named) {
      const count = tokenCount(value);
      if (count !== null) this.delta[field] = count;
    }
  }

  /** One event: its `data` lines, and the usage a `message_start` or `message_delta` holds. */
  private readEvent(block: string): void {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /, ""))
      .join("\n");
    if (data === "") return;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      // A half-written event (the stream was cut inside it): it decides nothing.
      return;
    }
    if (!isJsonObject(event)) return;
    this.noteOutcome(event);
    if (event.type === "message_start" && isJsonObject(event.message)) {
      this.start = tokensOf(event.message.usage) ?? this.start;
    }
    if (event.type === "message_delta") this.mergeDelta(event.usage);
  }
}

/**
 * The tokens an answer's body reported, or null when it reported none.
 *
 * `streaming`: a server-sent event stream. Which event carries a `usage`, and what it holds,
 * differs by backend, so each field is taken from the last event that **reports** it, and two
 * counts are never added together:
 *
 *   - Anthropic's `message_start` carries the `usage` on its `message` object with the input
 *     and cache counts. Its `message_delta` carries a cumulative `usage` that always names
 *     `output_tokens` and sometimes the input and cache counts too — its documented
 *     web-search example has `input_tokens` at 2,679 in the start and 10,682 at the end, so
 *     the start's count is not the final one.
 *   - A backend that translates an OpenAI stream knows the prompt's usage only at the end
 *     (OmniRoute's translator, read from its own `dist`): its `message_start` is a placeholder
 *     of zeros with no cache fields at all, and the real counts arrive in the last
 *     `message_delta`.
 *
 * So a count the last `message_delta` reports wins over the one `message_start` gave, for
 * every field; a field that event does not name keeps what the start gave. A field that is
 * missing, or not a number, means the answer did not report it.
 */
export function checkUsageFromAnswer(text: string, streaming: boolean): CheckTokens | null {
  const reader = new AnswerUsageReader(streaming);
  reader.push(new TextEncoder().encode(text));
  return reader.tokens();
}
