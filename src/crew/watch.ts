/**
 * `cc-smart-dev-kit crew watch [--lead <session>] [--once] [--timeout <seconds>]`: the lead's
 * window on its crew.
 *
 * **One line per change, and nothing else** (D25: the lead never waits, never polls, never asks
 * "done?"). Two readers feed it:
 *
 * - **the store's events log** (`events.jsonl`), read from the byte after the last whole line the
 *   last pass read — the store's own reader (`readCrewEvents`). A step, a report, a question and
 *   a state change are each one line, and **every change of state is said from its event and from
 *   nowhere else**: the watch's own acts write events too, so a change it makes is said once, in
 *   the same pass, and never twice.
 * - **agent view** (`claude agents --json --all`), read on every pass: what the sessions are doing
 *   now. It raises three alerts, each said once while it lasts, and none of them an action: a
 *   crew session that waits on a permission prompt or an input ("needs you"), one whose transcript has
 *   not moved for `workflow.crew.quietMinutes` ("quiet"), and one whose turn ended with no
 *   report. It also keeps the store true: a session that failed is `failed`, one that was stopped
 *   by hand is `stopped` — a crew session that is neither running nor reported must not hold a place
 *   (`RUNNING_STATES`) and keep a queued crew session waiting for ever.
 *
 * **The watch also acts** (D35: a crew session never outlives its work), and only on crew sessions the store
 * records — a session the kit does not know is the person's own:
 *
 * - it starts the **queued** crew sessions of this lead when a place frees — through the launcher's own
 *   path (`startQueued`), never a second launcher. A queued crew session held by a phase that was
 *   removed before its work was merged never starts by itself: the watch says so once, and names
 *   the way to drop the wait;
 * - it **resumes the paused** crew sessions of this lead once the gateway answers again (D42):
 *   one first, the others 30 s apart and only after the router answered a request since, never
 *   while a slot's breaker is open or a Claude limit is current (`src/crew/wait.ts`);
 * - it **ends** a crew session whose turn ended with a `done` or a `failed` report (`claude stop <id>`;
 *   the conversation stays; the record keeps `done` or `failed`), and a `blocked` one that has
 *   idled past `workflow.crew.idleStopMinutes`;
 * - it marks a crew session **merged** when the lead merged its branch, and then **removes it**
 *   (D62): the same steps `crew rm` runs (`runCrewRm`), never a second copy. A queued or starting
 *   continuation that still needs the branch holds the removal back until it starts; a refusal —
 *   a program still runs from the worktree, or work nobody committed — is said once and left for
 *   the lead. A **stopped** record is marked merged too, so what waits for its phase starts, but
 *   never removed: that is the lead's call (D62);
 * - every few minutes it finishes a removal that stopped halfway (`<path>-removing-<time>`).
 *
 * `--once` ends on the next change: where the plugin's monitors do not run, the lead runs it in
 * the background and its end starts the lead's next turn.
 */
import { randomUUID } from "node:crypto";
import { COMMAND } from "../build-info/names";
import { runGit } from "../hooks/git";
import { currentHolder } from "../setup/lock";
import type { ResolvedWorkflow } from "../workflow/resolve";
import { reviewsFile, reviewsOn } from "../workflow/reviews";
import { baseBranch } from "../worktrees/command";
import { agentRows, claudeDeps, isLiveRow, rowOf } from "./agents";
import {
  type ResumedSession,
  resumedAs,
  resumeSession,
  sendMessageLine,
  UNREADABLE_VIEW_WHY,
} from "./answer";
import { type Caller, readCaller, reasonOf } from "./caller";
import { type AgentRow, callClaude, findClaude } from "./claude";
import type { CrewContext } from "./context";
import { LEFTOVER_STOP_MARK, mergedIntoBase } from "./end";
import { mergeProof, observeLeadPresence, STOPPED_REMINDER_MS, stoppedCrewNeed } from "./lifecycle";
import { memoryMbOf } from "./memory";
import { runningCrew, unmetWaits } from "./places";
import { finishParkedWorktrees, runCrewRm } from "./remove";
import { startQueued } from "./start";
import {
  type CrewEvent,
  type CrewRecord,
  keepWatchLease,
  listCrew,
  listLeads,
  readCrewEvents,
  readReport,
  readWatchState,
  setCrewMemory,
  takeWatchLease,
  updateCrew,
  type WatchLease,
  type WatchState,
  writeWatchState,
} from "./store";
import { monitorsRunHere } from "./telemetry";
import { changedAt, transcriptFile } from "./transcript";
import {
  type GatewayNow,
  gatewayNow,
  pauseStartedAt,
  REPAUSE_WINDOW_MS,
  RESUME_SPACING_MS,
  resumeText,
  routerAnsweredSince,
  waitOver,
} from "./wait";

/** How often the watch reads agent view. */
export const WATCH_POLL_MS = 20_000;

/**
 * A watch that must stop acting (WF1): a newer watch of its lead took the lease, the process that
 * started it ended, or nobody reads its output. Thrown by its check (`WatchScope.goesOn`) before
 * it acts, and caught once in `runCrewWatch`, which says `line` on `stream` and ends with 0.
 */
export class WatchEnd extends Error {
  override name = "WatchEnd";
  readonly line: string;
  readonly stream: "error" | "print";

  constructor(stream: "error" | "print", line: string) {
    super(line);
    this.line = line;
    this.stream = stream;
  }
}

/**
 * How long a `starting` crew session may run before its own SessionStart hook has said it reached
 * its worktree (H101). The hook runs within seconds of the session's start; past this, it never
 * did — a crash, `ownHooks` silencing it, or a session outside git — so the watch alerts the lead
 * once. The record stays `starting`, and the alert is the only sign: the folder is never judged
 * from agent view (it reports the launch folder).
 */
export const WORKTREE_CONFIRM_MS = 3 * 60_000;

/**
 * The states a crew session's work is over in: the watch looks at the lead's merge for each of them,
 * because the merge can come after the crew session was stopped. A `stopped` one is marked merged
 * too — what waits for its phase starts on the merge — but **never removed by the watch (D62)**:
 * stopping it was the lead's call, and so is its removal (`mergedWhileStopped`, `store.ts`).
 */
