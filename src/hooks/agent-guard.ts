/**
 * The `agent-guard` hook: PreToolUse on the Agent tool (and the older name `Task`), and on the
 * `Workflow` tool, whose script's `agent(...)` launches are read and judged (`WorkflowLaunch`).
 *
 * **Machine-wide.** It runs with or without `.claude/cc-smart-dev-kit.json` (like `update-check`), and
 * its answer never depends on the project's file: it is about the model a launch runs on. A
 * project that runs its own Agent guard lists `"agent-guard"` in `ownHooks` and this one stays
 * silent there. It is wired with `--missing=ask`: a guard fails closed.
 *
 * **Why.** An Agent call with no `model` runs on whatever model the session has; an Opus or
 * Fable launch spends the person's own plan usage; a subagent at `low` or `medium` does work
 * nobody chose to cheapen; and an affordable gateway slot works well only at effort `max`.
 * The owner's decisions (2026-10-16):
 *
 * **Effort.** A subagent never runs at `low` or `medium` (the owner, 2026-10-16), whatever the
 * model: the guard refuses a launch whose `effort` is not `high`, `xhigh` or `max`. That list
 * lives once, in `ALLOWED_EFFORTS`, and the guard, its messages and the tests all read it. On
 * top of it, an affordable slot must be `max`, and an `opus`-tier launch asks the person at
 * `OPUS_ASK_EFFORT` (`max`).
 *
 * **The `opus` tier** (the owner's decision D11, 2026-10-17): any launch on it — a review or
 * not, any agent type, any purpose — runs with no question at every allowed level below `max`,
 * and asks the person at `max`. No reason line is needed; an `Opus reason: <word>` line, when a
 * prompt carries one, only names the purpose in the record.
 *
 * | The model behind the launch | The verdict |
 * |---|---|
 * | an affordable slot key / a `<backend>:<model>` target / `haiku` or `sonnet` (or their ids) while the gateway is on and the family's slot chain starts with a backend | allow; with the gateway on, its effort must be `max`, else deny |
 * | any other name (`best`, `opusplan`, `default`, `inherit`, a name no rule knows) | the `opus` tier below (the strictest reading): only what the guard can prove affordable is affordable |
 * | Claude Sonnet or Haiku (the gateway off, the family's slot off, or its chain starting with a `claude-…` model) | allow (the effort rule above still holds) |
 * | the `opus` tier | effort `high` or `xhigh`: allow, for any agent and any purpose; effort `max`: **ask** (the person approves each one, and sees the model and the effort); a fork names no effort: it runs at the session's own, which the person chose, so it is allowed |
 * | the `fable` tier | a read-only agent type with a prompt line `Fable reason: <one of FABLE_REASONS> - <why>`, and a person to answer: **ask** (the word `build` is not one of them: a read-only agent never builds); an agent that can change files (any other type, a fork included) with `Fable reason: build - <why>`: **ask** (the person asked for it); no line, a builder without the word `build`, or an unattended session (`claude -p`): deny |
 * | no `model` / no `effort` | deny (a launch that names neither would inherit the session's, which nobody chose) — except a `fork`, which always inherits both |
 * | a session nobody watches (`claude -p`) | every premium launch that would ask is denied (there is nobody to approve it): the `opus` tier at `max` says to run it at `high` or `xhigh`, or in an interactive session; the `opus` tier below `max` stays allowed |
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
 * It is resolved the way Claude Code and the router resolve it:
 *   1. `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` (all four exist in Claude Code 2.1.301, fable
 *      included), when the person set one, replaces the family's model;
 *   2. with the gateway on (`ANTHROPIC_BASE_URL` in Claude Code's settings), the router sends a
 *      Claude model to its FAMILY's slot (`FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus
 *      → opus, fable → fable) while that slot has a chain, and the chain's first target answers
 *      (`gateway.json`, read through the gateway's own `loadConfigFile`). A slot with no chain
 *      is off: the Claude model itself answers, on the person's own login.
 * So `sonnet` is an affordable slot exactly when the gateway is on and the worker's chain
 * starts with a `<backend>:<model>`; a chain that starts with a `claude-…` model is Claude. A
 * `fork` runs on the session's model and effort — Claude Code ignores a `model` it is given —
 * so it is judged on the session's own: the last Claude model in the hook input's
 * `transcript_path` (`lastClaudeModel`), else `ANTHROPIC_MODEL`; unknowable → the `opus` tier.
 *
 * Every premium launch that is allowed or asked is recorded with why it ran
 * (`agent-launches.ts`), and `cc-smart-dev-kit usage` lists them: the `opus` tier as
 * `opus:<effort>`, with the prompt's reason word after it when there is one (`opus:xhigh`,
 * `opus:max:security`; a fork `opus:session-effort`), and the `fable` tier by its word. Anything
 * the guard cannot work out lets the call through, except a Workflow whose launches it cannot
 * read (`workflowRefusal`).
 */

