import { existsSync } from "node:fs";
import { openWorkDb, type WorkDb, workDbFile } from "./db";
import { claimLive } from "./identity";
import {
  allTasks,
  claimHeldBy,
  claimState,
  eventsOf,
  getTask,
  holdingUnder,
  isBlocked,
  isOpen,
  notesOf,
  subtreeProgress,
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
function own(db: WorkDb, project: string, sessionIds: string[], plan?: string) {
  return allTasks(db, project).filter(
    (t) =>
      t.kind === "task" &&
      t.createdBy !== null &&
      sessionIds.includes(t.createdBy) &&
      (!plan || t.plan === plan),
  );
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
      .map((t) => ({ task: t, claim: claimState(t, claimLive, who) }));
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
/** The latest task claimed by this process and its progress. */
export function statusTask(paths: Paths, project: string, who: Who) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const task = all
      .filter((t) => t.status === "in_progress" && claimHeldBy(t.claim, who))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!task) return null;
    const count = subtreeProgress(all, task.id);
    return { number: task.number, subject: task.subject, closed: count.closed, total: count.total };
  });
}

export function hasOwnTask(paths: Paths, project: string, sessionIds: string[]) {
  return readWorkStore(paths, (db) => own(db, project, sessionIds).some(isOpen));
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

/** Current claimed work and task-only progress, by plan membership rather than nesting. */
export function planProgress(paths: Paths, project: string, who: Who) {
  return readWorkStore(paths, (db) => {
    const all = allTasks(db, project);
    const started = (id: string) =>
      eventsOf(db, id)
        .filter((e) => e.changes.status?.[1] === "in_progress")
        .at(-1)?.at ??
      all.find((t) => t.id === id)?.createdAt ??
      0;
    const task = all
      .filter(
        (t) =>
          t.status === "in_progress" &&
          (claimHeldBy(t.claim, who) ||
            (who.pid === null && who.sessionId !== null && t.createdBy === who.sessionId)),
      )
      .sort((a, b) => started(b.id) - started(a.id) || b.number - a.number)[0];
    if (!task) return null;
    const plan =
      task.plan === null
        ? null
        : (all.find((t) => t.kind === "plan" && t.plan === task.plan) ?? null);
    const tasks =
      task.plan === null ? [] : all.filter((t) => t.kind === "task" && t.plan === task.plan);
    return { task, plan, closed: tasks.filter((t) => !isOpen(t)).length, total: tasks.length };
  });
}
/** Task detail from the same read-only store as the tree. Ids are unique across projects. */
export function taskDetail(paths: Paths, id: string) {
  return readWorkStore(paths, (db) => {
    const row = db.sqlite
      .query<{ project: string }, [string]>("SELECT project FROM tasks WHERE id=?")
      .get(id);
    if (!row) return null;
    const task = getTask(db, row.project, id);
    return task === null ? null : { task, notes: notesOf(db, task), events: eventsOf(db, task) };
  });
}
