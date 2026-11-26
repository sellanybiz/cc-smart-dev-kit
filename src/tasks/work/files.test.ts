/**
 * A plan's file list (D2): how a path is normalised, when two lists overlap, how the list is
 * stored (with its history, and with its plan through the cascade) and what the task tools say
 * about it. Reservations and the held set are in `reserve.test.ts`.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../../build-info/names";
import { cliPaths } from "../../cli/paths";
import { commitConfig, hookEnv, makeClone, makeRepo, writeClaudeFile } from "../../testing/hooks";
import { overlapNotes, sharedWords, warned } from "../../testing/overlap-lines";
import { git, tempDir } from "../../testing/temp";
import { normalizeMergeFile, workflowSchema } from "../../workflow/schema";
import { folderProject } from "../context";
import { planFilesCheck } from "../files-check";
import { createTaskOps, type TaskAnswer } from "../ops";
import { openWorkDb, workDbFile } from "./db";
import { allTasks, eventsOf, filesOverlap, normalizePlanFile, planFiles } from "./queries";
import { readWorkStore } from "./read";
import { createTask, deleteTask, reservePlan, updateTask } from "./store";
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
  for (const given of ["src/*.ts", "src/?.ts", "plugin/dist/*", "a\nb"])
    expect(() => normalizePlanFile(given)).toThrow(/pattern character|control character/);
  expect(() => normalizePlanFile("src/*.ts")).toThrow(
    'file "src/*.ts" holds a pattern character (* or ?): list the path itself, and a whole folder with a trailing /',
  );
});

test("brackets are plain characters of a path, for a plan's files and for plans.mergeFiles", () => {
  expect(normalizePlanFile("app/[id]/page.tsx")).toBe("app/[id]/page.tsx");
  expect(normalizePlanFile("./app/[id]/")).toBe("app/[id]/");
  expect(normalizeMergeFile("app/[id]/page.tsx")).toEqual({ ok: true, path: "app/[id]/page.tsx" });
  // And they still overlap by the same rule: the folder holds the file.
  expect(filesOverlap(["app/[id]/"], ["app/[id]/page.tsx"])).toEqual([
    { path: "app/[id]/", other: "app/[id]/page.tsx" },
  ]);
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

test("inside a plans.appendOnly folder, two plans overlap only on the same file", () => {
  const appendOnly = ["db/migrations/"];
  // Two plans that each add a new file there do not overlap; the same file does.
  expect(
    filesOverlap(["db/migrations/002.sql"], ["db/migrations/003.sql"], { appendOnly }),
  ).toEqual([]);
  expect(
    filesOverlap(["db/migrations/002.sql"], ["db/migrations/002.sql"], { appendOnly }),
  ).toEqual([{ path: "db/migrations/002.sql", other: "db/migrations/002.sql" }]);
  // No folder entry holds a path in there: the folder itself, a folder inside it, a folder around it.
  expect(filesOverlap(["db/migrations/"], ["db/migrations/003.sql"], { appendOnly })).toEqual([]);
  expect(filesOverlap(["db/migrations/"], ["db/migrations/"], { appendOnly })).toEqual([]);
  expect(filesOverlap(["db/migrations/old/"], ["db/migrations/old/1.sql"], { appendOnly })).toEqual(
    [],
  );
  expect(filesOverlap(["db/"], ["db/migrations/003.sql"], { appendOnly })).toEqual([]);
  // Outside it, the folder around it still holds its other files.
  expect(filesOverlap(["db/"], ["db/schema.ts"], { appendOnly })).toEqual([
    { path: "db/", other: "db/schema.ts" },
  ]);
  // A folder outside the list behaves as before, and so does a name that only starts the same.
  expect(filesOverlap(["src/"], ["src/a.ts"], { appendOnly })).toHaveLength(1);
  expect(filesOverlap(["db/migrations-old/"], ["db/migrations-old/1.sql"], { appendOnly })).toEqual(
    [{ path: "db/migrations-old/", other: "db/migrations-old/1.sql" }],
  );
  // It folds with case like every list, and a merge file still takes no part.
  expect(
    filesOverlap(["DB/Migrations/"], ["db/migrations/3.sql"], { appendOnly, caseFold: true }),
  ).toEqual([]);
  expect(
    filesOverlap(["db/migrations/3.sql"], ["db/migrations/3.sql"], {
      appendOnly,
      ignore: ["db/migrations/3.sql"],
    }),
  ).toEqual([]);
});

test("plans.appendOnly in the project file takes folders only, normalised, once each", () => {
  const read = (appendOnly: string[]) => workflowSchema.safeParse({ plans: { appendOnly } });
  const parsed = read(["./db/migrations/", "db\\migrations\\", "docs/adr/"]);
  expect(parsed.success && parsed.data?.plans?.appendOnly).toEqual(["db/migrations/", "docs/adr/"]);
  const bare = read(["db/migrations"]);
  expect(bare.success).toBe(false);
  expect(bare.error?.issues[0]?.message).toBe(
    '"db/migrations" is not a folder: plans.appendOnly names folders, each ending in /',
  );
  expect(read(["/"]).error?.issues[0]?.message).toBe(
    '"/" is the root: name the files or folders under it',
  );
  expect(read(["../x/"]).success).toBe(false);
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

test("a schema 5 store moves to the current schema: the table and columns appear, old plans have no files and no lead", () => {
  const { paths, db } = setup();
  plan(db, "alpha");
  db.sqlite.run("DROP TABLE task_files");
  // Schema 7 added the stack column: the older store has none.
  db.sqlite.run("ALTER TABLE tasks DROP COLUMN stacked_on");
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
    expect(moved.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 7 });
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
    ).toContain(
      "Deploy tasks have no parent, blocked-by, work status, phase, plan, files or stacked_on",
    );
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

test("plans.appendOnly counts only as committed on origin/<base>, and lets two plans add files there", () => {
  const { repo } = makeClone();
  const env = hookEnv();
  // No committed file yet: no folders, and the merge list's reason says why.
  const none = planFilesCheck(repo, env);
  expect([none.appendOnly, none.reason]).toEqual([
    [],
    "origin/main has no .claude/cc-smart-dev-kit.json committed",
  ]);
  commitConfig(repo, { workflow: { plans: { appendOnly: ["db/migrations/"] } } }, ["main"]);
  // A working copy that widens the list changes nothing: only the committed copy counts.
  writeClaudeFile(repo, "cc-smart-dev-kit.json", {
    workflow: { plans: { appendOnly: ["db/migrations/", "src/"] } },
  });
  const check = planFilesCheck(repo, env);
  expect([check.appendOnly, check.reason]).toEqual([["db/migrations/"], null]);
  const stateDir = cliPaths(env).stateDir;
  const ops = createTaskOps({
    stateDir,
    env,
    cwd: () => repo,
    caller: () => ({ ...LEAD, cwd: repo }),
  });
  const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
  const reserve = (plan: string) =>
    ok(
      reservePlan(db, {
        project: folderProject(repo),
        plan,
        who: LEAD,
        holder: "child",
        ignore: check.ignore,
        caseFold: check.caseFold,
        appendOnly: check.appendOnly,
        now: 5,
      }),
    );
  try {
    said(
      ops.call("create", {
        subject: "Alpha",
        plan: "alpha",
        files: ["db/migrations/", "src/a.ts"],
      }),
    );
    said(ops.call("create", { subject: "Beta", plan: "beta", files: ["db/migrations/"] }));
    // Both add files to the folder, so both are held at once.
    reserve("alpha");
    reserve("beta");
    // A folder outside the list overlaps as before: the update lands, with the warning.
    expect(
      warned(ops.call("update", { task: "#2", files: ["db/migrations/", "src/"] })).map(
        sharedWords,
      ),
    ).toEqual(['#1 "Alpha" and #2 "Beta" share src/a.ts (src/)']);
    expect(warned(ops.call("update", { task: "#2", files: ["db/migrations/"] }))).toEqual([]);
    // Two new files are clear; the same file named by both is not.
    expect(
      warned(ops.call("update", { task: "#1", files: ["db/migrations/003.sql", "src/a.ts"] })),
    ).toEqual([]);
    expect(warned(ops.call("update", { task: "#2", files: ["db/migrations/004.sql"] }))).toEqual(
      [],
    );
    expect(
      warned(ops.call("update", { task: "#2", files: ["db/migrations/003.sql"] })).map(sharedWords),
    ).toEqual(['#1 "Alpha" and #2 "Beta" share db/migrations/003.sql']);
  } finally {
    db.close();
    ops.close();
  }
});

/**
 * A clone whose origin/main commits `.gitattributes` (`db/*.gen.ts` generated), two generated
 * files and one plain file in `db/` (and `more` generated files in `db/many/`), and
 * `plans.mergeFiles` (`CHANGELOG.md` unless given); then the task tools of two sessions, each
 * reading the real check of the checkout.
 */
