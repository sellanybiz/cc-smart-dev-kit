/**
 * The crew session's own hook: silent unless `CC_SMART_DEV_KIT_CREW` names a crew session in this
 * session's environment (the settings file `crew start` launches it with). A plain session pays
 * one environment read, and nothing else.
 *
 * - **SessionStart (startup, resume, compact)**: the role card, from the crew session's record and
 *   its brief file — its name and phase, the files the phase owns, the brief's path, how to hand
 *   back (`crew report`), how to ask or tell (`crew report --question`, `crew tell`), and the git
 *   rule (commit on its branch, never push). A resumed or compacted crew session gets it again,
 *   because its first prompt is gone from its context. **The session's own `cwd` is checked
 *   against the record's worktree**: `claude agents --json` reports the launch folder until a
 *   `--bg -w` session has entered its worktree (2.1.308), so the launcher cannot judge it; the
 *   session can. Inside the worktree, a `starting` record becomes `working`; outside it, the
 *   record is `failed` with the reason (the lead's watch then ends the session) and the card
 *   tells it to do nothing and end its turn.
 * - **PreToolUse on `AskUserQuestion` and `ExitPlanMode`**: denied with the report step (D36). A
 *   crew session never asks the person: its question goes to its lead, which answers it or asks
 *   the person. The answer is a **deny**, not an ask: the fix is mechanical, and asking the person
 *   here would be the very thing the hook prevents. **No store read**, so the answer is the same
 *   when the project's file is broken or too new, and outside git.
 * - **PreToolUse on `Edit`, `Write` and `NotebookEdit`**: the session's **first edit waits for
 *   its task list** (D23). While the session's task folder holds no task file, the call is
 *   **denied** with the step — look the task tools up, then one `TaskCreate` per part of the
 *   brief, each with its done-check. Nobody watches a crew session, and its list is what it
 *   resumes from after a compaction and what the person reads; the crew skill asked for one and
 *   17 of 24 live sessions still skipped it, because Claude Code leaves the task tools out until
 *   a session looks them up. Once a task file exists the hook answers from its own cache
 *   (`taskGateFile`, `src/crew/tasks.ts`) and never lists the folder again for that list. A
 *   subagent's edit is judged too: its `TaskCreate` writes into its parent session's folder, one
 *   list for the whole session (proved live, `docs/claude-code-contract.md` § The to-do list).
 *   A store or a folder the hook cannot read lets the edit through: a check that cannot be made
 *   is no denial.
 * - **UserPromptSubmit (D55)**: the person typed into the crew session. Their word wins over the
 *   brief, so the lead has to hear it: one `person` event (the first line, masked and clipped)
 *   and one short line of context telling the session whose word it is. Only the person's own
 *   prompt counts — Claude Code runs this hook for every turn a session gets, and the input says
 *   nothing about where a prompt came from (proved live on 2.1.309, only `prompt`),
 *   so the prompt's own shape decides: a `SendMessage` delivery carries
 *   `<cross-session-message …>`, a monitor's line carries `<task-notification>`, a subagent's
 *   hand-back the session itself launched carries `<agent-message from=…>`, and the three
 *   prompts a lead's own transport gives a crew session bare — `crew start`'s launch line
 *   (`firstPrompt`, built for the record's own name, lead and brief file), `crew answer`'s
 *   resume of a stopped session, and the watch's `resumeText` of a paused one — are recognised
 *   from the store. A bare prompt none of those explain is recorded as the person's (nothing else
 *   in the kit gives a crew session a prompt); one the hook cannot read at all — no `prompt`, no
 *   record — records nothing. Never a block, never a question: the person's prompt always goes
 *   on.
 *
 *   Whatever the turn is, the crew record's name is put back on the session's title when the
 *   title says something else (`titleAnswer`): the name is the address its lead, `crew answer`
 *   and the message guard reach it by, and `session-name` is silent here (D26, one owner per
 *   title).
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
import { firstPrompt, REPORT_COMMAND } from "../crew/brief";
import { RUNNING_STATES } from "../crew/places";
import { crewIdOf } from "../crew/session";
import {
  appendCrewEvent,
  type CrewRecord,
  crewBriefFile,
  readCrew,
  readCrewEvents,
  readStopState,
  updateCrew,
  updateCrewIfState,
  writeStopState,
} from "../crew/store";
import {
  readSessionTasks,
  readTaskGate,
  sessionTasksDir,
  taskListId,
  writeTaskGate,
} from "../crew/tasks";
import { lastPauseOf, pausesCrew, pauseText, readWaitFacts, waitFor } from "../crew/wait";
import { maskedLine } from "../gateway/plain-text";
import { isInside, realPath } from "./git";
import {
  addContext,
  addContextAndTitle,
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
} from "./io";
import { hasNotPersonWrapper } from "./prompt-source";
import type { Env } from "./run";
import { isSessionId, titleToSet } from "./session-name";

/** The two tools a crew session never calls: each one asks the person (D36). */
export const CREW_ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"] as const;

