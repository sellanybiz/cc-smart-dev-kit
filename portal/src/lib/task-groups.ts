/**
 * How the Tasks tab lays one project's work out: grouped by the session that made each plan or
 * loose task, each level folded or open, and cut to a page of rows so the list never scrolls
 * without end. The filters themselves are `tasks.ts`.
 */

import type { TaskSession, TasksProjectData, WorkTaskNode } from "@/api/types";
import {
  filterTasks,
  isClosed,
  NO_PLAN,
  NO_SESSION,
  type ShownTask,
  type TaskFilter,
} from "@/lib/tasks";

/** How many rows a project shows before "Show more": a page, not the whole list. */
export const PAGE_ROWS = 60;

/** One session's part of a project's tree: the plans and loose tasks it made. */
export interface SessionGroup {
  /** The session's id, or `NO_SESSION` for tasks with no session recorded. */
  id: string;
  /** What the server knows of it; null for `NO_SESSION`. */
  session: null | TaskSession;
  roots: WorkTaskNode[];
}

/** The name a person reads for a session: its own, else its short id. */
export function sessionLabel(group: Pick<SessionGroup, "id" | "session">): string {
  if (group.session === null) return "No session recorded";
  return group.session.name ?? `session ${group.session.id.slice(0, 8)}`;
}

/** The newest change in a group, for its order. */
function newest(roots: readonly WorkTaskNode[]): string {
  return roots.reduce((max, root) => (root.updatedAt > max ? root.updatedAt : max), "");
}

/**
 * The tree's top level by session: running sessions first, then the one with the newest change;
 * the tasks no session is recorded for last. Each group keeps the server's order of its roots.
 */
export function sessionGroupsOf(
  roots: readonly WorkTaskNode[],
  sessions: readonly TaskSession[],
): SessionGroup[] {
  const known = new Map(sessions.map((one) => [one.id, one]));
  const groups = new Map<string, SessionGroup>();
  for (const root of roots) {
    const id = root.session ?? NO_SESSION;
    const group = groups.get(id) ?? {
      id,
      roots: [],
      session:
        root.session === null
          ? null
          : (known.get(root.session) ?? { id: root.session, live: false, name: null }),
    };
    group.roots.push(root);
    groups.set(id, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.session === null) - Number(b.session === null) ||
      Number(b.session?.live ?? false) - Number(a.session?.live ?? false) ||
      newest(b.roots).localeCompare(newest(a.roots)),
  );
}

/** A group as the filter shows it: its rows, with the tasks above each match as its place. */
export interface ShownGroup {
  group: SessionGroup;
  shown: ShownTask[];
}

/** True when a root is in the plan the filter names (`NO_PLAN`: in no plan). */
function inPlan(root: WorkTaskNode, plan: null | string): boolean {
  if (plan === null) return true;
  return plan === NO_PLAN ? root.plan === null : root.plan === plan;
}

/** The groups a filter shows: the session, running and plan filters pick, the rest per row. */
export function filterGroups(groups: readonly SessionGroup[], filter: TaskFilter): ShownGroup[] {
  return groups.flatMap((group) => {
    if (filter.session !== null && group.id !== filter.session) return [];
    if (filter.live && group.session?.live !== true) return [];
    const shown = filterTasks(
      group.roots.filter((root) => inPlan(root, filter.plan)),
      filter,
    );
    return shown.length === 0 ? [] : [{ group, shown }];
  });
}

/** One plan the plan filter offers: its slug and the subject its plan task carries. */
export interface PlanChoice {
  slug: string;
  subject: string;
}

/** Every plan in the projects' trees, each once, in the order first met. */
export function plansOf(projects: readonly TasksProjectData[]): PlanChoice[] {
  const plans = new Map<string, string>();
  for (const one of projects) {
    const work = one.tasks.work;
    if (work.state !== "ready") continue;
    for (const root of work.tasks) {
      if (root.plan === null) continue;
      const subject = root.kind === "plan" ? root.subject : root.plan;
      if (!plans.has(root.plan) || root.kind === "plan") plans.set(root.plan, subject);
    }
  }
  return [...plans].map(([slug, subject]) => ({ slug, subject }));
}

/** Every session the projects name, each once: running ones first. */
export function sessionsOf(projects: readonly TasksProjectData[]): TaskSession[] {
  const all = new Map<string, TaskSession>();
  for (const one of projects) {
    const work = one.tasks.work;
    if (work.state !== "ready") continue;
    for (const session of work.sessions) {
      const before = all.get(session.id);
      all.set(session.id, {
        id: session.id,
        live: session.live || (before?.live ?? false),
        name: session.name ?? before?.name ?? null,
      });
    }
  }
  return [...all.values()].sort((a, b) => Number(b.live) - Number(a.live));
}