import type { CliPaths } from "../cli/paths";
import { type GatewayConfig, loadConfigFile } from "../gateway/config";
import { settingsReport } from "../gateway/settings";
import {
  CLAUDE_FAMILIES,
  type ClaudeFamily,
  claudeFamily,
  familySlotKey,
  isSlotKey,
  MODEL_SLOTS,
  parseTarget,
  withoutContextSuffix,
} from "../gateway/targets";
import { type AgentLaunch, agentLaunchesFile, appendAgentLaunch } from "./agent-launches";
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

/** The tools this guard reads: the Agent tool, the older name, and Workflow. */
export const AGENT_TOOLS = ["Agent", "Task"] as const;
export const WORKFLOW_TOOLS = ["Workflow"] as const;

/** The subagent type a fork uses: it runs on the session's model and effort. */
export const FORK = "fork";

/**
 * The one reason word an agent that can change files may use on Fable: the person asked Fable
 * to build it (the owner, 2026-10-16). Every other word, and no word, is refused there — and it
 * is not one of the read-only words (`FABLE_REASONS`): a read-only agent never builds.
 */
export const FABLE_BUILD_REASON = "build";

/** The words a builder may name: the one word that means the person asked for it. */
const BUILDER_WORDS = [FABLE_BUILD_REASON] as const;

/** What `Fable reason:` may name (the owner's list). */
export const FABLE_REASONS = [
  "hard",
  "rewrite",
  "ui-design",
  "architecture",
  "review",
  "plan",
  "unsatisfied",
] as const;

/**
 * The subagent types that count as read-only on Fable: they read and report, never build, so
 * any word of `FABLE_REASONS` is enough. Every other type — a fork included — can change
 * files and needs the one word `build` (`FABLE_BUILD_REASON`).
 */
export const READ_ONLY_AGENTS = ["Plan", "Reviewer", "Explore", "Code Explorer"] as const;

/** The environment variable a person may extend that list with (comma-separated). */
export const READ_ONLY_AGENTS_ENV = "CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS";

/**
 * The effort levels a subagent may run at — the one home of that list (owner, 2026-10-16):
 * `low` and `medium` are refused on every model, a Claude model and an affordable gateway slot
 * alike. Two rules name one level each, on top of this one: an affordable slot must be `max`,
 * and an `opus`-tier launch asks the person at `OPUS_ASK_EFFORT`.
 */
export const ALLOWED_EFFORTS = ["high", "xhigh", "max"] as const;

/**
 * The one effort at which an `opus`-tier launch asks the person (the owner's decision D11):
 * every lower level of `ALLOWED_EFFORTS` runs with no question, for any agent and any purpose.
 */
export const OPUS_ASK_EFFORT = "max";

/** The levels an `opus`-tier launch runs at with no question: every allowed one below `max`. */
const OPUS_FREE_EFFORTS = ALLOWED_EFFORTS.filter((one) => one !== OPUS_ASK_EFFORT);

/** True when an effort a launch names is one a subagent may run at. */
function effortAllowed(effort: string): boolean {
  return (ALLOWED_EFFORTS as readonly string[]).includes(effort.toLowerCase());
}

