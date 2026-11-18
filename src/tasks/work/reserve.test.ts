/**
 * Reserving a plan for a lead (D4): the atomic checks, the held set, release, who may take a
 * reserved plan, who may start work in it, and the store-only classifier the status line reads.
 */
import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../../build-info/names";
import { cliPaths } from "../../cli/paths";
import { hookEnv, makeRepo } from "../../testing/hooks";
import { tempDir } from "../../testing/temp";
import { folderProject } from "../context";
import { createTaskOps, type TaskAnswer } from "../ops";
import { openWorkDb, workDbFile } from "./db";
import { sessionEnded } from "./identity";
import { classifyLeadPlans, type LeadPlanState } from "./lead-plans";
import { allTasks, eventsOf, heldPlans, isLead, taskById } from "./queries";
import {
  createTask,
  type ReservePlan,
  reclaimResumed,
  releasePlan,
  reservePlan,
  takeTasks,
  updateTask,
} from "./store";
import type { ClaimProcess, Result, Who, WorkClaim, WorkTask } from "./types";

const LEAD: Who = { sessionId: "lead", pid: 4101, procStart: "41010" };
const CHILD: Who = { sessionId: "child", pid: 5202, procStart: "52020" };
const OTHER: Who = { sessionId: "other", pid: 6303, procStart: "63030" };
const NOBODY: ClaimProcess = { live: () => false, gone: () => false, ended: () => false };

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
/** The words of a refused result. */
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

/** One store file, a project key and a plan maker; connections open on demand. */
function setup() {
  const paths = { stateDir: tempDir() };
  const open = () => openWorkDb(workDbFile(paths), { mode: "write" });
  return { paths, db: open(), open };
}
type Db = ReturnType<typeof setup>["db"];

function plan(
  db: Db,
  slug: string,
  files: string[] | undefined,
  options: { who?: Who; blockedBy?: string[]; now?: number } = {},
): WorkTask {
  return ok(
    createTask(
      db,
      {
        project: "p",
        subject: slug,
        kind: "plan",
        plan: slug,
        ...(files === undefined ? {} : { files }),
        ...(options.blockedBy ? { blockedBy: options.blockedBy } : {}),
      },
      options.who ?? LEAD,
      options.now ?? 1,
    ),
  );
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
function leadOf(db: Db, id: string) {
  return taskById(db, id).lead;
}

test("a reservation writes the lead, records it in the history, and the plan is held", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const reserved = ok(reserve(db, "alpha"));
  expect(reserved.lead).toMatchObject({
    sessionId: "lead",
    pid: 4101,
    procStart: "41010",
    holder: "child",
  });
  expect(reserved.lead?.handoutId).toMatch(/^h[a-z2-7]{10}$/);
  expect(reserved.status).toBe("pending");
  const event = eventsOf(db, alpha).at(-1);
  expect([event?.action, event?.reason, event?.changes.lead]).toEqual([
    "changed",
    "plan reserved",
    [null, "lead (child)"],
  ]);
  expect(heldPlans(db, "p", LEAD).map((h) => [h.plan.plan, h.why, h.mine, h.files])).toEqual([
    ["alpha", "reserved", true, ["src/a/"]],
  ]);
  expect(heldPlans(db, "p", OTHER).map((h) => h.mine)).toEqual([false]);
});

test("a plan that overlaps a reserved plan is refused, naming the plan and the files", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/", "docs/x.md"]);
  plan(db, "beta", ["src/a/inner.ts", "docs/x.md", "lib/free.ts"]);
  ok(reserve(db, "alpha"));
  expect(why(reserve(db, "beta"))).toBe(
    '#2 "beta" overlaps #1 "alpha": docs/x.md, src/a/inner.ts (src/a/)',
  );
  expect(allTasks(db, "p")[1]?.lead).toBeNull();
});

test("a plan with an open blocker is refused, naming the blocker", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["src/b/"], { blockedBy: [alpha.id] });
  expect(why(reserve(db, "beta"))).toBe('#2 "beta" waits for #1 "alpha" (pending)');
  // A closed blocker lets it go.
  ok(updateTask(db, alpha.id, { status: "done" }, LEAD, 5));
  expect(ok(reserve(db, "beta")).lead?.sessionId).toBe("lead");
});

test("a plan with no file list is refused, with the call that sets one", () => {
  const { db } = setup();
  plan(db, "alpha", undefined);
  expect(why(reserve(db, "alpha"))).toBe(
    '#1 "alpha" has no file list: set it first (task_update with files), so overlaps can be checked',
  );
  plan(db, "beta", []);
  expect(why(reserve(db, "beta"))).toContain("has no file list");
});

test("a plan that is already reserved is refused, even for the lead that holds it", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha"));
  expect(why(reserve(db, "alpha"))).toBe('#1 "alpha" is already reserved for session lead');
  expect(why(reserve(db, "alpha", { who: OTHER }))).toContain("belongs to another session");
});

test("only an open, pending plan of the caller's own is reserved, and the caller needs a session", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  expect(why(reserve(db, "missing"))).toBe('Plan "missing" not found');
  expect(why(reserve(db, "alpha", { who: OTHER }))).toBe(
    '#1 "alpha" belongs to another session: only its owner reserves it',
  );
  expect(why(reserve(db, "alpha", { who: { sessionId: null, pid: null, procStart: null } }))).toBe(
    "reserve needs a resolvable calling session",
  );
  ok(updateTask(db, alpha.id, { status: "in_progress" }, LEAD, 2));
  expect(why(reserve(db, "alpha"))).toBe(
    '#1 "alpha" is in progress: only an open, pending plan is reserved',
  );
});

test("a refused reservation changes nothing", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/a/x.ts"]);
  ok(reserve(db, "alpha"));
  const before = eventsOf(db, beta).length;
  expect(reserve(db, "beta").ok).toBe(false);
  expect(eventsOf(db, beta)).toHaveLength(before);
  expect(taskById(db, beta.id).lead).toBeNull();
  expect(taskById(db, beta.id).updatedAt).toBe(1);
});

test("merge files take no part in the check, and case folds when the file system does", () => {
  const { db } = setup();
  plan(db, "alpha", ["CHANGELOG.md", "src/a/"]);
  plan(db, "beta", ["CHANGELOG.md", "plugin/dist/cli.js"]);
  plan(db, "gamma", ["SRC/A/y.ts"], { now: 3 });
  ok(reserve(db, "alpha"));
  expect(why(reserve(db, "beta"))).toContain("overlaps #1");
  expect(ok(reserve(db, "beta", { ignore: ["CHANGELOG.md", "plugin/dist/"] })).lead).not.toBeNull();
  // Folded, the ignore list too: `changelog.md` leaves out `CHANGELOG.md`.
  expect(why(reserve(db, "gamma", { caseFold: true }))).toBe(
    '#3 "gamma" overlaps #1 "alpha": SRC/A/y.ts (src/a/)',
  );
  expect(ok(reserve(db, "gamma")).lead).not.toBeNull();
});