function generatedWorld(options: { mergeFiles?: string[]; more?: number } = {}) {
  const { repo } = makeClone();
  const env = hookEnv();
  mkdirSync(join(repo, "db", "many"), { recursive: true });
  writeFileSync(join(repo, ".gitattributes"), "db/**/*.gen.ts linguist-generated\n");
  const many = Array.from(
    { length: options.more ?? 0 },
    (_, n) => `db/many/${"generated-client-for-one-service".repeat(2)}-${n}.gen.ts`,
  );
  for (const file of ["db/types.gen.ts", "db/client.gen.ts", "db/schema.ts", "src.ts", ...many])
    writeFileSync(join(repo, file), "export {};\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "generated files");
  const mergeFiles = options.mergeFiles ?? ["CHANGELOG.md"];
  commitConfig(repo, { workflow: { plans: { mergeFiles } } }, ["main"]);
  const stateDir = cliPaths(env).stateDir;
  const ops = (who: typeof LEAD) =>
    createTaskOps({ stateDir, env, cwd: () => repo, caller: () => ({ ...who, cwd: repo }) });
  /** The `Overlap:` notes of the task numbered `number`, oldest first. */
  const notes = (number: number) => {
    const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
    try {
      const task = allTasks(db, folderProject(repo)).find((t) => t.number === number);
      return overlapNotes(db, task?.id ?? "");
    } finally {
      db.close();
    }
  };
  return { repo, ops, notes, many };
}
const SECOND: typeof LEAD = { sessionId: "second", pid: 4202, procStart: "42020" };

test("a base-marked generated file the overlap holds is named with the ready propose line, in both orders", () => {
  const expected = `origin/main marks db/types.gen.ts generated: \`${COMMAND} workflow propose plans.mergeFiles 'CHANGELOG.md,db/types.gen.ts'\` opens the pull request that leaves them out of every overlap once the person merges it.`;
  for (const order of [
    ["alpha", "beta"],
    ["beta", "alpha"],
  ]) {
    const w = generatedWorld();
    // A mark only on the checkout's own branch, not on origin/main, never counts.
    writeFileSync(join(w.repo, ".gitattributes"), "* linguist-generated\n");
    git(w.repo, "commit", "-q", "-am", "a local mark");
    const lead = w.ops(LEAD);
    const second = w.ops(SECOND);
    try {
      said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["db/", "src.ts"] }));
      said(
        second.call("create", {
          subject: "Beta",
          plan: "beta",
          files: ["db/types.gen.ts", "src.ts", "CHANGELOG.md"],
        }),
      );
      const starts = {
        alpha: () => lead.call("update", { task: "#1", status: "in_progress" }),
        beta: () => second.call("update", { task: "#2", status: "in_progress" }),
      };
      expect(warned(starts[order[0] as "alpha"]())).toEqual([]);
      const lines = warned(starts[order[1] as "beta"]());
      expect(lines.map(sharedWords)).toEqual([
        '#1 "Alpha" and #2 "Beta" share db/ (db/types.gen.ts), src.ts',
      ]);
      expect(lines[0]).toEndWith(expected);
      // The same text is noted on both plans.
      expect([w.notes(1), w.notes(2)]).toEqual([lines, lines]);
    } finally {
      lead.close();
      second.close();
    }
  }
});

