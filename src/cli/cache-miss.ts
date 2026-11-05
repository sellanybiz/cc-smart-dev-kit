/**
 * The prompt cache's last miss, as Claude Code hands it to the status line (2.2.0): the one
 * reader of `prompt_cache.last_miss_at` and `prompt_cache.last_miss_cause`, the rule the status
 * line shows it by, and the record `doctor --live` reports.
 *
 * Why: a hook, a skill or the router that changed the start of a request would break the prompt
 * cache, and the session would pay to write it again. Nothing the kit adds is known to do that
 * (`additionalContext` lands where the hook fires, never in the system prompt), but it was never
 * measured; this makes a miss visible as it happens.
 *
 * The input (code.claude.com/docs/en/statusline § Prompt cache fields): `prompt_cache` is there
 * after the main conversation's first API response (Claude Code 2.1.251+). `last_miss_at` is the
 * last miss in Unix seconds, null while the session has none. `last_miss_cause` (2.1.260+) is
 * `{causes: string[], …}` — `tools_changed`, `system_prompt_changed`, `ttl_expired_5m`,
 * `likely_server_side`, … — and null until the first miss, and again when Claude Code found no
 * cause. A miss with no cause is still shown, as one whose cause is not known.
 *
 * **Shown for a while, with no state.** The segment shows while the miss is younger than
 * `CACHE_MISS_SHOW_MS`, read from the input alone: every refresh in that time shows it, and a
 * status line run Claude Code cancels (a newer refresh came) cannot use the miss up. The line
 * refreshes on events, not on a clock, so it may stay on screen past that time until the next
 * refresh.
 *
 * **The record.** A miss shown is also written to `<stateDir>/cache-miss.json` (mode 600, last
 * one wins, written only when it differs), so `doctor --live` can report the last miss any
 * session on this machine showed.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { COMMAND } from "../build-info/names";
import { atomicWrite } from "../setup/write";

/** How long after a miss the status line shows it. */
export const CACHE_MISS_SHOW_MS = 60_000;

/** One miss: when (Unix seconds), and what Claude Code found as its cause (null: none). */
export interface CacheMiss {
  at: number;
  causes: null | string[];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The last miss of a status line input; null before any miss, or with no `prompt_cache`. */
export function cacheMissOf(input: unknown): CacheMiss | null {
  if (!isJsonObject(input) || !isJsonObject(input.prompt_cache)) return null;
  const cache = input.prompt_cache;
  if (typeof cache.last_miss_at !== "number" || !Number.isFinite(cache.last_miss_at)) return null;
  const cause = cache.last_miss_cause;
  const causes =
    isJsonObject(cause) && Array.isArray(cause.causes)
      ? cause.causes.filter((one): one is string => typeof one === "string" && one !== "")
      : [];
  return { at: cache.last_miss_at, causes: causes.length === 0 ? null : causes };
}

/** A miss's cause, as words: Claude Code's cause names, or that none was found. */
export function cacheMissCause(miss: CacheMiss): string {
  return miss.causes === null ? "cause not known" : miss.causes.join(", ");
}

/** The status line's segment for a miss. */
export function cacheMissText(miss: CacheMiss): string {
  return `cache miss: ${cacheMissCause(miss)}`;
}

/** True while a miss is recent enough to show, at `nowMs` (either side: clocks drift). */
export function cacheMissRecent(miss: CacheMiss, nowMs: number): boolean {
  return Math.abs(nowMs - miss.at * 1000) < CACHE_MISS_SHOW_MS;
}

/** The file `doctor --live` reads the last miss from. */
export function cacheMissRecordFile(stateDir: string): string {
  return join(stateDir, "cache-miss.json");
}

const recordSchema = z.object({
  at: z.number(),
  causes: z.array(z.string()).nullable(),
});

/** The last miss a status line showed on this machine; null when none, or it cannot be read. */
export function readCacheMissRecord(stateDir: string): CacheMiss | null {
  const file = cacheMissRecordFile(stateDir);
  if (!existsSync(file)) return null;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    // A record that cannot be read is no record: the report says nothing about it.
    return null;
  }
}

/**
 * The segment for this input's miss while it is recent (`cacheMissRecent`), or null: no miss,
 * or one older than `CACHE_MISS_SHOW_MS`. A miss shown is recorded for `doctor --live` when the
 * record holds another; a record that cannot be written is one stderr line, and the segment
 * still shows.
 */
export function cacheMissSegment(input: unknown, stateDir: string, nowMs: number): null | string {
  const miss = cacheMissOf(input);
  if (miss === null || !cacheMissRecent(miss, nowMs)) return null;
  const stored = readCacheMissRecord(stateDir);
  if (stored === null || stored.at !== miss.at || cacheMissCause(stored) !== cacheMissCause(miss)) {
    try {
      mkdirSync(stateDir, { mode: 0o700, recursive: true });
      atomicWrite(cacheMissRecordFile(stateDir), `${JSON.stringify(miss)}\n`, 0o600);
    } catch (error) {
      console.error(
        `${COMMAND}: the cache miss was not recorded (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return cacheMissText(miss);
}
