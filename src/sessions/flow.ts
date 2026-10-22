/**
 * The flow report's reader: what this machine's Claude Code sessions did in a window, read from
 * Claude Code's own transcripts. Counts, times, tool names and hook names only — never a word of
 * a message (`usage.ts` follows the same rule).
 *
 * **Where the records are.** A session is `<config>/projects/<project folder>/<session id>.jsonl`;
 * each subagent of it is `<project folder>/<session id>/subagents/agent-<id>.jsonl`
 * (the same layout `usage.ts` reads, and the same file walk and project match). Claude Code
 * appends one JSON object per line; a line's `type` says what it holds. The fields this reader
 * relies on are **undocumented**: their contract rows are marked "seen, may change"
 * (`docs/claude-code-contract.md`). Every read is defensive: a missing, renamed or wrongly
 * typed field skips that record and counts it in "records skipped" — never a guess, never a crash.
 *
 * **What it measures** (one section per measure, below):
 * - agent launches per assistant reply, and the parallel ratio: lines that share `message.id`
 *   are one reply; a `tool_use` named `Agent` or `Task` is a launch; a reply with two or more
 *   launches is parallel. "Most at once" comes from the subagent transcripts' first and last
 *   timestamps.
 * - minutes blocked on permission prompts: a `user` line's `permissionDecision.source` starting
 *   with `user` (the person allowed or refused) is the moment the wait ended; the wait is that
 *   timestamp minus the assistant line's timestamp for the same `tool_use_id`. It is an **upper
 *   bound**, because the tool's own line may be written before Claude Code starts the prompt.
 *   The asker is the PreToolUse hook whose `hook_success` attachment carries the same
 *   `toolUseID` and an `ask` answer, named from its `command`'s script (`merge-guard`,
 *   `git-guard`, …); with no such hook, Claude Code's own prompt. `AskUserQuestion` and
 *   `ExitPlanMode` are questions, counted apart.
 * - auto-mode blocks by rule label: a tool result with `permissionDecision.decision: "reject"`
 *   and `source: "config"` is auto mode's refusal; its label is the bracketed rule name in the
 *   result text (`[Merge Without Review]`) — the label only, never the text — else the
 *   `reasonType` (`classifier`, `rule`, `safetyCheck`, `other`), else `config`.
 * - waits on background work and idle time: a `system/turn_duration` line ends a turn; the next
 *   `user` line that carries `turnOrigin` says what ended the wait. `human` means the session
 *   sat idle until the person wrote; any other origin after a turn with
 *   `pendingBackgroundAgentCount` > 0 is a wait on background work, grouped by that origin.
 * - compactions: `system/compact_boundary`, with `compactMetadata.trigger`, `preTokens` and
 *   `postTokens`.
 * - merges that asked: a `Bash` call whose command is `gh pr merge` and whose result came after
 *   a person's answer, with the asker (and, when the guards' ask log is there, its reason kind).
 *
 * **The ask log.** The hook frame writes each guard's ask to `guard-asks.jsonl`
 * (`{at, hook, kind, tool_use_id, session_id}`, a later phase). When that file exists it is
 * preferred to the attachment reading for the asker and the kind. It is written before the
 * tool's result, so the run that counts a prompt already has it.
 *
 * **The cache.** A report over a week of transcripts reads a lot (this machine: about 1.2 GB).
 * So each transcript's parse position lives in `<stateDir>/flow/<project>.json` (mode 0600,
 * written atomically through `atomicWrite`): its inode, size and mtime, the byte offset after
 * the last whole line, the open state (pending tool calls, the last reply, the last turn end)
 * and hourly buckets for eight days. A file that grew is read from its offset only; one that
 * shrank or was replaced starts again (and resets that session's buckets, which came from it).
 * The cache is derived data: last writer wins, no lock, and a failed write never fails the report.
 *
 * **What a transcript does not carry is said, not guessed.** A measure that needs a record kind
 * the version never wrote (`turn_duration`, `permissionDecision`, a hook's ask) is `null` in the
 * report, which prints "not recorded by this version".
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { entries, matches } from "../cli/usage";
import { atomicWrite } from "../setup/write";

/** The paths the report reads and writes; `CliPaths` satisfies it. */
export interface FlowPaths {
  claudeConfigDir: string;
  home: string;
  stateDir: string;
}

export interface FlowOptions {
  /** Milliseconds since the epoch: nothing older counts, and nothing at or after `nowMs`. */
  sinceMs: number;
  /** Only sessions in this project: its folder, its last part, or the session's `cwd`. */
  project: null | string;
  /** Only this session: its id, or a prefix of at least 4 characters (the report prints 8). */
  session: null | string;
  /** The window's end, and the clock the cache is pruned by. Default: `Date.now()`. */
  nowMs?: number;
}

/** One asker's prompts: how many, and how long they blocked. */
export interface AskerCount {
  count: number;
  ms: number;
}

/** What one session did in the window. */
export interface SessionFlow {
  project: string;
  session: string;
  cwd: null | string;
  firstAt: number | null;
  lastAt: number | null;
  /** The turns' own recorded time; `null` when the version wrote no `turn_duration`. */
  activeMs: number | null;
  agents: {
    launches: number;
    replies: number;
    /** Replies with two or more launches. */
    repliesParallel: number;
    /** Launches that were in such a reply. */
    launchesParallel: number;
    /** `launchesParallel / launches`; 0 when there were no launches. */
    parallelRatio: number;
    /** Overlap of the subagent transcripts' spans, clipped to the window. */
    mostAtOnce: number;
  };
  /** `null` when the version wrote no `permissionDecision` field. */
  prompts: null | {
    count: number;
    totalMs: number;
    longestMs: number;
    /** By asker: a hook's name, or `Claude Code` for its own prompt. */
    byAsker: Record<string, AskerCount>;
  };
  questions: { askUserQuestion: number; exitPlanMode: number };
  /** `null` when the version wrote no `turn_duration`. */
  background: null | { count: number; totalMs: number; byOrigin: Record<string, number> };
  /** `null` when the version wrote no `turn_duration`. */
  idle: null | { count: number; totalMs: number };
  compactions: {
    count: number;
    byTrigger: Record<string, number>;
    /** The tokens the boundaries recorded; `null` when they recorded none. */
    tokens: null | { post: number; pre: number };
  };
  /** Auto mode's refusals, by rule label. */
  autoModeBlocks: Record<string, number>;
  merges: { count: number; byAsker: Record<string, number>; byReason: Record<string, number> };
  /** Records this session's transcripts held that could not be read. */
  skipped: number;
}

