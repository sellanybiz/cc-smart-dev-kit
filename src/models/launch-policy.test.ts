/**
 * The launch policy (`launch-policy.ts`): the parts the Agent guard does not test through its
 * own verdicts — the UI rule, the slot that answers a launch, which tier a model answers, the
 * efforts, and what a launch really runs on. The guard's own tests
 * (`src/hooks/agent-guard.test.ts`) cover `resolveLaunchModel`.
 */
import { describe, expect, test } from "bun:test";
import type { GatewayConfig } from "../gateway/config";
import {
  answeringSlot,
  effectiveLaunch,
  effortAllowed,
  type GatewayFacts,
  type LaunchModel,
  resolveLaunchModel,
  resolveSessionModel,
  UI_EFFORTS,
  UI_POLICY,
  uiEffortAllowed,
  uiRuleText,
  uiTierAllowed,
} from "./launch-policy";

const NO_ENV = {} as Record<string, string | undefined>;

/** A gateway config whose worker and opus chains start with the targets given. */
function config(worker: string, opus: string): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
    port: 20100,
    slots: {
      "cc-smart-dev-kit-opus": [opus],
      "cc-smart-dev-kit-worker": [worker],
    },
    timeouts: { firstByteMs: 60_000 },
    version: 1,
  };
}

/** The gateway off, and no config at all. */
const NO_GATEWAY: GatewayFacts = { config: null, gatewayOn: false };

/** The gateway on, the worker and opus slots answered by a backend. */
const AFFORDABLE: GatewayFacts = {
  config: config("omniroute:glm-5.3-flash", "omniroute:glm-5.3"),
  gatewayOn: true,
};

/** The gateway on, both slots answered by Claude itself. */
const CLAUDE_SLOTS: GatewayFacts = {
  config: config("claude-sonnet-5-5", "claude-opus-5-5"),
  gatewayOn: true,
};

/** A config with backend chains, but Claude Code's settings do not point at the router. */
const CONFIG_BUT_OFF: GatewayFacts = { ...AFFORDABLE, gatewayOn: false };

describe("D50: UI/UX work runs only on the tiers and efforts UI_POLICY names", () => {
  test("the one home: opus and fable, at high and above", () => {
    expect(UI_POLICY).toEqual({ minEffort: "high", tiers: ["opus", "fable"] });
    expect(UI_EFFORTS).toEqual(["high", "xhigh", "max"]);
    expect(uiRuleText()).toBe("`opus` or `fable` at `high`, `xhigh` or `max`");
  });

  test("the allowed tiers: opus and fable; never Haiku, Sonnet or an affordable model", () => {
    const tier = (model: string, gateway: GatewayFacts = NO_GATEWAY) =>
      resolveLaunchModel(model, gateway, NO_ENV);
    expect(uiTierAllowed(tier("opus"))).toBe(true);
    expect(uiTierAllowed(tier("fable"))).toBe(true);
    expect(uiTierAllowed(tier("sonnet"))).toBe(false);
    expect(uiTierAllowed(tier("haiku"))).toBe(false);
    // A backend target behind the opus tier is still the opus tier, whatever answers it.
    expect(uiTierAllowed(tier("opus", AFFORDABLE))).toBe(true);
    // A backend target named directly has no tier, so UI/UX work is refused.
    expect(uiTierAllowed(tier("omniroute:glm-5.3-flash"))).toBe(false);
  });

  test("the minimum effort: high, xhigh and max pass; medium, low and none do not", () => {
    for (const effort of ["high", "xhigh", "max", "HIGH"]) {
      expect(`${effort}: ${uiEffortAllowed(effort)}`).toBe(`${effort}: true`);
    }
    for (const effort of ["medium", "low", "turbo", "", null]) {
      expect(`${effort}: ${uiEffortAllowed(effort)}`).toBe(`${effort}: false`);
    }
  });
});

