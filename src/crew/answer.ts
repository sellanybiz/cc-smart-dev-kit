/**
 * `cc-smart-dev-kit crew answer <name> "<text>"`: the lead's answer to a crew session's question
 * (D36).
 *
 * **Two ways the answer reaches the crew session.**
 *
 * - A **running** crew session gets it from its own monitor (AN1). The CLI cannot send a message
 *   itself — Claude Code's `SendMessage` is a tool only a session holds — so the command records
 *   the answer, and `crew self-watch`, the monitor every crew session runs, prints it into the
 *   session as one line and marks it delivered (`deliveryLine`, `markAnswerDelivered`). A line
 *   from a monitor wakes an idle session, so a blocked crew session needs no one to send it
 *   anything (proved live, `docs/claude-code-contract.md`). The monitor writes a heartbeat; the
 *   command waits a few seconds for the delivery and says which happened — delivered, or only
 *   recorded. **When it can only record** (no heartbeat, an old one, or a monitor that did not
 *   pass it on in time), it prints the one line the lead sends it with by hand (the crew
 *   session's name and the text), so the lead is never left without a way.
 * - **A second answer to the same question is a correction.** The first is kept in `superseded`,
 *   the new one is delivered the same way, with words that say it replaces the earlier answer.
 *   A question closed by the phase's end takes none.
 * - A **stopped** crew session (D35: the watch stops a blocked crew session that idles past
 *   `workflow.crew.idleStopMinutes`) is resumed with the answer as its next prompt, behind the
 *   crew command (`resumeArgs`): `claude --bg --resume <session id> -- "/<plugin>:crew <text>"`
 *   — the form `claude --help` gives in 2.1.306
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
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { resolveWorkflow } from "../workflow/resolve";
import { agentRows, claudeDeps, isLiveRow, rowOf } from "./agents";
import { restoreConversation } from "./archive";
import { findCrew } from "./board";
import { deliveryHead, withCrewCommand } from "./brief";
import { readCaller, reasonOf } from "./caller";
import {
  type AgentRow,
  type ClaudeDeps,
  callClaude,
  findClaude,
  parseBackgrounded,
  parseCopyNote,
  sessionFlags,
  startedRow,
} from "./claude";
import type { CrewContext } from "./context";
import { pendingDiscardWhy } from "./discard";
import { OPUS_TIER, placeFor, placeInputOf, withPlacesLock } from "./places";
import { restoreReleasedWorktree } from "./release";
import { actorOfCaller } from "./runs-actor";
import {
  ANSWER_BEAT_STALE_MS,
  answerCrewQuestion,
  type CrewRecord,
  claimResume,
  crewMcpFile,
  crewSettingsFile,
  isQuestionOpen,
  lastHeardAnswer,
  listAllCrew,
  listCrew,
  openQuestionIndex,
  questionClosed,
  RESUME_CLAIM_MS,
  readAnswerWatchBeat,
  readCrew,
  readReport,
  releaseResume,
  resumeWaitOf,
  updateCrew,
  updateCrewIfState,
} from "./store";
import { usageFacts } from "./usage-guard";

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

/** How many times `crew answer` looks for the delivery, and how long it waits between looks. */
const CONFIRM_LOOKS = 10;
const CONFIRM_WAIT_MS = 1000;

/**
 * The one line the crew session's monitor prints for an answer (AN1): a monitor line is one
 * notification, so the answer goes in as a JSON string and is never changed.
 */
export function deliveryLine(question: string, answer: string, earlier: null | string): string {
  return `${deliveryHead(question, earlier)} ${JSON.stringify(answer)}`;
}

/**
 * The text a message or a resume carries: the answer as the lead typed it, and for a correction
 * the words that say it replaces the earlier one, then the answer on its own line.
 */
export function deliveryText(question: string, answer: string, earlier: null | string): string {
  return earlier === null ? answer : `${deliveryHead(question, earlier)}\n${answer}`;
}

/**
 * The line the lead sends the answer with: the arguments of the `SendMessage` tool, as JSON, so
 * a quote or a line break in the answer is escaped and never changed. The text after the tool's
 * name is a valid JSON object with the two keys `to` and `message`, and nothing else.
 */
export function sendMessageLine(name: string, text: string): string {
  return `SendMessage ${JSON.stringify({ to: name, message: text })}`;
}

/**
 * The line that goes before the first `SendMessage` line a command prints. `SendMessage` is a
 * **deferred** tool: Claude Code leaves it out until a session looks it up with `ToolSearch`, and
 * the router drops a deferred tool a backend model has not loaded, so such a model cannot call it
 * at all until it runs `ToolSearch` with `select:SendMessage`. Every command that prints the
 * line prints this one first (`crew answer`, `crew tell`).
 */
