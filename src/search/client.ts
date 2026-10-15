/**
 * `anymodel search`'s client: web search, and one page's text, through the local
 * OmniRoute — the same backend the gateway uses for cheap models, with the same key.
 *
 * OmniRoute's API (read from its own `dist/docs/openapi.yaml` and route sources on
 * 2026-10-15, OmniRoute 3.8.51):
 *
 * - `POST /v1/search` with `{"query", "max_results"}` answers one normalized result list
 *   (`provider`, `results[]` with `title`, `url`, `snippet`, `usage`, `metrics`,
 *   `cached`). Its providers include Ollama's web search (`ollama-search` →
 *   `https://ollama.com/api/web_search`).
 * - `POST /v1/web/fetch` with `{"url", "format", "include_metadata"}` answers one page's
 *   text through a web-fetch provider (firecrawl, jina-reader, tavily-search, tinyfish,
 *   anysearch-search, context7, nimble-search). A machine with none of those keys sees a
 *   400 that says so.
 *
 * The key comes from the gateway's config file, read in this process. It is never
 * printed: an error answer goes through the router's own `maskSecrets` (the function its
 * log uses) before it reaches the terminal. A 200 answer is not masked: the generic
 * "32 characters or more" rule would wreck real page text, and a search answer is
 * OmniRoute's own — the program the key was given to. Only errors, which an upstream may
 * echo a key into, are masked.
 *
 * The shapes and the tests: docs/search.md.
 */

import { messageOf } from "../gateway/config";
import { maskSecrets } from "../gateway/router";

/** How long one search or fetch may take before it is given up. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** The most characters of a failed request's reason that is shown. */
const ERROR_CHARS = 300;

/** Where a request goes and with which key: one of the gateway config's backends. */
export interface SearchBackend {
  apiKey: string;
  baseUrl: string;
}

/** One result, as much of it as the plain output shows. */
export interface SearchResult {
  snippet: string;
  title: string;
  url: string;
}

/** What a search answered: its results, and what they cost. */
export interface SearchAnswer {
  cached: boolean;
  /** OmniRoute's own count, in dollars; 0 for a free provider. */
  costUsd: number;
  /** The search provider OmniRoute used, when its answer names one. */
  provider: string;
  results: SearchResult[];
  /** OmniRoute's own time for the search, in milliseconds. */
  tookMs: null | number;
}

/** One fetched page. */
export interface FetchedPage {
  content: string;
  title: string;
  url: string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string field, or "" when it is missing or not a string. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A number field inside `holder`, or null when it is missing or not a number. */
function numberIn(holder: unknown, key: string): null | number {
  if (!isJsonObject(holder)) return null;
  const value = holder[key];
  return typeof value === "number" ? value : null;
}

/**
 * Why a request failed, in one line, ready to print: OmniRoute's own `error.message`
 * when its answer is JSON with one, else the answer's text. Keys masked first (the
 * answer may echo the one that was sent), the terminal's own control characters turned
 * into spaces (an upstream's answer is its text, not a way to drive the terminal), then
 * cut to `ERROR_CHARS`.
 */
function reasonOf(text: string, backend: SearchBackend): string {
  let reason = text;
  try {
    const body: unknown = JSON.parse(text);
    if (isJsonObject(body)) {
      const error = body.error;
      if (isJsonObject(error) && typeof error.message === "string") reason = error.message;
      else if (typeof error === "string") reason = error;
    }
  } catch {
    // Not JSON: the text itself is the reason.
  }
  const oneLine = maskSecrets(reason, [backend.apiKey])
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > ERROR_CHARS ? `${oneLine.slice(0, ERROR_CHARS)}…` : oneLine;
}

/**
 * One POST to the backend. `{ error }` with the reason when nothing answered, when the
 * answer was a redirect, when it was not 2xx, or when it was not JSON; else the answer.
 *
 * A redirect is **not** followed: the key would travel to whatever address the answer
 * names. The router refuses one from a cheap backend for the same reason
 * (`.claude/rules/gateway.md` § The login only ever reaches Anthropic); `manual` is what
 * makes the answer readable here instead of a bare fetch failure.
 */
async function post(
  backend: SearchBackend,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ error: string } | { raw: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${backend.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${backend.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? `no answer within ${timeoutMs < 1000 ? `${timeoutMs} ms` : `${Math.round(timeoutMs / 1000)} s`}`
        : messageOf(error);
    return { error: `cannot reach OmniRoute at ${backend.baseUrl} (${reason}). Is it running?` };
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return {
      error:
        `OmniRoute answered a redirect (HTTP ${response.status === 0 ? "3xx" : response.status}); ` +
        "it is not followed, so the key stays with the address in the gateway config. Check backends.omniroute.baseUrl.",
    };
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    return { error: `OmniRoute answered HTTP ${response.status}: ${reasonOf(text, backend)}` };
  }
  try {
    return { raw: JSON.parse(text) };
  } catch {
    return { error: `OmniRoute's HTTP ${response.status} answer is not JSON` };
  }
}

/** The search answer as much as the plain output needs; null when the shape is not one we know. */
export function parseSearchAnswer(body: unknown): null | SearchAnswer {
  if (!isJsonObject(body) || !Array.isArray(body.results)) return null;
  const results: SearchResult[] = [];
  for (const entry of body.results) {
    if (!isJsonObject(entry) || typeof entry.url !== "string") continue;
    results.push({ snippet: textOf(entry.snippet), title: textOf(entry.title), url: entry.url });
  }
  return {
    cached: body.cached === true,
    costUsd: numberIn(body.usage, "search_cost_usd") ?? 0,
    provider: textOf(body.provider),
    results,
    tookMs: numberIn(body.metrics, "response_time_ms"),
  };
}

/** The fetched page; null when the shape is not one we know. `requested` fills in a missing url. */
export function parseFetchedPage(body: unknown, requested: string): FetchedPage | null {
  if (!isJsonObject(body) || typeof body.content !== "string") return null;
  const metadata = body.metadata;
  const url = textOf(body.url);
  return {
    content: body.content,
    title: isJsonObject(metadata) ? textOf(metadata.title) : "",
    url: url === "" ? requested : url,
  };
}

/** Search the web through the backend. */
export async function searchWeb(options: {
  backend: SearchBackend;
  max: number;
  query: string;
  timeoutMs?: number;
}): Promise<{ answer: SearchAnswer; raw: unknown } | { error: string }> {
  const sent = await post(
    options.backend,
    "/v1/search",
    { query: options.query, max_results: options.max },
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  if ("error" in sent) return sent;
  const answer = parseSearchAnswer(sent.raw);
  if (answer === null) {
    return {
      error: "OmniRoute's answer has no results list; it is not a shape this version knows",
    };
  }
  return { answer, raw: sent.raw };
}

/** Fetch one page's text through the backend. */
export async function fetchPage(options: {
  backend: SearchBackend;
  url: string;
  timeoutMs?: number;
}): Promise<{ page: FetchedPage; raw: unknown } | { error: string }> {
  const sent = await post(
    options.backend,
    "/v1/web/fetch",
    { url: options.url, format: "markdown", include_metadata: true },
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  if ("error" in sent) return sent;
  const page = parseFetchedPage(sent.raw, options.url);
  if (page === null) {
    return { error: "OmniRoute's answer has no page text; it is not a shape this version knows" };
  }
  return { page, raw: sent.raw };
}