/** A subagent type as a list compares it: after any `plugin:`, `-`/`_`/space as one `-`. */
export function agentKey(type: string): string {
  const base = type.includes(":") ? (type.split(":").pop() ?? type) : type;
  return base
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

function agentList(from: readonly string[], env: Env, name: string): Set<string> {
  const listed = (env[name] ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");
  return new Set([...from, ...listed].map(agentKey));
}

/** The model a launch will really run on, after Claude Code's env and the gateway config. */
export interface LaunchModel {
  /** True when the first target that answers is a Claude model (the person's own login). */
  claude: boolean;
  /** The family the launch's name stands for: a family name and a Claude id keep their own
   * through an override or their family's slot, a slot key reads its first target's, and null
   * is anything the guard cannot read as a family (a backend target, a name no rule knows). */
  family: ClaudeFamily | null;
  /** How the launch names it: the resolved id, the slot's first target, or the name as sent. */
  model: string;
  /**
   * The premium tier the launch's NAME stands for (owner, 2026-10-16): `opus` and `fable` mean
   * the tier, whatever model answers behind them — Claude, a backend through the gateway, a
   * name no rule knows. Null for everything else (Haiku, Sonnet, an affordable target).
   */
  tier: "fable" | "opus" | null;
}

/**
 * What the guard knows of the gateway: its config (null when there is none, or it cannot be
 * used), and whether Claude Code's settings send the requests to it.
 */
export interface GatewayFacts {
  config: GatewayConfig | null;
  /** True when Claude Code's settings point at the router (`ANTHROPIC_BASE_URL`). */
  gatewayOn: boolean;
}

/** The premium tier a family name or a Claude id stands for; null for Haiku and Sonnet. */
function premiumTier(family: ClaudeFamily | null): "fable" | "opus" | null {
  return family === "fable" || family === "opus" ? family : null;
}

/**
 * The tier a Claude reading carries: its family when that is `opus` or `fable`, null for Haiku
 * and Sonnet, and for a family the guard cannot read — a Claude id from the future, a name no
 * rule knows (`best`, `default`, …) — the strict one, `opus`, exactly as the rules treated it
 * before there were tiers.
 */
function tierOfReading(family: ClaudeFamily | null): "fable" | "opus" | null {
  return family === null ? "opus" : premiumTier(family);
}

/** Claude Code's override for a family: `ANTHROPIC_DEFAULT_OPUS_MODEL`, … */
export function familyEnv(family: ClaudeFamily): string {
  return `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`;
}

/**
 * The first target of the slot that answers for a Claude family, the way the router picks it
 * (`familySlotKey`, `FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus → opus, fable →
 * fable). Null when the gateway is off (Claude Code sends nothing to the router), when there
 * is no config, and when the slot has no chain: it is off, and the Claude model itself answers.
 */
function familyFirstTarget(gateway: GatewayFacts, family: ClaudeFamily | null): null | string {
  if (!gateway.gatewayOn || gateway.config === null || family === null) return null;
  const slot = familySlotKey(family);
  if (slot === null || !Object.hasOwn(gateway.config.slots, slot)) return null;
  return gateway.config.slots[slot]?.[0] ?? null;
}

/**
 * The tier an id stands for when a person's own override or a premium family's slot answers
 * with it: the session's model may be the backend id an `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` or
 * the opus or fable slot's first target names, and that id is still the family's tier (owner,
 * 2026-10-16).
 */
export function tierOfMappedId(
  model: string,
  gateway: GatewayFacts,
  env: Env,
): "fable" | "opus" | null {
  for (const premium of ["fable", "opus"] as const) {
    const override = stringField(env[familyEnv(premium)]);
    if (override !== null && withoutContextSuffix(override.trim()) === model) return premium;
    if (familyFirstTarget(gateway, premium) === model) return premium;
  }
  return null;
}

/**
 * The model behind a Claude family once the router has had it: its slot's first target while
 * the gateway is on and the slot has a chain, else `claude` (the Claude model answers). The
 * family and the tier stay the ones the NAME stands for (owner, 2026-10-16).
 */
function throughFamilySlot(
  claude: string,
  family: ClaudeFamily | null,
  gateway: GatewayFacts,
): LaunchModel {
  const tier = tierOfReading(family);
  const first = familyFirstTarget(gateway, family);
  if (first === null) return { claude: true, family, model: claude, tier };
  return { ...resolveTarget(first), family, tier };
}

/** A Claude id, slot key or `<backend>:<model>` as the model behind the launch. */
function resolveName(text: string, gateway: GatewayFacts): LaunchModel {
  if (text.startsWith("claude-")) return throughFamilySlot(text, claudeFamily(text), gateway);
  if (isSlotKey(text)) {
    const first = gateway.config?.slots[text]?.[0];
    const model =
      first === undefined
        ? { claude: false, family: null, model: text, tier: null }
        : resolveTarget(first);
    // A model slot (`cc-smart-dev-kit-opus`, `cc-smart-dev-kit-fable`) is its family's tier,
    // whether or not the config names a target for it.
    const slotFamily = MODEL_SLOTS[text];
    return slotFamily === "fable" || slotFamily === "opus"
      ? { ...model, family: slotFamily, tier: slotFamily }
      : model;
  }
  const parsed = parseTarget(text);
  if ("target" in parsed && parsed.target.kind === "backend") {
    return { claude: false, family: null, model: text, tier: null };
  }
  // A name no rule knows (`best`, `opusplan`, `default`, `inherit`, anything else): never read
  // as an affordable slot. Only a slot key and a `<backend>:<model>` target are affordable —
  // every other name gets the strictest rule, the one for a Claude id with no family to read.
  return { claude: true, family: null, model: text, tier: "opus" };
}

/** A slot target as the model behind the launch. */
function resolveTarget(text: string): LaunchModel {
  const parsed = parseTarget(text);
  if (!("target" in parsed) || parsed.target.kind !== "anthropic") {
    return { claude: false, family: null, model: text, tier: null };
  }
  const family = claudeFamily(parsed.target.model);
  return { claude: true, family, model: parsed.target.model, tier: tierOfReading(family) };
}

/**
 * The model behind a launch that names `name`: a family name goes through Claude Code's
 * environment, then — with the gateway on — its family's slot; a Claude id through its family's
 * slot; anything else is resolved as itself. **A family name keeps its tier** through the
 * override and the slot: `opus` is the premium tier even when the target that answers it is not
 * a Claude model.
 */
export function resolveLaunchModel(name: string, gateway: GatewayFacts, env: Env): LaunchModel {
  const text = withoutContextSuffix(name.trim());
  const family = CLAUDE_FAMILIES.find((one) => one === text.toLowerCase());
  if (family === undefined) {
    // A person's own override may name this id for a family: it is that family's tier then.
    const mapped = tierOfMappedId(text, gateway, env);
    const resolved = resolveName(text, gateway);
    return mapped === null || resolved.tier !== null ? resolved : { ...resolved, tier: mapped };
  }
  const tier = premiumTier(family);
  const override = stringField(env[familyEnv(family)]);
  if (override !== null) {
    // The NAME's family stays the launch's family: `opus` is the `opus` tier even when a backend
    // answers it, so the record, the review shortcut and the messages read the same family.
    return { ...resolveName(withoutContextSuffix(override.trim()), gateway), family, tier };
  }
  return throughFamilySlot(text, family, gateway);
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
  /** The session's own model, for a fork; null when it cannot be read. */
  sessionModel: null | string;
  /** The subagent types a Fable launch may use; the plugin's list by default. */
  readOnlyAgents?: readonly string[];
}

/**
 * One `agent(...)` call of a Workflow script, as much of it as its text shows. A workflow
 * runs its agents **inside itself**: live on 2.1.301 the `Workflow` tool call fires
 * PreToolUse (tool_name `Workflow`, its `script` in the input) and the launches inside the
 * script fire **nothing** — no `Agent` call passes the hooks. So the guard reads the script
 * (`readWorkflowScript`) and judges each launch it can see.
 *
 * What it cannot see is refused, never guessed:
 *   - a value held in a variable (`model: chosen`), a prompt built at run time, and a
 *     backtick literal that builds its text (`` `${…}` ``) leave that launch's verdict short
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

/** A string literal's value at `from`, and the index after it; null when it is not one. */
function stringAt(text: string, from: number): null | { end: number; value: string } {
  const quote = text[from];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let value = "";
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\") {
      // A literal escape with a value (`\n`, `\"`) is read as the character it names.
      const next = text[index + 1] ?? "";
      value += next === "n" ? "\n" : next;
      index += 1;
      continue;
    }
    if (char === quote) return { end: index + 1, value };
    value += char;
  }
  return null;
}

