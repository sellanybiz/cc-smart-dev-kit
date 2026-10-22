/**
 * `cc-smart-dev-kit worker watch [--lead <session>] [--once] [--timeout <seconds>]`: the lead's
 * window on its workers.
 *
 * **One line per change, and nothing else** (D25: the lead never waits, never polls, never asks
 * "done?"). Two readers feed it:
 *
 * - **the store's events log** (`events.jsonl`), read from the byte after the last whole line the
 *   last pass read — the store's own reader (`readWorkerEvents`). A step, a report, a question and
 *   a state change are each one line, and **every change of state is said from its event and from
 *   nowhere else**: the watch's own acts write events too, so a change it makes is said once, in
 *   the same pass, and never twice.
 * - **agent view** (`claude agents --json --all`), read on every pass: what the sessions are doing
 *   now. It raises three alerts, each said once while it lasts, and none of them an action: a
 *   worker that waits on a permission prompt or an input ("needs you"), one whose transcript has
 *   not moved for `workflow.workers.quietMinutes` ("quiet"), and one whose turn ended with no
 *   report. It also keeps the store true: a session that failed is `failed`, one that was stopped
 *   by hand is `stopped` — a worker that is neither running nor reported must not hold a place
 *   (`RUNNING_STATES`) and keep a queued worker waiting for ever.
 *
 * **The watch also acts** (D35: a worker never outlives its work), and only on workers the store
 * records — a session the kit does not know is the person's own:
 *
 * - it starts the **queued** workers of this lead when a place frees — through the launcher's own
 *   path (`startQueued`), never a second launcher;
 * - it **ends** a worker whose turn ended with a `done` or a `failed` report (`claude stop <id>`;
 *   the conversation stays), and a `blocked` one that has idled past
 *   `workflow.workers.idleStopMinutes`;
 * - it marks a worker **merged** when the lead merged its branch. The removal is `worker rm`'s
 *   work (W1c), and the line says so.
 *
 * `--once` ends on the next change: where the plugin's monitors do not run, the lead runs it in
 * the background and its end starts the lead's next turn.
 */
import { runGit } from "../hooks/git";
import type { ResolvedWorkflow } from "../workflow/resolve";
import { reviewsFile, reviewsOn } from "../workflow/reviews";
import { workOnRef } from "../worktrees/scan";
import { agentRows, claudeDeps, rowOf } from "./agents";
import { readCaller, reasonOf } from "./caller";
import { type AgentRow, callClaude, findClaude } from "./claude";
import type { WorkerContext } from "./context";
import { memoryMbOf } from "./memory";
import { runningWorkers } from "./places";
import { startQueued } from "./start";
import {
  listLeads,
  listWorkers,
  readReport,
  readWatchState,
  readWorkerEvents,
  setWorkerMemory,
  updateWorker,
  type WatchState,
  type WorkerEvent,
  type WorkerRecord,
  writeWatchState,
} from "./store";
import { monitorsRunHere } from "./telemetry";
import { changedAt, transcriptFile } from "./transcript";

/** How often the watch reads agent view. */
export const WATCH_POLL_MS = 20_000;

/**
 * The states a worker's work is over in: the watch looks at the lead's merge for each of them,
 * because the merge can come after the worker was stopped.
 */
const OVER_STATES: readonly string[] = ["done", "failed", "handoff", "stopped"];

/** How long one git call may take (a `rev-parse`, a `merge-base`). */
const GIT_TIMEOUT_MS = 15_000;

/** The longest piece of a worker's own words a line carries. */
const CLIP_CHARS = 120;

/** What `worker watch` was asked, already checked to be well formed. */
export interface WatchArgs {
  /** The lead session whose workers are watched; null when the calling session's. */
  lead: null | string;
  /** Ends on the next change; false when the watch runs for the session. */
  once: boolean;
  /** How long `--once` waits for something to say, in seconds; null when it waits for ever. */
  timeoutSeconds: null | number;
}

