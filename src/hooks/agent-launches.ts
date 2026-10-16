/**
 * The Opus and Fable launches the Agent guard allowed, one JSON line each, in
 * `<stateDir>/agent-launches.jsonl` — the record `cc-smart-dev-kit usage` lists (count, reasons).
 *
 * Why a file: the guard's answer reaches Claude and the hook log (`CC_SMART_DEV_KIT_HOOK_LOG`, which
 * is a check's log, not the person's), and an Opus or Fable launch spends the person's own
 * plan usage. The record is what makes "how much Opus did the agents really use, and why"
 * answerable. It holds no message text: the model, the reason line's word, the agent type and
 * the folder.
 *
 * The file is cc-smart-dev-kit's own state (`paths.stateDir`), appended by the hook with one short
 * line. A file that cannot be written or read never fails a hook: the record is information.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeFamily } from "./agent-guard";

/** One allowed Opus or Fable launch. */
export interface AgentLaunch {
  /** When the guard saw it (ms since the epoch). */
  at: number;
  family: ClaudeFamily;
  /** The model the launch really runs on, as the guard resolved it. */
  model: string;
  /** The folder the session worked in. */
  project: string;
  /** Why it was allowed: `review`, `opus:<word>`, `fable:<word>`. */
  reason: string;
  /** The subagent type the call named; empty when it named none. */
  subagentType: string;
  /** The session it happened in; empty for an old line that carries none. */
  session: string;
  /**
   * The tool call's id (`tool_use_id` of the hook input). Two PreToolUse runs with the same
   * id are one launch, never two lines: 2.1.301 runs the hook once for a call the person
   * approved (proved live), and a build that ran it again would record nothing new. Empty
   * for an old line, or an input without one.
   */
  toolUseId: string;
}

/** Where the record lives. */
export function agentLaunchesFile(stateDir: string): string {
  return join(stateDir, "agent-launches.jsonl");
}

/** The last recorded line, or null when the file is empty, missing or unreadable. */
export function lastAgentLaunch(file: string): AgentLaunch | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const last = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .at(-1);
  return last === undefined ? null : parseAgentLaunch(last);
}

/**
 * Appends one launch, once: two runs with the same `tool_use_id` in one session are the same
 * launch (see the field above), so only the first line is kept. Never throws (a hook must not
 * fail over its own record).
 */
export function appendAgentLaunch(file: string, launch: AgentLaunch): void {
  const previous = lastAgentLaunch(file);
  if (
    previous !== null &&
    launch.toolUseId !== "" &&
    previous.toolUseId === launch.toolUseId &&
    previous.session === launch.session
  ) {
    return;
  }
  try {
    appendFileSync(file, `${JSON.stringify(launch)}\n`);
  } catch {
    // The state folder cannot be written: the launch itself is unaffected.
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One line as a launch, or null when it is not one (a half-written line, an old shape). */
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
  return {
    at,
    family,
    model,
    project: typeof project === "string" ? project : "",
    reason,
    session: typeof value.session === "string" ? value.session : "",
    subagentType: typeof subagentType === "string" ? subagentType : "",
    toolUseId: typeof value.toolUseId === "string" ? value.toolUseId : "",
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

/** The words after the last `:` of a reason (`opus:security` → `security`). */
function reasonWord(reason: string): string {
  return reason.slice(reason.lastIndexOf(":") + 1);
}

/**
 * `cc-smart-dev-kit usage`'s lines for the record: how many Opus and Fable launches, and why. Empty
 * when there were none (an older machine has no file at all).
 */
export function formatAgentLaunches(launches: AgentLaunch[]): string[] {
  if (launches.length === 0) return [];
  const count = (family: ClaudeFamily) => launches.filter((one) => one.family === family).length;
  const reasons = new Map<string, number>();
  for (const launch of launches) {
    const word = reasonWord(launch.reason);
    reasons.set(word, (reasons.get(word) ?? 0) + 1);
  }
  const words = [...reasons.entries()]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([word, n]) => `${word} ${n}`)
    .join(", ");
  return [
    "",
    `Opus / Fable launches: ${launches.length} (Opus ${count("opus")}, Fable ${count("fable")}); why: ${words}`,
  ];
}
