/**
 * The portal's one place for writing numbers: a cost the history gave, and what it could not
 * price. The wording is the CLI's own (`src/cli/usage.ts` › `costText`): a sum of nothing but
 * unpriced requests is never "$0".
 */
import { describe, expect, test } from "bun:test";
import { costWords, usd } from "./format";

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
