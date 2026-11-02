import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subprocessGuard } from "../../testing/port-guard";
import { cleanGitEnv, tempDir } from "../../testing/temp";
import { NEWER_STORE, openWorkDb, workDbFile } from "./db";
import { importClaudeMem } from "./import-claude-mem";
import { claimState, getTask, listTasks, notesOf, openSubtasks, searchTasks } from "./queries";
import { crewPhaseState, hasOwnTask, leadOwnState, startView } from "./read";
import {
  ack,
  addNote,
  createTask,
  deleteTask,
  ensurePhaseTask,
  ensurePlanTask,
  systemClose,
  updateTask,
} from "./store";
import type { Result } from "./types";

const who = { sessionId: "session", crewId: null, pid: 12, procStart: "34" };
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function setup() {
  const paths = { stateDir: tempDir() };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
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
    why: "open subtasks: #2 Child",
  });
  expect(updateTask(db, root.id, { parentId: child.id }, who, 12).ok).toBe(false);
  expect(updateTask(db, child.id, { waitsFor: { add: [root.id] } }, who, 12).ok).toBe(true);
  expect(updateTask(db, root.id, { waitsFor: { add: [child.id] } }, who, 12).ok).toBe(false);
  expect(listTasks(db, { project: "p", openOnly: true })[0]?.children[0]?.id).toBe(child.id);
  expect(openSubtasks(db, root.id).map((t) => t.number)).toEqual([2]);
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
  value(ack(db, "p", "T-abcd", 22));
  db.close();
});
test("plan and phase upserts, hook views and claim classification", () => {
  const { db, paths } = setup();
  const plan = value(ensurePlanTask(db, { project: "p", plan: "plan", subject: "Plan" }, who, 1));
  const a = value(
    ensurePhaseTask(
      db,
      {
        project: "p",
        plan: "plan",
        phase: "a",
        subject: "A",
        description: "",
        crewId: "a",
        waitsForPhases: [],
      },
      who,
      2,
    ),
  );
  const b = value(
    ensurePhaseTask(
      db,
      {
        project: "p",
        plan: "plan",
        phase: "b",
        subject: "B",
        description: "",
        crewId: "b",
        waitsForPhases: ["a"],
      },
      who,
      3,
    ),
  );
  expect(a.parentId).toBe(plan.id);
  expect(b.waitsFor).toEqual([a.id]);
  expect(
    value(
      ensurePhaseTask(
        db,
        {
          project: "p",
          plan: "plan",
          phase: "a",
          subject: "A",
          description: "",
          crewId: "new",
          waitsForPhases: [],
        },
        who,
        4,
      ),
    ).id,
  ).toBe(a.id);
  const own = value(
    createTask(
      db,
      { project: "p", subject: "Work", plan: "plan", parentId: a.id, status: "in_progress" },
      who,
      5,
    ),
  );
  expect(claimState(own, () => true, who)).toBe("mine");
  // A `/clear` gives the same Claude process a new session id: the claim is still its own.
  expect(claimState(own, () => true, { ...who, sessionId: "clear" })).toBe("mine");
  expect(claimState(own, () => true, { ...who, pid: 99 })).toBe("another session");
  expect(claimState(own, () => true, { ...who, procStart: "reused" })).toBe("another session");
  expect(claimState(own, () => false, who)).toBe("free");
  db.close();
  expect(crewPhaseState(paths, "p", "new").state).toBe("ready");
  expect(leadOwnState(paths, "p", "plan", ["session"]).state).toBe("ready");
  expect(hasOwnTask(paths, "p", ["session"])).toEqual({ state: "ready", value: true });
  expect(startView(paths, "p", who, { limit: 8 }).state).toBe("ready");
});
test("fresh, reopened, newer, missing, broken and locked databases", () => {
  const { db, paths } = setup();
  value(createTask(db, { project: "p", subject: "x" }, who, 1));
  db.close();
  const reopened = openWorkDb(workDbFile(paths), { mode: "write" });
  expect(getTask(reopened, "p", "1")?.subject).toBe("x");
  reopened.sqlite.run("UPDATE meta SET value='2' WHERE key='min_compatible'");
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
    `import {openWorkDb} from ${JSON.stringify(dbModule)}; import {createTask} from ${JSON.stringify(store)}; const db=openWorkDb(process.argv[2],{mode:'write'}); for(let i=0;i<50;i++){ const r=createTask(db,{project:'p',subject:'task'}, {sessionId:null,crewId:null,pid:null,procStart:null},1); if(!r.ok) throw Error(r.why); } db.close();`,
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
    skipped: [],
  });
  expect(getTask(db, "p", "1")?.description).toBe("keep: yes");
  expect(getTask(db, "p", "2")?.description).toBe("");
  expect(getTask(db, "p", "2")?.status).toBe("in_progress");
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
