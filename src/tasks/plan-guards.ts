/**
 * The plan shape the task tools hold a session to (`docs/design/tasks.md` § The work store):
 * phases laid in any plan, one plan in flight at a time, and a plan's phases counted against
 * `plans.maxPhases`. These are the words and the pure checks; `ops.ts` calls them with the
 * caller's own plans, so the MCP tools and the `task` command refuse the same way. A shape
 * guard, not a security gate: it reads the checkout's working copy through the normal workflow
 * resolver.
 */
import type { GitRun } from "../hooks/git";
import { parseGitVersion } from "../workflow/review-cover";
import { TASK_TOOL } from "./words";
import { isOpen, livePhaseCount, PARK_NOTE_PREFIX, runningTasksOf } from "./work/queries";
import type { WorkStatus, WorkTask } from "./work/types";

/** What `planInTheWay` judges: the caller's plan in flight, and the plan work would start in. */
interface OtherPlanCheck {
  all: readonly WorkTask[];
  inFlight: WorkTask | null;
  plan: string;
  claimedElsewhere: (task: WorkTask) => boolean;
  /**
   * Who is asking, for a reserved plan (D4): `owns` is the caller's ownership test (`ownerOf`)
   * and `isLead` whether a plan's reservation is the caller's (`isLead`). Left out, a reserved
   * plan is judged like any other: only a caller that passes it gets the reservation refusal.
   */
  caller?: { owns: (task: WorkTask) => boolean; isLead: (task: WorkTask) => boolean };
}

/**
 * The reserved plan work may not start in: `plan` has a reservation (D4) and either the caller
 * does not own it, or it is a hand-out (holder `child`) and the caller is its lead. A lead that
 * handed the plan to a child never builds it, owned or not (before the child takes it the plan
 * is still the lead's own); a session that is not its lead never may. Closes the gap that a
 * pending plan has no claim, so a handed-out plan would read as free. Null for an unreserved
 * plan, a legacy plan with no task, a plan the caller owns and builds, and a caller that gave no
 * `caller`.
 */
function reservedAgainstCaller(options: OtherPlanCheck): WorkTask | null {
  const { all, plan, caller } = options;
  if (caller === undefined) return null;
  const row = all.find((t) => t.kind === "plan" && t.plan === plan);
  if (row === undefined || row.lead === null) return null;
  if (row.lead.holder === "child" && caller.isLead(row)) return row;
  return caller.owns(row) ? null : row;
}

/**
 * The plan that stops work from starting in `plan`, or null when nothing does: the plan is
 * reserved for another lead, or handed to a child that owns it (`reservedAgainstCaller`: the
 * plan itself is returned); or the caller has another plan in flight. Null when no plan is in
 * flight, the work is in that plan, the plan is a legacy one with no task, or another process
 * holds it live. The one rule `refuseOtherPlan` refuses by and the close answer's "now ready"
 * list leaves work out by.
 */
export function planInTheWay(options: OtherPlanCheck): WorkTask | null {
  const reserved = reservedAgainstCaller(options);
  if (reserved !== null) return reserved;
  const { all, inFlight, plan, claimedElsewhere } = options;
  if (inFlight === null || inFlight.plan === plan) return null;
  const row = all.find((t) => t.kind === "plan" && t.plan === plan);
  if (row === undefined || claimedElsewhere(row)) return null;
  return inFlight;
}

/**
 * Refuses starting work in a plan while the caller has another plan in flight
 * (`inFlightPlanOf`): a session runs one plan at a time. The words name the plan in flight and
 * the ways forward: finish it, or park it (two calls), or, for a plan whose task never ran, stop
 * the work running in it (`stopOrPark`). The target need not be the caller's own: a plan
 * another session made but never started (queued) is judged too, so a `/clear` that gave the
 * process a new session id cannot slip past. Only a plan claimed live by another process
 * (`claimedElsewhere`) is that session's own work and is left alone, and a plan with no task
 * is a legacy plan, also left alone. Laying a phase, or reopening a dropped one, is never
 * refused here: only the cap judges those.
 */
