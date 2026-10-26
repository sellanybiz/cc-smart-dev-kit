/**
 * Auto mode's safety checks are failing (the owner, 2026-10-27): the words every place says it
 * with (`checks-down.ts`) — the status line, `gateway status`, `doctor`, the session's note — and
 * the file reader. The expected texts are written by hand, in UTC.
 */
import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { tempDir } from "../testing/temp";
import {
  checksDownCause,
  checksDownFix,
  checksDownNote,
  checksDownNow,
  checksDownReason,
  checksDownStatusline,
  checksDownText,
} from "./checks-down";
import {
  CHECKS_DOWN_WHY,
  type ChecksDownRecord,
  currentChecksDown,
  emptyLimitState,
  formatLimitState,
  type LimitState,
  parseLimitState,
} from "./limit-state";

const UTC = "UTC";
const MINUTE = 60_000;
/** 2026-10-15T14:30:00Z, and the check that first failed at 14:05. */
const NOW = Date.UTC(2026, 9, 15, 14, 30, 0);
const SINCE = Date.UTC(2026, 9, 15, 14, 5, 0);
/** 2026-10-15T18:00:00Z in Unix seconds: when Claude's five-hour window resets. */
const RESET = Date.UTC(2026, 9, 15, 18, 0, 0) / 1000;
/** The same hour a day later. */
const RESET_TOMORROW = RESET + 24 * 3600;

function record(extra: Partial<ChecksDownRecord> = {}): ChecksDownRecord {
  return {
    claim: "five_hour",
    lastAt: NOW - MINUTE,
    resetsAt: RESET,
    since: SINCE,
    status: 429,
    why: "untested",
    ...extra,
  };
}

describe("the reason: Claude's side, and why nothing stood in", () => {
  it("a plan limit with its window and reset, and no tested worker target", () => {
    expect(checksDownReason(record(), NOW, UTC)).toBe(
      "Claude is at its plan limit (five_hour) until 18:00, and no worker target has passed the judge test",
    );
  });

  it("a reset on another day names the day", () => {
    expect(checksDownReason(record({ resetsAt: RESET_TOMORROW }), NOW, UTC)).toBe(
      "Claude is at its plan limit (five_hour) until Oct 16 18:00, and no worker target has passed the judge test",
    );
  });

  it("a plan limit whose answer named no window or no reset says what it knows", () => {
    expect(checksDownReason(record({ claim: null }), NOW, UTC)).toBe(
      "Claude is at its plan limit until 18:00, and no worker target has passed the judge test",
    );
    expect(checksDownReason(record({ resetsAt: null }), NOW, UTC)).toBe(
      "Claude is at its plan limit (five_hour), and no worker target has passed the judge test",
    );
  });

  it("with no plan limit: a short rate limit, or Claude down with the status it gave", () => {
    const bare = { claim: null, resetsAt: null, why: "off" } as const;
    expect(checksDownReason(record({ ...bare, status: 429 }), NOW, UTC)).toBe(
      "Claude is rate-limiting requests (HTTP 429), and the judge's stand-in is switched off",
    );
    expect(checksDownReason(record({ ...bare, status: 529 }), NOW, UTC)).toBe(
      "Claude is down (HTTP 529), and the judge's stand-in is switched off",
    );
  });

  it("each cause, in words", () => {
    const words = (why: ChecksDownRecord["why"]) =>
      checksDownReason(record({ claim: null, resetsAt: null, status: 503, why }), NOW, UTC);
    expect(words("no-worker")).toBe(
      "Claude is down (HTTP 503), and the worker slot has no affordable target to stand in",
    );
    expect(words("failed")).toBe(
      "Claude is limited or down, and the stand-in failed too (HTTP 503)",
    );
    expect(words("chain-untested")).toBe(
      "Claude is down (HTTP 503), and no target of your judge chain has passed the judge test",
    );
    // A judge chain of the person's own that failed does not involve Claude.
    expect(words("chain-failed")).toBe("your judge chain failed (HTTP 503)");
  });

  it("a stand-in that failed after Claude's plan limit keeps the limit in the words", () => {
    expect(checksDownReason(record({ status: 503, why: "failed" }), NOW, UTC)).toBe(
      "Claude is at its plan limit (five_hour) until 18:00, and the stand-in failed too (HTTP 503)",
    );
  });

  it("the cause has no clock in it (the router's log uses it too)", () => {
    expect(checksDownCause(record())).toBe("no worker target has passed the judge test");
  });
});

describe("the exact fix, built from the command's name", () => {
  const fix = (extra: Partial<ChecksDownRecord>, profile: null | string = null) =>
    checksDownFix(record(extra), profile, NOW, UTC);

  it("no tested target: gateway setup tests the worker's targets", () => {
    expect(fix({ why: "untested" })).toBe(`${COMMAND} gateway setup`);
    // The proofs are the machine's: a profile's record names the same command.
    expect(fix({ why: "untested" }, "team")).toBe(`${COMMAND} gateway setup`);
  });

  it("a worker slot with no affordable target: give it one", () => {
    expect(fix({ why: "no-worker" })).toBe(`${COMMAND} gateway slot worker <targets>`);
    expect(fix({ why: "no-worker" }, "team")).toBe(
      `${COMMAND} gateway profile team slot worker <targets>`,
    );
  });

  it("the person turned the stand-in off: turn it on", () => {
    expect(fix({ why: "off" })).toBe(`${COMMAND} gateway fallback judge on`);
    expect(fix({ why: "off" }, "team")).toBe(`${COMMAND} gateway profile team fallback judge on`);
  });

  it("a judge chain with no usable target: test and set one", () => {
    expect(fix({ why: "chain-untested" })).toBe(`${COMMAND} gateway slot judge <targets>`);
  });

  it("a judge chain that failed: look at what the gateway sees", () => {
    expect(fix({ why: "chain-failed" })).toBe(`${COMMAND} gateway status`);
  });

  it("a stand-in that failed too: wait until Claude's reset, or for Claude when none is known", () => {
    expect(fix({ why: "failed" })).toBe("wait until 18:00");
    expect(fix({ resetsAt: RESET_TOMORROW, why: "failed" })).toBe("wait until Oct 16 18:00");
    expect(fix({ resetsAt: null, why: "failed" })).toBe(
      `wait for Claude to answer again (${COMMAND} gateway status shows the stand-in)`,
    );
  });

  it("every cause has a fix that names a command or a wait", () => {
    for (const why of CHECKS_DOWN_WHY) {
      expect(fix({ why }).length).toBeGreaterThan(0);
    }
  });
});

