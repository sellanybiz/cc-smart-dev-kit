/**
 * The kit's task list in mock data (D75): each project's Tasks card and a crew page's phase
 * tree. Every name is a placeholder. The projects cover each state the card draws: a full tree
 * with every kind of task file (one stale, one broken file), a project with nothing open, one
 * whose store has nothing yet, and a folder git cannot read.
 */

import type { ProjectListRow, ProjectTasksData } from "./types";
import type { CrewPhaseTasks, ProjectTaskRow, WorkTaskNode } from "./wire";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A node, its subtree counted from its children the way the server counts (done or dropped). */
function node(
  number: number,
  subject: string,
  status: WorkTaskNode["status"],
  updatedAt: number,
  children: WorkTaskNode[] = [],
  extra: Partial<Pick<WorkTaskNode, "kind" | "phase" | "plan">> = {},
): WorkTaskNode {
  const under = (one: WorkTaskNode): WorkTaskNode[] => [one, ...one.children.flatMap(under)];
  const all = children.flatMap(under);
  return {
    children,
    closed: all.filter((one) => one.status === "done" || one.status === "dropped").length,
    id: `w${number.toString(36).padStart(10, "0")}`,
    kind: extra.kind ?? "task",
    phase: extra.phase ?? null,
    plan: extra.plan ?? null,
    ref: `#${number}`,
    status,
    subject,
    total: all.length,
    updatedAt: iso(updatedAt),
  };
}

/** The phase a mock crew session builds: two subtasks done, one in progress, one dropped. */
function storePhase(now: number): WorkTaskNode {
  return node(
    3,
    "Contracts: the store's record shapes",
    "in_progress",
    now - 4 * MINUTE,
    [
      node(4, "Write the record schema with its version field", "done", now - 40 * MINUTE),
      node(5, "Reject a record written by a newer version", "done", now - 25 * MINUTE),
      node(6, "Migrate the old records in place", "dropped", now - 20 * MINUTE),
      node(
        7,
        "Prove two writers at once lose no record: ten processes, one store, every write read back",
        "in_progress",
        now - 4 * MINUTE,
      ),
    ],
    { kind: "phase", phase: "K", plan: "master-plan" },
  );
}

function fullTree(now: number): WorkTaskNode[] {
  return [
    node(
      1,
      "master-plan",
      "in_progress",
      now - 4 * MINUTE,
      [
        storePhase(now),
        node(
          8,
          "Docs: the store's page",
          "pending",
          now - 50 * MINUTE,
          [node(9, "Wait for the contracts phase", "pending", now - 50 * MINUTE)],
          { kind: "phase", phase: "L", plan: "master-plan" },
        ),
      ],
      { kind: "plan", plan: "master-plan" },
    ),
    node(10, "Answer the person's question about the release date", "in_progress", now - MINUTE),
    node(11, "Look at the flaky upload test", "pending", now - 3 * HOUR),
    node(2, "Rename the old setting", "done", now - 2 * DAY),
  ];
}

function file(
  id: string,
  title: string,
  kind: ProjectTaskRow["kind"],
  created: string,
  more: Partial<Pick<ProjectTaskRow, "flags" | "stale" | "weight" | "when">> = {},
): ProjectTaskRow {
  return {
    created,
    file: `.claude/tasks/${id}-${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)}.md`,
    flags: more.flags ?? [],
    id,
    kind,
    stale: more.stale ?? false,
    title,
    weight: more.weight ?? null,
    when: more.when ?? null,
  };
}

const FULL_FILES: ProjectTaskRow[] = [
  file(
    "T-7k2m4q",
    "Set the payment provider's live key in production",
    "production",
    "2026-10-30",
    {
      flags: ["needs-yes", "spends-money"],
      weight: "blocks-release",
      when: "next-release",
    },
  ),
  file("T-p3x9ab", "Backfill the orders' region column", "database", "2026-10-28", {
    flags: ["twice-safe", "real-people"],
    weight: "after-deploy",
    when: "next-release",
  }),
  file("T-d4r7wz", "Drop the old sessions table once nothing reads it", "database", "2026-10-12", {
    flags: ["destructive", "needs-yes"],
    weight: "owner",
    when: "any",
  }),
  file("T-m6c2qe", "Run the new seed script on your own database", "teammate", "2026-11-01", {
    when: "now",
  }),
  file("T-z5h8ks", "Retire the second image service", "follow-up", "2026-09-20", {
    stale: true,
    when: "any",
  }),
];

/** Each project's Tasks card, by project id. */
export function tasksPagesFor(
  rows: ProjectListRow[],
  now: number,
): Record<string, ProjectTasksData> {
  const pages: Record<string, ProjectTasksData> = {};
  for (const [index, row] of rows.entries()) {
    if (index === 0) {
      pages[row.id] = {
        files: {
          broken: 1,
          closed: 12,
          dir: ".claude/tasks",
          staleDays: 30,
          state: "ready",
          tasks: FULL_FILES,
        },
        work: { more: 0, recentDays: 7, state: "ready", tasks: fullTree(now) },
      };
    } else if (row.worktrees === null) {
      // A folder git cannot read: neither the store's key nor the files can be found.
      const why = "git could not read this folder: it is not in a git checkout";
      pages[row.id] = {
        files: { state: "unavailable", why },
        work: { state: "unreadable", why },
      };
    } else if (row.setUp) {
      pages[row.id] = {
        files: {
          broken: 0,
          closed: 3,
          dir: ".claude/tasks",
          staleDays: 30,
          state: "ready",
          tasks: [],
        },
        work: { more: 0, recentDays: 7, state: "ready", tasks: [] },
      };
    } else {
      pages[row.id] = {
        files: {
          broken: 0,
          closed: 0,
          dir: ".claude/tasks",
          staleDays: 30,
          state: "ready",
          tasks: [],
        },
        work: { state: "none" },
      };
    }
  }
  return pages;
}

/** A crew page's phase tree: the running one builds its phase; a merged one shows it all closed. */
export function phaseTasksFor(now: number, merged: boolean): CrewPhaseTasks {
  const phase = storePhase(now);
  if (!merged) return { more: 0, phase, state: "ready" };
  const close = (one: WorkTaskNode): WorkTaskNode => ({
    ...one,
    children: one.children.map(close),
    closed: one.total,
    status: one.status === "dropped" ? "dropped" : "done",
  });
  return { more: 0, phase: close(phase), state: "ready" };
}
