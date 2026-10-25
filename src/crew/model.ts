/**
 * `cc-smart-dev-kit crew model <name> [--model <model>] [--effort <effort>]`: the lead changes a
 * crew session's model or effort (MC1). A crew session's model and effort are set at `crew start`;
 * this is the one way to change them afterwards, and the record is what every reader (`crew list`,
 * the caps, the portal, every resume) reads — so the record changes with the session.
 *
 * **The values are judged the way `crew start` judges them** (`chooseLaunch`, `start.ts`): a `ui`
 * session never runs on an affordable model or below `high`, and anything the Agent guard would
 * refuse or ask about is refused. A model asked for alone runs at its kind's effort
 * (`changedLaunch`).
 *
 * **What happens depends on the session.**
 *
 * - **Running** (`working`, `blocked`, `quiet`): stopped (`stopSession`) when its process lives,
 *   then resumed with the new flags through the one resume path (`resumeSession`, `answer.ts`),
 *   with a prompt that says what changed and to go on. Claude Code's `--resume` takes `--model`
 *   and `--effort` for the next turn (proved live, `docs/claude-code-contract.md`), and the
 *   crew session's own `--settings` file pins neither.
 * - **Stopped or paused**: keeps its state and takes the values at its next resume — every
 *   resume reads the record (`resumeArgs`).
 * - **Queued**: its start reads the record, so the values are stored.
 *
 * **The caps.** A change that moves a session onto the opus tier is a new opus session for the
 * caps (`crew.perLeadOpus`, `crew.maxOpus`, the usage window — `placeFor`, the one rule). When
 * one holds, the change is queued with its reason on the record (`pendingLaunch`): the session
 * runs on as it is, and the lead's watch applies the change once the caps allow
 * (`applyPendingModels`). A change adds no place, so the total caps never hold it.
 *
 * The values are written to the record before the session is touched (under the places lock, so
 * a second change counts them): a resume that fails leaves them stored for the next one.
 */
