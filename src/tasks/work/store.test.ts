import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { legacyCreateTask as createTask } from "../../testing/claude-mem-db";
import { subprocessGuard } from "../../testing/port-guard";
import { cleanGitEnv, tempDir } from "../../testing/temp";
import { NEWER_STORE, openWorkDb, workDbFile, writeWork } from "./db";
import { importClaudeMem } from "./import-claude-mem";
import {
  claimHeldBy,
  claimState,
  getTask,
  listTasks,
  notesOf,
  openChildren,
  searchTasks,
} from "./queries";
import { hasOwnTask, startView } from "./read";
import {
  addNote,
  createTask as createCurrentTask,
  deleteTask,
  ensurePlanTask,
  layPhase,
  systemClose,
  updateTask,
} from "./store";
import type { Result } from "./types";

const who = { sessionId: "session", pid: 12, procStart: "34" };
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function setup() {
  const paths = { stateDir: tempDir() };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
}
for (const kind of ["task", "phase"] as const) {
  test(`a second connection closing a selected plan prevents a ${kind} insert`, () => {
    const { db, paths } = setup();
    const writer = openWorkDb(workDbFile(paths), { mode: "write" });
    try {
      const plan = value(
        ensurePlanTask(db, { project: "p", plan: "race", subject: "Plan" }, who, 1),
      );
      const selected = getTask(db, "p", plan.id);
      expect(selected?.status).toBe("pending");
      value(updateTask(writer, plan.id, { status: "done" }, who, 2));
      const result =
        kind === "task"
          ? createCurrentTask(
              db,
              { project: "p", subject: "Task", plan: selected?.plan ?? null },
              who,
              3,
            )
          : writeWork(db, () =>
              layPhase(db, { project: "p", plan: "race", phase: "A", subject: "Phase" }, who, 3),
            );
      expect(result).toEqual({
        ok: false,
        why: 'Plan "race" is closed: reopen it with task_update, or create a loose task (no plan).',
      });
      expect(db.sqlite.query("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 1 });
    } finally {
      writer.close();
      db.close();
    }
  });
}

test("store rules, tree, dependencies, notes, and exact timestamps", () => {
  const { db, paths } = setup();
  const root = value(createTask(db, { project: "p", subject: " Root " }, who, 10));
  const child = value(
    createTask(db, { project: "p", subject: "Child", parentId: root.id }, who, 11),
  );
  expect(root.subject).toBe("Root");
  expect(root.number).toBe(1);
  expect(child.number).toBe(2);
  expect(root.id).toMatch(/^w[a-z2-7]{10}$/);
  expect(updateTask(db, root.id, { status: "done" }, who, 12)).toEqual({
    ok: false,
    why: "open tasks: #2 Child",
  });
  expect(updateTask(db, root.id, { parentId: child.id }, who, 12).ok).toBe(false);
  // A task blocked by its own parent could never start, and neither could ever be done.
  expect(updateTask(db, child.id, { waitsFor: { add: [root.id] } }, who, 12)).toEqual({
    ok: false,
    why: '#2 "Child" cannot be blocked by #1 "Root": it sits under it, and a parent waits for its tasks',
  });
  expect(updateTask(db, root.id, { waitsFor: { add: [child.id] } }, who, 12).ok).toBe(true);
  expect(listTasks(db, { project: "p", openOnly: true })[0]?.children[0]?.id).toBe(child.id);
  expect(openChildren(db, root.id).map((t) => t.number)).toEqual([2]);
  value(updateTask(db, child.id, { status: "in_progress" }, who, 13));
  expect(getTask(db, "p", "#2")?.claim).toEqual({ pid: 12, procStart: "34", sessionId: "session" });
  value(addNote(db, child.id, "literal %_", who, 14));
  expect(searchTasks(db, "p", "%_").map((t) => t.id)).toEqual([child.id]);
  expect(searchTasks(db, "p", "no_match")).toEqual([]);
  expect(deleteTask(db, child.id, who, 15).ok).toBe(false);
  value(systemClose(db, root.id, "done", "merged", who, 20));
  expect(getTask(db, "p", "2")?.status).toBe("dropped");
  expect(notesOf(db, child.id)[1]?.text).toBe("Automatically dropped: merged");
  expect(getTask(db, "p", root.id)?.closedAt).toBe(20);
  value(updateTask(db, root.id, { status: "pending" }, who, 21));
  expect(getTask(db, "p", root.id)?.closedAt).toBeNull();
  expect(createTask(db, { project: "p", subject: " " }, who, 1).ok).toBe(false);
  expect(createTask(db, { project: "p", subject: "x".repeat(201) }, who, 1).ok).toBe(false);
  expect(
    createTask(db, { project: "p", subject: "x", description: "x".repeat(200001) }, who, 1).ok,
  ).toBe(false);
  expect(addNote(db, root.id, "", who, 1).ok).toBe(false);
  expect(addNote(db, root.id, "x".repeat(64001), who, 1).ok).toBe(false);
  expect(statSync(workDbFile(paths)).mode & 0o777).toBe(0o600);
  expect(statSync(join(paths.stateDir, "tasks")).mode & 0o777).toBe(0o700);
  db.close();
});
test("plan upserts and process claims survive a clear", () => {
  const { db, paths } = setup();
  const plan = value(ensurePlanTask(db, { project: "p", plan: "plan", subject: "Plan" }, who, 1));
  expect(
    value(ensurePlanTask(db, { project: "p", plan: "plan", subject: "Other" }, who, 2)).id,
  ).toBe(plan.id);
  const own = value(
    createTask(db, { project: "p", subject: "Work", status: "in_progress" }, who, 3),
  );
  expect(claimState(own, () => true, { ...who, sessionId: "clear" })).toBe("mine");
  expect(claimState(own, () => true, { ...who, pid: 99 })).toBe("another session");
  expect(claimState(own, () => false, who)).toBe("free");
  db.close();
  expect(hasOwnTask(paths, "p", { sessionId: "session", pid: null, procStart: null })).toEqual({
    state: "ready",
    value: true,
  });
});
test("one claim match: the start time names the process; without one the session must match too", () => {
  const linux = { pid: 12, procStart: "34", sessionId: "session" };
  expect(claimHeldBy(linux, { sessionId: "after-clear", pid: 12, procStart: "34" })).toBe(true);
  expect(claimHeldBy(linux, { sessionId: "session", pid: 12, procStart: "reused" })).toBe(false);
  expect(claimHeldBy(linux, { sessionId: "session", pid: 13, procStart: "34" })).toBe(false);
  // Off Linux there is no start time: the same pid with another session is a reused pid.
  const elsewhere = { pid: 12, procStart: null, sessionId: "session" };
  expect(claimHeldBy(elsewhere, { sessionId: "other", pid: 12, procStart: null })).toBe(false);
  expect(claimHeldBy(elsewhere, { sessionId: "session", pid: 12, procStart: null })).toBe(true);
  expect(claimHeldBy(elsewhere, { sessionId: null, pid: 12, procStart: null })).toBe(false);
  expect(
    claimHeldBy({ ...elsewhere, sessionId: null }, { sessionId: null, pid: 12, procStart: null }),
  ).toBe(false);
  // A start time on one side only proves nothing either.
  expect(claimHeldBy(linux, { sessionId: "other", pid: 12, procStart: null })).toBe(false);
  expect(claimHeldBy(linux, { sessionId: "session", pid: 12, procStart: null })).toBe(true);
  expect(claimHeldBy(elsewhere, { sessionId: "session", pid: null, procStart: null })).toBe(false);
  expect(claimHeldBy(null, { sessionId: "session", pid: 12, procStart: null })).toBe(false);
  // The list's "mine" mark follows the same match.
  const { db } = setup();
  const task = value(createTask(db, { project: "p", subject: "Work" }, who, 1));
  db.close();
  const other = { sessionId: "other", pid: 12, procStart: null };
  expect(claimState({ ...task, claim: elsewhere }, () => true, other)).toBe("another session");
});
test("fresh, reopened, newer, missing, broken and locked databases", () => {
  const { db, paths } = setup();
  value(createTask(db, { project: "p", subject: "x" }, who, 1));
  db.close();
  const reopened = openWorkDb(workDbFile(paths), { mode: "write" });
  expect(getTask(reopened, "p", "1")?.subject).toBe("x");
  reopened.sqlite.run("UPDATE meta SET value='6' WHERE key='min_compatible'");
  reopened.close();
  const newer = openWorkDb(workDbFile(paths), { mode: "write" });
  expect(getTask(newer, "p", "1")?.subject).toBe("x");
  expect(createTask(newer, { project: "p", subject: "y" }, who, 2)).toEqual({
    ok: false,
    why: NEWER_STORE,
  });
  newer.close();
  expect(startView({ stateDir: tempDir() }, "p", who, { limit: 8 })).toEqual({ state: "none" });
  const bad = { stateDir: tempDir() };
  writeFileSync(join(bad.stateDir, "bad"), "garbage");
  expect(() => openWorkDb(join(bad.stateDir, "bad"), { mode: "hook" })).toThrow();
  // WAL: a writer's open transaction never blocks a hook. The hook reads the last committed
  // state at once, and a guard never goes silent because another session is writing.
  const lock = setup();
  value(createTask(lock.db, { project: "p", subject: "committed", status: "in_progress" }, who, 1));
  lock.db.sqlite.run("BEGIN IMMEDIATE");
  lock.db.sqlite.run("UPDATE tasks SET subject = 'uncommitted' WHERE project = 'p' AND number = 1");
  const before = performance.now();
  const seen = startView(lock.paths, "p", who, { limit: 8 });
  expect(performance.now() - before).toBeLessThan(150);
  expect(seen.state).toBe("ready");
  expect(seen.state === "ready" ? seen.value.tasks.map((task) => task.subject) : []).toEqual([
    "committed",
  ]);
  lock.db.sqlite.run("ROLLBACK");
  lock.db.close();
});
test("ten processes allocate exactly 500 project numbers", async () => {
  const { db, paths } = setup();
  db.close();
  const script = join(tempDir(), "writer.ts");
  const store = new URL("./store.ts", import.meta.url).pathname;
  const dbModule = new URL("./db.ts", import.meta.url).pathname;
  writeFileSync(
    script,
    `import {openWorkDb} from ${JSON.stringify(dbModule)}; import {createTask} from ${JSON.stringify(store)}; const db=openWorkDb(process.argv[2],{mode:'write'}); for(let i=0;i<50;i++){ const r=createTask(db,{project:'p',subject:'task'}, {sessionId:null,pid:null,procStart:null},1); if(!r.ok) throw Error(r.why); } db.close();`,
  );
  const guard = subprocessGuard();
  const children = Array.from({ length: 10 }, () =>
    Bun.spawn([process.execPath, ...guard.args, script, workDbFile(paths)], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...cleanGitEnv(),
        ...guard.env,
        HOME: paths.stateDir,
        CLAUDE_CONFIG_DIR: paths.stateDir,
      },
    }),
  );
  for (const child of children) {
    const stderr = await new Response(child.stderr).text();
    expect(await child.exited, stderr).toBe(0);
  }
  const read = openWorkDb(workDbFile(paths), { mode: "hook" });
  const rows = read.sqlite
    .query<{ number: number }, []>("SELECT number FROM tasks ORDER BY number")
    .all();
  expect(rows.length).toBe(500);
  expect(rows[0]?.number).toBe(1);
  expect(rows[499]?.number).toBe(500);
  expect(new Set(rows.map((r) => r.number)).size).toBe(500);
  read.close();
});
test("claude-mem folding, deletion, skips, dry run, import markers and schema refusal", () => {
  const file = join(tempDir(), "mem.db");
  const mem = new Database(file);
  mem.run(
    "CREATE TABLE work_state_entries(id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT)",
  );
  const insert = mem.query(
    "INSERT INTO work_state_entries(project,list_name,fields) VALUES ('mem',?,?)",
  );
  for (const [list, fields] of [
    ["List", { status: "doing", remove: "old" }],
    ["List", { remove: null, keep: "yes" }],
    ["List", { task: "item", status: "doing", extra: "value" }],
    ["List", { task: "item", extra: null }],
    ["List", { task: "closed", status: "done" }],
    ["Closed", { status: "done" }],
  ] as const)
    insert.run(list, JSON.stringify(fields));
  mem.close();
  const { db } = setup();
  const args = { claudeMemDb: file, workDb: db, project: "p", claudeMemProject: "mem", now: 10 };
  const dry = value(importClaudeMem({ ...args, dryRun: true }));
  expect(dry.imported.length).toBe(2);
  expect(listTasks(db, { project: "p", openOnly: true })).toEqual([]);
  expect(value(importClaudeMem({ ...args, dryRun: false })).imported.length).toBe(2);
  expect(value(importClaudeMem({ ...args, dryRun: false }))).toEqual({
    imported: [],
    dropped: [],
    kept: [],
    skipped: [],
    open: 1,
  });
  // An older claude-mem has no entry times: the task keeps the time of the import.
  expect(getTask(db, "p", "1")?.createdAt).toBe(10);
  expect(getTask(db, "p", "1")?.updatedAt).toBe(10);
  expect(getTask(db, "p", "1")?.description).toBe("keep: yes");
  expect(getTask(db, "p", "2")?.description).toBe("");
  expect(getTask(db, "p", "3")?.status).toBe("in_progress");
  const bad = join(tempDir(), "bad.db");
  const other = new Database(bad);
  other.run("CREATE TABLE work_state_entries(id INTEGER)");
  other.close();
  expect(importClaudeMem({ ...args, claudeMemDb: bad, dryRun: false })).toEqual({
    ok: false,
    why: "work_state_entries has unsupported columns: id",
  });
  db.close();
});
