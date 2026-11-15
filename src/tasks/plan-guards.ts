/**
 * The plan shape the task tools hold a session to (`docs/design/tasks.md` § The work store):
 * phases laid in any plan, one plan in flight at a time, and a plan's phases counted against
 * `plans.maxPhases`. These are the words and the pure checks; `ops.ts` calls them with the
 * caller's own plans, so the MCP tools and the `task` command refuse the same way. A shape
 * guard, not a security gate: it reads the checkout's working copy through the normal workflow
 * resolver.
 */
import { TASK_TOOL } from "./words";
import { isInFlight, isOpen, livePhaseCount } from "./work/queries";
import type { WorkStatus, WorkTask } from "./work/types";

/** A note that starts so says why a plan was parked (`task_update` with the plan pending). */
export const PARK_NOTE_PREFIX = "parked:";

/**
 * Refuses starting work in a plan while the caller has another plan in flight
 * (`inFlightPlanOf`): a session runs one plan at a time. The words name the plan in flight and
 * the ways forward: finish it, or park it (two calls), or, for a plan started under 4.8.0 whose
 * task never ran, stop its running phase. The target need not be the caller's own: a plan
 * another session made but never started (queued) is judged too, so a `/clear` that gave the
 * process a new session id cannot slip past. Only a plan claimed live by another process
 * (`claimedElsewhere`) is that session's own work and is left alone, and a plan with no task
 * is a legacy plan, also left alone. Laying a phase, or reopening a dropped one, is never
 * refused here: only the cap judges those.
 */
export function refuseOtherPlan(options: {
  all: readonly WorkTask[];
  inFlight: WorkTask | null;
  plan: string;
  claimedElsewhere: (task: WorkTask) => boolean;
}): void {
  const { all, inFlight, plan, claimedElsewhere } = options;
  if (inFlight === null || inFlight.plan === plan) return;
  const row = all.find((t) => t.kind === "plan" && t.plan === plan);
  if (row === undefined || claimedElsewhere(row)) return;
  const n = inFlight.number;
  const finish = `Finish "${inFlight.plan}" (${TASK_TOOL.done} on its #${n} once its phases are closed)`;
  // A plan started under 4.8.0 never set its task, so there is nothing to set back: it is in
  // flight only while a phase runs.
  const park =
    inFlight.status === "in_progress"
      ? `park it in two calls: ${TASK_TOOL.update} with task "#${n}" and status "pending" (refused while any phase or task of "${inFlight.plan}" is running, so stop that first), then ${TASK_TOOL.note} on "#${n}" with a note that starts "${PARK_NOTE_PREFIX}" and says why`
      : `stop its running phase (finish it with ${TASK_TOOL.done}, or set it back to pending with ${TASK_TOOL.update}); "${inFlight.plan}" was started before plans carried their own status, so it is in flight only while a phase runs`;
  throw new Error(
    `Plan "${inFlight.plan}" (#${n}) is in flight: your session runs one plan at a time. Do not start work in plan "${plan}" yet. ${finish}, or ${park}.`,
  );
}

/**
 * Refuses parking a plan (its task going from `in_progress` to `pending`) while one of its
 * phases or tasks is `in_progress`: stop or finish that work first. Nothing is dropped by a
 * park, so work left running would be a plan that is parked and running at once.
 */
export function refuseParkWhileBusy(
  all: readonly WorkTask[],
  task: WorkTask,
  status: WorkStatus | undefined,
): void {
  if (task.kind !== "plan" || task.status !== "in_progress" || status !== "pending") return;
  const running = all.filter(
    (t) => t.kind !== "plan" && t.plan === task.plan && t.status === "in_progress",
  );
  if (running.length === 0) return;
  throw new Error(
    `Plan "${task.plan}" (#${task.number}) has work in progress (${running.map((t) => `#${t.number}`).join(", ")}): do not park it yet. Finish that work (${TASK_TOOL.done}), or set it back to pending (${TASK_TOOL.update} with status "pending"), then park the plan.`,
  );
}

/** How a plan stands in the queue, as `task_list` on the plan ledger says it. */
export type PlanQueueState = "in flight" | "finishing" | "parked" | "queued";

/**
 * An open plan's place in the queue, for a plan that is not in flight (`isInFlight` says so
 * first): finishing (pending, every phase closed and one done: a plan started under 4.8.0 at its
 * final review and fix pass), parked (pending, with an open phase and either a done phase or a
 * note that starts `PARK_NOTE_PREFIX`), or queued (laid out, never started). `parkNote` says
 * whether the plan task holds such a note.
 */