export function refuseOtherPlan(options: OtherPlanCheck): void {
  const inFlight = planInTheWay(options);
  if (inFlight === null) return;
  const { plan, caller } = options;
  if (inFlight.plan === plan) {
    // The plan itself is in the way: it is reserved, and it is a hand-out or not the caller's.
    const mine = caller?.isLead(inFlight) === true;
    const holder = inFlight.lead?.sessionId ?? `process ${inFlight.lead?.pid}`;
    const first = `Plan "${plan}" (#${inFlight.number})`;
    if (mine)
      throw new Error(
        caller?.owns(inFlight) === true
          ? `${first} is reserved as a hand-out: its child builds it, never you. Do not start work in it. To build it yourself, release the reservation first.`
          : `${first} was handed to another session: it owns the plan now. Do not start work in it; its report arrives when it finishes.`,
      );
    throw new Error(
      `${first} is reserved for session ${holder}: it is that lead's, or its child's. Do not start work in it. If it was handed to you, take it first with the hand-out id your brief names.`,
    );
  }
  const n = inFlight.number;
  const finish = `Finish "${inFlight.plan}" (${TASK_TOOL.done} on its #${n} once its phases are closed)`;
  throw new Error(
    `Plan "${inFlight.plan}" (#${n}) is in flight: your session runs one plan at a time. Do not start work in plan "${plan}" yet. ${finish}, or ${stopOrPark(options.all, inFlight)}.`,
  );
}

/**
 * The second way out of the one-plan refusal. A plan whose task runs is parked. One whose task is
 * still pending runs only while its work does (`isInFlight`), so there is nothing to park: that
 * work stops. When only phases run, the plan was started under 4.8.0, which never set its task;
 * otherwise the running work is named by number (another session may have started a step).
 */
