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
 * - `own`: reserved for this lead itself (lead + children mode, holder `self`): it builds the plan.
 * - `with-child`: reserved as a hand-out (holder `child`). Its child has not taken it yet, or it
 *   runs, or it cannot be proved gone: a resume must never start a second child beside a live one.
 * - `child-gone`: a hand-out whose child took it and whose session is over: its maker and its
 *   claim, if it has one, are gone, and no running session carries its id (a reopened child that
 *   has made no task call yet is still `with-child`).
 * - `merging`: the plan is closed but still reserved for this lead: its pull request has not
 *   settled (`herdr plans` releases it).
 * - `waiting`: not reserved, and a blocker is still open in the store.
 * - `no-files`: not reserved, nothing blocks it, and it has no file list: it is never handed out.
 * - `ready`: not reserved, nothing blocks it and it has files. Overlaps with held plans are not
 *   judged here: they need the branch diffs, which `reservePlan` and `herdr plans` read.
 */
export type LeadPlanState =
  | "own"
  | "with-child"
  | "child-gone"
  | "merging"
  | "waiting"
  | "no-files"
  | "ready";

export interface LeadPlan {
  plan: WorkTask;
  state: LeadPlanState;
  /** The open blockers, for `waiting`; empty otherwise. */
  waitingOn: WorkTask[];
}

/**
 * The state of an open plan reserved for the caller. The holder kind was recorded at the
 * reservation, so a hand-out the lead still owns (its child has not taken it) is `with-child`,
 * never `own`. After a take the plan's maker is the child (`reclaimResumed` keeps it the running
 * process): `child-gone` needs it proved gone, and the claim too when the child started the plan.
 */
function reservedState(
  plan: WorkTask,
  owns: (task: WorkTask) => boolean,
  process: ClaimProcess,
): "own" | "with-child" | "child-gone" {
  if (owns(plan)) return plan.lead?.holder === "self" ? "own" : "with-child";
  const child = plan.creator;
  if (child === null || process.live(child)) return "with-child";
  // "Gone" is not enough: a reopened child session runs in a new process before it has made one
  // task call, so the store still names the dead one. Its session must be over too (`ended`).
  return process.ended(child) && (plan.claim === null || process.ended(plan.claim))
    ? "child-gone"
    : "with-child";
}

/**
 * The plans this caller leads, each with its state, in plan order: every plan reserved for the
 * caller (`isLead`: its session, or the same process, so a `/clear` and a resume keep them), and
 * every open plan the caller owns that is neither reserved nor running (queued plans it laid).
 * Another session's plans, closed plans that are not reserved and the caller's own solo plan in
 * flight are left out. `process` answers the child's liveness (`CLAIM_PROCESS` by default).
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
    if (plan.kind !== "plan") continue;
    if (isLead(plan.lead, who)) {
      const state = isOpen(plan) ? reservedState(plan, owns, process) : "merging";
      found.push({ plan, state, waitingOn: [] });
    } else if (isOpen(plan) && plan.lead === null && owns(plan) && !isInFlight(all, plan)) {
      const waitingOn = openBlockers(plan, byId);
      const state =
        waitingOn.length > 0 ? "waiting" : plan.files.length === 0 ? "no-files" : "ready";
      found.push({ plan, state, waitingOn });
    }
  }
  return found;
}
