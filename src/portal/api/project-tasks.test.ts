/**
 * `GET /api/tasks` and `GET /api/projects/<id>/tasks` (D75, D76): the Tasks tab — the kit's
 * work store for each project as a tree with each task's layer, type and blockers, and its open
 * task files, what blocks a release first, stale marked.
 * Every file is in `tempDir()`, git runs in a clean environment, the store is a temp home's.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../../cli/paths";
import { projectKey } from "../../tasks/context";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "../../tasks/work/db";
import { addNote, type LaidPhase, layPhase, updateTask } from "../../tasks/work/store";
import type { Result, Who } from "../../tasks/work/types";
import { legacyCreateTask as createTask } from "../../testing/claude-mem-db";
import { fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import { cleanGitEnv, git, tempDir } from "../../testing/temp";
import { type ActionContext, portalOmnirouteContext, runAction } from "../actions";
import type { PageDataDeps } from "../page-data";
import { addProjectRoot, forgetProjectsList } from "./projects";
import { answerApi } from "./routes";
import { testPortalContext } from "./test-context";
import type { ProjectTasksAnswer, TasksAnswer } from "./types";

const DAY = 86_400_000;
/** 2026-03-01T00:00:00Z: every date below is counted from it. */
const NOW = Date.UTC(2026, 2, 1);
const who: Who = { sessionId: "s", pid: 1, procStart: "1" };

function idOf(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}

/** A node with none of the ledger's fields: no agent, branch, worktree or base, and no steps. */
const NO_LEDGER = { agent: null, base: null, branch: null, steps: null, worktree: null };

/** A plan's phase, made once under its plan task, the way the task tools lay it. */
function phaseOf(db: WorkDb, input: LaidPhase, now: number) {
  return value(writeWork(db, () => layPhase(db, input, who, now).task));
}

function repo(): string {
  const root = join(tempDir("tasks-card"), "app");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
  return root;
}

/** One project task file, as the project store writes it: each value JSON on its own line. */
function taskFile(folder: string, id: string, fields: Record<string, unknown>): void {
  mkdirSync(folder, { recursive: true });
  const lines = Object.entries({ id, ...fields }).map(
    ([key, field]) => `${key}: ${JSON.stringify(field)}`,
  );
  writeFileSync(join(folder, `${id}-task.md`), `---\n${lines.join("\n")}\n---\nBody\n`);
}

