/**
 * Waiting out a limit (`wait.ts`, D42): which pause a stop records, the hold-off a re-pause
 * doubles, the exact lines, and when the watch may resume a paused crew session.
 *
 * Every fact is written by hand — the state file, the health answer, the record — so the test
 * says what the rule is, not what the code happens to compute.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emptyConfig, saveConfig } from "../gateway/config";
import type { HealthFetch } from "../gateway/health";
import { formatLimitState, type LimitState } from "../gateway/limit-state";
import { tempDir } from "../testing/temp";
import type { CrewRecord } from "./store";
import {
  FIRST_BACKOFF_MS,
  gatewayNow,
  healthNow,
  LIMIT_RESET_JITTER_MS,
  lastPauseOf,
  limitForStop,
  MAX_BACKOFF_MS,
  pauseBackoff,
  pauseStartedAt,
  pausesCrew,
  pauseText,
  RESUME_SPACING_MS,
  readWaitFacts,
  resumeText,
  routerAnsweredSince,
  type WaitFacts,
  waitFor,
  waitOver,
} from "./wait";

const NOW = Date.parse("2026-10-21T22:00:00.000Z");
const MINUTE = 60_000;

/** A paused crew record, with the fields these rules read. */
function paused(change: Partial<CrewRecord> = {}): CrewRecord {
  return {
    base: null,
    baseRef: "main",
    branch: "crew/B6b-portal-live",
    createdAt: "2026-10-21T20:00:00.000Z",
    effort: "high",
    files: [],
    id: "B6b-portal-live-1a2b3c",
    kind: "build",
    lastLine: null,
    leadName: "LEAD app master-plan",
    leadSessionId: "c00f9bb5-1111-2222-3333-444444444444",
    memoryMb: null,
    model: {
      named: "claude-sonnet-5-5",
      resolved: "claude-sonnet-5-5",
      slot: "cc-smart-dev-kit-worker",
      tier: null,
    },
    name: "C app B6b portal-live",
    permissionMode: "auto",
    phase: "B6b",
    plan: "master-plan",
    pr: null,
    questions: [],
    repo: "/home/user/my-app",
    reportPath: null,
    sessionId: "aaaa1111-2222-3333-4444-555555555555",
    shortId: "aaaa1111",
    slug: "portal-live",
    state: "paused",
    updatedAt: "2026-10-21T21:05:00.000Z",
    version: 1,
    waitsFor: [],
    waitingFor: {
      kind: "slot",
      since: "2026-10-21T21:05:00.000Z",
      slot: "cc-smart-dev-kit-worker",
    },
    worktree: "/home/user/my-app/.claude/worktrees/crew-B6b-portal-live",
    ...change,
  } as CrewRecord;
}

/** A breaker record for the worker slot, its one target resting until an hour from now. */
function breaker(sinceMs = Date.parse("2026-10-21T21:05:00.000Z")) {
  return {
    held: 3,
    lastAt: NOW - MINUTE,
    since: sinceMs,
    targets: [{ status: 429, target: "omniroute:glm-5.3-flash", until: NOW + 60 * MINUTE }],
  };
}

/** The facts one wait is judged by. */
function facts(change: Partial<WaitFacts> = {}): WaitFacts {
  return { breakers: {}, inUse: null, limits: {}, ...change };
}

describe("the errors that pause a crew session", () => {
  test("the plan's limit, an overloaded model and a server error; nothing else", () => {
    for (const error of ["rate_limit", "overloaded", "overloaded_error", "server_error"]) {
      expect(pausesCrew(error)).toBe(true);
    }
    for (const error of [null, "", "authentication_failed", "billing_error", "unknown"]) {
      expect(pausesCrew(error)).toBe(false);
    }
  });
});

