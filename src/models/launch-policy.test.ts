/**
 * The launch policy (`launch-policy.ts`): which tier a model answers (`resolveLaunchModel`,
 * `resolveSessionModel`).
 */
import { describe, expect, test } from "bun:test";
import type { GatewayConfig } from "../gateway/config";
import {
  type GatewayFacts,
  type LaunchModel,
  resolveLaunchModel,
  resolveSessionModel,
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

  test("a backend id a launch NAMES, mapped behind both tiers, is fable: the stricter reading", () => {
    const both = {
      ANTHROPIC_DEFAULT_FABLE_MODEL: "omniroute:glm-x",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "omniroute:glm-x",
    };
    expect(resolveLaunchModel("omniroute:glm-x", NO_GATEWAY, both)).toMatchObject({
      tier: "fable",
    });
    // The same id as the one that ANSWERED the session: opus, the person put it there.
    expect(
      resolveSessionModel({ model: "omniroute:glm-x", served: true }, NO_GATEWAY, both),
    ).toMatchObject({ tier: "opus" });
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
