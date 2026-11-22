import type { ProjectListRow, ProjectTasksData } from "./types";
import type {
  ProjectTaskRow,
  TaskDetailAnswer,
  TaskSession,
  WorkTaskBlocker,
  WorkTaskNode,
} from "./wire";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

type NodeExtra = { oldClosed?: number } & Partial<
  Pick<
    WorkTaskNode,
    | "agent"
    | "base"
    | "blocked"
    | "blockedBy"
    | "branch"
    | "claim"
    | "kind"
    | "notes"
    | "phase"
    | "plan"
    | "session"
    | "type"
    | "worktree"
  >
>;

/**
 * A node, its subtree counted from its children the way the server counts (done or dropped),
 * and each child's kind remains its layer.
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
  const notes = extra.notes ?? 0;
  // As the server counts from its whole list (`layerProgress`): a plan its phases, or its tasks
  // when it has no phase; a phase its tasks. `oldClosed` adds ones closed long ago, which the
  // server counts and its tree leaves out.
  const phases = all.filter((one) => one.kind === "phase");
  const tasks =
    kind === "plan" && phases.length > 0 ? phases : all.filter((one) => one.kind === "task");
  const old = extra.oldClosed ?? 0;
  return {
    session: extra.session ?? null,
    parentId: null,
    claim: extra.claim ?? "none",
    notes,
    // Its creation, each note, and a change of status once it has left pending.
    events: 1 + notes + (status === "pending" ? 0 : 1),
    agent: extra.agent ?? null,
    base: extra.base ?? null,
    blocked: extra.blocked ?? false,
    blockedBy: extra.blockedBy ?? [],
    branch: extra.branch ?? null,
    children,
    closed: all.filter((one) => one.status === "done" || one.status === "dropped").length,
    id: `w${number.toString(36).padStart(10, "0")}`,
    kind,
    layer: kind,
    phase: extra.phase ?? null,
    plan: extra.plan ?? null,
    progress:
      kind === "task"
        ? null
        : {
            closed:
              old + tasks.filter((one) => one.status === "done" || one.status === "dropped").length,
            total: old + tasks.length,
          },
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
  const roots = [
    ownedBy(
      SESSIONS.release.id,
      node(1, "master-plan", "in_progress", now - 4 * MINUTE, [phase, docs, release], {
        kind: "plan",
        plan: "master-plan",
      }),
    ),
    ownedBy(
      SESSIONS.release.id,
      node(
        10,
        "Answer the person's question about the release date",
        "in_progress",
        now - MINUTE,
        [],
        {
          claim: "live",
          notes: 1,
        },
      ),
    ),
    ownedBy(
      SESSIONS.release.id,
      node(11, "Look at the flaky upload test", "pending", now - 3 * HOUR, [], {
        type: "non-blocking",
      }),
    ),
    ...generatedPlans(now),
    // Made before sessions were recorded: no session to name.
    node(2, "Rename the old setting", "done", now - 2 * DAY, [
      node(15, "Say the new name in the changelog", "pending", now - 2 * DAY, [], {
        type: "non-blocking",
      }),
    ]),
  ];
  return placed(roots, null);
}

/** The sessions of the mock's first project: two running, one ended with a name, one without. */
const SESSIONS = {
  release: { id: "7f3c9a2e-41b8-4d6e-9a0f-2c5b8e1d4a73", live: true, name: "release-plan" },
  docs: { id: "b2e8d4f1-9c3a-4e7b-8d2f-6a1c9e5b3f08", live: true, name: "docs-sweep" },
  night: { id: "4a9d2c7e-5b1f-4c8a-9e3d-7f2a6b0c1d95", live: false, name: "night-build" },
  old: { id: "e1f7b3a9-2d6c-4f0e-8b5a-3c9d1e7f2a46", live: false, name: null },
} satisfies Record<string, TaskSession>;

const MOCK_SESSIONS: TaskSession[] = [
  SESSIONS.release,
  SESSIONS.docs,
  SESSIONS.night,
  SESSIONS.old,
];

/** The node and its subtree, each made by `session` unless it names its own. */
function ownedBy(session: string, one: WorkTaskNode): WorkTaskNode {
  return {
    ...one,
    session: one.session ?? session,
    children: one.children.map((child) => ownedBy(session, child)),
  };
}

