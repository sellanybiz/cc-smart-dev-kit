/**
 * The Agent guard (`agent-guard.ts`): which model a launch really runs on, and the owner's
 * verdict for each — effort medium or above (never `low`), a review at high unless the person
 * asks for a deeper one, an affordable slot at effort max, Claude Sonnet/Haiku free of the
 * model rules, Claude Opus only for a review or a reason line, Claude Fable only read-only
 * with a reason and a person to answer. Plus the record `cc-smart-dev-kit usage` reads, written
 * once a launch is known to run.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { cliPaths } from "../cli/paths";
import type { GatewayConfig } from "../gateway/config";
import { tempDir } from "../testing/temp";
import {
  ALLOWED_EFFORTS,
  agentGuard,
  type GuardContext,
  guardFacts,
  judgeLaunch,
  judgeWorkflow,
  readGuardContext,
  readLaunch,
  readWorkflowScript,
  reasonLine,
  resolveLaunchModel,
  workflowRefusal,
} from "./agent-guard";
import { agentLaunchesFile, parseAgentLaunch, readAgentLaunches } from "./agent-launches";
import type { HookInput } from "./io";

const NO_ENV = {} as Record<string, string | undefined>;
const OPUS_ID = "claude-opus-5-5";

/**
 * A gateway config whose opus chain starts with Claude Opus, and whose worker chain starts with
 * a backend. (Its 0.4.x `modelSlots` entry still loads; the router reaches a slot by family.)
 */
function configWithModelSlot(): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
    modelSlots: { [OPUS_ID]: "cc-smart-dev-kit-opus" },
    port: 20100,
    slots: {
      "cc-smart-dev-kit-opus": [OPUS_ID, "omniroute:glm-5.3-flash"],
      "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"],
    },
    timeouts: { firstByteMs: 60_000 },
    version: 1,
  };
}

/** An Agent call, as Claude Code builds one. */
function agentCall(fields: Record<string, unknown>, tool = "Agent"): HookInput {
  return { hook_event_name: "PreToolUse", tool_input: fields, tool_name: tool };
}

const CTX: GuardContext = { config: null, gatewayOn: false, sessionModel: null };

/** The config above, with Claude Code's settings pointing at the router. */
const ON_SLOTS = { config: configWithModelSlot(), gatewayOn: true };

/** No gateway config, and Claude Code's settings not pointing at one. */
const NO_GATEWAY = { config: null, gatewayOn: false };

/** A Workflow tool call, as Claude Code builds one. */
function workflowCall(script: string): HookInput {
  return {
    hook_event_name: "PreToolUse",
    tool_input: { script },
    tool_name: "Workflow",
  };
}

/** The paths a Workflow judgement uses (no gateway config, nothing on disk). */
const WORKFLOW_PATHS = cliPaths({
  CLAUDE_CONFIG_DIR: join(tempDir("workflow-home"), ".claude"),
  HOME: tempDir("workflow-home"),
});

function verdict(fields: Record<string, unknown>, ctx: GuardContext = CTX, env = NO_ENV) {
  const launch = readLaunch(agentCall(fields));
  if (launch === null) throw new Error("not an Agent call");
  return judgeLaunch(launch, ctx, env);
}

