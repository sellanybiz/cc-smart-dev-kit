/**
 * The lead's notes: what changed among this lead's crew sessions since its last turn, said **once**
 * (`src/crew/store.ts` › `readNotesState`). A lead hears its crew through `crew watch`, but a
 * monitor line can land while the lead is busy, and a compaction takes the lead's context with it.
 * So each turn the lead starts (UserPromptSubmit, which also fires on a hand-back turn, and
 * SessionStart: a start, a resume after a restart, a compaction) this hook reads the crew store's
 * events log from a per-lead cursor and adds the newest line it has not said yet — the same line
 * the watch prints (`eventLine`, one home), plus how many more there were.
 *
 * - **Only a registered lead** (`readLead` by the input's `session_id`) hears anything: any other
 *   session, and a folder outside git, is silence.
 * - **Its name comes back with the first note** (LD1): a registered lead's `LEAD <tag> <plan>`
 *   goes out as `sessionTitle` in the same `UserPromptSubmit` answer, with no setting, so the
 *   person never types `/rename` (`crew lead` records it as data). The rule is `session-name.ts`'s
 *   `titleToSet`, on that hook's own record, so a `/rename` the person gives after the kit set
 *   the name stays, and the same name is never set twice. A prompt only: SessionStart's title was seen reach the
 *   transcript but not the name ListAgents shows (`session-name.ts`, the whole story).
 * - **Never twice**: the cursor moves past every event read, whether or not a line came of it, and
 *   it is seeded at the log's end the first time (the lines before it are history the lead already
 *   saw — it started those crew sessions itself). A restart reads the same cursor file, so a lead
 *   that comes back is not told the same news again.
 * - **Never a question and never a block**: one `additionalContext` line, or nothing. A store that
 *   cannot be read is one line on stderr (the frame's own answer): a lead's turn goes on, because a
 *   note is never worth stopping work.
 *
 * The review mark on a report line is judged with the built-in review agents
 * (`workflowDefaults.reviewAgents`): this hook reads no project file, so its answer is the same
 * with or without one (`MACHINE_WIDE_HOOKS`). A project that adds a review agent hears its own
 * watch's line, which resolves the project's list.
 */
import type { CliPaths } from "../cli/paths";
import {
  eventsEndOffset,
  listCrew,
  readCrewEvents,
  readLead,
  readNotesState,
  writeNotesState,
} from "../crew/store";
import { readSessionTasks, taskListId } from "../crew/tasks";
import { eventLine, phasesWaitingFor } from "../crew/watch";
import { reviewsFile, reviewsOn } from "../workflow/reviews";
import { workflowDefaults } from "../workflow/schema";
import {
  addContext,
  addContextAndTitle,
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
} from "./io";
import type { Env } from "./run";
import { isSessionId, titleToSet } from "./session-name";

/** The one note: the newest line, and how many older ones this turn did not print. */
export function notesLine(lines: readonly string[]): string | null {
  const newest = lines.at(-1);
  if (newest === undefined) return null;
  const more = lines.length - 1;
  return more === 0 ? newest : `${newest} (and ${more} more…)`;
}

/**
 * The lead's name to set at this turn, or null: a prompt only, and only through `titleToSet`
 * (`session-name.ts`), so a person's own `/rename` stays and the same name is never set twice.
 */
function leadTitle(
  input: HookInput,
  event: string,
  env: Env,
  sessionId: string,
  name: string,
): null | string {
  return event === "UserPromptSubmit"
    ? titleToSet(env, sessionId, name, stringField(input.session_title))
    : null;
}

/**
 * The one line a lead gets at a prompt while it has no task list (D23): a reminder, never a
 * block. The person's asks and the lead's open work — the merges, the questions, the phases to
 * start — belong on the list, not in a context a compaction takes away.
 */
export function taskListReminder(): string {
  return "You have no to-do list: put the person's asks and your open work on it (TaskCreate), and keep it true as they move.";
}

/**
 * The reminder this prompt adds, or null: only a prompt, only a recorded lead, and only while
 * its own list holds no task file. A folder the hook cannot read says nothing either way, so it
 * says nothing: a wrong list is worse than no nudge.
 */
function reminderFor(paths: CliPaths, env: Env, sessionId: string, event: string): null | string {
  if (event !== "UserPromptSubmit") return null;
  const listId = taskListId(env, sessionId);
  if (listId === "") return null;
  const read = readSessionTasks(paths.claudeConfigDir, listId);
  if (read.state === "unreadable") return null;
  return read.state === "read" && read.files > 0 ? null : taskListReminder();
}

/** The answer for this turn: its lines for Claude, the lead's name, both, or silence. */
function answered(event: string, lines: readonly string[], title: null | string): HookResult {
  const text = lines.length === 0 ? null : lines.join("\n");
  if (title === null) return text === null ? SILENT : addContext(event, text);
  return addContextAndTitle(event, text, title);
}

/**
 * The note this turn adds, or SILENT. `repo` is null outside a git checkout: a lead record lives in
 * a repository's store, so there is nothing to read then.
 */
export function leadNotesAnswer(
  input: HookInput,
  event: string,
  paths: CliPaths,
  repo: null | string,
  env: Env,
): HookResult {
  const sessionId = input.session_id;
  if (repo === null || !isSessionId(sessionId)) return SILENT;
  const lead = readLead(paths.stateDir, repo, sessionId);
  if (lead === null) return SILENT;
  const reminder = reminderFor(paths, env, sessionId, event);
  const cursor = readNotesState(paths.stateDir, repo, sessionId);
  if (cursor === null) {
    // First turn in this lead: the log's history is what the lead already saw. From here on, new.
    writeNotesState(paths.stateDir, repo, sessionId, {
      offset: eventsEndOffset(paths.stateDir, repo),
    });
    return answered(
      event,
      reminder === null ? [] : [reminder],
      leadTitle(input, event, env, sessionId, lead.name),
    );
  }
  const read = readCrewEvents(paths.stateDir, repo, cursor.offset);
  const mine = listCrew(paths.stateDir, repo).records.filter(
    (one) => one.leadSessionId === sessionId,
  );
  const reviewFile = reviewsFile(paths.stateDir, repo);
  const lines: string[] = [];
  for (const crewEvent of read.events) {
    // Another lead's crew sessions are that lead's news, not this one's.
    if (crewEvent.lead !== sessionId) continue;
    const record = mine.find((one) => one.id === crewEvent.crew) ?? null;
    const reviewed =
      record !== null &&
      reviewsOn(reviewFile, record.branch, workflowDefaults.reviewAgents).length > 0;
    const line = eventLine(
      crewEvent,
      record,
      record === null ? [] : phasesWaitingFor(record, mine),
      reviewed,
    );
    if (line !== null) lines.push(line);
  }
  // Past every event read, spoken or not: the next turn says only what is newer.
  writeNotesState(paths.stateDir, repo, sessionId, { offset: read.offset });
  // The reminder first — it is about the prompt just typed — then the news. The title last: its
  // record is written as it is set, and a store that throws above leaves that record alone, so
  // the next prompt tries the name again.
  const note = notesLine(lines);
  return answered(
    event,
    [...(reminder === null ? [] : [reminder]), ...(note === null ? [] : [note])],
    leadTitle(input, event, env, sessionId, lead.name),
  );
}