/** A call a guard (or Claude Code) asked about, with no answer in the transcript yet. */
export interface OpenWait {
  project: string;
  session: string;
  cwd: null | string;
  /** When the ask happened. */
  at: number;
  /** The hook that asked, or `Claude Code` for its own prompt. */
  asker: string;
  /** The log's `kind` for the ask, when the ask log has one. */
  kind: null | string;
  /** The tool the ask is about: `Bash`, `AskUserQuestion`, … */
  tool: string;
}

/** One hour of the report's window: what every session it counts did in it. */
export interface FlowHour {
  /** Agents launched. */
  launches: number;
  /** Time blocked on permission prompts answered in this hour (ms). */
  promptMs: number;
  /** Permission prompts answered in this hour. */
  prompts: number;
  replies: number;
  /** The hour's start, in ms. */
  t: number;
}

/** The whole report: the sessions, the totals, the open waits, and what could not be read. */
export interface FlowReport {
  sinceMs: number;
  untilMs: number;
  sessions: SessionFlow[];
  totals: {
    sessions: number;
    activeMs: number | null;
    agents: {
      launches: number;
      replies: number;
      repliesParallel: number;
      launchesParallel: number;
      parallelRatio: number;
      mostAtOnce: number;
    };
    prompts: null | {
      count: number;
      totalMs: number;
      longestMs: number;
      byAsker: Record<string, AskerCount>;
    };
    questions: { askUserQuestion: number; exitPlanMode: number };
    background: null | { count: number; totalMs: number; byOrigin: Record<string, number> };
    idle: null | { count: number; totalMs: number };
    compactions: {
      count: number;
      byTrigger: Record<string, number>;
      tokens: null | { post: number; pre: number };
    };
    autoModeBlocks: Record<string, number>;
    merges: { count: number; byAsker: Record<string, number>; byReason: Record<string, number> };
    skipped: number;
  };
  /**
   * The window hour by hour, oldest first: every hour it touches, an empty one too, summed over
   * the sessions the report counts (the cache's own hourly buckets).
   */
  hours: FlowHour[];
  open: OpenWait[];
  /** Transcript records that could not be read, and ask-log lines that could not be read. */
  skipped: { askLog: number; records: number };
  /** The measures this version wrote none of, in words for the report's footer. */
  missing: string[];
}

/** The cache keeps hourly buckets this many days back; a longer window is refused. */
export const FLOW_DAYS_KEPT = 8;
/** A session quiet this long leaves the cache: Claude Code removes its transcript soon after. */
export const CACHE_KEEP_DAYS = 30;
/** A call asked more than this long ago is not "waiting on you now": its session is gone. */
export const OPEN_WAIT_MAX_AGE_MS = 24 * 3_600_000;
/** The ask log the hook frame writes (a later phase): `<stateDir>/guard-asks.jsonl`. */
export const GUARD_ASKS_FILE = "guard-asks.jsonl";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Raise this whenever the buckets' meaning changes: a cache of another version is ignored. */
const CACHE_VERSION = 2;
const CHUNK_BYTES = 4 * 1024 * 1024;
const NO_ASKER = "Claude Code";
/** The `tool_use` names that launch an agent. */
const LAUNCH_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);
/** The `tool_use` names that ask the person a question. */
const QUESTION_TOOLS: ReadonlySet<string> = new Set(["AskUserQuestion", "ExitPlanMode"]);
/** A `gh pr merge` command anywhere in a shell command line. */
const MERGE_COMMAND = /(^|[\s;&|()])gh\s+pr\s+merge\b/;
/** A rule label in brackets in an auto-mode refusal, e.g. `[Merge Without Review]`. */
const RULE_LABEL = /\[([A-Z][A-Za-z0-9'&.-]*(?: [A-Za-z0-9'&.-]+){0,4})\]/;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): null | string {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberField(value: unknown): null | number {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A record's time in ms; `null` when it carries none (the record cannot be placed). */
function timeOf(record: Record<string, unknown>): null | number {
  const stamp = stringField(record.timestamp);
  if (stamp === null) return null;
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : null;
}

/** The hour a time belongs to, as the cache keys it. */
function hourKey(ms: number): string {
  return String(Math.floor(ms / HOUR_MS));
}

/** One hour of one session, as the cache keeps it. */
interface HourBucket {
  askUserQuestion: number;
  autoMode: Record<string, number>;
  backgroundByOrigin: Record<string, number>;
  backgroundCount: number;
  backgroundMs: number;
  byAsker: Record<string, AskerCount>;
  compactByTrigger: Record<string, number>;
  compactPostTokens: number;
  compactPreTokens: number;
  compactions: number;
  /** The turns' recorded durations in this hour (ms). */
  durationMs: number;
  exitPlanMode: number;
  idleCount: number;
  idleMs: number;
  launches: number;
  launchesParallel: number;
  merges: number;
  mergesByAsker: Record<string, number>;
  mergesByReason: Record<string, number>;
  promptLongestMs: number;
  promptMs: number;
  prompts: number;
  replies: number;
  repliesParallel: number;
}

/** An empty bucket: one hour of one session. */
function emptyBucket(): HourBucket {
  return {
    askUserQuestion: 0,
    autoMode: {},
    backgroundByOrigin: {},
    backgroundCount: 0,
    backgroundMs: 0,
    byAsker: {},
    compactByTrigger: {},
    compactPostTokens: 0,
    compactPreTokens: 0,
    compactions: 0,
    durationMs: 0,
    exitPlanMode: 0,
    idleCount: 0,
    idleMs: 0,
    launches: 0,
    launchesParallel: 0,
    merges: 0,
    mergesByAsker: {},
    mergesByReason: {},
    promptLongestMs: 0,
    promptMs: 0,
    prompts: 0,
    replies: 0,
    repliesParallel: 0,
  };
}

/** A tool call with no result yet: what an open wait is made of. */
interface PendingTool {
  at: number;
  merge: boolean;
  name: string;
}

/** A hook's ask seen as an attachment, before the call's result. */
interface SeenAsk {
  at: number;
  hook: string;
  kind: null | string;
}

/** One transcript's parse position and open state. */
interface CachedTranscript {
  /** The first and last timestamps of its lines: the span "most at once" overlaps. */
  endAt: number | null;
  inode: number;
  mtimeMs: number;
  /** Byte offset after the last whole line read. */
  offset: number;
  /** The last assistant reply seen, and its launches so far: a reply can span appends. */
  replyId: null | string;
  replyLaunches: number;
  size: number;
  startAt: number | null;
  /** The turn that ended and nothing has answered yet. */
  turnEnd: null | { at: number; background: number };
  pending: Record<string, PendingTool>;
  asks: Record<string, SeenAsk>;
}

/** One session's cache entry. */
interface CachedSession {
  cwd: null | string;
  firstAt: number | null;
  hours: Record<string, HourBucket>;
  lastAt: number | null;
  /** The record kinds this session's transcripts carried (for "not recorded by this version"). */
  seen: { ask: boolean; compact: boolean; permission: boolean; turn: boolean; turnMs: boolean };
  skipped: number;
  transcripts: Record<string, CachedTranscript>;
}

interface FlowCache {
  project: string;
  sessions: Record<string, CachedSession>;
  version: number;
}

/** A fresh session entry: nothing seen, nothing counted. */
function emptySession(): CachedSession {
  return {
    cwd: null,
    firstAt: null,
    hours: {},
    lastAt: null,
    seen: { ask: false, compact: false, permission: false, turn: false, turnMs: false },
    skipped: 0,
    transcripts: {},
  };
}

function emptyTranscript(): CachedTranscript {
  return {
    asks: {},
    endAt: null,
    inode: 0,
    mtimeMs: 0,
    offset: 0,
    pending: {},
    replyId: null,
    replyLaunches: 0,
    size: 0,
    startAt: null,
    turnEnd: null,
  };
}

function readCounts(record: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    const count = numberField(value);
    if (count !== null) out[key] = count;
  }
  return out;
}

function readAskers(record: Record<string, unknown>): Record<string, AskerCount> {
  const out: Record<string, AskerCount> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!isJsonObject(value)) continue;
    const count = numberField(value.count);
    const ms = numberField(value.ms);
    if (count === null || ms === null) continue;
    out[key] = { count, ms };
  }
  return out;
}

