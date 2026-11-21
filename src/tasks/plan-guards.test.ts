/**
 * The plan shape the task tools hold a session to (`plan-guards.ts`, `docs/design/tasks.md`): the
 * phase cap, no phase started empty, phases laid in any plan with one plan in flight, tasks waiting under a plan, a step closed
 * with its proof, and the counts `task_list` and `doctor` show. Each test runs the same
 * operations the MCP tools and the `task` command run (`createTaskOps`), in a temp repo and a
 * temp home, so no real workflow setting is read.
 */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Check } from "../cli/check";
import { cliPaths } from "../cli/paths";
import { ancestorHoldChecks, planCapChecks } from "../cli/project-checks";
import { taskSegment } from "../cli/statusline";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { git, tempDir } from "../testing/temp";
import { folderProject } from "./context";
import { createTaskOps, type TaskAnswer } from "./ops";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./work/db";
import { allTasks, inFlightPlanOf, livePhaseCount } from "./work/queries";
import { planProgress } from "./work/read";
import { applyUpdate, layPhase } from "./work/store";

const LEAD = { sessionId: "lead", pid: 4101, procStart: "41010" };
const OTHER = { sessionId: "other", pid: 5202, procStart: "52020" };

function world() {
  const repo = makeRepo();
  const env = hookEnv();
  const paths = cliPaths(env);
  const ops = (who: typeof LEAD = LEAD) =>
    createTaskOps({
      stateDir: paths.stateDir,
      env,
      cwd: () => repo,
      caller: () => ({ ...who, cwd: repo }),
    });
  return { repo, env, paths, ops };
}

/** The text of an answer that worked; a refusal fails the test with its words. */
function said(answer: TaskAnswer): string {
  if (!answer.ok) throw new Error(answer.why);
  return answer.text;
}
/** The words of an answer that was refused. */
function refused(answer: TaskAnswer): string {
  if (answer.ok) throw new Error(`expected a refusal, got: ${answer.text}`);
  return answer.why;
}

function personalFile(w: { paths: { workflowConfigFile: string } }, value: unknown | string) {
  mkdirSync(dirname(w.paths.workflowConfigFile), { recursive: true });
  writeFileSync(
    w.paths.workflowConfigFile,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

test("the phase cap: the default 10 lets ten in and refuses the eleventh, with the way forward", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Big", plan: "big" }));
    for (let n = 1; n <= 10; n++)
      said(ops.call("create", { subject: `Area ${n}`, plan: "big", phase: `P${n}` }));
    expect(refused(ops.call("create", { subject: "One more", plan: "big", phase: "P11" }))).toBe(
      'Plan "big" already holds 10 phases, the most plans.maxPhases allows (10, from the built-in default). Do not add a phase: add the work as a task under the phase that owns its files (task_create with that phase as parent), or queue it as a task under the next plan (task_create with parent set to that plan\'s #n; make the plan first with task_create, plan and a subject). Only the person raises the cap: ask them to run `cc-smart-dev-kit workflow set plans.maxPhases <n>` in their own terminal (add --project to set it for this project).',
    );
    // A phase that is there is only answered, at the cap too.
    expect(said(ops.call("create", { subject: "Area 3", plan: "big", phase: "P3" }))).toContain(
      "it was there already",
    );
  } finally {
    ops.close();
  }
});

test("the phase cap: a dropped phase frees its slot, a done one keeps it", () => {
  const w = world();
  const personalCap = { plans: { maxPhases: 2 } };
  personalFile(w, personalCap);
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "A", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "B", plan: "p", phase: "B" }));
    expect(refused(ops.call("create", { subject: "C", plan: "p", phase: "C" }))).toContain(
      "already holds 2 phases, the most plans.maxPhases allows (2, from your own workflow settings)",
    );
    said(ops.call("done", { task: "#2" }));
    expect(refused(ops.call("create", { subject: "C", plan: "p", phase: "C" }))).toContain(
      "already holds 2 phases",
    );
    said(ops.call("done", { task: "#3", outcome: "dropped" }));
    said(ops.call("create", { subject: "C", plan: "p", phase: "C" }));
  } finally {
    ops.close();
  }
});

test("the cap comes from the project over the person over the default, and a broken file fails loudly", () => {
  const w = world();
  const ops = w.ops();
  try {
    personalFile(w, { plans: { maxPhases: 2 } });
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { workflow: { plans: { maxPhases: 3 } } });
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    for (const id of ["A", "B", "C"])
      said(ops.call("create", { subject: id, plan: "p", phase: id }));
    expect(refused(ops.call("create", { subject: "D", plan: "p", phase: "D" }))).toContain(
      "the most plans.maxPhases allows (3, from this project's workflow settings)",
    );
    // The person's file broken: the call fails and names the file.
    personalFile(w, "{ not json");
    expect(refused(ops.call("create", { subject: "E", plan: "p", phase: "E" }))).toContain(
      `Invalid ${w.paths.workflowConfigFile}: not valid JSON`,
    );
    // A re-lay needs no cap, so a broken file does not fail it.
    said(ops.call("create", { subject: "A", plan: "p", phase: "A" }));
  } finally {
    ops.close();
  }
});

test("the store counts and inserts in one transaction: layPhase refuses past its cap", () => {
  const w = world();
  const db = openWorkDb(workDbFile(w.paths), { mode: "write" });
  try {
    const lay = (phase: string, max: number) =>
      writeWork(db, () =>
        layPhase(
          db,
          { project: "p", plan: "q", phase, subject: phase, cap: { max, source: "project" } },
          { ...LEAD },
          1,
        ),
      );
    expect(lay("A", 1).ok).toBe(true);
    const second = lay("B", 1);
    expect(!second.ok && second.why).toContain('Plan "q" already holds 1 phases');
    // Nothing of the refused phase was kept.
    expect(livePhaseCount(allTasks(db, "p"), "q")).toBe(1);
    expect(lay("A", 1)).toMatchObject({ ok: true, value: { made: false } });
    expect(lay("B", 2).ok).toBe(true);
  } finally {
    db.close();
  }
});

test("a phase starts only with tasks: the refusal names the call, and one task lets it start", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    expect(refused(ops.call("update", { task: "#2", status: "in_progress" }))).toBe(
      '#2 "Area" has no tasks: add its steps first, each with its done-check (task_create with parent "#2"), then start it',
    );
    said(ops.call("create", { subject: "Step", parent: "#2" }));
    expect(said(ops.call("update", { task: "#2", status: "in_progress" }))).toContain(
      "in progress",
    );
    // A loose task and a task start as before.
    said(ops.call("update", { task: "#3", status: "in_progress" }));
  } finally {
    ops.close();
  }
});

/**
 * Lays each plan out whole: the plan, one phase (`P1`) and one step, so plan number i (from 0)
 * is task #(3i+1), its phase #(3i+2) and its step #(3i+3) in a project of these plans alone.
 */
