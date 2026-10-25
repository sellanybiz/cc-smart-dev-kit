/**
 * SL1: the status line's context segment and its reasoning effort (`statusline-context.ts`).
 */
import { describe, expect, it } from "bun:test";
import { parseConfig } from "../gateway/config";
import type { LimitState } from "../gateway/limit-state";
import {
  contextSegment,
  contextUseOf,
  effortOf,
  formatTokens,
  pinnedEffortOf,
} from "./statusline-context";

const NOW = Date.UTC(2026, 9, 25, 10, 0, 0);

/** The context part of a status line input as Claude Code 2.1.310 passes it. */
function input(tokens: unknown, size: unknown = 1_000_000, pct: unknown = null) {
  return {
    context_window: {
      context_window_size: size,
      total_input_tokens: tokens,
      used_percentage: pct,
    },
    model: { id: "claude-opus-5-5" },
  };
}

describe("formatTokens", () => {
  it("thousands as k, millions as M with one decimal when needed", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(15_500)).toBe("16k");
    expect(formatTokens(312_000)).toBe("312k");
    expect(formatTokens(400_000)).toBe("400k");
    expect(formatTokens(999_600)).toBe("1M");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
});

describe("contextUseOf", () => {
  it("the tokens and the window Claude Code reports", () => {
    expect(contextUseOf(input(312_000, 1_000_000))).toEqual({ size: 1_000_000, tokens: 312_000 });
  });

  it("no tokens but a percentage: the tokens come from it", () => {
    expect(contextUseOf(input(undefined, 200_000, 8))).toEqual({ size: 200_000, tokens: 16_000 });
  });

  it("no context data: nothing", () => {
    expect(contextUseOf({ model: { id: "x" } })).toBeNull();
    expect(contextUseOf(input(null, 1_000_000, null))).toBeNull();
    expect(contextUseOf({ context_window: "nope" })).toBeNull();
    expect(contextUseOf("not an object")).toBeNull();
    expect(contextUseOf(input(-5))).toBeNull();
  });

  it("no usable window: the tokens alone", () => {
    expect(contextUseOf(input(5000, null))).toEqual({ size: null, tokens: 5000 });
    expect(contextUseOf(input(5000, 0))).toEqual({ size: null, tokens: 5000 });
  });
});

describe("contextSegment", () => {
  it("measured against the model's window when no compaction window is set", () => {
    expect(contextSegment({ size: 1_000_000, tokens: 312_000 }, null, null, 85)).toBe(
      "ctx 312k · 31% of 1M",
    );
  });

  it("measured against the compaction window when it is the smaller", () => {
    expect(contextSegment({ size: 1_000_000, tokens: 312_000 }, 400_000, null, 85)).toBe(
      "ctx 312k · 78% of 400k",
    );
  });

  it("a compaction window above the model's window is held at the model's", () => {
    expect(contextSegment({ size: 200_000, tokens: 100_000 }, 400_000, null, 85)).toBe(
      "ctx 100k · 50% of 200k",
    );
  });

  it("warns from the warning share", () => {
    expect(contextSegment({ size: 1_000_000, tokens: 340_000 }, 400_000, null, 85)).toBe(
      "⚠ ctx 340k · 85% of 400k",
    );
    expect(contextSegment({ size: 1_000_000, tokens: 336_000 }, 400_000, null, 85)).toBe(
      "ctx 336k · 84% of 400k",
    );
  });

  it("the effort goes beside the tokens", () => {
    expect(contextSegment({ size: 1_000_000, tokens: 312_000 }, 400_000, "xhigh", 85)).toBe(
      "ctx 312k · 78% of 400k · xhigh",
    );
  });

  it("past the window, the share goes over 100", () => {
    expect(contextSegment({ size: 1_000_000, tokens: 450_000 }, 400_000, null, 85)).toBe(
      "⚠ ctx 450k · 113% of 400k",
    );
  });

  it("no window at all: the tokens alone", () => {
    expect(contextSegment({ size: null, tokens: 5000 }, null, null, 85)).toBe("ctx 5k");
  });

  it("no context data: no segment, an effort or not", () => {
    expect(contextSegment(null, 400_000, "high", 85)).toBeNull();
    expect(contextSegment(null, null, null, 85)).toBeNull();
  });
});

