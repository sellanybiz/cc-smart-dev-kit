/**
 * The plan phases one Claude process works on: what the keep-going Stop guard reads
 * (`src/hooks/keep-going.ts`).
 *
 * A plan is this process's own when its plan task is (`ownsPlan`, by `ownerOf`: made under the
 * session id, claimed by the process, or made by the process, so a `/clear` keeps the plan where
 * the process start time names the process). A step it claims in another session's plan never
 * makes that plan its own; its phase still counts as in progress for it. A claim lives only
 * while its task is `in_progress`. Its phases are the tasks of kind `phase` with that plan; one in progress is
 * work this session must finish, and a pending one with no open blocker and at least one live
 * task is ready to start, in a plan with a phase running or in the plan in flight.
 */
import {
  allTasks,
  claimHeldBy,
  inFlightPlanOf,
  isInFlight,
  isStartable,
  ownerOf,
  ownsPlan,
} from "./queries";
import { type ReadState, readWorkStore } from "./read";
import type { Who, WorkTask } from "./types";

/** One phase, as the guard names it: `#<number> <subject>`. */
export interface PhaseRef {
  number: number;
  subject: string;
  plan: string;
  agent: string | null;
}

export interface OpenPhases {
  /** The phases in progress of the plans this process works on, in number order. */
  inProgress: PhaseRef[];
  /**
   * The pending phases with no open blocker and at least one live (not dropped) task
   * (`isStartable`), of the plans that have a phase in progress and of the plan in flight
   * (`inFlightPlanOf`), in number order: every one can start now, together.
   */
  ready: PhaseRef[];
}

const NOTHING_OPEN: OpenPhases = { inProgress: [], ready: [] };

function refOf(task: WorkTask & { plan: string }): PhaseRef {
  // A blank agent names no builder to resume: the same as none.
  const agent = task.agent?.trim() || null;
  return { number: task.number, subject: task.subject, plan: task.plan, agent };
}

/** A plan phase: a `phase` task with its plan and phase id set. */
function isPhase(task: WorkTask): task is WorkTask & { plan: string } {
  return task.kind === "phase" && task.plan !== null && task.phase !== null;
}

/**
 * The open phases of the plans the caller owns, and the phases it claims work in. Read-only, like every hook read
 * (`readWorkStore`): no store is `none`, a store that cannot be read is `unreadable`.
 *
 * `caller` is asked only when a phase is in progress or a plan in flight has a phase that could
 * start: finding the caller may list the running processes (off Linux), too dear for every Stop
 * of every session. A caller of null owns nothing.
 */
export function openPhasesOf(
  paths: { stateDir: string },
  project: string,
  caller: () => Who | null,
): ReadState<OpenPhases> {
  const read = readWorkStore(paths, (db) => allTasks(db, project));
  if (read.state !== "ready") return read;
  const all = read.value;
  const phases = all.filter(isPhase);
  const byId = new Map(all.map((t) => [t.id, t]));
  // A phase with no live task is one the store refuses to start (`refuseEmptyPhase`): `isStartable`
  // leaves it out, so the guard never names it as ready.
  const startable = (phase: WorkTask) => isStartable(all, byId, phase);
  // Cheap, whoever the caller is: a phase runs, or a plan in flight has a phase that could start.
  const worth =
    phases.some((t) => t.status === "in_progress") ||
    all.some(
      (plan) =>
        plan.kind === "plan" &&
        isInFlight(all, plan) &&
        phases.some((t) => t.plan === plan.plan && startable(t)),
    );
  if (!worth) return { state: "ready", value: NOTHING_OPEN };
  const who = caller();
  if (who === null) return { state: "ready", value: NOTHING_OPEN };
  const owns = ownerOf(who);
  // The caller's plans: those whose plan task it owns (`ownsPlan`). A step it claims in another
  // session's plan does not make that plan its own.
  const owned = new Set(
    all.flatMap((t) => (t.plan !== null && ownsPlan(all, owns, t.plan) ? [t.plan] : [])),
  );
  // A phase in progress is the caller's when its plan is, or when the caller claims the phase or
  // one of its steps (work it took in another session's plan).
  const claimedBy = (task: WorkTask) => claimHeldBy(task.claim, who);
  const isMine = (phase: WorkTask & { plan: string }) =>
    owned.has(phase.plan) ||
    claimedBy(phase) ||
    all.some((t) => t.parentId === phase.id && claimedBy(t));
  const inProgress = phases.filter((t) => t.status === "in_progress" && isMine(t));
  // The plans that work now: those with a phase in progress, and the plan in flight (between
  // waves none runs, and the next phases wait to be started). Ready phases are only the
  // caller's own plans'.
  const working = new Set(inProgress.map((t) => t.plan));
  const flying = inFlightPlanOf(all, (t) => t.plan !== null && owned.has(t.plan));
  if (flying?.plan) working.add(flying.plan);
  const ready = phases.filter((t) => owned.has(t.plan) && working.has(t.plan) && startable(t));
  // `allTasks` reads in number order, so both lists keep it.
  return { state: "ready", value: { inProgress: inProgress.map(refOf), ready: ready.map(refOf) } };
}