function queue(ops: ReturnType<ReturnType<typeof world>["ops"]>, slugs: string[]): void {
  for (const slug of slugs) {
    const plan = said(ops.call("create", { subject: `Plan ${slug}`, plan: slug }));
    const number = Number(/^#(\d+)/.exec(plan)?.[1]);
    said(ops.call("create", { subject: `Area ${slug}`, plan: slug, phase: "P1" }));
    said(ops.call("create", { subject: `Step ${slug}`, parent: `#${number + 1}` }));
  }
}

/** One task of the store, by its number. */
function taskNumbered(w: ReturnType<typeof world>, number: number) {
  const db = openWorkDb(workDbFile(w.paths), { mode: "hook" });
  try {
    const task = allTasks(db, folderProject(w.repo)).find((t) => t.number === number);
    if (task === undefined) throw new Error(`no task #${number}`);
    return task;
  } finally {
    db.close();
  }
}

test("phases are laid up front in every plan; only a start puts one plan in flight", () => {
  const w = world();
  const lead = w.ops();
  try {
    // Three plans, each with its phase and step, all laid before any starts: no refusal.
    queue(lead, ["a", "b", "c"]);
    for (const number of [1, 2, 4, 5, 7, 8]) expect(taskNumbered(w, number).status).toBe("pending");
    // A second phase in a queued plan is laid too, while plan a runs.
    said(lead.call("update", { task: "#2", status: "in_progress" }));
    said(lead.call("create", { subject: "More b", plan: "b", phase: "P2" }));
    // The start put plan a in flight, claimed by the lead's process, and only plan a.
    const a = taskNumbered(w, 1);
    expect(a.status).toBe("in_progress");
    expect(a.claim?.pid).toBe(LEAD.pid);
    expect(taskNumbered(w, 4).status).toBe("pending");
    expect(taskNumbered(w, 7).status).toBe("pending");
  } finally {
    lead.close();
  }
});

test("a start in a second plan is refused while the first is in flight, with its two ways forward", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    queue(lead, ["a", "b", "c"]);
    said(lead.call("update", { task: "#2", status: "in_progress" }));
    const refusal =
      'Plan "a" (#1) is in flight: your session runs one plan at a time. Do not start work in plan "b" yet. Finish "a" (task_done on its #1 once its phases are closed), or park it in two calls: task_update with task "#1" and status "pending" (refused while any phase or task of "a" is running, so stop that first), then task_note on "#1" with a note that starts "parked:" and says why.';
    expect(refused(lead.call("update", { task: "#5", status: "in_progress" }))).toBe(refusal);
    // A task made in progress, and the plan task itself, are starts too.
    expect(
      refused(lead.call("create", { subject: "Now", parent: "#5", status: "in_progress" })),
    ).toBe(refusal);
    expect(refused(lead.call("update", { task: "#4", status: "in_progress" }))).toBe(refusal);
    expect(taskNumbered(w, 4).status).toBe("pending");
    // Work inside the plan in flight goes on.
    said(lead.call("update", { task: "#3", status: "in_progress" }));
    // A plan another session laid but never started is judged too: the lead's start there is
    // refused while plan a runs (a plan it made itself would be refused the same way).
    queue(other, ["x"]); // #10 to #12
    expect(refused(lead.call("update", { task: "#11", status: "in_progress" }))).toContain(
      'Plan "a" (#1) is in flight',
    );
    // Another session has its own one plan in flight, and the lead's never blocks it.
    said(other.call("update", { task: "#11", status: "in_progress" }));
    expect(taskNumbered(w, 10).status).toBe("in_progress");
  } finally {
    lead.close();
    other.close();
  }
});

test("park: a plan goes back to pending only once its work stopped, then the next plan starts and resuming waits", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a", "b"]);
    said(lead.call("update", { task: "#2", status: "in_progress" }));
    // A phase is running: the park is refused, and nothing changed.
    expect(refused(lead.call("update", { task: "#1", status: "pending" }))).toBe(
      'Plan "a" (#1) has work in progress (#2): do not park it yet. Finish that work (task_done), or set it back to pending (task_update with status "pending"), then park the plan.',
    );
    expect(taskNumbered(w, 1).status).toBe("in_progress");
    // The phase stops; the park goes through, with its own note, and drops nothing.
    said(lead.call("update", { task: "#2", status: "pending" }));
    said(lead.call("update", { task: "#1", status: "pending" }));
    said(lead.call("note", { task: "#1", text: "parked: plan b first" }));
    const parked = taskNumbered(w, 1);
    expect(parked.status).toBe("pending");
    expect(parked.claim).toBeNull();
    expect(taskNumbered(w, 2).status).toBe("pending");
    expect(taskNumbered(w, 3).status).toBe("pending");
    // Plan b starts.
    said(lead.call("update", { task: "#5", status: "in_progress" }));
    expect(taskNumbered(w, 4).status).toBe("in_progress");
    // Resuming a is a start, so it waits for b.
    expect(refused(lead.call("update", { task: "#2", status: "in_progress" }))).toContain(
      'Plan "b" (#4) is in flight',
    );
    // b is finished with task_done; then a resumes by starting a phase.
    said(lead.call("done", { task: "#6", evidence: "ran it: ok" }));
    said(lead.call("done", { task: "#5" }));
    said(lead.call("done", { task: "#4" }));
    said(lead.call("update", { task: "#2", status: "in_progress" }));
    expect(taskNumbered(w, 1).status).toBe("in_progress");
  } finally {
    lead.close();
  }
});

test("a plan stays in flight until task_done: its fix pass waits under it, an unnamed task is loose, an unnamed phase goes to it", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a", "b", "c"]);
    // Plan b runs, with a second phase still to start; plan a (lower number) is queued.
    said(lead.call("create", { subject: "More b", plan: "b", phase: "P2" })); // #10
    said(lead.call("create", { subject: "More b step", parent: "#10" })); // #11
    said(lead.call("update", { task: "#5", status: "in_progress" }));
    said(lead.call("create", { subject: "Unnamed one" })); // #12
    expect(taskNumbered(w, 12).plan).toBeNull();
    // Both of b's phases close: b is still in flight (its task is not done), so the final
    // review's fix pass, a task under the plan, still lands in b and not in the queued plan a.
    said(lead.call("done", { task: "#6", evidence: "ran it: ok" }));
    said(lead.call("done", { task: "#5" }));
    said(lead.call("done", { task: "#11", evidence: "ran it: ok" }));
    said(lead.call("done", { task: "#10" }));
    expect(taskNumbered(w, 4).status).toBe("in_progress");
    said(lead.call("create", { subject: "Fix a review finding", parent: "#4" })); // #13
    expect(taskNumbered(w, 13).plan).toBe("b");
    said(lead.call("create", { subject: "Late area", phase: "P3" })); // #14
    expect(taskNumbered(w, 14).plan).toBe("b");
    // And plan c cannot start before b is closed.
    expect(refused(lead.call("update", { task: "#8", status: "in_progress" }))).toContain(
      'Plan "b" (#4) is in flight',
    );
  } finally {
    lead.close();
  }
});

