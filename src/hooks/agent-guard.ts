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
 * top of it, an affordable slot must be `max` and a review runs at `xhigh`, never `max`.
 *
 * | The model behind the launch | The verdict |
 * |---|---|
 * | an affordable slot key / a `<backend>:<model>` target | allow; with the gateway on, its effort must be `max`, else deny |
 * | any other name (`best`, `opusplan`, `default`, `inherit`, a name no rule knows) | the Opus rule below: only what the guard can prove affordable is affordable |
 * | Claude Sonnet or Haiku | allow (the effort rule above still holds) |
 * | Claude Opus | a review agent (or one ending `:reviewer`): allow, no question (still refused at effort `max`); anything else with a prompt line `Opus reason: <one of OPUS_REASONS>`: **ask** (the person approves each one, and sees the reason); without that line: deny |
 * | Claude Fable | only a read-only agent type, with a prompt line `Fable reason: <one of FABLE_REASONS> - <why>`, and a person to answer: then **ask**; a builder type, no reason line, or an unattended session (`claude -p`): deny |
 * | no `model` / no `effort` | deny (a launch that names neither would inherit the session's, which nobody chose) — except a `fork`, which always inherits both |
 * | a session nobody watches (`claude -p`) | a non-review Opus or Fable launch: deny (there is nobody to approve it); a review on Opus: allow |
 *
 * **Which model, exactly.** The call's `model` is a name (`haiku|sonnet|opus|fable` — the
 * only four Claude Code's Agent tool accepts, proved live from its own schema; a full id, a
 * slot key and `<backend>:<model>` are read too, for a Workflow script or a future build).
 * It is resolved the way Claude Code resolves it:
 * `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` (all four exist in Claude Code 2.1.301, fable included)
 * overrides the family's model, and then the gateway config's first target answers
 * (`modelSlots` keeps a real Claude id first, so that target is the Claude model itself). A
 * `fork` runs on the session's model: the last Claude model in the hook input's
 * `transcript_path` (`lastClaudeModel`), else `ANTHROPIC_MODEL`; unknowable → Claude Opus.
 *
 * Every Opus or Fable launch is recorded with its reason (`agent-launches.ts`), and
 * `cc-smart-dev-kit usage` lists them. Anything the guard cannot work out lets the call through.
 */

import type { CliPaths } from "../cli/paths";
import { type GatewayConfig, loadConfigFile } from "../gateway/config";
import { settingsReport } from "../gateway/settings";
import { isSlotKey, parseTarget, withoutContextSuffix } from "../gateway/targets";
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

/** The Claude families Claude Code names as models, and overrides through its environment. */
export const CLAUDE_FAMILIES = ["fable", "haiku", "opus", "sonnet"] as const;
export type ClaudeFamily = (typeof CLAUDE_FAMILIES)[number];

/**
 * The family a model id names, by its `-<family>-` part (`claude-opus-5-5` → `opus`); null
 * for a name no family can be read from (a backend's model, a Claude id from the future).
 */
export function familyOfModel(model: string): ClaudeFamily | null {
  const name = model.toLowerCase();
  return CLAUDE_FAMILIES.find((family) => name.includes(`-${family}-`)) ?? null;
}

/** The tools this guard reads: the Agent tool, the older name, and Workflow. */
export const AGENT_TOOLS = ["Agent", "Task"] as const;
export const WORKFLOW_TOOLS = ["Workflow"] as const;

/** The subagent type a fork uses: it runs on the session's model and effort. */
export const FORK = "fork";

/** What `Opus reason:` may name (the owner's list). */
export const OPUS_REASONS = [
  "security",
  "money",
  "permissions",
  "schema",
  "deploy",
  "ui",
  "architecture",
  "plan-review",
  "debugging",
] as const;

/** What `Fable reason:` may name (the owner's list). */
export const FABLE_REASONS = [
  "hard",
  "rewrite",
  "ui-design",
  "architecture",
  "review",
  "plan",
] as const;

/** The subagent types a launch may use on Fable: they read and report, never build. */
export const READ_ONLY_AGENTS = ["Plan", "Reviewer", "Explore", "Code Explorer"] as const;

