/**
 * What a request's tokens cost, for the request history (`history.ts`, D51): Claude at its
 * list price, marked estimated; an affordable backend at the price its own model list gives,
 * when it gives one.
 *
 * The Claude table is Anthropic's published list price in USD per million tokens, read on
 * 2026-10-22 from `https://platform.claude.com/docs/en/about-claude/pricing`. A row is keyed
 * by family and version (`claude-opus-5-5` → opus 5.5), like the router's other model rules
 * (`CLAUDE_TARGET_RULES`), never by one exact id: a newer version of a family gets no price
 * until a row is added, and a request whose model has no row is logged with no cost rather
 * than a guessed one.
 *
 * Cache writes are priced at the 5-minute rate: an answer's `usage` reports one
 * `cache_creation_input_tokens` total (the parsing `safety-checks.ts` already does), and
 * Claude Code's prompt cache is the 5-minute one unless a request asks for the 1-hour cache.
 * So a 1-hour write is estimated a little low; the row says "estimated" either way.
 *
 * A backend's price comes from its `/v1/models` answer, read only when the list gives one;
 * `listedPrice` names the two shapes it reads and their units. The router asks for it in the
 * background, never on an answer's path (`router.ts`).
 *
 * No model id here is a default, a target or a fallback: the table prices a model that
 * already answered.
 */

import type { CheckTokens } from "./safety-checks";
import { claudeFamily, claudeVersion } from "./targets";

/** USD per million tokens. */
export interface ModelPrice {
  /** Tokens served from the prompt cache. */
  cacheRead: number;
  /** Tokens written into the prompt cache (the 5-minute cache). */
  cacheWrite: number;
  input: number;
  output: number;
}

/** A price, and whether it is an estimate (Claude's list price) or a backend's own. */
export interface CostEstimate {
  estimated: boolean;
  usd: number;
}

/** One Claude row: a family and version, its price, and an optional tier above a size. */
interface ClaudePriceRow {
  family: string;
  major: number;
  minor: number;
  price: ModelPrice;
  /** The prompt size past which `over` applies (Haiku 5.5's 100,000-token tier). */
  overAfter?: number;
  over?: ModelPrice;
}

/**
 * Anthropic's list prices, USD per million tokens: input, output, cache read, 5-minute
 * cache write. Read from the pricing page on 2026-10-22, and the cache reads of the rows
 * below on 2026-10-24 (`claude-api` › `shared/models.md`): a cache read costs a tenth of a
 * new token, except Claude Opus 5.5's (a twentieth) and Claude Fable 5.1's (a fortieth).
 *
 * Exported so a test walks every row (`prices.test.ts` › "every row's cache read is its
 * family's published share of its input rate").
 */
export const CLAUDE_PRICES: readonly ClaudePriceRow[] = [
  {
    family: "fable",
    major: 5,
    minor: 1,
    price: { cacheRead: 0.25, cacheWrite: 12.5, input: 10, output: 50 },
  },
  {
    family: "fable",
    major: 5,
    minor: 0,
    price: { cacheRead: 1, cacheWrite: 12.5, input: 10, output: 50 },
  },
  {
    family: "opus",
    major: 5,
    minor: 5,
    price: { cacheRead: 0.2, cacheWrite: 5, input: 4, output: 20 },
  },
  {
    family: "opus",
    major: 5,
    minor: 0,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
  },
  {
    family: "opus",
    major: 4,
    minor: 8,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
  },
  {
    family: "opus",
    major: 4,
    minor: 7,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
  },
  {
    family: "opus",
    major: 4,
    minor: 6,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
  },
  {
    family: "opus",
    major: 4,
    minor: 5,
    price: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
  },
  {
    family: "opus",
    major: 4,
    minor: 1,
    price: { cacheRead: 1.5, cacheWrite: 18.75, input: 15, output: 75 },
  },
  {
    family: "opus",
    major: 4,
    minor: 0,
    price: { cacheRead: 1.5, cacheWrite: 18.75, input: 15, output: 75 },
  },
  {
    family: "sonnet",
    major: 5,
    minor: 5,
    price: { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10 },
  },
  {
    family: "sonnet",
    major: 5,
    minor: 0,
    price: { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10 },
  },
  {
    family: "sonnet",
    major: 4,
    minor: 6,
    price: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  },
  {
    family: "sonnet",
    major: 4,
    minor: 5,
    price: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  },
  {
    family: "sonnet",
    major: 4,
    minor: 0,
    price: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  },
  {
    family: "haiku",
    major: 5,
    minor: 5,
    price: { cacheRead: 0.01, cacheWrite: 0.125, input: 0.1, output: 0.5 },
    overAfter: 100_000,
    over: { cacheRead: 0.05, cacheWrite: 0.625, input: 0.5, output: 2.5 },
  },
  {
    family: "haiku",
    major: 4,
    minor: 5,
    price: { cacheRead: 0.1, cacheWrite: 1.25, input: 1, output: 5 },
  },
  {
    family: "haiku",
    major: 3,
    minor: 5,
    price: { cacheRead: 0.08, cacheWrite: 1, input: 0.8, output: 4 },
  },
];

