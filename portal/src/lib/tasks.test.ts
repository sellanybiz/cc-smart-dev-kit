import { describe, expect, test } from "bun:test";
import { deployFiles, deployTask, FULL, PHASE, task } from "@/components/tasks-fixtures";
import {
  countTasks,
  DEFAULT_FILTER,
  DEFAULT_VIEW,
  deploySectionsOf,
  fileCountsOf,
  filesMatching,
  filterTasks,
  ledgerOf,
  matchCount,
  narrowWords,
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
    expect(taskViewOf(new URLSearchParams())).toEqual(DEFAULT_VIEW);
    const view = {
      status: "blocked",
      nonBlocking: true,
      q: "the store",
      session: "s-1",
      plan: "web-cleanup",
      live: true,
      project: "a1b2c3",
      tab: "work",
      task: "wabcdefghij",
    } as const;
    const query = queryOfView(view, new URLSearchParams("mock=normal"));
    expect(query.toString()).toBe(
      "mock=normal&project=a1b2c3&status=blocked&type=non-blocking&session=s-1&plan=web-cleanup&live=1&q=the+store&task=wabcdefghij",
    );
    expect(taskViewOf(query)).toEqual(view);
    // Back to the defaults: the words go, the address's other words stay.
    expect(queryOfView(DEFAULT_VIEW, query).toString()).toBe("mock=normal");
    expect(queryOfView({ ...DEFAULT_VIEW, tab: "files" }, query).toString()).toBe(
      "mock=normal&tab=files",
    );
  });

  test("an address from before 4.0 opens what it showed then, and its old words go on a change", () => {
    expect(taskViewOf(new URLSearchParams("show=recent")).status).toBe("all");
    expect(taskViewOf(new URLSearchParams("show=recent&blocked=1")).status).toBe("blocked");
    const old = new URLSearchParams("show=recent&blocked=1&project=p1");
    expect(queryOfView(taskViewOf(old), old).toString()).toBe("project=p1&status=blocked");
  });

  test("a word the page does not know reads as the default, and the project link is one id", () => {
    expect(
      taskViewOf(
        new URLSearchParams("status=late&show=all&blocked=yes&type=x&project=%20&tab=x&live=yes"),
      ),
    ).toEqual(DEFAULT_VIEW);
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

  test("each status: in progress, blocked, closed and all, the tasks above kept as places", () => {
    expect(refs(filterTasks(tree, { ...DEFAULT_FILTER, status: "in_progress" }))).toEqual([
      "#1",
      "#2",
      "#5",
    ]);
    const blocked = filterTasks(tree, { ...DEFAULT_FILTER, status: "blocked" });
    expect(refs(blocked)).toEqual(["~#1", "~#2", "#6"]);
    expect(matchCount(blocked)).toBe(1);
    expect(refs(filterTasks(tree, { ...DEFAULT_FILTER, status: "closed" }))).toEqual([
      "~#1",
      "~#2",
      "#3",
      "#4",
      "#8",
    ]);
    expect(matchCount(filterTasks(tree, { ...DEFAULT_FILTER, status: "all" }))).toBe(9);
  });

  test("non-blocking only keeps the tasks above as places; a closed one shows with All", () => {
    const noted = filterTasks(tree, { ...DEFAULT_FILTER, nonBlocking: true });
    expect(refs(noted)).toEqual(["~#1", "~#2", "~#5", "#7", "~#8", "#9"]);
    expect(matchCount(noted)).toBe(2);
    const closed = task(1, "Noted and done", "done", [], { type: "non-blocking" });
    expect(refs(filterTasks([closed], { ...DEFAULT_FILTER, nonBlocking: true }))).toEqual([]);
    expect(
      refs(filterTasks([closed], { ...DEFAULT_FILTER, nonBlocking: true, status: "all" })),
    ).toEqual(["#1"]);
  });

  test("the search finds words in a subject, any case, or a task's number with or without #", () => {
    expect(refs(filterTasks(tree, { ...DEFAULT_FILTER, q: "  TIME the " }))).toEqual([
      "~#1",
      "~#2",
      "~#5",
      "#7",
    ]);
    expect(refs(filterTasks(tree, { ...DEFAULT_FILTER, q: "#6" }))).toEqual(["~#1", "~#2", "#6"]);
    expect(refs(filterTasks(tree, { ...DEFAULT_FILTER, q: "6" }))).toEqual(["~#1", "~#2", "#6"]);
    // A number is matched whole: "1" is not #12.
    expect(
      refs(filterTasks([task(12, "Other", "pending")], { ...DEFAULT_FILTER, q: "1" })),
    ).toEqual([]);
  });

  test("the filter in words", () => {
    expect(narrowWords({ ...DEFAULT_FILTER, status: "blocked", nonBlocking: true, q: " x " })).toBe(
      "blocked, non-blocking, matching “x”",
    );
    expect(narrowWords({ ...DEFAULT_FILTER, status: "all", live: true })).toBe("running-session");
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

describe("the files", () => {
  test("the counts: every open deploy task, and the blocking ones", () => {
    expect(
      fileCountsOf(
        deployFiles([
          deployTask("staging-20261101-100000", "One"),
          deployTask("prod-20261101-100000", "Two", { type: "non-blocking" }),
          deployTask("prod-20261102-100000", "Three", { deploy: "after" }),
        ]),
      ),
    ).toEqual({ open: 3, blocking: 2 });
    expect(fileCountsOf({ state: "unavailable", why: "no git" })).toEqual({
      open: 0,
      blocking: 0,
    });
  });

  test("the sections: the project's environments in order, then any other a task holds", () => {
    const staging = deployTask("staging-20261101-100000", "One");
    const prod = deployTask("prod-20261101-100000", "Two");
    expect(
      deploySectionsOf(["staging", "prod"], [prod]).map((one) => [one.env, one.tasks.length]),
    ).toEqual([
      ["staging", 0],
      ["prod", 1],
    ]);
    expect(
      deploySectionsOf(["prod"], [staging, prod]).map((one) => [one.env, one.tasks.length]),
    ).toEqual([
      ["prod", 1],
      ["staging", 1],
    ]);
  });

  test("the files' search takes a title or an id, any case", () => {
    const files = [
      { id: "T-aaaaaa", title: "Set the live key" },
      { id: "T-bbbbbb", title: "Drop the old table" },
    ];
    expect(filesMatching(files, "LIVE").map((one) => one.id)).toEqual(["T-aaaaaa"]);
    expect(filesMatching(files, "t-bbb").map((one) => one.id)).toEqual(["T-bbbbbb"]);
    expect(filesMatching(files, " ")).toHaveLength(2);
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
