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