const OVER_STATES: readonly string[] = ["done", "failed", "handoff", "merged", "stopped"];

/**
 * How often the watch looks for folders a removal moved aside and could not remove (D62). One
 * that stays costs a scan of the whole repository, so a pass every 20 seconds would repeat it
 * for ever; a few minutes is soon enough for something that is not urgent.
 */
export const PARKED_PASS_MS = 5 * 60_000;

/** The key under which the watch remembers it said a look for moved-aside folders failed. */
const PARKED_SAID_KEY = "watch:parked";

/** The longest piece of a crew session's own words a line carries. */
const CLIP_CHARS = 120;

/** What `crew watch` was asked, already checked to be well formed. */
export interface WatchArgs {
  /** The lead session whose crew sessions are watched; null when the calling session's. */
  lead: null | string;
  /** Ends on the next change; false when the watch runs for the session. */
  once: boolean;
  /** How long `--once` waits for something to say, in seconds; null when it waits for ever. */
  timeoutSeconds: null | number;
}

/** A crew session's own words, on one line and no longer than a line should be. */
function clip(text: string): string {
  const one = (text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim();
  return one.length <= CLIP_CHARS ? one : `${one.slice(0, CLIP_CHARS - 1)}…`;
}

/**
 * What a blocked or failed crew session's report says about why, in a few words; null for any other
 * report, or one that cannot be read (the line then says the status alone).
 */
function reportDetail(record: null | CrewRecord): null | string {
  if (record === null || record.reportPath === null) return null;
  let report: ReturnType<typeof readReport>;
  try {
    report = readReport(record.reportPath);
  } catch {
    // A report that cannot be read leaves the line with its status alone.
    return null;
  }
  if (report === null) return null;
  if (report.status === "blocked" && report.question !== null) {
    return `waits on: ${clip(report.question)}`;
  }
  if (report.status === "failed") {
    const why = report.summary ?? report.open[0] ?? null;
    return why === null ? null : `why: ${clip(why)}`;
  }
  return null;
}

/**
 * The line for one event of the log, or null when the event is not news. A report names the
 * review the record holds, the phases that wait for this one and the report's file; a blocked or
 * failed one says why; a question says how to answer it; a state change says what it changed to
 * and why. `created` and `starting` are the lead's own launch, which it saw.
 */
export function eventLine(
  event: CrewEvent,
  record: null | CrewRecord,
  waits: readonly string[],
  reviewed: boolean,
): null | string {
  const name = event.name;
  switch (event.type) {
    case "state": {
      // `created` is the lead's own launch, which it saw. A `starting` event is news only when the
      // launcher gave it a line: one the watch started from the queue ("started from the queue").
      // The crew session's own SessionStart hook then says `working`, in the same way (H101).
      if (event.state === "starting" && (event.text === null || event.text === "")) return null;
      const line =
        event.text === null || event.text === ""
          ? `${name}: ${event.state}`
          : `${name}: ${event.state} — ${event.text}`;
      // What the session held when it ended (D35 measures it): the memory the stop freed.
      return typeof event.memoryMb === "number"
        ? `${line} · held ${Math.round(event.memoryMb)} MB`
        : line;
    }
    case "step": {
      const parts = [`${name}: ${event.text ?? "step"}`];
      if (typeof event.sha === "string") parts.push(event.sha.slice(0, 7));
      if (typeof event.note === "string" && event.note !== "") parts.push(clip(event.note));
      return parts.join(" · ");
    }
    case "report": {
      const status = event.text ?? "reported";
      const parts = [`${name}: ${status}`];
      const detail = reportDetail(record);
      if (detail !== null) parts.push(detail);
      if (status === "done" || status === "handoff") parts.push(reviewed ? "review ✓" : "review ✗");
      if (status === "done" && waits.length > 0) parts.push(`unblocks ${waits.join(", ")}`);
      if (typeof record?.reportPath === "string") parts.push(`report ${record.reportPath}`);
      return parts.join(" · ");
    }
    case "question":
      return `${name}: question · ${clip(event.text ?? "")} · answer it: crew answer "${name}" "<text>"`;
    case "person":
      // The person typed into the crew session (D55): their word wins over the brief, so the
      // phase it hands back may no longer be the phase it started — read it against the brief.
      return `${name}: the person wrote · ${clip(event.text ?? "")} · read its next report against the brief before the merge`;
    case "tell": {
      // A crew session told another a contract change or asked it a contract question (D47):
      // the lead sees it, because it is the one that answers what the two cannot settle.
      const told = event.tell?.to ?? [];
      const kind = event.tell?.kind ?? "note";
      return `${name}: told ${told.join(", ")} · ${kind} · ${clip(event.text ?? "")}`;
    }
    case "lead-tell": {
      // Another lead of this repository told this one a note (D55). The event's name is the
      // sending lead, and its text is the note's first line without the tag — the line already
      // names the lead, so the tag would say it twice.
      const kind = event.tell?.kind ?? "note";
      return `${name}: ${kind} from another lead · ${clip(event.text ?? "")}`;
    }
    case "clash":
    case "merge":
      // Both carry their whole line, written where it happened: the start's file clash (D55)
      // and a pull request merged into the base, for the other leads (D55).
      return event.text === null || event.text === "" ? null : event.text;
    default:
      return null;
  }
}

/**
 * The phases that wait for the phase of `record`: the phases the other crew sessions of this lead
 * wait for. A crew session whose report ends its phase unblocks them once the lead merges its branch.
 */
export function phasesWaitingFor(record: CrewRecord, records: readonly CrewRecord[]): string[] {
  const phases = new Set<string>();
  for (const one of records) {
    if (one.id === record.id) continue;
    if (one.waitsFor.includes(record.phase)) phases.add(one.phase);
  }
  return [...phases].sort();
}

/**
 * The one line for a queued crew session held by a phase that was removed before the lead merged
 * its work; null when no wait of it is such a phase. Nothing releases that wait by itself — the
 * work it waits for is not on the lead's branch — so the line says so once, and gives the way to
 * drop the wait: a queued crew session is removed at once, and the phase starts again without it.
 */
export function stuckWaitLine(record: CrewRecord, records: readonly CrewRecord[]): null | string {
  const stuck = unmetWaits(record.waitsFor, records).filter(
    (wait) => wait.removedUnmerged !== undefined,
  );
  if (stuck.length === 0) return null;
  const phases = stuck
    .map(
      (wait) =>
        `${wait.phase} (${wait.removedUnmerged?.name ?? wait.phase} was removed before its work was merged)`,
    )
    .join(", ");
  return `${record.name}: still waits for ${phases}; it will not start by itself — to drop the wait: ${COMMAND} crew rm "${record.name}", then start ${record.phase} again`;
}

/** True when `record` holds a place: its session lives and its phase is open. */
function isRunning(record: CrewRecord): boolean {
  return runningCrew([record]).length === 1;
}

/**
 * The alert for a running crew session, from agent view; null when there is nothing to say. Each is
 * said once while it lasts, and none is an action:
 *
 * - it **needs the person**: agent view says it waits on a permission prompt or an input;
 * - it **ended its turn with no report**: its session is done, but its record is still at work;
 * - it **never confirmed its worktree**: its session is listed and alive, but its own start hook
 *   has not turned the `starting` record `working` within `WORKTREE_CONFIRM_MS` (H101: the hook
 *   may have crashed, been silenced by `ownHooks`, or run outside git);
 * - it is **quiet**: agent view says working, but its transcript has not been written for
 *   `quietMinutes`.
 */
export function crewAlert(
  record: CrewRecord,
  row: null | AgentRow,
  now: number,
  quietMinutes: number,
  projectsDir: string,
): null | string {
  if (row === null || !isRunning(record)) return null;
  if (row.state === "blocked" || row.status === "waiting") {
    return `${record.name}: needs you — ${row.waitingFor ?? "it is waiting"}`;
  }
  if (row.state === "done" && (record.state === "working" || record.state === "starting")) {
    return `${record.name}: ended its turn with no report`;
  }
  if (record.state === "starting" && isLiveRow(row)) {
    const since = Date.parse(record.startedAt ?? record.createdAt);
    if (Number.isFinite(since) && now - since > WORKTREE_CONFIRM_MS) {
      // One stable line, so it is said once while the record stays `starting` (the map in the
      // watch's state keeps it from repeating).
      return `${record.name}: never confirmed its worktree — its session runs, but its own start hook has not recorded it in the worktree (it may have crashed, be silenced by ownHooks, or run outside git)`;
    }
  }
  if (row.state === "working" && record.sessionId !== null) {
    const last = changedAt(transcriptFile(projectsDir, record.worktree, record.sessionId));
    if (last !== null && now - last > quietMinutes * 60_000) {
      return `${record.name}: quiet — nothing written for ${Math.round((now - last) / 60_000)} minutes`;
    }
  }
  return null;
}

/**
 * True when the lead merged the branch of `record` into the branch it was cut from
 * (`record.baseRef`): the branch holds a commit of its own, and its work is on the base —
 * `mergedIntoBase`, the answer `crew rm` gives too: its tip is an ancestor (a merge commit), or
 * merging it changes nothing (a squash merge). When git cannot say, the branch is not reported
 * merged. A branch with no commit of its own has its base as its tip and is not reported merged.
 */
export function branchMerged(record: CrewRecord, ctx: CrewContext): boolean {
  const found = mergedIntoBase(record, ctx);
  return found === "ancestor" || found === "replay";
}

/**
 * Recover the stopped intent of a legacy merged record from its last two distinct states.
 * Events are newest first. A stop before a resume is not a stopped-to-merged transition.
 * Missing history cannot prove intent and keeps the legacy policy unchanged.
 */
function historicallyMergedWhileStopped(record: CrewRecord, events: readonly CrewEvent[]): boolean {
  const transitions = events.filter(
    (event) => event.crew === record.id && ["created", "state", "report"].includes(event.type),
  );
  if (transitions[0]?.state !== "merged") return false;
  return transitions.find((event) => event.state !== "merged")?.state === "stopped";
}

/** What one pass of the watch works over. */
export interface WatchScope {
  /** The lead session whose crew sessions are watched. */
  leadSessionId: string;
  /** The folder the lead merges in: its own, else the repository's main checkout. */
  mergeInto: string;
  repo: string;
  resolved: ResolvedWorkflow;
  /**
   * The ref a removal that stopped halfway is judged against when the store no longer knows its
   * crew session: `origin/<base>`, else the local branch of that name (`watchBase`). Null when
   * the repository has neither, and then such a folder is left alone rather than judged against
   * a guess.
   */
  base?: null | { label: string; ref: string };
  /**
   * False: this pass starts no queued crew session (`startQueued`). The watch sets it for a pass
   * whose workflow it could not read again — a file it cannot use, **and the person's own
   * switch**: `readCaller` refuses the same way for `crew.enabled` off and for a session in
   * bypass mode. A cap nobody could read, or a feature the person just turned off, is no licence
   * to start a session: the pass says why once and holds everything in the queue. Default: true.
   */
  mayStart?: boolean;
  /**
   * What the gateway says at a moment (D42), for the paused crew sessions. Left out, one pass
   * reads the state file, the config and the router's health page. A test hands in its own: no
   * test reaches a real router's port.
   */
  gateway?: (nowMs: number) => Promise<GatewayNow>;
  /**
   * Throws `WatchEnd` when this watch may no longer act (WF1): it lost its lead's lease, its
   * parent ended, or nobody reads its output. The pass asks again right before it starts queued
   * crew sessions and before it resumes paused ones — each launches a Claude session, and two
   * watches launching one record start two. Left out (a test's own pass): it always goes on.
   */
  goesOn?: () => Promise<void>;
}

/**
 * Stops `record`'s Claude session: `claude stop`, so the conversation stays on disk and the crew
 * session can be read and resumed by an answer. Null when done; else why not, for an alert.
 */
async function stopSession(record: CrewRecord, ctx: CrewContext): Promise<null | string> {
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  const shortId = record.shortId;
  if (claude === null) return `${record.name}: not stopped — claude is not on PATH`;
  if (shortId === null) return `${record.name}: not stopped — it has no session id`;
  const called = callClaude(claudeDeps(ctx), claude, ["stop", shortId], ctx.cwd);
  if (!called.ok || called.run.exitCode !== 0) {
    return `${record.name}: not stopped — claude stop ${shortId} failed`;
  }
  return null;
}

/** The one line the watch says when it ends the session of a crew session that failed (H101). */
export function failedStopLine(record: CrewRecord): string {
  return `${record.name}: its session stopped — it failed; the record stays failed`;
}

/**
 * The one line the watch says when it ends the session of a crew session whose turn ended (D35).
 * **The record keeps `done`.** A `stopped` record means a crew session something stopped before
 * its phase was over, and D62 leaves that one's removal to the lead: were a finished turn written
 * `stopped`, every auto-removal below would be dead.
 */
export function doneStopLine(record: CrewRecord): string {
  return `${record.name}: its session stopped — its turn ended; the record stays done`;
}

/**
 * Stops the session of `record` (`stopSession`) and records the state it ends in with `reason`.
 * Null when done; else why not, for an alert.
 */
async function stopCrew(
  record: CrewRecord,
  state: "merged" | "stopped",
  reason: string,
  ctx: CrewContext,
  row: null | AgentRow,
): Promise<null | string> {
  const why = await stopSession(record, ctx);
  if (why !== null) return why;
  await updateCrew(
    ctx.paths.stateDir,
    record.repo,
    record.id,
    { state },
    ctx.now(),
    reason,
    memoryMbOf(row?.pid ?? null),
  );
  return null;
}

/**
 * Reads the log from `from`, says each line that is news for this lead's crew sessions, and gives the
 * byte to go on from. The records are read after the events, so a record is at least as new as
 * the event that names it (a report's file is there when its line is said).
 */
function sayEvents(
  from: number,
  scope: WatchScope,
  ctx: CrewContext,
  say: (line: string) => void,
): number {
  const read = readCrewEvents(ctx.paths.stateDir, scope.repo, from);
  if (read.events.length === 0) return read.offset;
  const mine = listCrew(ctx.paths.stateDir, scope.repo).records.filter(
    (one) => one.leadSessionId === scope.leadSessionId,
  );
  const reviewFile = reviewsFile(ctx.paths.stateDir, scope.repo);
  for (const event of read.events) {
    if (event.lead !== scope.leadSessionId) continue;
    const record = mine.find((one) => one.id === event.crew) ?? null;
    const reviewed =
      record !== null &&
      reviewsOn(reviewFile, record.branch, scope.resolved.reviewAgents.value).length > 0;
    const line = eventLine(
      event,
      record,
      record === null ? [] : phasesWaitingFor(record, mine),
      reviewed,
    );
    if (line !== null) say(line);
  }
  return read.offset;
}

/**
 * How long after a resume the wave is still one wave: a further paused crew session resumed
 * within this is one of it (30 s apart, and only after the router answered), and one resumed
 * after it starts a new wave with a canary of its own.
 */
const RESUME_WAVE_GAP_MS = REPAUSE_WINDOW_MS;

/** What a resume of a paused crew session leaves in the watch's state: when, and the router's count then. */
type ResumeMark = Pick<WatchState, "resumedAt" | "routerRequests">;

/**
 * The `said` key that holds a paused crew session back from the watch's resumes: its last resume
 * may have started a session the kit could not name (`ResumeResult.unnamed`), and a second try
 * could start a second one. The lead's own `crew resume` brings it back; the key goes when the
 * record is no longer `paused`.
 */
function resumeHoldKey(id: string): string {
  return `resume-hold:${id}`;
}

/**
 * Resumes the ready paused crew sessions of one pass (D42): **one at a time**. The first of a
 * wave is the canary. Each further one waits `RESUME_SPACING_MS` after the resume before it,
 * and only goes once the router answered a request since (`routerAnsweredSince`); a pass that
 * may not resume yet says nothing, because nothing changed. A crew session held back
 * (`resumeHoldKey`) is skipped.
 */
async function resumePaused(
  paused: readonly CrewRecord[],
  state: WatchState,
  said: Record<string, string>,
  ctx: CrewContext,
  gateway: (nowMs: number) => Promise<GatewayNow>,
  goesOn: () => Promise<void>,
  agents: null | AgentRow[],
  say: (line: string) => void,
): Promise<null | ResumeMark> {
  const now = ctx.now();
  const facts = await gateway(now);
  const ready = paused
    .filter((one) => said[resumeHoldKey(one.id)] === undefined && waitOver(one, facts, now))
    .sort(
      (a, b) => pauseStartedAt(a) - pauseStartedAt(b) || a.createdAt.localeCompare(b.createdAt),
    );
  const [next] = ready;
  if (next === undefined) return null;
  const last = state.resumedAt;
  if (last !== undefined && now - last < RESUME_WAVE_GAP_MS) {
    if (now - last < RESUME_SPACING_MS) return null;
    if (!routerAnsweredSince(facts, state.routerRequests ?? null)) return null;
  }
  // Only the watch that holds its lead's lease resumes (WF1): two would start two sessions.
  await goesOn();
  const held = `the watch leaves it paused: ${COMMAND} crew resume "${next.name}" brings it back`;
  const one = await resumeOne(next, ctx, now, agents, say, held);
  if (one.unnamed) said[resumeHoldKey(next.id)] = held;
  // A resume that failed is no resume: the next pass tries again, and the others wait for it.
  if (!one.ok) return null;
  return { resumedAt: now, routerRequests: facts.requests };
}

/** What a resume of a paused crew session came to: whether it happened, whether the store has it, and how. */
export interface OneResume {
  ok: boolean;
  /** False when the store could not write the state: the record stays `paused`. */
  stored: boolean;
  /** A message to a session that still has a process, or a resume of one that has none. */
  way: "message" | "resume";
  /** The short id of the session that runs now: the record's own, or the copy a resume started. */
  shortId: null | string;
  /** True when the resume may have started a session it could not name (`ResumeResult`). */
  unnamed: boolean;
}

/**
 * Takes one paused crew session out of its wait, the way `crew answer` reaches a crew session:
 * a message for one whose session still has a process (the CLI prints the `SendMessage` line;
 * only a session holds that tool), `claude --bg --resume <id> "<text>"` in its worktree, with its
 * own settings and MCP files, for one whose session has none. **One home for bringing a paused
 * crew session back**: the watch and `crew resume --paused` (`end.ts`) both use it. The record is
 * `working` again in the same act, so nothing resumes it twice and it holds its place — with the
 * session the resume brought back (WF1: every crew resume is a copy with a new id), so the record
 * never names a session that is gone. A resume that fails is one line, and the record stays
 * `paused`; so is an agent view that cannot be read — it could be either, and a copy is worse than
 * a second try. `unnamedNote` ends the line of a resume that may have started a session it could
 * not name (the watch says it holds the record back).
 */
export async function resumeOne(
  record: CrewRecord,
  ctx: CrewContext,
  now: number,
  agents: null | AgentRow[],
  say: (line: string) => void,
  unnamedNote: null | string = null,
): Promise<OneResume> {
  const text = resumeText(record, record.waitingFor, now);
  const failed = { ok: false, shortId: record.shortId, stored: false, way: "resume" } as const;
  if (agents === null) {
    const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
    const why =
      claude === null
        ? "claude is not on PATH, nor in ~/.local/bin, so it cannot be resumed"
        : UNREADABLE_VIEW_WHY;
    say(`${record.name}: not resumed — ${why}`);
    return { ...failed, unnamed: false };
  }
  if (isLiveRow(rowOf(agents, record))) {
    say(sendMessageLine(record.name, text));
    const stored = await sayResumed(
      record,
      "the wait is over; the message to it wakes it",
      null,
      ctx,
      now,
      say,
    );
    return { ok: true, shortId: record.shortId, stored, unnamed: false, way: "message" };
  }
  const resumed = await resumeSession(ctx, record, text);
  if (!resumed.ok) {
    const note = resumed.unnamed && unnamedNote !== null ? `; ${unnamedNote}` : "";
    say(`${record.name}: not resumed — ${resumed.why}${note}`);
    return { ...failed, unnamed: resumed.unnamed };
  }
  const { session } = resumed;
  const stored = await sayResumed(
    record,
    `the wait is over; it was resumed${resumedAs(record, session.shortId)}`,
    session,
    ctx,
    now,
    say,
  );
  return { ok: true, shortId: session.shortId, stored, unnamed: false, way: "resume" };
}

/**
 * Records a resumed crew session `working` with its wait cleared, and with the session a resume
 * brought back (null: a message woke its own); false (and one line) when the store cannot.
 */
async function sayResumed(
  record: CrewRecord,
  text: string,
  session: null | ResumedSession,
  ctx: CrewContext,
  now: number,
  say: (line: string) => void,
): Promise<boolean> {
  try {
    await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      {
        state: "working",
        waitingFor: undefined,
        ...(session === null ? {} : { sessionId: session.sessionId, shortId: session.shortId }),
      },
      now,
      text,
    );
    return true;
  } catch (error) {
    say(`${record.name}: resumed, but the store could not record it: ${reasonOf(error)}`);
    return false;
  }
}

