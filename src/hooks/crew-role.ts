/**
 * The crew session's own hook: silent unless `CC_SMART_DEV_KIT_CREW` names a crew session in this
 * session's environment (the settings file `crew start` launches it with). A plain session pays
 * one environment read, and nothing else.
 *
 * - **SessionStart (startup, resume, compact)**: the role card, from the crew session's record and
 *   its brief file — its name and phase, the files the phase owns, the brief's path, how to hand
 *   back (`crew report`), how to ask or tell (`crew report --question`, `crew tell`), and the git
 *   rule (commit on its branch, never push). A resumed or compacted crew session gets it again,
 *   because its first prompt is gone from its context.
 * - **PreToolUse on `AskUserQuestion` and `ExitPlanMode`**: denied with the report step (D36). A
 *   crew session never asks the person: its question goes to its lead, which answers it or asks
 *   the person. The answer is a **deny**, not an ask: the fix is mechanical, and asking the person
 *   here would be the very thing the hook prevents. **No store read**, so the answer is the same
 *   when the project's file is broken or too new, and outside git.
 * - **Stop**: records the session's last line on its record (masked and clipped: a record is read
 *   by a person and by the lead) and **never gives context** — a Stop hook's `additionalContext`
 *   keeps the turn going and starves hand-backs (L1a.1). When the newest `step` or `report` event
 *   of this crew session is a `step`, the turn ended mid-phase with no report: it blocks **once**
 *   with the report step as its reason (`{"decision":"block","reason":…}`; Claude Code runs no
 *   second block while `stop_hook_active` is true). The events log is read from the crew session's
 *   own cursor (`readStopState`: the byte after the last line read, and the newest `step` or
 *   `report` seen), so a Stop costs the same on day 30 as on day 1 — the log only grows. Nothing runs while `background_tasks` is not
 *   empty: that turn is not over, and Claude Code wakes the session when the work lands.
 * - **StopFailure (D42)**: marks the crew session `paused` when a model limit ended its turn
 *   (`rate_limit`, `overloaded`, `server_error`), with what it waits for taken from the router's
 *   state file (`waitingFor`: its slot's breaker, Claude's plan limit, else `unknown`) and one
 *   `state` event the lead's watch shows. It never resumes anything: the watch does, once the
 *   gateway answers again (`src/crew/wait.ts`, `src/crew/watch.ts`). A stop of a crew session
 *   that already ended its phase, or waits in the queue, pauses nothing.
 *
 * A store that cannot be read is one line on stderr and no block: a crew session keeps working,
 * and a Stop hook never stops a session on a bug of the kit's.
 */
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { REPORT_COMMAND } from "../crew/brief";
import { RUNNING_STATES } from "../crew/places";
import { crewIdOf } from "../crew/session";
import {
  type CrewRecord,
  crewBriefFile,
  readCrew,
  readCrewEvents,
  readStopState,
  updateCrew,
  writeStopState,
} from "../crew/store";
import { lastPauseOf, pausesCrew, pauseText, readWaitFacts, waitFor } from "../crew/wait";
import { maskedLine } from "../gateway/plain-text";
import {
  addContext,
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
} from "./io";
import type { Env } from "./run";

/** The two tools a crew session never calls: each one asks the person (D36). */
export const CREW_ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"] as const;

/** The longest piece of the session's last line its record keeps. */
export const LAST_LINE_MAX = 120;

/** The reason of a Stop answer that reports nothing, and of the stop's one block. */
export function reportStep(): string {
  return `No report has been handed back for this phase. Hand it back with \`${REPORT_COMMAND} --status done\` (or \`--status failed\` and why), then end the turn.`;
}

/** The line a crew session gets instead of asking the person (D36). */
export function questionStep(): string {
  return `${REPORT_COMMAND} --question "<q>" --option "<a>" --option "<b>" --recommend <n>`;
}

