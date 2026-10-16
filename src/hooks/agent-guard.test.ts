/**
 * The Agent guard (`agent-guard.ts`): which model a launch really runs on, and the owner's
 * verdict for each — an affordable slot at effort max, Claude Sonnet/Haiku free, Claude Opus only
 * for a review or a reason line, Claude Fable only read-only with a reason and a person to
 * answer. Plus the record `cc-smart-dev-kit usage` reads.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { cliPaths } from "../cli/paths";
import type { GatewayConfig } from "../gateway/config";
import { tempDir } from "../testing/temp";
import {
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

/** A gateway config with an Opus model slot (its first target is the model itself). */
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
  it("a family name with no override and no gateway: the family itself", () => {
    expect(resolveLaunchModel("opus", null, NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: "opus",
    });
    expect(resolveLaunchModel("fable", null, NO_ENV)).toEqual({
      claude: true,
      family: "fable",
      model: "fable",
    });
  });

  it("Claude Code's env override wins: ANTHROPIC_DEFAULT_OPUS_MODEL (fable has one too)", () => {
    expect(
      resolveLaunchModel("opus", null, { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8" }),
    ).toEqual({ claude: true, family: "opus", model: "claude-opus-4-8" });
    expect(
      resolveLaunchModel("fable", null, { ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5-1" }),
    ).toEqual({ claude: true, family: "fable", model: "claude-fable-5-1" });
  });

  it("the gateway's model slot for the family: its first target answers (the model itself)", () => {
    expect(resolveLaunchModel("opus", configWithModelSlot(), NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: OPUS_ID,
    });
    // A full id that has a model slot keeps the Claude model first, the same way.
    expect(resolveLaunchModel(OPUS_ID, configWithModelSlot(), NO_ENV)).toEqual({
      claude: true,
      family: "opus",
      model: OPUS_ID,
    });
  });

  it("a slot key and a backend target are affordable; a name nobody knows is not", () => {
    const config = configWithModelSlot();
    expect(resolveLaunchModel("cc-smart-dev-kit-worker", config, NO_ENV)).toEqual({
      claude: false,
      family: null,
      model: "omniroute:glm-5.3-flash",
    });
    expect(resolveLaunchModel("omniroute:glm-5.3-flash", config, NO_ENV)).toEqual({
      claude: false,
      family: null,
      model: "omniroute:glm-5.3-flash",
    });
    // A name no rule knows is never read as an affordable slot: the strictest rule answers.
    expect(resolveLaunchModel("some-custom-model", config, NO_ENV)).toEqual({
      claude: true,
      family: null,
      model: "some-custom-model",
    });
  });

  it("a claude-… id is Claude even with no config; the [1m] suffix is dropped first", () => {
    expect(resolveLaunchModel("claude-sonnet-5-5[1m]", null, NO_ENV)).toEqual({
      claude: true,
      family: "sonnet",
      model: "claude-sonnet-5-5",
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
    expect(result.reason).toContain("Opus is for reviews and the owner's listed exceptions");
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
        { effort: "xhigh", model: "opus", prompt: "review", subagent_type: "Reviewer" },
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

  it("a review agent on Opus is allowed; at effort max it is denied", () => {
    expect(
      verdict({ effort: "xhigh", model: "opus", prompt: "review", subagent_type: "Reviewer" })
        .decision,
    ).toBe("allow");
    expect(
      verdict({
        effort: "xhigh",
        model: "opus",
        prompt: "review",
        subagent_type: "cc-smart-dev-kit:reviewer",
      }).decision,
    ).toBe("allow");
    const max = verdict({
      effort: "max",
      model: "opus",
      prompt: "review",
      subagent_type: "Reviewer",
    });
    expect(max.decision).toBe("deny");
    expect(max.reason).toContain("runs at effort `xhigh`, never `max`");
  });

  it("Sonnet and Haiku are allowed at any effort, and are never recorded", () => {
    expect(verdict({ effort: "low", model: "haiku", prompt: "search" }).decision).toBe("allow");
    const sonnet = verdict({ effort: "high", model: "sonnet", prompt: "build" });
    expect(sonnet.decision).toBe("allow");
    expect(sonnet.why).toBe("");
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

  it("Fable: a read-only agent with a reason line asks the person; a builder is denied", () => {
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
    expect(builder.reason).toContain("Fable advises, it never builds");
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
        effort: "xhigh",
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
      judgeWorkflow('await agent("x", { model: `haiku`, effort: "low" });', CTX, NO_ENV)[0]?.verdict
        .decision,
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
      'const done = `result: ${await agent("x", { model: "haiku", effort: "low" })}`;';
    expect(workflowRefusal(inTemplate)).toBeNull();
    expect(judgeWorkflow(inTemplate, CTX, NO_ENV).map((one) => one.verdict.decision)).toEqual([
      "allow",
    ]);
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
        effort: "xhigh",
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

  it("an asked Opus launch is recorded once, even when the hook runs twice for one call", () => {
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
    const asked = agentGuard(input, NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // 2.1.301 ran the hook once for the call the person approved (proved live); a build that
    // ran PreToolUse again with the same tool_use_id must not record a second launch.
    agentGuard(input, NO_ENV, where, "/tmp/app");
    const launches = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.reason).toBe("opus:debugging");
    expect(launches[0]?.toolUseId).toBe("toolu_1");
    // Another tool call in the same session is a second launch.
    agentGuard({ ...input, tool_use_id: "toolu_2" }, NO_ENV, where, "/tmp/app");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toHaveLength(2);
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
      tool: "Agent",
      why: "fable:hard",
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
