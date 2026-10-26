/**
 * Who runs a `crew` command: a crew session, or the Claude Code session that will be the
 * lead.
 *
 * - **A crew session** is named in its own environment: `crew start` launches it with a settings
 *   file whose `env` sets `CREW_ENV` to its id (proved live, L1a.1: the crew session's Bash sees the
 *   variable). A crew session never starts crew sessions and is never a lead.
 * - **The calling session** is first the one Claude Code names in the Bash tool's environment:
 *   `CLAUDE_PID` (its own process) and `CLAUDE_CODE_SESSION_ID`, seen on 2.1.310. Both must be
 *   set and agree with its record, `<config folder>/sessions/<pid>.json`
 *   (`sessionNamedByEnv`). Else it is the nearest ancestor process that has such a record
 *   (proved live on Linux, L1a.1 P13: the Bash tool's shell runs under the session's own
 *   process, in a terminal and in the background alike). The record holds the session's id and
 *   its name (`parseSessionRecord`, one home with the hooks). **On native Windows the walk alone
 *   finds nothing.** The launcher is a `sh` script that `exec`s bun, and Git Bash's fork and
 *   exec leave bun's Windows parent pointing at a process that has already exited, so the chain
 *   ends two shells up, short of `claude.exe` (seen on a Windows 11 PC, 2026-10-27).
 *
 * Reading parents: `/proc` on Linux (no process started); elsewhere one listing of the running
 * processes (`runningPrograms`: `ps` on macOS, PowerShell on Windows), read once per command.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { parseSessionRecord, type SessionRecord } from "../hooks/sessions";
import { ancestorsBy, type ParentReader, parentPidFromStat, readProcStat } from "../jobs/ancestry";
import { type RunningProgram, runningPrograms } from "../worktrees/machine-facts";

/** The variable that names a crew session to its own session: its id in the crew store. */
export const CREW_ENV = "CC_SMART_DEV_KIT_CREW";

type Env = Record<string, string | undefined>;

/** The crew id this process runs for, or null when it is not a crew session's. */
export function crewIdOf(env: Env): null | string {
  const id = env[CREW_ENV]?.trim() ?? "";
  return id === "" ? null : id;
}

/**
 * What a crew session reads instead of a guard's question (D36): nobody is at the machine to
 * answer it, so the session puts the question on the record for its lead and goes on with the
 * rest of its phase. One home for the words every guard's crew refusal ends with.
 */
export const CREW_QUESTION_STEP =
  "Nobody is at the machine to answer this question, so the call is refused. Ask your lead " +
  `with \`${COMMAND} crew report --question "<the question>" --option "<choice>" --option ` +
  '"<choice>" --recommend <n>`, and go on with the rest of your phase.';

/** Claude Code's record of the running session with process `pid`. */
export function sessionRecordFile(claudeConfigDir: string, pid: number): string {
  return join(claudeConfigDir, "sessions", `${pid}.json`);
}

/** A session record that is there but cannot be read: nobody can say which session calls. */
export class SessionRecordError extends Error {
  override name = "SessionRecordError";
}

/** Reads one file as text; null when it is not there or cannot be read. */
export type ReadText = (file: string) => null | string;

const readText: ReadText = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // Not there (most ancestors are no session), or not ours to read: not a session record.
    return null;
  }
};

/** The variable Claude Code sets in its Bash tool to its own process id. */
export const CLAUDE_PID_ENV = "CLAUDE_PID";

/** The variable Claude Code sets in its Bash tool to its session's id. */
export const CLAUDE_SESSION_ID_ENV = "CLAUDE_CODE_SESSION_ID";

/** The record of session process `pid`; null when there is none. Throws when it does not read. */
function recordOf(claudeConfigDir: string, pid: number, read: ReadText): SessionRecord | null {
  const file = sessionRecordFile(claudeConfigDir, pid);
  const text = read(file);
  if (text === null) return null;
  const record = parseSessionRecord(text);
  if (record === null || record.pid !== pid) {
    throw new SessionRecordError(
      `the session record ${file} cannot be read, so the session that runs this command is unknown`,
    );
  }
  return record;
}

/**
 * The session Claude Code names in this process's environment: `CLAUDE_PID`'s record, when
 * `CLAUDE_CODE_SESSION_ID` is set too and is the id that record holds. Null when either is
 * missing, when the process has no record (a variable left over from a session that ended), or
 * when the ids differ (a reused pid): then the process tree decides.
 */
export function sessionNamedByEnv(
  claudeConfigDir: string,
  env: Env,
  read: ReadText = readText,
): SessionRecord | null {
  const pid = env[CLAUDE_PID_ENV]?.trim() ?? "";
  const id = env[CLAUDE_SESSION_ID_ENV]?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(pid) || id === "") return null;
  const record = recordOf(claudeConfigDir, Number(pid), read);
  return record !== null && record.sessionId === id ? record : null;
}

/**
 * The Claude Code session this process runs under: the one its environment names
 * (`sessionNamedByEnv`), else the nearest ancestor of `pid` with a session record. Null when
 * neither finds one (outside Claude Code). Throws `SessionRecordError` when the record it finds
 * does not read as one: walking past it would name an outer session instead.
 */
export function callingSession(
  claudeConfigDir: string,
  pid: number,
  parentOf: ParentReader,
  env: Env = {},
  read: ReadText = readText,
): SessionRecord | null {
  const named = sessionNamedByEnv(claudeConfigDir, env, read);
  if (named !== null) return named;
  for (const ancestor of ancestorsBy(pid, parentOf)) {
    const record = recordOf(claudeConfigDir, ancestor, read);
    if (record !== null) return record;
  }
  return null;
}

/** One process's command line as text (its arguments joined by spaces), or null when unknown. */
export type CommandLineReader = (pid: number) => null | string;

/** What a `crew` command reads about the processes above it. */
export interface ProcessFacts {
  commandLineOf: CommandLineReader;
  parentOf: ParentReader;
}

/** A process's arguments from `/proc/<pid>/cmdline`, or null when it is gone or not ours. */
function procCommandLine(pid: number): null | string {
  try {
    const raw = readFileSync(`/proc/${String(pid)}/cmdline`, "utf8");
    const args = raw.split("\0").filter((arg) => arg !== "");
    return args.length === 0 ? null : args.join(" ");
  } catch {
    // Gone, or another user's: its command line is unknown.
    return null;
  }
}

/**
 * The real readers. Linux reads `/proc` and starts nothing. Elsewhere the first question lists
 * the running processes once (`runningPrograms`), and both readers answer from that listing; a
 * listing that fails answers null for every pid. On Windows the listing holds each program's
 * file, not its arguments, so no command line is known there.
 */
export function realProcessFacts(platform: NodeJS.Platform): ProcessFacts {
  if (platform === "linux") {
    return {
      commandLineOf: procCommandLine,
      parentOf: (pid) => {
        const stat = readProcStat(pid);
        return stat === null ? null : parentPidFromStat(stat);
      },
    };
  }
  let listed: Map<number, RunningProgram> | null = null;
  const program = (pid: number): RunningProgram | undefined => {
    if (listed === null) {
      const found = runningPrograms(platform);
      listed = new Map(found === "unknown" ? [] : found.map((one) => [one.pid, one]));
    }
    return listed.get(pid);
  };
  return {
    commandLineOf: (pid) => (platform === "win32" ? null : (program(pid)?.path ?? null)),
    parentOf: (pid) => program(pid)?.parentPid ?? null,
  };
}
