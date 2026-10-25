/**
 * The `agent-guard` hook: PreToolUse on the Agent tool (and the older name `Task`), and on the
 * `Workflow` tool, whose script's `agent(...)` launches are read and judged (`WorkflowLaunch`).
 *
 * **Machine-wide.** It runs with or without `.claude/cc-smart-dev-kit.json` (like `update-check`), and
 * its answer never depends on the project's file for the model and effort it judges: those are
 * what the launch runs on. One rule does read the project — D59's queue rule below, which needs
 * this repository's crew store and the project's caps — and that rule alone is why the frame
 * hands the run its checkout. A
 * project that runs its own Agent guard lists `"agent-guard"` in `ownHooks` and this one stays
 * silent there. It is wired with `--missing=ask`: a guard fails closed.
 *
 * **Why.** An Agent call with no `model` runs on whatever model the session has; an Opus or
 * Fable launch spends the person's own plan usage; a subagent at `low` does work nobody chose
 * to cheapen; and an affordable gateway slot works well only at effort `max`.
 *
 * **Effort** (the owner's decisions D5 and D13). A subagent never runs at `low`, whatever the
 * model: the guard refuses a launch whose `effort` is not `medium`, `high`, `xhigh` or `max`.
 * That list lives once, in `ALLOWED_EFFORTS`, and the guard, its messages and the tests all
 * read it. `medium` is for searches and reads, `high` for building and reviews, `xhigh` for
 * the hardest judgment, and `max` on a Claude `haiku` or `sonnet` when the task wants it, with no
 * restriction (the owner, 2026-10-25: the session-start note, `tier-view.ts`, tells Claude which
 * tier is Claude). On top of it, an affordable slot must be `max`, and an `opus`-tier launch asks
 * the person at `OPUS_ASK_EFFORT` (`max`).
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
 * | an affordable slot key / a `<backend>:<model>` target / `haiku` or `sonnet` (or their ids) while the gateway is on and the family's slot chain starts with a backend | allow; with the gateway on, its effort must be `max`, else deny |
 * | any other name (`best`, `opusplan`, `default`, `inherit`, a name no rule knows) | the `opus` tier below (the strictest reading): only what the guard can prove affordable is affordable |
 * | Claude Sonnet or Haiku (the gateway off, the family's slot off, or its chain starting with a `claude-…` model) | allow (the effort rule above still holds) |
 * | the `opus` tier | read as the Opus family (the `opus` name, a Claude Opus id, the opus slot, an id the person's own override names for it): effort `medium`, `high` or `xhigh`: allow, for any agent and any purpose; effort `max`: **ask** (the person approves each one, and sees the model and the effort); a fork names no effort: it runs at the session's own, which the person chose, so it is allowed. A reading with no family (a name no rule knows, an id the guard cannot read): **ask** at any effort — it may stand for a higher tier |
 * | the `fable` tier | a read-only agent type with a prompt line `Fable reason: <one of FABLE_REASONS> - <why>`, and a person to answer: **ask** (the word `build` is not one of them: a read-only agent never builds); an agent that can change files (any other type, a fork included) with `Fable reason: build - <why>`: **ask** (the person asked for it); no line, a builder without the word `build`, or a session nobody watches (`claude -p`, a crew session): deny |
 * | no `model` / no `effort` | deny (a launch that names neither would inherit the session's, which nobody chose) — except a `fork`, which always inherits both, and a launch whose model or effort one of Claude Code's overrides sets (below) |
 * | a launch that declares UI/UX work (`Opus reason: ui`, `Fable reason: ui-design`) | allow only on the `opus` or `fable` tier at `high`, `xhigh` or `max` (`UI_POLICY`, D50); anything else — Sonnet, Haiku, an affordable slot, or a tier below `high` — is denied with the rule in words |
 * | a session nobody watches (`claude -p`, or a crew session: a `--bg` session nobody reads) | every premium launch that would ask is denied (there is nobody to approve it): the `opus` tier at `max` says to run it at `medium`, `high` or `xhigh`, or in an interactive session; a crew session says to put the question to its lead (`crew report --question`, `CREW_QUESTION_STEP`); a reading with no family says to name `opus`; the Opus family below `max` stays allowed |
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
 * knows) is refused, and so is anything but `max` on an affordable slot: only the person can
 * change the variable, and the message says where. `auto` is the person's own choice, like a
 * fork's effort (`EFFORT_AUTO`): never refused for itself, never asked on the `opus` tier (no
 * model's default is `max`). A fork keeps its own rule.
 *
 * **Tiers, not vendors** (the owner, 2026-10-16). `opus` and `fable` mean the TIER: whatever
 * model answers behind them — Claude, a backend through an override or the family's slot, a
 * name no rule knows — the tier's gates hold (Fable's reason line, `max` asking on the `opus`
 * tier, `-p` refusing). A tier is never affordable and never forced to `max`. The guard's messages
 * name both: `` `opus` (answered by openai:gpt-…) ``. So a launch is judged by `LaunchModel.tier`
 * and it is decided before the affordable rule; Sonnet, Haiku and the affordable slots keep
 * being allowed freely (at `max` on an affordable slot, where the reasoning costs cents).
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
 *
 * **A lead's building launch waits for the crew queue** (the owner's decision D59). The queue
 * exists for the machine (the caps `crew.max` and `crew.perLead`, the free memory, the 5-hour
 * usage window) and for each lead's fair share of it; a builder subagent runs outside every one
 * of those counts, and it has none of a crew phase's worktree, review, report gate or to-do list.
 * So in a **recorded lead's** session (`readLead`, by the input's `session_id` in the project's
 * repository), a launch that can change files (`buildsFiles`) is refused while a `crew start`
 * from that lead would queue now (`placeForLeadStart`, the same decision `crew start` makes) —
 * with one line naming the cap that holds and the `crew start` step. The model/effort rules
 * answer first: a launch they deny keeps their own words. Read-only subagents (a search, a
 * review, an audit, a UI check) are never held, and neither is a small fix a lead may hand to a
 * subagent while a place is free. It is a denial, not a question: the step needs no person.
 *
 * The rule is a lead's, so it never answers for a crew session (`crewAgentAnswer` is unchanged),
 * for an ordinary session, or for a call the guard cannot judge: a lead record it cannot read, a
 * checkout it was not given (a broken project file, a folder outside git), a store or a caps file
 * that throws — each lets the launch through and nothing is recorded. The hook log
 * (`guardFacts`) carries the model and effort verdict only: the queue refusal needs the store,
 * and a logged run reads none of it.
 */