/** The tools whose call waits for a crew session's task list: every edit it makes (D23). */
export const CREW_EDIT_TOOLS = ["Edit", "Write", "NotebookEdit"] as const;

/** The longest piece of a line a record keeps: the session's last line, the person's first line. */
export const LAST_LINE_MAX = 120;

/** The reason of a Stop answer that reports nothing, and of the stop's one block. */
export function reportStep(): string {
  return `No report has been handed back for this phase. Hand it back with \`${REPORT_COMMAND} --status done\` (or \`--status failed\` and why), then end the turn.`;
}

/**
 * The one step that makes a crew session's to-do list: look the task tools up (Claude Code
 * leaves them out until a session does, so a session that skips this cannot make one at all),
 * then one task per part of the brief, each with its done-check. The deny of the first edit
 * and the role card both say it, from here.
 */
function taskListStep(): string {
  return "Write your task list first: look up the task tools (ToolSearch `select:TaskCreate,TaskUpdate,TaskList`), then one TaskCreate per part of your brief, each with its done-check.";
}

/**
 * The deny of a crew session's first edit, while its task folder holds no task file (D23). A
 * deny and not an ask: the step is mechanical and the session can take it alone, and nobody is
 * at the machine to answer a question (`.claude/rules/hooks-guards.md` § Fail safe). The last
 * sentence is the way out for a session Claude Code gave no task tools (the legacy `TodoWrite`
 * instead, a deny rule): it tells its lead, who tells the person, because the refusal would
 * otherwise hold every edit it makes for good.
 */
function taskListRefusal(): string {
  return `A crew session writes its task list before it changes a file: the list is what it resumes from after a compaction, and what the person reads. ${taskListStep()} If ToolSearch finds no task tools in this session, tell your lead: \`${questionStep()}\``;
}

/** The line a crew session gets instead of asking the person (D36). */
export function questionStep(): string {
  return `${REPORT_COMMAND} --question "<q>" --option "<a>" --option "<b>" --recommend <n>`;
}

/** The line a crew session tells another crew session a contract change or question (C1). */
export function tellStep(): string {
  return `${COMMAND} crew tell <name…> --kind contract|question "<text>"`;
}

/**
 * The frame `resumeText` (`src/crew/wait.ts`) builds the prompt the watch resumes a paused crew
 * session with. It arrives bare, as a typed prompt would, so it is recognised by that frame and
 * the phase it names. `crew-role.test.ts` holds it to `resumeText`'s own output, so the two
 * cannot drift apart.
 */
const RESUME_START = "The wait is over: ";
const RESUME_PHASE = ". Go on with phase ";
const RESUME_END = ", then hand it back as usual.";

/** How soon after its answer the prompt `crew answer` resumed a stopped crew session with still carries it. */
export const ANSWER_RESUME_MS = 60_000;

/**
 * True when `prompt` is the person's own words. Every other turn a crew session gets is its
 * lead's or its own subagent's: a `SendMessage` delivery, a monitor's line, or a subagent's
 * hand-back (the wrappers), the kit's own Stop block (a continuation that carries it), the line
 * `crew start` launched this crew session with (`firstPrompt`, built for this record — a
 * hand-off's next crew session gets its own), `crew answer`'s resume of a stopped crew session
 * (with a question still open, or with the answer the store recorded — the resume runs before
 * the answer is written), and the watch's resume of a paused one (the frame above). A bare
 * prompt none of those explain is the person's: nothing else in the kit gives a crew session a
 * prompt.
 */