/**
 * True when the literal at `[from, end)` builds its text at run time: a template with an
 * unescaped `${…}`. Its value is not the text between the backticks, so nothing is read from
 * it — `model: \`op${n}us\`` names no model the guard can prove.
 */
function interpolated(text: string, from: number, end: number): boolean {
  for (let index = from + 1; index < end - 1; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "$" && text[index + 1] === "{") return true;
  }
  return false;
}

/** A **fixed** string literal's value at `from`; null when it is not one, or is built at run time. */
function literalAt(text: string, from: number): null | { end: number; value: string } {
  const literal = stringAt(text, from);
  if (literal === null) return null;
  return text[from] === "`" && interpolated(text, from, literal.end) ? null : literal;
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

/** The first argument of a call, when it is a fixed string literal; null otherwise. */
function firstArgument(call: string): null | string {
  const args = call.slice(1);
  const lead = args.length - args.trimStart().length;
  const literal = literalAt(call, 1 + lead);
  return literal === null ? null : literal.value;
}

/** A fixed string option of a call (`model: "opus"`), or null when absent or not a literal. */
function stringOption(call: string, name: string): null | string {
  const found = new RegExp(`(^|[{,\\s])${name}\\s*:\\s*`).exec(call);
  if (found === null) return null;
  const at = found.index + found[0].length;
  const literal = literalAt(call, at);
  return literal === null ? null : literal.value;
}

/** One way a script mentions the `agent` function: its name in code, and whether it is called. */
interface AgentMention {
  /** Where the name starts in the script. */
  at: number;
  /** True for a direct call (`agent(…)`); false when `agent` is handed around as a value. */
  call: boolean;
}

/** The position of the `(` of a direct call whose name starts at `at`. */
function callOpen(at: number, script: string): number {
  const rest = script.slice(at + 5);
  return at + 5 + (rest.length - rest.trimStart().length);
}

/**
 * Every mention of `agent` in the script's code, and whether it is a direct call. In code
 * only: the word inside a prompt, a string or a comment is not a mention, and neither is a
 * property (`x.agent`) or a longer name (`agentType`, `agents`). A template literal's
 * `${…}` is code again — a launch written there is a launch — so the scan keeps a stack of
 * the contexts it is inside.
 */
function agentMentions(script: string): AgentMention[] {
  type Frame = {
    braces: number;
    kind: "block" | "code" | "double" | "line" | "single" | "template";
  };
  const mentions: AgentMention[] = [];
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
      script.startsWith("agent", index) &&
      (index === 0 || /[^\w.$]/.test(script[index - 1] ?? ""))
    ) {
      // `agentType`, `agents`: a longer name, not a mention of `agent`.
      if (/[\w$]/.test(script[index + 5] ?? "")) continue;
      mentions.push({ at: index, call: /^\s*\(/.test(script.slice(index + 5)) });
    }
  }
  return mentions;
}

