/**
 * The end of a worker: what `stop`, `resume` and `rm` (`remove.ts`) share, and `stop` and
 * `resume` themselves (D35).
 *
 * **The store is the truth about who is a worker.** Only a session the store records is ever
 * stopped, removed or respawned here — never a person's own session. Each command finds the
 * worker by its name, its id, its short id or its session id, in this repository's store only,
 * and a worker's own session never runs them: a worker never stops, removes or resumes workers.
 *
 * - **stop** runs `claude stop <short id>`: the conversation is kept on disk (to attach, or to
 *   `--resume`), and a worker that was running is marked `stopped`. A worker that already ended
 *   with an outcome (`done`, `failed`, `handoff`, `merged`) keeps it: the outcome is the fact a
 *   phase that waits for it reads, and stopping its process changes none of it. A stop that fails
 *   leaves the worker as it was — unless Claude Code does not know the session any more, which
 *   counts as stopped: the goal is met, and the line says so.
 * - **resume** runs `claude respawn <short id>` for that ONE session — never `--all`, which would
 *   restart every background session on the machine — and the store says `working` again.
 */
import { existsSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { isInside, runGit } from "../hooks/git";
import { claudeDeps } from "./agents";
import { findWorker, isRefusal, type Records, type Refusal, readRecords } from "./board";
import { REPORT_COMMAND } from "./brief";
import { agentRow, callClaude, findClaude, parseAgents } from "./claude";
import type { WorkerContext } from "./context";
import { lastLine } from "./display";
import { RUNNING_STATES } from "./places";
import { workerIdOf } from "./session";
import { type LeadRecord, readLead, updateWorker, type WorkerRecord } from "./store";

/** How long `claude stop`, `claude rm` and `claude respawn` may take: each returns at once. */
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
export function refuse(refusal: Refusal, ctx: WorkerContext): number {
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

/** The refusal of a session that is a worker's own: it never ends a worker. */
function workerSessionRefusal(command: string, ctx: WorkerContext): null | Refusal {
  const worker = workerIdOf(ctx.env);
  if (worker === null) return null;
  return failure(
    `worker ${command}: this session is the worker ${worker}, and a worker never stops, removes or resumes workers`,
    `Fix: hand the need to your lead: ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>"`,
  );
}

/** The worker `ref` names in this repository, for a command that acts on it; or the refusal. */
export function actOn(
  ref: string,
  command: string,
  ctx: WorkerContext,
): { read: Records; record: WorkerRecord } | Refusal {
  const own = workerSessionRefusal(command, ctx);
  if (own !== null) return own;
  const read = readRecords(ctx, false, command);
  if (isRefusal(read)) return read;
  const found = findWorker(read.records, ref, command);
  return "refusal" in found ? found.refusal : { read, record: found.record };
}

/**
 * One `claude <args>` call in the worker's repository: null when it exited 0, else the sentence
 * that says how it failed (`claude stop a1b2c3d4 failed (exit 1): no such session`).
 */
export function claudeFailure(ctx: WorkerContext, repo: string, args: string[]): null | string {
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

/** True when agent view, read once, does not list the worker's session at all. */
export function sessionUnknown(ctx: WorkerContext, record: WorkerRecord): boolean {
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
  record: WorkerRecord,
  state: string,
  text: string,
  ctx: WorkerContext,
): Promise<boolean> {
  try {
    await updateWorker(ctx.paths.stateDir, record.repo, record.id, { state }, ctx.now(), text);
    return true;
  } catch (error) {
    ctx.error(`worker: the store could not record ${record.name} as ${state}: ${reasonOf(error)}`);
    return false;
  }
}

/** What stopping a worker's session came to. */
export type Stopped =
  | { gone: boolean; ok: true; state: string; stored: boolean }
  | { ok: false; why: string };

/**
 * Stops the worker's session. A worker that was running is marked `stopped`; one that ended with
 * an outcome keeps it. A stop Claude Code refuses for a session it no longer lists counts as done.
 */
export async function stopSession(record: WorkerRecord, ctx: WorkerContext): Promise<Stopped> {
  if (record.shortId === null) return { ok: false, why: `${record.name} has no session to stop` };
  const stop = claudeFailure(ctx, record.repo, ["stop", record.shortId]);
  const gone = stop !== null && sessionUnknown(ctx, record);
  if (stop !== null && !gone) return { ok: false, why: stop };
  const running = (RUNNING_STATES as readonly string[]).includes(record.state);
  const text = gone ? "its session was gone already" : "stopped by the lead";
  const stored = running ? await markState(record, "stopped", text, ctx) : true;
  return { gone, ok: true, state: running ? "stopped" : record.state, stored };
}

/** `worker stop <name|id>`; the exit code. */
export async function runWorkerStop(ref: string, ctx: WorkerContext): Promise<number> {
  const found = actOn(ref, "stop", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  if (record.state === "removed") {
    return refuse(failure(`worker stop: ${record.name} is removed; it has no session left`), ctx);
  }
  if (record.shortId === null) {
    return refuse(
      failure(
        `worker stop: ${record.name} has no session yet (it is ${record.state})`,
        `Fix: ${COMMAND} worker list shows when it starts`,
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
        `worker stop: ${stopped.why}`,
        `Fix: claude stop ${id} by hand, or ${COMMAND} worker list to see it`,
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

/** `worker resume <name|id>`; the exit code. */
export async function runWorkerResume(ref: string, ctx: WorkerContext): Promise<number> {
  const found = actOn(ref, "resume", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  if (record.state === "removed") {
    return refuse(
      failure(`worker resume: ${record.name} is removed; there is nothing to bring back`),
      ctx,
    );
  }
  if (record.state === "merged") {
    return refuse(
      failure(`worker resume: ${record.name} is merged; its work belongs to the lead's branch now`),
      ctx,
    );
  }
  if (record.shortId === null) {
    return refuse(
      failure(
        `worker resume: ${record.name} has no session yet (it is ${record.state})`,
        `Fix: ${COMMAND} worker list shows when it starts`,
      ),
      ctx,
    );
  }
  const id = record.shortId;
  // That ONE session: `--all` would restart every background session on the machine.
  const respawn = claudeFailure(ctx, record.repo, ["respawn", id]);
  if (respawn !== null) {
    return refuse(
      failure(
        `worker resume: ${respawn}`,
        `Fix: claude respawn ${id} by hand, or ${COMMAND} worker list to see it`,
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

/** Where the lead merges: its folder, the branch checked out there, and the commit it is at. */
export interface LeadRef {
  folder: string;
  label: string;
  sha: string;
}

/**
 * The branch the lead merges worker branches into (D24): the one checked out in the lead's own
 * folder (its record names it), else the ref the worker was cut from. A reason when neither is
 * there — nothing is judged against a guess.
 */
export function leadRef(record: WorkerRecord, ctx: WorkerContext): LeadRef | { why: string } {
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
  const base = runGit(
    record.repo,
    ["rev-parse", "--verify", "--quiet", `${record.baseRef}^{commit}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (base.ok) return { folder: record.repo, label: record.baseRef, sha: base.out };
  return {
    why: `${record.leadName} has no folder here any more, and ${record.baseRef} is no commit: there is no branch to merge into`,
  };
}

/** How many commits `branch` has that the lead's ref does not; null when git cannot say. */
export function commitsNotOn(
  repo: string,
  lead: LeadRef,
  branch: string,
  env: WorkerContext["env"],
): null | number {
  const count = runGit(
    repo,
    ["rev-list", "--count", `${lead.sha}..refs/heads/${branch}`],
    env,
    GIT_TIMEOUT_MS,
  );
  return count.ok && /^\d+$/.test(count.out) ? Number(count.out) : null;
}
