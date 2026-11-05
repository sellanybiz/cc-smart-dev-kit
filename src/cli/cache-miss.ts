/**
 * The prompt cache's last miss, as Claude Code hands it to the status line (2.2.0): the one
 * reader of `prompt_cache.last_miss_at` and `prompt_cache.last_miss_cause`, the once-a-miss rule
 * the status line shows it by, and the record `doctor --live` reports.
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
 * **Once a miss.** The status line runs after every answer; a miss is shown in the one line that
 * follows it, then not again until a new one. The last shown is kept per session in
 * `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.cachemiss` (`namesDir`, beside the
 * session's other marks, so the OS clears it). A mark that cannot be kept shows nothing: a miss
 * that cannot be remembered would show at every refresh.
 *
 * **The record.** Each miss shown is also written to `<stateDir>/cache-miss.json` (mode 600, last
 * one wins), so `doctor --live` can report the last miss any session saw on this machine.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { COMMAND } from "../build-info/names";
import { isSessionId, namesDir } from "../hooks/session-name";
import { atomicWrite } from "../setup/write";

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
  if (typeof cache.last_miss_at !== "number") return null;
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

/** The mark that holds the last miss shown in this session. */
export function cacheMissMark(env: Record<string, string | undefined>, sessionId: string): string {
  return join(namesDir(env), `${sessionId}.cachemiss`);
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
 * The segment for this input's miss when it is new to this session, or null: no miss, a session
 * id Claude Code would not write, the miss shown already, or a mark that cannot be kept. A new
 * miss is also recorded for `doctor --live`; a record that cannot be written is one stderr line,
 * and the segment still shows.
 */
export function newCacheMiss(
  input: unknown,
  env: Record<string, string | undefined>,
  stateDir: string,
): null | string {
  const miss = cacheMissOf(input);
  if (miss === null || !isJsonObject(input) || !isSessionId(input.session_id)) return null;
  const mark = cacheMissMark(env, input.session_id);
  const key = JSON.stringify(miss);
  try {
    if (existsSync(mark) && readFileSync(mark, "utf8") === key) return null;
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, key);
  } catch {
    // Not remembered, so not shown: else it would show at every refresh.
    return null;
  }
  try {
    mkdirSync(stateDir, { mode: 0o700, recursive: true });
    atomicWrite(cacheMissRecordFile(stateDir), `${key}\n`, 0o600);
  } catch (error) {
    console.error(
      `${COMMAND}: the cache miss was not recorded (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return cacheMissText(miss);
}