describe("the lines, verbatim", () => {
  it("gateway status and doctor: since when, the reason", () => {
    expect(checksDownText(record(), null, NOW, UTC)).toBe(
      "auto mode's safety checks are failing since 14:05: Claude is at its plan limit (five_hour) until 18:00, and no worker target has passed the judge test",
    );
  });

  it("a profile's record says which profile", () => {
    expect(checksDownText(record({ why: "off" }), "team", NOW, UTC)).toBe(
      "auto mode's safety checks are failing in profile team since 14:05: Claude is at its plan limit (five_hour) until 18:00, and the judge's stand-in is switched off",
    );
  });

  it("the status line: the same words, then the fix after an arrow", () => {
    expect(checksDownStatusline(record(), null, NOW, UTC)).toBe(
      `⛔ auto mode's safety checks are failing since 14:05: Claude is at its plan limit (five_hour) until 18:00, and no worker target has passed the judge test → ${COMMAND} gateway setup`,
    );
    expect(checksDownStatusline(record({ why: "failed", status: 503 }), "team", NOW, UTC)).toBe(
      "⛔ auto mode's safety checks are failing in profile team since 14:05: Claude is at its plan limit (five_hour) until 18:00, and the stand-in failed too (HTTP 503) → wait until 18:00",
    );
  });

  it("the session's note: the owner's sentence, with the reason and what the person can do", () => {
    expect(checksDownNote(record(), null, NOW, UTC)).toBe(
      `Auto mode's safety checks are failing: Claude is at its plan limit (five_hour) until 18:00, and no worker target has passed the judge test. You cannot fix this; say it to the person once (what they can do: ${COMMAND} gateway setup), then stop and wait — do not retry or argue.`,
    );
    expect(checksDownNote(record({ why: "failed", status: 503 }), null, NOW, UTC)).toBe(
      "Auto mode's safety checks are failing: Claude is at its plan limit (five_hour) until 18:00, and the stand-in failed too (HTTP 503). You cannot fix this; say it to the person once (what they can do: wait until 18:00), then stop and wait — do not retry or argue.",
    );
  });
});

describe("the state file reader", () => {
  function fileWith(state: LimitState): string {
    const path = join(tempDir("checks-down-"), "gateway-state.json");
    writeFileSync(path, formatLimitState(state));
    return path;
  }

  it("returns each current record by its state key, and not a stale one", () => {
    const state: LimitState = {
      ...emptyLimitState(),
      checksDown: {
        "cc-smart-dev-kit-judge": record(),
        "stale/cc-smart-dev-kit-judge": record({ lastAt: NOW - 15 * MINUTE }),
        "team/cc-smart-dev-kit-judge": record({ why: "off" }),
      },
    };
    expect(checksDownNow(fileWith(state), NOW).map(([key]) => key)).toEqual([
      "cc-smart-dev-kit-judge",
      "team/cc-smart-dev-kit-judge",
    ]);
  });

  it("says none for a file that is not there, one that is not a state, or one with no record", () => {
    const dir = tempDir("checks-down-");
    expect(checksDownNow(join(dir, "missing.json"), NOW)).toEqual([]);
    writeFileSync(join(dir, "bad.json"), "not json");
    expect(checksDownNow(join(dir, "bad.json"), NOW)).toEqual([]);
    expect(checksDownNow(fileWith(emptyLimitState()), NOW)).toEqual([]);
  });
});

describe("the record in the state file", () => {
  it("is written whole and read back the same; a file without it reads as before", () => {
    const state: LimitState = {
      ...emptyLimitState(),
      checksDown: { "cc-smart-dev-kit-judge": record() },
    };
    expect(parseLimitState(formatLimitState(state))).toStrictEqual(state);
    expect(parseLimitState(formatLimitState(emptyLimitState()))).toStrictEqual(emptyLimitState());
    expect(formatLimitState(emptyLimitState())).not.toContain("checksDown");
  });

  it("is refused as a whole when its cause is not one we know, like any bad record", () => {
    const text = JSON.stringify({
      checksDown: { "cc-smart-dev-kit-judge": { ...record(), why: "mystery" } },
      fallbacks: {},
      limits: {},
      version: 1,
    });
    expect(parseLimitState(text)).toBeNull();
  });

  it("counts for 15 minutes after the router last touched it, not a second more", () => {
    const state: LimitState = {
      ...emptyLimitState(),
      checksDown: {
        a: record({ lastAt: NOW - 1000 }),
        b: record({ lastAt: NOW - 15 * MINUTE }),
        c: record({ lastAt: NOW - (15 * MINUTE - 1) }),
      },
    };
    expect(currentChecksDown(state, NOW).map(([key]) => key)).toEqual(["a", "c"]);
  });
});
