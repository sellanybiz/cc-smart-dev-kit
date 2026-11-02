/**
 * `GET /api/projects/<id>/tasks` (D75): the Project page's Tasks card. Two lists, read-only:
 *
 * - **Work tasks**: the kit's work store for the project (`src/tasks/work/tree.ts`): plan tasks,
 *   phase tasks and their subtasks as one tree — the open ones, and those closed in the last
 *   `TASKS_CARD_RECENT_DAYS` days. Every worktree of the repo shares the one list.
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
import { projectTaskTree, type TaskTreeNode } from "../../tasks/work/tree";
import type { PageDataDeps } from "../page-data";
import { projectsList, projectsWorldOf } from "./projects";
import type {
  ProjectTaskFiles,
  ProjectTaskRow,
  ProjectTasksAnswer,
  ProjectWorkTasks,
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

/** A tree node as the wire carries it: its change time as ISO 8601. */
export function workTaskNodeOf(node: TaskTreeNode): WorkTaskNode {
  return {
    children: node.children.map(workTaskNodeOf),
    closed: node.closed,
    id: node.id,
    kind: node.kind,
    phase: node.phase,
    plan: node.plan,
    ref: node.ref,
    status: node.status,
    subject: node.subject,
    total: node.total,
    updatedAt: new Date(node.updatedAt).toISOString(),
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

export async function projectTasksAnswerFor(
  deps: PageDataDeps,
  id: string,
): Promise<ProjectTasksAnswer | { error: string }> {
  const list = await projectsList(projectsWorldOf(deps));
  const project = list.projects.find((one) => one.id === id);
  if (project === undefined) {
    return { error: `no project has the id "${id}"; the list on /api/projects names them` };
  }
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
  const work: ProjectWorkTasks =
    tree.state === "ready"
      ? {
          more: tree.value.more,
          recentDays: TASKS_CARD_RECENT_DAYS,
          state: "ready",
          tasks: tree.value.roots.map(workTaskNodeOf),
        }
      : tree;
  const files: ProjectTaskFiles =
    context.projectTasks.ok && context.checkoutRoot !== null
      ? filesOf(context.checkoutRoot, context.projectTasks, new Date(at))
      : {
          state: "unavailable",
          why: context.projectTasks.ok ? "not in a git checkout" : context.projectTasks.why,
        };
  return { files, work };
}