/** One cached hour, read defensively: a wrong field is 0, never a crash. */
function readBucket(bucket: Record<string, unknown>): HourBucket {
  const out = emptyBucket();
  for (const key of Object.keys(out) as (keyof HourBucket)[]) {
    if (typeof out[key] === "number") {
      const value = numberField(bucket[key]);
      if (value !== null) (out[key] as number) = value;
    }
  }
  for (const [key, record] of Object.entries(bucket)) {
    if (!isJsonObject(record)) continue;
    if (key === "byAsker") out.byAsker = readAskers(record);
    if (key === "autoMode") out.autoMode = readCounts(record);
    if (key === "backgroundByOrigin") out.backgroundByOrigin = readCounts(record);
    if (key === "compactByTrigger") out.compactByTrigger = readCounts(record);
    if (key === "mergesByAsker") out.mergesByAsker = readCounts(record);
    if (key === "mergesByReason") out.mergesByReason = readCounts(record);
  }
  return out;
}

/** Reads a cache file defensively: anything unexpected starts the project's cache again. */
function parseCache(text: string, project: string): FlowCache {
  const fresh: FlowCache = { project, sessions: {}, version: CACHE_VERSION };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fresh;
  }
  if (!isJsonObject(parsed) || parsed.version !== CACHE_VERSION) return fresh;
  if (!isJsonObject(parsed.sessions)) return fresh;
  for (const [id, value] of Object.entries(parsed.sessions)) {
    if (!isJsonObject(value) || !isJsonObject(value.hours) || !isJsonObject(value.transcripts)) {
      continue;
    }
    if (!isJsonObject(value.seen)) continue;
    const session = emptySession();
    session.cwd = stringField(value.cwd);
    session.firstAt = numberField(value.firstAt);
    session.lastAt = numberField(value.lastAt);
    session.skipped = numberField(value.skipped) ?? 0;
    session.seen = {
      ask: value.seen.ask === true,
      compact: value.seen.compact === true,
      permission: value.seen.permission === true,
      turn: value.seen.turn === true,
      turnMs: value.seen.turnMs === true,
    };
    for (const [hour, bucket] of Object.entries(value.hours)) {
      if (isJsonObject(bucket)) session.hours[hour] = readBucket(bucket);
    }
    for (const [name, transcript] of Object.entries(value.transcripts)) {
      if (!isJsonObject(transcript)) continue;
      const entry = emptyTranscript();
      entry.offset = numberField(transcript.offset) ?? 0;
      entry.inode = numberField(transcript.inode) ?? 0;
      entry.size = numberField(transcript.size) ?? 0;
      entry.mtimeMs = numberField(transcript.mtimeMs) ?? 0;
      entry.startAt = numberField(transcript.startAt);
      entry.endAt = numberField(transcript.endAt);
      entry.replyId = stringField(transcript.replyId);
      entry.replyLaunches = numberField(transcript.replyLaunches) ?? 0;
      entry.turnEnd = isJsonObject(transcript.turnEnd)
        ? {
            at: numberField(transcript.turnEnd.at) ?? 0,
            background: numberField(transcript.turnEnd.background) ?? 0,
          }
        : null;
      if (isJsonObject(transcript.pending)) {
        for (const [toolId, tool] of Object.entries(transcript.pending)) {
          if (!isJsonObject(tool) || numberField(tool.at) === null) continue;
          entry.pending[toolId] = {
            at: numberField(tool.at) ?? 0,
            merge: tool.merge === true,
            name: stringField(tool.name) ?? "a tool",
          };
        }
      }
      if (isJsonObject(transcript.asks)) {
        for (const [toolId, ask] of Object.entries(transcript.asks)) {
          if (!isJsonObject(ask) || numberField(ask.at) === null) continue;
          entry.asks[toolId] = {
            at: numberField(ask.at) ?? 0,
            hook: stringField(ask.hook) ?? NO_ASKER,
            kind: stringField(ask.kind),
          };
        }
      }
      session.transcripts[name] = entry;
    }
    fresh.sessions[id] = session;
  }
  return fresh;
}

/** Adds `count` to a record's key. */
function addTo(into: Record<string, number>, key: string, count = 1): void {
  into[key] = (into[key] ?? 0) + count;
}

/** The hook's name from the command that ran it: the script's base name, no extension. */
export function hookNameFromCommand(command: null | string): null | string {
  if (command === null) return null;
  const words = command.replace(/["']/g, "").trim().split(/\s+/);
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word === undefined || word.startsWith("-")) continue;
    const base = word.split(/[\\/]/).pop() ?? "";
    const name = base.replace(/\.(c?js|mjs|ts)$/, "");
    if (name !== "" && name !== "bun" && name !== "cc-smart-dev-kit-bun.sh") return name;
  }
  return null;
}

/** One ask, as either the log or an attachment records it. */
export interface AskRecord {
  at: null | number;
  hook: string;
  kind: null | string;
}

