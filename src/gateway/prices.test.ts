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
  CLAUDE_PRICES,
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
    // $2 / $10 per MTok, cache reads $0.20: a tenth of the input rate, as Sonnet 5's row has.
    expect(claudePrice("claude-sonnet-5-5")).toEqual({
      cacheRead: 0.2,
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
    // (1000×2 + 500×10 + 2000×0.2 + 100×2.5) / 1,000,000 = 0.00765
    expect(claudeCost("claude-sonnet-5-5", TOKENS)).toEqual({ estimated: true, usd: 0.00765 });
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

  /**
   * The published cache-read price as a share of the input rate: a tenth of a new token for
   * every family and version, except the two rows that price caching more cheaply — Claude
   * Opus 5.5's a twentieth, Claude Fable 5.1's a fortieth. Anthropic's list gives each current
   * row's cache-read price (`claude-api` › `shared/models.md`, read 2026-10-24): Fable 5.1
   * $0.25 on $10, Opus 5.5 $0.20 on $4, Sonnet 5.5 and Haiku 5.5 $0.20 and $0.01 on $2 and
   * $0.10. Every row of the table is held to the share its own row was written from, so a
   * later edit cannot quietly change one of them — which is how Sonnet 5.5's came to be half
   * its list price.
   */
  const CACHE_READ_SHARE: Readonly<Record<string, number>> = {
    "fable 5.0": 0.1,
    "fable 5.1": 0.025,
    "haiku 3.5": 0.1,
    "haiku 4.5": 0.1,
    "haiku 5.5": 0.1,
    "opus 4.0": 0.1,
    "opus 4.1": 0.1,
    "opus 4.5": 0.1,
    "opus 4.6": 0.1,
    "opus 4.7": 0.1,
    "opus 4.8": 0.1,
    "opus 5.0": 0.1,
    "opus 5.5": 0.05,
    "sonnet 4.0": 0.1,
    "sonnet 4.5": 0.1,
    "sonnet 4.6": 0.1,
    "sonnet 5.0": 0.1,
    "sonnet 5.5": 0.1,
  };

  it("every row's cache read is its family's published share of its input rate", () => {
    expect(CLAUDE_PRICES).toHaveLength(Object.keys(CACHE_READ_SHARE).length);
    // Rounded past a float's noise: a tenth of $0.30 is 0.09999999999999999.
    const shareOf = (cacheRead: number, input: number): number =>
      Math.round((cacheRead / input) * 100_000) / 100_000;
    for (const row of CLAUDE_PRICES) {
      const key = `${row.family} ${row.major}.${row.minor}`;
      const share = CACHE_READ_SHARE[key];
      if (share === undefined) {
        throw new Error(`the published list has no cache-read share for ${key}`);
      }
      // The key in the object makes a failure name the row it is about.
      expect({ [key]: shareOf(row.price.cacheRead, row.price.input) }).toEqual({ [key]: share });
      if (row.over !== undefined) {
        expect({ [key]: shareOf(row.over.cacheRead, row.over.input) }).toEqual({ [key]: share });
      }
    }
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

  it("reads OmniRoute's own shape as USD per million tokens, cached included", () => {
    // The live answer for its `dva/claude-opus-5-max`: $5 / $25 a million, cache reads $0.50.
    expect(listedPrice({ pricing: { cached: 0.5, input: 5, output: 25 } })).toEqual({
      // No cache-write price: the input rate, never less.
      cacheRead: 0.5,
      cacheWrite: 5,
      input: 5,
      output: 25,
    });
    // A real entry of its list, with the keys around the price.
    expect(
      listedPrice({
        context_length: 1_000_000,
        id: "dva/deepseek-v4-flash-max",
        object: "model",
        owned_by: "devin-cli-agentic",
        pricing: { cached: 0.03, input: 0.14, output: 0.28 },
      }),
    ).toEqual({ cacheRead: 0.03, cacheWrite: 0.14, input: 0.14, output: 0.28 });
  });

  it("reads OmniRoute's cache_creation as the cache-write price", () => {
    expect(
      listedPrice({ pricing: { cache_creation: 6.25, cached: 0.5, input: 5, output: 25 } }),
    ).toEqual({ cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 });
  });

  it("half of a shape, or neither, gives no price rather than a guessed one", () => {
    expect(listedPrice({ pricing: { input: 5 } })).toBeNull();
    expect(listedPrice({ pricing: { cached: 0.5, input: 5 } })).toBeNull();
    expect(listedPrice({ pricing: { prompt: "0.000001" } })).toBeNull();
    expect(listedPrice({ pricing: { cached: 0.5, output: 25 } })).toBeNull();
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
