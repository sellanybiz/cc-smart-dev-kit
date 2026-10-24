/**
 * `cc-smart-dev-kit crew answer <name> "<text>"`: the lead's answer to a crew session's question
 * (D36).
 *
 * **Two ways the answer reaches the crew session.**
 *
 * - A **running** crew session gets it as a message. The CLI cannot send one itself — Claude Code's
 *   `SendMessage` is a tool only a session holds — so the command prints the one line the lead
 *   sends it with (the crew session's name and the text), and records the answer, so the question is
 *   answered once and never asked again.
 * - A **stopped** crew session (D35: the watch stops a blocked crew session that idles past
 *   `workflow.crew.idleStopMinutes`) is resumed with the answer as its next prompt:
 *   `claude --bg --resume <session id> "<text>"` — the form `claude --help` gives in 2.1.306
 *   ("With --resume <session-id>, continues that session in the background under the same ID,
 *   or starts a copy and says so when the session is already running"). The conversation stays
 *   on disk, so the crew session picks up where it stopped. Because of that copy, agent view is read
 *   first: a stopped record whose session still has a process is sent the message instead. On
 *   2.1.310 every crew resume is a copy with a new id all the same — the flags it passes differ
 *   from the session's saved ones — and the record takes that id with the answer (WF1,
 *   `resumedSession`).
 *
 * **A resume runs in the crew session's own worktree, never in the main checkout** where the lead
 * happens to be: a session brought back in the main checkout is marked failed by its own
 * `crew-role` start check (the bug of 2026-10-23). A crew session with no worktree any more is
 * refused with one line. `resumePlace` is the one home for that rule (`crew answer`, the watch's
 * resumes and `crew resume` read it).
 *
 * **A crew session the store does not know is never answered.** The store is what says a session is a
 * crew session (D35); a name alone is not enough.
 */
import { existsSync } from "node:fs";
import { agentRows, claudeDeps, isLiveRow, rowOf } from "./agents";
import { findCrew } from "./board";
import { readCaller, reasonOf } from "./caller";
import {
  callClaude,
  findClaude,
  parseBackgrounded,
  parseCopyNote,
  sessionFlags,
  startedRow,
} from "./claude";
import type { CrewContext } from "./context";
import { pendingDiscardWhy } from "./discard";
import {
  answerCrewQuestion,
  type CrewRecord,
  crewMcpFile,
  crewSettingsFile,
  listCrew,
  openQuestionIndex,
  questionClosed,
  readReport,
} from "./store";

/** What `crew answer` was asked, already checked to be well formed. */
export interface AnswerArgs {
  /** The crew session's name (or its id). */
  crew: string;
  /**
   * The person acted through the portal (D52): no Claude Code session runs this command. The
   * portal's child passes `--as-person` (`parseAnswerArgs`).
   */
  asPerson?: boolean;
  /** The answer. */
  text: string;
}

/**
 * The states a crew session is in when it can still be reached: a running one gets a message, a
 * stopped one is resumed. A crew session that ended its phase (done, failed, handoff) or was merged
 * or removed takes no more answers.
 */
const REACHABLE_STATES = ["starting", "working", "blocked", "paused", "quiet"] as const;

/** True when `state` is one a crew session can still take an answer in. */
function isReachable(state: string): boolean {
  return (REACHABLE_STATES as readonly string[]).includes(state);
}

/**
 * The line the lead sends the answer with: the arguments of the `SendMessage` tool, as JSON, so
 * a quote or a line break in the answer is escaped and never changed.
 */
export function sendMessageLine(name: string, text: string): string {
  return `SendMessage ${JSON.stringify({ to: name, message: text })}`;
}

/**
 * True when the crew session ended its phase with a report that takes no answer — `done`, `failed` or
 * `handoff`. A stopped crew session that did is not resumed by an answer; one that was stopped while
 * it waited (a `blocked` report, or none) is.
 */
function endedItsPhase(record: CrewRecord): boolean {
  if (record.reportPath === null) return false;
  try {
    const report = readReport(record.reportPath);
    return report !== null && ["done", "failed", "handoff"].includes(report.status);
  } catch {
    // A report that cannot be read says nothing about the phase: the crew session is not refused.
    return false;
  }
}

