/**
 * The price table the request history's cost comes from (D51): Claude's list price (marked
 * estimated) and a backend's own listed price. Every expected value is worked out by hand
 * from the published price (USD per million tokens); nothing here is computed by the code
 * under test.
 */
import { describe, expect, it } from "bun:test";
import { parseModelList } from "./backends";
import {
  backendCost,
  claudeCost,
  claudePrice,
  costUsd,
  listedPrice,
  priceFromModels,
} from "./prices";

const TOKENS = { cacheRead: 2000, cacheWrite: 100, input: 1000, output: 500 };

describe("Claude's list price", () => {
  it("prices the current models by family and version", () => {
    expect(claudePrice("claude-opus-5-5")).toEqual({
      cacheRead: 0.2,
      cacheWrite: 5,
      input: 4,
      output: 20,
    });
    expect(claudePrice("claude-sonnet-5-5")).toEqual({
      cacheRead: 0.1,
      cacheWrite: 2.5,
      input: 2,
      output: 10,
    });
    expect(claudePrice("claude-fable-5-1")).toEqual({
      cacheRead: 0.25,
      cacheWrite: 12.5,
      input: 10,
      output: 50,
    });
  });

  it("reads a dated id, a provider's prefix and [1m] as the same model", () => {
    const haiku = { cacheRead: 0.1, cacheWrite: 1.25, input: 1, output: 5 };
    expect(claudePrice("claude-haiku-4-5-20251001")).toEqual(haiku);
    expect(claudePrice("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toEqual(haiku);
    expect(claudePrice("claude-haiku-4-5[1m]")).toEqual(haiku);
  });

  it("never guesses: a newer version, an unknown name or a backend's model has no price", () => {
    expect(claudePrice("claude-opus-6-0")).toBeNull();
    expect(claudePrice("claude-opus-latest")).toBeNull();
    expect(claudePrice("glm-5.3-flash")).toBeNull();
    expect(claudePrice("omniroute:glm-5.3-flash")).toBeNull();
  });

  it("costs an answer: input, output, cache read and 5-minute cache write", () => {
    // (1000×2 + 500×10 + 2000×0.1 + 100×2.5) / 1,000,000 = 0.00745
    expect(claudeCost("claude-sonnet-5-5", TOKENS)).toEqual({ estimated: true, usd: 0.00745 });
    // (1000×4 + 500×20 + 2000×0.2 + 100×5) / 1,000,000 = 0.0149
    expect(claudeCost("claude-opus-5-5", TOKENS)).toEqual({ estimated: true, usd: 0.0149 });
  });

  it("an answer that reported no tokens, or a model with no row, has no cost", () => {
    expect(claudeCost("claude-sonnet-5-5", null)).toBeNull();
    expect(claudeCost("claude-opus-6-0", TOKENS)).toBeNull();
  });

  it("Haiku 5.5's 100,000-token tier: a larger prompt costs the over-100K row", () => {
    // At the limit: (100,000×0.1 + 1,000×0.5) / 1,000,000 = 0.0105
    expect(
      claudeCost("claude-haiku-5-5", { cacheRead: 0, cacheWrite: 0, input: 100_000, output: 1000 }),
    ).toEqual({ estimated: true, usd: 0.0105 });
    // One token over: (100,001×0.5 + 1,000×2.5) / 1,000,000 = 0.0525005
    expect(
      claudeCost("claude-haiku-5-5", { cacheRead: 0, cacheWrite: 0, input: 100_001, output: 1000 }),
    ).toEqual({ estimated: true, usd: 0.052501 });
  });

  it("a cost is in micro-dollars, and a zero answer costs $0", () => {
    expect(
      costUsd(
        { cacheRead: 0, cacheWrite: 0, input: 1, output: 0 },
        { cacheRead: 0, cacheWrite: 0, input: 1, output: 0 },
      ),
    ).toBe(0.000001);
    expect(costUsd({ cacheRead: 0, cacheWrite: 0, input: 0, output: 0 }, TOKENS)).toBe(0);
  });
});

describe("a backend's own listed price", () => {
  it("reads OpenRouter's per-token strings as per-million-token dollars", () => {
    expect(listedPrice({ pricing: { completion: "0.0000015", prompt: "0.0000005" } })).toEqual({
      // A list with no cache price prices cache tokens at the input rate, never less.
      cacheRead: 0.5,
      cacheWrite: 0.5,
      input: 0.5,
      output: 1.5,
    });
  });

  it("reads the cache prices when the list gives them, and numbers as numbers", () => {
    expect(
      listedPrice({
        pricing: {
          completion: 0.000002,
          input_cache_read: "0.0000001",
          input_cache_write: "0.0000006",
          prompt: 0.000001,
        },
      }),
    ).toEqual({ cacheRead: 0.1, cacheWrite: 0.6, input: 1, output: 2 });
  });

  it("a list with no price for the model gives none", () => {
    expect(listedPrice({ id: "m" })).toBeNull();
    expect(listedPrice({ pricing: { prompt: "0.000001" } })).toBeNull();
    expect(listedPrice({ pricing: { completion: "x", prompt: "0.000001" } })).toBeNull();
    expect(listedPrice(null)).toBeNull();
  });

  it("the model list carries the price only when it gives one", () => {
    const models = parseModelList({
      data: [
        { id: "priced", pricing: { completion: "0.000001", prompt: "0.0000005" } },
        { context_length: 1000, id: "plain" },
      ],
    });
    expect(models).toEqual([
      {
        contextLength: null,
        id: "priced",
        price: { cacheRead: 0.5, cacheWrite: 0.5, input: 0.5, output: 1 },
      },
      { contextLength: 1000, id: "plain" },
    ]);
    expect(priceFromModels(models, "priced")).toEqual({
      cacheRead: 0.5,
      cacheWrite: 0.5,
      input: 0.5,
      output: 1,
    });
    expect(priceFromModels(models, "plain")).toBeNull();
  });

  it("costs an answer at the list's price, not marked estimated", () => {
    // (1000×0.5 + 500×1.5 + 2000×0.5 + 100×0.5) / 1,000,000 = 0.0023
    const price = { cacheRead: 0.5, cacheWrite: 0.5, input: 0.5, output: 1.5 };
    expect(backendCost(price, TOKENS)).toEqual({ estimated: false, usd: 0.0023 });
    expect(backendCost(price, null)).toBeNull();
  });
});
