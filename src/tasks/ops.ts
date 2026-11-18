import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { READ_ONLY_OPERATIONS, type TaskOperation, taskSchemas } from "./schemas";

export type { TaskOperation } from "./schemas";

import { cliPaths } from "../cli/paths";
import { cappedHookList } from "../hooks/capped-list";
import { runGit } from "../hooks/git";
import { DEPLOY_TASKS_SINCE } from "../project/config";
import { resolvePlans } from "../workflow/resolve";
import { type TaskContext, taskContext } from "./context";
import {
  addDeployNote,
  closeDeployTask,
  createDeployPair,
  createDeployTask,
  findDeployTask,
  reopenDeployTask,
  scanDeployTasks,
  updateDeployTask,
} from "./deploy/files";
import { type DeployTask, isDeployTaskId } from "./deploy/format";
import { planFilesCheck } from "./files-check";
import {
  planInTheWay,
  planNote,
  refuseBareClose,
  refuseEmptyPhase,
  refuseOtherPlan,
  refuseParkWhileBusy,
  refuseStepEscape,
} from "./plan-guards";
import { TASK_COMMAND, TASK_TOOL } from "./words";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./work/db";
import { historyText } from "./work/history";
import { CLAIM_PROCESS, callerOf, claimGone, claimLive, sessionEnded } from "./work/identity";
import {
  allTasks,
  claimState,
  defaultPlanOf,
  deletedHistory,
  eventsOf,
  freedBy,
  getTask,
  inFlightPlanOf,
  isInFlight,
  isLead,
  isOpen,
  layerOf,
  normalizePlanFile,
  notesOf,
  openBlockers,
  ownerOf,
  ownsPlan,
  PARK_NOTE_PREFIX,
  planByRef,
  planQueueState,
  searchTasks,
  subtreeProgress,
} from "./work/queries";
import {
  applyUpdate,
  deleteTask,
  type FilesCheck,
  insertNote,
  insertTask,
  layPhase,
  type PhaseCap,
  planTask,
  reclaimResumed,
  refuseOverCap,
  takeTasks,
} from "./work/store";
import type { Result, Who, WorkTask } from "./work/types";

/** The longest phase id (`K`, `W1a`, `D17b`, `E1a-E1b`): short enough for a branch and a list. */
const MAX_PHASE = 8;

/** The phase id's rule, in the words a refusal says it. */
const PHASE_RULE = `1-${MAX_PHASE} characters: ASCII letters, digits, ".", "_" and "-", a letter or a digit at each end, never "--"`;

/** True when `value` is a phase id as written: `PHASE_RULE`, never changed into one. */
function isPhaseId(value: string): boolean {
  return (
    value.length <= MAX_PHASE &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value) &&
    !value.includes("--")
  );
}

function bindings(input: {
  agent?: string | undefined;
  branch?: string | undefined;
  worktree?: string | undefined;
  base?: string | undefined;
}) {
  return {
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.worktree === undefined ? {} : { worktree: input.worktree }),
    ...(input.base === undefined ? {} : { base: input.base }),
  };
}

/** A 4.x task id (`T-gpmiae`): the files they named are not read since `DEPLOY_TASKS_SINCE`. */
const OLD_TASK_ID = /^T-/;
const OLD_ID_ANSWER = `old task ids are gone in ${DEPLOY_TASKS_SINCE}: the file is not read; recreate it as a deploy task or delete it`;

/**
 * Refuses the fields only a deploy task has, on a work task: a forgotten `kind` must never
 * silently make a machine-local task out of a deploy step. `fields` are the call's own values.
 */
function refuseDeployFields(fields: Record<string, unknown>): void {
  const given = Object.keys(fields).filter((name) => {
    const value = fields[name];
    return !(
      value === undefined ||
      value === false ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    );
  });
  if (given.length > 0)
    throw new Error(
      `Deploy fields (${given.join(", ")}) need kind prod or staging: a work task has none`,
    );
}

/**
 * The refusal of what only the person may do to a blocking deploy task (D14): the text a session
 * reads, naming the exact command the person runs in their own terminal.
 */
function personOnly(id: string, action: string, command: string): string {
  return `${id} is blocking: only the person ${action}. Ask the person to run \`${TASK_COMMAND} ${command}\` in their own terminal, outside Claude Code`;
}

/**
 * What every deploy-task write says about where it landed: the file, relative to its checkout, and
 * the checkout. The one place the words live; `create` and every later op read it, so a person who
 * runs the command in another folder sees it at once.
 */
function deployWrote(root: string, file: string): string {
  return `${relative(root, file)} · written in ${root}: commit the file with your branch`;
}

/**
 * The line a read answer puts before the deploy tasks it shows from another checkout than the
 * session's (the CLI run in a second folder): which checkout's files they are.
 */
function deployTasksIn(root: string): string {
  return `Deploy tasks in ${root}:`;
}

/** True when `path` (repo-relative) is a folder in the working copy: a list entry for it needs its `/`. */
function isFolderOnDisk(root: string, path: string): boolean {
  const full = join(root, path);
  return existsSync(full) && statSync(full).isDirectory();
}

const DELETE_TRACKED =
  "Tracked deploy task: it is part of a commit, so close it with task_done instead";

