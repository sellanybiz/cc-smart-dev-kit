/**
 * The gateway config's breaker keys (`breaker`, `timeouts.breakerHoldMs`): how they parse, their
 * defaults, and what a config written before they existed does. The router's side of the
 * breaker is tested with the router; this file is the contract it reads.
 *
 * Every file goes into tempDir(). Expected values by hand.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  aliasesAtClaudeSlots,
  BREAKER_HOLD_CEILING_MS,
  BREAKER_HOLD_NON_STREAMING_MS,
  breakerHoldMs,
  breakerOn,
  breakerWords,
  fallbackOn,
  JUDGE_NEVER_HOLDS,
  judgeTargetUsable,
  loadConfigFile,
  parseConfig,
  saveConfig,
  streamIdleMs,
  watchConfig,
  workerJudgeTargets,
} from "./config";
import { formatTarget } from "./targets";

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

describe("D64: effort pins", () => {
  it("accepts none and rejects malformed targets, Claude targets and invalid levels", () => {
    expect(parseConfig(raw({ effort: { [SCOUT]: { "omniroute:m1": "none" } } }))).toHaveProperty(
      "config",
    );
    for (const effort of [
      { [SCOUT]: { "omniroute:m1": "turbo" } },
      { [SCOUT]: { "not-a-target": "high" } },
      { [SCOUT]: { "claude-sonnet-5-5": "high" } },
      { "invalid-slot": { "omniroute:m1": "high" } },
    ])
      expect(parseConfig(raw({ effort }))).toHaveProperty("error");
  });

  it("an older writer can turn a pinned slot off or replace its target without invalidating the config", () => {
    for (const slots of [{}, { [SCOUT]: ["omniroute:m2"] }]) {
      const cfg = parsed(raw({ slots, effort: { [SCOUT]: { "omniroute:m1": "xhigh" } } }));
      expect(cfg.slots).toEqual(slots);
      expect(cfg.effort).toBeUndefined();
      const file = join(tempDir("old-effort-writer"), "gateway.json");
      saveConfig(file, cfg);
      expect(JSON.parse(readFileSync(file, "utf8"))).not.toHaveProperty("effort");
    }
    const cfg = parsed(
      raw({ effort: { [SCOUT]: { "omniroute:m1": "high", "omniroute:gone": "max" } } }),
    );
    expect(cfg.effort).toEqual({ [SCOUT]: { "omniroute:m1": "high" } });
  });

  it("keeps future loose fields while saving active and kept effort pins", () => {
    const file = join(tempDir("effort-config"), "gateway.json");
    const cfg = parsed(
      raw({
        effort: { [SCOUT]: { "omniroute:m1": "xhigh" } },
        kept: {
          "cc-smart-dev-kit-extra": {
            effort: { "omniroute:m2": "none" },
            future: true,
            targets: ["omniroute:m2"],
          },
        },
        future: { untouched: true },
      }),
    );
    saveConfig(file, cfg);
    expect(loadConfigFile(file)).toEqual(cfg);
  });
});

describe("aliasesAtClaudeSlots (RV3: what a 1.1.x router would refuse)", () => {
  it("lists the aliases whose slot is not in use, sorted by alias", () => {
    const config = parsed(
      raw({
        aliases: { "old-worker": WORKER, "a-judge": JUDGE, "old-scout": SCOUT },
        slots: { [SCOUT]: ["omniroute:m1"] },
      }),
    );
    expect(aliasesAtClaudeSlots(config)).toEqual([
      ["a-judge", JUDGE],
      ["old-worker", WORKER],
    ]);
  });

  it("lists nothing when every aliased slot is in use, or the alias names a model", () => {
    const config = parsed(
      raw({
        aliases: { "old-scout": SCOUT, "to-model": "omniroute:m1" },
        slots: { [SCOUT]: ["omniroute:m1"] },
      }),
    );
    expect(aliasesAtClaudeSlots(config)).toEqual([]);
  });
});

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

describe("timeouts.firstByteMs (SC1)", () => {
  it("takes up to the longest wait a timer has, and refuses more: above it the wait is 1 ms", () => {
    expect(parsed(raw({ timeouts: { firstByteMs: 2_147_483_647 } })).timeouts.firstByteMs).toBe(
      2_147_483_647,
    );
    expect(parseConfig(raw({ timeouts: { firstByteMs: 2_147_483_648 } }))).toEqual({
      error: [
        "✖ too long: at most 2147483647 ms, the longest a timer can wait (above it the wait is 1 ms and every request would be cut)",
        "  → at timeouts.firstByteMs",
      ].join("\n"),
    });
  });
});

describe("timeouts.streamIdleMs (SC1)", () => {
  it("is 120 s when the config does not say, and adds no key to a config that has none", () => {
    expect(streamIdleMs(parsed(raw()))).toBe(120_000);
    expect(parsed(raw({ timeouts: { firstByteMs: 30_000 } })).timeouts).toStrictEqual({
      firstByteMs: 30_000,
    });
  });

  it("takes any positive whole number of milliseconds", () => {
    for (const value of [1, 45_000, 600_000]) {
      expect(streamIdleMs(parsed(raw({ timeouts: { streamIdleMs: value } })))).toBe(value);
    }
  });

  it("refuses a value no timer can wait: above it the wait is 1 ms and every stream is cut", () => {
    expect(streamIdleMs(parsed(raw({ timeouts: { streamIdleMs: 2_147_483_647 } })))).toBe(
      2_147_483_647,
    );
    expect(parseConfig(raw({ timeouts: { streamIdleMs: 2_147_483_648 } }))).toEqual({
      error: [
        "✖ too long: at most 2147483647 ms, the longest a timer can wait (above it the wait is 1 ms and every stream would be cut)",
        "  → at timeouts.streamIdleMs",
      ].join("\n"),
    });
  });

  it("refuses 0, a fraction and a word", () => {
    expect(parseConfig(raw({ timeouts: { streamIdleMs: 0 } }))).toEqual({
      error: "✖ Too small: expected number to be >0\n  → at timeouts.streamIdleMs",
    });
    expect("error" in parseConfig(raw({ timeouts: { streamIdleMs: 1.5 } }))).toBe(true);
    expect("error" in parseConfig(raw({ timeouts: { streamIdleMs: "120" } }))).toBe(true);
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

describe("the judge's targets (D44)", () => {
  /**
   * The proofs of two targets on the test backend, worked out by hand: `printf 'cc-smart-dev-kit
   * judge test 3\n<target>\nhttp://127.0.0.1:20128' | sha256sum`, the first 32 characters.
   */
  const M1_PROOF = "817a6622e4d5eaac7c33fa6a2dfda4a5";
  const M3_PROOF = "e0546be66f36717139fce9a39c853fd5";
  const PROOF = "0123456789abcdef0123456789abcdef";
  const URL_ = "http://127.0.0.1:20128";

  it("a claude-… target may judge with no proof; a backend target only with its own", () => {
    const config = parsed(raw({ judgeTested: { "omniroute:m1": M1_PROOF } }));
    expect(judgeTargetUsable(config, "claude-sonnet-5-5")).toBe(true);
    expect(judgeTargetUsable(config, "omniroute:m1")).toBe(true);
    expect(judgeTargetUsable(config, "omniroute:m2")).toBe(false);
    // A proof written for another target, or by hand, does not count.
    expect(
      judgeTargetUsable(parsed(raw({ judgeTested: { "omniroute:m1": PROOF } })), "omniroute:m1"),
    ).toBe(false);
    expect(judgeTargetUsable(config, "not a target")).toBe(false);
  });

  it("a judge chain may hold a claude-… target, first or last", () => {
    expect(
      "config" in parseConfig(raw({ slots: { [JUDGE]: ["claude-sonnet-5-5", "omniroute:m1"] } })),
    ).toBe(true);
    expect(
      "config" in parseConfig(raw({ slots: { [JUDGE]: ["omniroute:m1", "claude-sonnet-5-5"] } })),
    ).toBe(true);
  });

  it("the worker's targets that passed the test judge, in the worker chain's order; Claude and untested ones never", () => {
    const config = parsed(
      raw({
        judgeTested: {
          "omniroute:m1": M1_PROOF,
          "omniroute:m3": M3_PROOF,
        },
        slots: { [WORKER]: ["omniroute:m3", "claude-sonnet-5-5", "omniroute:m2", "omniroute:m1"] },
      }),
    );
    expect(workerJudgeTargets(config).map(formatTarget)).toEqual(["omniroute:m3", "omniroute:m1"]);
  });

  it("no worker chain, or no proof, gives none", () => {
    expect(workerJudgeTargets(parsed(raw({ slots: { [SCOUT]: ["omniroute:m1"] } })))).toEqual([]);
    expect(workerJudgeTargets(parsed(raw()))).toEqual([]);
  });

  it("D66: every slot's fallback switch is off by default, the judge's too", () => {
    const config = parsed(raw());
    for (const slot of [SCOUT, WORKER, OPUS, FABLE, JUDGE, "cc-smart-dev-kit-own"]) {
      expect(fallbackOn(config, slot)).toBe(false);
    }
    // No config at all (a `kept` chain's default reads `fallbackOn({}, slot)`).
    expect(fallbackOn({}, SCOUT)).toBe(false);
    expect(fallbackOn({}, JUDGE)).toBe(false);
  });

  it("D66: a switch the person turned on stays on, the judge's with no judge chain too", () => {
    const on = parsed(raw({ fallback: { [JUDGE]: true, [SCOUT]: true } }));
    expect(fallbackOn(on, JUDGE)).toBe(true);
    expect(fallbackOn(on, SCOUT)).toBe(true);
    // A slot the person did not switch on stays off beside it.
    expect(fallbackOn(on, WORKER)).toBe(false);
    const off = parsed(raw({ fallback: { [JUDGE]: false } }));
    expect(fallbackOn(off, JUDGE)).toBe(false);
  });

  it("the judge's fallback switch can be saved with no judge chain; another slot's cannot", () => {
    expect("config" in parseConfig(raw({ fallback: { [JUDGE]: true } }))).toBe(true);
    // Another slot with no chain is still refused.
    const refused = parseConfig(raw({ fallback: { "cc-smart-dev-kit-nope": false } }));
    expect("error" in refused && refused.error).toContain(
      'fallback names slot "cc-smart-dev-kit-nope", which is not in slots',
    );
  });

  it("an old proof (test version 2) does not count", () => {
    const old = createHash("sha256")
      .update(`cc-smart-dev-kit judge test 2\nomniroute:m1\n${URL_}`)
      .digest("hex")
      .slice(0, 32);
    expect(
      judgeTargetUsable(parsed(raw({ judgeTested: { "omniroute:m1": old } })), "omniroute:m1"),
    ).toBe(false);
  });
});
