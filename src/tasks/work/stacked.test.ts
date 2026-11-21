/**
 * A plan stacked on another (`stacked_on`): the overlap check skips that one parent plan, both
 * ways, while it is open; every other plan still blocks. What is refused, what the history and
 * the task tools show, and the schema step that brought the column.
 */
import { expect, test } from "bun:test";
import { cliPaths } from "../../cli/paths";
import { hookEnv, makeRepo } from "../../testing/hooks";
import { tempDir } from "../../testing/temp";
import { folderProject } from "../context";
import { createTaskOps, type TaskAnswer } from "../ops";
import { openWorkDb, workDbFile } from "./db";
import { allTasks, eventsOf, filesOverlap, isStackedPair, rivalsOf, taskById } from "./queries";
import { readWorkStore } from "./read";
import { createTask, deleteTask, type ReservePlan, reservePlan, updateTask } from "./store";
import type { Result, Who, WorkTask } from "./types";

const LEAD: Who = { sessionId: "lead", pid: 4101, procStart: "41010" };
const OTHER: Who = { sessionId: "other", pid: 6303, procStart: "63030" };
const THIRD: Who = { sessionId: "third", pid: 7404, procStart: "74040" };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function why<T>(result: Result<T>): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.why;
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
type Db = ReturnType<typeof setup>["db"];

function plan(db: Db, slug: string, files: string[], stackedOn?: string): WorkTask {
  const made = ok(
    createTask(db, { project: "p", subject: slug, kind: "plan", plan: slug, files }, LEAD, 1),
  );
  return stackedOn === undefined ? made : ok(updateTask(db, made.id, { stackedOn }, LEAD, 2));
}
function reserve(db: Db, slug: string, over: Partial<ReservePlan> = {}) {
  return reservePlan(db, {
    project: "p",
    plan: slug,
    who: LEAD,
    holder: "child",
    ignore: [],
    caseFold: false,
    now: 10,
    ...over,
  });
}

test("a plan stacked on another is held beside it although they share files, both ways", () => {
  const first = setup();
  plan(first.db, "alpha", ["src/a/"]);
  plan(first.db, "beta", ["src/a/x.ts", "lib/b.ts"], "alpha");
  ok(reserve(first.db, "alpha"));
  expect(ok(reserve(first.db, "beta")).lead).not.toBeNull();
  // The parent judged after the stacked plan skips it too.
  const second = setup();
  plan(second.db, "alpha", ["src/a/"]);
  plan(second.db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(second.db, "beta"));
  expect(ok(reserve(second.db, "alpha")).lead).not.toBeNull();
});

test("every other plan still blocks: a third plan, and a plan stacked on the stacked one", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["src/a/x.ts"], "alpha");
  plan(db, "gamma", ["src/a/y.ts"]);
  plan(db, "delta", ["src/a/x.ts"], "beta");
  ok(reserve(db, "alpha"));
  ok(reserve(db, "beta"));
  expect(why(reserve(db, "gamma"))).toBe('#3 "gamma" overlaps #1 "alpha": src/a/y.ts (src/a/)');
  // delta skips beta, its own parent, and never alpha, beta's parent.
  expect(why(reserve(db, "delta"))).toBe('#4 "delta" overlaps #1 "alpha": src/a/x.ts (src/a/)');
});

test("a parent that is closed is judged again, done but not released included", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(db, "alpha"));
  ok(updateTask(db, alpha.id, { status: "done" }, LEAD, 5));
  expect(why(reserve(db, "beta"))).toBe(
    '#2 "beta" overlaps #1 "alpha" (done, not released: `cc-smart-dev-kit herdr plans` releases it when its pull request merges): src/a/x.ts (src/a/)',
  );
});