export function isPersonPrompt(
  record: CrewRecord,
  prompt: string,
  briefFile: string,
  nowMs: number,
): boolean {
  if (hasNotPersonWrapper(prompt)) return false;
  // The kit's own words are never the person's. A Stop block continues the turn with this line,
  // and a transport that turned that continuation into a prompt would otherwise read as theirs.
  if (prompt.startsWith(reportStep())) return false;
  // `crew start` gives every crew session its launch line as its first prompt. Only this
  // record's own line is the lead's: one that names another crew session, or another brief
  // file, is still the person's.
  if (isLaunchPrompt(record, prompt, briefFile)) return false;
  // `crew answer` resumes a stopped crew session with the answer as its next prompt, and the
  // resume runs before the answer is recorded (`src/crew/answer.ts`): while a question still has
  // no answer, a prompt in a stopped record is that resume. A stopped record with no open
  // question takes no answer at all (`crew answer` refuses it), so a prompt there is a person
  // who attached to the kept conversation and typed.
  if (record.state === "stopped" && record.questions.some((asked) => asked.answer === null)) {
    return false;
  }
  if (isWaitOverResume(record, prompt)) return false;
  return !isAnswerResume(record, prompt, nowMs);
}

/**
 * `text` with one trailing line end dropped, and nothing else: a transport that adds or drops
 * that line end must not turn the lead's own line into the person's, and the person's own
 * " yes " typed after it must still be theirs.
 */
function withoutOneLineEnd(text: string): string {
  return text.replace(/\r?\n$/, "");
}

/**
 * True when `prompt` is the line `crew start` launched this crew session with. The line is read
 * from `firstPrompt`, which builds it (`src/crew/brief.ts`), never copied here: a change to the
 * launch line changes this with it. The record's own name, lead and brief file are what tell it
 * apart from every other crew session's.
 */
function isLaunchPrompt(record: CrewRecord, prompt: string, briefFile: string): boolean {
  const launch = firstPrompt(record.name, record.leadName, briefFile);
  return withoutOneLineEnd(prompt) === withoutOneLineEnd(launch);
}

/** True when `prompt` is the answer `crew answer` resumed this crew session with, just recorded. */
function isAnswerResume(record: CrewRecord, prompt: string, nowMs: number): boolean {
  return record.questions.some((asked) => {
    if (asked.answer === null || asked.answeredAt === null) return false;
    if (withoutOneLineEnd(asked.answer) !== withoutOneLineEnd(prompt)) return false;
    const at = Date.parse(asked.answeredAt);
    return Number.isFinite(at) && nowMs - at <= ANSWER_RESUME_MS;
  });
}

/** True when `prompt` is the line the watch resumes a paused crew session with (`resumeText`). */
function isWaitOverResume(record: CrewRecord, prompt: string): boolean {
  return (
    prompt.startsWith(RESUME_START) &&
    prompt.endsWith(RESUME_END) &&
    prompt.includes(`${RESUME_PHASE}${record.phase}${RESUME_END}`)
  );
}

/**
 * The person's words as the store and the lead's watch keep them: the first line that holds
 * anything, masked and clipped by the same reader as the session's last line. A prompt with no
 * such line is "", and it is recorded as nothing: a blank line says nothing to the lead.
 */
export function personLine(prompt: string): string {
  const line = prompt.split(/\r?\n/).find((one) => one.trim() !== "") ?? "";
  return maskedLine(line, [], LAST_LINE_MAX, { mark: "…" });
}