test("a held plan's branch diff counts: files its branch reached overlap too", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["lib/stray.ts"]);
  ok(reserve(db, "alpha"));
  // Without the diff, beta is clear; with it, it overlaps what alpha's branch touched.
  expect(heldPlans(db, "p", LEAD, { [alpha.id]: ["lib/stray.ts"] })[0]?.files).toEqual([
    "src/a/",
    "lib/stray.ts",
  ]);
  expect(why(reserve(db, "beta", { extraFiles: { [alpha.id]: ["lib/stray.ts"] } }))).toBe(
    '#2 "beta" overlaps #1 "alpha": lib/stray.ts',
  );
  expect(ok(reserve(db, "beta")).lead).not.toBeNull();
});

test("two reservations at once: the second one reads the first and refuses", () => {
  const { db, open } = setup();
  plan(db, "alpha", ["src/shared/a.ts"]);
  plan(db, "beta", ["src/shared/"], { now: 2 });
  const second = open();
  try {
    // Each connection is its own session of the store; the write lock orders them.
    expect(ok(reserve(db, "alpha")).lead?.sessionId).toBe("lead");
    expect(why(reserve(second, "beta"))).toBe(
      '#2 "beta" overlaps #1 "alpha": src/shared/ (src/shared/a.ts)',
    );
    expect(leadOf(second, allTasks(second, "p")[1]?.id ?? "")).toBeNull();
  } finally {
    second.close();
  }
});

test("a session's own plan in flight is held without a reservation", () => {
  const { db } = setup();
  const solo = plan(db, "solo", ["src/s/"], { who: OTHER });
  plan(db, "alpha", ["src/s/x.ts"]);
  ok(updateTask(db, solo.id, { status: "in_progress" }, OTHER, 2));
  expect(heldPlans(db, "p", LEAD).map((h) => [h.plan.plan, h.why, h.mine])).toEqual([
    ["solo", "in-flight", false],
  ]);
  expect(why(reserve(db, "alpha"))).toBe('#2 "alpha" overlaps #1 "solo": src/s/x.ts (src/s/)');
  // Once it stops running it holds nothing.
  ok(updateTask(db, solo.id, { status: "pending" }, OTHER, 3));
  expect(ok(reserve(db, "alpha")).lead).not.toBeNull();
});

test("a release frees the files; a plan done but not released still holds them; a drop releases", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["src/a/x.ts"]);
  ok(reserve(db, "alpha"));
  ok(updateTask(db, alpha.id, { status: "done" }, LEAD, 5));
  // The child's pull request may still be open: the reservation holds until it is released.
  expect(why(reserve(db, "beta"))).toContain("overlaps #1");
  const released = ok(releasePlan(db, { project: "p", plan: "alpha", who: LEAD, now: 6 }));
  expect(released.lead).toBeNull();
  expect(eventsOf(db, alpha).at(-1)?.reason).toBe("plan released");
  // Releasing again changes nothing.
  const events = eventsOf(db, alpha).length;
  ok(releasePlan(db, { project: "p", plan: "alpha", who: LEAD, now: 7 }));
  expect(eventsOf(db, alpha)).toHaveLength(events);
  expect(ok(reserve(db, "beta")).lead).not.toBeNull();
  expect(why(releasePlan(db, { project: "p", plan: "nope", who: LEAD, now: 8 }))).toBe(
    'Plan "nope" not found',
  );
  // A dropped plan is released by the drop itself.
  plan(db, "gamma", ["lib/g/"]);
  const gamma = ok(reserve(db, "gamma"));
  ok(updateTask(db, gamma.id, { status: "dropped" }, LEAD, 9));
  expect(taskById(db, gamma.id).lead).toBeNull();
});

test("a held plan's files may not grow into another held plan, by stored lists", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/b/"]);
  const gamma = plan(db, "gamma", ["src/g/"]);
  ok(reserve(db, "alpha"));
  ok(reserve(db, "beta"));
  const refusal = updateTask(db, beta.id, { files: ["src/b/", "src/a/inner.ts"] }, LEAD, 5);
  expect(why(refusal)).toBe(
    '#2 "beta" is held, so its files may not overlap another held plan: overlaps #1 "alpha": src/a/inner.ts (src/a/)',
  );
  expect(taskById(db, beta.id).files).toEqual(["src/b/"]);
  // A disjoint list is taken, and a merge file is left out of the check.
  ok(updateTask(db, beta.id, { files: ["src/b/", "docs/"] }, LEAD, 6));
  ok(
    updateTask(
      db,
      beta.id,
      { files: ["src/b/", "src/a/inner.ts"], filesCheck: { ignore: ["src/a/"], caseFold: false } },
      LEAD,
      7,
    ),
  );
  // A plan that is not held takes any list: reservePlan judges it later.
  ok(updateTask(db, gamma.id, { files: ["src/a/"] }, LEAD, 8));
  expect(why(reserve(db, "gamma"))).toContain("overlaps #1");
  expect(alpha.files).toEqual(["src/a/"]);
});

function world() {
  const repo = makeRepo();
  const env = hookEnv();
  const paths = cliPaths(env);
  const project = folderProject(repo);
  const ops = (who: Who) =>
    createTaskOps({
      stateDir: paths.stateDir,
      env,
      cwd: () => repo,
      caller: () => ({ ...who, cwd: repo }),
      filesCheck: () => ({ ignore: [], caseFold: false }),
    });
  const store = () => openWorkDb(workDbFile(paths), { mode: "write" });
  return { repo, env, paths, project, ops, store };
}

/** A plan with one phase holding one task, made through the task tools by `who`. */
function laidPlan(w: ReturnType<typeof world>, who: Who, slug: string, files: string[]) {
  const ops = w.ops(who);
  try {
    said(ops.call("create", { subject: slug, plan: slug, files }));
    said(ops.call("create", { subject: `${slug} phase`, plan: slug, phase: "A" }));
    const db = w.store();
    try {
      const phase = allTasks(db, w.project).find((t) => t.plan === slug && t.kind === "phase");
      said(ops.call("create", { subject: `${slug} step`, parent: `#${phase?.number}` }));
      return { phase: `#${phase?.number}` };
    } finally {
      db.close();
    }
  } finally {
    ops.close();
  }
}
function reserveIn(
  w: ReturnType<typeof world>,
  slug: string,
  who: Who,
  over: Partial<ReservePlan> = {},
) {
  const db = w.store();
  try {
    return reservePlan(db, {
      project: w.project,
      plan: slug,
      who,
      holder: "child",
      ignore: [],
      caseFold: false,
      now: 10,
      ...over,
    });
  } finally {
    db.close();
  }
}

