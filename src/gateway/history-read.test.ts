/**
 * The request history's read side (D51): the chart's series and buckets, the filters, the
 * recent-requests pages, and the read-only open the portal uses. Every expected number is
 * written by hand.
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { createHistoryWriter, type HistoryRow, historyDbBytes, historyDbExists } from "./history";
import {
  bucketWords,
  formatBytes,
  type HISTORY_BY,
  type HISTORY_RANGES,
  historySeries,
  historyWords,
  NO_SESSION_KEY,
  NO_SLOT_KEY,
  percentiles,
  recentRequests,
} from "./history-read";

/** 10:00 UTC, aligned to every bucket size (a day, an hour, 15, 5 and 1 minute). */
const NOW = Date.UTC(2026, 9, 22, 10, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

function file(): string {
  return join(tempDir("history-read"), "history.db");
}

function row(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    at: NOW,
    breaker: null,
    cost: null,
    model: "claude-sonnet-5-5",
    ms: 100,
    nextTarget: null,
    session: "session-1",
    slot: "cc-smart-dev-kit-worker",
    status: 200,
    target: "claude-sonnet-5-5",
    tokens: null,
    ...overrides,
  };
}

/** Five rows with known values, written in this order (the last is the newest id). */
const ROWS: HistoryRow[] = [
  row({
    at: NOW - 10 * MIN,
    cost: { estimated: true, usd: 0.001 },
    ms: 100,
    tokens: { cacheRead: 1000, cacheWrite: 20, input: 100, output: 10 },
  }),
  row({ at: NOW - 9 * MIN, ms: 300, status: 500 }),
  row({
    at: NOW - 8 * MIN,
    cost: { estimated: false, usd: 0.0001 },
    model: "claude-haiku-5-5",
    ms: 50,
    session: "session-2",
    slot: "cc-smart-dev-kit-scout",
    target: "omniroute:glm",
    tokens: { cacheRead: 0, cacheWrite: 0, input: 10, output: 5 },
  }),
  row({
    at: NOW - 7 * MIN,
    cost: { estimated: false, usd: 0.0002 },
    model: "claude-haiku-5-5",
    ms: 150,
    session: null,
    slot: null,
    target: "omniroute:glm",
  }),
  // Outside the shorter ranges, and the newest id: paging is by id, not by time.
  row({ at: NOW - 30 * 24 * HOUR, model: "claude-opus-5-5", ms: 999, session: null, slot: null }),
];

function seed(rows: HistoryRow[] = ROWS): { close: () => void; file: string } {
  const path = file();
  const writer = createHistoryWriter({
    file: path,
    flushAfterMs: 60_000,
    log: () => {},
    now: () => NOW,
    retentionDays: () => 90,
  });
  for (const entry of rows) writer.record(entry);
  writer.flush();
  return { close: () => writer.close(), file: path };
}

/** The requests in one series, summed over its buckets. */
function total(series: { points: { requests: number }[] }): number {
  return series.points.reduce((sum, point) => sum + point.requests, 0);
}

describe("the history's ranges and buckets", () => {
  it("each range has the bucket D51 names, and every bucket of the window is there", () => {
    const seeded = seed();
    const expected: [string, number, number][] = [
      // range, bucket ms, points (the window divided by the bucket, plus the one it starts in)
      ["1h", MIN, 61],
      ["4h", 5 * MIN, 49],
      ["1d", 15 * MIN, 97],
      ["7d", HOUR, 169],
      ["14d", 2 * HOUR, 169],
      ["30d", 6 * HOUR, 121],
      ["90d", 24 * HOUR, 91],
    ];
    for (const [range, bucketMs, points] of expected) {
      const answer = historySeries(seeded.file, {
        by: "target",
        now: NOW,
        range: range as (typeof HISTORY_RANGES)[number],
      });
      expect(answer.bucketMs).toBe(bucketMs);
      expect(answer.range).toBe(range as (typeof HISTORY_RANGES)[number]);
      for (const series of answer.series) {
        expect(series.points).toHaveLength(points);
        // Every point is one bucket after the one before it, and the last is the bucket
        // that holds `now` (a bucket size need not divide the window's start).
        for (let index = 1; index < series.points.length; index += 1) {
          const before = series.points[index - 1]?.t ?? 0;
          expect((series.points[index]?.t ?? 0) - before).toBe(bucketMs);
        }
        const last = series.points.at(-1)?.t ?? 0;
        expect(last).toBeLessThanOrEqual(NOW);
        expect(NOW - last).toBeLessThan(bucketMs);
      }
    }
    seeded.close();
  });

  it("the 90d range keeps the row 30 hours old; the shorter ones do not", () => {
    const seeded = seed();
    expect(
      historySeries(seeded.file, { by: "model", now: NOW, range: "90d" }).series.map(
        (series) => series.key,
      ),
    ).toContain("claude-opus-5-5");
    expect(
      historySeries(seeded.file, { by: "model", now: NOW, range: "7d" }).series.map(
        (series) => series.key,
      ),
    ).not.toContain("claude-opus-5-5");
    seeded.close();
  });
});