export function planQueueState(
  all: readonly WorkTask[],
  plan: WorkTask,
  parkNote: boolean,
): PlanQueueState {
  if (isInFlight(all, plan)) return "in flight";
  const phases = all.filter((t) => t.kind === "phase" && t.plan === plan.plan);
  const started = phases.some((t) => t.status === "done");
  if (started && phases.every((t) => !isOpen(t))) return "finishing";
  return started || parkNote ? "parked" : "queued";
}

/**
 * A phase starts with its steps in place: a phase is one builder's brief, and its tasks are the
 * steps that builder closes. The refusal names the call that adds one.
 */
export function refuseEmptyPhase(all: readonly WorkTask[], phase: WorkTask): void {
  // A dropped step is no step: a phase whose only task was dropped has none.
  if (phase.kind !== "phase" || all.some((t) => t.parentId === phase.id && t.status !== "dropped"))
    return;
  throw new Error(
    `#${phase.number} "${phase.subject}" has no tasks: add its steps first, each with its done-check (${TASK_TOOL.create} with parent "#${phase.number}"), then start it`,
  );
}

/**
 * A step of a phase (a task whose parent is a phase) closes with its proof: done with evidence
 * (what was run or checked, and the result), dropped with a note that gives the reason. A phase,
 * a plan, a loose task and a task waiting directly under a plan keep the plain close. `given`
 * holds what the closing call carries; `task_update` carries neither, so it is refused for a
 * step and points to `task_done`.
 */
export function refuseBareClose(
  all: readonly WorkTask[],
  task: WorkTask,
  outcome: "done" | "dropped",
  given: { evidence?: string | undefined; note?: string | undefined },
): void {
  const parent = task.parentId === null ? undefined : all.find((t) => t.id === task.parentId);
  if (task.kind !== "task" || parent?.kind !== "phase" || task.status === outcome) return;
  const step = `#${task.number} "${task.subject}" is a step of phase #${parent.number}`;
  if (outcome === "done" && !given.evidence?.trim())
    throw new Error(
      `${step}: a step closes done with evidence: what you ran or checked and its result (${TASK_TOOL.done} with task "#${task.number}" and evidence)`,
    );
  if (outcome === "dropped" && !given.note?.trim())
    throw new Error(
      `${step}: a step is dropped with a note that gives the reason (${TASK_TOOL.done} with task "#${task.number}", outcome "dropped" and note)`,
    );
}

/**
 * An open step stays in its phase until it is closed with its proof: moving it to the top, or
 * under a plan, would let it close without evidence (`refuseBareClose` judges only a step of a
 * phase). It may move to another phase of the same plan, and once closed it is free to move.
 * `to` is the new parent as the call gives it (null: the top).
 */
export function refuseStepEscape(
  all: readonly WorkTask[],
  task: WorkTask,
  to: WorkTask | null,
): void {
  const from = task.parentId === null ? undefined : all.find((t) => t.id === task.parentId);
  if (task.kind !== "task" || from?.kind !== "phase" || !isOpen(task)) return;
  if (to !== null && to.kind === "phase" && to.plan === from.plan) return;
  throw new Error(
    `#${task.number} "${task.subject}" is an open step of phase #${from.number} and stays there until it is closed: close it with evidence (${TASK_TOOL.done} with task "#${task.number}" and evidence), or drop it with a note that gives the reason (${TASK_TOOL.done} with outcome "dropped" and note); it may move to another phase of the plan`,
  );
}

/**
 * What a plan's row adds to its line on the plan ledger: its phase count against the cap (over
 * the cap it is frozen) and the open tasks waiting directly under it, which full phase
 * progress would otherwise hide.
 */
export function planNote(all: readonly WorkTask[], plan: WorkTask, cap: number | null): string {
  const slug = plan.plan ?? "";
  const count = livePhaseCount(all, slug);
  const phases =
    cap === null
      ? `Phases ${count}`
      : `Phases ${count}/${cap}${count > cap ? " · frozen: over the cap, no new phases" : ""}`;
  const waiting = all.filter((t) => t.parentId === plan.id && t.kind === "task" && isOpen(t));
  return waiting.length ? `${phases} · waiting ${waiting.length}` : phases;
}