test("4.8.0 data: a plan task still pending with a phase in progress counts as in flight, and its next start sets the task", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a", "b"]);
    // What 4.8.0 wrote: the phase running, the plan task never set.
    const db = openWorkDb(workDbFile(w.paths), { mode: "write" });
    try {
      const phase = allTasks(db, folderProject(w.repo)).find((t) => t.number === 2);
      if (phase === undefined) throw new Error("no phase");
      const result = writeWork(db, () =>
        applyUpdate(db, phase.id, { status: "in_progress" }, LEAD, 5),
      );
      expect(result.ok).toBe(true);
    } finally {
      db.close();
    }
    expect(taskNumbered(w, 1).status).toBe("pending");
    expect(refused(lead.call("update", { task: "#5", status: "in_progress" }))).toContain(
      'Plan "a" (#1) is in flight',
    );
    // The next start in plan a sets its task.
    said(lead.call("update", { task: "#3", status: "in_progress" }));
    expect(taskNumbered(w, 1).status).toBe("in_progress");
  } finally {
    lead.close();
  }
});

/** The same Claude process after a `/clear`: another session id, the same pid and start time. */
const AFTER_CLEAR = { ...LEAD, sessionId: "lead-after-clear" };

test("after /clear (a new session id, the same process) a start in a queued plan is still refused, and the queue is still the caller's", () => {
  const w = world();
  const before = w.ops();
  const after = w.ops(AFTER_CLEAR);
  try {
    queue(before, ["a", "b"]); // plan a #1, plan b #4: both made by the old session id
    said(before.call("update", { task: "#2", status: "in_progress" }));
    // Plan b is queued, so only the old session id owns it; the new one must not slip past.
    expect(refused(after.call("update", { task: "#5", status: "in_progress" }))).toContain(
      'Plan "a" (#1) is in flight',
    );
    expect(taskNumbered(w, 4).status).toBe("pending");
    // A phase laid with no plan goes to the plan in flight, and the new id sees both plans.
    said(after.call("create", { subject: "Unnamed", phase: "P9" })); // #7
    expect(taskNumbered(w, 7).plan).toBe("a");
    const ledger = said(after.call("list", { scope: "plan" }));
    expect(ledger).toContain("#1 [in flight · plan]");
    expect(ledger).toContain("#4 [queued · plan]");
  } finally {
    before.close();
    after.close();
  }
});

test("a plan started under 4.8.0 is in flight while a phase runs, so the refusal says to stop that phase, not to park the plan", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a", "b"]);
    const db = openWorkDb(workDbFile(w.paths), { mode: "write" });
    try {
      const phase = allTasks(db, folderProject(w.repo)).find((t) => t.number === 2);
      if (phase === undefined) throw new Error("no phase");
      expect(
        writeWork(db, () => applyUpdate(db, phase.id, { status: "in_progress" }, LEAD, 5)).ok,
      ).toBe(true);
    } finally {
      db.close();
    }
    expect(refused(lead.call("update", { task: "#5", status: "in_progress" }))).toBe(
      'Plan "a" (#1) is in flight: your session runs one plan at a time. Do not start work in plan "b" yet. Finish "a" (task_done on its #1 once its phases are closed), or stop its running phase (finish it with task_done, or set it back to pending with task_update); "a" was started before plans carried their own status, so it is in flight only while a phase runs.',
    );
  } finally {
    lead.close();
  }
});

test("a plan in flight because a step of it runs names that step, never a phase from 4.8.0", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    queue(lead, ["a", "b"]);
    // Another session starts a step of the lead's plan: the plan task stays pending, the plan runs.
    said(other.call("update", { task: "#3", status: "in_progress" }));
    expect(taskNumbered(w, 1).status).toBe("pending");
    expect(refused(lead.call("update", { task: "#5", status: "in_progress" }))).toBe(
      'Plan "a" (#1) is in flight: your session runs one plan at a time. Do not start work in plan "b" yet. Finish "a" (task_done on its #1 once its phases are closed), or stop the work running in "a" (#3): finish it (task_done), or set it back to pending (task_update with status "pending").',
    );
  } finally {
    lead.close();
    other.close();
  }
});

test("task_list on the plan ledger marks each plan in flight, queued, parked or finishing, in number order", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a", "b", "c"]);
    const marks = () =>
      said(lead.call("list", { scope: "plan" }))
        .split("\n")
        .filter((line) => line.includes("· plan]"));
    expect(marks()).toEqual([
      "#1 [queued · plan] Plan a · 0/1 · Phases 1/10",
      "#4 [queued · plan] Plan b · 0/1 · Phases 1/10",
      "#7 [queued · plan] Plan c · 0/1 · Phases 1/10",
    ]);
    said(lead.call("update", { task: "#5", status: "in_progress" }));
    said(lead.call("create", { subject: "Waits in c", parent: "#7" }));
    expect(marks()).toEqual([
      "#1 [queued · plan] Plan a · 0/1 · Phases 1/10",
      "#4 [in flight · plan] Plan b · 0/1 · Phases 1/10",
      "#7 [queued · plan] Plan c · 0/1 · Phases 1/10 · waiting 1",
    ]);
    // Parked by its note, even with nothing done, and by a phase done under a pending plan.
    said(lead.call("update", { task: "#5", status: "pending" }));
    said(lead.call("update", { task: "#4", status: "pending" }));
    said(lead.call("note", { task: "#4", text: "parked: a first" }));
    said(lead.call("done", { task: "#9", evidence: "ran it: ok" }));
    said(lead.call("done", { task: "#8" }));
    expect(marks()).toEqual([
      "#1 [queued · plan] Plan a · 0/1 · Phases 1/10",
      "#4 [parked · plan] Plan b · 0/1 · Phases 1/10",
      "#7 [finishing · plan] Plan c · 1/1 · Phases 1/10 · waiting 1",
    ]);
    // A done phase with another phase still open: parked, not finishing.
    said(lead.call("create", { subject: "More c", plan: "c", phase: "P2" }));
    expect(marks()[2]).toBe("#7 [parked · plan] Plan c · 1/2 · Phases 2/10 · waiting 1");
  } finally {
    lead.close();
  }
});

test("a call that names no plan goes to the plan in flight or in the queue, even after a newer plan was queued", () => {
  const w = world();
  const ops = w.ops();
  const planOf = (number: number) => {
    const db = openWorkDb(workDbFile(w.paths), { mode: "hook" });
    try {
      return allTasks(db, folderProject(w.repo)).find((t) => t.number === number)?.plan;
    } finally {
      db.close();
    }
  };
  try {
    said(ops.call("create", { subject: "Plan A", plan: "a" }));
    said(ops.call("create", { subject: "Area", plan: "a", phase: "A1" }));
    said(ops.call("create", { subject: "Plan B", plan: "b" }));
    // Plan B is the newest, and plan A is the one being built. A plain task is loose.
    said(ops.call("create", { subject: "Where do I go" }));
    expect(planOf(4)).toBeNull();
    said(ops.call("create", { subject: "Second area", phase: "A2" }));
    expect(planOf(5)).toBe("a");
    // A's phases are all done and A is still open (its final review and fix pass): A is the plan
    // being finished, so a call that names no plan goes to A, not to the queued plan B.
    said(ops.call("done", { task: "#2" }));
    said(ops.call("done", { task: "#5" }));
    said(ops.call("create", { subject: "Waits in B", parent: "#3" }));
    said(ops.call("create", { subject: "Late area", phase: "A3" }));
    expect(planOf(7)).toBe("a");
  } finally {
    ops.close();
  }
});