test("the lead reserves its own plan, starts it, and a later overlapping reservation refuses", () => {
  const w = world();
  const alpha = laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const ops = w.ops(LEAD);
  try {
    said(ops.call("create", { subject: "Beta", plan: "beta", files: ["src/a/inner.ts"] }));
    said(ops.call("create", { subject: "Gamma", plan: "gamma", files: ["lib/g/"] }));
    expect(ok(reserveIn(w, "alpha", LEAD, { holder: "self" })).lead?.sessionId).toBe("lead");
    // The usual start: the phase goes in progress, and the reserved plan with it.
    said(ops.call("update", { task: alpha.phase, status: "in_progress" }));
    expect(said(ops.call("get", { task: "#1" }))).toContain("[plan · in progress]");
    expect(said(ops.call("get", { task: "#1" }))).toContain("Reserved for: session lead");
    // Held twice over now (reserved and in flight): a child's plan on its files refuses.
    expect(why(reserveIn(w, "beta", LEAD))).toContain('overlaps #1 "alpha"');
    // A plan on other files is handed out.
    expect(ok(reserveIn(w, "gamma", LEAD)).lead).not.toBeNull();
  } finally {
    ops.close();
  }
});

test("another session's unreserved plan in flight blocks an overlapping reservation", () => {
  const w = world();
  const solo = laidPlan(w, OTHER, "solo", ["src/s/"]);
  const other = w.ops(OTHER);
  const lead = w.ops(LEAD);
  try {
    said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["src/s/x.ts"] }));
    said(other.call("update", { task: solo.phase, status: "in_progress" }));
    expect(why(reserveIn(w, "alpha", LEAD))).toBe(
      '#4 "Alpha" overlaps #1 "solo": src/s/x.ts (src/s/)',
    );
  } finally {
    other.close();
    lead.close();
  }
});

test("task_update files on a held plan reads the merge files before the lock and refuses an overlap", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const ops = w.ops(LEAD);
  try {
    said(ops.call("create", { subject: "Beta", plan: "beta", files: ["src/b/"] }));
    expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
    expect(ok(reserveIn(w, "beta", LEAD)).lead).not.toBeNull();
    expect(refused(ops.call("update", { task: "#4", files: ["src/b/", "src/a/x.ts"] }))).toBe(
      '#4 "Beta" is held, so its files may not overlap another held plan: overlaps #1 "alpha": src/a/x.ts (src/a/)',
    );
    said(ops.call("update", { task: "#4", files: ["src/b/", "docs/"] }));
  } finally {
    ops.close();
  }
});

test("task_update files on a held plan works with the real git read of the checkout", () => {
  const repo = makeRepo();
  const env = hookEnv();
  const stateDir = cliPaths(env).stateDir;
  const lead = createTaskOps({
    stateDir,
    env,
    cwd: () => repo,
    caller: () => ({ ...LEAD, cwd: repo }),
  });
  const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
  try {
    said(lead.call("create", { subject: "Alpha", plan: "alpha", files: ["src/a/"] }));
    said(lead.call("create", { subject: "Beta", plan: "beta", files: ["src/b/"] }));
    const project = folderProject(repo);
    for (const slug of ["alpha", "beta"])
      ok(
        reservePlan(db, {
          project,
          plan: slug,
          who: LEAD,
          holder: "child",
          ignore: [],
          caseFold: false,
          now: 5,
        }),
      );
    // No origin and no committed list: the merge files are empty, the check still runs.
    expect(refused(lead.call("update", { task: "#2", files: ["src/a/"] }))).toContain(
      "overlaps #1",
    );
  } finally {
    db.close();
    lead.close();
  }
});

test("a reserved plan is taken only from its lead, once", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha"));
  const live = { isLive: () => false };
  const take = (who: Who, options: { from?: string; force?: boolean } = {}) =>
    takeTasks(db, "p", alpha.id, who, 20, { ...live, ...options });
  expect(why(take(CHILD))).toBe(
    '#1 "alpha" is reserved for session lead: take it with from set to the hand-out id its brief names',
  );
  expect(why(take(CHILD, { from: "somebody" }))).toContain("is reserved for session lead");
  expect(taskById(db, alpha.id).createdBy).toBe("lead");
  ok(take(CHILD, { from: "lead" }));
  expect(taskById(db, alpha.id).createdBy).toBe("child");
  // After the take, the plan is the child's: nobody else takes it, even naming the lead.
  expect(why(take(OTHER, { from: "lead" }))).toContain("belongs to session child");
  expect(why(take(OTHER))).toContain("is reserved for session lead");
  // The person's force still works, and the one who owns it may take it again.
  ok(take(CHILD));
  ok(take(OTHER, { force: true }));
  expect(taskById(db, alpha.id).createdBy).toBe("other");
});

test("the lead takes its own reserved plan without from, and an unreserved plan is taken as before", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const beta = plan(db, "beta", ["src/b/"], { now: 2 });
  ok(reserve(db, "alpha"));
  const live = { isLive: () => false };
  ok(takeTasks(db, "p", alpha.id, LEAD, 20, live));
  // Unreserved: any session may take it, with or without from, exactly as before.
  ok(takeTasks(db, "p", beta.id, CHILD, 21, live));
  expect(taskById(db, beta.id).createdBy).toBe("child");
});

test("only the owner of a reserved plan starts work in it", () => {
  const w = world();
  const alpha = laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const lead = w.ops(LEAD);
  const child = w.ops(CHILD);
  const other = w.ops(OTHER);
  try {
    const handout = ok(reserveIn(w, "alpha", LEAD)).lead?.handoutId;
    // Another session may not start it, and says whose it is.
    expect(refused(other.call("update", { task: alpha.phase, status: "in_progress" }))).toBe(
      `Plan "alpha" (#1) is reserved for session lead: it is that lead's, or its child's. Do not start work in it. If it was handed to you, take it first with the hand-out id your brief names.`,
    );
    // A hand-out is never the lead's to build, even before its child takes it.
    expect(refused(lead.call("update", { task: alpha.phase, status: "in_progress" }))).toBe(
      'Plan "alpha" (#1) is reserved as a hand-out: its child builds it, never you. Do not start work in it. To build it yourself, release the reservation first.',
    );
    // The child takes it, then it is the child's to run, and no longer the lead's.
    said(child.call("take", { task: "alpha", from: handout }));
    expect(refused(lead.call("update", { task: alpha.phase, status: "in_progress" }))).toBe(
      'Plan "alpha" (#1) was handed to another session: it owns the plan now. Do not start work in it; its report arrives when it finishes.',
    );
    expect(refused(other.call("update", { task: alpha.phase, status: "in_progress" }))).toContain(
      "is reserved for session lead",
    );
    said(child.call("update", { task: alpha.phase, status: "in_progress" }));
    expect(said(child.call("get", { task: "#1" }))).toContain("[plan · in progress]");
  } finally {
    lead.close();
    child.close();
    other.close();
  }
});

