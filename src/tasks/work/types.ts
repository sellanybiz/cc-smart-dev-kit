export type WorkStatus = "pending" | "in_progress" | "done" | "dropped";
export type WorkKind = "task" | "plan" | "phase";
export const SUBJECT_LIMIT = 200;
export const DESCRIPTION_LIMIT = 200_000;
export const NOTE_LIMIT = 64_000;
export interface Who {
  sessionId: string | null;
  crewId: string | null;
  pid: number | null;
  procStart: string | null;
  /** The session's name, as Claude Code shows it (`callerOf`); absent or null when unknown. */
  name?: string | null;
}
/** What a change did to a task, as its history records it. */
export type WorkEventAction = "created" | "changed" | "noted" | "closed" | "deleted";
/**
 * One entry in a task's history: written in the same transaction as the change, never edited,
 * and kept after the task is deleted. `changes` holds each field's value before and after.
 */
export interface WorkEvent {
  id: number;
  taskId: string;
  number: number;
  at: number;
  action: WorkEventAction;
  changes: Record<string, [unknown, unknown]>;
  sessionId: string | null;
  sessionName: string | null;
  crewId: string | null;
  pid: number | null;
  /** Why the kit itself made the change (a merge, a removal, an import); null for a session's own. */
  reason: string | null;
}
export interface WorkClaim {
  pid: number;
  procStart: string | null;
  sessionId: string | null;
}
export interface WorkTask {
  id: string;
  number: number;
  project: string;
  parentId: string | null;
  kind: WorkKind;
  subject: string;
  description: string;
  status: WorkStatus;
  plan: string | null;
  phase: string | null;
  crewId: string | null;
  createdBy: string | null;
  claim: WorkClaim | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  waitsFor: string[];
}
export interface WorkTree extends WorkTask {
  children: WorkTree[];
}
export interface WorkNote {
  id: number;
  taskId: string;
  text: string;
  sessionId: string | null;
  crewId: string | null;
  at: number;
}
export type Result<T> = { ok: true; value: T } | { ok: false; why: string };
