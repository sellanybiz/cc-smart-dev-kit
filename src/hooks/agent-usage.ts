/**
 * SubagentStop: what one subagent's replies cost, one JSON line each in
 * `<stateDir>/agent-usage.jsonl` — the record `cc-smart-dev-kit usage` shows per session
 * (agents by type and model, tokens, the share on Opus, an estimated cost).
 *
 * Why a file: Claude Code's own transcripts say which model wrote each reply and what it
 * reported for tokens, but nobody keeps a per-agent total, and a transcript is gone once the
 * session's files are cleaned up. The record is the person's own spend on this machine, so
 * the hook is **machine-wide**: it records with no `cc-smart-dev-kit.json` and outside git. A
 * project that wants its own agent-usage hook lists the name in `ownHooks` (`PLUGIN_HOOK_NAMES`).
 *
 * What a line holds: the time, the session, the agent's id and type, and per model the
 * replies, the four token counts and the estimated USD. **Never any content**: a transcript
 * line's text, tool input and tool result are skipped. The cost comes from the one price
 * home (`src/gateway/prices.ts`, Claude's list price, marked estimated); a model with no row
 * there (an affordable backend's) is recorded with its tokens and no price, never a guess —
 * `unpriced` counts those replies.
 *
 * **One reply, one count.** Claude Code writes a reply's content blocks as separate
 * `assistant` lines, each carrying the reply's whole `usage`; the lines are counted once by
 * `message.id`. **A second stop for one agent** (a block made it continue) writes a newer
 * line with the whole transcript; a reader keeps the newest line per session and agent
 * (`readAgentUsage`), so an agent's cost is never a sum of two halves.
 *
 * The record is kept small like the ask log (`jsonl-log.ts`: `LOG_MAX_BYTES`, the newer half
 * kept). An unreadable transcript, and a record that cannot be written, are one stderr line,
 * exit 0: a subagent must always finish (`.claude/rules/hooks-guards.md` § Fail safe).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { claudeCost } from "../gateway/prices";
import type { CheckTokens } from "../gateway/safety-checks";
import { type HookInput, type HookResult, SILENT, stringField } from "./io";
import { appendJsonLine } from "./jsonl-log";

/** The record's file name, in the state folder. */
export const AGENT_USAGE_FILE = "agent-usage.jsonl";

/** One model's share of a subagent's replies. */
export interface AgentModelUsage extends CheckTokens {
  /** The model id that wrote them (`message.model`), as the answer reported it. */
  model: string;
  /** How many replies it wrote. */
  replies: number;
  /** Their estimated cost at Claude's list price; null when the model has no price row. */
  usd: number | null;
}

/** One subagent's whole run. */
export interface AgentUsage {
  /** The agent's id (`agent_id`); empty when the input names none. */
  agent: string;
  /** The subagent's type (`agent_type`, `general-purpose` say); null when it names none. */
  agentType: string | null;
  /** When the agent stopped (ms since the epoch). */
  at: number;
  /** The models that answered it, by name (a stable order for the exact line). */
  models: AgentModelUsage[];
  /** The session it ran in; empty when the input names none. */
  session: string;
  /** How many replies have no price (their model has no row); 0 when every one is priced. */
  unpriced: number;
  /** The estimated USD for the priced replies; null when none of them could be priced. */
  usd: number | null;
}

/** Where the record lives. */
export function agentUsageFile(stateDir: string): string {
  return join(stateDir, AGENT_USAGE_FILE);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-negative finite number as reported; 0 for anything else (a missing token count). */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** A reply's tokens from its `message.usage`, the four sums Anthropic reports. */
function tokensOf(usage: unknown): CheckTokens {
  if (!isJsonObject(usage)) return { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };
  return {
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
  };
}

/** One reply: the model that wrote it, and what it reported. */
interface Reply {
  model: string;
  tokens: CheckTokens;
}

/** The model a reply line names; `(unknown)` when the line names none. */
const UNKNOWN_MODEL = "(unknown)";

/**
 * Every reply in a transcript, by its `message.id` (the first content-block line of each
 * reply counts it). Only `assistant` lines are read, and only their model and `usage`: no
 * text, no tool input, no tool result.
 *
 * `agentId`: the agent whose file this is. Every line of a subagent's own file carries its
 * `agentId`, so a line that names a DIFFERENT agent is a nested launch's reply and is not
 * this agent's cost (the nested launch has its own stop and its own line). A line with no
 * `agentId`, or when none is asked for, is counted.
 */
export function repliesOfTranscript(text: string, agentId = ""): Map<string, Reply> {
  const replies = new Map<string, Reply>();
  let unnamed = 0;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      // The last line may still be half written.
      continue;
    }
    if (!isJsonObject(line) || line.type !== "assistant") continue;
    const lineAgent = stringField(line.agentId);
    if (agentId !== "" && lineAgent !== null && lineAgent !== agentId) continue;
    const message = line.message;
    if (!isJsonObject(message)) continue;
    const model = stringField(message.model) ?? UNKNOWN_MODEL;
    const id = stringField(message.id);
    const key = id ?? `line-${unnamed}`;
    if (id === null) unnamed += 1;
    if (replies.has(key)) continue;
    replies.set(key, { model, tokens: tokensOf(message.usage) });
  }
  return replies;
}