test("a plan that is not reserved is guarded as before: another session's queued plan can be started", () => {
  const w = world();
  const alpha = laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const other = w.ops(OTHER);
  try {
    said(other.call("update", { task: alpha.phase, status: "in_progress" }));
  } finally {
    other.close();
  }
});

/** The states a lead's plans are in, by plan slug. */
function states(db: Db, who: Who, process = NOBODY): Record<string, LeadPlanState | undefined> {
  return Object.fromEntries(
    classifyLeadPlans(db, "p", who, process).map((c) => [c.plan.plan, c.state]),
  );
}

test("the classifier names each state from the store alone", () => {
  const { db } = setup();
  const live = { isLive: () => false };
  // Reserved for the lead itself, never taken: own.
  plan(db, "own", ["src/own/"]);
  // Handed to a child, which took it: with-child, gone, and unproved.
  const running = plan(db, "running", ["src/running/"]);
  const dead = plan(db, "dead", ["src/dead/"]);
  const unsure = plan(db, "unsure", ["src/unsure/"]);
  for (const slug of ["running", "dead", "unsure"]) ok(reserve(db, slug));
  ok(reserve(db, "own", { holder: "self" }));
  ok(takeTasks(db, "p", running.id, CHILD, 20, { ...live, from: "lead" }));
  ok(
    takeTasks(db, "p", dead.id, { ...CHILD, sessionId: "child2", pid: 7, procStart: "7" }, 21, {
      ...live,
      from: "lead",
    }),
  );
  ok(
    takeTasks(db, "p", unsure.id, { ...CHILD, sessionId: "child3", pid: 8, procStart: "8" }, 22, {
      ...live,
      from: "lead",
    }),
  );
  // Not reserved: waiting on an open blocker, no list, ready.
  const blocker = plan(db, "blocker", ["src/blocker/"], { now: 5 });
  plan(db, "waiting", ["src/waiting/"], { blockedBy: [blocker.id], now: 6 });
  plan(db, "nolist", undefined, { now: 7 });
  plan(db, "ready", ["src/ready/"], { now: 8 });
  // Left out: another session's plan, a closed plan, the lead's own unreserved plan in flight.
  plan(db, "theirs", ["src/theirs/"], { who: OTHER, now: 9 });
  const finished = plan(db, "finished", ["src/finished/"], { now: 10 });
  ok(updateTask(db, finished.id, { status: "done" }, LEAD, 11));
  const solo = plan(db, "solo", ["src/solo/"], { now: 12 });
  ok(updateTask(db, solo.id, { status: "in_progress" }, LEAD, 13));
  const process = {
    live: (c: { pid: number }) => c.pid === CHILD.pid,
    gone: (c: { pid: number }) => c.pid === 7,
    ended: (c: { pid: number }) => c.pid === 7,
  };
  expect(states(db, LEAD, process)).toEqual({
    own: "own",
    running: "with-child",
    dead: "child-gone",
    unsure: "with-child",
    blocker: "ready",
    waiting: "waiting",
    nolist: "no-files",
    ready: "ready",
  });
  const waiting = classifyLeadPlans(db, "p", LEAD, process).find((c) => c.plan.plan === "waiting");
  expect(waiting?.waitingOn.map((t) => t.plan)).toEqual(["blocker"]);
});

test("the classifier follows the lead across a /clear; a hand-out is the child's from the reservation on", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["src/b/"]);
  ok(reserve(db, "alpha", { holder: "self" }));
  ok(reserve(db, "beta", { holder: "child" }));
  // A /clear: the same process under a new session id is still the lead.
  const cleared: Who = { ...LEAD, sessionId: "lead-after-clear" };
  expect(isLead(taskById(db, alpha.id).lead, cleared)).toBe(true);
  // The holder kind says it, the lead owning both: no binding or take is needed first.
  expect(states(db, cleared)).toEqual({ alpha: "own", beta: "with-child" });
  // Another session and another process are not the lead.
  expect(states(db, OTHER)).toEqual({});
});

test("a closed plan still reserved for the lead is merging until it is released", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha"));
  ok(takeTasks(db, "p", alpha.id, CHILD, 20, { isLive: () => false, from: "lead" }));
  ok(updateTask(db, alpha.id, { status: "done" }, CHILD, 21));
  expect(states(db, LEAD)).toEqual({ alpha: "merging" });
  // Other sessions do not lead it, and a release ends it.
  expect(states(db, OTHER)).toEqual({});
  ok(releasePlan(db, { project: "p", plan: "alpha", who: LEAD, now: 30 }));
  expect(states(db, LEAD)).toEqual({});
});

test("the classifier reads the store and nothing else: no git, no process but the one it is given", () => {
  const { db } = setup();
  plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha", { holder: "self" }));
  let asked = 0;
  const counting = {
    live: () => {
      asked += 1;
      return true;
    },
    gone: () => {
      asked += 1;
      return false;
    },
    ended: () => {
      asked += 1;
      return false;
    },
  };
  expect(states(db, LEAD, counting)).toEqual({ alpha: "own" });
  // An owned, unhanded plan needs no process question at all.
  expect(asked).toBe(0);
});

/** A process list where only the named pids still run. */
function running(...pids: number[]): ClaimProcess {
  return {
    live: (c) => pids.includes(c.pid),
    gone: (c) => !pids.includes(c.pid),
    ended: (c) => !pids.includes(c.pid),
  };
}

test("H1: a resumed child reads with-child while it runs, and child-gone only when its claim and maker are both gone", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha"));
  ok(takeTasks(db, "p", alpha.id, CHILD, 20, { isLive: () => false, from: "lead" }));
  ok(updateTask(db, alpha.id, { status: "in_progress" }, CHILD, 21));
  // The child's session is reopened in a new process; the old one is gone.
  const resumed: Who = { sessionId: "child", pid: 5303, procStart: "53030" };
  expect(ok(reclaimResumed(db, resumed, 30, (c) => c.pid === CHILD.pid))).toBe(1);
  const row = taskById(db, alpha.id);
  expect([row.claim?.pid, row.creator?.pid]).toEqual([5303, 5303]);
  expect(
    eventsOf(db, alpha).some((e) => e.reason === "maker moved to the resumed session's process"),
  ).toBe(true);
  expect(states(db, LEAD, running(resumed.pid as number))).toEqual({ alpha: "with-child" });
  // With no process running, the restamped claim and maker are both gone.
  expect(states(db, LEAD, running())).toEqual({ alpha: "child-gone" });
});