describe("effortOf", () => {
  it("is the level Claude Code reports for this refresh", () => {
    expect(effortOf({ effort: { level: "xhigh" } })).toBe("xhigh");
    expect(effortOf({ effort: { level: "low" } })).toBe("low");
  });

  it("is nothing when the input has none, or an odd one", () => {
    expect(effortOf({})).toBeNull();
    expect(effortOf({ effort: {} })).toBeNull();
    expect(effortOf({ effort: { level: "" } })).toBeNull();
    expect(effortOf({ effort: { level: 3 } })).toBeNull();
    expect(effortOf({ effort: "high" })).toBeNull();
    expect(effortOf(null)).toBeNull();
  });
});

describe("pinnedEffortOf: the effort the slot's backend target really answers with (D64)", () => {
  const parsed = parseConfig({
    aliases: {},
    backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:20128" } },
    effort: {
      "cc-smart-dev-kit-opus": { "omniroute:glm-5.3": "xhigh" },
      "cc-smart-dev-kit-worker": { "omniroute:glm-5.3-flash": "none" },
    },
    fallback: { "cc-smart-dev-kit-opus": true },
    slots: {
      "cc-smart-dev-kit-opus": ["omniroute:glm-5.3", "omniroute:kimi"],
      "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash"],
    },
    version: 1,
  });
  if (!("config" in parsed)) throw new Error(parsed.error);
  const config = parsed.config;
  const empty: LimitState = { fallbacks: {}, limits: {}, version: 1 };

  it("a Claude id whose family slot's first target is pinned: the pin", () => {
    expect(pinnedEffortOf(config, "claude-opus-5-5", null, null, NOW)).toBe("xhigh");
    expect(pinnedEffortOf(config, "claude-opus-5-5[1m]", empty, null, NOW)).toBe("xhigh");
  });

  it("a pin to none is the pin", () => {
    expect(pinnedEffortOf(config, "claude-sonnet-5-5", null, null, NOW)).toBe("none");
  });

  it("the slot key itself, as Claude Code sends it under the gateway", () => {
    expect(pinnedEffortOf(config, "cc-smart-dev-kit-opus", null, null, NOW)).toBe("xhigh");
  });

  it("a slot with no pin, a slot with no chain and a non-Claude name: nothing", () => {
    expect(pinnedEffortOf(config, "claude-haiku-5-5", null, null, NOW)).toBeNull();
    expect(pinnedEffortOf(config, "claude-fable-5-1", null, null, NOW)).toBeNull();
    expect(pinnedEffortOf(config, "glm-5.3", null, null, NOW)).toBeNull();
  });

  it("no config, no model: nothing", () => {
    expect(pinnedEffortOf(null, "claude-opus-5-5", null, null, NOW)).toBeNull();
    expect(pinnedEffortOf(config, null, null, null, NOW)).toBeNull();
  });

  it("a slot answering from its next target (a fallback record): that target's pin, or none", () => {
    const fallen: LimitState = {
      fallbacks: {
        "cc-smart-dev-kit-opus": {
          lastAt: NOW - 1000,
          model: "claude-opus-5-5",
          resetsAt: null,
          since: NOW - 1000,
          target: "omniroute:kimi",
        },
      },
      limits: {},
      version: 1,
    };
    // `kimi` has no pin: the session's own effort stands.
    expect(pinnedEffortOf(config, "claude-opus-5-5", fallen, null, NOW)).toBeNull();
  });

  it("a record of another chain does not move the answer", () => {
    const other: LimitState = {
      fallbacks: {
        "team/cc-smart-dev-kit-opus": {
          lastAt: NOW - 1000,
          model: "claude-opus-5-5",
          resetsAt: null,
          since: NOW - 1000,
          target: "omniroute:kimi",
        },
      },
      limits: {},
      version: 1,
    };
    expect(pinnedEffortOf(config, "claude-opus-5-5", other, null, NOW)).toBe("xhigh");
    expect(pinnedEffortOf(config, "claude-opus-5-5", other, "team", NOW)).toBeNull();
  });
});