/** The line a crew session tells another crew session a contract change or question (C1). */
export function tellStep(): string {
  return `${COMMAND} crew tell <name…> --kind contract|question "<text>"`;
}

/** The card a crew session starts (or resumes) with: who it is, and the lines it needs. */
export function roleCard(record: CrewRecord, briefFile: string): string {
  const files =
    record.files.length === 0
      ? "The brief names no files this phase owns."
      : `The files this phase owns: ${record.files.map((file) => `\`${file}\``).join(", ")}. Say in your report why you changed any other file.`;
  return [
    `You are the crew session \`${record.name}\`, phase \`${record.phase}\` of \`${record.plan}\`, for the lead \`${record.leadName}\`.`,
    `Your brief, which is your task: ${briefFile}`,
    files,
    `Hand the phase back with \`${REPORT_COMMAND} --status done\` (or \`--status failed\` and why), then end the turn.`,
    `Ask your lead, never the person: \`${questionStep()}\``,
    `Tell another crew session only a contract change or a contract question: \`${tellStep()}\``,
    `Git: commit on your branch \`${record.branch}\`; never push, never open a pull request, never merge — the lead handles git.`,
  ].join("\n");
}

/** Why the store could not be used, as the hook says it: one line, and never a block. */
function storeProblem(why: string): HookResult {
  return { stderr: `cc-smart-dev-kit crew-role: ${why}` };
}

/** What went wrong, in words. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The crew session's record in `repo`; a result that carries the failure line when it cannot be read. */
function recordOf(
  id: string,
  repo: string,
  paths: CliPaths,
): { ok: true; record: CrewRecord } | { ok: false; result: HookResult } {
  let record: CrewRecord | null;
  try {
    record = readCrew(paths.stateDir, repo, id);
  } catch (error) {
    return { ok: false, result: storeProblem(reasonOf(error)) };
  }
  if (record === null) {
    return {
      ok: false,
      result: storeProblem(`no crew session "${id}" is recorded for ${repo}`),
    };
  }
  return { ok: true, record };
}

/** SessionStart: the role card, for a start, a resume and a compaction only. */
function startCard(input: HookInput, id: string, repo: string, paths: CliPaths): HookResult {
  const source = stringField(input.source);
  // A `clear` is a new conversation: no card, as on a session that is not a crew session's.
  if (source !== "startup" && source !== "resume" && source !== "compact") return SILENT;
  const found = recordOf(id, repo, paths);
  if (!found.ok) return found.result;
  const brief = crewBriefFile(paths.stateDir, repo, id);
  return addContext("SessionStart", roleCard(found.record, brief));
}

/** Stop: record the last line, then block once when the turn ended with a step and no report. */
async function stopAnswer(
  input: HookInput,
  id: string,
  repo: string,
  paths: CliPaths,
): Promise<HookResult> {
  // A Stop that answers a block from this hook (or another): never a second one.
  if (input.stop_hook_active === true) return SILENT;
  // A turn that waits on background work is not over: Claude Code wakes the session when it lands.
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) return SILENT;
  const found = recordOf(id, repo, paths);
  if (!found.ok) return found.result;
  const said = stringField(input.last_assistant_message);
  if (said !== null) {
    try {
      await updateCrew(
        paths.stateDir,
        repo,
        id,
        { lastLine: maskedLine(said, [], LAST_LINE_MAX, { mark: "…" }) },
        Date.now(),
      );
    } catch (error) {
      // The store cannot be written: no block either, because its events cannot be trusted.
      return storeProblem(reasonOf(error));
    }
  }
  // From the byte the Stop before this one read: the log grows with every step, report and
  // state change of every crew session, so a read from its start would cost more each day.
  const cursor = readStopState(paths.stateDir, repo, id);
  let events: ReturnType<typeof readCrewEvents>;
  try {
    events = readCrewEvents(paths.stateDir, repo, cursor?.offset ?? 0);
  } catch (error) {
    return storeProblem(reasonOf(error));
  }
  // The newest step or report of the whole session: one in this read's window, else the one the
  // cursor remembers. Read this way, a Stop answers what a read from the log's start answered,
  // and a cursor that cannot be written is only a slower next Stop — never a wrong answer.
  const newest = events.events
    .filter((event) => event.crew === id && (event.type === "step" || event.type === "report"))
    .at(-1);
  const fresh: "report" | "step" | null =
    newest?.type === "step" ? "step" : newest?.type === "report" ? "report" : null;
  const last = fresh ?? cursor?.last ?? null;
  try {
    writeStopState(paths.stateDir, repo, id, { last, offset: events.offset });
  } catch (error) {
    return storeProblem(reasonOf(error));
  }
  return last === "step"
    ? { stdout: JSON.stringify({ decision: "block", reason: reportStep() }) }
    : SILENT;
}

