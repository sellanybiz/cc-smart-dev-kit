/**
 * `cc-smart-dev-kit statusline`: the line from Claude Code's status line input and the router's
 * state file. Every expected line is written by hand; times are shown in UTC.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import type { LimitState } from "../gateway/limit-state";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { runStatusline, statuslineText } from "./statusline";

import { readUsageWindow } from "./usage-window";

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
    // A profile's breaker (owner D29): its chain lives in the config, not at `gateway slot`.
    const profile: LimitState = {
      ...state,
      breakers: {
        "my-project/cc-smart-dev-kit-worker": state.breakers?.["cc-smart-dev-kit-worker"] ?? {
          held: 0,
          lastAt: 0,
          since: 0,
          targets: [],
        },
      },
    };
    expect(statuslineText(input(null, null), profile, NOW, "UTC")).toBe(
      "Opus 5.5 · worker slot in profile my-project: every target limited since 09:55 → gateway profile my-project slot worker <targets>",
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

  it("D54: records the 5-hour window it read, so the opus guard can read it back", async () => {
    const paths = cliPaths({ HOME: tempDir("home") });
    mkdirSync(paths.stateDir, { recursive: true });
    const printed: string[] = [];
    const original = console.log;
    console.log = (...parts: unknown[]) => {
      printed.push(parts.map(String).join(" "));
    };
    try {
      await runStatusline(paths, async () => JSON.stringify(input(87, 41)), NOW);
      expect(readUsageWindow(paths, NOW)).toEqual({ percent: 87, resetsAt: AT_13 });
      // An input with no rate_limits (an API key, or a refused request) records nothing.
      await runStatusline(paths, async () => JSON.stringify(input(null, null)), NOW + 1000);
      expect(readUsageWindow(paths, NOW + 1000)).toEqual({ percent: 87, resetsAt: AT_13 });
    } finally {
      console.log = original;
    }
    expect(printed).toEqual(["Opus 5.5 · ⚠ 5h 87% (resets 13:00) · 7d 41%", "Opus 5.5"]);
  });
});

describe("RV3: a record shows in the session it is about", () => {
  const record = (model: string, target: string) => ({
    lastAt: NOW - 60_000,
    model,
    resetsAt: AT_13,
    since: NOW - 600_000,
    target,
  });
  const breaker = {
    held: 1,
    lastAt: NOW - 60_000,
    since: NOW - 5 * 60_000,
    targets: [{ status: 429, target: "omniroute:glm", until: NOW + 60_000 }],
  };
  /** The machine's records, a profile's `team/…` records, and a profile's judge record. */
  const state: LimitState = {
    breakers: {
      "cc-smart-dev-kit-worker": breaker,
      "team/cc-smart-dev-kit-scout": breaker,
    },
    fallbacks: {
      "cc-smart-dev-kit-opus": record("claude-opus-5-5", "omniroute:machine-opus"),
      "team/cc-smart-dev-kit-fable": record("claude-fable-5-1", "omniroute:team-fable"),
      "team/cc-smart-dev-kit-judge": record("claude-sonnet-5", "omniroute:team-judge"),
    },
    limits: {
      "claude-fable-5-1": { claim: "five_hour", resetsAt: AT_13, seenAt: NOW - 1000 },
      "claude-opus-5-5": { claim: "five_hour", resetsAt: AT_13, seenAt: NOW - 1000 },
    },
    version: 1,
  };

  it("a profile's judge record is not shown either (the key is `<profile>/<slot>`)", () => {
    const text = statuslineText(input(null, null), state, NOW, "UTC", undefined, {
      gatewayOn: true,
      profile: "team",
    });
    expect(text).not.toContain("team-judge");
  });

  it("a session on the machine's URL shows the machine's records, not a profile's", () => {
    expect(
      statuslineText(input(null, null), state, NOW, "UTC", undefined, {
        gatewayOn: true,
        profile: null,
      }),
    ).toBe(
      "Opus 5.5 · ⚠ claude-opus-5-5 at its limit → omniroute:machine-opus until 13:00 · ⛔ claude-fable-5-1 at its plan limit until 13:00 · worker slot: every target limited since 09:55 → gateway slot worker <targets>",
    );
  });

  it("a session on a profile's URL shows that profile's records, not the machine's", () => {
    expect(
      statuslineText(input(null, null), state, NOW, "UTC", undefined, {
        gatewayOn: true,
        profile: "team",
      }),
    ).toBe(
      "Opus 5.5 · ⚠ claude-fable-5-1 at its limit → omniroute:team-fable until 13:00 · ⛔ claude-opus-5-5 at its plan limit until 13:00 · scout slot in profile team: every target limited since 09:55 → gateway profile team slot scout <targets>",
    );
  });

  it("a session off the gateway shows no fallback or breaker, only the plan limits it hits", () => {
    expect(
      statuslineText(input(null, null), state, NOW, "UTC", undefined, {
        gatewayOn: false,
        profile: null,
      }),
    ).toBe(
      "Opus 5.5 · ⛔ claude-fable-5-1 at its plan limit until 13:00 · ⛔ claude-opus-5-5 at its plan limit until 13:00",
    );
  });

  it("with no session to judge by (run by hand), every record the state file holds shows", () => {
    const text = statuslineText(input(null, null), state, NOW, "UTC");
    expect(text).toContain("omniroute:team-fable");
    expect(text).toContain("omniroute:machine-opus");
    expect(text).not.toContain("team-judge");
  });

  it("runStatusline reads the session's URL from the environment it is given", async () => {
    const home = tempDir("home");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(paths.stateDir, { recursive: true });
    mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
    mkdirSync(dirname(paths.gatewayStateFile), { recursive: true });
    writeFileSync(
      paths.gatewayConfigFile,
      JSON.stringify({
        aliases: {},
        anthropicBaseUrl: "https://api.anthropic.com",
        backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
        port: 20199,
        profiles: { team: { slots: { "cc-smart-dev-kit-fable": ["omniroute:team-fable"] } } },
        slots: { "cc-smart-dev-kit-opus": ["omniroute:machine-opus"] },
        timeouts: { firstByteMs: 60_000 },
        version: 1,
      }),
      { mode: 0o600 },
    );
    writeFileSync(paths.gatewayStateFile, JSON.stringify(state));
    const lines: string[] = [];
    const original = console.log;
    console.log = (...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    };
    try {
      const run = (url: string) =>
        runStatusline(paths, async () => JSON.stringify(input(null, null)), NOW, undefined, {
          ANTHROPIC_BASE_URL: url,
        });
      await run("http://127.0.0.1:20199/p/team");
      await run("http://127.0.0.1:20199");
      await run("https://api.anthropic.com");
      // No address in the environment says nothing about the gateway: the machine's records.
      await runStatusline(paths, async () => JSON.stringify(input(null, null)), NOW, undefined, {});
      // An empty address is Anthropic's own (what `sessionGatewayOf` and Claude Code read): off.
      await run("");
    } finally {
      console.log = original;
    }
    expect(lines[0]).toContain("omniroute:team-fable");
    expect(lines[0]).not.toContain("machine-opus");
    expect(lines[1]).toContain("omniroute:machine-opus");
    expect(lines[1]).not.toContain("team-fable");
    expect(lines[2]).not.toContain("omniroute:");
    expect(lines[3]).toContain("omniroute:machine-opus");
    expect(lines[3]).not.toContain("team-fable");
    expect(lines[4]).not.toContain("omniroute:");
  });
});

