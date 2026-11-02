/**
 * The lead's notes: what changed among this lead's crew sessions since its last turn, said **once**
 * (`src/crew/store.ts` › `readNotesState`). A lead hears its crew through `crew watch`, but a
 * monitor line can land while the lead is busy, and a compaction takes the lead's context with it.
 * So each turn the lead starts (UserPromptSubmit, which also fires on a hand-back turn, and
 * SessionStart: a start, a resume after a restart, a compaction) this hook reads the
 * crew store's events log from a per-lead cursor and adds the newest line it has not said yet —
 * the same line
 * the watch prints (`eventLine`, one home), plus how many more there were.
 *
 * - **A registered lead** (`readLead` by the input's `session_id`) hears its notes. An unregistered
 *   continuation hears only an adoption hint when a matching absent lead still has crew.
 *   A crew session, an unrelated ordinary session, and a folder outside git hear nothing.
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
 * - **Stop continues an active task once**: a registered lead with an `in_progress` task and
 *   no `Waiting for:` line in its last message gets a block. A follow-up Stop, a crew session,
 *   a turn that waits on background work other than the lead's own watch, and a message or task
 *   list it cannot read are silent.
 * - **Notes never ask or block**: one `additionalContext` line, or nothing. A store that
 *   cannot be read is one line on stderr (the frame's own answer): a lead's turn goes on, because a
 *   note is never worth stopping work.
 * - **A lead whose watch is gone is told** (every turn, while it lasts): when no live watch holds
 *   the lead's lease and it still has crew sessions that can talk (any not yet merged or
 *   removed), one line says how to start it. A lead that never ran the lead skill in this
 *   session — no lease was ever taken — is told to run it. One whose watch ended is told to start
 *   the same command with Claude Code's `Monitor` tool, or to run the skill in a new session: a
 *   monitor is armed once for each Claude process and the skill cannot arm it a second time
 *   there (Claude Code 2.1.310). A lease a `--once` look left is no ended watch: such a look ends
 *   at its first news by design, so it says nothing. A lead whose plan ended (`crew lead
 *   --end`) hears nothing.
 * - **A start note for every lead** (D61): at a SessionStart only — a start, a resume or a
 *   compaction, each of which builds the lead's context again — the answer also holds the one
 *   line saying the crew builds the work. Those are the three sources `hooks.json` wires the
 *   hook for (`startup|resume|compact`, kept by `entries.test.ts`); a `clear` is a new
 *   conversation, which `crew-role` reads the same way. Nothing at a prompt and nothing on an
 *   edit: the owner chose words, not a guard. An ordinary session and a crew session hear
 *   neither line.
 *
 * The review mark on a report line is judged with the built-in review agents
 * (`workflowDefaults.reviewAgents`): this hook reads no project file, so its answer is the same
 * with or without one (`MACHINE_WIDE_HOOKS`). A project that adds a review agent hears its own
 * watch's line, which resolves the project's list.
 */

import { COMMAND } from "../build-info/names";
import { type CliPaths, cliPaths } from "../cli/paths";
import { isLeadWatchTask } from "../crew/brief";
import { isOpenCrewOfLead } from "../crew/lifecycle";
import { crewIdOf } from "../crew/session";
import { LEAD_SKILL } from "../crew/skills";
import {
  eventsEndOffset,
  type LeadRecord,
  leadSessions,
  listCrew,
  listLeads,
  readCrewEvents,
  readLead,
  readNotesState,
  readWatchLease,
  watchIsAlive,
  writeNotesState,
} from "../crew/store";
import { taskListId } from "../crew/tasks";
import { eventLine, phasesWaitingFor, WATCH_RESTART } from "../crew/watch";
import { loadProjectConfig, locateCheckout, ownHooksOf } from "../project/resolve";
import { projectKey, taskContext } from "../tasks/context";
import { leadTaskView, type OpenTaskLine } from "../tasks/guard-view";
import { checkProjectTasks } from "../tasks/project/check";
import { leadTaskReminder, TASK_COMMAND, taskCloseStep } from "../tasks/words";
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
import { isSessionId, titleToSetOrProblem } from "./session-name";
import { liveSessions, type SessionRecord } from "./sessions";

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
 * A name whose record cannot be written is not set, and the turn goes on with its news:
 * `problem` is the line for stderr (`titleToSetOrProblem`).
 */
