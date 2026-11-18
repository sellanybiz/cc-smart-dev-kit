/**
 * Where a lead's plans stand, by the store alone (D7): the one reader the status line and the
 * keep-going hook share. It runs no git, no gh and no hc, so it stays inside a hook's budget; the
 * live gates (a blocker's pull request, a branch diff, a pane) are `herdr plans`' own.
 */
import type { WorkDb } from "./db";
import { CLAIM_PROCESS } from "./identity";
import { allTasks, isInFlight, isLead, isOpen, openBlockers, ownerOf } from "./queries";
import type { ClaimProcess, Who, WorkTask } from "./types";

/**
 * - `own`: reserved for this lead itself (lead + children mode): it builds the plan.
 * - `with-child`: reserved and handed to a child. Its process runs, or cannot be proved gone: a
 *   resume must never start a second child beside a live one.
 * - `child-gone`: reserved and handed to a child whose process is proved gone.
 * - `waiting`: not reserved, and a blocker is still open in the store.
 * - `no-files`: not reserved, nothing blocks it, and it has no file list: it is never handed out.
 * - `ready`: not reserved, nothing blocks it and it has files. Overlaps with held plans are not
 *   judged here: they need the branch diffs, which `reservePlan` and `herdr plans` read.
 */
export type LeadPlanState = "own" | "with-child" | "child-gone" | "waiting" | "no-files" | "ready";

export interface LeadPlan {
  plan: WorkTask;
  state: LeadPlanState;
  /** The open blockers, for `waiting`; empty otherwise. */
  waitingOn: WorkTask[];
}

/**
 * The state of a plan reserved for the caller. A plan the caller still owns was never taken by a
 * child: it is the lead's own, unless herdr already bound a child's agent to it (a launch whose
 * child has not taken it yet), which is a child's. After a take the plan's creator is the child,
 * so that process's liveness says whether the child still runs.
 */
function reservedState(
  plan: WorkTask,
  owns: (task: WorkTask) => boolean,
  process: ClaimProcess,
): "own" | "with-child" | "child-gone" {
  if (owns(plan)) return plan.agent === null ? "own" : "with-child";
  const child = plan.creator;
  if (child === null || process.live(child)) return "with-child";
  return process.gone(child) ? "child-gone" : "with-child";
}

/**
 * The open plans this caller leads, each with its state, in plan order: every open plan reserved
 * for the caller (`isLead`: its session, or the same process, so a `/clear` keeps them), and
 * every open plan the caller owns that is neither reserved nor running (queued plans it laid).
 * Another session's plans, closed plans and the caller's own solo plan in flight are left out.
 * `process` answers the child's liveness (`CLAIM_PROCESS` by default).
 */
export function classifyLeadPlans(
  db: WorkDb,
  project: string,
  who: Who,
  process: ClaimProcess = CLAIM_PROCESS,
): LeadPlan[] {
  const all = allTasks(db, project);
  const byId = new Map(all.map((t) => [t.id, t]));
  const owns = ownerOf(who);
  const found: LeadPlan[] = [];
  for (const plan of all) {
    if (plan.kind !== "plan" || !isOpen(plan)) continue;
    if (isLead(plan.lead, who)) {
      found.push({ plan, state: reservedState(plan, owns, process), waitingOn: [] });
    } else if (plan.lead === null && owns(plan) && !isInFlight(all, plan)) {
      const waitingOn = openBlockers(plan, byId);
      const state =
        waitingOn.length > 0 ? "waiting" : plan.files.length === 0 ? "no-files" : "ready";
      found.push({ plan, state, waitingOn });
    }
  }
  return found;
}
