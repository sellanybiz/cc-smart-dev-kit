import { existsSync } from "node:fs";
import { readProcStat } from "../../jobs/ancestry";
import { openWorkDb, type WorkDb, workDbFile } from "./db";
import { allTasks, claimState, descendants, isOpen, openSubtasks } from "./queries";
import type { Who, WorkClaim } from "./types";
export type ReadState<T> =
  | { state: "ready"; value: T }
  | { state: "none" }
  | { state: "unreadable"; why: string };
type Paths = { stateDir: string };
function read<T>(paths: Paths, body: (db: WorkDb) => T): ReadState<T> {
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
export function crewPhaseState(paths: Paths, project: string, crewId: string) {
  return read(paths, (db) => {
    const phase =
      allTasks(db, project).find((t) => t.kind === "phase" && t.crewId === crewId) ?? null;
    return {
      phase,
      openSubtasks: phase ? openSubtasks(db, phase.id) : [],
      total: phase ? descendants(db, phase.id).length : 0,
    };
  });
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
export function leadOwnState(paths: Paths, project: string, plan: string, sessionIds: string[]) {
  return read(paths, (db) => {
    const tasks = own(db, project, sessionIds, plan);
    return { inProgress: tasks.filter((t) => t.status === "in_progress"), total: tasks.length };
  });
}
function claimLive(claim: WorkClaim): boolean {
  if (claim.procStart === null) return false;
  const stat = readProcStat(claim.pid);
  return (
    stat
      ?.slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/)[19] === claim.procStart
  );
}
export function startView(paths: Paths, project: string, who: Who, options: { limit: number }) {
  return read(paths, (db) => {
    const tasks = allTasks(db, project)
      .filter(isOpen)
      .sort(
        (a, b) =>
          Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
          b.updatedAt - a.updatedAt ||
          a.number - b.number,
      );
    const limit = Math.max(0, Math.floor(options.limit));
    return {
      tasks: tasks.slice(0, limit).map((t) => ({
        id: t.id,
        number: t.number,
        subject: t.subject,
        status: t.status,
        claim: claimState(t, claimLive, who),
      })),
      more: Math.max(0, tasks.length - limit),
    };
  });
}
export function hasOwnTask(paths: Paths, project: string, sessionIds: string[]) {
  return read(paths, (db) => own(db, project, sessionIds).some(isOpen));
}
