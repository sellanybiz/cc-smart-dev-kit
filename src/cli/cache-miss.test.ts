/**
 * The prompt cache's last miss (`cache-miss.ts`): read from the status line input in the shape
 * code.claude.com/docs/en/statusline documents, shown once a miss per session, and recorded for
 * `doctor --live`. Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  cacheMissMark,
  cacheMissOf,
  cacheMissRecordFile,
  newCacheMiss,
  readCacheMissRecord,
} from "./cache-miss";

const SESSION = "11111111-2222-3333-4444-555555555555";

/** A status line input whose `prompt_cache` holds a miss at `at` with `cause` (as documented). */
function input(at: null | number, cause: unknown, sessionId = SESSION): Record<string, unknown> {
  return {
    prompt_cache: {
      hit_ratio: 0.91,
      last_miss_at: at,
      last_miss_cause: cause,
      misses: 2,
      warm: true,
    },
    session_id: sessionId,
  };
}

function world() {
  const env = { TMPDIR: tempDir("miss-tmp") };
  const stateDir = join(tempDir("miss-state"), "state");
  return { env, stateDir };
}

describe("cacheMissOf", () => {
  it("the documented shape: the time and the causes", () => {
    expect(
      cacheMissOf(
        input(1_738_425_230, { causes: ["tools_changed"], tools_added: 2, tools_removed: 0 }),
      ),
    ).toEqual({ at: 1_738_425_230, causes: ["tools_changed"] });
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

describe("newCacheMiss: once a miss, per session", () => {
  it("shown once, then not again until a new miss; each one recorded, mode 600", () => {
    const { env, stateDir } = world();
    const first = input(100, { causes: ["system_prompt_changed"], system_char_delta: 40 });
    expect(newCacheMiss(first, env, stateDir)).toBe("cache miss: system_prompt_changed");
    expect(newCacheMiss(first, env, stateDir)).toBeNull();
    expect(readCacheMissRecord(stateDir)).toEqual({ at: 100, causes: ["system_prompt_changed"] });
    expect(statSync(cacheMissRecordFile(stateDir)).mode & 0o777).toBe(0o600);
    const second = input(200, { causes: ["tools_changed", "ttl_expired_5m"] });
    expect(newCacheMiss(second, env, stateDir)).toBe("cache miss: tools_changed, ttl_expired_5m");
    expect(newCacheMiss(second, env, stateDir)).toBeNull();
    expect(readFileSync(cacheMissRecordFile(stateDir), "utf8")).toBe(
      '{"at":200,"causes":["tools_changed","ttl_expired_5m"]}\n',
    );
  });

  it("a miss with no cause found says so", () => {
    const { env, stateDir } = world();
    expect(newCacheMiss(input(100, null), env, stateDir)).toBe("cache miss: cause not known");
  });

  it("another session sees the same miss data as its own", () => {
    const { env, stateDir } = world();
    const cause = { causes: ["tools_changed"] };
    expect(newCacheMiss(input(100, cause), env, stateDir)).toBe("cache miss: tools_changed");
    const other = input(100, cause, "99999999-2222-3333-4444-555555555555");
    expect(newCacheMiss(other, env, stateDir)).toBe("cache miss: tools_changed");
  });

  it("a session id Claude Code would not write, or a mark that cannot be kept: nothing", () => {
    const { env, stateDir } = world();
    expect(newCacheMiss(input(100, null, "s-1"), env, stateDir)).toBeNull();
    // The names folder is a FILE here, so the mark cannot be made.
    const mark = cacheMissMark(env, SESSION);
    mkdirSync(dirname(dirname(mark)), { recursive: true });
    writeFileSync(dirname(mark), "");
    expect(newCacheMiss(input(100, null), env, stateDir)).toBeNull();
    expect(existsSync(cacheMissRecordFile(stateDir))).toBe(false);
  });

  it("a broken record reads as none", () => {
    const { stateDir } = world();
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(cacheMissRecordFile(stateDir), "{ broken");
    expect(readCacheMissRecord(stateDir)).toBeNull();
  });
});
