/**
 * The breaker's pure parts: what counts as a capacity failure, the answer the router gives
 * when a slot's every target is limited or down, and the words the log, the health page and
 * `gateway status` use for it. The router (`router.ts`) holds the state and does the waiting.
 *
 * Why a breaker: when every target of a slot is limited or down, an answer that fails within
 * minutes ends every agent on the machine at once. The router holds the request for a while
 * (the config is read once a second, so a changed chain is served at once), then answers a
 * 429 that Claude Code retries by itself. What Claude Code does with that answer, proved on
 * 2.1.306 (docs/claude-code-contract.md):
 *   - a 429 with no quota headers is retried 10 times, and a `retry-after` above 60 seconds
 *     ends the request at once, so the answer's is 60 or less;
 *   - a 429 never switches to a `--fallback-model`; a 529 does after three;
 *   - a request held with no headers is not cut for at least 330 seconds.
 * The router never fakes Anthropic's quota headers: Claude Code would show plan-limit and
 * upsell messages, and its auto-continue would wait for a limit that is not the plan's.
 *
 * Pure: it imports no clock and no state, and nothing that carries the plugin version (the
 * router bundle imports it).
 */

import { COMMAND } from "../build-info/names";
import { formatClock } from "./limit-state";
import { CAPACITY_STATUSES, SLOT_PREFIX } from "./targets";

/** At most this many requests wait in the hold for one slot; the next one is answered at once. */
export const BREAKER_MAX_HELD = 64;

/**
 * The longest `retry-after`, in seconds, that Claude Code waits for: above this it ends the
 * request at once (proved on 2.1.306, docs/claude-code-contract.md). Every `retry-after` the
 * router relays or sends is capped here.
 */
export const CLIENT_RETRY_AFTER_CEILING_SEC = 60;

/** The `retry-after` of the breaker's answer when no rest end is known. */
export const BREAKER_RETRY_AFTER_UNKNOWN_SEC = 30;

/** How often a held request reads the config and looks again, in milliseconds. */
export const BREAKER_POLL_MS = 1000;

/**
 * The longest the router waits for the last target of a streaming request to give its first
 * real event (or its headers), while the breaker is on: a stream of heartbeats only would
 * otherwise stall Claude Code for its whole 5 minutes. A hold counts from the request's start,
 * so the wait and the hold together stay under the hold's ceiling.
 */
export const BREAKER_HEARTBEAT_WAIT_MS = 180_000;

/** At most one reminder line this often, while a breaker stays open. */
export const BREAKER_REMINDER_MS = 10 * 60_000;

/** The `retry-after` of an answer to a request released at SIGTERM, in seconds. */
export const BREAKER_SHUTDOWN_RETRY_AFTER_SEC = 5;

/** The `retry-after` of an answer to a request whose slot changed under it, in seconds. */
export const BREAKER_RELEASED_RETRY_AFTER_SEC = 1;

/**
 * Is this a capacity failure: the target cannot answer now, and may again later? A status in
 * `CAPACITY_STATUSES` (408, 429, 5xx, 529), or no status at all (a network error, or a
 * header or first-event timeout). Not a 400 or a refused key, which the person must fix, and
 * not an error inside a 200 stream, which may be about this one request.
 */
export function isCapacityFailure(status: null | number): boolean {
  return status === null || CAPACITY_STATUSES.has(status);
}

/** A `retry-after` Claude Code accepts: whole seconds, at most the ceiling. */
export function capRetryAfter(seconds: number): number {
  return Math.min(seconds, CLIENT_RETRY_AFTER_CEILING_SEC);
}

/**
 * The `retry-after` of the breaker's own answer, in whole seconds: the wait asked for, from 1
 * to the ceiling; `BREAKER_RETRY_AFTER_UNKNOWN_SEC` when none is known.
 */
export function clientRetryAfter(seconds: null | number): number {
  if (seconds === null) return BREAKER_RETRY_AFTER_UNKNOWN_SEC;
  return Math.max(1, capRetryAfter(Math.ceil(seconds)));
}

/** One target of a slot whose breaker is open, as the answer and the log name it. */
export interface BreakerFailure {
  /** Why it does not answer, in a few words (`HTTP 429`, `no event in time …`). */
  reason: string;
  /** The HTTP status of its last failure, or null when it gave none. */
  status: null | number;
  /** The target, as the config spells it. */
  target: string;
  /** Milliseconds since the epoch: when its rest ends. */
  until: number;
}

/** The slot's short name, as a person types it: `cc-smart-dev-kit-worker` → `worker`. */
export function slotShortName(slot: string): string {
  return slot.startsWith(SLOT_PREFIX) ? slot.slice(SLOT_PREFIX.length) : slot;
}

/** Seconds from `nowMs` until the earliest rest ends; null when no target is named. */
export function earliestRestSeconds(
  failures: readonly BreakerFailure[],
  nowMs: number,
): null | number {
  if (failures.length === 0) return null;
  const earliest = Math.min(...failures.map((failure) => failure.until));
  return Math.max(0, Math.ceil((earliest - nowMs) / 1000));
}

