/**
 * The plain output of `anymodel search`, and the cut that keeps it short.
 *
 * Ollama's web search puts a whole page's text in each result's `snippet` (measured
 * 2026-10-15: 585 to 61,350 characters for five results), so a snippet is shown as one
 * short line of `SNIPPET_CHARS` characters, and the whole output is cut to
 * `MAX_OUTPUT_CHARS` with a note saying so. `--json` prints OmniRoute's whole answer
 * instead, uncut.
 *
 * The numbers and the measurement: docs/search.md.
 */

import type { FetchedPage, SearchAnswer, SearchResult } from "./client";

/** The whole plain output is never longer than this, the cut note included. */
export const MAX_OUTPUT_CHARS = 2500;

/** How much of one result's snippet the plain output shows. */
export const SNIPPET_CHARS = 300;

/** The last line, when the output did not fit. */
export const CUT_NOTE = "… (output cut; --json prints the whole answer)";

/** A duration as the header shows it: milliseconds under a second. */
function took(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** One result's snippet: one line, cut to `SNIPPET_CHARS`. */
function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_CHARS ? `${oneLine.slice(0, SNIPPET_CHARS)}…` : oneLine;
}

/**
 * The text, cut to at most `MAX_OUTPUT_CHARS` characters. The note takes the last line,
 * so a cut output is never longer than the limit; the cut lands on a line break when
 * there is one in the second half of what fits, so a snippet is not chopped mid-word for
 * nothing. No newline at the end: the caller prints the text as one line block.
 */
export function cutOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const room = MAX_OUTPUT_CHARS - CUT_NOTE.length - 1;
  const head = text.slice(0, room);
  const lastBreak = head.lastIndexOf("\n");
  const kept = lastBreak > room / 2 ? head.slice(0, lastBreak) : head;
  return `${kept}\n${CUT_NOTE}`;
}

/** A search's plain output: the query, what answered, then each result. Cut to the limit. */
export function searchOutput(query: string, answer: SearchAnswer): string {
  const facts = [
    `${answer.results.length} result${answer.results.length === 1 ? "" : "s"}`,
    answer.provider === "" ? "" : `from ${answer.provider}`,
    answer.tookMs === null ? "" : `in ${took(answer.tookMs)}`,
    answer.cached ? "(cached)" : "",
    answer.costUsd > 0 ? `cost $${answer.costUsd.toFixed(4)}` : "",
  ].filter((fact) => fact !== "");
  const lines = [`Search: ${query}`, facts.join(" ")];
  answer.results.forEach((result: SearchResult, index: number) => {
    lines.push(
      "",
      `${index + 1}. ${result.title === "" ? result.url : result.title}`,
      `   ${result.url}`,
    );
    const text = snippet(result.snippet);
    if (text !== "") lines.push(`   ${text}`);
  });
  return cutOutput(lines.join("\n"));
}

/** A fetched page's plain output: its title and its text. Cut to the limit. */
export function pageOutput(page: FetchedPage): string {
  const head = [`Page: ${page.url}`];
  if (page.title !== "") head.push(page.title);
  return cutOutput(`${head.join("\n")}\n\n${page.content.trim()}`);
}
