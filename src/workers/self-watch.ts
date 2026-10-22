/**
 * `cc-smart-dev-kit worker self-watch`: the worker's own line about its context and its time.
 *
 * The worker's monitor runs this. It reads the worker's own transcript tail and the time since
 * it started, and prints **one line** into the worker's chat when the worker should act:
 *
 * - at `workflow.workers.handoffPercent` (70 %) of its context: **hand off** — commit the work
 *   in progress and run `worker report --status handoff`, so the lead starts the next worker
 *   from this head;
 * - at `workflow.workers.softHours` (2): a **note** — the phase is long: tell the lead where it
 *   stands (a `worker step` with a `--note`, which the lead's watch says), or hand off;
 * - at `workflow.workers.maxHours` (4): **hand off** again, now because the time is up.
 *
 * **Nothing else is printed.** A worker that is fine sees nothing. The line is repeated every
 * 15 minutes while it is ignored, so a worker that missed it sees it again.
 *
 * **The window.** The kit knows no backend's window; Claude Code's own is 200 000 tokens, or
 * 1 000 000 for a model whose name carries `[1m]` (`transcript.ts`). A model the kit does not
 * know has no window, and so no context line — the time lines still apply.
 */
import { COMMAND } from "../build-info/names";
import { readWorkerSelf, reasonOf } from "./caller";
import type { WorkerContext } from "./context";
import { runningWorkers } from "./places";
import { readSelfWatchState, readWorker, writeSelfWatchState } from "./store";
import { contextPercent, contextUseOf, contextWindowOf, transcriptFile } from "./transcript";

/** How long the worker waits before it says the same line again. */
export const SELF_WATCH_REPEAT_MS = 15 * 60_000;

/** How often the self-watch looks: a transcript tail and a clock cost almost nothing. */
export const SELF_WATCH_POLL_MS = 60_000;

/** What the worker should hear, or null when it should hear nothing. */
export interface SelfAdvice {
  /** The line, in the worker's own chat. */
  line: string;
  /** Which advice it is: the context ran out, the phase is long, or the time is up. */
  kind: "context" | "long" | "time";
}

/** The thresholds a worker watches itself against. */
export interface SelfThresholds {
  /** The share of the context, in percent, at which it hands off. */
  handoffPercent: number;
  /** The hours after which the lead gets a note about it. */
  softHours: number;
  /** The hours after which it hands off. */
  maxHours: number;
}

/** How long the worker has been at it, in hours (a fraction of an hour counts). */
export function hoursSince(startedAtMs: number, nowMs: number): number {
  return Math.max(0, (nowMs - startedAtMs) / 3_600_000);
}

/**
 * The line the worker needs, or null when it needs none. `contextPercent` is the share of the
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
      line: `${hours.toFixed(1)} hours into this phase: hand off now — commit your work in progress, then run \`cc-smart-dev-kit worker report --status handoff\``,
    };
  }
  if (contextPercentValue !== null && contextPercentValue >= thresholds.handoffPercent) {
    return {
      kind: "context",
      line: `context at ${contextPercentValue}%: hand off now — commit your work in progress, then run \`cc-smart-dev-kit worker report --status handoff\``,
    };
  }
  if (hours >= thresholds.softHours) {
    return {
      kind: "long",
      line: `${hours.toFixed(1)} hours into this phase: it is long. Tell the lead where it stands (\`${COMMAND} worker step <the step you are at> --note "<where you stand>"\`), or hand off.`,
    };
  }
  return null;
}

/** The thresholds of this project. */
export function thresholdsOf(resolved: {
  workers: {
    handoffPercent: { value: number };
    maxHours: { value: number };
    softHours: { value: number };
  };
}): SelfThresholds {
  return {
    handoffPercent: resolved.workers.handoffPercent.value,
    maxHours: resolved.workers.maxHours.value,
    softHours: resolved.workers.softHours.value,
  };
}

/** `worker self-watch`; the exit code. */
export async function runWorkerSelfWatch(ctx: WorkerContext, once = false): Promise<number> {
  // A plugin's monitor is a process of the host: it may not carry the settings' `env`, so the
  // worker is found by its worktree when the variable is not there.
  const self = readWorkerSelf(ctx, "worker self-watch", { byWorktree: true });
  if (!self.ok) {
    for (const line of self.lines) ctx.error(line);
    return 1;
  }
  const { repo, resolved } = self.self;
  let { record } = self.self;
  const thresholds = thresholdsOf(resolved);
  // A line that is ignored is said again when its time is up, and the watch keeps looking —
  // until the worker's phase is over: a worker that hands off or reports ends its work, and
  // its monitor has nothing more to say.
  for (;;) {
    const now = ctx.now();
    const usage =
      record.sessionId === null
        ? null
        : contextUseOf(transcriptFile(ctx.paths.projectsDir, record.worktree, record.sessionId));
    // The model that wrote the last reply is the truth about the window (a fallback target may
    // have answered); the record's own model stands in before there is a reply.
    const window = contextWindowOf(usage?.model ?? record.model.resolved);
    const percent = usage === null ? null : contextPercent(usage, window);
    const hours = hoursSince(Date.parse(record.startedAt ?? record.createdAt), now);
    const advice = adviceFor(percent, hours, thresholds);
    if (advice !== null) {
      // The same advice is said again only after its time is up: a worker that ignored it sees
      // it again, and a worker that acted does not.
      const said = readSelfWatchState(ctx.paths.stateDir, repo, record.id);
      if (said === null || said.kind !== advice.kind || now - said.at >= SELF_WATCH_REPEAT_MS) {
        try {
          writeSelfWatchState(ctx.paths.stateDir, repo, record.id, { at: now, kind: advice.kind });
        } catch (error) {
          ctx.error(`worker self-watch: the store could not record the line: ${reasonOf(error)}`);
        }
        ctx.print(advice.line);
      }
    }
    if (once) return 0;
    await ctx.sleep(SELF_WATCH_POLL_MS);
    try {
      const fresh = readWorker(ctx.paths.stateDir, repo, record.id);
      if (fresh === null || runningWorkers([fresh]).length === 0) return 0;
      record = fresh;
    } catch {
      // The record cannot be read this round: keep the one we have, and look again.
    }
  }
}
