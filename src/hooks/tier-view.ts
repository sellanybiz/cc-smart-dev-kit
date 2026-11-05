/**
 * SessionStart and UserPromptSubmit: tell Claude what each subagent tier runs now, so it can name
 * the model when it launches. The tier and the effort are chosen by the job, never by the model
 * behind a tier (2.2.0, the owner, 2026-11-05; `/cc-smart-dev-kit:subagent-decision`). Nothing
 * used to tell a session what answered its tiers: the Agent guard knew, and the session read
 * "the gateway is on".
 *
 * **What it says.** `tierNote` (`src/models/tier-view.ts`): a header and one line per tier the
 * Agent tool's `model` names, read the Agent guard's way (`resolveLaunchModel`) through the
 * session's own gateway view (`sessionGatewayOf`: its effective `ANTHROPIC_BASE_URL`, a profile's
 * chains) — never a second list. The gateway off says that every tier is Claude, in the same
 * lines: the instructions' effort rule reads the note, so a session without a gateway needs it
 * as much as one with.
 *
 * **When.** At every SessionStart (a start, a resume, a clear, a compaction: each builds Claude's
 * context again, and the hook's `hooks.json` entry carries no matcher), and at a
 * UserPromptSubmit **only when the note differs from the one said last in this session** — the
 * owner may change a slot while sessions run, and each line costs context in every session on
 * the machine. The last note is kept in `<TMPDIR>/cc-smart-dev-kit-session-names/<session>.tiers`,
 * beside the session's other marks (`namesDir`), so the OS clears it. A prompt in a session the
 * hook never saw start (the plugin updated mid-session) says it once. A mark that cannot be kept
 * makes a prompt silent: a note that cannot be remembered would repeat at every prompt.
 *
 * **Why UserPromptSubmit and not the Agent guard's PreToolUse.** The guard answers a launch
 * after Claude chose its effort; a note there arrives too late and costs a denied call. A
 * prompt's context reaches Claude before it picks.
 *
 * **Why a hook of its own.** `fable-session` runs at the same events but speaks to the person
 * and never to Claude (its contract); `session-name` names the session. Neither has this job.
 *
 * **One more line, while auto mode's safety checks fail** (the owner, 2026-10-27): when the
 * router has recorded that Claude is limited or down and nothing stood in for it
 * (`checksDownNote`, `src/gateway/checks-down.ts`), the session's gateway scope is told once,
 * under the tiers: the checks fail, it cannot fix that, who can and how, and to stop and wait
 * rather than retry. Claude Code's own message to the model says the checker is "temporarily
 * unavailable" and to try again; this line is why it should not. It rides the same marks: said at
 * every start, and at a prompt only when the note differs from the last one said, so it appears
 * when the checks start failing and the tiers' note repeats when they recover. Only a session on
 * the gateway gets it (`sessionGatewayOf`), its own profile's record only.
 *
 * **One line about the plan's usage, at a prompt** (2.2.0, the owner, 2026-11-05). No hook input
 * carries the plan's usage; the status line records it (`src/cli/usage-window.ts`). When a
 * window (5-hour, 7-day) first reaches 50, 75 or 90% (`USAGE_THRESHOLDS`), the prompt's context
 * gets one line with the share and the reset time, and the pointer to the skill's § Usage left
 * (`usageLine`). Each crossing is told once a window: the session's `<session>.usage` mark keeps
 * the highest share told and the window's reset, and a window whose reset has passed starts
 * again. Never the number at every prompt, and never at a start (a start's note is the tiers).
 * No line without the file, for a window past its reset, or for one with no reset time: the
 * file is written only when the numbers change, so only the reset says a number is still true.
 * It rides UserPromptSubmit beside the tiers' note, in the same `additionalContext`, and keeps
 * its own mark, so a changed tier note and a usage crossing never hide each other.
 *
 * **Machine-wide**, like `agent-guard` whose view it reads: the note never depends on the
 * project's file, and a folder outside git gets it too (its subagents run on these tiers). A
 * config that cannot be read is said plainly, never a crash; the address
 * of a proxy that is not the kit's gateway (no `gateway.json`) is read as Claude, the guard's
 * way. Never a question and never a block.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { readUsageWindows, type UsageWindows } from "../cli/usage-window";
import { checksDownNote, checksDownNow } from "../gateway/checks-down";
import { formatClock, scopeOfStateKey } from "../gateway/limit-state";
import { tierNote } from "../models/tier-view";
import { sessionGatewayOf } from "./agent-guard";
import { addContext, type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { Env } from "./run";
import { isSessionId, namesDir } from "./session-name";

/** The note when the gateway is on and its config cannot be used: the view is not known. */
export function tierNoteUnknown(): string {
  return `Subagent tiers now: not known — the gateway config cannot be read (\`${COMMAND} doctor\` says why). The Agent guard judges each launch and names the effort it needs.`;
}

/** The mark that holds the note this session was told last, beside the session's name files. */
export function tierViewMark(env: Env, sessionId: string): string {
  return join(namesDir(env), `${sessionId}.tiers`);
}

/**
 * The note for this session's own gateway view. A session on a gateway address whose
 * `gateway.json` exists but cannot be used has a view nobody can prove: the plain note says so.
 */
export function currentNote(paths: CliPaths, env: Env): string {
  const gateway = sessionGatewayOf(paths, env);
  if (gateway.gatewayOn && gateway.config === null && existsSync(paths.gatewayConfigFile)) {
    return tierNoteUnknown();
  }
  return tierNote(gateway, env);
}

/**
 * The line for this session's gateway scope while auto mode's safety checks fail, or null: no
 * record, a session off the gateway, or a record that went stale (`currentChecksDown`).
 */