/**
 * The machine's answers for a fake machine: only `pids` run, and `sessions` is what the Claude
 * config folder's records say (a function, so a test can make it throw).
 */
function machine(pids: number[], sessions: () => { pid: number; sessionId: string }[]) {
  const facts = {
    platform: "darwin" as const,
    running: (pid: number) => pids.includes(pid),
    sessions: () => sessions().map((s) => ({ ...s, cwd: "/x", name: "n" })),
  };
  const process: ClaimProcess = {
    live: (c) => pids.includes(c.pid),
    gone: (c) => !pids.includes(c.pid),
    ended: (c) => sessionEnded(c, facts),
  };
  return { process, isEnded: process.ended };
}

/** A plan taken and started by CHILD, whose session is then reopened in a new process that made no task call. */
function reopenedChild() {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const handout = ok(reserve(db, "alpha")).lead?.handoutId ?? "";
  ok(takeTasks(db, "p", alpha.id, CHILD, 20, { isLive: () => false, from: handout }));
  ok(updateTask(db, alpha.id, { status: "in_progress" }, CHILD, 21));
  const second: Who = { sessionId: "child-2", pid: 6000, procStart: "60000" };
  const take = (isEnded: (c: WorkClaim) => boolean) =>
    takeTasks(db, "p", alpha.id, second, 25, { isLive: () => false, isEnded, from: handout });
  return { db, alpha, handout, take };
}

test("Q1: a reopened child with a live session and no task call yet reads with-child, and a second child may not take its plan", () => {
  const { db, take } = reopenedChild();
  // The old process is gone; the reopened one (pid 5303) runs the same session id.
  const m = machine([5303], () => [{ pid: 5303, sessionId: "child" }]);
  expect(states(db, LEAD, m.process)).toEqual({ alpha: "with-child" });
  expect(why(take(m.isEnded))).toContain("belongs to session child");
});

test("Q1: a child that died, with no running session of its id, reads child-gone and its plan can be taken", () => {
  const { db, alpha, take } = reopenedChild();
  const m = machine([], () => [{ pid: 9, sessionId: "somebody-else" }]);
  expect(states(db, LEAD, m.process)).toEqual({ alpha: "child-gone" });
  ok(take(m.isEnded));
  expect(taskById(db, alpha.id).createdBy).toBe("child-2");
});

test("Q1: session records that cannot be read are not an end: with-child, and no second take", () => {
  const { db, take } = reopenedChild();
  const m = machine([], () => {
    throw new Error("a running session's record is unreadable");
  });
  expect(states(db, LEAD, m.process)).toEqual({ alpha: "with-child" });
  expect(why(take(m.isEnded))).toContain("belongs to session child");
});

test("H1: a child whose maker is gone but whose claim still runs is with-child", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha"));
  ok(takeTasks(db, "p", alpha.id, CHILD, 20, { isLive: () => false, from: "lead" }));
  // Another process of the plan's work holds the claim (a live claim the maker's process lacks).
  ok(updateTask(db, alpha.id, { status: "in_progress" }, OTHER, 21));
  expect(taskById(db, alpha.id).claim?.pid).toBe(OTHER.pid as number);
  expect(states(db, LEAD, running(OTHER.pid as number))).toEqual({ alpha: "with-child" });
  expect(states(db, LEAD, running())).toEqual({ alpha: "child-gone" });
  // A claim that cannot be proved gone keeps it with-child too.
  const unproved: ClaimProcess = {
    live: () => false,
    gone: (c) => c.pid === CHILD.pid,
    ended: (c) => c.pid === CHILD.pid,
  };
  expect(states(db, LEAD, unproved)).toEqual({ alpha: "with-child" });
});

test("M1: a take with the hand-out id passes after the lead's /clear moved its session", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const handout = ok(reserve(db, "alpha")).lead?.handoutId;
  const cleared: Who = { ...LEAD, sessionId: "lead-2" };
  expect(ok(reclaimResumed(db, cleared, 15, () => false))).toBe(1);
  const moved = taskById(db, alpha.id);
  // The lead's session moved, the hand-out id did not: the child's brief still names it.
  expect([moved.createdBy, moved.lead?.sessionId, moved.lead?.handoutId]).toEqual([
    "lead-2",
    "lead-2",
    handout,
  ]);
  const take = (from: string) =>
    takeTasks(db, "p", alpha.id, CHILD, 20, { isLive: () => false, from });
  ok(take(handout ?? ""));
  expect(taskById(db, alpha.id).createdBy).toBe("child");
});

test("M1: the lead's current session also names the reservation", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha"));
  ok(reclaimResumed(db, { ...LEAD, sessionId: "lead-2" }, 15, () => false));
  expect(
    why(takeTasks(db, "p", alpha.id, CHILD, 20, { isLive: () => false, from: "wrong" })),
  ).toContain("is reserved for session lead-2");
  ok(takeTasks(db, "p", alpha.id, CHILD, 21, { isLive: () => false, from: "lead-2" }));
});

test("M2: a take of a reserved plan passes a maker proved gone, and refuses one that may run", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const handout = ok(reserve(db, "alpha")).lead?.handoutId;
  ok(takeTasks(db, "p", alpha.id, CHILD, 20, { isLive: () => false, from: handout ?? "" }));
  // The child died; herdr starts a new child session. Its maker is gone: the take passes.
  const second: Who = { sessionId: "child-2", pid: 5404, procStart: "54040" };
  const options = { isLive: () => false, from: handout ?? "" };
  expect(why(takeTasks(db, "p", alpha.id, second, 30, { ...options, isEnded: () => false }))).toBe(
    `#1 "alpha" belongs to session child, not ${handout}`,
  );
  ok(takeTasks(db, "p", alpha.id, second, 31, { ...options, isEnded: (c) => c.pid === CHILD.pid }));
  expect(taskById(db, alpha.id).createdBy).toBe("child-2");
  // The live-claim check stays: a claim that runs is never taken without force.
  ok(updateTask(db, alpha.id, { status: "in_progress" }, second, 32));
  const third: Who = { sessionId: "child-3", pid: 5505, procStart: "55050" };
  expect(
    why(
      takeTasks(db, "p", alpha.id, third, 33, {
        from: handout ?? "",
        isLive: () => true,
        isEnded: () => true,
      }),
    ),
  ).toContain("is live in session child-2; use force to take it");
});