export const TASK_LINE_CAP = 200;
export const TASK_TEXT_CAP = 20_000;
export type TaskAnswer = { ok: true; text: string; data?: unknown } | { ok: false; why: string };
export interface TaskOpsOptions {
  stateDir?: string;
  env?: Record<string, string | undefined>;
  caller?: () => (Who & { cwd: string }) | null;
  cwd?: () => string;
  now?: () => number;
  /**
   * Refuse to drop a blocking deploy task: only the person drops one (D14). The MCP server sets
   * it always; the command sets it inside Claude Code.
   */
  refuseBlockingDrop?: boolean;
  /**
   * How a new file list on a held plan is compared (`plans.mergeFiles` and case). Read from git
   * before the write lock; tests pass their own. Default: `planFilesCheck` of the caller's folder.
   */
  filesCheck?: (cwd: string) => FilesCheck;
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function label(task: WorkTask): string {
  return `#${task.number} "${task.subject}"`;
}
/**
 * What a close adds to its answer: the caller's own work it just made startable (`freedBy`), in
 * number order and capped like the hooks' lists, or nothing when it freed none. Read after the
 * close, so `all` holds the closed task as closed.
 */
function freedText(
  all: readonly WorkTask[],
  closed: WorkTask,
  owns: (t: WorkTask) => boolean,
  canStartIn: (plan: string) => boolean,
) {
  // Work the store would refuse to start (another plan is in flight) is left out; a loose task
  // is in no plan.
  const freed = freedBy(all, closed, owns).filter((t) => t.plan === null || canStartIn(t.plan));
  if (freed.length === 0) return "";
  const list = cappedHookList(freed, (t) => `#${t.number} ${t.subject}`, TASK_TOOL.list);
  return ` · now ready: ${list}: start ${freed.length === 1 ? "it" : "them together"}`;
}
/** What a task's line adds to its status (D76): its type when non-blocking, its open blockers. */
function marks(task: WorkTask, byId: ReadonlyMap<string, WorkTask>): string[] {
  const blockers = isOpen(task) ? openBlockers(task, byId) : [];
  return [
    ...(task.type === "non-blocking" ? ["non-blocking"] : []),
    ...(blockers.length ? [`blocked by ${blockers.map((t) => `#${t.number}`).join(", ")}`] : []),
  ];
}
/**
 * The words in a task's brackets: its status, its layer when it is a plan or a phase (`withLayer`:
 * every layer, for `task_get`), then its `marks`. `queue` stands in for the status of an open
 * plan on the plan ledger: in flight, queued or parked (`planQueueState`).
 */
function stateWords(
  task: WorkTask,
  byId: ReadonlyMap<string, WorkTask>,
  withLayer = false,
  queue?: string,
): string {
  const layer = layerOf(task, byId);
  return [
    ...(withLayer ? [layer] : []),
    queue ?? task.status.replaceAll("_", " "),
    ...(!withLayer && layer === "plan" ? ["plan"] : []),
    ...(!withLayer && layer === "phase" ? [`phase ${task.phase ?? ""}`.trim()] : []),
    ...marks(task, byId),
  ].join(" · ");
}
export function projectLine(task: DeployTask): string {
  return `${task.id} [${[task.deploy, task.type].join(" · ")}] ${task.title}`;
}
function capped(lines: string[]): string {
  return lines.length
    ? [
        ...lines.slice(0, TASK_LINE_CAP),
        ...(lines.length > TASK_LINE_CAP ? [`+${lines.length - TASK_LINE_CAP} more`] : []),
      ].join("\n")
    : "No tasks.";
}
function page(text: string, offset: number): string {
  const end = offset + TASK_TEXT_CAP;
  return text.slice(offset, end) + (end < text.length ? `\n… more: offset ${end}` : "");
}

/** Both front doors call these operations. Identity and checkout are resolved afresh on every call. */
export function createTaskOps(options: TaskOpsOptions = {}) {
  const env = options.env ?? process.env;
  const paths = cliPaths(env);
  const stateDir = options.stateDir ?? paths.stateDir;
  let db: WorkDb | undefined;
  const database = () => {
    if (db?.writeRefusal !== undefined) {
      db.close();
      db = undefined;
    }
    if (db === undefined) db = openWorkDb(workDbFile({ stateDir }), { mode: "write" });
    return db;
  };
  /** `notes` collects lines the answer carries after its own text (`call`). */
  function run(operation: TaskOperation, raw: unknown, notes: string[]): TaskAnswer {
    try {
      const caller = options.caller ? options.caller() : callerOf({ env });
      const who: Who = caller ?? { sessionId: null, pid: null, procStart: null };
      const cwd = caller?.cwd ?? options.cwd?.() ?? process.cwd();
      const ctx = taskContext(cwd, env);
      if (!ctx.ok) throw new Error(ctx.why);
      // Deploy task files are written where the command runs: an explicit `cwd` (the CLI's own
      // folder) wins over the session record's, so a close lands in the checkout the gates read.
      // Work-task identity and project stay with `ctx`. Read once, and only when it differs.
      const explicitCwd = options.cwd?.();
      let deployCtx: TaskContext | undefined;
      const deployContext = (): TaskContext => {
        deployCtx ??=
          explicitCwd === undefined || explicitCwd === cwd ? ctx : taskContext(explicitCwd, env);
        return deployCtx;
      };
      const now = options.now?.() ?? Date.now();
      const store = database();
      // A reopened session keeps its session id in a new process: its running claims move to this
      // process before anything reads them, so every reader (the status line too) finds them.
      if (store.writable) {
        const reclaimed = reclaimResumed(store, who, now, claimGone);
        if (!reclaimed.ok) {
          // A read still answers, with the failure on a line of its own; a write fails loudly.
          const why = `claims of this session not moved: ${reclaimed.why}`;
          if (!READ_ONLY_OPERATIONS.has(operation)) throw new Error(why);
          notes.push(`${why}; the next call retries`);
        }
      }
      const all = allTasks(store, ctx.project);
      // The caller's own task (`ownerOf`: made under its session id, claimed by its process, or
      // made by its process under an earlier session id, as before a `/clear`).
      const owns = ownerOf(who);
      // Reads keep the latest own plan, even closed. Writes never revive an older open plan.
      // Never another session's plan, or its phases would count as the caller's (`openPhasesOf`):
      // a plan is the caller's by its plan task (`ownsPlan`), not by a step it merely claims.
      const ownPlan =
        [...all].reverse().find((t) => t.plan !== null && owns(t) && ownsPlan(all, owns, t.plan))
          ?.plan ?? null;
      // The plan in flight: a plan queued behind it never takes a call that names no plan.
      const inFlight = inFlightPlanOf(all, owns);
      const writePlan = defaultPlanOf(all, owns, inFlight, ownPlan);
      /** `plans.maxPhases` for this checkout: a broken workflow file fails the call, naming it. */
      const phaseCap = (): PhaseCap => {
        if (!ctx.projectConfig.ok) throw new Error(ctx.projectConfig.why);
        const { value, source } = resolvePlans(paths, ctx.projectConfig.config).maxPhases;
        return { max: value, source };
      };
      // A plan another process holds live is that session's work, not a queued plan to refuse.
      const claimedElsewhere = (t: WorkTask) =>
        claimState(t, CLAIM_PROCESS, who) === "another session";
      // A reserved plan is refused by who owns it (D4): the reservation says who it was handed to.
      const guardCaller = { owns, isLead: (t: WorkTask) => isLead(t.lead, who) };
      const refuseOther = (plan: string) =>
        refuseOtherPlan({ all, inFlight, plan, claimedElsewhere, caller: guardCaller });
      /** What a close freed, judged on the list read after it: the plan in flight may have closed. */
      const freedAfter = (after: readonly WorkTask[], closed: WorkTask) =>
        freedText(
          after,
          closed,
          owns,
          (plan) =>
            planInTheWay({
              all: after,
              inFlight: inFlightPlanOf(after, owns),
              plan,
              claimedElsewhere,
              caller: guardCaller,
            }) === null,
        );
      /**
       * A plan's new file list, checked before the write lock: each entry is normalised (D2) and
       * a folder written without its `/` is refused with the fix. It always reads `plans.mergeFiles`
       * and case from git here (whether the plan is held is only known inside the transaction), so
       * no git runs under the lock; the store then judges an overlap there.
       */
      const filesWrite = (files: readonly string[]) => {
        for (const raw of files) {
          const path = normalizePlanFile(raw);
          if (ctx.checkoutRoot === null || path.endsWith("/")) continue;
          if (isFolderOnDisk(ctx.checkoutRoot, path))
            throw new Error(`file "${raw}" is a folder: write it ${path}/`);
        }
        return { files, filesCheck: (options.filesCheck ?? planFilesCheck)(cwd) };
      };
      /**
       * How a plan's start is judged against the plans held for others (the store refuses an
       * overlap in the start's own write): the real `plans.mergeFiles` and case read, taken before
       * the lock, whenever this start puts a plan into flight (it has a plan row that is not in
       * flight yet). A step in a plan that already runs reads nothing, so git runs once per plan
       * start, never once per step. The store's own default (nothing ignored, case compared) is
       * for a caller with no read, and is never used on this path.
       */
      const startCheck = (plan: string | null): { filesCheck?: FilesCheck } => {
        const row = all.find((t) => t.kind === "plan" && t.plan === plan);
        return row === undefined || isInFlight(all, row)
          ? {}
          : { filesCheck: (options.filesCheck ?? planFilesCheck)(cwd) };
      };
      /**
       * Marks the caller's own plan in flight when work in it starts: its task goes from pending
       * to `in_progress` in the same write, claimed by this process. A plan that is not the
       * caller's, one with no task, and one already running are left as they are. `check` is
       * `startCheck`, read before the lock.
       */
      const enterFlight = (plan: string | null, check: { filesCheck?: FilesCheck }) => {
        const row = all.find((t) => t.kind === "plan" && t.plan === plan);
        if (row === undefined || row.status !== "pending" || !owns(row)) return;
        applyUpdate(store, row.id, { status: "in_progress", ...check }, who, now);
      };
      const deployTasksOf = () => {
        const here = deployContext();
        if (!here.ok) throw new Error(here.why);
        if (!here.projectTasks.ok) throw new Error(here.projectTasks.why);
        return here.projectTasks;
      };
      /** True when the deploy task folder can be read (a list or search shows them then). */
      const deployReadable = () => {
        const here = deployContext();
        return here.ok && here.projectTasks.ok;
      };
      const projectDir = () => deployTasksOf().dir;
      const projectEnvs = () => deployTasksOf().envs;
      /** The deploy task checkout, or why there is none: one answer for every op that names it. */
      const deployRoot = () => {
        const here = deployContext();
        if (!here.ok) throw new Error(here.why);
        if (here.checkoutRoot === null) throw new Error("Deploy tasks need a git checkout");
        return here.checkoutRoot;
      };
      /**
       * The checkout the deploy tasks are read from when it is not the session's own checkout
       * (an explicit `cwd`, the CLI in another folder), else null: a read then names it.
       */
      const otherDeployRoot = () => {
        const here = deployContext();
        return here.ok && here.checkoutRoot !== null && here.checkoutRoot !== ctx.checkoutRoot
          ? here.checkoutRoot
          : null;
      };
      /** A write's answer part: the file and the checkout it is in, as create says it. */
      const wroteIn = (task: DeployTask) => deployWrote(deployRoot(), task.file);
      const projectTasks = (archive: boolean) => scanDeployTasks(projectDir(), { archive }).tasks;
      const work = (reference: string) => {
        if (OLD_TASK_ID.test(reference)) throw new Error(OLD_ID_ANSWER);
        const task = getTask(store, ctx.project, reference);
        if (!task) throw new Error(`Task not found: ${reference}`);
        return task;
      };
      const project = (reference: string) => findDeployTask(projectDir(), reference);
      if (operation === "take") {
        const input = taskSchemas.take.parse(raw);
        if (!caller?.sessionId) throw new Error("take needs a resolvable calling session");
        const target = planByRef(store, ctx.project, input.task) ?? work(input.task);
        const moved = value(
          takeTasks(store, ctx.project, target.id, who, now, {
            ...(input.from === undefined ? {} : { from: input.from }),
            force: input.force,
            isLive: claimLive,
            // The session records of this caller's config folder (`env`), never another one's.
            isEnded: (claim) => sessionEnded(claim, { env }),
          }),
        );
        return {
          ok: true,
          text: `${moved.length} task(s) taken by session ${who.sessionId}${input.force ? " (forced)" : ""}${who.pid === null ? "; session only, no process claim" : ""}`,
        };
      }
      if (operation === "create") {
        const input = taskSchemas.create.parse(raw);
        if (input.kind !== "work") {
          if (
            Object.keys(bindings(input)).length ||
            input.parent ||
            input.blocked_by?.length ||
            input.status ||
            input.phase ||
            input.plan ||
            input.files !== undefined
          )
            throw new Error(
              "Deploy tasks have no parent, blocked-by, work status, phase, plan or files",
            );
          if (input.deploy === undefined)
            throw new Error("A deploy task needs deploy (before or after)");
          if (input.type === undefined)
            throw new Error("A deploy task needs type (blocking or non-blocking)");
          const envs = projectEnvs();
          if (!envs.includes(input.kind))
            throw new Error(
              `${input.kind} is not one of this project's environments (tasks.envs: ${envs.join(", ")})`,
            );
          if (input.pair && input.kind !== "staging")
            throw new Error(
              "pair is for kind staging: it creates the staging task and its prod twin",
            );
          const root = deployRoot();
          const branch = runGit(root, ["branch", "--show-current"], env);
          if (!branch.ok) throw new Error("Could not read the current branch");
          const fields = {
            title: input.subject,
            deploy: input.deploy,
            type: input.type,
            ...(input.description === undefined ? {} : { body: input.description }),
            ...(input.flags === undefined ? {} : { flags: input.flags }),
            ...(input.refs === undefined ? {} : { refs: input.refs }),
            from: input.from ?? (branch.out ? `branch ${branch.out}` : "a detached HEAD"),
          };
          const sources = { now: new Date(now) };
          const made = input.pair
            ? Object.values(createDeployPair(projectDir(), fields, sources, envs))
            : [createDeployTask(projectDir(), { ...fields, env: input.kind }, sources)];
          return {
            ok: true,
            text: made.map((task) => `${task.id} "${task.title}" · ${wroteIn(task)}`).join("\n"),
          };
        }
        refuseDeployFields({
          deploy: input.deploy,
          pair: input.pair,
          flags: input.flags,
          refs: input.refs,
          from: input.from,
        });
        // Every blocker is found before anything is written: a wrong one leaves no task behind.
        const blockedBy = input.blocked_by?.map((r) => work(r).id) ?? [];
        // Only the plan task itself carries a file list: a plan made without a phase or a parent.
        if (
          input.files !== undefined &&
          (input.phase !== undefined || input.plan === undefined || input.parent !== undefined)
        )
          throw new Error(
            "files belong to a plan task: create the plan with plan and a subject (no phase, no parent), or set files on it with task_update",
          );
        if (input.phase !== undefined || (input.plan !== undefined && input.parent === undefined)) {
          if (input.parent !== undefined)
            throw new Error("A plan stays at the top and a phase under its plan: leave out parent");
          if (input.status !== undefined)
            throw new Error("A plan or a phase starts pending: leave out status");
          if (
            input.phase === undefined &&
            (Object.keys(bindings(input)).length ||
              blockedBy.length ||
              input.type !== undefined ||
              input.description !== undefined)
          )
            throw new Error(
              "A plan without parent creates the plan itself and takes a subject only: to add a task to this plan, name its phase, or the plan's #n, as parent; give phase to lay out a phase",
            );
          const slug = input.plan ?? writePlan;
          if (slug === null) throw new Error("A phase belongs to a plan: give plan (its slug)");
          if (input.phase === undefined) {
            const existing = all.find((t) => t.kind === "plan" && t.plan === slug);
            const there = existing !== undefined;
            // A plan that is there takes the list as an update, held or not (`applyUpdate`).
            const listed = input.files === undefined ? undefined : filesWrite(input.files);
            const made = value(
              writeWork(store, () => {
                const row = planTask(
                  store,
                  { project: ctx.project, plan: slug, subject: input.subject },
                  who,
                  now,
                );
                return listed === undefined ? row : applyUpdate(store, row.id, listed, who, now);
              }),
            );
            return {
              ok: true,
              text: `${label(made)} · plan ${slug}${there ? " · it was there already" : ""}`,
            };
          }
          const phaseId = input.phase;
          if (!isPhaseId(phaseId))
            throw new Error(`The phase "${phaseId}" is not one: a phase is ${PHASE_RULE}`);
          // A phase that is there is only answered, so the cap does not judge it. A new one goes
          // in any plan of the caller's: only the cap holds it back.
          const there = all.some(
            (t) => t.kind === "phase" && t.plan === slug && t.phase === phaseId,
          );
          const laid = value(
            writeWork(store, () =>
              layPhase(
                store,
                {
                  project: ctx.project,
                  plan: slug,
                  phase: phaseId,
                  subject: input.subject,
                  ...(there ? {} : { cap: phaseCap() }),
                  ...(input.description === undefined ? {} : { description: input.description }),
                  ...bindings(input),
                  ...(input.type === undefined ? {} : { type: input.type }),
                  blockedBy,
                },
                who,
                now,
              ),
            ),
          );
          // A phase that was there keeps its own fields: say which of the call's were not used.
          const kept = [
            ...(input.description === undefined ? [] : ["description"]),
            ...(input.type === undefined ? [] : ["type"]),
            ...(blockedBy.length ? ["blocked_by"] : []),
            ...Object.keys(bindings(input)),
          ];
          const unchanged = kept.length
            ? `: its ${kept.join(", ")} stay as they were (${TASK_TOOL.update} changes them)`
            : "";
          return {
            ok: true,
            text: `${label(laid.task)} · phase ${phaseId} of plan ${slug}${laid.made ? "" : ` · it was there already${unchanged}`}`,
          };
        }
        const parent = input.parent ? work(input.parent) : undefined;
        if (input.plan !== undefined && parent?.plan !== input.plan)
          throw new Error("parent belongs to another plan");
        // A task with neither plan nor parent is loose, whatever plans are open: a small fix
        // needs no plan. It joins a plan only through its parent (a phase, or the plan's #n).
        const taskPlan = parent?.plan ?? null;
        if (input.status === "in_progress" && taskPlan !== null) refuseOther(taskPlan);
        const flight = input.status === "in_progress" ? startCheck(taskPlan) : {};
        // The task and its blockers go in one transaction: a refused blocker leaves no task. A
        // task made in progress also puts its plan in flight, in the same write.
        const task = value(
          writeWork(store, () => {
            const made = insertTask(
              store,
              {
                project: ctx.project,
                subject: input.subject,
                ...(input.description === undefined ? {} : { description: input.description }),
                ...bindings(input),
                ...(input.status === undefined ? {} : { status: input.status }),
                ...(input.type === undefined ? {} : { type: input.type }),
                parentId: parent?.id ?? null,
                plan: taskPlan,
                blockedBy,
              },
              who,
              now,
            );
            if (input.status === "in_progress") enterFlight(taskPlan, flight);
            return made;
          }),
        );
        const byId = new Map(allTasks(store, ctx.project).map((t) => [t.id, t]));
        return {
          ok: true,
          text: [
            `${label(task)}${parent ? ` under #${parent.number}` : ""}`,
            ...marks(task, byId),
          ].join(" · "),
        };
      }
      if (operation === "update") {
        const input = taskSchemas.update.parse(raw);
        if (isDeployTaskId(input.task)) {
          if (
            Object.keys(bindings(input)).length ||
            input.parent !== undefined ||
            input.blocked_by_add !== undefined ||
            input.blocked_by_remove !== undefined ||
            input.files !== undefined
          )
            throw new Error("Deploy tasks have no parent, blocked-by, files or builder bindings");
          if (input.status !== undefined && input.status !== "open")
            throw new Error(
              `A deploy task closes through ${TASK_TOOL.done} (done with evidence, dropped with a note); status open reopens a closed one`,
            );
          // A blocking task that turns non-blocking, or moves after the deploy, no longer holds
          // the gate: that is a drop by another name, so it is the person's too (D14). Judged on
          // the task as it is now, closed or open, so a reopen cannot carry the change.
          const current = project(input.task);
          if (options.refuseBlockingDrop && current.type === "blocking") {
            if (input.type === "non-blocking")
              throw new Error(
                personOnly(
                  current.id,
                  "weakens a blocking deploy task",
                  `set ${current.id} --type non-blocking`,
                ),
              );
            if (input.deploy === "after" && current.deploy === "before")
              throw new Error(
                personOnly(
                  current.id,
                  "weakens a blocking deploy task",
                  `set ${current.id} --deploy after`,
                ),
              );
          }
          const patch = {
            ...(input.subject === undefined ? {} : { title: input.subject }),
            ...(input.description === undefined ? {} : { body: input.description }),
            ...(input.deploy === undefined ? {} : { deploy: input.deploy }),
            ...(input.type === undefined ? {} : { type: input.type }),
            ...(input.flags === undefined ? {} : { flags: input.flags }),
            ...(input.refs === undefined ? {} : { refs: input.refs }),
            ...(input.from === undefined ? {} : { from: input.from }),
          };
          // Reopen first, so a call that also edits fields edits the reopened file.
          const reopened =
            input.status === "open"
              ? reopenDeployTask(projectDir(), input.task, new Date(now))
              : undefined;
          const task =
            Object.keys(patch).length > 0
              ? updateDeployTask(projectDir(), input.task, patch, new Date(now))
              : (reopened ?? project(input.task));
          return {
            ok: true,
            text: `${task.id} "${task.title}" · ${input.status === "open" ? "open again" : "updated"} · ${wroteIn(task)}`,
          };
        }
        refuseDeployFields({
          deploy: input.deploy,
          flags: input.flags,
          refs: input.refs,
          from: input.from,
        });
        // Narrowed here, once: the closures below keep this type, `input.status` would not.
        const { status } = input;
        if (status === "open")
          throw new Error(
            "status open reopens a closed deploy task; a work task is pending or in_progress",
          );
        const task = work(input.task);
        if (input.files !== undefined && task.kind !== "plan")
          throw new Error(
            `${label(task)} is a ${task.kind}: only a plan task has a file list (set files on the plan's own #n)`,
          );
        const listed = input.files === undefined ? undefined : filesWrite(input.files);
        // A dropped phase coming back is a phase laid again: the cap judges it.
        if (
          task.kind === "phase" &&
          task.status === "dropped" &&
          (status === "pending" || status === "in_progress") &&
          task.plan !== null
        ) {
          const cap = phaseCap();
          refuseOverCap(all, task.plan, cap);
        }
        const starting = status === "in_progress" && task.status !== "in_progress";
        const destination = input.parent ? work(input.parent) : null;
        // The plan the task is in after this call (moving to the top keeps it). A running task
        // moved into another plan puts work there, so it is a start in that plan: the one-plan
        // rule judges it, and the plan goes in flight.
        const landing = destination === null ? task.plan : destination.plan;
        const entering =
          starting || (landing !== task.plan && (status ?? task.status) === "in_progress");
        if (starting) refuseEmptyPhase(all, task);
        if (entering && landing !== null) refuseOther(landing);
        refuseParkWhileBusy(all, task, status);
        if (input.parent !== undefined) refuseStepEscape(all, task, destination);
        // This call carries no evidence or note, so a step cannot close here.
        if (status === "done" || status === "dropped") refuseBareClose(all, task, status, {});
        // The plan that goes in flight is judged against the plans held for others (`startCheck`).
        const flight = entering ? startCheck(task.kind === "plan" ? task.plan : landing) : {};
        // Starting work puts its plan in flight, in the same write (a plan's own start sets it).
        const updated = value(
          writeWork(store, () => {
            const changed = applyUpdate(
              store,
              task.id,
              {
                ...(input.subject === undefined ? {} : { subject: input.subject }),
                ...(input.description === undefined ? {} : { description: input.description }),
                ...bindings(input),
                ...(status === undefined ? {} : { status: status }),
                ...(input.parent === undefined
                  ? {}
                  : { parentId: input.parent === null ? null : work(input.parent).id }),
                ...(input.type === undefined ? {} : { type: input.type }),
                ...flight,
                ...listed,
                waitsFor: {
                  add: (input.blocked_by_add ?? []).map((r) => work(r).id),
                  remove: (input.blocked_by_remove ?? []).map((r) => work(r).id),
                },
              },
              who,
              now,
            );
            if (entering && task.kind !== "plan") enterFlight(landing, flight);
            return changed;
          }),
        );
        const afterAll = allTasks(store, ctx.project);
        const byId = new Map(afterAll.map((t) => [t.id, t]));
        const closed = updated.status === "done" || updated.status === "dropped";
        return {
          ok: true,
          text:
            [label(updated), updated.status.replaceAll("_", " "), ...marks(updated, byId)].join(
              " · ",
            ) + (closed ? freedAfter(afterAll, updated) : ""),
        };
      }
      if (operation === "done") {
        const input = taskSchemas.done.parse(raw);
        if (isDeployTaskId(input.task)) {
          const task = project(input.task);
          if (
            options.refuseBlockingDrop &&
            input.outcome === "dropped" &&
            task.status === "open" &&
            task.type === "blocking"
          )
            throw new Error(
              personOnly(
                task.id,
                "drops a blocking deploy task",
                `drop ${task.id} --note "<reason>"`,
              ),
            );
          const closed = closeDeployTask(
            projectDir(),
            task.id,
            {
              status: input.outcome,
              ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
              ...(input.note === undefined ? {} : { note: input.note }),
            },
            new Date(now),
          );
          return {
            ok: true,
            text: `${task.id} "${task.title}" · ${input.outcome} · ${wroteIn(closed)}`,
          };
        }
        const task = work(input.task);
        refuseBareClose(all, task, input.outcome, { evidence: input.evidence, note: input.note });
        // One transaction: a close the store refuses (an open blocking task) keeps no note either, so
        // a retry after finishing the task saves each note once.
        const changed = value(
          writeWork(store, () => {
            for (const text of [input.note, input.evidence])
              if (text) insertNote(store, task.id, text, who, now);
            return applyUpdate(store, task.id, { status: input.outcome }, who, now);
          }),
        );
        return {
          ok: true,
          text: `${label(changed)} · ${input.outcome}${freedAfter(allTasks(store, ctx.project), changed)}`,
        };
      }
      if (operation === "note") {
        const input = taskSchemas.note.parse(raw);
        if (isDeployTaskId(input.task)) {
          const noted = addDeployNote(projectDir(), input.task, input.text, new Date(now));
          return { ok: true, text: `${input.task} · note saved · ${wroteIn(noted)}` };
        }
        value(writeWork(store, () => insertNote(store, work(input.task).id, input.text, who, now)));
        return { ok: true, text: `${input.task} · note saved` };
      }
      if (operation === "get") {
        const input = taskSchemas.get.parse(raw);
        const text = isDeployTaskId(input.task)
          ? (() => {
              // A deploy task's history is its file's git log: every commit that changed it,
              // across its move into `archive/`. `--follow` loses the move with `--reverse`
              // (seen on git 2.53), so the lines are put oldest first here.
              const file = project(input.task).file;
              const text = readFileSync(file, "utf8");
              const here = deployContext();
              const root = here.ok ? here.checkoutRoot : null;
              if (root === null) return text;
              const elsewhere = otherDeployRoot();
              const body = elsewhere === null ? text : `${deployTasksIn(elsewhere)}\n${text}`;
              // A branch with no commit yet has no log at all: git's own answer, not its message.
              const head = runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"], env);
              if (!head.ok && head.code === 1)
                return `${body.trimEnd()}\n\nHistory: not committed yet.`;
              const log = runGit(
                root,
                [
                  "log",
                  "--follow",
                  "--date=iso-strict",
                  "--format=%ad %an %h %s",
                  "--",
                  relative(root, file),
                ],
                env,
              );
              const history = !log.ok
                ? `History: git could not read it (${log.err})`
                : log.out
                  ? `History (git, oldest first):\n${log.out.split("\n").reverse().join("\n")}`
                  : "History: not committed yet.";
              return `${body.trimEnd()}\n\n${history}`;
            })()
          : (() => {
              if (OLD_TASK_ID.test(input.task)) throw new Error(OLD_ID_ANSWER);
              const task = getTask(store, ctx.project, input.task);
              if (!task) {
                // A deleted task is gone from the list, not from its history.
                const gone = deletedHistory(store, ctx.project, input.task);
                const last = gone.at(-1);
                if (!last) throw new Error(`Task not found: ${input.task}`);
                return `#${last.number} "${String(last.changes.subject?.[0] ?? "")}" [deleted]\n\n${historyText(gone, { full: input.history })}`;
              }
              const notes = notesOf(store, task)
                .map((n) => `${new Date(n.at).toISOString()} ${n.text}`)
                .join("\n");
              const byId = new Map(all.map((t) => [t.id, t]));
              const blockers = task.waitsFor
                .map((id) => byId.get(id))
                .filter((t) => t !== undefined)
                .sort((a, b) => a.number - b.number)
                .map((t) => `${label(t)} (${t.status.replaceAll("_", " ")})`);
              // Only the parts that hold something, a blank line between them.
              return [
                [
                  `${label(task)} [${stateWords(task, byId, true)}]`,
                  ...(["agent", "branch", "worktree", "base"] as const).flatMap((key) =>
                    task[key] === null
                      ? []
                      : [`${key[0]?.toUpperCase()}${key.slice(1)}: ${task[key]}`],
                  ),
                  ...(blockers.length ? [`Blocked by: ${blockers.join(", ")}`] : []),
                  ...(task.files.length ? [`Files: ${task.files.join(", ")}`] : []),
                  ...(task.lead === null
                    ? []
                    : [
                        `Reserved for: session ${task.lead.sessionId ?? `process ${task.lead.pid}`} (${task.lead.holder === "child" ? "a child builds it" : "the lead builds it"}) · hand-out id ${task.lead.handoutId}`,
                      ]),
                ].join("\n"),
                task.description,
                notes,
                historyText(eventsOf(store, task), { full: input.history }),
              ]
                .filter((part) => part !== "")
                .join("\n\n");
            })();
        return { ok: true, text: page(text, input.offset) };
      }
      if (operation === "delete") {
        const input = taskSchemas.delete.parse(raw);
        if (isDeployTaskId(input.task)) {
          const task = project(input.task);
          // What a session may not do to an open blocking task is the person's: a tracked file
          // closes (drop), it is never deleted, so the command named depends on the file's state.
          const guarded =
            options.refuseBlockingDrop && task.status === "open" && task.type === "blocking";
          const trackedRefusal = guarded
            ? personOnly(
                task.id,
                "drops a blocking deploy task",
                `drop ${task.id} --note "<reason>"`,
              )
            : DELETE_TRACKED;
          const root = deployRoot();
          const tracked = runGit(
            root,
            ["ls-files", "--error-unmatch", "--", relative(root, task.file)],
            env,
          );
          if (tracked.ok) throw new Error(trackedRefusal);
          // A failed git command is not evidence that a file is untracked. Check the index separately.
          const index = runGit(root, ["ls-files", "--", relative(root, task.file)], env);
          if (!index.ok) throw new Error(`Could not read git's index: ${index.err}`);
          if (index.out) throw new Error(trackedRefusal);
          if (guarded)
            throw new Error(
              personOnly(task.id, "deletes a blocking deploy task", `delete ${task.id}`),
            );
          rmSync(task.file);
          return {
            ok: true,
            text: `${input.task} · deleted · ${relative(root, task.file)} · removed from ${root}`,
          };
        }
        const result = deleteTask(store, work(input.task).id, who, now);
        if (!result.ok) throw new Error(`${result.why}; drop it instead`);
        return { ok: true, text: `${input.task} · deleted` };
      }
      let selected: WorkTask[];
      let projects: DeployTask[] = [];
      let planLedger = false;
      if (operation === "search") {
        const input = taskSchemas.search.parse(raw);
        selected = searchTasks(store, ctx.project, input.text).filter(
          (t) => input.include_closed || isOpen(t),
        );
        if (deployReadable())
          projects = projectTasks(input.include_closed).filter(
            (t) =>
              (input.include_closed || t.status === "open") &&
              `${t.title}\n${t.body}`.toLowerCase().includes(input.text.toLowerCase()),
          );
      } else {
        const input = taskSchemas.list.parse(raw);
        planLedger = input.scope === "plan";
        const openOnly = input.scope !== "all" && input.scope !== "plan" && input.open_only;
        selected = all.filter((t) => !openOnly || isOpen(t));
        if (input.scope === "mine") {
          selected = selected.filter(owns);
          // A terminal without Claude identity owns the tasks made without a session.
          if (!caller)
            selected = all.filter((t) => t.createdBy === null && (!openOnly || isOpen(t)));
        } else if (input.scope === "plan") {
          // Only this read may show another session's plan: the project's newest, when the
          // caller has none of its own. Nothing written ever takes it.
          const shown =
            input.plan ??
            ownPlan ??
            all
              .filter((t) => t.kind === "plan")
              .sort((a, b) => b.updatedAt - a.updatedAt || b.number - a.number)[0]?.plan ??
            null;
          const ownPlans = new Set(
            all
              .filter(owns)
              .map((t) => t.plan)
              .filter((p) => p !== null && ownsPlan(all, owns, p)),
          );
          selected = selected.filter(
            (t) =>
              t.kind !== "task" &&
              (input.plan === undefined && ownPlans.size > 1
                ? t.plan !== null && ownPlans.has(t.plan)
                : shown !== null && t.plan === shown),
          );
        } else if (deployReadable())
          projects = projectTasks(!openOnly).filter((t) => !openOnly || t.status === "open");
      }
      const selectedIds = new Set(selected.map((t) => t.id));
      const byId = new Map(all.map((t) => [t.id, t]));
      const lines: string[] = [];
      // A plan's phases against the cap, on the plan ledger only. A cap that cannot be read
      // (a broken workflow file) leaves the count alone and says why on a line of its own.
      let cap: number | null = null;
      let capWhy: string | null = null;
      if (planLedger) {
        try {
          cap = phaseCap().max;
        } catch (error) {
          capWhy = `plans.maxPhases cannot be read: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      const visit = (task: WorkTask, depth: number) => {
        const count = subtreeProgress(all, task.id);
        const progress =
          (count.total || task.kind === "phase" ? ` · ${count.closed}/${count.total}` : "") +
          (task.kind === "plan" && (cap !== null || capWhy !== null)
            ? ` · ${planNote(all, task, cap)}`
            : "");
        const binding =
          task.kind === "phase"
            ? ` · agent ${task.agent ?? "none"} · branch ${task.branch ?? "none"}`
            : "";
        const state = claimState(task, CLAIM_PROCESS, who);
        // On the plan ledger an open plan says where it stands in the queue; a plan with a
        // `parked:` note counts as parked only once it is not running (`planQueueState`).
        const queue =
          planLedger && task.kind === "plan" && isOpen(task)
            ? planQueueState(
                all,
                task,
                notesOf(store, task).some((n) => n.text.startsWith(PARK_NOTE_PREFIX)),
              )
            : undefined;
        lines.push(
          `${"  ".repeat(depth)}#${task.number} [${stateWords(task, byId, false, queue)}] ${task.subject}${progress}${binding}${state === "another session" ? " (another session)" : ""}`,
        );
        for (const child of selected.filter((t) => t.parentId === task.id)) visit(child, depth + 1);
      };
      for (const task of selected.filter((t) => !t.parentId || !selectedIds.has(t.parentId)))
        visit(task, 0);
      const elsewhere = projects.length > 0 ? otherDeployRoot() : null;
      if (elsewhere !== null) lines.push(deployTasksIn(elsewhere));
      lines.push(...projects.map(projectLine));
      if (capWhy !== null) lines.push(capWhy);
      return { ok: true, text: capped(lines), data: { work: selected, project: projects } };
    } catch (error) {
      return {
        ok: false,
        why: (error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, " "),
      };
    }
  }
  function call(operation: TaskOperation, raw: unknown): TaskAnswer {
    const notes: string[] = [];
    const answer = run(operation, raw, notes);
    return answer.ok && notes.length > 0
      ? { ...answer, text: [answer.text, ...notes].join("\n") }
      : answer;
  }
  return {
    call,
    close: () => {
      db?.close();
      db = undefined;
    },
  };
}
