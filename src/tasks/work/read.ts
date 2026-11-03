import { existsSync } from "node:fs";
import { openWorkDb, type WorkDb, workDbFile } from "./db";
import { claimLive } from "./identity";
import { allTasks, claimState, holdingUnder, isBlocked, isOpen, subtreeProgress } from "./queries";
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
      .filter(
        (t) =>
          t.status === "in_progress" &&
          t.claim?.pid === who.pid &&
          t.claim?.procStart === who.procStart,
      )
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
