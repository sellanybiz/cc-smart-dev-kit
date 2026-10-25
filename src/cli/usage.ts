/**
 * `cc-smart-dev-kit usage`: which models answered this machine's Claude Code sessions, main
 * sessions and subagents apart, read from Claude Code's own transcripts. Read only; it
 * prints counts and model names, never a word of a message.
 *
 * Claude Code 2.1.300 writes a session's own conversation to
 * `<config>/projects/<project folder>/<session id>.jsonl`, and each subagent of it to
 * `<config>/projects/<project folder>/<session id>/subagents/agent-<id>.jsonl`, beside an
 * `agent-<id>.meta.json` that names how it was launched (`model`: `opus`, `sonnet`, `haiku`,
 * or none, which means it took the session's model). In a `.jsonl`, each line of
 * `type: "assistant"` is one content block of a reply: `message.id` names the reply,
 * `message.model` the model that wrote it (a backend's own name, `<model>`, when a slot with a
 * chain answered), `timestamp` when, `cwd` the folder. (docs/claude-code-contract.md)
 *
 * What it counts, in the window: per session, the main session's replies by model; the
 * subagents launched, how, their replies by model, and the share of those on an Opus model.
 * A file last changed before the window holds nothing in it, and is not read.
 *
 * Beside the transcripts it lists the Opus and Fable launches the Agent guard allowed
 * (`src/hooks/agent-launches.ts`), counted by the effort each ran at and by why (its reason
 * word): an Opus or Fable agent spends the person's own plan usage, and the reason the guard
 * accepted is the one thing the transcripts cannot say.
 *
 * And each subagent's own record (`src/hooks/agent-usage.ts`, `agent-usage.jsonl`): at every
 * subagent's stop the hook writes the agent's type, the models that answered it, the four
 * token sums and an estimated cost. The transcripts already give the models; the record adds
 * the agent type, the tokens and the cost, and survives the transcripts' cleanup. `--json`
 * prints the same facts as one object a portal or another reader can take.
 *
 * It also shows the auto-mode safety checks the router counted (`../gateway/safety-checks.ts`),
 * by day: those requests are not in the transcripts, since they belong to no session's
 * conversation. The file is the router's own state; with no gateway set up there is none,
 * and the report says so.
 */

import { basename, resolve } from "node:path";
import {
  type TranscriptRef,
  transcriptChangedAt,
  transcriptText,
  transcriptTree,
} from "../crew/archive-read";
import {
  type CheckTokens,
  localDay,
  recentCheckDays,
  SAFETY_CHECK_WINDOW_DAYS,
  type SafetyCheckState,
} from "../gateway/safety-checks";
import { readSafetyChecks } from "../gateway/safety-checks-read";
import {
  type AgentLaunch,
  agentLaunchesFile,
  formatAgentLaunches,
  readAgentLaunches,
} from "../hooks/agent-launches";
import {
  type AgentModelUsage,
  type AgentUsage,
  agentUsageFile,
  readAgentUsage,
} from "../hooks/agent-usage";
import { type CliPaths, tildify } from "./paths";

export interface UsageOptions {
  /** Only sessions whose folder, or its last part, or the project folder's name, is this. */
  project: null | string;
  /** Milliseconds since the epoch: nothing older counts. */
  sinceMs: number;
}