describe("the history's grouping and filters", () => {
  it("groups by target, slot, model and session; a row with none is under its own key", () => {
    const seeded = seed();
    const keys = (by: (typeof HISTORY_BY)[number]) =>
      historySeries(seeded.file, { by, now: NOW, range: "1d" }).series.map((series) => series.key);

    expect(keys("target")).toEqual(["claude-sonnet-5-5", "omniroute:glm"]);
    expect(keys("slot")).toEqual([
      NO_SLOT_KEY,
      "cc-smart-dev-kit-scout",
      "cc-smart-dev-kit-worker",
    ]);
    expect(keys("model")).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(keys("session")).toEqual([NO_SESSION_KEY, "session-1", "session-2"]);
    seeded.close();
  });

  it("every filter narrows to its own rows, and status=error to 400 and above", () => {
    const seeded = seed();
    const count = (filters: Parameters<typeof historySeries>[1]["filters"] = {}) =>
      historySeries(seeded.file, {
        by: "target",
        filters: filters ?? {},
        now: NOW,
        range: "1d",
      }).series.reduce((sum, series) => sum + total(series), 0);
    expect(count({ slot: "cc-smart-dev-kit-worker" })).toBe(2);
    expect(count({ target: "omniroute:glm" })).toBe(2);
    expect(count({ model: "claude-haiku-5-5" })).toBe(2);
    expect(count({ session: "session-2" })).toBe(1);
    expect(count({ status: "error" })).toBe(1);
    expect(count({ slot: "cc-smart-dev-kit-worker", status: "error" })).toBe(1);
    seeded.close();
  });

  it("a bucket's counts, tokens, cost and latency are its own rows", () => {
    const seeded = seed();
    const answer = historySeries(seeded.file, { by: "target", now: NOW, range: "1h" });
    const sonnet = answer.series.find((series) => series.key === "claude-sonnet-5-5");
    if (sonnet === undefined) throw new Error("no sonnet series");
    const answered = sonnet.points.find((point) => point.requests > 0);
    expect(answered).toEqual({
      cacheReadTokens: 1000,
      cacheWriteTokens: 20,
      costUsd: 0.001,
      errors: 0,
      inputTokens: 100,
      outputTokens: 10,
      p50Ms: 100,
      p95Ms: 100,
      requests: 1,
      t: NOW - 10 * MIN,
    });
    const failed = sonnet.points.find((point) => point.errors > 0);
    expect(failed).toMatchObject({ errors: 1, p50Ms: 300, requests: 1, t: NOW - 9 * MIN });
    seeded.close();
  });

  it("percentiles are nearest-rank on a known set, and empty is zero", () => {
    expect(percentiles([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({ p50: 50, p95: 100 });
    expect(percentiles([7])).toEqual({ p50: 7, p95: 7 });
    expect(percentiles([9, 1, 5])).toEqual({ p50: 5, p95: 9 });
    expect(percentiles([])).toEqual({ p50: 0, p95: 0 });
  });
});

describe("the recent-requests pages", () => {
  it("newest first, one page at a time, with the cursor the page after it needs", () => {
    const seeded = seed();
    const first = recentRequests(seeded.file, { limit: 2 });
    expect(first.rows.map((entry) => entry.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    expect(first.nextCursor).toBe(4);
    const second = recentRequests(seeded.file, { cursor: first.nextCursor ?? 0, limit: 2 });
    expect(second.rows.map((entry) => entry.ms)).toEqual([50, 300]);
    expect(second.nextCursor).toBe(2);
    const third = recentRequests(seeded.file, { cursor: second.nextCursor ?? 0, limit: 2 });
    expect(third.rows.map((entry) => entry.ms)).toEqual([100]);
    expect(third.nextCursor).toBeNull();
    seeded.close();
  });

  it("the same filters apply, and a limit is clamped", () => {
    const seeded = seed();
    expect(
      recentRequests(seeded.file, { filters: { slot: "cc-smart-dev-kit-worker" }, limit: 10 }).rows,
    ).toHaveLength(2);
    expect(recentRequests(seeded.file, { limit: 0 }).rows).toHaveLength(1);
    expect(recentRequests(seeded.file, { limit: 100_000 }).rows).toHaveLength(5);
    seeded.close();
  });
});

describe("reading is read-only", () => {
  it("a missing database is an empty history, and no file is made", () => {
    const path = file();
    expect(historySeries(path, { by: "target", now: NOW, range: "1h" })).toEqual({
      bucketMs: MIN,
      range: "1h",
      series: [],
    });
    expect(recentRequests(path)).toEqual({ nextCursor: null, rows: [] });
    expect(historyDbExists(path)).toBe(false);
  });

  it("the portal reads while the router's writer still holds the database", () => {
    const seeded = seed();
    // The writer is still open (not closed): the read must work, and add nothing.
    const before = historyDbBytes(seeded.file);
    expect(recentRequests(seeded.file, { limit: 10 }).rows).toHaveLength(5);
    expect(historySeries(seeded.file, { by: "target", now: NOW, range: "1h" }).series).toHaveLength(
      2,
    );
    expect(historyDbBytes(seeded.file)).toBe(before);
    seeded.close();
  });
});

describe("the history's words", () => {
  it("a size: bytes, then one decimal in the unit that fits", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.0 KB");
    expect(formatBytes(1_234_567)).toBe("1.2 MB");
    expect(formatBytes(1_100_000_000)).toBe("1.1 GB");
  });

  it("a bucket's length", () => {
    expect(bucketWords(MIN)).toBe("1-minute");
    expect(bucketWords(15 * MIN)).toBe("15-minute");
    expect(bucketWords(HOUR)).toBe("1-hour");
    expect(bucketWords(6 * HOUR)).toBe("6-hour");
    expect(bucketWords(24 * HOUR)).toBe("1-day");
  });

  it("the state line: off, no requests yet, or a size and the retention", () => {
    expect(historyWords({ bytes: 0, exists: false, retentionDays: 0 })).toBe(
      "off (history.retentionDays: 0)",
    );
    expect(historyWords({ bytes: 0, exists: false, retentionDays: 90 })).toBe(
      "no requests logged yet, keeping 90 days",
    );
    expect(historyWords({ bytes: 1_234_567, exists: true, retentionDays: 1 })).toBe(
      "1.2 MB, keeping 1 day",
    );
  });
});
