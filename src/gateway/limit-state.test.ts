/**
 * The router's limit state file (`limit-state.ts`), its optional `breakers`: that a file written
 * before they existed reads as before, that a reader which does not know them ignores them, and
 * when a breaker's record counts as current, and how a time in it prints.
 *
 * Pure: no file, no clock. Expected values by hand.
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  type BreakerRecord,
  currentBreakers,
  emptyLimitState,
  formatClock,
  formatLimitState,
  type LimitState,
  mergeSeenClaude,
  NO_RESET_FRESH_MS,
  parseLimitState,
  SEEN_CLAUDE_MAX,
} from "./limit-state";

const NOW = Date.parse("2026-10-22T10:00:00.000Z");
const MINUTE = 60_000;

const WORKER = "cc-smart-dev-kit-worker";
const OPUS = "cc-smart-dev-kit-opus";
const SCOUT = "cc-smart-dev-kit-scout";

/** A state file as a router before the breaker wrote it. */
const OLD_FILE = `${JSON.stringify(
  {
    fallbacks: {
      [OPUS]: {
        lastAt: NOW - MINUTE,
        model: "claude-opus-5-5",
        resetsAt: 1_792_000_000,
        since: NOW - 5 * MINUTE,
        target: "omniroute:glm-5.3-flash",
      },
    },
    limits: {
      "claude-opus-5-5": { claim: "seven_day_opus", resetsAt: 1_792_000_000, seenAt: NOW - MINUTE },
    },
    version: 1,
  },
  null,
  2,
)}\n`;

/** An open breaker: its last target answered 429, the other gave no answer at all. */
function breaker(lastAt: number): BreakerRecord {
  return {
    held: 37,
    lastAt,
    since: NOW - 72 * MINUTE,
    targets: [
      { status: 429, target: "omniroute:glm-5.3-flash", until: NOW + 2 * MINUTE },
      { status: null, target: "omniroute:deepseek-v4.1-flash", until: NOW + 5 * MINUTE },
    ],
  };
}

function stateWith(breakers: Record<string, BreakerRecord>): LimitState {
  return { breakers, fallbacks: {}, limits: {}, version: 1 };
}

describe("a state file written before the breaker", () => {
  it("parses to what it parsed to before: no breakers key appears", () => {
    const state = parseLimitState(OLD_FILE);
    expect(state).toStrictEqual({
      fallbacks: {
        [OPUS]: {
          lastAt: NOW - MINUTE,
          model: "claude-opus-5-5",
          resetsAt: 1_792_000_000,
          since: NOW - 5 * MINUTE,
          target: "omniroute:glm-5.3-flash",
        },
      },
      limits: {
        "claude-opus-5-5": {
          claim: "seven_day_opus",
          resetsAt: 1_792_000_000,
          seenAt: NOW - MINUTE,
        },
      },
      version: 1,
    });
  });

  it("is written back the same: reading it and saving it adds no breakers", () => {
    const state = parseLimitState(OLD_FILE);
    if (state === null) throw new Error("the old file should parse");
    // Same keys, same values: the router that restarts and saves keeps the file as it was.
    expect(JSON.parse(formatLimitState(state))).toEqual(JSON.parse(OLD_FILE));
    expect(formatLimitState(state)).not.toContain("breakers");
  });

  it("has no breaker open, and the empty state has none either", () => {
    const state = parseLimitState(OLD_FILE);
    if (state === null) throw new Error("the old file should parse");
    expect(currentBreakers(state, NOW)).toEqual([]);
    expect(emptyLimitState()).toStrictEqual({ fallbacks: {}, limits: {}, version: 1 });
    expect(currentBreakers(emptyLimitState(), NOW)).toEqual([]);
  });
});

describe("a state file with a breaker", () => {
  it("is written as JSON with the record's five fields, and read back whole", () => {
    const state = stateWith({ [WORKER]: breaker(NOW) });
    const text = formatLimitState(state);
    expect(JSON.parse(text)).toEqual({
      breakers: {
        [WORKER]: {
          held: 37,
          lastAt: NOW,
          since: NOW - 72 * MINUTE,
          targets: [
            { status: 429, target: "omniroute:glm-5.3-flash", until: NOW + 2 * MINUTE },
            { status: null, target: "omniroute:deepseek-v4.1-flash", until: NOW + 5 * MINUTE },
          ],
        },
      },
      fallbacks: {},
      limits: {},
      version: 1,
    });
    expect(parseLimitState(text)).toStrictEqual(state);
  });

  it("keeps its fallbacks and limits beside it", () => {
    const withAll = parseLimitState(OLD_FILE);
    if (withAll === null) throw new Error("the old file should parse");
    const both: LimitState = { ...withAll, breakers: { [WORKER]: breaker(NOW) } };
    const back = parseLimitState(formatLimitState(both));
    expect(back).toStrictEqual(both);
    expect(Object.keys(back?.fallbacks ?? {})).toEqual([OPUS]);
  });

  it("is ignored by a reader that does not know the field, which still reads the rest", () => {
    // The schema of the reader before the breaker, as it was: this file must still satisfy it.
    // If the state's `version` ever moves, or a field of the old shape changes, this fails.
    const olderReader = z.object({
      fallbacks: z.record(
        z.string(),
        z.object({
          lastAt: z.number(),
          model: z.string(),
          resetsAt: z.number().nullable(),
          since: z.number(),
          target: z.string(),
        }),
      ),
      limits: z.record(
        z.string(),
        z.object({
          claim: z.string().nullable(),
          resetsAt: z.number().nullable(),
          seenAt: z.number(),
        }),
      ),
      version: z.literal(1),
    });
    const text = formatLimitState(stateWith({ [WORKER]: breaker(NOW) }));
    const read = olderReader.safeParse(JSON.parse(text));
    expect(read.success).toBe(true);
    expect(read.data).toStrictEqual({ fallbacks: {}, limits: {}, version: 1 });
  });

  it("is refused as a whole when a record is wrong, like a bad limit record is", () => {
    const good = JSON.parse(formatLimitState(stateWith({ [WORKER]: breaker(NOW) })));
    expect(parseLimitState(JSON.stringify(good))).not.toBeNull();
    const negative = structuredClone(good);
    negative.breakers[WORKER].held = -1;
    expect(parseLimitState(JSON.stringify(negative))).toBeNull();
    const noTargets = structuredClone(good);
    delete noTargets.breakers[WORKER].targets;
    expect(parseLimitState(JSON.stringify(noTargets))).toBeNull();
    const fractionStatus = structuredClone(good);
    fractionStatus.breakers[WORKER].targets[0].status = 429.5;
    expect(parseLimitState(JSON.stringify(fractionStatus))).toBeNull();
  });
});