test("inFlightPlanOf: an own plan whose task runs, never a queued one or another session's", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    queue(other, ["x"]); // #1 plan, #2 phase, #3 step
    queue(lead, ["a"]); // #4 plan, #5 phase, #6 step
    const inFlightOf = (who: { sessionId: string }) => {
      const db = openWorkDb(workDbFile(w.paths), { mode: "hook" });
      try {
        const all = allTasks(db, folderProject(w.repo));
        return inFlightPlanOf(all, (t) => t.createdBy === who.sessionId)?.plan ?? null;
      } finally {
        db.close();
      }
    };
    // Laid out is not in flight, whatever its phases are.
    expect(inFlightOf(LEAD)).toBeNull();
    expect(inFlightOf(OTHER)).toBeNull();
    said(other.call("update", { task: "#2", status: "in_progress" }));
    expect(inFlightOf(LEAD)).toBeNull();
    expect(inFlightOf(OTHER)).toBe("x");
  } finally {
    lead.close();
    other.close();
  }
});

test("a task waits under a plan, moves under a phase of that plan, and holds the plan's close", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    expect(said(ops.call("create", { subject: "Ask later", parent: "#1" }))).toContain(
      '#2 "Ask later" under #1',
    );
    const db = openWorkDb(workDbFile(w.paths), { mode: "hook" });
    try {
      const task = allTasks(db, folderProject(w.repo)).find((t) => t.number === 2);
      expect(task).toMatchObject({ kind: "task", plan: "p" });
      expect(task?.parentId).toBe(allTasks(db, folderProject(w.repo))[0]?.id ?? "none");
    } finally {
      db.close();
    }
    // The plan cannot close while the waiting task is open.
    expect(refused(ops.call("done", { task: "#1" }))).toBe("open tasks: #2 Ask later");
    // An existing task never moves up under a plan.
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "Step", parent: "#3" }));
    said(ops.call("done", { task: "#4", evidence: "ran it: ok" }));
    expect(refused(ops.call("update", { task: "#4", parent: "#1" }))).toContain(
      "a task waits under a plan only where it is made",
    );
    // Later it moves under a phase of its own plan, and the plan list counts it there.
    said(ops.call("update", { task: "#2", parent: "#3" }));
    expect(said(ops.call("list", { scope: "plan" }))).toContain(
      "#3 [pending · phase A] Area · 1/2",
    );
  } finally {
    ops.close();
  }
});

test("a waiting task cannot move to another plan's phase", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan P", plan: "p" }));
    said(ops.call("create", { subject: "Plan Q", plan: "q" }));
    said(ops.call("create", { subject: "Area Q", plan: "q", phase: "Q1" }));
    said(ops.call("create", { subject: "Waits in P", parent: "#1" }));
    expect(refused(ops.call("update", { task: "#4", parent: "#3" }))).toBe(
      '#4 "Waits in P" waits in plan "p": move it under a phase of that plan',
    );
  } finally {
    ops.close();
  }
});

test("the status line shows the phase while it runs, and the plan in flight between waves", () => {
  const w = world();
  const ops = w.ops();
  const progress = () => {
    const read = planProgress(w.paths, folderProject(w.repo), LEAD);
    if (read.state !== "ready" || read.value === null) throw new Error("no progress");
    return read.value;
  };
  try {
    queue(ops, ["a", "b"]); // plan #1, phase #2, step #3; plan #4, phase #5, step #6
    expect(planProgress(w.paths, folderProject(w.repo), LEAD)).toEqual({
      state: "ready",
      value: null,
    });
    said(ops.call("update", { task: "#2", status: "in_progress" }));
    expect(progress().task.number).toBe(2);
    expect(progress().phase?.number).toBe(2);
    said(ops.call("done", { task: "#3", evidence: "ran it: ok" }));
    said(ops.call("done", { task: "#2" }));
    // Between waves: no phase runs, plan a does, and it is what the line names, never plan b.
    expect(progress().task.number).toBe(1);
    expect(progress().plan?.number).toBe(1);
    expect(progress().phases).toEqual({ closed: 1, total: 1 });
  } finally {
    ops.close();
  }
});

test("the status line counts the plans that wait behind the one in flight", () => {
  const w = world();
  const ops = w.ops();
  const planRow = () => (taskSegment(w.paths, folderProject(w.repo), LEAD) ?? "").split("\n")[0];
  try {
    queue(ops, ["a", "b", "c"]); // plans #1, #4, #7, each with a phase and a step
    said(ops.call("update", { task: "#2", status: "in_progress" }));
    expect(planRow()).toBe("Plan · Plan a · 2 queued");
    // Park plan a, then start plan b: a is parked, c still queued.
    said(ops.call("update", { task: "#2", status: "pending" }));
    said(ops.call("update", { task: "#1", status: "pending" }));
    said(ops.call("note", { task: "#1", text: "parked: plan b first" }));
    said(ops.call("update", { task: "#5", status: "in_progress" }));
    expect(planRow()).toBe("Plan · Plan b · 1 queued, 1 parked");
    // Another session's plan never counts.
    const other = w.ops(OTHER);
    try {
      said(other.call("create", { subject: "Plan z", plan: "z" }));
    } finally {
      other.close();
    }
    expect(planRow()).toBe("Plan · Plan b · 1 queued, 1 parked");
  } finally {
    ops.close();
  }
});

test("a waiting task in a phased plan shows on the status line under no phase", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "Waits", parent: "#1" }));
    said(ops.call("update", { task: "#3", status: "in_progress" }));
    const read = planProgress(w.paths, folderProject(w.repo), LEAD);
    if (read.state !== "ready" || read.value === null) throw new Error("no progress");
    expect(read.value.task.number).toBe(3);
    expect(read.value.phase).toBeNull();
    expect(read.value.phases).toEqual({ closed: 0, total: 1 });
    expect(read.value.tasks).toBeNull();
  } finally {
    ops.close();
  }
});

test("task_list on the plan ledger shows Phases n/cap, and a plan over the cap is frozen", () => {
  const w = world();
  const ops = w.ops();
  try {
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { workflow: { plans: { maxPhases: 3 } } });
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    for (const id of ["A", "B", "C"])
      said(ops.call("create", { subject: id, plan: "p", phase: id }));
    expect(said(ops.call("list", { scope: "plan" })).split("\n")[0]).toBe(
      "#1 [queued · plan] Plan · 0/3 · Phases 3/3",
    );
    // The cap is lowered below the plan's count: the plan is frozen, nothing is rewritten.
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { workflow: { plans: { maxPhases: 2 } } });
    expect(said(ops.call("list", { scope: "plan" })).split("\n")[0]).toBe(
      "#1 [queued · plan] Plan · 0/3 · Phases 3/2 · frozen: over the cap, no new phases",
    );
    // Other scopes do not carry the count.
    expect(said(ops.call("list", { scope: "project" }))).not.toContain("Phases");
    // A cap that cannot be read leaves the count and says why.
    personalFile(w, "{ not json");
    const broken = said(ops.call("list", { scope: "plan" }));
    expect(broken.split("\n")[0]).toBe("#1 [queued · plan] Plan · 0/3 · Phases 3");
    expect(broken).toContain("plans.maxPhases cannot be read: Invalid");
  } finally {
    ops.close();
  }
});

