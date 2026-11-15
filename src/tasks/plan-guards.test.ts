/**
 * The plan shape the task tools hold a session to (`plan-guards.ts`, `docs/design/tasks.md`): the
 * phase cap, no phase started empty, one active plan, tasks waiting under a plan, a step closed
 * with its proof, and the counts `task_list` and `doctor` show. Each test runs the same
 * operations the MCP tools and the `task` command run (`createTaskOps`), in a temp repo and a
 * temp home, so no real workflow setting is read.
 */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cliPaths } from "../cli/paths";
import { planCapChecks } from "../cli/project-checks";
import { hookEnv, makeRepo, writeClaudeFile } from "../testing/hooks";
import { folderProject } from "./context";
import { createTaskOps, type TaskAnswer } from "./ops";
import { openWorkDb, workDbFile, writeWork } from "./work/db";
import { activePlanOf, allTasks, livePhaseCount } from "./work/queries";
import { planProgress } from "./work/read";
import { layPhase } from "./work/store";

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

test("one active plan: a phase in a second plan is refused while the first has open phases", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    said(lead.call("create", { subject: "Plan A", plan: "a" }));
    said(lead.call("create", { subject: "Area", plan: "a", phase: "A1" }));
    said(lead.call("create", { subject: "Step", parent: "#2" }));
    said(lead.call("create", { subject: "Plan B", plan: "b" }));
    const refusal = refused(lead.call("create", { subject: "Area", plan: "b", phase: "B1" }));
    expect(refusal).toBe(
      'Plan "a" (#1) is your active plan: it still has open phases. Do not lay a phase in plan "b" yet. Queue the work as a task that waits there (task_create with parent "#4"), or finish or drop the open phases of "a" first.',
    );
    // A plan that does not exist yet says to make it first.
    expect(refused(lead.call("create", { subject: "Area", plan: "c", phase: "C1" }))).toContain(
      'make plan "c" first',
    );
    // A task waiting in B is the way forward; starting it is not.
    said(lead.call("create", { subject: "Later", parent: "#4" }));
    expect(refused(lead.call("update", { task: "#5", status: "in_progress" }))).toContain(
      'Do not start work in plan "b" yet',
    );
    // Another session's plan never blocks, and never counts as the lead's active plan.
    said(other.call("create", { subject: "Plan X", plan: "x" }));
    said(other.call("create", { subject: "Area", plan: "x", phase: "X1" }));
    said(other.call("create", { subject: "Step", parent: "#6" }));
    // The lead's own plan A closes its phases: B is open to it.
    said(lead.call("done", { task: "#3", evidence: "ran the step: ok" }));
    said(lead.call("done", { task: "#2" }));
    said(lead.call("create", { subject: "Area", plan: "b", phase: "B1" }));
    expect(said(lead.call("update", { task: "#5", status: "in_progress" }))).toContain(
      "in progress",
    );
  } finally {
    lead.close();
    other.close();
  }
});

test("a call that names no plan goes to the active plan, even after a newer plan was queued", () => {
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
    // Plan B is the newest, and plan A is the one being built.
    said(ops.call("create", { subject: "Where do I go" }));
    expect(planOf(4)).toBe("a");
    said(ops.call("create", { subject: "Second area", phase: "A2" }));
    expect(planOf(5)).toBe("a");
    // A's phases are all done and A is still open (its final review and fix pass): A is the plan
    // being finished, so a call that names no plan goes to A, not to the queued plan B.
    said(ops.call("done", { task: "#2" }));
    said(ops.call("done", { task: "#5" }));
    said(ops.call("create", { subject: "Waits in B", parent: "#3" }));
    said(ops.call("create", { subject: "Fix a review finding" }));
    expect(planOf(7)).toBe("a");
  } finally {
    ops.close();
  }
});

