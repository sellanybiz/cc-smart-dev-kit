/**
 * The opus usage guard (D54): the one reader of Claude Code's 5-hour window, the state file the
 * status line records it in, and the opus slot's fallback chain that lifts the guard.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { readUsageWindow, recordUsageWindow, usageWindowFile, windowOf } from "../cli/usage-window";
import { emptyConfig, type GatewayConfig } from "../gateway/config";
import { tempDir } from "../testing/temp";
import { opusFallbackOf, usageFacts, usageUnreadLine } from "./usage-guard";

/** 2026-10-21 10:00 UTC. */
const NOW = Date.parse("2026-10-21T10:00:00.000Z");
const RESET = NOW / 1000 + 3 * 3600;

/** The status line input as Claude Code passes it, with the 5-hour window `percent` used. */
function inputOf(percent: number, resetsAt: null | number = RESET): Record<string, unknown> {
  return {
    model: { display_name: "Opus 5.5" },
    rate_limits: { five_hour: { resets_at: resetsAt, used_percentage: percent } },
  };
}

/** A temp home with the kit's paths, and that home's state folder made. */
function pathsFor(): CliPaths {
  const paths = cliPaths({ HOME: tempDir("home") });
  mkdirSync(paths.stateDir, { mode: 0o700, recursive: true });
  return paths;
}

describe("the one reader of Claude Code's windows", () => {
  test("the 5-hour window: its share used and when it resets", () => {
    expect(windowOf(inputOf(87.5), "five_hour")).toEqual({ percent: 87.5, resetsAt: RESET });
    expect(windowOf(inputOf(40, null), "five_hour")).toEqual({ percent: 40, resetsAt: null });
  });

  test("no window, or one without a number: null, never an invented number", () => {
    expect(windowOf({ model: {} }, "five_hour")).toBeNull();
    expect(
      windowOf({ rate_limits: { seven_day: { used_percentage: 41 } } }, "five_hour"),
    ).toBeNull();
    expect(windowOf({ rate_limits: { five_hour: { used_percentage: "87" } } }, "five_hour")).toBe(
      null,
    );
    expect(windowOf("not an object", "five_hour")).toBeNull();
    expect(windowOf(null, "five_hour")).toBeNull();
  });
});

describe("the window the status line recorded", () => {
  test("the number and its reset are written; the same numbers again keep the file as it is", () => {
    const paths = pathsFor();
    recordUsageWindow(paths, inputOf(87), NOW);
    const file = usageWindowFile(paths);
    const first = readFileSync(file, "utf8");
    expect(JSON.parse(first)).toEqual({
      fiveHour: { percent: 87, resetsAt: RESET },
      readAt: new Date(NOW).toISOString(),
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    recordUsageWindow(paths, inputOf(87), NOW + 60_000);
    expect(readFileSync(file, "utf8")).toBe(first);
    recordUsageWindow(paths, inputOf(91), NOW + 120_000);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      fiveHour: { percent: 91, resetsAt: RESET },
      readAt: new Date(NOW + 120_000).toISOString(),
    });
  });

  test("a status line input with no window records nothing, so the last one stands", () => {
    const paths = pathsFor();
    recordUsageWindow(paths, inputOf(87), NOW);
    recordUsageWindow(paths, { rate_limits: {} }, NOW + 60_000);
    expect(readUsageWindow(paths, NOW + 60_000)).toEqual({ percent: 87, resetsAt: RESET });
  });

  test("read back: nothing recorded, a broken file, or a window already reset all read as unknown", () => {
    const paths = pathsFor();
    expect(readUsageWindow(paths, NOW)).toBeNull();
    recordUsageWindow(paths, inputOf(87), NOW);
    // The window resets at RESET; past it, that reading measured a window that is over.
    expect(readUsageWindow(paths, NOW)).toEqual({ percent: 87, resetsAt: RESET });
    expect(readUsageWindow(paths, RESET * 1000 + 1)).toBeNull();
    const file = usageWindowFile(paths);
    writeFileSync(file, "not json");
    expect(readUsageWindow(paths, NOW)).toBeNull();
    writeFileSync(file, JSON.stringify({ fiveHour: { percent: 87 } }));
    expect(readUsageWindow(paths, NOW)).toBeNull();
    // A window with no reset time holds while it is younger than the window itself (5 hours),
    // and is unknown after that: it could not describe a window that old.
    writeFileSync(
      file,
      JSON.stringify({
        fiveHour: { percent: 87, resetsAt: null },
        readAt: new Date(NOW - 60 * 60_000).toISOString(),
      }),
    );
    expect(readUsageWindow(paths, NOW)).toEqual({ percent: 87, resetsAt: null });
    writeFileSync(
      file,
      JSON.stringify({
        fiveHour: { percent: 87, resetsAt: null },
        readAt: new Date(NOW - 6 * 60 * 60_000).toISOString(),
      }),
    );
    expect(readUsageWindow(paths, NOW)).toBeNull();
  });
});

describe("D54: the gateway's opus slot lifts the guard", () => {
  const off = emptyConfig();
  const chain: GatewayConfig = {
    ...off,
    backends: { omniroute: { apiKey: "test-key", baseUrl: "http://127.0.0.1:20199" } },
    fallback: { "cc-smart-dev-kit-opus": true },
    slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-5.3-flash"] },
  };

  test("a chain in use with its fallback on, and the gateway on: lifted", () => {
    expect(opusFallbackOf({ config: chain, gatewayOn: true })).toBe(true);
  });

  test("no chain, its fallback off, the gateway off, or no config: not lifted", () => {
    expect(opusFallbackOf({ config: { ...chain, slots: {} }, gatewayOn: true })).toBe(false);
    expect(
      opusFallbackOf({
        config: { ...chain, fallback: { "cc-smart-dev-kit-opus": false } },
        gatewayOn: true,
      }),
    ).toBe(false);
    expect(opusFallbackOf({ config: chain, gatewayOn: false })).toBe(false);
    expect(opusFallbackOf({ config: null, gatewayOn: true })).toBe(false);
  });

  test("the facts a start reads: the window from the state file and the chain from the gateway", () => {
    const paths = pathsFor();
    expect(usageFacts(paths, NOW)).toEqual({ opusFallback: false, percent: null });
    recordUsageWindow(paths, inputOf(87), NOW);
    expect(usageFacts(paths, NOW)).toEqual({ opusFallback: false, percent: 87 });
    mkdirSync(dirname(paths.gatewayConfigFile), { mode: 0o700, recursive: true });
    writeFileSync(paths.gatewayConfigFile, `${JSON.stringify({ ...chain, version: 1 })}\n`, {
      mode: 0o600,
    });
    writeFileSync(
      paths.settingsFile,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" } }),
    );
    expect(usageFacts(paths, NOW)).toEqual({ opusFallback: true, percent: 87 });
  });

  test("the one line said when the window cannot be read", () => {
    expect(usageUnreadLine()).toBe(
      "note: the 5-hour usage window cannot be read, so the opus usage guard does not hold: cc-smart-dev-kit setup --statusline records it, and no current reading is stored",
    );
  });
});