test("doctor: one ! line for each open plan over the cap, with its fix", () => {
  const w = world();
  const ops = w.ops();
  try {
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { workflow: { plans: { maxPhases: 3 } } });
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    for (const id of ["A", "B", "C"])
      said(ops.call("create", { subject: id, plan: "p", phase: id }));
    const config = (max: number) => ({ workflow: { plans: { maxPhases: max } } });
    expect(planCapChecks(w.repo, w.env, w.paths, config(3))).toEqual([]);
    expect(planCapChecks(w.repo, w.env, w.paths, config(2))).toEqual([
      {
        ok: true,
        warn: true,
        text: 'project plans: plan "p" (#1) holds 3 phases, over the plans.maxPhases cap of 2 (project): it is frozen and takes no new phase',
        fix: "finish it, or re-plan its remaining work as plans within the cap",
      },
    ]);
    // A closed plan is history, and a folder with no store says nothing.
    for (const task of ["#2", "#3", "#4"]) said(ops.call("done", { task }));
    said(ops.call("done", { task: "#1" }));
    expect(planCapChecks(w.repo, w.env, w.paths, config(2))).toEqual([]);
    expect(planCapChecks(makeRepo(), hookEnv(), cliPaths(hookEnv()), null)).toEqual([]);
  } finally {
    ops.close();
  }
});

/** Step #3 blocked by its phase #2: the hold a store lifted by an older release may still carry. */
function holdOnAncestor(db: WorkDb): void {
  db.sqlite.run(
    "INSERT INTO task_deps(task_id,waits_for) SELECT t.id,p.id FROM tasks t, tasks p WHERE t.number=3 AND p.number=2",
  );
}

test("doctor: a ! line for each open task blocked by an open task above it, with the way to lift it", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "Step", parent: "#2" }));
    expect(ancestorHoldChecks(w.repo, w.env, w.paths)).toEqual([]);
    expect(refused(ops.call("update", { task: "#3", blocked_by_add: ["#2"] }))).toContain(
      "it sits under it",
    );
    const db = openWorkDb(workDbFile(w.paths), { mode: "write" });
    try {
      holdOnAncestor(db);
      expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 6 });
    } finally {
      db.close();
    }
    const line: Check = {
      ok: true,
      warn: true,
      text: "project tasks: #3 is blocked by #2, which it sits under, so neither can be done",
      fix: 'task_update #3 with blocked_by_remove ["#2"]',
    };
    expect(ancestorHoldChecks(w.repo, w.env, w.paths)).toEqual([line]);
    // The fix the line names lifts the hold.
    said(ops.call("update", { task: "#3", blocked_by_remove: ["#2"] }));
    expect(ancestorHoldChecks(w.repo, w.env, w.paths)).toEqual([]);
    // A folder with no store says nothing.
    expect(ancestorHoldChecks(makeRepo(), hookEnv(), cliPaths(hookEnv()))).toEqual([]);
  } finally {
    ops.close();
  }
});

test("doctor: a hold on an ancestor says nothing once either task is closed", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "Step", parent: "#2" }));
    const db = openWorkDb(workDbFile(w.paths), { mode: "write" });
    try {
      holdOnAncestor(db);
      expect(ancestorHoldChecks(w.repo, w.env, w.paths)).toHaveLength(1);
      // A closed blocker lets its task go, and a closed task waits for nothing: no deadlock.
      db.sqlite.run("UPDATE tasks SET status='done' WHERE number=2");
      expect(ancestorHoldChecks(w.repo, w.env, w.paths)).toEqual([]);
      db.sqlite.run("UPDATE tasks SET status='pending' WHERE number=2");
      db.sqlite.run("UPDATE tasks SET status='dropped' WHERE number=3");
      expect(ancestorHoldChecks(w.repo, w.env, w.paths)).toEqual([]);
    } finally {
      db.close();
    }
  } finally {
    ops.close();
  }
});

test("a step of a phase closes done only with evidence, dropped only with a note", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    for (const subject of ["One", "Two", "Three"])
      said(ops.call("create", { subject, parent: "#2" }));
    const bare = (n: number) =>
      `#${n} "${["One", "Two", "Three"][n - 3]}" is a step of phase #2: a step closes done with evidence: what you ran or checked and its result (task_done with task "#${n}" and evidence)`;
    expect(refused(ops.call("done", { task: "#3" }))).toBe(bare(3));
    expect(refused(ops.call("update", { task: "#3", status: "done" }))).toBe(bare(3));
    expect(refused(ops.call("done", { task: "#3", note: "all fine" }))).toBe(bare(3));
    said(ops.call("done", { task: "#3", evidence: "ran the tests: 4 pass" }));
    expect(refused(ops.call("done", { task: "#4", outcome: "dropped" }))).toBe(
      '#4 "Two" is a step of phase #2: a step is dropped with a note that gives the reason (task_done with task "#4", outcome "dropped" and note)',
    );
    expect(refused(ops.call("done", { task: "#4", outcome: "dropped", evidence: "x" }))).toContain(
      "dropped with a note",
    );
    expect(refused(ops.call("update", { task: "#4", status: "dropped" }))).toContain(
      "dropped with a note",
    );
    said(ops.call("done", { task: "#4", outcome: "dropped", note: "out of scope" }));
    // The refusal changed nothing: the step is still open and kept no note.
    expect(said(ops.call("get", { task: "#5" }))).toContain("pending");
    // A phase, a plan, a loose task and a task waiting under a plan keep the plain close.
    said(ops.call("done", { task: "#5", evidence: "checked" }));
    said(ops.call("done", { task: "#2" }));
    said(ops.call("create", { subject: "Waits", parent: "#1" }));
    said(ops.call("done", { task: "#6" }));
    said(ops.call("done", { task: "#1" }));
    const loose = w.ops(OTHER);
    try {
      said(loose.call("create", { subject: "Loose" }));
      said(loose.call("done", { task: "#7" }));
    } finally {
      loose.close();
    }
  } finally {
    ops.close();
  }
});

test("a phase whose only step was dropped has no task, so it does not start", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "Step", parent: "#2" }));
    said(ops.call("done", { task: "#3", outcome: "dropped", note: "not needed" }));
    expect(refused(ops.call("update", { task: "#2", status: "in_progress" }))).toContain(
      "has no tasks",
    );
    said(ops.call("create", { subject: "Real step", parent: "#2" }));
    said(ops.call("update", { task: "#2", status: "in_progress" }));
  } finally {
    ops.close();
  }
});

