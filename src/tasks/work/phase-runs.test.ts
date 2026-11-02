import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "../../testing/temp";
import { crewTaskView } from "../guard-view";
import { openWorkDb, type WorkDb, workDbFile } from "./db";
import { eventsOf, taskById } from "./queries";
import { phaseProgressByCrew, type ReadState, statusTask } from "./read";
import { createTask, ensurePhaseTask, systemClose, updateTask } from "./store";
import { crewPhaseTree } from "./tree";
import type { Result, WorkEvent } from "./types";

const lead = { sessionId: "lead-1", crewId: null, pid: 7, procStart: "70" };
const crewA = { sessionId: "crew-1", crewId: "crew-a", pid: 8, procStart: "80" };
const crewB = { sessionId: "crew-2", crewId: "crew-b", pid: 9, procStart: "90" };
const kit = { sessionId: null, crewId: null, pid: null, procStart: null };
const TOOK = "crew session phase-a-2 took the phase";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function ready<T>(read: ReadState<T>): T {
  if (read.state !== "ready") throw new Error(read.state);
  return read.value;
}
function world() {
  const stateDir = tempDir();
  const claudeConfigDir = tempDir();
  const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
  const where = {
    stateDir,
    claudeConfigDir,
    settingsFile: join(claudeConfigDir, "settings.json"),
    project: "p",
    listId: "none",
  };
  return { db, stateDir, where };
}
/** What `crew start` writes: the plan task is #1, the phase task #2. */
function phase(db: WorkDb, crewId: string, now: number, reason?: string) {
  return value(
    ensurePhaseTask(
      db,
      {
        project: "p",
        plan: "plan",
        phase: "a",
        subject: "Phase A",
        description: "",
        crewId,
        waitsForPhases: [],
        ...(reason === undefined ? {} : { reason }),
      },
      lead,
      now,
    ),
  );
}
const entry = (event: WorkEvent | undefined) => {
  if (!event) throw new Error("no entry");
  const { id: _id, taskId: _taskId, ...rest } = event;
  return rest;
};

test("a phase started again after `crew rm` opens again, and the old session's closed subtasks hold nothing", () => {
  const { db, stateDir, where } = world();
  const first = phase(db, "crew-a", 1);
  const finished = value(
    createTask(db, { project: "p", subject: "Old step", parentId: first.id }, crewA, 2),
  );
  value(updateTask(db, finished.id, { status: "done" }, crewA, 3));
  value(createTask(db, { project: "p", subject: "Old open", parentId: first.id }, crewA, 4));
  value(systemClose(db, first.id, "dropped", "removed by crew rm", kit, 5));

  const again = phase(db, "crew-b", 6, TOOK);
  expect(again.id).toBe(first.id);
  expect(again.status).toBe("pending");
  expect(again.closedAt).toBeNull();
  expect(entry(eventsOf(db, again).at(-1))).toEqual({
    number: 2,
    at: 6,
    action: "changed",
    changes: { status: ["dropped", "pending"], crew: ["crew-a", "crew-b"] },
    sessionId: "lead-1",
    sessionName: null,
    crewId: null,
    pid: 7,
    reason: TOOK,
  });

  // The first-edit gate holds the new session until it lists its own work.
  expect(crewTaskView({ ...where, crewId: "crew-b" }).listed).toBe(false);
  expect(ready(phaseProgressByCrew({ stateDir }, ["p"])).get("p:crew-b")).toEqual({
    closed: 0,
    total: 0,
  });

  value(createTask(db, { project: "p", subject: "New step", parentId: again.id }, crewB, 7));
  const view = crewTaskView({ ...where, crewId: "crew-b" });
  expect(view.listed).toBe(true);
  expect(view.open).toEqual([{ ref: "#5", subject: "New step", status: "pending" }]);
  expect(ready(phaseProgressByCrew({ stateDir }, ["p"])).get("p:crew-b")).toEqual({
    closed: 0,
    total: 1,
  });
  expect(ready(statusTask({ stateDir }, "p", crewB))).toEqual({
    number: 2,
    subject: "Phase A",
    closed: 0,
    total: 1,
  });
  const tree = ready(crewPhaseTree({ stateDir }, "p", "crew-b")).phase;
  // The crew page still shows the old session's record; its counts are the new session's.
  expect(tree?.children.map((node) => node.ref)).toEqual(["#5", "#4", "#3"]);
  expect([tree?.closed, tree?.total]).toEqual([0, 1]);

  // The merge closes it: the phase is the new session's and open, so nothing returns early.
  expect(value(systemClose(db, again.id, "done", "merged", kit, 8)).status).toBe("done");
  db.close();
});

test("a continuation takes its predecessor's subtasks over, so they count on", () => {
  const { db, stateDir, where } = world();
  const first = phase(db, "crew-a", 1);
  const finished = value(
    createTask(db, { project: "p", subject: "Step one", parentId: first.id }, crewA, 2),
  );
  value(updateTask(db, finished.id, { status: "done" }, crewA, 3));
  value(createTask(db, { project: "p", subject: "Step two", parentId: first.id }, crewA, 4));

  const next = phase(db, "crew-b", 5, TOOK);
  expect(next.status).toBe("pending");
  const carried = taskById(db, finished.id);
  expect([carried.crewId, carried.updatedAt]).toEqual(["crew-b", 3]);
  expect(entry(eventsOf(db, carried).at(-1))).toEqual({
    number: 3,
    at: 5,
    action: "changed",
    changes: { crew: ["crew-a", "crew-b"] },
    sessionId: "lead-1",
    sessionName: null,
    crewId: null,
    pid: 7,
    reason: TOOK,
  });

  expect(crewTaskView({ ...where, crewId: "crew-b" }).listed).toBe(true);
  expect(ready(phaseProgressByCrew({ stateDir }, ["p"])).get("p:crew-b")).toEqual({
    closed: 1,
    total: 2,
  });
  expect(ready(statusTask({ stateDir }, "p", crewB))).toEqual({
    number: 2,
    subject: "Phase A",
    closed: 1,
    total: 2,
  });
  db.close();
});
