import type { ProjectListRow, ProjectTasksData } from "./types";
import type { ProjectTaskRow, WorkTaskBlocker, WorkTaskNode } from "./wire";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

type NodeExtra = Partial<
  Pick<
    WorkTaskNode,
    | "agent"
    | "base"
    | "blocked"
    | "blockedBy"
    | "branch"
    | "kind"
    | "phase"
    | "plan"
    | "type"
    | "worktree"
  >
>;

/**
 * A node, its subtree counted from its children the way the server counts (done or dropped),
 * and its children's layers worked out the way the store does: a task under a task is a subtask.
 * A phase's steps are counted the way `src/portal/api/phase-steps.ts` counts them: the blocking
 * work reached through blocking work, a dropped step left out.
 */
function node(
  number: number,
  subject: string,
  status: WorkTaskNode["status"],
  updatedAt: number,
  children: WorkTaskNode[] = [],
  extra: NodeExtra = {},
): WorkTaskNode {
  const kind = extra.kind ?? "task";
  const under = (one: WorkTaskNode): WorkTaskNode[] => [one, ...one.children.flatMap(under)];
  const all = children.flatMap(under);
  const blocking = (one: WorkTaskNode): WorkTaskNode[] =>
    one.type === "blocking" ? [one, ...one.children.flatMap(blocking)] : [];
  const steps = children.flatMap(blocking).filter((one) => one.status !== "dropped");
  return {
    agent: extra.agent ?? null,
    base: extra.base ?? null,
    blocked: extra.blocked ?? false,
    blockedBy: extra.blockedBy ?? [],
    branch: extra.branch ?? null,
    children: children.map((child) =>
      kind === "task" && child.kind === "task" ? { ...child, layer: "subtask" } : child,
    ),
    closed: all.filter((one) => one.status === "done" || one.status === "dropped").length,
    id: `w${number.toString(36).padStart(10, "0")}`,
    kind,
    layer: kind,
    phase: extra.phase ?? null,
    plan: extra.plan ?? null,
    ref: `#${number}`,
    status,
    steps:
      kind === "phase"
        ? { done: steps.filter((one) => one.status === "done").length, total: steps.length }
        : null,
    subject,
    total: all.length,
    type: extra.type ?? "blocking",
    updatedAt: iso(updatedAt),
    worktree: extra.worktree ?? null,
  };
}

function blocker(one: WorkTaskNode): WorkTaskBlocker {
  return { ref: one.ref, status: one.status, subject: one.subject };
}

function storePhase(now: number): WorkTaskNode {
  const prove = node(
    7,
    "Prove two writers at once lose no record: ten processes, one store, every write read back",
    "in_progress",
    now - 4 * MINUTE,
    [
      node(12, "Start the ten writers from one script", "done", now - 10 * MINUTE),
      node(13, "Read every record back and compare", "in_progress", now - 4 * MINUTE),
      node(14, "Note how long a write waits for the lock", "pending", now - 9 * MINUTE, [], {
        type: "non-blocking",
      }),
    ],
  );
  return node(
    3,
    "Contracts: the store's record shapes",
    "in_progress",
    now - 4 * MINUTE,
    [
      node(4, "Write the record schema with its version field", "done", now - 40 * MINUTE),
      node(5, "Reject a record written by a newer version", "done", now - 25 * MINUTE),
      node(6, "Migrate the old records in place", "dropped", now - 20 * MINUTE),
      prove,
    ],
    {
      // Every field of the ledger set: the agent building it, on its own branch and worktree.
      agent: "a3f9c2e81b7d4056e",
      base: "4c1d8e9a7b2f3c6d5e4f3a2b1c0d9e8f7a6b5c4d",
      branch: "worktree-agent-a3f9c2e81b7d4056e",
      kind: "phase",
      phase: "K",
      plan: "master-plan",
      worktree: "/home/user/code/my-app/.claude/worktrees/agent-a3f9c2e81b7d4056e",
    },
  );
}

function fullTree(now: number): WorkTaskNode[] {
  const phase = storePhase(now);
  const prove = phase.children.find((one) => one.ref === "#7");
  const schema = phase.children.find((one) => one.ref === "#4");
  const docs = node(
    8,
    "Docs: the store's page",
    "pending",
    now - 50 * MINUTE,
    [
      node(9, "Write the page from the record schema", "pending", now - 50 * MINUTE, [], {
        blocked: true,
        blockedBy: [schema, prove].flatMap((one) => (one === undefined ? [] : [blocker(one)])),
      }),
    ],
    // Some of the ledger: an agent named and its branch, no worktree or base yet.
    {
      agent: "docs-writer",
      branch: "docs/store-page",
      kind: "phase",
      phase: "L",
      plan: "master-plan",
    },
  );
  // None of the ledger: a phase laid out and not started, with no steps yet.
  const release = node(16, "Release: ship the store", "pending", now - 55 * MINUTE, [], {
    kind: "phase",
    phase: "M",
    plan: "master-plan",
  });
  return [
    node(1, "master-plan", "in_progress", now - 4 * MINUTE, [phase, docs, release], {
      kind: "plan",
      plan: "master-plan",
    }),
    node(10, "Answer the person's question about the release date", "in_progress", now - MINUTE),
    node(11, "Look at the flaky upload test", "pending", now - 3 * HOUR, [], {
      type: "non-blocking",
    }),
    node(2, "Rename the old setting", "done", now - 2 * DAY, [
      node(15, "Say the new name in the changelog", "pending", now - 2 * DAY, [], {
        type: "non-blocking",
      }),
    ]),
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

/** Each project's tasks, by project id. */
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
        work: {
          more: 0,
          recentDays: 7,
          state: "ready",
          tasks: [node(1, "Fix the broken link on the home page", "done", now - DAY)],
        },
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