test("M3: the lead's identity follows its process through a /clear and a resume, the hand-out id never moves", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  const handout = ok(reserve(db, "alpha")).lead?.handoutId;
  const cleared: Who = { ...LEAD, sessionId: "lead-2" };
  ok(reclaimResumed(db, cleared, 15, () => false));
  // Then the reopened session runs in a new process, the old one gone.
  const after: Who = { sessionId: "lead-2", pid: 9999, procStart: "99990" };
  expect(ok(reclaimResumed(db, after, 16, (c) => c.pid === LEAD.pid))).toBe(1);
  const lead = taskById(db, alpha.id).lead;
  expect([lead?.sessionId, lead?.pid, lead?.procStart, lead?.handoutId]).toEqual([
    "lead-2",
    9999,
    "99990",
    handout,
  ]);
  expect(isLead(lead ?? null, after)).toBe(true);
  expect(states(db, after, NOBODY)).toEqual({ alpha: "with-child" });
  // A release clears the hand-out id with the rest.
  ok(releasePlan(db, { project: "p", plan: "alpha", who: after, now: 20 }));
  expect(taskById(db, alpha.id).lead).toBeNull();
  // A different reservation gets a different id.
  expect(ok(reserve(db, "alpha", { who: after })).lead?.handoutId).not.toBe(handout);
});

test("M3: a live process is never replaced as the lead, and another session never moves it", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  ok(reserve(db, "alpha"));
  const same: Who = { sessionId: "lead", pid: 9999, procStart: "99990" };
  expect(ok(reclaimResumed(db, same, 16, () => false))).toBe(0);
  expect(ok(reclaimResumed(db, OTHER, 17, () => true))).toBe(0);
  expect(taskById(db, alpha.id).lead?.pid).toBe(LEAD.pid as number);
});

test("M4: the holder kind is recorded once, shown in the history, and read by the classifier", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["src/b/"]);
  expect(ok(reserve(db, "alpha", { holder: "self" })).lead?.holder).toBe("self");
  expect(ok(reserve(db, "beta", { holder: "child" })).lead?.holder).toBe("child");
  expect(eventsOf(db, alpha).at(-1)?.changes.lead).toEqual([null, "lead (self)"]);
  // Both are the lead's own rows (it made them), yet only the self plan reads own.
  expect(states(db, LEAD)).toEqual({ alpha: "own", beta: "with-child" });
});

test("M4: the lead may start its own plan and may not start a plan it handed out, taken or not", () => {
  const w = world();
  const alpha = laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, LEAD, "beta", ["src/b/"]);
  const lead = w.ops(LEAD);
  try {
    expect(ok(reserveIn(w, "alpha", LEAD, { holder: "self" })).lead?.holder).toBe("self");
    expect(ok(reserveIn(w, "beta", LEAD, { holder: "child" })).lead?.holder).toBe("child");
    expect(refused(lead.call("update", { task: beta.phase, status: "in_progress" }))).toContain(
      "is reserved as a hand-out",
    );
    said(lead.call("update", { task: alpha.phase, status: "in_progress" }));
  } finally {
    lead.close();
  }
});

test("L1 and L2: the merge files are read for every list, and a read that fell short is named in the refusal", () => {
  const repo = makeRepo();
  const env = hookEnv();
  const stateDir = cliPaths(env).stateDir;
  let reads = 0;
  const ops = createTaskOps({
    stateDir,
    env,
    cwd: () => repo,
    caller: () => ({ ...LEAD, cwd: repo }),
    filesCheck: () => {
      reads += 1;
      return { ignore: [], caseFold: false, reason: "no ref origin/main was found" };
    },
  });
  const db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
  try {
    said(ops.call("create", { subject: "Alpha", plan: "alpha", files: ["src/a/"] }));
    said(ops.call("create", { subject: "Beta", plan: "beta" }));
    // Neither plan is held, and the list is still read: only the transaction knows if it is held.
    said(ops.call("update", { task: "#2", files: ["src/b/"] }));
    expect(reads).toBe(2);
    const project = folderProject(repo);
    for (const slug of ["alpha", "beta"])
      ok(
        reservePlan(db, {
          project,
          plan: slug,
          who: LEAD,
          holder: "child",
          ignore: [],
          caseFold: false,
          reason: null,
          now: 5,
        }),
      );
    expect(refused(ops.call("update", { task: "#2", files: ["src/a/x.ts"] }))).toBe(
      '#2 "Beta" is held, so its files may not overlap another held plan: overlaps #1 "Alpha": src/a/x.ts (src/a/). plans.mergeFiles was not read in full, so a merge file may count: no ref origin/main was found',
    );
    // reservePlan says it too.
    said(ops.call("create", { subject: "Gamma", plan: "gamma", files: ["src/a/y.ts"] }));
    expect(
      why(
        reservePlan(db, {
          project,
          plan: "gamma",
          who: LEAD,
          holder: "child",
          ignore: [],
          caseFold: false,
          reason: "bad entry docs",
          now: 7,
        }),
      ),
    ).toBe(
      '#3 "Gamma" overlaps #1 "Alpha": src/a/y.ts (src/a/). plans.mergeFiles was not read in full, so a merge file may count: bad entry docs',
    );
  } finally {
    db.close();
    ops.close();
  }
});

test("L3: an overlap with a done plan that is not released says so, and what releases it", () => {
  const { db } = setup();
  const alpha = plan(db, "alpha", ["src/a/"]);
  plan(db, "beta", ["src/a/x.ts"]);
  ok(reserve(db, "alpha"));
  ok(updateTask(db, alpha.id, { status: "done" }, LEAD, 5));
  expect(why(reserve(db, "beta"))).toBe(
    `#2 "beta" overlaps #1 "alpha" (done, not released: \`${COMMAND} herdr plans\` releases it when its pull request merges): src/a/x.ts (src/a/)`,
  );
});

test("the take through the task tools asks the session records of its own config folder", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const handout = ok(reserveIn(w, "alpha", LEAD)).lead?.handoutId;
  // The first child took the plan from a process that has ended.
  const first: Who = { sessionId: "child", pid: 999999971, procStart: "1" };
  const firstOps = w.ops(first);
  try {
    said(firstOps.call("take", { task: "alpha", from: handout }));
  } finally {
    firstOps.close();
  }
  // Its session is reopened in this test's own process, before any task call.
  const sessions = join(w.env.CLAUDE_CONFIG_DIR as string, "sessions");
  mkdirSync(sessions, { recursive: true });
  const record = join(sessions, `${process.pid}.json`);
  writeFileSync(record, JSON.stringify({ pid: process.pid, sessionId: "child", cwd: w.repo }));
  const second: Who = { sessionId: "child-2", pid: 999999972, procStart: "2" };
  const secondOps = w.ops(second);
  try {
    expect(refused(secondOps.call("take", { task: "alpha", from: handout }))).toContain(
      "belongs to session child",
    );
    // Once that session is over too, the plan is free to resume in a new child.
    rmSync(record);
    said(secondOps.call("take", { task: "alpha", from: handout }));
  } finally {
    secondOps.close();
  }
});

