/**
 * One project's tasks on the Tasks tab, drawn from data alone: the work tree by session and
 * layer (`WorkSection`, `TaskList`), a phase's ledger, and the project's task files
 * (`FilesSection`).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectWorkTasks, TaskSession, WorkTaskNode } from "@/api/types";
import { TaskList } from "@/components/task-tree";
import { WorkSection } from "@/components/task-work";
import { FilesSection } from "@/components/tasks-card";
import { FULL, LEDGER, PHASE, task, words } from "@/components/tasks-fixtures";
import { foldKey } from "@/lib/task-groups";
import { DEFAULT_FILTER, filterTasks, SHOW_ALL, type TaskFilter } from "@/lib/tasks";

/** The `data-layer` of every row, in the order the tree draws them. */
function layers(html: string): string[] {
  return [...html.matchAll(/data-layer="([a-z]+)"/g)].map((match) => match[1] ?? "");
}

/** One phase drawn alone, its steps closed so only its own row shows. */
function phaseRow(more: Partial<WorkTaskNode>): string {
  const phase = task(2, "Build the store", "in_progress", [], {
    kind: "phase",
    layer: "phase",
    phase: "K",
    plan: "plan",
    ...more,
  });
  return renderToStaticMarkup(<TaskList tasks={filterTasks([phase], SHOW_ALL)} />);
}

/** The project's work, drawn as the Tasks tab draws it, every level at its default. */
function work(
  data: ProjectWorkTasks = FULL.work,
  filter: TaskFilter = DEFAULT_FILTER,
  folds: Record<string, boolean> = {},
  onFilter?: (filter: TaskFilter) => void,
): string {
  return renderToStaticMarkup(
    <WorkSection
      projectId="p1"
      work={data}
      filter={filter}
      {...(onFilter === undefined ? {} : { onFilter })}
      ui={{ folds, setFolds: () => {}, selected: null, onOpen: () => {} }}
    />,
  );
}

const files = (): string => renderToStaticMarkup(<FilesSection files={FULL.files} />);

