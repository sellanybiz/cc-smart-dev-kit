/**
 * The request history's read side (D51): what the portal's history page and its
 * recent-requests table show, and what `gateway history` prints.
 *
 * Read **read-only**, always: this module never makes a database, never writes one, and never
 * touches the router (`new Database(file, { readonly: true })`). A missing file — no request
 * was ever logged — reads as an empty history, which is what a new machine has.
 *
 * Two queries:
 *   - `historySeries` groups the rows of a range into buckets, by target, slot, model or
 *     session: requests, errors, p50 and p95 latency, the four token sums and the estimated
 *     USD. Every bucket of the window is there, empty ones as zeros, so a chart needs no
 *     filling in.
 *   - `recentRequests` pages the newest rows first, by id (`cursor` is the last id of the
 *     page before), with the same filters.
 *
 * Filters: `slot`, `target`, `model`, `session` (exact), and `status: "error"` (an HTTP status
 * of 400 or more). A row with no slot or no session is grouped under `(no slot)` /
 * `(no session)`.
 */

import { Database } from "bun:sqlite";
import { HISTORY_COLUMNS, historyDbExists, retentionWords, type StoredRow } from "./history";

/** The ranges `GET /api/history?range=` and `gateway history` accept, and their buckets. */
export const HISTORY_RANGES = ["1h", "4h", "1d", "7d", "14d", "30d", "90d"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** How far back each range looks. */
const RANGE_MS: Readonly<Record<HistoryRange, number>> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

/** The same map for the portal's API, which builds its range list from it (one home). */
export const HISTORY_RANGE_MS: Readonly<Record<HistoryRange, number>> = RANGE_MS;

/** Each range's bucket: 1 min, 5 min, 15 min, 1 h, 2 h, 6 h, 1 day (D51). */
const BUCKET_MS: Readonly<Record<HistoryRange, number>> = {
  "1h": 60 * 1000,
  "4h": 5 * 60 * 1000,
  "1d": 15 * 60 * 1000,
  "7d": 60 * 60 * 1000,
  "14d": 2 * 60 * 60 * 1000,
  "30d": 6 * 60 * 60 * 1000,
  "90d": 24 * 60 * 60 * 1000,
};

/** What `historySeries` groups by. */
export const HISTORY_BY = ["target", "slot", "model", "session"] as const;
export type HistoryBy = (typeof HISTORY_BY)[number];

/** The range and grouping `gateway history` uses when the person names neither. */
export const DEFAULT_HISTORY_RANGE: HistoryRange = "1d";
export const DEFAULT_HISTORY_BY: HistoryBy = "target";

/** The filters both queries take. */
export interface HistoryFilters {
  model?: string;
  session?: string;
  slot?: string;
  /** `"error"`: only rows whose status is 400 or more. */
  status?: "error";
  target?: string;
}

/** One bucket of one series. */
export interface HistoryPoint {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Rows whose status was 400 or more. */
  errors: number;
  inputTokens: number;
  /** Milliseconds: the 50th percentile of the bucket's answers. */
  p50Ms: number;
  p95Ms: number;
  outputTokens: number;
  requests: number;
  /** The bucket's start, milliseconds since the epoch. */
  t: number;
}

/** One line of the chart: a target, slot, model or session. */
export interface HistorySeries {
  key: string;
  points: HistoryPoint[];
}

/** What `historySeries` answers. */
export interface HistoryAnswer {
  bucketMs: number;
  range: HistoryRange;
  series: HistorySeries[];
}

/** One row of the recent-requests table. */
export interface RecentRequestRow {
  at: number;
  breaker: null | string;
  costEstimated: boolean;
  costUsd: null | number;
  id: number;
  inputTokens: null | number;
  model: string;
  ms: number;
  nextTarget: null | string;
  outputTokens: null | number;
  cacheReadTokens: null | number;
  cacheWriteTokens: null | number;
  session: null | string;
  slot: null | string;
  status: number;
  target: string;
}

/** One page of recent requests, newest first; `nextCursor` for the page after it. */
export interface RecentPage {
  nextCursor: null | number;
  rows: RecentRequestRow[];
}

/** The key a row with no slot or no session is grouped and shown under. */
export const NO_SLOT_KEY = "(no slot)";
export const NO_SESSION_KEY = "(no session)";

/** The most rows one page of `recentRequests` returns. */
export const RECENT_PAGE_MAX = 200;

/** The default page size. */
export const RECENT_PAGE_DEFAULT = 50;

/** The grouping expression, from the column a row holds; never from a caller's text. */
function groupExpression(by: HistoryBy): string {
  switch (by) {
    case "slot":
      return `coalesce(slot, '${NO_SLOT_KEY}')`;
    case "session":
      return `coalesce(session, '${NO_SESSION_KEY}')`;
    default:
      return by;
  }
}

/** The filter part of the WHERE clause and its bound values. */
function filterClause(filters: HistoryFilters): { sql: string[]; values: (number | string)[] } {
  const parts: string[] = [];
  const values: (number | string)[] = [];
  for (const column of ["slot", "target", "model", "session"] as const) {
    const value = filters[column];
    if (value === undefined) continue;
    parts.push(`${column} = ?`);
    values.push(value);
  }
  if (filters.status === "error") parts.push("status >= 400");
  return { sql: parts, values };
}

/** The WHERE clause and its bound values for a window that starts at `from`. */
function whereClause(
  from: number,
  filters: HistoryFilters,
): { sql: string; values: (number | string)[] } {
  const filter = filterClause(filters);
  return { sql: ["at >= ?", ...filter.sql].join(" AND "), values: [from, ...filter.values] };
}

/**
 * Opens the database read-only. A file that is not there is an empty history, not an error;
 * a file that cannot be read (wrong permissions, not a database) throws, so the caller can
 * say so instead of showing zeros.
 */
function openReadonly(file: string): Database | null {
  // `readonly` never creates the file: a machine that never logged a request has none.
  if (!historyDbExists(file)) return null;
  const db = new Database(file, { readonly: true });
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/** The 50th and 95th percentiles of `values` (nearest rank), in milliseconds. */
export function percentiles(values: readonly number[]): { p50: number; p95: number } {
  if (values.length === 0) return { p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}

/** The bucket a time falls in, for `bucketMs`. */
function bucketStart(at: number, bucketMs: number): number {
  return Math.floor(at / bucketMs) * bucketMs;
}

/** Micro-dollar rounding, as the writer does: a sum of rows stays exact enough. */
function roundUsd(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** One (series, bucket) while the rows are read. */
interface Bucket {
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  durs: number[];
  errors: number;
  input: number;
  output: number;
  requests: number;
}

function emptyBucket(): Bucket {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    durs: [],
    errors: 0,
    input: 0,
    output: 0,
    requests: 0,
  };
}

/**
 * The history of a range, grouped by `by`: every bucket of the window, empty ones as zeros,
 * and each series' buckets in time order. `now` is injectable for a test.
 */
export function historySeries(
  file: string,
  options: { by: HistoryBy; filters?: HistoryFilters; now?: number; range: HistoryRange },
): HistoryAnswer {
  const now = options.now ?? Date.now();
  const bucketMs = BUCKET_MS[options.range];
  const first = bucketStart(now - RANGE_MS[options.range], bucketMs);
  const last = bucketStart(now, bucketMs);
  const db = openReadonly(file);
  if (db === null) {
    return { bucketMs, range: options.range, series: [] };
  }
  try {
    const where = whereClause(now - RANGE_MS[options.range], options.filters ?? {});
    const sql = `SELECT ${groupExpression(options.by)} AS key, CAST(at / ? AS INTEGER) * ? AS t,
      status, ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
      FROM requests WHERE ${where.sql}`;
    const buckets = new Map<string, Map<number, Bucket>>();
    const rows = db.query(sql).iterate(bucketMs, bucketMs, ...where.values) as Iterable<
      Pick<
        StoredRow,
        | "cache_read_tokens"
        | "cache_write_tokens"
        | "cost_usd"
        | "input_tokens"
        | "ms"
        | "output_tokens"
        | "status"
      > & { key: string; t: number }
    >;
    for (const row of rows) {
      const bucket = bucketOf(buckets, row.key, row.t);
      bucket.requests += 1;
      if (row.status >= 400) bucket.errors += 1;
      bucket.durs.push(row.ms);
      bucket.input += row.input_tokens ?? 0;
      bucket.output += row.output_tokens ?? 0;
      bucket.cacheRead += row.cache_read_tokens ?? 0;
      bucket.cacheWrite += row.cache_write_tokens ?? 0;
      bucket.cost += row.cost_usd ?? 0;
    }
    const series: HistorySeries[] = [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, byBucket]) => ({
        key,
        points: pointsOf(byBucket, first, last, bucketMs),
      }));
    return { bucketMs, range: options.range, series };
  } finally {
    db.close();
  }
}

/** The bucket for a series key and time, made when first seen. */
function bucketOf(buckets: Map<string, Map<number, Bucket>>, key: string, t: number): Bucket {
  let series = buckets.get(key);
  if (series === undefined) {
    series = new Map();
    buckets.set(key, series);
  }
  let bucket = series.get(t);
  if (bucket === undefined) {
    bucket = emptyBucket();
    series.set(t, bucket);
  }
  return bucket;
}

/** Every bucket from `first` to `last` in order: the empty ones as zeros. */
function pointsOf(
  buckets: Map<number, Bucket>,
  first: number,
  last: number,
  bucketMs: number,
): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  for (let t = first; t <= last; t += bucketMs) {
    const bucket = buckets.get(t);
    if (bucket === undefined) {
      points.push({
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        p50Ms: 0,
        p95Ms: 0,
        requests: 0,
        t,
      });
      continue;
    }
    const { p50, p95 } = percentiles(bucket.durs);
    points.push({
      cacheReadTokens: bucket.cacheRead,
      cacheWriteTokens: bucket.cacheWrite,
      costUsd: roundUsd(bucket.cost),
      errors: bucket.errors,
      inputTokens: bucket.input,
      outputTokens: bucket.output,
      p50Ms: p50,
      p95Ms: p95,
      requests: bucket.requests,
      t,
    });
  }
  return points;
}

