/**
 * `GET /api/tasks` (D76: the Tasks tab, every project) and `GET /api/projects/<id>/tasks` (D75:
 * one project). Both answer each project with the same reading, two lists, read-only:
 *
 * - **Work tasks**: the kit's work store for the project (`src/tasks/work/tree.ts`): Plan ›
 *   Phase › Task as one tree, each with its type and what blocks it — the open ones,
 *   and those closed in the last `TASKS_CARD_RECENT_DAYS` days. Every worktree of the repo
 *   shares the one list. Each phase carries its ledger (G3): the agent, branch, worktree and
 *   base the main session set on it, and its steps (`phase-steps.ts`).
 * - **Project task files**: the open ones in the main checkout's task folder
 *   (`src/tasks/project/`), what blocks a release first. Stale is `task check`'s own rule
 *   (`checkProjectTasks`), never a second copy of it. A task on a branch not merged yet is not in
 *   the main checkout: `task list --branches` shows those.
 *
 * The project is found the way `src/tasks/context.ts` finds it for every other reader, with git
 * read through `Bun.spawn` (`taskContextAsync`), so the server never blocks. A change is a task
 * tool or `cc-smart-dev-kit task`, never this page.
 */
import { relative } from "node:path";
import { taskContextAsync } from "../../tasks/context";
import { checkProjectTasks, DAY_MS } from "../../tasks/project/check";
import { scanProjectTasks } from "../../tasks/project/files";
import type { ProjectTask } from "../../tasks/project/format";
import { allTasks } from "../../tasks/work/queries";
import { readWorkStore } from "../../tasks/work/read";
import { projectTaskTree, type TaskTreeNode } from "../../tasks/work/tree";
import type { PageDataDeps } from "../page-data";
import { type PhaseSteps, phaseSteps } from "./phase-steps";
import { mapLimit, PROJECT_GIT_AT_ONCE, projectsList, projectsWorldOf } from "./projects";
import type {
  ProjectSummary,
  ProjectTaskFiles,
  ProjectTaskRow,
  ProjectTasksAnswer,
  ProjectWorkTasks,
  TasksAnswer,
  WorkTaskNode,
} from "./types";

/** A closed work task stays on the card this many days after its last change. */
export const TASKS_CARD_RECENT_DAYS = 7;

/** What blocks a release comes first, then what must be done after a deploy, then the owner's. */
const WEIGHT_ORDER: Readonly<Record<string, number>> = {
  "blocks-release": 0,
  "after-deploy": 1,
  owner: 2,
};

/** Now before the next release, before any time. */
const WHEN_ORDER: Readonly<Record<string, number>> = { now: 0, "next-release": 1, any: 2 };

/**
 * A tree node as the wire carries it: its change time as ISO 8601, and a phase's steps from
 * `steps` (`phaseSteps`; a phase it does not hold has none to show).
 */
export function workTaskNodeOf(
  node: TaskTreeNode,
  steps: ReadonlyMap<string, PhaseSteps>,
): WorkTaskNode {
  const counted = node.layer === "phase" ? steps.get(node.id) : undefined;
  return {
    session: node.session,
    parentId: node.parentId,
    claim: node.claim,
    notes: node.notes,
    events: node.events,
    agent: node.agent,
    base: node.base,
    blocked: node.blocked,
    blockedBy: node.blockedBy.map((one) => ({
      ref: one.ref,
      status: one.status,
      subject: one.subject,
    })),
    branch: node.branch,
    children: node.children.map((child) => workTaskNodeOf(child, steps)),
    closed: node.closed,
    id: node.id,
    kind: node.kind,
    layer: node.layer,
    phase: node.phase,
    plan: node.plan,
    ref: node.ref,
    status: node.status,
    steps: counted === undefined ? null : { done: counted.done, total: counted.total },
    subject: node.subject,
    total: node.total,
    type: node.type,
    updatedAt: new Date(node.updatedAt).toISOString(),
    worktree: node.worktree,
  };
}

function rowOf(task: ProjectTask, root: string, stale: ReadonlySet<string>): ProjectTaskRow {
  return {
    created: task.created,
    file: relative(root, task.file),
    flags: [...(task.flags ?? [])],
    id: task.id,
    kind: task.kind,
    stale: stale.has(task.id),
    title: task.title,
    weight: task.weight ?? null,
    when: task.when ?? null,
  };
}