/** The ask log's entries by tool-use id, with the count of lines that could not be read. */
export function readAskLog(file: string): { asks: Map<string, AskRecord>; skipped: number } {
  const asks = new Map<string, AskRecord>();
  let skipped = 0;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // No log (a version before the frame wrote one): the attachment reading answers.
    return { asks, skipped };
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!isJsonObject(entry)) {
      skipped += 1;
      continue;
    }
    const id = stringField(entry.tool_use_id);
    const hook = stringField(entry.hook);
    if (id === null || hook === null) {
      skipped += 1;
      continue;
    }
    let at = numberField(entry.at);
    if (at === null && typeof entry.at === "string") {
      const parsed = Date.parse(entry.at);
      if (Number.isFinite(parsed)) at = parsed;
    }
    asks.set(id, { at, hook, kind: stringField(entry.kind) });
  }
  return { asks, skipped };
}

/** Everything one run of the reader carries besides the cache: the log and the clocks. */
interface ReadContext {
  askLog: Map<string, AskRecord>;
  nowMs: number;
  sinceMs: number;
  untilMs: number;
}

/** The label an auto-mode refusal is counted under: the rule's bracket, else its reason. */
function blockLabel(result: Record<string, unknown>, record: Record<string, unknown>): string {
  const decision = record.permissionDecision;
  const reasonType = isJsonObject(decision) ? stringField(decision.reasonType) : null;
  const content = result.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((block) => isJsonObject(block) && block.type === "text")
            .map((block) => (isJsonObject(block) ? String(block.text ?? "") : ""))
            .join(" ")
        : "";
  const label = RULE_LABEL.exec(text);
  if (label?.[1] !== undefined) return label[1];
  return reasonType ?? "config";
}

/** One record's time and the session's activity span. `null`: a record with no time. */
function place(
  record: Record<string, unknown>,
  session: CachedSession,
  transcript: CachedTranscript,
  context: ReadContext,
): null | number {
  const ts = timeOf(record);
  if (ts === null) {
    session.skipped += 1;
    return null;
  }
  const cwd = stringField(record.cwd);
  if (cwd !== null && session.cwd === null) session.cwd = cwd;
  if (ts >= context.untilMs) return ts;
  session.lastAt = Math.max(session.lastAt ?? ts, ts);
  session.firstAt = Math.min(session.firstAt ?? ts, ts);
  transcript.startAt = Math.min(transcript.startAt ?? ts, ts);
  transcript.endAt = Math.max(transcript.endAt ?? ts, ts);
  return ts;
}

/** Applies one record to a session's cache. `subagent`: this transcript is a subagent's own. */
function apply(
  record: Record<string, unknown>,
  session: CachedSession,
  transcript: CachedTranscript,
  subagent: boolean,
  context: ReadContext,
): void {
  const ts = place(record, session, transcript, context);
  if (ts === null) return;
  // The cache keeps eight days of buckets; an event older than that is gone for good.
  if (ts < context.nowMs - FLOW_DAYS_KEPT * DAY_MS || ts >= context.untilMs) return;
  const bucket = session.hours[hourKey(ts)] ?? emptyBucket();
  session.hours[hourKey(ts)] = bucket;
  const type = record.type;
  if (type === "assistant") applyAssistant(record, session, transcript, bucket, subagent, ts);
  else if (type === "user") applyUser(record, session, transcript, bucket, context, ts);
  else if (type === "system") applySystem(record, session, transcript, bucket, ts);
  else if (type === "attachment") applyAttachment(record, session, transcript, ts);
}

function applyAssistant(
  record: Record<string, unknown>,
  session: CachedSession,
  transcript: CachedTranscript,
  bucket: HourBucket,
  subagent: boolean,
  ts: number,
): void {
  // An older Claude Code wrote a subagent's lines into the main session's file.
  if (!subagent && record.isSidechain === true) return;
  const message = record.message;
  if (!isJsonObject(message)) {
    session.skipped += 1;
    return;
  }
  const content = message.content;
  if (!Array.isArray(content)) {
    session.skipped += 1;
    return;
  }
  const id = stringField(message.id) ?? stringField(record.uuid);
  let launches = 0;
  for (const block of content) {
    if (!isJsonObject(block) || block.type !== "tool_use") continue;
    const name = stringField(block.name);
    if (name === null) continue;
    if (name === "AskUserQuestion") bucket.askUserQuestion += 1;
    else if (name === "ExitPlanMode") bucket.exitPlanMode += 1;
    if (LAUNCH_TOOLS.has(name)) launches += 1;
    const toolId = stringField(block.id);
    if (toolId !== null) {
      const input = isJsonObject(block.input) ? block.input : {};
      const command = stringField(input.command);
      transcript.pending[toolId] = {
        at: ts,
        merge: name === "Bash" && command !== null && MERGE_COMMAND.test(command),
        name,
      };
    }
  }
  if (launches === 0) {
    if (id !== null && transcript.replyId !== id) {
      // A reply with no launch still counts: the parallel ratio is launches over replies.
      transcript.replyId = id;
      transcript.replyLaunches = 0;
      bucket.replies += 1;
    }
    return;
  }
  if (id === null) {
    // No reply id: the launch counts, but it cannot be grouped into a reply.
    session.skipped += 1;
    bucket.launches += launches;
    return;
  }
  if (transcript.replyId !== id) {
    transcript.replyId = id;
    transcript.replyLaunches = 0;
    bucket.replies += 1;
  }
  for (let index = 0; index < launches; index += 1) {
    bucket.launches += 1;
    transcript.replyLaunches += 1;
    if (transcript.replyLaunches === 2) {
      // The first launch is in a parallel reply too: both count from the second on.
      bucket.launchesParallel += 2;
      bucket.repliesParallel += 1;
    } else if (transcript.replyLaunches > 2) {
      bucket.launchesParallel += 1;
    }
  }
}

/** The next user line's `turnOrigin` closes a turn: idle time, or a wait on background work. */
function closeTurn(
  transcript: CachedTranscript,
  bucket: HourBucket,
  ts: number,
  origin: string,
): void {
  const end = transcript.turnEnd;
  if (end === null) return;
  const wait = Math.max(0, ts - end.at);
  if (end.background > 0) {
    bucket.backgroundCount += 1;
    bucket.backgroundMs += wait;
    addTo(bucket.backgroundByOrigin, origin);
  } else if (origin === "human") {
    bucket.idleCount += 1;
    bucket.idleMs += wait;
  }
  transcript.turnEnd = null;
}