function leadTitle(
  input: HookInput,
  event: string,
  env: Env,
  sessionId: string,
  name: string,
): { problem: null | string; title: null | string } {
  return event === "UserPromptSubmit"
    ? titleToSetOrProblem(env, sessionId, name, stringField(input.session_title))
    : { problem: null, title: null };
}

/**
 * The line a lead gets at a start, a resume and a compaction (D61): the lead skill's
 * "Your crew builds" in one line. A lead plans, briefs, starts, answers and merges; the building
 * goes to its crew sessions, because the lead's context is re-read on every turn and every file
 * it reads or writes costs on every later one. Words only: never at a prompt, never on an edit,
 * and never a refusal.
 */
export function leadStartNote(): string {
  return "You lead: your crew sessions build the work — your context is re-read every turn, so every file you read or write costs on every later turn.";
}

/**
 * The one line a lead gets at a prompt while it has no task list (D23): a reminder, never a
 * block. The person's asks and the lead's open work — the merges, the questions, the phases to
 * start — belong on the list, not in a context a compaction takes away.
 */
export function taskListReminder(): string {
  return leadTaskReminder();
}

/**
 * The reminder this prompt adds, or null: only a prompt, only a recorded lead, and only while
 * its own list holds no task file. A folder the hook cannot read says nothing either way, so it
 * says nothing: a wrong list is worse than no nudge.
 */
function reminderFor(
  paths: CliPaths,
  env: Env,
  lead: LeadRecord,
  repo: string,
  event: string,
): null | string {
  if (event !== "UserPromptSubmit") return null;
  const view = leadTaskView({
    stateDir: paths.stateDir,
    claudeConfigDir: paths.claudeConfigDir,
    settingsFile: paths.settingsFile,
    project: projectKey(repo),
    listId: taskListId(env, lead.sessionId),
    plan: lead.plan,
    sessionIds: leadSessions(lead),
  });
  return view.unreadable.length > 0 || view.hasOwn ? null : leadTaskReminder();
}

/**
 * The states in which a crew session has nothing more to tell its lead: its branch is merged, or
 * it is gone. A lead with only such records has no news to miss.
 */
const SPENT_STATES: readonly string[] = ["discarded", "merged", "removed"];

/** The line for a lead that has not started its watch in this session: run the lead skill. */
export function watchNeverStartedNote(): string {
  return `Your crew watch is not running, so crew news will not reach you: run /${LEAD_SKILL} to start it.`;
}

/**
 * The line for a lead whose watch ended: the same command started by hand (`WATCH_RESTART`). The
 * skill cannot arm its monitor a second time in one Claude process, but a lead that was resumed in
 * a new one can run it again, so the line says both and is true in either.
 */
export function watchEndedNote(): string {
  return `Your crew watch ended: ${WATCH_RESTART} (or run /${LEAD_SKILL} in a new session).`;
}

/**
 * The line about the lead's watch, or null: the lead's plan is not ended, it has a crew session
 * that can still talk, and no live watch holds its lease (`watchIsAlive`). No lease ever taken:
 * the skill never ran. A lease whose holder is gone: the monitor ended — unless that lease is a
 * `--once` look's, which ends by design at its first news and was no monitor. A store or a lease
 * the hook cannot read says nothing — a wrong line is worse than none.
 */
