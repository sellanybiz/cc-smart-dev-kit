import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import { holdingSteps } from "./read";
import { createTask, updateTask } from "./store";
import type { Result } from "./types";

const who = { sessionId: "session", pid: 12, procStart: "34" };
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

test("holdingSteps: the open blocking steps under a task, at any depth; a non-blocking one holds nothing", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const phase = value(
    createTask(db, { project: "p", subject: "The phase", kind: "phase" }, who, 1),
  );
  const step = value(
    createTask(db, { project: "p", subject: "A step", parentId: phase.id }, who, 2),
  );
  value(createTask(db, { project: "p", subject: "Its part", parentId: step.id }, who, 3));
  const done = value(createTask(db, { project: "p", subject: "Done", parentId: phase.id }, who, 4));
  value(updateTask(db, done.id, { status: "done" }, who, 5));
  const aside = value(
    createTask(
      db,
      { project: "p", subject: "Aside", parentId: phase.id, type: "non-blocking" },
      who,
      6,
    ),
  );
  // Under a non-blocking task, a blocking one holds only that task, never the phase.
  value(createTask(db, { project: "p", subject: "Under aside", parentId: aside.id }, who, 7));
  value(updateTask(db, step.id, { status: "in_progress" }, who, 8));
  db.close();

  expect(holdingSteps(paths, "p", 1)).toEqual({
    state: "ready",
    value: {
      number: 1,
      open: [
        { number: 2, subject: "A step" },
        { number: 3, subject: "Its part" },
      ],
    },
  });
  // A task with nothing open under it, a task in no project here, and a number no task has.
  expect(holdingSteps(paths, "p", 4)).toEqual({ state: "ready", value: { number: 4, open: [] } });
  expect(holdingSteps(paths, "other", 1)).toEqual({ state: "ready", value: null });
  expect(holdingSteps(paths, "p", 99)).toEqual({ state: "ready", value: null });
});

test("holdingSteps: no store is none, and never makes one", () => {
  const paths = { stateDir: tempDir() };
  expect(holdingSteps(paths, "p", 1)).toEqual({ state: "none" });
  expect(existsSync(workDbFile(paths))).toBe(false);
});
