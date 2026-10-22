/**
 * `cc-smart-dev-kit statusline`: the line from Claude Code's status line input and the router's
 * state file. Every expected line is written by hand; times are shown in UTC.
 */
import { describe, expect, it } from "bun:test";
import type { LimitState } from "../gateway/limit-state";
import { statuslineText } from "./statusline";

/** 2026-10-15 10:00 UTC. */
const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);
const AT_13 = NOW / 1000 + 3 * 3600;
const IN_3_DAYS = NOW / 1000 + 3 * 86_400;

/** The status line input as Claude Code 2.1.300 passes it (the fields this reads). */
function input(five: null | number, seven: null | number): Record<string, unknown> {
  const rateLimits: Record<string, unknown> = {};
  if (five !== null) rateLimits.five_hour = { resets_at: AT_13, used_percentage: five };
  if (seven !== null) rateLimits.seven_day = { resets_at: IN_3_DAYS, used_percentage: seven };
  return {
    model: { display_name: "Opus 5.5", id: "claude-opus-5-5" },
    ...(five === null && seven === null ? {} : { rate_limits: rateLimits }),
    session_id: "s-1",
  };
}

const EMPTY: LimitState = { fallbacks: {}, limits: {}, version: 1 };

describe("statusline", () => {
  it("shows the model and both windows below 85 %", () => {
    expect(statuslineText(input(23.5, 41.2), EMPTY, NOW, "UTC")).toBe("Opus 5.5 · 5h 24% · 7d 41%");
  });

  it("warns from 85 %, with the reset time; another day shows the date", () => {
    expect(statuslineText(input(85, 90), null, NOW, "UTC")).toBe(
      "Opus 5.5 · ⚠ 5h 85% (resets 13:00) · ⚠ 7d 90% (resets Oct 18 10:00)",
    );
    expect(statuslineText(input(84.4, null), null, NOW, "UTC")).toBe("Opus 5.5 · 5h 84%");
  });

  it("no rate_limits (an API key, or before the first answer): the model alone", () => {
    expect(statuslineText(input(null, null), null, NOW, "UTC")).toBe("Opus 5.5");
    expect(statuslineText("not an object", null, NOW, "UTC")).toBe("");
  });

  it("a slot on its fallback; a judge record an older router wrote is not shown", () => {
    const state: LimitState = {
      fallbacks: {
        "cc-smart-dev-kit-judge": {
          lastAt: NOW - 60_000,
          model: "claude-sonnet-5",
          resetsAt: null,
          since: NOW - 60_000,
          target: "ollama:deepseek-v4.1-flash",
        },
        "cc-smart-dev-kit-opus": {
          lastAt: NOW - 60_000,
          model: "claude-opus-5-5",
          resetsAt: AT_13,
          since: NOW - 600_000,
          target: "omniroute:ollama-cloud/glm-5.3-flash",
        },
      },
      limits: { "claude-opus-5-5": { claim: "five_hour", resetsAt: AT_13, seenAt: NOW - 600_000 } },
      version: 1,
    };
    expect(statuslineText(input(null, null), state, NOW, "UTC")).toBe(
      "Opus 5.5 · ⚠ claude-opus-5-5 at its limit → omniroute:ollama-cloud/glm-5.3-flash until 13:00",
    );
  });

  it("a plan limit with no fallback; records past their reset or too old are not shown", () => {
    const state: LimitState = {
      fallbacks: {
        "cc-smart-dev-kit-fable": {
          lastAt: NOW - 3_600_000,
          model: "claude-fable-5-1",
          resetsAt: NOW / 1000 - 1,
          since: NOW - 7_200_000,
          target: "omniroute:glm-5.3-flash",
        },
      },
      limits: {
        "claude-fable-5-1": {
          claim: "seven_day",
          resetsAt: NOW / 1000 - 1,
          seenAt: NOW - 3_600_000,
        },
        "claude-haiku-5": { claim: null, resetsAt: null, seenAt: NOW - 16 * 60_000 },
        "claude-opus-5-5": { claim: "five_hour", resetsAt: AT_13, seenAt: NOW - 1000 },
      },
      version: 1,
    };
    expect(statuslineText(input(100, null), state, NOW, "UTC")).toBe(
      "Opus 5.5 · ⛔ claude-opus-5-5 at its plan limit until 13:00 · ⚠ 5h 100% (resets 13:00)",
    );
  });

  it("a slot whose breaker is open: the part from `currentBreakers`, only while it is open", () => {
    const state: LimitState = {
      breakers: {
        "cc-smart-dev-kit-worker": {
          held: 2,
          lastAt: NOW - 60_000,
          since: NOW - 5 * 60_000,
          targets: [
            { status: 429, target: "omniroute:ollama-cloud/glm-5.3-flash", until: NOW + 60_000 },
          ],
        },
      },
      fallbacks: {},
      limits: {},
      version: 1,
    };
    expect(statuslineText(input(null, null), state, NOW, "UTC")).toBe(
      "Opus 5.5 · worker slot: every target limited since 09:55 → gateway slot worker <targets>",
    );
    // A record the router stopped touching 15 minutes ago is stale: it goes with the breaker.
    const stale: LimitState = {
      ...state,
      breakers: {
        "cc-smart-dev-kit-worker": {
          held: 2,
          lastAt: NOW - 16 * 60_000,
          since: NOW - 5 * 60_000,
          targets: [],
        },
      },
    };
    expect(statuslineText(input(null, null), stale, NOW, "UTC")).toBe("Opus 5.5");
  });

  it("the warning share is a setting (`alerts.usagePercent`), not a fixed 85", () => {
    // With nothing set the built-in 85 holds (`src/workflow/schema.ts`)...
    expect(statuslineText(input(70, 41.2), EMPTY, NOW, "UTC")).toBe("Opus 5.5 · 5h 70% · 7d 41%");
    // ...and a project or a person may warn earlier, or later.
    expect(statuslineText(input(70, 41.2), EMPTY, NOW, "UTC", 70)).toBe(
      "Opus 5.5 · ⚠ 5h 70% (resets 13:00) · 7d 41%",
    );
    expect(statuslineText(input(85, 90), EMPTY, NOW, "UTC", 95)).toBe("Opus 5.5 · 5h 85% · 7d 90%");
  });
});
