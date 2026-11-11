import { describe, expect, test } from "bun:test";
import type { TaskSession, TasksProjectData, WorkTaskNode } from "@/api/types";
import { task } from "@/components/tasks-fixtures";
import {
  claimCount,
  filterGroups,
  findTask,
  foldedByDefault,
  foldKey,
  isOpen,
  pageRows,
  plansOf,
  type SessionGroup,
  sessionGroupsOf,
  sessionLabel,
  sessionsOf,
  taskOpen,
} from "@/lib/task-groups";
import { DEFAULT_FILTER, NO_PLAN, NO_SESSION, SHOW_ALL, type ShownTask } from "@/lib/tasks";

const LIVE: TaskSession = { id: "s-live-1234", live: true, name: "builder" };
const OLD: TaskSession = { id: "s-old-98765432", live: false, name: null };

/** A plan of the running session: a done phase, and a phase at work with two claims. */
const PLAN = task(
  1,
  "Web clean-up",
  "in_progress",
  [
    task(2, "A. Done phase", "done", [task(3, "Old work", "done"), task(4, "Dropped", "dropped")], {
      kind: "phase",
      layer: "phase",
      phase: "A",
      plan: "web",
      session: LIVE.id,
    }),
    task(
      5,
      "B. At work",
      "in_progress",
      [
        task(6, "Build it", "in_progress", [], { claim: "live", session: LIVE.id, plan: "web" }),
        task(7, "Left by a crash", "in_progress", [], {
          claim: "dead",
          session: LIVE.id,
          plan: "web",
        }),
        task(8, "Later", "pending", [], { session: LIVE.id, plan: "web" }),
      ],
      { kind: "phase", layer: "phase", phase: "B", plan: "web", session: LIVE.id },
    ),
  ],
  {
    kind: "plan",
    layer: "plan",
    plan: "web",
    session: LIVE.id,
    updatedAt: "2026-11-03T09:00:00.000Z",
  },
);
const LOOSE = task(9, "A loose task", "pending", [], {
  session: LIVE.id,
  updatedAt: "2026-11-03T08:00:00.000Z",
});
const OLD_TASK = task(10, "Older session's task", "pending", [], {
  session: OLD.id,
  updatedAt: "2026-11-03T11:00:00.000Z",
});
const STRANGER = task(11, "A session the list does not name", "pending", [], {
  session: "s-stranger",
  updatedAt: "2026-11-03T10:00:00.000Z",
});
const NOBODY = task(12, "Made before sessions were recorded", "pending");

const ROOTS = [NOBODY, OLD_TASK, PLAN, LOOSE, STRANGER];

function ids(groups: readonly ({ id: string } | { group: { id: string } })[]): string[] {
  return groups.map((one) => ("group" in one ? one.group.id : one.id));
}

/** The refs a shown tree holds, depth first. */
function refs(shown: readonly ShownTask[]): string[] {
  return shown.flatMap((one) => [one.task.ref, ...refs(one.children)]);
}

describe("the sessions", () => {
  test("running sessions first, then the newest change; work with no session last", () => {
    const groups = sessionGroupsOf(ROOTS, [LIVE, OLD]);
    expect(ids(groups)).toEqual([LIVE.id, OLD.id, "s-stranger", NO_SESSION]);
    // Each group keeps the server's order of its roots.
    expect(groups[0]?.roots.map((root) => root.ref)).toEqual(["#1", "#9"]);
    // A session the list does not name is still a group, not running, with no name.
    expect(groups[2]?.session).toEqual({ id: "s-stranger", live: false, name: null });
    expect(groups[3]?.session).toBe(null);
  });

  test("a session's name, else its short id; none recorded says so", () => {
    const [live, old, , none] = sessionGroupsOf(ROOTS, [LIVE, OLD]) as SessionGroup[];
    expect(live && sessionLabel(live)).toBe("builder");
    expect(old && sessionLabel(old)).toBe("session s-old-98");
    expect(none && sessionLabel(none)).toBe("No session recorded");
  });

  test("the session, running and plan filters pick whole groups and roots", () => {
    const groups = sessionGroupsOf(ROOTS, [LIVE, OLD]);
    expect(ids(filterGroups(groups, { ...DEFAULT_FILTER, session: OLD.id }))).toEqual([OLD.id]);
    expect(ids(filterGroups(groups, { ...DEFAULT_FILTER, session: NO_SESSION }))).toEqual([
      NO_SESSION,
    ]);
    expect(ids(filterGroups(groups, { ...DEFAULT_FILTER, live: true }))).toEqual([LIVE.id]);
    const web = filterGroups(groups, { ...DEFAULT_FILTER, plan: "web" });
    expect(ids(web)).toEqual([LIVE.id]);
    expect(web[0]?.shown.map((one) => one.task.ref)).toEqual(["#1"]);
    const loose = filterGroups(groups, { ...DEFAULT_FILTER, plan: NO_PLAN });
    expect(loose.flatMap((one) => one.shown.map((shown) => shown.task.ref))).toEqual([
      "#9",
      "#10",
      "#11",
      "#12",
    ]);
    // A group with nothing the row filter keeps is left out.
    expect(ids(filterGroups(groups, { ...DEFAULT_FILTER, status: "closed" }))).toEqual([LIVE.id]);
  });

  test("the sessions of several projects, each once: running wins, a name fills a gap", () => {
    const project = (sessions: TaskSession[]): TasksProjectData => ({
      project: {
        current: false,
        id: "p",
        lastUsed: null,
        name: "p",
        path: "/home/user/p",
        setUp: true,
        source: "sessions",
        uncommitted: false,
        worktrees: 0,
      },
      tasks: {
        files: { state: "unavailable", why: "x" },
        work: { more: 0, recentDays: 7, sessions, sessionsWhy: null, state: "ready", tasks: [] },
      },
    });
    expect(
      sessionsOf([
        project([OLD, { id: "s-a", live: false, name: null }]),
        project([{ id: "s-a", live: true, name: "named" }]),
      ]),
    ).toEqual([{ id: "s-a", live: true, name: "named" }, OLD]);
  });
});