/** A worker's own words, on one line and no longer than a line should be. */
function clip(text: string): string {
  const one = (text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim();
  return one.length <= CLIP_CHARS ? one : `${one.slice(0, CLIP_CHARS - 1)}…`;
}

/**
 * What a blocked or failed worker's report says about why, in a few words; null for any other
 * report, or one that cannot be read (the line then says the status alone).
 */
function reportDetail(record: null | WorkerRecord): null | string {
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
  event: WorkerEvent,
  record: null | WorkerRecord,
  waits: readonly string[],
  reviewed: boolean,
): null | string {
  const name = event.name;
  switch (event.type) {
    case "state": {
      if (event.state === "starting") return null;
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
      return `${name}: question · ${clip(event.text ?? "")} · answer it: worker answer "${name}" "<text>"`;
    default:
      return null;
  }
}

/**
 * The phases that wait for the phase of `record`: the phases the other workers of this lead
 * wait for. A worker whose report ends its phase unblocks them once the lead merges its branch.
 */
export function phasesWaitingFor(record: WorkerRecord, records: readonly WorkerRecord[]): string[] {
  const phases = new Set<string>();
  for (const one of records) {
    if (one.id === record.id) continue;
    if (one.waitsFor.includes(record.phase)) phases.add(one.phase);
  }
  return [...phases].sort();
}

/** True when `record` holds a place: its session lives and its phase is open. */
function isRunning(record: WorkerRecord): boolean {
  return runningWorkers([record]).length === 1;
}

/**
 * The alert for a running worker, from agent view; null when there is nothing to say. Each is
 * said once while it lasts, and none is an action:
 *
 * - it **needs the person**: agent view says it waits on a permission prompt or an input;
 * - it **ended its turn with no report**: its session is done, but its record is still at work;
 * - it is **quiet**: agent view says working, but its transcript has not been written for
 *   `quietMinutes`.
 */
export function workerAlert(
  record: WorkerRecord,
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
  if (row.state === "working" && record.sessionId !== null) {
    const last = changedAt(transcriptFile(projectsDir, record.worktree, record.sessionId));
    if (last !== null && now - last > quietMinutes * 60_000) {
      return `${record.name}: quiet — nothing written for ${Math.round((now - last) / 60_000)} minutes`;
    }
  }
  return null;
}

/**
 * True when the lead merged the branch of `record`: the branch holds a commit of its own, and
 * its work is on the commit `mergeInto` (the lead's folder) is on — `workOnRef`, the answer
 * `worker rm` gives too: its tip is an ancestor (a merge commit), or merging it changes nothing
 * (a squash merge). When git cannot say, the branch is not reported merged.
 *
 * A branch with no commit of its own — a worker that failed or was stopped before it committed —
 * has its base as its tip, and the base is an ancestor of the lead's branch for that reason alone:
 * it was never merged, and is not reported as merged.
 */
export function branchMerged(record: WorkerRecord, mergeInto: string, ctx: WorkerContext): boolean {
  if (record.base === null) return false;
  const tip = runGit(
    mergeInto,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!tip.ok || tip.out === "" || tip.out === record.base.sha) return false;
  const found = workOnRef(mergeInto, "HEAD", tip.out, ctx.env);
  return found === "ancestor" || found === "replay";
}

/** What one pass of the watch works over. */
export interface WatchScope {
  /** The lead session whose workers are watched. */
  leadSessionId: string;
  /** The folder the lead merges in: its own, else the repository's main checkout. */
  mergeInto: string;
  repo: string;
  resolved: ResolvedWorkflow;
}

/**
 * Stops the session of `record` (`claude stop`; the conversation stays on disk, so the worker can
 * be read, and resumed by an answer) and records the state it ends in with `reason`. Null when
 * done; else why not, for an alert.
 */
async function stopWorker(
  record: WorkerRecord,
  state: "merged" | "stopped",
  reason: string,
  ctx: WorkerContext,
  row: null | AgentRow,
): Promise<null | string> {
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  const shortId = record.shortId;
  if (claude === null) return `${record.name}: not stopped — claude is not on PATH`;
  if (shortId === null) return `${record.name}: not stopped — it has no session id`;
  const called = callClaude(claudeDeps(ctx), claude, ["stop", shortId], ctx.cwd);
  if (!called.ok || called.run.exitCode !== 0) {
    return `${record.name}: not stopped — claude stop ${shortId} failed`;
  }
  await updateWorker(
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
 * Reads the log from `from`, says each line that is news for this lead's workers, and gives the
 * byte to go on from. The records are read after the events, so a record is at least as new as
 * the event that names it (a report's file is there when its line is said).
 */
function sayEvents(
  from: number,
  scope: WatchScope,
  ctx: WorkerContext,
  say: (line: string) => void,
): number {
  const read = readWorkerEvents(ctx.paths.stateDir, scope.repo, from);
  if (read.events.length === 0) return read.offset;
  const mine = listWorkers(ctx.paths.stateDir, scope.repo).records.filter(
    (one) => one.leadSessionId === scope.leadSessionId,
  );
  const reviewFile = reviewsFile(ctx.paths.stateDir, scope.repo);
  for (const event of read.events) {
    if (event.lead !== scope.leadSessionId) continue;
    const record = mine.find((one) => one.id === event.worker) ?? null;
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

/** One pass of the watch: what changed, what is started, what is ended. */
export async function watchPass(
  state: WatchState,
  ctx: WorkerContext,
  scope: WatchScope,
): Promise<{ lines: number; state: WatchState }> {
  const { repo, resolved } = scope;
  const said = { ...state.said };
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
  const mine = listWorkers(ctx.paths.stateDir, repo).records.filter(
    (one) => one.leadSessionId === scope.leadSessionId,
  );
  for (const record of mine) {
    const row = agents === null ? null : rowOf(agents, record);
    const alert = workerAlert(
      record,
      row,
      ctx.now(),
      resolved.workers.quietMinutes.value,
      ctx.paths.projectsDir,
    );
    if (alert !== null && said[record.id] !== alert) {
      say(alert);
      said[record.id] = alert;
    } else if (alert === null) {
      delete said[record.id];
    }
    if (row === null || !isRunning(record)) continue;
    // The store stays true, so a worker that is gone does not hold a place. Each change is a
    // state event, said below.
    if (row.state === "failed") {
      await updateWorker(
        ctx.paths.stateDir,
        record.repo,
        record.id,
        { state: "failed" },
        ctx.now(),
        "its session failed",
        memoryMbOf(row.pid),
      );
    } else if (row.state === "stopped") {
      await updateWorker(
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
        await setWorkerMemory(ctx.paths.stateDir, record.repo, record.id, memory);
      }
    }
  }

  // Workers whose work is over: the lead's merge, the end of a session, a blocked worker that
  // idled. Only a worker the store records is ever stopped.
  for (const record of listWorkers(ctx.paths.stateDir, repo).records) {
    if (record.leadSessionId !== scope.leadSessionId) continue;
    const row = agents === null ? null : rowOf(agents, record);
    // Its session is in agent view and is neither stopped nor dead: it may still hold a process
    // (a session whose turn ended keeps one, D35). A session that crashed has nothing to stop.
    const listed = row !== null && row.state !== "stopped" && row.state !== "failed";
    const stopKey = `${record.id}:stop`;
    let refusal: null | string = null;
    if (OVER_STATES.includes(record.state) && branchMerged(record, scope.mergeInto, ctx)) {
      const reason = "the lead merged its branch; `worker rm` removes it";
      if (listed) {
        refusal = await stopWorker(record, "merged", reason, ctx, row);
      } else {
        await updateWorker(
          ctx.paths.stateDir,
          record.repo,
          record.id,
          { state: "merged" },
          ctx.now(),
          reason,
        );
      }
    } else if ((record.state === "done" || record.state === "failed") && listed) {
      refusal = await stopWorker(record, "stopped", "its turn ended", ctx, row);
    } else if (record.state === "blocked" && listed) {
      const idle = ctx.now() - Date.parse(record.updatedAt);
      if (Number.isFinite(idle) && idle > resolved.workers.idleStopMinutes.value * 60_000) {
        const minutes = Math.round(idle / 60_000);
        refusal = await stopWorker(
          record,
          "stopped",
          `it has been blocked for ${minutes} minutes; an answer brings it back`,
          ctx,
          row,
        );
      }
    }
    // A stop that fails is said once, not on every pass.
    if (refusal !== null && said[stopKey] !== refusal) {
      say(refusal);
      said[stopKey] = refusal;
    } else if (refusal === null) {
      delete said[stopKey];
    }
  }

  // Workers that wait for a place: start them, oldest first. Each start is state events.
  const queued = listWorkers(ctx.paths.stateDir, repo)
    .records.filter((one) => one.leadSessionId === scope.leadSessionId && one.state === "queued")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const record of queued) await startQueued(record, ctx, resolved);

  // What this pass itself wrote is said now, in the same pass — once.
  offset = sayEvents(offset, scope, ctx, say);
  return { lines, state: { noted, offset, said } };
}

/**
 * The lead whose workers are watched: `--lead` names one; else the session that runs the
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

/** `worker watch`; the exit code. */
export async function runWorkerWatch(args: WatchArgs, ctx: WorkerContext): Promise<number> {
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
      `worker watch: which lead's workers? name one with --lead <session>${
        leads.length === 0
          ? " (no lead is recorded in this repository)"
          : ` (the leads here: ${leads.map((one) => one.sessionId).join(", ")})`
      }`,
    );
    return 2;
  }
  // The lead merges in its own folder; where that is gone, in the main checkout.
  const mergeInto = leads.find((one) => one.sessionId === leadSessionId)?.cwd ?? repo;
  const scope: WatchScope = { leadSessionId, mergeInto, repo, resolved };
  const known = readWatchState(ctx.paths.stateDir, repo, leadSessionId);
  // A watch with no mark yet reads the log from its start: no event is lost. The mark is written
  // when the lead records itself (`worker lead`), so the lines after it are this lead's.
  let state: WatchState = known ?? { noted: false, offset: 0, said: {} };
  const deadline =
    args.once && args.timeoutSeconds !== null ? ctx.now() + args.timeoutSeconds * 1000 : null;
  for (;;) {
    let pass: { lines: number; state: WatchState };
    try {
      pass = await watchPass(state, ctx, scope);
    } catch (error) {
      ctx.error(`worker watch: ${reasonOf(error)}`);
      return 1;
    }
    state = pass.state;
    writeWatchState(ctx.paths.stateDir, repo, leadSessionId, state);
    // `--once` ends on the next change: the lead runs it in the background, and its end
    // starts the lead's next turn. A pass with nothing to say waits for the next one — a
    // watch that ended at once would wake the lead with no news, over and over.
    if (args.once && pass.lines > 0) return 0;
    if (deadline !== null && ctx.now() >= deadline) return 0;
    await ctx.sleep(WATCH_POLL_MS);
  }
}
