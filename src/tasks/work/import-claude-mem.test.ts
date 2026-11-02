import { expect, test } from "bun:test";
import { claudeMemDb, mistakenImport } from "../../testing/claude-mem-db";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import { type ImportResult, importClaudeMem } from "./import-claude-mem";
import { eventsOf, getTask, notesOf } from "./queries";
import { startView } from "./read";
import { createTask } from "./store";
import type { Result } from "./types";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const who = { sessionId: "session", crewId: null, pid: 12, procStart: "34" };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

test("claude-mem's own lists stay out, and a second run drops what an earlier import took from them", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const file = claudeMemDb([
    ["my-focus", { task: "Focus area: Billing", status: "suggested" }, NOW - DAY],
    ["owner-goals", { task: "Ask: Ship faster", status: "todo" }, NOW - DAY],
    ["owner-goals/2026-10-01", { task: "Ask: An older ask" }, NOW - DAY],
    ["my-rules", { task: "Rule: tests first" }, NOW - DAY],
    ["release-work", { task: "Ship it", status: "todo" }, NOW - DAY],
  ]);
  mistakenImport(db, "p", NOW - DAY);
  // A session's own task under the same name is work: it stays.
  value(createTask(db, { project: "p", subject: "my-focus" }, who, NOW - DAY));
  const args = { claudeMemDb: file, workDb: db, project: "p", claudeMemProject: "home", now: NOW };
  const expected: ImportResult = {
    imported: [
      {
        subject: "release-work",
        description: "",
        status: "pending",
        list: "release-work",
        parent: null,
      },
      {
        subject: "Ship it",
        description: "",
        status: "pending",
        list: "release-work",
        parent: "release-work",
      },
    ],
    dropped: [{ list: "my-focus", number: 1, tasks: 2 }],
    skipped: ["my-focus", "owner-goals", "owner-goals/2026-10-01", "my-rules"],
  };

  expect(value(importClaudeMem({ ...args, dryRun: true }))).toEqual(expected);
  expect(getTask(db, "p", "#1")?.status).toBe("pending");

  expect(value(importClaudeMem({ ...args, dryRun: false }))).toEqual(expected);
  expect(["#1", "#2", "#3", "#4", "#5"].map((ref) => getTask(db, "p", ref)?.status)).toEqual([
    "dropped",
    "dropped",
    "pending",
    "pending",
    "pending",
  ]);
  const listTask = getTask(db, "p", "#1");
  if (!listTask) throw new Error("no list task");
  expect(notesOf(db, listTask).map((note) => note.text)).toEqual([
    "Automatically dropped: claude-mem's own list, not work: an earlier import took it by mistake",
  ]);

  expect(value(importClaudeMem({ ...args, dryRun: false }))).toEqual({
    imported: [],
    dropped: [],
    skipped: ["my-focus", "owner-goals", "owner-goals/2026-10-01", "my-rules"],
  });
  db.close();
});

test("an imported task keeps claude-mem's dates, so an old one counts as stale", () => {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const file = claudeMemDb([
    ["old-list", { note: "kept" }, 10 * DAY],
    ["old-list", { task: "Old step", status: "todo" }, 20 * DAY],
    ["new-list", { task: "New step", status: "todo" }, NOW - DAY],
  ]);
  value(
    importClaudeMem({
      claudeMemDb: file,
      workDb: db,
      project: "p",
      claudeMemProject: "home",
      dryRun: false,
      now: NOW,
    }),
  );
  const dates = (ref: string) => {
    const task = getTask(db, "p", ref);
    return [task?.subject, task?.createdAt, task?.updatedAt];
  };
  expect(["#1", "#2", "#3", "#4"].map(dates)).toEqual([
    ["old-list", 10 * DAY, 20 * DAY],
    ["Old step", 20 * DAY, 20 * DAY],
    ["new-list", NOW - DAY, NOW - DAY],
    ["New step", NOW - DAY, NOW - DAY],
  ]);
  // The history still says when the kit imported it.
  const old = getTask(db, "p", "#1");
  if (!old) throw new Error("no task");
  expect(eventsOf(db, old)[0]?.at).toBe(NOW);
  db.close();

  const view = startView(paths, "p", who, { limit: 8, staleBefore: NOW - 30 * DAY });
  if (view.state !== "ready") throw new Error(view.state);
  expect(view.value.tasks.map((task) => task.subject)).toEqual(["new-list", "New step"]);
  expect(view.value.stale).toBe(2);
});
