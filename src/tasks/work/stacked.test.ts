/**
 * A plan stacked on another (`stacked_on`), in the store: the overlap check skips that one parent
 * plan, both ways, while that parent holds its files (open, or done and still reserved until its
 * pull request merges), that very pair is proved, and one lead leads both; every other overlap is
 * still found and warned of. Only the lead of both plans sets a stack. What is refused, what the history shows, and
 * the schema step that brought the column. The proof from git and the task tools:
 * `src/tasks/stack-proof.test.ts`.
 */
import { expect, test } from "bun:test";
import { tempDir } from "../../testing/temp";
import { openWorkDb, workDbFile } from "./db";
import {
  allTasks,
  eventsOf,
  filesOverlap,
  isStackedPair,
  provedSet,
  rivalsOf,
  taskById,
} from "./queries";
import { readWorkStore } from "./read";
import {
  createTask,
  deleteTask,
  type PlanOverlap,
  type ReservePlan,
  releasePlan,
  reservePlan,
  takeTasks,
  updateTask,
} from "./store";
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

/** The proof of one stack, as `provedStacks` gives it: the plan and the parent it names. */
function on(task: WorkTask) {
  return { child: task.id, parent: task.stackedOn ?? "" };
}

function setup() {
  const paths = { stateDir: tempDir() };
  return { paths, db: openWorkDb(workDbFile(paths), { mode: "write" }) };
}
type Db = ReturnType<typeof setup>["db"];

function plan(db: Db, slug: string, files: string[], stackedOn?: string, who = LEAD): WorkTask {
  const made = ok(
    createTask(db, { project: "p", subject: slug, kind: "plan", plan: slug, files }, who, 1),
  );
  return stackedOn === undefined ? made : ok(updateTask(db, made.id, { stackedOn }, who, 2));
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
/** The overlaps a write found, each as `plan ~ other: path (other's path)`. */
function overlapWords(found: readonly PlanOverlap[]): string[] {
  return found.map(
    (one) =>
      `${one.plan.plan} ~ ${one.other.plan}: ${one.overlaps.map((o) => (o.path === o.other ? o.path : `${o.path} (${o.other})`)).join(", ")}`,
  );
}
/** Reserves `slug`, which must pass, and answers the overlaps the reservation found. */
function reserveFound(db: Db, slug: string, over: Partial<ReservePlan> = {}): string[] {
  const found: PlanOverlap[] = [];
  ok(reserve(db, slug, { ...over, found }));
  return overlapWords(found);
}

test("a proved stack is held beside its parent although they share files, both ways", () => {
  const first = setup();
  plan(first.db, "alpha", ["src/a/"]);
  const beta = plan(first.db, "beta", ["src/a/x.ts", "lib/b.ts"], "alpha");
  ok(reserve(first.db, "alpha"));
  // The pair settles its shared paths: no overlap is found, so none is warned of.
  expect(reserveFound(first.db, "beta", { stacked: [on(beta)] })).toEqual([]);
  // The parent judged after the stacked plan skips it too.
  const second = setup();
  plan(second.db, "alpha", ["src/a/"]);
  const stacked = plan(second.db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(second.db, "beta", { stacked: [on(stacked)] }));
  expect(reserveFound(second.db, "alpha", { stacked: [on(stacked)] })).toEqual([]);
});

test("a stack that is not proved is judged as rivals, both ways", () => {
  const first = setup();
  plan(first.db, "alpha", ["src/a/"]);
  const stacked = plan(first.db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(first.db, "alpha"));
  const rivals = ["beta ~ alpha: src/a/x.ts (src/a/)"];
  /** Reserves beta with `proof`, answers what it found, and lets beta go again. */
  const judged = (proof: { child: string; parent: string }[] | undefined) => {
    const words = reserveFound(first.db, "beta", proof === undefined ? {} : { stacked: proof });
    ok(releasePlan(first.db, { project: "p", plan: "beta", who: LEAD, now: 11 }));
    return words;
  };
  // No proof given (the store's own default), or a proof of another plan: the pair are rivals.
  expect(judged(undefined)).toEqual(rivals);
  expect(judged([{ child: "w-another", parent: "alpha" }])).toEqual(rivals);
  // A proof of the same plan on another parent is no proof of this pair.
  expect(judged([{ child: stacked.id, parent: "gamma" }])).toEqual(rivals);
  const reversed = setup();
  plan(reversed.db, "alpha", ["src/a/"]);
  const beta = plan(reversed.db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(reversed.db, "beta", { stacked: [on(beta)] }));
  expect(reserveFound(reversed.db, "alpha")).toEqual(["alpha ~ beta: src/a/ (src/a/x.ts)"]);
});

test("every other plan is still warned of: a third plan, and a plan stacked on the stacked one", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  plan(db, "gamma", ["src/a/y.ts"]);
  const delta = plan(db, "delta", ["src/a/x.ts"], "beta");
  const stacked = [on(beta), on(delta)];
  ok(reserve(db, "alpha", { stacked }));
  ok(reserve(db, "beta", { stacked }));
  expect(reserveFound(db, "gamma", { stacked })).toEqual(["gamma ~ alpha: src/a/y.ts (src/a/)"]);
  // delta skips beta, its own parent, and never alpha, beta's parent.
  expect(reserveFound(db, "delta", { stacked })).toEqual(["delta ~ alpha: src/a/x.ts (src/a/)"]);
});