describe("what a pause waits for, from the router's state file", () => {
  /** A limit state file, and its facts at `NOW`. */
  function state(change: Partial<LimitState>): WaitFacts {
    const file = join(tempDir("state"), "gateway-state.json");
    const value: LimitState = { fallbacks: {}, limits: {}, version: 1, ...change };
    writeFileSync(file, formatLimitState(value));
    // No gateway config: the chains are not known, and the pause reads the state file alone.
    return readWaitFacts(
      { gatewayConfigFile: join(dirname(file), "missing.json"), gatewayStateFile: file },
      NOW,
    );
  }

  test("the slot's own breaker comes first, with the time it opened", () => {
    const read = state({ breakers: { "cc-smart-dev-kit-worker": breaker() } });
    expect(waitFor(paused(), read, NOW)).toEqual({
      kind: "slot",
      since: "2026-10-21T21:05:00.000Z",
      slot: "cc-smart-dev-kit-worker",
    });
  });

  test("a breaker a stopped router left behind is stale: no slot wait", () => {
    const read = state({
      breakers: { "cc-smart-dev-kit-worker": { ...breaker(), lastAt: NOW - 16 * MINUTE } },
    });
    expect(read.breakers).toEqual({});
    expect(waitFor(paused(), read, NOW)).toEqual({
      kind: "unknown",
      since: "2026-10-21T22:00:00.000Z",
    });
  });

  test("Claude's own limit next: the session's model first, with its reset time", () => {
    const read = state({
      limits: {
        "claude-fable-5-1": { claim: "five_hour", resetsAt: 1_792_630_800, seenAt: NOW - MINUTE },
        "claude-sonnet-5-5": {
          claim: "seven_day_opus",
          resetsAt: 1_792_621_800,
          seenAt: NOW - 2 * MINUTE,
        },
      },
    });
    expect(waitFor(paused({ model: { ...paused().model, slot: null } }), read, NOW)).toEqual({
      kind: "claude-limit",
      model: "claude-sonnet-5-5",
      resetsAt: "2026-10-21T22:30:00.000Z",
    });
    // Without its own model at a limit: the freshest limit of a model whose family has a slot.
    const other = state({
      limits: {
        "claude-fable-5-1": { claim: "five_hour", resetsAt: null, seenAt: NOW - MINUTE },
        "claude-sonnet-5-5": { claim: "seven_day", resetsAt: null, seenAt: NOW - 2 * MINUTE },
      },
    });
    expect(
      waitFor(
        paused({ model: { ...paused().model, named: "haiku", resolved: "haiku", slot: null } }),
        other,
        NOW,
      ),
    ).toEqual({ kind: "claude-limit", model: "claude-fable-5-1", resetsAt: null });
  });

  test("no reset time named reads as null; nothing at all is unknown", () => {
    const read = state({
      limits: {
        "claude-sonnet-5-5": { claim: null, resetsAt: null, seenAt: NOW - MINUTE },
      },
    });
    expect(waitFor(paused({ model: { ...paused().model, slot: null } }), read, NOW)).toEqual({
      kind: "claude-limit",
      model: "claude-sonnet-5-5",
      resetsAt: null,
    });
    expect(waitFor(paused({ model: { ...paused().model, slot: null } }), state({}), NOW)).toEqual({
      kind: "unknown",
      since: "2026-10-21T22:00:00.000Z",
    });
  });

  test("a record with no slot never takes another session's breaker for its own", () => {
    const read = state({ breakers: { "cc-smart-dev-kit-worker": breaker() } });
    expect(waitFor(paused({ model: { ...paused().model, slot: null } }), read, NOW).kind).toBe(
      "unknown",
    );
  });
});

/**
 * A Claude model that is only a fallback in the slot's chain (2026-10-25): the worker slot ran
 * `omniroute:codex/gpt-6-luna → claude-sonnet-5-5`, one empty answer from Codex fell through to
 * Sonnet, and Sonnet's weekly limit paused two crew sessions until its reset days later, while
 * their own model answered again within seconds.
 */