/** The words of each term of a ledger, in order: what a screen reader names each value. */
function terms(html: string): string[] {
  return [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((match) => match[1] ?? "");
}

describe("a phase's ledger (G3)", () => {
  test("every field: the agent, branch, worktree folder, short base and steps, each named", () => {
    const html = phaseRow({ ...LEDGER, steps: { done: 3, total: 5 } });
    expect(html).not.toContain("style=");
    expect(terms(html)).toEqual(["steps", "agent", "branch", "worktree", "base"]);
    const text = words(html);
    expect(text).toContain("3 of 5 steps done");
    expect(text).toContain("3/5");
    expect(text).toContain("agent builder-a1c485264ab14f591");
    expect(text).toContain("branch plan/build-the-store");
    // The folder's name in sight, the whole path in its title and for a screen reader.
    expect(text).toContain(
      "worktree build-the-store , at /home/user/my-app/.claude/worktrees/build-the-store",
    );
    expect(html).toContain('title="/home/user/my-app/.claude/worktrees/build-the-store"');
    expect(text).toContain("base 21eadc8");
    expect(html).toContain('title="21eadc8a0f3b4c5d6e7f8091a2b3c4d5e6f70812"');
    expect(html).toContain('aria-label="Ledger of phase K"');
  });

  test("some fields: only those, after the steps; none: the steps alone, no empty label", () => {
    const some = phaseRow({ agent: "builder-b2", branch: "plan/ui", steps: { done: 0, total: 2 } });
    expect(terms(some)).toEqual(["steps", "agent", "branch"]);
    expect(words(some)).toContain("0 of 2 steps done");
    const none = phaseRow({ steps: { done: 0, total: 0 } });
    expect(terms(none)).toEqual(["steps"]);
    expect(words(none)).toContain("no steps yet");
    for (const label of ["agent", "branch", "worktree", "base"]) {
      expect(words(none)).not.toContain(label);
    }
  });

  test("the steps take the place of the count on a phase row, never both", () => {
    // The server's count of the phase's tasks, closed long ago too: the row holds no children.
    const progress = { closed: 7, total: 9 };
    const html = phaseRow({ progress, steps: { done: 1, total: 3 } });
    expect(words(html)).toContain("1 of 3 steps done");
    expect(words(html)).not.toContain("7 of 9 closed");
    // A phase the store could not count shows the server's count of its tasks, and no ledger.
    const uncounted = phaseRow({ progress, steps: null });
    expect(words(uncounted)).toContain("7 of 9 closed");
    expect(uncounted).not.toContain("<dl");
    // No count from the server: no meter, never one made up from the rows in view.
    const none = phaseRow({ children: [task(3, "One", "done")], progress: null, steps: null });
    expect(none).not.toContain("<meter");
  });

  test("a plan and a task draw no ledger, whatever they hold", () => {
    const html = renderToStaticMarkup(
      <TaskList
        tasks={filterTasks(
          [
            task(1, "plan", "in_progress", [task(3, "A task", "pending", [], { ...LEDGER })], {
              ...LEDGER,
              kind: "plan",
              layer: "plan",
              plan: "plan",
            }),
          ],
          SHOW_ALL,
        )}
      />,
    );
    expect(html).not.toContain("<dl");
  });
});

describe("a row", () => {
  test("it opens its task, folds what is under it, and names its claim and notes", () => {
    const html = renderToStaticMarkup(
      <TaskList
        tasks={filterTasks(
          [
            task(1, "Parent", "in_progress", [
              task(2, "Held", "in_progress", [], { claim: "live", notes: 1 }),
              task(3, "Left behind", "in_progress", [], { claim: "dead", notes: 3 }),
            ]),
          ],
          DEFAULT_FILTER,
        )}
      />,
    );
    expect(html).not.toContain("style=");
    // Each row is a button that opens its panel; a row with rows under it has a fold button.
    expect(html.match(/aria-haspopup="dialog"/g)?.length).toBe(3);
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-label="Fold #1 Parent"/);
    const text = words(html);
    expect(text).toContain("Held ● running 1 note");
    expect(text).toContain("Left behind ! claim ended 3 notes");
  });
});