import { COMMAND, PLUGIN } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { OPUS_TIER, type Place, placeForLeadStart } from "../crew/places";
import { CREW_QUESTION_STEP, crewIdOf } from "../crew/session";
import { readLead } from "../crew/store";
import {
  type GatewayConfig,
  loadConfigFile,
  plainClaudeView,
  profileView,
} from "../gateway/config";
import { urlMeaning } from "../gateway/project-state";
import { baseUrlPointsAtGateway, routerBaseUrl, settingsReport } from "../gateway/settings";
import { type MemoryFacts, realMemoryFacts } from "../jobs/memory";
import {
  AFFORDABLE_EFFORT,
  ALLOWED_EFFORTS,
  EFFORT_AUTO,
  EFFORT_LEVEL_ENV,
  type EffectiveLaunch,
  effectiveLaunch,
  effortAllowed,
  FABLE_BUILD_REASON,
  FABLE_REASONS,
  type GatewayFacts,
  isAffordable,
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
import type { Checkout } from "../project/resolve";
import {
  scriptAtPath,
  scriptByName,
  skipBlank,
  stringAt,
  type WorkflowPlace,
  wholeLiteralAt,
} from "./agent-guard-workflows";
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
import { isSessionId } from "./session-name";
import { lastClaudeModel } from "./transcript";

/** The tools this guard reads: the Agent tool, the older name, and Workflow. */
export const AGENT_TOOLS = ["Agent", "Task"] as const;
export const WORKFLOW_TOOLS = ["Workflow"] as const;

/** The subagent type a fork uses: it runs on the session's model and effort. */
export const FORK = "fork";

/** The words a builder may name: the one word that means the person asked for it. */
const BUILDER_WORDS = [FABLE_BUILD_REASON] as const;

/**
 * The subagent types that count as read-only on Fable: they read and report, never build, so
 * any word of `FABLE_REASONS` is enough. Every other type — a fork included — can change
 * files and needs the one word `build` (`FABLE_BUILD_REASON`).
 */
export const READ_ONLY_AGENTS = ["Plan", "Reviewer", "Explore", "auditor"] as const;

/** The environment variable a person may extend that list with (comma-separated). */
export const READ_ONLY_AGENTS_ENV = "CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS";

/** A subagent type as a list compares it: after any `plugin:`, `-`/`_`/space as one `-`. */
export function agentKey(type: string): string {
  const base = type.includes(":") ? (type.split(":").pop() ?? type) : type;
  return base
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

/**
 * The subagent types that build no phase's work (D59): a lead may launch them whatever the crew
 * queue holds. `Explore`, `Plan` and `claude-code-guide` only read and report. `statusline-setup`
 * is not read-only — Claude Code gives it `Edit` (the Agent tool lists its tools as `Read,
 * Edit`) and it writes the status line setting in the person's settings file — but it edits
 * nothing of the project, and a crew phase would not build that either. Every other type — a
 * `fork`, an unknown one, a custom one, a project's own agent — can change the project's
 * files, and so can a launch that asks for `isolation: "worktree"`, whatever its type.
 *
 * The two lists are separate because the ids are not the same kind. Claude Code's own four are
 * built in and carry no plugin prefix. The kit's three are plugin agents, and Claude Code
 * addresses a plugin's agent as `<plugin>:<agent>`: so only `cc-smart-dev-kit:reviewer` reads
 * as the kit's reviewer, and a project's own `.claude/agents/reviewer.md` (bare) or another
 * plugin's `probe-kit:reviewer` builds, as the brief's "any unknown or custom type" says.
 *
 * This is **not** `READ_ONLY_AGENTS`: that list is what Claude Fable may advise from (the
 * owner's), and the two answer different questions, so a type may sit in one and not the other.
 */
export const READ_ONLY_BUILT_INS = [
  "Explore",
  "Plan",
  "claude-code-guide",
  "statusline-setup",
] as const;

/** The kit's own read-only agent types, as Claude Code addresses a plugin's agents. */
export const READ_ONLY_KIT_AGENTS = ["reviewer", "auditor", "ui-verifier"] as const;

/** `READ_ONLY_BUILT_INS` as `agentKey` compares them, read once. */
const READ_ONLY_BUILT_IN_KEYS: ReadonlySet<string> = new Set(READ_ONLY_BUILT_INS.map(agentKey));

/** The kit's three, plugin-qualified, read once. */
const READ_ONLY_KIT_KEYS: ReadonlySet<string> = new Set(
  READ_ONLY_KIT_AGENTS.map((one) => `${PLUGIN}:${one}`.toLowerCase()),
);

/**
 * The kit's own Workflows that only read (`plugin/workflows/`): a lead may run them while its
 * crew queue is full. Every other Workflow — an inline script, a saved one, one named by a
 * path, a project's own saved file of the same name — may build, and a workflow's launches fire
 * no hook of their own. A bare name only ever finds a saved file (`scriptByName`), never the
 * kit's own workflow: its id is the plugin-qualified `<plugin>:<name>` the skills call.
 */
export const READ_ONLY_WORKFLOWS = [
  `${PLUGIN}:audit-run`,
  `${PLUGIN}:review-split`,
  `${PLUGIN}:research-sweep`,
] as const;

/** `READ_ONLY_WORKFLOWS` as Claude Code sends a plugin workflow's name, read once. */
const READ_ONLY_WORKFLOW_KEYS: ReadonlySet<string> = new Set(
  READ_ONLY_WORKFLOWS.map((one) => one.toLowerCase()),
);

/** True when an Agent launch can change files: any type but the read-only ones, or any worktree. */
export function buildsFiles(launch: Launch): boolean {
  if (launch.isolation?.toLowerCase() === "worktree") return true;
  const type = (launch.subagentType ?? "").trim().toLowerCase();
  if (!type.includes(":") && READ_ONLY_BUILT_IN_KEYS.has(agentKey(type))) return false;
  return !READ_ONLY_KIT_KEYS.has(type);
}

/**
 * True when a Workflow call can change files: every call but one that runs one of the kit's own
 * read-only workflows. A call gives a script in Claude Code's own order (`callScript`): an
 * inline `script` runs whatever the call also names, else `scriptPath`, else `name` — and a
 * `resumeFromRunId` goes on from a script the guard cannot see. So only a call that gives the
 * kit's qualified name and nothing else is read-only; a named call with a script, a path or a
 * resume is judged as what it runs.
 */
export function buildsWorkflow(fields: Record<string, unknown>): boolean {
  if (
    stringField(fields.script) !== null ||
    stringField(fields.scriptPath) !== null ||
    stringField(fields.resumeFromRunId) !== null
  ) {
    return true;
  }
  const name = stringField(fields.name);
  return name === null || !READ_ONLY_WORKFLOW_KEYS.has(name.trim().toLowerCase());
}

function agentList(from: readonly string[], env: Env, name: string): Set<string> {
  const listed = (env[name] ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");
  return new Set([...from, ...listed].map(agentKey));
}

/** The `model` (or one of its aliases) behind a launch, as Claude Code will send it. */
export interface Launch {
  effort: null | string;
  /** True for `subagent_type: "fork"`: it runs on the session's model and effort. */
  fork: boolean;
  /** `isolation` as the call names it: `"worktree"` gives the agent a checkout of its own. */
  isolation: null | string;
  /** The model as the call names it; null when it names none. */
  model: null | string;
  prompt: string;
  subagentType: null | string;
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
    isolation: stringField(fields.isolation),
    model: stringField(fields.model),
    prompt: typeof fields.prompt === "string" ? fields.prompt : "",
    subagentType,
    tool,
  };
}

/** What the guard reads from this machine; a test passes its own. */
export interface GuardContext extends GatewayFacts {
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
 * What it cannot see is refused, never guessed:
 *   - a value held in a variable (`model: chosen`), a prompt built at run time, a literal an
 *     operator changes (`effort: "high" && "max"`, `"a" + b`), and a backtick literal that
 *     builds its text (`` `${…}` ``) leave that launch's verdict short
 *     of a reason line, so a Fable launch is denied and a launch whose `model` cannot be read
 *     is denied outright (an `opus`-tier launch needs no reason line, so its prompt does not
 *     matter);
 *   - options built at run time (a `...spread`, a computed `[…]` key) and a launch made
 *     through a **variable** (`const run = agent; run(…)`, `agent?.(…)`, `agent` passed
 *     around) hide every rule from the guard, so the whole Workflow is denied with the reason
 *     (`workflowRefusal`).
 *
 * A launch written as a direct `agent(…)` call is read and judged wherever it is — inside a
 * helper function defined in the script too, and inside a template literal's `${…}`.
 */
export interface WorkflowLaunch {
  /** `agentType` of the call's options; null when the call names none or not as a literal. */
  agentType: null | string;
  effort: null | string;
  model: null | string;
  /** The prompt, when the first argument is a string literal; null otherwise. */
  prompt: null | string;
  /** How the message names this launch: its `label`, else the first words of its prompt. */
  where: string;
}

/** Where a `{…}` object or a `(…)` call ends, skipping string literals; the text's end. */
function endOf(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === '"' || char === "'" || char === "`") {
      const literal = stringAt(text, index);
      if (literal === null) return text.length;
      index = literal.end - 1;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

/** The text of the call whose `(` is at `open`, to the matching `)`. */
function callText(script: string, open: number): string {
  return script.slice(open, endOf(script, open, "(", ")") + 1);
}

/**
 * The first argument of a call, when it is a fixed string literal and the whole argument (no
 * `"a" + b` after it); null otherwise.
 */
function firstArgument(call: string): null | string {
  return wholeLiteralAt(call, skipBlank(call, 1), ",)");
}

/**
 * A fixed string option of a call (`model: "opus"`), or null when absent or not a literal — and
 * not when an operator follows it (`effort: "high" && "max"` runs at `max`). Only a key of the
 * call's own options object counts — never the same words in the prompt or in a nested object
 * (`schema: { effort: … }`), which would let them stand in for the real option.
 */
function stringOption(call: string, name: string): null | string {
  const at = readOptions(call).keys.get(name);
  if (at === undefined) return null;
  const colon = /^\s*:/.exec(call.slice(at));
  if (colon === null) return null;
  return wholeLiteralAt(call, skipBlank(call, at + colon[0].length), ",}");
}

/** The script functions the guard follows: `agent` launches one agent, `workflow` nests one. */
type ScriptFunction = "agent" | "workflow";

/** One way a script mentions a function: its name in code, and whether it is called. */
interface Mention {
  /** Where the name starts in the script. */
  at: number;
  /** True for a direct call (`agent(…)`); false when the function is handed around as a value. */
  call: boolean;
  /** The function's name. */
  name: ScriptFunction;
}

/** The position of the `(` of a direct call (`mention.call`). */
function callOpen(mention: Mention, script: string): number {
  return skipBlank(script, mention.at + mention.name.length);
}

/**
 * Every mention of `name` (`agent`, `workflow`) in the script's code, and whether it is a
 * direct call. In code only: the word inside a prompt, a string or a comment is not a mention,
 * and neither is a property (`x.agent`) or a longer name (`agentType`, `agents`). A template
 * literal's `${…}` is code again — a launch written there is a launch — so the scan keeps a
 * stack of the contexts it is inside.
 */
function mentionsOf(script: string, name: ScriptFunction): Mention[] {
  type Frame = {
    braces: number;
    kind: "block" | "code" | "double" | "line" | "single" | "template";
  };
  const mentions: Mention[] = [];
  const stack: Frame[] = [{ braces: 0, kind: "code" }];
  for (let index = 0; index < script.length; index += 1) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    const char = script[index] ?? "";
    const next = script[index + 1] ?? "";
    if (frame.kind === "line") {
      if (char === "\n") stack.pop();
      continue;
    }
    if (frame.kind === "block") {
      if (char === "*" && next === "/") {
        stack.pop();
        index += 1;
      }
      continue;
    }
    if (frame.kind === "single" || frame.kind === "double") {
      if (char === "\\") index += 1;
      else if (char === (frame.kind === "single" ? "'" : '"')) stack.pop();
      continue;
    }
    if (frame.kind === "template") {
      if (char === "\\") index += 1;
      else if (char === "`") stack.pop();
      else if (char === "$" && next === "{") {
        stack.push({ braces: 0, kind: "code" });
        index += 1;
      }
      continue;
    }
    // Code.
    if (char === "/" && next === "/") {
      stack.push({ braces: 0, kind: "line" });
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      stack.push({ braces: 0, kind: "block" });
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      stack.push({ braces: 0, kind: char === "'" ? "single" : "double" });
      continue;
    }
    if (char === "`") {
      stack.push({ braces: 0, kind: "template" });
      continue;
    }
    if (char === "{") {
      frame.braces += 1;
      continue;
    }
    if (char === "}") {
      if (frame.braces > 0) frame.braces -= 1;
      else if (stack.length > 1) stack.pop();
      continue;
    }
    if (
      script.startsWith(name, index) &&
      (index === 0 || /[^\w.$]/.test(script[index - 1] ?? ""))
    ) {
      const after = index + name.length;
      // `agentType`, `agents`: a longer name, not a mention of `agent`.
      if (/[\w$]/.test(script[after] ?? "")) continue;
      mentions.push({ at: index, call: /^\s*\(/.test(script.slice(after)), name });
    }
  }
  return mentions;
}

/** The line of the script an index sits on, counting from 1: what a message names. */
function lineOf(script: string, index: number): number {
  return script.slice(0, index).split("\n").length;
}

/** What one scan of a call's text finds (`readOptions`). */
interface CallOptions {
  /**
   * True when the call's options are not what they seem: a `...spread` (which can replace any
   * option), a computed key (`[…]`) where an object's key belongs, or the same key twice at one
   * level (JavaScript keeps the last, the guard reads the first). Any of them can change `model`
   * or `effort` after the literal the guard would have read.
   */
  hidden: boolean;
  /**
   * The keys of the call's own options object — the first object written directly in the call's
   * parentheses — each with the position just after its name.
   */
  keys: Map<string, number>;
}

/**
 * Scans a call's text once, skipping string literals and comments: the keys of its own options
 * object, and whether any option is hidden from the guard. A scan that meets an unclosed
 * literal or comment stops there with what it has read.
 */
function readOptions(call: string): CallOptions {
  const stack: string[] = [];
  /** The keys seen so far, one set per open object literal. */
  const seen: Array<Set<string>> = [];
  const keys = new Map<string, number>();
  /** True once the call's own options object has closed: a later object is not it. */
  let optionsDone = false;
  let keyExpected = false;
  const found = (hidden: boolean): CallOptions => ({ hidden, keys });
  /** Notes a key of the object open now, ending at `end`; true when that object has it twice. */
  const twice = (key: string, end: number): boolean => {
    const open = seen.at(-1);
    if (open !== undefined) {
      if (open.has(key)) return true;
      open.add(key);
    }
    if (stack.length === 1 && !optionsDone) keys.set(key, end);
    return false;
  };
  for (let index = 1; index < call.length; index += 1) {
    const char = call[index] ?? "";
    const next = call[index + 1] ?? "";
    if (char === '"' || char === "'" || char === "`") {
      const literal = stringAt(call, index);
      if (literal === null) return found(false);
      // A quoted key (`"model": …`) is a key like any other: JavaScript keeps the last of two.
      if (keyExpected && char !== "`" && twice(literal.value, literal.end)) return found(true);
      index = literal.end - 1;
      keyExpected = false;
      continue;
    }
    // A comment is not code: the `...` a person writes in one is not a spread.
    if (char === "/" && next === "/") {
      const end = call.indexOf("\n", index);
      if (end === -1) return found(false);
      index = end;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = call.indexOf("*/", index + 2);
      if (end === -1) return found(false);
      index = end + 1;
      continue;
    }
    if (call.startsWith("...", index)) return found(true);
    if (/\s/.test(char)) continue;
    if (char === "{" || char === "(" || char === "[") {
      if (keyExpected && char === "[") return found(true);
      stack.push(char);
      if (char === "{") seen.push(new Set());
      keyExpected = char === "{";
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      if (char === "}") {
        seen.pop();
        if (stack.length === 1) optionsDone = true;
      }
      stack.pop();
      keyExpected = false;
      continue;
    }
    if (char === ",") {
      keyExpected = stack.at(-1) === "{";
      continue;
    }
    // A key of an object literal, never the same name twice in that object.
    const key = keyExpected ? /^[A-Za-z_$][\w$]*/.exec(call.slice(index))?.[0] : undefined;
    if (key !== undefined) {
      if (twice(key, index + key.length)) return found(true);
      index += key.length - 1;
    }
    keyExpected = false;
  }
  return found(false);
}

/** True when a call's options are not what they seem (`CallOptions.hidden`). */
function builtAtRuntime(call: string): boolean {
  return readOptions(call).hidden;
}

/** Where each direct call's `(` sits, in script order: what `readWorkflowScript` reads. */
function callsOf(script: string): number[] {
  return mentionsOf(script, "agent")
    .filter((mention) => mention.call)
    .map((mention) => callOpen(mention, script));
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

/** Said when a call's options are not what they seem: what the guard read can differ. */
const OPTIONS_BUILT_AT_RUNTIME = [
  "Its options are not what they seem: a `...spread`, a computed `[…]` key, or the same option written twice (the last one wins at run time, while the guard reads the first). The model and effort it will really run on cannot be read.",
  "Write `model`, `effort` and `agentType` once each, as string literals in the call's own options object.",
].join("\n");

/**
 * The reason this whole Workflow call is refused, or null when every launch in it can be
 * read. Two things hide the rules from the guard, and a hook must refuse what it cannot see
 * rather than let it run unchecked:
 *   - `agent` or `workflow` mentioned without being called at once (`const run = agent;
 *     run(…)`, `agent?.(…)`, either passed around as a value);
 *   - an `agent(…)` call whose options are not what they seem (`builtAtRuntime`).
 * A nested `workflow(…)` call whose workflow is named at run time is refused by
 * `nestedWorkflows`.
 */
export function workflowRefusal(script: string): null | string {
  for (const name of ["agent", "workflow"] as const) {
    const handed = mentionsOf(script, name).find((mention) => !mention.call);
    if (handed === undefined) continue;
    return [
      `This Workflow uses \`${name}\` without calling it at once (line ${lineOf(script, handed.at)}): a variable holds it, it is optional-called (\`${name}?.(…)\`), or it is passed as a value.`,
      HANDED_AROUND[name],
    ].join("\n");
  }
  for (const mention of mentionsOf(script, "agent")) {
    if (!builtAtRuntime(callText(script, callOpen(mention, script)))) {
      continue;
    }
    return [
      `This Workflow's \`agent(…)\` call at line ${lineOf(script, mention.at)} cannot be read.`,
      OPTIONS_BUILT_AT_RUNTIME,
    ].join("\n");
  }
  return null;
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
  const calls: NestedCall[] = [];
  for (const mention of mentionsOf(script, "workflow")) {
    if (!mention.call) continue;
    const call = callText(script, callOpen(mention, script));
    const line = lineOf(script, mention.at);
    const name = firstArgument(call);
    const path =
      call[skipBlank(call, 1)] === "{" && !builtAtRuntime(call)
        ? stringOption(call, "scriptPath")
        : null;
    if (name !== null) calls.push({ line, name });
    else if (path !== null) calls.push({ line, scriptPath: path });
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

/**
 * Every `agent(...)` call of a Workflow script, in order. A call is found by its name, in code
 * only (the word inside a prompt, a string or a comment is not a call); its text runs to the
 * matching `)`. Nothing is evaluated: only fixed string literals are read.
 */
export function readWorkflowScript(script: string): WorkflowLaunch[] {
  const launches: WorkflowLaunch[] = [];
  for (const open of callsOf(script)) {
    const call = callText(script, open);
    const prompt = firstArgument(call);
    const label = stringOption(call, "label");
    launches.push({
      agentType: stringOption(call, "agentType"),
      effort: stringOption(call, "effort"),
      model: stringOption(call, "model"),
      prompt,
      where: label ?? prompt?.split("\n")[0]?.slice(0, 60) ?? "(unreadable)",
    });
  }
  return launches;
}

/** A Workflow script's launch as an Agent call's launch, for the same rules. */
function asLaunch(one: WorkflowLaunch): Launch {
  return {
    effort: one.effort,
    fork: false,
    // A script's `agent(…)` options carry no `isolation` the guard reads: D59 judges a Workflow
    // by the workflow's own name, not by what one of its launches asks for.
    isolation: null,
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

const NO_WORKFLOW_MODEL = [
  "This Workflow launch names no `model` the guard can read.",
  "An agent given none runs on the session's model and effort, which nobody chose — and a `model` held in a variable is not visible to a hook.",
  "Write `model` and `effort` as string literals in the `agent(...)` options.",
].join("\n");

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
    const deeper = mentionsOf(found.script, "workflow")[0];
    if (deeper !== undefined) {
      return refused(
        `The workflow \`${from}\` this one runs nests a workflow of its own (line ${lineOf(found.script, deeper.at)}): Claude Code runs workflows one level deep, and the guard reads no deeper.`,
      );
    }
    const childRefusal = workflowRefusal(found.script);
    if (childRefusal !== null) {
      return refused(`In the workflow \`${from}\` this one runs: ${childRefusal}`);
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
 * Said in a crew session after the reasons a run cannot be read: the same self-serve fix the
 * `claude -p` line names, without "run it in an interactive session", which a crew session
 * cannot do. `CREW_QUESTION_STEP` follows it.
 */
const UNREADABLE_CREW =
  "The guard cannot see the model and effort its launches run on: pass the script inline (`script`), or by `scriptPath` to a file the guard can read.";

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
      reason: [
        ...call.unreadable,
        ...(inCrew(env) ? [UNREADABLE_CREW, CREW_QUESTION_STEP] : [UNREADABLE_UNATTENDED]),
      ].join("\n"),
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
  "This Agent launch names no `model`.",
  "An agent given none runs on the session's model and effort, which nobody chose: pass `model` and `effort` on every launch.",
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
  "`medium` is for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, and `max` when the task wants it on a Claude `haiku` or `sonnet` (the `opus` tier asks the person at `max`; an affordable backend always runs at `max`).";

const NO_EFFORT = [
  "This Agent launch names no `effort`.",
  `An agent given none runs at the session's effort: pass \`effort\` on every launch, ${EFFORTS}.`,
  EFFORT_USE,
].join("\n");

/** Said when a launch names an effort a subagent never runs at: `low`, or a level no rule knows. */
function effortDenial(effort: string): string {
  return [
    `This launch asks for effort \`${effort}\`, which no subagent may run at (the plugin's rule).`,
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
  if (ran.effortFrom === null) return null;
  return `It runs at effort \`${ran.effort}\` because \`${ran.effortFrom}\` is set: Claude Code ignores the launch's own \`effort\`, and only the person can change the variable, ${WHERE_SET}.`;
}

/**
 * Judges one launch against the owner's rules; pure, so a test can drive every branch. It
 * judges what the launch REALLY runs on (`effectiveLaunch`: Claude Code's FORCE, Workflow and
 * effort overrides, read from `env`), and an ask or a denial names the override that applied.
 */
export function judgeLaunch(launch: Launch, ctx: GuardContext, env: Env): Verdict {
  const ran = effectiveLaunch(
    {
      effort: launch.effort,
      fork: launch.fork,
      model: launch.model,
      workflow: launch.tool === "Workflow",
    },
    env,
    ctx.sessionModel,
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
    if (ran.modelFrom === "call" && ran.model === null) return judged(deny(null, NO_MODEL));
    if (ran.effort === null) return judged(deny(null, NO_EFFORT));
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
  const auto = ran.effortFrom !== null && ran.effort === EFFORT_AUTO;
  if (ran.effort !== null && !auto && !effortAllowed(ran.effort)) {
    return ran.effortFrom === null
      ? judged(deny(real, effortDenial(ran.effort)))
      : { namesEffortLevel: true, verdict: deny(real, effortLevelDenial(ran.effort)) };
  }
  // The affordable slot's own effort, when the variable sets it to another level: only the
  // person can change that.
  if (
    ran.effortFrom !== null &&
    isAffordable(real) &&
    ctx.gatewayOn &&
    ran.effort !== AFFORDABLE_EFFORT
  ) {
    return {
      namesEffortLevel: true,
      verdict: deny(
        real,
        [
          `This launch runs on ${real.model}, an affordable gateway slot.`,
          `An affordable slot runs at effort \`${AFFORDABLE_EFFORT}\` (its reasoning costs cents), and \`${ran.effortFrom}\` runs every subagent at \`${ran.effort}\`: only the person can change the variable — ask them to set it to \`${AFFORDABLE_EFFORT}\`, or to remove it, ${WHERE_SET}.`,
        ].join("\n"),
      ),
    };
  }
  return judged(judgeModel({ ...launch, effort: ran.effort }, real, ctx, env));
}

/** The model rules, on the launch's real model and the effort it really runs at. */
function judgeModel(launch: Launch, real: LaunchModel, ctx: GuardContext, env: Env): Judged {
  const type = launch.subagentType ?? "";
  const readOnly =
    ctx.readOnlyAgents === undefined
      ? agentList(READ_ONLY_AGENTS, env, READ_ONLY_AGENTS_ENV)
      : new Set(ctx.readOnlyAgents.map(agentKey));
  const builder = !readOnly.has(agentKey(type));

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

  // The premium tiers come FIRST, before the affordable rule: `opus` and `fable` are the tier
  // whatever model answers behind them (owner, 2026-10-16), so an override or a family slot that
  // points one at a backend never makes it an affordable slot, never forces `max`, and never
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
        inCrew(env)
          ? [`${why}.`, CREW_QUESTION_STEP].join("\n")
          : [`${why} (\`claude -p\`).`, "Run it in an interactive session."].join("\n"),
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
          inCrew(env)
            ? [
                `${why}.`,
                "Name `opus` (or a Claude Opus id) as its model.",
                CREW_QUESTION_STEP,
              ].join("\n")
            : [`${why} (\`claude -p\`).`, "Name `opus` (or a Claude Opus id) as its model."].join(
                "\n",
              ),
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
        inCrew(env)
          ? [`${nobody}.`, `Run it at ${levelsText(OPUS_FREE_EFFORTS)}.`, CREW_QUESTION_STEP].join(
              "\n",
            )
          : [
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

  // Both tiers answered above, so what is left is Claude Sonnet or Haiku, or an affordable model.
  if (isAffordable(real)) {
    if (ctx.gatewayOn && launch.effort?.toLowerCase() !== AFFORDABLE_EFFORT) {
      return deny(
        real,
        [
          `This launch runs on ${real.model}, an affordable gateway slot.`,
          `An affordable slot runs at effort \`${AFFORDABLE_EFFORT}\` (its reasoning costs cents): pass \`effort: "${AFFORDABLE_EFFORT}"\`.`,
        ].join("\n"),
      );
    }
    return allow(real, "");
  }

  // Sonnet or Haiku: free of the model rules.
  return allow(real, "");
}

/**
 * True when this session has nobody to answer a question: `claude -p`, or a crew session (a
 * `--bg` session its lead started, with nobody watching it). A crew session is judged exactly
 * like `claude -p` — every ask becomes a refusal — but its words name the step that reaches its
 * lead (`CREW_QUESTION_STEP`) rather than "run it in an interactive session".
 */
function nobodyWatches(env: Env): boolean {
  return inCrew(env) || !isAttended(env);
}

/** True when the session is a crew session: nobody watches it, and its step is `crew report`. */
function inCrew(env: Env): boolean {
  return crewIdOf(env) !== null;
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

/**
 * True when Claude Code's settings send its requests to the router (`ANTHROPIC_BASE_URL` set
 * to something other than Anthropic's own address — `gateway off` leaves that address in the
 * file, GP5); false when they do not, or cannot be read.
 */
export function gatewayOnOf(paths: CliPaths): boolean {
  try {
    return baseUrlPointsAtGateway(settingsReport(paths.settingsFile).baseUrl);
  } catch {
    // Settings that cannot be read send nothing anywhere the guard can prove: off.
    return false;
  }
}

/**
 * The gateway as the machine's own files see it: its config, and whether the user's settings
 * point at the router. A command outside a session (`crew start`, the usage guard) reads this;
 * a hook reads the session's own gateway instead (`sessionGatewayOf`).
 */
export function gatewayFactsOf(paths: CliPaths): GatewayFacts {
  return { config: gatewayConfigOf(paths), gatewayOn: gatewayOnOf(paths) };
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

/** What the guard reads for `judgeLaunch`: the session's own gateway and model; never throws. */
export function readGuardContext(paths: CliPaths, input: HookInput, env: Env): GuardContext {
  const { config, gatewayOn } = sessionGatewayOf(paths, env);
  return {
    config,
    gatewayOn,
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

/**
 * The guard's judgment of one call, with no record written: the one place `agentGuard` and the
 * crew part (`crewAgentAnswer`) both judge from, so a spelling that gets past one gets past both.
 */
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

/** How a refusal names the call it holds: `this launch (\`general-purpose\`)`, `this Workflow`. */
function queueSubject(judged: Judgement, input: HookInput): string {
  if (judged.kind === "launch") {
    return `this launch (\`${judged.launch.subagentType ?? "general-purpose"}\`)`;
  }
  const name = stringField(toolInput(input).name);
  return name === null ? "this Workflow" : `this Workflow (\`${name}\`)`;
}

/**
 * The refusal a lead gets for a building launch while its crew queue is full (D59): the cap
 * that holds, in `placeFor`'s own words, and the `crew start` step that queues and starts by
 * itself. The last line names what the rule never holds, so the lead does not stop using
 * read-only subagents.
 */
function queueRefusal(what: string, why: string): string {
  return [
    `A lead never routes a building phase around its crew queue: ${what} may build, and a \`crew start\` from this lead would queue now — ${why}.`,
    `Fix: ${COMMAND} crew start <phase> --slug <slug> --kind <kind> --brief <file>: it queues and starts by itself.`,
    `Read-only launches are never held: the built-in ${levelsText(READ_ONLY_BUILT_INS)}, the kit's own \`${PLUGIN}:<name>\` agents for ${READ_ONLY_KIT_AGENTS.join(", ")}, and the kit's two read-only Workflows called by those ids with nothing else.`,
  ].join("\n");
}

/**
 * D59's refusal for one call, or null when it may go on as judged. It is the lead's rule only:
 * a crew session (`crewAgentAnswer`'s), an ordinary session, and a launch that only reads are
 * each null. A Workflow is building unless it names one of the kit's own read-only ones, and it
 * counts as opus-tier when any of its launches does.
 *
 * It reads the lead record, then asks `placeForLeadStart` — the decision `crew start` makes.
 * Everything it cannot work out is null: no checkout (the frame had none), a session id that
 * cannot own a lead record, a record, store or project file that throws. A guard that cannot
 * work out the queue lets the call through; the launch it is judging is never blocked for it.
 */
async function queuedLaunch(
  judged: Judgement,
  input: HookInput,
  env: Env,
  paths: CliPaths,
  checkout: null | Checkout,
  nowMs: number,
  memory: MemoryFacts,
): Promise<null | string> {
  // A crew session has its own refusals (`crewAgentAnswer`), and it never leads.
  if (inCrew(env)) return null;
  if (checkout === null) return null;
  // A launch that only reads is never held, and this check is free: the store is read only for a
  // launch that can change files in a lead's session.
  const building =
    judged.kind === "workflow" ? buildsWorkflow(toolInput(input)) : buildsFiles(judged.launch);
  if (!building) return null;
  const sessionId = input.session_id;
  if (!isSessionId(sessionId)) return null;
  try {
    const repo = checkout.mainCheckout ?? checkout.root;
    if (readLead(paths.stateDir, repo, sessionId) === null) return null;
  } catch {
    // A store the guard cannot read is no lead to hold: the launch goes on.
    return null;
  }
  const opus =
    judged.kind === "workflow"
      ? judged.call.results.some((one) => one.verdict.real?.tier === OPUS_TIER)
      : judged.verdict.real?.tier === OPUS_TIER;
  let place: null | Place;
  try {
    place = await placeForLeadStart({
      checkout,
      leadSessionId: sessionId,
      memory,
      nowMs,
      opus,
      paths,
    });
  } catch {
    return null;
  }
  if (place === null || place.start) return null;
  return queueRefusal(queueSubject(judged, input), place.why);
}

/**
 * The hook's answer: judge the launch (or every launch a Workflow script makes), record an
 * Opus or Fable one once it is known to run, and answer with the PreToolUse decision.
 *
 * **A recorded lead's building launch waits for the crew queue** (D59): after the model and
 * effort rules — which keep their own words when they deny — a launch that can change files is
 * refused while a `crew start` from this lead would queue, with the cap and the step
 * (`queuedLaunch`). A refused launch never runs, so nothing is recorded for it.
 *
 * The record: on PreToolUse, a call the guard allows outright (it runs with no question); on
 * PostToolUse (`RAN_EVENT`), a call the guard asked about (it ran, so the person said yes). So
 * a launch the person refuses is never recorded, and none is recorded twice. A Workflow is one
 * call: when any of its launches asks, the person may refuse them all, so all wait for the run.
 * Each of a Workflow's launches is recorded under its own index, as its own line.
 *
 * A Workflow run is judged however it names its script — inline, `scriptPath`, a saved or a
 * plugin's `name` — with the workflows it nests (`judgeWorkflowCall`). One the guard cannot read
 * (a built-in, a missing file, a resume) asks, and is refused in `claude -p` (and in a crew
 * session). Anything else it cannot work out lets the call through.
 *
 * `checkout` is the project the frame found for the call's `cwd` (`HookContext.project`); the
 * queue rule needs it to find this repository's lead record. The paths the frame calls without
 * one (a broken project file, a folder outside git) judge the model and effort alone, and let
 * the launch through: a guard that cannot work out the queue never blocks.
 */
export async function agentGuard(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  cwd: string,
  nowMs: number = Date.now(),
  checkout: null | Checkout = null,
  memory: MemoryFacts = realMemoryFacts(),
): Promise<HookResult> {
  const judged = judgeCall(input, env, paths, cwd);
  if (judged === null) return SILENT;
  const ran = afterTheCall(input);
  // The model and effort rules answer first: a launch they deny keeps their own words, and the
  // queue rule is asked only about a launch that would otherwise run (allowed or asked).
  const judgedDeny =
    judged.kind === "workflow" ? judged.decision === "deny" : judged.verdict.decision === "deny";
  if (!ran && !judgedDeny) {
    const queued = await queuedLaunch(judged, input, env, paths, checkout, nowMs, memory);
    if (queued !== null) return toolDecision("deny", queued);
  }
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

/**
 * The guard's crew part (D36): a crew session is a background session nobody watches, so every
 * launch the guard would ask the person about is refused, with the step that reaches its lead —
 * whatever the project's `ownHooks` says, since a project could otherwise switch the guard off
 * (`.claude/rules/hooks-guards.md` § A crew session's own limits). It is a **judgment only**: nothing
 * is recorded, because the run records a launch that runs and this part only ever refuses; the
 * launch it refuses never runs, so it is recorded nowhere, exactly as for `claude -p`.
 *
 * **Only the former questions.** A launch the guard denies for a person (no model or effort, a
 * low effort, the UI rule) stays the project's own policy: a project whose `ownHooks` lists
 * `agent-guard` runs its own copy, and this part must not answer for it. So the part denies
 * exactly the answers that name `CREW_QUESTION_STEP` — the four rules that ask a person.
 *
 * Not a crew session, a call outside the guard's tools, or a call it allows: silence.
 */
export function crewAgentAnswer(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  cwd: string,
): HookResult {
  if (!inCrew(env) || afterTheCall(input)) return SILENT;
  const judged = judgeCall(input, env, paths, cwd);
  if (judged === null) return SILENT;
  const decision = judged.kind === "workflow" ? judged.decision : judged.verdict.decision;
  const reason = judged.kind === "workflow" ? judged.reason : judged.verdict.reason;
  return decision === "deny" && reason.includes(CREW_QUESTION_STEP)
    ? toolDecision("deny", reason)
    : SILENT;
}
