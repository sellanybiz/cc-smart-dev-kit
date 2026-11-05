/**
 * The `agent-guard` hook: PreToolUse on the Agent tool (and the older name `Task`), and on the
 * `Workflow` tool, whose script's `agent(...)` launches are read and judged (`WorkflowLaunch`).
 *
 * **Machine-wide.** It runs with or without `.claude/cc-smart-dev-kit.json` (like `update-check`), and
 * its answer never depends on the project's file: it judges the model and effort the launch runs
 * on. A project that runs its own Agent guard lists `"agent-guard"` in `ownHooks` and this one
 * stays silent there. It is wired with `--missing=ask`: a guard fails closed.
 *
 * **Why.** An Agent call with no `model` runs on whatever model the session has; an Opus or
 * Fable launch spends the person's own plan usage; a subagent at `low` does work nobody chose
 * to cheapen. (An affordable gateway slot used to be held to `max`; the owner dropped that on
 * 2026-10-26: Claude picks the effort by the task on every tier, and a person who wants a backend
 * at one level pins it in the router, `effortPinForBackend`.)
 *
 * **Effort** (the owner's decisions D5 and D13). A subagent never runs at `low`, whatever the
 * model: the guard refuses a launch whose `effort` is not `medium`, `high`, `xhigh` or `max`.
 * That list lives once, in `ALLOWED_EFFORTS`, and the guard, its messages and the tests all
 * read it. `medium` is for searches and reads, `high` for building and reviews, `xhigh` for
 * the hardest judgment, and `max` on `haiku` or `sonnet` when the task wants it, with no
 * restriction and whatever model answers them (the owner, 2026-10-25 and 2026-10-26: the
 * session-start note, `tier-view.ts`, tells Claude what answers each tier). On top of it, an
 * `opus`-tier launch asks the person at `OPUS_ASK_EFFORT` (`max`).
 *
 * **The launch policy** — that list, the model resolution below and the Fable reason words —
 * has its one home in `src/models/launch-policy.ts`; this file is the hook around it.
 *
 * **The `opus` tier** (the owner's decision D11, 2026-10-17): any launch on it — a review or
 * not, any agent type, any purpose — runs with no question at every allowed level below `max`,
 * and asks the person at `max`. No reason line is needed; an `Opus reason: <word>` line, when a
 * prompt carries one, only names the purpose in the record.
 *
 * **UI/UX work** (the owner's decision D50, 2026-10-22): design judgment, layout, components,
 * pages and styling run only on the tiers and at the efforts `UI_POLICY` names — `opus` or
 * `fable`, at `high` or above, never an affordable model. A launch declares it with
 * `Opus reason: ui` (or `Fable reason: ui-design`); one that declares it on another tier or
 * below `high` is denied, before every rule below would allow it. A prompt is never sniffed for
 * keywords: the declaration is the contract. Checking is not design: `ui-verifier` may run on
 * `sonnet`, and the design verdict is made on `opus` or `fable`.
 *
 * | The model behind the launch | The verdict |
 * |---|---|
 * | an affordable slot key / a `<backend>:<model>` target / `haiku` or `sonnet` (or their ids) while the gateway is on and the family's slot chain starts with a backend | allow, at any allowed effort (the effort rule above still holds) |
 * | any other name (`best`, `opusplan`, `default`, `inherit`, a name no rule knows) | the `opus` tier below (the strictest reading): only what the guard can read as Sonnet, Haiku or a backend target is judged as one |
 * | Claude Sonnet or Haiku (the gateway off, the family's slot off, or its chain starting with a `claude-…` model) | allow (the effort rule above still holds) |
 * | the `opus` tier | read as the Opus family (the `opus` name, a Claude Opus id, the opus slot, an id the person's own override names for it): effort `medium`, `high` or `xhigh`: allow, for any agent and any purpose; effort `max`: **ask** (the person approves each one, and sees the model and the effort); a fork names no effort: it runs at the session's own, which the person chose, so it is allowed. A reading with no family (a name no rule knows, an id the guard cannot read): **ask** at any effort — it may stand for a higher tier |
 * | the `fable` tier | a read-only agent type (`READ_ONLY_AGENTS`, by its whole name: Claude Code's `Plan` and `Explore`, the kit's own under its plugin prefix) with a prompt line `Fable reason: <one of FABLE_REASONS> - <why>`, and a person to answer: **ask** (the word `build` is not one of them: a read-only agent never builds); an agent that can change files (any other type, a fork included) with `Fable reason: build - <why>`: **ask** (the person asked for it); no line, a builder without the word `build`, or a session nobody watches (`claude -p`): deny |
 * | no readable `model` / `effort` in the call or agent definition | deny (the call's, else the agent definition's choice must be readable) — except a `fork`, which always inherits both, and a launch whose model or effort one of Claude Code's overrides sets (below) |
 * | a launch that declares UI/UX work (`Opus reason: ui`, `Fable reason: ui-design`) | allow only on the `opus` or `fable` tier at `high`, `xhigh` or `max` (`UI_POLICY`, D50); anything else — Sonnet, Haiku, an affordable slot, or a tier below `high` — is denied with the rule in words |
 * | a session nobody watches (`claude -p`) | every premium launch that would ask is denied (there is nobody to approve it): the `opus` tier at `max` says to run it at `medium`, `high` or `xhigh`, or in an interactive session; a reading with no family says to name `opus`; the Opus family below `max` stays allowed |
 *
 * A reason word is read with the punctuation around it dropped: `Fable reason: plan.` names
 * `plan`.
 *
 * **What really runs.** Every rule above judges the model and effort the launch REALLY runs
 * on, after Claude Code's own overrides (`effectiveLaunch`, in the launch policy, read from the
 * hook's own environment, which a settings file's `env` reaches too):
 * `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (its `CLAUDE_CODE_SUBAGENT_MODEL`, else the session's own
 * model) > `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` (a Workflow agent only) > the call's `model`;
 * `CLAUDE_CODE_EFFORT_LEVEL` > the call's `effort`. Under FORCE or `CLAUDE_CODE_EFFORT_LEVEL`
 * Claude Code removes `model` or `effort` from the Agent tool, so a call that names neither is
 * judged on what the variable sets, never refused for it. An ask or a denial names the override.
 * A level `CLAUDE_CODE_EFFORT_LEVEL` names that no subagent may run at (`low`, a level no rule
 * knows) is refused: only the person can change the variable, and the message says where. `auto`
 * is the person's own choice, like a
 * fork's effort (`EFFORT_AUTO`): never refused for itself, never asked on the `opus` tier (no
 * model's default is `max`). A fork keeps its own rule.
 *
 * **Tiers, not vendors** (the owner, 2026-10-16). `opus` and `fable` mean the TIER: whatever
 * model answers behind them — Claude, a backend through an override or the family's slot, a
 * name no rule knows — the tier's gates hold (Fable's reason line, `max` asking on the `opus`
 * tier, `-p` refusing). The guard's messages
 * name both: `` `opus` (answered by openai:gpt-…) ``. So a launch is judged by `LaunchModel.tier`
 * and it is decided first; Sonnet, Haiku and the affordable slots keep being allowed freely, at
 * any allowed effort.
 *
 * **Which model, exactly.** The call's `model` is a name (`haiku|sonnet|opus|fable` — the
 * only four Claude Code's Agent tool accepts, proved live from its own schema; a full id, a
 * slot key and `<backend>:<model>` are read too, for a Workflow script or a future build).
 * It is resolved the way Claude Code and the router resolve it (`resolveLaunchModel`):
 *   1. `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` (all four exist in Claude Code 2.1.301, fable
 *      included), when the person set one, replaces the family's model;
 *   2. with the gateway on (`ANTHROPIC_BASE_URL` in Claude Code's settings), the router sends a
 *      Claude model to its FAMILY's slot (`FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus
 *      → opus, fable → fable) while that slot has a chain, and the chain's first target answers
 *      (`gateway.json`, read through the gateway's own `loadConfigFile`). A slot with no chain
 *      is off: the Claude model itself answers, on the person's own login.
 * So `sonnet` is an affordable slot exactly when the gateway is on and the worker's chain
 * starts with a `<backend>:<model>`; a chain that starts with a `claude-…` model is Claude.
 * **A name never runs below the tier of what answers it:** when the override or the slot
 * answers a family name with a model the guard reads as a stricter premium family (`sonnet`
 * whose `ANTHROPIC_DEFAULT_SONNET_MODEL` is a Claude Opus id, or whose worker chain starts with
 * one), the launch is that family and its tier — it spends that tier's usage. A model the guard
 * cannot read as a family leaves the name's own tier (`asNamed`). A
 * `fork` runs on the session's model and effort — Claude Code ignores a `model` it is given —
 * so it is judged on the session's own: the last Claude model in the hook input's
 * `transcript_path` (`lastClaudeModel`), else `ANTHROPIC_MODEL`; unknowable → the `opus` tier.
 *
 * **Every Workflow run** (G2). A Workflow call's launches run inside the tool and fire no hook of
 * their own, so the guard reads the script the call runs, however the call names it — an
 * inline `script`, a `scriptPath`, a saved workflow's `name`, a plugin's `<plugin>:<name>`
 * (`agent-guard-workflows.ts` finds the file the way Claude Code does) — and every workflow
 * that script nests with a literal `workflow("<name>")` or `workflow({ scriptPath: "…" })`, one
 * level deep (`judgeWorkflowCall`). A run whose script the guard cannot read — a built-in
 * workflow, a missing file, two files that claim one name, a `resumeFromRunId` — asks the
 * person, and is denied in `claude -p`, saying why. A nested workflow named at run time, or a
 * script that nests deeper, refuses the whole call.
 *
 * Every premium launch is recorded (`agent-launches.ts`) once it is known to run, with its
 * effort and its reason word as their own fields, and with why it ran as one string for older
 * readers: the `opus` tier as `opus:<effort>`, with the prompt's reason word after it when there
 * is one (`opus:xhigh`, `opus:max:security`; a fork `opus:session-effort`), and the `fable` tier
 * by its word. `cc-smart-dev-kit usage` counts them by effort and by word. An allowed launch is
 * recorded on PreToolUse, an asked one on PostToolUse — the call ran, so the person said yes
 * (`RAN_EVENT`); a launch the person refuses is never recorded. A Workflow's launches share one
 * `tool_use_id`, so each is recorded under its own index, once. Anything the guard cannot work
 * out lets the call through, except a Workflow whose launches it cannot read
 * (`workflowRefusal`, `judgeWorkflowCall`).
 */