/** `omniroute:a: HTTP 429, until 21:07` for each target, joined with `; `. */
export function describeFailures(failures: readonly BreakerFailure[], nowMs: number): string {
  return failures
    .map(
      (failure) =>
        `${failure.target}: ${failure.reason}, until ${formatClock(Math.ceil(failure.until / 1000), nowMs)}`,
    )
    .join("; ");
}

/**
 * The command that changes the chain that failed, without the program's name (the status line
 * is short): `gateway slot worker <targets>` for the machine's chain, and for a profile
 * `gateway profile <name> slot worker <targets>` — a profile's chain is not the `gateway slot`
 * one, and the profile command works whether the profile names the slot or not.
 */
export function breakerChangeCommand(slot: string, profile: null | string): string {
  const short = slotShortName(slot);
  return profile === null
    ? `gateway slot ${short} <targets>`
    : `gateway profile ${profile} slot ${short} <targets>`;
}

/**
 * What to change when a chain's every target is limited or down, as the words after
 * "change it:". A profile that names no chain for the slot (`inherited`) uses the machine's, so
 * there are two ways out and the words say what each changes; with the profile's own chain, or
 * when the caller cannot tell, the profile command alone is the one that is always right.
 */
export function breakerChangeHint(
  slot: string,
  profile: null | string = null,
  inherited = false,
): string {
  const own = `${COMMAND} ${breakerChangeCommand(slot, profile)}`;
  if (profile === null || !inherited) return own;
  return `${own} (a chain of its own for this profile), or ${COMMAND} ${breakerChangeCommand(slot, null)} (the machine's chain, which this profile uses)`;
}

/** The text of the breaker's answer, and of the line `gateway status` prints. */
export function breakerMessage(
  slot: string,
  sinceMs: number,
  failures: readonly BreakerFailure[],
  nowMs: number,
  profile: null | string = null,
  inherited = false,
): string {
  const since = formatClock(Math.floor(sinceMs / 1000), nowMs);
  const named = failures.length === 0 ? "" : ` (${describeFailures(failures, nowMs)})`;
  const where = profile === null ? slot : `${slot} in profile ${profile}`;
  return `cc-smart-dev-kit-router: every target of ${where} is limited or down since ${since}${named}; change it: ${breakerChangeHint(slot, profile, inherited)}`;
}

/**
 * The 429 Claude Code retries by itself: `rate_limit_error`, a `retry-after` it accepts, and
 * `x-should-retry: true`. Never any `anthropic-ratelimit-unified-*` header.
 */
export function breakerAnswer(answer: {
  failures: readonly BreakerFailure[];
  /** Replaces the usual `retry-after` (whole seconds, capped and at least 1). */
  retryAfterSec?: number;
  slot: string;
  /** The profile whose chain the slot's failure is about; null (or absent): the machine's. */
  profile?: null | string;
  /** The profile names no chain for the slot: it uses the machine's (`breakerChangeHint`). */
  inherited?: boolean;
  sinceMs: number;
  nowMs: number;
  /** Replaces the usual message: a request released before its hold ended says why. */
  message?: string;
}): Response {
  const retryAfter = clientRetryAfter(
    answer.retryAfterSec ?? earliestRestSeconds(answer.failures, answer.nowMs),
  );
  return Response.json(
    {
      error: {
        message:
          answer.message ??
          breakerMessage(
            answer.slot,
            answer.sinceMs,
            answer.failures,
            answer.nowMs,
            answer.profile ?? null,
            answer.inherited ?? false,
          ),
        type: "rate_limit_error",
      },
      type: "error",
    },
    { headers: { "retry-after": String(retryAfter), "x-should-retry": "true" }, status: 429 },
  );
}

/** A duration for the close line: `45s`, `7m`, `1h12m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}

/**
 * The lines `gateway status` prints for the breakers the router's health page names:
 * `cc-smart-dev-kit-worker: all targets limited, holding requests since 21:05 (omniroute:a
 * 429 until 21:07; …)`. Anything in the page that is not the shape the router writes is
 * ignored, so a newer or older router never breaks the command.
 */
export function breakerStatusLines(value: unknown, nowMs: number): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const [slot, record] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (typeof record !== "object" || record === null) continue;
    const since = "since" in record && typeof record.since === "number" ? record.since : null;
    const targets = "targets" in record && Array.isArray(record.targets) ? record.targets : [];
    const named = targets.flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const target = "target" in entry && typeof entry.target === "string" ? entry.target : null;
      if (target === null) return [];
      const status = "status" in entry && typeof entry.status === "number" ? entry.status : null;
      const until = "until" in entry && typeof entry.until === "number" ? entry.until : null;
      const why = status === null ? "no answer" : String(status);
      const when = until === null ? "" : ` until ${formatClock(Math.ceil(until / 1000), nowMs)}`;
      return [`${target} ${why}${when}`];
    });
    const sinceWords =
      since === null ? "" : ` since ${formatClock(Math.floor(since / 1000), nowMs)}`;
    lines.push(
      `  ${slot}: all targets limited, holding requests${sinceWords}${named.length > 0 ? ` (${named.join("; ")})` : ""}`,
    );
  }
  return lines;
}
