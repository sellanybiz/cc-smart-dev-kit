/**
 * A plan's file list (D2): how a path is normalised, when two lists overlap, how the list is
 * stored (with its history, and with its plan through the cascade) and what the task tools say
 * about it. Reservations and the held set are in `reserve.test.ts`.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../../cli/paths";
import { hookEnv, makeRepo } from "../../testing/hooks";
import { tempDir } from "../../testing/temp";
import { createTaskOps, type TaskAnswer } from "../ops";
import { openWorkDb, workDbFile } from "./db";
import { allTasks, eventsOf, filesOverlap, normalizePlanFile, planFiles } from "./queries";
import { readWorkStore } from "./read";
import { createTask, deleteTask, updateTask } from "./store";
import type { Result } from "./types";

const LEAD = { sessionId: "lead", pid: 4101, procStart: "41010" };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function said(answer: TaskAnswer): string {
  if (!answer.ok) throw new Error(answer.why);
  return answer.text;
}
function refused(answer: TaskAnswer): string {
  if (answer.ok) throw new Error(`expected a refusal, got: ${answer.text}`);
  return answer.why;
}
function setup() {
  const paths = { stateDir: tempDir() };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
}
function plan(
  db: ReturnType<typeof setup>["db"],
  slug: string,
  files?: string[],
  now = 1,
  who = LEAD,
) {
  return ok(
    createTask(
      db,
      { project: "p", subject: slug, kind: "plan", plan: slug, ...(files ? { files } : {}) },
      who,
      now,
    ),
  );
}

test("a path is written repo-relative with /, a folder ends in /", () => {
  const cases: [string, string][] = [
    ["src/a.ts", "src/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src\\sub\\a.ts", "src/sub/a.ts"],
    ["src/", "src/"],
    ["src//x/./y.ts", "src/x/y.ts"],
    ["./src/.", "src/"],
    ["  docs/ ", "docs/"],
  ];
  for (const [given, stored] of cases) expect(normalizePlanFile(given)).toBe(stored);
});

test("an absolute path, a .. and the root are refused, each with the fix", () => {
  const refusals: [string, string][] = [
    [
      "/etc/hosts",
      'file "/etc/hosts" is an absolute path: write it relative to the repository root',
    ],
    ["C:\\x\\y", 'file "C:\\x\\y" is an absolute path: write it relative to the repository root'],
    ["../x", 'file "../x" goes up with "..": list the path from the repository root'],
    ["src/../x", 'file "src/../x" goes up with "..": list the path from the repository root'],
    ["", 'file "" is the repository root: list the files or folders the plan changes'],
    [".", 'file "." is the repository root: list the files or folders the plan changes'],
    ["/", 'file "/" is the repository root: list the files or folders the plan changes'],
    ["./", 'file "./" is the repository root: list the files or folders the plan changes'],
  ];
  for (const [given, why] of refusals) expect(() => normalizePlanFile(given)).toThrow(why);
});

test("a wildcard or a control character is refused, as plans.mergeFiles refuses it", () => {
  for (const given of ["src/*.ts", "src/?.ts", "src/[ab].ts", "plugin/dist/*", "a\nb"])
    expect(() => normalizePlanFile(given)).toThrow(/pattern character|control character/);
  expect(() => normalizePlanFile("src/*.ts")).toThrow(
    'file "src/*.ts" holds a pattern character (*, ? or [): list the path itself, and a whole folder with a trailing /',
  );
});

test("two lists overlap when a path is equal or inside the other's folder, and not on a shared prefix", () => {
  expect(filesOverlap(["src/a.ts"], ["src/a.ts"])).toEqual([
    { path: "src/a.ts", other: "src/a.ts" },
  ]);
  expect(filesOverlap(["src/a.ts"], ["src/"])).toEqual([{ path: "src/a.ts", other: "src/" }]);
  expect(filesOverlap(["src/"], ["src/deep/b.ts"])).toEqual([
    { path: "src/", other: "src/deep/b.ts" },
  ]);
  // A file named like a folder's start, and a sibling folder, are not inside it.
  expect(filesOverlap(["src/ab.ts"], ["src/a"])).toEqual([]);
  expect(filesOverlap(["src2/x.ts"], ["src/"])).toEqual([]);
  expect(filesOverlap([], ["src/"])).toEqual([]);
});

test("merge files take no part in an overlap, as an equal path or inside a merge folder", () => {
  const ignore = ["CHANGELOG.md", "plugin/dist/"];
  expect(filesOverlap(["CHANGELOG.md", "a.ts"], ["CHANGELOG.md", "b.ts"], { ignore })).toEqual([]);
  expect(filesOverlap(["plugin/dist/cli.js"], ["plugin/dist/"], { ignore })).toEqual([]);
  // A folder that holds a merge folder still overlaps through its other files.
  expect(filesOverlap(["plugin/"], ["plugin/x.ts"], { ignore })).toEqual([
    { path: "plugin/", other: "plugin/x.ts" },
  ]);
  expect(filesOverlap(["a.ts"], ["a.ts"], { ignore })).toHaveLength(1);
});

test("case counts unless the file system ignores it, and then the ignore list folds too", () => {
  expect(filesOverlap(["Src/A.ts"], ["src/a.ts"])).toEqual([]);
  expect(filesOverlap(["Src/A.ts"], ["src/a.ts"], { caseFold: true })).toEqual([
    { path: "Src/A.ts", other: "src/a.ts" },
  ]);
  expect(filesOverlap(["SRC/"], ["src/b.ts"], { caseFold: true })).toHaveLength(1);
  expect(
    filesOverlap(["Change.MD"], ["change.md"], { caseFold: true, ignore: ["CHANGE.md"] }),
  ).toEqual([]);
  expect(filesOverlap(["Change.MD"], ["change.md"], { ignore: ["CHANGE.md"] })).toEqual([]);
  expect(filesOverlap(["Change.MD"], ["Change.MD"], { ignore: ["CHANGE.md"] })).toHaveLength(1);
});

test("a plan stores its files normalised, once each, and its history records every change", () => {
  const { db } = setup();
  const made = plan(db, "alpha", ["./src/b.ts", "src/a.ts", "src\\b.ts"]);
  expect(made.files).toEqual(["src/a.ts", "src/b.ts"]);
  expect(planFiles(db, made)).toEqual(["src/a.ts", "src/b.ts"]);
  ok(updateTask(db, made.id, { files: ["docs/"] }, LEAD, 2));
  expect(planFiles(db, made.id)).toEqual(["docs/"]);
  ok(updateTask(db, made.id, { files: [] }, LEAD, 3));
  expect(planFiles(db, made.id)).toEqual([]);
  expect(eventsOf(db, made).map((e) => [e.action, e.changes.files])).toEqual([
    ["created", [null, ["src/a.ts", "src/b.ts"]]],
    ["changed", [["src/a.ts", "src/b.ts"], ["docs/"]]],
    ["changed", [["docs/"], []]],
  ]);
});

test("files belong to a plan task: a phase or a task refuses them and keeps no row", () => {
  const { db } = setup();
  const made = plan(db, "alpha");
  const phase = ok(
    createTask(
      db,
      {
        project: "p",
        subject: "Phase",
        kind: "phase",
        parentId: made.id,
        plan: "alpha",
        phase: "A",
      },
      LEAD,
      2,
    ),
  );
  const refusal = updateTask(db, phase.id, { files: ["src/"] }, LEAD, 3);
  expect(refusal.ok ? "" : refusal.why).toBe('#2 "Phase" is a phase: only a plan has a file list');
  const created = createTask(
    db,
    { project: "p", subject: "T", parentId: phase.id, files: ["src/"] },
    LEAD,
    4,
  );
  expect(created.ok ? "" : created.why).toContain("only a plan has a file list");
  expect(db.sqlite.query("SELECT COUNT(*) AS n FROM task_files").get()).toEqual({ n: 0 });
  expect(allTasks(db, "p").map((t) => t.subject)).toEqual(["alpha", "Phase"]);
});

test("a bad path fails the whole write: the old list stays", () => {
  const { db } = setup();
  const made = plan(db, "alpha", ["src/a.ts"]);
  const refusal = updateTask(db, made.id, { files: ["ok.ts", "../out"] }, LEAD, 2);
  expect(refusal.ok ? "" : refusal.why).toContain('goes up with ".."');
  expect(planFiles(db, made)).toEqual(["src/a.ts"]);
});

test("an older kit's plain DELETE of a plan takes its files with it", () => {
  const { paths, db } = setup();
  const made = plan(db, "alpha", ["src/a.ts", "src/b/"]);
  plan(db, "beta", ["docs/"], 2);
  db.close();
  // The older kit opens the file with foreign keys on, and knows no `task_files`.
  const old = new Database(workDbFile(paths));
  try {
    old.run("PRAGMA foreign_keys = ON");
    old.query("DELETE FROM tasks WHERE id=?").run(made.id);
    expect(old.query("SELECT task_id,path FROM task_files").all()).toHaveLength(1);
    expect(old.query("SELECT COUNT(*) AS n FROM task_files WHERE task_id=?").get(made.id)).toEqual({
      n: 0,
    });
  } finally {
    old.close();
  }
});

test("the kit's own delete of a plan with files works and its history keeps the files", () => {
  const { db } = setup();
  const made = plan(db, "alpha", ["src/a.ts"]);
  expect(deleteTask(db, made.id, LEAD, 2).ok).toBe(true);
  expect(db.sqlite.query("SELECT COUNT(*) AS n FROM task_files").get()).toEqual({ n: 0 });
  const last = db.sqlite
    .query<{ changes: string }, [string]>(
      "SELECT changes FROM task_events WHERE task_id=? AND action='deleted'",
    )
    .get(made.id);
  expect(JSON.parse(last?.changes ?? "{}").files).toEqual([["src/a.ts"], null]);
});

test("a schema 5 store moves to 6: the table and columns appear, old plans have no files and no lead", () => {
  const { paths, db } = setup();
  plan(db, "alpha");
  db.sqlite.run("DROP TABLE task_files");
  for (const column of ["lead_session", "lead_pid", "lead_start", "lead_child", "lead_handout"])
    db.sqlite.run(`ALTER TABLE tasks DROP COLUMN ${column}`);
  db.sqlite.run("PRAGMA user_version = 5");
  db.close();
  // A hook reads the store as it is, before any writer moved it: no table, no error.
  expect(
    readWorkStore(paths, (hook) => allTasks(hook, "p").map((t) => [t.subject, t.files, t.lead])),
  ).toEqual({ state: "ready", value: [["alpha", [], null]] });
  const moved = openWorkDb(workDbFile(paths), { mode: "write" });
  try {
    expect(moved.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 6 });
    expect(
      moved.sqlite
        .query<{ name: string }, []>("PRAGMA table_info(tasks)")
        .all()
        .map((c) => c.name)
        .filter((name) => name.startsWith("lead_")),
    ).toEqual(["lead_session", "lead_pid", "lead_start", "lead_child", "lead_handout"]);
    expect(
      moved.sqlite
        .query<{ name: string }, []>("PRAGMA table_info(task_files)")
        .all()
        .map((c) => c.name),
    ).toEqual(["task_id", "path"]);
    // It is additive: older code still reads the store, so it stays compatible with version 1.
    expect(moved.sqlite.query("SELECT value FROM meta WHERE key='min_compatible'").get()).toEqual({
      value: "1",
    });
    const [row] = allTasks(moved, "p");
    expect([row?.files, row?.lead]).toEqual([[], null]);
    ok(updateTask(moved, row?.id ?? "", { files: ["src/a.ts"] }, LEAD, 5));
    expect(planFiles(moved, row?.id ?? "")).toEqual(["src/a.ts"]);
  } finally {
    moved.close();
  }
});

function world() {
  const repo = makeRepo();
  const env = hookEnv();
  const paths = cliPaths(env);
  const ops = (who = LEAD) =>
    createTaskOps({
      stateDir: paths.stateDir,
      env,
      cwd: () => repo,
      caller: () => ({ ...who, cwd: repo }),
    });
  return { repo, paths, ops };
}

test("the task tools set, show and clear a plan's files, and refuse them on anything else", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Alpha", plan: "alpha", files: ["./src/a.ts", "docs/"] }));
    expect(said(ops.call("get", { task: "#1" }))).toContain("Files: docs/, src/a.ts");
    said(ops.call("update", { task: "#1", files: ["lib/x.ts"] }));
    expect(said(ops.call("get", { task: "#1" }))).toContain("Files: lib/x.ts");
    said(ops.call("update", { task: "#1", files: [] }));
    const shown = said(ops.call("get", { task: "#1" }));
    expect(shown).not.toContain("Files:");
    // The history says each change in words.
    expect(shown).toContain("created: kind plan; plan alpha;");
    expect(shown).toContain("changed: files none → docs/, src/a.ts");
    expect(shown).toContain("changed: files docs/, src/a.ts → lib/x.ts");
    expect(shown).toContain("changed: files lib/x.ts → none");
    // Not a plan: a phase, a task, and a create that is not the plan itself.
    said(ops.call("create", { subject: "Phase", plan: "alpha", phase: "A" }));
    expect(refused(ops.call("update", { task: "#2", files: ["x"] }))).toBe(
      '#2 "Phase" is a phase: only a plan task has a file list (set files on the plan\'s own #n)',
    );
    expect(
      refused(ops.call("create", { subject: "Phase B", plan: "alpha", phase: "B", files: ["x"] })),
    ).toContain("files belong to a plan task");
    expect(refused(ops.call("create", { subject: "Loose", files: ["x"] }))).toContain(
      "files belong to a plan task",
    );
    expect(refused(ops.call("create", { subject: "Under", parent: "#2", files: ["x"] }))).toContain(
      "files belong to a plan task",
    );
    expect(
      refused(
        ops.call("create", {
          subject: "Deploy",
          kind: "prod",
          deploy: "after",
          type: "blocking",
          files: ["x"],
        }),
      ),
    ).toContain("Deploy tasks have no parent, blocked-by, work status, phase, plan or files");
  } finally {
    ops.close();
  }
});

test("the task tools refuse an absolute path, a .., the root, and a folder written without its /", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Alpha", plan: "alpha" }));
    expect(refused(ops.call("update", { task: "#1", files: ["/etc/hosts"] }))).toContain(
      "is an absolute path",
    );
    expect(refused(ops.call("update", { task: "#1", files: ["a/../b"] }))).toContain(
      'goes up with ".."',
    );
    expect(refused(ops.call("update", { task: "#1", files: ["."] }))).toContain(
      "is the repository root",
    );
    expect(refused(ops.call("update", { task: "#1", files: ["src/*.ts"] }))).toContain(
      "holds a pattern character",
    );
    expect(said(ops.call("get", { task: "#1" }))).not.toContain("Files:");
    mkdirSync(join(w.repo, "src"));
    expect(refused(ops.call("update", { task: "#1", files: ["src"] }))).toBe(
      'file "src" is a folder: write it src/',
    );
    // A path that does not exist yet, or a real file, is taken as written.
    said(ops.call("update", { task: "#1", files: ["src/new.ts", "README.md", "src/"] }));
    expect(said(ops.call("get", { task: "#1" }))).toContain("Files: README.md, src/, src/new.ts");
  } finally {
    ops.close();
  }
});
