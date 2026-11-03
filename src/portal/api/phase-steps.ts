/**
 * A phase's steps, as the Tasks tab's ledger counts them (G3): its blocking work done, of its
 * blocking work. "Blocking work" is what holds the phase (`holdingUnder`, D76): each blocking
 * task under it reached through blocking tasks only, at any depth. A dropped step is no step any
 * more: it leaves both numbers, so a phase whose steps are all done or dropped reads n of n.
 */
import { holdingUnder } from "../../tasks/work/queries";
import type { WorkTask } from "../../tasks/work/types";

export interface PhaseSteps {
  done: number;
  total: number;
}

/** Each phase's steps, by the phase task's id. A plan or a task has no entry. */
export function phaseSteps(tasks: readonly WorkTask[]): Map<string, PhaseSteps> {
  // `holdingUnder` names the open tasks that hold a task. Its walk goes on below a closed task,
  // so with every task read as open it names every blocking task under the phase, whatever its
  // state: the store's one walk, never a second copy of it. The real state is looked up after.
  const asOpen = tasks.map((task) => ({ ...task, status: "pending" as const }));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const steps = new Map<string, PhaseSteps>();
  for (const phase of tasks) {
    if (phase.kind !== "phase") continue;
    const kept = holdingUnder(asOpen, phase.id)
      .map((one) => byId.get(one.id)?.status)
      .filter((status) => status !== undefined && status !== "dropped");
    steps.set(phase.id, {
      done: kept.filter((status) => status === "done").length,
      total: kept.length,
    });
  }
  return steps;
}