/** One pass of the watch: what changed, what is started, what is resumed, what is ended. */
export async function watchPass(
  state: WatchState,
  ctx: CrewContext,
  scope: WatchScope,
): Promise<{ lines: number; state: WatchState }> {
  const { repo, resolved } = scope;
  const said = { ...state.said };
  const removals = { ...state.removals };
  const stoppedRemindedAt = { ...state.stoppedRemindedAt };
  let noted = state.noted;
  let lines = 0;
  const say = (line: string): void => {
    ctx.print(line);
    lines += 1;
  };

  // Where the plugin's monitors do not run (telemetry off), this watch is the way the lead
  // hears. The lead is told once, so it knows to re-arm the watch after each event. The note is
  // not news: it does not end a `--once` that waits for a change.
  if (!noted && !monitorsRunHere(ctx.env, ctx.paths.settingsFile)) {
    ctx.print(
      "the plugin's monitors do not run on this machine (telemetry is off), so run this watch again after each event",
    );
    noted = true;
  }

  // What happened since the last pass.
  let offset = sayEvents(state.offset, scope, ctx, say);

  // What the sessions are doing now.
  const agents = agentRows(ctx);
  await observeLeadPresence(
    ctx.paths.stateDir,
    listLeads(ctx.paths.stateDir, repo).records,
    agents,
    ctx.now(),
  );
  const mine = listCrew(ctx.paths.stateDir, repo).records.filter(
    (one) => one.leadSessionId === scope.leadSessionId,
  );
  for (const record of mine) {
    const row = agents === null ? null : rowOf(agents, record);
    const alert = crewAlert(
      record,
      row,
      ctx.now(),
      resolved.crew.quietMinutes.value,
      ctx.paths.projectsDir,
    );
    if (alert !== null && said[record.id] !== alert) {
      say(alert);
      said[record.id] = alert;
    } else if (alert === null) {
      delete said[record.id];
    }
    if (row === null || !isRunning(record)) continue;
    // The store stays true, so a crew session that is gone does not hold a place. Each change is a
    // state event, said below.
    if (row.state === "failed") {
      await updateCrew(
        ctx.paths.stateDir,
        record.repo,
        record.id,
        { state: "failed" },
        ctx.now(),
        "its session failed",
        memoryMbOf(row.pid),
      );
    } else if (row.state === "stopped") {
      await updateCrew(
        ctx.paths.stateDir,
        record.repo,
        record.id,
        { state: "stopped" },
        ctx.now(),
        "its session was stopped",
      );
    } else {
      const memory = memoryMbOf(row.pid);
      if (memory !== null && record.memoryMb !== memory) {
        await setCrewMemory(ctx.paths.stateDir, record.repo, record.id, memory);
      }
    }
  }

  // Crew sessions whose work is over: the lead's merge, the end of a session, a blocked crew session that
  // idled. Only a crew session the store records is ever stopped.
  const allRecords = listCrew(ctx.paths.stateDir, repo).records;
  const events = readCrewEvents(ctx.paths.stateDir, repo).events.reverse();
  for (const record of allRecords) {
    if (record.leadSessionId !== scope.leadSessionId) continue;
    const lastReminder = stoppedRemindedAt[record.id];
    // Check spacing before the shared need runs synchronous git merge proof.
    if (lastReminder === undefined || ctx.now() - lastReminder >= STOPPED_REMINDER_MS) {
      const need = stoppedCrewNeed(record, events, ctx, allRecords);
      if (need !== null) {
        say(need.line);
        stoppedRemindedAt[record.id] = ctx.now();
      }
    }
    const row = agents === null ? null : rowOf(agents, record);
    // Its session is in agent view and is neither stopped nor dead: it may still hold a process
    // (a session whose turn ended keeps one, D35). A session that crashed has nothing to stop.
    const listed = row !== null && row.state !== "stopped" && row.state !== "failed";
    const stopKey = `${record.id}:stop`;
    let refusal: null | string = null;
    /** What the watch did about it, when the act is news of its own (a failed record's stop). */
    let news: null | string = null;
    if (
      OVER_STATES.includes(record.state) &&
      (record.state === "merged" || branchMerged(record, ctx))
    ) {
      const wasStopped = record.state === "stopped";
      // Marked once: a record that is merged already is not written again on every pass.
      if (record.state !== "merged") {
        const proof = mergeProof(record, ctx);
        if (proof === undefined) continue;
        await updateCrew(
          ctx.paths.stateDir,
          record.repo,
          record.id,
          { state: "merged", mergeProof: proof },
          ctx.now(),
          wasStopped
            ? "the lead merged its branch; it was stopped, so `crew rm` removes it"
            : "the lead merged its branch; the watch removes it",
        );
      }
      // D62: stopping a crew session was the lead's call, and so is removing it. It is marked
      // merged all the same — what waits for its phase starts on the merge — and left for
      // `crew rm`. The store keeps the fact (`mergedWhileStopped`), so a later pass sees it too.
      if (wasStopped || record.mergedWhileStopped === true) continue;
      if (
        record.state === "merged" &&
        record.mergedWhileStopped === undefined &&
        historicallyMergedWhileStopped(record, events)
      ) {
        await updateCrew(
          ctx.paths.stateDir,
          record.repo,
          record.id,
          { mergedWhileStopped: true },
          ctx.now(),
        );
        continue;
      }
      // Keep the chain's records until every later continuation's work is on its first base.
      // The records are also the proof of that base for later removals.
      const descendants = new Set([record.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const one of allRecords) {
          if (one.continues != null && descendants.has(one.continues) && !descendants.has(one.id)) {
            descendants.add(one.id);
            grew = true;
          }
        }
      }
      const continuations = allRecords.filter(
        (one) =>
          one.id !== record.id &&
          descendants.has(one.id) &&
          !(one.state === "merged" || (one.state === "removed" && one.mergedBeforeRemoval)) &&
          !branchMerged(one, ctx),
      );
      if (continuations.length > 0) {
        const line = `${record.name}: merged — waiting for its continuation ${continuations[0]?.name ?? "a continuation"} to merge`;
        if (said[stopKey] !== line) {
          say(line);
          said[stopKey] = line;
        }
        continue;
      }
      // Retry refusals only when the folder changes, or after the parked-folder interval.
      const head = runGit(record.worktree, ["rev-parse", "HEAD"], ctx.env);
      const status = runGit(record.worktree, ["status", "--porcelain"], ctx.env);
      const signature = JSON.stringify([head.ok, head.out, status.ok, status.out]);
      const previous = removals[record.id];
      if (
        previous !== undefined &&
        previous.signature === signature &&
        ctx.now() - previous.at < PARKED_PASS_MS
      )
        continue;
      removals[record.id] = { at: ctx.now(), signature };
      // The watch removes it by itself, with the same steps `crew rm` runs.
      const captured: string[] = [];
      const capture = {
        ...ctx,
        error: (line: string) => {
          captured.push(line);
        },
        print: (line: string) => {
          captured.push(line);
        },
      };
      let code: number;
      try {
        code = await runCrewRm(record.id, capture, { skipParked: true });
      } catch (error) {
        captured.push(`crew rm: ${reasonOf(error)}`);
        code = 1;
      }
      if (code !== 0) {
        refusal =
          captured.find((line) => line.startsWith("crew rm:")) ??
          captured.at(-1) ??
          "the removal refused";
        if (said[stopKey] !== refusal) {
          say(refusal);
          said[stopKey] = refusal;
        }
      }
      for (const line of captured.filter(
        (one) =>
          one.startsWith("Fix:") || one.startsWith("note:") || one.startsWith("  the worktree"),
      )) {
        const key = `${record.id}:detail:${line}`;
        if (said[key] !== line) {
          say(line);
          said[key] = line;
        }
      }
      // A removal that stopped the programs a finished turn left running says so once (D62):
      // the lead needs to know, and the rest of the removal's own lines stay captured.
      const stopped = captured.find((line) => line.includes(LEFTOVER_STOP_MARK));
      if (code === 0 && stopped !== undefined && said[stopKey] !== stopped) {
        say(stopped);
        said[stopKey] = stopped;
      }
    } else if (record.state === "failed" && listed) {
      // Its record says failed and **stays failed**: the board must show why it ended, not a
      // stop that hides it. Its session is ended all the same (D35), once (a pass while agent
      // view catches up does not stop it a second time), and one line says so.
      const line = failedStopLine(record);
      if (said[stopKey] !== line) {
        refusal = await stopSession(record, ctx);
        if (refusal === null) news = line;
      } else {
        news = line;
      }
    } else if (record.state === "done" && listed) {
      // Its session ends; its record keeps `done` (D62: `stopped` is for a phase something
      // stopped before it ended, and its removal is the lead's call). Stopped once: the mark
      // in `said` remembers it while agent view catches up.
      const line = doneStopLine(record);
      if (said[stopKey] !== line) {
        refusal = await stopSession(record, ctx);
        if (refusal === null) news = line;
      } else {
        news = line;
      }
    } else if (record.state === "blocked" && listed) {
      const idle = ctx.now() - Date.parse(record.updatedAt);
      if (Number.isFinite(idle) && idle > resolved.crew.idleStopMinutes.value * 60_000) {
        const minutes = Math.round(idle / 60_000);
        refusal = await stopCrew(
          record,
          "stopped",
          `it has been blocked for ${minutes} minutes; an answer brings it back`,
          ctx,
          row,
        );
      }
    }
    // A stop that fails is said once, not on every pass; a failed crew session's stop is said once
    // and is also the mark that its session was ended (its record stays `failed`, so nothing else
    // would remember it).
    const saidLine = refusal ?? news;
    if (saidLine !== null && said[stopKey] !== saidLine) {
      say(saidLine);
      said[stopKey] = saidLine;
    } else if (saidLine === null && record.state !== "failed") {
      delete said[stopKey];
    }
  }

  // Removals that stopped halfway are finished here too (D62): a folder a removal moved aside
  // (`<path>-removing-<time>`) and could not remove, whether or not the store still knows its
  // crew session. After the loop above, so a crew session whose branch this folder's removal
  // deletes was marked merged first — what waits for its phase starts on that mark. A folder
  // that stays is not news; a later look judges it again, every `PARKED_PASS_MS`.
  let parkedAt = state.parkedAt;
  if (parkedAt === undefined || ctx.now() - parkedAt >= PARKED_PASS_MS) {
    parkedAt = ctx.now();
    try {
      await finishParkedWorktrees(repo, ctx, scope.base ?? null, say);
    } catch (error) {
      // A look that fails never ends the watch: it is said once, and tried again later.
      const line = `crew watch: could not look for folders a removal left half done: ${reasonOf(error)}`;
      if (said[PARKED_SAID_KEY] !== line) {
        ctx.error(line);
        said[PARKED_SAID_KEY] = line;
      }
    }
  }

  // Crew sessions that wait for a place: start them, oldest first. Each start is state events.
  const here = listCrew(ctx.paths.stateDir, repo).records;
  const queued = here
    .filter((one) => one.leadSessionId === scope.leadSessionId && one.state === "queued")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Only the watch that holds its lead's lease starts a session (WF1).
  if (queued.length > 0 && scope.mayStart !== false) await scope.goesOn?.();
  for (const record of queued) {
    if (scope.mayStart !== false) await startQueued(record, ctx, resolved);
    // A phase that was removed before its work was merged releases nothing, so this one never
    // starts by itself: say it once, with the way to drop the wait (a phase that was merged
    // before its removal started it, and the start's own state event is its line).
    const waitKey = `${record.id}:wait`;
    const stuck = stuckWaitLine(record, here);
    if (stuck !== null && said[waitKey] !== stuck) {
      say(stuck);
      said[waitKey] = stuck;
    } else if (stuck === null) {
      delete said[waitKey];
    }
  }

  // Crew sessions that wait out a limit: resume them once the gateway answers again (D42), one
  // at a time, and never while a breaker is open or a limit is current.
  const paused = listCrew(ctx.paths.stateDir, repo).records.filter(
    (one) => one.leadSessionId === scope.leadSessionId && one.state === "paused",
  );
  // A hold lasts while its record stays paused: once the lead brought it back, it goes.
  for (const key of Object.keys(said)) {
    if (key.startsWith(resumeHoldKey("")) && !paused.some((one) => resumeHoldKey(one.id) === key)) {
      delete said[key];
    }
  }
  const marked =
    paused.length === 0
      ? null
      : await resumePaused(
          paused,
          state,
          said,
          ctx,
          scope.gateway ?? ((now) => gatewayNow(ctx.paths, now)),
          scope.goesOn ?? (() => Promise.resolve()),
          agents,
          say,
        );

  // What this pass itself wrote is said now, in the same pass — once.
  offset = sayEvents(offset, scope, ctx, say);
  const resumedAt = marked?.resumedAt ?? state.resumedAt;
  const routerRequests = marked === null ? state.routerRequests : marked.routerRequests;
  return {
    lines,
    state: {
      noted,
      removals,
      stoppedRemindedAt,
      offset,
      said,
      ...(resumedAt === undefined ? {} : { resumedAt }),
      ...(routerRequests === undefined ? {} : { routerRequests }),
      parkedAt,
    },
  };
}