function rank(order: Readonly<Record<string, number>>, value: null | string): number {
  return value === null ? Object.keys(order).length : (order[value] ?? Object.keys(order).length);
}

function filesOf(
  root: string,
  tasks: { dir: string; staleDays: number; legacyFolders: string[] },
  now: Date,
): ProjectTaskFiles {
  try {
    const scan = scanProjectTasks(tasks.dir, { archive: true });
    const stale = new Set(
      checkProjectTasks({
        checkoutRoot: root,
        dir: tasks.dir,
        settings: { staleDays: tasks.staleDays },
        now,
        shippedIds: new Set(),
        legacyFolders: tasks.legacyFolders,
      })
        .filter((finding) => finding.kind === "stale" && finding.id !== undefined)
        .map((finding) => finding.id as string),
    );
    const open = scan.tasks
      .filter((task) => task.status === "open")
      .map((task) => rowOf(task, root, stale))
      .sort(
        (a, b) =>
          rank(WEIGHT_ORDER, a.weight) - rank(WEIGHT_ORDER, b.weight) ||
          rank(WHEN_ORDER, a.when) - rank(WHEN_ORDER, b.when) ||
          a.created.localeCompare(b.created) ||
          a.id.localeCompare(b.id),
      );
    return {
      broken: scan.broken.length,
      closed: scan.tasks.length - open.length,
      dir: relative(root, tasks.dir),
      staleDays: tasks.staleDays,
      state: "ready",
      tasks: open,
    };
  } catch (error) {
    return { state: "unavailable", why: error instanceof Error ? error.message : String(error) };
  }
}

/** `projects/<id>/tasks`: one project's answer, or why there is no project by that id. */
export async function projectTasksAnswerFor(
  deps: PageDataDeps,
  id: string,
): Promise<ProjectTasksAnswer | { error: string }> {
  const list = await projectsList(projectsWorldOf(deps));
  const project = list.projects.find((one) => one.id === id);
  if (project === undefined) {
    return { error: `no project has the id "${id}"; the list on /api/projects names them` };
  }
  return await tasksOf(deps, project);
}

/**
 * `GET /api/tasks` (D76): the Tasks tab, every project of the list with its tasks, read
 * `PROJECT_GIT_AT_ONCE` at a time (each project asks git for its key and checkout).
 */
export async function tasksAnswer(deps: PageDataDeps): Promise<TasksAnswer> {
  const list = await projectsList(projectsWorldOf(deps));
  const projects = await mapLimit(list.projects, PROJECT_GIT_AT_ONCE, async (project) => ({
    project,
    tasks: await tasksOf(deps, project),
  }));
  return { note: list.note, projects };
}

/** One project's work tree and its open task files: the one reading both answers use. */
async function tasksOf(deps: PageDataDeps, project: ProjectSummary): Promise<ProjectTasksAnswer> {
  const { env, now, paths } = deps.action.portal;
  const context = await taskContextAsync(project.root, env);
  if (!context.ok) {
    // Without git's answer the project's key is unknown: a guessed one would show another list.
    return {
      files: { state: "unavailable", why: context.why },
      work: { state: "unreadable", why: context.why },
    };
  }
  const at = now();
  const tree = projectTaskTree(paths, context.project, {
    now: at,
    recentMs: TASKS_CARD_RECENT_DAYS * DAY_MS,
  });
  let work: ProjectWorkTasks;
  if (tree.state === "ready") {
    // The steps count every task under a phase, closed long ago too: the tree leaves those out,
    // so they are read from the project's whole list. A list that cannot be read now shows no
    // steps, and the next `tasks` event reads both again.
    const all = readWorkStore(paths, (db) => phaseSteps(allTasks(db, context.project)));
    const steps = all.state === "ready" ? all.value : new Map<string, PhaseSteps>();
    work = {
      more: tree.value.more,
      recentDays: TASKS_CARD_RECENT_DAYS,
      state: "ready",
      tasks: tree.value.roots.map((root) => workTaskNodeOf(root, steps)),
    };
  } else {
    work = tree;
  }
  const files: ProjectTaskFiles =
    context.projectTasks.ok && context.checkoutRoot !== null
      ? filesOf(context.checkoutRoot, context.projectTasks, new Date(at))
      : {
          state: "unavailable",
          why: context.projectTasks.ok ? "not in a git checkout" : context.projectTasks.why,
        };
  return { files, work };
}