describe("a Claude limit holds a session only when Claude answers its slot first", () => {
  const WORKER = "cc-smart-dev-kit-worker";
  const SONNET_LIMIT = {
    "claude-sonnet-5-5": { claim: "seven_day", resetsAt: 1_793_217_600, seenAt: NOW - MINUTE },
  };
  /** A crew session on the worker slot, as `crew start` records one. */
  const onWorker = paused({
    model: { named: WORKER, resolved: "omniroute:codex/gpt-6-luna", slot: WORKER, tier: null },
  });

  test("a backend-first chain: no claude-limit wait; it waits for its slot, from now", () => {
    const read = facts({
      inUse: { [WORKER]: ["omniroute:codex/gpt-6-luna", "claude-sonnet-5-5"] },
      limits: SONNET_LIMIT,
    });
    expect(waitFor(onWorker, read, NOW)).toEqual({
      kind: "slot",
      since: "2026-10-21T22:00:00.000Z",
      slot: WORKER,
    });
  });

  test("the chain is read from the gateway's config at the pause", () => {
    const home = tempDir("gateway");
    const configFile = join(home, "gateway.json");
    const stateFile = join(home, "gateway-state.json");
    saveConfig(configFile, {
      ...emptyConfig(),
      backends: { omniroute: { apiKey: "test-key", baseUrl: "http://127.0.0.1:47124" } },
      fallback: { [WORKER]: true },
      slots: { [WORKER]: ["omniroute:codex/gpt-6-luna", "claude-sonnet-5-5"] },
    });
    writeFileSync(stateFile, formatLimitState({ fallbacks: {}, limits: SONNET_LIMIT, version: 1 }));
    const read = readWaitFacts({ gatewayConfigFile: configFile, gatewayStateFile: stateFile }, NOW);
    expect(read.inUse).toEqual({ [WORKER]: ["omniroute:codex/gpt-6-luna", "claude-sonnet-5-5"] });
    expect(waitFor(onWorker, read, NOW).kind).toBe("slot");
  });

  test("a Claude-first chain keeps today's wait: the limit and its reset", () => {
    const read = facts({
      inUse: { [WORKER]: ["claude-sonnet-5-5[1m]", "omniroute:codex/gpt-6-luna"] },
      limits: SONNET_LIMIT,
    });
    expect(waitFor(onWorker, read, NOW)).toEqual({
      kind: "claude-limit",
      model: "claude-sonnet-5-5",
      resetsAt: "2026-10-28T20:00:00.000Z",
    });
  });

  test("a session on Claude itself (no slot) keeps today's wait", () => {
    const read = facts({
      inUse: { [WORKER]: ["omniroute:codex/gpt-6-luna", "claude-sonnet-5-5"] },
      limits: SONNET_LIMIT,
    });
    expect(waitFor(paused({ model: { ...paused().model, slot: null } }), read, NOW)).toEqual({
      kind: "claude-limit",
      model: "claude-sonnet-5-5",
      resetsAt: "2026-10-28T20:00:00.000Z",
    });
  });

  test("its line names the slot, never a reset date that does not hold it", () => {
    const read = facts({
      inUse: { [WORKER]: ["omniroute:codex/gpt-6-luna", "claude-sonnet-5-5"] },
      limits: SONNET_LIMIT,
    });
    expect(pauseText(waitFor(onWorker, read, NOW), "rate_limit", NOW, "UTC")).toBe(
      "worker slot limited since 22:00; goes on by itself when it answers",
    );
  });

  test("resumed after the backoff, while the Claude limit is still current", () => {
    const read = facts({
      inUse: { [WORKER]: ["omniroute:codex/gpt-6-luna", "claude-sonnet-5-5"] },
      limits: SONNET_LIMIT,
    });
    const first = paused({
      ...onWorker,
      lastPause: { backoffMs: 0, since: "2026-10-21T22:00:00.000Z" },
      waitingFor: waitFor(onWorker, read, NOW),
    });
    expect(waitOver(first, read, NOW)).toBe(true);
    const again = paused({
      ...first,
      lastPause: { backoffMs: FIRST_BACKOFF_MS, since: "2026-10-21T22:00:00.000Z" },
    });
    expect(waitOver(again, read, NOW + 4 * MINUTE)).toBe(false);
    expect(waitOver(again, read, NOW + 5 * MINUTE)).toBe(true);
  });

  test("a claude-limit wait an older kit recorded on such a chain goes on after the backoff too", () => {
    const stuck = paused({
      ...onWorker,
      lastPause: { backoffMs: 0, since: "2026-10-21T21:55:00.000Z" },
      waitingFor: {
        kind: "claude-limit",
        model: "claude-sonnet-5-5",
        resetsAt: "2026-10-28T20:00:00.000Z",
      },
    });
    const backendFirst = facts({
      inUse: { [WORKER]: ["omniroute:codex/gpt-6-luna", "claude-sonnet-5-5"] },
      limits: SONNET_LIMIT,
    });
    expect(waitOver(stuck, backendFirst, NOW)).toBe(true);
    // Its slot's breaker open on its first target holds it, as a slot wait is held.
    expect(
      waitOver(
        stuck,
        {
          ...backendFirst,
          breakers: {
            [WORKER]: {
              ...breaker(),
              targets: [
                { status: 502, target: "omniroute:codex/gpt-6-luna", until: NOW + 60 * MINUTE },
              ],
            },
          },
        },
        NOW,
      ),
    ).toBe(false);
    // The chain unknown, or Claude first: the limit holds it, as before.
    expect(waitOver(stuck, { ...backendFirst, inUse: null }, NOW)).toBe(false);
    expect(
      waitOver(
        stuck,
        {
          ...backendFirst,
          inUse: { [WORKER]: ["claude-sonnet-5-5", "omniroute:codex/gpt-6-luna"] },
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("the hold-off a pause carries", () => {
  test("the first pause waits for the gateway; a re-pause within 15 minutes waits 5, 10, 20", () => {
    expect(pauseBackoff(undefined, NOW)).toBe(0);
    const first = lastPauseOf(undefined, NOW);
    expect(first).toEqual({ backoffMs: 0, since: "2026-10-21T22:00:00.000Z" });
    const five = lastPauseOf(first, NOW + 10 * MINUTE);
    expect(five).toEqual({ backoffMs: FIRST_BACKOFF_MS, since: "2026-10-21T22:10:00.000Z" });
    const ten = lastPauseOf(five, NOW + 20 * MINUTE);
    expect(ten.backoffMs).toBe(2 * FIRST_BACKOFF_MS);
    const twenty = lastPauseOf(ten, NOW + 30 * MINUTE);
    expect(twenty.backoffMs).toBe(MAX_BACKOFF_MS);
    expect(lastPauseOf(twenty, NOW + 40 * MINUTE).backoffMs).toBe(MAX_BACKOFF_MS);
    // The same trouble after a quarter of an hour is a new one.
    expect(lastPauseOf(twenty, NOW + 30 * MINUTE + 16 * MINUTE).backoffMs).toBe(0);
    expect(
      pauseBackoff({ backoffMs: MAX_BACKOFF_MS, since: "2026-10-21T21:00:00.000Z" }, NOW),
    ).toBe(0);
  });

  test("the pause began at its lastPause, else its wait's since, else when the record changed", () => {
    expect(pauseStartedAt(paused())).toBe(Date.parse("2026-10-21T21:05:00.000Z"));
    expect(
      pauseStartedAt(paused({ lastPause: { backoffMs: 0, since: "2026-10-21T21:30:00.000Z" } })),
    ).toBe(Date.parse("2026-10-21T21:30:00.000Z"));
    expect(
      pauseStartedAt(
        paused({
          updatedAt: "2026-10-21T21:40:00.000Z",
          waitingFor: { kind: "claude-limit", model: "claude-opus-5-5", resetsAt: null },
        }),
      ),
    ).toBe(Date.parse("2026-10-21T21:40:00.000Z"));
  });
});

describe("the lines the person reads", () => {
  test("the pause line names what is limited, since when, and that it goes on by itself", () => {
    expect(
      pauseText(
        { kind: "slot", since: "2026-10-21T21:05:00.000Z", slot: "cc-smart-dev-kit-worker" },
        "rate_limit",
        NOW,
        "UTC",
      ),
    ).toBe("worker slot limited since 21:05; goes on by itself when it answers");
    expect(
      pauseText(
        {
          kind: "claude-limit",
          model: "claude-opus-5-5",
          resetsAt: "2026-10-21T19:40:00.000Z",
        },
        "rate_limit",
        NOW,
        "UTC",
      ),
    ).toBe(
      "claude-opus-5-5 is at its limit, resets 19:40; goes on by itself when it answers once the limit lifts",
    );
    expect(
      pauseText(
        { kind: "claude-limit", model: "claude-fable-5-1", resetsAt: null },
        "rate_limit",
        NOW,
        "UTC",
      ),
    ).toBe(
      "claude-fable-5-1 is at its limit, no reset time named; goes on by itself when it answers once the limit lifts",
    );
    expect(
      pauseText({ kind: "unknown", since: "2026-10-21T22:00:00.000Z" }, "server_error", NOW),
    ).toBe("it stopped on server_error; the watch goes on with it once a model answers");
    // An error word with a line break in it stays one line: the watch prints one line per change.
    expect(
      pauseText(
        { kind: "unknown", since: "2026-10-21T22:00:00.000Z" },
        "server_error\nand something else",
        NOW,
      ),
    ).toBe(
      "it stopped on server_error and something else; the watch goes on with it once a model answers",
    );
  });

  test("the resume text names what changed and the phase", () => {
    expect(
      resumeText(
        paused(),
        { kind: "slot", since: "2026-10-21T21:05:00.000Z", slot: "cc-smart-dev-kit-worker" },
        NOW,
      ),
    ).toBe(
      "The wait is over: worker answers again. Go on with phase B6b, then hand it back as usual.",
    );
    expect(
      resumeText(
        paused(),
        { kind: "claude-limit", model: "claude-opus-5-5", resetsAt: "2026-10-21T19:40:00.000Z" },
        NOW,
        "UTC",
      ),
    ).toBe(
      "The wait is over: Claude's limit reset at 19:40. Go on with phase B6b, then hand it back as usual.",
    );
    expect(resumeText(paused(), { kind: "unknown", since: "2026-10-21T21:05:00.000Z" }, NOW)).toBe(
      "The wait is over: a model answers again. Go on with phase B6b, then hand it back as usual.",
    );
  });
});

describe("when the watch may resume a paused crew session", () => {
  test("a slot: never while its breaker is open on the same first target", () => {
    const open = facts({
      breakers: { "cc-smart-dev-kit-worker": breaker() },
      inUse: { "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash"] },
    });
    expect(waitOver(paused(), open, NOW)).toBe(false);
    // The fallback switch off keeps only the first target.
    expect(waitOver(paused(), { ...open, inUse: null }, NOW)).toBe(false);
  });

  test("a slot: once the breaker closed, or the chain's first target changed", () => {
    expect(
      waitOver(
        paused(),
        facts({ inUse: { "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash"] } }),
        NOW,
      ),
    ).toBe(true);
    expect(
      waitOver(
        paused(),
        facts({
          breakers: { "cc-smart-dev-kit-worker": breaker() },
          inUse: {
            "cc-smart-dev-kit-worker": ["omniroute:other-model", "omniroute:glm-5.3-flash"],
          },
        }),
        NOW,
      ),
    ).toBe(true);
  });

  test("a Claude limit: never while it is current; after the reset, plus the jitter", () => {
    const waiting = {
      kind: "claude-limit" as const,
      model: "claude-opus-5-5",
      resetsAt: "2026-10-21T21:30:00.000Z",
    };
    const record = paused({ model: { ...paused().model, slot: null }, waitingFor: waiting });
    const current = facts({
      limits: {
        "claude-opus-5-5": { claim: "five_hour", resetsAt: 1_792_623_600, seenAt: NOW },
      },
    });
    expect(waitOver(record, current, NOW)).toBe(false);
    // The record is gone, but the reset time is still ahead.
    expect(waitOver(record, facts(), Date.parse("2026-10-21T21:29:00.000Z"))).toBe(false);
    expect(waitOver(record, facts(), Date.parse("2026-10-21T21:31:00.000Z"))).toBe(false);
    expect(
      waitOver(record, facts(), Date.parse("2026-10-21T21:30:00.000Z") + LIMIT_RESET_JITTER_MS),
    ).toBe(true);
  });

  test("a limit with no reset time: only the router dropping it frees the session", () => {
    const record = paused({
      model: { ...paused().model, slot: null },
      waitingFor: { kind: "claude-limit", model: "claude-opus-5-5", resetsAt: null },
    });
    expect(waitOver(record, facts(), NOW)).toBe(true);
    expect(
      waitOver(
        record,
        facts({
          limits: { "claude-opus-5-5": { claim: null, resetsAt: null, seenAt: NOW } },
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("an unknown wait: the hold-off, and no breaker or limit that explains it now", () => {
    const record = paused({ waitingFor: { kind: "unknown", since: "2026-10-21T21:55:00.000Z" } });
    expect(waitOver(record, facts(), NOW)).toBe(true);
    expect(
      waitOver(record, facts({ breakers: { "cc-smart-dev-kit-worker": breaker() } }), NOW),
    ).toBe(false);
    expect(
      waitOver(
        record,
        facts({
          limits: { "claude-sonnet-5-5": { claim: null, resetsAt: null, seenAt: NOW } },
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("the hold-off a re-pause carries is part of the wait, whatever the gateway says", () => {
    const record = paused({
      lastPause: { backoffMs: FIRST_BACKOFF_MS, since: "2026-10-21T22:00:00.000Z" },
    });
    expect(waitOver(record, facts(), NOW)).toBe(false);
    expect(waitOver(record, facts(), NOW + 4 * MINUTE)).toBe(false);
    expect(waitOver(record, facts(), NOW + 5 * MINUTE)).toBe(true);
  });

  test("a paused record a kit wrote without a wait is read as an unknown one from its change", () => {
    const record = paused({
      lastPause: { backoffMs: FIRST_BACKOFF_MS, since: "2026-10-21T21:58:00.000Z" },
      updatedAt: "2026-10-21T21:58:00.000Z",
      waitingFor: undefined,
    });
    expect(waitOver(record, facts(), NOW)).toBe(false);
    expect(waitOver(record, facts(), NOW + 3 * MINUTE)).toBe(true);
  });
});

describe("the router's own answer", () => {
  test("a request count that grew is an answer; no health page leaves the state file as the evidence", () => {
    const now = { breakers: {}, inUse: null, limits: {}, requests: 12 };
    expect(routerAnsweredSince(now, 11)).toBe(true);
    expect(routerAnsweredSince(now, 12)).toBe(false);
    expect(routerAnsweredSince({ ...now, requests: null }, 12)).toBe(true);
    expect(routerAnsweredSince(now, null)).toBe(true);
  });

  test("the health answer: its breakers are the live truth, and a page that is not this router's says nothing", () => {
    expect(
      healthNow(
        {
          breakers: {
            "cc-smart-dev-kit-worker": { held: 2, since: 1_700_000_000_000, targets: [] },
          },
          ok: true,
          requests: 7,
        },
        NOW,
      ),
    ).toEqual({
      breakers: {
        "cc-smart-dev-kit-worker": { held: 2, lastAt: NOW, since: 1_700_000_000_000, targets: [] },
      },
      requests: 7,
    });
    expect(healthNow({ ok: false, requests: 7 }, NOW)).toBeNull();
    expect(healthNow("not json", NOW)).toBeNull();
  });

  test("gatewayNow: the state file, the chains in use, and the live page when it answers", async () => {
    const home = tempDir("gateway");
    const configFile = join(home, "gateway.json");
    const stateFile = join(home, "gateway-state.json");
    const config = emptyConfig();
    saveConfig(configFile, {
      ...config,
      backends: { omniroute: { apiKey: "test-key", baseUrl: "http://127.0.0.1:47124" } },
      fallback: { "cc-smart-dev-kit-worker": false },
      port: 47123,
      slots: {
        "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash", "omniroute:other-model"],
      },
    });
    writeFileSync(
      stateFile,
      formatLimitState({
        breakers: { "cc-smart-dev-kit-worker": breaker() },
        fallbacks: {},
        limits: {},
        version: 1,
      }),
    );
    const asked: string[] = [];
    const fetchImpl: HealthFetch = async (url) => {
      asked.push(url);
      return Response.json({
        breakers: { "cc-smart-dev-kit-worker": { held: 5, since: 1, targets: [] } },
        ok: true,
        requests: 9,
      });
    };
    const now = await gatewayNow(
      { gatewayConfigFile: configFile, gatewayStateFile: stateFile },
      NOW,
      fetchImpl,
    );
    expect(asked).toEqual(["http://127.0.0.1:47123/__cc-smart-dev-kit/health"]);
    expect(now.requests).toBe(9);
    expect(now.breakers["cc-smart-dev-kit-worker"]?.held).toBe(5);
    // The fallback switch is off: only the first target is in use.
    expect(now.inUse).toEqual({ "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash"] });

    // No config: no chain, no port, no page — the state file alone.
    const stateOnly = await gatewayNow(
      { gatewayConfigFile: join(home, "missing.json"), gatewayStateFile: stateFile },
      NOW,
      fetchImpl,
    );
    expect(stateOnly).toMatchObject({ inUse: null, requests: null });
    expect(stateOnly.breakers["cc-smart-dev-kit-worker"]?.held).toBe(3);
  });
});

describe("the limit that explains a stop", () => {
  test("the session's own model, else the freshest limit of a model whose family has a slot", () => {
    const limits = {
      "claude-sonnet-5-5": { claim: null, resetsAt: null, seenAt: NOW - 3 * MINUTE },
      "claude-opus-5-5": { claim: null, resetsAt: null, seenAt: NOW - MINUTE },
      "some-other-model": { claim: null, resetsAt: null, seenAt: NOW },
    };
    expect(limitForStop(paused(), limits)?.[0]).toBe("claude-sonnet-5-5");
    expect(
      limitForStop(
        paused({ model: { ...paused().model, named: "haiku", resolved: "haiku" } }),
        limits,
      )?.[0],
    ).toBe("claude-opus-5-5");
  });

  test("the spacing the watch keeps between two resumes", () => {
    expect(RESUME_SPACING_MS).toBe(30_000);
  });
});
