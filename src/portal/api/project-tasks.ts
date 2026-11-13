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
 * - **Sessions**: every session that made a task in the tree, and every session that runs now
 *   with its folder in the project (Claude Code's own records, `liveSessions`), each with its
 *   name: a running session's own (none when its record has none), a session that runs no more
 *   by the last name its task history holds. The page names
 *   sessions with it, and offers the running ones as where a take-over (`task.take`) can move work.
 *
 * The project is found the way `src/tasks/context.ts` finds it for every other reader, with git
 * read through `Bun.spawn` (`taskContextAsync`), so the server never blocks. A change is a task
 * tool, `cc-smart-dev-kit task` or the take-over action, never a read.
 */
import { relative } from "node:path";
import { liveSessions, type SessionRecord } from "../../hooks/sessions";
import { isInside } from "../../path-compare";
import { taskContextAsync } from "../../tasks/context";
import { checkProjectTasks, DAY_MS } from "../../tasks/project/check";
import { scanProjectTasks } from "../../tasks/project/files";
import type { ProjectTask } from "../../tasks/project/format";
import { allTasks, layerProgress, sessionNames } from "../../tasks/work/queries";
import { readWorkStore } from "../../tasks/work/read";
import { projectTaskTree, type TaskTreeNode } from "../../tasks/work/tree";
import type { WorkTask } from "../../tasks/work/types";
import type { PageDataDeps } from "../page-data";
import { type PhaseSteps, phaseSteps } from "./phase-steps";
import { mapLimit, PROJECT_GIT_AT_ONCE, projectsList, projectsWorldOf } from "./projects";
import type {
  ProjectSummary,
  ProjectTaskFiles,
  ProjectTaskRow,
  ProjectTasksAnswer,
  ProjectWorkTasks,
  TaskSession,
  TasksAnswer,
  WorkTaskNode,
  WorkTaskProgress,
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

/** What the project's whole list counts for the tree's plans and phases, by task id. */
export interface ListCounts {
  /** A phase's steps (`phaseSteps`). */
  steps: ReadonlyMap<string, PhaseSteps>;
  /** A plan's phases (its tasks when it has none) or a phase's tasks closed of all (`layerProgress`). */
  progress: ReadonlyMap<string, WorkTaskProgress>;
}

/** Nothing counted: a list that cannot be read shows no steps and no progress. */
const NO_COUNTS: ListCounts = { progress: new Map(), steps: new Map() };

/** The counts of every plan and phase in the project's whole list, closed long ago too. */
export function listCountsOf(all: readonly WorkTask[]): ListCounts {
  const progress = new Map<string, WorkTaskProgress>();
  for (const layer of all) {
    if (layer.kind !== "task") progress.set(layer.id, layerProgress(all, layer));
  }
  return { progress, steps: phaseSteps(all) };
}

/**
 * A tree node as the wire carries it: its change time as ISO 8601, a phase's steps and a plan's
 * or a phase's progress from `counts` (a node it does not hold has none to show).
 */
export function workTaskNodeOf(node: TaskTreeNode, counts: ListCounts): WorkTaskNode {
  const counted = node.layer === "phase" ? counts.steps.get(node.id) : undefined;
  const progress = node.kind === "task" ? undefined : counts.progress.get(node.id);
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
    children: node.children.map((child) => workTaskNodeOf(child, counts)),
    closed: node.closed,
    id: node.id,
    kind: node.kind,
    layer: node.layer,
    phase: node.phase,
    plan: node.plan,
    progress: progress === undefined ? null : { closed: progress.closed, total: progress.total },
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
  return await tasksOf(deps, project, await runningSessions(deps, project.root));
}

/** The sessions running now, by the project key of each one's folder, or why none could be read. */
interface Running {
  byProject: ReadonlyMap<string, readonly SessionRecord[]>;
  why: null | string;
}

/**
 * Claude Code's records of the running sessions, read once for an answer, each put under its
 * folder's project (found the way every task reader finds it). A folder git cannot place, or
 * that is gone, belongs to no project here. With `within` (one project's answer), a session
 * whose folder is not inside that folder is skipped before git is asked: a session in a
 * worktree outside the main checkout's folder is then not named there.
 */
async function runningSessions(deps: PageDataDeps, within?: string): Promise<Running> {
  const { env, paths } = deps.action.portal;
  let records: SessionRecord[];
  try {
    records = liveSessions(paths.claudeConfigDir);
  } catch (error) {
    return { byProject: new Map(), why: error instanceof Error ? error.message : String(error) };
  }
  if (within !== undefined) records = records.filter((record) => isInside(record.cwd, within));
  const keys = await mapLimit(records, PROJECT_GIT_AT_ONCE, async (record) => {
    try {
      const context = await taskContextAsync(record.cwd, env);
      return context.ok ? context.project : null;
    } catch {
      // The folder is gone (its real path cannot be read): it is in no project now.
      return null;
    }
  });
  const byProject = new Map<string, SessionRecord[]>();
  for (const [index, record] of records.entries()) {
    const key = keys[index];
    if (key === null || key === undefined) continue;
    byProject.set(key, [...(byProject.get(key) ?? []), record]);
  }
  return { byProject, why: null };
}

/** Every session id the tree names, each once. */
function treeSessions(nodes: readonly TaskTreeNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.session !== null) into.add(node.session);
    treeSessions(node.children, into);
  }
  return into;
}