test("a parent done but still reserved is skipped while it holds its files; released, the pair ends", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  plan(db, "gamma", ["src/a/y.ts"]);
  const proved = provedSet([on(beta)]);
  ok(reserve(db, "alpha"));
  const done = ok(updateTask(db, alpha.id, { status: "done" }, LEAD, 5));
  // Built on alpha's branch, beta shares alpha's files by construction until alpha's pull request merges.
  expect(isStackedPair(beta, done, proved)).toBe(true);
  expect(reserveFound(db, "beta", { stacked: [on(beta)] })).toEqual([]);
  // A plan that is not stacked on alpha is still found overlapping it.
  expect(reserveFound(db, "gamma", { stacked: [on(beta)] })).toEqual([
    "gamma ~ alpha: src/a/y.ts (src/a/)",
  ]);
  const released = ok(releasePlan(db, { project: "p", plan: "alpha", who: LEAD, now: 6 }));
  expect(isStackedPair(beta, released, proved)).toBe(false);
});

test("the stacked pair is the one filter: open parent, either way, proved, never a third plan", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  const gamma = plan(db, "gamma", ["src/a/y.ts"]);
  const proved = provedSet([on(beta)]);
  expect([isStackedPair(beta, alpha, proved), isStackedPair(alpha, beta, proved)]).toEqual([
    true,
    true,
  ]);
  expect([isStackedPair(gamma, alpha, proved), isStackedPair(beta, gamma, proved)]).toEqual([
    false,
    false,
  ]);
  const none = provedSet();
  expect([isStackedPair(beta, alpha, none), isStackedPair(alpha, beta, none)]).toEqual([
    false,
    false,
  ]);
  const held = [alpha, beta, gamma].map((one) => ({ plan: one }));
  expect(rivalsOf(held, beta, proved).map((h) => h.plan.plan)).toEqual(["gamma"]);
  expect(rivalsOf(held, alpha, proved).map((h) => h.plan.plan)).toEqual(["gamma"]);
  expect(rivalsOf(held, beta, none).map((h) => h.plan.plan)).toEqual(["alpha", "gamma"]);
  // The pair still overlaps as files: only the judging skips it.
  expect(filesOverlap(beta.files, alpha.files)).toHaveLength(1);
  const done = ok(updateTask(db, alpha.id, { status: "dropped" }, LEAD, 5));
  expect(isStackedPair(beta, done, proved)).toBe(false);
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

test("only the lead of both plans stacks one on the other: another lead's stack is refused", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const theirs = plan(db, "theirs", ["src/a/x.ts"], undefined, OTHER);
  // A session stacks its own plan on another lead's plan: refused, and nothing is written.
  expect(why(updateTask(db, theirs.id, { stackedOn: "alpha" }, OTHER, 3))).toBe(
    '#2 "theirs" cannot be stacked on "alpha": #1 "alpha" is not led by this session. A plan is stacked only on another plan of the same lead, whose branch it is built on',
  );
  // Nor may it stack another lead's plan on its own, or set a stack between two plans of another.
  expect(why(updateTask(db, alpha.id, { stackedOn: "theirs" }, OTHER, 3))).toBe(
    '#1 "alpha" cannot be stacked on "theirs": #1 "alpha" is not led by this session. A plan is stacked only on another plan of the same lead, whose branch it is built on',
  );
  const mine = plan(db, "mine", ["src/m/"]);
  expect(why(updateTask(db, mine.id, { stackedOn: "alpha" }, THIRD, 3))).toBe(
    '#3 "mine" cannot be stacked on "alpha": #3 "mine" and #1 "alpha" are not led by this session. A plan is stacked only on another plan of the same lead, whose branch it is built on',
  );
  expect(taskById(db, theirs.id).stackedOn).toBeNull();
  // The lead of a plan handed to a child (the child took it, so it made the plan its own) still
  // leads it through the reservation: it stacks its next plan on it.
  ok(reserve(db, "alpha"));
  const CHILD: Who = { sessionId: "child", pid: 8505, procStart: "85050" };
  ok(
    takeTasks(db, "p", alpha.id, CHILD, 4, {
      from: taskById(db, alpha.id).lead?.handoutId ?? "",
      isLive: () => false,
    }),
  );
  expect(taskById(db, alpha.id).createdBy).toBe("child");
  expect(ok(updateTask(db, mine.id, { stackedOn: "alpha" }, LEAD, 4)).stackedOn).toBe("alpha");
  // Clearing a stack only adds checks, so another session may.
  expect(ok(updateTask(db, mine.id, { stackedOn: null }, CHILD, 5)).stackedOn).toBeNull();
});

test("the lead is judged when the overlap is, not only when the stack was set: a proved pair taken apart is rivals", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(db, "alpha"));
  expect(isStackedPair(beta, taskById(db, alpha.id), provedSet([on(beta)]))).toBe(true);
  // Another session takes beta: the store still holds the stack and the caller still brings its proof.
  ok(takeTasks(db, "p", beta.id, OTHER, 3, { isLive: () => false }));
  const taken = taskById(db, beta.id);
  expect([taken.createdBy, taken.stackedOn]).toEqual(["other", "alpha"]);
  expect(isStackedPair(taken, taskById(db, alpha.id), provedSet([on(taken)]))).toBe(false);
  expect(reserveFound(db, "beta", { who: OTHER, stacked: [on(taken)] })).toEqual([
    "beta ~ alpha: src/a/x.ts (src/a/)",
  ]);
});

test("clearing the stack of a held plan that shares its parent's files finds the overlap", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(db, "alpha"));
  ok(reserve(db, "beta", { stacked: [on(beta)] }));
  const found: PlanOverlap[] = [];
  const filesCheck = { ignore: [], caseFold: false, found };
  ok(updateTask(db, beta.id, { stackedOn: null, filesCheck }, LEAD, 5));
  expect(overlapWords(found)).toEqual(["beta ~ alpha: src/a/x.ts (src/a/)"]);
  expect(taskById(db, beta.id).stackedOn).toBeNull();
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
