/**
 * The launch policy (`launch-policy.ts`): the parts the Agent guard does not test through its
 * own verdicts — what "affordable" means, and the model and effort each worker kind runs on
 * (D46). The guard's own tests (`src/hooks/agent-guard.test.ts`) cover `resolveLaunchModel`.
 */
import { describe, expect, test } from "bun:test";
import type { GatewayConfig } from "../gateway/config";
import { judgeLaunch, readLaunch } from "../hooks/agent-guard";
import {
  answeringSlot,
  effectiveLaunch,
  effortAllowed,
  type GatewayFacts,
  isAffordable,
  isWorkerKind,
  resolveLaunchModel,
  WORKER_KIND_NAMES,
  WORKER_KINDS,
  type WorkerKind,
  workerLaunch,
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

describe("D46: the worker kinds", () => {
  test("D46: eight kinds name sonnet, only architecture and ui name opus at xhigh", () => {
    expect(WORKER_KINDS).toEqual({
      build: {
        about: "routine building",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      docs: {
        about: "docs and their updates",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      tests: {
        about: "tests and test runs",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      security: {
        about: "code that touches security",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      money: {
        about: "code that touches money",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      permissions: {
        about: "code that touches permissions",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      schema: {
        about: "a schema or a contract",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      deploy: {
        about: "deploy plumbing",
        affordableEffort: "max",
        effort: "high",
        model: "sonnet",
      },
      architecture: {
        about: "architecture and design",
        affordableEffort: "xhigh",
        effort: "xhigh",
        model: "opus",
      },
      ui: {
        about: "UI and UX judgment",
        affordableEffort: "xhigh",
        effort: "xhigh",
        model: "opus",
      },
    });
  });

  test("D46: the kind names, in the table's order, and the check for one", () => {
    expect(WORKER_KIND_NAMES).toEqual([
      "build",
      "docs",
      "tests",
      "security",
      "money",
      "permissions",
      "schema",
      "deploy",
      "architecture",
      "ui",
    ]);
    expect(isWorkerKind("ui")).toBe(true);
    expect(isWorkerKind("UI")).toBe(false);
    expect(isWorkerKind("review")).toBe(false);
    expect(isWorkerKind("toString")).toBe(false);
  });

  test("D46: a sonnet kind runs at max on an affordable worker slot", () => {
    const launch = workerLaunch("build", AFFORDABLE, NO_ENV);
    expect(launch.model).toBe("sonnet");
    expect(launch.effort).toBe("max");
    expect(launch.real).toEqual({
      claude: false,
      family: "sonnet",
      model: "omniroute:glm-5.3-flash",
      tier: null,
    });
  });

  test.each([
    ["the gateway off", NO_GATEWAY],
    ["the worker slot answered by Claude Sonnet", CLAUDE_SLOTS],
    ["a backend chain, but the gateway off", CONFIG_BUT_OFF],
  ] as const)("D46: a sonnet kind runs at high with %s", (_label, gateway) => {
    for (const kind of [
      "build",
      "docs",
      "tests",
      "security",
      "money",
      "permissions",
      "schema",
      "deploy",
    ] as const) {
      expect(workerLaunch(kind, gateway, NO_ENV)).toMatchObject({
        effort: "high",
        model: "sonnet",
      });
    }
  });

  test("D46: a person's own override to a backend is affordable too: max", () => {
    const env = { ANTHROPIC_DEFAULT_SONNET_MODEL: "omniroute:glm-5.3-flash" };
    expect(workerLaunch("tests", NO_GATEWAY, env).effort).toBe("max");
  });

  test.each([
    ["the gateway off", NO_GATEWAY],
    ["the opus slot answered by a backend", AFFORDABLE],
    ["the opus slot answered by Claude Opus", CLAUDE_SLOTS],
  ] as const)(
    "D46: an opus kind runs at xhigh with %s: a tier is never affordable",
    (_l, gateway) => {
      const launch = workerLaunch("architecture", gateway, NO_ENV);
      expect(launch.model).toBe("opus");
      expect(launch.effort).toBe("xhigh");
      expect(launch.real.tier).toBe("opus");
    },
  );

  test("D46: the Agent guard allows every kind's own launch, on every gateway", () => {
    for (const gateway of [NO_GATEWAY, AFFORDABLE, CLAUDE_SLOTS, CONFIG_BUT_OFF]) {
      for (const kind of WORKER_KIND_NAMES) {
        const { effort, model } = workerLaunch(kind, gateway, NO_ENV);
        const launch = readLaunch({
          hook_event_name: "PreToolUse",
          tool_input: { effort, model, prompt: "Build it.", subagent_type: "general-purpose" },
          tool_name: "Agent",
        });
        if (launch === null) throw new Error("not an Agent call");
        const verdict = judgeLaunch(launch, { ...gateway, sessionModel: null }, NO_ENV);
        expect(`${kind}: ${verdict.decision}`).toBe(`${kind}: allow`);
      }
    }
  });

  test("D46: every kind resolves through the policy the guard uses", () => {
    const kind: WorkerKind = "architecture";
    expect(workerLaunch(kind, AFFORDABLE, NO_ENV).real).toEqual(
      resolveLaunchModel("opus", AFFORDABLE, NO_ENV),
    );
    const sonnetKind: WorkerKind = "security";
    expect(workerLaunch(sonnetKind, AFFORDABLE, NO_ENV).real).toEqual(
      resolveLaunchModel("sonnet", AFFORDABLE, NO_ENV),
    );
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

describe("what the policy calls affordable", () => {
  test("a model a backend answers, with no premium tier", () => {
    expect(isAffordable(resolveLaunchModel("omniroute:glm-5.3", NO_GATEWAY, NO_ENV))).toBe(true);
    expect(isAffordable(resolveLaunchModel("sonnet", AFFORDABLE, NO_ENV))).toBe(true);
  });

  test("never Claude, and never a premium tier, whatever answers it", () => {
    expect(isAffordable(resolveLaunchModel("sonnet", NO_GATEWAY, NO_ENV))).toBe(false);
    expect(isAffordable(resolveLaunchModel("haiku", CLAUDE_SLOTS, NO_ENV))).toBe(false);
    expect(isAffordable(resolveLaunchModel("opus", AFFORDABLE, NO_ENV))).toBe(false);
    expect(isAffordable(resolveLaunchModel("best", AFFORDABLE, NO_ENV))).toBe(false);
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

  test("G1: plain CLAUDE_CODE_SUBAGENT_MODEL never beats the call's model", () => {
    const env = { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" };
    expect(effectiveLaunch(CALL, env, null).model).toBe("opus");
    // A call that names none may still run on its agent's own definition, which no hook sees.
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
