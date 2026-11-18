import { existsSync } from "node:fs";
import { openWorkDb, type WorkDb, workDbFile } from "./db";
import { historyChanges } from "./history";
import { CLAIM_PROCESS, claimGone } from "./identity";
import {
  allTasks,
  claimIsMine,
  claimState,
  eventsOf,
  getTask,
  holdingUnder,
  isBlocked,
  isOpen,
  layerProgress,
  notesOf,
  ownerOf,
  PARK_NOTE_PREFIX,
  waitingPlans,
} from "./queries";
import type { Who } from "./types";
export type ReadState<T> =
  | { state: "ready"; value: T }
  | { state: "none" }
  | { state: "unreadable"; why: string };
type Paths = { stateDir: string };
/**
 * Every read a hook, the board or the portal makes: never creates or migrates the store (a
 * missing one is `none`), never takes the write lock, and says a store it cannot read rather
 * than answer with an empty list.
 */
export function readWorkStore<T>(paths: Paths, body: (db: WorkDb) => T): ReadState<T> {
  let db: WorkDb | undefined;
  try {
    const file = workDbFile(paths);
    if (!existsSync(file)) return { state: "none" };
    db = openWorkDb(file, { mode: "hook" });
    return { state: "ready", value: body(db) };
  } catch (error) {
    return { state: "unreadable", why: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}
export function startView(
  paths: Paths,
  project: string,
  who: Who,
  options: { limit: number; staleBefore?: number },
) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const byId = new Map(all.map((t) => [t.id, t]));
    const open = all
      .filter((t) => isOpen(t))
      .map((t) => ({ task: t, claim: claimState(t, CLAIM_PROCESS, who) }));
    const shown = open.filter(
      ({ task, claim }) =>
        claim === "mine" ||
        options.staleBefore === undefined ||
        task.updatedAt >= options.staleBefore,
    );
    shown.sort(
      (a, b) =>
        Number(b.claim === "mine") - Number(a.claim === "mine") ||
        Number(b.task.status === "in_progress") - Number(a.task.status === "in_progress") ||
        b.task.updatedAt - a.task.updatedAt ||
        a.task.number - b.task.number,
    );
    const limit = Math.max(0, Math.floor(options.limit));
    return {
      tasks: shown.slice(0, limit).map(({ task, claim }) => ({
        id: task.id,
        number: task.number,
        subject: task.subject,
        status: task.status,
        claim,
        type: task.type,
        blocked: isBlocked(task, byId),
      })),
      more: Math.max(0, shown.length - limit),
      stale: open.length - shown.length,
    };
  });
}
/** Whether the caller has an open task of its own (`ownerOf`: by session id, claim or maker process). */
export function hasOwnTask(paths: Paths, project: string, who: Who) {
  return readWorkStore(paths, (db) => {
    const owns = ownerOf(who);
    return allTasks(db, project).some((t) => t.kind === "task" && owns(t) && isOpen(t));
  });
}

/**
 * Task `#number` and the open tasks that hold its done (`holdingUnder`: open blocking tasks at
 * any depth, reached through blocking tasks only), in progress first: what a builder's
 * hand-back waits on (`src/hooks/builder-finish.ts`). Null when no task has that number.
 */
export function holdingSteps(paths: Paths, project: string, number: number) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const task = all.find((t) => t.number === number);
    if (!task) return null;
    return {
      number: task.number,
      open: holdingUnder(all, task.id).map((t) => ({ number: t.number, subject: t.subject })),
    };
  });
}

/**
 * Current claimed work and its counts, by plan membership rather than nesting: the plan's
 * phases closed of all (null when it has none), and the tasks of the current phase, or of the
 * plan itself when it has no phase (null when neither applies, and for loose work).
 */
export function planProgress(paths: Paths, project: string, who: Who) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const started = (id: string) =>
      eventsOf(db, id)
        .filter((e) => e.changes.status?.[1] === "in_progress")
        .at(-1)?.at ??
      all.find((t) => t.id === id)?.createdAt ??
      0;
    // The current work is what this process has claimed, or its session left claimed in a process
    // that is gone (`resumedClaim`), not everything it owns (`ownerOf`): a task it made that
    // another process runs is not its work now. A caller with no process
    // (`who.pid` null) holds no claim, so its own running tasks stand in.
    const task = all
      .filter(
        (t) =>
          t.status === "in_progress" &&
          (claimIsMine(t.claim, who, claimGone) ||
            (who.pid === null && who.sessionId !== null && t.createdBy === who.sessionId)),
      )
      .sort((a, b) => started(b.id) - started(a.id) || b.number - a.number)[0];
    if (!task) return null;
    const plan =
      task.plan === null
        ? null
        : (all.find((t) => t.kind === "plan" && t.plan === task.plan) ?? null);
    const phase =
      task.kind === "phase"
        ? task
        : (all.find((t) => t.kind === "phase" && t.id === task.parentId) ?? null);
    if (task.plan === null) return { task, plan, phase, phases: null, tasks: null, waiting: null };
    // By plan membership: the plan task itself need not exist for its phases or tasks to count.
    const ofPlan = layerProgress(all, { id: "", kind: "plan", plan: task.plan });
    const hasPhases = all.some((t) => t.kind === "phase" && t.plan === task.plan);
    // The caller's other open plans behind this one, by the rule the task tools own them by.
    const waiting = waitingPlans(all, ownerOf(who), task.plan, (p) =>
      notesOf(db, p).some((n) => n.text.startsWith(PARK_NOTE_PREFIX)),
    );
    return {
      task,
      plan,
      phase,
      phases: hasPhases ? ofPlan : null,
      tasks: phase !== null ? layerProgress(all, phase) : hasPhases ? null : ofPlan,
      waiting,
    };
  });
}
/**
 * Task detail from the same read-only store as the tree. Ids are unique across projects. Each
 * history entry carries its changes in words (`historyChanges`), the ones `task_get` prints.
 */
export function taskDetail(paths: Paths, id: string) {
  return readWorkStore(paths, (db) => {
    const row = db.sqlite
      .query<{ project: string }, [string]>("SELECT project FROM tasks WHERE id=?")
      .get(id);
    if (!row) return null;
    const task = getTask(db, row.project, id);
    if (task === null) return null;
    const events = eventsOf(db, task).map((event) => ({ ...event, lines: historyChanges(event) }));
    return { task, notes: notesOf(db, task), events };
  });
}
