/**
 * D66, the owner (2026-10-25): every slot is Claude and every fallback is off, by default. The
 * move that takes a machine set up before it there: `planClaudeDefaults` is the pure part, the
 * config before and after with one line per change, old → new. The step in `setup`, its marker,
 * its backup and the gateway going off are tested in `src/cli/setup-claude-default.test.ts`.
 *
 * Expected values are written by hand.
 */
import { describe, expect, it } from "bun:test";
import { planClaudeDefaults } from "./claude-defaults";
import { type GatewayConfig, parseConfig } from "./config";

const SCOUT = "cc-smart-dev-kit-scout";
const WORKER = "cc-smart-dev-kit-worker";
const OPUS = "cc-smart-dev-kit-opus";
const FABLE = "cc-smart-dev-kit-fable";
const JUDGE = "cc-smart-dev-kit-judge";
const MINE = "cc-smart-dev-kit-mine";

const PROOF = "0".repeat(32);

/** A machine set up before 1.2.0: chains in six slots, switches set, a profile, a saved chain. */
function raw(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aliases: { haiku: MINE },
    backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
    breaker: { [WORKER]: false },
    fallback: { [JUDGE]: true, [SCOUT]: false, [WORKER]: true },
    judgeTested: { "omniroute:j1": PROOF },
    kept: { [FABLE]: { fallback: true, targets: ["omniroute:f1"] } },
    profiles: {
      team: {
        breaker: { [WORKER]: false },
        fallback: { [WORKER]: true },
        slots: { [SCOUT]: "claude", [WORKER]: ["omniroute:p1", "omniroute:p2"] },
      },
    },
    slots: {
      [JUDGE]: ["omniroute:j1"],
      [MINE]: ["omniroute:q1"],
      [OPUS]: ["omniroute:o1"],
      [SCOUT]: ["omniroute:a1", "omniroute:a2"],
      [WORKER]: ["omniroute:w1", "omniroute:w2"],
    },
    version: 1,
    ...extra,
  };
}

function parsed(text: Record<string, unknown>): GatewayConfig {
  const result = parseConfig(text);
  if ("error" in result) throw new Error(result.error);
  return result.config;
}

function planned(config: GatewayConfig) {
  const plan = planClaudeDefaults(config);
  if ("error" in plan) throw new Error(plan.error);
  return plan;
}

describe("D66: the move to Claude defaults, planned", () => {
  it("every chain of the machine goes to Claude, in the slots' order, one line each", () => {
    const plan = planned(parsed(raw()));
    expect(plan.config.slots).toEqual({});
    expect(plan.lines.slice(0, 5)).toEqual([
      "scout: omniroute:a1,omniroute:a2 → Claude",
      "worker: omniroute:w1,omniroute:w2 → Claude",
      "opus: omniroute:o1 → Claude",
      "judge: omniroute:j1 → Claude",
      "mine: omniroute:q1 → Claude",
    ]);
  });

  it("the chains are not lost: each waits in kept, where `gateway slot <slot> custom` finds it", () => {
    const { kept } = planned(parsed(raw())).config;
    expect(kept?.[SCOUT]?.targets).toEqual(["omniroute:a1", "omniroute:a2"]);
    expect(kept?.[WORKER]?.targets).toEqual(["omniroute:w1", "omniroute:w2"]);
    expect(kept?.[JUDGE]?.targets).toEqual(["omniroute:j1"]);
    expect(kept?.[MINE]?.targets).toEqual(["omniroute:q1"]);
    expect(kept?.[FABLE]?.targets).toEqual(["omniroute:f1"]);
  });

  it("every fallback switch is off: the machine's record goes, a saved chain's too", () => {
    const plan = planned(parsed(raw()));
    expect(plan.config).not.toHaveProperty("fallback");
    for (const saved of Object.values(plan.config.kept ?? {})) {
      expect(saved).not.toHaveProperty("fallback");
    }
    // Only a switch that was ON is a change worth a line (an explicit off was the default's).
    expect(plan.lines).toContain("fallback worker: on → off");
    expect(plan.lines).toContain("fallback judge: on → off");
    expect(plan.lines).toContain("fallback fable (saved chain): on → off");
    expect(plan.lines.filter((line) => line.startsWith("fallback scout"))).toEqual([]);
  });

  it("a profile's chains go (Claude, over the machine's), its explicit Claude stays, its switches go", () => {
    const plan = planned(parsed(raw()));
    expect(plan.config.profiles?.team?.slots).toEqual({ [SCOUT]: "claude" });
    expect(plan.config.profiles?.team).not.toHaveProperty("fallback");
    expect(plan.config.profiles?.team).not.toHaveProperty("breaker");
    expect(plan.lines).toContain("profile team worker: omniroute:p1,omniroute:p2 → Claude");
    expect(plan.lines).toContain("profile team fallback worker: on → off");
  });

  it("a profile left with nothing to say stays a profile: its project's URL still resolves", () => {
    const plan = planned(
      parsed(raw({ profiles: { team: { slots: { [WORKER]: ["omniroute:p1"] } } } })),
    );
    expect(plan.config.profiles).toEqual({ team: {} });
  });

  it("the breaker switch of a slot that moved goes with it, as `gateway slot <slot> claude` does", () => {
    const plan = planned(parsed(raw()));
    expect(plan.config).not.toHaveProperty("breaker");
  });

  it("what is not a chain or a fallback stays: backends, port, aliases, the judge's proofs", () => {
    const before = parsed(raw());
    const { config } = planned(before);
    expect(config.backends).toEqual(before.backends);
    expect(config.port).toBe(before.port);
    expect(config.aliases).toEqual({ haiku: MINE });
    expect(config.judgeTested).toEqual({ "omniroute:j1": PROOF });
  });

  it("the plan is a valid config", () => {
    const { config } = planned(parsed(raw()));
    expect("config" in parseConfig(structuredClone(config))).toBe(true);
  });

  it("a config that is Claude and off already has nothing to move: no line, the same config", () => {
    const clean = parsed({
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
      slots: {},
      version: 1,
    });
    const plan = planned(clean);
    expect(plan.lines).toEqual([]);
    expect(plan.config).toEqual(clean);
  });

  it("explicit offs alone are dropped without a line: the file is plain, the meaning is the same", () => {
    const plan = planned(
      parsed({
        backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://127.0.0.1:20128" } },
        fallback: { [JUDGE]: false },
        slots: {},
        version: 1,
      }),
    );
    expect(plan.lines).toEqual([]);
    expect(plan.config).not.toHaveProperty("fallback");
  });

  it("a slot's pins travel with its saved chain", () => {
    const plan = planned(parsed(raw({ effort: { [SCOUT]: { "omniroute:a1": "high" } } })));
    expect(plan.config).not.toHaveProperty("effort");
    expect(plan.config.kept?.[SCOUT]?.effort).toEqual({ "omniroute:a1": "high" });
  });
});
