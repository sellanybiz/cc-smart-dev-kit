/**
 * `cc-smart-dev-kit report`: what this machine's Claude Code sessions did in a window — the
 * flow report. The measures and the reader are `src/sessions/flow.ts`; this module parses the
 * options, prints the report and prints the JSON.
 *
 * Read only, and counts, times, tool names and hook names only — never a word of a message.
 * The window is at most eight days, because the reader's cache keeps hourly buckets for eight
 * (`FLOW_DAYS_KEPT`).
 */
import { COMMAND } from "../build-info";
import {
  type AskerCount,
  FLOW_DAYS_KEPT,
  type FlowReport,
  projectsFolder,
  readFlow,
  type SessionFlow,
} from "../sessions/flow";
import type { CliPaths } from "./paths";
import { tildify } from "./paths";

const HOUR_MS = 3_600_000;

/** The report's window when no option names one: seven days. */
export const DEFAULT_REPORT_DAYS = 7;

export const REPORT_USAGE = `Usage: ${COMMAND} report [--hours <n> | --days <n>] [--project <folder or name>] [--session <id>] [--json]

What this machine's Claude Code sessions did in the window (default: the last ${DEFAULT_REPORT_DAYS}
days), read from Claude Code's transcripts: per session, the time Claude Code timed, agent
launches and the parallel share, the minutes blocked on permission prompts and which guard asked,
questions, waits on background work, idle time until the person wrote, compactions, auto-mode
blocks by rule, and merges that asked. Then the totals, every prompt's cause, and the calls
waiting on you now. Read only; no message text. The window is at most ${FLOW_DAYS_KEPT} days.

  --hours <n>          the window in hours (default ${DEFAULT_REPORT_DAYS * 24}, at most ${FLOW_DAYS_KEPT * 24})
  --days <n>           the window in days (at most ${FLOW_DAYS_KEPT})
  --project <name>     one project: its folder, its last part, or a session's cwd
  --session <id>       one session: its id, or the first 4 or more characters
  --json               print the whole report as JSON`;

/** What `report` was asked for. */
export interface ReportOptions {
  hours: number;
  json: boolean;
  project: null | string;
  session: null | string;
}

/** Parses `report`'s options; an error in words on a wrong one. */
export function reportOptions(args: string[]): { error: string } | ReportOptions {
  let hours: null | number = null;
  let days: null | number = null;
  let project: null | string = null;
  let session: null | string = null;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--hours" && value !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: `--hours wants a number above 0, not "${value}"` };
      }
      hours = parsed;
      index += 1;
    } else if (arg === "--days" && value !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: `--days wants a number above 0, not "${value}"` };
      }
      days = parsed;
      index += 1;
    } else if (arg === "--project" && value !== undefined) {
      project = value;
      index += 1;
    } else if (arg === "--session" && value !== undefined) {
      session = value;
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      return { error: `Unknown option: ${arg ?? ""}` };
    }
  }
  if (hours !== null && days !== null) {
    return { error: "--hours and --days name the same window: give one" };
  }
  const chosen = hours ?? (days === null ? DEFAULT_REPORT_DAYS * 24 : days * 24);
  if (chosen > FLOW_DAYS_KEPT * 24) {
    return {
      error: `the window is at most ${FLOW_DAYS_KEPT} days (the report's cache keeps ${FLOW_DAYS_KEPT})`,
    };
  }
  return { hours: chosen, json, project, session };
}

