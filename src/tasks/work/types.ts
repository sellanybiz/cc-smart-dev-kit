export type WorkStatus = "pending" | "in_progress" | "done" | "dropped";
export type WorkKind = "task" | "plan" | "phase";
/**
 * The stored kind is the layer: a plan holds phases, a phase holds tasks, a task holds nothing.
 */
export type WorkLayer = "plan" | "phase" | "task";
/**
 * Whether an open task holds its parent's done. Non-blocking work holds nothing.
 */
export type WorkType = "blocking" | "non-blocking";
export const SUBJECT_LIMIT = 200;
export const DESCRIPTION_LIMIT = 200_000;
export const NOTE_LIMIT = 64_000;
export interface Who {
  sessionId: string | null;
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
  pid: number | null;
  /** Why the kit itself made the change (a merge, a removal, an import); null for a session's own. */
  reason: string | null;
}
export interface WorkClaim {
  pid: number;
  procStart: string | null;
  sessionId: string | null;
}
/**
 * The two questions about a claim's process. `live`: does it run, proved (a claim not proved
 * live is free to take). `gone`: is it proved to have ended (only then may the caller's own
 * session move the claim to itself). A process that runs but cannot be proved either way is
 * neither.
 */
export interface ClaimProcess {
  live(claim: WorkClaim): boolean;
  gone(claim: WorkClaim): boolean;
}
/**
 * The lead a plan is reserved for (`reservePlan`): the session and process that handed the plan
 * out, or that builds it itself. Judged by the same rule as an owner (`isLead`): its session id,
 * or the same process, so a `/clear` keeps it.
 */
export interface WorkLead {
  sessionId: string | null;
  pid: number | null;
  procStart: string | null;
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
  agent: string | null;
  branch: string | null;
  worktree: string | null;
  base: string | null;
  createdBy: string | null;
  /**
   * The process that made the task, in the shape of a claim (`claimHeldBy` judges both): its pid
   * and start time, and the session id it made the task under. Null for a task made before
   * schema 5, or by a caller with no process.
   */
  creator: WorkClaim | null;
  claim: WorkClaim | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  /** The ids of the tasks it is blocked by (`task_deps`): it cannot start or be done while one is open. */
  waitsFor: string[];
  /** `WorkType`; a store from before schema 2 reads as blocking. */
  type: WorkType;
  /**
   * A plan's file list (`task_files`): repo-relative, `/`-separated, a folder ending in `/`, in
   * path order. Empty for a plan with none, for any other task, and in a store from before schema 6.
   */
  files: string[];
  /** The lead the plan is reserved for; null while it is unreserved, and for any other task. */
  lead: WorkLead | null;
}
export interface WorkTree extends WorkTask {
  children: WorkTree[];
}
export interface WorkNote {
  id: number;
  taskId: string;
  text: string;
  sessionId: string | null;
  at: number;
}
export type Result<T> = { ok: true; value: T } | { ok: false; why: string };