/**
 * Every answer of the hook, for every event it is wired for. `repo` is null outside a git checkout
 * (the PreToolUse answer needs none; a card, a stop and a pause need the store, so they stay
 * silent there). Async because the Stop and StopFailure answers write the record:
 * `onConfigProblem` and `outsideGit` call it too, so a broken or too new project file never
 * changes an answer.
 */
export async function crewRoleAnswer(
  input: HookInput,
  event: string,
  env: Env,
  paths: CliPaths,
  repo: null | string,
  options: CrewRoleOptions = {},
): Promise<HookResult> {
  const id = crewIdOf(env);
  if (id === null) return SILENT;
  if (event === "PreToolUse") {
    const tool = stringField(input.tool_name);
    return tool !== null && (CREW_ASK_TOOLS as readonly string[]).includes(tool)
      ? toolDecision("deny", questionStep())
      : SILENT;
  }
  if (repo === null) return SILENT;
  if (event === "SessionStart") return startCard(input, id, repo, paths);
  if (event === "Stop") return await stopAnswer(input, id, repo, paths);
  if (event === "StopFailure") return await stopFailureAnswer(input, id, repo, paths, options);
  return SILENT;
}

/** What a crew session's pause reads besides its input; a test hands in its own. */
export interface CrewRoleOptions {
  /** The clock the pause records and its line shows; undefined: `Date.now()`. */
  nowMs?: number;
  /** Shown times use it; undefined: the machine's. */
  timeZone?: string;
}

/**
 * StopFailure: the turn ended on a model limit, so the crew session is `paused` with what it
 * waits for (D42). One `state` event, whose line the watch shows; the record's `lastPause`
 * carries the hold-off a re-pause doubles. Never a block and never stdout: Claude Code ignores
 * a StopFailure hook's output, and the pause is the store's.
 */
async function stopFailureAnswer(
  input: HookInput,
  id: string,
  repo: string,
  paths: CliPaths,
  options: CrewRoleOptions,
): Promise<HookResult> {
  const error = stringField(input.error);
  if (!pausesCrew(error)) return SILENT;
  const found = recordOf(id, repo, paths);
  if (!found.ok) return found.result;
  const record = found.record;
  // Only a session that runs now waits for a model to answer: one that ended its phase, was
  // stopped, or still waits in the queue has no turn to pause.
  if (!(RUNNING_STATES as readonly string[]).includes(record.state)) return SILENT;
  const nowMs = options.nowMs ?? Date.now();
  const waitingFor = waitFor(record, readWaitFacts(paths, nowMs), nowMs);
  const text = pauseText(waitingFor, error, nowMs, options.timeZone);
  try {
    await updateCrew(
      paths.stateDir,
      repo,
      id,
      { lastPause: lastPauseOf(record.lastPause, nowMs), state: "paused", waitingFor },
      nowMs,
      text,
    );
  } catch (why) {
    // A store that cannot be written is one line: the session goes on, and its next turn may pause.
    return storeProblem(reasonOf(why));
  }
  return SILENT;
}