/** Each node with its parent's id, as the server sends it. */
function placed(nodes: readonly WorkTaskNode[], parentId: null | string): WorkTaskNode[] {
  return nodes.map((one) => ({ ...one, parentId, children: placed(one.children, one.id) }));
}

const VERBS = [
  "Write",
  "Check",
  "Move",
  "Rename",
  "Test",
  "Remove",
  "Document",
  "Split",
  "Measure",
];
const THINGS = [
  "the login form",
  "the settings page",
  "the upload queue",
  "the search index",
  "the email template",
  "the order table",
  "the cache keys",
  "the error page",
  "the date picker",
  "the session store",
  "the export button",
  "the health check",
  "the rate limit",
];

/** A plan laid out: each phase's status, and how many tasks of its own are done. */
interface PlanShape {
  first: number;
  slug: string;
  title: string;
  session: string;
  /** Each phase: its status and its count of tasks; an in-progress phase's first half is done. */
  phases: { status: WorkTaskNode["status"]; tasks: number }[];
  /** Hours ago it last changed. */
  age: number;
  /** The phase (by index) whose in-progress task a process still claims, and whether it runs. */
  claimed?: { phase: number; claim: WorkTaskNode["claim"] };
  /** Its phases closed long ago: the plan counts them, the tree does not hold them. */
  oldClosed?: number;
}

/** The status of a phase's task `index` of `count`, from its phase's status. */
function taskStatus(phase: WorkTaskNode["status"], index: number, count: number) {
  if (phase === "done") return index === count - 1 ? "dropped" : "done";
  if (phase !== "in_progress") return "pending";
  const half = Math.floor(count / 2);
  return index < half ? "done" : index === half ? "in_progress" : "pending";
}

function plan(shape: PlanShape, now: number): WorkTaskNode {
  let number = shape.first;
  const updated = now - shape.age * HOUR;
  const phases: WorkTaskNode[] = [];
  let lastOpen: null | WorkTaskNode = null;
  for (const [index, phase] of shape.phases.entries()) {
    const phaseNumber = number++;
    const tasks: WorkTaskNode[] = [];
    for (let at = 0; at < phase.tasks; at++) {
      const status = taskStatus(phase.status, at, phase.tasks);
      const n = number++;
      const subject = `${VERBS[n % VERBS.length]} ${THINGS[(n * 7) % THINGS.length]}`;
      // The first task of a pending phase waits for the open task of the phase before it.
      const waits = phase.status === "pending" && at === 0 && lastOpen !== null;
      const claimed =
        shape.claimed?.phase === index && status === "in_progress" ? shape.claimed.claim : "none";
      tasks.push(
        node(n, subject, status, updated - (phase.tasks - at) * MINUTE, [], {
          claim: claimed,
          notes: n % 5 === 0 ? 2 : n % 3 === 0 ? 1 : 0,
          type: n % 11 === 0 ? "non-blocking" : "blocking",
          ...(waits && lastOpen !== null ? { blocked: true, blockedBy: [blocker(lastOpen)] } : {}),
        }),
      );
    }
    const open = tasks.find((one) => one.status === "in_progress");
    if (open !== undefined) lastOpen = open;
    const letter = String.fromCharCode(65 + index);
    phases.push(
      node(
        phaseNumber,
        `${letter}. ${VERBS[index % VERBS.length]} ${THINGS[index % THINGS.length]}`,
        phase.status,
        updated,
        tasks,
        {
          kind: "phase",
          phase: letter,
          plan: shape.slug,
          ...(phase.status === "in_progress"
            ? {
                agent: `builder-${shape.slug}-${letter.toLowerCase()}`,
                branch: `plan/${shape.slug}`,
              }
            : {}),
        },
      ),
    );
  }
  const status = shape.phases.every((one) => one.status === "done")
    ? "done"
    : shape.phases.some((one) => one.status !== "pending")
      ? "in_progress"
      : "pending";
  return ownedBy(
    shape.session,
    node(shape.first - 1, shape.title, status, updated, phases, {
      kind: "plan",
      oldClosed: shape.oldClosed ?? 0,
      plan: shape.slug,
    }),
  );
}

/**
 * The plans that make the first project's list long: several sessions, 200 tasks and more, a
 * done plan (it starts folded), blocked work, and a claim whose process has ended.
 */