function applyUser(
  record: Record<string, unknown>,
  session: CachedSession,
  transcript: CachedTranscript,
  bucket: HourBucket,
  context: ReadContext,
  ts: number,
): void {
  const origin = stringField(record.turnOrigin);
  if (origin !== null) closeTurn(transcript, bucket, ts, origin);
  const decision = record.permissionDecision;
  const source = isJsonObject(decision) ? stringField(decision.source) : null;
  if (isJsonObject(decision)) session.seen.permission = true;
  const content = isJsonObject(record.message) ? record.message.content : null;
  const blocks = Array.isArray(content) ? content : [];
  if (source?.startsWith("user")) {
    for (const block of blocks) {
      if (!isJsonObject(block) || block.type !== "tool_result") continue;
      const toolId = stringField(block.tool_use_id);
      if (toolId === null) {
        session.skipped += 1;
        continue;
      }
      const pending = transcript.pending[toolId];
      if (pending === undefined) {
        // The call's own line is older than the cache keeps: the wait cannot be timed.
        session.skipped += 1;
        continue;
      }
      const waiting = Math.max(0, ts - pending.at);
      const logged = context.askLog.get(toolId);
      const seen = transcript.asks[toolId];
      const asker = logged?.hook ?? seen?.hook ?? NO_ASKER;
      const kind = logged?.kind ?? seen?.kind ?? null;
      bucket.prompts += 1;
      bucket.promptMs += waiting;
      bucket.promptLongestMs = Math.max(bucket.promptLongestMs, waiting);
      const askerCount = bucket.byAsker[asker] ?? { count: 0, ms: 0 };
      bucket.byAsker[asker] = askerCount;
      askerCount.count += 1;
      askerCount.ms += waiting;
      if (pending.merge) {
        bucket.merges += 1;
        addTo(bucket.mergesByAsker, asker);
        addTo(bucket.mergesByReason, kind ?? "not recorded");
      }
    }
  }
  if (isJsonObject(decision) && decision.decision === "reject" && source === "config") {
    const result = blocks.find((block) => isJsonObject(block) && block.type === "tool_result");
    if (isJsonObject(result)) addTo(bucket.autoMode, blockLabel(result, record));
  }
  for (const block of blocks) {
    if (!isJsonObject(block) || block.type !== "tool_result") continue;
    const toolId = stringField(block.tool_use_id);
    if (toolId === null) continue;
    delete transcript.pending[toolId];
    delete transcript.asks[toolId];
  }
}

function applySystem(
  record: Record<string, unknown>,
  session: CachedSession,
  transcript: CachedTranscript,
  bucket: HourBucket,
  ts: number,
): void {
  if (record.subtype === "turn_duration") {
    session.seen.turn = true;
    transcript.turnEnd = {
      at: ts,
      background: numberField(record.pendingBackgroundAgentCount) ?? 0,
    };
    const duration = numberField(record.durationMs);
    if (duration === null) {
      session.skipped += 1;
    } else {
      session.seen.turnMs = true;
      bucket.durationMs += duration;
    }
    return;
  }
  if (record.subtype === "compact_boundary") {
    session.seen.compact = true;
    const meta = isJsonObject(record.compactMetadata) ? record.compactMetadata : {};
    bucket.compactions += 1;
    addTo(bucket.compactByTrigger, stringField(meta.trigger) ?? "unknown");
    bucket.compactPreTokens += numberField(meta.preTokens) ?? 0;
    bucket.compactPostTokens += numberField(meta.postTokens) ?? 0;
  }
}

function applyAttachment(
  record: Record<string, unknown>,
  session: CachedSession,
  transcript: CachedTranscript,
  ts: number,
): void {
  const attachment = record.attachment;
  if (!isJsonObject(attachment) || attachment.type !== "hook_success") return;
  const stdout = stringField(attachment.stdout);
  if (stdout === null || !stdout.includes('"permissionDecision":"ask"')) return;
  const toolId = stringField(attachment.toolUseID);
  if (toolId === null) {
    session.skipped += 1;
    return;
  }
  const hook =
    hookNameFromCommand(stringField(attachment.command)) ??
    stringField(attachment.hookName) ??
    "a hook";
  transcript.asks[toolId] = { at: ts, hook, kind: null };
  session.seen.ask = true;
}

/** One whole line of a transcript, filtered before the parse to keep a first read affordable. */
function neededLine(line: string): boolean {
  if (line.length < 10) return false;
  // Claude Code's own request bookkeeping (often hundreds of KB a line): never a record here.
  if (line.includes('"type":"api-request"')) return false;
  if (line.includes('"type":"attachment"')) {
    // The one attachment this reader uses: a hook's ask. Its answer sits escaped in `stdout`.
    return line.includes("permissionDecision");
  }
  return (
    line.includes('"type":"assistant"') ||
    line.includes('"type":"user"') ||
    line.includes('"type":"system"')
  );
}

/**
 * Forgets everything a session's transcripts contributed, and their parse positions with it, so
 * this run reads every one of them from the start again. Used when a transcript was replaced or
 * shrank: its old lines are not the file's content any more, and the session's buckets cannot be
 * separated from them.
 */
function resetSession(session: CachedSession): void {
  session.hours = {};
  session.skipped = 0;
  session.seen = { ask: false, compact: false, permission: false, turn: false, turnMs: false };
  for (const transcript of Object.values(session.transcripts)) {
    transcript.offset = 0;
    transcript.inode = 0;
    transcript.size = -1;
    transcript.mtimeMs = -1;
    transcript.pending = {};
    transcript.asks = {};
    transcript.replyId = null;
    transcript.replyLaunches = 0;
    transcript.turnEnd = null;
    transcript.startAt = null;
    transcript.endAt = null;
  }
}

/** Whether a transcript this cache already read is not the same file any more. */
function replaced(file: string, transcript: CachedTranscript): boolean {
  if (transcript.inode === 0) return false;
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
  } catch {
    return false;
  }
  return Number(stat.ino) !== transcript.inode || stat.size < transcript.offset;
}

/**
 * Reads one transcript from its cached offset, applying each whole line. Returns whether
 * anything was read (the cache needs writing then). The caller has already reset the session
 * when a transcript was replaced.
 */
