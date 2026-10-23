/**
 * The request history's ranges and filters: one home for the range list, the bucket widths, and
 * how a filter is written into the page's address and read back.
 */

import type {
  HistoryBy,
  HistoryFilter,
  HistoryKeys,
  HistoryPoint,
  HistoryRange,
} from "@/api/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface RangeInfo {
  value: HistoryRange;
  label: string;
  words: string;
  spanMs: number;
  bucketMs: number;
}

/** Every range, with its span and the bucket it is drawn in. */
const RANGE_INFO: Record<HistoryRange, RangeInfo> = {
  "1h": { value: "1h", label: "1h", words: "the last hour", spanMs: HOUR, bucketMs: MINUTE },
  "4h": {
    value: "4h",
    label: "4h",
    words: "the last 4 hours",
    spanMs: 4 * HOUR,
    bucketMs: 5 * MINUTE,
  },
  "1d": { value: "1d", label: "1d", words: "the last day", spanMs: DAY, bucketMs: 15 * MINUTE },
  "7d": { value: "7d", label: "7d", words: "the last 7 days", spanMs: 7 * DAY, bucketMs: HOUR },
  "14d": {
    value: "14d",
    label: "14d",
    words: "the last 14 days",
    spanMs: 14 * DAY,
    bucketMs: 2 * HOUR,
  },
  "30d": {
    value: "30d",
    label: "30d",
    words: "the last 30 days",
    spanMs: 30 * DAY,
    bucketMs: 6 * HOUR,
  },
  "90d": { value: "90d", label: "90d", words: "the last 90 days", spanMs: 90 * DAY, bucketMs: DAY },
};

/** The ranges in the switch's order. */
export const HISTORY_RANGES: readonly RangeInfo[] = Object.values(RANGE_INFO);

export const DEFAULT_RANGE: HistoryRange = "1d";

export const HISTORY_BYS: readonly { value: HistoryBy; label: string }[] = [
  { value: "target", label: "Target" },
  { value: "slot", label: "Slot" },
  { value: "model", label: "Model" },
  { value: "session", label: "Session" },
];

export function rangeOf(value: HistoryRange): RangeInfo {
  return RANGE_INFO[value];
}

export function isRange(value: null | string): value is HistoryRange {
  return HISTORY_RANGES.some((range) => range.value === value);
}

export function isBy(value: null | string): value is HistoryBy {
  return HISTORY_BYS.some((by) => by.value === value);
}

/** The filter keys, as the address and `GET /api/history` spell them. */
const FILTER_KEYS = ["slot", "target", "model", "session"] as const;

/** The filter a page's address holds. */
export function filterFromQuery(query: URLSearchParams): HistoryFilter {
  const filter: HistoryFilter = {};
  for (const key of FILTER_KEYS) {
    const value = query.get(key);
    if (value !== null && value !== "") filter[key] = value;
  }
  if (query.get("status") === "error") filter.errorsOnly = true;
  return filter;
}

/** The address with this filter in it; every other parameter is kept as it was. */
export function queryWithFilter(query: URLSearchParams, filter: HistoryFilter): URLSearchParams {
  const next = new URLSearchParams(query);
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  if (filter.errorsOnly === true) next.set("status", "error");
  else next.delete("status");
  return next;
}

/** A stable text for a filter, for a read's key. */
export function filterKey(filter: HistoryFilter): string {
  return [
    ...FILTER_KEYS.map((key) => filter[key] ?? ""),
    filter.errorsOnly === true ? "e" : "",
  ].join("|");
}

export function hasFilter(filter: HistoryFilter): boolean {
  return FILTER_KEYS.some((key) => filter[key] !== undefined) || filter.errorsOnly === true;
}

/** Every token a point counts. */
export function tokensOf(point: HistoryPoint): number {
  return point.inputTokens + point.outputTokens + point.cacheReadTokens + point.cacheWriteTokens;
}

/** The name a person reads for a session: its own name, else its project and short id. */
export function sessionLabel(session: HistoryKeys["sessions"][number]): string {
  if (session.name !== null) return session.name;
  const short = session.id.slice(0, 8);
  return session.project === null ? short : `${session.project} ${short}`;
}