/** A span as a person reads it: seconds, minutes, or hours and minutes. */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** The English plural of a count's word: `1 launch`, `4 launches`, `1 reply`, `2 replies`. */
function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  const many = /(ch|sh|s|x|z)$/.test(word)
    ? `${word}es`
    : /[^aeiou]y$/.test(word)
      ? `${word.slice(0, -1)}ies`
      : `${word}s`;
  return `${n} ${many}`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)} %`;
}

/** `name count, name count`, by count (most first) then name. */
export function countList(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB))
    .map(([name, count]) => `${name} ${count}`)
    .join(", ");
}

/** `name count (duration), …`, by time (most first) then name. */
function askerList(askers: Record<string, AskerCount>): string {
  return Object.entries(askers)
    .sort(([nameA, a], [nameB, b]) => b.ms - a.ms || nameA.localeCompare(nameB))
    .map(([name, asker]) => `${name} ${asker.count} (${duration(asker.ms)})`)
    .join(", ");
}

/** A moment in the report's time zone, as `YYYY-MM-DD HH:MM`. */
function stamp(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(ms);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

/** Where a session ran: its `cwd` with `~`, else the project folder's own name. */
function where(session: { cwd: null | string; project: string }, home: string): string {
  return session.cwd === null ? session.project : tildify(session.cwd, home);
}

/** The measures both a session and the totals print, as their lines. */
function measureLines(flow: FlowReport["totals"] | SessionFlow): string[] {
  const lines: string[] = [];
  if (flow.activeMs === null) lines.push("active time: not recorded by this version");
  else lines.push(`active time: ${duration(flow.activeMs)} (the turns Claude Code timed)`);
  const agents = flow.agents;
  if (agents.launches === 0) {
    lines.push(
      `agents: no launches in ${plural(agents.replies, "reply")}; most at once ${agents.mostAtOnce}`,
    );
  } else {
    lines.push(
      `agents: ${plural(agents.launches, "launch")} in ${plural(agents.replies, "reply")}; ${agents.repliesParallel} with 2 or more (${agents.launchesParallel} of ${agents.launches} launches in parallel, ${percent(agents.launchesParallel, agents.launches)}); most at once ${agents.mostAtOnce}`,
    );
  }
  if (flow.prompts === null) {
    lines.push("blocked on prompts: not recorded by this version");
  } else if (flow.prompts.count === 0) {
    lines.push("blocked on prompts: none");
  } else {
    lines.push(
      `blocked on prompts: ${plural(flow.prompts.count, "prompt")}, ${duration(flow.prompts.totalMs)} in all, longest ${duration(flow.prompts.longestMs)} — ${askerList(flow.prompts.byAsker)} (an upper bound: from the tool call's line to the person's answer)`,
    );
  }
  lines.push(questionsLine(flow.questions));
  if (flow.background === null) {
    lines.push("waiting on background work: not recorded by this version");
  } else if (flow.background.count === 0) {
    lines.push("waiting on background work: none");
  } else {
    lines.push(
      `waiting on background work: ${plural(flow.background.count, "wait")}, ${duration(flow.background.totalMs)} (${countList(flow.background.byOrigin)})`,
    );
  }
  if (flow.idle === null) lines.push("idle until the person wrote: not recorded by this version");
  else if (flow.idle.count === 0) lines.push("idle until the person wrote: none");
  else
    lines.push(
      `idle until the person wrote: ${plural(flow.idle.count, "wait")}, ${duration(flow.idle.totalMs)}`,
    );
  lines.push(compactionLine(flow.compactions));
  lines.push(
    Object.keys(flow.autoModeBlocks).length === 0
      ? "auto-mode blocks: none"
      : `auto-mode blocks: ${sumCounts(flow.autoModeBlocks)} (${countList(flow.autoModeBlocks)})`,
  );
  lines.push(mergesLine(flow.merges));
  return lines;
}

/** The total of a record of counts. */
function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function questionsLine(questions: { askUserQuestion: number; exitPlanMode: number }): string {
  const parts: string[] = [];
  if (questions.askUserQuestion > 0) parts.push(`AskUserQuestion ${questions.askUserQuestion}`);
  if (questions.exitPlanMode > 0) parts.push(`ExitPlanMode ${questions.exitPlanMode}`);
  if (parts.length === 0) return "questions: none";
  const total = questions.askUserQuestion + questions.exitPlanMode;
  return `questions: ${plural(total, "question")} (${parts.join(", ")})`;
}

function compactionLine(compactions: SessionFlow["compactions"]): string {
  if (compactions.count === 0) return "compactions: none";
  const tokens =
    compactions.tokens === null
      ? "; the tokens were not recorded by this version"
      : `; ${compactions.tokens.pre} tokens in, ${compactions.tokens.post} out`;
  return `compactions: ${compactions.count} (${countList(compactions.byTrigger)}${tokens})`;
}

function mergesLine(merges: SessionFlow["merges"]): string {
  if (merges.count === 0) return "merges that asked: none";
  const askers = countList(merges.byAsker);
  const reasons = Object.entries(merges.byReason).filter(([reason]) => reason !== "not recorded");
  const byReason =
    reasons.length === 0
      ? "; the reason needs the guards' ask log"
      : `; by reason: ${countList(Object.fromEntries(reasons))}`;
  return `merges that asked: ${merges.count} (${askers})${byReason}`;
}

/** The open waits: what is waiting on the person right now, newest first. */
function openLines(report: FlowReport, home: string, nowMs: number): string[] {
  if (report.open.length === 0) return [];
  const lines = ["", `Waiting on you now: ${plural(report.open.length, "call")}`];
  for (const wait of report.open) {
    const kind = wait.kind === null ? "" : ` (${wait.kind})`;
    lines.push(
      `  ${where(wait, home)}  session ${wait.session.slice(0, 8)}  ${wait.asker} asked for ${wait.tool}${kind}, ${duration(Math.max(0, nowMs - wait.at))} ago`,
    );
  }
  return lines;
}

/** The window in words: whole days when it is one, else hours. */
function windowWords(hours: number): string {
  return hours % 24 === 0 ? plural(hours / 24, "day") : `${hours} h`;
}

/** The report's lines: the header, the open waits, every session, the totals and the footers. */
export function formatFlow(
  report: FlowReport,
  hours: number,
  projectsDir: string,
  home: string,
  timeZone?: string,
): string {
  const lines = [
    `${COMMAND} report: the last ${windowWords(hours)}, from ${tildify(projectsDir, home)} (read only; no message text)`,
    ...openLines(report, home, report.untilMs),
  ];
  if (report.sessions.length === 0) {
    lines.push("", "No session ran in that window.");
  }
  for (const session of report.sessions) {
    lines.push(
      "",
      `${where(session, home)}  session ${session.session.slice(0, 8)}  (last active ${stamp(session.lastAt ?? report.untilMs, timeZone)})`,
    );
    for (const line of measureLines(session)) lines.push(`  ${line}`);
  }
  if (report.sessions.length > 0) {
    lines.push("", `Totals over ${plural(report.totals.sessions, "session")}:`);
    for (const line of measureLines(report.totals)) lines.push(`  ${line}`);
    lines.push(
      "",
      report.totals.prompts === null
        ? "Prompts by cause: not recorded by this version"
        : report.totals.prompts.count === 0
          ? "Prompts by cause: none"
          : `Prompts by cause: ${askerList(report.totals.prompts.byAsker)}`,
    );
  }
  const askLog =
    report.skipped.askLog === 0 ? "" : ` (and ${plural(report.skipped.askLog, "ask-log line")})`;
  lines.push("", `Records skipped: ${report.skipped.records}${askLog}`);
  if (report.missing.length > 0) {
    lines.push("What this version did not record:");
    for (const one of report.missing) lines.push(`  ${one}`);
  }
  return lines.join("\n");
}

/** Runs `cc-smart-dev-kit report`. */
export function runReport(paths: CliPaths, args: string[], nowMs: number): number {
  const options = reportOptions(args);
  if ("error" in options) {
    console.error(`${options.error}\n\n${REPORT_USAGE}`);
    return 2;
  }
  const report = readFlow(
    { claudeConfigDir: paths.claudeConfigDir, home: paths.home, stateDir: paths.stateDir },
    {
      nowMs,
      project: options.project,
      session: options.session,
      sinceMs: nowMs - options.hours * HOUR_MS,
    },
  );
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(formatFlow(report, options.hours, projectsFolder(paths), paths.home));
  return 0;
}