test("an open step cannot leave its phase to the top or a plan; it may change phase, and a closed one is free", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area A", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "Area B", plan: "p", phase: "B" }));
    said(ops.call("create", { subject: "Step", parent: "#2" }));
    const stays =
      '#4 "Step" is an open step of phase #2 and stays there until it is closed: close it with evidence (task_done with task "#4" and evidence), or drop it with a note that gives the reason (task_done with outcome "dropped" and note); it may move to another phase of the plan';
    expect(refused(ops.call("update", { task: "#4", parent: null }))).toBe(stays);
    expect(refused(ops.call("update", { task: "#4", parent: "#1" }))).toBe(stays);
    said(ops.call("update", { task: "#4", parent: "#3" }));
    // Closed with its proof, it is free to move.
    said(ops.call("done", { task: "#4", evidence: "ran it: ok" }));
    said(ops.call("update", { task: "#4", parent: null }));
  } finally {
    ops.close();
  }
});

test("task_list names the open tasks waiting under a plan, so full phase progress cannot hide them", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" }));
    said(ops.call("create", { subject: "Area", plan: "p", phase: "A" }));
    said(ops.call("create", { subject: "Step", parent: "#2" }));
    said(ops.call("done", { task: "#3", evidence: "ran it: ok" }));
    said(ops.call("done", { task: "#2" }));
    expect(said(ops.call("list", { scope: "plan", open_only: false })).split("\n")[0]).toBe(
      "#1 [finishing · plan] Plan · 1/1 · Phases 1/10",
    );
    said(ops.call("create", { subject: "Later one", parent: "#1" }));
    said(ops.call("create", { subject: "Later two", parent: "#1" }));
    said(ops.call("done", { task: "#5" }));
    expect(said(ops.call("list", { scope: "plan", open_only: false })).split("\n")[0]).toBe(
      "#1 [finishing · plan] Plan · 1/1 · Phases 1/10 · waiting 1",
    );
  } finally {
    ops.close();
  }
});

test("after task_take of a plan with a running phase, that plan is the taker's plan in flight, and the refusal names it", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    said(lead.call("create", { subject: "Plan A", plan: "a" }));
    said(lead.call("create", { subject: "Area", plan: "a", phase: "A1" }));
    said(other.call("create", { subject: "Plan X", plan: "x" }));
    said(other.call("create", { subject: "Area", plan: "x", phase: "X1" }));
    said(other.call("create", { subject: "Step", parent: "#4" }));
    said(other.call("update", { task: "#4", status: "in_progress" }));
    said(lead.call("take", { task: "x", force: true }));
    const db = openWorkDb(workDbFile(w.paths), { mode: "hook" });
    try {
      const all = allTasks(db, folderProject(w.repo));
      const ownedByLead = (t: { createdBy: string | null }) => t.createdBy === LEAD.sessionId;
      // Both plans are the lead's now; the one with a phase in progress is the one in flight.
      expect(inFlightPlanOf(all, ownedByLead)?.plan).toBe("x");
    } finally {
      db.close();
    }
    // The refusal to start in plan a names plan x, which the lead now owns; work in x goes on.
    said(lead.call("create", { subject: "Step", parent: "#2" }));
    const refusal = refused(lead.call("update", { task: "#2", status: "in_progress" }));
    expect(refusal).toContain('Plan "x" (#3) is in flight');
    said(lead.call("create", { subject: "Second area", plan: "x", phase: "X2" }));
    // Laying phases in the other plan is not refused any more.
    said(lead.call("create", { subject: "More", plan: "a", phase: "A2" }));
  } finally {
    lead.close();
    other.close();
  }
});

function planOfNumber(w: ReturnType<typeof world>, number: number) {
  const db = openWorkDb(workDbFile(w.paths), { mode: "hook" });
  try {
    return allTasks(db, folderProject(w.repo)).find((t) => t.number === number)?.plan;
  } finally {
    db.close();
  }
}

test("a plan whose phases are all dropped is not finishing: the call falls to the latest own task's plan", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan A", plan: "a" })); // #1
    said(ops.call("create", { subject: "Area", plan: "a", phase: "A1" })); // #2
    said(ops.call("done", { task: "#2", outcome: "dropped" }));
    said(ops.call("create", { subject: "Plan B", plan: "b" })); // #3
    said(ops.call("create", { subject: "Waits in B", parent: "#3" })); // #4
    said(ops.call("create", { subject: "Next ask", phase: "B1" })); // #5
    expect(planOfNumber(w, 5)).toBe("b");
  } finally {
    ops.close();
  }
});

test("a 4.8.0 drop-parked plan: its dropped phase reopens on the cap alone, even with another plan in flight", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan A", plan: "a" })); // #1
    said(ops.call("create", { subject: "Area", plan: "a", phase: "A1" })); // #2
    said(ops.call("create", { subject: "Step", parent: "#2" })); // #3
    said(ops.call("done", { task: "#3", outcome: "dropped", note: "parked: other work first" }));
    said(ops.call("done", { task: "#2", outcome: "dropped", note: "parked: other work first" }));
    said(ops.call("create", { subject: "Plan B", plan: "b" })); // #4
    said(ops.call("create", { subject: "B area", plan: "b", phase: "B1" })); // #5
    said(ops.call("create", { subject: "B step", parent: "#5" })); // #6
    said(ops.call("update", { task: "#5", status: "in_progress" }));
    // B is in flight: A's phase still comes back to pending (only the cap judges a reopen) ...
    said(ops.call("update", { task: "#2", status: "pending" }));
    said(ops.call("update", { task: "#3", status: "pending" }));
    // ... but starting it is a start in another plan.
    expect(refused(ops.call("update", { task: "#2", status: "in_progress" }))).toContain(
      'Plan "b" (#4) is in flight',
    );
  } finally {
    ops.close();
  }
});

test("reopening a dropped phase counts toward the cap like laying one", () => {
  const w = world();
  personalFile(w, { plans: { maxPhases: 2 } });
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "p" })); // #1
    said(ops.call("create", { subject: "A", plan: "p", phase: "A" })); // #2
    said(ops.call("create", { subject: "B", plan: "p", phase: "B" })); // #3
    said(ops.call("done", { task: "#2", outcome: "dropped" }));
    said(ops.call("create", { subject: "C", plan: "p", phase: "C" })); // #4 takes the freed slot
    expect(refused(ops.call("update", { task: "#2", status: "pending" }))).toContain(
      "already holds 2 phases, the most plans.maxPhases allows (2, from your own workflow settings)",
    );
    said(ops.call("done", { task: "#4", outcome: "dropped" }));
    said(ops.call("update", { task: "#2", status: "pending" }));
  } finally {
    ops.close();
  }
});

test("an open step moves to a phase of its own plan only, never to another plan's phase", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    said(lead.call("create", { subject: "Plan A", plan: "a" })); // #1
    said(lead.call("create", { subject: "Area", plan: "a", phase: "A1" })); // #2
    said(lead.call("create", { subject: "Step", parent: "#2" })); // #3
    said(other.call("create", { subject: "Plan X", plan: "x" })); // #4
    said(other.call("create", { subject: "Area", plan: "x", phase: "X1" })); // #5
    expect(refused(lead.call("update", { task: "#3", parent: "#5" }))).toContain(
      "stays there until it is closed",
    );
    said(lead.call("create", { subject: "Second area", plan: "a", phase: "A2" })); // #6
    said(lead.call("update", { task: "#3", parent: "#6" }));
  } finally {
    lead.close();
    other.close();
  }
});

