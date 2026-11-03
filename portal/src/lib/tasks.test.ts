import { describe, expect, test } from "bun:test";
import { FULL, PHASE, task } from "@/components/tasks-fixtures";
import {
  countTasks,
  DEFAULT_FILTER,
  filterTasks,
  ledgerOf,
  matchCount,
  queryOfView,
  type ShownTask,
  tasksHref,
  taskViewOf,
} from "@/lib/tasks";

/** The refs a shown tree holds, depth first, a `~` on each one there only as a place. */
function refs(shown: readonly ShownTask[]): string[] {
  return shown.flatMap((one) => [`${one.match ? "" : "~"}${one.task.ref}`, ...refs(one.children)]);
}

const tree = FULL.work.state === "ready" ? FULL.work.tasks : [];

describe("the Tasks tab's address", () => {
  test("the defaults are an empty address, and every word reads back as written", () => {
    expect(taskViewOf(new URLSearchParams())).toEqual({ ...DEFAULT_FILTER, project: null });
    const view = { show: "recent", blocked: true, nonBlocking: true, project: "a1b2c3" } as const;
    const query = queryOfView(view, new URLSearchParams("mock=normal"));
    expect(query.toString()).toBe(
      "mock=normal&project=a1b2c3&show=recent&blocked=1&type=non-blocking",
    );
    expect(taskViewOf(query)).toEqual(view);
    // Back to the defaults: the words go, the address's other words stay.
    expect(queryOfView({ ...DEFAULT_FILTER, project: null }, query).toString()).toBe("mock=normal");
  });

  test("a word the page does not know reads as the default, and the project link is one id", () => {
    expect(taskViewOf(new URLSearchParams("show=all&blocked=yes&type=x&project=%20"))).toEqual({
      ...DEFAULT_FILTER,
      project: null,
    });
    expect(tasksHref("a b/c")).toBe("/tasks?project=a%20b%2Fc");
  });
});

describe("what a filter shows", () => {
  test("open only hides each closed task, but keeps a done parent as the place of open work", () => {
    expect(refs(filterTasks(tree, DEFAULT_FILTER))).toEqual([
      "#1",
      "#2",
      "#5",
      "#7",
      "#6",
      "~#8",
      "#9",
    ]);
  });

  test("blocked only and non-blocking only keep the tasks above as places", () => {
    const blocked = filterTasks(tree, { ...DEFAULT_FILTER, blocked: true });
    expect(refs(blocked)).toEqual(["~#1", "~#2", "#6"]);
    expect(matchCount(blocked)).toBe(1);
    const noted = filterTasks(tree, { ...DEFAULT_FILTER, nonBlocking: true });
    expect(refs(noted)).toEqual(["~#1", "~#2", "~#5", "#7", "~#8", "#9"]);
    expect(matchCount(noted)).toBe(2);
    // Recent and non-blocking: a closed non-blocking task shows too.
    const closed = task(1, "Noted and done", "done", [], { type: "non-blocking" });
    expect(refs(filterTasks([closed], { ...DEFAULT_FILTER, nonBlocking: true }))).toEqual([]);
    expect(
      refs(filterTasks([closed], { ...DEFAULT_FILTER, nonBlocking: true, show: "recent" })),
    ).toEqual(["#1"]);
  });

  test("the counts take every layer, and only open tasks", () => {
    expect(countTasks(tree)).toEqual({ open: 6, inProgress: 3, blocked: 1, nonBlocking: 2 });
    expect(countTasks([PHASE.children[0] ?? PHASE])).toEqual({
      open: 0,
      inProgress: 0,
      blocked: 0,
      nonBlocking: 0,
    });
  });
});

describe("a phase's ledger (G3)", () => {
  test("all four fields, in their fixed order: the worktree as its folder, the base as a short sha", () => {
    expect(ledgerOf(PHASE)).toEqual([
      {
        full: "builder-a1c485264ab14f591",
        key: "agent",
        label: "agent",
        shown: "builder-a1c485264ab14f591",
      },
      {
        full: "plan/build-the-store",
        key: "branch",
        label: "branch",
        shown: "plan/build-the-store",
      },
      {
        full: "/home/user/my-app/.claude/worktrees/build-the-store",
        key: "worktree",
        label: "worktree",
        shown: "build-the-store",
      },
      {
        full: "21eadc8a0f3b4c5d6e7f8091a2b3c4d5e6f70812",
        key: "base",
        label: "base",
        shown: "21eadc8",
      },
    ]);
  });

  test("some fields: only the ones set, still in order; none: an empty list", () => {
    const some = task(2, "Some", "pending", [], {
      agent: "builder-b2",
      kind: "phase",
      layer: "phase",
      worktree: "C:\\Users\\user\\my-app\\.claude\\worktrees\\ui\\",
    });
    expect(ledgerOf(some).map((field) => [field.key, field.shown])).toEqual([
      ["agent", "builder-b2"],
      // A Windows path, its trailing separator too: the folder's own name.
      ["worktree", "ui"],
    ]);
    expect(ledgerOf(task(3, "None", "pending", [], { kind: "phase", layer: "phase" }))).toEqual([]);
  });

  test("a base that is not a long hex sha is shown as written", () => {
    const tag = task(4, "Tag", "pending", [], { base: "v1.2.0", kind: "phase", layer: "phase" });
    expect(ledgerOf(tag)).toEqual([
      { full: "v1.2.0", key: "base", label: "base", shown: "v1.2.0" },
    ]);
  });
});
