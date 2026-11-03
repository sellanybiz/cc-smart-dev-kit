import { describe, expect, test } from "bun:test";
import { FULL, PHASE, task } from "@/components/tasks-fixtures";
import {
  countTasks,
  DEFAULT_FILTER,
  filterTasks,
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