import { COMMAND } from "../build-info/names";
import { isCrewKind } from "../models/launch-policy";
import type { ResolvedWorkflow } from "../workflow/resolve";
import { resumedAs, resumeSession, sessionLiveness, UNREADABLE_VIEW_WHY } from "./answer";
import { findCrew } from "./board";
import { readCaller, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { pendingDiscardWhy } from "./discard";
import { stopSession } from "./end";
import { OPUS_TIER, placeFor, placeInputOf, RUNNING_STATES, withPlacesLock } from "./places";
import { changedLaunch, chooseLaunch } from "./start";
import { type CrewRecord, listAllCrew, listCrew, readCrew, updateCrew } from "./store";
import { usageFacts } from "./usage-guard";

/** What `crew model` was asked, already checked to be well formed. */
export interface ModelArgs {
  /** The crew session's name, id or short id. */
  crew: string;
  effort: null | string;
  model: null | string;
}

/** The model of a record, as a launch records it. */
type RecordedModel = CrewRecord["model"];

/** The states in which a change cannot be made: the crew session ended its phase or is gone. */
const ENDED_STATES = ["done", "failed", "handoff", "merged"] as const;

/** The sessions whose process a change stops and resumes. */
const LIVE_STATES = ["working", "blocked", "quiet"] as const;

/** What a change came to: the line to print, and whether it worked. */
interface Changed {
  /** False: the change was asked for and could not be made as asked (the line goes to stderr). */
  ok: boolean;
  line: string;
}

/** `named effort`: how a line shows what a crew session runs on. */
function runsOn(model: string, effort: string): string {
  return `${model} ${effort}`;
}

/** The prompt a resumed crew session gets: what changed, and to go on. */
function changePrompt(
  from: { effort: string; model: string },
  to: { effort: string; model: string },
): string {
  const parts: string[] = [];
  if (from.model !== to.model) parts.push(`your model from ${from.model} to ${to.model}`);
  if (from.effort !== to.effort) parts.push(`your effort from ${from.effort} to ${to.effort}`);
  return `Your lead changed ${parts.join(" and ")}. Go on from where you stopped.`;
}

/**
 * The cap that holds a change, as a sentence; null when none does. Only a move onto the opus
 * tier is judged (a session already on it keeps its place, and one moving off it frees one), as
 * a new opus session would be: the session itself is left out of the count, and the total caps
 * are left out too — a change adds no place.
 */
function opusHold(
  all: readonly CrewRecord[],
  record: CrewRecord,
  to: RecordedModel,
  crew: ResolvedWorkflow["crew"],
  ctx: CrewContext,
): null | string {
  if (to.tier !== OPUS_TIER || record.model.tier === OPUS_TIER) return null;
  const input = placeInputOf(
    all.filter((one) => one.id !== record.id),
    record.leadSessionId,
    crew,
    usageFacts(ctx.paths, ctx.now()),
    { opus: true, unmet: [] },
  );
  const place = placeFor({
    ...input,
    max: Number.POSITIVE_INFINITY,
    perLead: Number.POSITIVE_INFINITY,
  });
  return place.start ? null : place.why;
}

/**
 * Makes the change `record` → (`to`, `effort`) as its state allows, or queues it when an opus cap
 * holds (`held`: the watch passes `retry` and gets null while the cap still holds). The caps are
 * read and the record written under the places lock, so two changes never both take the last
 * opus place.
 */
async function changeModel(
  record: CrewRecord,
  to: RecordedModel,
  effort: string,
  ctx: CrewContext,
  crew: ResolvedWorkflow["crew"],
  retry: boolean,
): Promise<Changed | null> {
  const from = runsOn(record.model.named, record.effort);
  const head = `${record.name}: ${from} → ${runsOn(to.named, effort)}`;
  // A running session is read before anything is written: a view that cannot be read says
  // nothing about its process, and the record must not name values the session does not run on.
  const running = (LIVE_STATES as readonly string[]).includes(record.state);
  const liveness = running ? sessionLiveness(ctx, record) : "dead";
  if (liveness === "unknown") {
    return { line: `${head} · ${UNREADABLE_VIEW_WHY}; nothing changed`, ok: false };
  }
  const decided = await withPlacesLock(ctx.paths.stateDir, async () => {
    // The watch's retry acts on a record it read a pass ago: a change asked for or dropped since
    // is the lead's newer word.
    if (retry) {
      const fresh = readCrew(ctx.paths.stateDir, record.repo, record.id);
      if (fresh?.pendingLaunch?.at !== record.pendingLaunch?.at) return "stale";
    }
    // A queued crew session is judged by its start, which reads the record.
    const why =
      record.state === "queued"
        ? null
        : opusHold(listAllCrew(ctx.paths.stateDir).records, record, to, crew, ctx);
    if (why !== null) {
      if (!retry) {
        await updateCrew(
          ctx.paths.stateDir,
          record.repo,
          record.id,
          {
            pendingLaunch: { at: new Date(ctx.now()).toISOString(), effort, model: to, why },
          },
          ctx.now(),
        );
      }
      return why;
    }
    await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { effort, model: to, pendingLaunch: undefined },
      ctx.now(),
    );
    return null;
  });
  if (decided === "stale") return null;
  if (decided !== null) {
    return retry ? null : { line: `${head} · queued (${decided})`, ok: true };
  }
  if (record.state === "queued") return { line: `${head} · stored for its start`, ok: true };
  if (!running) return { line: `${head} · stored for the next resume`, ok: true };
  return await moveSession(record, to, effort, head, liveness === "live", ctx);
}

/** Stops a running session (when its process lives) and resumes it on the values just stored. */
async function moveSession(
  record: CrewRecord,
  to: RecordedModel,
  effort: string,
  head: string,
  live: boolean,
  ctx: CrewContext,
): Promise<Changed> {
  const kept = `the new values are kept for the next resume (${COMMAND} crew resume "${record.name}")`;
  let state = record.state;
  if (live) {
    const stopped = await stopSession(record, ctx);
    if (!stopped.ok) {
      // Its process runs on as it was, so the record goes back to what it runs on.
      await updateCrew(
        ctx.paths.stateDir,
        record.repo,
        record.id,
        { effort: record.effort, model: record.model },
        ctx.now(),
      );
      return { line: `${head} · ${stopped.why}; nothing changed`, ok: false };
    }
    state = stopped.state;
  }
  const resumed = await resumeSession(
    ctx,
    { ...record, effort, model: to, state },
    changePrompt({ effort: record.effort, model: record.model.named }, { effort, model: to.named }),
  );
  if (!resumed.ok) return { line: `${head} · ${resumed.why}; ${kept}`, ok: false };
  const { session } = resumed;
  try {
    // The session the resume brought back comes with the state (WF1), as in `crew answer`.
    await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { sessionId: session.sessionId, shortId: session.shortId, state: "working" },
      ctx.now(),
      "resumed on a new model or effort by the lead",
    );
  } catch (error) {
    const as = resumedAs(record, session.shortId);
    return {
      line: `${head} · resumed${as}, but the store could not record the session: ${reasonOf(error)}`,
      ok: false,
    };
  }
  const as = resumedAs(record, session.shortId);
  return {
    line: `${head} · ${as === "" ? `resumed (${session.shortId})` : `resumed${as}`}`,
    ok: true,
  };
}

