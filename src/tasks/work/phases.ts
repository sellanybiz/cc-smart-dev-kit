/**
 * The plan phases one Claude process works on: what the keep-going Stop guard reads
 * (`src/hooks/keep-going.ts`).
 *
 * A plan is this process's own when it holds a task this process has claimed: the store's
 * claim is the Claude process (its pid and start time, `callerOf`), never the session id, so a
 * `/clear` keeps the plan. A claim lives only while its task is `in_progress`. Its phases are
 * the tasks of kind `phase` with that plan; one in progress is work this session must finish,
 * and a pending one with no open blocker is the next one ready to start.
 */
import { allTasks, isBlocked } from "./queries";
import { type ReadState, readWorkStore } from "./read";
import type { Who, WorkTask } from "./types";

/** One phase, as the guard names it: `#<number> <subject>`. */
export interface PhaseRef {
  number: number;
  subject: string;
  plan: string;
}

export interface OpenPhases {
  /** The phases in progress of the plans this process works on, in number order. */
  inProgress: PhaseRef[];
  /**
   * The pending phases with no open blocker, of the plans that have a phase in progress, in
   * number order: the first is the next to start.
   */
  ready: PhaseRef[];
}

/** True when this process holds the task's claim: the same pid and process start time. */
function claimedBy(task: WorkTask, who: Who): boolean {
  return who.pid !== null && task.claim?.pid === who.pid && task.claim.procStart === who.procStart;
}

function refOf(task: WorkTask & { plan: string }): PhaseRef {
  return { number: task.number, subject: task.subject, plan: task.plan };
}

/** A plan phase: a `phase` task with its plan and phase id set. */
function isPhase(task: WorkTask): task is WorkTask & { plan: string } {
  return task.kind === "phase" && task.plan !== null && task.phase !== null;
}

/**
 * The open phases of the plans `who` holds a claim in. Read-only, like every hook read
 * (`readWorkStore`): no store is `none`, a store that cannot be read is `unreadable`.
 */
export function openPhasesOf(
  paths: { stateDir: string },
  project: string,
  who: Who,
): ReadState<OpenPhases> {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const mine = new Set(
      all.flatMap((t) => (t.plan !== null && claimedBy(t, who) ? [t.plan] : [])),
    );
    const phases = all.filter(isPhase).filter((t) => mine.has(t.plan));
    const inProgress = phases.filter((t) => t.status === "in_progress");
    const busy = new Set(inProgress.map((t) => t.plan));
    const byId = new Map(all.map((t) => [t.id, t]));
    const ready = phases.filter(
      (t) => t.status === "pending" && busy.has(t.plan) && !isBlocked(t, byId),
    );
    // `allTasks` reads in number order, so both lists keep it.
    return { inProgress: inProgress.map(refOf), ready: ready.map(refOf) };
  });
}
