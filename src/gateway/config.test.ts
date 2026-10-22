/**
 * The gateway config's breaker keys (`breaker`, `timeouts.breakerHoldMs`): how they parse, their
 * defaults, and what a config written before they existed does. The router's side of the
 * breaker is tested with the router; this file is the contract it reads.
 *
 * Every file goes into tempDir(). Expected values by hand.
 */
import { describe, expect, it } from "bun:test";
import { chmodSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  BREAKER_HOLD_CEILING_MS,
  BREAKER_HOLD_NON_STREAMING_MS,
  breakerHoldMs,
  breakerOn,
  breakerWords,
  JUDGE_NEVER_HOLDS,
  loadConfigFile,
  parseConfig,
  saveConfig,
  watchConfig,
} from "./config";

const WORKER = "cc-smart-dev-kit-worker";
const SCOUT = "cc-smart-dev-kit-scout";
const OPUS = "cc-smart-dev-kit-opus";
const FABLE = "cc-smart-dev-kit-fable";
const JUDGE = "cc-smart-dev-kit-judge";

/** A config as a machine has it, with a chain in four slots and none of the breaker's keys. */
function raw(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128/" } },
    slots: {
      [FABLE]: ["omniroute:m1"],
      [OPUS]: ["omniroute:m1"],
      [SCOUT]: ["omniroute:m1", "omniroute:m2"],
      [WORKER]: ["omniroute:m1"],
    },
    version: 1,
    ...extra,
  };
}

/** The config the text parses to, or the test fails with the error. */
function parsed(text: Record<string, unknown>) {
  const result = parseConfig(text);
  if ("error" in result) throw new Error(result.error);
  return result.config;
}

describe("the numbers", () => {
  it("a streaming request is held 240 s at most, a request that does not stream 60 s", () => {
    expect(BREAKER_HOLD_CEILING_MS).toBe(240_000);
    expect(BREAKER_HOLD_NON_STREAMING_MS).toBe(60_000);
  });
});

describe("a config written before the breaker", () => {
  const OLD = {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128/" } },
    fallback: { [OPUS]: true },
    futureField: { level: 3 },
    port: 21111,
    slots: { [OPUS]: ["omniroute:m1", "omniroute:m2"], [SCOUT]: ["omniroute:m1"] },
    timeouts: { firstByteMs: 5000, idleMs: 9000 },
    version: 1,
  };

  it("parses to what it parsed to before: no breaker key appears, nothing else moves", () => {
    expect(parseConfig(OLD)).toStrictEqual({
      config: {
        aliases: {},
        anthropicBaseUrl: "https://api.anthropic.com",
        // The one change the parse makes to it is the old one: the trailing slash goes.
        backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
        fallback: { [OPUS]: true },
        futureField: { level: 3 },
        port: 21111,
        slots: { [OPUS]: ["omniroute:m1", "omniroute:m2"], [SCOUT]: ["omniroute:m1"] },
        timeouts: { firstByteMs: 5000, idleMs: 9000 },
        version: 1,
      },
    });
  });

  it("keeps the breaker on and the hold at its ceiling, by the defaults", () => {
    const config = parsed(OLD);
    expect(breakerOn(config, SCOUT)).toBe(true);
    expect(breakerOn(config, OPUS)).toBe(true);
    expect(breakerHoldMs(config)).toBe(240_000);
  });

  it("saved by a command, it gains no breaker key either", () => {
    const path = join(tempDir("gateway-config"), "gateway.json");
    writeFileSync(path, JSON.stringify(OLD), { mode: 0o600 });
    chmodSync(path, 0o600);
    saveConfig(path, loadConfigFile(path));
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(saved).sort()).toEqual([
      "aliases",
      "anthropicBaseUrl",
      "backends",
      "fallback",
      "futureField",
      "port",
      "slots",
      "timeouts",
      "version",
    ]);
    expect(saved.timeouts).toEqual({ firstByteMs: 5000, idleMs: 9000 });
  });
});

describe("the breaker switch", () => {
  it("is on for scout, worker, opus, fable and a machine's own slot when nothing is set", () => {
    const config = parsed(raw());
    for (const slot of [SCOUT, WORKER, OPUS, FABLE, "cc-smart-dev-kit-mine"]) {
      expect(breakerOn(config, slot)).toBe(true);
    }
  });

  it("is never on for the judge, with a setting or without one", () => {
    expect(breakerOn(parsed(raw()), JUDGE)).toBe(false);
    // The schema refuses an entry for it; a config built by hand and not parsed still holds nothing.
    expect(breakerOn({ breaker: { [JUDGE]: true } }, JUDGE)).toBe(false);
  });

  it("reads the person's setting, slot by slot, the way the fallback switch is read", () => {
    const config = parsed(raw({ breaker: { [WORKER]: false, [OPUS]: true } }));
    expect(config.breaker).toEqual({ [OPUS]: true, [WORKER]: false });
    expect(breakerOn(config, WORKER)).toBe(false);
    expect(breakerOn(config, OPUS)).toBe(true);
    // A slot without an entry keeps the default.
    expect(breakerOn(config, SCOUT)).toBe(true);
    expect(breakerOn(config, FABLE)).toBe(true);
  });

  it("is said in two words, and not at all for the judge", () => {
    const config = parsed(raw({ breaker: { [WORKER]: false } }));
    expect(breakerWords(config, WORKER)).toBe("breaker off");
    expect(breakerWords(config, SCOUT)).toBe("breaker on");
    expect(breakerWords(config, JUDGE)).toBeNull();
  });

  it("refuses an entry for the judge, in words that say why", () => {
    const withChain = parseConfig(
      raw({
        breaker: { [JUDGE]: true },
        slots: { [JUDGE]: ["omniroute:m1"], [WORKER]: ["omniroute:m1"] },
      }),
    );
    expect(withChain).toEqual({
      error: [
        "✖ breaker names cc-smart-dev-kit-judge: the judge never holds a request (a held safety check would freeze every action in auto mode), so it has no breaker switch",
        '  → at breaker["cc-smart-dev-kit-judge"]',
      ].join("\n"),
    });
    // The same words when the judge has no chain: the judge is the reason, not the chain.
    const noChain = parseConfig(raw({ breaker: { [JUDGE]: false } }));
    expect("error" in noChain && noChain.error).toContain(
      `breaker names ${JUDGE}: ${JUDGE_NEVER_HOLDS}`,
    );
  });

  it("refuses an entry for a slot with no chain, like the fallback switch does", () => {
    const config = raw({ breaker: { "cc-smart-dev-kit-nothing": false } });
    expect(parseConfig(config)).toEqual({
      error: [
        '✖ breaker names slot "cc-smart-dev-kit-nothing", which is not in slots (a slot with no chain has no request to hold)',
        '  → at breaker["cc-smart-dev-kit-nothing"]',
      ].join("\n"),
    });
  });

  it("refuses a value that is not true or false", () => {
    expect(parseConfig(raw({ breaker: { [WORKER]: "off" } }))).toEqual({
      error: [
        "✖ Invalid input: expected boolean, received string",
        '  → at breaker["cc-smart-dev-kit-worker"]',
      ].join("\n"),
    });
  });
});