function generatedPlans(now: number): WorkTaskNode[] {
  const loose = [
    node(96, "Check the docs' links once the sweep is done", "pending", now - 30 * MINUTE),
    node(97, "Ask about the screenshots in the guide", "in_progress", now - 20 * MINUTE, [], {
      claim: "live",
    }),
    node(98, "Note the pages with old wording", "pending", now - 50 * MINUTE, [], {
      type: "non-blocking",
    }),
  ].map((one) => ownedBy(SESSIONS.docs.id, one));
  return [
    plan(
      {
        first: 101,
        slug: "web-cleanup",
        title: "Web app clean-up: one home for every component",
        session: SESSIONS.docs.id,
        phases: [
          { status: "done", tasks: 10 },
          { status: "done", tasks: 12 },
          { status: "in_progress", tasks: 12 },
          { status: "pending", tasks: 12 },
          { status: "pending", tasks: 10 },
          { status: "pending", tasks: 8 },
          { status: "pending", tasks: 10 },
        ],
        age: 1,
        claimed: { phase: 2, claim: "live" },
      },
      now,
    ),
    ...loose,
    plan(
      {
        first: 201,
        slug: "bug-hunt",
        title: "Bug hunt before the next release",
        session: SESSIONS.night.id,
        phases: [
          { status: "done", tasks: 14 },
          { status: "in_progress", tasks: 14 },
          { status: "pending", tasks: 14 },
          { status: "pending", tasks: 12 },
          { status: "pending", tasks: 12 },
          { status: "pending", tasks: 10 },
          { status: "pending", tasks: 14 },
        ],
        age: 9,
        // The session that worked on it ended: its claim is left behind.
        claimed: { phase: 1, claim: "dead" },
        // Phases closed weeks ago still count in the plan's progress.
        oldClosed: 3,
      },
      now,
    ),
    plan(
      {
        first: 301,
        slug: "store-v1",
        title: "The first store",
        session: SESSIONS.old.id,
        phases: [
          { status: "done", tasks: 6 },
          { status: "done", tasks: 6 },
          { status: "done", tasks: 5 },
        ],
        age: 40,
      },
      now,
    ),
  ];
}

/** Every node of a tree, depth first. */
function everyNode(nodes: readonly WorkTaskNode[]): WorkTaskNode[] {
  return nodes.flatMap((one) => [one, ...everyNode(one.children)]);
}

/**
 * `GET /api/tasks/<id>` in the mock: the task as the store keeps it, with a description, its
 * notes and its history made up from the node, or null when no mock project has it.
 */
export function mockTaskDetail(
  pages: Readonly<Record<string, ProjectTasksData>>,
  id: string,
): null | TaskDetailAnswer {
  for (const [project, page] of Object.entries(pages)) {
    if (page.work.state !== "ready") continue;
    const all = everyNode(page.work.tasks);
    const one = all.find((candidate) => candidate.id === id);
    if (one === undefined) continue;
    const number = Number(one.ref.slice(1));
    const updatedAt = Date.parse(one.updatedAt);
    const createdAt = updatedAt - 3 * HOUR;
    const session = page.work.sessions.find((candidate) => candidate.id === one.session);
    const sessionName = session?.name ?? null;
    const notes = Array.from({ length: one.notes }, (_, index) => ({
      at: createdAt + (index + 1) * HOUR,
      id: number * 10 + index,
      sessionId: one.session,
      taskId: one.id,
      text:
        index === 0
          ? "Report: the first half is built; the tests for **the store** pass.\n\n- `bun test` green\n- one open question"
          : "Ruling: keep the old name for one release — the docs still use it — cost if wrong: one rename later.",
    }));
    // Each entry's words the way the server's `historyChanges` gives them.
    const event = (
      offset: number,
      action: "changed" | "created" | "noted",
      changes: Record<string, [unknown, unknown]>,
      lines: string[],
    ) => ({
      action,
      at: createdAt + offset,
      changes,
      lines,
      id: number * 100 + offset,
      number,
      pid: 4242,
      reason: null,
      sessionId: one.session,
      sessionName,
      taskId: one.id,
    });
    const events = [
      event(0, "created", { subject: [null, one.subject], status: [null, "pending"] }, [
        `kind ${one.kind}`,
        `subject ${JSON.stringify(one.subject)}`,
        "status pending",
      ]),
      ...notes.map((note, index) =>
        event(index + 1, "noted", { note: [null, note.text] }, [
          `note ${JSON.stringify(note.text)}`,
        ]),
      ),
      ...(one.status === "pending"
        ? []
        : [
            event(notes.length + 1, "changed", { status: ["pending", one.status] }, [
              `status pending → ${one.status}`,
            ]),
          ]),
    ];
    const closed = one.status === "done" || one.status === "dropped";
    const waitsFor = one.blockedBy.flatMap((blocking) => {
      const found = all.find((candidate) => candidate.ref === blocking.ref);
      return found === undefined ? [] : [found.id];
    });
    return {
      events,
      notes,
      task: {
        agent: one.agent,
        base: one.base,
        branch: one.branch,
        claim: one.claim === "none" ? null : { pid: 4242, procStart: null, sessionId: one.session },
        closedAt: closed ? updatedAt : null,
        createdAt,
        createdBy: one.session,
        creator: null,
        description: `## What\n\n${one.subject}.\n\n## Done when\n\n- the change is in\n- its test fails without it`,
        files: [],
        id: one.id,
        kind: one.kind,
        lead: null,
        number,
        parentId: one.parentId,
        phase: one.phase,
        plan: one.plan,
        project,
        stackedOn: null,
        status: one.status,
        subject: one.subject,
        type: one.type,
        updatedAt,
        waitsFor,
        worktree: one.worktree,
      },
    };
  }
  return null;
}