/** One session: its own replies and its subagents'. */
export interface SessionUsage {
  /** Read from the kit's crew archive: a removed crew session's conversation. */
  archived: boolean;
  cwd: null | string;
  /** How each subagent was launched: `opus`, `sonnet`, `haiku`, or `inherited`. */
  launched: Record<string, number>;
  /** The main session's own replies, by the model that wrote them. */
  main: Record<string, number>;
  /** The project folder's name under `projects/`. */
  project: string;
  /** The subagents' replies, by the model that wrote them. */
  replies: Record<string, number>;
  session: string;
  subagents: number;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(ref: TranscriptRef): unknown {
  try {
    return JSON.parse(transcriptText(ref) ?? "");
  } catch {
    // A file being written, or not JSON: skipped.
    return null;
  }
}

/**
 * One transcript's replies in the window, by model, and the first `cwd` it names. Skipped
 * unread (no replies) when the file last changed before the window. `sidechains`: false
 * for a main session, whose file may hold a subagent's lines in older Claude Code versions.
 */
function readTranscript(
  ref: null | TranscriptRef | undefined,
  sinceMs: number,
  sidechains: boolean,
): { cwd: null | string; replies: Map<string, string> } {
  const replies = new Map<string, string>();
  let cwd: null | string = null;
  if (ref == null || transcriptChangedAt(ref) < sinceMs) return { cwd, replies };
  const text = transcriptText(ref);
  if (text === null) return { cwd, replies };
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // The last line may still be half written.
      continue;
    }
    if (!isJsonObject(entry)) continue;
    if (cwd === null && typeof entry.cwd === "string") cwd = entry.cwd;
    if (entry.type !== "assistant" || !isJsonObject(entry.message)) continue;
    if (!sidechains && entry.isSidechain === true) continue;
    const time = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    if (!(time >= sinceMs)) continue;
    const model = typeof entry.message.model === "string" ? entry.message.model : "(unknown)";
    const id =
      typeof entry.message.id === "string"
        ? entry.message.id
        : typeof entry.uuid === "string"
          ? entry.uuid
          : `${replies.size}`;
    replies.set(id, model);
  }
  return { cwd, replies };
}

/**
 * Whether a session belongs to `project`: its folder, its last part, or the session's `cwd`.
 * `flow.ts` reads the same transcripts and matches a project the same way.
 */
export function matches(project: null | string, folder: string, cwd: null | string): boolean {
  if (project === null) return true;
  if (folder === project) return true;
  if (cwd === null) return false;
  return cwd === resolve(project) || basename(cwd) === project;
}

function count(into: Record<string, number>, replies: Map<string, string>): void {
  for (const model of replies.values()) into[model] = (into[model] ?? 0) + 1;
}

/**
 * Every session with a reply, or a subagent, in the window, read from `projectsDir` — and, with
 * `stateDir`, from the kit's crew archive too (`archive-read.ts`): a removed crew session's
 * conversation moves there, and its replies still count. An archived session says so
 * (`archived`).
 */
export function collectUsage(
  projectsDir: string,
  options: UsageOptions,
  stateDir: null | string = null,
): SessionUsage[] {
  const out: SessionUsage[] = [];
  for (const [project, sessions] of transcriptTree(projectsDir, stateDir)) {
    for (const [session, files] of sessions) {
      const usage: SessionUsage = {
        archived: files.main?.gz === true || [...files.subagents.values()].some((file) => file.gz),
        cwd: null,
        launched: {},
        main: {},
        project,
        replies: {},
        session,
        subagents: 0,
      };
      const own = readTranscript(files.main, options.sinceMs, false);
      usage.cwd = own.cwd;
      count(usage.main, own.replies);
      const metas = [...files.subagents.keys()].filter((name) => name.endsWith(".meta.json"));
      for (const name of metas.sort()) {
        const metaRef = files.subagents.get(name);
        if (metaRef === undefined) continue;
        const transcript = files.subagents.get(name.replace(/\.meta\.json$/, ".jsonl"));
        const started = transcriptChangedAt(metaRef);
        const { cwd, replies } = readTranscript(transcript, options.sinceMs, true);
        if (replies.size === 0 && started < options.sinceMs) continue;
        const meta = readJson(metaRef);
        usage.cwd ??= cwd;
        usage.subagents += 1;
        const launched =
          isJsonObject(meta) && typeof meta.model === "string" ? meta.model : "inherited";
        usage.launched[launched] = (usage.launched[launched] ?? 0) + 1;
        count(usage.replies, replies);
      }
      const active = own.replies.size > 0 || usage.subagents > 0;
      if (active && matches(options.project, project, usage.cwd)) out.push(usage);
    }
  }
  return out;
}

const isOpus = (model: string) => /opus/i.test(model);

function counts(record: Record<string, number>): string {
  return Object.entries(record)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([name, count]) => `${name} ${count}`)
    .join(", ");
}

function share(record: Record<string, number>): { opus: number; total: number } {
  let opus = 0;
  let total = 0;
  for (const [model, count] of Object.entries(record)) {
    total += count;
    if (isOpus(model)) opus += count;
  }
  return { opus, total };
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;
}