describe("currentBreakers", () => {
  it("counts a record for 15 minutes after the router last touched it, not a second more", () => {
    expect(NO_RESET_FRESH_MS).toBe(15 * MINUTE);
    const state = stateWith({
      [OPUS]: breaker(NOW - 1000),
      [SCOUT]: breaker(NOW - 15 * MINUTE),
      [WORKER]: breaker(NOW - (15 * MINUTE - 1)),
    });
    // Sorted by slot; the scout's record is exactly 15 minutes old, so it is stale.
    expect(currentBreakers(state, NOW).map(([slot]) => slot)).toEqual([OPUS, WORKER]);
  });

  it("returns each current record whole", () => {
    const record = breaker(NOW - MINUTE);
    expect(currentBreakers(stateWith({ [WORKER]: record }), NOW)).toEqual([[WORKER, record]]);
  });

  it("does not wait for a target's rest to end: `until` is when it may be asked again, not when the breaker ends", () => {
    // Every rest is over, but the router touched the record a minute ago: a probe is due.
    const resting = breaker(NOW - MINUTE);
    resting.targets = resting.targets.map((target) => ({ ...target, until: NOW - 30_000 }));
    expect(currentBreakers(stateWith({ [WORKER]: resting }), NOW)).toHaveLength(1);
    // A record nobody has touched for an hour is stale even if a rest were to run longer.
    const forgotten = breaker(NOW - 60 * MINUTE);
    forgotten.targets = forgotten.targets.map((target) => ({
      ...target,
      until: NOW + 10 * MINUTE,
    }));
    expect(currentBreakers(stateWith({ [WORKER]: forgotten }), NOW)).toEqual([]);
  });

  it("changes nothing in the state it reads", () => {
    const state = stateWith({ [SCOUT]: breaker(NOW - 20 * MINUTE), [WORKER]: breaker(NOW) });
    const before = structuredClone(state);
    currentBreakers(state, NOW);
    expect(state).toStrictEqual(before);
  });
});

describe("seenClaude: the Claude ids Claude Code sent", () => {
  it("is optional: a file without it reads, and one a newer router wrote keeps it", () => {
    expect(parseLimitState(OLD_FILE)?.seenClaude).toBeUndefined();
    const withSeen = parseLimitState(
      JSON.stringify({
        fallbacks: {},
        limits: {},
        seenClaude: { "claude-opus-5-5": NOW },
        version: 1,
      }),
    );
    expect(withSeen?.seenClaude).toEqual({ "claude-opus-5-5": NOW });
  });

  it("merges two records: each id keeps its latest time", () => {
    expect(
      mergeSeenClaude(
        { "claude-opus-5-5": NOW, "claude-sonnet-5-5": NOW - MINUTE },
        { "claude-fable-5-5": NOW, "claude-opus-5-5": NOW - 2 * MINUTE },
      ),
    ).toEqual({
      "claude-fable-5-5": NOW,
      "claude-opus-5-5": NOW,
      "claude-sonnet-5-5": NOW - MINUTE,
    });
  });

  it("keeps only the 50 ids seen last, whatever order they came in", () => {
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};
    for (let index = 0; index < 60; index += 1) {
      (index < 30 ? a : b)[`claude-model-${String(index)}`] = NOW + index;
    }
    const merged = mergeSeenClaude(a, b);
    expect(Object.keys(merged)).toHaveLength(SEEN_CLAUDE_MAX);
    // The 10 oldest are gone; the rest keep their own times.
    expect(merged["claude-model-9"]).toBeUndefined();
    expect(merged["claude-model-10"]).toBe(NOW + 10);
    expect(merged["claude-model-59"]).toBe(NOW + 59);
  });
});

describe("formatClock", () => {
  it("shows a time today as the clock, another day with its date", () => {
    expect(formatClock(Date.parse("2026-10-22T13:05:00.000Z") / 1000, NOW, "UTC")).toBe("13:05");
    expect(formatClock(Date.parse("2026-10-24T08:30:00.000Z") / 1000, NOW, "UTC")).toBe(
      "Oct 24 08:30",
    );
  });

  it("never throws on a time no date can hold: the file accepts any number", () => {
    expect(formatClock(Number.MAX_SAFE_INTEGER, NOW, "UTC")).toBe("an unknown time");
    expect(formatClock(-9e15, NOW)).toBe("an unknown time");
    expect(formatClock(Number.NaN, NOW)).toBe("an unknown time");
  });
});
