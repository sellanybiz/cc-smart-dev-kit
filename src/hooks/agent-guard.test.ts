/**
 * The Agent guard (`agent-guard.ts`): which model a launch really runs on, and the owner's
 * verdict for each — effort medium or above (never `low`), an affordable slot at
 * effort max, Claude Sonnet/Haiku free of the model rules, the opus tier free below `max` and
 * asked at `max` (D11), Claude Fable only read-only with a reason and a person to answer. Plus
 * the record `cc-smart-dev-kit usage` reads.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { cliPaths } from "../cli/paths";
import type { GatewayConfig } from "../gateway/config";
import { ALLOWED_EFFORTS, resolveLaunchModel } from "../models/launch-policy";
import { makeRepo } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import {
  agentGuard,
  type GuardContext,
  guardFacts,
  judgeLaunch,
  judgeWorkflow,
  type Launch,
  PRINT_RUN,
  readGuardContext,
  readLaunch,
  readWorkflowScript,
  reasonLine,
  workflowReason,
  workflowRefusal,
} from "./agent-guard";
import { agentLaunchesFile, parseAgentLaunch, readAgentLaunches } from "./agent-launches";
import type { HookInput } from "./io";
import { loadScriptParser } from "./script-parser";

// The guard's bundle loads its Workflow script parser in its entry; this file judges scripts too.
loadScriptParser();

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
const WORKFLOW_PATHS = testPaths({
  CLAUDE_CONFIG_DIR: join(tempDir("workflow-home"), ".claude"),
  HOME: tempDir("workflow-home"),
});

/** A managed agents folder in a temp folder: no test reads the machine's own. */
function managedFolder(): string {
  return join(tempDir("managed-agents"), ".claude", "agents");
}

/** Every path a test here uses: the CLI's, with a temp managed agents folder. */
function testPaths(env: Record<string, string | undefined>): CliPaths {
  return { ...cliPaths(env), managedAgentsDir: managedFolder() };
}

function verdict(fields: Record<string, unknown>, ctx: GuardContext = CTX, env = NO_ENV) {
  const launch = readLaunch(agentCall(fields));
  if (launch === null) throw new Error("not an Agent call");
  return judgeLaunch(launch, ctx, env);
}

describe("frontmatter launch fields", () => {
  it("uses one definition for Agent and Workflow launches, with call and env overrides", () => {
    const ctx: GuardContext = {
      ...CTX,
      definition: (name) => (name === "checker" ? { model: "sonnet", effort: "high" } : null),
    };
    const agent = verdict({ subagent_type: "checker" }, ctx);
    expect(agent.decision).toBe("allow");
    expect(agent.ran).toEqual({
      model: "sonnet",
      modelFrom: "frontmatter",
      effort: "high",
      effortFrom: "frontmatter",
    });
    expect(verdict({ subagent_type: "checker", model: "opus", effort: "max" }, ctx).decision).toBe(
      "ask",
    );
    expect(
      verdict({ subagent_type: "checker" }, ctx, { CLAUDE_CODE_EFFORT_LEVEL: "max" }).ran.effort,
    ).toBe("max");
    const workflow = judgeWorkflow('await agent("check", { agentType: "checker" });', ctx, NO_ENV);
    expect(workflow[0]?.verdict.decision).toBe("allow");
  });

  it("denies nonliteral Workflow fields before reading a definition", () => {
    for (const field of ["model: chosen", "effort: chosen", "agentType: chosen"]) {
      let reads = 0;
      const ctx: GuardContext = {
        ...CTX,
        definition: () => {
          reads += 1;
          return { model: "sonnet", effort: "high" };
        },
      };
      const result = judgeWorkflow(`await agent("check", { ${field} });`, ctx, NO_ENV)[0];
      expect(result?.verdict.decision).toBe("deny");
      expect(reads).toBe(0);
    }
  });

  it("read-only specialist agents can advise on Fable with review", () => {
    for (const name of [
      "cc-smart-dev-kit:auditor",
      "cc-smart-dev-kit:edge-case-hunter",
      "cc-smart-dev-kit:researcher",
      "Plan",
      "Explore",
    ]) {
      const result = verdict({
        subagent_type: name,
        model: "fable",
        effort: "high",
        prompt: "Fable reason: review - check it",
      });
      expect(result.decision).toBe("ask");
    }
  });

  it("a bare `Plan` or `Explore` is read-only only while the built-in answers that name", () => {
    const fable = (subagent_type: string, ctx: GuardContext) =>
      verdict(
        { subagent_type, model: "fable", effort: "high", prompt: "Fable reason: review - x" },
        ctx,
      ).decision;
    const builtIn: GuardContext = {
      ...CTX,
      definition: () => ({ model: null, effort: null, builtIn: true }),
    };
    expect(fable("Explore", builtIn)).toBe("ask");
    // A project's, a user's or a managed `Explore` overrides the built-in (the sub-agents docs).
    const local: GuardContext = { ...CTX, definition: () => ({ model: null, effort: null }) };
    expect(fable("Explore", local)).toBe("deny");
    expect(fable("Plan", local)).toBe("deny");
    // A lookup that failed proves nothing: not read-only.
    expect(fable("Plan", { ...CTX, definition: () => null })).toBe("deny");
    // Names match as written.
    expect(fable("explore", builtIn)).toBe("deny");
    expect(fable("Cc-Smart-Dev-Kit:researcher", builtIn)).toBe("deny");
  });

  it("the hook sees a project's own `Explore` file: that Explore is not read-only", () => {
    const home = tempDir("explore-home");
    const cwd = join(home, "repo");
    mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "agents", "explore.md"),
      "---\nname: Explore\ndescription: Mine.\n---\nWrite files too.\n",
    );
    const paths = testPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    const ctx = readGuardContext(paths, { cwd }, NO_ENV);
    const result = verdict(
      {
        subagent_type: "Explore",
        model: "fable",
        effort: "high",
        prompt: "Fable reason: review - x",
      },
      ctx,
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("`Explore`, which can change files");
  });

  it("another plugin's or a project's agent of the same short name is not read-only", () => {
    for (const name of [
      "researcher",
      "auditor",
      "other-kit:researcher",
      "other-kit:edge-case-hunter",
      "other-kit:Plan",
    ]) {
      const result = verdict({
        subagent_type: name,
        model: "fable",
        effort: "high",
        prompt: "Fable reason: review - check it",
      });
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain(`\`${name}\`, which can change files`);
    }
  });

  it("a senior engineer on Fable needs build, not review", () => {
    const result = verdict({
      subagent_type: "cc-smart-dev-kit:senior-engineer",
      model: "fable",
      effort: "high",
      prompt: "Fable reason: review - check it",
    });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("build");
  });

  it("refuses unseen SDK agents, inherit, and missing effort with accurate text", () => {
    expect(verdict({ subagent_type: "sdk-only" }).reason).toStartWith(
      "Neither this Agent launch nor its agent definition names a `model` the guard can read.",
    );
    const ctx: GuardContext = { ...CTX, definition: () => ({ model: "inherit", effort: "high" }) };
    expect(verdict({ subagent_type: "inherited" }, ctx).decision).toBe("deny");
    expect(verdict({ model: "sonnet" }).reason).toStartWith(
      "Neither this Agent launch nor its agent definition names an `effort` the guard can read.",
    );
  });

  it("the hook reads project frontmatter through its input cwd and injected user paths", () => {
    const home = tempDir("frontmatter-hook");
    const cwd = join(home, "repo");
    const paths = testPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "agents", "checker.md"),
      "---\nname: checker\ndescription: Check.\nmodel: sonnet\neffort: high\n---\nCheck it.\n",
    );
    const input = { ...agentCall({ subagent_type: "checker" }), cwd };
    const ctx = readGuardContext(paths, input, NO_ENV);
    expect(verdict({ subagent_type: "checker" }, ctx).decision).toBe("allow");
    expect(
      judgeWorkflow('await agent("check", { agentType: "checker" });', ctx, NO_ENV)[0]?.verdict
        .decision,
    ).toBe("allow");
  });

  it("caches definitions once per hook run and fails the whole lookup on a bad cwd", () => {
    const home = tempDir("definition-cache");
    const paths = testPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    const folder = join(paths.claudeConfigDir, "agents");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, "checker.md");
    writeFileSync(
      file,
      "---\nname: checker\ndescription: Check.\nmodel: sonnet\neffort: high\n---\n",
    );
    const ctx = readGuardContext(paths, { cwd: home }, NO_ENV);
    expect(ctx.definition?.("checker")).toEqual({ model: "sonnet", effort: "high" });
    writeFileSync(file, "---\nname: checker\ndescription: Check.\nmodel: opus\n---\n");
    expect(ctx.definition?.("checker")).toEqual({ model: "sonnet", effort: "high" });
    const bad = readGuardContext(paths, { cwd: join(home, "missing") }, NO_ENV);
    expect(bad.definition?.("checker")).toBeNull();
    expect(bad.definition?.("claude-code-guide")).toBeNull();
  });

  it("a symlinked cwd inside a real git checkout: the project files beat the user's", () => {
    const repo = makeRepo("linked-app");
    const home = tempDir("linked-home");
    const paths = testPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    const pinned = (name: string, model: string) =>
      `---\nname: ${name}\ndescription: Check.\nmodel: ${model}\neffort: high\n---\n`;
    const put = (folder: string, name: string, model: string) => {
      mkdirSync(join(folder, "agents"), { recursive: true });
      writeFileSync(join(folder, "agents", `${name}.md`), pinned(name, model));
    };
    put(join(repo, ".claude"), "checker", "sonnet");
    put(join(repo, "src", ".claude"), "nested", "haiku");
    put(join(repo, ".claude"), "nested", "sonnet");
    put(paths.claudeConfigDir, "checker", "opus");
    put(paths.claudeConfigDir, "nested", "opus");
    const link = join(home, "linked-src");
    symlinkSync(join(repo, "src"), link, "dir");
    const ctx = readGuardContext(paths, { cwd: link }, NO_ENV);
    // The root's file beats the user's, and the folder the link really is beats the root's.
    expect(ctx.definition?.("checker")).toEqual({ model: "sonnet", effort: "high" });
    expect(ctx.definition?.("nested")).toEqual({ model: "haiku", effort: "high" });
  });

  it("a call that names both fields reads no definition; a fork never reads one", () => {
    let reads = 0;
    const ctx: GuardContext = {
      ...CTX,
      definition: () => {
        reads += 1;
        return { model: "sonnet", effort: "high" };
      },
    };
    verdict({ subagent_type: "checker", model: "haiku", effort: "high" }, ctx);
    verdict({ subagent_type: "fork" }, ctx);
    expect(reads).toBe(0);
    verdict({ subagent_type: "checker", model: "haiku" }, ctx);
    expect(reads).toBe(1);
  });

  it("a `claude -p` run has no agent definition: none is read, and its reasons say so", () => {
    let reads = 0;
    const ctx: GuardContext = {
      ...CTX,
      definition: () => {
        reads += 1;
        return { model: "sonnet", effort: "high" };
      },
    };
    const run = (fields: Partial<Launch>) =>
      judgeLaunch(
        {
          effort: null,
          fork: false,
          model: null,
          prompt: "do it",
          subagentType: "general-purpose",
          tool: PRINT_RUN,
          ...fields,
        },
        ctx,
        NO_ENV,
      );
    const noModel = run({});
    expect(noModel.decision).toBe("deny");
    expect(noModel.reason).toBe(
      [
        "This `claude -p` run names no `model` the guard can read.",
        "A run given none starts on the default model, which nobody chose, and no agent definition stands behind a print run.",
      ].join("\n"),
    );
    const noEffort = run({ model: "sonnet" });
    expect(noEffort.decision).toBe("deny");
    expect(noEffort.reason).toBe(
      [
        "This `claude -p` run names no `effort` the guard can read.",
        "Name one of `medium`, `high`, `xhigh` or `max`.",
        "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` when the task wants it on `haiku` or `sonnet`, whatever model answers them (the `opus` tier asks the person at `max`).",
      ].join("\n"),
    );
    expect(reads).toBe(0);
  });

  it("frontmatter auto or low is not an environment override", () => {
    for (const effort of ["auto", "low"]) {
      const ctx: GuardContext = { ...CTX, definition: () => ({ model: "sonnet", effort }) };
      const result = verdict({ subagent_type: "checker" }, ctx);
      expect(result.decision).toBe("deny");
      expect(result.reason).not.toContain("CLAUDE_CODE_EFFORT_LEVEL");
      expect(result.reason).toBe(
        [
          `This launch asks for effort \`${effort}\`, which no subagent may run at (the plugin's rule).`,
          `Effort \`${effort}\` comes from the agent's frontmatter; pass \`effort\` on the call to override it.`,
          "A subagent runs at `medium`, `high`, `xhigh` or `max` — never `low`, on any model.",
          "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` when the task wants it on `haiku` or `sonnet`, whatever model answers them (the `opus` tier asks the person at `max`).",
        ].join("\n"),
      );
    }
  });

  it("a frontmatter effort is named only on the effort rule's own reason", () => {
    const ctx: GuardContext = { ...CTX, definition: () => ({ model: "fable", effort: "high" }) };
    const result = verdict({ subagent_type: "checker", prompt: "Fable reason: review - x" }, ctx);
    expect(result.decision).toBe("deny");
    expect(result.reason).toStartWith("This launch would run on Claude Fable");
    expect(result.reason).not.toContain("frontmatter");
  });
});