function add(into: Record<string, number>, from: Record<string, number>): void {
  for (const [model, count] of Object.entries(from)) into[model] = (into[model] ?? 0) + count;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What one side's answers reported, as the report shows it. */
function tokens(count: CheckTokens): string {
  return `${count.input} in, ${count.output} out, ${count.cacheRead} cache read, ${count.cacheWrite} cache write`;
}

/** A USD amount as a person reads it: at least cents, and the micro-dollars one reply costs. */
export function usdText(usd: number): string {
  const fixed = usd.toFixed(6).replace(/0+$/, "");
  const [whole = "0", part = ""] = fixed.split(".");
  return `$${whole}.${part.padEnd(2, "0")}`;
}

/** An agent whose type was not recorded (`agent_type` absent). */
const NO_TYPE = "(no type)";

/** What some agent records add up to: types and models by count, tokens, the share on Opus. */
export interface AgentRecordTotals {
  byModel: Record<string, number>;
  byType: Record<string, number>;
  opus: number;
  replies: number;
  tokens: CheckTokens;
  unpriced: number;
  usd: number | null;
}

/** The sums of a set of agent records (one session's, or every one in the window). */
export function agentRecordTotals(agents: readonly AgentUsage[]): AgentRecordTotals {
  const totals: AgentRecordTotals = {
    byModel: {},
    byType: {},
    opus: 0,
    replies: 0,
    tokens: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    unpriced: 0,
    usd: null,
  };
  let priced = 0;
  let cost = 0;
  for (const agent of agents) {
    const type = agent.agentType ?? NO_TYPE;
    totals.byType[type] = (totals.byType[type] ?? 0) + 1;
    totals.unpriced += agent.unpriced;
    if (agent.usd !== null) {
      priced += 1;
      cost += agent.usd;
    }
    for (const model of agent.models) {
      totals.byModel[model.model] = (totals.byModel[model.model] ?? 0) + model.replies;
      totals.replies += model.replies;
      totals.tokens.input += model.input;
      totals.tokens.output += model.output;
      totals.tokens.cacheRead += model.cacheRead;
      totals.tokens.cacheWrite += model.cacheWrite;
      if (isOpus(model.model)) totals.opus += model.replies;
    }
  }
  totals.usd = priced === 0 ? null : Math.round(cost * 1_000_000) / 1_000_000;
  return totals;
}

/** A cost as the report says it, with what it cannot price. */
export function costText(usd: number | null, unpriced: number): string {
  const known = usd === null ? "no price known" : `${usdText(usd)} estimated`;
  if (unpriced === 0) return known;
  return `${known} (${unpriced === 1 ? "1 reply has no price" : `${unpriced} replies have no price`})`;
}

/** The report's one line for a set of agent records; nothing when there are none. */
export function formatAgentRecord(agents: readonly AgentUsage[]): string[] {
  if (agents.length === 0) return [];
  const totals = agentRecordTotals(agents);
  const sessions = new Set(agents.map((agent) => agent.session)).size;
  return [
    "",
    `Agents on record: ${plural(agents.length, "agent")} in ${plural(sessions, "session")}; by type: ${counts(totals.byType)}; replies by model: ${counts(totals.byModel)}; on Opus: ${totals.opus} of ${totals.replies} replies (${percent(totals.opus, totals.replies)}); cost ${costText(totals.usd, totals.unpriced)}`,
  ];
}

/** The agent records by session id, for the per-session part of the report. */
export function agentsBySession(agents: readonly AgentUsage[]): Map<string, AgentUsage[]> {
  const bySession = new Map<string, AgentUsage[]>();
  for (const agent of agents) {
    const list = bySession.get(agent.session) ?? [];
    list.push(agent);
    bySession.set(agent.session, list);
  }
  return bySession;
}

/** One agent record as the JSON report carries it: the line's fields and its reply count. */
export interface AgentUsageJson extends CheckTokens {
  agent: string;
  agentType: string | null;
  at: number;
  models: AgentModelUsage[];
  replies: number;
  session: string;
  unpriced: number;
  usd: number | null;
}

/** What `usage --json` prints. `format` goes up when a field changes meaning. */
export interface UsageJson {
  agents: AgentUsageJson[];
  format: number;
  hours: number;
  sessions: SessionUsage[];
  totals: {
    agentReplies: number;
    agents: number;
    agentTokens: CheckTokens;
    agentUnpriced: number;
    agentUsd: number | null;
    main: Record<string, number>;
    replies: Record<string, number>;
    sessions: number;
    subagents: number;
  };
}

/**
 * The same facts as the text report, as one object: the sessions the transcripts gave, the
 * subagent records (`agent-usage.jsonl`), and the totals. The text is built from these same
 * readers, so the two can never disagree. No message text, ever.
 */
export function usageJson(
  sessions: readonly SessionUsage[],
  agents: readonly AgentUsage[],
  hours: number,
): UsageJson {
  const main: Record<string, number> = {};
  const replies: Record<string, number> = {};
  for (const session of sessions) {
    add(main, session.main);
    add(replies, session.replies);
  }
  const recorded = agentRecordTotals(agents);
  return {
    agents: agents.map((agent) => ({
      agent: agent.agent,
      agentType: agent.agentType,
      at: agent.at,
      models: agent.models,
      replies: agent.models.reduce((sum, model) => sum + model.replies, 0),
      session: agent.session,
      unpriced: agent.unpriced,
      usd: agent.usd,
      ...agent.models.reduce(
        (tokens, model) => ({
          cacheRead: tokens.cacheRead + model.cacheRead,
          cacheWrite: tokens.cacheWrite + model.cacheWrite,
          input: tokens.input + model.input,
          output: tokens.output + model.output,
        }),
        { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      ),
    })),
    format: 1,
    hours,
    sessions: sessions.map((session) => ({ ...session })),
    totals: {
      agentReplies: recorded.replies,
      agents: agents.length,
      agentTokens: recorded.tokens,
      agentUnpriced: recorded.unpriced,
      agentUsd: recorded.usd,
      main,
      replies,
      sessions: sessions.length,
      subagents: sessions.reduce((sum, session) => sum + session.subagents, 0),
    },
  };
}

/**
 * The safety-check lines of the report: the days the router counted, today and the seven
 * before it (`SAFETY_CHECK_WINDOW_DAYS`), newest first. `timeZone` is the machine's own
 * unless a test names one, as the router counts by local day.
 *
 * What these numbers cannot say, in one line under them: whether the tokens count against
 * a Pro, Max or Team plan's limit. Anthropic's docs say they count for Enterprise and API
 * accounts; for the rest it is not confirmed, and a report that guessed would be worse
 * than one that says so (`README.md` § The usage limit).
 */
export function formatSafetyChecks(
  state: null | SafetyCheckState,
  nowMs: number,
  timeZone?: string,
): string[] {
  const lines = ["", "Auto mode's safety checks the router counted on this machine:"];
  const days =
    state === null ? [] : recentCheckDays(state, nowMs, SAFETY_CHECK_WINDOW_DAYS, timeZone);
  if (days.length === 0) {
    lines.push(
      `  none in the last ${SAFETY_CHECK_WINDOW_DAYS} days (the gateway must be set up, and a session must have run with auto mode on)`,
    );
    return lines;
  }
  const today = localDay(nowMs, timeZone);
  for (const [day, record] of days) {
    const fallback =
      record.fallback.checks > 0
        ? `; your judge ${record.fallback.checks} (${tokens(record.fallback)})`
        : "";
    lines.push(
      `  ${day === today ? `today (${day})` : day}: ${plural(record.checks, "check")} — Anthropic ${record.anthropic.checks} (${tokens(record.anthropic)})${fallback}`,
    );
  }
  lines.push(
    "  The tokens are what each answer's `usage` reported; whether they count against a Pro, Max or Team plan's limit is not confirmed (Anthropic's docs say they do on Enterprise and API accounts).",
  );
  return lines;
}

/**
 * The report's lines. `agents` is each subagent's record (`agent-usage.jsonl`), shown under
 * its session; a session whose agents have no record (an older plugin, a cleaned-up
 * transcript) keeps the transcript's own lines alone.
 */
export function formatUsage(
  sessions: SessionUsage[],
  hours: number,
  projectsDir: string,
  home: string,
  launches: AgentLaunch[] = [],
  agents: AgentUsage[] = [],
): string {
  const lines = [
    `Claude Code replies in the last ${hours} h, main sessions and subagents apart, from ${tildify(projectsDir, home)} (read only; no message text)`,
  ];
  if (sessions.length === 0) {
    lines.push("", "No session answered in that time.");
    lines.push(...formatAgentLaunches(launches), ...formatAgentRecord(agents));
    return lines.join("\n");
  }
  const recorded = agentsBySession(agents);
  const main: Record<string, number> = {};
  const replies: Record<string, number> = {};
  let mainSessions = 0;
  let subagents = 0;
  let withSubagents = 0;
  for (const session of sessions) {
    lines.push(
      "",
      `${session.cwd === null ? session.project : tildify(session.cwd, home)}  session ${session.session.slice(0, 8)}${session.archived ? " (a removed crew session, from the kit's crew archive)" : ""}`,
    );
    lines.push(`  main session, replies by model: ${counts(session.main) || "none in the window"}`);
    if (session.subagents === 0) {
      lines.push("  subagents: none in the window");
    } else {
      lines.push(`  ${session.subagents} subagents, launched as: ${counts(session.launched)}`);
      lines.push(`  subagent replies by model: ${counts(session.replies) || "none in the window"}`);
      const { opus, total } = share(session.replies);
      lines.push(`  subagents on Opus: ${opus} of ${total} replies (${percent(opus, total)})`);
      withSubagents += 1;
    }
    const own = recorded.get(session.session) ?? [];
    if (own.length > 0) {
      const totals = agentRecordTotals(own);
      lines.push(
        `  agents on record: ${own.length} — by type: ${counts(totals.byType)}`,
        `  agents' replies by model: ${counts(totals.byModel)}; on Opus: ${totals.opus} of ${totals.replies} (${percent(totals.opus, totals.replies)})`,
        `  agents' tokens: ${tokens(totals.tokens)}; cost ${costText(totals.usd, totals.unpriced)}`,
      );
    }
    if (Object.keys(session.main).length > 0) mainSessions += 1;
    subagents += session.subagents;
    add(main, session.main);
    add(replies, session.replies);
  }
  const { opus, total } = share(replies);
  lines.push(
    "",
    `Main sessions: ${plural(mainSessions, "session")}; replies by model: ${counts(main) || "none"}`,
    `Subagents: ${subagents} in ${plural(withSubagents, "session")}; replies by model: ${counts(replies) || "none"}; on Opus: ${opus} of ${total} replies (${percent(opus, total)})`,
    ...formatAgentRecord(agents),
    ...formatAgentLaunches(launches),
  );
  return lines.join("\n");
}

/** Parses `usage`'s options; an error in words on a wrong one. */
export function usageOptions(
  args: string[],
): { error: string } | { hours: number; json: boolean; project: null | string } {
  let hours = 6;
  let json = false;
  let project: null | string = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--hours" && value !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0)
        return { error: `--hours wants a number above 0, not "${value}"` };
      hours = parsed;
      index += 1;
    } else if (arg === "--project" && value !== undefined) {
      project = value;
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      return { error: `Unknown option: ${arg ?? ""}` };
    }
  }
  return { hours, json, project };
}

