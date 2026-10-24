/**
 * The breaker's pure parts (`breaker.ts`) and how a backend's refusal is relayed
 * (`refusal.ts`). The router's behaviour with them is in `gateway.test.ts` › "the breaker".
 * Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import {
  BREAKER_MAX_HELD,
  breakerAnswer,
  breakerChangeCommand,
  breakerChangeHint,
  breakerMessage,
  breakerStatusLines,
  capRetryAfter,
  clientRetryAfter,
  describeFailures,
  earliestRestSeconds,
  formatDuration,
  isCapacityFailure,
  slotShortName,
} from "./breaker";
import { backendRefusal, isLengthRefusal, isRefusalStatus, REFUSAL_STATUS } from "./refusal";

const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);

describe("which failures count as a want of capacity", () => {
  it("408, 429, the 5xx that mean down or busy, 529, and no status at all", () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
      expect(isCapacityFailure(status)).toBe(true);
    }
    expect(isCapacityFailure(null)).toBe(true);
  });

  it("not a refusal, a missing key, or a stream that opened with 200", () => {
    for (const status of [200, 400, 401, 403, 404, 413, 422]) {
      expect(isCapacityFailure(status)).toBe(false);
    }
  });
});

describe("the retry-after Claude Code accepts", () => {
  it("is capped at 60: above it Claude Code ends the request at once", () => {
    expect(capRetryAfter(66)).toBe(60);
    expect(capRetryAfter(60)).toBe(60);
    expect(capRetryAfter(45)).toBe(45);
    expect(capRetryAfter(0)).toBe(0);
  });

  it("is 30 when no rest is known, and between 1 and 60 otherwise", () => {
    expect(clientRetryAfter(null)).toBe(30);
    expect(clientRetryAfter(0)).toBe(1);
    expect(clientRetryAfter(0.2)).toBe(1);
    expect(clientRetryAfter(20)).toBe(20);
    expect(clientRetryAfter(20.1)).toBe(21);
    expect(clientRetryAfter(61)).toBe(60);
    expect(clientRetryAfter(600)).toBe(60);
  });

  it("at most 64 requests are held per slot", () => {
    expect(BREAKER_MAX_HELD).toBe(64);
  });
});

describe("what the breaker tells a person to change (RV3: a command that exists, for the chain that fails)", () => {
  it("the machine's chain: gateway slot", () => {
    expect(breakerChangeHint("cc-smart-dev-kit-worker")).toBe(
      "cc-smart-dev-kit gateway slot worker <targets>",
    );
    expect(breakerChangeCommand("cc-smart-dev-kit-worker", null)).toBe(
      "gateway slot worker <targets>",
    );
  });

  it("a profile's own chain: gateway profile <name> slot, never a hand edit of gateway.json", () => {
    expect(breakerChangeHint("cc-smart-dev-kit-worker", "my-project")).toBe(
      "cc-smart-dev-kit gateway profile my-project slot worker <targets>",
    );
    expect(breakerChangeCommand("cc-smart-dev-kit-worker", "my-project")).toBe(
      "gateway profile my-project slot worker <targets>",
    );
  });

  it("a profile with no chain of its own uses the machine's: both commands, each said what it changes", () => {
    expect(breakerChangeHint("cc-smart-dev-kit-worker", "my-project", true)).toBe(
      "cc-smart-dev-kit gateway profile my-project slot worker <targets> (a chain of its own for this profile), or cc-smart-dev-kit gateway slot worker <targets> (the machine's chain, which this profile uses)",
    );
  });

  it("the answer's message carries it, for a profile that inherits the chain too", () => {
    expect(
      breakerMessage("cc-smart-dev-kit-worker", NOW, [], NOW, "my-project", true).endsWith(
        "change it: cc-smart-dev-kit gateway profile my-project slot worker <targets> (a chain of its own for this profile), or cc-smart-dev-kit gateway slot worker <targets> (the machine's chain, which this profile uses)",
      ),
    ).toBe(true);
  });
});

describe("the breaker's answer", () => {
  const failures = [
    { reason: "HTTP 429", status: 429, target: "omniroute:a", until: NOW + 120_000 },
    {
      reason: "no event in time (only heartbeats)",
      status: null,
      target: "ollama:b",
      until: NOW + 30_000,
    },
  ];

  it("names the slot, when it began, each target's reason and rest, and the command", () => {
    const text = breakerMessage("cc-smart-dev-kit-worker", NOW - 60_000, failures, NOW);
    expect(text).toMatch(
      /^cc-smart-dev-kit-router: every target of cc-smart-dev-kit-worker is limited or down since \d\d:\d\d \(omniroute:a: HTTP 429, until \d\d:\d\d; ollama:b: no event in time \(only heartbeats\), until \d\d:\d\d\); change it: cc-smart-dev-kit gateway slot worker <targets>$/,
    );
    expect(describeFailures(failures, NOW)).toMatch(/^omniroute:a: HTTP 429, until \d\d:\d\d; /);
  });

  it("is a 429 rate_limit_error with the earliest rest as retry-after, and never a quota header", async () => {
    const res = breakerAnswer({
      failures,
      nowMs: NOW,
      sinceMs: NOW,
      slot: "cc-smart-dev-kit-worker",
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("x-should-retry")).toBe("true");
    expect([...res.headers.keys()].sort()).toEqual([
      "content-type",
      "retry-after",
      "x-should-retry",
    ]);
    const body = (await res.json()) as { error: { type: string }; type: string };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("rate_limit_error");
  });

  it("clamps a long rest to 60, and says 30 when it knows none", () => {
    const far = [{ reason: "HTTP 429", status: 429, target: "a:b", until: NOW + 600_000 }];
    expect(
      breakerAnswer({ failures: far, nowMs: NOW, sinceMs: NOW, slot: "s" }).headers.get(
        "retry-after",
      ),
    ).toBe("60");
    expect(
      breakerAnswer({ failures: [], nowMs: NOW, sinceMs: NOW, slot: "s" }).headers.get(
        "retry-after",
      ),
    ).toBe("30");
    expect(earliestRestSeconds([], NOW)).toBeNull();
    expect(earliestRestSeconds(far, NOW)).toBe(600);
  });

  it("a given retry-after and message replace the usual ones", async () => {
    const res = breakerAnswer({
      failures,
      message: "stopping",
      nowMs: NOW,
      retryAfterSec: 5,
      sinceMs: NOW,
      slot: "s",
    });
    expect(res.headers.get("retry-after")).toBe("5");
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("stopping");
  });

  it("a slot's short name is what a person types", () => {
    expect(slotShortName("cc-smart-dev-kit-worker")).toBe("worker");
    expect(slotShortName("custom")).toBe("custom");
  });

  it("a duration reads as seconds, minutes, or hours and minutes", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(7 * 60_000)).toBe("7m");
    expect(formatDuration(72 * 60_000)).toBe("1h12m");
    expect(formatDuration(2 * 3_600_000)).toBe("2h");
  });
});

describe("the lines of `gateway status`", () => {
  it("one line per breaker, with each target; anything else in the page is ignored", () => {
    const lines = breakerStatusLines(
      {
        "cc-smart-dev-kit-worker": {
          held: 3,
          since: NOW,
          targets: [
            { status: 429, target: "omniroute:a", until: NOW + 60_000 },
            { status: null, target: "ollama:b", until: NOW + 30_000 },
            "not a target",
          ],
        },
        broken: "not a breaker",
      },
      NOW,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^ {2}cc-smart-dev-kit-worker: all targets limited, holding requests since \d\d:\d\d \(omniroute:a 429 until \d\d:\d\d; ollama:b no answer until \d\d:\d\d\)$/,
    );
    expect(breakerStatusLines(undefined, NOW)).toEqual([]);
    expect(breakerStatusLines([], NOW)).toEqual([]);
  });
});

describe("a backend's refusal, relayed so Claude Code does not send it again", () => {
  it("only a 400 or 422 needs it", () => {
    expect(isRefusalStatus(400)).toBe(true);
    expect(isRefusalStatus(422)).toBe(true);
    expect(isRefusalStatus(404)).toBe(false);
    expect(isRefusalStatus(429)).toBe(false);
  });

  it("a refusal for the conversation's length is Claude Code's own 'prompt is too long'", async () => {
    for (const reason of [
      "Input exceeds context window of 202752 tokens",
      "This model's maximum context length is 131072 tokens",
      "prompt too long",
      "request too large for this model",
      "token limit exceeded",
    ]) {
      expect(isLengthRefusal(reason)).toBe(true);
    }
    const res = backendRefusal("omniroute:a", 400, "Input exceeds context window");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /^prompt is too long: omniroute:a refused this conversation/,
    );
  });

  it("any other refusal is a 424, which Claude Code shows once and does not send again", async () => {
    for (const reason of [
      "tool_choice is not supported here",
      "context_management: Extra inputs are not permitted",
      "(no body)",
    ]) {
      expect(isLengthRefusal(reason)).toBe(false);
    }
    const res = backendRefusal("omniroute:a", 422, "bad field");
    expect(res.status).toBe(REFUSAL_STATUS);
    expect(REFUSAL_STATUS).toBe(424);
    expect(res.headers.get("x-should-retry")).toBe("false");
    expect(await res.json()).toEqual({
      error: {
        message: "cc-smart-dev-kit-router: omniroute:a refused this request (HTTP 422): bad field",
        type: "invalid_request_error",
      },
      type: "error",
    });
  });
});