/** The sessions one project's tree names, and those running in it: running first, then by name. */
export function taskSessionsOf(
  roots: readonly TaskTreeNode[],
  running: readonly SessionRecord[],
  names: ReadonlyMap<string, string>,
): TaskSession[] {
  const live = new Map(running.map((record) => [record.sessionId, record]));
  const ids = treeSessions(roots, new Set(live.keys()));
  return [...ids]
    .map((id) => {
      const record = live.get(id);
      if (record === undefined) return { id, live: false, name: names.get(id) ?? null };
      // A running session is named by its own record only: a take-over finds it by that name
      // (`task.take`), so an older name from the history would offer one it then refuses.
      const own = record.name.trim();
      return { id, live: true, name: own === "" ? null : own };
    })
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) ||
        // A named session before one with no name.
        Number(a.name === null) - Number(b.name === null) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        a.id.localeCompare(b.id),
    );
}

/**
 * `GET /api/tasks` (D76): the Tasks tab, every project of the list with its tasks, read
 * `PROJECT_GIT_AT_ONCE` at a time (each project asks git for its key and checkout).
 */
export async function tasksAnswer(deps: PageDataDeps): Promise<TasksAnswer> {
  const [list, running] = await Promise.all([
    projectsList(projectsWorldOf(deps)),
    runningSessions(deps),
  ]);
  const projects = await mapLimit(list.projects, PROJECT_GIT_AT_ONCE, async (project) => ({
    project,
    tasks: await tasksOf(deps, project, running),
  }));
  return { note: list.note, projects };
}

/** One project's work tree and its open task files: the one reading both answers use. */
async function tasksOf(
  deps: PageDataDeps,
  project: ProjectSummary,
  running: Running,
): Promise<ProjectTasksAnswer> {
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
    // The steps and the progress count every task under a plan or phase, closed long ago too:
    // the tree leaves those out, so they are read from the project's whole list. A list that
    // cannot be read now shows neither, and the next `tasks` event reads both again.
    const all = readWorkStore(paths, (db) => ({
      counts: listCountsOf(allTasks(db, context.project)),
      names: sessionNames(db, context.project),
    }));
    const counts = all.state === "ready" ? all.value.counts : NO_COUNTS;
    const names = all.state === "ready" ? all.value.names : new Map<string, string>();
    work = {
      more: tree.value.more,
      recentDays: TASKS_CARD_RECENT_DAYS,
      sessions: taskSessionsOf(
        tree.value.roots,
        running.byProject.get(context.project) ?? [],
        names,
      ),
      sessionsWhy: running.why,
      state: "ready",
      tasks: tree.value.roots.map((root) => workTaskNodeOf(root, counts)),
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