function readTranscriptFile(
  file: string,
  session: CachedSession,
  transcript: CachedTranscript,
  subagent: boolean,
  context: ReadContext,
): boolean {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
  } catch {
    // Gone since the listing.
    return false;
  }
  const unchanged =
    Number(stat.ino) === transcript.inode &&
    stat.size === transcript.size &&
    stat.mtimeMs === transcript.mtimeMs;
  if (unchanged) return false;
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return false;
  }
  let readAnything = false;
  try {
    let absolute = transcript.offset;
    let carry = Buffer.alloc(0);
    const chunk = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      let read: number;
      try {
        read = readSync(fd, chunk, 0, CHUNK_BYTES, absolute + carry.length);
      } catch {
        // A read that failed: the position stays, so the next run reads the rest.
        break;
      }
      if (read <= 0) break;
      readAnything = true;
      // `carry` is a view on `chunk`, so take a copy before the next read fills it again.
      const data =
        carry.length === 0
          ? Buffer.from(chunk.subarray(0, read))
          : Buffer.concat([carry, chunk.subarray(0, read)]);
      const whole = data.lastIndexOf(10) + 1;
      const text = data.subarray(0, whole).toString("utf8");
      for (const line of text.split("\n")) {
        if (line.trim() === "" || !neededLine(line)) continue;
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          session.skipped += 1;
          continue;
        }
        if (!isJsonObject(record)) {
          session.skipped += 1;
          continue;
        }
        apply(record, session, transcript, subagent, context);
      }
      absolute += whole;
      carry = Buffer.from(data.subarray(whole));
      if (read < CHUNK_BYTES) break;
    }
    // Only a full pass marks the file as read: a failed read is tried again next time.
    transcript.offset = absolute;
    transcript.inode = Number(stat.ino);
    transcript.size = stat.size;
    transcript.mtimeMs = stat.mtimeMs;
  } finally {
    closeSync(fd);
  }
  return readAnything;
}

/** Drops the buckets and open state older than the kept window. */
function prune(session: CachedSession, nowMs: number): boolean {
  const cutoff = nowMs - FLOW_DAYS_KEPT * DAY_MS;
  let changed = false;
  for (const hour of Object.keys(session.hours)) {
    if (Number(hour) * HOUR_MS < cutoff) {
      delete session.hours[hour];
      changed = true;
    }
  }
  for (const transcript of Object.values(session.transcripts)) {
    for (const [id, tool] of Object.entries(transcript.pending)) {
      if (tool.at < cutoff) {
        delete transcript.pending[id];
        changed = true;
      }
    }
    for (const [id, ask] of Object.entries(transcript.asks)) {
      if (ask.at < cutoff) {
        delete transcript.asks[id];
        changed = true;
      }
    }
  }
  return changed;
}

/** Sums the buckets whose hour starts inside [since, until). */
function bucketsIn(session: CachedSession, context: ReadContext): HourBucket[] {
  const out: HourBucket[] = [];
  for (const [hour, bucket] of Object.entries(session.hours)) {
    const start = Number(hour) * HOUR_MS;
    if (start + HOUR_MS <= context.sinceMs || start >= context.untilMs) continue;
    out.push(bucket);
  }
  return out;
}

/** Every hour the window touches, oldest first, with the sessions' buckets of that hour added. */
function hoursOf(sessions: readonly CachedSession[], context: ReadContext): FlowHour[] {
  const first = Math.floor(context.sinceMs / HOUR_MS);
  const last = Math.ceil(context.untilMs / HOUR_MS);
  const hours: FlowHour[] = [];
  for (let hour = first; hour < last; hour += 1) {
    hours.push({ launches: 0, promptMs: 0, prompts: 0, replies: 0, t: hour * HOUR_MS });
  }
  for (const session of sessions) {
    for (const [key, bucket] of Object.entries(session.hours)) {
      const into = hours[Number(key) - first];
      if (into === undefined) continue;
      into.launches += bucket.launches;
      into.promptMs += bucket.promptMs;
      into.prompts += bucket.prompts;
      into.replies += bucket.replies;
    }
  }
  return hours;
}

/** The largest number of spans covering one instant; touching spans do not overlap. */
export function maxOverlap(spans: { end: number; start: number }[]): number {
  const edges: { at: number; delta: number }[] = [];
  for (const span of spans) {
    if (span.end < span.start) continue;
    edges.push({ at: span.start, delta: 1 });
    edges.push({ at: span.end, delta: -1 });
  }
  // An end sorts before a start at the same moment: touching is not overlapping.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let at = 0;
  let most = 0;
  for (const edge of edges) {
    at += edge.delta;
    most = Math.max(most, at);
  }
  return most;
}

/** Adds one bucket into another (the session's window, or the totals). */
function addBucket(into: HourBucket, from: HourBucket): void {
  into.askUserQuestion += from.askUserQuestion;
  into.backgroundCount += from.backgroundCount;
  into.backgroundMs += from.backgroundMs;
  into.compactPostTokens += from.compactPostTokens;
  into.compactPreTokens += from.compactPreTokens;
  into.compactions += from.compactions;
  into.durationMs += from.durationMs;
  into.exitPlanMode += from.exitPlanMode;
  into.idleCount += from.idleCount;
  into.idleMs += from.idleMs;
  into.launches += from.launches;
  into.launchesParallel += from.launchesParallel;
  into.merges += from.merges;
  into.promptLongestMs = Math.max(into.promptLongestMs, from.promptLongestMs);
  into.promptMs += from.promptMs;
  into.prompts += from.prompts;
  into.replies += from.replies;
  into.repliesParallel += from.repliesParallel;
  for (const [key, count] of Object.entries(from.autoMode)) addTo(into.autoMode, key, count);
  for (const [key, count] of Object.entries(from.backgroundByOrigin)) {
    addTo(into.backgroundByOrigin, key, count);
  }
  for (const [key, count] of Object.entries(from.compactByTrigger)) {
    addTo(into.compactByTrigger, key, count);
  }
  for (const [key, count] of Object.entries(from.mergesByAsker)) {
    addTo(into.mergesByAsker, key, count);
  }
  for (const [key, count] of Object.entries(from.mergesByReason)) {
    addTo(into.mergesByReason, key, count);
  }
  for (const [key, asker] of Object.entries(from.byAsker)) {
    const target = into.byAsker[key] ?? { count: 0, ms: 0 };
    into.byAsker[key] = target;
    target.count += asker.count;
    target.ms += asker.ms;
  }
}