test("the stacked pair is the one filter: open parent, either way, never a third plan", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  const gamma = plan(db, "gamma", ["src/a/y.ts"]);
  expect([isStackedPair(beta, alpha), isStackedPair(alpha, beta)]).toEqual([true, true]);
  expect([isStackedPair(gamma, alpha), isStackedPair(beta, gamma)]).toEqual([false, false]);
  const held = [alpha, beta, gamma].map((one) => ({ plan: one }));
  expect(rivalsOf(held, beta).map((h) => h.plan.plan)).toEqual(["gamma"]);
  expect(rivalsOf(held, alpha).map((h) => h.plan.plan)).toEqual(["gamma"]);
  // The pair still overlaps as files: only the judging skips it.
  expect(filesOverlap(beta.files, alpha.files)).toHaveLength(1);
  const done = ok(updateTask(db, alpha.id, { status: "dropped" }, LEAD, 5));
  expect(isStackedPair(beta, done)).toBe(false);
});

test("a stack names a plan of the project: never itself, a missing plan, a loop or a non-plan", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/b/"], "alpha");
  const gamma = plan(db, "gamma", ["src/g/"], "beta");
  expect(why(updateTask(db, alpha.id, { stackedOn: "alpha" }, LEAD, 3))).toBe(
    '#1 "alpha" cannot be stacked on itself',
  );
  expect(why(updateTask(db, alpha.id, { stackedOn: "nope" }, LEAD, 3))).toBe(
    'Plan "nope" not found: stacked_on names a plan of this project',
  );
  expect(why(updateTask(db, alpha.id, { stackedOn: "gamma" }, LEAD, 3))).toBe(
    '#1 "alpha" cannot be stacked on "gamma": that would make a loop (alpha → gamma → beta → alpha)',
  );
  const step = ok(createTask(db, { project: "p", subject: "loose" }, LEAD, 3));
  expect(why(updateTask(db, step.id, { stackedOn: "alpha" }, LEAD, 3))).toBe(
    '#4 "loose" is a task: only a plan is stacked on another plan',
  );
  // A refused stack writes nothing; null clears one, and the history keeps both changes.
  expect(taskById(db, alpha.id).stackedOn).toBeNull();
  expect(ok(updateTask(db, gamma.id, { stackedOn: null }, LEAD, 4)).stackedOn).toBeNull();
  expect(eventsOf(db, gamma).map((e) => e.changes.stackedOn)).toEqual([
    undefined,
    [null, "beta"],
    ["beta", null],
  ]);
  expect(taskById(db, beta.id).stackedOn).toBe("alpha");
});

test("clearing the stack of a held plan that shares its parent's files is refused", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(db, "alpha"));
  ok(reserve(db, "beta"));
  expect(why(updateTask(db, beta.id, { stackedOn: null }, LEAD, 5))).toBe(
    '#2 "beta" is held, so its files may not overlap another held plan: overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
  expect(taskById(db, beta.id).stackedOn).toBe("alpha");
});

test("a plan another plan is stacked on is not deleted until the stack is cleared", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", []);
  const beta = plan(db, "beta", [], "alpha");
  expect(why(deleteTask(db, alpha.id, LEAD, 3))).toBe(
    '#2 "beta" is stacked on it: clear that first (task_update with stacked_on null)',
  );
  ok(updateTask(db, beta.id, { stackedOn: null }, LEAD, 4));
  expect(ok(deleteTask(db, alpha.id, LEAD, 5))).toBe(true);
});

test("a schema 6 store moves to 7: a hook reads no stack before, and the column comes after", () => {
  const { paths, db } = setup();
  plan(db, "alpha", ["src/a/"]);
  db.sqlite.run("ALTER TABLE tasks DROP COLUMN stacked_on");
  db.sqlite.run("PRAGMA user_version = 6");
  db.close();
  expect(
    readWorkStore(paths, (hook) => allTasks(hook, "p").map((t) => [t.plan, t.stackedOn])),
  ).toEqual({ state: "ready", value: [["alpha", null]] });
  const moved = openWorkDb(workDbFile(paths), { mode: "write" });
  try {
    expect(moved.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 7 });
    expect(moved.sqlite.query("SELECT value FROM meta WHERE key='min_compatible'").get()).toEqual({
      value: "1",
    });
    plan(moved, "beta", ["src/b/"], "alpha");
    expect(allTasks(moved, "p").map((t) => t.stackedOn)).toEqual([null, "alpha"]);
  } finally {
    moved.close();
  }
});