/** The folder words: listing the generated files would not settle `folder`, which both plans list. */
const folderWords = (files: string, folder: string) =>
  `origin/main marks ${files} generated, but a merge file does not settle a folder both plans list (${folder}): narrow that folder entry to the files the plan changes, or put the folder itself in plans.mergeFiles.`;

test("two folders that share generated files name the files, and say why listing them settles nothing", () => {
  for (const mergeFiles of [
    ["CHANGELOG.md"],
    ["CHANGELOG.md", "db/client.gen.ts", "db/types.gen.ts"],
  ]) {
    // The second time the files are merge files already: still no propose line, never the same list again.
    const w = generatedWorld({ mergeFiles });
    const lead = w.ops(LEAD);
    const second = w.ops(SECOND);
    try {
      said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["db/"] }));
      said(second.call("create", { subject: "Beta", plan: "beta", files: ["db/"] }));
      said(lead.call("update", { task: "#1", status: "in_progress" }));
      const [line] = warned(second.call("update", { task: "#2", status: "in_progress" }));
      expect(sharedWords(line ?? "")).toBe('#1 "Alpha" and #2 "Beta" share db/');
      expect(line).toEndWith(folderWords("db/client.gen.ts, db/types.gen.ts", "db/"));
      expect(line).not.toContain("workflow propose");
    } finally {
      lead.close();
      second.close();
    }
  }
});

test("a folder of many generated files names the first ones, counts the rest, and the note is saved", () => {
  const w = generatedWorld({ more: 700 });
  const lead = w.ops(LEAD);
  const second = w.ops(SECOND);
  try {
    said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["db/"] }));
    said(second.call("create", { subject: "Beta", plan: "beta", files: w.many }));
    said(lead.call("update", { task: "#1", status: "in_progress" }));
    const lines = warned(second.call("update", { task: "#2", status: "in_progress" }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^Overlap: #1 "Alpha" and #2 "Beta" share db\/ \(db\/many\/[^)]+\), .+ and \d+ more\. Leads: /,
    );
    expect(lines[0]).toMatch(
      /\.gen\.ts and \d+ more generated: too many for one propose line, so put the folder that holds them in plans\.mergeFiles\.$/,
    );
    expect([w.notes(1), w.notes(2)]).toEqual([lines, lines]);
  } finally {
    lead.close();
    second.close();
  }
});