/** The line of the script an index sits on, counting from 1: what a message names. */
function lineOf(script: string, index: number): number {
  return script.slice(0, index).split("\n").length;
}

/**
 * True when a call's options are not what they seem: a `...spread` (which can replace any
 * option), a computed key (`[…]`) where an object's key belongs, or the same key twice at one
 * level (JavaScript keeps the last, the guard reads the first). Any of them can change `model`
 * or `effort` after the literal the guard would have read.
 */
function builtAtRuntime(call: string): boolean {
  const stack: string[] = [];
  /** The keys seen so far, one set per open object literal. */
  const keys: Array<Set<string>> = [];
  let keyExpected = false;
  for (let index = 1; index < call.length; index += 1) {
    const char = call[index] ?? "";
    const next = call[index + 1] ?? "";
    if (char === '"' || char === "'" || char === "`") {
      const literal = stringAt(call, index);
      if (literal === null) return false;
      index = literal.end - 1;
      continue;
    }
    // A comment is not code: the `...` a person writes in one is not a spread.
    if (char === "/" && next === "/") {
      const end = call.indexOf("\n", index);
      if (end === -1) return false;
      index = end;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = call.indexOf("*/", index + 2);
      if (end === -1) return false;
      index = end + 1;
      continue;
    }
    if (call.startsWith("...", index)) return true;
    if (/\s/.test(char)) continue;
    if (char === "{" || char === "(" || char === "[") {
      if (keyExpected && char === "[") return true;
      stack.push(char);
      if (char === "{") keys.push(new Set());
      keyExpected = char === "{";
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      if (char === "}") keys.pop();
      stack.pop();
      keyExpected = false;
      continue;
    }
    if (char === ",") {
      keyExpected = stack.at(-1) === "{";
      continue;
    }
    // A key of an object literal: an identifier one (`"model": …` cannot be read as an option
    // anyway), and never the same name twice in that object.
    const key = keyExpected ? /^[A-Za-z_$][\w$]*/.exec(call.slice(index))?.[0] : undefined;
    if (key !== undefined) {
      const open = keys.at(-1);
      if (open !== undefined) {
        if (open.has(key)) return true;
        open.add(key);
      }
      index += key.length - 1;
    }
    keyExpected = false;
  }
  return false;
}

/** Where each direct call's `(` sits, in script order: what `readWorkflowScript` reads. */
function callsOf(script: string): number[] {
  return agentMentions(script)
    .filter((mention) => mention.call)
    .map((mention) => callOpen(mention.at, script));
}

/** Said when the script hands `agent` around: nothing it launches can be read. */
const AGENT_HANDED_AROUND = [
  "A launch made through a variable runs inside the tool and never reaches a hook, so the guard cannot read the model and effort it will run on.",
  'Write every launch as a direct `agent("<prompt>", { model: "…", effort: "…" })` call.',
].join("\n");

/** Said when a call's options are not what they seem: what the guard read can differ. */
const OPTIONS_BUILT_AT_RUNTIME = [
  "Its options are not what they seem: a `...spread`, a computed `[…]` key, or the same option written twice (the last one wins at run time, while the guard reads the first). The model and effort it will really run on cannot be read.",
  "Write `model`, `effort` and `agentType` once each, as string literals in the call's own options object.",
].join("\n");

