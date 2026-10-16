/**
 * Auto mode's safety checks, counted: the day keys, the file, and the two ways an answer
 * reports its tokens. Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import {
  addCheckTokens,
  type CheckTokens,
  checkUsageFromAnswer,
  emptySafetyChecks,
  formatSafetyCheckState,
  localDay,
  parseSafetyCheckState,
  recentCheckDays,
  recordSafetyCheck,
  SAFETY_CHECK_DAYS,
  SAFETY_CHECK_WINDOW_DAYS,
  type SafetyCheckState,
} from "./safety-checks";

const DAY_MS = 86_400_000;
/** 2026-10-16T10:00:00Z. */
const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);

/** A day's record as the file holds it, written by hand. */
function day(checks: number, anthropic: number, fallback: number) {
  return {
    anthropic: { cacheRead: 0, cacheWrite: 0, checks: anthropic, input: 0, output: 0 },
    checks,
    fallback: { cacheRead: 0, cacheWrite: 0, checks: fallback, input: 0, output: 0 },
  };
}

describe("the safety-check counts", () => {
  it("a day key is the local calendar day of the machine, or of a named zone", () => {
    expect(localDay(Date.UTC(2026, 9, 15, 23, 30), "UTC")).toBe("2026-10-15");
    expect(localDay(Date.UTC(2026, 9, 16, 0, 30), "UTC")).toBe("2026-10-16");
    // Dubai is four hours ahead: 23:30 UTC is already the next day there.
    expect(localDay(Date.UTC(2026, 9, 15, 23, 30), "Asia/Dubai")).toBe("2026-10-16");
  });

  it("the file's text is the state again; junk and a shape it does not know read as none", () => {
    const state = emptySafetyChecks();
    recordSafetyCheck(state, "2026-10-16", "anthropic");
    addCheckTokens(state, "2026-10-16", "anthropic", {
      cacheRead: 500,
      cacheWrite: 0,
      input: 1234,
      output: 7,
    });
    const text = formatSafetyCheckState(state);
    expect(text).toBe(
      `${JSON.stringify(
        {
          days: {
            "2026-10-16": {
              anthropic: { cacheRead: 500, cacheWrite: 0, checks: 1, input: 1234, output: 7 },
              checks: 1,
              fallback: { cacheRead: 0, cacheWrite: 0, checks: 0, input: 0, output: 0 },
            },
          },
          version: 1,
        },
        null,
        2,
      )}\n`,
    );
    expect(parseSafetyCheckState(text)).toEqual(state);
    expect(parseSafetyCheckState("{half a file")).toBeNull();
    expect(parseSafetyCheckState('{"days":{},"version":2}')).toBeNull();
    expect(parseSafetyCheckState('{"days":{"2026-10-16":{"checks":1}},"version":1}')).toBeNull();
  });

  it("a check counts the day and the side that answered; its answer's tokens add up", () => {
    const state = emptySafetyChecks();
    recordSafetyCheck(state, "2026-10-16", "anthropic");
    addCheckTokens(state, "2026-10-16", "anthropic", {
      cacheRead: 100,
      cacheWrite: 20,
      input: 900,
      output: 5,
    });
    recordSafetyCheck(state, "2026-10-16", "anthropic");
    addCheckTokens(state, "2026-10-16", "anthropic", {
      cacheRead: 0,
      cacheWrite: 0,
      input: 100,
      output: 2,
    });
    // The judge answered one; a check that reached nobody counts in the day only.
    recordSafetyCheck(state, "2026-10-16", "fallback");
    recordSafetyCheck(state, "2026-10-16", null);
    recordSafetyCheck(state, "2026-10-15", "anthropic");
    expect(state).toEqual({
      days: {
        "2026-10-15": day(1, 1, 0),
        "2026-10-16": {
          anthropic: { cacheRead: 100, cacheWrite: 20, checks: 2, input: 1000, output: 7 },
          checks: 4,
          fallback: { cacheRead: 0, cacheWrite: 0, checks: 1, input: 0, output: 0 },
        },
      },
      version: 1,
    } as SafetyCheckState);
    // A day that is gone (pruned while the answer streamed) takes nothing.
    addCheckTokens(state, "2026-10-01", "anthropic", {
      cacheRead: 1,
      cacheWrite: 1,
      input: 1,
      output: 1,
    });
    expect(Object.keys(state.days).sort()).toEqual(["2026-10-15", "2026-10-16"]);
  });

  it(`keeps the newest ${SAFETY_CHECK_DAYS} days, and drops the rest`, () => {
    const state = emptySafetyChecks();
    for (let index = 0; index < SAFETY_CHECK_DAYS + 1; index += 1) {
      recordSafetyCheck(state, localDay(NOW - index * DAY_MS, "UTC"), "anthropic");
    }
    expect(Object.keys(state.days)).toHaveLength(SAFETY_CHECK_DAYS);
    expect(Object.hasOwn(state.days, "2026-10-16")).toBe(true);
    // The 31st day back is gone; the 30th is the oldest kept.
    expect(Object.hasOwn(state.days, "2026-09-16")).toBe(false);
    expect(Object.hasOwn(state.days, "2026-09-17")).toBe(true);
  });

  it(`shows today and the ${SAFETY_CHECK_WINDOW_DAYS - 1} days before it, newest first`, () => {
    const state = emptySafetyChecks();
    for (const days of [0, 1, 7, 8, 40]) {
      recordSafetyCheck(state, localDay(NOW - days * DAY_MS, "UTC"), "anthropic");
    }
    expect(
      recentCheckDays(state, NOW, SAFETY_CHECK_WINDOW_DAYS, "UTC").map(([date]) => date),
    ).toEqual(["2026-10-16", "2026-10-15", "2026-10-09"]);
    // No state at all: no days (the caller says so in words).
    expect(recentCheckDays(emptySafetyChecks(), NOW, SAFETY_CHECK_WINDOW_DAYS, "UTC")).toEqual([]);
  });
});