describe("timeouts.breakerHoldMs", () => {
  it("is the ceiling when the config does not say", () => {
    expect(breakerHoldMs(parsed(raw()))).toBe(240_000);
    expect(breakerHoldMs(parsed(raw({ timeouts: { firstByteMs: 30_000 } })))).toBe(240_000);
  });

  it("takes any whole number of milliseconds up to the ceiling, 0 and the ceiling included", () => {
    for (const value of [0, 1, 90_000, 239_999, 240_000]) {
      const config = parsed(raw({ timeouts: { breakerHoldMs: value } }));
      // 0 means no hold: it is a setting, not a missing one.
      expect(breakerHoldMs(config)).toBe(value);
    }
  });

  it("refuses a value above the ceiling, and the message names the ceiling", () => {
    expect(parseConfig(raw({ timeouts: { breakerHoldMs: 240_001 } }))).toEqual({
      error: [
        "✖ too long: at most 240000 ms (240 s), because a longer hold risks Claude Code giving up on the request",
        "  → at timeouts.breakerHoldMs",
      ].join("\n"),
    });
    expect("error" in parseConfig(raw({ timeouts: { breakerHoldMs: 3_600_000 } }))).toBe(true);
  });

  it("refuses a negative number, a fraction and a word", () => {
    expect(parseConfig(raw({ timeouts: { breakerHoldMs: -1 } }))).toEqual({
      error: "✖ Too small: expected number to be >=0\n  → at timeouts.breakerHoldMs",
    });
    expect(parseConfig(raw({ timeouts: { breakerHoldMs: 1.5 } }))).toEqual({
      error: "✖ Invalid input: expected int, received number\n  → at timeouts.breakerHoldMs",
    });
    expect(parseConfig(raw({ timeouts: { breakerHoldMs: "240" } }))).toEqual({
      error: "✖ Invalid input: expected number, received string\n  → at timeouts.breakerHoldMs",
    });
  });

  it("sits beside the other timeouts, and a key this version does not know stays", () => {
    const config = parsed(raw({ timeouts: { breakerHoldMs: 10_000, idleMs: 9000 } }));
    expect(config.timeouts).toStrictEqual({
      breakerHoldMs: 10_000,
      firstByteMs: 60_000,
      idleMs: 9000,
    });
  });
});

describe("a file with a bad breaker key", () => {
  it("is refused with the ceiling in the error, and the router keeps the last good config", () => {
    const dir = tempDir("gateway-config");
    const path = join(dir, "gateway.json");
    const write = (text: string, mtimeSec: number) => {
      writeFileSync(path, text, { mode: 0o600 });
      chmodSync(path, 0o600);
      utimesSync(path, mtimeSec, mtimeSec);
    };
    const logs: string[] = [];
    write(JSON.stringify(raw({ timeouts: { breakerHoldMs: 90_000 } })), 1000);
    const source = watchConfig(path, (line) => logs.push(line));
    expect(breakerHoldMs(source.get())).toBe(90_000);

    // 300 s is above the ceiling: the edit is refused, and 90 s stays in force.
    write(JSON.stringify(raw({ timeouts: { breakerHoldMs: 300_000 } })), 2000);
    expect(breakerHoldMs(source.get())).toBe(90_000);
    expect(breakerHoldMs(source.get())).toBe(90_000);
    const errors = logs.filter((line) => line.startsWith("ERROR"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("at most 240000 ms (240 s)");
    expect(errors[0]).toContain("keeping the last good config");

    // A fixed edit takes over.
    write(JSON.stringify(raw({ timeouts: { breakerHoldMs: 0 } })), 3000);
    expect(breakerHoldMs(source.get())).toBe(0);
  });

  it("is refused when it is not JSON, and the file's text is not quoted back", () => {
    const path = join(tempDir("gateway-config"), "gateway.json");
    writeFileSync(path, '{"breaker": {"cc-smart-dev-kit-worker": nope}', { mode: 0o600 });
    chmodSync(path, 0o600);
    expect(() => loadConfigFile(path)).toThrow(`${path} is not valid JSON. Fix it by hand.`);
  });
});