import { PLUGIN } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import {
  type GatewayConfig,
  loadConfigFile,
  plainClaudeView,
  profileView,
} from "../gateway/config";
import { urlMeaning } from "../gateway/project-state";
import { baseUrlPointsAtGateway, routerBaseUrl } from "../gateway/settings";
import { type AgentDefinition, agentDefinition } from "../models/agent-definition";
import {
  ALLOWED_EFFORTS,
  EFFORT_AUTO,
  EFFORT_LEVEL_ENV,
  type EffectiveLaunch,
  effectiveLaunch,
  effortAllowed,
  FABLE_BUILD_REASON,
  FABLE_REASONS,
  type GatewayFacts,
  type LaunchModel,
  OPUS_ASK_EFFORT,
  OPUS_FREE_EFFORTS,
  resolveLaunchModel,
  SUBAGENT_MODEL_ENV,
  SUBAGENT_MODEL_FORCE_ENV,
  UI_REASON_WORDS,
  uiEffortAllowed,
  uiRuleText,
  uiTierAllowed,
  WORKFLOW_SUBAGENT_MODEL_ENV,
} from "../models/launch-policy";
import { locateCheckout } from "../project/resolve";
import { scriptAtPath, scriptByName, type WorkflowPlace } from "./agent-guard-workflows";
import {
  type AgentLaunch,
  agentLaunchesFile,
  appendAgentLaunches,
  reasonParts,
  SESSION_EFFORT,
} from "./agent-launches";
import { isAttended } from "./attended";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { Env, HookEnvContext } from "./run";
import { lastClaudeModel } from "./transcript";
import {
  type AgentCallRead,
  type ParsedScript,
  parseScript,
  type ScriptFunction,
} from "./workflow-script";

/** The tools this guard reads: the Agent tool, the older name, and Workflow. */
export const AGENT_TOOLS = ["Agent", "Task"] as const;
export const WORKFLOW_TOOLS = ["Workflow"] as const;

/**
 * The `tool` of a launch the Bash judge reads from a `claude -p` command (`bash-judge.ts`): a
 * whole session in print mode, which no agent definition stands behind.
 */
export const PRINT_RUN = "claude -p";

/** The subagent type a fork uses: it runs on the session's model and effort. */
export const FORK = "fork";

/** The words a builder may name: the one word that means the person asked for it. */
const BUILDER_WORDS = [FABLE_BUILD_REASON] as const;

/**
 * The subagent types that count as read-only on Fable: they read and report, never build, so
 * any word of `FABLE_REASONS` is enough. Every other type — a fork included — can change
 * files and needs the one word `build` (`FABLE_BUILD_REASON`). Each is matched by its whole
 * name: Claude Code's own built-ins bare, the kit's agents under this plugin's prefix. Another
 * plugin's or a project's agent of the same short name (`researcher`) is not read-only.
 */
export const READ_ONLY_AGENTS = [
  "Plan",
  "Explore",
  `${PLUGIN}:auditor`,
  `${PLUGIN}:edge-case-hunter`,
  `${PLUGIN}:researcher`,
] as const;

/** The environment variable a person may extend that list with (comma-separated). */
export const READ_ONLY_AGENTS_ENV = "CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS";

