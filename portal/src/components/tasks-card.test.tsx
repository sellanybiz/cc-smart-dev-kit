/**
 * The Tasks card and a crew page's phase card, drawn from data alone: every state says what it
 * is in words, and the markup holds no `style` attribute (the portal's policy refuses one).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectTasksData, WorkTaskNode } from "@/api/types";
import { PhaseTasksCard, TasksBody } from "@/components/tasks-card";

/** The words a person reads: the tags gone, the entities React writes turned back. */
function words(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function task(
  ref: number,
  subject: string,
  status: WorkTaskNode["status"],
  children: WorkTaskNode[] = [],
  more: Partial<WorkTaskNode> = {},
): WorkTaskNode {
  return {
    children,
    closed: 0,
    id: `w${ref}`,
    kind: "task",
    phase: null,
    plan: null,
    ref: `#${ref}`,
    status,
    subject,
    total: 0,
    updatedAt: "2026-11-03T10:00:00.000Z",
    ...more,
  };
}

const PHASE = task(
  2,
  "Build the store",
  "in_progress",
  [
    task(3, "Write the schema", "done"),
    task(4, "Migrate the old rows", "dropped"),
    task(5, "Prove two writers", "in_progress"),
  ],
  { closed: 2, kind: "phase", phase: "K", plan: "plan", total: 3 },
);

const FULL: ProjectTasksData = {
  files: {
    broken: 1,
    closed: 4,
    dir: ".claude/tasks",
    staleDays: 30,
    state: "ready",
    tasks: [
      {
        created: "2026-10-30",
        file: ".claude/tasks/T-7k2m4q-live-key.md",
        flags: ["needs-yes", "a-flag-of-its-own"],
        id: "T-7k2m4q",
        kind: "production",
        stale: false,
        title: "Set the live key",
        weight: "blocks-release",
        when: "next-release",
      },
      {
        created: "2026-09-01",
        file: ".claude/tasks/T-z5h8ks-retire.md",
        flags: [],
        id: "T-z5h8ks",
        kind: "follow-up",
        stale: true,
        title: "Retire the old service",
        weight: null,
        when: null,
      },
    ],
  },
  work: {
    more: 2,
    recentDays: 7,
    state: "ready",
    tasks: [
      task(1, "plan", "in_progress", [PHASE], { closed: 2, kind: "plan", plan: "plan", total: 4 }),
    ],
  },
};

describe("the Tasks card", () => {
  test("a full answer: the tree with each status in words, the files by kind with their pills", () => {
    const html = renderToStaticMarkup(<TasksBody data={FULL} />);
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("Work on this machine");
    // Every open task counts, at every depth: the plan, the phase and one subtask.
    expect(text).toContain("3 open · closed ones stay 7 days");
    expect(text).toContain("in progress: plan");
    expect(text).toContain("phase K");
    expect(text).toContain("done: Write the schema");
    expect(text).toContain("dropped: Migrate the old rows");
    expect(text).toContain("2 of 4 closed");
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
  test("its phase with its progress, and the subtasks under it", () => {
    const html = renderToStaticMarkup(
      <PhaseTasksCard tasks={{ more: 0, phase: PHASE, state: "ready" }} />,
    );
    expect(html).not.toContain("style=");
    const text = words(html);
    expect(text).toContain("#2 Build the store");
    expect(text).toContain("2 of 3 closed");
    expect(text).toContain("in progress: Prove two writers");
  });

  test("a session from before the task list, a phase with no subtask yet, and no store", () => {
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
    ).toContain("No subtask yet: its first edit waits until it has one.");
    expect(words(renderToStaticMarkup(<PhaseTasksCard tasks={{ state: "none" }} />))).toContain(
      "The kit's task list has no store on this machine yet.",
    );
  });
});