test("a held plan with no file list and no branch diff refuses a reservation, naming the fix", () => {
  const { db } = setup();
  const solo = plan(db, "solo", undefined, { who: OTHER });
  const beta = plan(db, "beta", ["src/b/"], { now: 2 });
  ok(updateTask(db, solo.id, { status: "in_progress" }, OTHER, 3));
  expect(why(reserve(db, "beta"))).toBe(
    '#1 "solo" is held with no file list: set its files first (task_update on #1 with files), or finish, park or drop it',
  );
  expect(leadOf(db, beta.id)).toBeNull();
  // Its branch diff is what it holds then, and a plan elsewhere is clear.
  expect(ok(reserve(db, "beta", { extraFiles: { [solo.id]: ["lib/x.ts"] } })).lead).not.toBeNull();
});

test("a held plan with a list still allows a disjoint reservation", () => {
  const { db } = setup();
  const solo = plan(db, "solo", ["lib/"], { who: OTHER });
  plan(db, "beta", ["src/b/"], { now: 2 });
  ok(updateTask(db, solo.id, { status: "in_progress" }, OTHER, 3));
  expect(ok(reserve(db, "beta")).lead).not.toBeNull();
});

/** A start of a phase by `who`, through the task tools: the answer. */
function startPhase(w: ReturnType<typeof world>, who: Who, phase: string) {
  const ops = w.ops(who);
  try {
    return ops.call("update", { task: phase, status: "in_progress" });
  } finally {
    ops.close();
  }
}
function planStatus(w: ReturnType<typeof world>, slug: string) {
  const db = w.store();
  try {
    return allTasks(db, w.project).find((t) => t.kind === "plan" && t.plan === slug)?.status;
  } finally {
    db.close();
  }
}

test("a solo first start that overlaps a reserved plan is refused, and the plan stays queued", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, OTHER, "beta", ["src/a/x.ts"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  const words = refused(startPhase(w, OTHER, beta.phase));
  expect(words).toContain('"beta" cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)');
  expect(words).toContain("Two plans that share a file never run at once");
  expect(words).toContain('#1 "alpha" is reserved: wait until its pull request merges or closes');
  expect(words).toContain("task_update with files");
  expect(planStatus(w, "beta")).toBe("pending");
});

test("a solo first start that overlaps another session's plan in flight is refused", () => {
  const w = world();
  const solo = laidPlan(w, LEAD, "solo", ["src/s/"]);
  const beta = laidPlan(w, OTHER, "beta", ["src/s/inner/"]);
  said(startPhase(w, LEAD, solo.phase));
  expect(planStatus(w, "solo")).toBe("in_progress");
  expect(refused(startPhase(w, OTHER, beta.phase))).toContain('overlaps #1 "solo"');
  expect(planStatus(w, "beta")).toBe("pending");
});

test("a start of a plan with no file list is refused while a reserved plan is held, with the fix", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, OTHER, "beta", []);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  expect(refused(startPhase(w, OTHER, beta.phase))).toContain(
    'has no file list, so it cannot be shown clear of #1 "alpha": set its files first (task_update with files)',
  );
  expect(planStatus(w, "beta")).toBe("pending");
});

test("a solo user who never hands out a plan sees no new refusal", () => {
  const w = world();
  const solo = laidPlan(w, LEAD, "solo", []);
  said(startPhase(w, LEAD, solo.phase));
  expect(planStatus(w, "solo")).toBe("in_progress");
  // Another session's plan in flight is not a reserved plan: with no list, no refusal.
  const second = laidPlan(w, OTHER, "second", []);
  said(startPhase(w, OTHER, second.phase));
  expect(planStatus(w, "second")).toBe("in_progress");
});

test("the caller's own reserved plan is never refused by itself, a child's take included", () => {
  const w = world();
  const alpha = laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, LEAD, "beta", ["src/b/"]);
  expect(ok(reserveIn(w, "alpha", LEAD, { holder: "self" })).lead).not.toBeNull();
  said(startPhase(w, LEAD, alpha.phase));
  expect(planStatus(w, "alpha")).toBe("in_progress");
  // A hand-out: the child takes it, then starts it.
  expect(ok(reserveIn(w, "beta", LEAD)).lead).not.toBeNull();
  const child = w.ops(CHILD);
  try {
    said(child.call("take", { task: "beta", from: "lead" }));
    said(child.call("update", { task: beta.phase, status: "in_progress" }));
  } finally {
    child.close();
  }
  expect(planStatus(w, "beta")).toBe("in_progress");
});

test("a start disjoint from every held plan is allowed", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, OTHER, "beta", ["lib/b/"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  said(startPhase(w, OTHER, beta.phase));
  expect(planStatus(w, "beta")).toBe("in_progress");
});

