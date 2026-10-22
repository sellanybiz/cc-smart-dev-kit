/**
 * The Opus and Fable launches the Agent guard allowed, one JSON line each, in
 * `<stateDir>/agent-launches.jsonl` — the record `cc-smart-dev-kit usage` lists (count, effort,
 * reasons).
 *
 * Why a file: the guard's answer reaches Claude and the hook log (`CC_SMART_DEV_KIT_HOOK_LOG`, which
 * is a check's log, not the person's), and an Opus or Fable launch spends the person's own
 * plan usage. The record is what makes "how much Opus did the agents really use, and why"
 * answerable. It holds no message text: the model, the effort, the reason line's word, the agent
 * type and the folder.
 *
 * The file is cc-smart-dev-kit's own state (`paths.stateDir`), appended by the hook with short
 * lines. A file that cannot be written or read never fails a hook: the record is information.
 */

import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ClaudeFamily } from "../gateway/targets";
import { ALLOWED_EFFORTS, EFFORT_AUTO } from "../models/launch-policy";

/** One allowed Opus or Fable launch. */
export interface AgentLaunch {
  /** When the guard saw it (ms since the epoch). */
  at: number;
  /**
   * The effort the launch really ran at (`xhigh`, `max`, `auto`), `session-effort` for a fork
   * (it runs at the session's own), or null when the line does not say: an old `fable:<word>`
   * line, or one whose reason holds no effort.
   */
  effort: null | string;
  family: ClaudeFamily;
  /**
   * Which launch of the tool call this is, counting from 0: a Workflow's launches all share its
   * one `tool_use_id`, so the id alone cannot tell them apart. 0 for an Agent call and an old
   * line.
   */
  launchIndex: number;
  /**
   * The model the launch really runs on: Claude Code's own `resolvedModel`, when its
   * PostToolUse answer carries one (the record of an asked launch), else the model the
   * guard resolved from the name the call gave.
   */
  model: string;
  /** The folder the session worked in. */
  project: string;
  /**
   * Why it ran, as one string, kept for a reader that knows only it: the `opus` tier as
   * `opus:<effort>`, with its reason word when one is given (`opus:xhigh`, `opus:max:security`,
   * a fork's `opus:session-effort`), and a model the guard cannot read as Opus as
   * `opus:unreadable`; `fable:<word>`. `effort` and `word` hold its parts.
   */
  reason: string;
  /** The subagent type the call named; empty when it named none. */
  subagentType: string;
  /** The session it happened in; empty for an old line that carries none. */
  session: string;
  /**
   * The tool call's id (`tool_use_id` of the hook input). Two runs with the same id, session and
   * launch index are one launch, never two lines: 2.1.301 runs the hook once for a call the
   * person approved (proved live), and a build that ran it again would record nothing new.
   * Empty for an old line, or an input without one.
   */
  toolUseId: string;
  /**
   * The prompt's reason word (`Opus reason: security …` → `security`, `Fable reason: plan …` →
   * `plan`), `unreadable` for a model the guard cannot read as Opus, or null when there is none.
   */
  word: null | string;
}

/** The parts of a `reason` string (`reasonParts`). */
export interface ReasonParts {
  effort: null | string;
  word: null | string;
}

/** The effort a fork's reason names: it runs at the session's own effort. */
export const SESSION_EFFORT = "session-effort";

/** Every effort a reason string can carry: the allowed levels, `auto`, and a fork's. */
const REASON_EFFORTS: readonly string[] = [...ALLOWED_EFFORTS, EFFORT_AUTO, SESSION_EFFORT];

/**
 * The effort and the word of a `reason` string — the one place a reason is taken apart: for a
 * new line's fields, and for an old line that carries only `reason`.
 *
 * `opus:xhigh:security` → xhigh, security; `opus:max` → max, no word; `opus:session-effort` →
 * the session's effort; `fable:plan` → no effort, plan; `opus:unreadable` → no effort,
 * `unreadable`; an older line's `opus:security` or bare `review` → no effort, that word.
 */
export function reasonParts(reason: string): ReasonParts {
  const parts = reason.split(":");
  const rest = parts[0] === "opus" || parts[0] === "fable" ? parts.slice(1) : parts;
  const [first = "", ...after] = rest;
  if (REASON_EFFORTS.includes(first)) {
    return { effort: first, word: after.length === 0 ? null : after.join(":") };
  }
  const word = rest.join(":");
  return { effort: null, word: word === "" ? null : word };
}

/** Where the record lives. */
export function agentLaunchesFile(stateDir: string): string {
  return join(stateDir, "agent-launches.jsonl");
}

/**
 * How far back from the end the record is read to find a launch already written (64 KiB, a few
 * hundred lines). A second run of the same call comes within seconds of the first, so its lines
 * are in that tail, and a hook never reads a record that has grown for months.
 */
export const RECORD_TAIL_BYTES = 64 * 1024;