/** One part of a subagent type as a list compares it: lower case, `-`/`_`/space as one `-`. */
function keyPart(part: string): string {
  return part
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

/** A subagent type as the person's list compares it: the name after any `plugin:`. */
export function agentKey(type: string): string {
  return keyPart(type.includes(":") ? (type.split(":").pop() ?? type) : type);
}

/**
 * True when a type is read-only: on the kit's list (or the context's) by its whole name, as
 * written, or on the person's own list (`READ_ONLY_AGENTS_ENV`) by the name after any
 * `plugin:`, as the person writes it. A bare name on the kit's list (`Plan`, `Explore`) is
 * Claude Code's built-in only while no managed, project or user file claims that name (such a
 * file overrides the built-in, per the sub-agents docs): the definition must say `builtIn`. A
 * context with no lookup at all (a pure caller) knows no local file.
 */
function readOnlyType(type: string, ctx: GuardContext, env: Env): boolean {
  if ((ctx.readOnlyAgents ?? READ_ONLY_AGENTS).includes(type)) {
    if (type.includes(":") || ctx.definition === undefined) return true;
    return ctx.definition(type)?.builtIn === true;
  }
  if (ctx.readOnlyAgents !== undefined) return false;
  const listed = (env[READ_ONLY_AGENTS_ENV] ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");
  return new Set(listed.map(agentKey)).has(agentKey(type));
}

/** The `model` (or one of its aliases) behind a launch, as Claude Code will send it. */
export interface Launch {
  effort: null | string;
  /** True for `subagent_type: "fork"`: it runs on the session's model and effort. */
  fork: boolean;
  /** The model as the call names it; null when it names none. */
  model: null | string;
  prompt: string;
  subagentType: null | string;
  /** What launches it: `Agent`, `Task`, `Workflow`, or `PRINT_RUN` for a `claude -p` run. */
  tool: string;
}

/** The launch an Agent (or Task) call describes; null when the tool is another one. */
export function readLaunch(input: HookInput): Launch | null {
  const tool = stringField(input.tool_name);
  if (tool === null || !(AGENT_TOOLS as readonly string[]).includes(tool)) return null;
  const fields = toolInput(input);
  const subagentType = stringField(fields.subagent_type);
  return {
    effort: stringField(fields.effort),
    fork: subagentType?.toLowerCase() === FORK,
    model: stringField(fields.model),
    prompt: typeof fields.prompt === "string" ? fields.prompt : "",
    subagentType,
    tool,
  };
}

/** What the guard reads from this machine; a test passes its own. */
export interface GuardContext extends GatewayFacts {
  /** Definition lookup injected from the hook's paths; pure callers can pass their own. */
  definition?: (name: null | string) => AgentDefinition | null;
  /** The session's own model, for a fork; null when it cannot be read. */
  sessionModel: null | string;
  /** The subagent types a Fable launch may use; the plugin's list by default. */
  readOnlyAgents?: readonly string[];
}

/**
 * One `agent(...)` call of a Workflow script, as much of it as its text shows. A workflow
 * runs its agents **inside itself**: live on 2.1.301 the `Workflow` tool call fires
 * PreToolUse (tool_name `Workflow`; its input holds the `script`, or only a `name` or a
 * `scriptPath`, 2.1.306) and the launches inside the script fire **nothing** — no `Agent` call
 * passes the hooks. So the guard reads the script (`readWorkflowScript`; found by
 * `judgeWorkflowCall` when the input holds none) and judges each launch it can see.
 *
 * The script is parsed the way Claude Code runs it (`workflow-script.ts`, with acorn). What the
 * guard cannot see is refused, never guessed:
 *   - a script that does not parse refuses the whole Workflow (`workflowRefusal`), naming the
 *     parser's message and line;
 *   - a value held in a variable (`model: chosen`), a prompt built at run time, a literal an
 *     operator changes (`effort: "high" && "max"`, `"a" + b`), and a backtick literal that
 *     builds its text (`` `${…}` ``) leave that launch's verdict short
 *     of a reason line, so a Fable launch is denied and a launch whose `model` cannot be read
 *     is denied outright (an `opus`-tier launch needs no reason line, so its prompt does not
 *     matter);
 *   - options that are not one plain object literal (`AgentCallRead.plain`: a getter, a method, a
 *     shorthand key, `__proto__`, a ternary or a second object) can set `model`, `effort` or
 *     `agentType` where the guard never sees them, so none of the three is read: the launch is
 *     denied before any agent definition is read, unless Claude Code's own overrides name both
 *     its model and its effort;
 *   - options built at run time (a `...spread`, a computed `[…]` key) and a launch made
 *     through a **variable** (`const run = agent; run(…)`, `agent?.(…)`, `agent` passed
 *     around) hide every rule from the guard, so the whole Workflow is denied with the reason
 *     (`workflowRefusal`).
 *
 * A launch written as a direct `agent(…)` call is read and judged wherever it is — inside a
 * helper function defined in the script too, and inside a template literal's `${…}`. A name
 * that is not a use of the function (a property `x.agent`, a key `{ agent: … }`) is not one.
 */
export interface WorkflowLaunch {
  /** `agentType` of the call's options; null when the call names none or not as a literal. */
  agentType: null | string;
  effort: null | string;
  model: null | string;
  /** A policy key exists but is not a string literal; never replace it with frontmatter. */
  unreadable?: string;
  /**
   * True when the options are not one plain object literal (`AgentCallRead.plain`): `model`,
   * `effort` and `agentType` are then null, since the run can take each from what the guard
   * cannot see.
   */
  optionsNotPlain?: true;
  /** The prompt, when the first argument is a string literal; null otherwise. */
  prompt: null | string;
  /** How the message names this launch: its `label`, else the first words of its prompt. */
  where: string;
}

/** Thrown when a script that does not parse is read anyway; `workflowRefusal` says it first. */
class UnreadableScript extends Error {}

/**
 * What the parser found in a script (`parseScript`). A script that does not parse throws:
 * `workflowRefusal` refuses such a script before anything reads it, so a throw here is a guard's
 * crash, which asks (`guardCrash`) — never an allow.
 */
function parsedScript(script: string): ParsedScript {
  const read = parseScript(script);
  if (!read.ok) throw new UnreadableScript(read.why);
  return read;
}

/** Said when the parser cannot read a script: its message, and where. */
function unreadableScript(line: null | number, why: string): string {
  const where = line === null ? "" : ` at line ${line}`;
  return [
    `This Workflow's script cannot be read${where}: ${why}.`,
    "The guard parses the script the way Claude Code runs it (the body of an async function), and a script it cannot parse could hide a launch.",
    "Fix the script so it runs as JavaScript.",
  ].join("\n");
}

/** Why a function handed around hides what it runs. */
const THROUGH_A_VARIABLE =
  "A launch made through a variable runs inside the tool and never reaches a hook, so the guard cannot read the model and effort it will run on.";

/** Said when the script hands `agent` or `workflow` around: nothing it runs can be read. */
const HANDED_AROUND: Record<ScriptFunction, string> = {
  agent: [
    THROUGH_A_VARIABLE,
    'Write every launch as a direct `agent("<prompt>", { model: "…", effort: "…" })` call.',
  ].join("\n"),
  workflow: [
    THROUGH_A_VARIABLE,
    'Write every nested workflow as a direct `workflow("<name>")` call.',
  ].join("\n"),
};

/** Said after a route around the names: what a script may not use (`ScriptRoute`). */
const ROUTES_REFUSED =
  'Write every launch as a direct `agent("<prompt>", { model: "…", effort: "…" })` call, and leave out `eval`, `Function`, `arguments`, `globalThis`, `global`, `self`, a `this` outside a non-arrow function (an arrow uses the script\'s own `this`), `import(…)` and `.constructor`.';

/** Said when a call's options are not what they seem: what the guard read can differ. */
const OPTIONS_BUILT_AT_RUNTIME = [
  "Its options are not what they seem: a `...spread`, a computed `[…]` key, or the same option written twice (the last one wins at run time, while the guard reads the first). The model and effort it will really run on cannot be read.",
  "Write `model`, `effort` and `agentType` once each, as string literals in the call's own options object.",
].join("\n");

/**
 * The reason this whole Workflow call is refused, or null when every launch in it can be
 * read. Three things hide the rules from the guard, and a hook must refuse what it cannot see
 * rather than let it run unchecked:
 *   - a script that does not parse (`parseScript`), where a launch could hide;
 *   - a route around the names (`ScriptRoute`): `eval`, `Function`, `arguments`,
 *     `globalThis`, `global`, `self`, a `this` outside a non-arrow function, `import(…)`,
 *     `.constructor`;
 *   - `agent` or `workflow` used without being called at once (`const run = agent; run(…)`,
 *     `agent?.(…)`, either passed around as a value, or a name of the script's own that takes
 *     its place);
 *   - an `agent(…)` call whose options are not what they seem (`AgentCallRead.hidden`).
 * A nested `workflow(…)` call whose workflow is named at run time is refused by
 * `nestedWorkflows`.
 */
export function workflowRefusal(script: string): null | string {
  const read = parseScript(script);
  if (!read.ok) return unreadableScript(read.line, read.why);
  const [route] = read.routes;
  if (route !== undefined) {
    return [
      `This Workflow uses ${route.what} (line ${route.line}): that can reach \`agent\` under another name, or build code at run time, so it could launch an agent the guard never sees.`,
      ROUTES_REFUSED,
    ].join("\n");
  }
  for (const name of ["agent", "workflow"] as const) {
    const handed = read.handed.find((use) => use.name === name);
    if (handed === undefined) continue;
    return [
      `This Workflow uses \`${name}\` without calling it at once (line ${handed.line}): a variable holds it, it is optional-called (\`${name}?.(…)\`), or it is passed as a value.`,
      HANDED_AROUND[name],
    ].join("\n");
  }
  const hidden = read.agents.find((call) => call.hidden);
  if (hidden === undefined) return null;
  return [
    `This Workflow's \`agent(…)\` call at line ${hidden.line} cannot be read.`,
    OPTIONS_BUILT_AT_RUNTIME,
  ].join("\n");
}

/** A nested `workflow(…)` call of a script: the workflow it names, and its line. */
type NestedCall = { line: number } & ({ name: string } | { scriptPath: string });

/**
 * Every nested `workflow(…)` call of a script, in order — the two shapes Claude Code accepts,
 * `workflow("<name>")` and `workflow({ scriptPath: "<path>" })`, each with a string literal — or
 * why the whole call is refused: a call whose workflow is named at run time
 * (`workflow(name)`, `workflow("a" + b)`) runs a script the guard cannot know.
 */
export function nestedWorkflows(script: string): { calls: NestedCall[] } | { refusal: string } {
  const read = parseScript(script);
  if (!read.ok) return { refusal: unreadableScript(read.line, read.why) };
  const calls: NestedCall[] = [];
  for (const { line, name, scriptPath } of read.workflows) {
    if (name !== null) calls.push({ line, name });
    else if (scriptPath !== null) calls.push({ line, scriptPath });
    else {
      return {
        refusal: [
          `This Workflow's \`workflow(…)\` call at line ${line} names its workflow at run time.`,
          'Write it as `workflow("<name>")` or `workflow({ scriptPath: "<path>" })`, with a string literal, so the guard can read what it runs.',
        ].join("\n"),
      };
    }
  }
  return { calls };
}

/** The options a launch's policy reads: a call's `model`, `effort` and `agentType`. */
const POLICY_KEYS = ["model", "effort", "agentType"] as const;

/**
 * One `agent(…)` call as a launch. Nothing is evaluated: only fixed strings are read. Only a key
 * of the call's own options object counts — never the same words in the prompt or in a nested
 * object (`schema: { effort: … }`), which would let them stand in for the real option.
 */
function launchOf(call: AgentCallRead): WorkflowLaunch {
  const { keys, plain, prompt } = call;
  const unreadable = POLICY_KEYS.find((key) => keys.has(key) && keys.get(key) === null);
  // Options that are not one plain object can hand the run any policy key: none is read.
  const policy = (key: (typeof POLICY_KEYS)[number]) => (plain ? (keys.get(key) ?? null) : null);
  return {
    ...(unreadable === undefined ? {} : { unreadable }),
    ...(plain ? {} : { optionsNotPlain: true as const }),
    agentType: policy("agentType"),
    effort: policy("effort"),
    model: policy("model"),
    prompt,
    where: keys.get("label") ?? prompt?.split("\n")[0]?.slice(0, 60) ?? "(unreadable)",
  };
}

/**
 * Every `agent(...)` call of a Workflow script, in order (`parseScript`): the word inside a
 * prompt, a string or a comment is not a call. A script that does not parse throws;
 * `workflowRefusal` refuses it first, in every hook path.
 */
export function readWorkflowScript(script: string): WorkflowLaunch[] {
  return parsedScript(script).agents.map(launchOf);
}

/** A Workflow script's launch as an Agent call's launch, for the same rules. */
function asLaunch(one: WorkflowLaunch): Launch {
  return {
    effort: one.effort,
    fork: false,
    model: one.model,
    prompt: one.prompt ?? "",
    subagentType: one.agentType,
    tool: "Workflow",
  };
}

/** One launch of a Workflow script, judged. */
export interface WorkflowResult {
  /** How the messages name the script it is in: null for the call's own inline script. */
  from: null | string;
  launch: WorkflowLaunch;
  verdict: Verdict;
}

/** Said when a Workflow launch's `model` or `effort` cannot be read from its options or its definition. */
function noWorkflowField(field: "effort" | "model"): string {
  return [
    `This Workflow launch names no \`${field}\` the guard can read, in its options or its agent definition.`,
    `A value held in a variable, or options that are not one plain object literal (a getter, a method, a shorthand key, \`__proto__\`, a ternary, a second object), can set the run's \`${field}\` where a hook never sees it, so no agent definition stands in for it then.`,
    'Write `model` and `effort` as string literals in one plain options object: `agent("<prompt>", { model: "…", effort: "…" })`.',
  ].join("\n");
}

const NO_WORKFLOW_MODEL = noWorkflowField("model");
const NO_WORKFLOW_EFFORT = noWorkflowField("effort");

/** Said in a Workflow launch's reason when its prompt is not a literal the guard can read. */
const PROMPT_UNREADABLE =
  "The launch's prompt is built at run time, so the guard cannot read a `Fable reason:` line in it.";

/**
 * Judges every launch of a Workflow script, in order. `from` names the script in the messages
 * (`judgeWorkflowCall`); null for a call's own inline script.
 */
export function judgeWorkflow(
  script: string,
  ctx: GuardContext,
  env: Env,
  from: null | string = null,
): WorkflowResult[] {
  return readWorkflowScript(script).map((launch) => {
    // What runs with no definition read: the denials below come before any lookup.
    const bare = () =>
      effectiveLaunch(
        { model: null, effort: null, fork: false, workflow: true },
        env,
        ctx.sessionModel,
      );
    if (launch.optionsNotPlain === true) {
      // Only an override of Claude Code's own can name the model or the effort such a launch
      // runs on: its options can set either where the guard never sees it.
      const ran = bare();
      const missing =
        ran.modelFrom === "call"
          ? NO_WORKFLOW_MODEL
          : ran.effort === null
            ? NO_WORKFLOW_EFFORT
            : null;
      if (missing !== null) return { from, launch, verdict: { ...deny(null, missing), ran } };
    }
    if (launch.unreadable !== undefined) {
      return {
        from,
        launch,
        verdict: {
          ...deny(
            null,
            `This Workflow launch's \`${launch.unreadable}\` is not a string literal the guard can read. Write policy options as string literals.`,
          ),
          ran: bare(),
        },
      };
    }
    const verdict = judgeLaunch(asLaunch(launch), ctx, env);
    // A model the script builds at run time cannot be read by a hook: refused, never guessed —
    // unless an override names the model it runs on whatever the script says.
    if (launch.model === null && verdict.ran.modelFrom === "call") {
      return {
        from,
        launch,
        verdict: { ...deny(verdict.real, NO_WORKFLOW_MODEL), ran: verdict.ran },
      };
    }
    // An ask that rests on the launch's own prompt — a reason line — cannot stand with a prompt
    // the guard cannot read: there is nothing to approve, so it is refused instead. An ask that
    // rests on the effort (the `opus` tier at `max`) needs no prompt and stays an ask.
    if (launch.prompt === null && (verdict.decision === "deny" || verdict.restsOnPrompt === true)) {
      return {
        from,
        launch,
        verdict: {
          ...verdict,
          decision: "deny" as const,
          reason: `${verdict.reason}\n${PROMPT_UNREADABLE}`,
        },
      };
    }
    return { from, launch, verdict };
  });
}

/** The Workflow answer's words: which workflow and which launch it is about, and the rule. */
export function workflowReason(result: WorkflowResult): string {
  const named =
    result.launch.where === "(unreadable)" ? "one launch" : `the launch "${result.launch.where}"`;
  const workflow = result.from === null ? "this workflow" : `the workflow \`${result.from}\``;
  return `In ${workflow}, ${named}: ${result.verdict.reason}`;
}

/** A script a Workflow call runs: its own, or one its script nests. */
interface RunScript {
  /** How the messages name it: null for the call's own inline script. */
  from: null | string;
  script: string;
}

/** A Workflow call, judged: every launch of every script it runs, and what the guard cannot see. */
export interface WorkflowCall {
  /** Why the whole call is refused — a launch or a nested workflow the guard cannot follow. */
  refusal: null | string;
  /** Every launch of the call's scripts, judged: its own script's first, then each nested one's. */
  results: WorkflowResult[];
  /** Why the guard cannot see what (part of) the call runs; each asks, or is refused in `claude -p`. */
  unreadable: string[];
}

/** Said when a call resumes a run: what runs again comes from a script the guard does not see. */
function resumeUnreadable(runId: string): string {
  return `This Workflow call resumes run \`${runId}\`: the run goes on from a script the guard does not see, and it runs again every launch whose prompt or options changed.`;
}

/** Said when a call names none of the three ways to give a script. */
const NO_SCRIPT = "This Workflow call names no `script`, `name` or `scriptPath`.";

/**
 * The script a Workflow call runs, or why the guard cannot read it. In Claude Code's own order
 * (2.1.306): an inline `script` runs whatever else the call names; else `scriptPath`; else
 * `name`. A `resumeFromRunId` goes on from a run the guard cannot see, whatever it names.
 */
function callScript(fields: Record<string, unknown>, place: WorkflowPlace): ScriptRun {
  const resume = stringField(fields.resumeFromRunId);
  if (resume !== null) return { unreadable: resumeUnreadable(resume) };
  const name = stringField(fields.name);
  const script = stringField(fields.script);
  if (script !== null) return { from: name, script };
  const path = stringField(fields.scriptPath);
  const found =
    path !== null
      ? scriptAtPath(path, place.cwd)
      : name !== null
        ? scriptByName(name, place)
        : null;
  if (found === null) return { unreadable: NO_SCRIPT };
  if ("unreadable" in found) return found;
  return { from: path === null ? name : found.file, script: found.script };
}

/** A script to judge, or why there is none the guard can read. */
type ScriptRun = RunScript | { unreadable: string };

/**
 * Judges a whole Workflow call: the script it runs (`callScript`), and every workflow that
 * script nests with `workflow(…)` — one level, as Claude Code runs them; a nested script that
 * nests again is refused. A launch or a nested call the guard cannot follow refuses the whole
 * call; a script it cannot find is `unreadable`, and asks.
 */
export function judgeWorkflowCall(
  fields: Record<string, unknown>,
  ctx: GuardContext,
  env: Env,
  place: WorkflowPlace,
): WorkflowCall {
  const refused = (refusal: string): WorkflowCall => ({ refusal, results: [], unreadable: [] });
  const top = callScript(fields, place);
  if ("unreadable" in top) return { refusal: null, results: [], unreadable: [top.unreadable] };
  const inTop = (reason: string) =>
    top.from === null ? reason : `In the workflow \`${top.from}\`: ${reason}`;
  const topRefusal = workflowRefusal(top.script);
  if (topRefusal !== null) return refused(inTop(topRefusal));
  const nested = nestedWorkflows(top.script);
  if ("refusal" in nested) return refused(inTop(nested.refusal));
  const scripts: RunScript[] = [top];
  const unreadable: string[] = [];
  for (const call of nested.calls) {
    const found =
      "name" in call ? scriptByName(call.name, place) : scriptAtPath(call.scriptPath, place.cwd);
    if ("unreadable" in found) {
      unreadable.push(found.unreadable);
      continue;
    }
    const from = "name" in call ? call.name : found.file;
    // The refusal first: it says why a script does not parse, before anything reads it.
    const childRefusal = workflowRefusal(found.script);
    if (childRefusal !== null) {
      return refused(`In the workflow \`${from}\` this one runs: ${childRefusal}`);
    }
    const deeper = parsedScript(found.script).workflows[0];
    if (deeper !== undefined) {
      return refused(
        `The workflow \`${from}\` this one runs nests a workflow of its own (line ${deeper.line}): Claude Code runs workflows one level deep, and the guard reads no deeper.`,
      );
    }
    scripts.push({ from, script: found.script });
  }
  return {
    refusal: null,
    results: scripts.flatMap((one) => judgeWorkflow(one.script, ctx, env, one.from)),
    unreadable,
  };
}

/** The question asked after each reason a run cannot be read. */
const UNREADABLE_ASK =
  "The guard cannot see the model and effort its launches run on: approve only if you know what this workflow runs.";

/** Said in `claude -p` after the reasons a run cannot be read. */
const UNREADABLE_UNATTENDED =
  "The guard cannot see the model and effort its launches run on, and this session has nobody to answer (`claude -p`): pass the script inline (`script`), or by `scriptPath` to a file the guard can read, or run it in an interactive session.";

/**
 * The one answer for a whole Workflow call: a refusal or any denied launch denies it; a script
 * it cannot read asks (denied in `claude -p`, where nobody can answer); else the ask names each
 * launch that asks; else it is allowed.
 */
function workflowAnswer(
  call: WorkflowCall,
  env: Env,
): { decision: "allow" | "ask" | "deny"; reason: string } {
  if (call.refusal !== null) return { decision: "deny", reason: call.refusal };
  const denied = call.results.find((one) => one.verdict.decision === "deny");
  if (denied !== undefined) return { decision: "deny", reason: workflowReason(denied) };
  if (call.unreadable.length > 0 && nobodyWatches(env)) {
    return {
      decision: "deny",
      reason: [...call.unreadable, UNREADABLE_UNATTENDED].join("\n"),
    };
  }
  const asks = [
    ...call.unreadable.map((reason) => `${reason}\n${UNREADABLE_ASK}`),
    ...call.results.filter((one) => one.verdict.decision === "ask").map(workflowReason),
  ];
  return asks.length > 0
    ? { decision: "ask", reason: asks.join("\n") }
    : { decision: "allow", reason: "" };
}

/** The guard's answer: what to do, in words for the person or Claude, and what it read. */
export interface Verdict {
  decision: "allow" | "ask" | "deny";
  /** The model and effort the launch really runs on, after Claude Code's overrides. */
  ran: EffectiveLaunch;
  /** The launch's real model; null when the call named none and is not a fork. */
  real: LaunchModel | null;
  /** One short paragraph: the ask shown to the person, or the denial shown to Claude. */
  reason: string;
  /** True for an ask that rests on the launch's own prompt: a reason line, which a Workflow
   * script's unreadable prompt cannot carry (`judgeWorkflow`). */
  restsOnPrompt?: true;
  /** Why an Opus or Fable launch is allowed (for the record and the hook log); else "". */
  why: string;
}

/** A verdict before `judgeLaunch` adds what the launch really runs on. */
type Judged = Omit<Verdict, "ran">;

function allow(real: LaunchModel | null, why = ""): Judged {
  return { decision: "allow", real, reason: "", why };
}

function deny(real: LaunchModel | null, reason: string, why = ""): Judged {
  return { decision: "deny", real, reason, why };
}

/** The text after a `Opus reason:` / `Fable reason:` label, on its own line; else null. */
export function reasonLine(prompt: string, label: string): null | string {
  const pattern = new RegExp(`^\\s*${label}:\\s*(\\S.*)$`, "i");
  for (const line of prompt.split("\n")) {
    const found = pattern.exec(line);
    if (found?.[1] !== undefined) return found[1].trim();
  }
  return null;
}

/**
 * The first word of a reason line, as `firstWord` reads it (lower case, without the punctuation
 * around it); null when it names a word not in `allowed`.
 */
function reasonWord(text: null | string, allowed: readonly string[]): null | string {
  const word = firstWord(text) ?? "";
  return allowed.includes(word) ? word : null;
}

/** The longest reason word the record keeps: a reason line is free text. */
const REASON_WORD_MAX = 40;

/**
 * The first word of an `Opus reason:` line, lower case and without the punctuation around it
 * (`security.` and `` `security` `` both read `security`); null when the line has no word.
 * Mostly it only names the purpose in the record; the UI rule (`uiDeclaration`) decides on it.
 */
function firstWord(text: null | string): null | string {
  const found = /^[^a-z0-9]*([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(text?.toLowerCase() ?? "");
  return found?.[1]?.slice(0, REASON_WORD_MAX) ?? null;
}

/**
 * The UI/UX declaration a launch's prompt carries, or null (D50): the first word of an
 * `Opus reason:` or a `Fable reason:` line, when it is one of `UI_REASON_WORDS`. Only a
 * declared launch is held to the UI rule — a prompt that merely talks about a page or a
 * layout is never sniffed for keywords, because a false positive would block real work.
 */
function uiDeclaration(prompt: string): null | string {
  for (const label of ["Opus reason", "Fable reason"]) {
    const said = reasonLine(prompt, label);
    const word = firstWord(said);
    if (word !== null && (UI_REASON_WORDS as readonly string[]).includes(word)) {
      return `${label}: ${said}`;
    }
  }
  return null;
}

const NO_MODEL = [
  "Neither this Agent launch nor its agent definition names a `model` the guard can read.",
  "Pass `model` on the launch or set it in the agent's frontmatter; `inherit` does not choose a model.",
].join("\n");

/** Levels as the guard's messages name them: `` `high` or `xhigh` ``. */
function levelsText(levels: readonly string[]): string {
  const named = levels.map((one) => `\`${one}\``);
  return named.length < 2 ? named.join("") : `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`;
}

/** The levels of `ALLOWED_EFFORTS` as the guard's messages name them: `` `medium`, `high`, `xhigh` or `max` ``. */
const EFFORTS = levelsText(ALLOWED_EFFORTS);

/** What each allowed level is for (the owner's decision D13), as every effort message says it. */
const EFFORT_USE =
  "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` when the task wants it on `haiku` or `sonnet`, whatever model answers them (the `opus` tier asks the person at `max`).";

const NO_EFFORT = [
  "Neither this Agent launch nor its agent definition names an `effort` the guard can read.",
  `Pass \`effort\` on the launch or set it in the agent's frontmatter: ${EFFORTS}.`,
  EFFORT_USE,
].join("\n");

/** Said when a `claude -p` run (`PRINT_RUN`) names no model: it has no agent definition. */
const PRINT_NO_MODEL = [
  "This `claude -p` run names no `model` the guard can read.",
  "A run given none starts on the default model, which nobody chose, and no agent definition stands behind a print run.",
].join("\n");

/** Said when a `claude -p` run names no effort. */
const PRINT_NO_EFFORT = [
  "This `claude -p` run names no `effort` the guard can read.",
  `Name one of ${EFFORTS}.`,
  EFFORT_USE,
].join("\n");

/**
 * Said when a launch names an effort a subagent never runs at: `low`, or a level no rule knows.
 * An effort the agent's frontmatter set says so, with how the call overrides it.
 */
function effortDenial(effort: string, fromFrontmatter: boolean): string {
  return [
    `This launch asks for effort \`${effort}\`, which no subagent may run at (the plugin's rule).`,
    ...(fromFrontmatter
      ? [
          `Effort \`${effort}\` comes from the agent's frontmatter; pass \`effort\` on the call to override it.`,
        ]
      : []),
    `A subagent runs at ${EFFORTS} — never \`low\`, on any model.`,
    EFFORT_USE,
  ].join("\n");
}

/**
 * Said when a launch declares UI/UX work (D50) and would run on a tier or an effort UI/UX work
 * never runs at. The line names the allowed models and efforts, built from `UI_POLICY`.
 */
function uiDenial(real: LaunchModel, effort: null | string, declared: string): string {
  return [
    `This launch declares UI/UX work (\`${declared}\`) and would run on \`${real.model}\` ${atEffort(effort)}.`,
    `Use ${uiRuleText()} for UI/UX work (D50).`,
    "Checking is not design: `cc-smart-dev-kit:ui-verifier` may run on an affordable model, and you judge its measured facts and screenshots on one of those tiers.",
  ].join("\n");
}

/**
 * How the guard's messages name the model behind a premium launch: Claude by its family when a
 * Claude model answers, else the tier and the model that answers it (owner, 2026-10-16), so an
 * `opus` whose slot answers with a backend never reads as Claude.
 */
function namedModel(real: LaunchModel): string {
  if (real.claude) return real.tier === "fable" ? "Claude Fable" : "Claude Opus";
  return `\`${real.tier ?? real.model}\` (answered by ${real.model})`;
}

/**
 * The effort a message names: what the launch asked for, lower case. A fork names none — it
 * runs at the session's own effort, which the hook cannot read.
 */
function atEffort(effort: null | string): string {
  return effort === null ? "at the session's own effort" : `at effort \`${effort.toLowerCase()}\``;
}

/**
 * Why an `opus`-tier launch ran, for the record: the tier and the effort, then the prompt's
 * `Opus reason:` word when it has one (`opus:xhigh:security`). `cc-smart-dev-kit usage` counts
 * by the last part, so a launch with a word is counted by its word, and one without by its
 * effort. A fork names no effort: it runs at the session's own.
 */
function opusWhy(effort: null | string, word: null | string): string {
  const level = effort ?? SESSION_EFFORT;
  return word === null ? `opus:${level}` : `opus:${level}:${word}`;
}

/**
 * Said when a read-only Fable launch names no reason word, or one nobody listed — `build`
 * included: that word is the builder's own (owner, 2026-10-16), and a read-only agent never
 * builds.
 */
function fableDenial(real: LaunchModel): string {
  return [
    `This launch would run on ${namedModel(real)}.`,
    `Fable advises; it builds only when the person asks. Use a read-only agent type (${READ_ONLY_AGENTS.join(", ")}) and put a line in the prompt saying why:`,
    `Fable reason: <${FABLE_REASONS.join("|")}> - <why>`,
    `An agent that can change files needs \`Fable reason: ${FABLE_BUILD_REASON} - <what the person asked>\` instead.`,
  ].join("\n");
}

/**
 * Said when an agent that can change files (a builder, or a fork) asks for Fable without the
 * one word that means the person asked for it.
 */
function fableBuildDenial(real: LaunchModel, type: string): string {
  return [
    `This launch would run on ${namedModel(real)}, and it asks for \`${type || "(no type)"}\`, which can change files.`,
    "Fable builds only when the person asks: put what they asked for in the prompt as this line, and they approve this one launch:",
    `Fable reason: ${FABLE_BUILD_REASON} - <what the person asked>`,
  ].join("\n");
}

/**
 * Where a person changes one of Claude Code's own variables: Claude cannot, since the call no
 * longer carries the field the variable replaces.
 */
const WHERE_SET =
  "where it is set — the environment Claude Code was started with, or the `env` of a Claude Code settings file (the user's, the project's, or the project's local one)";

/** Said when `CLAUDE_CODE_EFFORT_LEVEL` names a level no subagent may run at. */
function effortLevelDenial(level: string): string {
  return [
    `\`${EFFORT_LEVEL_ENV}\` is \`${level}\`, and Claude Code runs every subagent at it: no subagent may run at \`${level}\` (the plugin's rule).`,
    `A subagent runs at ${EFFORTS} — never \`low\`, on any model.`,
    `Only the person can change the variable: ask them to set it to one of those levels, or to remove it, ${WHERE_SET}.`,
  ].join("\n");
}

/** Said when an override puts the launch on a model other than the one it names. */
function modelNote(ran: EffectiveLaunch): null | string {
  const ignored = "Claude Code ignores the launch's own `model`.";
  if (ran.modelFrom === "force") {
    return `This launch runs on \`${ran.model}\` because \`${SUBAGENT_MODEL_FORCE_ENV}\` is set, with \`${SUBAGENT_MODEL_ENV}=${ran.model}\`: ${ignored}`;
  }
  if (ran.modelFrom === "force-session") {
    const which = ran.model === null ? "" : `, \`${ran.model}\`,`;
    const unknown =
      ran.model === null
        ? " The guard cannot read the session's model, so it judges the launch as the opus tier."
        : "";
    return `This launch runs on the session's own model${which} because \`${SUBAGENT_MODEL_FORCE_ENV}\` is set without \`${SUBAGENT_MODEL_ENV}\`: ${ignored}${unknown}`;
  }
  if (ran.modelFrom === "workflow") {
    return `This launch runs on \`${ran.model}\` because \`${WORKFLOW_SUBAGENT_MODEL_ENV}\` is set: Claude Code ignores the script's own \`model\`.`;
  }
  return null;
}

/** Said when `CLAUDE_CODE_EFFORT_LEVEL` sets the effort the launch runs at. */
function effortNote(ran: EffectiveLaunch): null | string {
  // Only the variable is named on every reason; frontmatter is named by the effort rule's own.
  if (ran.effortFrom !== EFFORT_LEVEL_ENV) return null;
  return `It runs at effort \`${ran.effort}\` because \`${ran.effortFrom}\` is set: Claude Code ignores the launch's own \`effort\`, and only the person can change the variable, ${WHERE_SET}.`;
}

/**
 * Judges one launch against the owner's rules; pure, so a test can drive every branch. It
 * judges what the launch REALLY runs on (`effectiveLaunch`: Claude Code's FORCE, Workflow and
 * effort overrides, read from `env`), and an ask or a denial names the override that applied.
 */
export function judgeLaunch(launch: Launch, ctx: GuardContext, env: Env): Verdict {
  // A definition is read only when the call names an agent and leaves a field to its
  // definition: a fork and a `claude -p` run never read one.
  const needsDefinition =
    !launch.fork &&
    launch.tool !== PRINT_RUN &&
    launch.subagentType !== null &&
    (launch.model === null || launch.effort === null);
  const ran = effectiveLaunch(
    {
      effort: launch.effort,
      fork: launch.fork,
      model: launch.model,
      workflow: launch.tool === "Workflow",
    },
    env,
    ctx.sessionModel,
    needsDefinition ? (ctx.definition?.(launch.subagentType) ?? null) : null,
  );
  const { verdict, namesEffortLevel } = judgeRan(launch, ran, ctx, env);
  if (verdict.decision === "allow") return { ...verdict, ran };
  const notes = [modelNote(ran), namesEffortLevel ? null : effortNote(ran)].filter(
    (one): one is string => one !== null,
  );
  return { ...verdict, ran, reason: [...notes, verdict.reason].join("\n") };
}

/** The verdict on what a launch really runs on; `namesEffortLevel` when its words already do. */
function judgeRan(
  launch: Launch,
  ran: EffectiveLaunch,
  ctx: GuardContext,
  env: Env,
): { namesEffortLevel: boolean; verdict: Judged } {
  const judged = (verdict: Judged) => ({ namesEffortLevel: false, verdict });
  if (!launch.fork) {
    // A call that names no model, with no override to name it, would inherit the session's.
    const print = launch.tool === PRINT_RUN;
    if (ran.modelFrom === "call" && ran.model === null) {
      return judged(deny(null, print ? PRINT_NO_MODEL : NO_MODEL));
    }
    if (ran.effort === null) return judged(deny(null, print ? PRINT_NO_EFFORT : NO_EFFORT));
  }
  // A fork always runs on the session's own model and effort: Claude Code ignores a `model` a
  // fork is given (`docs/claude-code-contract.md`), so judging the name it carries would judge a
  // model it never runs on. FORCE without a model of its own does the same for every launch.
  const real =
    ran.modelFrom === "fork" || ran.modelFrom === "force-session"
      ? sessionLaunchModel(ran.model, ctx, env)
      : resolveLaunchModel(ran.model ?? "", ctx, env);
  // The effort rule, before every model rule: a subagent never runs at `low` — on a Claude model
  // and an affordable slot alike. A level no rule knows is refused, not guessed.
  // `CLAUDE_CODE_EFFORT_LEVEL=auto` is the person's own choice (`EFFORT_AUTO`): the model picks
  // its default, which is never `max`, so it passes the effort rule and the opus tier's ask.
  const auto = ran.effortFrom === EFFORT_LEVEL_ENV && ran.effort === EFFORT_AUTO;
  if (ran.effort !== null && !auto && !effortAllowed(ran.effort)) {
    return ran.effortFrom !== EFFORT_LEVEL_ENV
      ? judged(deny(real, effortDenial(ran.effort, ran.effortFrom === "frontmatter")))
      : { namesEffortLevel: true, verdict: deny(real, effortLevelDenial(ran.effort)) };
  }
  return judged(judgeModel({ ...launch, effort: ran.effort }, real, ctx, env));
}

/** The model rules, on the launch's real model and the effort it really runs at. */
function judgeModel(launch: Launch, real: LaunchModel, ctx: GuardContext, env: Env): Judged {
  const type = launch.subagentType ?? "";
  const builder = !readOnlyType(type, ctx, env);

  // UI/UX work (D50) comes before every tier rule: a launch that declares it runs only on the
  // tiers and at the efforts `UI_POLICY` names, so a declared UI launch on Sonnet, Haiku or an
  // affordable slot — or on an allowed tier below `high` — is refused here rather than allowed
  // by the rule below. A fork names no effort: it runs at the session's own, which the person
  // chose, so only its tier is judged.
  const declared = uiDeclaration(launch.prompt);
  if (declared !== null) {
    const effort = launch.effort?.toLowerCase() ?? null;
    const tooLow = effort !== null && !uiEffortAllowed(effort);
    if (!uiTierAllowed(real) || tooLow) return deny(real, uiDenial(real, effort, declared));
  }

  // The premium tiers come FIRST: `opus` and `fable` are the tier whatever model answers behind
  // them (owner, 2026-10-16), so an override or a family slot that points one at a backend never
  // drops the tier's own gate (Fable's reason line, the `opus` tier's ask at `max`).
  if (real.tier === "fable") {
    const said = reasonLine(launch.prompt, "Fable reason");
    // A read-only agent advises, so any word of the read-only list is enough; an agent that can
    // change files — any other type, a fork included — runs on Fable only when the person asked
    // for it: the one word `build`, which is the builder's own.
    const word = reasonWord(said, builder ? BUILDER_WORDS : FABLE_REASONS);
    if (word === null)
      return deny(real, builder ? fableBuildDenial(real, type) : fableDenial(real));
    if (nobodyWatches(env)) {
      const why =
        "A Fable launch is approved by the person, one by one, and this session has nobody to answer";
      return deny(
        real,
        [`${why} (\`claude -p\`).`, "Run it in an interactive session."].join("\n"),
      );
    }
    return {
      decision: "ask",
      real,
      reason: builder
        ? [
            `${namedModel(real)} launch: \`${type || "(no type)"}\` will build here, ${atEffort(launch.effort)}, at the person's request, with the reason line \`Fable reason: ${said}\`.`,
            "Fable builds only when the person asks, and this launch spends the person's own plan usage. Approve only if you asked for it.",
          ].join("\n")
        : [
            `${namedModel(real)} launch: a read-only agent (\`${type}\`) ${atEffort(launch.effort)}, with the reason line \`Fable reason: ${said}\`.`,
            "Fable advises; it builds only when the person asks. Approve if this is the advice, the review or the fresh attempt you want.",
          ].join("\n"),
      why: `fable:${word}`,
      restsOnPrompt: true,
    };
  }

  // The `opus` tier — a Claude Opus model, an `opus` name with anything behind it, or a name no
  // rule knows (the strictest reading). The owner's decision D11: below `OPUS_ASK_EFFORT` it
  // runs with no question, for any agent and any purpose; at `max` the person is asked, and the
  // ask rests on the effort, not on a prompt. No reason line is needed: when the prompt has one,
  // its word only names the purpose in the record.
  if (real.tier === "opus") {
    const said = reasonLine(launch.prompt, "Opus reason");
    // A fork names no effort: it runs at the session's own, which the person chose.
    const effort = launch.effort?.toLowerCase() ?? null;
    // The free path is for a reading the guard can prove is the Opus family. A name it cannot
    // read (`inherit`, `best`, an id it does not know) may stand for a higher tier, so the
    // person approves it, at any effort — and where nobody can answer, it is refused.
    if (real.family !== "opus") {
      if (nobodyWatches(env)) {
        const why = `This launch names \`${real.model}\`, which the guard cannot read as Claude Opus, and such a launch is approved by the person, one by one: this session has nobody to answer`;
        return deny(
          real,
          [`${why} (\`claude -p\`).`, "Name `opus` (or a Claude Opus id) as its model."].join("\n"),
        );
      }
      return {
        decision: "ask",
        real,
        reason: [
          `A launch on \`${real.model}\` ${atEffort(launch.effort)}: the guard cannot read the model behind it as Claude Opus, so it may be a higher tier.`,
          "Approve only if this launch really runs on the opus tier.",
        ].join("\n"),
        why: "opus:unreadable",
      };
    }
    const why = opusWhy(effort, firstWord(said));
    if (effort !== OPUS_ASK_EFFORT) return allow(real, why);
    if (nobodyWatches(env)) {
      const nobody = `A launch on ${namedModel(real)} at effort \`${effort}\` is approved by the person, one by one, and this session has nobody to answer`;
      return deny(
        real,
        [
          `${nobody} (\`claude -p\`).`,
          `Run it at ${levelsText(OPUS_FREE_EFFORTS)}, or in an interactive session.`,
        ].join("\n"),
      );
    }
    return {
      decision: "ask",
      real,
      reason: [
        `${namedModel(real)} launch at effort \`${effort}\`: \`${type || "general-purpose"}\`${said === null ? "" : `, with the reason line "Opus reason: ${said}"`}.`,
        `The opus tier runs at ${levelsText(OPUS_FREE_EFFORTS)} with no question; \`${effort}\` only when the person asks for it. Approve only if you did.`,
      ].join("\n"),
      why,
    };
  }

  // Both tiers answered above, so what is left is Sonnet or Haiku, Claude or a backend that
  // answers the slot: free of the model rules, at any allowed effort (the owner, 2026-10-26).
  return allow(real, "");
}

/** True when this session has nobody to answer a question: `claude -p`. */
function nobodyWatches(env: Env): boolean {
  return !isAttended(env);
}

/**
 * The model behind a launch on the session's own model (a fork, or FORCE with no model of its
 * own): unknowable → Claude Opus.
 */
function sessionLaunchModel(
  sessionModel: null | string,
  gateway: GatewayFacts,
  env: Env,
): LaunchModel {
  if (sessionModel === null)
    return { claude: true, family: "opus", model: "the session's model (unknown)", tier: "opus" };
  return resolveLaunchModel(sessionModel, gateway, env);
}

/** The gateway config for a hook on this machine: null when there is none, or it cannot be used. */
export function gatewayConfigOf(paths: CliPaths): GatewayConfig | null {
  try {
    return loadConfigFile(paths.gatewayConfigFile);
  } catch {
    // No gateway.json, or one that cannot be used: no slot is known, and every claude-… id
    // stays Claude. The judgement then leans on the family names alone.
    return null;
  }
}

/**
 * The model the session itself runs on: the one that last answered in its transcript
 * (`lastClaudeModel`), else the model it was started on (`ANTHROPIC_MODEL`). One home: the
 * Agent guard's fork rule and `fable-session` both read it.
 */
export function sessionModelOf(input: HookInput, env: Env): null | string {
  const transcript = stringField(input.transcript_path);
  const answered = transcript === null ? null : lastClaudeModel(transcript);
  return answered ?? stringField(env.ANTHROPIC_MODEL);
}

/** The gateway one session runs on: `GatewayFacts`, and the profile its URL names. */
export interface SessionGateway extends GatewayFacts {
  /** The profile the session's URL names (`…/p/<name>`); null for none. */
  profile: null | string;
}

/**
 * The gateway as THIS session runs on it (RF1-2). Claude Code gives a hook process the session's
 * effective `ANTHROPIC_BASE_URL` in its own environment — the project's personal file over its
 * team file over the user file, a `--settings` file over all of them, and any of them over the
 * shell's own export (proved live on 2.1.310, `docs/claude-code-contract.md` § Hooks) — so
 * `gateway project on|off`, a profile and `launch --settings` are each judged as the session
 * really runs, never from the machine's file alone:
 *   - no URL, or Anthropic's own address (what `gateway off` and `gateway project off` write):
 *     off, the Claude model answers on the person's login;
 *   - `…/p/<name>` on this machine's router: on, with that profile's chains (`profileView`); a
 *     name the config does not hold answers as plain Claude (`plainClaudeView`), as the router
 *     answers it;
 *   - this machine's router, or any other address: on, with the machine's chains, as before.
 * Never throws: a config that cannot be read gives no chains (`gatewayConfigOf`).
 */
export function sessionGatewayOf(paths: CliPaths, env: Env): SessionGateway {
  const raw = env.ANTHROPIC_BASE_URL;
  const url = raw === undefined || raw === "" ? null : raw;
  const config = gatewayConfigOf(paths);
  if (!baseUrlPointsAtGateway(url)) return { config, gatewayOn: false, profile: null };
  const profile = config === null ? null : urlMeaning(url, routerBaseUrl(config.port)).profile;
  if (config === null || profile === null) return { config, gatewayOn: true, profile: null };
  return {
    config: profileView(config, profile) ?? plainClaudeView(config),
    gatewayOn: true,
    profile,
  };
}

/**
 * What the guard reads for `judgeLaunch`: the session's own gateway and model, and the agent
 * definitions; never throws. The managed agents folder comes from `paths.managedAgentsDir` (a
 * test's paths name a temp folder, so it never reads the machine's own).
 */
export function readGuardContext(paths: CliPaths, input: HookInput, env: Env): GuardContext {
  const { config, gatewayOn } = sessionGatewayOf(paths, env);
  const cwd = stringField(input.cwd);
  const definitions = new Map<string, AgentDefinition | null>();
  const definition = (name: null | string): AgentDefinition | null => {
    if (name === null) return null;
    if (definitions.has(name)) return definitions.get(name) ?? null;
    let found: AgentDefinition | null = null;
    try {
      // Qualified plugin names never need a project scan or git lookup.
      const checkout =
        !name.includes(":") && cwd !== null ? (locateCheckout(cwd)?.root ?? cwd) : null;
      found = agentDefinition(name, { paths, checkout, cwd });
    } catch {
      // A failed checkout lookup, or a cwd that cannot be resolved, makes the entire definition
      // unknown, not user-only: the launch then needs its own `model` and `effort`.
    }
    definitions.set(name, found);
    return found;
  };
  return {
    config,
    gatewayOn,
    definition,
    // The session's own model, for a fork: what last answered, else the model the session was
    // started on, else unknowable.
    sessionModel: sessionModelOf(input, env),
  };
}

/**
 * The facts the hook log carries (`logFacts`), so `doctor --live` can prove what the guard
 * judged — an Opus or Fable launch and its reason included. Only a hook whose log is on
 * (`CC_SMART_DEV_KIT_HOOK_LOG`) runs this.
 */
export function guardFacts(input: HookInput, context: HookEnvContext): Record<string, unknown> {
  // After the call the guard answers nothing: a verdict there would read as a second question.
  if (afterTheCall(input)) return { event: RAN_EVENT };
  const guard = readGuardContext(context.paths, input, context.env);
  const tool = stringField(input.tool_name);
  if (tool !== null && (WORKFLOW_TOOLS as readonly string[]).includes(tool)) {
    const call = judgeWorkflowCall(
      toolInput(input),
      guard,
      context.env,
      workflowPlace(context.paths, context.env, stringField(input.cwd) ?? ""),
    );
    const { decision } = workflowAnswer(call, context.env);
    // What decided it: a script or a call the guard cannot read, else the first launch that
    // gave the call its answer.
    const decided = call.results.find((one) => one.verdict.decision === decision);
    const why =
      decision === "allow"
        ? null
        : call.refusal !== null ||
            (call.unreadable.length > 0 && decided?.verdict.decision !== "deny")
          ? "unreadable"
          : decided === undefined
            ? decision
            : decided.verdict.why || decided.verdict.decision;
    return {
      decision,
      launches: call.results.length,
      tool: "Workflow",
      ...(why === null ? {} : { why }),
    };
  }
  const launch = readLaunch(input);
  if (launch === null) return {};
  const result = judgeLaunch(launch, guard, context.env);
  return {
    decision: result.decision,
    effort: launch.effort,
    family: result.real?.family ?? null,
    fork: launch.fork,
    model: launch.model,
    subagent_type: launch.subagentType,
    tier: result.real?.tier ?? null,
    tool: launch.tool,
    ...(result.why === "" ? {} : { why: result.why }),
    ...overrideFacts(result.ran),
  };
}

/** The variable that set the model a launch runs on, for the log; null when none did. */
function modelOverride(ran: EffectiveLaunch): null | string {
  if (ran.modelFrom === "force" || ran.modelFrom === "force-session") {
    return SUBAGENT_MODEL_FORCE_ENV;
  }
  return ran.modelFrom === "workflow" ? WORKFLOW_SUBAGENT_MODEL_ENV : null;
}

/** The overrides that applied, and what the launch ran on because of them: only when one did. */
function overrideFacts(ran: EffectiveLaunch): Record<string, unknown> {
  const model = modelOverride(ran);
  return {
    ...(model === null ? {} : { model_override: model, ran_model: ran.model }),
    ...(ran.effortFrom === null ? {} : { effort_override: ran.effortFrom, ran_effort: ran.effort }),
  };
}

/**
 * Where a Workflow's scripts are found from this hook (`WorkflowPlace`): the input's `cwd`, the
 * person's folders, and this plugin's own folder (`CLAUDE_PLUGIN_ROOT`, which Claude Code sets
 * for a plugin's hook).
 */
function workflowPlace(paths: CliPaths, env: Env, cwd: string): WorkflowPlace {
  return {
    claudeConfigDir: paths.claudeConfigDir,
    cwd,
    home: paths.home,
    installedPluginsFile: paths.installedPluginsFile,
    pluginRoot: stringField(env.CLAUDE_PLUGIN_ROOT),
  };
}

/**
 * The model Claude Code resolved for a launch it started: `PostToolUse`'s
 * `tool_response.resolvedModel` (`docs/claude-code-contract.md` § Hooks). PostToolUse on the
 * Agent tool fires **at the launch**, not when the agent finishes, so this is the model the
 * agent runs on (proved live on 2.1.306: `claude-opus-5-5` for a launch that named `opus`).
 * Null on PreToolUse, and for a call whose answer carries none (a Workflow).
 */
export function resolvedModelOf(input: HookInput): null | string {
  const response = input.tool_response;
  if (typeof response !== "object" || response === null || Array.isArray(response)) return null;
  return stringField((response as Record<string, unknown>).resolvedModel);
}

/**
 * One line in the record for an Opus or Fable launch; null for any other. `index` is the
 * launch's place in its tool call (a Workflow's launches share one `tool_use_id`).
 */
function recorded(
  result: Verdict,
  launch: Launch,
  input: HookInput,
  cwd: string,
  nowMs: number,
  index: number,
): AgentLaunch | null {
  // The tier, not the vendor: a premium launch whose model is a backend is recorded too.
  const family = result.real?.tier;
  if (family !== "opus" && family !== "fable") return null;
  const reason = result.why === "" ? result.decision : result.why;
  return {
    at: nowMs,
    // What it really ran at, after Claude Code's overrides; a fork at the session's own.
    effort: result.ran.effort?.toLowerCase() ?? SESSION_EFFORT,
    family,
    launchIndex: index,
    // What Claude Code says the launch runs on, when it says (PostToolUse, the record of an
    // asked launch); else what the guard resolved from the model name.
    model: resolvedModelOf(input) ?? result.real?.model ?? "",
    project: cwd,
    reason,
    session: stringField(input.session_id) ?? "",
    subagentType: launch.subagentType ?? "",
    toolUseId: stringField(input.tool_use_id) ?? "",
    word: reasonParts(reason).word,
  };
}

/**
 * The event that says a call RAN. A PreToolUse hook cannot know the person's answer to an ask,
 * so an asked launch is recorded here instead: Claude Code runs PostToolUse only for a call
 * that ran, and an asked call runs only on the person's yes. The guard says nothing there.
 */
export const RAN_EVENT = "PostToolUse";

/** True when the input is the guard's run after the call (`RAN_EVENT`), not its question. */
function afterTheCall(input: HookInput): boolean {
  return stringField(input.hook_event_name) === RAN_EVENT;
}

/**
 * What the guard judged for one call, before any record is written: a whole Workflow call, or a
 * single launch. `null` when the call is none of the guard's business.
 */
type Judgement =
  | { kind: "workflow"; call: WorkflowCall; decision: "allow" | "ask" | "deny"; reason: string }
  | { kind: "launch"; launch: Launch; verdict: Verdict };

/** The guard's judgment of one call, with no record written. */
function judgeCall(input: HookInput, env: Env, paths: CliPaths, cwd: string): Judgement | null {
  const tool = stringField(input.tool_name);
  const context = readGuardContext(paths, input, env);
  if (tool !== null && (WORKFLOW_TOOLS as readonly string[]).includes(tool)) {
    const call = judgeWorkflowCall(toolInput(input), context, env, workflowPlace(paths, env, cwd));
    // One answer for the whole call: a deny refuses it, so nothing in it runs; an ask names each
    // launch that asks and each script it cannot read.
    const answer = workflowAnswer(call, env);
    return { kind: "workflow", call, decision: answer.decision, reason: answer.reason };
  }
  const launch = readLaunch(input);
  if (launch === null) return null;
  return { kind: "launch", launch, verdict: judgeLaunch(launch, context, env) };
}

/**
 * The hook's answer: judge the launch (or every launch a Workflow script makes), record an
 * Opus or Fable one once it is known to run, and answer with the PreToolUse decision.
 *
 * The record: on PreToolUse, a call the guard allows outright (it runs with no question); on
 * PostToolUse (`RAN_EVENT`), a call the guard asked about (it ran, so the person said yes). So
 * a launch the person refuses is never recorded, and none is recorded twice. A Workflow is one
 * call: when any of its launches asks, the person may refuse them all, so all wait for the run.
 * Each of a Workflow's launches is recorded under its own index, as its own line.
 *
 * A Workflow run is judged however it names its script — inline, `scriptPath`, a saved or a
 * plugin's `name` — with the workflows it nests (`judgeWorkflowCall`). One the guard cannot read
 * (a built-in, a missing file, a resume) asks, and is refused in `claude -p`. Anything else it
 * cannot work out lets the call through.
 */
export function agentGuard(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  cwd: string,
  nowMs: number = Date.now(),
): HookResult {
  const judged = judgeCall(input, env, paths, cwd);
  if (judged === null) return SILENT;
  const ran = afterTheCall(input);
  const file = agentLaunchesFile(paths.stateDir);
  const record = (lines: ReadonlyArray<{ launch: Launch; verdict: Verdict }>) => {
    const records = lines
      .map((one, index) => recorded(one.verdict, one.launch, input, cwd, nowMs, index))
      .filter((line): line is AgentLaunch => line !== null);
    if (records.length > 0) appendAgentLaunches(file, records);
  };
  if (judged.kind === "workflow") {
    const { call, decision, reason } = judged;
    // A deny refuses the whole call, so nothing in it runs and none of its launches is recorded.
    if (decision === "deny") return ran ? SILENT : toolDecision("deny", reason);
    const asked = decision === "ask";
    // Recorded when the whole call is known to run: at once when nothing in it asks, else after
    // it ran.
    if (ran === asked) {
      record(call.results.map((one) => ({ launch: asLaunch(one.launch), verdict: one.verdict })));
    }
    if (ran || !asked) return SILENT;
    return toolDecision("ask", reason);
  }
  const { launch, verdict } = judged;
  if (verdict.decision === (ran ? "ask" : "allow")) record([{ launch, verdict }]);
  return ran || verdict.decision === "allow"
    ? SILENT
    : toolDecision(verdict.decision, verdict.reason);
}
