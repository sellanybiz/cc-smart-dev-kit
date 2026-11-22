/**
 * The usage-window file (`usage-window.ts`): what the status line records of the plan's 5-hour
 * and 7-day windows, and how its readers get them back. Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { readUsageWindows, recordUsageWindow, usageWindowFile } from "./usage-window";

/** 2026-10-15 10:00 UTC. */
const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);
const AT_13 = NOW / 1000 + 3 * 3600;
const IN_3_DAYS = NOW / 1000 + 3 * 86_400;

/** A status line input with the windows given (null: that window is missing). */
function input(five: null | number, seven: null | number): Record<string, unknown> {
  const rateLimits: Record<string, unknown> = {};
  if (five !== null) rateLimits.five_hour = { resets_at: AT_13, used_percentage: five };
  if (seven !== null) rateLimits.seven_day = { resets_at: IN_3_DAYS, used_percentage: seven };
  return five === null && seven === null ? {} : { rate_limits: rateLimits };
}

function world() {
  const paths = cliPaths({ HOME: tempDir("usage-home") });
  mkdirSync(paths.stateDir, { recursive: true });
  return paths;
}

describe("recordUsageWindow", () => {
  it("records both windows, mode 600", () => {
    const paths = world();
    recordUsageWindow(paths, input(87, 41), NOW);
    expect(JSON.parse(readFileSync(usageWindowFile(paths), "utf8"))).toEqual({
      fiveHour: { percent: 87, resetsAt: AT_13 },
      readAt: "2026-10-15T10:00:00.000Z",
      sevenDay: { percent: 41, resetsAt: IN_3_DAYS },
    });
    expect(statSync(usageWindowFile(paths)).mode & 0o777).toBe(0o600);
  });

  it("writes only when the numbers change: readAt keeps the last change", () => {
    const paths = world();
    recordUsageWindow(paths, input(87, 41), NOW);
    recordUsageWindow(paths, input(87, 41), NOW + 60_000);
    expect(JSON.parse(readFileSync(usageWindowFile(paths), "utf8")).readAt).toBe(
      "2026-10-15T10:00:00.000Z",
    );
    // The 7-day number alone moved: a write.
    recordUsageWindow(paths, input(87, 42), NOW + 120_000);
    expect(JSON.parse(readFileSync(usageWindowFile(paths), "utf8"))).toEqual({
      fiveHour: { percent: 87, resetsAt: AT_13 },
      readAt: "2026-10-15T10:02:00.000Z",
      sevenDay: { percent: 42, resetsAt: IN_3_DAYS },
    });
  });

  it("each window on its own: a window the input lacks is not kept", () => {
    const paths = world();
    recordUsageWindow(paths, input(87, 41), NOW);
    recordUsageWindow(paths, input(null, 41), NOW + 60_000);
    expect(JSON.parse(readFileSync(usageWindowFile(paths), "utf8"))).toEqual({
      readAt: "2026-10-15T10:01:00.000Z",
      sevenDay: { percent: 41, resetsAt: IN_3_DAYS },
    });
    expect(readUsageWindows(paths, NOW + 60_000)).toEqual({
      fiveHour: null,
      readAt: Date.UTC(2026, 9, 15, 10, 1, 0),
      sevenDay: { percent: 41, resetsAt: IN_3_DAYS },
    });
  });

  it("an input with no rate_limits records nothing", () => {
    const paths = world();
    recordUsageWindow(paths, input(87, 41), NOW);
    recordUsageWindow(paths, input(null, null), NOW + 60_000);
    // readAt stays at the last change: 10:00, not the 10:01 that recorded nothing.
    expect(readUsageWindows(paths, NOW + 60_000)).toEqual({
      fiveHour: { percent: 87, resetsAt: AT_13 },
      readAt: Date.UTC(2026, 9, 15, 10, 0, 0),
      sevenDay: { percent: 41, resetsAt: IN_3_DAYS },
    });
  });
});

describe("readUsageWindows", () => {
  it("no file, or one that cannot be read: neither window", () => {
    const paths = world();
    expect(readUsageWindows(paths, NOW)).toEqual({ fiveHour: null, readAt: null, sevenDay: null });
    writeFileSync(usageWindowFile(paths), "{not json");
    expect(readUsageWindows(paths, NOW)).toEqual({ fiveHour: null, readAt: null, sevenDay: null });
  });

  it("the file a kit before 2.2.0 wrote (fiveHour alone) still reads", () => {
    const paths = world();
    writeFileSync(
      usageWindowFile(paths),
      JSON.stringify({
        fiveHour: { percent: 61, resetsAt: AT_13 },
        readAt: "2026-10-15T09:50:00Z",
      }),
    );
    expect(readUsageWindows(paths, NOW)).toEqual({
      fiveHour: { percent: 61, resetsAt: AT_13 },
      readAt: Date.UTC(2026, 9, 15, 9, 50, 0),
      sevenDay: null,
    });
  });

  it("a window past its reset is no number, each on its own", () => {
    const paths = world();
    recordUsageWindow(paths, input(87, 41), NOW);
    // Past the 5-hour reset (13:00), before the 7-day one.
    expect(readUsageWindows(paths, AT_13 * 1000)).toEqual({
      fiveHour: null,
      readAt: NOW,
      sevenDay: { percent: 41, resetsAt: IN_3_DAYS },
    });
    expect(readUsageWindows(paths, IN_3_DAYS * 1000)).toEqual({
      fiveHour: null,
      readAt: NOW,
      sevenDay: null,
    });
  });

  it("a window with no reset time ages out after its own span", () => {
    const paths = world();
    writeFileSync(
      usageWindowFile(paths),
      JSON.stringify({
        fiveHour: { percent: 12, resetsAt: null },
        readAt: "2026-10-15T10:00:00.000Z",
        sevenDay: { percent: 30, resetsAt: null },
      }),
    );
    const sixHours = NOW + 6 * 3_600_000;
    expect(readUsageWindows(paths, sixHours)).toEqual({
      fiveHour: null,
      readAt: NOW,
      sevenDay: { percent: 30, resetsAt: null },
    });
    expect(readUsageWindows(paths, NOW + 8 * 86_400_000)).toEqual({
      fiveHour: null,
      readAt: NOW,
      sevenDay: null,
    });
  });
});
