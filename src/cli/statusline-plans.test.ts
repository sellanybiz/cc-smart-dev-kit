/**
 * The lead's `Plans · …` row of the status line (`taskSegment`): counts by the store classifier's
 * states, zero counts left out, alone when the process claims no work (a coordinator) and below
 * the own rows when it does (lead + children), and nothing for a session that leads no plan. The
 * row reads the store alone: no git, no gh, and no session record for a child that runs.
 */
import { expect, test } from "bun:test";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openWorkDb, workDbFile, writeWork } from "../tasks/work/db";
import {
  createTask,
  ensurePlanTask,
  layPhase,
  reservePlan,
  takeTasks,
  updateTask,
} from "../tasks/work/store";
import type { ClaimProcess, Result, Who } from "../tasks/work/types";
import { tempDir } from "../testing/temp";
import { taskSegment } from "./statusline";

/** The coordinator has no process of its own to claim with: its session id names it. */
const LEAD: Who = { sessionId: "lead", pid: null, procStart: null };
const PROJECT = "p";

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

/** A store in a temp folder; `process` answers for the children's processes. */
function world() {
  const paths = { stateDir: tempDir() };
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  let at = 1;
  const tick = () => {
    at += 1;
    return at;
  };
  /** A plan the lead laid, with a file list (none: `undefined`) and blockers. */
  function plan(slug: string, files: string[] = [`src/${slug}/`], blockedBy: string[] = []) {
    return ok(
      createTask(
        db,
        {
          project: PROJECT,
          subject: slug,
          kind: "plan",
          plan: slug,
          ...{ files },
          ...(blockedBy.length > 0 ? { blockedBy } : {}),
        },
        LEAD,
        tick(),
      ),
    );
  }
  /** Reserve a plan for the lead; a child takes it unless told otherwise (`taken` false). */
  function handOut(slug: string, child: Who, taken = true, holder: "child" | "self" = "child") {
    const reserved = ok(
      reservePlan(db, {
        project: PROJECT,
        plan: slug,
        who: LEAD,
        holder,
        ignore: [],
        caseFold: false,
        now: tick(),
      }),
    );
    if (taken)
      ok(
        takeTasks(db, PROJECT, reserved.id, child, tick(), {
          isLive: () => false,
          from: reserved.lead?.handoutId ?? "",
        }),
      );
    return reserved;
  }
  return { paths, db, plan, handOut, tick };
}

/** The children's processes: `running` pids are live, `ended` pids are gone with their sessions. */
function machine(running: number[], ended: number[]): ClaimProcess {
  return {
    live: (c) => running.includes(c.pid),
    gone: (c) => ended.includes(c.pid),
    ended: (c) => ended.includes(c.pid),
  };
}
const NO_ONE = machine([], []);

function child(n: number): Who {
  return { sessionId: `child${n}`, pid: 6000 + n, procStart: `${6000 + n}0` };
}

test("a coordinator's row counts each state in words, zero counts left out", () => {
  const w = world();
  w.plan("a");
  w.plan("b");
  w.plan("c");
  w.handOut("a", child(1));
  w.handOut("b", child(2));
  w.handOut("c", child(3));
  const blocker = w.plan("blocker", ["src/blocker/"]);
  w.plan("waits", ["src/waits/"], [blocker.id]);
  w.plan("ready1", ["src/r1/"]);
  w.plan("bare", []);
  // child1 and child2 run; child3 is gone with its session.
  const text = taskSegment(w.paths, PROJECT, LEAD, machine([6001, 6002], [6003]));
  // blocker is ready by the store too, so two plans are ready.
  expect(text).toBe("Plans · 2 with children · 1 child gone · 1 waiting · 1 needs files · 2 ready");
});

test("one of each reads in the singular, merging counts, and a missing state is not named", () => {
  const w = world();
  w.plan("a");
  w.plan("done");
  w.handOut("a", child(1));
  const closed = w.handOut("done", child(2));
  ok(updateTask(w.db, closed.id, { status: "done" }, child(2), w.tick()));
  expect(taskSegment(w.paths, PROJECT, LEAD, machine([6001], []))).toBe(
    "Plans · 1 with child · 1 merging",
  );
});

test("a coordinator with only waiting and ready plans shows just those", () => {
  const w = world();
  const first = w.plan("first");
  w.plan("second", ["src/second/"], [first.id]);
  w.plan("third", ["src/third/"]);
  expect(taskSegment(w.paths, PROJECT, LEAD, NO_ONE)).toBe("Plans · 1 waiting · 2 ready");
});

