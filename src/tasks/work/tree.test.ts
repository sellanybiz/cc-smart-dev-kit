import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { legacyCreateTask as createTask } from "../../testing/claude-mem-db";
import { tempDir } from "../../testing/temp";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./db";
import { type LaidPhase, layPhase, updateTask } from "./store";
import type { Who } from "./types";

function createPhase(db: WorkDb, input: LaidPhase, who: Who, now: number) {
  return writeWork(db, () => layPhase(db, input, who, now).task);
}

import { projectTaskTree, TREE_TASK_LIMIT } from "./tree";
import type { Result } from "./types";

const who = { sessionId: "s", pid: 1, procStart: "1" };
const DAY = 86_400_000;
const NOW = 100 * DAY;

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

test("plan, phase and tasks as one tree, with membership and subtree counts", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const phase = value(
    createPhase(
      db,
      {
        project: "p",
        plan: "plan",
        phase: "a",
        subject: "Phase A",
        description: "",
      },
      who,
      NOW - 2 * DAY,
    ),
  );
  const one = value(
    createTask(db, { project: "p", subject: "One", parentId: phase.id }, who, NOW - DAY),
  );
  value(createTask(db, { project: "p", subject: "Two", parentId: phase.id }, who, NOW - DAY));
  value(updateTask(db, one.id, { status: "done" }, who, NOW - DAY));
  const old = value(
    createTask(db, { project: "p", subject: "Old and closed" }, who, NOW - 30 * DAY),
  );
  value(updateTask(db, old.id, { status: "done" }, who, NOW - 30 * DAY));
  const recent = value(createTask(db, { project: "p", subject: "Closed today" }, who, NOW - DAY));
  value(updateTask(db, recent.id, { status: "dropped" }, who, NOW - 1000));
  value(createTask(db, { project: "other", subject: "Another project" }, who, NOW));
  db.close();

  const tree = projectTaskTree(paths, "p", { now: NOW, recentMs: 7 * DAY });
  if (tree.state !== "ready") throw new Error(tree.state);
  const outline = (nodes: typeof tree.value.roots, depth = 0): string[] =>
    nodes.flatMap((node) => [
      `${"  ".repeat(depth)}${node.ref} ${node.subject} [${node.status}] ${node.closed}/${node.total}`,
      ...outline(node.children, depth + 1),
    ]);
  // The plan task is open (its phase is open), so it comes first; the old closed task is gone.
  // Each level lists open work first: Two before One, which is done.
  expect(outline(tree.value.roots)).toEqual([
    // A plan counts its phases: the one here is open.
    "#1 plan [pending] 0/1",
    "  #2 Phase A [pending] 1/2",
    "    #4 Two [pending] 0/0",
    "    #3 One [done] 0/0",
    "#6 Closed today [dropped] 0/0",
  ]);
  expect(tree.value.more).toBe(0);
});

test("past the limit the rest is counted, subtrees included", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  for (let index = 0; index < TREE_TASK_LIMIT; index++) {
    value(createTask(db, { project: "p", subject: `Task ${index}` }, who, NOW - DAY - index));
  }
  const last = value(createTask(db, { project: "p", subject: "Oldest" }, who, NOW - 2 * DAY));
  value(
    createTask(db, { project: "p", subject: "Its child", parentId: last.id }, who, NOW - 2 * DAY),
  );
  db.close();
  const tree = projectTaskTree(paths, "p", { now: NOW, recentMs: 7 * DAY });
  if (tree.state !== "ready") throw new Error(tree.state);
  expect(tree.value.roots).toHaveLength(TREE_TASK_LIMIT);
  expect(tree.value.more).toBe(2);
});

test("no store, and a store that cannot be read", () => {
  expect(projectTaskTree({ stateDir: tempDir() }, "p", { now: NOW, recentMs: DAY })).toEqual({
    state: "none",
  });
  const broken = { stateDir: tempDir() };
  mkdirSync(join(broken.stateDir, "tasks"));
  writeFileSync(workDbFile(broken), "not a database");
  expect(projectTaskTree(broken, "p", { now: NOW, recentMs: DAY }).state).toBe("unreadable");
});
