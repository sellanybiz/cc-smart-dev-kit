/**
 * A plan stacked on another (`stacked_on`): the overlap check skips that one parent plan, both
 * ways, while that parent holds its files (open, or done and still reserved until its pull request
 * merges) and the stack is proved (the stacked plan's start holds the parent's work); every other
 * plan still blocks. Only the lead of both plans sets a stack. What is refused, what the history
 * and the task tools show, and the schema step that brought the column.
 */
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../../cli/paths";
import { runGit } from "../../hooks/git";
import { hookEnv, makeRepo } from "../../testing/hooks";
import { git, tempDir } from "../../testing/temp";
import { folderProject } from "../context";
import { createTaskOps, type TaskAnswer } from "../ops";
import { provedStacks, type StackGit, stackHolds } from "../stack-proof";
import { openWorkDb, workDbFile } from "./db";
import { allTasks, eventsOf, filesOverlap, isStackedPair, rivalsOf, taskById } from "./queries";
import { readWorkStore } from "./read";
import {
  createTask,
  deleteTask,
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

test("a proved stack is held beside its parent although they share files, both ways", () => {
  const first = setup();
  plan(first.db, "alpha", ["src/a/"]);
  const beta = plan(first.db, "beta", ["src/a/x.ts", "lib/b.ts"], "alpha");
  ok(reserve(first.db, "alpha"));
  expect(ok(reserve(first.db, "beta", { stacked: [beta.id] })).lead).not.toBeNull();
  // The parent judged after the stacked plan skips it too.
  const second = setup();
  plan(second.db, "alpha", ["src/a/"]);
  const stacked = plan(second.db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(second.db, "beta", { stacked: [stacked.id] }));
  expect(ok(reserve(second.db, "alpha", { stacked: [stacked.id] })).lead).not.toBeNull();
});

test("a stack that is not proved is judged as rivals, both ways", () => {
  const first = setup();
  plan(first.db, "alpha", ["src/a/"]);
  plan(first.db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(first.db, "alpha"));
  // No proof given (the store's own default), or a proof of another plan: the pair are rivals.
  expect(why(reserve(first.db, "beta"))).toBe('#2 "beta" overlaps #1 "alpha": src/a/x.ts (src/a/)');
  expect(why(reserve(first.db, "beta", { stacked: ["w-another"] }))).toBe(
    '#2 "beta" overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
  const reversed = setup();
  plan(reversed.db, "alpha", ["src/a/"]);
  const beta = plan(reversed.db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(reversed.db, "beta", { stacked: [beta.id] }));
  expect(why(reserve(reversed.db, "alpha"))).toBe(
    '#1 "alpha" overlaps #2 "beta": src/a/ (src/a/x.ts)',
  );
});

test("every other plan still blocks: a third plan, and a plan stacked on the stacked one", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  plan(db, "gamma", ["src/a/y.ts"]);
  const delta = plan(db, "delta", ["src/a/x.ts"], "beta");
  const stacked = [beta.id, delta.id];
  ok(reserve(db, "alpha", { stacked }));
  ok(reserve(db, "beta", { stacked }));
  expect(why(reserve(db, "gamma", { stacked }))).toBe(
    '#3 "gamma" overlaps #1 "alpha": src/a/y.ts (src/a/)',
  );
  // delta skips beta, its own parent, and never alpha, beta's parent.
  expect(why(reserve(db, "delta", { stacked }))).toBe(
    '#4 "delta" overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
});

test("a parent done but still reserved is skipped while it holds its files; released, the pair ends", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  plan(db, "gamma", ["src/a/y.ts"]);
  const proved = new Set([beta.id]);
  ok(reserve(db, "alpha"));
  const done = ok(updateTask(db, alpha.id, { status: "done" }, LEAD, 5));
  // Built on alpha's branch, beta shares alpha's files by construction until alpha's pull request merges.
  expect(isStackedPair(beta, done, proved)).toBe(true);
  expect(ok(reserve(db, "beta", { stacked: [beta.id] })).lead).not.toBeNull();
  // A plan that is not stacked on alpha is still held off by it.
  expect(why(reserve(db, "gamma", { stacked: [beta.id] }))).toBe(
    '#3 "gamma" overlaps #1 "alpha" (done, not released: `cc-smart-dev-kit herdr plans` releases it when its pull request merges): src/a/y.ts (src/a/)',
  );
  const released = ok(releasePlan(db, { project: "p", plan: "alpha", who: LEAD, now: 6 }));
  expect(isStackedPair(beta, released, proved)).toBe(false);
});

test("the stacked pair is the one filter: open parent, either way, proved, never a third plan", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  const gamma = plan(db, "gamma", ["src/a/y.ts"]);
  const proved = new Set([beta.id]);
  expect([isStackedPair(beta, alpha, proved), isStackedPair(alpha, beta, proved)]).toEqual([
    true,
    true,
  ]);
  expect([isStackedPair(gamma, alpha, proved), isStackedPair(beta, gamma, proved)]).toEqual([
    false,
    false,
  ]);
  const none = new Set<string>();
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

test("clearing the stack of a held plan that shares its parent's files is refused", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"], "alpha");
  ok(reserve(db, "alpha"));
  ok(reserve(db, "beta", { stacked: [beta.id] }));
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

/** Commits `files` on the checked-out branch and returns the new commit. */
function commit(repo: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `change ${Object.keys(files).join(" ")}`);
  return git(repo, "rev-parse", "HEAD").trim();
}

/**
 * A repo whose `alpha-branch` leaves `main` at `base` and holds one commit (`tip`), and a `main`
 * that moved on by one commit of its own (`later`). Checked out on `main`.
 */
function stackRepo() {
  const repo = makeRepo();
  const base = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "checkout", "-q", "-b", "alpha-branch");
  const tip = commit(repo, { "alpha.txt": "1\n" });
  git(repo, "checkout", "-q", "main");
  const later = commit(repo, { "main.txt": "1\n" });
  const env = hookEnv();
  const run: StackGit = (args) => runGit(repo, args, env);
  return { repo, base, tip, later, run };
}

test("a stack is proved only when its start holds the parent's work on the parent's own line", () => {
  const { repo, base, tip, later, run } = stackRepo();
  const { db } = setup();
  const alpha = ok(
    updateTask(db, plan(db, "alpha", ["src/a/"]).id, { branch: "alpha-branch", base }, LEAD, 3),
  );
  // Started on the parent's tip, or on a commit past it: proved.
  expect(stackHolds(run, alpha, tip)).toBe(true);
  git(repo, "checkout", "-q", "-b", "beta-branch", "alpha-branch");
  const past = commit(repo, { "beta.txt": "1\n" });
  expect(stackHolds(run, alpha, past)).toBe(true);
  // The parent's branch moves on after the start: the start is still on its own line.
  git(repo, "checkout", "-q", "alpha-branch");
  const moved = commit(repo, { "alpha.txt": "2\n" });
  expect(stackHolds(run, alpha, tip)).toBe(true);
  expect(stackHolds(run, alpha, moved)).toBe(true);
  // Started on the default branch (the honest mistake: no --base), at the parent's own base, or
  // on nothing git knows: not proved.
  expect(stackHolds(run, alpha, later)).toBe(false);
  expect(stackHolds(run, alpha, base)).toBe(false);
  expect(stackHolds(run, alpha, null)).toBe(false);
  expect(stackHolds(run, alpha, "no-such-ref")).toBe(false);
  expect(stackHolds(run, alpha, "--all")).toBe(false);
  // A parent with no branch, no base, or no work past its base proves nothing.
  expect(stackHolds(run, { ...alpha, branch: null }, tip)).toBe(false);
  expect(stackHolds(run, { ...alpha, base: null }, tip)).toBe(false);
  expect(stackHolds(run, { ...alpha, branch: "gone-branch" }, tip)).toBe(false);
  expect(stackHolds(run, { ...alpha, base: moved }, moved)).toBe(false);
});

test("provedStacks names the stacked plans whose start, or recorded base, holds a parent that holds its files", () => {
  const { base, tip, later, run } = stackRepo();
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  ok(updateTask(db, alpha.id, { branch: "alpha-branch", base }, LEAD, 3));
  const onTip = plan(db, "on-tip", ["src/a/x.ts"], "alpha");
  ok(updateTask(db, onTip.id, { base: tip }, LEAD, 3));
  const onMain = plan(db, "on-main", ["src/a/y.ts"], "alpha");
  ok(updateTask(db, onMain.id, { base: later }, LEAD, 3));
  const unbased = plan(db, "unbased", ["src/a/z.ts"], "alpha");
  plan(db, "plain", ["src/a/w.ts"]);
  const all = () => allTasks(db, "p");
  expect(provedStacks(all(), run)).toEqual([onTip.id]);
  // A start given for a plan wins over its recorded base.
  expect(provedStacks(all(), run, { [onMain.id]: tip, [unbased.id]: tip })).toEqual([
    onTip.id,
    onMain.id,
    unbased.id,
  ]);
  expect(provedStacks(all(), run, { [onTip.id]: later })).toEqual([]);
  // A parent that no longer holds its files (dropped) proves no stack.
  ok(updateTask(db, alpha.id, { status: "dropped" }, LEAD, 4));
  expect(provedStacks(all(), run)).toEqual([]);
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
  // Another session's plan is never stacked on this lead's plan through the tools either.
  const other = w.ops(OTHER);
  try {
    said(other.call("create", { subject: "Theirs", plan: "theirs", files: ["src/a/y.ts"] }));
    expect(refused(other.call("update", { task: "#4", stacked_on: "alpha" }))).toBe(
      '#4 "Theirs" cannot be stacked on "alpha": #1 "Alpha" is not led by this session. A plan is stacked only on another plan of the same lead, whose branch it is built on',
    );
  } finally {
    other.close();
  }
});

test("a stacked plan starts beside its reserved parent only when its base holds the parent's work", () => {
  const w = world();
  const base = git(w.repo, "rev-parse", "HEAD").trim();
  git(w.repo, "checkout", "-q", "-b", "alpha-branch");
  const tip = commit(w.repo, { "alpha.txt": "1\n" });
  git(w.repo, "checkout", "-q", "main");
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
  const beta = lay(LEAD, "beta", ["src/a/x.ts"], "alpha");
  const gamma = lay(THIRD, "gamma", ["src/a/y.ts"]);
  const db = w.store();
  const row = (slug: string) =>
    allTasks(db, w.project).find((t) => t.kind === "plan" && t.plan === slug) as WorkTask;
  try {
    ok(updateTask(db, row("alpha").id, { branch: "alpha-branch", base }, LEAD, 5));
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
    // Beta records the default branch as its start: its stack is not proved, so alpha is a rival.
    ok(updateTask(db, row("beta").id, { base }, LEAD, 11));
  } finally {
    db.close();
  }
  const lead = w.ops(LEAD);
  const third = w.ops(THIRD);
  try {
    expect(refused(lead.call("update", { task: beta, status: "in_progress" }))).toContain(
      '"beta" cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)',
    );
    // Built on alpha's branch, it starts beside alpha in parallel.
    said(lead.call("update", { task: "#4", base: tip }));
    expect(said(lead.call("update", { task: beta, status: "in_progress" }))).toBe(
      `${beta} "beta phase" · in progress`,
    );
    expect(refused(third.call("update", { task: gamma, status: "in_progress" }))).toContain(
      '"gamma" cannot start, since it overlaps #1 "alpha": src/a/y.ts (src/a/)',
    );
  } finally {
    lead.close();
    third.close();
  }
});