async function world(root: string) {
  const home = tempDir("tasks-card-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const env = { ...cleanGitEnv(), CLAUDE_CONFIG_DIR: paths.claudeConfigDir, HOME: home };
  const ctx = testPortalContext(paths, env, () => NOW);
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  const deps: PageDataDeps = {
    action,
    doctor: async () => null,
    facts: async () => ({ platform: "linux", portalPort: 0, router: null, version: "0.0.0" }),
    found: { error: "no gateway config yet" },
    projectDefaults: action.projectDefaults,
    workflow,
  };
  await addProjectRoot(paths, root);
  forgetProjectsList();
  return { deps, paths };
}

async function answerOf(deps: PageDataDeps, id: string) {
  const url = new URL(`http://127.0.0.1/api/projects/${id}/tasks`);
  return await answerApi(deps, url);
}

test("task detail returns description, notes and history and refuses an unknown move destination", async () => {
  const { deps, paths } = await world(repo());
  const db = openWorkDb(workDbFile(paths), { mode: "write" });
  const task = value(
    createTask(db, { project: "p", subject: "Detail", description: "Full description" }, who, NOW),
  );
  value(addNote(db, task.id, "A note", who, NOW + 1));
  db.close();
  const answer = await answerApi(deps, new URL(`http://127.0.0.1/api/tasks/${task.id}`));
  expect(answer?.status).toBe(200);
  expect(answer?.body).toMatchObject({
    task: { id: task.id, description: "Full description" },
    notes: [{ text: "A note" }],
    events: [{ action: "created" }, { action: "noted" }],
  });
  expect((await answerApi(deps, new URL("http://127.0.0.1/api/tasks/wabcdefghij")))?.status).toBe(
    404,
  );
  expect((await answerApi(deps, new URL("http://127.0.0.1/api/tasks/%zz")))?.status).toBe(400);
  expect(await runAction("task.take", { task: task.id, session: "unknown" }, deps.action)).toEqual({
    ok: false,
    lines: ["unknown destination session; nothing changed"],
  });
  expect(
    await runAction("task.take", { task: task.id, session: "unknown", force: true }, deps.action),
  ).toEqual({ ok: false, lines: ["confirm the forced take-over first"] });
});

beforeEach(() => {
  forgetProjectsList();
});

describe("a project's tasks answer (D75)", () => {
  test("the work tree and the open task files, what blocks a release first, stale marked", async () => {
    const root = repo();
    const { deps, paths } = await world(root);
    const db = openWorkDb(workDbFile(paths), { mode: "write" });
    const phase = phaseOf(
      db,
      { project: projectKey(root), plan: "launch", phase: "api", subject: "The API" },
      NOW - 2 * DAY,
    );
    const step = value(
      createTask(
        db,
        { project: projectKey(root), subject: "Write it", parentId: phase.id },
        who,
        NOW - DAY,
      ),
    );
    value(updateTask(db, step.id, { status: "in_progress" }, who, NOW - DAY));
    value(createTask(db, { project: "another-project", subject: "Not this one" }, who, NOW));
    db.close();

    const tasks = join(root, ".claude", "tasks");
    taskFile(tasks, "T-aaaaaa", {
      title: "Tell the team",
      kind: "teammate",
      status: "open",
      when: "any",
      created: "2026-02-25",
    });
    taskFile(tasks, "T-bbbbbb", {
      title: "Run the backfill",
      kind: "database",
      status: "open",
      when: "next-release",
      weight: "blocks-release",
      flags: ["twice-safe"],
      created: "2026-01-02",
    });
    taskFile(join(tasks, "archive"), "T-cccccc", {
      title: "Old one",
      kind: "production",
      status: "done",
      created: "2025-12-01",
      closed: "2026-01-01",
    });
    writeFileSync(join(tasks, "T-dddddd-broken.md"), "no front matter\n");

    const answer = await answerOf(deps, idOf(root));
    expect(answer?.status).toBe(200);
    const body = answer?.body as ProjectTasksAnswer;
    expect(body.work).toEqual({
      more: 0,
      recentDays: 7,
      state: "ready",
      tasks: [
        {
          children: [
            {
              children: [
                {
                  ...NO_LEDGER,
                  blocked: false,
                  blockedBy: [],
                  children: [],
                  closed: 0,
                  session: who.sessionId,
                  notes: 0,
                  parentId: phase.id,
                  claim: "dead",
                  events: 2,
                  id: step.id,
                  kind: "task",
                  layer: "task",
                  phase: null,
                  // Made straight in the store, which copies no plan from the parent (the task
                  // tools do): the tree shows what the store holds.
                  plan: null,
                  ref: "#3",
                  status: "in_progress",
                  subject: "Write it",
                  total: 0,
                  type: "blocking",
                  updatedAt: "2026-02-28T00:00:00.000Z",
                },
              ],
              ...NO_LEDGER,
              blocked: false,
              blockedBy: [],
              closed: 0,
              session: who.sessionId,
              notes: 0,
              parentId: phase.parentId,
              claim: "none",
              events: 1,
              id: phase.id,
              kind: "phase",
              layer: "phase",
              phase: "api",
              plan: "launch",
              ref: "#2",
              status: "pending",
              // Its one step is in progress: none of one done.
              steps: { done: 0, total: 1 },
              subject: "The API",
              total: 1,
              type: "blocking",
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          ],
          ...NO_LEDGER,
          blocked: false,
          blockedBy: [],
          closed: 0,
          session: who.sessionId,
          parentId: null,
          claim: "none",
          notes: 0,
          events: 1,
          id: phase.parentId as string,
          kind: "plan",
          layer: "plan",
          phase: null,
          plan: "launch",
          ref: "#1",
          status: "pending",
          subject: "launch",
          total: 0,
          type: "blocking",
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      ],
    });
    expect(body.files).toEqual({
      broken: 1,
      closed: 1,
      dir: ".claude/tasks",
      staleDays: 30,
      state: "ready",
      tasks: [
        {
          created: "2026-01-02",
          file: ".claude/tasks/T-bbbbbb-task.md",
          flags: ["twice-safe"],
          id: "T-bbbbbb",
          kind: "database",
          stale: true,
          title: "Run the backfill",
          weight: "blocks-release",
          when: "next-release",
        },
        {
          created: "2026-02-25",
          file: ".claude/tasks/T-aaaaaa-task.md",
          flags: [],
          id: "T-aaaaaa",
          kind: "teammate",
          stale: false,
          title: "Tell the team",
          weight: null,
          when: "any",
        },
      ],
    });
  });

  test("no store yet and no task folder: nothing to show, said as such", async () => {
    const root = repo();
    const { deps } = await world(root);
    const answer = await answerOf(deps, idOf(root));
    expect(answer?.body).toEqual({
      files: {
        broken: 0,
        closed: 0,
        dir: ".claude/tasks",
        staleDays: 30,
        state: "ready",
        tasks: [],
      },
      work: { state: "none" },
    });
  });

  test("the Tasks tab's answer: every project, each task's layer, type and blockers (D76)", async () => {
    const root = repo();
    const { deps, paths } = await world(root);
    const project = projectKey(root);
    const db = openWorkDb(workDbFile(paths), { mode: "write" });
    const brief = value(createTask(db, { project, subject: "Read the brief" }, who, NOW - DAY));
    value(updateTask(db, brief.id, { status: "done" }, who, NOW - DAY));
    const build = value(createTask(db, { project, subject: "Build it" }, who, NOW - DAY));
    value(updateTask(db, build.id, { status: "in_progress" }, who, NOW - DAY));
    const note = value(
      createTask(
        db,
        { project, subject: "Name the fields", parentId: build.id, type: "non-blocking" },
        who,
        NOW - DAY,
      ),
    );
    const ship = value(
      createTask(db, { project, subject: "Ship it", blockedBy: [build.id, brief.id] }, who, NOW),
    );
    db.close();

    const answer = await answerApi(deps, new URL("http://127.0.0.1/api/tasks"));
    expect(answer?.status).toBe(200);
    const body = answer?.body as TasksAnswer;
    // The projects list's own note, passed on: this home has an added folder and no records.
    expect(body.note).toBe(
      "Claude Code has saved no session records on this machine yet, so this list holds only the folders you added.",
    );
    expect(body.projects.map((one) => [one.project.id, one.project.name])).toEqual([
      [idOf(root), "app"],
    ]);
    const work = body.projects[0]?.tasks.work;
    if (work?.state !== "ready") throw new Error(`no tree: ${JSON.stringify(work)}`);
    // Open work first, newest change first; the closed brief last.
    expect(work.tasks).toEqual([
      {
        ...NO_LEDGER,
        blocked: true,
        // In number order, the closed one too: only the open one still blocks.
        blockedBy: [
          { ref: "#1", status: "done", subject: "Read the brief" },
          { ref: "#2", status: "in_progress", subject: "Build it" },
        ],
        children: [],
        closed: 0,
        session: who.sessionId,
        notes: 0,
        parentId: null,
        claim: "none",
        events: 1,
        id: ship.id,
        kind: "task",
        layer: "task",
        phase: null,
        plan: null,
        ref: "#4",
        status: "pending",
        subject: "Ship it",
        total: 0,
        type: "blocking",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        ...NO_LEDGER,
        blocked: false,
        blockedBy: [],
        children: [
          {
            ...NO_LEDGER,
            blocked: false,
            blockedBy: [],
            children: [],
            closed: 0,
            session: who.sessionId,
            notes: 0,
            parentId: build.id,
            claim: "none",
            events: 1,
            id: note.id,
            kind: "task",
            layer: "task",
            phase: null,
            plan: null,
            ref: "#3",
            status: "pending",
            subject: "Name the fields",
            total: 0,
            type: "non-blocking",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
        ],
        closed: 0,
        session: who.sessionId,
        notes: 0,
        parentId: null,
        claim: "dead",
        events: 2,
        id: build.id,
        kind: "task",
        layer: "task",
        phase: null,
        plan: null,
        ref: "#2",
        status: "in_progress",
        subject: "Build it",
        total: 1,
        type: "blocking",
        updatedAt: "2026-02-28T00:00:00.000Z",
      },
      {
        ...NO_LEDGER,
        blocked: false,
        blockedBy: [],
        children: [],
        closed: 0,
        session: who.sessionId,
        notes: 0,
        parentId: null,
        claim: "none",
        events: 2,
        id: brief.id,
        kind: "task",
        layer: "task",
        phase: null,
        plan: null,
        ref: "#1",
        status: "done",
        subject: "Read the brief",
        total: 0,
        type: "blocking",
        updatedAt: "2026-02-28T00:00:00.000Z",
      },
    ]);
    // The same reading as the one project's own answer: the tab and the route never disagree.
    expect((await answerOf(deps, idOf(root)))?.body).toEqual(body.projects[0]?.tasks);
  });

  test("the ledger (G3): each phase's agent, branch, worktree, base and steps, as the store holds them", async () => {
    const root = repo();
    const { deps, paths } = await world(root);
    const project = projectKey(root);
    const db = openWorkDb(workDbFile(paths), { mode: "write" });
    const at = NOW - DAY;
    const all = phaseOf(
      db,
      {
        agent: "builder-a1",
        base: "21eadc8a0f3b4c5d6e7f8091a2b3c4d5e6f70812",
        branch: "plan/api",
        phase: "api",
        plan: "launch",
        project,
        subject: "The API",
        worktree: "/home/user/my-app/.claude/worktrees/plan-api",
      },
      at,
    );
    const some = phaseOf(
      db,
      { agent: "builder-b2", phase: "ui", plan: "launch", project, subject: "The page" },
      at,
    );
    const none = phaseOf(db, { phase: "docs", plan: "launch", project, subject: "The docs" }, at);
    for (const status of ["done", "done", "pending"] as const) {
      const made = value(createTask(db, { parentId: all.id, project, subject: "A step" }, who, at));
      if (status !== "pending") value(updateTask(db, made.id, { status }, who, at));
    }
    // Set after the phase is laid, the way the main session binds a phase to its agent.
    value(updateTask(db, some.id, { branch: "plan/ui" }, who, at));
    db.close();

    const answer = await answerOf(deps, idOf(root));
    expect(answer?.status).toBe(200);
    const work = (answer?.body as ProjectTasksAnswer | undefined)?.work;
    if (work?.state !== "ready") throw new Error(`no tree: ${JSON.stringify(work)}`);
    const phases = work.tasks[0]?.children ?? [];
    const ledger = (id: string) => {
      const node = phases.find((one) => one.id === id);
      return node === undefined
        ? undefined
        : {
            agent: node.agent,
            base: node.base,
            branch: node.branch,
            steps: node.steps,
            worktree: node.worktree,
          };
    };
    expect(ledger(all.id)).toEqual({
      agent: "builder-a1",
      base: "21eadc8a0f3b4c5d6e7f8091a2b3c4d5e6f70812",
      branch: "plan/api",
      steps: { done: 2, total: 3 },
      worktree: "/home/user/my-app/.claude/worktrees/plan-api",
    });
    expect(ledger(some.id)).toEqual({
      agent: "builder-b2",
      base: null,
      branch: "plan/ui",
      steps: { done: 0, total: 0 },
      worktree: null,
    });
    expect(ledger(none.id)).toEqual({
      agent: null,
      base: null,
      branch: null,
      steps: { done: 0, total: 0 },
      worktree: null,
    });
    // The steps of a phase only: the plan above them has none.
    expect(work.tasks[0]?.steps).toBe(null);
  });

  test("the Tasks tab with no project at all: an empty list, not an error", async () => {
    const home = tempDir("tasks-empty-home");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const env = { ...cleanGitEnv(), CLAUDE_CONFIG_DIR: paths.claudeConfigDir, HOME: home };
    const ctx = testPortalContext(paths, env, () => NOW);
    const workflow = fakeWorkflow();
    const action: ActionContext = {
      cwd: home,
      omniroute: portalOmnirouteContext(ctx),
      portal: ctx,
      projectDefaults: () => fakeDefaults(),
      workflow,
    };
    const deps: PageDataDeps = {
      action,
      doctor: async () => null,
      facts: async () => ({ platform: "linux", portalPort: 0, router: null, version: "0.0.0" }),
      found: { error: "no gateway config yet" },
      projectDefaults: action.projectDefaults,
      workflow,
    };
    const answer = await answerApi(deps, new URL("http://127.0.0.1/api/tasks"));
    expect(answer?.status).toBe(200);
    const body = answer?.body as TasksAnswer;
    expect(body.projects).toEqual([]);
  });

  test("a project the list does not have is a 404 with the list's name", async () => {
    const root = repo();
    const { deps } = await world(root);
    const answer = await answerOf(deps, "000000000000");
    expect(answer?.status).toBe(404);
    expect(answer?.body).toEqual({
      error: 'no project has the id "000000000000"; the list on /api/projects names them',
    });
  });
});