/** The task tools in a temp repo, for any caller, with nothing ignored and case compared. */
function world() {
  const repo = makeRepo();
  const env = hookEnv();
  const paths = cliPaths(env);
  const ops = (who: Who) =>
    createTaskOps({
      stateDir: paths.stateDir,
      env,
      cwd: () => repo,
      caller: () => ({ ...who, cwd: repo }),
      filesCheck: () => ({ ignore: [], caseFold: false }),
    });
  const store = () => openWorkDb(workDbFile(paths), { mode: "write" });
  return { repo, project: folderProject(repo), ops, store };
}

test("the task tools set a stack on create and update, show it, and refuse it off a plan", () => {
  const w = world();
  const ops = w.ops(LEAD);
  try {
    said(ops.call("create", { subject: "Alpha", plan: "alpha", files: ["src/a/"] }));
    expect(
      said(
        ops.call("create", {
          subject: "Beta",
          plan: "beta",
          files: ["src/a/x.ts"],
          stacked_on: "alpha",
        }),
      ),
    ).toBe('#2 "Beta" · plan beta');
    said(ops.call("create", { subject: "Beta phase", plan: "beta", phase: "A" }));
    expect(said(ops.call("list", { scope: "plan", plan: "beta" }))).toContain(
      "#2 [queued · plan · stacked on alpha] Beta",
    );
    expect(said(ops.call("get", { task: "#2" }))).toContain(
      '#2 "Beta" [plan · pending · stacked on alpha]',
    );
    expect(
      refused(ops.call("create", { subject: "B", plan: "beta", phase: "B", stacked_on: "alpha" })),
    ).toBe(
      "stacked_on belongs to a plan task: create the plan with plan and a subject (no phase, no parent), or set it with task_update",
    );
    expect(refused(ops.call("update", { task: "#3", stacked_on: "alpha" }))).toBe(
      '#3 "Beta phase" is a phase: only a plan task is stacked on another plan (set stacked_on on the plan\'s own #n)',
    );
    expect(refused(ops.call("update", { task: "#2", stacked_on: "beta" }))).toBe(
      '#2 "Beta" cannot be stacked on itself',
    );
    expect(said(ops.call("update", { task: "#2", stacked_on: null }))).toBe('#2 "Beta" · pending');
  } finally {
    ops.close();
  }
});

test("a stacked plan starts beside its reserved parent; another plan's start is still refused", () => {
  const w = world();
  const lay = (who: Who, slug: string, files: string[], stackedOn?: string) => {
    const ops = w.ops(who);
    try {
      said(
        ops.call("create", {
          subject: slug,
          plan: slug,
          files,
          ...(stackedOn === undefined ? {} : { stacked_on: stackedOn }),
        }),
      );
      said(ops.call("create", { subject: `${slug} phase`, plan: slug, phase: "A" }));
      const db = w.store();
      try {
        const phase = allTasks(db, w.project).find((t) => t.plan === slug && t.kind === "phase");
        said(ops.call("create", { subject: `${slug} step`, parent: `#${phase?.number}` }));
        return `#${phase?.number}`;
      } finally {
        db.close();
      }
    } finally {
      ops.close();
    }
  };
  lay(LEAD, "alpha", ["src/a/"]);
  const beta = lay(OTHER, "beta", ["src/a/x.ts"], "alpha");
  const gamma = lay(THIRD, "gamma", ["src/a/y.ts"]);
  const db = w.store();
  try {
    ok(
      reservePlan(db, {
        project: w.project,
        plan: "alpha",
        who: LEAD,
        holder: "child",
        ignore: [],
        caseFold: false,
        now: 10,
      }),
    );
  } finally {
    db.close();
  }
  const other = w.ops(OTHER);
  const third = w.ops(THIRD);
  try {
    expect(said(other.call("update", { task: beta, status: "in_progress" }))).toBe(
      `${beta} "beta phase" · in progress`,
    );
    expect(refused(third.call("update", { task: gamma, status: "in_progress" }))).toContain(
      '"gamma" cannot start, since it overlaps #1 "alpha": src/a/y.ts (src/a/)',
    );
  } finally {
    other.close();
    third.close();
  }
});
