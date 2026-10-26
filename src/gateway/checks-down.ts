/**
 * Auto mode's safety checks are failing (owner, 2026-10-27): the words, once, for every place
 * that says it. The router records the fact (`ChecksDownRecord`, `limit-state.ts`); the status
 * line, `gateway status`, `doctor`, and the one line a session reads all take their words from
 * here, so the reason and the fix are the same everywhere.
 *
 * Why it needs saying: when Claude's limit is full and nothing stands in for it, every check
 * fails, auto mode approves nothing, and Claude Code tells the model only that the checker is
 * "temporarily unavailable" (`docs/claude-code-contract.md` § The gateway). Nobody told the person
 * once, with the way out.
 *
 * Pure but for one reader (`checksDownNow`): no clock, no other file. The command's name comes
 * from `build-info/names`, never the version, because the router bundle imports this file.
 */

import { readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import {
  type ChecksDownRecord,
  type ChecksDownWhy,
  currentChecksDown,
  formatClock,
  parseLimitState,
} from "./limit-state";

/** Who is talking about: the machine's gateway (null), or a profile's (`…/p/<name>`). */
export type DownProfile = null | string;

/**
 * The scopes whose safety checks are failing now, by state key, from the router's state file
 * (`checksDown`): what `gateway status`, `doctor` and the session's note read. A file that is
 * not there, or not readable, says none.
 */
export function checksDownNow(statePath: string, nowMs: number): [string, ChecksDownRecord][] {
  try {
    const state = parseLimitState(readFileSync(statePath, "utf8"));
    return state === null ? [] : currentChecksDown(state, nowMs);
  } catch {
    return [];
  }
}

/** `since 14:05`, in the machine's clock unless `timeZone` says (tests). */
function sinceWords(record: ChecksDownRecord, nowMs: number, timeZone?: string): string {
  return `since ${formatClock(Math.floor(record.since / 1000), nowMs, timeZone)}`;
}

/** Claude's side of it, in words: its plan limit with the reset when the answer said so. */
function claudeWords(record: ChecksDownRecord, nowMs: number, timeZone?: string): string {
  if (record.claim !== null || record.resetsAt !== null) {
    const claim = record.claim === null ? "" : ` (${record.claim})`;
    const reset =
      record.resetsAt === null ? "" : ` until ${formatClock(record.resetsAt, nowMs, timeZone)}`;
    return `Claude is at its plan limit${claim}${reset}`;
  }
  if (record.why === "failed") return "Claude is limited or down";
  return record.status === 429
    ? "Claude is rate-limiting requests (HTTP 429)"
    : `Claude is down (HTTP ${String(record.status)})`;
}

const CAUSES: Record<ChecksDownWhy, (record: ChecksDownRecord) => string> = {
  "chain-failed": (record) => `your judge chain failed (HTTP ${String(record.status)})`,
  "chain-untested": () => "no target of your judge chain has passed the judge test",
  failed: (record) => `the stand-in failed too (HTTP ${String(record.status)})`,
  "no-worker": () => "the worker slot has no affordable target to stand in",
  off: () => "the judge's stand-in is switched off",
  untested: () => "no worker target has passed the judge test",
};

/** Why no stand-in judged, in words; no clock in it (the router's log uses it too). */
export function checksDownCause(record: ChecksDownRecord): string {
  return CAUSES[record.why](record);
}

/**
 * What is wrong, in one sentence without a full stop: Claude's side and why nothing stood in.
 * A judge chain of the person's own that failed does not involve Claude, so it stands alone.
 */
export function checksDownReason(
  record: ChecksDownRecord,
  nowMs: number,
  timeZone?: string,
): string {
  const cause = checksDownCause(record);
  if (record.why === "chain-failed") return cause;
  return `${claudeWords(record, nowMs, timeZone)}, and ${cause}`;
}

/**
 * The exact fix, or the wait that is the only one. Every command is built from `COMMAND`:
 *   - `untested`: `gateway setup` tests the worker's targets (the proofs are the machine's);
 *   - `no-worker`: give the worker slot an affordable target (the command tests it);
 *   - `off`: the person's own switch, turned on again;
 *   - `chain-untested`: the judge chain's targets are tested by `gateway slot judge`;
 *   - `failed`, `chain-failed`: nothing of ours to change; wait for Claude's reset when its
 *     answer gave one, else look at what the gateway sees.
 */
export function checksDownFix(
  record: ChecksDownRecord,
  profile: DownProfile,
  nowMs: number,
  timeZone?: string,
): string {
  /** The machine's command, or the profile's own when the failing scope is a profile. */
  const own = (machine: string, forProfile: (name: string) => string): string =>
    `${COMMAND} ${profile === null ? machine : forProfile(profile)}`;
  switch (record.why) {
    case "untested":
      return `${COMMAND} gateway setup`;
    case "no-worker":
      return own(
        "gateway slot worker <targets>",
        (name) => `gateway profile ${name} slot worker <targets>`,
      );
    case "off":
      return own(
        "gateway fallback judge on",
        (name) => `gateway profile ${name} fallback judge on`,
      );
    case "chain-untested":
      return `${COMMAND} gateway slot judge <targets>`;
    case "chain-failed":
      return `${COMMAND} gateway status`;
    case "failed":
      return record.resetsAt === null
        ? `wait for Claude to answer again (${COMMAND} gateway status shows the stand-in)`
        : `wait until ${formatClock(record.resetsAt, nowMs, timeZone)}`;
  }
}

/** `since 14:05: <reason>`: the text `gateway status` and `doctor` print, with the fix apart. */
export function checksDownText(
  record: ChecksDownRecord,
  profile: DownProfile,
  nowMs: number,
  timeZone?: string,
): string {
  const where = profile === null ? "" : ` in profile ${profile}`;
  return `auto mode's safety checks are failing${where} ${sinceWords(record, nowMs, timeZone)}: ${checksDownReason(record, nowMs, timeZone)}`;
}

/** The status line's part: the same words, with the fix after an arrow. */
export function checksDownStatusline(
  record: ChecksDownRecord,
  profile: DownProfile,
  nowMs: number,
  timeZone?: string,
): string {
  return `⛔ ${checksDownText(record, profile, nowMs, timeZone)} → ${checksDownFix(record, profile, nowMs, timeZone)}`;
}

/**
 * The one line a session reads while the checks are down (Claude Code's own message tells the
 * model to retry; this one says the model cannot fix it, who can, and how). It names what the
 * person can do, so the model can say it once.
 */
export function checksDownNote(
  record: ChecksDownRecord,
  profile: DownProfile,
  nowMs: number,
  timeZone?: string,
): string {
  return `Auto mode's safety checks are failing: ${checksDownReason(record, nowMs, timeZone)}. You cannot fix this; say it to the person once (what they can do: ${checksDownFix(record, profile, nowMs, timeZone)}), then stop and wait — do not retry or argue.`;
}