/** Runs `cc-smart-dev-kit usage`. */
export function runUsage(paths: CliPaths, args: string[], nowMs: number): number {
  const options = usageOptions(args);
  if ("error" in options) {
    console.error(
      `${options.error}\n\nUsage: cc-smart-dev-kit usage [--hours <n>] [--project <folder or name>] [--json]`,
    );
    return 2;
  }
  const projectsDir = paths.projectsDir;
  const sinceMs = nowMs - options.hours * 3_600_000;
  const sessions = collectUsage(projectsDir, { project: options.project, sinceMs }, paths.stateDir);
  const recorded = readAgentUsage(agentUsageFile(paths.stateDir), sinceMs);
  // `--project` filters the sessions the transcripts give. The record holds a session id and
  // no folder, so under a project filter it counts only the sessions that survived: an agent
  // whose transcript was cleaned up cannot be placed in a project.
  const agents =
    options.project === null
      ? recorded
      : recorded.filter((agent) => sessions.some((session) => session.session === agent.session));
  if (options.json) {
    console.log(JSON.stringify(usageJson(sessions, agents, options.hours), null, 2));
    return 0;
  }
  console.log(
    [
      formatUsage(
        sessions,
        options.hours,
        projectsDir,
        paths.home,
        readAgentLaunches(agentLaunchesFile(paths.stateDir), sinceMs),
        agents,
      ),
      ...formatSafetyChecks(readSafetyChecks(paths.safetyChecksFile), nowMs),
    ].join("\n"),
  );
  return 0;
}