describe("which model a launch runs on", () => {
  it("a family name with no override and no gateway: the family itself, and its tier", () => {
    expect(resolveLaunchModel("opus", NO_GATEWAY, NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: "opus",
      tier: "opus",
    });
    expect(resolveLaunchModel("fable", NO_GATEWAY, NO_ENV)).toEqual({
      claude: true,
      family: "fable",
      model: "fable",
      tier: "fable",
    });
    // Haiku and Sonnet have no premium tier.
    expect(resolveLaunchModel("sonnet", NO_GATEWAY, NO_ENV)).toEqual({
      claude: true,
      family: "sonnet",
      model: "sonnet",
      tier: null,
    });
  });

  it("Claude Code's env override wins: ANTHROPIC_DEFAULT_OPUS_MODEL (fable has one too)", () => {
    expect(
      resolveLaunchModel("opus", NO_GATEWAY, { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8" }),
    ).toEqual({ claude: true, family: "opus", model: "claude-opus-4-8", tier: "opus" });
    expect(
      resolveLaunchModel("fable", NO_GATEWAY, {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5-1",
      }),
    ).toEqual({ claude: true, family: "fable", model: "claude-fable-5-1", tier: "fable" });
  });

  it("a tier keeps its name whatever the override answers with (owner, 2026-10-16)", () => {
    // `opus` is the tier even when a backend answers it: never affordable, never forced to max,
    // and the family the messages and the record read stays the tier's own.
    expect(
      resolveLaunchModel("opus", NO_GATEWAY, { ANTHROPIC_DEFAULT_OPUS_MODEL: "openai:gpt-5.5" }),
    ).toEqual({ claude: false, family: "opus", model: "openai:gpt-5.5", tier: "opus" });
    expect(
      resolveLaunchModel("fable", NO_GATEWAY, { ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5" }),
    ).toEqual({ claude: false, family: "fable", model: "openai:gpt-5.5", tier: "fable" });
    // The id an override names is that tier wherever it appears, the session's model included.
    const env = { ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5" };
    expect(resolveLaunchModel("openai:gpt-5.5", NO_GATEWAY, env)).toEqual({
      claude: false,
      family: null,
      model: "openai:gpt-5.5",
      tier: "fable",
    });
    // An id no override names keeps being an affordable target.
    expect(resolveLaunchModel("openai:gpt-5.5", NO_GATEWAY, NO_ENV)).toEqual({
      claude: false,
      family: null,
      model: "openai:gpt-5.5",
      tier: null,
    });
  });

  it("with the gateway on, the family's slot answers: its chain's first target", () => {
    expect(resolveLaunchModel("opus", ON_SLOTS, NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: OPUS_ID,
      tier: "opus",
    });
    // A full id reaches its family's slot the same way.
    expect(resolveLaunchModel(OPUS_ID, ON_SLOTS, NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: OPUS_ID,
      tier: "opus",
    });
    // A model slot's own key is its family's tier too.
    expect(resolveLaunchModel("cc-smart-dev-kit-opus", ON_SLOTS, NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: OPUS_ID,
      tier: "opus",
    });
    // Sonnet's slot is the worker: its chain starts with a backend, so a backend answers, and
    // the launch keeps its family.
    expect(resolveLaunchModel("sonnet", ON_SLOTS, NO_ENV)).toEqual({
      claude: false,
      family: "sonnet",
      model: "omniroute:glm-5.3-flash",
      tier: null,
    });
    // The same config with the gateway off: nothing reaches the router, Claude Sonnet answers.
    expect(
      resolveLaunchModel("sonnet", { config: configWithModelSlot(), gatewayOn: false }, NO_ENV),
    ).toEqual({ claude: true, family: "sonnet", model: "sonnet", tier: null });
  });

  it("a slot key and a backend target are affordable; a name nobody knows is not", () => {
    expect(resolveLaunchModel("cc-smart-dev-kit-worker", ON_SLOTS, NO_ENV)).toEqual({
      claude: false,
      family: null,
      model: "omniroute:glm-5.3-flash",
      tier: null,
    });
    expect(resolveLaunchModel("omniroute:glm-5.3-flash", ON_SLOTS, NO_ENV)).toEqual({
      claude: false,
      family: null,
      model: "omniroute:glm-5.3-flash",
      tier: null,
    });
    // A name no rule knows is never read as an affordable slot: the strictest rule answers, and
    // that rule is the `opus` tier.
    expect(resolveLaunchModel("some-custom-model", ON_SLOTS, NO_ENV)).toEqual({
      claude: true,
      family: null,
      model: "some-custom-model",
      tier: "opus",
    });
  });

  it("a claude-… id is Claude even with no config; the [1m] suffix is dropped first", () => {
    expect(resolveLaunchModel("claude-sonnet-5-5[1m]", NO_GATEWAY, NO_ENV)).toEqual({
      claude: true,
      family: "sonnet",
      model: "claude-sonnet-5-5",
      tier: null,
    });
  });
});

describe("the session's own model, for a fork", () => {
  const paths = () =>
    cliPaths({
      CLAUDE_CONFIG_DIR: join(tempDir("guard-session"), ".claude"),
      HOME: tempDir("guard-session"),
    });

  it("the transcript's last Claude model is read; ANTHROPIC_MODEL is the fallback", () => {
    const transcript = join(tempDir("guard-session"), "session.jsonl");
    writeFileSync(
      transcript,
      `${JSON.stringify({ message: { content: [], model: "claude-haiku-4-5" }, type: "assistant" })}\n`,
    );
    const call = (input: HookInput) => readGuardContext(paths(), input, NO_ENV);
    expect(call({ transcript_path: transcript }).sessionModel).toBe("claude-haiku-4-5");
    expect(call({}).sessionModel).toBeNull();
    // The model the session was started on: no transcript yet (a session's first call).
    expect(
      readGuardContext(paths(), {}, { ANTHROPIC_MODEL: "claude-sonnet-5-5" }).sessionModel,
    ).toBe("claude-sonnet-5-5");
    // What answered wins over what the session was started on.
    expect(
      readGuardContext(
        paths(),
        { transcript_path: transcript },
        {
          ANTHROPIC_MODEL: "claude-opus-5-5",
        },
      ).sessionModel,
    ).toBe("claude-haiku-4-5");
  });

  it("a fork is judged on that model: a Sonnet session allows it, an unknown one is Opus", () => {
    const sonnet: GuardContext = {
      config: null,
      gatewayOn: false,
      sessionModel: "claude-haiku-4-5",
    };
    expect(verdict({ prompt: "x", subagent_type: "fork" }, sonnet).decision).toBe("allow");
    // Nobody named it: the strictest reading, so it needs the Opus reason line.
    expect(verdict({ prompt: "x", subagent_type: "fork" }, CTX).decision).toBe("deny");
  });
});

describe("the verdict", () => {
  it("no model: denied; no effort: denied; a fork needs neither", () => {
    expect(verdict({ prompt: "x", effort: "high" }).decision).toBe("deny");
    expect(verdict({ model: "sonnet", prompt: "x" }).decision).toBe("deny");
    // A fork needs neither line — it always inherits both — but it still runs on a model:
    // an unknown session model counts as Claude Opus, so it needs the Opus reason.
    const fork = verdict({ prompt: "x", subagent_type: "fork" });
    expect(fork.decision).toBe("deny");
    expect(fork.real?.family).toBe("opus");
    expect(
      verdict({ prompt: "Opus reason: debugging - it is", subagent_type: "fork" }).decision,
    ).toBe("ask");
  });

  it("a full Opus id is denied too, with the rule in words", () => {
    const result = verdict({ effort: "high", model: OPUS_ID, prompt: "do it" });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("Opus is for reviews and the plugin's listed exceptions");
    expect(result.reason).toContain("Opus reason: <security|money|");
  });

  it("Opus with an `Opus reason:` line asks the person, who sees the reason", () => {
    const result = verdict({
      effort: "xhigh",
      model: "opus",
      prompt: "Rewrite the router.\nOpus reason: architecture - the routing table is the core",
    });
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("Opus reason: architecture - the routing table is the core");
    expect(result.why).toBe("opus:architecture");
  });

  it("nobody to answer (`claude -p`): a non-review Opus launch is denied, a review is allowed", () => {
    const unattended = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
    const asked = verdict(
      { effort: "xhigh", model: "opus", prompt: "Opus reason: debugging - it is" },
      CTX,
      unattended,
    );
    expect(asked.decision).toBe("deny");
    expect(asked.reason).toContain("nobody to answer");
    expect(
      verdict(
        { effort: "high", model: "opus", prompt: "review", subagent_type: "Reviewer" },
        CTX,
        unattended,
      ).decision,
    ).toBe("allow");
  });

  it("Opus with a reason word nobody listed is denied", () => {
    const result = verdict({
      effort: "high",
      model: "opus",
      prompt: "Opus reason: because I like it",
    });
    expect(result.decision).toBe("deny");
  });

  it("a review agent on Opus is allowed; at effort max it asks the person", () => {
    expect(
      verdict({ effort: "high", model: "opus", prompt: "review", subagent_type: "Reviewer" })
        .decision,
    ).toBe("allow");
    expect(
      verdict({
        effort: "high",
        model: "opus",
        prompt: "review",
        subagent_type: "cc-smart-dev-kit:reviewer",
      }).decision,
    ).toBe("allow");
    // A deeper review: `max` asks, and the person's yes is the ask's answer (no reason line).
    const max = verdict({
      effort: "max",
      model: "opus",
      prompt: "review",
      subagent_type: "Reviewer",
    });
    expect(max.decision).toBe("ask");
    expect(max.reason).toContain("Claude Opus review at effort `max`");
    expect(max.reason).toContain("a review runs at `high` unless you asked for a deeper one");
    expect(max.why).toBe("opus:review-max");
  });

  it("a review at effort max under `claude -p` is denied: nobody is there to approve it", () => {
    const where = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
    const max = verdict(
      { effort: "max", model: "opus", prompt: "review", subagent_type: "Reviewer" },
      CTX,
      where,
    );
    expect(max.decision).toBe("deny");
    expect(max.reason).toContain("nobody to answer");
    // The usual effort stays allowed there.
    expect(
      verdict(
        { effort: "high", model: "opus", prompt: "review", subagent_type: "Reviewer" },
        CTX,
        where,
      ).decision,
    ).toBe("allow");
  });

  it("Sonnet and Haiku are free of the model rules, and are never recorded", () => {
    const sonnet = verdict({ effort: "high", model: "sonnet", prompt: "build" });
    expect(sonnet.decision).toBe("allow");
    expect(sonnet.why).toBe("");
    expect(verdict({ effort: "xhigh", model: "haiku", prompt: "search" }).decision).toBe("allow");
  });

  it("`low` is refused on every model: a Claude family and an affordable slot", () => {
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    for (const model of ["haiku", "sonnet", "cc-smart-dev-kit-worker"]) {
      for (const ctx of [CTX, on]) {
        const result = verdict({ effort: "low", model, prompt: "search it" }, ctx);
        expect(result.decision).toBe("deny");
        expect(result.reason).toContain("asks for effort `low`");
        expect(result.reason).toContain("the plugin's rule");
        for (const level of ALLOWED_EFFORTS) {
          expect(result.reason).toContain(`\`${level}\``);
        }
      }
    }
    // A fork inherits, but one that names a level itself is held to the same rule.
    const fork = verdict(
      { effort: "low", prompt: "x", subagent_type: "fork" },
      {
        config: null,
        gatewayOn: false,
        sessionModel: "claude-haiku-4-5",
      },
    );
    expect(fork.decision).toBe("deny");
    expect(fork.reason).toContain("asks for effort `low`");
    // `medium` is allowed on a Claude family (D5); an affordable slot with the gateway on still
    // needs `max`, its own rule.
    expect(verdict({ effort: "medium", model: "haiku", prompt: "search it" }, on).decision).toBe(
      "allow",
    );
    const slot = verdict({ effort: "medium", model: "cc-smart-dev-kit-worker", prompt: "x" }, on);
    expect(slot.decision).toBe("deny");
    expect(slot.reason).toContain("an affordable gateway slot");
  });

  it("every allowed level passes a Claude builder; a level no rule knows is refused", () => {
    for (const effort of ALLOWED_EFFORTS) {
      expect(verdict({ effort, model: "sonnet", prompt: "build" }).decision).toBe("allow");
    }
    // Only the three levels above are allowed: a level no rule knows is refused, not guessed.
    const odd = verdict({ effort: "none", model: "sonnet", prompt: "build" });
    expect(odd.decision).toBe("deny");
    expect(odd.reason).toContain("asks for effort `none`");
  });

  it("an affordable slot is allowed with the gateway off, and needs effort max with it on", () => {
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    const affordable = verdict(
      { effort: "high", model: "cc-smart-dev-kit-worker", prompt: "build" },
      on,
    );
    expect(affordable.decision).toBe("deny");
    expect(affordable.reason).toContain("an affordable gateway slot");
    expect(affordable.reason).toContain('pass `effort: "max"`');
    expect(
      verdict({ effort: "max", model: "cc-smart-dev-kit-worker", prompt: "build" }, on).decision,
    ).toBe("allow");
    expect(
      verdict({ effort: "high", model: "cc-smart-dev-kit-worker", prompt: "build" }).decision,
    ).toBe("allow");
  });

  it("a name the guard does not know is never affordable: the strictest rule answers", () => {
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    // Only a slot key and a `<backend>:<model>` target count as affordable: an unknown name
    // could be anything, so it is judged like a Claude id with no family to read.
    for (const model of ["best", "opusplan", "default", "inherit", "gpt-5", "some-custom-model"]) {
      const result = verdict({ effort: "max", model, prompt: "build it" }, on);
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("This launch would run on Claude Opus");
    }
    const asked = verdict({
      effort: "xhigh",
      model: "opusplan",
      prompt: "Opus reason: debugging - it is",
    });
    expect(asked.decision).toBe("ask");
    expect(asked.real?.family).toBeNull();
    // A fork's session model follows the same rule: a family name is that family, an unknown
    // name is the strict one.
    const fork = (sessionModel: string) =>
      verdict(
        { prompt: "x", subagent_type: "fork" },
        { config: null, gatewayOn: false, sessionModel },
      );
    expect(fork("sonnet").decision).toBe("allow");
    expect(fork("best").decision).toBe("deny");
    expect(fork("best").real?.family).toBeNull();
  });

  it("Fable: a read-only agent with a reason line asks the person; a builder needs the word `build`", () => {
    const plan = verdict({
      effort: "max",
      model: "fable",
      prompt: "Plan the rewrite.\nFable reason: rewrite - the editor is being replaced",
      subagent_type: "Plan",
    });
    expect(plan.decision).toBe("ask");
    expect(plan.reason).toContain("Fable reason: rewrite - the editor is being replaced");
    expect(plan.why).toBe("fable:rewrite");
    const builder = verdict({
      effort: "max",
      model: "fable",
      prompt: "Fable reason: hard - it is hard",
      subagent_type: "general-purpose",
    });
    expect(builder.decision).toBe("deny");
    expect(builder.reason).toContain("Fable reason: build");
  });

  it("Fable: `unsatisfied` on a read-only type asks, and the ask names that reason", () => {
    const fresh = verdict({
      effort: "max",
      model: "fable",
      prompt: "Fable reason: unsatisfied - the person did not like the first layout",
      subagent_type: "Plan",
    });
    expect(fresh.decision).toBe("ask");
    expect(fresh.reason).toContain(
      "Fable reason: unsatisfied - the person did not like the first layout",
    );
    expect(fresh.why).toBe("fable:unsatisfied");
  });

  it("Fable: a builder with `Fable reason: build` asks the person, and the ask says it builds", () => {
    const built = verdict({
      effort: "max",
      model: "fable",
      prompt: "Fable reason: build - the person asked Fable to write the migration",
      subagent_type: "general-purpose",
    });
    expect(built.decision).toBe("ask");
    expect(built.reason).toContain("general-purpose");
    expect(built.reason).toContain("will build here");
    expect(built.reason).toContain(
      "Fable reason: build - the person asked Fable to write the migration",
    );
    expect(built.why).toBe("fable:build");
    // A builder with any other word — or none — is refused, and the message names the line it
    // needs. The person asked is the only way Fable builds.
    for (const prompt of [
      "Fable reason: hard - it is",
      "Fable reason: unsatisfied - the layout",
      "build it",
    ]) {
      const refused = verdict({ effort: "max", model: "fable", prompt, subagent_type: "Task" });
      expect(refused.decision).toBe("deny");
      expect(refused.reason).toContain("Fable reason: build - <what the person asked>");
    }
  });

  it("Fable: `build` on a read-only type is denied — that word is the builder's own", () => {
    const refused = verdict({
      effort: "max",
      model: "fable",
      prompt: "Fable reason: build - the person wants Fable on this plan",
      subagent_type: "Explore",
    });
    expect(refused.decision).toBe("deny");
    // The refusal lists the read-only words, and names `build` as the builder's own line.
    expect(refused.reason).toContain(
      "Fable reason: <hard|rewrite|ui-design|architecture|review|plan|unsatisfied> - <why>",
    );
    expect(refused.reason).toContain("Fable reason: build - <what the person asked>");
  });

  it("a fork is judged on the session's model, never on the model it names", () => {
    // Claude Code ignores a `model` a fork is given (`docs/claude-code-contract.md`): a fork
    // naming Haiku in a Fable session still runs on Fable, so the Fable rules judge it.
    const fableSession: GuardContext = { config: null, gatewayOn: false, sessionModel: "fable" };
    const bare = verdict(
      { effort: "high", model: "haiku", prompt: "do it", subagent_type: "fork" },
      fableSession,
    );
    expect(bare.decision).toBe("deny");
    expect(bare.reason).toContain("Fable reason: build");
    expect(bare.real?.tier).toBe("fable");
    const built = verdict(
      { effort: "high", model: "haiku", prompt: "Fable reason: build - x", subagent_type: "fork" },
      fableSession,
    );
    expect(built.decision).toBe("ask");
    expect(built.real?.tier).toBe("fable");
    // A fork naming Sonnet in an Opus session runs on Opus: with no reason line, denied.
    const opusSession: GuardContext = {
      config: null,
      gatewayOn: false,
      sessionModel: "claude-opus-5-5",
    };
    const named = verdict(
      { effort: "high", model: "sonnet", prompt: "do it", subagent_type: "fork" },
      opusSession,
    );
    expect(named.decision).toBe("deny");
    expect(named.reason).toContain("Opus reason: <security|money|");
    expect(named.real?.tier).toBe("opus");
    expect(named.real?.model).toBe("claude-opus-5-5");
  });

  it("a review whose model the guard cannot read asks about that reading", () => {
    // The review shortcut needs a model the guard can really read as Opus (owner, 2026-10-16):
    // an unreadable name asks about the reading instead of passing on a guess or denying it.
    const asked = verdict({
      effort: "xhigh",
      model: "best",
      prompt: "r",
      subagent_type: "Reviewer",
    });
    expect(asked.decision).toBe("ask");
    expect(asked.reason).toContain("A review on `best` at effort `xhigh`");
    expect(asked.reason).toContain("cannot read the model behind it as Claude Opus");
    expect(asked.why).toBe("opus:review-unreadable");
    // A review on a readable Opus stays allowed with no question.
    expect(
      verdict({ effort: "high", model: "opus", prompt: "r", subagent_type: "Reviewer" }).decision,
    ).toBe("allow");
  });

  it("every premium ask at effort max says so; Sonnet, Haiku and a slot stay silent", () => {
    const review = verdict({
      effort: "max",
      model: "opus",
      prompt: "r",
      subagent_type: "Reviewer",
    });
    expect(review.reason).toContain("at effort `max`");
    const opus = verdict({
      effort: "max",
      model: "opus",
      prompt: "Opus reason: architecture - it is",
    });
    expect(opus.reason).toContain("at effort `max`");
    const fable = verdict({
      effort: "max",
      model: "fable",
      prompt: "Fable reason: hard - it is",
      subagent_type: "Plan",
    });
    expect(fable.reason).toContain("at effort `max`");
    const built = verdict({
      effort: "max",
      model: "fable",
      prompt: "Fable reason: build - x",
      subagent_type: "general-purpose",
    });
    expect(built.reason).toContain("at effort `max`");
    // No gate for these: max is a silent allow.
    for (const model of ["sonnet", "haiku", "cc-smart-dev-kit-worker"]) {
      expect(verdict({ effort: "max", model, prompt: "build" }).decision).toBe("allow");
    }
  });

  it("Fable: a fork of a Fable session needs `build` too; without a line it is denied", () => {
    // A fork runs on the session's own model and can change files, so it is a builder: a
    // session on Fable could not fork at all before this rule.
    const fableSession: GuardContext = { config: null, gatewayOn: false, sessionModel: "fable" };
    const built = verdict(
      { prompt: "Fable reason: build - the person asked for it", subagent_type: "fork" },
      fableSession,
    );
    expect(built.decision).toBe("ask");
    expect(built.real?.family).toBe("fable");
    expect(built.reason).toContain("will build here");
    // A fork names no effort: it runs at the session's own, and the ask says so (not "at effort ``").
    expect(built.reason).toContain("`fork` will build here, at the session's own effort,");
    const bare = verdict({ prompt: "do it", subagent_type: "fork" }, fableSession);
    expect(bare.decision).toBe("deny");
    expect(bare.reason).toContain("Fable reason: build");
    // The full id a transcript names resolves to the same family.
    const byId = verdict(
      { prompt: "Fable reason: build - go", subagent_type: "fork" },
      { config: null, gatewayOn: false, sessionModel: "claude-fable-5-1" },
    );
    expect(byId.decision).toBe("ask");
  });

  it("Fable: `build` in a session nobody watches (`claude -p`) is denied", () => {
    const result = verdict(
      {
        effort: "max",
        model: "fable",
        prompt: "Fable reason: build - the person asked",
        subagent_type: "general-purpose",
      },
      CTX,
      { CLAUDE_CODE_SESSION_ATTENDED: "0" },
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("nobody to answer");
  });

  it("the Fable refusal lists the read-only words, `unsatisfied` included, and `build` apart", () => {
    // No reason line at all, and a word nobody listed: the same refusal, and it never offers
    // `build` as a read-only word — a Builder's line is named separately (owner, 2026-10-16).
    for (const prompt of ["help", "Fable reason: because"]) {
      const refused = verdict({ effort: "max", model: "fable", prompt, subagent_type: "Explore" });
      expect(refused.decision).toBe("deny");
      expect(refused.reason).toContain(
        "Fable reason: <hard|rewrite|ui-design|architecture|review|plan|unsatisfied> - <why>",
      );
      expect(refused.reason).toContain("unsatisfied");
      expect(refused.reason).not.toContain("unsatisfied|build");
      expect(refused.reason).toContain("Fable reason: build - <what the person asked>");
    }
  });

  it("Fable: no reason line is denied; a reason word nobody listed too", () => {
    expect(
      verdict({ effort: "max", model: "fable", prompt: "help", subagent_type: "Explore" }).decision,
    ).toBe("deny");
    expect(
      verdict({
        effort: "max",
        model: "fable",
        prompt: "Fable reason: because",
        subagent_type: "Explore",
      }).decision,
    ).toBe("deny");
  });

  it("Fable in a session nobody watches (CLAUDE_CODE_SESSION_ATTENDED=0): denied", () => {
    const result = verdict(
      {
        effort: "max",
        model: "fable",
        prompt: "Fable reason: hard - it is",
        subagent_type: "Plan",
      },
      CTX,
      { CLAUDE_CODE_SESSION_ATTENDED: "0" },
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("nobody to answer");
  });

  it("the two lists are configurable through the environment", () => {
    const readOnly = verdict(
      {
        effort: "max",
        model: "fable",
        prompt: "Fable reason: plan - yes",
        subagent_type: "cc-smart-dev-kit:ui-verifier",
      },
      CTX,
      { CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS: "UI Verifier" },
    );
    expect(readOnly.decision).toBe("ask");
    const review = verdict(
      {
        effort: "high",
        model: "opus",
        prompt: "check it",
        subagent_type: "my-auditor",
      },
      CTX,
      { CC_SMART_DEV_KIT_AGENT_GUARD_REVIEW_AGENTS: "my-auditor" },
    );
    expect(review.decision).toBe("allow");
    expect(review.why).toBe("review");
  });

  it("the old tool name `Task` is read the same way, and another tool is not read at all", () => {
    const task = readLaunch(agentCall({ effort: "high", model: "sonnet", prompt: "x" }, "Task"));
    expect(task?.tool).toBe("Task");
    expect(readLaunch(agentCall({ command: "ls" }, "Bash"))).toBeNull();
  });

  it("reasonLine reads only a line of its own, whatever the case", () => {
    expect(reasonLine("a\nFable reason: hard - why\nb", "Fable reason")).toBe("hard - why");
    expect(reasonLine("fable reason: hard - why", "Fable reason")).toBe("hard - why");
    expect(reasonLine("say Fable reason: hard", "Fable reason")).toBeNull();
  });
});

describe("tiers, not vendors (owner, 2026-10-16)", () => {
  // `opus` and `fable` mean the TIER: an override that points one at a backend keeps its gates,
  // and it is never affordable, never forced to `max`, and always named with what answers it.
  const OPENAI_OPUS = { ANTHROPIC_DEFAULT_OPUS_MODEL: "openai:gpt-5.5" };
  const OPENAI_FABLE = { ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5" };
  const ON: GuardContext = { config: null, gatewayOn: true, sessionModel: null };

  it("`opus` over a backend keeps the Opus gate, and the affordable rule never applies", () => {
    const bare = verdict({ effort: "high", model: "opus", prompt: "do it" }, ON, OPENAI_OPUS);
    expect(bare.decision).toBe("deny");
    expect(bare.reason).toContain("`opus` (answered by openai:gpt-5.5)");
    expect(bare.reason).toContain("Opus reason: <security|money|");
    // With the gateway on, a missing `max` is never a reason for a tier.
    expect(bare.reason).not.toContain("affordable");
    const asked = verdict(
      { effort: "high", model: "opus", prompt: "Opus reason: architecture - it is" },
      ON,
      OPENAI_OPUS,
    );
    expect(asked.decision).toBe("ask");
    expect(asked.reason).toContain("`opus` (answered by openai:gpt-5.5)");
    // A review on the tier: allowed at high, an ask at max, naming the model behind it.
    expect(
      verdict(
        { effort: "high", model: "opus", prompt: "r", subagent_type: "Reviewer" },
        ON,
        OPENAI_OPUS,
      ).decision,
    ).toBe("allow");
    const deep = verdict(
      { effort: "max", model: "opus", prompt: "r", subagent_type: "Reviewer" },
      ON,
      OPENAI_OPUS,
    );
    expect(deep.decision).toBe("ask");
    expect(deep.reason).toContain("`opus` (answered by openai:gpt-5.5)");
    expect(deep.reason).toContain("at effort `max`");
    expect(deep.why).toBe("opus:review-max");
  });

  it("`fable` over a backend keeps the Fable gate: a builder needs `build`", () => {
    const built = verdict(
      {
        effort: "high",
        model: "fable",
        prompt: "Fable reason: build - the person asked",
        subagent_type: "general-purpose",
      },
      ON,
      OPENAI_FABLE,
    );
    expect(built.decision).toBe("ask");
    expect(built.reason).toContain("`fable` (answered by openai:gpt-5.5)");
    expect(built.reason).toContain("at effort `high`");
    const bare = verdict(
      { effort: "high", model: "fable", prompt: "do it", subagent_type: "general-purpose" },
      ON,
      OPENAI_FABLE,
    );
    expect(bare.decision).toBe("deny");
    expect(bare.reason).toContain("Fable reason: build - <what the person asked>");
    // A read-only agent on the tier keeps the read-only words.
    const advice = verdict(
      { effort: "high", model: "fable", prompt: "Fable reason: plan - yes", subagent_type: "Plan" },
      ON,
      OPENAI_FABLE,
    );
    expect(advice.decision).toBe("ask");
    expect(advice.why).toBe("fable:plan");
  });

  it("a fork of a session on the fable tier's backend keeps the Fable rules", () => {
    const session: GuardContext = {
      config: null,
      gatewayOn: false,
      sessionModel: "openai:gpt-5.5",
    };
    const built = verdict(
      { prompt: "Fable reason: build - the person asked", subagent_type: "fork" },
      session,
      OPENAI_FABLE,
    );
    expect(built.decision).toBe("ask");
    expect(built.real?.tier).toBe("fable");
    expect(built.reason).toContain("`fable` (answered by openai:gpt-5.5)");
    const bare = verdict({ prompt: "do it", subagent_type: "fork" }, session, OPENAI_FABLE);
    expect(bare.decision).toBe("deny");
    expect(bare.reason).toContain("Fable reason: build");
    // The same id with no override naming it is an ordinary affordable target.
    const affordable = verdict({ prompt: "do it", subagent_type: "fork" }, session, NO_ENV);
    expect(affordable.decision).toBe("allow");
    expect(affordable.real?.tier).toBeNull();
  });
});

describe("a Workflow script", () => {
  it("reads each agent(…) call: its model, effort, agentType, label and literal prompt", () => {
    const script = [
      "export const meta = { name: 'probe', description: 'x' };",
      'const a = await agent("Say the word: ready.\\nOpus reason: debugging - go", { label: "one", model: "opus", effort: "xhigh" });',
      "const b = await agent(promptFrom(a), { label: 'two', model: 'haiku', effort: 'low', agentType: 'Explore' });",
    ].join("\n");
    expect(readWorkflowScript(script)).toEqual([
      {
        agentType: null,
        effort: "xhigh",
        model: "opus",
        prompt: "Say the word: ready.\nOpus reason: debugging - go",
        where: "one",
      },
      {
        agentType: "Explore",
        effort: "low",
        model: "haiku",
        prompt: null,
        where: "two",
      },
    ]);
  });

  it("the word `agent(` inside a prompt, a string or a comment is not a call", () => {
    const script = [
      "// agent(prompt, { model: 'opus' }) in a comment is not a call",
      'const note = "call agent(x) when done";',
      'await agent("Say agent(nothing) here.", { model: "haiku", effort: "low" });',
    ].join("\n");
    expect(readWorkflowScript(script)).toEqual([
      {
        agentType: null,
        effort: "low",
        model: "haiku",
        prompt: "Say agent(nothing) here.",
        where: "Say agent(nothing) here.",
      },
    ]);
    // None of them is a use of `agent` either: the call stands, nothing refuses the Workflow.
    expect(workflowRefusal(script)).toBeNull();
  });

  it("judges every launch of the call: a heavy one denies the whole Workflow call", () => {
    const script = [
      'await agent("build it", { model: "sonnet", effort: "high" });',
      'await agent("do it", { model: "opus", effort: "high" });',
    ].join("\n");
    const results = judgeWorkflow(script, CTX, NO_ENV);
    expect(results.map((one) => one.verdict.decision)).toEqual(["allow", "deny"]);
    const answer = JSON.parse(
      agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app").stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain('In this workflow, the launch "do it"');
    expect(answer.permissionDecisionReason).toContain("Opus is for reviews");
  });

  it("a Fable launch with a reason line asks; the ask names the launch", () => {
    const script =
      'await agent("Plan the rewrite.\\nFable reason: rewrite - the editor", { label: "plan", model: "fable", effort: "max", agentType: "Plan" });';
    const answer = JSON.parse(
      agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app").stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("ask");
    expect(answer.permissionDecisionReason).toContain('the launch "plan"');
    expect(answer.permissionDecisionReason).toContain("Fable advises");
  });

  it("an ask names every launch of the script that asks, not only the first", () => {
    const script = [
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });',
      'await agent("Fable reason: build - write it", { label: "builder", model: "fable", effort: "max", agentType: "general-purpose" });',
    ].join("\n");
    const answer = JSON.parse(
      agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app").stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("ask");
    expect(answer.permissionDecisionReason).toContain('the launch "advice"');
    expect(answer.permissionDecisionReason).toContain('the launch "builder"');
  });

  it("an ask that rests on the effort, not the prompt, survives a built prompt", () => {
    // The review at `max` asks for the effort: a prompt the guard cannot read does not matter.
    const review =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its prompt.
      'await agent(`review ${x}`, { agentType: "Reviewer", model: "opus", effort: "max", label: "deep" });';
    const deep = judgeWorkflow(review, CTX, NO_ENV);
    expect(deep[0]?.verdict.decision).toBe("ask");
    expect(deep[0]?.verdict.why).toBe("opus:review-max");
    // A reason-line ask in the same shape is refused instead: there is nothing to approve.
    const advice =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its prompt.
      'await agent(`why ${x}`, { agentType: "Plan", model: "fable", effort: "max", label: "advice" });';
    const refused = judgeWorkflow(advice, CTX, NO_ENV);
    expect(refused[0]?.verdict.decision).toBe("deny");
    expect(refused[0]?.verdict.reason).toContain("prompt is built at run time");
  });

  it("a launch whose model or prompt is not a literal: denied, never guessed", () => {
    const model = judgeWorkflow(
      'await agent("x", { model: chosen, effort: "high" });',
      CTX,
      NO_ENV,
    );
    expect(model[0]?.verdict.decision).toBe("deny");
    expect(model[0]?.verdict.reason).toContain("names no `model` the guard can read");
    const prompt = judgeWorkflow(
      'await agent(thePrompt, { model: "opus", effort: "high" });',
      CTX,
      NO_ENV,
    );
    expect(prompt[0]?.verdict.decision).toBe("deny");
    expect(prompt[0]?.verdict.reason).toContain("prompt is built at run time");
  });

  it("a backtick literal that builds its text is not a literal: denied, never guessed", () => {
    const model = judgeWorkflow(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its model.
      'await agent("x", { model: `op${n}`, effort: "high" });',
      CTX,
      NO_ENV,
    );
    expect(model[0]?.verdict.decision).toBe("deny");
    expect(model[0]?.verdict.reason).toContain("names no `model` the guard can read");
    // A backtick literal with no placeholder is a fixed string, and read like any other.
    expect(
      judgeWorkflow('await agent("x", { model: `haiku`, effort: "high" });', CTX, NO_ENV)[0]
        ?.verdict.decision,
    ).toBe("allow");
    const prompt = judgeWorkflow(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its prompt.
      'await agent(`fix ${file}`, { model: "opus", effort: "high" });',
      CTX,
      NO_ENV,
    );
    expect(prompt[0]?.verdict.decision).toBe("deny");
    expect(prompt[0]?.verdict.reason).toContain("prompt is built at run time");
  });

  it("`agent` handed around refuses the whole Workflow: nothing it launches can be read", () => {
    const script = [
      'const run = agent;\nawait run("x", { model: "opus", effort: "high" });',
      'await agent?.("x", { model: "haiku", effort: "low" });',
      'const helpers = [agent];\nawait helpers[0]("x", { model: "haiku", effort: "low" });',
      // A use inside a template literal's placeholder is code too: the scan reads it.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture hands `agent` around inside a template.
      "const label = `run: ${agent}`;\nexport const meta = { label };",
    ].join("\n");
    const refusal = workflowRefusal(script);
    expect(refusal).toContain("without calling it at once");
    // The first one is named by its line, so the script can be fixed.
    expect(refusal).toContain("(line 1)");
    const answer = JSON.parse(
      agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app").stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain("never reaches a hook");
    expect(answer.permissionDecisionReason).toContain('agent("<prompt>"');
  });

  it("options built at run time refuse the whole Workflow: the literal read can be replaced", () => {
    const scripts = [
      'await agent("x", { model: "haiku", effort: "low", ["model"]: "opus" });',
      'await agent("x", { model: "haiku", effort: "low", ...overrides });',
      // The same option twice: JavaScript keeps the last, the guard would read the first.
      'await agent("x", { model: "haiku", effort: "low", model: "opus" });',
    ];
    for (const script of scripts) {
      expect(workflowRefusal(script)).toContain("cannot be read");
      const answer = JSON.parse(
        agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app").stdout ?? "{}",
      ).hookSpecificOutput;
      expect(answer.permissionDecision).toBe("deny");
      expect(answer.permissionDecisionReason).toContain("not what they seem");
    }
    // A `[` that is a value, not a key: an array option is not a computed key.
    expect(
      workflowRefusal('await agent("x", { model: "haiku", effort: "low", list: [1, 2] });'),
    ).toBeNull();
    // A comment is not code either: the `...` a person writes in one is not a spread.
    expect(
      workflowRefusal('await agent("x", { model: "haiku", effort: "low" /* ... */ });'),
    ).toBeNull();
    expect(
      workflowRefusal('await agent("x", {\n  model: "haiku", // ...\n  effort: "low"\n});'),
    ).toBeNull();
  });

  it("a direct call is read wherever it is written: in a helper, in a template's placeholder", () => {
    const helper = [
      "async function one(file) {",
      '  return agent("fix " + file, { model: "opus", effort: "high" });',
      "}",
    ].join("\n");
    expect(workflowRefusal(helper)).toBeNull();
    expect(judgeWorkflow(helper, CTX, NO_ENV)[0]?.verdict.decision).toBe("deny");
    const inTemplate =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture calls `agent` inside a template.
      'const done = `result: ${await agent("x", { model: "haiku", effort: "high" })}`;';
    expect(workflowRefusal(inTemplate)).toBeNull();
    expect(judgeWorkflow(inTemplate, CTX, NO_ENV).map((one) => one.verdict.decision)).toEqual([
      "allow",
    ]);
  });

  it("a Workflow agent() at `low` is refused, on every model; `medium` is allowed (D5)", () => {
    const script = [
      'await agent("search it", { label: "scout", model: "haiku", effort: "low" });',
      'await agent("build it", { label: "worker", model: "cc-smart-dev-kit-worker", effort: "low" });',
      'await agent("read it", { label: "reader", model: "haiku", effort: "medium" });',
      'await agent("check it", { label: "audit", model: "sonnet", effort: "high" });',
    ].join("\n");
    const results = judgeWorkflow(script, CTX, NO_ENV);
    expect(results.map((one) => one.verdict.decision)).toEqual(["deny", "deny", "allow", "allow"]);
    expect(results[0]?.verdict.reason).toContain("asks for effort `low`");
    expect(results[1]?.verdict.reason).toContain("asks for effort `low`");
    const answer = JSON.parse(
      agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app").stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain('the launch "scout"');
    expect(answer.permissionDecisionReason).toContain("asks for effort `low`");
  });

  it("a script with no agent(…) call, or no script at all: nothing to say", () => {
    expect(judgeWorkflow("export const meta = {};", CTX, NO_ENV)).toEqual([]);
    expect(agentGuard(workflowCall("return 1;"), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).toEqual({});
    expect(
      agentGuard(
        { hook_event_name: "PreToolUse", tool_input: {}, tool_name: "Workflow" },
        NO_ENV,
        WORKFLOW_PATHS,
        "/tmp/app",
      ),
    ).toEqual({});
  });
});

describe("the hook's answer, and the record", () => {
  function paths(): CliPaths {
    const home = tempDir("guard-home");
    return cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  }

  it("denied: a PreToolUse deny on stdout, and nothing recorded", () => {
    const where = paths();
    const result = agentGuard(
      agentCall({ effort: "high", model: "opus", prompt: "x" }),
      NO_ENV,
      where,
      "/tmp/app",
    );
    const answer = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
  });

  it("allowed: silent, and the Opus launch is recorded with its reason", () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const result = agentGuard(
      agentCall({
        effort: "high",
        model: "opus",
        prompt: "review it",
        subagent_type: "Reviewer",
      }),
      NO_ENV,
      where,
      "/tmp/app",
    );
    expect(result).toEqual({});
    const [launch] = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launch?.family).toBe("opus");
    expect(launch?.reason).toBe("review");
    expect(launch?.project).toBe("/tmp/app");
    expect(launch?.subagentType).toBe("Reviewer");
  });

  it("an asked Opus launch is recorded once it ran, even when the hook runs twice for one call", () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const input = {
      ...agentCall({
        effort: "xhigh",
        model: "opus",
        prompt: "Opus reason: debugging - the router hangs",
      }),
      session_id: "11111111-2222-3333-4444-555555555555",
      tool_use_id: "toolu_1",
    };
    const ran = { ...input, hook_event_name: "PostToolUse" };
    const asked = agentGuard(input, NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // A build that ran PreToolUse again for the same call records nothing either: the person
    // has not answered.
    agentGuard(input, NO_ENV, where, "/tmp/app");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    // It ran: one record, even when PostToolUse runs twice with the same tool_use_id.
    agentGuard(ran, NO_ENV, where, "/tmp/app");
    agentGuard(ran, NO_ENV, where, "/tmp/app");
    const launches = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.reason).toBe("opus:debugging");
    expect(launches[0]?.toolUseId).toBe("toolu_1");
    // Another tool call in the same session is a second launch.
    agentGuard({ ...ran, tool_use_id: "toolu_2" }, NO_ENV, where, "/tmp/app");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toHaveLength(2);
  });

  it("a Workflow denied as a whole records none of its launches; an ask records them once it ran", () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const denied = [
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });',
      'await agent("do it", { label: "plain", model: "opus", effort: "high" });',
    ].join("\n");
    const answer = JSON.parse(
      agentGuard(workflowCall(denied), NO_ENV, where, "/tmp/app").stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    // The whole call was refused, so nothing in it ran: no launch of it is recorded, not even
    // by a PostToolUse run.
    agentGuard({ ...workflowCall(denied), hook_event_name: "PostToolUse" }, NO_ENV, where, "/a");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    const asked =
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });';
    const second = JSON.parse(
      agentGuard(workflowCall(asked), NO_ENV, where, "/tmp/app").stdout ?? "{}",
    ).hookSpecificOutput;
    expect(second.permissionDecision).toBe("ask");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    agentGuard({ ...workflowCall(asked), hook_event_name: "PostToolUse" }, NO_ENV, where, "/a");
    const launches = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.reason).toBe("fable:plan");
  });

  it("a Fable build launch is recorded once with its reason, `fable:build`", () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const input = {
      ...agentCall({
        effort: "max",
        model: "fable",
        prompt: "Fable reason: build - the person asked Fable to write the migration",
        subagent_type: "general-purpose",
      }),
      session_id: "11111111-2222-3333-4444-555555555555",
      tool_use_id: "toolu_build",
    };
    const asked = agentGuard(input, NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    const ran = { ...input, hook_event_name: "PostToolUse" };
    agentGuard(ran, NO_ENV, where, "/tmp/app");
    const launches = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.family).toBe("fable");
    expect(launches[0]?.reason).toBe("fable:build");
    expect(launches[0]?.subagentType).toBe("general-purpose");
    // The hook runs twice for one call: one record, not two.
    agentGuard(ran, NO_ENV, where, "/tmp/app");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toHaveLength(1);
  });

  it("a deeper review at effort max is recorded as `opus:review-max`, so `usage` lists it", () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const call = agentCall({
      effort: "max",
      model: "opus",
      prompt: "review it",
      subagent_type: "Reviewer",
    });
    const result = agentGuard(call, NO_ENV, where, "/tmp/app");
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    agentGuard({ ...call, hook_event_name: "PostToolUse" }, NO_ENV, where, "/tmp/app");
    const [launch] = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launch?.family).toBe("opus");
    expect(launch?.reason).toBe("opus:review-max");
    expect(launch?.subagentType).toBe("Reviewer");
  });

  it("a Sonnet launch is not recorded, and a record of another shape is skipped", () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    agentGuard(
      agentCall({ effort: "high", model: "sonnet", prompt: "x" }),
      NO_ENV,
      where,
      "/tmp/app",
    );
    writeFileSync(agentLaunchesFile(where.stateDir), '{"at":"x"}\nnot json\n');
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
  });

  it("guardFacts names the verdict, so doctor --live can prove it", () => {
    const where = paths();
    const input = agentCall({
      effort: "max",
      model: "fable",
      prompt: "Fable reason: hard - it is",
      subagent_type: "Plan",
    });
    const facts = guardFacts(input, { env: NO_ENV, paths: where });
    expect(facts).toEqual({
      decision: "ask",
      effort: "max",
      family: "fable",
      fork: false,
      model: "fable",
      subagent_type: "Plan",
      tier: "fable",
      tool: "Agent",
      why: "fable:hard",
    });
    // The tier an override answers with is the tier the guard judged by.
    const overridden = guardFacts(agentCall({ effort: "high", model: "opus", prompt: "do it" }), {
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "openai:gpt-5.5" },
      paths: where,
    });
    expect(overridden).toEqual({
      decision: "deny",
      effort: "high",
      family: "opus",
      fork: false,
      model: "opus",
      subagent_type: null,
      tier: "opus",
      tool: "Agent",
    });
  });

  it("a record of another day is not in the window", () => {
    expect(
      parseAgentLaunch(JSON.stringify({ at: 1, family: "opus", model: "m", reason: "review" })),
    ).toEqual({
      at: 1,
      family: "opus",
      model: "m",
      project: "",
      reason: "review",
      session: "",
      subagentType: "",
      toolUseId: "",
    });
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    writeFileSync(
      agentLaunchesFile(where.stateDir),
      `${JSON.stringify({ at: 1, family: "fable", model: "m", reason: "fable:plan" })}\n`,
    );
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 2)).toEqual([]);
    expect(readFileSync(agentLaunchesFile(where.stateDir), "utf8")).toContain("fable:plan");
  });
});