describe("one project's work", () => {
  test("open only (the default): one session group, the tree by layer, each status in words", () => {
    const html = work();
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("Work on this machine");
    // Every open task counts, at every depth; closed ones are hidden by default.
    expect(text).toContain("6 open · 1 blocked · 2 non-blocking · closed ones hidden");
    // No session recorded for the fixture's tasks: one group, named as such.
    expect(text).toContain("Session: No session recorded 1 plan · 6 open · 1 blocked");
    // Plan › Phase › Task, and the done parent kept as the place of its open task.
    expect(layers(html)).toEqual(["plan", "phase", "task", "task", "task", "task", "task"]);
    expect(text).toContain("in progress: plan");
    expect(text).toContain("phase K");
    expect(text).toContain("Task, in progress: Prove two writers");
    expect(text).toContain("Task, pending: Time the lock");
    expect(text).not.toContain("Write the schema ");
    expect(text).not.toContain("Migrate the old rows");
    // The plan's progress is the server's count from the whole list, not the rows in view.
    expect(text).toContain("12 of 20 closed");
    expect(text).not.toContain("2 of 5 closed");
    expect(text).toContain("2 more not sent by the server: cc-smart-dev-kit task list --scope all");
  });

  test("the sessions: running first, each named, with what it holds", () => {
    const sessions: TaskSession[] = [
      { id: "s-live", live: true, name: "builder" },
      { id: "s-gone-12345678", live: false, name: null },
    ];
    const html = work({
      more: 0,
      recentDays: 7,
      sessions,
      sessionsWhy: null,
      state: "ready",
      tasks: [
        task(1, "Old loose task", "pending", [], { session: "s-gone-12345678" }),
        task(2, "Live loose task", "in_progress", [], { session: "s-live", claim: "live" }),
      ],
    });
    const text = words(html);
    expect([...html.matchAll(/data-session="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "s-live",
      "s-gone-12345678",
    ]);
    expect(text).toContain("Session: builder ● running now 1 open");
    expect(text).toContain("Session: session s-gone-1 ○ not running 1 open");
  });

  test("a folded session or plan keeps its heading and draws nothing under it", () => {
    const plan = FULL.work.state === "ready" ? FULL.work.tasks[0] : undefined;
    const foldedPlan = work(FULL.work, DEFAULT_FILTER, { [foldKey.task(plan?.id ?? "")]: true });
    expect(layers(foldedPlan)).toEqual(["plan", "task", "task"]);
    expect(foldedPlan).toMatch(/aria-expanded="false"[^>]*aria-label="Unfold #1 plan"/);
    const foldedSession = work(FULL.work, DEFAULT_FILTER, {
      [foldKey.session("p1", "none")]: true,
    });
    expect(layers(foldedSession)).toEqual([]);
    expect(words(foldedSession)).toContain("Session: No session recorded");
    // A search opens every level that holds a match, whatever was folded.
    const searched = work(
      FULL.work,
      { ...DEFAULT_FILTER, q: "lock" },
      { [foldKey.session("p1", "none")]: true },
    );
    expect(layers(searched)).toEqual(["plan", "phase", "task", "task"]);
  });

  test("a done plan starts folded", () => {
    const html = work(
      {
        more: 0,
        recentDays: 7,
        sessions: [],
        sessionsWhy: null,
        state: "ready",
        tasks: [
          task(1, "Shipped", "done", [task(2, "Its task", "done")], {
            kind: "plan",
            layer: "plan",
          }),
        ],
      },
      SHOW_ALL,
    );
    expect(layers(html)).toEqual(["plan"]);
  });

  test("a long list shows a page of rows and says how many wait", () => {
    const many = Array.from({ length: 75 }, (_, index) =>
      task(index + 1, `Task ${index + 1}`, "pending"),
    );
    const html = work({
      more: 0,
      recentDays: 7,
      sessions: [],
      sessionsWhy: null,
      state: "ready",
      tasks: many,
    });
    expect(layers(html)).toHaveLength(60);
    const text = words(html);
    expect(text).toContain("15 more rows hidden");
    expect(text).toContain("Show 15 more");
    expect(text).toContain("Show all");
  });

  test("a non-blocking task is marked, blocking says nothing, and work left open says so", () => {
    const html = work();
    const text = words(html);
    expect(html.match(/>non-blocking<\/span>/g)?.length).toBe(2);
    expect(text).not.toMatch(/ blocking /);
    expect(text).toContain("Say it in the changelog non-blocking · left open");
    expect(text.match(/left open/g)?.length).toBe(1);
  });

  test("a blocked task names each task it waits for, with that task's state, closed ones too", () => {
    const text = words(work());
    expect(text).toContain(
      "Write the docs page ! blocked by #3 ✓ (done: Write the schema) #5 ◐ (in progress: Prove two writers)",
    );
    expect(text.match(/blocked by/g)?.length).toBe(1);
  });

  test("All shows the closed tasks too, and says how long they stay", () => {
    const text = words(work(FULL.work, SHOW_ALL));
    expect(text).toContain("closed ones stay 7 days");
    expect(text).toContain("done: Write the schema");
    expect(text).toContain("dropped: Migrate the old rows");
  });

  test("blocked: the blocked task with the tasks above it as its place", () => {
    const html = work(FULL.work, { ...DEFAULT_FILTER, status: "blocked" });
    expect(layers(html)).toEqual(["plan", "phase", "task"]);
    expect(words(html)).toContain("Write the docs page");
    expect(words(html)).not.toContain("Task, in progress: Prove two writers");
  });

  test("nothing that matches says so, and offers to clear the filters", () => {
    const none = words(
      work(FULL.work, { ...DEFAULT_FILTER, status: "blocked", nonBlocking: true }, {}, () => {}),
    );
    expect(none).toContain("Nothing matches the filters");
    expect(none).toContain("No blocked, non-blocking task here.");
    expect(none).toContain("Clear the filters");
  });

  test("each empty and unreadable state says what it is and what makes it change", () => {
    const none = words(work({ state: "none" }));
    expect(none).toContain("No work tasks here yet");
    expect(none).toContain("task_create");
    expect(none).toContain("cc-smart-dev-kit task add");
    const quiet = words(
      work({ more: 0, recentDays: 7, sessions: [], sessionsWhy: null, state: "ready", tasks: [] }),
    );
    expect(quiet).toContain("Nothing open");
    expect(quiet).toContain("none closed in the last 7 days");
    const allClosed = words(
      work(
        {
          more: 0,
          recentDays: 7,
          sessions: [],
          sessionsWhy: null,
          state: "ready",
          tasks: [PHASE.children[0] ?? PHASE],
        },
        DEFAULT_FILTER,
        {},
        () => {},
      ),
    );
    expect(allClosed).toContain("Every task here is closed");
    expect(allClosed).toContain("Show all");
    const broken = words(work({ state: "unreadable", why: "file is not a database" }));
    expect(broken).toContain("The task list cannot be read");
    expect(broken).toContain("file is not a database. cc-smart-dev-kit doctor checks the store.");
    const unknownSessions = words(
      work({
        more: 0,
        recentDays: 7,
        sessions: [],
        sessionsWhy: "the record of running session 42 cannot be read; retry",
        state: "ready",
        tasks: [],
      }),
    );
    expect(unknownSessions).toContain(
      "Which sessions run now is unknown: the record of running session 42 cannot be read; retry",
    );
  });
});

describe("one project's task files", () => {
  test("by kind, what blocks a release first, each flag in words", () => {
    const html = files();
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("2 open in .claude/tasks · 4 closed");
    expect(text).toContain("1 file does not read as a task");
    expect(text).toContain("Production · 1");
    expect(text).toContain("Follow-ups · 1");
    expect(text).not.toContain("Database ·");
    expect(text).toContain("blocks the release");
    expect(text).toContain("next release");
    expect(text).toContain("needs a yes");
    // A flag the page has no words for is shown as written, never dropped.
    expect(text).toContain("a-flag-of-its-own");
    expect(text).toContain("open over 30 days");
    expect(text).toContain(".claude/tasks/T-z5h8ks-retire.md · written 2026-09-01");
  });

  test("the search keeps the files it finds, and says when it finds none", () => {
    const found = words(renderToStaticMarkup(<FilesSection files={FULL.files} q="retire" />));
    expect(found).toContain("Retire the old service");
    expect(found).not.toContain("Set the live key");
    const none = words(renderToStaticMarkup(<FilesSection files={FULL.files} q="nothing" />));
    expect(none).toContain("Nothing matches the search");
    expect(none).toContain("No open task file here holds “nothing” in its title or id.");
  });

  test("nothing owed, and files that cannot be read, each say so", () => {
    const none = words(
      renderToStaticMarkup(
        <FilesSection
          files={{
            broken: 0,
            closed: 0,
            dir: ".claude/tasks",
            staleDays: 30,
            state: "ready",
            tasks: [],
          }}
        />,
      ),
    );
    expect(none).toContain("Nothing owed");
    const broken = words(
      renderToStaticMarkup(
        <FilesSection files={{ state: "unavailable", why: "the project file is broken" }} />,
      ),
    );
    expect(broken).toContain("The task files cannot be read");
    expect(broken).toContain("the project file is broken");
  });
});