/** `crew model`; the exit code. */
export async function runCrewModel(args: ModelArgs, ctx: CrewContext): Promise<number> {
  const read = readCaller("model", ctx);
  if (!read.ok) {
    for (const line of read.lines) ctx.error(line);
    return 1;
  }
  const { repo, resolved } = read.caller;
  let records: CrewRecord[];
  try {
    records = listCrew(ctx.paths.stateDir, repo).records;
  } catch (error) {
    ctx.error(`crew model: the store could not be read: ${reasonOf(error)}`);
    return 1;
  }
  const found = findCrew(records, args.crew, "model");
  if ("refusal" in found) {
    for (const line of found.refusal.lines) ctx.error(line);
    return 1;
  }
  const { record } = found;
  const pending = pendingDiscardWhy(record);
  if (pending !== null) {
    ctx.error(`crew model: ${pending}`);
    return 1;
  }
  if (["removed", "discarded"].includes(record.state)) {
    ctx.error(`crew model: ${record.name} is ${record.state}; it has no session left`);
    return 1;
  }
  if ((ENDED_STATES as readonly string[]).includes(record.state)) {
    ctx.error(
      `crew model: ${record.name} is ${record.state}; it ended its phase, so there is nothing to change`,
    );
    return 1;
  }
  if (record.state === "starting") {
    ctx.error(`crew model: ${record.name} is starting; try again when it is working`);
    return 1;
  }
  if (!isCrewKind(record.kind)) {
    ctx.error(`crew model: ${record.name} has a kind this kit does not know (${record.kind})`);
    return 1;
  }
  const chosen = chooseLaunch(
    record.kind,
    changedLaunch({ effort: record.effort, model: record.model.named }, args),
    ctx,
  );
  if ("refusal" in chosen) {
    ctx.error(`crew model: ${chosen.refusal}`);
    return 2;
  }
  const to: RecordedModel = {
    named: chosen.model,
    resolved: chosen.real.model,
    slot: chosen.slot,
    tier: chosen.real.tier,
  };
  if (to.named === record.model.named && chosen.effort === record.effort) {
    // Asking for what it runs on drops a change that waited for a cap.
    if (record.pendingLaunch !== undefined) {
      await updateCrew(
        ctx.paths.stateDir,
        record.repo,
        record.id,
        { pendingLaunch: undefined },
        ctx.now(),
      );
    }
    ctx.print(`${record.name}: already ${runsOn(to.named, chosen.effort)} · nothing changed`);
    return 0;
  }
  let changed: Changed | null;
  try {
    changed = await changeModel(record, to, chosen.effort, ctx, resolved.crew, false);
  } catch (error) {
    ctx.error(`crew model: ${reasonOf(error)}`);
    return 1;
  }
  if (changed === null) return 1;
  if (changed.ok) {
    ctx.print(changed.line);
    return 0;
  }
  ctx.error(`crew model: ${changed.line}`);
  return 1;
}

/**
 * The changes the caps held back, applied once they allow (the lead's watch, each pass). Each
 * record with a `pendingLaunch` is judged again; one still held stays as it is and says nothing.
 * `say` gets the line of each change made, or the reason one failed. The records are the lead's
 * own, and the caller holds the watch's lease (`WatchScope.goesOn`).
 */
export async function applyPendingModels(
  records: readonly CrewRecord[],
  ctx: CrewContext,
  resolved: ResolvedWorkflow,
  say: (line: string) => void,
): Promise<void> {
  for (const record of records) {
    const wanted = record.pendingLaunch;
    const open =
      (RUNNING_STATES as readonly string[]).includes(record.state) || record.state === "stopped";
    if (wanted === undefined || !open || record.state === "starting") continue;
    try {
      const changed = await changeModel(
        record,
        wanted.model,
        wanted.effort,
        ctx,
        resolved.crew,
        true,
      );
      if (changed !== null) say(changed.ok ? changed.line : `${changed.line} — not changed`);
    } catch (error) {
      say(`${record.name}: its queued model change failed: ${reasonOf(error)}`);
    }
  }
}