test("activePlanOf: an own open plan with an open phase, never another session's", () => {
  const w = world();
  const lead = w.ops();
  const other = w.ops(OTHER);
  try {
    said(other.call("create", { subject: "Plan X", plan: "x" }));
    said(other.call("create", { subject: "Area", plan: "x", phase: "X1" }));
    said(lead.call("create", { subject: "Plan A", plan: "a" }));
    const db = openWorkDb(workDbFile(w.paths), { mode: "hook" });
    try {
      const all = allTasks(db, folderProject(w.repo));
      const ownedBy = (who: { sessionId: string }) => (t: { createdBy: string | null }) =>
        t.createdBy === who.sessionId;
      expect(activePlanOf(all, ownedBy(LEAD))).toBeNull();
      expect(activePlanOf(all, ownedBy(OTHER))?.plan).toBe("x");
    } finally {
      db.close();
    }
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
      "#1 [pending · plan] Plan · 0/3 · Phases 3/3",
    );
    // The cap is lowered below the plan's count: the plan is frozen, nothing is rewritten.
    writeClaudeFile(w.repo, "cc-smart-dev-kit.json", { workflow: { plans: { maxPhases: 2 } } });
    expect(said(ops.call("list", { scope: "plan" })).split("\n")[0]).toBe(
      "#1 [pending · plan] Plan · 0/3 · Phases 3/2 · frozen: over the cap, no new phases",
    );
    // Other scopes do not carry the count.
    expect(said(ops.call("list", { scope: "project" }))).not.toContain("Phases");
    // A cap that cannot be read leaves the count and says why.
    personalFile(w, "{ not json");
    const broken = said(ops.call("list", { scope: "plan" }));
    expect(broken.split("\n")[0]).toBe("#1 [pending · plan] Plan · 0/3 · Phases 3");
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
      "#1 [pending · plan] Plan · 1/1 · Phases 1/10",
    );
    said(ops.call("create", { subject: "Later one", parent: "#1" }));
    said(ops.call("create", { subject: "Later two", parent: "#1" }));
    said(ops.call("done", { task: "#5" }));
    expect(said(ops.call("list", { scope: "plan", open_only: false })).split("\n")[0]).toBe(
      "#1 [pending · plan] Plan · 1/1 · Phases 1/10 · waiting 1",
    );
  } finally {
    ops.close();
  }
});

test("after task_take of a plan with a running phase, that plan is the taker's active plan, and the refusal names it", () => {
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
      // Both plans are the lead's now; the one with a phase in progress is the active one.
      expect(activePlanOf(all, ownedByLead)?.plan).toBe("x");
    } finally {
      db.close();
    }
    // The refusal names plan x, which the lead now owns, and work there is allowed.
    const refusal = refused(lead.call("create", { subject: "More", plan: "a", phase: "A2" }));
    expect(refusal).toContain('Plan "x" (#3) is your active plan');
    said(lead.call("create", { subject: "Second area", plan: "x", phase: "X2" }));
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
    said(ops.call("create", { subject: "Next ask" })); // #5
    expect(planOfNumber(w, 5)).toBe("b");
  } finally {
    ops.close();
  }
});

test("parking: dropping a plan's open steps and phases frees the next plan; resuming is refused while that plan has open phases", () => {
  const w = world();
  const ops = w.ops();
  try {
    said(ops.call("create", { subject: "Plan A", plan: "a" })); // #1
    said(ops.call("create", { subject: "Area", plan: "a", phase: "A1" })); // #2
    said(ops.call("create", { subject: "Step", parent: "#2" })); // #3
    said(ops.call("create", { subject: "Plan B", plan: "b" })); // #4
    // A has an open phase, so B cannot lay one yet.
    expect(refused(ops.call("create", { subject: "B area", plan: "b", phase: "B1" }))).toContain(
      'Plan "a" (#1) is your active plan',
    );
    // Park A: drop each open step, then the open phase, each with a note. The plan stays open.
    said(ops.call("done", { task: "#3", outcome: "dropped", note: "parked: other work first" }));
    said(ops.call("done", { task: "#2", outcome: "dropped", note: "parked: other work first" }));
    said(ops.call("create", { subject: "B area", plan: "b", phase: "B1" })); // #5
    // Resuming A's phase while B has an open phase is refused like laying one.
    const refusal = refused(ops.call("update", { task: "#2", status: "pending" }));
    expect(refusal).toContain('Plan "b" (#4) is your active plan');
    expect(refusal).toContain('Do not reopen a phase in plan "a"');
    // B's phase done: A can come back, its step too, and its phase starts.
    said(ops.call("done", { task: "#5" }));
    said(ops.call("update", { task: "#2", status: "pending" }));
    said(ops.call("update", { task: "#3", status: "pending" }));
    said(ops.call("update", { task: "#2", status: "in_progress" }));
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