function watchNote(paths: CliPaths, repo: string, lead: LeadRecord): null | string {
  if (lead.endedAt != null) return null;
  try {
    const live = listCrew(paths.stateDir, repo).records.some(
      (one) => one.leadSessionId === lead.sessionId && !SPENT_STATES.includes(one.state),
    );
    if (!live || watchIsAlive(paths.stateDir, repo, lead.sessionId)) return null;
    const lease = readWatchLease(paths.stateDir, repo, lead.sessionId);
    if (lease === null) return watchNeverStartedNote();
    return lease.once === true ? null : watchEndedNote();
  } catch {
    return null;
  }
}

/**
 * The answer for this turn: its lines for Claude, the lead's name, both, or silence — and one
 * line on stderr when the name's record could not be written (the lines still go out).
 */
function answered(
  event: string,
  lines: readonly string[],
  name: { problem: null | string; title: null | string },
): HookResult {
  const text = lines.length === 0 ? null : lines.join("\n");
  const { problem, title } = name;
  const result =
    title === null
      ? text === null
        ? SILENT
        : addContext(event, text)
      : addContextAndTitle(event, text, title);
  return problem === null
    ? result
    : { ...result, stderr: `cc-smart-dev-kit lead-notes: ${problem}` };
}

/** The one Stop instruction, naming the first task, how to close it, and counting the others. */
function continueTask(first: OpenTaskLine, count: number): string {
  const more = count > 1 ? ` (and ${String(count - 1)} more)` : "";
  return `Your task "${first.ref} ${first.subject}"${more} is still in progress. Continue it now, and mark it done the moment it is: ${taskCloseStep(first.ref)}. If it really waits for something — a crew session, the person, CI — end your turn with one line: Waiting for: <what>.`;
}

/** The read-only Stop decision, shared with the notifier. Throws only when a read fails. */
export function leadStopReason(input: HookInput, env: Env, paths: CliPaths): string | null {
  if (crewIdOf(env) !== null || input.stop_hook_active === true) return null;
  // A turn that waits on background work (a subagent, a background command) is not over: Claude
  // Code wakes the lead when it lands. The lead's own watch is no such work: it runs all session.
  if (Array.isArray(input.background_tasks) && !input.background_tasks.every(isLeadWatchTask)) {
    return null;
  }
  const sessionId = input.session_id;
  if (!isSessionId(sessionId)) return null;
  const said = stringField(input.last_assistant_message);
  if (said === null) return null;
  if (
    said.split(/\r?\n/).some((line) => /^waiting for:/i.test(line.trim().replace(/^[*_>\- ]+/, "")))
  )
    return null;
  const cwd = stringField(input.cwd);
  if (cwd === null) return null;
  const checkout = locateCheckout(cwd, { env });
  if (checkout === null || ownHooksOf(checkout).includes("lead-notes")) return null;
  // Match the frame: a broken or too-new project file must never yield a Stop block.
  const project = loadProjectConfig(checkout);
  const repo = project.mainCheckout ?? project.root;
  const lead = readLead(paths.stateDir, repo, sessionId);
  if (lead === null || lead.endedAt != null) return null;
  const list = leadTaskView({
    stateDir: paths.stateDir,
    claudeConfigDir: paths.claudeConfigDir,
    settingsFile: paths.settingsFile,
    project: projectKey(repo),
    listId: taskListId(env, sessionId),
    plan: lead.plan,
    sessionIds: leadSessions(lead),
  });
  if (list.unreadable.length > 0) return null;
  const active = list.inProgress;
  const first = active[0];
  return first === undefined ? null : continueTask(first, active.length);
}

