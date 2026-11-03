/**
 * One project's tasks and a crew page's phase card, drawn from data alone: every state says what
 * it is in words, each row its layer, its type and what blocks it, and the markup holds no
 * `style` attribute (the portal's policy refuses one).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseTasksCard, TasksBody } from "@/components/tasks-card";
import { FULL, PHASE, words } from "@/components/tasks-fixtures";
import { DEFAULT_FILTER, SHOW_ALL } from "@/lib/tasks";

/** The `data-layer` of every row, in the order the tree draws them. */
function layers(html: string): string[] {
  return [...html.matchAll(/data-layer="([a-z]+)"/g)].map((match) => match[1] ?? "");
}

describe("one project's tasks", () => {
  test("open only (the default): the tree by layer, each status in words, the files by kind", () => {
    const html = renderToStaticMarkup(<TasksBody data={FULL} />);
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("Work on this machine");
    // Every open task counts, at every depth; closed ones are hidden by default.
    expect(text).toContain("6 open · 1 blocked · 2 non-blocking · closed ones hidden");
    // Plan › Phase › Task › Subtask, and the done parent kept as the place of its open subtask.
    expect(layers(html)).toEqual(["plan", "phase", "task", "subtask", "task", "task", "subtask"]);
    expect(text).toContain("in progress: plan");
    expect(text).toContain("phase K");
    expect(text).toContain("Task, in progress: Prove two writers");
    expect(text).toContain("Subtask, pending: Time the lock");
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
    expect(layers(html)).toEqual(["plan", "phase", "task", "subtask", "task", "subtask"]);
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
            work: { more: 0, recentDays: 7, state: "ready", tasks: [] },
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
            work: { more: 0, recentDays: 7, state: "ready", tasks: [PHASE.children[0] ?? PHASE] },
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

describe("a crew page's phase card", () => {
  test("its phase with its progress, and every task under it with the same row details", () => {
    const html = renderToStaticMarkup(
      <PhaseTasksCard tasks={{ more: 0, phase: PHASE, state: "ready" }} />,
    );
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("#2 Build the store phase K");
    expect(text).toContain("2 of 5 closed");
    // The whole phase, closed tasks too.
    expect(text).toContain("done: Write the schema");
    expect(text).toContain("Task, in progress: Prove two writers");
    expect(text).toContain("Subtask, pending: Time the lock non-blocking");
    expect(text).toContain("! blocked by #3 ✓ (done: Write the schema) #5 ◐");
  });

  test("a session from before the task list, a phase with no task yet, and no store", () => {
    expect(
      words(
        renderToStaticMarkup(<PhaseTasksCard tasks={{ more: 0, phase: null, state: "ready" }} />),
      ),
    ).toContain("This crew session started before the kit's task list, so it has no phase task.");
    expect(
      words(
        renderToStaticMarkup(
          <PhaseTasksCard
            tasks={{
              more: 0,
              phase: { ...PHASE, children: [], closed: 0, total: 0 },
              state: "ready",
            }}
          />,
        ),
      ),
    ).toContain("No task under it yet: its first edit waits until it has one.");
    expect(words(renderToStaticMarkup(<PhaseTasksCard tasks={{ state: "none" }} />))).toContain(
      "The kit's task list has no store on this machine yet.",
    );
  });
});
