/**
 * The end of a crew session: what `stop`, `resume` and `rm` (`remove.ts`) share, and `stop` and
 * `resume` themselves (D35).
 *
 * **The store is the truth about who is a crew session.** Only a session the store records is ever
 * stopped, removed or brought back here — never a person's own session. Each command finds the
 * crew session by its name, its id, its short id or its session id, in this repository's store only,
 * and a crew session's own session never runs them: a crew session never stops, removes or resumes crew sessions.
 *
 * - **stop** runs `claude stop <short id>`: the conversation is kept on disk (to attach, or to
 *   `--resume`), and a crew session that was running is marked `stopped`. A crew session that already ended
 *   with an outcome (`done`, `failed`, `handoff`, `merged`) keeps it: the outcome is the fact a
 *   phase that waits for it reads, and stopping its process changes none of it. A stop that fails
 *   leaves the crew session as it was — unless Claude Code does not know the session any more, which
 *   counts as stopped: the goal is met, and the line says so.
 * - **resume** brings that ONE session back with `claude --bg --resume <session id>` **in the
 *   crew session's own worktree**, with its own settings and MCP files (`resumeSession`,
 *   `answer.ts`) — never `--all`, which would restart every background session on the machine,
 *   and never `claude respawn`, which does not re-apply `-w` and brings a `--bg -w` session back
 *   in the main checkout, where its own start check marks it failed (the bug of 2026-10-23). A
 *   session that still has a process is not resumed: `--bg --resume` would start a copy beside
 *   it. `crew resume --paused` does the same for every paused crew session of a lead at once,
 *   the person's way out after `/login` on another account (D42), through the watch's own
 *   `resumeOne`. A record whose worktree or settings file is gone is refused with one line.
 */
import { existsSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { IGNORE_CASE, isInside, runGit } from "../hooks/git";
import {
  descendsFrom,
  programName,
  programsUsing,
  type RunningProgram,
  runningPrograms,
  startTimes,
} from "../worktrees/machine-facts";
import { type WorkOnRef, workOnRef } from "../worktrees/scan";
import { agentRows, claudeDeps, isLiveRow, rowOf } from "./agents";
import { resumePlace, resumeSession, sessionLiveness, UNREADABLE_VIEW_WHY } from "./answer";
import { findCrew, isRefusal, type Records, type Refusal, readRecords } from "./board";
import { CREW_NEVER_RUNS, REPORT_COMMAND } from "./brief";
import { agentRow, callClaude, findClaude, parseAgents } from "./claude";
import type { CrewContext } from "./context";
import { lastLine } from "./display";
import { RUNNING_STATES } from "./places";
import { callingSession, crewIdOf } from "./session";
import {
  type CrewRecord,
  type LeadRecord,
  listLeads,
  readCrewEvents,
  readLead,
  updateCrew,
} from "./store";
import { pauseStartedAt } from "./wait";
import { leadOf, resumeOne } from "./watch";

/** How long `claude stop` and `claude rm` may take: each returns at once. */
export const CLAUDE_END_TIMEOUT_MS = 30_000;

/** How long one git call of a removal may take: a `git status` in the worktree is the slow part. */
export const GIT_TIMEOUT_MS = 30_000;

/**
 * The start of the reason of the lock Claude Code takes on a worktree it started: `claude session
 * <name> (pid … start …)` (proved live, L1a.1). A lock with any other reason is a person's.
 */
export const CLAUDE_LOCK_PREFIX = "claude session ";

/** Why anything thrown happened, in one line. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Prints a refusal on stderr; its exit code. */
export function refuse(refusal: Refusal, ctx: CrewContext): number {
  for (const line of refusal.lines) ctx.error(line);
  return refusal.code;
}

/** A refusal of exit 1 with these lines. */
export function failure(...lines: string[]): Refusal {
  return { code: 1, lines };
}

/** A path as a person reads it from the repository: `.claude/worktrees/<name>`. */
export function relative(repo: string, path: string): string {
  return isInside(path, repo) ? path.slice(repo.replace(/\/+$/, "").length + 1) : path;
}

/** The refusal of a session that is a crew session's own: it never ends a crew session. */
function crewSessionRefusal(command: "resume" | "rm" | "stop", ctx: CrewContext): null | Refusal {
  const crew = crewIdOf(ctx.env);
  if (crew === null) return null;
  return failure(
    `crew ${command}: this session is the crew session ${crew}, and a crew session never ${CREW_NEVER_RUNS[command]}`,
    `Fix: hand the need to your lead: ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>"`,
  );
}

/** The crew session `ref` names in this repository, for a command that acts on it; or the refusal. */
export function actOn(
  ref: string,
  command: "resume" | "rm" | "stop",
  ctx: CrewContext,
): { read: Records; record: CrewRecord } | Refusal {
  const own = crewSessionRefusal(command, ctx);
  if (own !== null) return own;
  const read = readRecords(ctx, false, command);
  if (isRefusal(read)) return read;
  const found = findCrew(read.records, ref, command);
  return "refusal" in found ? found.refusal : { read, record: found.record };
}

/**
 * One `claude <args>` call in the crew session's repository: null when it exited 0, else the sentence
 * that says how it failed (`claude stop a1b2c3d4 failed (exit 1): no such session`).
 */
export function claudeFailure(ctx: CrewContext, repo: string, args: string[]): null | string {
  const command = `claude ${args.join(" ")}`;
  const binary = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (binary === null) return "claude is not on PATH, nor in ~/.local/bin";
  const call = callClaude(claudeDeps(ctx), binary, args, repo, CLAUDE_END_TIMEOUT_MS);
  if (!call.ok) return call.why;
  if (call.run.timedOut) return `${command} did not answer in time`;
  if (call.run.exitCode === 0) return null;
  const said = lastLine(`${call.run.stdout}\n${call.run.stderr}`);
  return `${command} failed (exit ${String(call.run.exitCode)})${said === "" ? "" : `: ${said}`}`;
}

/** True when agent view, read once, does not list the crew session's Claude session at all. */
export function sessionUnknown(ctx: CrewContext, record: CrewRecord): boolean {
  const binary = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (binary === null || record.shortId === null) return false;
  const listed = callClaude(
    claudeDeps(ctx),
    binary,
    ["agents", "--json", "--all"],
    record.repo,
    CLAUDE_END_TIMEOUT_MS,
  );
  if (!listed.ok || listed.run.exitCode !== 0) return false;
  const rows = parseAgents(listed.run.stdout);
  return rows !== null && agentRow(rows, record.shortId) === null;
}

/** Records `state` with `text` as the event; false (and a line on stderr) when the store cannot. */
export async function markState(
  record: CrewRecord,
  state: string,
  text: string,
  ctx: CrewContext,
): Promise<boolean> {
  try {
    await updateCrew(ctx.paths.stateDir, record.repo, record.id, { state }, ctx.now(), text);
    return true;
  } catch (error) {
    ctx.error(`crew: the store could not record ${record.name} as ${state}: ${reasonOf(error)}`);
    return false;
  }
}

/** What stopping a crew session's Claude session came to. */
export type Stopped =
  | { gone: boolean; ok: true; state: string; stored: boolean }
  | { ok: false; why: string };

/**
 * Stops the crew session's Claude session. A crew session that was running is marked `stopped`; one that ended with
 * an outcome keeps it. A stop Claude Code refuses for a session it no longer lists counts as done.
 */
export async function stopSession(record: CrewRecord, ctx: CrewContext): Promise<Stopped> {
  if (record.shortId === null) return { ok: false, why: `${record.name} has no session to stop` };
  const stop = claudeFailure(ctx, record.repo, ["stop", record.shortId]);
  const gone = stop !== null && sessionUnknown(ctx, record);
  if (stop !== null && !gone) return { ok: false, why: stop };
  const running = (RUNNING_STATES as readonly string[]).includes(record.state);
  const text = gone ? "its session was gone already" : "stopped by the lead";
  const stored = running ? await markState(record, "stopped", text, ctx) : true;
  return { gone, ok: true, state: running ? "stopped" : record.state, stored };
}

/** How long a leftover program gets to end on SIGTERM before SIGKILL. */
export const LEFTOVER_GRACE_MS = 3_000;

/** The words of the one line a removal says when it stops a finished session's leftovers. */
export const LEFTOVER_STOP_MARK = "stopped its own leftover programs";

/** What stopping a finished crew session's leftover programs came to. */
export interface LeftoversStopped {
  /** The line to say, or null when nothing was stopped. */
  line: null | string;
  /** The programs as they are after the stop: the verdict judges the worktree by them. */
  programs: "unknown" | RunningProgram[];
}

/** True while `pid` still has a process. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sends `signal` to `pid`; false when there is no such process (or it is not ours). */
function signal(pid: number, sig: NodeJS.Signals): boolean {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}

/**
 * The states whose event says the crew session's own session ended: a report that closes its
 * phase, or a stop. **Not `merged` or `removed`:** those are the lead's acts, and a program the
 * person started after the session ended must not look like the session's own.
 */
const SESSION_END_STATES: readonly string[] = ["done", "failed", "handoff", "stopped"];

/**
 * When the crew session's own session last ended: the newest `state` or `report` event of its own
 * whose state is one of `SESSION_END_STATES` (a session an answer brought back ends again, and
 * what it started in between is its own). The record's `updatedAt` stands in when the log has no
 * such event (a store that cannot be read, or a record written before the log). Null when
 * neither reads.
 */
export function sessionEndedAt(record: CrewRecord, ctx: CrewContext): null | number {
  try {
    let ended: null | number = null;
    for (const event of readCrewEvents(ctx.paths.stateDir, record.repo, 0).events) {
      if (event.crew !== record.id) continue;
      if (event.type !== "state" && event.type !== "report") continue;
      if (!SESSION_END_STATES.includes(event.state)) continue;
      const at = Date.parse(event.at);
      if (Number.isFinite(at) && (ended === null || at > ended)) ended = at;
    }
    if (ended !== null) return ended;
  } catch {
    // The log cannot be read: the record's own last change is the next best witness.
  }
  const at = Date.parse(record.updatedAt);
  return Number.isFinite(at) ? at : null;
}

/**
 * Stops the programs a finished crew session's own turn left running (D62): a `bun run check` or
 * its `sh` and `bash`, still working in the worktree after the turn ended. It stops only when
 * **every** program there belongs to the session:
 *
 * - the session's Claude process is gone or stopped (agent view, read the way `crew rm` reads
 *   it) — a live one starts its own children, and stopping them would break it;
 * - each program either descends from that session or started before its turn ended
 *   (`sessionEndedAt`).
 *
 * A program that does not belong — a dev server or a container the person started there — is
 * left alone, and the caller keeps refusing as before. SIGTERM first, `LEFTOVER_GRACE_MS`, then
 * SIGKILL for what is still there: one line says what was stopped. A test hands in the programs
 * (`ctx.scanFacts.programs`), and the pids are its own child processes, so no test signals a
 * process it did not start.
 */
export async function stopLeftoverProcesses(
  record: CrewRecord,
  ctx: CrewContext,
): Promise<LeftoversStopped> {
  const programs = ctx.scanFacts?.programs ?? runningPrograms();
  if (programs === "unknown") return { line: null, programs };
  const inside = programsUsing(programs, record.worktree, IGNORE_CASE, ctx.pid);
  if (inside.length === 0) return { line: null, programs };
  // A live session is not a finished one: its children are the work it is doing now.
  const rows = agentRows(ctx);
  if (rows === null) return { line: null, programs };
  const row = rowOf(rows, record);
  if (isLiveRow(row)) return { line: null, programs };
  const endedAt = sessionEndedAt(record, ctx);
  const sessionPid = row?.pid ?? null;
  // When each started: a test gives it; on the machine it is read for exactly these programs.
  const read = startTimes(
    inside.filter((one) => one.startedAt === undefined).map((one) => one.pid),
    ctx.now(),
  );
  const startedAt = (program: RunningProgram): number | undefined =>
    program.startedAt ?? read.get(program.pid);
  const theirs = inside.every((program) => {
    if (sessionPid !== null && descendsFrom(programs, program.pid, sessionPid)) return true;
    const started = startedAt(program);
    return started !== undefined && endedAt !== null && started <= endedAt;
  });
  if (!theirs) return { line: null, programs };
  const pids = [...new Set(inside.map((one) => one.pid))].filter((pid) => pid !== process.pid);
  const signalled = new Set(pids.filter((pid) => signal(pid, "SIGTERM")));
  if (signalled.size === 0) return { line: null, programs };
  await ctx.sleep(LEFTOVER_GRACE_MS);
  for (const pid of signalled) if (alive(pid)) signal(pid, "SIGKILL");
  const names = [...new Set(inside.map((one) => programName(one)))].sort();
  return {
    line: `${record.name}: ${LEFTOVER_STOP_MARK} (${names.join(", ")})`,
    programs: programs.filter((one) => !signalled.has(one.pid)),
  };
}

/** `crew stop <name|id>`; the exit code. */
export async function runCrewStop(ref: string, ctx: CrewContext): Promise<number> {
  const found = actOn(ref, "stop", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  if (record.state === "removed") {
    return refuse(failure(`crew stop: ${record.name} is removed; it has no session left`), ctx);
  }
  if (record.shortId === null) {
    return refuse(
      failure(
        `crew stop: ${record.name} has no session yet (it is ${record.state})`,
        `Fix: ${COMMAND} crew list shows when it starts`,
      ),
      ctx,
    );
  }
  const id = record.shortId;
  if (record.state === "stopped") {
    ctx.print(`${record.name} is stopped already; \`claude attach ${id}\` opens it again`);
    return 0;
  }
  const stopped = await stopSession(record, ctx);
  if (!stopped.ok) {
    return refuse(
      failure(
        `crew stop: ${stopped.why}`,
        `Fix: claude stop ${id} by hand, or ${COMMAND} crew list to see it`,
      ),
      ctx,
    );
  }
  const what = stopped.gone
    ? "its session was gone already"
    : `the conversation is kept, and \`claude attach ${id}\` opens it again`;
  const stays = stopped.state === "stopped" ? "" : `; it stays ${stopped.state}`;
  ctx.print(`stopped ${record.name} (${id}); ${what}${stays}`);
  return stopped.stored ? 0 : 1;
}

/** `crew resume <name|id>`; the exit code. */
export async function runCrewResume(ref: string, ctx: CrewContext): Promise<number> {
  const found = actOn(ref, "resume", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  if (record.state === "removed") {
    return refuse(
      failure(`crew resume: ${record.name} is removed; there is nothing to bring back`),
      ctx,
    );
  }
  if (record.state === "merged") {
    return refuse(
      failure(`crew resume: ${record.name} is merged; its work belongs to the lead's branch now`),
      ctx,
    );
  }
  if (record.shortId === null) {
    return refuse(
      failure(
        `crew resume: ${record.name} has no session yet (it is ${record.state})`,
        `Fix: ${COMMAND} crew list shows when it starts`,
      ),
      ctx,
    );
  }
  const id = record.shortId;
  // First the folder: a record with no worktree is refused before anything runs.
  const place = resumePlace(record);
  if (!place.ok) {
    return refuse(
      failure(`crew resume: ${place.why}; remove it (${COMMAND} crew rm "${record.name}")`),
      ctx,
    );
  }
  // A session that still has a process is not resumed: `--bg --resume` would start a copy
  // beside it (`claude --help`, proved live on 2.1.309). `crew resume` is for one that is gone —
  // after a stop, or after the machine restarted. A view that cannot be read refuses: it could be
  // either, and a copy is worse than a second try.
  const liveness = sessionLiveness(ctx, record);
  if (liveness === "live") {
    ctx.print(`${record.name} is running already (${id}); there is nothing to resume`);
    return 0;
  }
  if (liveness === "unknown") {
    return refuse(failure(`crew resume: ${record.name}: ${UNREADABLE_VIEW_WHY}`), ctx);
  }
  // That ONE session, in its own worktree, with its own settings and MCP files — never `--all`,
  // which would restart every background session on the machine, and never in the main checkout,
  // where `claude respawn` brings a `--bg -w` session back (the bug of 2026-10-23).
  const resumed = await resumeSession(ctx, record, null);
  if (!resumed.ok) {
    return refuse(
      failure(
        `crew resume: ${resumed.why}`,
        `Fix: ${COMMAND} crew status "${record.name}" shows its files; if it cannot come back, merge its branch and start the phase again`,
      ),
      ctx,
    );
  }
  const stored =
    record.state === "working"
      ? true
      : await markState(record, "working", "resumed by the lead", ctx);
  ctx.print(`resumed ${record.name} (${id})`);
  return stored ? 0 : 1;
}

/**
 * `crew resume --paused` (D42): every paused crew session of this lead at once. The person
 * switched accounts with `/login` and does not wait for the watch. Each goes back **the way the
 * watch brings one back** (`resumeOne`, one home): a message line for one whose session still has
 * a process — never a copy — and `--bg --resume` in its worktree, with its own settings and MCP
 * files, for one that has none. Each record goes `working` with its wait cleared. One that cannot
 * be resumed is named and the others still go; the exit code is 1 when one failed.
 */
export async function runCrewResumePaused(named: null | string, ctx: CrewContext): Promise<number> {
  const own = crewSessionRefusal("resume", ctx);
  if (own !== null) return refuse(own, ctx);
  const read = readRecords(ctx, false, "resume");
  if (isRefusal(read)) return refuse(read, ctx);
  const repo = read.repo ?? ctx.cwd;
  // The session that runs this command, found the way `crew lead` finds it: the nearest
  // ancestor with a Claude Code session record. No other check: this command only needs to know
  // whose crew sessions to resume, and it acts on the store's own records.
  let sessionId: null | string;
  try {
    sessionId =
      callingSession(ctx.paths.claudeConfigDir, ctx.pid, ctx.processes.parentOf)?.sessionId ?? null;
  } catch (error) {
    return refuse(failure(`crew resume: ${reasonOf(error)}`), ctx);
  }
  let leads: LeadRecord[];
  try {
    leads = listLeads(ctx.paths.stateDir, repo).records;
  } catch (error) {
    return refuse(failure(`crew resume: the store could not be read: ${reasonOf(error)}`), ctx);
  }
  const leadSessionId = leadOf(
    named,
    sessionId,
    leads.map((one) => one.sessionId),
  );
  if (leadSessionId === null) {
    return refuse(
      failure(
        `crew resume --paused: which lead's crew sessions? name one: crew resume --paused --lead <session>${
          leads.length === 0
            ? " (no lead is recorded in this repository)"
            : ` (the leads here: ${leads.map((one) => one.sessionId).join(", ")})`
        }`,
      ),
      ctx,
    );
  }
  const paused = read.records
    .filter((one) => one.leadSessionId === leadSessionId && one.state === "paused")
    .sort(
      (a, b) => pauseStartedAt(a) - pauseStartedAt(b) || a.createdAt.localeCompare(b.createdAt),
    );
  if (paused.length === 0) {
    ctx.print("no paused crew session of this lead");
    return 0;
  }
  const agents = agentRows(ctx);
  let code = 0;
  for (const record of paused) {
    if (record.shortId === null) {
      ctx.error(`crew resume: ${record.name} has no session to resume`);
      code = 1;
      continue;
    }
    // The watch's own way: a message for one whose session still has a process, a resume in its
    // worktree for one that has none (`resumeOne`). It prints the message line or why it could
    // not; a resume the store could not record is its line too, and the exit code says so.
    const one = await resumeOne(record, ctx, ctx.now(), agents, (line) => ctx.print(line));
    if (!one.ok || !one.stored) {
      code = 1;
      continue;
    }
    ctx.print(
      one.way === "message"
        ? `${record.name} is running (${record.shortId}): send the message above`
        : `resumed ${record.name} (${record.shortId})`,
    );
  }
  return code;
}

/** Where the lead merges: its folder, the branch checked out there, and the commit it is at. */
export interface LeadRef {
  folder: string;
  label: string;
  sha: string;
}

/**
 * The branch the crew session's work is merged into (D24): the ref it was cut from
 * (`record.baseRef`), else the branch checked out in the lead's own folder. A reason when neither
 * is there — nothing is judged against a guess.
 */
export function leadRef(record: CrewRecord, ctx: CrewContext): LeadRef | { why: string } {
  const base = runGit(
    record.repo,
    ["rev-parse", "--verify", "--quiet", `${record.baseRef}^{commit}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (base.ok) return { folder: record.repo, label: record.baseRef, sha: base.out };
  let lead: LeadRecord | null;
  try {
    lead = readLead(ctx.paths.stateDir, record.repo, record.leadSessionId);
  } catch (error) {
    return { why: reasonOf(error) };
  }
  if (lead !== null && existsSync(lead.cwd)) {
    const sha = runGit(
      lead.cwd,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      ctx.env,
      GIT_TIMEOUT_MS,
    );
    if (sha.ok) {
      const branch = runGit(
        lead.cwd,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        ctx.env,
        GIT_TIMEOUT_MS,
      );
      const label = branch.ok ? branch.out : `HEAD at ${sha.out.slice(0, 7)}`;
      return { folder: lead.cwd, label, sha: sha.out };
    }
  }
  return {
    why: `${record.leadName} has no folder here any more, and ${record.baseRef} is no commit: there is no branch to merge into`,
  };
}

/**
 * Is the work of `record`'s branch on the branch it was cut from (`record.baseRef`)?
 * One home for the merged check: the watch's merged mark and `crew rm` both use it. An ancestor, or
 * a merge that changes nothing (a squash merge). Anything git cannot say counts as not merged, and a
 * branch with no commit of its own is not merged either: its base is its tip.
 */
export function mergedIntoBase(record: CrewRecord, ctx: CrewContext): WorkOnRef {
  if (record.base === null) return "unknown";
  const tip = runGit(
    record.repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}^{commit}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!tip.ok || tip.out === "") return "unknown";
  if (tip.out === record.base.sha) return "missing";
  const base = leadRef(record, ctx);
  if ("why" in base) return "unknown";
  return workOnRef(record.repo, base.sha, tip.out, ctx.env);
}

/** How many commits `branch` has that the lead's ref does not; null when git cannot say. */
export function commitsNotOn(
  repo: string,
  lead: LeadRef,
  branch: string,
  env: CrewContext["env"],
): null | number {
  const count = runGit(
    repo,
    ["rev-list", "--count", `${lead.sha}..refs/heads/${branch}`],
    env,
    GIT_TIMEOUT_MS,
  );
  return count.ok && /^\d+$/.test(count.out) ? Number(count.out) : null;
}