/** A deploy task's id from its time, in the store's shape: `<env>-<YYYYMMDD>-<HHMMSS>` in UTC. */
function deployId(env: ProjectTaskRow["env"], at: number): string {
  return `${env}-${iso(at).slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}`;
}

function deployTask(
  env: ProjectTaskRow["env"],
  title: string,
  at: number,
  more: Partial<Pick<ProjectTaskRow, "deploy" | "flags" | "stale" | "twin" | "type">> = {},
): ProjectTaskRow {
  const id = deployId(env, at);
  return {
    created: iso(at).replace(/\.\d{3}Z$/, "Z"),
    deploy: more.deploy ?? "before",
    env,
    file: `.claude/tasks/${env}/${id}-${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)}.md`,
    flags: more.flags ?? [],
    id,
    stale: more.stale ?? false,
    title,
    twin: more.twin ?? null,
    type: more.type ?? "blocking",
  };
}

/** The full project's open deploy tasks, in the server's order: staging, then prod. */
function fullFiles(now: number): ProjectTaskRow[] {
  const migration = now - 2 * DAY - 3 * HOUR;
  return [
    deployTask("staging", "Run the orders migration", migration, {
      flags: ["twice-safe"],
      twin: { id: deployId("prod", migration), status: "open" },
    }),
    deployTask("staging", "Tell support the new export is live", now - DAY, {
      deploy: "after",
      type: "non-blocking",
    }),
    deployTask("prod", "Set the payment provider's live key", now - 6 * DAY, {
      flags: ["needs-yes", "spends-money"],
    }),
    deployTask("prod", "Run the orders migration", migration, {
      flags: ["twice-safe", "real-people"],
      twin: { id: deployId("staging", migration), status: "open" },
    }),
    deployTask("prod", "Rotate the webhook secret", now - 9 * DAY, {
      twin: { id: deployId("staging", now - 9 * DAY), status: "done" },
      type: "non-blocking",
    }),
    deployTask("prod", "Drop the old sessions table once nothing reads it", now - 40 * DAY, {
      deploy: "after",
      flags: ["destructive", "needs-yes"],
      stale: true,
    }),
  ];
}

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
          duplicateIds: [],
          envs: ["staging", "prod"],
          old: 3,
          staleDays: 30,
          state: "ready",
          tasks: fullFiles(now),
        },
        work: {
          more: 0,
          recentDays: 7,
          sessions: MOCK_SESSIONS,
          sessionsWhy: null,
          state: "ready",
          tasks: fullTree(now),
        },
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
          duplicateIds: [],
          envs: ["staging", "prod"],
          old: 0,
          staleDays: 30,
          state: "ready",
          tasks: [],
        },
        work: {
          more: 0,
          recentDays: 7,
          sessions: [],
          sessionsWhy: null,
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
          duplicateIds: [],
          envs: ["prod"],
          old: 0,
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