/** `crew answer`; the exit code. */
export async function runCrewAnswer(args: AnswerArgs, ctx: CrewContext): Promise<number> {
  const read = readCaller(
    "answer",
    ctx,
    args.asPerson === true ? { asPerson: true, session: "optional" } : { session: "required" },
  );
  if (!read.ok) {
    for (const line of read.lines) ctx.error(line);
    return 1;
  }
  const { repo } = read.caller;
  let records: CrewRecord[];
  try {
    records = listCrew(ctx.paths.stateDir, repo).records;
  } catch (error) {
    ctx.error(`crew answer: the store could not be read: ${reasonOf(error)}`);
    return 1;
  }
  const found = findCrew(records, args.crew, "answer");
  if ("refusal" in found) {
    for (const line of found.refusal.lines) ctx.error(line);
    return 1;
  }
  const { record } = found;
  const pending = pendingDiscardWhy(record);
  if (pending !== null) {
    ctx.error(`crew answer: ${pending}`);
    return 1;
  }
  const index = openQuestionIndex(record);
  if (index === null) {
    // A question left behind at the end of the phase needs no answer: the crew session is
    // finished, and nothing would read one (one rule for every reader, `openQuestionIndex`).
    if (questionClosed(record.state) && record.questions.some((one) => one.answer === null)) {
      ctx.error(
        `crew answer: ${record.name} is finished (${record.state}), so its question needs no answer`,
      );
      return 1;
    }
    ctx.error(
      `crew answer: ${record.name} has no question waiting for an answer${
        record.questions.length === 0 ? " (it never asked one)" : ""
      }`,
    );
    return 1;
  }

  const question = record.questions[index]?.question ?? "";
  // How the answer reaches the crew session: a message, or a resume of a session that is gone.
  let way: "message" | "resume" = "message";
  if (record.state === "stopped") {
    if (endedItsPhase(record)) {
      ctx.error(
        `crew answer: ${record.name} ended its phase and was stopped, and it takes no more answers`,
      );
      return 1;
    }
    // The store says stopped; agent view says whether a process is there. `claude --bg --resume`
    // on a session that runs starts a copy beside it, so a live one is sent the message instead —
    // and a view that cannot be read refuses rather than guessing (it could be either).
    const liveness = sessionLiveness(ctx, record);
    if (liveness === "unknown") {
      ctx.error(`crew answer: ${record.name}: ${UNREADABLE_VIEW_WHY}`);
      return 1;
    }
    if (liveness === "dead") way = "resume";
  } else if (!isReachable(record.state)) {
    ctx.error(`crew answer: ${record.name} is ${record.state}, and it takes no more answers`);
    return 1;
  }
  let session: null | ResumedSession = null;
  if (way === "resume") {
    const resumed = await resumeSession(ctx, record, args.text);
    if (!resumed.ok) {
      ctx.error(`crew answer: ${resumed.why}`);
      return 1;
    }
    session = resumed.session;
  }
  try {
    // A crew session that has its answer is working: a record that kept saying `blocked` or `stopped`
    // would let the watch stop a crew session that is busy, and a stopped one holds no place. A
    // resume's session comes in the same write (WF1): a record that kept the old id would read
    // that session's stopped row as its own.
    await answerCrewQuestion(
      ctx.paths.stateDir,
      repo,
      record.id,
      index,
      args.text,
      ctx.now(),
      "working",
      session,
    );
  } catch (error) {
    ctx.error(`crew answer: the store could not record the answer: ${reasonOf(error)}`);
    return 1;
  }
  if (session !== null) {
    ctx.print(
      `answered ${record.name}: resumed with your answer${resumedAs(record, session.shortId)} · ${question}`,
    );
  } else {
    ctx.print(`answered ${record.name}: ${question}`);
    ctx.print(sendMessageLine(record.name, args.text));
  }
  return 0;
}

/** The session a resume brought back: the same one, or the copy Claude Code started instead. */
export interface ResumedSession {
  sessionId: string;
  shortId: string;
}

/**
 * What a resume of a crew session gave back: the session that runs now, which the record takes in
 * the write that makes it `working` (WF1); or why not. `unnamed` is true when a session may have
 * started that the kit cannot name — `claude` said it started one but no id could be read, or two
 * ids disagree: a second try could start a second one, so the watch does not try again by itself.
 */
export type ResumeResult =
  | { ok: true; session: ResumedSession }
  | { ok: false; unnamed: boolean; why: string };

/**
 * The words a line adds when a resume came back as another session: ` as session <new> (a copy of
 * <old>)`; nothing when it is the same session.
 */
