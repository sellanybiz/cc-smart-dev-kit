/**
 * A session's to-do list (`tasks.ts`): where Claude Code keeps it, what the kit reads out of
 * one, and the one cache a hook keeps between two calls.
 *
 * The shapes here are Claude Code's own, written by hand: the files a live run left under
 * `<config dir>/tasks/<session id>/` on 2.1.309 (`docs/claude-code-contract.md`
 * § The to-do list) — `1.json` with `{id, subject, description, activeForm, status, blocks,
 * blockedBy}`, a `.lock` beside them, and a task created without an `activeForm` that has
 * none. A unit proof tests our reader on those files; it does not prove Claude Code still
 * writes them.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  OPEN_TASK_STATUSES,
  openTasks,
  readSessionTasks,
  readTaskGate,
  sessionTasksDir,
  TASK_LIST_ENV,
  taskGateFile,
  taskListId,
  writeTaskGate,
} from "./tasks";

/** A task file, as Claude Code writes one, in `folder`. */
function taskFile(folder: string, n: number, change: Record<string, unknown> = {}): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, `${n}.json`),
    `${JSON.stringify(
      {
        id: String(n),
        subject: `Part ${n}`,
        description: `the part ${n}`,
        activeForm: `Doing part ${n}`,
        status: "pending",
        blocks: [],
        blockedBy: [],
        ...change,
      },
      null,
      2,
    )}\n`,
  );
}

describe("where a session's list is", () => {
  test("one folder per list, under the config dir's tasks; the session id is the folder", () => {
    expect(sessionTasksDir("/config", "aaaa1111-2222")).toBe(
      join("/config", "tasks", "aaaa1111-2222"),
    );
    expect(taskListId({}, "aaaa1111-2222")).toBe("aaaa1111-2222");
    expect(taskListId({}, null)).toBe("");
    expect(taskListId({}, "")).toBe("");
  });

  test("CLAUDE_CODE_TASK_LIST_ID names the folder instead of the session id", () => {
    // The docs' own way to share one list across sessions (code.claude.com/docs/en/env-vars,
    // read 2026-10-23; proved live: the folder was `tasks/shared-list/`).
    expect(taskListId({ [TASK_LIST_ENV]: "shared-list" }, "aaaa1111-2222")).toBe("shared-list");
    expect(taskListId({ [TASK_LIST_ENV]: "  shared-list  " }, null)).toBe("shared-list");
    expect(TASK_LIST_ENV).toBe("CLAUDE_CODE_TASK_LIST_ID");
  });
});