/** The subagent types that count as reviews (Claude Opus without a reason line). */
export const REVIEW_AGENTS = ["Reviewer"] as const;

/** The environment variables a person may extend those two lists with (comma-separated). */
export const REVIEW_AGENTS_ENV = "CC_SMART_DEV_KIT_AGENT_GUARD_REVIEW_AGENTS";
export const READ_ONLY_AGENTS_ENV = "CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS";

/**
 * The effort levels a subagent may run at — the one home of that list (owner, 2026-10-16):
 * `low` and `medium` are refused on every model, a Claude model and an affordable gateway slot
 * alike. Two rules name one level each, on top of this one: an affordable slot must be `max`,
 * and a review runs at `xhigh`, never `max`.
 */
export const ALLOWED_EFFORTS = ["high", "xhigh", "max"] as const;

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
  /** Its family; null for a non-Claude target, or a Claude id no family can be read from. */
  family: ClaudeFamily | null;
  /** How the launch names it: the resolved id, the slot's first target, or the name as sent. */
  model: string;
}

/** Claude Code's override for a family: `ANTHROPIC_DEFAULT_OPUS_MODEL`, … */
export function familyEnv(family: ClaudeFamily): string {
  return `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`;
}

/** The first target of the model slot for a family, from the config's `modelSlots`. */
function modelSlotFirstTarget(config: GatewayConfig | null, family: ClaudeFamily): null | string {
  if (config === null) return null;
  for (const [model, slot] of Object.entries(config.modelSlots ?? {})) {
    if (familyOfModel(model) !== family) continue;
    const first = config.slots[slot]?.[0];
    if (first !== undefined) return first;
  }
  return null;
}

/** A Claude id, slot key or `<backend>:<model>` as the model behind the launch. */
function resolveName(text: string, config: GatewayConfig | null): LaunchModel {
  if (text.startsWith("claude-")) {
    const slot = config?.modelSlots?.[text];
    const first = slot === undefined ? undefined : config?.slots[slot]?.[0];
    const shown = first ?? text;
    return { claude: true, family: familyOfModel(shown), model: shown };
  }
  if (isSlotKey(text)) {
    const first = config?.slots[text]?.[0];
    if (first === undefined) return { claude: false, family: null, model: text };
    return resolveTarget(first);
  }
  const parsed = parseTarget(text);
  if ("target" in parsed && parsed.target.kind === "backend") {
    return { claude: false, family: null, model: text };
  }
  // A name no rule knows (`best`, `opusplan`, `default`, `inherit`, anything else): never read
  // as an affordable slot. Only a slot key and a `<backend>:<model>` target are affordable —
  // every other name gets the strictest rule, the one for a Claude id with no family to read.
  return { claude: true, family: null, model: text };
}

/** A slot target as the model behind the launch. */
function resolveTarget(text: string): LaunchModel {
  const parsed = parseTarget(text);
  return "target" in parsed && parsed.target.kind === "anthropic"
    ? { claude: true, family: familyOfModel(parsed.target.model), model: parsed.target.model }
    : { claude: false, family: null, model: text };
}

/**
 * The model behind a launch that names `name`: a family name goes through Claude Code's
 * environment, then the gateway's model slot for that family; anything else is resolved as
 * itself.
 */
