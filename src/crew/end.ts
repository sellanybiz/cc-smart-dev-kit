/**
 * The end of a crew session: what `stop`, `resume` and `rm` (`remove.ts`) share, and `stop` and
 * `resume` themselves (D35).
 *
 * **The store is the truth about who is a crew session.** Only a session the store records is ever
 * stopped, removed or respawned here — never a person's own session. Each command finds the
 * crew session by its name, its id, its short id or its session id, in this repository's store only,
 * and a crew session's own session never runs them: a crew session never stops, removes or resumes crew sessions.
 *
 * - **stop** runs `claude stop <short id>`: the conversation is kept on disk (to attach, or to
 *   `--resume`), and a crew session that was running is marked `stopped`. A crew session that already ended
 *   with an outcome (`done`, `failed`, `handoff`, `merged`) keeps it: the outcome is the fact a
 *   phase that waits for it reads, and stopping its process changes none of it. A stop that fails
 *   leaves the crew session as it was — unless Claude Code does not know the session any more, which
 *   counts as stopped: the goal is met, and the line says so.
 * - **resume** runs `claude respawn <short id>` for that ONE session — never `--all`, which would
 *   restart every background session on the machine — **from the crew session's own worktree**
 *   (`resumePlace`): a `--bg -w` session respawned from the main checkout comes back there, and
 *   its own start check marks it failed (the bug of 2026-10-23). The store says `working` again.
 *   `crew resume --paused` does the same for every paused crew session of a lead at once, the
 *   person's way out after `/login` on another account (D42). A record whose worktree is gone is
 *   refused with one line: there is nowhere to bring it back.
 */
import { existsSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { isInside, runGit } from "../hooks/git";
import { claudeDeps } from "./agents";
import { resumePlace } from "./answer";
import { findCrew, isRefusal, type Records, type Refusal, readRecords } from "./board";
import { REPORT_COMMAND } from "./brief";
import { agentRow, callClaude, findClaude, parseAgents } from "./claude";
import type { CrewContext } from "./context";
import { lastLine } from "./display";
import { RUNNING_STATES } from "./places";
import { callingSession, crewIdOf } from "./session";
import { type CrewRecord, type LeadRecord, listLeads, readLead, updateCrew } from "./store";
import { pauseStartedAt } from "./wait";
import { leadOf } from "./watch";

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
function crewSessionRefusal(command: string, ctx: CrewContext): null | Refusal {
  // The person through the portal is not a crew session, whatever started the portal (D52).
  if (ctx.asPerson === true) return null;
  const crew = crewIdOf(ctx.env);
  if (crew === null) return null;
  return failure(
    `crew ${command}: this session is the crew session ${crew}, and a crew session never stops, removes or resumes crew sessions`,
    `Fix: hand the need to your lead: ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>"`,
  );
}

/** The crew session `ref` names in this repository, for a command that acts on it; or the refusal. */
export function actOn(
  ref: string,
  command: string,
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
  // That ONE session, from its own worktree — never `--all`, which would restart every
  // background session on the machine, and never from the main checkout, where a `--bg -w`
  // session that is respawned there comes back (the bug of 2026-10-23).
  const place = resumePlace(record);
  if (!place.ok) {
    return refuse(
      failure(`crew resume: ${place.why}; remove it (${COMMAND} crew rm "${record.name}")`),
      ctx,
    );
  }
  const respawn = claudeFailure(ctx, place.folder, ["respawn", id]);
  if (respawn !== null) {
    return refuse(
      failure(
        `crew resume: ${respawn}`,
        `Fix: claude respawn ${id} by hand, or ${COMMAND} crew list to see it`,
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
 * switched accounts with `/login` and does not wait for the watch; `claude respawn` gives each
 * session a fresh process, which is what reads the new login. Each record goes `working` with
 * its wait cleared. One that cannot be respawned is named and the others still go; the exit
 * code is 1 when one failed.
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
  let code = 0;
  for (const record of paused) {
    const id = record.shortId;
    if (id === null) {
      ctx.error(`crew resume: ${record.name} has no session to respawn`);
      code = 1;
      continue;
    }
    // Each in its own worktree, never in the main checkout (2026-10-23).
    const place = resumePlace(record);
    if (!place.ok) {
      ctx.error(`crew resume: ${place.why}; remove it (${COMMAND} crew rm "${record.name}")`);
      code = 1;
      continue;
    }
    const respawn = claudeFailure(ctx, place.folder, ["respawn", id]);
    if (respawn !== null) {
      ctx.error(`crew resume: ${record.name}: ${respawn}`);
      code = 1;
      continue;
    }
    try {
      await updateCrew(
        ctx.paths.stateDir,
        record.repo,
        record.id,
        { state: "working", waitingFor: undefined },
        ctx.now(),
        "resumed by the lead after a limit",
      );
    } catch (error) {
      ctx.error(`crew resume: the store could not record ${record.name}: ${reasonOf(error)}`);
      code = 1;
      continue;
    }
    ctx.print(`resumed ${record.name} (${id})`);
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
 * The branch the lead merges crew branches into (D24): the one checked out in the lead's own
 * folder (its record names it), else the ref the crew session was cut from. A reason when neither is
 * there — nothing is judged against a guess.
 */
export function leadRef(record: CrewRecord, ctx: CrewContext): LeadRef | { why: string } {
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