/** A sum of micro-dollar costs, rounded so a float's noise stays out of the line. */
function microUsd(sum: number): number {
  return Math.round(sum * 1_000_000) / 1_000_000;
}

/**
 * The models that answered, each priced once per reply (`costUsd` prices one prompt size,
 * so a Haiku answer's larger-prompt tier is judged on its own reply, never on a sum).
 * Returned by model name, the order the line holds.
 */
export function modelsOfReplies(replies: Iterable<Reply>): AgentModelUsage[] {
  const byModel = new Map<string, AgentModelUsage & { priced: number; cost: number }>();
  for (const reply of replies) {
    const one = byModel.get(reply.model) ?? {
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      input: 0,
      model: reply.model,
      output: 0,
      priced: 0,
      replies: 0,
      usd: null,
    };
    one.replies += 1;
    one.input += reply.tokens.input;
    one.output += reply.tokens.output;
    one.cacheRead += reply.tokens.cacheRead;
    one.cacheWrite += reply.tokens.cacheWrite;
    const cost = claudeCost(reply.model, reply.tokens);
    if (cost !== null) {
      one.priced += 1;
      one.cost += cost.usd;
    }
    byModel.set(reply.model, one);
  }
  return [...byModel.values()]
    .map(({ priced, cost, ...one }) => ({
      ...one,
      usd: priced === 0 ? null : microUsd(cost),
    }))
    .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
}

/** The line one subagent's transcript makes, or null when it answered nothing. */
export function agentUsageOf(
  input: HookInput,
  transcript: string,
  nowMs: number,
): AgentUsage | null {
  const models = modelsOfReplies(
    repliesOfTranscript(transcript, stringField(input.agent_id) ?? "").values(),
  );
  if (models.length === 0) return null;
  const priced = models.filter((one) => one.usd !== null);
  return {
    agent: stringField(input.agent_id) ?? "",
    agentType: stringField(input.agent_type),
    at: nowMs,
    models,
    session: stringField(input.session_id) ?? "",
    unpriced: models.reduce((sum, one) => sum + (one.usd === null ? one.replies : 0), 0),
    usd:
      priced.length === 0 ? null : microUsd(priced.reduce((sum, one) => sum + (one.usd ?? 0), 0)),
  };
}

/** One line as a record, or null when it is not one (a half-written line, a foreign shape). */
export function parseAgentUsage(line: string): AgentUsage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isJsonObject(value)) return null;
  const { agent, agentType, at, models, session, unpriced, usd } = value;
  if (typeof at !== "number" || !Array.isArray(models)) return null;
  const parsed: AgentModelUsage[] = [];
  for (const one of models) {
    if (!isJsonObject(one) || typeof one.model !== "string") return null;
    if (typeof one.replies !== "number") return null;
    if (one.usd !== null && typeof one.usd !== "number") return null;
    parsed.push({
      cacheRead: count(one.cacheRead),
      cacheWrite: count(one.cacheWrite),
      input: count(one.input),
      model: one.model,
      output: count(one.output),
      replies: count(one.replies),
      usd: typeof one.usd === "number" ? one.usd : null,
    });
  }
  return {
    agent: typeof agent === "string" ? agent : "",
    agentType: typeof agentType === "string" ? agentType : null,
    at,
    models: parsed,
    session: typeof session === "string" ? session : "",
    unpriced: count(unpriced),
    usd: typeof usd === "number" ? usd : null,
  };
}

/** What makes two lines one agent: its session and its id. */
function agentKey(one: AgentUsage): string {
  return `${one.session}\u0000${one.agent}`;
}

/**
 * The records in the window, oldest first, one per agent: a later stop of the same agent
 * (a block made it continue) supersedes the earlier line, which held part of its run. A
 * missing or unreadable file reads as none.
 */
export function readAgentUsage(file: string, sinceMs: number): AgentUsage[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const newest = new Map<string, AgentUsage>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const one = parseAgentUsage(line);
    if (one === null || one.at < sinceMs) continue;
    const key = agentKey(one);
    const seen = newest.get(key);
    if (seen === undefined || seen.at <= one.at) newest.set(key, one);
  }
  return [...newest.values()].sort((a, b) => a.at - b.at);
}

/** One line on stderr: the record is missing, and the person can act on why. */
function said(why: string): HookResult {
  return { stderr: `cc-smart-dev-kit agent-usage: ${why}` };
}

/**
 * The hook's whole answer: read the stopping agent's own transcript, and append its line.
 * Nothing on stdout, ever; a failure is one stderr line and exit 0.
 */
export function recordAgentUsage(
  input: HookInput,
  event: string,
  paths: CliPaths,
  nowMs: number,
): HookResult {
  if (event !== "SubagentStop") return SILENT;
  const transcript = stringField(input.agent_transcript_path);
  if (transcript === null) return said("the input names no agent transcript");
  let text: string;
  try {
    text = readFileSync(transcript, "utf8");
  } catch {
    return said("the agent's transcript cannot be read, so its usage is not recorded");
  }
  const usage = agentUsageOf(input, text, nowMs);
  if (usage === null) return SILENT;
  try {
    appendJsonLine(agentUsageFile(paths.stateDir), usage);
  } catch (error) {
    return said(
      `cannot write the record (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return SILENT;
}