test("a session that leads no plan gets nothing", () => {
  const w = world();
  // Another session's plans are not this session's.
  w.plan("a");
  const stranger: Who = { sessionId: "stranger", pid: null, procStart: null };
  expect(taskSegment(w.paths, PROJECT, stranger, NO_ONE)).toBeNull();
  // Nor does an empty store give the lead one.
  expect(taskSegment(world().paths, PROJECT, LEAD, NO_ONE)).toBeNull();
});

test("a closed plan that was never reserved gives no row", () => {
  const w = world();
  const done = w.plan("finished");
  ok(updateTask(w.db, done.id, { status: "done" }, LEAD, w.tick()));
  expect(taskSegment(w.paths, PROJECT, LEAD, NO_ONE)).toBeNull();
});

/** The lead's own running plan: a plan task, one phase and the phase started, claimed by the lead. */
function startOwnWork(w: ReturnType<typeof world>, slug: string): void {
  ok(
    ensurePlanTask(w.db, { project: PROJECT, plan: slug, subject: `Plan ${slug}` }, LEAD, w.tick()),
  );
  const phase = ok(
    writeWork(w.db, () =>
      layPhase(
        w.db,
        { project: PROJECT, plan: slug, phase: "A", subject: "Build it" },
        LEAD,
        w.tick(),
      ),
    ),
  ).task;
  ok(
    createTask(
      w.db,
      { project: PROJECT, plan: slug, subject: "Step", parentId: phase.id },
      LEAD,
      w.tick(),
    ),
  );
  ok(updateTask(w.db, phase.id, { status: "in_progress" }, LEAD, w.tick()));
}

test("with claimed work and no plan reserved, the rows are unchanged: queued plans stay on the Plan row", () => {
  const w = world();
  startOwnWork(w, "work");
  w.plan("queued-a");
  w.plan("queued-b");
  expect(taskSegment(w.paths, PROJECT, LEAD, NO_ONE)).toBe(
    "Plan · Plan work · 2 queued\nPhases 0/1 · Build it\nTasks 0/1",
  );
});

test("lead + children: the Plans row sits below the lead's own rows, and the own plan is not counted", () => {
  const w = world();
  // The lead reserves its own plan, then starts it; a child builds another.
  w.plan("mine");
  w.handOut("mine", LEAD, false, "self");
  startOwnWork(w, "mine");
  w.plan("theirs");
  w.handOut("theirs", child(1));
  w.plan("later");
  expect(taskSegment(w.paths, PROJECT, LEAD, machine([6001], []))).toBe(
    "Plan · mine · 1 queued\nPhases 0/1 · Build it\nTasks 0/1\nPlans · 1 with child · 1 ready",
  );
});

test("lead + children, with nothing else counted: no Plans row at all", () => {
  const w = world();
  w.plan("mine");
  w.handOut("mine", LEAD, false, "self");
  startOwnWork(w, "mine");
  expect(taskSegment(w.paths, PROJECT, LEAD, NO_ONE)).toBe(
    "Plan · mine\nPhases 0/1 · Build it\nTasks 0/1",
  );
});

test("a child that runs costs no session record: only a child proved gone is asked about its session", () => {
  const w = world();
  w.plan("a");
  w.handOut("a", child(1));
  const asked: string[] = [];
  const spying: ClaimProcess = {
    live: () => true,
    gone: () => {
      asked.push("gone");
      return false;
    },
    ended: () => {
      asked.push("ended");
      return false;
    },
  };
  expect(taskSegment(w.paths, PROJECT, LEAD, spying)).toBe("Plans · 1 with child");
  expect(asked).toEqual([]);
});

test("the row runs no git, gh or hc: every process spawn is recorded and refused, and stalled fakes on PATH stay unread", () => {
  const w = world();
  w.plan("a");
  w.plan("b");
  w.handOut("a", child(1));
  const bin = tempDir();
  const log = join(bin, "calls.log");
  for (const name of ["git", "gh", "hc"]) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\necho ${name} >> "${log}"\nsleep 30\n`);
    chmodSync(file, 0o755);
  }
  const spawned: unknown[] = [];
  const { spawn, spawnSync } = Bun;
  const before = process.env.PATH;
  process.env.PATH = `${bin}:${before ?? ""}`;
  const refuse = (command: unknown): never => {
    spawned.push(command);
    throw new Error("the status line must spawn nothing");
  };
  Object.assign(Bun, { spawn: refuse, spawnSync: refuse });
  let text: string | null;
  try {
    text = taskSegment(w.paths, PROJECT, LEAD, machine([6001], []));
  } finally {
    Object.assign(Bun, { spawn, spawnSync });
    if (before === undefined) delete process.env.PATH;
    else process.env.PATH = before;
  }
  expect(text).toBe("Plans · 1 with child · 1 ready");
  expect(spawned).toEqual([]);
  expect(existsSync(log)).toBe(false);
});