/** Whether this Stop will continue the lead: an unreadable store asks nothing of a sibling. */
export function leadStopWouldBlockAt(input: HookInput, env: Env): boolean {
  try {
    return leadStopReason(input, env, cliPaths(env)) !== null;
  } catch {
    return false;
  }
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
  deps: { sessions?: () => readonly SessionRecord[] } = {},
): HookResult {
  if (event === "Stop") {
    if (repo === null) return SILENT;
    const reason = leadStopReason(input, env, paths);
    return reason === null ? SILENT : { stdout: JSON.stringify({ decision: "block", reason }) };
  }
  const sessionId = input.session_id;
  if (repo === null || !isSessionId(sessionId)) return SILENT;
  const lead = readLead(paths.stateDir, repo, sessionId);
  if (lead === null) {
    if (event !== "UserPromptSubmit" || crewIdOf(env) !== null) return SILENT;
    const leads = listLeads(paths.stateDir, repo).records.filter((one) => one.endedAt == null);
    if (leads.length === 0) return SILENT;
    let sessions: readonly SessionRecord[];
    try {
      sessions = deps.sessions?.() ?? liveSessions(paths.claudeConfigDir);
    } catch {
      return {
        ...SILENT,
        stderr: `${COMMAND} lead-notes: the session records cannot be read`,
      };
    }
    const sessionName = sessions.find((one) => one.sessionId === sessionId)?.name;
    const candidates = leads.filter(
      (one) =>
        one.cwd === input.cwd || one.name === input.session_title || one.name === sessionName,
    );
    const crew = listCrew(paths.stateDir, repo).records;
    for (const old of candidates) {
      const count = crew.filter((one) => isOpenCrewOfLead(one, old)).length;
      if (
        count === 0 ||
        old.sessionUnknownSince == null ||
        sessions.some((one) => one.sessionId === old.sessionId) ||
        watchIsAlive(paths.stateDir, repo, old.sessionId)
      )
        continue;
      return addContext(
        event,
        `This session continues lead ${old.name} (${old.sessionId.slice(0, 8)})? Run \`${COMMAND} crew lead --plan ${old.plan}\` to take its ${count} crew sessions.`,
      );
    }
    return SILENT;
  }
  if (lead.endedAt != null) return SILENT;
  const ids = leadSessions(lead);
  // The rule comes first at a start; a prompt hears the reminder and the news instead.
  const startNote = event === "SessionStart" ? [leadStartNote()] : [];
  if (event === "SessionStart" && (input.source === "startup" || input.source === "resume")) {
    const cwd = stringField(input.cwd);
    if (cwd !== null) {
      try {
        const context = taskContext(cwd, env);
        if (context.ok && context.checkoutRoot !== null && context.projectTasks.ok) {
          const settings = context.projectTasks;
          const stale = checkProjectTasks({
            checkoutRoot: context.checkoutRoot,
            dir: settings.dir,
            settings: { staleDays: settings.staleDays },
            now: new Date(),
            shippedIds: new Set(),
            legacyFolders: settings.legacyFolders,
          }).filter((finding) => finding.kind === "stale").length;
          if (stale > 0)
            startNote.push(
              `${stale} project tasks are open past ${settings.staleDays} days: run \`${TASK_COMMAND} check\`.`,
            );
        }
      } catch {
        // Unavailable project tasks add no start note.
      }
    }
  }
  const reminder = reminderFor(paths, env, lead, repo, event);
  const watch = watchNote(paths, repo, lead);
  const cursor = readNotesState(paths.stateDir, repo, sessionId);
  if (cursor === null) {
    // First turn in this lead: the log's history is what the lead already saw. From here on, new.
    writeNotesState(paths.stateDir, repo, sessionId, {
      offset: eventsEndOffset(paths.stateDir, repo),
    });
    return answered(
      event,
      [...startNote, ...(reminder === null ? [] : [reminder]), ...(watch === null ? [] : [watch])],
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
    if (crewEvent.lead === null || !ids.includes(crewEvent.lead) || crewEvent.type === "adopted")
      continue;
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
  // The start note first (a start only), then the reminder — it is about the prompt just typed —
  // then the watch's line, then the news. The title last: its
  // record is written as it is set, and a store that throws above leaves that record alone, so
  // the next prompt tries the name again.
  const note = notesLine(lines);
  return answered(
    event,
    [
      ...startNote,
      ...(reminder === null ? [] : [reminder]),
      ...(watch === null ? [] : [watch]),
      ...(note === null ? [] : [note]),
    ],
    leadTitle(input, event, env, sessionId, lead.name),
  );
}