export function resumedAs(record: CrewRecord, shortId: string): string {
  if (shortId === record.shortId) return "";
  return ` as session ${shortId}${record.shortId === null ? "" : ` (a copy of ${record.shortId})`}`;
}

/** What a resume says before it is tried again, when it may have started a session it cannot name. */
const UNNAMED_FIX = "see claude agents before you resume it again";

/** Where a crew session comes back: its own worktree; or why it cannot be brought back. */
export type ResumePlace = { folder: string; ok: true } | { ok: false; why: string };

/**
 * The folder a crew session's session is brought back in: **its own worktree**. `claude respawn`
 * does not re-apply `-w` (its restart flags leave it out, read from the 2.1.309 binary), so a
 * respawned `--bg -w` session comes back in the folder it was launched from — the main checkout —
 * and its own start hook marks it failed (the bug of 2026-10-23). A resume never falls back to
 * the caller's folder, and a worktree that is not there any more is a refusal: there is nowhere
 * to resume in.
 */
export function resumePlace(record: CrewRecord): ResumePlace {
  const pending = pendingDiscardWhy(record);
  if (pending !== null) return { ok: false, why: pending };
  if (!existsSync(record.worktree)) {
    return { ok: false, why: `${record.name} has no worktree at ${record.worktree} any more` };
  }
  return { folder: record.worktree, ok: true };
}

/** What agent view says about a crew session's process: it runs, it does not, or the view cannot say. */
export type Liveness = "dead" | "live" | "unknown";

/**
 * Whether a crew session's session still has a process. Agent view is the one witness: a live one
 * must never be resumed (`--bg --resume` starts a copy beside it), and **a view that cannot be
 * read must not be read as dead** — that would start the very copy the guard exists to prevent.
 * A missing `claude` is the resume's own refusal (`resumeSession`), not this one, so it counts as
 * dead and the refusal that names it is the one said.
 */
export function sessionLiveness(ctx: CrewContext, record: CrewRecord): Liveness {
  const rows = agentRows(ctx);
  if (rows === null) {
    const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
    return claude === null ? "dead" : "unknown";
  }
  return isLiveRow(rowOf(rows, record)) ? "live" : "dead";
}

/**
 * Why a command refuses to resume when agent view could not be read: it could be either, and a
 * copy is worse than a second try. One home for the sentence (`crew answer`, `crew resume`, the
 * watch's `resumeOne`).
 */
export const UNREADABLE_VIEW_WHY =
  "agent view could not be read (claude agents --json), so it cannot say whether its session still runs; try again";

/**
 * The arguments that bring a crew session back: `claude --bg --resume <session id>` with what
 * `crew start` gave it — **the record's own files** (`--strict-mcp-config --mcp-config <mcp.json>`
 * and `--settings <settings.json>`) and the model, effort, permission mode and autocompact it was
 * launched with (`sessionFlags`, the same home the launch reads them from) — and then the text,
 * when there is one. Without the files a resumed session is a plain session: no `CREW_ENV` (so no
 * longer a crew session), every plugin and connector back, every MCP server loaded, the lean start
 * undone (`crew start`). The files are read from the store, never rebuilt. **`--mcp-config` comes
 * before `--settings`**: it takes any number of files, so a prompt after it would be read as one
 * more config file (proved live on 2.1.309, `launchArgs`), and `--settings` takes one value and
 * ends the flag list.
 */
export function resumeArgs(
  launch: { effort: string; model: string; permissionMode: string; sessionId: string },
  files: { mcpFile: null | string; settingsFile: string },
  text: null | string,
): string[] {
  const args = [
    "--bg",
    "--resume",
    launch.sessionId,
    ...sessionFlags(launch.model, launch.effort, launch.permissionMode),
  ];
  if (files.mcpFile !== null) args.push("--strict-mcp-config", "--mcp-config", files.mcpFile);
  args.push("--settings", files.settingsFile);
  if (text !== null) args.push(text);
  return args;
}

/**
 * Resumes the crew session `record` in its own worktree (`resumePlace`), with `text` as its next
 * prompt when there is one, so the session goes on where it stopped (it keeps its name, its
 * worktree, its conversation and its lean start). `--bg --resume` starts in the folder the
 * command runs in, which is why the folder is the worktree; on a session that still has a
 * process it starts a copy and says so, so a caller reads agent view first. A crew session with
 * no session id, whose settings file is gone, or a `claude` that refuses is reported with the
 * reason. `crew answer`, `crew resume`, `crew resume --paused` and the lead's watch (`watch.ts`)
 * all resume this way: one home for the transport (D42).
 */