export function checksNote(paths: CliPaths, env: Env, nowMs: number): null | string {
  const gateway = sessionGatewayOf(paths, env);
  if (!gateway.gatewayOn) return null;
  const found = checksDownNow(paths.gatewayStateFile, nowMs).find(
    ([key]) => scopeOfStateKey(key).profile === gateway.profile,
  );
  return found === undefined ? null : checksDownNote(found[1], gateway.profile, nowMs);
}

/** The note last said in this session, or null: no mark, or one that cannot be read. */
function lastSaid(mark: string): null | string {
  try {
    return readFileSync(mark, "utf8");
  } catch {
    return null;
  }
}

/** Keeps `note` as the last said. False when the mark cannot be written. */
function keep(mark: string, note: string): boolean {
  try {
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, note);
    return true;
  } catch {
    return false;
  }
}

/** The shares of a plan window at which the session is told, once each, per window. */
export const USAGE_THRESHOLDS = [50, 75, 90] as const;

/** The two windows, as the usage line names them. */
const USAGE_WINDOWS = [
  ["fiveHour", "5-hour"],
  ["sevenDay", "7-day"],
] as const satisfies readonly (readonly [keyof UsageWindows, string])[];

/** What this session was told of one window: the window (its reset) and the highest share. */
interface ToldWindow {
  level: number;
  resetsAt: number;
}

/** What this session was told of each window, as its usage mark keeps it. */
export type ToldUsage = Partial<Record<keyof UsageWindows, ToldWindow>>;

/** The mark that holds what this session was told of the plan's usage. */
export function usageMark(env: Env, sessionId: string): string {
  return join(namesDir(env), `${sessionId}.usage`);
}

/** The highest threshold `percent` has reached; 0 below the first. */
export function usageLevel(percent: number): number {
  let level = 0;
  for (const threshold of USAGE_THRESHOLDS) if (percent >= threshold) level = threshold;
  return level;
}

/** The mark's content, or nothing told: no mark, or one that cannot be read. */
function toldUsage(mark: string): ToldUsage {
  const text = lastSaid(mark);
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as ToldUsage) : {};
  } catch {
    return {};
  }
}

/**
 * The usage line for `windows`, given what was `told` before, and what to keep after it. A window
 * is told when its share first reaches a threshold above the one told for the same window. A
 * window it was told about whose reset has passed is over: a new window starts from nothing. A
 * window with no reset time is not told: its freshness cannot be known (the file is written only
 * when the numbers change, so its age says nothing). Null line: nothing new.
 */
export function usageLine(
  windows: UsageWindows,
  told: ToldUsage,
  nowMs: number,
  timeZone?: string,
): { line: null | string; next: ToldUsage } {
  const next: ToldUsage = {};
  const parts: string[] = [];
  for (const [key, name] of USAGE_WINDOWS) {
    const window = windows[key];
    const before = told[key];
    // Still the window it was told about: its reset has not passed yet.
    const same =
      before !== undefined &&
      typeof before.resetsAt === "number" &&
      typeof before.level === "number" &&
      before.resetsAt * 1000 > nowMs;
    if (same) next[key] = before;
    if (window === null || window.resetsAt === null || window.resetsAt * 1000 <= nowMs) continue;
    const level = usageLevel(window.percent);
    if (level <= (same ? before.level : 0)) continue;
    next[key] = { level, resetsAt: window.resetsAt };
    parts.push(
      `${name} window ${Math.floor(window.percent)}% used (resets ${formatClock(window.resetsAt, nowMs, timeZone)})`,
    );
  }
  if (parts.length === 0) return { line: null, next };
  return {
    line: `Plan usage: ${parts.join("; ")}. Follow /cc-smart-dev-kit:subagent-decision § Usage left.`,
    next,
  };
}

/**
 * The usage line for this session at a prompt, or null: no usage file, no window that crossed
 * a threshold since it was last told, or a mark that cannot be kept (a line that cannot be
 * remembered would repeat at every prompt).
 */
export function usageNote(
  paths: CliPaths,
  env: Env,
  sessionId: string,
  nowMs: number,
  timeZone?: string,
): null | string {
  const windows = readUsageWindows(paths, nowMs);
  if (windows.fiveHour === null && windows.sevenDay === null) return null;
  const mark = usageMark(env, sessionId);
  const { line, next } = usageLine(windows, toldUsage(mark), nowMs, timeZone);
  if (line === null) return null;
  return keep(mark, JSON.stringify(next)) ? line : null;
}

/**
 * The note as context at a start, or at a prompt when what the tiers run has changed; and at a
 * prompt, the usage line when a plan window first crosses a threshold (`usageNote`).
 */
export function tierView(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  nowMs: number = Date.now(),
  timeZone?: string,
): HookResult {
  const event = stringField(input.hook_event_name);
  if (event !== "SessionStart" && event !== "UserPromptSubmit") return SILENT;
  const sessionId = input.session_id;
  const mark = isSessionId(sessionId) ? tierViewMark(env, sessionId) : null;
  const checks = checksNote(paths, env, nowMs);
  const note =
    checks === null ? currentNote(paths, env) : [currentNote(paths, env), checks].join("\n\n");
  if (event === "SessionStart") {
    // A new context every time: said whatever the mark holds, and kept for the prompts after it.
    if (mark !== null) keep(mark, note);
    return addContext(event, note);
  }
  if (mark === null || !isSessionId(sessionId)) return SILENT;
  const parts: string[] = [];
  // Said only when it can be remembered: else the next prompt would say it again.
  if (lastSaid(mark) !== note && keep(mark, note)) parts.push(note);
  const usage = usageNote(paths, env, sessionId, nowMs, timeZone);
  if (usage !== null) parts.push(usage);
  return parts.length === 0 ? SILENT : addContext(event, parts.join("\n\n"));
}