/** The prompt size Haiku 5.5 prices differently above; the row's own `overAfter` says it. */
function promptTokens(tokens: CheckTokens): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}

/** The table row a Claude model id names, or null when it has none. */
function priceRow(model: string): ClaudePriceRow | null {
  const family = claudeFamily(model);
  const version = claudeVersion(model);
  if (family === null || version === null) return null;
  return (
    CLAUDE_PRICES.find(
      (candidate) =>
        candidate.family === family &&
        candidate.major === version.major &&
        candidate.minor === version.minor,
    ) ?? null
  );
}

/**
 * The list price of a Claude model id, or null when the table has no row for its family and
 * version. `[1m]` and a provider's prefix are ignored (`claudeFamily`, `claudeVersion`).
 * The base tier; `claudeCost` picks the row's larger-prompt tier when one applies.
 */
export function claudePrice(model: string): ModelPrice | null {
  return priceRow(model)?.price ?? null;
}

/** A row's price for this request: its larger-prompt tier past the row's size, else base. */
function tierOf(row: ClaudePriceRow, tokens: CheckTokens): ModelPrice {
  return row.over !== undefined &&
    row.overAfter !== undefined &&
    promptTokens(tokens) > row.overAfter
    ? row.over
    : row.price;
}

/** What a request's tokens cost at `price`, in USD, or null when it reported no tokens. */
export function costUsd(price: ModelPrice, tokens: CheckTokens): number {
  const usd =
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite) /
    1_000_000;
  // Micro-dollars: enough for a single request, and a sum of them stays exact enough.
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Claude's estimated cost for an answer that reported `tokens`: list price, its family and
 * version's tier. Null when the model has no row (never a guess) or no tokens were read.
 */
export function claudeCost(model: string, tokens: CheckTokens | null): CostEstimate | null {
  if (tokens === null) return null;
  const row = priceRow(model);
  if (row === null) return null;
  return { estimated: true, usd: costUsd(tierOf(row, tokens), tokens) };
}

/** A backend's cost at the price its own list gave. Not marked estimated: it is the list's. */
export function backendCost(price: ModelPrice, tokens: CheckTokens | null): CostEstimate | null {
  if (tokens === null) return null;
  return { estimated: false, usd: costUsd(price, tokens) };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A per-token price from a list, as a number; null when it is absent or not a number. */
function perToken(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

/** A per-token price as per-million-token dollars, rounded to keep a float's noise out. */
function perMillion(value: number): number {
  return Math.round(value * 1_000_000 * 1_000_000) / 1_000_000;
}

/**
 * The price one model list entry gives, in USD per million tokens, or null when it gives none.
 * Two shapes are read, **each in its own unit**:
 *
 *   - **OpenRouter's**: `pricing: {prompt, completion, input_cache_read, input_cache_write}`,
 *     USD **per token**, as strings or numbers (`"0.0000005"` is $0.50 a million).
 *   - **OmniRoute's**: `pricing: {input, output, cached, cache_creation}`, USD **per million
 *     tokens**, as numbers. That is the unit its own catalog is built in and the one its
 *     `/v1/models` serves: its `dva/claude-opus-5-max` answers `{input: 5, cached: 0.5,
 *     output: 25}`, the list price of $5 / $25 a million. `cached` is the cache-read price and
 *     `cache_creation` the cache-write one.
 *
 * Which shape it is comes from the keys, never from a guess: `prompt` and `completion` are
 * OpenRouter's, `input` and `output` OmniRoute's. An entry that gives only half of one shape,
 * or neither, has no price rather than a guessed one. A model whose list gives no cache price
 * is priced at its input rate for cache tokens: never an underestimate.
 */
export function listedPrice(entry: unknown): ModelPrice | null {
  if (!isJsonObject(entry)) return null;
  const pricing = entry.pricing;
  if (!isJsonObject(pricing)) return null;
  const field = (name: string): number | null => perToken(pricing[name]);

  const prompt = field("prompt");
  const completion = field("completion");
  if (prompt !== null || completion !== null) {
    if (prompt === null || completion === null) return null;
    return {
      cacheRead: perMillion(field("input_cache_read") ?? prompt),
      cacheWrite: perMillion(field("input_cache_write") ?? prompt),
      input: perMillion(prompt),
      output: perMillion(completion),
    };
  }

  const input = field("input");
  const output = field("output");
  if (input === null || output === null) return null;
  return {
    cacheRead: field("cached") ?? input,
    cacheWrite: field("cache_creation") ?? input,
    input,
    output,
  };
}

/** One model's price from a backend's model list; null when the list gives none. */
export function priceFromModels(
  models: readonly { id: string; price?: ModelPrice }[],
  model: string,
): ModelPrice | null {
  const entry = models.find((candidate) => candidate.id === model);
  return entry?.price ?? null;
}