/**
 * The reason this whole Workflow call is refused, or null when every launch in it can be
 * read. Two things hide the rules from the guard, and a hook must refuse what it cannot see
 * rather than let it run unchecked:
 *   - `agent` mentioned without being called at once (`const run = agent; run(…)`,
 *     `agent?.(…)`, `agent` passed around as a value);
 *   - a call whose options are not what they seem (`builtAtRuntime`).
 */
export function workflowRefusal(script: string): null | string {
  const mentions = agentMentions(script);
  const handed = mentions.find((mention) => !mention.call);
  if (handed !== undefined) {
    return [
      `This Workflow uses \`agent\` without calling it at once (line ${lineOf(script, handed.at)}): a variable holds it, it is optional-called (\`agent?.(…)\`), or it is passed as a value.`,
      AGENT_HANDED_AROUND,
    ].join("\n");
  }
  for (const mention of mentions) {
    if (!builtAtRuntime(callText(script, callOpen(mention.at, script)))) {
      continue;
    }
    return [
      `This Workflow's \`agent(…)\` call at line ${lineOf(script, mention.at)} cannot be read.`,
      OPTIONS_BUILT_AT_RUNTIME,
    ].join("\n");
  }
  return null;
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
    model: one.model,
    prompt: one.prompt ?? "",
    subagentType: one.agentType,
    tool: "Workflow",
  };
}