/** One session's report, from its cached buckets inside the window. */
function sessionFlow(
  project: string,
  id: string,
  session: CachedSession,
  context: ReadContext,
): SessionFlow {
  const total = emptyBucket();
  for (const bucket of bucketsIn(session, context)) addBucket(total, bucket);
  const spans: { end: number; start: number }[] = [];
  for (const [name, transcript] of Object.entries(session.transcripts)) {
    if (!name.includes("/subagents/")) continue;
    if (transcript.startAt === null || transcript.endAt === null) continue;
    const start = Math.max(transcript.startAt, context.sinceMs);
    const end = Math.min(transcript.endAt, context.untilMs);
    if (end < start) continue;
    spans.push({ end, start });
  }
  const tokens = total.compactPreTokens + total.compactPostTokens;
  return {
    activeMs: session.seen.turnMs ? total.durationMs : null,
    agents: {
      launches: total.launches,
      launchesParallel: total.launchesParallel,
      mostAtOnce: maxOverlap(spans),
      parallelRatio: total.launches === 0 ? 0 : total.launchesParallel / total.launches,
      replies: total.replies,
      repliesParallel: total.repliesParallel,
    },
    autoModeBlocks: total.autoMode,
    background: session.seen.turn
      ? {
          byOrigin: total.backgroundByOrigin,
          count: total.backgroundCount,
          totalMs: total.backgroundMs,
        }
      : null,
    compactions: {
      byTrigger: total.compactByTrigger,
      count: total.compactions,
      tokens:
        total.compactions === 0 || tokens === 0
          ? null
          : { post: total.compactPostTokens, pre: total.compactPreTokens },
    },
    cwd: session.cwd,
    firstAt: session.firstAt,
    idle: session.seen.turn ? { count: total.idleCount, totalMs: total.idleMs } : null,
    lastAt: session.lastAt,
    merges: {
      byAsker: total.mergesByAsker,
      byReason: total.mergesByReason,
      count: total.merges,
    },
    project,
    prompts: session.seen.permission
      ? {
          byAsker: total.byAsker,
          count: total.prompts,
          longestMs: total.promptLongestMs,
          totalMs: total.promptMs,
        }
      : null,
    questions: {
      askUserQuestion: total.askUserQuestion,
      exitPlanMode: total.exitPlanMode,
    },
    session: id,
    skipped: session.skipped,
  };
}

/** The totals over every session in the window. */
function totalsOf(sessions: SessionFlow[]): FlowReport["totals"] {
  const totals: FlowReport["totals"] = {
    activeMs: null,
    agents: {
      launches: 0,
      launchesParallel: 0,
      mostAtOnce: 0,
      parallelRatio: 0,
      replies: 0,
      repliesParallel: 0,
    },
    autoModeBlocks: {},
    background: null,
    compactions: { byTrigger: {}, count: 0, tokens: null },
    idle: null,
    merges: { byAsker: {}, byReason: {}, count: 0 },
    prompts: null,
    questions: { askUserQuestion: 0, exitPlanMode: 0 },
    sessions: sessions.length,
    skipped: 0,
  };
  let pre = 0;
  let post = 0;
  let tokensSeen = false;
  for (const session of sessions) {
    totals.skipped += session.skipped;
    if (session.activeMs !== null) totals.activeMs = (totals.activeMs ?? 0) + session.activeMs;
    totals.agents.launches += session.agents.launches;
    totals.agents.launchesParallel += session.agents.launchesParallel;
    totals.agents.replies += session.agents.replies;
    totals.agents.repliesParallel += session.agents.repliesParallel;
    totals.agents.mostAtOnce = Math.max(totals.agents.mostAtOnce, session.agents.mostAtOnce);
    totals.questions.askUserQuestion += session.questions.askUserQuestion;
    totals.questions.exitPlanMode += session.questions.exitPlanMode;
    for (const [key, count] of Object.entries(session.autoModeBlocks)) {
      addTo(totals.autoModeBlocks, key, count);
    }
    totals.merges.count += session.merges.count;
    for (const [key, count] of Object.entries(session.merges.byAsker)) {
      addTo(totals.merges.byAsker, key, count);
    }
    for (const [key, count] of Object.entries(session.merges.byReason)) {
      addTo(totals.merges.byReason, key, count);
    }
    totals.compactions.count += session.compactions.count;
    for (const [key, count] of Object.entries(session.compactions.byTrigger)) {
      addTo(totals.compactions.byTrigger, key, count);
    }
    if (session.compactions.tokens !== null) {
      tokensSeen = true;
      pre += session.compactions.tokens.pre;
      post += session.compactions.tokens.post;
    }
    if (session.prompts !== null) {
      totals.prompts ??= { byAsker: {}, count: 0, longestMs: 0, totalMs: 0 };
      totals.prompts.count += session.prompts.count;
      totals.prompts.totalMs += session.prompts.totalMs;
      totals.prompts.longestMs = Math.max(totals.prompts.longestMs, session.prompts.longestMs);
      for (const [key, asker] of Object.entries(session.prompts.byAsker)) {
        const into = totals.prompts.byAsker[key] ?? { count: 0, ms: 0 };
        totals.prompts.byAsker[key] = into;
        into.count += asker.count;
        into.ms += asker.ms;
      }
    }
    if (session.background !== null) {
      totals.background ??= { byOrigin: {}, count: 0, totalMs: 0 };
      totals.background.count += session.background.count;
      totals.background.totalMs += session.background.totalMs;
      for (const [key, count] of Object.entries(session.background.byOrigin)) {
        addTo(totals.background.byOrigin, key, count);
      }
    }
    if (session.idle !== null) {
      totals.idle ??= { count: 0, totalMs: 0 };
      totals.idle.count += session.idle.count;
      totals.idle.totalMs += session.idle.totalMs;
    }
  }
  totals.compactions.tokens = totals.compactions.count === 0 || !tokensSeen ? null : { post, pre };
  totals.agents.parallelRatio =
    totals.agents.launches === 0 ? 0 : totals.agents.launchesParallel / totals.agents.launches;
  return totals;
}

/** Whether a session id is the one `session` names: exactly, or by a prefix of 4 or more. */
function sessionMatches(wanted: null | string, id: string): boolean {
  if (wanted === null) return true;
  if (id === wanted) return true;
  return wanted.length >= 4 && id.startsWith(wanted);
}

/** The open waits of one session, from its pending calls and the asks about them. */
function openWaitsOf(flow: SessionFlow, session: CachedSession, context: ReadContext): OpenWait[] {
  const out: OpenWait[] = [];
  const cutoff = context.nowMs - OPEN_WAIT_MAX_AGE_MS;
  for (const transcript of Object.values(session.transcripts)) {
    for (const [id, tool] of Object.entries(transcript.pending)) {
      if (tool.at < cutoff) continue;
      const logged = context.askLog.get(id);
      const seen = transcript.asks[id];
      const question = QUESTION_TOOLS.has(tool.name);
      if (logged === undefined && seen === undefined && !question) continue;
      out.push({
        asker: logged?.hook ?? seen?.hook ?? NO_ASKER,
        at: logged?.at ?? tool.at,
        cwd: flow.cwd,
        kind: logged?.kind ?? seen?.kind ?? (question ? "question" : null),
        project: flow.project,
        session: flow.session,
        tool: tool.name,
      });
    }
  }
  return out;
}