const IN_FLIGHT_A =
  'Plan "a" (#1) is in flight: your session runs one plan at a time. Do not start work in plan "b" yet. Finish "a" (task_done on its #1 once its phases are closed), or park it in two calls: task_update with task "#1" and status "pending" (refused while any phase or task of "a" is running, so stop that first), then task_note on "#1" with a note that starts "parked:" and says why.';

test("plans laid, then a /clear before any start: the new session id still owns them, and the one-plan rule holds through the wave and its final review", () => {
  const w = world();
  const before = w.ops();
  const after = w.ops(AFTER_CLEAR);
  try {
    queue(before, ["a", "b"]); // plan a #1, phase #2, step #3; plan b #4, phase #5, step #6
    // Nothing is claimed yet, so only the process that made the plans proves they are the caller's.
    expect(said(after.call("list", {}))).toBe(
      [
        "#1 [pending · plan] Plan a · 0/1",
        "  #2 [pending · phase P1] Area a · 0/1 · agent none · branch none",
        "    #3 [pending] Step a",
        "#4 [pending · plan] Plan b · 0/1",
        "  #5 [pending · phase P1] Area b · 0/1 · agent none · branch none",
        "    #6 [pending] Step b",
      ].join("\n"),
    );
    // The first start puts plan a in flight, though its plan task was made under the old id.
    expect(said(after.call("update", { task: "#2", status: "in_progress" }))).toBe(
      '#2 "Area a" · in progress',
    );
    expect(taskNumbered(w, 1).status).toBe("in_progress");
    expect(taskNumbered(w, 1).claim?.pid).toBe(LEAD.pid);
    // The wave finishes; the plan still owes its final review, so plan b stays refused.
    said(after.call("done", { task: "#3", evidence: "ran it: ok" }));
    said(after.call("done", { task: "#2" }));
    expect(refused(after.call("update", { task: "#5", status: "in_progress" }))).toBe(IN_FLIGHT_A);
    expect(taskNumbered(w, 4).status).toBe("pending");
    expect(said(after.call("list", { scope: "plan" }))).toBe(
      [
        "#1 [in flight · plan] Plan a · 1/1 · Phases 1/10",
        "  #2 [done · phase P1] Area a · 1/1 · agent none · branch none",
        "#4 [queued · plan] Plan b · 0/1 · Phases 1/10",
        "  #5 [pending · phase P1] Area b · 0/1 · agent none · branch none",
      ].join("\n"),
    );
  } finally {
    before.close();
    after.close();
  }
});

test("starting one step of another session's plan does not make that plan the caller's", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    said(other.call("create", { subject: "Plan a", plan: "a" })); // #1
    said(other.call("create", { subject: "Area a", plan: "a", phase: "P1" })); // #2
    said(other.call("create", { subject: "Step a1", parent: "#2" })); // #3
    said(other.call("create", { subject: "Step a2", parent: "#2" })); // #4
    said(other.call("update", { task: "#2", status: "in_progress" }));
    queue(lead, ["b"]); // plan b #5, phase #6, step #7
    // The lead helps with one of the other session's steps.
    expect(said(lead.call("update", { task: "#4", status: "in_progress" }))).toBe(
      '#4 "Step a2" · in progress',
    );
    // Its own list shows its own plan and the step it holds, never the other session's plan.
    expect(said(lead.call("list", {}))).toBe(
      [
        "#4 [in progress] Step a2",
        "#5 [pending · plan] Plan b · 0/1",
        "  #6 [pending · phase P1] Area b · 0/1 · agent none · branch none",
        "    #7 [pending] Step b",
      ].join("\n"),
    );
    // The other session's plan is not the lead's plan in flight, so the lead's own plan starts.
    expect(said(lead.call("update", { task: "#6", status: "in_progress" }))).toBe(
      '#6 "Area b" · in progress',
    );
    expect(taskNumbered(w, 5).status).toBe("in_progress");
    expect(taskNumbered(w, 1).status).toBe("in_progress");
  } finally {
    lead.close();
    other.close();
  }
});

test("a parked plan with every phase closed reads parked, not finishing, and resumes by starting its plan task", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a"]);
    said(lead.call("update", { task: "#2", status: "in_progress" }));
    said(lead.call("done", { task: "#3", evidence: "ran it: ok" }));
    said(lead.call("done", { task: "#2" }));
    expect(said(lead.call("list", { scope: "plan" }))).toContain(
      "#1 [in flight · plan] Plan a · 1/1 · Phases 1/10",
    );
    said(lead.call("update", { task: "#1", status: "pending" }));
    expect(said(lead.call("list", { scope: "plan" }))).toContain(
      "#1 [finishing · plan] Plan a · 1/1 · Phases 1/10",
    );
    said(lead.call("note", { task: "#1", text: "parked: waiting for the release" }));
    expect(said(lead.call("list", { scope: "plan" }))).toContain(
      "#1 [parked · plan] Plan a · 1/1 · Phases 1/10",
    );
    // It resumes by starting the plan task itself: there is no open phase to start.
    expect(said(lead.call("update", { task: "#1", status: "in_progress" }))).toContain(
      "in progress",
    );
  } finally {
    lead.close();
  }
});

test("a small fix needs no plan: a task with no plan and no parent is loose, and starting it leaves a queued plan queued", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a"]); // plan a #1, phase #2, step #3
    expect(said(lead.call("create", { subject: "fix caching" }))).toBe('#4 "fix caching"');
    expect(taskNumbered(w, 4).plan).toBeNull();
    expect(said(lead.call("update", { task: "#4", status: "in_progress" }))).toBe(
      '#4 "fix caching" · in progress',
    );
    expect(taskNumbered(w, 1).status).toBe("pending");
    expect(said(lead.call("list", { scope: "plan" }))).toBe(
      [
        "#1 [queued · plan] Plan a · 0/1 · Phases 1/10",
        "  #2 [pending · phase P1] Area a · 0/1 · agent none · branch none",
      ].join("\n"),
    );
    // A loose task made in progress is the same.
    expect(said(lead.call("create", { subject: "fix this route", status: "in_progress" }))).toBe(
      '#5 "fix this route"',
    );
    expect(taskNumbered(w, 1).status).toBe("pending");
  } finally {
    lead.close();
  }
});

test("a loose task starts while a plan is in flight: never refused, never counted, and the plan stays in flight", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a", "b"]); // plan a #1, plan b #4
    said(lead.call("update", { task: "#5", status: "in_progress" })); // plan b in flight
    expect(said(lead.call("create", { subject: "fix this API route" }))).toBe(
      '#7 "fix this API route"',
    );
    expect(said(lead.call("update", { task: "#7", status: "in_progress" }))).toBe(
      '#7 "fix this API route" · in progress',
    );
    expect(taskNumbered(w, 7).plan).toBeNull();
    expect(taskNumbered(w, 4).status).toBe("in_progress");
    expect(taskNumbered(w, 1).status).toBe("pending");
    // The loose task is in neither plan's count, and b is still the plan in flight.
    expect(said(lead.call("list", { scope: "plan" }))).toBe(
      [
        "#1 [queued · plan] Plan a · 0/1 · Phases 1/10",
        "  #2 [pending · phase P1] Area a · 0/1 · agent none · branch none",
        "#4 [in flight · plan] Plan b · 0/1 · Phases 1/10",
        "  #5 [in progress · phase P1] Area b · 0/1 · agent none · branch none",
      ].join("\n"),
    );
    expect(refused(lead.call("update", { task: "#2", status: "in_progress" }))).toContain(
      'Plan "b" (#4) is in flight',
    );
  } finally {
    lead.close();
  }
});