/** One launch of a Workflow script, judged. */
export interface WorkflowResult {
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

/** Judges every launch of a Workflow script, in order. */
export function judgeWorkflow(script: string, ctx: GuardContext, env: Env): WorkflowResult[] {
  return readWorkflowScript(script).map((launch) => {
    const verdict = judgeLaunch(asLaunch(launch), ctx, env);
    // A model the script builds at run time cannot be read by a hook: refused, never guessed.
    if (launch.model === null) {
      return { launch, verdict: deny(verdict.real, NO_WORKFLOW_MODEL) };
    }
    // An ask that rests on the launch's own prompt — a reason line — cannot stand with a prompt
    // the guard cannot read: there is nothing to approve, so it is refused instead. An ask that
    // rests on the effort (the `opus` tier at `max`) needs no prompt and stays an ask.
    if (launch.prompt === null && (verdict.decision === "deny" || verdict.restsOnPrompt === true)) {
      return {
        launch,
        verdict: {
          ...verdict,
          decision: "deny" as const,
          reason: `${verdict.reason}\n${PROMPT_UNREADABLE}`,
        },
      };
    }
    return { launch, verdict };
  });
}

/** The Workflow answer's words: which launch it is about, and the rule. */
export function workflowReason(result: WorkflowResult): string {
  const named =
    result.launch.where === "(unreadable)" ? "one launch" : `the launch "${result.launch.where}"`;
  return `In this workflow, ${named}: ${result.verdict.reason}`;
}

/** The guard's answer: what to do, in words for the person or Claude, and what it read. */
export interface Verdict {
  decision: "allow" | "ask" | "deny";
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

function allow(real: LaunchModel | null, why = ""): Verdict {
  return { decision: "allow", real, reason: "", why };
}

function deny(real: LaunchModel | null, reason: string, why = ""): Verdict {
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

/** The first word of a reason line, lower case; null when it names a word not in `allowed`. */
function reasonWord(text: null | string, allowed: readonly string[]): null | string {
  const word = text?.split(/\s+/)[0]?.toLowerCase() ?? "";
  return allowed.includes(word) ? word : null;
}

/** The longest reason word the record keeps: a reason line is free text. */
const REASON_WORD_MAX = 40;

/**
 * The first word of an `Opus reason:` line, lower case and without the punctuation around it
 * (`security.` and `` `security` `` both read `security`); null when the line has no word.
 * Nothing decides on it: it only names the purpose in the record.
 */
function firstWord(text: null | string): null | string {
  const found = /^[^a-z0-9]*([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(text?.toLowerCase() ?? "");
  return found?.[1]?.slice(0, REASON_WORD_MAX) ?? null;
}

const NO_MODEL = [
  "This Agent launch names no `model`.",
  "An agent given none runs on the session's model and effort, which nobody chose: pass `model` and `effort` on every launch.",
].join("\n");

/** The levels of `ALLOWED_EFFORTS` as the guard's messages name them: `` `high`, `xhigh`, `max` ``. */
const EFFORTS = ALLOWED_EFFORTS.map((one) => `\`${one}\``).join(", ");

/** Levels as the guard's messages name them: `` `high` or `xhigh` ``. */
function levelsText(levels: readonly string[]): string {
  const named = levels.map((one) => `\`${one}\``);
  return named.length < 2 ? named.join("") : `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`;
}

const NO_EFFORT = [
  "This Agent launch names no `effort`.",
  `An agent given none runs at the session's effort: pass \`effort\` on every launch — ${EFFORTS} only, never \`low\` or \`medium\` (\`max\` for the hardest problem, always on an affordable gateway slot).`,
].join("\n");

/** Said when a launch names an effort a subagent never runs at: `low`, `medium`, or a level no rule knows. */
function effortDenial(effort: string): string {
  return [
    `This launch asks for effort \`${effort}\`, which no subagent may run at (the owner's rule, 2026-10-16).`,
    `A subagent runs at ${EFFORTS} only — \`low\` and \`medium\` are refused on every model, a Claude model and an affordable gateway slot alike.`,
    "`high` is for searches, reads and routine building, `xhigh` for review and real judgment, and `max` for the hardest problem only (always on an affordable gateway slot).",
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
  const level = effort ?? "session-effort";
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
    "Fable advises; it builds only when the person asks. Use a read-only agent type (Plan, Reviewer, Explore, Code Explorer) and put a line in the prompt saying why:",
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

/** Judges one launch against the owner's rules; pure, so a test can drive every branch. */
export function judgeLaunch(launch: Launch, ctx: GuardContext, env: Env): Verdict {
  const named = launch.model;
  if (!launch.fork) {
    if (named === null) return deny(null, NO_MODEL);
    if (launch.effort === null) return deny(null, NO_EFFORT);
  }
  // A fork always runs on the session's own model and effort: Claude Code ignores a `model` a
  // fork is given (`docs/claude-code-contract.md`), so judging the name it carries would judge a
  // model it never runs on.
  const real = launch.fork
    ? forkModel(ctx.sessionModel, ctx, env)
    : resolveLaunchModel(named ?? "", ctx, env);
  // The owner's rule, before every model rule: a subagent never runs at `low` or `medium` — on
  // a Claude model and an affordable slot alike. A level no rule knows is refused, not guessed.
  if (launch.effort !== null && !effortAllowed(launch.effort)) {
    return deny(real, effortDenial(launch.effort));
  }
  const type = launch.subagentType ?? "";
  const readOnly =
    ctx.readOnlyAgents === undefined
      ? agentList(READ_ONLY_AGENTS, env, READ_ONLY_AGENTS_ENV)
      : new Set(ctx.readOnlyAgents.map(agentKey));
  const builder = !readOnly.has(agentKey(type));

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
      return deny(
        real,
        [
          "A Fable launch is approved by the person, one by one, and this session has nobody to answer (`claude -p`).",
          "Run it in an interactive session.",
        ].join("\n"),
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
    const why = opusWhy(effort, firstWord(said));
    if (effort !== OPUS_ASK_EFFORT) return allow(real, why);
    if (nobodyWatches(env)) {
      return deny(
        real,
        [
          `A launch on ${namedModel(real)} at effort \`${effort}\` is approved by the person, one by one, and this session has nobody to answer (\`claude -p\`).`,
          `Run it at ${levelsText(OPUS_FREE_EFFORTS)}, or in an interactive session.`,
        ].join("\n"),
      );
    }
    return {
      decision: "ask",
      real,
      reason: [
        `${namedModel(real)} launch at effort \`${effort}\`: \`${type || "(no type)"}\`${said === null ? "" : `, with the reason line \`Opus reason: ${said}\``}.`,
        `The opus tier runs at ${levelsText(OPUS_FREE_EFFORTS)} with no question; \`${effort}\` only when the person asks for it. Approve only if you did.`,
      ].join("\n"),
      why,
    };
  }

  if (!real.claude) {
    if (ctx.gatewayOn && launch.effort?.toLowerCase() !== "max") {
      return deny(
        real,
        [
          `This launch runs on ${real.model}, an affordable gateway slot.`,
          'An affordable slot runs at effort `max` (its reasoning costs cents): pass `effort: "max"`.',
        ].join("\n"),
      );
    }
    return allow(real, "");
  }

  // Sonnet or Haiku: free of the model rules.
  return allow(real, "");
}

/** True when this session has nobody to answer a question (`claude -p`). */
function nobodyWatches(env: Env): boolean {
  return (env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0";
}

/** The model behind a fork: the session's own, unknowable → Claude Opus. */
function forkModel(sessionModel: null | string, gateway: GatewayFacts, env: Env): LaunchModel {
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
 * True when Claude Code's settings send its requests to the router (`ANTHROPIC_BASE_URL` set);
 * false when they do not, or cannot be read.
 */
export function gatewayOnOf(paths: CliPaths): boolean {
  try {
    return settingsReport(paths.settingsFile).baseUrl !== null;
  } catch {
    // Settings that cannot be read send nothing anywhere the guard can prove: off.
    return false;
  }
}

/** The gateway as a hook on this machine sees it: its config, and whether it is on. */
export function gatewayFactsOf(paths: CliPaths): GatewayFacts {
  return { config: gatewayConfigOf(paths), gatewayOn: gatewayOnOf(paths) };
}

/** What the guard reads from this machine for `judgeLaunch`; never throws. */
export function readGuardContext(paths: CliPaths, input: HookInput, env: Env): GuardContext {
  return {
    ...gatewayFactsOf(paths),
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
  const guard = readGuardContext(context.paths, input, context.env);
  const tool = stringField(input.tool_name);
  if (tool !== null && (WORKFLOW_TOOLS as readonly string[]).includes(tool)) {
    const script = stringField(toolInput(input).script);
    if (script === null) return {};
    const refusal = workflowRefusal(script);
    if (refusal !== null)
      return { decision: "deny", launches: 0, tool: "Workflow", why: "unreadable" };
    const results = judgeWorkflow(script, guard, context.env);
    const decided = results.find((one) => one.verdict.decision !== "allow");
    return {
      decision: decided?.verdict.decision ?? "allow",
      launches: results.length,
      tool: "Workflow",
      ...(decided === undefined ? {} : { why: decided.verdict.why || decided.verdict.decision }),
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
  };
}

/** One line in the record, and one in the hook log, for an Opus or Fable launch. */
function recorded(
  result: Verdict,
  launch: Launch,
  input: HookInput,
  cwd: string,
  nowMs: number,
): AgentLaunch | null {
  // The tier, not the vendor: a premium launch whose model is a backend is recorded too.
  const family = result.real?.tier;
  if (family !== "opus" && family !== "fable") return null;
  return {
    at: nowMs,
    family,
    model: result.real?.model ?? "",
    project: cwd,
    reason: result.why === "" ? result.decision : result.why,
    session: stringField(input.session_id) ?? "",
    subagentType: launch.subagentType ?? "",
    toolUseId: stringField(input.tool_use_id) ?? "",
  };
}

/**
 * The hook's answer: judge the launch (or every launch a Workflow script makes), record an
 * Opus or Fable one, and answer with the PreToolUse decision. Anything it cannot read lets
 * the call through.
 */
export function agentGuard(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  cwd: string,
  nowMs: number = Date.now(),
): HookResult {
  const tool = stringField(input.tool_name);
  const context = readGuardContext(paths, input, env);
  const file = agentLaunchesFile(paths.stateDir);
  if (tool !== null && (WORKFLOW_TOOLS as readonly string[]).includes(tool)) {
    const script = stringField(toolInput(input).script);
    if (script === null) return SILENT;
    // A launch the guard cannot follow — `agent` handed around, options built at run time —
    // refuses the whole call: the rules would not hold for it.
    const refusal = workflowRefusal(script);
    if (refusal !== null) return toolDecision("deny", refusal);
    const results = judgeWorkflow(script, context, env);
    // The strictest verdict of the script's launches answers for the whole call: a deny refuses
    // it, so nothing in it ran and none of its launches is recorded; otherwise every asking and
    // allowed launch is, and the ask names each launch that asks.
    const decided = results.find((one) => one.verdict.decision === "deny");
    if (decided !== undefined) return toolDecision("deny", workflowReason(decided));
    for (const one of results) {
      const record = recorded(one.verdict, asLaunch(one.launch), input, cwd, nowMs);
      if (record !== null) appendAgentLaunch(file, record);
    }
    const asks = results.filter((one) => one.verdict.decision === "ask");
    return asks.length === 0
      ? SILENT
      : toolDecision("ask", asks.map((one) => workflowReason(one)).join("\n"));
  }
  const launch = readLaunch(input);
  if (launch === null) return SILENT;
  const result = judgeLaunch(launch, context, env);
  const launchRecord = recorded(result, launch, input, cwd, nowMs);
  if (launchRecord !== null && result.decision !== "deny") appendAgentLaunch(file, launchRecord);
  return result.decision === "allow" ? SILENT : toolDecision(result.decision, result.reason);
}