test("a generated-files reader that throws leaves the write done and the warning plain, with one line", () => {
  const repo = makeRepo();
  const env = hookEnv();
  const stateDir = cliPaths(env).stateDir;
  const ops = (who: typeof LEAD) =>
    createTaskOps({
      stateDir,
      env,
      cwd: () => repo,
      caller: () => ({ ...who, cwd: repo }),
      filesCheck: () => ({
        ignore: [],
        caseFold: false,
        generated: () => {
          throw new Error("ENOENT: no such file or directory, mkdtemp");
        },
      }),
    });
  const lead = ops(LEAD);
  const second = ops(SECOND);
  try {
    said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["src/"] }));
    said(second.call("create", { subject: "Beta", plan: "beta", files: ["src/a.ts"] }));
    said(lead.call("update", { task: "#1", status: "in_progress" }));
    const answer = second.call("update", { task: "#2", status: "in_progress" });
    expect(said(answer).split("\n")[0]).toBe('#2 "Beta" · in progress');
    expect(said(answer)).toContain(
      "The generated files could not be read: ENOENT: no such file or directory, mkdtemp",
    );
    expect(warned(answer).map(sharedWords)).toEqual([
      '#1 "Alpha" and #2 "Beta" share src/ (src/a.ts)',
    ]);
  } finally {
    lead.close();
    second.close();
  }
});

test("a path set whose words begin an older note's words is still noted", () => {
  const w = generatedWorld();
  const lead = w.ops(LEAD);
  const second = w.ops(SECOND);
  try {
    said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["src.ts", "src"] }));
    said(second.call("create", { subject: "Beta", plan: "beta", files: ["src.ts"] }));
    said(lead.call("update", { task: "#1", status: "in_progress" }));
    said(second.call("update", { task: "#2", status: "in_progress" }));
    // "share src." begins "share src.ts.": the older note is not this one.
    said(second.call("update", { task: "#2", files: ["src"] }));
    expect(w.notes(2).map(sharedWords)).toEqual([
      '#1 "Alpha" and #2 "Beta" share src.ts',
      '#1 "Alpha" and #2 "Beta" share src',
    ]);
  } finally {
    lead.close();
    second.close();
  }
});

test("a merge file the base commits settles its path: no warning, and no note", () => {
  const w = generatedWorld();
  const lead = w.ops(LEAD);
  const second = w.ops(SECOND);
  try {
    said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["CHANGELOG.md"] }));
    said(second.call("create", { subject: "Beta", plan: "beta", files: ["CHANGELOG.md"] }));
    expect(warned(lead.call("update", { task: "#1", status: "in_progress" }))).toEqual([]);
    expect(warned(second.call("update", { task: "#2", status: "in_progress" }))).toEqual([]);
    expect([w.notes(1), w.notes(2)]).toEqual([[], []]);
  } finally {
    lead.close();
    second.close();
  }
});

test("a wider overlap adds a new note; the same one again adds none", () => {
  const w = generatedWorld();
  const lead = w.ops(LEAD);
  const second = w.ops(SECOND);
  try {
    said(
      lead.call("create", { subject: "Alpha", plan: "alpha", files: ["src.ts", "db/schema.ts"] }),
    );
    said(second.call("create", { subject: "Beta", plan: "beta", files: ["src.ts"] }));
    said(lead.call("update", { task: "#1", status: "in_progress" }));
    said(second.call("update", { task: "#2", status: "in_progress" }));
    expect(w.notes(2)).toHaveLength(1);
    // The same list again: the answer still warns, and no second note is saved.
    expect(
      warned(second.call("update", { task: "#2", files: ["src.ts"] })).map(sharedWords),
    ).toEqual(['#1 "Alpha" and #2 "Beta" share src.ts']);
    expect(w.notes(2)).toHaveLength(1);
    // A wider list: a new note on each plan.
    expect(
      warned(second.call("update", { task: "#2", files: ["src.ts", "db/schema.ts"] })).map(
        sharedWords,
      ),
    ).toEqual(['#1 "Alpha" and #2 "Beta" share db/schema.ts, src.ts']);
    expect([w.notes(1).length, w.notes(2).length]).toEqual([2, 2]);
  } finally {
    lead.close();
    second.close();
  }
});
