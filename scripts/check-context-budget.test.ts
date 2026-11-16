/**
 * The context budget. The `claude plugin details` output is a fixture written here in its
 * real shape, so the test never runs Claude Code; every expected value is written by hand.
 */
import { describe, expect, test } from "bun:test";
import { ALWAYS_ON, CORE, checkBudget, estimateTokens, parseDetails } from "./check-context-budget";

/** `claude plugin details` output, cut to the lines around the two the check reads. */
function details(alwaysOn: string, source = "my-plugin@inline"): string {
  return [
    "my-plugin 1.0.0",
    "  Description: An example plugin",
    `  Source: ${source}`,
    "",
    "Projected token cost",
    `  Always-on:   ~${alwaysOn} tok   added to every session`,
    "",
  ].join("\n");
}

describe("check-context-budget", () => {
  test("reads the always-on figure, thousands separator and all, and the source", () => {
    expect(parseDetails(details("3,133"))).toEqual({ alwaysOn: 3133, source: "my-plugin@inline" });
    expect(parseDetails(details("146"))).toEqual({ alwaysOn: 146, source: "my-plugin@inline" });
  });

  test("output it cannot read is an error, never a pass", () => {
    expect(() => parseDetails("my-plugin 1.0.0\n  Source: my-plugin@inline\n")).toThrow(
      "cannot read the Always-on or the Source line",
    );
    expect(() => parseDetails("  Always-on:   ~146 tok\n")).toThrow("cannot read");
  });

  test("the core.md estimate is four characters a token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  test("inside both budgets it passes, and says how far each is from its target", () => {
    expect(checkBudget(2_600, 2_000)).toEqual({
      lines: [
        "Always-on: ~2600 tokens (budget 2720, target 2000, 600 above the target).",
        "plugin/instructions/core.md: ~2000 tokens (budget 2345, target 1900, 100 above the target).",
        "Every session starts with ~4600 tokens from the plugin.",
      ],
      ok: true,
    });
    expect(checkBudget(1_500, 1_000).lines[0]).toBe(
      "Always-on: ~1500 tokens (budget 2720, target 2000).",
    );
  });

  test("at a budget it passes; one token over either budget fails", () => {
    expect(checkBudget(ALWAYS_ON.max, CORE.max).ok).toBe(true);
    const alwaysOnOver = checkBudget(ALWAYS_ON.max + 1, CORE.max);
    expect(alwaysOnOver.ok).toBe(false);
    expect(alwaysOnOver.lines[0]).toBe(
      "Always-on: ~2721 tokens, over its 2720-token budget. Every session carries it: trim it, or move text into a skill that loads only when used.",
    );
    const coreOver = checkBudget(ALWAYS_ON.max, CORE.max + 1);
    expect(coreOver.ok).toBe(false);
    expect(coreOver.lines[1]).toBe(
      "plugin/instructions/core.md: ~2346 tokens, over its 2345-token budget. Every session carries it: trim it, or move text into a skill that loads only when used.",
    );
  });

  test("each target is below its budget, so the distance shown is real", () => {
    expect(ALWAYS_ON.target).toBeLessThan(ALWAYS_ON.max);
    expect(CORE.target).toBeLessThan(CORE.max);
  });
});