export async function resumeSession(
  ctx: CrewContext,
  record: CrewRecord,
  text: null | string,
): Promise<ResumeResult> {
  if (record.sessionId === null) {
    return { ok: false, unnamed: false, why: `${record.name} has no session to resume` };
  }
  const place = resumePlace(record);
  if (!place.ok) return { ok: false, unnamed: false, why: place.why };
  // Its own settings: without them the session comes back as a plain one, not as this crew session.
  const settingsFile = crewSettingsFile(ctx.paths.stateDir, record.repo, record.id);
  if (!existsSync(settingsFile)) {
    return {
      ok: false,
      unnamed: false,
      why: `${record.name} has no settings file any more (${settingsFile}), so a resume would come back as a plain session`,
    };
  }
  const mcpFile = crewMcpFile(ctx.paths.stateDir, record.repo, record.id);
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (claude === null) {
    return {
      ok: false,
      unnamed: false,
      why: "claude is not on PATH, nor in ~/.local/bin, so it cannot be resumed",
    };
  }
  const deps = claudeDeps(ctx);
  const called = callClaude(
    deps,
    claude,
    resumeArgs(
      {
        effort: record.effort,
        model: record.model.named,
        permissionMode: record.permissionMode,
        sessionId: record.sessionId,
      },
      { mcpFile: existsSync(mcpFile) ? mcpFile : null, settingsFile },
      text,
    ),
    place.folder,
  );
  if (!called.ok) return { ok: false, unnamed: false, why: called.why };
  const { run } = called;
  const command = `claude --bg --resume ${record.sessionId}`;
  if (run.timedOut) {
    return { ok: false, unnamed: true, why: `${command} did not answer in time; ${UNNAMED_FIX}` };
  }
  if (run.exitCode !== 0) {
    const last = `${run.stdout}\n${run.stderr}`.trim().split(/\r?\n/).at(-1) ?? "";
    return {
      ok: false,
      unnamed: false,
      why: `${command} failed (exit ${run.exitCode ?? "none"})${last === "" ? "" : `: ${last}`}`,
    };
  }
  return resumedSession(record, run, deps, claude, place.folder, command);
}

/**
 * The session a `claude --bg --resume` that exited 0 brought back (WF1). The id is read from the
 * `backgrounded · <short id>` line on stdout, and checked against the copy note on stderr
 * (`parseCopyNote`): the same short id and no note is the record's own session, going on; any
 * other id is a copy (2.1.310 starts one for every crew resume, because the flags `resumeArgs`
 * passes differ from the session's saved ones), and agent view gives its full session id, as a
 * start reads it (`startedRow`). No line, two ids that disagree, or a copy agent view cannot show
 * is said with the reason — never a guess.
 */
function resumedSession(
  record: CrewRecord,
  run: { stderr: string; stdout: string },
  deps: ReturnType<typeof claudeDeps>,
  claude: string,
  folder: string,
  command: string,
): ResumeResult {
  const line = parseBackgrounded(run.stdout);
  if (line === null) {
    return {
      ok: false,
      unnamed: true,
      why: `${command} printed no line backgrounded · <id>, so the session it started is not known; ${UNNAMED_FIX}`,
    };
  }
  const { shortId } = line;
  const copy = parseCopyNote(run.stderr);
  if (copy !== null && copy !== shortId) {
    return {
      ok: false,
      unnamed: true,
      why: `${command} said it started a copy as ${copy}, but printed backgrounded · ${shortId}; ${UNNAMED_FIX}`,
    };
  }
  if (copy === null && shortId === record.shortId && record.sessionId !== null) {
    return { ok: true, session: { sessionId: record.sessionId, shortId } };
  }
  const listed = startedRow(deps, claude, shortId, folder);
  const sessionId = listed.ok ? listed.row.sessionId : null;
  if (sessionId !== null) return { ok: true, session: { sessionId, shortId } };
  const what = !listed.ok
    ? listed.why === "unreadable"
      ? "claude agents --json could not be read"
      : "claude agents does not list it"
    : "claude agents lists it with no session id";
  return {
    ok: false,
    unnamed: true,
    why: `session ${shortId} started, but ${what}; see claude agents, and stop it (claude stop ${shortId}) before you resume it again`,
  };
}