test("a plan task started directly, and a task made in progress, are judged the same way", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  laidPlan(w, OTHER, "beta", ["src/a/"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  const other = w.ops(OTHER);
  try {
    expect(refused(other.call("update", { task: "#4", status: "in_progress" }))).toContain(
      'overlaps #1 "alpha"',
    );
    expect(
      refused(other.call("create", { subject: "Work", parent: "#5", status: "in_progress" })),
    ).toContain('overlaps #1 "alpha"');
  } finally {
    other.close();
  }
  expect(planStatus(w, "beta")).toBe("pending");
});

const THIRD: Who = { sessionId: "third", pid: 7404, procStart: "74040" };

function statusOf(w: ReturnType<typeof world>, ref: string) {
  const db = w.store();
  try {
    return allTasks(db, w.project).find((t) => `#${t.number}` === ref)?.status;
  } finally {
    db.close();
  }
}
function numberOf(w: ReturnType<typeof world>, subject: string) {
  const db = w.store();
  try {
    const found = allTasks(db, w.project).find((t) => t.subject === subject);
    if (found === undefined) throw new Error(`no task "${subject}"`);
    return `#${found.number}`;
  } finally {
    db.close();
  }
}

test("a phase started by a session that does not own the plan is judged like the owner's start", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, OTHER, "beta", ["src/a/x.ts"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  // A third session starts the phase of OTHER's plan: the plan goes into flight all the same.
  expect(refused(startPhase(w, THIRD, beta.phase))).toContain(
    'cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)',
  );
  expect(statusOf(w, beta.phase)).toBe("pending");
  expect(planStatus(w, "beta")).toBe("pending");
});

test("a step started in a plan that is not in flight is judged too, and a step in a running plan is not", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, OTHER, "beta", ["src/a/x.ts"]);
  const gamma = laidPlan(w, THIRD, "gamma", ["lib/g/"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  const betaStep = numberOf(w, "beta step");
  const gammaStep = numberOf(w, "gamma step");
  const third = w.ops(THIRD);
  try {
    expect(refused(third.call("update", { task: betaStep, status: "in_progress" }))).toContain(
      'overlaps #1 "alpha"',
    );
    expect(statusOf(w, beta.phase)).toBe("pending");
    expect(planStatus(w, "beta")).toBe("pending");
    // A disjoint plan runs; its later steps need no new judgment.
    said(third.call("update", { task: gamma.phase, status: "in_progress" }));
    said(third.call("update", { task: gammaStep, status: "in_progress" }));
    expect(planStatus(w, "gamma")).toBe("in_progress");
  } finally {
    third.close();
  }
});

test("the way out of an overlap follows why the plan is held: a reserved plan merges, a running one is done or parked", () => {
  const w = world();
  const solo = laidPlan(w, LEAD, "solo", ["src/s/"]);
  laidPlan(w, OTHER, "alpha", ["src/a/"]);
  const beta = laidPlan(w, THIRD, "beta", ["src/a/x.ts", "src/s/y.ts"]);
  said(startPhase(w, LEAD, solo.phase));
  expect(ok(reserveIn(w, "alpha", OTHER)).lead).not.toBeNull();
  const words = refused(startPhase(w, THIRD, beta.phase));
  expect(words).toContain('#1 "solo" is running: wait until it is done or parked');
  expect(words).toContain("if its session is gone, take it (task_take), or park or drop it");
  expect(words).toContain('#4 "alpha" is reserved: wait until its pull request merges or closes');
  expect(words).toContain("or change this plan's files (task_update with files)");
});

/** Ops that count how often the files check is read, and what it says. */
function countingOps(
  w: ReturnType<typeof world>,
  who: Who,
  check = { ignore: [] as string[], caseFold: false },
) {
  const reads = { count: 0 };
  const ops = createTaskOps({
    stateDir: w.paths.stateDir,
    env: w.env,
    cwd: () => w.repo,
    caller: () => ({ ...who, cwd: w.repo }),
    filesCheck: () => {
      reads.count += 1;
      return { ...check, reason: null };
    },
  });
  return { ops, reads };
}

test("the files check is read once when a plan goes into flight, and never for a step in a running plan", () => {
  const w = world();
  const alpha = laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const { ops, reads } = countingOps(w, LEAD);
  try {
    said(ops.call("create", { subject: "second phase", plan: "alpha", phase: "B" }));
    const second = numberOf(w, "second phase");
    said(ops.call("create", { subject: "its step", parent: second }));
    said(ops.call("update", { task: alpha.phase, status: "in_progress" }));
    expect(reads.count).toBe(1);
    said(ops.call("update", { task: second, status: "in_progress" }));
    expect(reads.count).toBe(1);
  } finally {
    ops.close();
  }
});

test("a start is judged with the files check the caller read: plans.mergeFiles and case", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["CHANGELOG.md", "src/A.ts"]);
  const beta = laidPlan(w, OTHER, "beta", ["CHANGELOG.md"]);
  const gamma = laidPlan(w, THIRD, "gamma", ["src/a.ts"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  const ignoring = countingOps(w, OTHER, { ignore: ["CHANGELOG.md"], caseFold: true });
  const folding = countingOps(w, THIRD, { ignore: ["CHANGELOG.md"], caseFold: true });
  try {
    // The merge file takes no part, so beta is clear of alpha; gamma differs from alpha only in case.
    said(ignoring.ops.call("update", { task: beta.phase, status: "in_progress" }));
    expect(
      refused(folding.ops.call("update", { task: gamma.phase, status: "in_progress" })),
    ).toContain('overlaps #1 "alpha": src/a.ts (src/A.ts)');
  } finally {
    ignoring.ops.close();
    folding.ops.close();
  }
});

test("a task created already running puts its plan into flight, and is judged like a start", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const beta = laidPlan(w, OTHER, "beta", ["src/a/x.ts"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  const third = w.ops(THIRD);
  try {
    // A third session creates a running task under OTHER's phase, beside the reserved plan.
    expect(
      refused(
        third.call("create", { subject: "sneak", parent: beta.phase, status: "in_progress" }),
      ),
    ).toContain('cannot start, since it overlaps #1 "alpha": src/a/x.ts (src/a/)');
  } finally {
    third.close();
  }
  // Nothing was stored: no task, and the plan holds nothing.
  const db = w.store();
  try {
    expect(allTasks(db, w.project).some((t) => t.subject === "sneak")).toBe(false);
    expect(heldPlans(db, w.project, THIRD).map((h) => h.plan.plan)).toEqual(["alpha"]);
  } finally {
    db.close();
  }
  expect(planStatus(w, "beta")).toBe("pending");
});

test("a task created running in a plan clear of every held plan is allowed, and holds the plan", () => {
  const w = world();
  laidPlan(w, LEAD, "alpha", ["src/a/"]);
  const gamma = laidPlan(w, OTHER, "gamma", ["lib/g/"]);
  expect(ok(reserveIn(w, "alpha", LEAD)).lead).not.toBeNull();
  const third = w.ops(THIRD);
  try {
    said(third.call("create", { subject: "fine", parent: gamma.phase, status: "in_progress" }));
  } finally {
    third.close();
  }
  const db = w.store();
  try {
    expect(heldPlans(db, w.project, THIRD).map((h) => [h.plan.plan, h.why])).toEqual([
      ["alpha", "reserved"],
      ["gamma", "in-flight"],
    ]);
  } finally {
    db.close();
  }
});

test("a step started in a plan holds the plan, so a later reservation that overlaps is refused", () => {
  const w = world();
  laidPlan(w, OTHER, "beta", ["src/b/"]);
  laidPlan(w, LEAD, "alpha", ["src/b/inner/"]);
  const step = numberOf(w, "beta step");
  const third = w.ops(THIRD);
  try {
    said(third.call("update", { task: step, status: "in_progress" }));
  } finally {
    third.close();
  }
  const db = w.store();
  try {
    // The plan row never started, the step did: the plan runs all the same.
    expect(planStatus(w, "beta")).toBe("pending");
    expect(heldPlans(db, w.project, LEAD).map((h) => [h.plan.plan, h.why])).toEqual([
      ["beta", "in-flight"],
    ]);
  } finally {
    db.close();
  }
  expect(why(reserveIn(w, "alpha", LEAD))).toBe(
    '#4 "alpha" overlaps #1 "beta": src/b/inner/ (src/b/)',
  );
});