/** The one line a crew session gets when the person typed to it (D55): whose word it is, and what to do. */
export function personWroteLine(): string {
  return "The person wrote to you directly: their word wins over your brief. If it changes this phase's scope or files, say so in your report; if it says to stop, still hand back a report (`blocked` or `handoff`) before you end.";
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
    `${taskListStep()} Your first edit waits for it, and \`${REPORT_COMMAND} --status done\` waits until no task is open.`,
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

/** Why a crew session is failed when it starts outside its worktree: where it is, and where it belongs. */
export function wrongFolderReason(record: CrewRecord, cwd: string): string {
  return `its session is in ${cwd}, not in its worktree ${record.worktree}`;
}

/**
 * The card a crew session gets when it started outside its worktree: it does nothing and ends its
 * turn. The record is already `failed`, so the lead's watch stops its session (`src/crew/watch.ts`).
 */
export function wrongFolderCard(record: CrewRecord, cwd: string): string {
  return [
    `You are the crew session \`${record.name}\`, and you are in \`${cwd}\`, not in your worktree \`${record.worktree}\`.`,
    "This crew session is failed: its work belongs in its worktree, and a session anywhere else would edit another checkout.",
    "Do nothing here — change no file, run no command — and end your turn now.",
  ].join("\n");
}

/**
 * SessionStart: the role card, for a start, a resume and a compaction only. The session's real
 * `cwd` decides: inside its worktree the card is the normal one (and a `starting` record is
 * `working` from here); outside it the record is `failed` and the card says to stop.
 */
async function startCard(
  input: HookInput,
  id: string,
  repo: string,
  paths: CliPaths,
  options: CrewRoleOptions,
): Promise<HookResult> {
  const source = stringField(input.source);
  // A `clear` is a new conversation: no card, as on a session that is not a crew session's.
  if (source !== "startup" && source !== "resume" && source !== "compact") return SILENT;
  const found = recordOf(id, repo, paths);
  if (!found.ok) return found.result;
  const record = found.record;
  const nowMs = options.nowMs ?? Date.now();
  const cwd = stringField(input.cwd);
  if (cwd !== null && !isInside(realPath(cwd), realPath(record.worktree))) {
    // It is ours (the store records it): a crew session outside its worktree would edit another
    // checkout. Fail it here, where the session's real folder is known, and say stop. **Only an
    // open record is failed** (`updateCrewIfState`: the state is read again under the store's
    // lock): a phase that ended — `done`, `handoff`, `merged`, `removed` — keeps its state,
    // because `merged` is what a dependent phase waits for and `crew rm` reads it. A store that
    // cannot record is one line: the card still tells the session to stop. **The hook cannot stop
    // the session itself**: Claude Code 2.1.308 takes a SessionStart answer's `{"continue": false}`
    // without acting on it (proved offline, `docs/claude-code-contract.md`), so the card is the
    // word and the lead's watch is the act (D35).
    let stderr: undefined | string;
    try {
      await updateCrewIfState(
        paths.stateDir,
        repo,
        id,
        RUNNING_STATES,
        { state: "failed" },
        nowMs,
        wrongFolderReason(record, cwd),
      );
    } catch (error) {
      stderr = `cc-smart-dev-kit crew-role: the store could not record the failure: ${reasonOf(error)}`;
    }
    const answer = addContext("SessionStart", wrongFolderCard(record, cwd));
    return stderr === undefined ? answer : { ...answer, stderr };
  }
  // In its worktree: its session runs there, so a record the launcher left `starting` is
  // `working` from here, and the lead's watch says so once from the state event. Only a record
  // that is still `starting` moves (`updateCrewIfState`), so this never writes over a `failed`
  // or `merged` the watch recorded meanwhile. A store that cannot record is one line; the
  // session still gets its task.
  let stderr: undefined | string;
  if (record.state === "starting") {
    try {
      await updateCrewIfState(
        paths.stateDir,
        repo,
        id,
        ["starting"],
        { startedAt: record.startedAt ?? new Date(nowMs).toISOString(), state: "working" },
        nowMs,
        "started in its worktree",
      );
    } catch (error) {
      stderr = `cc-smart-dev-kit crew-role: the store could not record the start: ${reasonOf(error)}`;
    }
  }
  const brief = crewBriefFile(paths.stateDir, repo, id);
  const answer = addContext("SessionStart", roleCard(record, brief));
  return stderr === undefined ? answer : { ...answer, stderr };
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
 * The crew session's name to set at this turn, or null. **The crew record is the one owner of
 * its session's title**: 1.1.1 let a crew session name itself after its task (`session-name`),
 * and 1.1.2 refused new renames without setting the title back — so a session renamed then kept
 * a task name while its lead, `crew answer` and the message guard went on addressing it by the
 * record's name. `titleToSet` is the one rule and the one record (`session-name`, as for a
 * lead's name in `lead-notes`), so a name the kit already set is never set twice, and a session
 * whose title is already right is told nothing.
 */
function titleAnswer(input: HookInput, record: CrewRecord, env: Env): null | string {
  const sessionId = stringField(input.session_id);
  if (!isSessionId(sessionId)) return null;
  return titleToSet(env, sessionId, record.name, stringField(input.session_title));
}

/** The title alone in a `UserPromptSubmit` answer, or nothing to say at all. */
function titleOnly(title: null | string): HookResult {
  return title === null ? SILENT : addContextAndTitle("UserPromptSubmit", null, title);
}

/**
 * UserPromptSubmit: the person typed into the crew session (D55). One `person` event, so the
 * lead's watch says it and the lead reads the next report against it, and one line of context
 * telling the session whose word it is. Never a block and never a question: the prompt goes on
 * whatever the store does. A store that cannot record is one line, and the prompt still reaches
 * the session — only the lead's line is missing.
 *
 * Whatever the turn is — the person's, the lead's, a subagent's — the name goes back with it
 * when the session's title says something else (`titleAnswer`): the name is the address every
 * other part of the kit reaches this crew session by, so it is put right on the lead's turns
 * too, not only on the turns the person types.
 */
async function personPromptAnswer(
  input: HookInput,
  id: string,
  repo: string,
  paths: CliPaths,
  env: Env,
  options: CrewRoleOptions,
): Promise<HookResult> {
  const found = recordOf(id, repo, paths);
  if (!found.ok) return found.result;
  const record = found.record;
  const title = titleAnswer(input, record, env);
  const prompt = stringField(input.prompt);
  if (prompt === null) return titleOnly(title);
  const nowMs = options.nowMs ?? Date.now();
  const briefFile = crewBriefFile(paths.stateDir, repo, record.id);
  if (!isPersonPrompt(record, prompt, briefFile, nowMs)) return titleOnly(title);
  const line = personLine(prompt);
  // Nothing to say: a prompt of blank lines is the person's, but the lead gets no line for it.
  if (line === "") return titleOnly(title);
  try {
    await appendCrewEvent(
      paths.stateDir,
      repo,
      {
        crew: record.id,
        lead: record.leadSessionId,
        name: record.name,
        state: record.state,
        text: line,
        type: "person",
      },
      nowMs,
    );
  } catch (error) {
    // The event could not be written, and the name still goes out: `titleToSet` has already
    // recorded this name as the kit's, so a turn that dropped it would never set it again — the
    // address would stay lost for good, which is the very bug this is here to fix.
    const problem = storeProblem(reasonOf(error));
    const only = titleOnly(title);
    return only.stdout === undefined ? problem : { ...problem, stdout: only.stdout };
  }
  return title === null
    ? addContext("UserPromptSubmit", personWroteLine())
    : addContextAndTitle("UserPromptSubmit", personWroteLine(), title);
}

/**
 * The first edit of a crew session waits for its task list (D23): while the session's task
 * folder holds no task file, the call is denied with the step. The list is the session's own —
 * `CLAUDE_CODE_TASK_LIST_ID` when the environment names one, else the input's `session_id`,
 * which is the parent session's for a subagent's call too — and a subagent's `TaskCreate`
 * writes into that same folder, so every edit of the session is judged against the one list
 * it keeps (proved live, `docs/claude-code-contract.md` § The to-do list).
 *
 * Once a task file has been seen, the gate's own file answers (`taskGateFile`) and the folder
 * is not read again for that list. **Every answer that cannot be made lets the edit through**:
 * no session id names no folder, a folder the hook cannot read says nothing about the list, and
 * a gate file it cannot write is one line on stderr — a denial on a guess would hold the
 * session's work for nothing. Outside git (`repo` null) the gate has no store folder to
 * remember in, so the folder is read on each call.
 */
function taskListGate(
  input: HookInput,
  id: string,
  repo: null | string,
  paths: CliPaths,
  env: Env,
): HookResult {
  const listId = taskListId(env, stringField(input.session_id));
  if (listId === "") return SILENT;
  if (repo !== null && readTaskGate(paths.stateDir, repo, id)?.listId === listId) return SILENT;
  const tasks = readSessionTasks(paths.claudeConfigDir, listId);
  if (tasks.state === "unreadable") {
    return storeProblem(
      `the task folder ${sessionTasksDir(paths.claudeConfigDir, listId)} cannot be read, so the edit is not held for the task list`,
    );
  }
  if (tasks.state === "none" || tasks.files === 0) {
    return toolDecision("deny", taskListRefusal());
  }
  if (repo === null) return SILENT;
  try {
    writeTaskGate(paths.stateDir, repo, id, { listId });
  } catch (error) {
    // Only a cache: the next edit lists the folder again. The edit itself goes on.
    return storeProblem(`the task list gate could not be recorded: ${reasonOf(error)}`);
  }
  return SILENT;
}

/**
 * Every answer of the hook, for every event it is wired for. `repo` is null outside a git checkout
 * (the PreToolUse answers need none; a card, a stop, a pause and the person's prompt need the
 * store, so they stay silent there). Async because the Stop, the StopFailure and the
 * UserPromptSubmit answers write the store: `onConfigProblem` and `outsideGit` call it too, so a
 * broken or too new project file never changes an answer.
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
    if (tool === null) return SILENT;
    if ((CREW_ASK_TOOLS as readonly string[]).includes(tool))
      return toolDecision("deny", questionStep());
    if ((CREW_EDIT_TOOLS as readonly string[]).includes(tool))
      return taskListGate(input, id, repo, paths, env);
    return SILENT;
  }
  if (repo === null) return SILENT;
  if (event === "SessionStart") return await startCard(input, id, repo, paths, options);
  if (event === "UserPromptSubmit")
    return await personPromptAnswer(input, id, repo, paths, env, options);
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
