/**
 * What the task tests draw from (`tasks-card.test.tsx`, `views/tasks.test.tsx`): a task node
 * with every field written out, one project's full answer, and the words a person reads in the
 * markup. Test data only: no page imports this module.
 */
import type { ProjectTasksData, WorkTaskNode } from "@/api/types";

/** The words a person reads: the tags gone, the entities React writes turned back. */
export function words(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
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

/** A full project: the plan with its phase, a done task with work left open, and files. */
export const FULL: ProjectTasksData = {
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
