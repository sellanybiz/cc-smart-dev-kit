/**
 * Reading the safety-check counts from disk: the file, the local days a window covers, and the
 * window's totals. One home for both readers — the CLI's `usage` and the portal's Usage page
 * (F6). Every expected number is written by hand.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  type CheckDay,
  emptySafetyChecks,
  formatSafetyCheckState,
  localDay,
  type SafetyCheckState,
} from "./safety-checks";
import { readSafetyChecks, safetyCheckWindow, windowDays } from "./safety-checks-read";

/** Noon UTC, so a window of a few hours stays inside one local day. */
const NOON = Date.UTC(2026, 9, 22, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

function day(checks: number, anthropic: number, fallback = 0): CheckDay {
  const side = (count: number): CheckDay["anthropic"] => ({
    cacheRead: 0,
    cacheWrite: 0,
    checks: count,
    input: 0,
    output: 0,
  });
  return { anthropic: side(anthropic), checks, fallback: side(fallback) };
}

/** A state holding three local days: today, yesterday, and three days back. */
function state(): SafetyCheckState {
  return {
    days: {
      [localDay(NOON, "UTC")]: day(9, 7, 2),
      [localDay(NOON - DAY, "UTC")]: day(5, 5),
      [localDay(NOON - 3 * DAY, "UTC")]: day(100, 100),
    },
    version: 1,
  };
}

describe("the local days a window covers", () => {
  it("counts the day it starts in through today, both ends included", () => {
    expect(windowDays(NOON, HOUR, "UTC")).toBe(1);
    expect(windowDays(NOON, 24 * HOUR, "UTC")).toBe(2);
    expect(windowDays(NOON, 7 * DAY, "UTC")).toBe(8);
    expect(windowDays(NOON, 90 * DAY, "UTC")).toBe(91);
    // Half past midnight, an hour back reaches into yesterday: two days, not one.
    expect(windowDays(Date.UTC(2026, 9, 22, 0, 30), HOUR, "UTC")).toBe(2);
  });
});

describe("a window's safety checks", () => {
  it("sums the days the window covers, newest first", () => {
    const window = safetyCheckWindow(state(), {
      nowMs: NOON,
      timeZone: "UTC",
      windowMs: 24 * HOUR,
    });
    expect(window.days.map(([label]) => label)).toEqual([
      localDay(NOON, "UTC"),
      localDay(NOON - DAY, "UTC"),
    ]);
    expect(window.checks).toBe(14);
  });

  it("a window longer than the days kept reads only the days that are there", () => {
    // Three days back is outside a one-day window, and inside a 90-day one.
    expect(
      safetyCheckWindow(state(), { nowMs: NOON, timeZone: "UTC", windowMs: HOUR }).checks,
    ).toBe(9);
    expect(
      safetyCheckWindow(state(), { nowMs: NOON, timeZone: "UTC", windowMs: 90 * DAY }).checks,
    ).toBe(114);
  });

  it("no file counted yet: nothing, and no day reached", () => {
    expect(safetyCheckWindow(null, { nowMs: NOON, timeZone: "UTC", windowMs: DAY })).toEqual({
      checks: 0,
      days: [],
    });
  });
});

describe("reading the file", () => {
  function file(text: string): string {
    const path = join(tempDir("safety-checks-read"), "safety-checks.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return path;
  }

  it("a file the router wrote reads back as it stands", () => {
    expect(readSafetyChecks(file(formatSafetyCheckState(state())))).toEqual(state());
  });

  it("a file that is not there, or holds no state this version reads, is null", () => {
    expect(
      readSafetyChecks(join(tempDir("safety-checks-missing"), "safety-checks.json")),
    ).toBeNull();
    expect(readSafetyChecks(file("{ not json"))).toBeNull();
    expect(readSafetyChecks(file('{"days":{},"version":99}'))).toBeNull();
    expect(readSafetyChecks(file(formatSafetyCheckState(emptySafetyChecks())))).toEqual(
      emptySafetyChecks(),
    );
  });
});