/** Writes a project's cache atomically, mode 0600; a failure is ignored (derived data). */
function writeCache(file: string, cache: FlowCache): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    atomicWrite(file, `${JSON.stringify(cache)}\n`, 0o600);
  } catch {
    // The cache is an optimisation: the next run reads the transcripts again.
  }
}

/** The measures the version wrote none of, in words for the report's footer. */
function missingMeasures(sessions: CachedSession[]): string[] {
  // No session at all: there was nothing to record, so nothing is missing.
  if (sessions.length === 0) return [];
  const missing: string[] = [];
  if (!sessions.some((session) => session.seen.turnMs)) {
    missing.push("active time: no turn durations were recorded by this version");
  }
  if (!sessions.some((session) => session.seen.turn)) {
    missing.push("background waits and idle time: no turn durations were recorded");
  }
  if (!sessions.some((session) => session.seen.permission)) {
    missing.push("prompts: no permission decisions were recorded by this version");
  }
  if (!sessions.some((session) => session.seen.ask)) {
    missing.push(
      "which hook asked: no hook asks were recorded; every prompt is attributed to Claude Code",
    );
  }
  return missing;
}

/**
 * Reads the flow report: every session of `paths`' projects folder with activity in the window,
 * newest first, with its totals and the calls still waiting on the person.
 *
 * The cache in `<stateDir>/flow/` makes a second run read only what grew. It is derived data:
 * last writer wins, no lock, and a failed write never fails the report.
 */
export function readFlow(paths: FlowPaths, options: FlowOptions): FlowReport {
  const nowMs = options.nowMs ?? Date.now();
  const logged = readAskLog(join(paths.stateDir, GUARD_ASKS_FILE));
  const context: ReadContext = {
    askLog: logged.asks,
    nowMs,
    sinceMs: options.sinceMs,
    untilMs: nowMs,
  };
  const sessions: SessionFlow[] = [];
  const open: OpenWait[] = [];
  const seenSessions: CachedSession[] = [];
  const projectsDir = join(paths.claudeConfigDir, "projects");
  for (const project of entries(projectsDir).dirs) {
    const folder = join(projectsDir, project);
    const cacheFile = join(paths.stateDir, "flow", `${project}.json`);
    let cache: FlowCache = { project, sessions: {}, version: CACHE_VERSION };
    try {
      cache = parseCache(readFileSync(cacheFile, "utf8"), project);
    } catch {
      // No cache yet (or not readable): everything is read from the start.
    }
    let dirty = false;
    const listed = entries(folder);
    const ids = new Set([
      ...listed.files.filter((name) => name.endsWith(".jsonl")).map((name) => name.slice(0, -6)),
      ...listed.dirs,
    ]);
    for (const id of [...ids].sort()) {
      if (!sessionMatches(options.session, id)) continue;
      const session = cache.sessions[id] ?? emptySession();
      cache.sessions[id] = session;
      const own = join(folder, `${id}.jsonl`);
      const entry = session.transcripts[`${id}.jsonl`] ?? emptyTranscript();
      session.transcripts[`${id}.jsonl`] = entry;
      const subagents = join(folder, id, "subagents");
      const files: { path: string; subagent: boolean; transcript: CachedTranscript }[] = [
        { path: own, subagent: false, transcript: entry },
      ];
      for (const name of entries(subagents).files.filter((file) => file.endsWith(".jsonl"))) {
        const key = `${id}/subagents/${name}`;
        const transcript = session.transcripts[key] ?? emptyTranscript();
        session.transcripts[key] = transcript;
        files.push({ path: join(subagents, name), subagent: true, transcript });
      }
      // One transcript replaced or shrunk: the session's buckets cannot be told apart any more,
      // so every one of its transcripts is read again from the start in this run.
      if (files.some((file) => replaced(file.path, file.transcript))) resetSession(session);
      for (const file of files) {
        if (readTranscriptFile(file.path, session, file.transcript, file.subagent, context)) {
          dirty = true;
        }
      }
    }
    if (pruneAll(cache, nowMs)) dirty = true;
    if (dirty) writeCache(cacheFile, cache);
    for (const [id, session] of Object.entries(cache.sessions)) {
      if (!sessionMatches(options.session, id)) continue;
      if (!matches(options.project, project, session.cwd)) continue;
      const flow = sessionFlow(project, id, session, context);
      // "Waiting on you now" is independent of the window: a call asked 20 hours ago is still
      // waiting, and `OPEN_WAIT_MAX_AGE_MS` is what ends it.
      open.push(...openWaitsOf(flow, session, context));
      const last = session.lastAt;
      if (last === null || last < options.sinceMs || last >= nowMs) continue;
      if (bucketsIn(session, context).length === 0) continue;
      sessions.push(flow);
      seenSessions.push(session);
    }
  }
  sessions.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.session.localeCompare(b.session));
  open.sort((a, b) => b.at - a.at || a.session.localeCompare(b.session));
  return {
    hours: hoursOf(seenSessions, context),
    missing: missingMeasures(seenSessions),
    open,
    sessions,
    sinceMs: options.sinceMs,
    skipped: { askLog: logged.skipped, records: sessions.reduce((sum, s) => sum + s.skipped, 0) },
    totals: totalsOf(sessions),
    untilMs: nowMs,
  };
}

/** The calls asked and still unanswered: "waiting on you now". */
export function openWaits(paths: FlowPaths, options: FlowOptions): OpenWait[] {
  return readFlow(paths, options).open;
}

/** Prunes every session's kept window, and the sessions too old to matter. */
function pruneAll(cache: FlowCache, nowMs: number): boolean {
  let changed = false;
  for (const [id, session] of Object.entries(cache.sessions)) {
    if (session.lastAt !== null && session.lastAt < nowMs - CACHE_KEEP_DAYS * DAY_MS) {
      delete cache.sessions[id];
      changed = true;
      continue;
    }
    if (prune(session, nowMs)) changed = true;
  }
  return changed;
}

/** The projects folder the report reads. */
export function projectsFolder(paths: FlowPaths): string {
  return join(paths.claudeConfigDir, "projects");
}

/** The folder the flow cache lives in: `<stateDir>/flow/`. */
export function flowCacheFolder(paths: FlowPaths): string {
  return join(paths.stateDir, "flow");
}