describe("reading a list", () => {
  test("the tasks in their number's order, with the status each file carries", () => {
    const config = tempDir("config");
    const folder = sessionTasksDir(config, "session-1");
    taskFile(folder, 2, { status: "completed" });
    taskFile(folder, 1, { status: "in_progress" });
    taskFile(folder, 10);
    writeFileSync(join(folder, ".lock"), "");
    const read = readSessionTasks(config, "session-1");
    expect(read).toEqual({
      state: "read",
      files: 3,
      tasks: [
        { id: "1", status: "in_progress", subject: "Part 1" },
        { id: "2", status: "completed", subject: "Part 2" },
        { id: "10", status: "pending", subject: "Part 10" },
      ],
    });
  });

  test("a deleted task's file is gone: the list is what is left", () => {
    // Proved live: removing a task leaves its file removed and a `.highwatermark` beside the
    // others; nothing rewrites the files that stay.
    const config = tempDir("config");
    const folder = sessionTasksDir(config, "session-1");
    taskFile(folder, 1);
    taskFile(folder, 2);
    rmSync(join(folder, "2.json"));
    writeFileSync(join(folder, ".highwatermark"), "2");
    const read = readSessionTasks(config, "session-1");
    expect(read.state).toBe("read");
    if (read.state !== "read") return;
    expect(read.files).toBe(1);
    expect(read.tasks.map((task) => task.id)).toEqual(["1"]);
  });

  test("no folder: none. A folder that cannot be read (a file where the folder belongs): unreadable", () => {
    const config = tempDir("config");
    expect(readSessionTasks(config, "never")).toEqual({ state: "none" });
    expect(readSessionTasks(config, "")).toEqual({ state: "none" });
    // A file where the list's folder belongs: the kit cannot say the list is empty.
    mkdirSync(join(config, "tasks"));
    writeFileSync(join(config, "tasks", "not-a-folder"), "{}");
    expect(readSessionTasks(config, "not-a-folder")).toEqual({ state: "unreadable" });
  });

  test("a task without an activeForm, as a live subagent's TaskCreate wrote one, still reads", () => {
    const config = tempDir("config");
    const folder = sessionTasksDir(config, "session-1");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "2.json"),
      `${JSON.stringify({
        id: "2",
        subject: "subagent task",
        description: "made by the subagent",
        status: "pending",
        blocks: [],
        blockedBy: [],
      })}\n`,
    );
    const read = readSessionTasks(config, "session-1");
    expect(read.state === "read" ? read.tasks : []).toEqual([
      { id: "2", status: "pending", subject: "subagent task" },
    ]);
  });

  test("a file that is not a task file is counted in the folder, and is no task", () => {
    const config = tempDir("config");
    const folder = sessionTasksDir(config, "session-1");
    taskFile(folder, 1);
    writeFileSync(join(folder, "notes.txt"), "not a task\n");
    writeFileSync(join(folder, "2.json"), "{ not json");
    writeFileSync(join(folder, "3.json"), JSON.stringify({ subject: "no status" }));
    const read = readSessionTasks(config, "session-1");
    expect(read.state).toBe("read");
    if (read.state !== "read") return;
    // `notes.txt` is not a task file; the two broken `*.json` files are counted and skipped.
    expect(read.files).toBe(3);
    expect(read.tasks).toEqual([{ id: "1", status: "pending", subject: "Part 1" }]);
  });
});

describe("what is still open", () => {
  test("pending and in_progress are open; completed is closed; an unknown word is not held", () => {
    expect([...OPEN_TASK_STATUSES]).toEqual(["pending", "in_progress"]);
    const tasks = [
      { id: "1", status: "pending", subject: "one" },
      { id: "2", status: "in_progress", subject: "two" },
      { id: "3", status: "completed", subject: "three" },
      { id: "4", status: "a newer kit's word", subject: "four" },
    ];
    expect(openTasks(tasks).map((task) => task.id)).toEqual(["1", "2"]);
    expect(openTasks([])).toEqual([]);
  });
});

describe("the cache a hook keeps", () => {
  test("one file per crew session, in its own store folder; a list id it does not name: null", () => {
    const stateDir = tempDir("state");
    const repo = tempDir("repo");
    const file = taskGateFile(stateDir, repo, "B1-x-1a2b3c");
    expect(file.endsWith(join("files", "B1-x-1a2b3c", "task-gate.json"))).toBe(true);
    expect(readTaskGate(stateDir, repo, "B1-x-1a2b3c")).toBeNull();
    writeTaskGate(stateDir, repo, "B1-x-1a2b3c", { listId: "aaaa1111-2222" });
    expect(readTaskGate(stateDir, repo, "B1-x-1a2b3c")).toEqual({ listId: "aaaa1111-2222" });
    // A gate file the kit cannot read is no gate: the hook reads the folder again.
    writeFileSync(file, "{ not json");
    expect(readTaskGate(stateDir, repo, "B1-x-1a2b3c")).toBeNull();
  });

  test("an id the store refuses is no gate, never a throw: this runs before every edit", () => {
    const stateDir = tempDir("state");
    const repo = tempDir("repo");
    expect(readTaskGate(stateDir, repo, "../../etc")).toBeNull();
    expect(readTaskGate(stateDir, repo, "")).toBeNull();
  });
});
