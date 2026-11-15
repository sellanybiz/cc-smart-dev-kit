/**
 * The plan shape the task tools hold a session to (`docs/design/tasks.md` § The work store):
 * one active plan at a time, and a plan's phases counted against `plans.maxPhases`. These are
 * the words and the pure checks; `ops.ts` calls them with the caller's own plans, so the MCP
 * tools and the `task` command refuse the same way. A shape guard, not a security gate: it
 * reads the checkout's working copy through the normal workflow resolver.
 */
import { TASK_TOOL } from "./words";
import { isOpen, livePhaseCount } from "./work/queries";
import type { WorkTask } from "./work/types";

/** What a call does in a plan other than the active one. */
export type PlanWork = "lay a phase" | "start work";

/**
 * Refuses work in a plan other than the caller's active plan (`activePlanOf`): a session builds
 * one plan at a time, and a later ask waits as a task under its own plan. Another session's
 * plan is not judged here. A plan with no task yet is new, so laying a phase in it is refused
 * too; starting work in a plan with no task is a legacy plan, left alone.
 */
export function refuseOtherPlan(options: {
  all: readonly WorkTask[];
  active: WorkTask | null;
  plan: string;
  owns: (task: WorkTask) => boolean;
  doing: PlanWork;
}): void {
  const { all, active, plan, owns, doing } = options;
  if (active === null || active.plan === plan) return;
  const row = all.find((t) => t.kind === "plan" && t.plan === plan);
  const mine = row === undefined ? doing === "lay a phase" : owns(row);
  if (!mine) return;
  const queue =
    row === undefined
      ? `make plan "${plan}" first (${TASK_TOOL.create} with plan and a subject), then add the task with ${TASK_TOOL.create} and parent set to its #n`
      : `${TASK_TOOL.create} with parent "#${row.number}"`;
  throw new Error(
    `Plan "${active.plan}" (#${active.number}) is your active plan: it still has open phases. Do not ${doing} in plan "${plan}" yet. Queue the work as a task that waits there (${queue}), or finish or drop the open phases of "${active.plan}" first.`,
  );
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
 * phase). It may move to another phase, and once closed it is free to move. `to` is the new
 * parent as the call gives it (null: the top).
 */
export function refuseStepEscape(
  all: readonly WorkTask[],
  task: WorkTask,
  to: WorkTask | null,
): void {
  const from = task.parentId === null ? undefined : all.find((t) => t.id === task.parentId);
  if (task.kind !== "task" || from?.kind !== "phase" || !isOpen(task)) return;
  if (to !== null && to.kind === "phase") return;
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