describe("the slot that answers a launch", () => {
  test("a family name: its family's slot while it has a chain and the gateway is on", () => {
    expect(answeringSlot("sonnet", AFFORDABLE, NO_ENV)).toBe("cc-smart-dev-kit-worker");
    expect(answeringSlot("opus", CLAUDE_SLOTS, NO_ENV)).toBe("cc-smart-dev-kit-opus");
    expect(answeringSlot("haiku", AFFORDABLE, NO_ENV)).toBeNull();
    expect(answeringSlot("sonnet", CONFIG_BUT_OFF, NO_ENV)).toBeNull();
    expect(answeringSlot("sonnet", NO_GATEWAY, NO_ENV)).toBeNull();
  });

  test("through the person's override: a Claude id goes to its family's slot, a backend to none", () => {
    expect(
      answeringSlot("sonnet", AFFORDABLE, { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-5-5" }),
    ).toBe("cc-smart-dev-kit-opus");
    expect(
      answeringSlot("sonnet", AFFORDABLE, { ANTHROPIC_DEFAULT_SONNET_MODEL: "omniroute:glm-5.3" }),
    ).toBeNull();
  });

  test("a Claude id and a slot key, named directly", () => {
    expect(answeringSlot("claude-sonnet-5-5[1m]", AFFORDABLE, NO_ENV)).toBe(
      "cc-smart-dev-kit-worker",
    );
    expect(answeringSlot("cc-smart-dev-kit-scout", AFFORDABLE, NO_ENV)).toBe(
      "cc-smart-dev-kit-scout",
    );
    expect(answeringSlot("omniroute:glm-5.3", AFFORDABLE, NO_ENV)).toBeNull();
  });
});

describe("which tier a model answers (`resolveLaunchModel`)", () => {
  test("a backend answers sonnet with no premium tier; a premium name keeps its tier", () => {
    expect(resolveLaunchModel("omniroute:glm-5.3", NO_GATEWAY, NO_ENV)).toMatchObject({
      claude: false,
      tier: null,
    });
    expect(resolveLaunchModel("sonnet", AFFORDABLE, NO_ENV)).toMatchObject({
      claude: false,
      tier: null,
    });
    expect(resolveLaunchModel("sonnet", NO_GATEWAY, NO_ENV)).toMatchObject({
      claude: true,
      tier: null,
    });
    expect(resolveLaunchModel("opus", AFFORDABLE, NO_ENV)).toMatchObject({
      claude: false,
      tier: "opus",
    });
    expect(resolveLaunchModel("best", AFFORDABLE, NO_ENV)).toMatchObject({ tier: "opus" });
  });

  test("Claude Fable behind the opus name is the opus tier (owner, 2026-11-11)", () => {
    const fableFirst: GatewayFacts = {
      config: config("omniroute:glm-5.3-flash", "claude-fable-5-2"),
      gatewayOn: true,
    };
    const asOpus: LaunchModel = {
      claude: true,
      family: "opus",
      model: "claude-fable-5-2",
      tier: "opus",
    };
    const override = { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-fable-5-2" };
    // The `opus` name, through the opus slot or the person's override.
    expect(resolveLaunchModel("opus", fableFirst, NO_ENV)).toEqual(asOpus);
    expect(resolveLaunchModel("opus", NO_GATEWAY, override)).toEqual(asOpus);
    // The id that ANSWERED a session (its transcript): the tier it was mapped behind.
    const served = { model: "claude-fable-5-2", served: true };
    expect(resolveSessionModel(served, fableFirst, NO_ENV)).toEqual(asOpus);
    expect(resolveSessionModel(served, NO_GATEWAY, override)).toEqual(asOpus);
    // Unmapped, the id that answered is Fable; and the `fable` name stays Fable.
    expect(resolveSessionModel(served, NO_GATEWAY, NO_ENV)).toMatchObject({ tier: "fable" });
    expect(resolveLaunchModel("fable", fableFirst, NO_ENV)).toMatchObject({ tier: "fable" });
  });

  test("an id a launch NAMES is the model it asks for: Fable named outright stays Fable", () => {
    const fableFirst: GatewayFacts = {
      config: config("omniroute:glm-5.3-flash", "claude-fable-5-2"),
      gatewayOn: true,
    };
    expect(resolveLaunchModel("claude-fable-5-2", fableFirst, NO_ENV)).toMatchObject({
      family: "fable",
      tier: "fable",
    });
    // The same id asked for by the session (a start, a switch, ANTHROPIC_MODEL) is Fable too.
    const asked = { model: "claude-fable-5-2", served: false };
    expect(resolveSessionModel(asked, fableFirst, NO_ENV)).toMatchObject({ tier: "fable" });
    // The opus slot's key named outright is the opus tier, whatever an override says of it.
    const slotAsFable = { ANTHROPIC_DEFAULT_FABLE_MODEL: "cc-smart-dev-kit-opus" };
    expect(resolveLaunchModel("cc-smart-dev-kit-opus", fableFirst, slotAsFable)).toMatchObject({
      tier: "opus",
    });
  });

  test("an id mapped behind both premium tiers is opus: the person put it behind opus", () => {
    const both: GatewayFacts = {
      config: {
        ...config("omniroute:glm-5.3-flash", "claude-fable-5-2"),
        slots: {
          "cc-smart-dev-kit-fable": ["claude-fable-5-2"],
          "cc-smart-dev-kit-opus": ["claude-fable-5-2"],
        },
      },
      gatewayOn: true,
    };
    const served = { model: "claude-fable-5-2", served: true };
    expect(resolveSessionModel(served, both, NO_ENV)).toMatchObject({ tier: "opus" });
    const fableEnv = { ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5-2" };
    const opusSlot: GatewayFacts = {
      config: config("omniroute:glm-5.3-flash", "claude-fable-5-2"),
      gatewayOn: true,
    };
    expect(resolveSessionModel(served, opusSlot, fableEnv)).toMatchObject({ tier: "opus" });
  });

  test("a slot target with a context suffix maps the id that answers without it", () => {
    const suffixed: GatewayFacts = {
      config: config("omniroute:glm-5.3-flash", "claude-fable-5-2[1m]"),
      gatewayOn: true,
    };
    expect(
      resolveSessionModel({ model: "claude-fable-5-2", served: true }, suffixed, NO_ENV),
    ).toMatchObject({ tier: "opus" });
  });

  test("an id that answered is never routed through a slot again", () => {
    // The opus slot answers with Fable; the fable slot would send Fable on to Sonnet.
    const chained: GatewayFacts = {
      config: {
        ...config("omniroute:glm-5.3-flash", "claude-fable-5-2"),
        slots: {
          "cc-smart-dev-kit-fable": ["claude-sonnet-5-5"],
          "cc-smart-dev-kit-opus": ["claude-fable-5-2"],
        },
      },
      gatewayOn: true,
    };
    expect(
      resolveSessionModel({ model: "claude-fable-5-2", served: true }, chained, NO_ENV),
    ).toEqual({ claude: true, family: "opus", model: "claude-fable-5-2", tier: "opus" });
  });

  test("a name with no premium tier still takes the tier of a premium Claude model behind it", () => {
    const fableWorker: GatewayFacts = {
      config: config("claude-fable-5-2", "omniroute:glm-5.3"),
      gatewayOn: true,
    };
    expect(resolveLaunchModel("sonnet", fableWorker, NO_ENV)).toEqual({
      claude: true,
      family: "fable",
      model: "claude-fable-5-2",
      tier: "fable",
    });
    expect(resolveLaunchModel("sonnet", CLAUDE_SLOTS, NO_ENV)).toMatchObject({ tier: null });
    const opusSonnet = { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-5-5" };
    expect(resolveLaunchModel("sonnet", NO_GATEWAY, opusSonnet)).toMatchObject({
      family: "opus",
      tier: "opus",
    });
    // Sonnet → Claude Opus, whose own slot answers with Claude Fable: Fable answers, so Fable.
    const fableFirst: GatewayFacts = {
      config: config("omniroute:glm-5.3-flash", "claude-fable-5-2"),
      gatewayOn: true,
    };
    expect(resolveLaunchModel("sonnet", fableFirst, opusSonnet)).toEqual({
      claude: true,
      family: "fable",
      model: "claude-fable-5-2",
      tier: "fable",
    });
  });
});

describe("the effort levels", () => {
  test("medium, high, xhigh and max, in any case; never low, never a level no rule knows", () => {
    for (const level of ["medium", "HIGH", "xHigh", "max"]) expect(effortAllowed(level)).toBe(true);
    for (const level of ["low", "LOW", "", "ultra", "minimal"])
      expect(effortAllowed(level)).toBe(false);
  });
});

describe("G1: what a launch really runs on (`effectiveLaunch`, proved live on 2.1.306)", () => {
  const CALL = { effort: "high", fork: false, model: "opus", workflow: false };
  const FORCE = { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" };

  test("G1: no override: the call's own model and effort", () => {
    expect(effectiveLaunch(CALL, NO_ENV, "claude-sonnet-5-5")).toEqual({
      effort: "high",
      effortFrom: null,
      model: "opus",
      modelFrom: "call",
    });
  });

  test("G1: FORCE with CLAUDE_CODE_SUBAGENT_MODEL: that model, whatever the call names", () => {
    const env = { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: " haiku " };
    expect(effectiveLaunch(CALL, env, "claude-opus-5-5")).toEqual({
      effort: "high",
      effortFrom: null,
      model: "haiku",
      modelFrom: "force",
    });
    // The input Claude Code really sends under FORCE: no `model` at all.
    expect(effectiveLaunch({ ...CALL, model: null }, env, null).model).toBe("haiku");
  });

  test("G1: FORCE alone, or with CLAUDE_CODE_SUBAGENT_MODEL=inherit: the session's own model", () => {
    for (const env of [FORCE, { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "inherit" }]) {
      expect(effectiveLaunch(CALL, env, "claude-fable-5")).toEqual({
        effort: "high",
        effortFrom: null,
        model: "claude-fable-5",
        modelFrom: "force-session",
      });
    }
    // A session model the guard cannot read stays unknown: the guard judges it as the opus tier.
    expect(effectiveLaunch(CALL, FORCE, null).model).toBeNull();
    expect(effectiveLaunch(CALL, FORCE, null).modelFrom).toBe("force-session");
  });

  test("G1: FORCE is on exactly where Claude Code reads it as on: 1, true, yes, on", () => {
    for (const value of ["1", "true", "YES", " on "]) {
      const env = { CLAUDE_CODE_SUBAGENT_MODEL: "haiku", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: value };
      expect(`${value}: ${effectiveLaunch(CALL, env, null).modelFrom}`).toBe(`${value}: force`);
    }
    for (const value of ["", "0", "false", "off", "2"]) {
      const env = { CLAUDE_CODE_SUBAGENT_MODEL: "haiku", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: value };
      expect(`${value}: ${effectiveLaunch(CALL, env, null).modelFrom}`).toBe(`${value}: call`);
    }
  });

  test("frontmatter supplies both fields, below call and environment effort", () => {
    const definition = { model: "sonnet", effort: "high" };
    const bare = { ...CALL, model: null, effort: null };
    expect(
      effectiveLaunch(bare, { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" }, null, definition),
    ).toEqual({
      model: "sonnet",
      modelFrom: "frontmatter",
      effort: "high",
      effortFrom: "frontmatter",
    });
    expect(effectiveLaunch(CALL, NO_ENV, null, definition).model).toBe("opus");
    expect(
      effectiveLaunch(bare, { CLAUDE_CODE_EFFORT_LEVEL: "max" }, null, definition).effort,
    ).toBe("max");
  });

  test("G1: plain CLAUDE_CODE_SUBAGENT_MODEL never beats the call's model", () => {
    const env = { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" };
    expect(effectiveLaunch(CALL, env, null).model).toBe("opus");
    // With no supplied definition, the guard still cannot prove an unseen SDK agent's model.
    expect(effectiveLaunch({ ...CALL, model: null }, env, null)).toEqual({
      effort: "high",
      effortFrom: null,
      model: null,
      modelFrom: "call",
    });
  });

  test("G1: CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL moves a Workflow agent, never an Agent call", () => {
    const env = { CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: "sonnet" };
    expect(effectiveLaunch(CALL, env, null).modelFrom).toBe("call");
    expect(effectiveLaunch({ ...CALL, workflow: true }, env, null)).toEqual({
      effort: "high",
      effortFrom: null,
      model: "sonnet",
      modelFrom: "workflow",
    });
    // `inherit` is the same as unset (Claude Code's own reading).
    const inherit = { CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: "inherit" };
    expect(effectiveLaunch({ ...CALL, workflow: true }, inherit, null).modelFrom).toBe("call");
    // FORCE comes first, for a Workflow agent too.
    const both = { ...env, ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "haiku" };
    expect(effectiveLaunch({ ...CALL, workflow: true }, both, null).model).toBe("haiku");
  });

  test("G1: CLAUDE_CODE_EFFORT_LEVEL beats the call's effort, also when the call names none", () => {
    const env = { CLAUDE_CODE_EFFORT_LEVEL: " High " };
    expect(effectiveLaunch({ ...CALL, effort: "max" }, env, null)).toEqual({
      effort: "high",
      effortFrom: "CLAUDE_CODE_EFFORT_LEVEL",
      model: "opus",
      modelFrom: "call",
    });
    expect(effectiveLaunch({ ...CALL, effort: null }, env, null).effort).toBe("high");
    // Empty is unset.
    expect(effectiveLaunch(CALL, { CLAUDE_CODE_EFFORT_LEVEL: " " }, null).effortFrom).toBeNull();
  });

  test("G1: a fork keeps today's rule under every override: the session's model, its own effort", () => {
    const env = {
      ...FORCE,
      CLAUDE_CODE_EFFORT_LEVEL: "max",
      CLAUDE_CODE_SUBAGENT_MODEL: "haiku",
    };
    expect(effectiveLaunch({ ...CALL, fork: true }, env, "claude-opus-5-5")).toEqual({
      effort: "high",
      effortFrom: null,
      model: "claude-opus-5-5",
      modelFrom: "fork",
    });
    expect(effectiveLaunch({ ...CALL, effort: null, fork: true }, env, null)).toEqual({
      effort: null,
      effortFrom: null,
      model: null,
      modelFrom: "fork",
    });
  });
});
