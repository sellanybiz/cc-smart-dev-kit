/**
 * The portal's one place for writing numbers: a cost the history gave, and what it could not
 * price. The wording is the CLI's own (`src/cli/usage.ts` › `costText`): a sum of nothing but
 * unpriced requests is never "$0".
 */
import { describe, expect, test } from "bun:test";
import { costWords, targetModel, until, usd } from "./format";

describe("costWords", () => {
  test("a sum with nothing unpriced is the money alone", () => {
    expect(costWords(12.4, 0, 90)).toBe("$12.40");
    expect(costWords(0.0021, 0, 90)).toBe("$0.0021");
    expect(costWords(0, 0, 90)).toBe(usd(0));
  });

  test("a sum that holds requests with no price says so", () => {
    expect(costWords(12.4, 1, 90)).toBe("$12.40 + 1 request with no price");
    expect(costWords(12.4, 1234, 1300)).toBe("$12.40 + 1,234 requests with no price");
  });

  test("a sum of nothing but unpriced requests is no price, never $0", () => {
    expect(costWords(0, 1, 1)).toBe("no price");
    expect(costWords(0, 17373, 17373)).toBe("no price");
    expect(costWords(0, 17373, 17373)).not.toContain("$");
  });

  test("a real $0 behind unpriced requests stays a $0, and says what it leaves out", () => {
    // A free model's own list price is $0: the priced rows are a real nothing, not "no price".
    expect(costWords(0, 1, 1001)).toBe("$0 + 1 request with no price");
  });
});

test("how long until: minutes and hours as before, a day or more in days and hours", () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  const minute = 60_000;
  const hour = 60 * minute;
  expect(until(now + 52 * minute, now)).toBe("in 52 min");
  expect(until(now + 2 * hour + 7 * minute, now)).toBe("in 2 h 7 min");
  expect(until(now + 23 * hour + 59 * minute, now)).toBe("in 23 h 59 min");
  expect(until(now + 24 * hour, now)).toBe("in 1 d");
  expect(until(now + 48 * hour, now)).toBe("in 2 d");
  expect(until(now + 93 * hour, now)).toBe("in 3 d 21 h");
  // The hours are whole: 3 d 20 h 40 min is closer to 3 d 21 h.
  expect(until(now + 92 * hour + 40 * minute, now)).toBe("in 3 d 21 h");
  // Rounding up to a whole day says the day alone.
  expect(until(now + 47 * hour + 50 * minute, now)).toBe("in 2 d");
  expect(until(now - minute, now)).toBe("now");
});

test("model names keep provider paths distinct", () => {
  expect(targetModel("omniroute:codex/x")).toBe("codex/x");
  expect(targetModel("omniroute:openai/x")).toBe("openai/x");
});