test("a phase laid with no plan still goes to the default plan: the plan in flight", () => {
  const w = world();
  const lead = w.ops();
  try {
    queue(lead, ["a", "b"]);
    said(lead.call("update", { task: "#5", status: "in_progress" })); // plan b in flight
    expect(said(lead.call("create", { subject: "More area", phase: "P2" }))).toBe(
      '#7 "More area" · phase P2 of plan b',
    );
    expect(taskNumbered(w, 7).plan).toBe("b");
  } finally {
    lead.close();
  }
});

/**
 * The hand-back guard: a phase that records its builder's `branch` and `base` closes `done` only
 * with a commit in `base..branch` that the plan branch holds. The repo has `main`, the plan
 * branch `plan-br` (at `main`) and a builder branch `work` cut from the same commit.
 */
function handBack(options: { planBranch?: string | null } = {}) {
  const w = world();
  const ops = w.ops();
  const base = git(w.repo, "rev-parse", "main").trim();
  git(w.repo, "branch", "plan-br");
  git(w.repo, "branch", "work");
  const planBranch = options.planBranch === undefined ? "plan-br" : options.planBranch;
  said(ops.call("create", { subject: "Plan", plan: "hb" }));
  if (planBranch !== null) said(ops.call("update", { task: "#1", branch: planBranch }));
  said(
    ops.call("create", {
      subject: "Area",
      plan: "hb",
      phase: "P1",
      branch: "work",
      base,
      worktree: w.repo,
    }),
  );
  said(ops.call("create", { subject: "Step", parent: "#2" }));
  said(ops.call("done", { task: "#3", evidence: "ran it: passes" }));
  return { ...w, ops, base };
}

/** One commit on `branch`, made in a throwaway worktree so the repo's own checkout stays put. */
function commitOn(repo: string, branch: string, file: string) {
  const tree = join(tempDir("hand-back-wt"), "wt");
  git(repo, "worktree", "add", "-q", tree, branch);
  writeFileSync(join(tree, file), "x\n");
  git(tree, "add", file);
  git(tree, "commit", "-q", "-m", `work ${file}`);
  git(repo, "worktree", "remove", "--force", tree);
}

test("a hand-back: a phase with no branch recorded closes as before", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan", plan: "hb" }));
    said(ops.call("update", { task: "#1", branch: "plan-br" }));
    said(ops.call("create", { subject: "Area", plan: "hb", phase: "P1" }));
    said(ops.call("create", { subject: "Step", parent: "#2" }));
    said(ops.call("done", { task: "#3", evidence: "ran it: passes" }));
    expect(said(ops.call("done", { task: "#2" }))).toContain("done");
  } finally {
    ops.close();
  }
});

test("a hand-back: a branch with no commit past its base is refused, naming both", () => {
  const w = handBack();
  try {
    const why = refused(w.ops.call("done", { task: "#2" }));
    expect(why).toContain('"work"');
    expect(why).toContain(w.base);
    expect(why).toContain("no commit");
    const viaUpdate = refused(w.ops.call("update", { task: "#2", status: "done" }));
    expect(viaUpdate).toContain("no commit");
  } finally {
    w.ops.close();
  }
});

test("a hand-back: a commit the plan branch does not hold is refused, naming both branches", () => {
  const w = handBack();
  try {
    commitOn(w.repo, "work", "a.txt");
    const why = refused(w.ops.call("done", { task: "#2" }));
    expect(why).toContain('"work"');
    expect(why).toContain('"plan-br"');
    expect(why).toContain("not in");
    expect(refused(w.ops.call("update", { task: "#2", status: "done" }))).toContain('"plan-br"');
  } finally {
    w.ops.close();
  }
});

test("a hand-back: a commit the plan branch holds lets the phase close, by either tool", () => {
  const w = handBack();
  try {
    commitOn(w.repo, "work", "a.txt");
    git(w.repo, "branch", "-f", "plan-br", "work");
    expect(said(w.ops.call("done", { task: "#2" }))).toContain("done");
  } finally {
    w.ops.close();
  }
  const again = handBack();
  try {
    commitOn(again.repo, "work", "a.txt");
    git(again.repo, "branch", "-f", "plan-br", "work");
    expect(said(again.ops.call("update", { task: "#2", status: "done" }))).toContain("done");
  } finally {
    again.ops.close();
  }
});

test("a hand-back: with no plan branch recorded only the commit count is judged", () => {
  const w = handBack({ planBranch: null });
  try {
    expect(refused(w.ops.call("done", { task: "#2" }))).toContain("no commit");
    commitOn(w.repo, "work", "a.txt");
    expect(said(w.ops.call("done", { task: "#2" }))).toContain("done");
  } finally {
    w.ops.close();
  }
});

test("a hand-back: a branch git cannot find is refused with git's reason, never passed", () => {
  const w = handBack();
  try {
    git(w.repo, "branch", "-D", "work");
    const why = refused(w.ops.call("done", { task: "#2" }));
    expect(why).toContain('"work"');
    expect(why).toContain("could not");
    expect(why.toLowerCase()).toContain("unknown revision");
  } finally {
    w.ops.close();
  }
});

test("a hand-back: task_update judges the binding the call writes, not the old one", () => {
  // The old binding ("work") has no commit, the new one holds a merged commit: it closes.
  const fixed = handBack();
  try {
    git(fixed.repo, "branch", "good");
    commitOn(fixed.repo, "good", "a.txt");
    git(fixed.repo, "branch", "-f", "plan-br", "good");
    expect(
      said(fixed.ops.call("update", { task: "#2", branch: "good", status: "done" })),
    ).toContain("done");
  } finally {
    fixed.ops.close();
  }
  // The old binding is merged work, the new one is empty: refused, naming the new branch.
  const broken = handBack();
  try {
    commitOn(broken.repo, "work", "a.txt");
    git(broken.repo, "branch", "-f", "plan-br", "work");
    git(broken.repo, "branch", "empty");
    const why = refused(broken.ops.call("update", { task: "#2", branch: "empty", status: "done" }));
    expect(why).toContain('"empty"');
    expect(why).toContain("no commit");
  } finally {
    broken.ops.close();
  }
});

test("a hand-back: a dropped phase is not judged", () => {
  const w = handBack();
  try {
    expect(
      said(w.ops.call("done", { task: "#2", outcome: "dropped", note: "not needed" })),
    ).toContain("dropped");
  } finally {
    w.ops.close();
  }
});
