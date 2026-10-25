/**
 * `cc-smart-dev-kit crew self-watch`: the crew session's own line about its context and its time.
 *
 * The crew session's monitor runs this. It reads the crew session's own transcript tail and the time since
 * it started, and prints **one line** into the crew session's chat when the crew session should act:
 *
 * - at `workflow.crew.handoffPercent` (70 %) of its context: **hand off** — commit the work
 *   in progress and run `crew report --status handoff`, so the lead starts the next crew session
 *   from this head;
 * - at `workflow.crew.softHours` (2): a **note** — the phase is long: tell the lead where it
 *   stands (a `crew step` with a `--note`, which the lead's watch says), or hand off;
 * - at `workflow.crew.maxHours` (4): **hand off** again, now because the time is up.
 *
 * - **the lead's answer** to its question (AN1): the monitor looks every few seconds
 *   (`ANSWER_WATCH_POLL_MS`) and prints an answer that is on record and not yet delivered, as one
 *   line (`deliveryLine`), once. The line is a notification, which wakes an idle crew session, so a
 *   blocked one needs nobody to send it anything. The answer is marked delivered *before* the line
 *   is printed, under the store's lock (`markAnswerDelivered`): two monitors of one crew session
 *   (the original and a copy a resume started) never both print it. The monitor also writes a
 *   heartbeat, which `crew answer` reads to know the answer will arrive. It looks at the crew
 *   record only when its file changed (a stat, never a re-read each tick).
 *
 * **Nothing else is printed.** A crew session that is fine sees nothing. The line is repeated every
 * 15 minutes while it is ignored, so a crew session that missed it sees it again.
 *
 * **The window.** The model that wrote the last reply decides it (`context-window.ts`): Claude
 * Code's own number when the status line recorded one for that model, the kit's table
 * otherwise, and a backend's own model list for a bare backend model. A model whose window the
 * kit cannot know has no window, and so no context line — the time lines still apply.
 */
import { statSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import { deliveryLine } from "./answer";
import { readCrewSelf, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { windowWatch } from "./context-window";
import { runningCrew } from "./places";
import {
  ANSWER_BEAT_EVERY_MS,
  ANSWER_WATCH_POLL_MS,
  type CrewRecord,
  crewFile,
  markAnswerDelivered,
  readCrew,
  readSelfWatchState,
  undeliveredAnswerIndex,
  writeAnswerWatchBeat,
  writeSelfWatchState,
} from "./store";
import { contextPercent, contextUseOf, transcriptFile } from "./transcript";

/** How long the crew session waits before it says the same line again. */
export const SELF_WATCH_REPEAT_MS = 15 * 60_000;

/**
 * How often the self-watch looks at the context and the clock: a transcript tail costs almost
 * nothing, but nothing needs it more often. (The answer is looked for every
 * `ANSWER_WATCH_POLL_MS`, a stat of the record's file.)
 */
export const SELF_WATCH_POLL_MS = 60_000;

/** What the crew session should hear, or null when it should hear nothing. */
export interface SelfAdvice {
  /** The line, in the crew session's own chat. */
  line: string;
  /** Which advice it is: the context ran out, the phase is long, or the time is up. */
  kind: "context" | "long" | "time";
}

/** The thresholds a crew session watches itself against. */
export interface SelfThresholds {
  /** The share of the context, in percent, at which it hands off. */
  handoffPercent: number;
  /** The hours after which the lead gets a note about it. */
  softHours: number;
  /** The hours after which it hands off. */
  maxHours: number;
}

/** How long the crew session has been at it, in hours (a fraction of an hour counts). */
export function hoursSince(startedAtMs: number, nowMs: number): number {
  return Math.max(0, (nowMs - startedAtMs) / 3_600_000);
}

/**
 * The line the crew session needs, or null when it needs none. `contextPercent` is the share of the
 * window its last reply used (null when the window is unknown), `hours` how long it has run.
 */
export function adviceFor(
  contextPercentValue: null | number,
  hours: number,
  thresholds: SelfThresholds,
): SelfAdvice | null {
  if (hours >= thresholds.maxHours) {
    return {
      kind: "time",
      line: `${hours.toFixed(1)} hours into this phase: hand off now — commit your work in progress, then run \`cc-smart-dev-kit crew report --status handoff\``,
    };
  }
  if (contextPercentValue !== null && contextPercentValue >= thresholds.handoffPercent) {
    return {
      kind: "context",
      line: `context at ${contextPercentValue}%: hand off now — commit your work in progress, then run \`cc-smart-dev-kit crew report --status handoff\``,
    };
  }
  if (hours >= thresholds.softHours) {
    return {
      kind: "long",
      line: `${hours.toFixed(1)} hours into this phase: it is long. Tell the lead where it stands (\`${COMMAND} crew step <the step you are at> --note "<where you stand>"\`), or hand off.`,
    };
  }
  return null;
}

/** The thresholds of this project. */
export function thresholdsOf(resolved: {
  crew: {
    handoffPercent: { value: number };
    maxHours: { value: number };
    softHours: { value: number };
  };
}): SelfThresholds {
  return {
    handoffPercent: resolved.crew.handoffPercent.value,
    maxHours: resolved.crew.maxHours.value,
    softHours: resolved.crew.softHours.value,
  };
}

/** `crew self-watch`; the exit code. */
export async function runCrewSelfWatch(ctx: CrewContext, once = false): Promise<number> {
  // A plugin's monitor is a process of the host: it may not carry the settings' `env`, so the
  // crew session is found by its worktree when the variable is not there.
  const self = readCrewSelf(ctx, "crew self-watch", { byWorktree: true });
  if (!self.ok) {
    for (const line of self.lines) ctx.error(line);
    return 1;
  }
  const { repo, resolved } = self.self;
  let { record } = self.self;
  const thresholds = thresholdsOf(resolved);
  // What it learns about windows is kept between polls: the gateway config once, and a
  // backend's list for its own lifetime (`context-window.ts`).
  const windows = windowWatch({ paths: ctx.paths });
  // A line that is ignored is said again when its time is up, and the watch keeps looking —
  // until the crew session's phase is over: a crew session that hands off or reports ends its work, and
  // its monitor has nothing more to say.
  const file = crewFile(ctx.paths.stateDir, repo, record.id);
  let seen: null | number = null;
  let lastBeat = Number.NEGATIVE_INFINITY;
  let lastAdvice = Number.NEGATIVE_INFINITY;
  for (;;) {
    const now = ctx.now();
    // The record is read when its file changed, and that read also ends the watch with the phase.
    const changed = mtimeOf(file);
    if (changed !== seen) {
      seen = changed;
      try {
        const fresh = readCrew(ctx.paths.stateDir, repo, record.id);
        if (fresh === null || runningCrew([fresh]).length === 0) return 0;
        record = fresh;
      } catch {
        // The record cannot be read this round: keep the one we have, and look again.
      }
    }
    if (now - lastBeat >= ANSWER_BEAT_EVERY_MS) {
      lastBeat = now;
      try {
        writeAnswerWatchBeat(ctx.paths.stateDir, repo, record.id, now);
      } catch (error) {
        ctx.error(`crew self-watch: the store could not record the heartbeat: ${reasonOf(error)}`);
      }
    }
    await deliverAnswer(ctx, repo, record, now);
    if (now - lastAdvice >= SELF_WATCH_POLL_MS) {
      lastAdvice = now;
      await adviseOnce(ctx, repo, record, thresholds, windows, now);
    }
    if (once) return 0;
    await ctx.sleep(ANSWER_WATCH_POLL_MS);
  }
}

/** When the file last changed, in ms; null when it cannot be read (the record read says why). */
function mtimeOf(file: string): null | number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Prints the lead's answer when it is on record and not delivered yet (AN1): the claim comes first
 * (`markAnswerDelivered`, atomic), so only the monitor that wins it prints. The words say when the
 * answer replaces an earlier one.
 */
async function deliverAnswer(
  ctx: CrewContext,
  repo: string,
  record: CrewRecord,
  now: number,
): Promise<void> {
  const index = undeliveredAnswerIndex(record);
  if (index === null) return;
  try {
    const claimed = await markAnswerDelivered(ctx.paths.stateDir, repo, record.id, index, now);
    if (claimed === null || claimed.answer === null) return;
    const earlier = claimed.superseded?.at(-1)?.answer ?? null;
    ctx.print(deliveryLine(claimed.question, claimed.answer, earlier));
  } catch (error) {
    // Not claimed, so the next tick tries again: an answer is never lost to a busy lock.
    ctx.error(`crew self-watch: the store could not deliver the answer: ${reasonOf(error)}`);
  }
}

/** The context and time advice for this look (the same lines as ever), said once per its time. */
async function adviseOnce(
  ctx: CrewContext,
  repo: string,
  record: CrewRecord,
  thresholds: SelfThresholds,
  windows: ReturnType<typeof windowWatch>,
  now: number,
): Promise<void> {
  const usage =
    record.sessionId === null
      ? null
      : contextUseOf(transcriptFile(ctx.paths.projectsDir, record.worktree, record.sessionId));
  // The model that wrote the last reply is the truth about the window (a fallback target may
  // have answered); the record's own model stands in before there is a reply.
  const window = await windows.of(usage?.model ?? record.model.resolved, now);
  const percent = usage === null ? null : contextPercent(usage, window);
  const hours = hoursSince(Date.parse(record.startedAt ?? record.createdAt), now);
  const advice = adviceFor(percent, hours, thresholds);
  if (advice === null) return;
  // The same advice is said again only after its time is up: a crew session that ignored it sees
  // it again, and a crew session that acted does not.
  const said = readSelfWatchState(ctx.paths.stateDir, repo, record.id);
  if (said !== null && said.kind === advice.kind && now - said.at < SELF_WATCH_REPEAT_MS) return;
  try {
    writeSelfWatchState(ctx.paths.stateDir, repo, record.id, { at: now, kind: advice.kind });
  } catch (error) {
    ctx.error(`crew self-watch: the store could not record the line: ${reasonOf(error)}`);
  }
  ctx.print(advice.line);
}
