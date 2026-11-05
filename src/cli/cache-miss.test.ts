/**
 * The prompt cache's last miss (`cache-miss.ts`): read from the status line input in the shape
 * code.claude.com/docs/en/statusline documents, shown for a minute after the miss with no state,
 * and recorded for `doctor --live`. Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  cacheMissOf,
  cacheMissRecordFile,
  cacheMissSegment,
  readCacheMissRecord,
} from "./cache-miss";

const SESSION = "11111111-2222-3333-4444-555555555555";

/** 2026-10-15 10:00 UTC, in Unix seconds and in ms. */
const AT = Date.UTC(2026, 9, 15, 10, 0, 0) / 1000;
const AT_MS = AT * 1000;

/** A status line input whose `prompt_cache` holds a miss at `at` with `cause` (as documented). */
function input(at: unknown, cause: unknown): Record<string, unknown> {
  return {
    prompt_cache: {
      hit_ratio: 0.91,
      last_miss_at: at,
      last_miss_cause: cause,
      misses: 2,
      warm: true,
    },
    session_id: SESSION,
  };
}

function stateDir(): string {
  return join(tempDir("miss-state"), "state");
}

describe("cacheMissOf", () => {
  it("the documented shape: the time and the causes", () => {
    expect(
      cacheMissOf(input(AT, { causes: ["tools_changed"], tools_added: 2, tools_removed: 0 })),
    ).toEqual({ at: AT, causes: ["tools_changed"] });
  });

  it("no miss yet, no prompt_cache, or not an object: nothing", () => {
    expect(cacheMissOf(input(null, null))).toBeNull();
    expect(cacheMissOf({ session_id: SESSION })).toBeNull();
    expect(cacheMissOf("text")).toBeNull();
  });

  it("a miss whose cause Claude Code did not find: a miss with no cause", () => {
    expect(cacheMissOf(input(100, null))).toEqual({ at: 100, causes: null });
    expect(cacheMissOf(input(100, { causes: [] }))).toEqual({ at: 100, causes: null });
  });
});

describe("cacheMissSegment: for a minute after the miss, with no state", () => {
  it("inside the minute: shown at every refresh, and recorded once, mode 600", () => {
    const dir = stateDir();
    const miss = input(AT, { causes: ["system_prompt_changed"], system_char_delta: 40 });
    expect(cacheMissSegment(miss, dir, AT_MS + 1000)).toBe("cache miss: system_prompt_changed");
    // A second refresh (or one after a cancelled run) still shows it: nothing was used up.
    expect(cacheMissSegment(miss, dir, AT_MS + 59_000)).toBe("cache miss: system_prompt_changed");
    expect(readCacheMissRecord(dir)).toEqual({ at: AT, causes: ["system_prompt_changed"] });
    expect(statSync(cacheMissRecordFile(dir)).mode & 0o777).toBe(0o600);
    expect(readFileSync(cacheMissRecordFile(dir), "utf8")).toBe(
      `{"at":${AT},"causes":["system_prompt_changed"]}\n`,
    );
  });

  it("past the minute: not shown, and not recorded", () => {
    const dir = stateDir();
    expect(cacheMissSegment(input(AT, { causes: ["tools_changed"] }), dir, AT_MS + 60_000)).toBe(
      null,
    );
    expect(readCacheMissRecord(dir)).toBeNull();
  });

  it("a missing or bad last_miss_at: nothing", () => {
    const dir = stateDir();
    for (const at of [null, undefined, "1738425230", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cacheMissSegment(input(at, { causes: ["tools_changed"] }), dir, AT_MS)).toBeNull();
    }
    expect(cacheMissSegment({ session_id: SESSION }, dir, AT_MS)).toBeNull();
  });

  it("a miss with no cause found says so", () => {
    expect(cacheMissSegment(input(AT, null), stateDir(), AT_MS)).toBe(
      "cache miss: cause not known",
    );
  });

  it("a new miss replaces the record", () => {
    const dir = stateDir();
    cacheMissSegment(input(AT, { causes: ["tools_changed"] }), dir, AT_MS);
    cacheMissSegment(input(AT + 300, { causes: ["ttl_expired_5m"] }), dir, AT_MS + 300_000);
    expect(readCacheMissRecord(dir)).toEqual({ at: AT + 300, causes: ["ttl_expired_5m"] });
  });

  it("a broken record reads as none", () => {
    const dir = stateDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(cacheMissRecordFile(dir), "{ broken");
    expect(readCacheMissRecord(dir)).toBeNull();
  });
});