describe("the plans the filter offers", () => {
  test("each plan once, named by its plan task; a loose task's plan by its slug", () => {
    const loosePlan = task(20, "Stray", "pending", [], { plan: "other" });
    const data: TasksProjectData = {
      project: {
        current: false,
        id: "p",
        lastUsed: null,
        name: "p",
        path: "/home/user/p",
        setUp: true,
        source: "sessions",
        uncommitted: false,
        worktrees: 0,
      },
      tasks: {
        files: { state: "unavailable", why: "x" },
        work: {
          more: 0,
          recentDays: 7,
          sessions: [],
          sessionsWhy: null,
          state: "ready",
          tasks: [loosePlan, PLAN, task(21, "Web stray", "pending", [], { plan: "web" })],
        },
      },
    };
    expect(plansOf([data])).toEqual([
      { slug: "other", subject: "other" },
      { slug: "web", subject: "Web clean-up" },
    ]);
  });
});

describe("folding", () => {
  test("a done or dropped plan or phase starts folded; a task and open work start open", () => {
    expect(foldedByDefault(PLAN)).toBe(false);
    expect(foldedByDefault(PLAN.children[0] as WorkTaskNode)).toBe(true);
    expect(foldedByDefault(task(1, "Done plan", "dropped", [], { kind: "plan" }))).toBe(true);
    expect(foldedByDefault(task(1, "Done task", "done"))).toBe(false);
  });

  test("a person's choice beats the default, both ways", () => {
    const done = PLAN.children[0] as WorkTaskNode;
    expect(taskOpen({}, done)).toBe(false);
    expect(taskOpen({ [foldKey.task(done.id)]: false }, done)).toBe(true);
    expect(taskOpen({ [foldKey.task(PLAN.id)]: true }, PLAN)).toBe(false);
    expect(isOpen({}, foldKey.session("p", "s"))).toBe(true);
    expect(foldKey.session("p", "s")).toBe("s:p:s");
  });
});

describe("a page of rows", () => {
  const groups = filterGroups(sessionGroupsOf(ROOTS, [LIVE, OLD]), SHOW_ALL);
  const allOpen = () => true;

  test("the rows count across the groups in order, and the rest is counted as hidden", () => {
    // 8 rows in the plan, 1 loose, then 1 in each other group: 12 in all.
    const page = pageRows(groups, 5, allOpen, allOpen);
    expect(page.hidden).toBe(7);
    expect(page.groups.map((one) => refs(one.shown))).toEqual([["#1", "#2", "#3", "#4", "#5"]]);
    const whole = pageRows(groups, Number.POSITIVE_INFINITY, allOpen, allOpen);
    expect(whole.hidden).toBe(0);
    expect(whole.groups.flatMap((one) => refs(one.shown))).toHaveLength(12);
  });

  test("a folded level counts its own row; a folded group counts none and stays a heading", () => {
    const foldPlan = (node: WorkTaskNode) => node.id !== PLAN.id;
    const page = pageRows(groups, 3, allOpen, foldPlan);
    // The plan is one row, then the loose task and the old session's task: three.
    expect(page.groups.map((one) => one.shown.map((shown) => shown.task.ref))).toEqual([
      ["#1", "#9"],
      ["#10"],
    ]);
    expect(page.hidden).toBe(2);
    const foldLive = (group: SessionGroup) => group.id !== LIVE.id;
    const folded = pageRows(groups, 2, foldLive, allOpen);
    expect(folded.groups.map((one) => one.group.id)).toEqual([LIVE.id, OLD.id, "s-stranger"]);
    expect(folded.hidden).toBe(1);
  });
});

describe("what a row says of its subtree", () => {
  test("the claims in a subtree, running and ended", () => {
    expect(claimCount(PLAN, "live")).toBe(1);
    expect(claimCount(PLAN, "dead")).toBe(1);
    expect(claimCount(LOOSE, "live")).toBe(0);
  });

  test("a task found by its id in any project, with its project; none is null", () => {
    const data = {
      project: { id: "p" },
      tasks: {
        work: {
          more: 0,
          recentDays: 7,
          sessions: [],
          sessionsWhy: null,
          state: "ready",
          tasks: ROOTS,
        },
      },
    } as unknown as TasksProjectData;
    expect(findTask([data], "w7")?.node.subject).toBe("Left by a crash");
    expect(findTask([data], "w7")?.project).toBe(data);
    expect(findTask([data], "w99")).toBe(null);
  });
});