export function sendMessageHint(): string {
  return "The SendMessage tool is deferred: load it first with ToolSearch, query select:SendMessage. Then call SendMessage with the JSON object on each line below.";
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
  let index = openQuestionIndex(record);
  // The answer to the newest question, given again, is a correction (AN1) — while the phase runs.
  let correcting = false;
  if (index === null) {
    const last = record.questions.length - 1;
    if (last >= 0 && record.questions[last]?.answer !== null) {
      if (questionClosed(record.state)) {
        ctx.error(
          `crew answer: ${record.name} is finished (${record.state}), so its answer cannot be corrected`,
        );
        return 1;
      }
      index = last;
      correcting = true;
    }
  }
  if (index === null) {
    // A question left behind at the end of the phase needs no answer: the crew session is
    // finished, and nothing would read one (one rule for every reader, `openQuestionIndex`).
    if (questionClosed(record.state) && record.questions.some(isQuestionOpen)) {
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

  const asked = record.questions[index];
  const question = asked?.question ?? "";
  // What the answer replaces: the answer on record now.
  // Only an answer the session heard is replaced: the monitor may not have printed the one on record.
  const earlier = correcting && asked !== undefined ? lastHeardAnswer(asked, true) : null;
  const text = deliveryText(question, args.text, earlier);
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
    const resumed = await resumeSession(ctx, record, text);
    if (!resumed.ok) {
      if (resumed.waits !== undefined) {
        await answerCrewQuestion(
          ctx.paths.stateDir,
          repo,
          record.id,
          index,
          args.text,
          ctx.now(),
          null,
          null,
          { correction: correcting, delivered: false },
          actorOfCaller(ctx, repo),
        );
        await updateCrew(
          ctx.paths.stateDir,
          repo,
          record.id,
          { resumeWaits: resumeWaitOf(record, ctx.now(), index) },
          ctx.now(),
        );
        ctx.print(
          `${record.name}: the answer waits: ${resumed.waits}; it is delivered when the session comes back`,
        );
        return 0;
      }
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
      // A resume carries the answer as its prompt: that is its delivery.
      { correction: correcting, delivered: session !== null },
      actorOfCaller(ctx, repo),
    );
  } catch (error) {
    // A copy that runs while the record still names the old session: the line names the copy.
    const as = session === null ? "" : resumedAs(record, session.shortId);
    ctx.error(
      `crew answer: the store could not record the answer: ${reasonOf(error)}${as === "" ? "" : `; it was resumed${as}`}`,
    );
    return 1;
  }
  if (session !== null) {
    ctx.print(
      `answered ${record.name}: resumed with your ${correcting ? "correction" : "answer"}${resumedAs(record, session.shortId)} · ${question}`,
    );
    return 0;
  }
  ctx.print(`${correcting ? "corrected the answer to" : "answered"} ${record.name}: ${question}`);
  const how = { asPerson: args.asPerson === true, replaces: earlier !== null };
  for (const line of await deliveryReport(ctx, repo, record, index, how, text)) {
    ctx.print(line);
  }
  return 0;
}

/**
 * What `crew answer` says about the delivery to a running crew session (AN1): the monitor's
 * heartbeat decides. A live one is given a few seconds to pass the answer on, and the command says
 * which happened; with no live monitor, or one that did not pass it on in time, the answer is
 * only recorded, and the line says why and carries the `SendMessage` line the lead sends it with.
 * The person's click (`asPerson`) gets no such line — they cannot send it — and is told when the
 * session will hear it instead.
 */
async function deliveryReport(
  ctx: CrewContext,
  repo: string,
  record: CrewRecord,
  index: number,
  how: { asPerson: boolean; replaces: boolean },
  text: string,
): Promise<string[]> {
  const { stateDir } = ctx.paths;
  const beat = readAnswerWatchBeat(stateDir, repo, record.id);
  const age = beat === null ? null : Math.max(0, ctx.now() - beat);
  if (age === null || age > ANSWER_BEAT_STALE_MS) {
    const why =
      age === null
        ? "no heartbeat from its monitor"
        : `its monitor's last heartbeat was ${Math.round(age / 1000)} s ago`;
    return how.asPerson
      ? [
          `recorded, not delivered: ${why}, so it hears the answer when its monitor next runs, or when its lead sends it`,
        ]
      : [
          `recorded, not delivered: ${why}, so send it yourself:`,
          sendMessageHint(),
          sendMessageLine(record.name, text),
        ];
  }
  for (let look = 0; look < CONFIRM_LOOKS; look += 1) {
    await ctx.sleep(CONFIRM_WAIT_MS);
    const now = readCrew(stateDir, repo, record.id)?.questions[index]?.deliveredAt ?? null;
    if (now !== null) {
      return [
        how.replaces
          ? "delivered: its monitor gave the session your correction, which replaces your earlier answer"
          : "delivered: its monitor gave it to the session",
      ];
    }
  }
  const late = `recorded, not delivered yet: its monitor is running but did not pass it on within ${(CONFIRM_LOOKS * CONFIRM_WAIT_MS) / 1000} s;`;
  return how.asPerson
    ? [`${late} it still will`]
    : [
        `${late} if the session stays silent, send it yourself (it then arrives twice):`,
        sendMessageHint(),
        sendMessageLine(record.name, text),
      ];
}

/** One writer for a resumed session's identity and working state (D72). */
export async function markResumed(
  record: CrewRecord,
  session: ResumedSession,
  ctx: CrewContext,
): Promise<boolean> {
  try {
    const result = await updateCrewIfState(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      [record.state],
      {
        state: "working",
        sessionId: session.sessionId,
        shortId: session.shortId,
        resumeWaits: undefined,
      },
      ctx.now(),
      "resumed by the lead",
    );
    if (!result.changed) {
      ctx.error(
        `${record.name}: resumed as session ${session.shortId}, but its record changed to ${result.record.state}; its state was not overwritten`,
      );
    }
    return result.changed;
  } catch (error) {
    ctx.error(
      `${record.name}: resumed as session ${session.shortId}, but the store could not record it: ${reasonOf(error)}`,
    );
    return false;
  }
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
  | { ok: false; unnamed: boolean; why: string; waits?: string };

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
  if (!existsSync(record.worktree) && record.released === undefined) {
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
 * dead and the refusal that names it is the one said. `rows` is a read the caller already made
 * (the watch's pass); left out, agent view is read here.
 */
export function sessionLiveness(
  ctx: CrewContext,
  record: CrewRecord,
  rows: null | AgentRow[] = agentRows(ctx),
): Liveness {
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
 * launched with (`sessionFlags`, the same home the launch reads them from) — and then the
 * prompt (below). **The prompt comes after a bare `--`**: a text that starts with `-` ("-1 is
 * wrong: use 2") would otherwise be read as a flag, and the resume fails with `unknown option`
 * (proved live on 2.1.309 with `claude -p`: without `--` it answered `error: unknown option
 * '-1 is wrong: use 2'`; with it the fake Anthropic's log held the text as the prompt,
 * `docs/claude-code-contract.md`). Without the files a resumed session is a plain session: no
 * `CREW_ENV` (so no longer a crew session), every plugin and connector back, every MCP server
 * loaded, the lean start undone (`crew start`). The files are read from the store, never rebuilt.
 * **`--mcp-config` comes before `--settings`**: it takes any number of files, so a prompt after
 * it would be read as one more config file (proved live on 2.1.309, `launchArgs`), and
 * `--settings` takes one value and ends the flag list.
 *
 * **The prompt is the crew command, then the text** (`withCrewCommand`; no text is the bare
 * command). `--resume` does not arm a plugin monitor by itself — Claude Code arms one only
 * when the skill is dispatched under its full name, once for each process — so a resumed crew
 * session ran with no `crew-self` monitor: no lead's answer, no hand-off line. The command
 * dispatches the skill in the new process. This is the one place the command is added, so
 * every resume has it (`crew answer`, `crew resume`, `crew model`, the watch's wake of a paused
 * session), while a message to a process that still runs (`SendMessage`) keeps the bare text.
 * The text then sits under `ARGUMENTS:` at the end of the skill.
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
  args.push("--", withCrewCommand(text ?? ""));
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
 *
 * **One resume of a record at a time** (WF1): before `claude` runs, the resume claims the record
 * in the store, in the state its caller judged it in (`claimResume`). A second resume — the
 * person's `crew resume --paused` beside the watch, or a watch that took over the lease from one
 * resuming now — is refused, so two copies never start. A resume that started nothing gives the
 * claim back at once; the rest end it when the record's state changes, or in `RESUME_CLAIM_MS`.
 */
export async function resumeSession(
  ctx: CrewContext,
  record: CrewRecord,
  text: null | string,
  options: { replacesItself?: boolean } = {},
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
  const { stateDir } = ctx.paths;
  const token = randomUUID();
  let claimed: boolean;
  let previousLaunch = record.launchedAt;
  try {
    const checkout = locateCheckout(record.repo, { env: ctx.env });
    const crew = resolveWorkflow(
      ctx.paths,
      checkout === null ? null : loadProjectConfig(checkout).config,
    ).crew;
    const usage = usageFacts(ctx.paths, ctx.now(), record.repo);
    const decision = await withPlacesLock(stateDir, async () => {
      const all = listAllCrew(stateDir).records;
      previousLaunch = all.find(
        (one) => one.repo === record.repo && one.id === record.id,
      )?.launchedAt;
      const input = placeInputOf(all, record.leadSessionId, crew, usage, {
        continuation: false,
        exclude: record,
        opus: record.model.tier === OPUS_TIER,
        unmet: [],
        nowMs: ctx.now(),
      });
      // A model change replaces the process already stopped by its caller. It adds no
      // session, and refusing it here would leave that process unable to come back.
      const first = options.replacesItself ? { start: true as const } : placeFor(input);
      const place =
        first.start && !options.replacesItself
          ? placeFor({ ...input, freeGb: await ctx.freeMemoryGb(), load: ctx.load() })
          : first;
      if (!place.start) return { claimed: false, waits: place.why };
      const claimed = await claimResume(
        stateDir,
        record.repo,
        record.id,
        [record.state],
        token,
        ctx.now(),
      );
      if (claimed)
        await updateCrew(
          stateDir,
          record.repo,
          record.id,
          { launchedAt: new Date(ctx.now()).toISOString() },
          ctx.now(),
        );
      return { claimed, waits: null };
    });
    if (decision.waits !== null)
      return { ok: false, unnamed: false, why: decision.waits, waits: decision.waits };
    claimed = decision.claimed;
  } catch (error) {
    return {
      ok: false,
      unnamed: false,
      why: `the store could not claim its resume: ${reasonOf(error)}`,
    };
  }
  if (!claimed) {
    return {
      ok: false,
      unnamed: false,
      why: `${record.name} is being resumed by another command right now, or it changed since it was read; try again in a moment`,
    };
  }
  // D69: its conversation and its worktree come back only once this command owns the resume. The
  // claim comes first so the timeline's sweep, which reads the record again under the archive lock
  // the restore holds, never takes a conversation away again while it is being resumed.
  const conversation = await restoreConversation(ctx.paths, record);
  if (!conversation.ok) {
    await releaseResume(stateDir, record.repo, record.id, token, { previous: previousLaunch });
    return { ok: false, unnamed: false, why: conversation.why };
  }
  if (conversation.note !== undefined) ctx.print(conversation.note);
  const restored = await restoreReleasedWorktree(record, ctx);
  if (!restored.ok) {
    await releaseResume(stateDir, record.repo, record.id, token, { previous: previousLaunch });
    return { ok: false, unnamed: false, why: restored.why };
  }
  const prompt = restored.remade
    ? `Your worktree was made again on your kept branch. Install its dependencies before running anything.\n${text ?? "Continue your phase."}`
    : text;
  const result = launchResume(ctx, record, prompt, {
    claude,
    folder: place.folder,
    mcpFile: existsSync(mcpFile) ? mcpFile : null,
    sessionId: record.sessionId,
    settingsFile,
  });
  if (result.ok || result.unnamed) return result;
  try {
    await releaseResume(stateDir, record.repo, record.id, token, { previous: previousLaunch });
  } catch (error) {
    // The claim then ends by itself: a later resume waits that long, and the line says so.
    return {
      ...result,
      why: `${result.why}; its claim could not be given back (${reasonOf(error)}), so it can be resumed again in ${RESUME_CLAIM_MS / 60_000} minutes`,
    };
  }
  return result;
}

/** Runs `claude --bg --resume` for a claimed resume, and reads the session it brought back. */
function launchResume(
  ctx: CrewContext,
  record: CrewRecord,
  text: null | string,
  launch: {
    claude: string;
    folder: string;
    mcpFile: null | string;
    sessionId: string;
    settingsFile: string;
  },
): ResumeResult {
  const deps = claudeDeps(ctx);
  const called = callClaude(
    deps,
    launch.claude,
    resumeArgs(
      {
        effort: record.effort,
        model: record.model.named,
        permissionMode: record.permissionMode,
        sessionId: launch.sessionId,
      },
      { mcpFile: launch.mcpFile, settingsFile: launch.settingsFile },
      text,
    ),
    launch.folder,
  );
  if (!called.ok) return { ok: false, unnamed: false, why: called.why };
  const { run } = called;
  const command = `claude --bg --resume ${launch.sessionId}`;
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
  return resumedSession(record, run, deps, launch.claude, launch.folder, command);
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
  deps: ClaudeDeps,
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