function stopOrPark(all: readonly WorkTask[], inFlight: WorkTask): string {
  const n = inFlight.number;
  if (inFlight.status === "in_progress")
    return `park it in two calls: ${TASK_TOOL.update} with task "#${n}" and status "pending" (refused while any phase or task of "${inFlight.plan}" is running, so stop that first), then ${TASK_TOOL.note} on "#${n}" with a note that starts "${PARK_NOTE_PREFIX}" and says why`;
  const running = runningTasksOf(all, inFlight.plan);
  if (running.every((t) => t.kind === "phase"))
    return `stop its running phase (finish it with ${TASK_TOOL.done}, or set it back to pending with ${TASK_TOOL.update}); "${inFlight.plan}" was started before plans carried their own status, so it is in flight only while a phase runs`;
  const them = running.length === 1 ? "it" : "them";
  return `stop the work running in "${inFlight.plan}" (${running.map((t) => `#${t.number}`).join(", ")}): finish ${them} (${TASK_TOOL.done}), or set ${them} back to pending (${TASK_TOOL.update} with status "pending")`;
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
  const running = runningTasksOf(all, task.plan);
  if (running.length === 0) return;
  throw new Error(
    `Plan "${task.plan}" (#${task.number}) has work in progress (${running.map((t) => `#${t.number}`).join(", ")}): do not park it yet. Finish that work (${TASK_TOOL.done}), or set it back to pending (${TASK_TOOL.update} with status "pending"), then park the plan.`,
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
 * A phase whose builder's `branch` and `base` are recorded closes `done` only with that work in
 * the plan: at least one commit in `base..branch`, and `branch` reachable from the plan branch
 * (the plan task's `branch`; with none recorded, only the commit count is judged). A builder
 * that handed back nothing, or whose commit never reached the plan branch, is refused with both
 * names. A phase with no branch or no base, a dropped close and a phase already done pass. Git
 * that cannot answer refuses with its own reason: a guess would let a phase close with none of
 * its work. `git` runs one git command for the caller's repo (every worktree shares the refs).
 */
export function refuseEmptyHandBack(
  all: readonly WorkTask[],
  phase: WorkTask,
  outcome: "done" | "dropped",
  git: (args: string[]) => GitRun,
): void {
  const { branch, base } = phase;
  if (phase.kind !== "phase" || outcome !== "done" || phase.status === "done") return;
  if (!branch || !base) return;
  const what = `#${phase.number} "${phase.subject}" records its builder's branch "${branch}" and base ${base}`;
  const planBranch = all.find((t) => t.kind === "plan" && t.plan === phase.plan)?.branch ?? null;
  // A git branch name never starts with "-": one that does is not a name, and git would read it as an option.
  for (const name of [branch, base, planBranch])
    if (name?.startsWith("-"))
      throw new Error(
        `${what}, and "${name}" is not a branch or commit name: fix the phase's binding`,
      );
  const counted = git(["rev-list", "--count", `${base}..${branch}`]);
  if (!counted.ok)
    throw new Error(
      `${what}: git could not count its commits (${counted.err || "no reason given"}), so the hand-back is not proved. Fix the binding or the repo, then close the phase`,
    );
  if (counted.out === "0")
    throw new Error(
      `${what}, but "${branch}" has no commit past its base: the builder handed back nothing. Get its work committed on "${branch}" and merged into ${planBranch === null ? "the plan branch" : `"${planBranch}"`}, then close the phase`,
    );
  if (planBranch === null) return;
  const held = git(["merge-base", "--is-ancestor", branch, planBranch]);
  if (held.ok) return;
  if (held.code === 1)
    throw new Error(
      `${what}, but "${branch}" is not in the plan branch "${planBranch}": merge the builder's commit into "${planBranch}", then close the phase`,
    );
  throw new Error(
    `${what}: git could not check that "${branch}" is in the plan branch "${planBranch}" (${held.err || "no reason given"}), so the hand-back is not proved. Fix the binding or the repo, then close the phase`,
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

/** The most changed files a stale-brief warning names; the rest are counted. */
export const STALE_BRIEF_FILES = 10;

/** What `staleBriefWarning` reads: the phase that starts, its plan's files, and where git looks. */
export interface StaleBriefCheck {
  /** The phase that starts: only its number is said. */
  phase: Pick<WorkTask, "number">;
  /** The plan's file list, as stored (a folder ends in `/`). */
  files: readonly string[];
  /** When the phase's description was last written (ms), from its history; null when it never was. */
  writtenAt: number | null;
  /** The default branch's name (`baseBranch`); its remote tracking ref is read as it is, never fetched. */
  base: string;
  /** One git command in the caller's checkout. */
  git: (args: string[]) => GitRun;
}

/** The first git whose `log` has `--since-as-filter`, which filters by date without stopping the walk. */
export const MIN_SINCE_FILTER_GIT = "2.38.0";

/**
 * The date option `staleBriefWarning`'s log takes. `--since` stops the walk at the first commit
 * older than the date, so a fast-forwarded commit dated before the brief at the tip hides every
 * change behind it; `--since-as-filter` (git 2.38) only skips such commits. An older git, or one
 * whose version cannot be read, gets `--since`: the repository's floor is 2.31.
 */
function sinceFlag(git: (args: string[]) => GitRun): "--since-as-filter" | "--since" {
  const asked = git(["--version"]);
  const version = asked.ok ? parseGitVersion(asked.out) : null;
  return version !== null && Bun.semver.order(version, MIN_SINCE_FILTER_GIT) >= 0
    ? "--since-as-filter"
    : "--since";
}

/**
 * The warning a phase's start adds when its brief may be stale: commits that reached the default
 * branch (`origin/<base>`, first parent, so a merge counts when it landed) after the phase's
 * description was last written, and that change any of the plan's files. One `git log` with the
 * plan's paths as literal pathspecs; nothing is fetched. Null when nothing changed, when the phase
 * has no description or the plan no files, and when this checkout has no `origin/<base>` to read.
 * It never refuses: git that fails says so in the line it returns.
 */
export function staleBriefWarning(check: StaleBriefCheck): string | null {
  const { phase, files, writtenAt, base, git } = check;
  if (writtenAt === null || files.length === 0) return null;
  const ref = `refs/remotes/origin/${base}`;
  const known = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (!known.ok && known.code === 1) return null;
  const since = new Date(Math.floor(writtenAt / 1000) * 1000).toISOString();
  const log = git([
    "-c",
    "core.quotePath=false",
    "--literal-pathspecs",
    "log",
    "--first-parent",
    "--diff-merges=first-parent",
    `${sinceFlag(git)}=${since}`,
    "--format=%x1e%h%x09%ct%x09%s",
    "--name-only",
    ref,
    "--",
    ...files,
  ]);
  const brief = `the brief of #${phase.number}`;
  if (!known.ok || !log.ok)
    return `Warning: ${brief} was not checked against origin/${base}: git could not read it (${(known.ok ? log.err : known.err) || "no reason given"})`;
  const changed: string[] = [];
  let newest: string | null = null;
  for (const entry of log.out.split("\x1e")) {
    const [head = "", ...paths] = entry.split("\n");
    const [sha = "", seconds = "", subject = ""] = head.split("\t");
    // `--since` counts whole seconds: a commit in the same second as the write is not after it.
    if (sha === "" || Number(seconds) * 1000 <= writtenAt) continue;
    newest ??= `${sha} "${subject}"`;
    for (const path of paths) if (path !== "" && !changed.includes(path)) changed.push(path);
  }
  if (newest === null || changed.length === 0) return null;
  const shown = changed.slice(0, STALE_BRIEF_FILES);
  const more = changed.length > shown.length ? ` and ${changed.length - shown.length} more` : "";
  return `Warning: ${brief} may be stale: origin/${base} changed ${shown.join(", ")}${more} after it was written (newest: ${newest}). Read those changes before you build on it.`;
}