/**
 * The lead whose crew sessions are watched: `--lead` names one; else the session that runs the
 * command; else the only lead recorded in this repository (a monitor runs as a process of its
 * own, and may find no session above it).
 */
export function leadOf(
  named: null | string,
  sessionId: null | string,
  leadSessionIds: readonly string[],
): null | string {
  if (named !== null) return named;
  if (sessionId !== null) return sessionId;
  return leadSessionIds.length === 1 ? (leadSessionIds[0] ?? null) : null;
}

/**
 * The ref a removal that stopped halfway is judged against when its record is gone: the base
 * `worktrees` judges against (`baseBranch`: the project's `worktrees.base`, else the remote's
 * default branch, else `main`) as `origin/<base>`, else — a repository with no remote — the
 * local branch of that name. Null when neither is there, and then such a folder is left alone:
 * nothing is judged against a guess.
 */
function watchBase(caller: Caller, ctx: CrewContext): null | { label: string; ref: string } {
  const { base } = baseBranch(caller.checkout, ctx.env, caller.repo);
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    if (runGit(caller.repo, ["rev-parse", "--verify", "--quiet", ref], ctx.env).ok) {
      return { label: base, ref };
    }
  }
  return null;
}

/** `crew watch`; the exit code. */
export async function runCrewWatch(args: WatchArgs, ctx: CrewContext): Promise<number> {
  const read = readCaller("watch", ctx, { session: "optional" });
  if (!read.ok) {
    for (const line of read.lines) ctx.error(line);
    return 1;
  }
  const { repo, resolved } = read.caller;
  const leads = listLeads(ctx.paths.stateDir, repo).records;
  const leadSessionId = leadOf(
    args.lead,
    read.caller.session?.sessionId ?? null,
    leads.map((one) => one.sessionId),
  );
  if (leadSessionId === null) {
    ctx.error(
      `crew watch: which lead's crew sessions? name one with --lead <session>${
        leads.length === 0
          ? " (no lead is recorded in this repository)"
          : ` (the leads here: ${leads.map((one) => one.sessionId).join(", ")})`
      }`,
    );
    return 2;
  }
  // The lead merges in its own folder; where that is gone, in the main checkout.
  const mergeInto = leads.find((one) => one.sessionId === leadSessionId)?.cwd ?? repo;
  // **One acting watch per lead: the newest wins** (WF1). A monitor the lead restarts is its
  // intent, so this watch takes the lease whoever holds it, and the one it replaces ends at its
  // next look. Before the state is read, so this watch goes on from where the last one wrote.
  const lease: WatchLease = { ...currentHolder(), at: ctx.now(), token: randomUUID() };
  try {
    await takeWatchLease(ctx.paths.stateDir, repo, leadSessionId, lease);
  } catch (error) {
    ctx.error(`crew watch: could not take this lead's watch lease: ${reasonOf(error)}`);
    return 1;
  }
  const parent = ctx.parentPid?.() ?? null;
  const goesOn = async (): Promise<void> => {
    // Claude Code ends a monitor by ending its shell, and the watch is re-parented: nobody
    // started it any more, and nobody reads it.
    if (parent !== null && ctx.parentPid?.() !== parent) {
      throw new WatchEnd("error", "crew watch: the process that started it ended; this watch ends");
    }
    if (ctx.outputClosed?.() === true) {
      throw new WatchEnd("error", "crew watch: nobody reads its output any more; this watch ends");
    }
    const kept = await keepWatchLease(ctx.paths.stateDir, repo, leadSessionId, lease);
    if (!kept.held) {
      throw new WatchEnd(
        "print",
        `crew watch: a newer watch of this lead runs (pid ${kept.holder.pid}); this one ends`,
      );
    }
  };
  try {
    return await watchLoop(args, ctx, {
      base: watchBase(read.caller, ctx),
      goesOn,
      leadSessionId,
      mergeInto,
      repo,
      resolved,
    });
  } catch (error) {
    // The one way a watch ends by itself: it says why once, and ends well.
    if (!(error instanceof WatchEnd)) throw error;
    (error.stream === "print" ? ctx.print : ctx.error)(error.line);
    return 0;
  }
}