/** The last `RECORD_TAIL_BYTES` of the file, as whole lines; empty when it cannot be read. */
function tailLines(file: string): string[] {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    // No record yet, or one that cannot be read: nothing was written before.
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const from = Math.max(0, size - RECORD_TAIL_BYTES);
    const buffer = Buffer.alloc(size - from);
    const read = readSync(fd, buffer, 0, buffer.length, from);
    const lines = buffer.subarray(0, read).toString("utf8").split("\n");
    // Read from the middle of the file, the first line is only a part of one: dropped.
    return (from > 0 ? lines.slice(1) : lines).filter((line) => line.trim() !== "");
  } catch {
    // A file that cannot be read now holds nothing the hook can compare with.
    return [];
  } finally {
    closeSync(fd);
  }
}

/** What makes two lines the same launch: the session, the tool call and the launch's index. */
function launchKey(launch: AgentLaunch): string {
  return `${launch.session}\u0000${launch.toolUseId}\u0000${launch.launchIndex}`;
}

/**
 * Appends launches, each once: a line with the same session, `tool_use_id` and launch index as
 * one already written is the same launch (see `toolUseId`), so it is skipped. A launch with no
 * `tool_use_id` is always new. All of them go in one write. Never throws (a hook must not fail
 * over its own record).
 */
export function appendAgentLaunches(file: string, launches: readonly AgentLaunch[]): void {
  const written = new Set(
    tailLines(file)
      .map(parseAgentLaunch)
      .filter((one): one is AgentLaunch => one !== null && one.toolUseId !== "")
      .map(launchKey),
  );
  const fresh = launches.filter((one) => {
    if (one.toolUseId === "") return true;
    const key = launchKey(one);
    if (written.has(key)) return false;
    written.add(key);
    return true;
  });
  if (fresh.length === 0) return;
  try {
    // The state folder is made when it is not there yet: a launch recorded on PostToolUse (an
    // asked one) must not be lost because nothing else has written the folder first.
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    appendFileSync(file, fresh.map((one) => `${JSON.stringify(one)}\n`).join(""));
  } catch {
    // The state folder cannot be written: the launch itself is unaffected.
  }
}

/** Appends one launch, once (`appendAgentLaunches`). */
export function appendAgentLaunch(file: string, launch: AgentLaunch): void {
  appendAgentLaunches(file, [launch]);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field that is a non-empty string, else null. */
function textOrNull(value: unknown): null | string {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * One line as a launch, or null when it is not one (a half-written line, an old shape). A line
 * written before `effort` and `word` were fields gets them from its `reason` (`reasonParts`).
 */
export function parseAgentLaunch(line: string): AgentLaunch | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isJsonObject(value)) return null;
  const { at, family, model, project, reason, subagentType } = value;
  if (
    typeof at !== "number" ||
    (family !== "opus" && family !== "fable") ||
    typeof model !== "string" ||
    typeof reason !== "string"
  ) {
    return null;
  }
  const parts =
    "effort" in value || "word" in value
      ? { effort: textOrNull(value.effort), word: textOrNull(value.word) }
      : reasonParts(reason);
  const index = value.launchIndex;
  return {
    at,
    effort: parts.effort,
    family,
    launchIndex: typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : 0,
    model,
    project: typeof project === "string" ? project : "",
    reason,
    session: typeof value.session === "string" ? value.session : "",
    subagentType: typeof subagentType === "string" ? subagentType : "",
    toolUseId: typeof value.toolUseId === "string" ? value.toolUseId : "",
    word: parts.word,
  };
}

/** The launches in the window; a missing or unreadable file reads as none. */
export function readAgentLaunches(file: string, sinceMs: number): AgentLaunch[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseAgentLaunch)
    .filter((launch): launch is AgentLaunch => launch !== null)
    .filter((launch) => launch.at >= sinceMs)
    .sort((a, b) => a.at - b.at);
}

/** How `usage` names a launch whose line holds no effort, or no word. */
const NOT_NAMED = { effort: "effort not recorded", word: "no word" } as const;

/** `name n` pairs, the most first, then by name. */
function countsText(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");
}

/**
 * `cc-smart-dev-kit usage`'s lines for the record: how many Opus and Fable launches, at which
 * effort, and why (their reason word). Each count reads the line's own `effort` and `word` —
 * an old line's come from its `reason`, once, when it is read. Empty when there were none (an
 * older machine has no file at all).
 */
export function formatAgentLaunches(launches: AgentLaunch[]): string[] {
  if (launches.length === 0) return [];
  const count = (family: ClaudeFamily) => launches.filter((one) => one.family === family).length;
  const efforts = new Map<string, number>();
  const words = new Map<string, number>();
  for (const launch of launches) {
    const effort = launch.effort ?? NOT_NAMED.effort;
    const word = launch.word ?? NOT_NAMED.word;
    efforts.set(effort, (efforts.get(effort) ?? 0) + 1);
    words.set(word, (words.get(word) ?? 0) + 1);
  }
  return [
    "",
    `Opus / Fable launches: ${launches.length} (Opus ${count("opus")}, Fable ${count("fable")}); effort: ${countsText(efforts)}; why: ${countsText(words)}`,
  ];
}
