/**
 * The plan phases one Claude process works on: what the keep-going Stop guard reads
 * (`src/hooks/keep-going.ts`).
 *
 * A plan is this process's own when it holds a task this process has claimed (`claimHeldBy`,
 * the store's claim from `callerOf`), never only the session id, so a `/clear` keeps the plan
 * where the process start time names the process. A claim lives only while its task is
 * `in_progress`. Its phases are the tasks of kind `phase` with that plan; one in progress is
 * work this session must finish, and a pending one with no open blocker is the next one ready
 * to start.
 */
import { allTasks, claimHeldBy, isBlocked } from "./queries";
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
   * The pending phases with no open blocker, of the plans that have a phase in progress, in
   * number order: the first is the next to start.
   */
  ready: PhaseRef[];
}

const NOTHING_OPEN: OpenPhases = { inProgress: [], ready: [] };

function refOf(task: WorkTask & { plan: string }): PhaseRef {
  return { number: task.number, subject: task.subject, plan: task.plan, agent: task.agent };
}

/** A plan phase: a `phase` task with its plan and phase id set. */
function isPhase(task: WorkTask): task is WorkTask & { plan: string } {
  return task.kind === "phase" && task.plan !== null && task.phase !== null;
}

/**
 * The open phases of the plans the caller holds a claim in. Read-only, like every hook read
 * (`readWorkStore`): no store is `none`, a store that cannot be read is `unreadable`.
 *
 * `caller` is asked only when the project has a phase in progress at all: finding the caller
 * may list the running processes (off Linux), too dear for every Stop of every session. A
 * caller of null holds no claim, so nothing is its own.
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
  if (!phases.some((t) => t.status === "in_progress")) {
    return { state: "ready", value: NOTHING_OPEN };
  }
  const who = caller();
  if (who === null) return { state: "ready", value: NOTHING_OPEN };
  const mine = new Set(
    all.flatMap((t) => (t.plan !== null && claimHeldBy(t.claim, who) ? [t.plan] : [])),
  );
  const own = phases.filter((t) => mine.has(t.plan));
  const inProgress = own.filter((t) => t.status === "in_progress");
  const busy = new Set(inProgress.map((t) => t.plan));
  const byId = new Map(all.map((t) => [t.id, t]));
  const ready = own.filter(
    (t) => t.status === "pending" && busy.has(t.plan) && !isBlocked(t, byId),
  );
  // `allTasks` reads in number order, so both lists keep it.
  return { state: "ready", value: { inProgress: inProgress.map(refOf), ready: ready.map(refOf) } };
}