/**
 * The watch's passes, one every `WATCH_POLL_MS`, each after `scope.goesOn` said this watch may
 * still act, and its state written only while it holds the lease. `--once` ends on the first pass
 * with news, `--timeout` on its deadline.
 */
async function watchLoop(
  args: WatchArgs,
  ctx: CrewContext,
  start: WatchScope & { goesOn: () => Promise<void> },
): Promise<number> {
  const { goesOn, leadSessionId, repo, resolved } = start;
  const known = readWatchState(ctx.paths.stateDir, repo, leadSessionId);
  // A watch with no mark yet reads the log from its start: no event is lost. The mark is written
  // when the lead records itself (`crew lead`), so the lines after it are this lead's.
  let state: WatchState = known ?? { noted: false, offset: 0, said: {} };
  // **The workflow is read again at each pass.** Reading it once, before this loop, meant a cap
  // a person changes while a lead's watch runs never reached it: on 2026-10-23 the owner set
  // `crew.max 16` (the CPU was 5x overloaded) and every lead's watch went on starting queued
  // phases up to the old 24. `readCaller` is the reader the start itself uses, so the project's
  // file, the person's `workflow.json` and the schema are all read again — once a pass, cheap
  // against the agent view a pass already runs. A read that fails in one pass says so once, keeps
  // the last good value for that pass's read-only decisions, and starts nothing (see below).
  let caps = resolved;
  let capsSaid = false;
  const deadline =
    args.once && args.timeoutSeconds !== null ? ctx.now() + args.timeoutSeconds * 1000 : null;
  for (;;) {
    // Before it acts: a watch that may not act any more ends here (`WatchEnd`).
    await goesOn();
    const reread = readCaller("watch", ctx, { session: "optional" });
    let mayStart = true;
    if (reread.ok) {
      caps = reread.caller.resolved;
      capsSaid = false;
    } else {
      // The last good caps stand for this pass's read-only decisions (the quiet and idle
      // thresholds), and **no crew session starts on them**: `readCaller` refuses the same way
      // for a file it cannot use and for the person's own switch (`crew.enabled` off, a session
      // in bypass), and neither is a reason to start a session on a cap nobody could read.
      mayStart = false;
      if (!capsSaid) {
        for (const line of reread.lines) ctx.error(line);
        capsSaid = true;
      }
    }
    const scope: WatchScope = { ...start, mayStart, resolved: caps };
    let pass: { lines: number; state: WatchState };
    try {
      pass = await watchPass(state, ctx, scope);
    } catch (error) {
      if (error instanceof WatchEnd) throw error;
      ctx.error(`crew watch: ${reasonOf(error)}`);
      return 1;
    }
    state = pass.state;
    // Only the lease holder writes the state: a watch that lost the lease while this pass ran
    // leaves it to the newer one, which goes on from what it read.
    await goesOn();
    writeWatchState(ctx.paths.stateDir, repo, leadSessionId, state);
    // `--once` ends on the next change: the lead runs it in the background, and its end
    // starts the lead's next turn. A pass with nothing to say waits for the next one — a
    // watch that ended at once would wake the lead with no news, over and over.
    if (args.once && pass.lines > 0) return 0;
    if (deadline !== null && ctx.now() >= deadline) return 0;
    await ctx.sleep(WATCH_POLL_MS);
  }
}