describe("the tokens an answer reported", () => {
  const TOKENS: CheckTokens = { cacheRead: 500, cacheWrite: 0, input: 1234, output: 7 };

  it("a JSON answer: the `usage` of the message", () => {
    expect(
      checkUsageFromAnswer(
        JSON.stringify({
          content: [{ text: "<severity>1", type: "text" }],
          id: "msg_1",
          type: "message",
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 500,
            input_tokens: 1234,
            output_tokens: 7,
          },
        }),
        false,
      ),
    ).toEqual(TOKENS);
    // No usage at all, and a type the reader does not take: nothing reported.
    expect(checkUsageFromAnswer('{"content":[],"id":"msg_2"}', false)).toBeNull();
    expect(checkUsageFromAnswer('{"usage":{"input_tokens":"many"}}', false)).toBeNull();
    expect(checkUsageFromAnswer("not json at all", false)).toBeNull();
  });

  it("a streamed answer: input and cache from `message_start`, output from the last `message_delta`", () => {
    const stream = [
      "event: message_start",
      `data: {"type":"message_start","message":{"id":"msg_1","type":"message","usage":{"cache_creation_input_tokens":0,"cache_read_input_tokens":500,"input_tokens":1234,"output_tokens":1}}}`,
      "",
      "event: content_block_start",
      'data: {"content_block":{"text":"","type":"text"},"index":0,"type":"content_block_start"}',
      "",
      "event: content_block_delta",
      'data: {"delta":{"text":"<severity>","type":"text_delta"},"index":0,"type":"content_block_delta"}',
      "",
      "event: message_delta",
      'data: {"delta":{"stop_reason":"stop_sequence"},"type":"message_delta","usage":{"output_tokens":7}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    expect(checkUsageFromAnswer(stream, true)).toEqual(TOKENS);
  });

  it("a streamed answer cut before its last event: what arrived counts, and a half event is skipped", () => {
    // The blank line after it is the event's end, as on the wire.
    const start =
      'event: message_start\ndata: {"message":{"usage":{"input_tokens":90,"output_tokens":1}},"type":"message_start"}\n\n';
    // Only the start: its output is the partial one, and the cache fields it never named are 0.
    expect(checkUsageFromAnswer(start, true)).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      input: 90,
      output: 1,
    });
    // A half-written last event, and an event with no usage: what came before still counts.
    expect(checkUsageFromAnswer(`${start}event: message_delta\ndata: {"output_tok`, true)).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      input: 90,
      output: 1,
    });
    // An empty stream: nothing.
    expect(checkUsageFromAnswer("", true)).toBeNull();
    expect(checkUsageFromAnswer("event: ping\ndata: {}\n\n", true)).toBeNull();
  });
});