describe("auto mode's safety checks are failing (the owner, 2026-10-27)", () => {
  const down = (extra: Record<string, unknown> = {}) => ({
    claim: "five_hour",
    lastAt: NOW - 60_000,
    resetsAt: AT_13,
    since: NOW - 20 * 60_000,
    status: 429,
    why: "untested",
    ...extra,
  });
  const state = (checksDown: Record<string, unknown>): LimitState =>
    ({ checksDown, fallbacks: {}, limits: {}, version: 1 }) as LimitState;

  it("the machine's record: since when, Claude's reason with its reset, and the exact fix", () => {
    expect(
      statuslineText(input(null, null), state({ "cc-smart-dev-kit-judge": down() }), NOW, "UTC"),
    ).toBe(
      `Opus 5.5 · ⛔ auto mode's safety checks are failing since 09:40: Claude is at its plan limit (five_hour) until 13:00, and no worker target has passed the judge test → ${COMMAND} gateway setup`,
    );
  });

  it("the fix follows the cause: the switch turned off, and a stand-in that failed too (a wait)", () => {
    expect(
      statuslineText(
        input(null, null),
        state({
          "cc-smart-dev-kit-judge": down({ claim: null, resetsAt: null, status: 529, why: "off" }),
        }),
        NOW,
        "UTC",
      ),
    ).toBe(
      `Opus 5.5 · ⛔ auto mode's safety checks are failing since 09:40: Claude is down (HTTP 529), and the judge's stand-in is switched off → ${COMMAND} gateway fallback judge on`,
    );
    expect(
      statuslineText(
        input(null, null),
        state({ "cc-smart-dev-kit-judge": down({ status: 503, why: "failed" }) }),
        NOW,
        "UTC",
      ),
    ).toBe(
      "Opus 5.5 · ⛔ auto mode's safety checks are failing since 09:40: Claude is at its plan limit (five_hour) until 13:00, and the stand-in failed too (HTTP 503) → wait until 13:00",
    );
  });

  it("a record nobody touched for 15 minutes is stale: the line is gone with it", () => {
    expect(
      statuslineText(
        input(null, null),
        state({ "cc-smart-dev-kit-judge": down({ lastAt: NOW - 15 * 60_000 }) }),
        NOW,
        "UTC",
      ),
    ).toBe("Opus 5.5");
  });

  it("shows only in the session on its gateway scope: a profile's own record, never the machine's, and none off the gateway", () => {
    const both = state({
      "cc-smart-dev-kit-judge": down(),
      "team/cc-smart-dev-kit-judge": down({ claim: null, resetsAt: null, status: 529, why: "off" }),
    });
    const machine = statuslineText(input(null, null), both, NOW, "UTC", undefined, {
      gatewayOn: true,
      profile: null,
    });
    expect(machine).toContain("no worker target has passed the judge test");
    expect(machine).not.toContain("in profile team");
    const team = statuslineText(input(null, null), both, NOW, "UTC", undefined, {
      gatewayOn: true,
      profile: "team",
    });
    expect(team).toBe(
      `Opus 5.5 · ⛔ auto mode's safety checks are failing in profile team since 09:40: Claude is down (HTTP 529), and the judge's stand-in is switched off → ${COMMAND} gateway profile team fallback judge on`,
    );
    expect(
      statuslineText(input(null, null), both, NOW, "UTC", undefined, {
        gatewayOn: false,
        profile: null,
      }),
    ).toBe("Opus 5.5");
    // Run by hand, with no session to judge by: every record shows.
    const byHand = statuslineText(input(null, null), both, NOW, "UTC");
    expect(byHand).toContain("no worker target has passed the judge test");
    expect(byHand).toContain("in profile team");
  });

  it("sits before the usage numbers, and no record means no part", () => {
    expect(
      statuslineText(input(30, null), state({ "cc-smart-dev-kit-judge": down() }), NOW, "UTC"),
    ).toContain(`→ ${COMMAND} gateway setup · 5h 30%`);
    expect(statuslineText(input(30, null), EMPTY, NOW, "UTC")).toBe("Opus 5.5 · 5h 30%");
  });
});
