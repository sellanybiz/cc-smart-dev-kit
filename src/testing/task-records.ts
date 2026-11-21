import type { RecordedBranches } from "../worktrees/scan";

/** No open task records any branch, which is what a test without a task store means. */
export const NO_TASK_RECORDS: RecordedBranches = { ok: true, byBranch: new Map() };
