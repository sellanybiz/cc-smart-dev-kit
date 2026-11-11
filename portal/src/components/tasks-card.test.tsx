import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkTaskNode } from "@/api/types";
import { TaskList } from "@/components/task-tree";
import { TasksBody } from "@/components/tasks-card";
import { FULL, LEDGER, PHASE, task, words } from "@/components/tasks-fixtures";
import { DEFAULT_FILTER, filterTasks, SHOW_ALL } from "@/lib/tasks";

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

  test("the steps take the place of the subtree's count on a phase row, never both", () => {
    const html = phaseRow({ closed: 2, steps: { done: 1, total: 3 }, total: 5 });
    expect(words(html)).toContain("1 of 3 steps done");
    expect(words(html)).not.toContain("2 of 5 closed");
    // A phase the store could not count keeps the subtree's count and draws no ledger.
    const uncounted = phaseRow({ closed: 2, steps: null, total: 5 });
    expect(words(uncounted)).toContain("2 of 5 closed");
    expect(uncounted).not.toContain("<dl");
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

describe("one project's tasks", () => {
  test("open only (the default): the tree by layer, each status in words, the files by kind", () => {
    const html = renderToStaticMarkup(<TasksBody data={FULL} />);
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("Work on this machine");
    // Every open task counts, at every depth; closed ones are hidden by default.
    expect(text).toContain("6 open · 1 blocked · 2 non-blocking · closed ones hidden");
    // Plan › Phase › Task (legacy nested fixtures), and the done parent kept as the place of its open subtask.
    expect(layers(html)).toEqual(["plan", "phase", "task", "task", "task", "task", "task"]);
    expect(text).toContain("in progress: plan");
    expect(text).toContain("phase K");
    expect(text).toContain("Task, in progress: Prove two writers");
    expect(text).toContain("Task, pending: Time the lock");
    expect(text).not.toContain("Write the schema ");
    expect(text).not.toContain("Migrate the old rows");
    expect(text).toContain("2 of 6 closed");
    expect(text).toContain("2 more not shown: cc-smart-dev-kit task list --scope all");
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

  test("a non-blocking task is marked, blocking says nothing, and work left open says so", () => {
    const html = renderToStaticMarkup(<TasksBody data={FULL} />);
    const text = words(html);
    // Two non-blocking rows each carry the mark; the blocking default is never written out.
    expect(html.match(/>non-blocking<\/span>/g)?.length).toBe(2);
    expect(text).not.toMatch(/ blocking /);
    // The open subtask under the done task was left open when its parent closed.
    expect(text).toContain("Say it in the changelog non-blocking · left open");
    expect(text.match(/left open/g)?.length).toBe(1);
  });

  test("a blocked task names each task it waits for, with that task's state, closed ones too", () => {
    const text = words(renderToStaticMarkup(<TasksBody data={FULL} />));
    expect(text).toContain(
      "Write the docs page ! blocked by #3 ✓ (done: Write the schema) #5 ◐ (in progress: Prove two writers)",
    );
    expect(text.match(/blocked by/g)?.length).toBe(1);
  });

  test("recent shows the closed tasks too, and says how long they stay", () => {
    const text = words(renderToStaticMarkup(<TasksBody data={FULL} filter={SHOW_ALL} />));
    expect(text).toContain("closed ones stay 7 days");
    expect(text).toContain("done: Write the schema");
    expect(text).toContain("dropped: Migrate the old rows");
  });

  test("blocked only: the blocked task with the tasks above it as its place", () => {
    const html = renderToStaticMarkup(
      <TasksBody data={FULL} filter={{ ...DEFAULT_FILTER, blocked: true }} />,
    );
    expect(layers(html)).toEqual(["plan", "phase", "task"]);
    expect(words(html)).toContain("Write the docs page");
    // Its blocker is named on its row, but is no row of its own: it is not blocked.
    expect(words(html)).not.toContain("Task, in progress: Prove two writers");
  });

  test("non-blocking only: the two noted tasks, and nothing that matches says so", () => {
    const html = renderToStaticMarkup(
      <TasksBody data={FULL} filter={{ ...DEFAULT_FILTER, nonBlocking: true }} />,
    );
    expect(layers(html)).toEqual(["plan", "phase", "task", "task", "task", "task"]);
    const none = words(
      renderToStaticMarkup(
        <TasksBody
          data={FULL}
          filter={{ ...DEFAULT_FILTER, blocked: true, nonBlocking: true }}
          onFilter={() => {}}
        />,
      ),
    );
    expect(none).toContain("Nothing matches the filters");
    expect(none).toContain("No blocked, non-blocking task here.");
    expect(none).toContain("Clear the filters");
  });

  test("each empty and unreadable state says what it is and what makes it change", () => {
    const none = words(
      renderToStaticMarkup(
        <TasksBody
          data={{
            files: {
              broken: 0,
              closed: 0,
              dir: ".claude/tasks",
              staleDays: 30,
              state: "ready",
              tasks: [],
            },
            work: { state: "none" },
          }}
        />,
      ),
    );
    expect(none).toContain("No work tasks here yet");
    expect(none).toContain("task_create");
    expect(none).toContain("cc-smart-dev-kit task add");
    expect(none).toContain("Nothing owed");
    const quiet = words(
      renderToStaticMarkup(
        <TasksBody
          data={{
            files: { state: "unavailable", why: "the project file is broken" },
            work: { more: 0, recentDays: 7, sessions: [], sessionsWhy: null, state: "ready", tasks: [] },
          }}
        />,
      ),
    );
    expect(quiet).toContain("Nothing open");
    expect(quiet).toContain("none closed in the last 7 days");
    expect(quiet).toContain("The task files cannot be read");
    expect(quiet).toContain("the project file is broken");
    const allClosed = words(
      renderToStaticMarkup(
        <TasksBody
          data={{
            ...FULL,
            work: { more: 0, recentDays: 7, sessions: [], sessionsWhy: null, state: "ready", tasks: [PHASE.children[0] ?? PHASE] },
          }}
          onFilter={() => {}}
        />,
      ),
    );
    expect(allClosed).toContain("Every task here is closed");
    expect(allClosed).toContain("Show recent");
    const broken = words(
      renderToStaticMarkup(
        <TasksBody
          data={{
            files: { state: "unavailable", why: "no git" },
            work: { state: "unreadable", why: "file is not a database" },
          }}
        />,
      ),
    );
    expect(broken).toContain("The task list cannot be read");
    expect(broken).toContain("file is not a database. cc-smart-dev-kit doctor checks the store.");
  });
});
