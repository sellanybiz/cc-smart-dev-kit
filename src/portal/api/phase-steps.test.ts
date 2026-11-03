/**
 * A phase's steps on the Tasks tab's ledger (G3): its blocking work done, of its blocking work.
 * The store is a temp folder's; every expected count is written by hand.
 */
import { expect, test } from "bun:test";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "../../tasks/work/db";
import { allTasks } from "../../tasks/work/queries";
import { createTask, type LaidPhase, layPhase, updateTask } from "../../tasks/work/store";
import type { Result, Who, WorkStatus } from "../../tasks/work/types";
import { tempDir } from "../../testing/temp";
import { phaseSteps } from "./phase-steps";

const who: Who = { sessionId: "s", pid: 1, procStart: "1" };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

function store(): WorkDb {
  return openWorkDb(workDbFile({ stateDir: tempDir("phase-steps") }), { mode: "write" });
}

function phase(db: WorkDb, input: Omit<LaidPhase, "plan" | "project" | "subject">) {
  const laid = { plan: "launch", project: "p", subject: `Phase ${input.phase}`, ...input };
  return value(writeWork(db, () => layPhase(db, laid, who, 1).task));
}

function step(
  db: WorkDb,
  parentId: string,
  status: WorkStatus,
  type: "blocking" | "non-blocking" = "blocking",
) {
  const made = value(createTask(db, { parentId, project: "p", subject: "A step", type }, who, 1));
  if (status !== "pending") value(updateTask(db, made.id, { status }, who, 2));
  return made;
}

test("a phase's steps: its blocking work done, of its blocking work, a dropped one left out", () => {
  const db = store();
  const api = phase(db, { phase: "api" });
  step(db, api.id, "done");
  step(db, api.id, "done");
  step(db, api.id, "in_progress");
  step(db, api.id, "dropped");
  // A blocking subtask under a blocking task is a step of the phase too, and so is the task.
  const task = step(db, api.id, "done");
  step(db, task.id, "done");
  step(db, task.id, "pending");
  // Non-blocking work holds nothing, and neither does what sits under it.
  const note = step(db, api.id, "pending", "non-blocking");
  step(db, note.id, "pending");
  const steps = phaseSteps(allTasks(db, "p"));
  db.close();
  // Done: the two done steps, the done task and its done subtask. To do: one in progress, one
  // pending subtask. The dropped step and the non-blocking branch count nowhere.
  expect(steps.get(api.id)).toEqual({ done: 4, total: 6 });
});

test("a phase with no steps yet is 0 of 0; a plan or a task has no steps of its own", () => {
  const db = store();
  const empty = phase(db, { phase: "empty" });
  const full = phase(db, { phase: "full" });
  step(db, full.id, "done");
  const loose = value(createTask(db, { project: "p", subject: "Loose" }, who, 1));
  step(db, loose.id, "done");
  const tasks = allTasks(db, "p");
  db.close();
  const steps = phaseSteps(tasks);
  expect(steps.get(empty.id)).toEqual({ done: 0, total: 0 });
  expect(steps.get(full.id)).toEqual({ done: 1, total: 1 });
  expect(steps.has(loose.id)).toBe(false);
  expect(steps.has(empty.parentId ?? "")).toBe(false);
  // Only the two phases: the plan, the loose task and the steps have no entry.
  expect(steps.size).toBe(2);
});
