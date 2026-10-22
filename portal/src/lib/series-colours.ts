/**
 * Which colour a series gets. Colour follows the series, never its rank: a key keeps the colour
 * it first got for as long as the page lives, on every chart, so a range switch or a filter
 * never repaints one and two charts of one page agree. New keys take the next free colour in
 * the order of their requests; once the four are taken, a key is "Other".
 */

import type { History, HistoryBy } from "@/api/types";

export const COLOURED = ["s1", "s2", "s3", "s4"] as const;
export type SeriesColour = (typeof COLOURED)[number] | "other";

/** The swatch class of each colour (the tokens are `--series-*` in globals.css). */
export const SWATCH: Record<SeriesColour, string> = {
  s1: "bg-series-1",
  s2: "bg-series-2",
  s3: "bg-series-3",
  s4: "bg-series-4",
  other: "bg-series-other",
};

/** True for one of the colour keys a chart's data uses. */
export function isSeriesColour(value: unknown): value is SeriesColour {
  return value === "other" || COLOURED.some((colour) => colour === value);
}

/** What a chart's series are keyed by: the history's breakdowns, and the guard log's guards. */
export type SeriesBy = HistoryBy | "guard";

const memory: Record<SeriesBy, Map<string, SeriesColour>> = {
  guard: new Map(),
  target: new Map(),
  slot: new Map(),
  model: new Map(),
  session: new Map(),
};

/** The colour of every key in `history`, giving new keys theirs. */
export function coloursFor(history: History, by: SeriesBy): Map<string, SeriesColour> {
  const known = memory[by];
  const totals = history.series
    .map((series) => ({
      key: series.key,
      total: series.points.reduce((sum, point) => sum + point.requests, 0),
    }))
    .sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1));
  for (const { key } of totals) {
    if (known.has(key)) continue;
    const taken = new Set(known.values());
    known.set(key, COLOURED.find((colour) => !taken.has(colour)) ?? "other");
  }
  return new Map(history.series.map((series) => [series.key, known.get(series.key) ?? "other"]));
}
