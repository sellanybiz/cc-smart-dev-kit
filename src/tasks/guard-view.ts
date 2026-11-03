/**
 * What the guards ask of a session's task list (D75), in one place: is there a list, and what
 * on it is still open. `crew-role` (a crew session's first edit and its stop), `crew report`
 * (a `done` report) and `lead-notes` (a lead's stop and its reminder) all read it, so they never
 * answer the same question two ways.
 *
 * **Two lists, for one release.** The kit's own store (`src/tasks/work/`) is the list. Claude
 * Code's own (`src/crew/tasks.ts`) is read beside it, because a machine that updated the plugin
 * before running `setup` still has Claude Code's task tools, and a session there may have used
 * them. A task open on either list is open. The legacy half goes in the release after.
 * **Once setup has run, Claude Code's list is not read**: setup denies its tools, so a task left
 * open there can never be closed, and it must not hold a session at a stop or a done report.
 *
 * **What cannot be read is named, never read as an empty list**: each caller decides what an
 * unreadable list means for its own answer (a guard lets the call through, `hooks-guards.md`).
 */
import { openTasks, readSessionTasks, sessionTasksDir } from "../crew/tasks";
import { readUserJson } from "../setup/user-json";
import { RETIRED_TASK_CLOSER } from "./words";
import { crewPhaseState, leadOwnState } from "./work/read";
import type { WorkTask } from "./work/types";

/** One open task as a guard names it. */
export interface OpenTaskLine {
  /** `#12` for the kit's own, `Claude Code task 3` for Claude Code's. */
  ref: string;
  subject: string;
  status: string;
}

interface Where {
  /** The kit's state folder (`cliPaths().stateDir`), which holds the work store. */
  stateDir: string;
  /** Claude Code's config folder, which holds its own task lists. */
  claudeConfigDir: string;
  /** The user's Claude Code settings (`cliPaths().settingsFile`), where setup's deny entries are. */
  settingsFile: string;
  /** The work store's project key (`taskContext`). */
  project: string;
  /** Claude Code's list id for the session (`taskListId`); "" when none is known. */
  listId: string;
}

function kitLine(task: WorkTask): OpenTaskLine {
  return { ref: `#${task.number}`, subject: task.subject, status: task.status };
}

/**
 * Whether a session can still close a task on Claude Code's own list: not once the user's
 * settings deny `TaskUpdate`, which setup does (`src/setup/task-tools.ts`). A settings file that
 * is missing or is not JSON shows no deny, so the list is read, as on a machine before setup.
 */
function claudeListClosable(settingsFile: string): boolean {
  let settings: unknown;
  try {
    settings = readUserJson(settingsFile);
  } catch {
    return true;
  }
  const permissions =
    typeof settings === "object" && settings !== null && "permissions" in settings
      ? settings.permissions
      : undefined;
  const deny =
    typeof permissions === "object" && permissions !== null && "deny" in permissions
      ? permissions.deny
      : undefined;
  return !(Array.isArray(deny) && deny.includes(RETIRED_TASK_CLOSER));
}

/** Claude Code's list, read: its open tasks, whether it holds any task file, and what failed. */
function claudeList(where: Where): {
  files: number;
  open: OpenTaskLine[];
  unreadable: string | null;
} {
  if (!claudeListClosable(where.settingsFile)) return { files: 0, open: [], unreadable: null };
  const read = readSessionTasks(where.claudeConfigDir, where.listId);
  if (read.state === "none") return { files: 0, open: [], unreadable: null };
  if (read.state === "unreadable") {
    return {
      files: 0,
      open: [],
      unreadable: `Claude Code's task list in ${sessionTasksDir(where.claudeConfigDir, where.listId)} cannot be read`,
    };
  }
  const open = openTasks(read.tasks).sort(
    (a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress"),
  );
  return {
    files: read.files,
    open: open.map((task) => ({
      ref: `Claude Code task ${task.id}`,
      subject: task.subject,
      status: task.status,
    })),
    unreadable: null,
  };
}

function storeProblem(why: string): string {
  return `the kit's task store cannot be read: ${why}`;
}

export interface CrewTaskView {
  /** The phase task `crew start` made for this crew session (keyed by plan and phase), or null. */
  phase: WorkTask | null;
  /** A list exists to judge by: the phase task has a subtask, or Claude Code's list a task file. */
  listed: boolean;
  /**
   * Every open task that holds the hand-back, in progress first: the phase task's blocking
   * subtasks (`holdingUnder`), then Claude Code's list.
   */
  open: OpenTaskLine[];
  /** The phase's other open tasks, which hold nothing (non-blocking work, D76): the card lists them. */
  aside: OpenTaskLine[];
  /** What could not be read, one line each; empty when everything was read. */
  unreadable: string[];
}

/** A crew session's list: its phase task's subtree in the kit's store, and Claude Code's list. */
export function crewTaskView(where: Where & { crewId: string }): CrewTaskView {
  const kit = crewPhaseState({ stateDir: where.stateDir }, where.project, where.crewId);
  const legacy = claudeList(where);
  const unreadable = [
    ...(kit.state === "unreadable" ? [storeProblem(kit.why)] : []),
    ...(legacy.unreadable === null ? [] : [legacy.unreadable]),
  ];
  const ready = kit.state === "ready" ? kit.value : null;
  return {
    phase: ready?.phase ?? null,
    listed: (ready?.total ?? 0) > 0 || legacy.files > 0,
    open: [...(ready?.openSubtasks ?? []).map(kitLine), ...legacy.open],
    aside: (ready?.aside ?? []).map(kitLine),
    unreadable,
  };
}

export interface LeadTaskView {
  /** The lead has a task of its own on either list, open or not. */
  hasOwn: boolean;
  /** Its own tasks in progress: the kit's (made by its sessions, in its plan), then Claude Code's. */
  inProgress: OpenTaskLine[];
  /** What could not be read, one line each. */
  unreadable: string[];
}

/**
 * A lead's own list: the work tasks its sessions made in its plan (`leadSessions`, so an adopted
 * lead keeps its predecessor's), never the plan task or the phase tasks, which are its crew's.
 */
export function leadTaskView(
  where: Where & { plan: string; sessionIds: readonly string[] },
): LeadTaskView {
  const kit = leadOwnState({ stateDir: where.stateDir }, where.project, where.plan, [
    ...where.sessionIds,
  ]);
  const legacy = claudeList(where);
  const ready = kit.state === "ready" ? kit.value : null;
  return {
    hasOwn: (ready?.total ?? 0) > 0 || legacy.files > 0,
    inProgress: [
      ...(ready?.inProgress ?? []).map(kitLine),
      ...legacy.open.filter((task) => task.status === "in_progress"),
    ],
    unreadable: [
      ...(kit.state === "unreadable" ? [storeProblem(kit.why)] : []),
      ...(legacy.unreadable === null ? [] : [legacy.unreadable]),
    ],
  };
}