describe("a Workflow script is parsed: a regular expression hides nothing", () => {
  /** The hook's answer for a Workflow call with this inline script. */
  async function answer(script: string) {
    const result = await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app");
    return JSON.parse(result.stdout ?? "{}").hookSpecificOutput ?? {};
  }

  const FABLE = 'await agent("p", { model: "fable", effort: "high" });';

  it("a quote inside a regular expression opens no string: the launch after it is judged", async () => {
    for (const before of [
      `s.replace(/"/g, "'");`,
      `const r = /["']/;`,
      `if (ok) /"/.test(s);`,
      `if (ok) { go(); } /"/.test(s);`,
      `function f(s) { return /'/.test(s); }`,
      `const t = x ? /"/ : /'/;`,
      `const u = typeof /"/;`,
    ]) {
      const said = await answer(`${before}\n${FABLE}`);
      expect(said.permissionDecision).toBe("deny");
      expect(said.permissionDecisionReason).toContain('the launch "p"');
    }
  });

  it("a getter between two regular expressions that hold a quote: denied", () => {
    const script = [
      'const a = /"/;',
      'await agent("x", { agentType: "checker", get model() { return "opus"; } });',
      'const b = /"/;',
    ].join("\n");
    const results = judgeWorkflow(script, CTX, NO_ENV);
    expect(results).toHaveLength(1);
    expect(results[0]?.verdict.decision).toBe("deny");
  });

  it("a backtick nested inside a template's placeholder starts a new template", async () => {
    const said = await answer(`const t = \`a \${\`"\`} b\`;\n${FABLE}`);
    expect(said.permissionDecision).toBe("deny");
    expect(said.permissionDecisionReason).toContain('the launch "p"');
  });

  it("a division stays a division: `a / b`, `f(x) / 2`, `a[i] / 2`, `({}) / 2` and `/=`", async () => {
    const script = [
      "const n = a / b / 2;",
      "const m = f(x) / 2 + a[i] / 3;",
      "let k = ({}).size / 2; k /= 2;",
      'await agent("p", { model: "haiku", effort: "high" });',
    ].join("\n");
    expect(workflowRefusal(script)).toBeNull();
    expect((await answer(script)).permissionDecision).toBeUndefined();
  });

  it("a regular expression, string or comment that never closes refuses the whole Workflow", async () => {
    for (const script of [
      `const r = (/"\n);\n${FABLE.replace("fable", "haiku")}`,
      `const s = "open\n${FABLE.replace("fable", "haiku")}`,
      `/* never closed\n${FABLE.replace("fable", "haiku")}`,
    ]) {
      expect(workflowRefusal(script)).toContain("cannot be read");
      const said = await answer(script);
      expect(said.permissionDecision).toBe("deny");
      expect(said.permissionDecisionReason).toContain("cannot be read at line");
    }
  });
});

describe("round 3: shapes a hand-written lexer misread are parsed, and their launch is judged", () => {
  /** The hook's answer for a Workflow call with this inline script. */
  async function answer(script: string) {
    const result = await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app");
    return JSON.parse(result.stdout ?? "{}").hookSpecificOutput ?? {};
  }

  /** A Fable launch with no reason line: the guard denies it once it sees it. */
  const LAUNCH = 'agent("p", { model: "fable", effort: "high" })';

  it("a division a lexer reads as a regular expression hides no launch", async () => {
    for (const script of [
      `const n = i++ / ${LAUNCH} / 1;`,
      `const n = i-- / ${LAUNCH} / 1;`,
      `const n = o.return / ${LAUNCH} / 1;`,
      `const n = function () {} / ${LAUNCH} / 1;`,
      `const n = class {} / ${LAUNCH} / 1;`,
      `const t = \`\${{} / ${LAUNCH} / 1}\`;`,
    ]) {
      const said = await answer(script);
      expect({ script, decision: said.permissionDecision }).toEqual({ script, decision: "deny" });
      expect(said.permissionDecisionReason).toContain('the launch "p"');
    }
  });

  it("a regular expression a lexer reads as a division hides no launch", async () => {
    for (const before of [
      "if (a) {} else {} /[/*]/.test(s);",
      "switch (k) { case 1: {} /[/*]/.test(s); }",
      "here: {} /[/*]/.test(s);",
    ]) {
      const script = `${before}\nawait ${LAUNCH};\n// */`;
      const said = await answer(script);
      expect({ script, decision: said.permissionDecision }).toEqual({ script, decision: "deny" });
      expect(said.permissionDecisionReason).toContain('the launch "p"');
    }
  });

  it("a line comment ends at every line terminator JavaScript knows", async () => {
    for (const end of ["\r", " ", " "]) {
      const script = `// a note${end}await ${LAUNCH};`;
      const said = await answer(script);
      expect({ end, decision: said.permissionDecision }).toEqual({ end, decision: "deny" });
      expect(said.permissionDecisionReason).toContain('the launch "p"');
    }
  });

  it("an HTML-like comment (`<!--`, `-->` at a line's start) refuses the whole Workflow", async () => {
    // A script reads it as a comment, a module as code: the guard judges neither reading.
    for (const [script, line] of [
      [`x = 1;\n--> /*\nawait ${LAUNCH};\n// */`, 2],
      [`x = 1; <!-- /*\nawait ${LAUNCH};\n// */`, 1],
      [`a <!--b, ${LAUNCH};`, 1],
    ] as const) {
      const said = await answer(script);
      expect({ script, decision: said.permissionDecision }).toEqual({ script, decision: "deny" });
      expect(said.permissionDecisionReason).toStartWith(
        `This Workflow's script cannot be read at line ${line}: an HTML-like comment (\`<!--\`, or \`-->\` at a line's start), which a script reads as a comment and a module as code, so a launch could hide in it.`,
      );
    }
  });

  it("valid JavaScript a lexer refused is read: a postfix division, a function's division, a CRLF continuation", async () => {
    const haiku = 'await agent("p", { model: "haiku", effort: "high" });';
    for (const before of [
      "const r = count++ / total;",
      "const f = function () {} / 2;",
      'const s = "a\\\r\nb";',
    ]) {
      const script = `${before}\n${haiku}`;
      expect(workflowRefusal(script)).toBeNull();
      expect(await answer(script)).toEqual({});
    }
  });

  it("a script that does not parse is refused whole, with the parser's message and line", () => {
    expect(
      workflowRefusal('await agent("p", { model: "haiku", effort: "high" });\nconst s = "open\n;'),
    ).toBe(
      [
        "This Workflow's script cannot be read at line 2: Unterminated string constant.",
        "The guard parses the script the way Claude Code runs it (the body of an async function), and a script it cannot parse could hide a launch.",
        "Fix the script so it runs as JavaScript.",
      ].join("\n"),
    );
  });

  it("`export const meta` as the first statement is read; an `export` anywhere else does not parse", () => {
    const meta = "// the meta\nexport const meta = { name: 'probe', description: 'x' };";
    const launch = 'await agent("p", { model: "haiku", effort: "high" });';
    expect(workflowRefusal(`${meta}\n${launch}`)).toBeNull();
    expect(readWorkflowScript(`${meta}\n${launch}`).map((one) => one.model)).toEqual(["haiku"]);
    expect(workflowRefusal(`${launch}\n${meta}`)).toContain(
      "This Workflow's script cannot be read at line 3:",
    );
  });
});