describe("the family's slot decides (0.5.0: no model is pinned in Claude Code's settings)", () => {
  // The machine as the hook reads it: `gateway.json` through the gateway's own reader, and
  // Claude Code's settings for `ANTHROPIC_BASE_URL`. No `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` and
  // no `modelSlots` anywhere: the router sends a Claude model to its family's slot by itself.
  function machine(slots: Record<string, string[]>, gatewayOn: boolean): CliPaths {
    const home = tempDir("guard-family");
    const where = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(join(where.gatewayConfigFile, ".."), { recursive: true });
    writeFileSync(
      where.gatewayConfigFile,
      JSON.stringify({
        backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
        slots,
        version: 1,
      }),
      { mode: 0o600 },
    );
    mkdirSync(join(where.settingsFile, ".."), { recursive: true });
    writeFileSync(
      where.settingsFile,
      JSON.stringify(gatewayOn ? { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:39999" } } : {}),
    );
    mkdirSync(where.stateDir, { recursive: true });
    return where;
  }

  /** The hook's PreToolUse answer for one Agent call; null when it stays silent (allowed). */
  function answer(where: CliPaths, fields: Record<string, unknown>) {
    const result = agentGuard(agentCall(fields), NO_ENV, where, "/tmp/app");
    if (result.stdout === undefined || result.stdout === "") return null;
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    return {
      decision: output.permissionDecision as string,
      reason: output.permissionDecisionReason as string,
    };
  }

  const WORKER_ON_BACKEND = { "cc-smart-dev-kit-worker": ["omniroute:glm-x"] };

  it("a sonnet launch on a worker chain that starts with a backend is affordable: effort max", () => {
    const where = machine(WORKER_ON_BACKEND, true);
    expect(answer(where, { effort: "high", model: "sonnet", prompt: "build it" })).toEqual({
      decision: "deny",
      reason: [
        "This launch runs on omniroute:glm-x, an affordable gateway slot.",
        'An affordable slot runs at effort `max` (its reasoning costs cents): pass `effort: "max"`.',
      ].join("\n"),
    });
    expect(answer(where, { effort: "max", model: "sonnet", prompt: "build it" })).toBeNull();
    // The full id goes to the same slot: the router reads the family, not the exact id.
    expect(
      answer(where, { effort: "xhigh", model: "claude-sonnet-9-9", prompt: "build it" })?.decision,
    ).toBe("deny");
    // Haiku's slot is the scout: with no scout chain, a haiku launch is Claude Haiku.
    expect(answer(where, { effort: "high", model: "haiku", prompt: "search" })).toBeNull();
  });

  it("no worker chain, a chain that starts with Claude, or the gateway off: Claude Sonnet", () => {
    for (const where of [
      machine({ "cc-smart-dev-kit-scout": ["omniroute:glm-x"] }, true),
      machine({ "cc-smart-dev-kit-worker": ["claude-sonnet-5-5", "omniroute:glm-x"] }, true),
      machine(WORKER_ON_BACKEND, false),
    ]) {
      expect(answer(where, { effort: "high", model: "sonnet", prompt: "build it" })).toBeNull();
    }
    // With the gateway off nothing reaches the router: an opus chain there answers nothing, and
    // the launch is named for the Claude model that runs it.
    const off = machine({ "cc-smart-dev-kit-opus": ["omniroute:glm-x"] }, false);
    expect(answer(off, { effort: "high", model: "opus", prompt: "do it" })?.reason).toContain(
      "This launch would run on Claude Opus.",
    );
  });

  it("opus and fable keep their gates by name when their slot starts with a backend", () => {
    const where = machine(
      {
        "cc-smart-dev-kit-fable": ["omniroute:glm-x"],
        "cc-smart-dev-kit-opus": ["omniroute:glm-x"],
      },
      true,
    );
    // Never affordable, never forced to `max`: the Opus rule, naming what answers it.
    const bare = answer(where, { effort: "max", model: "opus", prompt: "do it" });
    expect(bare?.decision).toBe("deny");
    expect(bare?.reason).toContain(
      "This launch would run on `opus` (answered by omniroute:glm-x).",
    );
    expect(bare?.reason).toContain("Opus reason: <security|money|");
    expect(bare?.reason).not.toContain("affordable");
    // A review on the tier at high: allowed with no question, as before.
    expect(
      answer(where, { effort: "high", model: "opus", prompt: "r", subagent_type: "Reviewer" }),
    ).toBeNull();
    const asked = answer(where, {
      effort: "high",
      model: "opus",
      prompt: "Opus reason: debugging - it is",
    });
    expect(asked?.decision).toBe("ask");
    expect(asked?.reason).toContain(
      "`opus` (answered by omniroute:glm-x) launch: not a review, at effort `high`",
    );
    // Fable: a read-only agent with its reason asks, naming what answers it; a builder without
    // the word `build` is refused.
    const advice = answer(where, {
      effort: "high",
      model: "fable",
      prompt: "Fable reason: plan - yes",
      subagent_type: "Plan",
    });
    expect(advice?.decision).toBe("ask");
    expect(advice?.reason).toContain("`fable` (answered by omniroute:glm-x) launch: a read-only");
    expect(
      answer(where, { effort: "max", model: "fable", prompt: "do it", subagent_type: "x" })
        ?.decision,
    ).toBe("deny");
    // The record names the tier and the model that answered it.
    const [record] = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(record?.family).toBe("opus");
    expect(record?.model).toBe("omniroute:glm-x");
  });
});

describe("the 0.6.0 audit fixes (C3)", () => {
  function paths(): CliPaths {
    const home = tempDir("guard-c3");
    const where = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(where.stateDir, { recursive: true });
    return where;
  }

  /** A hook input for one call, as Claude Code builds it at `event`. */
  function at(event: string, input: HookInput): HookInput {
    return {
      ...input,
      hook_event_name: event,
      session_id: "11111111-2222-3333-4444-555555555555",
      tool_use_id: "toolu_c3",
    };
  }

  const records = (where: CliPaths) => readAgentLaunches(agentLaunchesFile(where.stateDir), 0);

  it("IN-2 (D5): a medium scout launch is allowed; `low` is still refused", () => {
    expect(verdict({ effort: "medium", model: "haiku", prompt: "find the file" }).decision).toBe(
      "allow",
    );
    expect(verdict({ effort: "medium", model: "sonnet", prompt: "read it" }).decision).toBe(
      "allow",
    );
    const low = verdict({ effort: "low", model: "haiku", prompt: "find the file" });
    expect(low.decision).toBe("deny");
    expect(low.reason).toBe(
      [
        "This launch asks for effort `low`, which no subagent may run at (the plugin's rule).",
        "A subagent runs at `medium`, `high`, `xhigh` or `max` — never `low`, on any model.",
        "`medium` is for searches and reads, `high` for building and for reviews, and `xhigh` and `max` only when the person asks for them (an affordable gateway slot always runs at `max`).",
      ].join("\n"),
    );
  });

  it("IN-2 (D5): a medium Opus build is asked, like any Opus build with a reason line", () => {
    const build = verdict({
      effort: "medium",
      model: "opus",
      prompt: "Opus reason: security - the token check",
    });
    expect(build.decision).toBe("ask");
    expect(build.reason).toContain("at effort `medium`");
    expect(build.why).toBe("opus:security");
  });

  it("IN-2 (D5): a review runs at `high`; `xhigh` and `max` ask, as a deeper review", () => {
    const review = (effort: string, env = NO_ENV) =>
      verdict({ effort, model: "opus", prompt: "review", subagent_type: "Reviewer" }, CTX, env);
    expect(review("high").decision).toBe("allow");
    expect(review("medium").decision).toBe("allow");
    for (const effort of ["xhigh", "max"]) {
      const deeper = review(effort);
      expect(deeper.decision).toBe("ask");
      expect(deeper.reason).toBe(
        `Claude Opus review at effort \`${effort}\`: a review runs at \`high\` unless you asked for a deeper one. Approve if you did.`,
      );
      expect(deeper.why).toBe(`opus:review-${effort}`);
      // Nobody to answer: refused, with the way out.
      const unattended = review(effort, { CLAUDE_CODE_SESSION_ATTENDED: "0" });
      expect(unattended.decision).toBe("deny");
      expect(unattended.reason).toBe(
        [
          `A review at effort \`${effort}\` is approved by the person, one by one, and this session has nobody to answer (\`claude -p\`).`,
          "Run it at `high`, or in an interactive session.",
        ].join("\n"),
      );
    }
    expect(review("high", { CLAUDE_CODE_SESSION_ATTENDED: "0" }).decision).toBe("allow");
  });

  it("IN-9: an Opus launch with 'Opus reason: research' or 'retry' passes the reason gate", () => {
    for (const word of ["research", "retry"]) {
      const result = verdict({
        effort: "high",
        model: "opus",
        prompt: `Opus reason: ${word} - the question is open`,
      });
      expect(result.decision).toBe("ask");
      expect(result.why).toBe(`opus:${word}`);
    }
    // The refusal teaches both words.
    expect(verdict({ effort: "high", model: "opus", prompt: "do it" }).reason).toContain(
      "Opus reason: <security|money|permissions|schema|deploy|ui|architecture|plan-review|debugging|research|retry>",
    );
  });

  it("IN-24: the deny texts say the plugin's rule, never the owner's or a date", () => {
    const unattended = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    const denials = [
      verdict({ model: "sonnet", prompt: "x" }),
      verdict({ effort: "low", model: "sonnet", prompt: "x" }),
      verdict({ effort: "high", model: "opus", prompt: "x" }),
      verdict({ effort: "high", model: "fable", prompt: "x", subagent_type: "Plan" }),
      verdict({ effort: "high", model: "fable", prompt: "x", subagent_type: "general-purpose" }),
      verdict({ effort: "high", model: "cc-smart-dev-kit-worker", prompt: "x" }, on),
      verdict({ effort: "high", model: "opus", prompt: "Opus reason: ui - x" }, CTX, unattended),
      verdict(
        { effort: "max", model: "opus", prompt: "r", subagent_type: "Reviewer" },
        CTX,
        unattended,
      ),
    ];
    for (const one of denials) {
      expect(one.decision).toBe("deny");
      expect(one.reason).not.toMatch(/owner/i);
      expect(one.reason).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    expect(denials[1]?.reason).toContain("(the plugin's rule)");
    expect(denials[2]?.reason).toContain("Opus is for reviews and the plugin's listed exceptions");
  });

  it("HK hunch 4: trailing punctuation keeps a reason word valid ('Opus reason: security.')", () => {
    for (const line of [
      "Opus reason: security.",
      "Opus reason: security, the token check",
      "Opus reason: security: the token check",
      "Opus reason: `security` - the token check",
      "Opus reason: plan-review.",
    ]) {
      expect(verdict({ effort: "high", model: "opus", prompt: line }).decision).toBe("ask");
    }
    expect(verdict({ effort: "high", model: "opus", prompt: "Opus reason: security." }).why).toBe(
      "opus:security",
    );
    const fable = verdict({
      effort: "high",
      model: "fable",
      prompt: "Fable reason: plan. - a second read",
      subagent_type: "Plan",
    });
    expect(fable.decision).toBe("ask");
    expect(fable.why).toBe("fable:plan");
    // Punctuation never turns an unlisted word into a listed one.
    expect(
      verdict({ effort: "high", model: "opus", prompt: "Opus reason: securityish." }).decision,
    ).toBe("deny");
  });

  it("HK hunch 3: an asked launch is recorded only once it ran (PostToolUse), never on the ask", () => {
    const where = paths();
    const call = agentCall({
      effort: "high",
      model: "opus",
      prompt: "Opus reason: debugging - the router hangs",
    });
    const asked = agentGuard(at("PreToolUse", call), NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // The person has not answered yet: nothing is recorded.
    expect(records(where)).toEqual([]);
    // The call ran, so the person said yes: one record, and the hook says nothing.
    expect(agentGuard(at("PostToolUse", call), NO_ENV, where, "/tmp/app")).toEqual({});
    const launches = records(where);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.reason).toBe("opus:debugging");
    expect(launches[0]?.toolUseId).toBe("toolu_c3");
    // A second PostToolUse run for the same call records nothing new.
    agentGuard(at("PostToolUse", call), NO_ENV, where, "/tmp/app");
    expect(records(where)).toHaveLength(1);
  });

  it("HK hunch 3: an allowed launch is recorded on PreToolUse, and its PostToolUse adds nothing", () => {
    const where = paths();
    const review = agentCall({
      effort: "high",
      model: "opus",
      prompt: "review it",
      subagent_type: "Reviewer",
    });
    expect(agentGuard(at("PreToolUse", review), NO_ENV, where, "/tmp/app")).toEqual({});
    expect(records(where).map((one) => one.reason)).toEqual(["review"]);
    expect(agentGuard(at("PostToolUse", review), NO_ENV, where, "/tmp/app")).toEqual({});
    expect(records(where)).toHaveLength(1);
    // A launch the guard denies records nothing, even on a PostToolUse run.
    const bare = agentCall({ effort: "high", model: "opus", prompt: "do it" });
    agentGuard(at("PostToolUse", bare), NO_ENV, where, "/tmp/app");
    expect(records(where)).toHaveLength(1);
    // A Sonnet launch is never recorded.
    agentGuard(
      at("PostToolUse", agentCall({ effort: "high", model: "sonnet", prompt: "x" })),
      NO_ENV,
      where,
      "/tmp/app",
    );
    expect(records(where)).toHaveLength(1);
  });

  it("HK hunch 3: a Workflow that asks records its launches only once it ran", () => {
    const where = paths();
    const script = [
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });',
      'await agent("review it", { label: "check", model: "opus", effort: "high", agentType: "Reviewer" });',
    ].join("\n");
    const asked = agentGuard(at("PreToolUse", workflowCall(script)), NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // The person may still say no to the whole call: none of its launches is recorded yet,
    // not even the review that needed no question.
    expect(records(where)).toEqual([]);
    expect(agentGuard(at("PostToolUse", workflowCall(script)), NO_ENV, where, "/tmp/app")).toEqual(
      {},
    );
    expect(records(where).map((one) => one.reason)).toContain("fable:plan");
    // A Workflow the guard allows outright is recorded on PreToolUse, and not again after it.
    const quiet = paths();
    const reviewOnly =
      'await agent("review it", { label: "check", model: "opus", effort: "high", agentType: "Reviewer" });';
    expect(
      agentGuard(at("PreToolUse", workflowCall(reviewOnly)), NO_ENV, quiet, "/tmp/app"),
    ).toEqual({});
    expect(records(quiet).map((one) => one.reason)).toEqual(["review"]);
    agentGuard(at("PostToolUse", workflowCall(reviewOnly)), NO_ENV, quiet, "/tmp/app");
    expect(records(quiet)).toHaveLength(1);
  });

  it("HK hunch 3: guardFacts logs no verdict for a PostToolUse run", () => {
    const where = paths();
    const call = agentCall({ effort: "high", model: "opus", prompt: "Opus reason: ui - x" });
    expect(guardFacts(at("PostToolUse", call), { env: NO_ENV, paths: where })).toEqual({
      event: "PostToolUse",
    });
  });

  it("HK hunch 2: `sonnet` whose override answers with Claude Opus is the opus tier", () => {
    const env = { ANTHROPIC_DEFAULT_SONNET_MODEL: OPUS_ID };
    expect(resolveLaunchModel("sonnet", NO_GATEWAY, env)).toEqual({
      claude: true,
      family: "opus",
      model: OPUS_ID,
      tier: "opus",
    });
    // It spends the person's Opus usage: the Opus rules hold.
    const bare = verdict({ effort: "high", model: "sonnet", prompt: "build it" }, CTX, env);
    expect(bare.decision).toBe("deny");
    expect(bare.reason).toContain("This launch would run on Claude Opus.");
    // A review on it is really Claude Opus: allowed, as on `opus`.
    expect(
      verdict({ effort: "high", model: "sonnet", prompt: "r", subagent_type: "Reviewer" }, CTX, env)
        .decision,
    ).toBe("allow");
    // Haiku on Claude Fable is the fable tier: even a read-only type needs its reason line.
    expect(
      verdict({ effort: "high", model: "haiku", prompt: "r", subagent_type: "Reviewer" }, CTX, {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-fable-5-1",
      }).decision,
    ).toBe("deny");
    // A Claude Sonnet id, a backend, or an id the guard cannot read keeps the name's own tier.
    for (const override of ["claude-sonnet-4-6", "openai:gpt-5.5", "us.vendor.some-model"]) {
      expect(
        resolveLaunchModel("sonnet", NO_GATEWAY, { ANTHROPIC_DEFAULT_SONNET_MODEL: override }).tier,
      ).toBeNull();
    }
  });

  it("HK hunch 2: `sonnet` whose worker chain starts with Claude Opus is the opus tier", () => {
    const config = configWithModelSlot();
    config.slots["cc-smart-dev-kit-worker"] = [OPUS_ID];
    const on = { config, gatewayOn: true };
    expect(resolveLaunchModel("sonnet", on, NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: OPUS_ID,
      tier: "opus",
    });
    expect(
      verdict(
        { effort: "high", model: "sonnet", prompt: "build it" },
        { ...on, sessionModel: null },
      ).decision,
    ).toBe("deny");
    // `opus` stays the opus tier when its own slot answers with a Claude Sonnet: never lower.
    config.slots["cc-smart-dev-kit-opus"] = ["claude-sonnet-5-5"];
    expect(resolveLaunchModel("opus", on, NO_ENV).tier).toBe("opus");
  });
});