/**
 * The newest requests first, one page at a time. `cursor` is the `nextCursor` of the page
 * before (its last id); no cursor starts at the newest. `limit` is clamped to 1..200, and a
 * missing one is 50.
 */
export function recentRequests(
  file: string,
  options: { cursor?: number; filters?: HistoryFilters; limit?: number } = {},
): RecentPage {
  const limit = Math.min(
    RECENT_PAGE_MAX,
    Math.max(1, Math.trunc(options.limit ?? RECENT_PAGE_DEFAULT)),
  );
  const db = openReadonly(file);
  if (db === null) return { nextCursor: null, rows: [] };
  try {
    const filter = filterClause(options.filters ?? {});
    const conditions = [...(options.cursor === undefined ? [] : ["id < ?"]), ...filter.sql];
    const values: (number | string)[] = [
      ...(options.cursor === undefined ? [] : [options.cursor]),
      ...filter.values,
    ];
    const sql = `SELECT ${HISTORY_COLUMNS} FROM requests WHERE ${
      conditions.length === 0 ? "1 = 1" : conditions.join(" AND ")
    } ORDER BY id DESC LIMIT ?`;
    const rows = db.query(sql).all(...values, limit) as StoredRow[];
    return {
      nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
      rows: rows.map(rowOf),
    };
  } finally {
    db.close();
  }
}