describe("a Workflow agent() whose options are not one plain object reads no definition", () => {
  /** A context whose definition lookup counts its reads, and would allow anything. */
  function counting() {
    const seen = { reads: 0 };
    const ctx: GuardContext = {
      ...CTX,
      definition: () => {
        seen.reads += 1;
        return { model: "sonnet", effort: "high" };
      },
    };
    return { ctx, seen };
  }

  const NO_MODEL_TEXT = [
    "This Workflow launch names no `model` the guard can read, in its options or its agent definition.",
    "A value held in a variable, or options that are not one plain object literal (a getter, a method, a shorthand key, `__proto__`, a ternary, a second object), can set the run's `model` where a hook never sees it, so no agent definition stands in for it then.",
    'Write `model` and `effort` as string literals in one plain options object: `agent("<prompt>", { model: "…", effort: "…" })`.',
  ].join("\n");

  it("a getter, a ternary, a method, a shorthand, `__proto__` or a second object: denied", () => {
    const forms = [
      'await agent("x", { agentType: "checker", get model() { return "opus"; } });',
      'await agent("x", pick ? { agentType: "checker" } : { agentType: "checker", model: "fable" });',
      'await agent("x", { agentType: "checker", model() { return "opus"; } });',
      'await agent("x", { agentType: "checker", model });',
      'await agent("x", { agentType: "checker", __proto__: { model: "fable" } });',
      'await agent("x", { agentType: "checker" }, { model: "fable" });',
      // A literal the guard could read is no proof either: a getter can still replace it.
      'await agent("x", { model: "haiku", effort: "high", get agentType() { return "checker"; } });',
    ];
    for (const script of forms) {
      const { ctx, seen } = counting();
      const result = judgeWorkflow(script, ctx, NO_ENV)[0];
      expect(result?.verdict.decision).toBe("deny");
      expect(result?.verdict.reason).toBe(NO_MODEL_TEXT);
      expect(seen.reads).toBe(0);
    }
  });

  it("the same for effort: a getter or a ternary, with the model set by Claude Code's override", () => {
    const env = { CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: "sonnet" };
    for (const script of [
      'await agent("x", { agentType: "checker", get effort() { return "low"; } });',
      'await agent("x", fast ? { agentType: "checker" } : { agentType: "checker", effort: "low" });',
    ]) {
      const { ctx, seen } = counting();
      const result = judgeWorkflow(script, ctx, env)[0];
      expect(result?.verdict.decision).toBe("deny");
      expect(result?.verdict.reason).toBe(
        [
          "This Workflow launch names no `effort` the guard can read, in its options or its agent definition.",
          "A value held in a variable, or options that are not one plain object literal (a getter, a method, a shorthand key, `__proto__`, a ternary, a second object), can set the run's `effort` where a hook never sees it, so no agent definition stands in for it then.",
          'Write `model` and `effort` as string literals in one plain options object: `agent("<prompt>", { model: "…", effort: "…" })`.',
        ].join("\n"),
      );
      expect(seen.reads).toBe(0);
    }
  });

  it("Claude Code's overrides for both fields still judge such a launch", () => {
    const { ctx, seen } = counting();
    const env = { CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_EFFORT_LEVEL: "high" };
    const result = judgeWorkflow(
      'await agent("x", { agentType: "checker", get model() { return "opus"; } });',
      ctx,
      env,
    )[0];
    expect(result?.verdict.decision).toBe("allow");
    expect(seen.reads).toBe(0);
  });

  it("one plain object, with comments, quoted keys and a trailing comma, still reads its definition", () => {
    const { ctx, seen } = counting();
    const result = judgeWorkflow(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its prompt.
      'await agent(`look at ${x}`, {\n  "agentType": "checker", // who\n  label: cond ? "a" : "b",\n  schema: { type: "object" },\n},);',
      ctx,
      NO_ENV,
    )[0];
    expect(result?.verdict.decision).toBe("allow");
    expect(seen.reads).toBe(1);
  });
});

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
    // `opus` is the tier even when a backend answers it, and the family the messages and the
    // record read stays the tier's own.
    expect(
      resolveLaunchModel("opus", NO_GATEWAY, { ANTHROPIC_DEFAULT_OPUS_MODEL: "openai:gpt-5.5" }),
    ).toEqual({ claude: false, family: "opus", model: "openai:gpt-5.5", tier: "opus" });
    expect(
      resolveLaunchModel("fable", NO_GATEWAY, { ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5" }),
    ).toEqual({ claude: false, family: "fable", model: "openai:gpt-5.5", tier: "fable" });
    // The id an override names is that tier — and that family — wherever it appears, the
    // session's model included: the person's own setting proves what the id stands for.
    const env = { ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5" };
    expect(resolveLaunchModel("openai:gpt-5.5", NO_GATEWAY, env)).toEqual({
      claude: false,
      family: "fable",
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
    testPaths({
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
    // Nobody named it: the strictest reading, the opus tier — which runs at the session's own
    // effort with no question (D11).
    const unknown = verdict({ prompt: "x", subagent_type: "fork" }, CTX);
    expect(unknown.decision).toBe("allow");
    expect(unknown.real?.tier).toBe("opus");
    expect(unknown.why).toBe("opus:session-effort");
  });
});

describe("the verdict", () => {
  it("no model: denied; no effort: denied; a fork needs neither", () => {
    expect(verdict({ prompt: "x", effort: "high" }).decision).toBe("deny");
    expect(verdict({ model: "sonnet", prompt: "x" }).decision).toBe("deny");
    // A fork needs neither line — it always inherits both — but it still runs on a model:
    // an unknown session model counts as Claude Opus, which runs at the session's own effort
    // with no question (D11); a reason line, when it has one, is kept for the record.
    const fork = verdict({ prompt: "x", subagent_type: "fork" });
    expect(fork.decision).toBe("allow");
    expect(fork.real?.family).toBe("opus");
    const said = verdict({ prompt: "Opus reason: debugging - it is", subagent_type: "fork" });
    expect(said.decision).toBe("allow");
    expect(said.why).toBe("opus:session-effort:debugging");
    // A fork that names `max` itself is held to the same rule as any opus-tier launch.
    expect(verdict({ effort: "max", prompt: "x", subagent_type: "fork" }).decision).toBe("ask");
  });

  it("a full Opus id is the opus tier: allowed at `high` with no reason line, asked at `max`", () => {
    const allowed = verdict({ effort: "high", model: OPUS_ID, prompt: "do it" });
    expect(allowed.decision).toBe("allow");
    expect(allowed.why).toBe("opus:high");
    // `max` asks, and the ask states the rule in words.
    const max = verdict({ effort: "max", model: OPUS_ID, prompt: "do it" });
    expect(max.decision).toBe("ask");
    expect(max.reason).toContain("Claude Opus launch at effort `max`");
    expect(max.reason).toContain(
      "The opus tier runs at `medium`, `high` or `xhigh` with no question",
    );
  });

  it("Opus with an `Opus reason:` line: allowed below max, the word kept for the record", () => {
    const result = verdict({
      effort: "xhigh",
      model: "opus",
      prompt: "Rewrite the router.\nOpus reason: architecture - the routing table is the core",
    });
    expect(result.decision).toBe("allow");
    expect(result.why).toBe("opus:xhigh:architecture");
    // At `max` the ask shows the line, and the word stays part of the record.
    const max = verdict({
      effort: "max",
      model: "opus",
      prompt: "Rewrite the router.\nOpus reason: architecture - the routing table is the core",
    });
    expect(max.decision).toBe("ask");
    expect(max.reason).toContain("Opus reason: architecture - the routing table is the core");
    expect(max.why).toBe("opus:max:architecture");
  });

  it("nobody to answer (`claude -p`): an Opus launch below max is allowed, review or not; max is denied", () => {
    const unattended = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
    // No reason line, attended or not: nothing below `max` asks (D11).
    expect(
      verdict({ effort: "high", model: "opus", prompt: "build it" }, CTX, unattended).decision,
    ).toBe("allow");
    expect(
      verdict(
        { effort: "xhigh", model: "opus", prompt: "Opus reason: debugging - it is" },
        CTX,
        unattended,
      ).decision,
    ).toBe("allow");
    const max = verdict(
      { effort: "max", model: "opus", prompt: "Opus reason: debugging - it is" },
      CTX,
      unattended,
    );
    expect(max.decision).toBe("deny");
    expect(max.reason).toContain("nobody to answer");
    expect(max.reason).toContain("Run it at `medium`, `high` or `xhigh`");
    expect(
      verdict(
        {
          effort: "high",
          model: "opus",
          prompt: "review",
          subagent_type: "cc-smart-dev-kit:senior-engineer",
        },
        CTX,
        unattended,
      ).decision,
    ).toBe("allow");
  });

  it("D11: `opus` runs with no question at `high` or `xhigh`, attended or not; `max` asks", () => {
    const unattended = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
    for (const effort of ["high", "xhigh"]) {
      for (const env of [NO_ENV, unattended]) {
        const result = verdict({ effort, model: "opus", prompt: "build it" }, CTX, env);
        expect(result.decision).toBe("allow");
        expect(result.reason).toBe("");
        expect(result.why).toBe(`opus:${effort}`);
      }
    }
    // `max` asks the person; where nobody can answer (`claude -p`), it is refused.
    expect(verdict({ effort: "max", model: "opus", prompt: "build it" }).decision).toBe("ask");
    const max = verdict({ effort: "max", model: "opus", prompt: "build it" }, CTX, unattended);
    expect(max.decision).toBe("deny");
    expect(max.reason).toContain("nobody to answer");
  });

  it("an `Opus reason:` word nobody lists is still recorded: it never decides anything", () => {
    const result = verdict({
      effort: "high",
      model: "opus",
      prompt: "Opus reason: because I like it",
    });
    expect(result.decision).toBe("allow");
    expect(result.why).toBe("opus:high:because");
  });

  it("a review agent on Opus is allowed below max; at effort max it asks the person", () => {
    expect(
      verdict({
        effort: "xhigh",
        model: "opus",
        prompt: "review",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      }).decision,
    ).toBe("allow");
    expect(
      verdict({
        effort: "xhigh",
        model: "opus",
        prompt: "review",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      }).decision,
    ).toBe("allow");
    // `max` asks like any opus-tier launch, review or not, and the person's yes is the answer.
    const max = verdict({
      effort: "max",
      model: "opus",
      prompt: "review",
      subagent_type: "cc-smart-dev-kit:senior-engineer",
    });
    expect(max.decision).toBe("ask");
    expect(max.reason).toContain("Claude Opus launch at effort `max`");
    expect(max.reason).toContain("`cc-smart-dev-kit:senior-engineer`");
    expect(max.why).toBe("opus:max");
  });

  it("a review at effort max under `claude -p` is denied: nobody is there to approve it", () => {
    const where = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
    const max = verdict(
      {
        effort: "max",
        model: "opus",
        prompt: "review",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      },
      CTX,
      where,
    );
    expect(max.decision).toBe("deny");
    expect(max.reason).toContain("nobody to answer");
    // The usual effort stays allowed there.
    expect(
      verdict(
        {
          effort: "xhigh",
          model: "opus",
          prompt: "review",
          subagent_type: "cc-smart-dev-kit:senior-engineer",
        },
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

  it("`low` is refused on every model; `medium` runs on Claude and on an affordable slot alike", () => {
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
    // `medium` is for searches and reads on Claude (D5, D13).
    for (const model of ["haiku", "sonnet"]) {
      expect(verdict({ effort: "medium", model, prompt: "search it" }).decision).toBe("allow");
    }
    // An affordable slot takes `medium` as Claude does (the owner, 2026-10-26).
    const slot = verdict({ effort: "medium", model: "cc-smart-dev-kit-worker", prompt: "x" }, on);
    expect(slot.decision).toBe("allow");
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

  it("an affordable slot takes every allowed effort, gateway on or off (the owner, 2026-10-26)", () => {
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    for (const effort of ALLOWED_EFFORTS) {
      for (const ctx of [on, CTX]) {
        const result = verdict({ effort, model: "cc-smart-dev-kit-worker", prompt: "build" }, ctx);
        expect(`${effort}: ${result.decision}`).toBe(`${effort}: allow`);
      }
    }
    // `low` is the one level still refused there, as on Claude.
    const low = verdict({ effort: "low", model: "cc-smart-dev-kit-worker", prompt: "build" }, on);
    expect(low.decision).toBe("deny");
    expect(low.reason).toContain("asks for effort `low`");
  });

  it("a name the guard does not know is never affordable: the strictest rule answers", () => {
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    // Only a slot key and a `<backend>:<model>` target count as affordable: an unknown name
    // could be anything, so it is judged like a Claude id with no family to read: the opus
    // tier, but not proved Opus — it may stand for a higher tier, so the person approves it at
    // every effort (D11's free path is for a reading proved as Opus), never forced to `max`.
    for (const model of ["best", "opusplan", "default", "inherit", "gpt-5", "some-custom-model"]) {
      for (const effort of ["high", "xhigh", "max"]) {
        const result = verdict({ effort, model, prompt: "build it" }, on);
        expect(result.decision).toBe("ask");
        expect(result.reason).toContain("cannot read the model behind it as Claude Opus");
        expect(result.reason).not.toContain("affordable");
      }
    }
    const said = verdict({
      effort: "xhigh",
      model: "opusplan",
      prompt: "Opus reason: debugging - it is",
    });
    expect(said.decision).toBe("ask");
    expect(said.real?.family).toBeNull();
    // A fork's session model follows the same rule: a family name is that family, an unknown
    // name is the strict one.
    const fork = (sessionModel: string) =>
      verdict(
        { prompt: "x", subagent_type: "fork" },
        { config: null, gatewayOn: false, sessionModel },
      );
    expect(fork("sonnet").decision).toBe("allow");
    expect(fork("best").decision).toBe("ask");
    expect(fork("best").real?.tier).toBe("opus");
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
    // A fork naming Sonnet in an Opus session runs on Opus: allowed at `high` (D11), asked at
    // `max` — never judged as Sonnet.
    const opusSession: GuardContext = {
      config: null,
      gatewayOn: false,
      sessionModel: "claude-opus-5-5",
    };
    const named = verdict(
      { effort: "high", model: "sonnet", prompt: "do it", subagent_type: "fork" },
      opusSession,
    );
    expect(named.decision).toBe("allow");
    expect(named.why).toBe("opus:high");
    expect(named.real?.tier).toBe("opus");
    expect(named.real?.model).toBe("claude-opus-5-5");
    expect(
      verdict(
        { effort: "max", model: "sonnet", prompt: "do it", subagent_type: "fork" },
        opusSession,
      ).decision,
    ).toBe("ask");
  });

  it("a review whose model the guard cannot read asks like any launch (D11)", () => {
    // There is no review shortcut any more: an unreadable name is the opus tier without a
    // family, so the person approves it at every effort, a review or not.
    const unread = verdict({
      effort: "xhigh",
      model: "best",
      prompt: "r",
      subagent_type: "cc-smart-dev-kit:senior-engineer",
    });
    expect(unread.decision).toBe("ask");
    expect(unread.why).toBe("opus:unreadable");
    const max = verdict({
      effort: "max",
      model: "best",
      prompt: "r",
      subagent_type: "cc-smart-dev-kit:senior-engineer",
    });
    expect(max.decision).toBe("ask");
    expect(max.why).toBe("opus:unreadable");
    // A review on a readable Opus is allowed with no question the same way.
    expect(
      verdict({
        effort: "xhigh",
        model: "opus",
        prompt: "r",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      }).decision,
    ).toBe("allow");
  });

  it("every premium ask at effort max says so; Sonnet, Haiku and a slot stay silent", () => {
    const review = verdict({
      effort: "max",
      model: "opus",
      prompt: "r",
      subagent_type: "cc-smart-dev-kit:senior-engineer",
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

  it("the read-only list is configurable through the environment; Opus needs no review list (D11)", () => {
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
    // Any agent type runs on the opus tier below `max` with no list naming it; the old review
    // list's variable no longer changes anything — `max` still asks.
    const audit = verdict({
      effort: "high",
      model: "opus",
      prompt: "check it",
      subagent_type: "my-auditor",
    });
    expect(audit.decision).toBe("allow");
    expect(audit.why).toBe("opus:high");
    const deep = verdict(
      { effort: "max", model: "opus", prompt: "check it", subagent_type: "my-auditor" },
      CTX,
      { CC_SMART_DEV_KIT_AGENT_GUARD_REVIEW_AGENTS: "my-auditor" },
    );
    expect(deep.decision).toBe("ask");
    expect(deep.why).toBe("opus:max");
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
  // and it is always named with what answers it.
  const OPENAI_OPUS = { ANTHROPIC_DEFAULT_OPUS_MODEL: "openai:gpt-5.5" };
  const OPENAI_FABLE = { ANTHROPIC_DEFAULT_FABLE_MODEL: "openai:gpt-5.5" };
  const ON: GuardContext = { config: null, gatewayOn: true, sessionModel: null };

  it("`opus` over a backend keeps the opus tier's gate, and the affordable rule never applies", () => {
    // With the gateway on, a missing `max` is never a reason to refuse a tier: `high` is allowed.
    const bare = verdict({ effort: "high", model: "opus", prompt: "do it" }, ON, OPENAI_OPUS);
    expect(bare.decision).toBe("allow");
    expect(bare.real?.tier).toBe("opus");
    expect(bare.why).toBe("opus:high");
    // At `max` the tier asks, naming the model behind it, and never as an affordable slot.
    const asked = verdict(
      { effort: "max", model: "opus", prompt: "Opus reason: architecture - it is" },
      ON,
      OPENAI_OPUS,
    );
    expect(asked.decision).toBe("ask");
    expect(asked.reason).toContain("`opus` (answered by openai:gpt-5.5)");
    expect(asked.reason).not.toContain("affordable");
    // A review on the tier: allowed at high, an ask at max, naming the model behind it.
    expect(
      verdict(
        {
          effort: "xhigh",
          model: "opus",
          prompt: "r",
          subagent_type: "cc-smart-dev-kit:senior-engineer",
        },
        ON,
        OPENAI_OPUS,
      ).decision,
    ).toBe("allow");
    const deep = verdict(
      {
        effort: "max",
        model: "opus",
        prompt: "r",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      },
      ON,
      OPENAI_OPUS,
    );
    expect(deep.decision).toBe("ask");
    expect(deep.reason).toContain("`opus` (answered by openai:gpt-5.5)");
    expect(deep.reason).toContain("at effort `max`");
    expect(deep.why).toBe("opus:max");
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

  it("judges every launch of the call: a denied one denies the whole Workflow call", async () => {
    const script = [
      'await agent("build it", { model: "sonnet", effort: "high" });',
      'await agent("plan it", { model: "opus", effort: "xhigh" });',
      'await agent("do it", { model: "fable", effort: "high", agentType: "Plan" });',
    ].join("\n");
    const results = judgeWorkflow(script, CTX, NO_ENV);
    expect(results.map((one) => one.verdict.decision)).toEqual(["allow", "allow", "deny"]);
    const answer = JSON.parse(
      (await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain('In this workflow, the launch "do it"');
    expect(answer.permissionDecisionReason).toContain("Fable advises");
  });

  it("a Fable launch with a reason line asks; the ask names the launch", async () => {
    const script =
      'await agent("Plan the rewrite.\\nFable reason: rewrite - the editor", { label: "plan", model: "fable", effort: "max", agentType: "Plan" });';
    const answer = JSON.parse(
      (await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("ask");
    expect(answer.permissionDecisionReason).toContain('the launch "plan"');
    expect(answer.permissionDecisionReason).toContain("Fable advises");
  });

  it("an ask names every launch of the script that asks, not only the first", async () => {
    const script = [
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });',
      'await agent("Fable reason: build - write it", { label: "builder", model: "fable", effort: "max", agentType: "general-purpose" });',
    ].join("\n");
    const answer = JSON.parse(
      (await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("ask");
    expect(answer.permissionDecisionReason).toContain('the launch "advice"');
    expect(answer.permissionDecisionReason).toContain('the launch "builder"');
  });

  it("an ask that rests on the effort, not the prompt, survives a built prompt", () => {
    // The opus tier at `max` asks for the effort: a prompt the guard cannot read does not matter.
    const review =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its prompt.
      'await agent(`review ${x}`, { agentType: "cc-smart-dev-kit:senior-engineer", model: "opus", effort: "max", label: "deep" });';
    const deep = judgeWorkflow(review, CTX, NO_ENV);
    expect(deep[0]?.verdict.decision).toBe("ask");
    expect(deep[0]?.verdict.why).toBe("opus:max");
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
    expect(model[0]?.verdict.reason).toBe(
      "This Workflow launch's `model` is not a string literal the guard can read. Write policy options as string literals.",
    );
    const prompt = judgeWorkflow(
      'await agent(thePrompt, { model: "fable", effort: "high", agentType: "Plan" });',
      CTX,
      NO_ENV,
    );
    expect(prompt[0]?.verdict.decision).toBe("deny");
    expect(prompt[0]?.verdict.reason).toContain("prompt is built at run time");
    // The opus tier reads no reason line (D11), so its prompt does not matter below `max`.
    expect(
      judgeWorkflow('await agent(thePrompt, { model: "opus", effort: "high" });', CTX, NO_ENV)[0]
        ?.verdict.decision,
    ).toBe("allow");
  });

  it("a backtick literal that builds its text is not a literal: denied, never guessed", () => {
    const model = judgeWorkflow(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its model.
      'await agent("x", { model: `op${n}`, effort: "high" });',
      CTX,
      NO_ENV,
    );
    expect(model[0]?.verdict.decision).toBe("deny");
    expect(model[0]?.verdict.reason).toBe(
      "This Workflow launch's `model` is not a string literal the guard can read. Write policy options as string literals.",
    );
    // A backtick literal with no placeholder is a fixed string, and read like any other.
    expect(
      judgeWorkflow('await agent("x", { model: `haiku`, effort: "high" });', CTX, NO_ENV)[0]
        ?.verdict.decision,
    ).toBe("allow");
    const prompt = judgeWorkflow(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is a template that builds its prompt.
      'await agent(`fix ${file}`, { model: "fable", effort: "high", agentType: "Plan" });',
      CTX,
      NO_ENV,
    );
    expect(prompt[0]?.verdict.decision).toBe("deny");
    expect(prompt[0]?.verdict.reason).toContain("prompt is built at run time");
  });

  it("`agent` handed around refuses the whole Workflow: nothing it launches can be read", async () => {
    const script = [
      'const run = agent;\nawait run("x", { model: "opus", effort: "high" });',
      'await agent?.("x", { model: "haiku", effort: "low" });',
      'const helpers = [agent];\nawait helpers[0]("x", { model: "haiku", effort: "low" });',
      // A use inside a template literal's placeholder is code too: the scan reads it.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture hands `agent` around inside a template.
      "const label = `run: ${agent}`;\nconst meta = { label };",
    ].join("\n");
    const refusal = workflowRefusal(script);
    expect(refusal).toContain("without calling it at once");
    // The first one is named by its line, so the script can be fixed.
    expect(refusal).toContain("(line 1)");
    const answer = JSON.parse(
      (await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain("never reaches a hook");
    expect(answer.permissionDecisionReason).toContain('agent("<prompt>"');
  });

  it("options built at run time refuse the whole Workflow: the literal read can be replaced", async () => {
    const scripts = [
      'await agent("x", { model: "haiku", effort: "low", ["model"]: "opus" });',
      'await agent("x", { model: "haiku", effort: "low", ...overrides });',
      // The same option twice: JavaScript keeps the last, the guard would read the first.
      'await agent("x", { model: "haiku", effort: "low", model: "opus" });',
    ];
    for (const script of scripts) {
      expect(workflowRefusal(script)).toContain("cannot be read");
      const answer = JSON.parse(
        (await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).stdout ?? "{}",
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
    // The prompt is built (`"fix " + file`), which matters only to a tier that reads a reason
    // line: at `max` the opus tier asks for the effort, and below it the prompt changes nothing.
    const helper = (effort: string) =>
      [
        "async function one(file) {",
        `  return agent("fix " + file, { model: "opus", effort: "${effort}" });`,
        "}",
      ].join("\n");
    expect(workflowRefusal(helper("high"))).toBeNull();
    expect(judgeWorkflow(helper("max"), CTX, NO_ENV)[0]?.verdict.decision).toBe("ask");
    expect(judgeWorkflow(helper("high"), CTX, NO_ENV)[0]?.verdict.decision).toBe("allow");
    const inTemplate =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture calls `agent` inside a template.
      'const done = `result: ${await agent("x", { model: "haiku", effort: "high" })}`;';
    expect(workflowRefusal(inTemplate)).toBeNull();
    expect(judgeWorkflow(inTemplate, CTX, NO_ENV).map((one) => one.verdict.decision)).toEqual([
      "allow",
    ]);
  });

  it("a Workflow agent() at `low` is refused, on every model; `medium` runs on Claude", async () => {
    const script = [
      'await agent("search it", { label: "scout", model: "haiku", effort: "medium" });',
      'await agent("build it", { label: "worker", model: "cc-smart-dev-kit-worker", effort: "low" });',
      'await agent("check it", { label: "audit", model: "sonnet", effort: "high" });',
    ].join("\n");
    const results = judgeWorkflow(script, CTX, NO_ENV);
    expect(results.map((one) => one.verdict.decision)).toEqual(["allow", "deny", "allow"]);
    expect(results[1]?.verdict.reason).toContain("asks for effort `low`");
    const answer = JSON.parse(
      (await agentGuard(workflowCall(script), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(answer.permissionDecisionReason).toContain('the launch "worker"');
    expect(answer.permissionDecisionReason).toContain("asks for effort `low`");
  });

  it("a script with no agent(…) call: nothing to say", async () => {
    expect(judgeWorkflow("export const meta = {};", CTX, NO_ENV)).toEqual([]);
    expect(await agentGuard(workflowCall("return 1;"), NO_ENV, WORKFLOW_PATHS, "/tmp/app")).toEqual(
      {},
    );
  });

  it("G2: a call with no script at all is no longer let through: it asks", async () => {
    // Before G2 this was silent, and so was every run by `name` or `scriptPath`.
    const answer = await agentGuard(
      { hook_event_name: "PreToolUse", tool_input: {}, tool_name: "Workflow" },
      NO_ENV,
      WORKFLOW_PATHS,
      "/tmp/app",
    );
    expect(JSON.parse(answer.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
  });
});

describe("the hook's answer, and the record", () => {
  function paths(): CliPaths {
    const home = tempDir("guard-home");
    return testPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  }

  it("denied: a PreToolUse deny on stdout, and nothing recorded", async () => {
    const where = paths();
    const result = await agentGuard(
      agentCall({ effort: "low", model: "opus", prompt: "x" }),
      NO_ENV,
      where,
      "/tmp/app",
    );
    const answer = JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
  });

  it("allowed: silent, and the Opus launch is recorded with its reason", async () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const result = await agentGuard(
      agentCall({
        effort: "xhigh",
        model: "opus",
        prompt: "review it",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      }),
      NO_ENV,
      where,
      "/tmp/app",
    );
    expect(result).toEqual({});
    const [launch] = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launch?.family).toBe("opus");
    expect(launch?.reason).toBe("opus:xhigh");
    expect(launch?.project).toBe("/tmp/app");
    expect(launch?.subagentType).toBe("cc-smart-dev-kit:senior-engineer");
  });

  it("an asked Opus launch is recorded once it ran, and once only for one call", async () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const input = {
      ...agentCall({
        effort: "max",
        model: "opus",
        prompt: "Opus reason: debugging - the router hangs",
      }),
      session_id: "11111111-2222-3333-4444-555555555555",
      tool_use_id: "toolu_1",
    };
    const asked = await agentGuard(input, NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // Asked, not yet answered: nothing is recorded, also when PreToolUse runs again.
    await agentGuard(input, NO_ENV, where, "/tmp/app");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    // It ran (PostToolUse), so the person said yes: one record, and a second run adds none.
    const ran = { ...input, hook_event_name: "PostToolUse" };
    await agentGuard(ran, NO_ENV, where, "/tmp/app");
    await agentGuard(ran, NO_ENV, where, "/tmp/app");
    const launches = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.reason).toBe("opus:max:debugging");
    expect(launches[0]?.toolUseId).toBe("toolu_1");
    // Another tool call in the same session is a second launch.
    await agentGuard({ ...ran, tool_use_id: "toolu_2" }, NO_ENV, where, "/tmp/app");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toHaveLength(2);
  });

  it("a Workflow denied as a whole records none of its launches; an ask records them once it ran", async () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const denied = [
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });',
      'await agent("build it", { label: "worker", model: "haiku", effort: "low" });',
    ].join("\n");
    const answer = JSON.parse(
      (await agentGuard(workflowCall(denied), NO_ENV, where, "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("deny");
    // The whole call was refused, so nothing in it ran: no launch of it is recorded.
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    const asked =
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });';
    const second = JSON.parse(
      (await agentGuard(workflowCall(asked), NO_ENV, where, "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(second.permissionDecision).toBe("ask");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    await agentGuard(
      { ...workflowCall(asked), hook_event_name: "PostToolUse" },
      NO_ENV,
      where,
      "/tmp/app",
    );
    const launches = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.reason).toBe("fable:plan");
  });

  it("a Fable build launch is recorded once with its reason, `fable:build`", async () => {
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
    const asked = await agentGuard(input, NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    const ran = { ...input, hook_event_name: "PostToolUse" };
    await agentGuard(ran, NO_ENV, where, "/tmp/app");
    const launches = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.family).toBe("fable");
    expect(launches[0]?.reason).toBe("fable:build");
    expect(launches[0]?.subagentType).toBe("general-purpose");
    // The hook runs twice for one call (proved live): one record, not two.
    await agentGuard(ran, NO_ENV, where, "/tmp/app");
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toHaveLength(1);
  });

  it("an opus launch at effort max is recorded as `opus:max`, so `usage` lists it", async () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    const result = await agentGuard(
      agentCall({
        effort: "max",
        model: "opus",
        prompt: "review it",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      }),
      NO_ENV,
      where,
      "/tmp/app",
    );
    expect(JSON.parse(result.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // Recorded once the call ran (the person said yes).
    await agentGuard(
      {
        ...agentCall({
          effort: "max",
          model: "opus",
          prompt: "review it",
          subagent_type: "cc-smart-dev-kit:senior-engineer",
        }),
        hook_event_name: "PostToolUse",
      },
      NO_ENV,
      where,
      "/tmp/app",
    );
    const [launch] = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launch?.family).toBe("opus");
    expect(launch?.reason).toBe("opus:max");
    expect(launch?.subagentType).toBe("cc-smart-dev-kit:senior-engineer");
  });

  it("a Sonnet launch is not recorded, and a record of another shape is skipped", async () => {
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    await agentGuard(
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
    const facts = guardFacts(input, { env: NO_ENV, nowMs: 0, paths: where });
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
    // The tier an override answers with is the tier the guard judged by: an `opus` name whose
    // backend answers it is still the opus tier, allowed at `high` (D11).
    const overridden = guardFacts(agentCall({ effort: "high", model: "opus", prompt: "do it" }), {
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "openai:gpt-5.5" },
      nowMs: 0,
      paths: where,
    });
    expect(overridden).toEqual({
      decision: "allow",
      effort: "high",
      family: "opus",
      fork: false,
      model: "opus",
      subagent_type: null,
      tier: "opus",
      tool: "Agent",
      why: "opus:high",
    });
  });

  it("a record of another day is not in the window", async () => {
    expect(
      parseAgentLaunch(JSON.stringify({ at: 1, family: "opus", model: "m", reason: "review" })),
    ).toEqual({
      at: 1,
      // An old line's effort and word come from its reason (G2).
      effort: null,
      family: "opus",
      launchIndex: 0,
      model: "m",
      project: "",
      reason: "review",
      session: "",
      subagentType: "",
      toolUseId: "",
      word: "review",
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

/** The router's port in the session-gateway tests: only a URL names it, nothing connects. */
const SESSION_ROUTER = "http://127.0.0.1:39999";

/** A machine for the gateway tests: its paths, and the hook's environment for one session. */
type GuardMachine = CliPaths & { env: Record<string, string> };

/**
 * A machine whose `gateway.json` has `slots` (and `profiles`) on port 39999, and the environment
 * of a session whose effective `ANTHROPIC_BASE_URL` is `sessionUrl` (null: none). A hook process
 * gets the session's effective value in its own environment (proved live on 2.1.310), so that is
 * what the guard reads. `userFileUrl`: what the user's own settings file says, which the guard no
 * longer reads (RF1-2): a project or a `--settings` file decides over it.
 */
function guardMachine(
  slots: Record<string, string[]>,
  sessionUrl: null | string,
  options: { profiles?: Record<string, unknown>; userFileUrl?: string } = {},
): GuardMachine {
  const home = tempDir("guard-family");
  const where = testPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  mkdirSync(join(where.gatewayConfigFile, ".."), { recursive: true });
  writeFileSync(
    where.gatewayConfigFile,
    JSON.stringify({
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:9" } },
      port: 39_999,
      ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
      slots,
      version: 1,
    }),
    { mode: 0o600 },
  );
  mkdirSync(join(where.settingsFile, ".."), { recursive: true });
  writeFileSync(
    where.settingsFile,
    JSON.stringify(
      options.userFileUrl === undefined ? {} : { env: { ANTHROPIC_BASE_URL: options.userFileUrl } },
    ),
  );
  mkdirSync(where.stateDir, { recursive: true });
  return { ...where, env: sessionUrl === null ? {} : { ANTHROPIC_BASE_URL: sessionUrl } };
}

describe("the family's slot decides (0.5.0: no model is pinned in Claude Code's settings)", () => {
  // The machine as the hook reads it: `gateway.json` through the gateway's own reader, and the
  // session's own `ANTHROPIC_BASE_URL`. No `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` and no
  // `modelSlots` anywhere: the router sends a Claude model to its family's slot by itself.
  function machine(slots: Record<string, string[]>, gatewayOn: boolean): GuardMachine {
    return guardMachine(slots, gatewayOn ? SESSION_ROUTER : null);
  }

  /** The hook's PreToolUse answer for one Agent call; null when it stays silent (allowed). */
  async function answer(where: GuardMachine, fields: Record<string, unknown>) {
    const result = await agentGuard(agentCall(fields), where.env, where, "/tmp/app");
    if (result.stdout === undefined || result.stdout === "") return null;
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    return {
      decision: output.permissionDecision as string,
      reason: output.permissionDecisionReason as string,
    };
  }

  const WORKER_ON_BACKEND = { "cc-smart-dev-kit-worker": ["omniroute:glm-x"] };

  it("a sonnet launch on a worker chain that starts with a backend takes any allowed effort, `low` refused (2026-10-26)", async () => {
    const where = machine(WORKER_ON_BACKEND, true);
    for (const effort of ["medium", "high", "xhigh", "max"]) {
      expect(await answer(where, { effort, model: "sonnet", prompt: "build it" })).toBeNull();
    }
    // The full id goes to the same slot: the router reads the family, not the exact id.
    expect(
      await answer(where, { effort: "high", model: "claude-sonnet-9-9", prompt: "build it" }),
    ).toBeNull();
    const low = await answer(where, { effort: "low", model: "sonnet", prompt: "build it" });
    expect(low?.decision).toBe("deny");
    expect(low?.reason).toContain("asks for effort `low`");
    // Haiku's slot is the scout: with no scout chain, a haiku launch is Claude Haiku.
    expect(await answer(where, { effort: "high", model: "haiku", prompt: "search" })).toBeNull();
  });

  it("no worker chain, a chain that starts with Claude, or the gateway off: Claude Sonnet", async () => {
    for (const where of [
      machine({ "cc-smart-dev-kit-scout": ["omniroute:glm-x"] }, true),
      machine({ "cc-smart-dev-kit-worker": ["claude-sonnet-5-5", "omniroute:glm-x"] }, true),
      machine(WORKER_ON_BACKEND, false),
    ]) {
      expect(
        await answer(where, { effort: "high", model: "sonnet", prompt: "build it" }),
      ).toBeNull();
    }
    // With the gateway off nothing reaches the router: an opus chain there answers nothing, and
    // the launch is named for the Claude model that runs it. Below `max` that is a silent allow;
    // at `max` the ask names Claude Opus.
    const off = machine({ "cc-smart-dev-kit-opus": ["omniroute:glm-x"] }, false);
    expect(await answer(off, { effort: "high", model: "opus", prompt: "do it" })).toBeNull();
    expect(
      (await answer(off, { effort: "max", model: "opus", prompt: "do it" }))?.reason,
    ).toContain("Claude Opus launch at effort `max`");
  });

  it("opus and fable keep their gates by name when their slot starts with a backend", async () => {
    const where = machine(
      {
        "cc-smart-dev-kit-fable": ["omniroute:glm-x"],
        "cc-smart-dev-kit-opus": ["omniroute:glm-x"],
      },
      true,
    );
    // The opus tier at `max` asks, naming what answers it.
    const bare = await answer(where, { effort: "max", model: "opus", prompt: "do it" });
    expect(bare?.decision).toBe("ask");
    expect(bare?.reason).toContain("`opus` (answered by omniroute:glm-x) launch at effort `max`");
    expect(bare?.reason).not.toContain("affordable");
    // Below `max` the tier runs with no question, review or not (D11).
    expect(await answer(where, { effort: "high", model: "opus", prompt: "do it" })).toBeNull();
    expect(
      await answer(where, {
        effort: "xhigh",
        model: "opus",
        prompt: "r",
        subagent_type: "cc-smart-dev-kit:senior-engineer",
      }),
    ).toBeNull();
    // Fable: a read-only agent with its reason asks, naming what answers it; a builder without
    // the word `build` is refused.
    const advice = await answer(where, {
      effort: "high",
      model: "fable",
      prompt: "Fable reason: plan - yes",
      subagent_type: "Plan",
    });
    expect(advice?.decision).toBe("ask");
    expect(advice?.reason).toContain("`fable` (answered by omniroute:glm-x) launch: a read-only");
    expect(
      (await answer(where, { effort: "max", model: "fable", prompt: "do it", subagent_type: "x" }))
        ?.decision,
    ).toBe("deny");
    // The record names the tier and the model that answered it.
    const [record] = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(record?.family).toBe("opus");
    expect(record?.model).toBe("omniroute:glm-x");
  });
});

describe("RF1-2: the guard judges the session's own gateway, not the machine's file", () => {
  const WORKER_ON_BACKEND = { "cc-smart-dev-kit-worker": ["omniroute:glm-x"] };
  const OPUS_ON_BACKEND = { "cc-smart-dev-kit-opus": ["omniroute:glm-x"] };

  async function answer(where: GuardMachine, fields: Record<string, unknown>) {
    const result = await agentGuard(agentCall(fields), where.env, where, "/tmp/app");
    if (result.stdout === undefined || result.stdout === "") return null;
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    return {
      decision: output.permissionDecision as string,
      reason: output.permissionDecisionReason as string,
    };
  }

  it("the machine is on with a backend worker chain, the project is off: a sonnet launch runs on Claude", async () => {
    // `gateway project off` writes Anthropic's own address into the project's file, which the
    // session's environment carries over the user file's router address.
    const where = guardMachine(WORKER_ON_BACKEND, "https://api.anthropic.com", {
      userFileUrl: SESSION_ROUTER,
    });
    expect(await answer(where, { effort: "high", model: "sonnet", prompt: "build it" })).toBeNull();
    // A launch started with no URL anywhere goes to Anthropic too.
    const bare = guardMachine(WORKER_ON_BACKEND, null, { userFileUrl: SESSION_ROUTER });
    expect(await answer(bare, { effort: "high", model: "sonnet", prompt: "build it" })).toBeNull();
  });

  // A launch that declares UI/UX work is refused on Sonnet whatever answers it, and its message
  // names the model that really answers: that shows which gateway the guard read.
  const UI_ON_SONNET = {
    effort: "high",
    model: "sonnet",
    prompt: "Build it.\nOpus reason: ui - the page",
  };

  it("the machine is off, the project is on: the backend worker chain answers, at any effort", async () => {
    const where = guardMachine(WORKER_ON_BACKEND, SESSION_ROUTER);
    for (const effort of ["medium", "high", "max"]) {
      expect(await answer(where, { effort, model: "sonnet", prompt: "build it" })).toBeNull();
    }
    expect((await answer(where, UI_ON_SONNET))?.reason).toContain(
      "would run on `omniroute:glm-x` at effort `high`",
    );
  });

  it("an opus launch at max: the premium ask names what really answers it", async () => {
    // The machine's file says on with an opus chain on a backend; the session is off, so Claude
    // Opus answers, and the ask names Claude Opus rather than the backend.
    const off = guardMachine(OPUS_ON_BACKEND, "https://api.anthropic.com", {
      userFileUrl: SESSION_ROUTER,
    });
    const offAsk = await answer(off, { effort: "max", model: "opus", prompt: "do it" });
    expect(offAsk?.decision).toBe("ask");
    expect(offAsk?.reason).toContain("Claude Opus launch at effort `max`");
    // The reverse: the session is on while the machine's file says nothing.
    const on = guardMachine(OPUS_ON_BACKEND, SESSION_ROUTER);
    expect((await answer(on, { effort: "max", model: "opus", prompt: "do it" }))?.reason).toContain(
      "`opus` (answered by omniroute:glm-x) launch at effort `max`",
    );
  });

  it("a profile's URL: that profile's chains decide, and a name the config lacks is plain Claude", async () => {
    const profiles = {
      cheap: { slots: { "cc-smart-dev-kit-worker": ["omniroute:glm-x"] } },
      plain: { slots: { "cc-smart-dev-kit-worker": "claude" } },
    };
    // The machine's worker answers on Claude; the profile `cheap` puts it on a backend.
    const cheap = guardMachine({}, `${SESSION_ROUTER}/p/cheap`, { profiles });
    expect((await answer(cheap, UI_ON_SONNET))?.reason).toContain("would run on `omniroute:glm-x`");
    // The machine's worker is on a backend; the profile `plain` turns it off there.
    const plain = guardMachine(WORKER_ON_BACKEND, `${SESSION_ROUTER}/p/plain`, { profiles });
    expect((await answer(plain, UI_ON_SONNET))?.reason).toContain("would run on `sonnet`");
    // A name the config does not hold answers as plain Claude, as the router does.
    const unknown = guardMachine(WORKER_ON_BACKEND, `${SESSION_ROUTER}/p/nope`, { profiles });
    expect((await answer(unknown, UI_ON_SONNET))?.reason).toContain("would run on `sonnet`");
  });
});

describe("the opus tier's free path needs a reading proved as Opus (D11)", () => {
  const unattended = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
  const bedrockFable = "us.anthropic.claude-fable-5-1-20261001-v1:0";

  it("a name the guard cannot read asks at any effort, and is refused where nobody answers", () => {
    for (const name of ["inherit", "best", "some-new-model"]) {
      const real = resolveLaunchModel(name, NO_GATEWAY, NO_ENV);
      expect(real.tier).toBe("opus");
      expect(real.family).toBeNull();
      const launch = { effort: "high", model: name, prompt: "do it" };
      const asked = verdict(launch);
      expect(asked.decision).toBe("ask");
      expect(asked.why).toBe("opus:unreadable");
      expect(asked.reason).toContain("cannot read the model behind it as Claude Opus");
      const refused = verdict(launch, CTX, unattended);
      expect(refused.decision).toBe("deny");
      expect(refused.reason).toContain("Name `opus` (or a Claude Opus id) as its model.");
    }
  });

  it("a cloud provider's Claude id has its own family: Fable is the fable tier", () => {
    const real = resolveLaunchModel(bedrockFable, NO_GATEWAY, NO_ENV);
    expect(real.family).toBe("fable");
    expect(real.tier).toBe("fable");
    const opus = resolveLaunchModel(
      "us.anthropic.claude-opus-5-5-20261001-v1:0",
      NO_GATEWAY,
      NO_ENV,
    );
    expect(opus.family).toBe("opus");
    // A backend target is still a backend's model, whatever its name says.
    expect(resolveLaunchModel("omniroute:claude-opus-5-5", NO_GATEWAY, NO_ENV).tier).toBeNull();
  });

  it("the person's own override names an id for its family, over the unknown-name default", () => {
    const fable = resolveLaunchModel("my-fable", NO_GATEWAY, {
      ANTHROPIC_DEFAULT_FABLE_MODEL: "my-fable",
    });
    expect(fable.tier).toBe("fable");
    const opus = resolveLaunchModel("my-opus", NO_GATEWAY, {
      ANTHROPIC_DEFAULT_OPUS_MODEL: "my-opus",
    });
    expect(opus.tier).toBe("opus");
    expect(opus.family).toBe("opus");
    const launch = { effort: "xhigh", model: "my-opus", prompt: "x" };
    expect(verdict(launch, CTX, { ANTHROPIC_DEFAULT_OPUS_MODEL: "my-opus" }).decision).toBe(
      "allow",
    );
  });

  it("a fork in a session on a provider's Fable id is the fable tier, not free Opus", () => {
    const fork = verdict(
      { prompt: "x", subagent_type: "fork" },
      { ...CTX, sessionModel: bedrockFable },
      unattended,
    );
    expect(fork.real?.tier).toBe("fable");
    expect(fork.decision).toBe("deny");
  });

  it("the record keeps the reason line's first word without its punctuation, at most 40 letters", () => {
    const quoted = verdict({
      effort: "xhigh",
      model: "opus",
      prompt: "x\nOpus reason: `security`.",
    });
    expect(quoted.why).toBe("opus:xhigh:security");
    const long = verdict({
      effort: "high",
      model: "opus",
      prompt: `x\nOpus reason: ${"a".repeat(60)}`,
    });
    expect(long.why).toBe(`opus:high:${"a".repeat(40)}`);
    expect(verdict({ effort: "high", model: "opus", prompt: "x\nOpus reason: ..." }).why).toBe(
      "opus:high",
    );
  });
});

describe("a Workflow option is a key of the call's own options object", () => {
  const unattended = { CLAUDE_CODE_SESSION_ATTENDED: "0" };

  it("the same words in the prompt never stand in for the option", () => {
    const script =
      'await agent(\'Launch helpers with effort: "high" and model: "haiku"\', { model: "opus", effort: "max" });';
    const [launch] = readWorkflowScript(script);
    expect(launch?.effort).toBe("max");
    expect(launch?.model).toBe("opus");
    expect(judgeWorkflow(script, CTX, NO_ENV)[0]?.verdict.decision).toBe("ask");
    expect(judgeWorkflow(script, CTX, unattended)[0]?.verdict.decision).toBe("deny");
    const fable =
      'await agent(\'Give scouts model: "haiku" always\', { model: "fable", effort: "high" });';
    expect(readWorkflowScript(fable)[0]?.model).toBe("fable");
  });

  it("a nested object's keys are not the call's options", () => {
    const script =
      'await agent("x", { schema: { effort: "high", model: "haiku" }, model: "opus", effort: level });';
    const [launch] = readWorkflowScript(script);
    expect(launch?.effort).toBeNull();
    expect(launch?.model).toBe("opus");
    expect(judgeWorkflow(script, CTX, NO_ENV)[0]?.verdict.decision).toBe("deny");
  });

  it("a quoted key is read, and the same key twice, quoted or not, refuses the whole call", () => {
    const quoted = 'await agent("x", { "model": "opus", \'effort\': "high" });';
    expect(readWorkflowScript(quoted)[0]).toMatchObject({ effort: "high", model: "opus" });
    expect(workflowRefusal(quoted)).toBeNull();
    const twice = 'await agent("x", { model: "haiku", effort: "high", "model": "fable" });';
    expect(workflowRefusal(twice)).toContain("the same option written twice");
  });
});

describe("the read-only agent types (0.6.0: the code-explorer agent is gone)", () => {
  it("an agent named Code Explorer is no longer read-only: a Fable launch on it is a builder's", () => {
    const launch = {
      effort: "high",
      model: "fable",
      prompt: "Find the callers.\nFable reason: review - a second look",
      subagent_type: "Code Explorer",
    };
    const result = verdict(launch);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("`Code Explorer`, which can change files");
    // The advice names the read-only types from their one list.
    const unsaid = verdict({
      effort: "high",
      model: "fable",
      prompt: "x",
      subagent_type: "Explore",
    });
    expect(unsaid.reason).toContain(
      "Use a read-only agent type (Plan, Explore, cc-smart-dev-kit:auditor, cc-smart-dev-kit:edge-case-hunter, cc-smart-dev-kit:researcher) and put a line in the prompt saying why:",
    );
    // The same line on a read-only type still asks the person.
    expect(verdict({ ...launch, subagent_type: "Explore" }).decision).toBe("ask");
  });
});

describe("the audit fixes carried onto D11 (C3, merged with 0.5.5)", () => {
  function paths(): CliPaths {
    const home = tempDir("guard-c3");
    const where = testPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
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

  it("IN-2 (D5, D13): a medium scout launch is allowed; `low` is still refused", () => {
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
        "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` when the task wants it on `haiku` or `sonnet`, whatever model answers them (the `opus` tier asks the person at `max`).",
      ].join("\n"),
    );
  });

  it("IN-2 (D5, D11): an Opus launch at `medium` runs free, like `high` and `xhigh`", () => {
    const build = verdict({
      effort: "medium",
      model: "opus",
      prompt: "Opus reason: security - the token check",
    });
    expect(build.decision).toBe("allow");
    expect(build.why).toBe("opus:medium:security");
  });

  it("IN-24: the deny texts say the plugin's rule, never the owner's or a date", () => {
    const unattended = { CLAUDE_CODE_SESSION_ATTENDED: "0" };
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    const denials = [
      verdict({ model: "sonnet", prompt: "x" }),
      verdict({ effort: "low", model: "sonnet", prompt: "x" }),
      verdict({ effort: "high", model: "fable", prompt: "x", subagent_type: "Plan" }),
      verdict({ effort: "high", model: "fable", prompt: "x", subagent_type: "general-purpose" }),
      verdict({ effort: "low", model: "cc-smart-dev-kit-worker", prompt: "x" }, on),
      verdict({ effort: "max", model: "opus", prompt: "x" }, CTX, unattended),
    ];
    for (const one of denials) {
      expect(one.decision).toBe("deny");
      expect(one.reason).not.toMatch(/owner/i);
      expect(one.reason).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    expect(denials[1]?.reason).toContain("(the plugin's rule)");
  });

  it("HK hunch 4: punctuation around a reason word is dropped ('Fable reason: plan.')", () => {
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
      verdict({
        effort: "high",
        model: "fable",
        prompt: "Fable reason: planish. - x",
        subagent_type: "Plan",
      }).decision,
    ).toBe("deny");
    // An Opus line only names the purpose in the record, read the same way.
    expect(verdict({ effort: "high", model: "opus", prompt: "Opus reason: security." }).why).toBe(
      "opus:high:security",
    );
  });

  it("HK hunch 3: an asked launch is recorded only once it ran (PostToolUse), never on the ask", async () => {
    const where = paths();
    const call = agentCall({
      effort: "max",
      model: "opus",
      prompt: "Opus reason: debugging - the router hangs",
    });
    const asked = await agentGuard(at("PreToolUse", call), NO_ENV, where, "/tmp/app");
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // The person has not answered yet: nothing is recorded.
    expect(records(where)).toEqual([]);
    // The call ran, so the person said yes: one record, and the hook says nothing.
    expect(await agentGuard(at("PostToolUse", call), NO_ENV, where, "/tmp/app")).toEqual({});
    const launches = records(where);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.reason).toBe("opus:max:debugging");
    expect(launches[0]?.toolUseId).toBe("toolu_c3");
  });

  it("HK hunch 3: an allowed launch is recorded on PreToolUse, and its PostToolUse adds nothing", async () => {
    const where = paths();
    const build = agentCall({ effort: "high", model: "opus", prompt: "build it" });
    expect(await agentGuard(at("PreToolUse", build), NO_ENV, where, "/tmp/app")).toEqual({});
    expect(records(where).map((one) => one.reason)).toEqual(["opus:high"]);
    expect(await agentGuard(at("PostToolUse", build), NO_ENV, where, "/tmp/app")).toEqual({});
    expect(records(where)).toHaveLength(1);
    // A launch the guard denies records nothing, even on a PostToolUse run.
    const bare = agentCall({ model: "opus", prompt: "do it" });
    await agentGuard(at("PostToolUse", bare), NO_ENV, where, "/tmp/app");
    expect(records(where)).toHaveLength(1);
    // A Sonnet launch is never recorded.
    await agentGuard(
      at("PostToolUse", agentCall({ effort: "high", model: "sonnet", prompt: "x" })),
      NO_ENV,
      where,
      "/tmp/app",
    );
    expect(records(where)).toHaveLength(1);
  });

  it("HK hunch 3: a Workflow that asks records its launches only once it ran", async () => {
    const where = paths();
    const script = [
      'await agent("Fable reason: plan - look", { label: "advice", model: "fable", effort: "max", agentType: "Plan" });',
      'await agent("check it", { label: "check", model: "opus", effort: "high", agentType: "cc-smart-dev-kit:senior-engineer" });',
    ].join("\n");
    const asked = await agentGuard(
      at("PreToolUse", workflowCall(script)),
      NO_ENV,
      where,
      "/tmp/app",
    );
    expect(JSON.parse(asked.stdout ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    // The person may still say no to the whole call: none of its launches is recorded yet,
    // not even the one that needed no question.
    expect(records(where)).toEqual([]);
    expect(
      await agentGuard(at("PostToolUse", workflowCall(script)), NO_ENV, where, "/tmp/app"),
    ).toEqual({});
    expect(records(where).map((one) => one.reason)).toContain("fable:plan");
    // A Workflow the guard allows outright is recorded on PreToolUse, and not again after it.
    const quiet = paths();
    const opusOnly =
      'await agent("check it", { label: "check", model: "opus", effort: "high", agentType: "cc-smart-dev-kit:senior-engineer" });';
    expect(
      await agentGuard(at("PreToolUse", workflowCall(opusOnly)), NO_ENV, quiet, "/tmp/app"),
    ).toEqual({});
    expect(records(quiet).map((one) => one.reason)).toEqual(["opus:high"]);
    await agentGuard(at("PostToolUse", workflowCall(opusOnly)), NO_ENV, quiet, "/tmp/app");
    expect(records(quiet)).toHaveLength(1);
  });

  it("HK hunch 3: guardFacts logs no verdict for a PostToolUse run", () => {
    const where = paths();
    const call = agentCall({ effort: "max", model: "opus", prompt: "Opus reason: ui - x" });
    expect(guardFacts(at("PostToolUse", call), { env: NO_ENV, nowMs: 0, paths: where })).toEqual({
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
    // It spends the person's Opus usage: the opus tier's rules hold (free below `max`, asked at it).
    expect(verdict({ effort: "high", model: "sonnet", prompt: "build it" }, CTX, env).why).toBe(
      "opus:high",
    );
    expect(verdict({ effort: "max", model: "sonnet", prompt: "build it" }, CTX, env).decision).toBe(
      "ask",
    );
    // Haiku on Claude Fable is the fable tier: even a read-only type needs its reason line.
    expect(
      verdict({ effort: "high", model: "haiku", prompt: "r", subagent_type: "Plan" }, CTX, {
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
      verdict({ effort: "max", model: "sonnet", prompt: "build it" }, { ...on, sessionModel: null })
        .decision,
    ).toBe("ask");
    // `opus` stays the opus tier when its own slot answers with a Claude Sonnet: never lower.
    config.slots["cc-smart-dev-kit-opus"] = ["claude-sonnet-5-5"];
    expect(resolveLaunchModel("opus", on, NO_ENV).tier).toBe("opus");
  });
});

describe("G1: the guard judges what really runs (Claude Code's overrides, 2.1.306)", () => {
  function paths(): CliPaths {
    const home = tempDir("guard-g1");
    return testPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  }
  const FORCE = { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" };
  const WHERE =
    "where it is set — the environment Claude Code was started with, or the `env` of a Claude Code settings file (the user's, the project's, or the project's local one)";
  const OPUS_MAX_ASK = [
    "Claude Opus launch at effort `max`: `general-purpose`.",
    "The opus tier runs at `medium`, `high` or `xhigh` with no question; `max` only when the person asks for it. Approve only if you did.",
  ];
  /**
   * The input Claude Code really sent under FORCE and `CLAUDE_CODE_EFFORT_LEVEL` (seen live on
   * 2.1.306): the Agent tool had lost `model` and `effort`, so the call carries neither. It is
   * read from its JSON text, the way the hook reads stdin.
   */
  const LIVE_FORCED_INPUT = (): HookInput =>
    JSON.parse(
      JSON.stringify({
        cwd: "/tmp/app",
        effort: { level: "high" },
        hook_event_name: "PreToolUse",
        permission_mode: "auto",
        session_id: "8110edd1-9058-4aea-a039-fdbcecdaca81",
        tool_input: {
          description: "Answer 2+2",
          prompt: "Answer this question and report back the answer in one short sentence.",
          run_in_background: false,
          subagent_type: "general-purpose",
        },
        tool_name: "Agent",
        tool_use_id: "call_1",
      }),
    );

  it("G1: the live bug — the input FORCE and EFFORT_LEVEL leave is allowed, not refused", async () => {
    const env = {
      ...FORCE,
      CLAUDE_CODE_EFFORT_LEVEL: "high",
      CLAUDE_CODE_SUBAGENT_MODEL: "haiku",
    };
    const where = paths();
    expect(await agentGuard(LIVE_FORCED_INPUT(), env, where, "/tmp/app")).toEqual({});
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
    // The same call with no override still names nothing: refused, as before.
    const plain = readLaunch(LIVE_FORCED_INPUT());
    if (plain === null) throw new Error("not an Agent call");
    expect(judgeLaunch(plain, CTX, NO_ENV).decision).toBe("deny");
    // `null` for both fields (the other shape seen for a removed field) reads the same.
    const nulls = verdict(
      { effort: null, model: null, prompt: "x", subagent_type: "general-purpose" },
      CTX,
      env,
    );
    expect(nulls.decision).toBe("allow");
    expect(nulls.real?.model).toBe("haiku");
  });

  it("G1: FORCE with CLAUDE_CODE_SUBAGENT_MODEL=haiku and a call naming opus: judged as haiku, recorded nowhere", async () => {
    const env = { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "haiku" };
    const where = paths();
    const call = agentCall({ effort: "max", model: "opus", prompt: "x" });
    expect(await agentGuard(call, env, where, "/tmp/app")).toEqual({});
    expect(
      await agentGuard({ ...call, hook_event_name: "PostToolUse" }, env, where, "/tmp/app"),
    ).toEqual({});
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)).toEqual([]);
  });

  it("G1: FORCE with CLAUDE_CODE_SUBAGENT_MODEL=opus and a call naming sonnet: the opus tier, recorded as opus", async () => {
    const env = { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "opus" };
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    expect(
      await agentGuard(
        agentCall({ effort: "high", model: "sonnet", prompt: "x" }),
        env,
        where,
        "/a",
      ),
    ).toEqual({});
    const [launch] = readAgentLaunches(agentLaunchesFile(where.stateDir), 0);
    expect(launch?.family).toBe("opus");
    expect(launch?.model).toBe("opus");
    expect(launch?.reason).toBe("opus:high");
    const asked = verdict({ effort: "max", model: "sonnet", prompt: "x" }, CTX, env);
    expect(asked.decision).toBe("ask");
    expect(asked.reason).toBe(
      [
        "This launch runs on `opus` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set, with `CLAUDE_CODE_SUBAGENT_MODEL=opus`: Claude Code ignores the launch's own `model`.",
        ...OPUS_MAX_ASK,
      ].join("\n"),
    );
  });

  it("G1: FORCE alone: the session's own model; one the guard cannot read is the opus tier", () => {
    const fable: GuardContext = { ...CTX, sessionModel: "claude-fable-5-1" };
    const built = verdict({ effort: "high", model: "haiku", prompt: "build it" }, fable, FORCE);
    expect(built.decision).toBe("deny");
    expect(built.reason).toBe(
      [
        "This launch runs on the session's own model, `claude-fable-5-1`, because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set without `CLAUDE_CODE_SUBAGENT_MODEL`: Claude Code ignores the launch's own `model`.",
        "This launch would run on Claude Fable, and it asks for `(no type)`, which can change files.",
        "Fable builds only when the person asks: put what they asked for in the prompt as this line, and they approve this one launch:",
        "Fable reason: build - <what the person asked>",
      ].join("\n"),
    );
    // `inherit` is the same as no model of its own.
    const inherit = { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "inherit" };
    expect(verdict({ effort: "high", model: "haiku", prompt: "x" }, fable, inherit).decision).toBe(
      "deny",
    );
    // A Haiku session: a call naming opus at max runs on Haiku, with no question.
    const haiku: GuardContext = { ...CTX, sessionModel: "claude-haiku-4-5" };
    expect(verdict({ effort: "max", model: "opus", prompt: "x" }, haiku, FORCE).decision).toBe(
      "allow",
    );
    // A session model nobody can read: the opus tier — free below `max`, asked at `max`.
    const free = verdict({ effort: "high", model: "haiku", prompt: "x" }, CTX, FORCE);
    expect(free.decision).toBe("allow");
    expect(free.real?.tier).toBe("opus");
    expect(free.why).toBe("opus:high");
    const asked = verdict({ effort: "max", model: "haiku", prompt: "x" }, CTX, FORCE);
    expect(asked.decision).toBe("ask");
    expect(asked.reason).toBe(
      [
        "This launch runs on the session's own model because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set without `CLAUDE_CODE_SUBAGENT_MODEL`: Claude Code ignores the launch's own `model`. The guard cannot read the session's model, so it judges the launch as the opus tier.",
        ...OPUS_MAX_ASK,
      ].join("\n"),
    );
  });

  it("G1: FORCE and a fork: the fork still runs on the session's model", () => {
    const env = { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "haiku" };
    const opusSession: GuardContext = { ...CTX, sessionModel: OPUS_ID };
    const fork = verdict({ prompt: "x", subagent_type: "fork" }, opusSession, env);
    expect(fork.decision).toBe("allow");
    expect(fork.real?.tier).toBe("opus");
    expect(fork.why).toBe("opus:session-effort");
    expect(fork.ran.modelFrom).toBe("fork");
  });

  it("G1: CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: no effect on an Agent call; a Workflow agent runs on it", async () => {
    const env = { CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: "opus" };
    const agent = verdict({ effort: "high", model: "sonnet", prompt: "x" }, CTX, env);
    expect(agent.decision).toBe("allow");
    expect(agent.real?.tier).toBeNull();
    const script = 'await agent("look", { label: "scan", model: "haiku", effort: "max" });';
    const [one] = judgeWorkflow(script, CTX, env);
    expect(one?.verdict.decision).toBe("ask");
    expect(one === undefined ? "" : workflowReason(one)).toBe(
      [
        'In this workflow, the launch "scan": This launch runs on `opus` because `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` is set: Claude Code ignores the script\'s own `model`.',
        ...OPUS_MAX_ASK,
      ].join("\n"),
    );
    // A launch that names no model runs on the variable's: it is judged, not refused.
    const unnamed = 'await agent("look", { label: "scan", effort: "high" });';
    expect(judgeWorkflow(unnamed, CTX, env)[0]?.verdict.decision).toBe("allow");
    expect(judgeWorkflow(unnamed, CTX, NO_ENV)[0]?.verdict.decision).toBe("deny");
    // FORCE comes first, for a Workflow agent too.
    const forced = { ...env, ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "haiku" };
    expect(judgeWorkflow(script, CTX, forced)[0]?.verdict.decision).toBe("allow");
    // The hook: the ask reaches the person.
    const answer = JSON.parse(
      (await agentGuard(workflowCall(script), env, paths(), "/tmp/app")).stdout ?? "{}",
    ).hookSpecificOutput;
    expect(answer.permissionDecision).toBe("ask");
  });

  it("G1: CLAUDE_CODE_EFFORT_LEVEL=high and a call naming max: judged at high, no ask", () => {
    const env = { CLAUDE_CODE_EFFORT_LEVEL: "high" };
    const launch = verdict({ effort: "max", model: "opus", prompt: "x" }, CTX, env);
    expect(launch.decision).toBe("allow");
    expect(launch.why).toBe("opus:high");
    // The call carries no `effort` at all there: still judged at high.
    expect(verdict({ model: "opus", prompt: "x" }, CTX, env).decision).toBe("allow");
    // At max, the opus tier asks, and the ask says where the effort comes from.
    const asked = verdict({ model: "opus", prompt: "x" }, CTX, { CLAUDE_CODE_EFFORT_LEVEL: "max" });
    expect(asked.decision).toBe("ask");
    expect(asked.reason).toBe(
      [
        `It runs at effort \`max\` because \`CLAUDE_CODE_EFFORT_LEVEL\` is set: Claude Code ignores the launch's own \`effort\`, and only the person can change the variable, ${WHERE}.`,
        ...OPUS_MAX_ASK,
      ].join("\n"),
    );
  });

  it("G1: CLAUDE_CODE_EFFORT_LEVEL=auto on Claude Sonnet or Haiku: allowed", () => {
    for (const model of ["sonnet", "haiku"]) {
      const env = { CLAUDE_CODE_EFFORT_LEVEL: "auto" };
      expect(verdict({ model, prompt: "x" }, CTX, env).decision).toBe("allow");
      // Any case, as Claude Code reads it; and the call's own `max` does not count.
      const upper = { CLAUDE_CODE_EFFORT_LEVEL: " AUTO " };
      expect(verdict({ effort: "max", model, prompt: "x" }, CTX, upper).decision).toBe("allow");
    }
  });

  it("G1: CLAUDE_CODE_EFFORT_LEVEL=auto on the opus tier: allowed with no ask, recorded as opus:auto", async () => {
    const env = { CLAUDE_CODE_EFFORT_LEVEL: "auto" };
    const free = verdict({ model: "opus", prompt: "x" }, CTX, env);
    expect(free.decision).toBe("allow");
    expect(free.why).toBe("opus:auto");
    const where = paths();
    mkdirSync(where.stateDir, { recursive: true });
    expect(await agentGuard(agentCall({ model: "opus", prompt: "x" }), env, where, "/a")).toEqual(
      {},
    );
    expect(readAgentLaunches(agentLaunchesFile(where.stateDir), 0)[0]?.reason).toBe("opus:auto");
    // Unattended too: `auto` is never `max`, so nothing waits for a person.
    expect(
      verdict({ model: "opus", prompt: "x" }, CTX, { ...env, CLAUDE_CODE_SESSION_ATTENDED: "0" })
        .decision,
    ).toBe("allow");
  });

  it("G1: CLAUDE_CODE_EFFORT_LEVEL=auto on an affordable slot: allowed, as on Claude (2026-10-26)", () => {
    const on: GuardContext = { ...ON_SLOTS, sessionModel: null };
    const allowed = verdict({ model: "sonnet", prompt: "x" }, on, {
      CLAUDE_CODE_EFFORT_LEVEL: "auto",
    });
    expect(allowed.decision).toBe("allow");
  });

  it("G1: CLAUDE_CODE_EFFORT_LEVEL=auto on the fable tier: its reason-line rules, as before", () => {
    const env = { CLAUDE_CODE_EFFORT_LEVEL: "auto" };
    const read = verdict(
      { model: "fable", prompt: "Fable reason: plan - look", subagent_type: "Plan" },
      CTX,
      env,
    );
    expect(read.decision).toBe("ask");
    expect(read.why).toBe("fable:plan");
    expect(read.reason).toContain("a read-only agent (`Plan`) at effort `auto`");
    expect(verdict({ model: "fable", prompt: "build it" }, CTX, env).decision).toBe("deny");
    expect(
      verdict({ model: "fable", prompt: "Fable reason: build - asked" }, CTX, env).decision,
    ).toBe("ask");
  });

  it("G1: CLAUDE_CODE_EFFORT_LEVEL=low (or a level no rule knows): refused, naming the variable and where to change it", () => {
    for (const level of ["low", "ultra"]) {
      const refused = verdict({ model: "sonnet", prompt: "x" }, CTX, {
        CLAUDE_CODE_EFFORT_LEVEL: level,
      });
      expect(refused.decision).toBe("deny");
      expect(refused.reason).toBe(
        [
          `\`CLAUDE_CODE_EFFORT_LEVEL\` is \`${level}\`, and Claude Code runs every subagent at it: no subagent may run at \`${level}\` (the plugin's rule).`,
          "A subagent runs at `medium`, `high`, `xhigh` or `max` — never `low`, on any model.",
          `Only the person can change the variable: ask them to set it to one of those levels, or to remove it, ${WHERE}.`,
        ].join("\n"),
      );
    }
    // A call that names `low` itself keeps today's words.
    expect(verdict({ effort: "low", model: "sonnet", prompt: "x" }).reason).toStartWith(
      "This launch asks for effort `low`",
    );
  });

  it("G1: FORCE onto an affordable slot: any allowed effort, from the call or from CLAUDE_CODE_EFFORT_LEVEL (2026-10-26)", () => {
    const on: GuardContext = { ...ON_SLOTS, sessionModel: null };
    const slot = { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "cc-smart-dev-kit-worker" };
    for (const effort of ["medium", "high", "max"]) {
      expect(verdict({ effort, prompt: "x" }, on, slot).decision).toBe("allow");
      // The variable sets the effort: judged on what it sets, as on Claude.
      expect(
        verdict({ prompt: "x" }, on, { ...slot, CLAUDE_CODE_EFFORT_LEVEL: effort }).decision,
      ).toBe("allow");
    }
    // `low` stays refused there, naming the variable when it sets it.
    expect(verdict({ effort: "low", prompt: "x" }, on, slot).decision).toBe("deny");
    const levelled = verdict({ prompt: "x" }, on, { ...slot, CLAUDE_CODE_EFFORT_LEVEL: "low" });
    expect(levelled.decision).toBe("deny");
    expect(levelled.reason).toContain("`CLAUDE_CODE_EFFORT_LEVEL` is `low`");
    // A `<backend>:<model>` target forced the same way, with the gateway on or off.
    const backend = { ...FORCE, CLAUDE_CODE_SUBAGENT_MODEL: "omniroute:glm-5.3" };
    for (const ctx of [on, CTX]) {
      expect(verdict({ effort: "max", prompt: "x" }, ctx, backend).decision).toBe("allow");
      expect(verdict({ effort: "high", prompt: "x" }, ctx, backend).decision).toBe("allow");
    }
  });

  it("G1: guardFacts logs the override and what the launch ran on", () => {
    const env = {
      ...FORCE,
      CLAUDE_CODE_EFFORT_LEVEL: "high",
      CLAUDE_CODE_SUBAGENT_MODEL: "opus",
    };
    expect(guardFacts(LIVE_FORCED_INPUT(), { env, nowMs: 0, paths: paths() })).toEqual({
      decision: "allow",
      effort: null,
      effort_override: "CLAUDE_CODE_EFFORT_LEVEL",
      family: "opus",
      fork: false,
      model: null,
      model_override: "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
      ran_effort: "high",
      ran_model: "opus",
      subagent_type: "general-purpose",
      tier: "opus",
      tool: "Agent",
      why: "opus:high",
    });
  });
});

describe("G2: every Workflow run is judged, however it names its script", () => {
  /** A home, its config folder, and a git repo in it: the session's cwd. */
  function world() {
    const home = tempDir("g2-home");
    const repo = join(home, "code", "my-app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const where = testPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(where.stateDir, { recursive: true });
    return { home, repo, where };
  }

  function put(path: string, text: string): void {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }

  /** A workflow script whose `meta.name` is `name`, with these lines of body. */
  function script(name: string, ...body: string[]): string {
    return [`export const meta = { name: "${name}", description: "A probe." };`, ...body].join(
      "\n",
    );
  }

  const OPUS_MAX = 'await agent("look", { label: "deep", model: "opus", effort: "max" });';
  const OPUS_HIGH = 'await agent("look", { label: "check", model: "opus", effort: "high" });';
  const HAIKU_LOW = 'await agent("look", { label: "cheap", model: "haiku", effort: "low" });';

  /** A Workflow call with this input, as Claude Code builds it. */
  function call(fields: Record<string, unknown>, event = "PreToolUse"): HookInput {
    return {
      hook_event_name: event,
      session_id: "11111111-2222-3333-4444-555555555555",
      tool_input: fields,
      tool_name: "Workflow",
      tool_use_id: "toolu_wf",
    };
  }

  function answer(result: { stdout?: string }) {
    return JSON.parse(result.stdout ?? "{}").hookSpecificOutput;
  }

  const records = (where: CliPaths) => readAgentLaunches(agentLaunchesFile(where.stateDir), 0);

  const UNATTENDED = { CLAUDE_CODE_SESSION_ATTENDED: "0" };

  /** The line every unreadable run's question ends with. */
  const UNREADABLE_ASK =
    "The guard cannot see the model and effort its launches run on: approve only if you know what this workflow runs.";

  it("G2: a saved workflow by name: its launches are judged and the ask names the workflow", async () => {
    const { repo, where } = world();
    put(join(repo, ".claude", "workflows", "probe.js"), script("probe", OPUS_MAX));
    expect(answer(await agentGuard(call({ name: "probe" }), NO_ENV, where, repo))).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: [
        'In the workflow `probe`, the launch "deep": Claude Opus launch at effort `max`: `general-purpose`.',
        "The opus tier runs at `medium`, `high` or `xhigh` with no question; `max` only when the person asks for it. Approve only if you did.",
      ].join("\n"),
    });
    // A denied launch in it denies the whole call.
    put(join(repo, ".claude", "workflows", "probe.js"), script("probe", HAIKU_LOW));
    expect(
      answer(await agentGuard(call({ name: "probe" }), NO_ENV, where, repo)).permissionDecision,
    ).toBe("deny");
  });

  it("G2: by scriptPath: the file is read and judged", async () => {
    const { repo, where } = world();
    const file = join(repo, "flows", "x.js");
    put(file, script("x", HAIKU_LOW));
    const result = answer(await agentGuard(call({ scriptPath: file }), NO_ENV, where, repo));
    expect(result.permissionDecision).toBe("deny");
    expect(result.permissionDecisionReason).toStartWith(
      `In the workflow \`${file}\`, the launch "cheap": `,
    );
  });

  it("G2: a plugin's `<plugin>:<name>`: from its installed folder", async () => {
    const { home, repo, where } = world();
    const root = join(home, "plugins", "probe-kit");
    put(join(root, "workflows", "audit-run.js"), script("audit-run", OPUS_MAX));
    put(
      where.installedPluginsFile,
      JSON.stringify({
        plugins: { "probe-kit@example-market": [{ installPath: root, scope: "user" }] },
        version: 2,
      }),
    );
    const result = answer(
      await agentGuard(call({ name: "probe-kit:audit-run" }), NO_ENV, where, repo),
    );
    expect(result.permissionDecision).toBe("ask");
    expect(result.permissionDecisionReason).toStartWith(
      'In the workflow `probe-kit:audit-run`, the launch "deep": ',
    );
  });

  it("G2: a bare name found in the user folder only", async () => {
    const { repo, where } = world();
    put(join(where.claudeConfigDir, "workflows", "probe.js"), script("probe", HAIKU_LOW));
    expect(
      answer(await agentGuard(call({ name: "probe" }), NO_ENV, where, repo)).permissionDecision,
    ).toBe("deny");
  });

  it("G2: two files claim one name: asked, naming both (refused in claude -p)", async () => {
    const { repo, where } = world();
    const a = join(repo, ".claude", "workflows", "a.js");
    const b = join(repo, ".claude", "workflows", "b.js");
    put(a, script("probe", OPUS_HIGH));
    put(b, script("probe", OPUS_MAX));
    const claim = `Two files claim the workflow name \`probe\`: \`${a}\` and \`${b}\`. Claude Code runs one of them, and which one depends on the order the folder lists them, so the guard cannot tell. Give each workflow its own \`meta.name\`.`;
    expect(answer(await agentGuard(call({ name: "probe" }), NO_ENV, where, repo))).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: [claim, UNREADABLE_ASK].join("\n"),
    });
    expect(answer(await agentGuard(call({ name: "probe" }), UNATTENDED, where, repo))).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: [
        claim,
        "The guard cannot see the model and effort its launches run on, and this session has nobody to answer (`claude -p`): pass the script inline (`script`), or by `scriptPath` to a file the guard can read, or run it in an interactive session.",
      ].join("\n"),
    });
  });

  it("G2: a built-in name, a missing file, a resume: each asks, saying why", async () => {
    const { repo, where } = world();
    const ask = async (fields: Record<string, unknown>) =>
      answer(await agentGuard(call(fields), NO_ENV, where, repo));
    expect(await ask({ name: "deep-research" })).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: [
        "The workflow `deep-research` has no file the guard can find: a built-in workflow (its script is inside Claude Code), or a saved one the guard cannot read.",
        UNREADABLE_ASK,
      ].join("\n"),
    });
    const missing = join(repo, "gone.js");
    expect((await ask({ scriptPath: missing })).permissionDecisionReason).toBe(
      [`The workflow script \`${missing}\` does not exist.`, UNREADABLE_ASK].join("\n"),
    );
    // A resume runs on from a script the guard does not see — even with one beside it.
    put(join(repo, "x.js"), script("x", OPUS_HIGH));
    expect(await ask({ resumeFromRunId: "run_1", scriptPath: join(repo, "x.js") })).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: [
        "This Workflow call resumes run `run_1`: the run goes on from a script the guard does not see, and it runs again every launch whose prompt or options changed.",
        UNREADABLE_ASK,
      ].join("\n"),
    });
    expect((await ask({})).permissionDecisionReason).toBe(
      ["This Workflow call names no `script`, `name` or `scriptPath`.", UNREADABLE_ASK].join("\n"),
    );
    // Where nobody can answer, each is refused.
    for (const fields of [{ name: "deep-research" }, { resumeFromRunId: "run_1" }]) {
      expect(
        answer(await agentGuard(call(fields), UNATTENDED, where, repo)).permissionDecision,
      ).toBe("deny");
    }
  });

  it("G2: an inline script still wins over a name, as Claude Code runs it", async () => {
    const { repo, where } = world();
    put(join(repo, ".claude", "workflows", "probe.js"), script("probe", HAIKU_LOW));
    expect(
      await agentGuard(
        call({ name: "probe", script: script("probe", OPUS_HIGH) }),
        NO_ENV,
        where,
        repo,
      ),
    ).toEqual({});
  });

  it("G2: a nested literal `workflow('x')` is resolved and judged, one level deep", async () => {
    const { repo, where } = world();
    put(join(repo, ".claude", "workflows", "child.js"), script("child", HAIKU_LOW));
    const top = script("top", OPUS_HIGH, 'const out = await workflow("child", { n: 1 });');
    const result = answer(await agentGuard(call({ script: top }), NO_ENV, where, repo));
    expect(result.permissionDecision).toBe("deny");
    expect(result.permissionDecisionReason).toStartWith(
      'In the workflow `child`, the launch "cheap": ',
    );
    // `{ scriptPath: '…' }` too, relative to the cwd.
    put(join(repo, "flows", "c.js"), script("c", OPUS_MAX));
    const byPath = script("top", "await workflow({ scriptPath: 'flows/c.js' });");
    const asked = answer(await agentGuard(call({ script: byPath }), NO_ENV, where, repo));
    expect(asked.permissionDecision).toBe("ask");
    expect(asked.permissionDecisionReason).toStartWith(
      `In the workflow \`${join(repo, "flows", "c.js")}\`, the launch "deep": `,
    );
    // A nested name with no file asks, like a run by that name.
    const builtIn = script("top", "await workflow('deep-research');");
    expect(
      answer(await agentGuard(call({ script: builtIn }), NO_ENV, where, repo)).permissionDecision,
    ).toBe("ask");
  });

  it("G2: a nested computed name, `workflow` handed around, or a second level: refused whole", async () => {
    const { repo, where } = world();
    const refused = async (top: string) =>
      answer(await agentGuard(call({ script: top }), NO_ENV, where, repo));
    expect(await refused(script("top", "const name = args.n;", "await workflow(name);"))).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: [
        "This Workflow's `workflow(…)` call at line 3 names its workflow at run time.",
        'Write it as `workflow("<name>")` or `workflow({ scriptPath: "<path>" })`, with a string literal, so the guard can read what it runs.',
      ].join("\n"),
    });
    expect((await refused(script("top", "await workflow('a' + args.n);"))).permissionDecision).toBe(
      "deny",
    );
    expect(
      (await refused(script("top", "await workflow({ scriptPath: args.p });"))).permissionDecision,
    ).toBe("deny");
    expect(await refused(script("top", "const run = workflow;", "await run('x');"))).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: [
        "This Workflow uses `workflow` without calling it at once (line 2): a variable holds it, it is optional-called (`workflow?.(…)`), or it is passed as a value.",
        "A launch made through a variable runs inside the tool and never reaches a hook, so the guard cannot read the model and effort it will run on.",
        'Write every nested workflow as a direct `workflow("<name>")` call.',
      ].join("\n"),
    });
    put(
      join(repo, ".claude", "workflows", "child.js"),
      script("child", "await workflow('grand');"),
    );
    expect(await refused(script("top", "await workflow('child');"))).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "The workflow `child` this one runs nests a workflow of its own (line 2): Claude Code runs workflows one level deep, and the guard reads no deeper.",
    });
  });

  it('G2: a literal followed by an operator is not the value: `effort: "high" && "max"`', async () => {
    const { repo, where } = world();
    const top = script(
      "top",
      'await agent("look", { label: "deep", model: "opus", effort: "high" && "max" });',
    );
    expect(
      answer(await agentGuard(call({ script: top }), NO_ENV, where, repo)).permissionDecision,
    ).toBe("deny");
    // A comment after the literal is no operator.
    const fine = script(
      "top",
      'await agent("look", { label: "check", model: "opus" /* the tier */, effort: "high" });',
    );
    expect(await agentGuard(call({ script: fine }), NO_ENV, where, repo)).toEqual({});
  });

  it("G2: a run with three premium launches is recorded three times, once each", async () => {
    const { repo, where } = world();
    put(
      join(repo, ".claude", "workflows", "probe.js"),
      script(
        "probe",
        'await agent("Opus reason: security - a", { label: "a", model: "opus", effort: "xhigh", agentType: "cc-smart-dev-kit:senior-engineer" });',
        'await agent("b", { label: "b", model: "opus", effort: "high" });',
        'await agent("c", { label: "cheap", model: "haiku", effort: "medium" });',
        // The nested workflow's launch is the third premium one.
        'await workflow("child");',
      ),
    );
    put(join(repo, ".claude", "workflows", "child.js"), script("child", OPUS_HIGH));
    expect(await agentGuard(call({ name: "probe" }), NO_ENV, where, repo)).toEqual({});
    // PreToolUse again, then PostToolUse: nothing new.
    await agentGuard(call({ name: "probe" }), NO_ENV, where, repo);
    await agentGuard(call({ name: "probe" }, "PostToolUse"), NO_ENV, where, repo);
    expect(
      records(where).map((one) => [
        one.launchIndex,
        one.reason,
        one.effort,
        one.word,
        one.toolUseId,
      ]),
    ).toEqual([
      [0, "opus:xhigh:security", "xhigh", "security", "toolu_wf"],
      [1, "opus:high", "high", null, "toolu_wf"],
      [3, "opus:high", "high", null, "toolu_wf"],
    ]);
  });

  it("G2: an asked named run records its launches once it ran", async () => {
    const { repo, where } = world();
    put(join(repo, ".claude", "workflows", "probe.js"), script("probe", OPUS_MAX, OPUS_HIGH));
    expect(
      answer(await agentGuard(call({ name: "probe" }), NO_ENV, where, repo)).permissionDecision,
    ).toBe("ask");
    expect(records(where)).toEqual([]);
    await agentGuard(call({ name: "probe" }, "PostToolUse"), NO_ENV, where, repo);
    await agentGuard(call({ name: "probe" }, "PostToolUse"), NO_ENV, where, repo);
    expect(records(where).map((one) => [one.launchIndex, one.effort])).toEqual([
      [0, "max"],
      [1, "high"],
    ]);
  });

  it("G2: an Agent launch's line carries its effort and word as fields", async () => {
    const { repo, where } = world();
    await agentGuard(
      {
        ...agentCall({
          effort: "xhigh",
          model: "opus",
          prompt: "Opus reason: security - check it",
          subagent_type: "cc-smart-dev-kit:senior-engineer",
        }),
        session_id: "s",
        tool_use_id: "toolu_a",
      },
      NO_ENV,
      where,
      repo,
    );
    const line = JSON.parse(readFileSync(agentLaunchesFile(where.stateDir), "utf8").trim());
    expect([line.reason, line.effort, line.word, line.launchIndex]).toEqual([
      "opus:xhigh:security",
      "xhigh",
      "security",
      0,
    ]);
  });

  it("G2: guardFacts judges a named run the same way", () => {
    const { repo, where } = world();
    put(join(repo, ".claude", "workflows", "probe.js"), script("probe", OPUS_HIGH));
    expect(
      guardFacts(
        { ...call({ name: "probe" }), cwd: repo },
        { env: NO_ENV, nowMs: 0, paths: where },
      ),
    ).toEqual({ decision: "allow", launches: 1, tool: "Workflow" });
    expect(
      guardFacts(
        { ...call({ name: "deep-research" }), cwd: repo },
        { env: NO_ENV, nowMs: 0, paths: where },
      ),
    ).toEqual({ decision: "ask", launches: 0, tool: "Workflow", why: "unreadable" });
  });
});

describe("D50: UI/UX work runs only on opus or fable, at high or above", () => {
  /** A launch that declares UI/UX work in its reason line, as the plugin's instructions say. */
  const UI = "Build the settings page: layout, components, styling.\nOpus reason: ui - the page";

  it("a declared UI launch on sonnet is denied, with the rule in words", () => {
    const result = verdict({ effort: "high", model: "sonnet", prompt: UI });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain(
      "This launch declares UI/UX work (`Opus reason: ui - the page`)",
    );
    expect(result.reason).toContain(
      "Use `opus` or `fable` at `high`, `xhigh` or `max` for UI/UX work (D50).",
    );
  });

  it("a declared UI launch on haiku or an affordable slot is denied too", () => {
    expect(verdict({ effort: "high", model: "haiku", prompt: UI }).decision).toBe("deny");
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    expect(verdict({ effort: "max", model: "sonnet", prompt: UI }, on).decision).toBe("deny");
    expect(
      verdict({ effort: "max", model: "cc-smart-dev-kit-worker", prompt: UI }, on).decision,
    ).toBe("deny");
    expect(verdict({ effort: "max", model: "omniroute:glm-5.3-flash", prompt: UI }).decision).toBe(
      "deny",
    );
  });

  it("a declared UI launch on opus at high is allowed; at medium it is denied", () => {
    const allowed = verdict({ effort: "high", model: "opus", prompt: UI });
    expect(allowed.decision).toBe("allow");
    expect(allowed.why).toBe("opus:high:ui");
    expect(verdict({ effort: "xhigh", model: "opus", prompt: UI }).decision).toBe("allow");
    const medium = verdict({ effort: "medium", model: "opus", prompt: UI });
    expect(medium.decision).toBe("deny");
    expect(medium.reason).toContain(
      "Use `opus` or `fable` at `high`, `xhigh` or `max` for UI/UX work (D50).",
    );
  });

  it("a declared UI launch on the fable tier at high passes the UI rule: the Fable ask stands", () => {
    const readOnly = verdict({
      effort: "high",
      model: "fable",
      prompt: "Measure the page.\nFable reason: ui-design - the layout judgment",
      subagent_type: "Plan",
    });
    // D50 allows fable at high; every Fable launch still asks the person (the rule kept).
    expect(readOnly.decision).toBe("ask");
    const low = verdict({
      effort: "medium",
      model: "fable",
      prompt: "Measure the page.\nFable reason: ui-design - the layout judgment",
      subagent_type: "Plan",
    });
    expect(low.decision).toBe("deny");
    expect(low.reason).toContain("for UI/UX work (D50)");
  });

  it("checking is not design: a ui-verifier launch on sonnet is allowed", () => {
    // The verifier collects measured facts and screenshots; no declaration, so no UI rule.
    expect(
      verdict({
        effort: "high",
        model: "sonnet",
        prompt: "Check the settings page at 375x812 and dark mode; facts only.",
        subagent_type: "cc-smart-dev-kit:ui-verifier",
      }).decision,
    ).toBe("allow");
    // And a prompt that merely talks about UI work is never sniffed for keywords.
    expect(
      verdict({ effort: "high", model: "sonnet", prompt: "Build the UI page, layout and all." })
        .decision,
    ).toBe("allow");
  });

  it("a declared UI launch after Claude Code's effort override is judged on what runs", () => {
    const on: GuardContext = { ...CTX, config: configWithModelSlot(), gatewayOn: true };
    // The opus launch names high; CLAUDE_CODE_EFFORT_LEVEL puts every subagent at medium.
    const result = verdict({ effort: "high", model: "opus", prompt: UI }, on, {
      CLAUDE_CODE_EFFORT_LEVEL: "medium",
    });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("for UI/UX work (D50)");
  });
});
