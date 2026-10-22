/**
 * The one budget a hook's children share (HK hunch 9). Small and pure: what the call gets,
 * and what is left when the budget is spent.
 */
import { describe, expect, test } from "bun:test";
import {
  BUDGET_MARGIN_MS,
  budgetMs,
  GUARD_BUDGET_ENV,
  GUARD_BUDGET_MS,
  startBudget,
} from "./budget";

describe("the hook budget", () => {
  test("the default is the hook's 25 s of its 30 s", () => {
    expect(budgetMs({})).toBe(25_000);
    expect(GUARD_BUDGET_MS).toBe(25_000);
    expect(BUDGET_MARGIN_MS).toBe(2_000);
  });

  test("a test's variable shortens it, and can never lengthen it", () => {
    expect(budgetMs({ [GUARD_BUDGET_ENV]: "1200" })).toBe(1200);
    // A value above the default is cut to it: a project's settings `env` reaches a hook, and a
    // guard whose children outran the hook is killed.
    expect(budgetMs({ [GUARD_BUDGET_ENV]: "600000" })).toBe(GUARD_BUDGET_MS);
    // Not a positive number: the default.
    for (const value of ["", "0", "-5", "soon", "NaN"]) {
      expect([value, budgetMs({ [GUARD_BUDGET_ENV]: value })]).toEqual([value, GUARD_BUDGET_MS]);
    }
  });

  test("each call gets its own limit or what is left, and nothing is left at the end", () => {
    const env = { [GUARD_BUDGET_ENV]: "10000" };
    let now = 1_000;
    const { timeFor } = startBudget(env, () => now);
    // Fresh: the call's own limit is smaller than what is left, so it keeps it.
    expect(timeFor(3_000)).toBe(3_000);
    // Half the budget spent: what is left less the margin is smaller now.
    now += 5_000;
    expect(timeFor(10_000)).toBe(10_000 - 5_000 - BUDGET_MARGIN_MS);
    // With less left than the margin, no call is made at all: zero or less.
    now += 3_500;
    expect(timeFor(10_000)).toBeLessThanOrEqual(0);
  });
});