/** One stored row as the table shows it. */
function rowOf(row: StoredRow): RecentRequestRow {
  return {
    at: row.at,
    breaker: row.breaker,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    costEstimated: row.cost_estimated === 1,
    costUsd: row.cost_usd,
    id: row.id,
    inputTokens: row.input_tokens,
    model: row.model,
    ms: row.ms,
    nextTarget: row.next_target,
    outputTokens: row.output_tokens,
    session: row.session,
    slot: row.slot,
    status: row.status,
    target: row.target,
  };
}

/** The bytes the history takes, in words: "0 B", "12.3 MB", "1.1 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "TB"}`;
}

/** A bucket's length in words: "1-minute", "15-minute", "1-hour", "1-day". */
export function bucketWords(bucketMs: number): string {
  if (bucketMs % 86_400_000 === 0) return `${String(bucketMs / 86_400_000)}-day`;
  if (bucketMs % 3_600_000 === 0) return `${String(bucketMs / 3_600_000)}-hour`;
  return `${String(bucketMs / 60_000)}-minute`;
}

/**
 * The history's state in words, one line for `doctor` and `gateway status`: its size and the
 * retention, or that it is off, or that it has not logged a request yet.
 */
export function historyWords(options: {
  bytes: number;
  exists: boolean;
  retentionDays: number;
}): string {
  if (options.retentionDays <= 0) return "off (history.retentionDays: 0)";
  const keeping = `keeping ${retentionWords(options.retentionDays)}`;
  return options.exists
    ? `${formatBytes(options.bytes)}, ${keeping}`
    : `no requests logged yet, ${keeping}`;
}