export function resolveLaunchModel(
  name: string,
  config: GatewayConfig | null,
  env: Env,
): LaunchModel {
  const text = withoutContextSuffix(name.trim());
  const family = CLAUDE_FAMILIES.find((one) => one === text.toLowerCase());
  if (family === undefined) return resolveName(text, config);
  const override = stringField(env[familyEnv(family)]);
  if (override !== null) return resolveName(withoutContextSuffix(override.trim()), config);
  return { claude: true, family, model: modelSlotFirstTarget(config, family) ?? text };
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
export interface GuardContext {
  config: GatewayConfig | null;
  /** True when Claude Code's settings point at the router (`ANTHROPIC_BASE_URL`). */
  gatewayOn: boolean;
  /** The session's own model, for a fork; null when it cannot be read. */
  sessionModel: null | string;
  /** The subagent types a Fable launch may use; the plugin's list by default. */
  readOnlyAgents?: readonly string[];
  /** The subagent types counted as reviews; the plugin's list by default. */
  reviewAgents?: readonly string[];
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
 *     of a reason line, so an Opus or Fable launch is denied and a launch whose `model` cannot
 *     be read is denied outright;
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
  "The launch's prompt is built at run time, so the guard cannot read an `Opus reason:` or `Fable reason:` line in it.";

/** Judges every launch of a Workflow script, in order. */
export function judgeWorkflow(script: string, ctx: GuardContext, env: Env): WorkflowResult[] {
  return readWorkflowScript(script).map((launch) => {
    const verdict = judgeLaunch(asLaunch(launch), ctx, env);
    // A model the script builds at run time cannot be read by a hook: refused, never guessed.
    if (launch.model === null) {
      return { launch, verdict: deny(verdict.real, NO_WORKFLOW_MODEL) };
    }
    // An Opus or Fable launch that would ask rests on a reason line in its prompt: with a
    // prompt the guard cannot read, there is nothing to approve, so it is refused instead.
    if (launch.prompt === null && verdict.decision !== "allow") {
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

const NO_MODEL = [
  "This Agent launch names no `model`.",
  "An agent given none runs on the session's model and effort, which nobody chose: pass `model` and `effort` on every launch.",
].join("\n");

/** The levels of `ALLOWED_EFFORTS` as the guard's messages name them: `` `high`, `xhigh`, `max` ``. */
const EFFORTS = ALLOWED_EFFORTS.map((one) => `\`${one}\``).join(", ");

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

function opusDenial(): string {
  return [
    "This launch would run on Claude Opus.",
    "Opus is for reviews and the owner's listed exceptions only: launch it as a review agent (`subagent_type` Reviewer, or one ending `:reviewer`), or put a line in the prompt saying why — the person is then asked to approve each one:",
    `Opus reason: <${OPUS_REASONS.join("|")}>`,
  ].join("\n");
}

function fableDenial(): string {
  return [
    "This launch would run on Claude Fable.",
    "Fable advises the main session; it never builds. Use a read-only agent type (Plan, Reviewer, Explore, Code Explorer), and put a line in the prompt saying why:",
    `Fable reason: <${FABLE_REASONS.join("|")}> - <why>`,
  ].join("\n");
}

/** Judges one launch against the owner's rules; pure, so a test can drive every branch. */
export function judgeLaunch(launch: Launch, ctx: GuardContext, env: Env): Verdict {
  if (!launch.fork) {
    if (launch.model === null) return deny(null, NO_MODEL);
    if (launch.effort === null) return deny(null, NO_EFFORT);
  }
  const real =
    launch.model !== null
      ? resolveLaunchModel(launch.model, ctx.config, env)
      : forkModel(ctx.sessionModel, ctx.config, env);
  // The owner's rule, before every model rule: a subagent never runs at `low` or `medium` — on
  // a Claude model and an affordable slot alike. A level no rule knows is refused, not guessed.
  if (launch.effort !== null && !effortAllowed(launch.effort)) {
    return deny(real, effortDenial(launch.effort));
  }
  const type = launch.subagentType ?? "";
  const review =
    ctx.reviewAgents === undefined
      ? agentList(REVIEW_AGENTS, env, REVIEW_AGENTS_ENV)
      : new Set(ctx.reviewAgents.map(agentKey));
  const readOnly =
    ctx.readOnlyAgents === undefined
      ? agentList(READ_ONLY_AGENTS, env, READ_ONLY_AGENTS_ENV)
      : new Set(ctx.readOnlyAgents.map(agentKey));
  const isReview = review.has(agentKey(type));

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

  if (real.family === "haiku" || real.family === "sonnet") return allow(real, "");

  if (real.family === "fable") {
    if (!readOnly.has(agentKey(type))) {
      return deny(
        real,
        [
          `Fable advises, it never builds — and this launch asks for \`${type || "(no type)"}\`, which works (and may change files).`,
          "Ask a read-only agent on Fable (Plan, Reviewer, Explore, Code Explorer), or run this agent on another model.",
        ].join("\n"),
      );
    }
    const said = reasonLine(launch.prompt, "Fable reason");
    const word = reasonWord(said, FABLE_REASONS);
    if (word === null) return deny(real, fableDenial());
    if ((env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0") {
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
      reason: [
        `Claude Fable launch: a read-only agent (\`${type}\`) with the reason line \`Fable reason: ${said}\`.`,
        "Fable advises; it never builds. Approve if this is the hard problem that needs it.",
      ].join("\n"),
      why: `fable:${word}`,
    };
  }

  // Claude Opus, or a Claude id no family can be read from: the strictest of the rules.
  // A review is allowed without a question; anything else on Opus asks the person, with the
  // reason line the launch wrote, and is refused when nobody is there to answer.
  if (isReview && launch.effort?.toLowerCase() === "max") {
    return deny(
      real,
      "A review runs at effort `xhigh`, never `max`. Change the effort (reviews are real judgment, not the hardest problem).",
    );
  }
  if (isReview) return allow(real, "review");
  const said = reasonLine(launch.prompt, "Opus reason");
  const word = reasonWord(said, OPUS_REASONS);
  if (word === null) return deny(real, opusDenial());
  if ((env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0") {
    return deny(
      real,
      [
        "An Opus launch other than a review is approved by the person, one by one, and this session has nobody to answer (`claude -p`).",
        "Run it in an interactive session, or launch it as a review agent.",
      ].join("\n"),
    );
  }
  return {
    decision: "ask",
    real,
    reason: [
      `Claude Opus launch: not a review, with the reason line \`Opus reason: ${said}\`.`,
      "Opus is for reviews and the listed exceptions. Approve only if this launch is one of them.",
    ].join("\n"),
    why: `opus:${word}`,
  };
}

/** The model behind a fork: the session's own, unknowable → Claude Opus. */
function forkModel(
  sessionModel: null | string,
  config: GatewayConfig | null,
  env: Env,
): LaunchModel {
  if (sessionModel === null)
    return { claude: true, family: "opus", model: "the session's model (unknown)" };
  return resolveLaunchModel(sessionModel, config, env);
}

/** What the guard reads from this machine for `judgeLaunch`; never throws. */
export function readGuardContext(paths: CliPaths, input: HookInput, env: Env): GuardContext {
  let config: GatewayConfig | null = null;
  try {
    config = loadConfigFile(paths.gatewayConfigFile);
  } catch {
    // No gateway.json, or one that cannot be used: no slot is known, and every claude-… id
    // stays Claude. The judgement then leans on the family names alone.
    config = null;
  }
  let gatewayOn = false;
  try {
    gatewayOn = settingsReport(paths.settingsFile).baseUrl !== null;
  } catch {
    gatewayOn = false;
  }
  const transcript = stringField(input.transcript_path);
  const answered = transcript === null ? null : lastClaudeModel(transcript);
  return {
    config,
    gatewayOn,
    // The session's own model, for a fork: what last answered (`lastClaudeModel`), else the
    // model the session was started on (`ANTHROPIC_MODEL`), else unknowable.
    sessionModel: answered ?? stringField(env.ANTHROPIC_MODEL),
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
  const family = result.real?.family;
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
    for (const one of results) {
      if (one.verdict.decision === "deny") continue;
      const record = recorded(one.verdict, asLaunch(one.launch), input, cwd, nowMs);
      if (record !== null) appendAgentLaunch(file, record);
    }
    // The strictest verdict of the script's launches answers for the whole call.
    const decided = results.find((one) => one.verdict.decision === "deny");
    const asked = results.find((one) => one.verdict.decision === "ask");
    if (decided !== undefined) return toolDecision("deny", workflowReason(decided));
    return asked === undefined ? SILENT : toolDecision("ask", workflowReason(asked));
  }
  const launch = readLaunch(input);
  if (launch === null) return SILENT;
  const result = judgeLaunch(launch, context, env);
  const launchRecord = recorded(result, launch, input, cwd, nowMs);
  if (launchRecord !== null && result.decision !== "deny") appendAgentLaunch(file, launchRecord);
  return result.decision === "allow" ? SILENT : toolDecision(result.decision, result.reason);
}
