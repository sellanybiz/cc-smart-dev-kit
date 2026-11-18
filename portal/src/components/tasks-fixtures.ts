/**
 * What the task tests draw from (`tasks-card.test.tsx`, `views/tasks.test.tsx`): a task node
 * with every field written out, one project's full answer, and the words a person reads in the
 * markup. Test data only: no page imports this module.
 */
import type { ProjectTaskFiles, ProjectTaskRow, ProjectTasksData, WorkTaskNode } from "@/api/types";

/** The words a person reads: the tags gone, the entities React writes turned back. */
export function words(html: string): string {
  return (
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // Last, so a written `&amp;lt;` stays `&lt;` and is not read twice.
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function task(
  ref: number,
  subject: string,
  status: WorkTaskNode["status"],
  children: WorkTaskNode[] = [],
  more: Partial<WorkTaskNode> = {},
): WorkTaskNode {
  return {
    session: null,
    parentId: null,
    claim: "none",
    notes: 0,
    events: 0,
    agent: null,
    base: null,
    blocked: false,
    blockedBy: [],
    branch: null,
    children,
    closed: 0,
    id: `w${ref}`,
    kind: "task",
    layer: "task",
    phase: null,
    plan: null,
    progress: null,
    ref: `#${ref}`,
    status,
    steps: null,
    subject,
    total: 0,
    type: "blocking",
    updatedAt: "2026-11-03T10:00:00.000Z",
    worktree: null,
    ...more,
  };
}

/** A phase's ledger with all four fields set (G3): what the main session binds a phase to. */
export const LEDGER = {
  agent: "builder-a1c485264ab14f591",
  base: "21eadc8a0f3b4c5d6e7f8091a2b3c4d5e6f70812",
  branch: "plan/build-the-store",
  worktree: "/home/user/my-app/.claude/worktrees/build-the-store",
} as const;

export const PHASE = task(
  2,
  "Build the store",
  "in_progress",
  [
    task(3, "Write the schema", "done"),
    task(4, "Migrate the old rows", "dropped"),
    task(
      5,
      "Prove two writers",
      "in_progress",
      [
        task(7, "Time the lock", "pending", [], {
          layer: "task",
          type: "non-blocking",
        }),
      ],
      { total: 1 },
    ),
    task(6, "Write the docs page", "pending", [], {
      blocked: true,
      blockedBy: [
        { ref: "#3", status: "done", subject: "Write the schema" },
        { ref: "#5", status: "in_progress", subject: "Prove two writers" },
      ],
    }),
  ],
  {
    ...LEDGER,
    closed: 2,
    kind: "phase",
    layer: "phase",
    phase: "K",
    plan: "plan",
    // Blocking and not dropped: #3 (done), #5 and #6. The dropped #4 and the non-blocking #7 are no step.
    steps: { done: 1, total: 3 },
    total: 5,
  },
);

/** One open deploy task, the server's order and shape; `more` sets the rest. */
export function deployTask(
  id: string,
  title: string,
  more: Partial<ProjectTaskRow> = {},
): ProjectTaskRow {
  const env = id.startsWith("prod-") ? "prod" : "staging";
  return {
    created: "2026-10-30T09:15:00Z",
    deploy: "before",
    env,
    file: `.claude/tasks/${env}/${id}-task.md`,
    flags: [],
    id,
    stale: false,
    title,
    twin: null,
    type: "blocking",
    ...more,
  };
}

/** The deploy tasks of a project with nothing left over: no broken, duplicate or old file. */
export function deployFiles(
  tasks: ProjectTaskRow[],
  more: Partial<Extract<ProjectTaskFiles, { state: "ready" }>> = {},
): ProjectTaskFiles {
  return {
    broken: 0,
    closed: 0,
    dir: ".claude/tasks",
    duplicateIds: [],
    envs: ["staging", "prod"],
    old: 0,
    staleDays: 30,
    state: "ready",
    tasks,
    ...more,
  };
}

/** A full project: the plan with its phase, a done task with work left open, and deploy tasks. */
export const FULL: ProjectTasksData = {
  files: deployFiles(
    [
      deployTask("staging-20260901-080000", "Retire the old service", {
        created: "2026-09-01T08:00:00Z",
        deploy: "after",
        file: ".claude/tasks/staging/staging-20260901-080000-retire.md",
        stale: true,
        type: "non-blocking",
      }),
      deployTask("prod-20261030-091500", "Set the live key", {
        flags: ["needs-yes", "a-flag-of-its-own"],
        twin: { id: "staging-20261030-091500", status: "done" },
      }),
    ],
    { broken: 1, closed: 4 },
  ),
  work: {
    more: 2,
    recentDays: 7,
    sessions: [],
    sessionsWhy: null,
    state: "ready",
    tasks: [
      task(1, "plan", "in_progress", [PHASE], {
        closed: 2,
        kind: "plan",
        layer: "plan",
        plan: "plan",
        // The server's count from the whole list: more than the tree holds, old tasks too.
        progress: { closed: 12, total: 20 },
        total: 6,
      }),
      task(
        8,
        "Rename the old setting",
        "done",
        [
          task(9, "Say it in the changelog", "pending", [], {
            layer: "task",
            type: "non-blocking",
          }),
        ],
        { total: 1 },
      ),
    ],
  },
};
