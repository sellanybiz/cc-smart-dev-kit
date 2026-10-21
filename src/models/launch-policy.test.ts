/**
 * The launch policy (`launch-policy.ts`): the parts the Agent guard does not test through its
 * own verdicts — what "affordable" means, and the model and effort each worker kind runs on
 * (D21). The guard's own tests (`src/hooks/agent-guard.test.ts`) cover `resolveLaunchModel`.
 */
import { describe, expect, test } from "bun:test";
import type { GatewayConfig } from "../gateway/config";
import { judgeLaunch, readLaunch } from "../hooks/agent-guard";
import {
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

describe("D21: the worker kinds", () => {
  test("D21: build, docs and tests name sonnet; the seven judgment kinds name opus at xhigh", () => {
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
        affordableEffort: "xhigh",
        effort: "xhigh",
        model: "opus",
      },
      money: {
        about: "code that touches money",
        affordableEffort: "xhigh",
        effort: "xhigh",
        model: "opus",
      },
      permissions: {
        about: "code that touches permissions",
        affordableEffort: "xhigh",
        effort: "xhigh",
        model: "opus",
      },
      schema: {
        about: "a schema or a contract",
        affordableEffort: "xhigh",
        effort: "xhigh",
        model: "opus",
      },
      deploy: {
        about: "deploy plumbing",
        affordableEffort: "xhigh",
        effort: "xhigh",
        model: "opus",
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

  test("D21: the kind names, in the table's order, and the check for one", () => {
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

  test("D21: a sonnet kind runs at max on an affordable worker slot", () => {
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
  ] as const)("D21: a sonnet kind runs at high with %s", (_label, gateway) => {
    for (const kind of ["build", "docs", "tests"] as const) {
      expect(workerLaunch(kind, gateway, NO_ENV)).toMatchObject({
        effort: "high",
        model: "sonnet",
      });
    }
  });

  test("D21: a person's own override to a backend is affordable too: max", () => {
    const env = { ANTHROPIC_DEFAULT_SONNET_MODEL: "omniroute:glm-5.3-flash" };
    expect(workerLaunch("tests", NO_GATEWAY, env).effort).toBe("max");
  });

  test.each([
    ["the gateway off", NO_GATEWAY],
    ["the opus slot answered by a backend", AFFORDABLE],
    ["the opus slot answered by Claude Opus", CLAUDE_SLOTS],
  ] as const)(
    "D21: an opus kind runs at xhigh with %s: a tier is never affordable",
    (_l, gateway) => {
      const launch = workerLaunch("security", gateway, NO_ENV);
      expect(launch.model).toBe("opus");
      expect(launch.effort).toBe("xhigh");
      expect(launch.real.tier).toBe("opus");
    },
  );

  test("D21: the Agent guard allows every kind's own launch, on every gateway", () => {
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

  test("D21: every kind resolves through the policy the guard uses", () => {
    const kind: WorkerKind = "architecture";
    expect(workerLaunch(kind, AFFORDABLE, NO_ENV).real).toEqual(
      resolveLaunchModel("opus", AFFORDABLE, NO_ENV),
    );
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
