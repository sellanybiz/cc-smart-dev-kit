/**
 * `GET /api/projects/<id>/tasks` (D75): the Project page's Tasks card — the kit's work store for
 * the project as a tree, and its open task files, what blocks a release first, stale marked.
 * Every file is in `tempDir()`, git runs in a clean environment, the store is a temp home's.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../../cli/paths";
import { projectKey } from "../../tasks/context";
import { openWorkDb, workDbFile } from "../../tasks/work/db";
import { createTask, ensurePhaseTask, updateTask } from "../../tasks/work/store";
import type { Result } from "../../tasks/work/types";
import { fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import { cleanGitEnv, git, tempDir } from "../../testing/temp";
import { type ActionContext, portalOmnirouteContext } from "../actions";
import type { PageDataDeps } from "../page-data";
import { addProjectRoot, forgetProjectsList } from "./projects";
import { answerApi } from "./routes";
import { testPortalContext } from "./test-context";
import type { ProjectTasksAnswer } from "./types";

const DAY = 86_400_000;
/** 2026-03-01T00:00:00Z: every date below is counted from it. */
const NOW = Date.UTC(2026, 2, 1);
const who = { sessionId: "s", crewId: null, pid: 1, procStart: "1" };

function idOf(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
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

beforeEach(() => {
  forgetProjectsList();
});

describe("a project's tasks answer (D75)", () => {
  test("the work tree and the open task files, what blocks a release first, stale marked", async () => {
    const root = repo();
    const { deps, paths } = await world(root);
    const db = openWorkDb(workDbFile(paths), { mode: "write" });
    const phase = value(
      ensurePhaseTask(
        db,
        {
          project: projectKey(root),
          plan: "launch",
          phase: "api",
          subject: "The API",
          description: "",
          crewId: "c1",
          waitsForPhases: [],
        },
        who,
        NOW - 2 * DAY,
      ),
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
                  children: [],
                  closed: 0,
                  id: step.id,
                  kind: "task",
                  phase: null,
                  // Made straight in the store, which copies no plan from the parent (the task
                  // tools do): the tree shows what the store holds.
                  plan: null,
                  ref: "#3",
                  status: "in_progress",
                  subject: "Write it",
                  total: 0,
                  updatedAt: "2026-02-28T00:00:00.000Z",
                },
              ],
              closed: 0,
              id: phase.id,
              kind: "phase",
              phase: "api",
              plan: "launch",
              ref: "#2",
              status: "pending",
              subject: "The API",
              total: 1,
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          ],
          closed: 0,
          id: phase.parentId as string,
          kind: "plan",
          phase: null,
          plan: "launch",
          ref: "#1",
          status: "pending",
          subject: "launch",
          total: 2,
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