// ── Folding ────────────────────────────────────────────────────────────────────────────

/** Each level's key in the remembered folds: a project, a session in a project, a task. */
export const foldKey = {
  project: (project: string) => `p:${project}`,
  session: (project: string, session: string) => `s:${project}:${session}`,
  task: (id: string) => `t:${id}`,
};

/** A done or dropped plan or phase starts folded; everything else starts open. */
export function foldedByDefault(task: WorkTaskNode): boolean {
  return task.kind !== "task" && isClosed(task.status);
}

/** The folds a person chose, by key: true is folded. A key not in it takes its default. */
export type Folds = Readonly<Record<string, boolean>>;

/** True when the level is open: the person's choice, else its default. */
export function isOpen(folds: Folds, key: string, defaultFolded = false): boolean {
  return !(folds[key] ?? defaultFolded);
}

/** True when the task's own rows (its children) show under it. */
export function taskOpen(folds: Folds, task: WorkTaskNode): boolean {
  return isOpen(folds, foldKey.task(task.id), foldedByDefault(task));
}

// ── Paging ─────────────────────────────────────────────────────────────────────────────

/** The rows a shown tree draws: each row, and the rows under an open one. */
export function rowCount(
  shown: readonly ShownTask[],
  open: (task: WorkTaskNode) => boolean,
): number {
  return shown.reduce(
    (sum, one) => sum + 1 + (open(one.task) ? rowCount(one.children, open) : 0),
    0,
  );
}

/** The first `budget` rows of a tree, depth first: a row's place above it always comes first. */
function takeRows(
  shown: readonly ShownTask[],
  budget: number,
  open: (task: WorkTaskNode) => boolean,
): { rows: ShownTask[]; used: number } {
  const rows: ShownTask[] = [];
  let used = 0;
  for (const one of shown) {
    if (used >= budget) break;
    used += 1;
    if (!open(one.task)) {
      rows.push(one);
      continue;
    }
    const under = takeRows(one.children, budget - used, open);
    used += under.used;
    rows.push({ ...one, children: under.rows });
  }
  return { rows, used };
}

/** A project's page of rows: the groups cut to the budget, and how many rows wait past it. */
export interface RowPage {
  groups: ShownGroup[];
  /** Rows past the budget, in open groups and open levels: what "Show more" brings. */
  hidden: number;
}

/**
 * The groups as one page: rows count across the groups in order, a folded group or level
 * counts its own row only, and a group past the budget is left out.
 */
export function pageRows(
  groups: readonly ShownGroup[],
  budget: number,
  groupOpen: (group: SessionGroup) => boolean,
  open: (task: WorkTaskNode) => boolean,
): RowPage {
  const page: ShownGroup[] = [];
  let used = 0;
  let total = 0;
  for (const one of groups) {
    const rows = groupOpen(one.group) ? rowCount(one.shown, open) : 0;
    total += rows;
    if (!groupOpen(one.group)) {
      page.push(one);
      continue;
    }
    if (used >= budget) continue;
    const taken = takeRows(one.shown, budget - used, open);
    used += taken.used;
    page.push({ group: one.group, shown: taken.rows });
  }
  return { groups: page, hidden: total - used };
}

// ── What a row says of its subtree ─────────────────────────────────────────────────────

/**
 * How many tasks in a subtree, the task itself too, carry this claim: `live`, a running process
 * holds it; `dead`, the process that held it has ended.
 */
export function claimCount(node: WorkTaskNode, claim: "dead" | "live"): number {
  return (
    (node.claim === claim ? 1 : 0) +
    node.children.reduce((sum, one) => sum + claimCount(one, claim), 0)
  );
}

/** The task with this id in any project's tree, with its project; null when none has it. */
export function findTask(
  projects: readonly TasksProjectData[],
  id: string,
): null | { node: WorkTaskNode; project: TasksProjectData } {
  const search = (nodes: readonly WorkTaskNode[]): null | WorkTaskNode => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = search(node.children);
      if (found !== null) return found;
    }
    return null;
  };
  for (const project of projects) {
    const work = project.tasks.work;
    if (work.state !== "ready") continue;
    const node = search(work.tasks);
    if (node !== null) return { node, project };
  }
  return null;
}
