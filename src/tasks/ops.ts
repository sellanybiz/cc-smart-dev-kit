import { readFileSync, rmSync } from "node:fs";
import { relative } from "node:path";
import { type TaskOperation, taskSchemas } from "./schemas";

export type { TaskOperation } from "./schemas";

import { cliPaths } from "../cli/paths";
import { runGit } from "../hooks/git";
import { taskContext } from "./context";
import {
  addProjectNote,
  closeProjectTask,
  createProjectTask,
  scanProjectTasks,
  updateProjectTask,
} from "./project/files";
import type { ProjectTask } from "./project/format";
import { TASK_TOOL } from "./words";
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./work/db";
import { historyText } from "./work/history";
import { callerOf, claimLive } from "./work/identity";
import {
  allTasks,
  claimHeldBy,
  claimState,
  deletedHistory,
  eventsOf,
  getTask,
  isOpen,
  layerOf,
  notesOf,
  openBlockers,
  searchTasks,
  subtreeProgress,
} from "./work/queries";
import {
  ack,
  applyUpdate,
  deleteTask,
  insertNote,
  insertTask,
  layPhase,
  planTask,
  takeTasks,
  updateTask,
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

export const TASK_LINE_CAP = 200;
export const TASK_TEXT_CAP = 20_000;
export type TaskAnswer = { ok: true; text: string; data?: unknown } | { ok: false; why: string };
export interface TaskOpsOptions {
  stateDir?: string;
  env?: Record<string, string | undefined>;
  caller?: () => (Who & { cwd: string }) | null;
  cwd?: () => string;
  now?: () => number;
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.why);
  return result.value;
}
function label(task: WorkTask): string {
  return `#${task.number} "${task.subject}"`;
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
 * every layer, for `task_get`), then its `marks`.
 */
function stateWords(
  task: WorkTask,
  byId: ReadonlyMap<string, WorkTask>,
  withLayer = false,
): string {
  const layer = layerOf(task, byId);
  return [
    ...(withLayer ? [layer] : []),
    task.status.replaceAll("_", " "),
    ...(!withLayer && layer === "plan" ? ["plan"] : []),
    ...(!withLayer && layer === "phase" ? [`phase ${task.phase ?? ""}`.trim()] : []),
    ...marks(task, byId),
  ].join(" · ");
}
export function projectLine(task: ProjectTask): string {
  return `${task.id} [${[task.kind, task.when, task.weight].filter(Boolean).join(" · ")}] ${task.title}`;
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
  const stateDir = options.stateDir ?? cliPaths(env).stateDir;
  let db: WorkDb | undefined;
  const database = () => (db ??= openWorkDb(workDbFile({ stateDir }), { mode: "write" }));
  function call(operation: TaskOperation, raw: unknown): TaskAnswer {
    try {
      const caller = options.caller ? options.caller() : callerOf({ env });
      const who: Who = caller ?? { sessionId: null, pid: null, procStart: null };
      const cwd = caller?.cwd ?? options.cwd?.() ?? process.cwd();
      const ctx = taskContext(cwd, env);
      if (!ctx.ok) throw new Error(ctx.why);
      const now = options.now?.() ?? Date.now();
      const store = database();
      const all = allTasks(store, ctx.project);
      // The caller's own task: one it made (a caller with no session id made none), or one its
      // process claims.
      const owns = (t: WorkTask) =>
        (who.sessionId !== null && t.createdBy === who.sessionId) || claimHeldBy(t.claim, who);
      // The caller's own plan, from its latest own task with a plan: what a new task or phase
      // takes. Never another session's plan, or that session's phases would count as the
      // caller's (`openPhasesOf`).
      const ownPlan = [...all].reverse().find((t) => t.plan !== null && owns(t))?.plan ?? null;
      const projectDir = () => {
        if (!ctx.projectTasks.ok) throw new Error(ctx.projectTasks.why);
        return ctx.projectTasks.dir;
      };
      const projectTasks = (archive: boolean) => scanProjectTasks(projectDir(), { archive }).tasks;
      const work = (reference: string) => {
        const task = getTask(store, ctx.project, reference);
        if (!task) throw new Error(`Task not found: ${reference}`);
        return task;
      };
      const project = (reference: string) => {
        const task = projectTasks(true).find((t) => t.id === reference);
        if (!task) throw new Error(`Project task not found: ${reference}`);
        return task;
      };
      const acked = (id: string) =>
        !!store.sqlite
          .query("SELECT 1 FROM acks WHERE project=? AND task_ref=?")
          .get(ctx.project, id);
      if (operation === "take") {
        const input = taskSchemas.take.parse(raw);
        if (!caller?.sessionId) throw new Error("take needs a resolvable calling session");
        const target =
          all.find((t) => t.kind === "plan" && t.plan === input.task) ?? work(input.task);
        const moved = value(
          takeTasks(store, ctx.project, target.id, who, now, {
            ...(input.from === undefined ? {} : { from: input.from }),
            force: input.force,
            isLive: claimLive,
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
            input.type ||
            input.phase ||
            input.plan
          )
            throw new Error(
              "Project tasks have no parent, blocked-by, work status, type, phase or plan",
            );
          const branch = ctx.checkoutRoot
            ? runGit(ctx.checkoutRoot, ["branch", "--show-current"], env)
            : null;
          if (!branch?.ok) throw new Error("Could not read the current branch");
          const from = input.from ?? `branch ${branch.out}`;
          const task = createProjectTask(
            projectDir(),
            {
              title: input.subject,
              kind: input.kind,
              ...(input.description === undefined ? {} : { body: input.description }),
              ...(input.when === undefined ? {} : { when: input.when }),
              ...(input.weight === undefined ? {} : { weight: input.weight }),
              ...(input.flags === undefined ? {} : { flags: input.flags }),
              ...(input.refs === undefined ? {} : { refs: input.refs }),
              from,
            },
            { now: new Date(now), random: Math.random },
          );
          return {
            ok: true,
            text: `${task.id} "${task.title}" · ${relative(ctx.checkoutRoot ?? cwd, task.file)} · commit it with your branch`,
          };
        }
        // Every blocker is found before anything is written: a wrong one leaves no task behind.
        const blockedBy = input.blocked_by?.map((r) => work(r).id) ?? [];
        if (input.phase !== undefined || input.plan !== undefined) {
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
              "A plan's own task takes a subject only: give phase to lay out a phase, with its description, type and blockers",
            );
          const slug = input.plan ?? ownPlan;
          if (slug === null) throw new Error("A phase belongs to a plan: give plan (its slug)");
          if (input.phase === undefined) {
            const there = allTasks(store, ctx.project).some(
              (t) => t.kind === "plan" && t.plan === slug,
            );
            const made = value(
              writeWork(store, () =>
                planTask(
                  store,
                  { project: ctx.project, plan: slug, subject: input.subject },
                  who,
                  now,
                ),
              ),
            );
            return {
              ok: true,
              text: `${label(made)} · plan ${slug}${there ? " · it was there already" : ""}`,
            };
          }
          const phaseId = input.phase;
          if (!isPhaseId(phaseId))
            throw new Error(`The phase "${phaseId}" is not one: a phase is ${PHASE_RULE}`);
          const laid = value(
            writeWork(store, () =>
              layPhase(
                store,
                {
                  project: ctx.project,
                  plan: slug,
                  phase: phaseId,
                  subject: input.subject,
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
        // The task and its blockers go in one transaction: a refused blocker leaves no task.
        const task = value(
          writeWork(store, () =>
            insertTask(
              store,
              {
                project: ctx.project,
                subject: input.subject,
                ...(input.description === undefined ? {} : { description: input.description }),
                ...bindings(input),
                ...(input.status === undefined ? {} : { status: input.status }),
                ...(input.type === undefined ? {} : { type: input.type }),
                parentId: parent?.id ?? null,
                plan: parent?.plan ?? ownPlan,
                blockedBy,
              },
              who,
              now,
            ),
          ),
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
        if (input.task.startsWith("T-")) {
          if (
            Object.keys(bindings(input)).length ||
            input.status !== undefined ||
            input.parent !== undefined ||
            input.type !== undefined ||
            input.blocked_by_add !== undefined ||
            input.blocked_by_remove !== undefined
          )
            throw new Error(
              "Project task status changes only through task_done; project tasks have no parent, type or blocked-by",
            );
          const task = updateProjectTask(
            projectDir(),
            input.task,
            {
              ...(input.subject === undefined ? {} : { title: input.subject }),
              ...(input.description === undefined ? {} : { body: input.description }),
              ...(input.when === undefined ? {} : { when: input.when }),
              ...(input.weight === undefined ? {} : { weight: input.weight }),
              ...(input.flags === undefined ? {} : { flags: input.flags }),
              ...(input.refs === undefined ? {} : { refs: input.refs }),
              ...(input.from === undefined ? {} : { from: input.from }),
            },
            new Date(now),
          );
          return { ok: true, text: `${task.id} "${task.title}" · updated` };
        }
        const task = work(input.task);
        const updated = value(
          updateTask(
            store,
            task.id,
            {
              ...(input.subject === undefined ? {} : { subject: input.subject }),
              ...(input.description === undefined ? {} : { description: input.description }),
              ...bindings(input),
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.parent === undefined
                ? {}
                : { parentId: input.parent === null ? null : work(input.parent).id }),
              ...(input.type === undefined ? {} : { type: input.type }),
              waitsFor: {
                add: (input.blocked_by_add ?? []).map((r) => work(r).id),
                remove: (input.blocked_by_remove ?? []).map((r) => work(r).id),
              },
            },
            who,
            now,
          ),
        );
        const byId = new Map(allTasks(store, ctx.project).map((t) => [t.id, t]));
        return {
          ok: true,
          text: [label(updated), updated.status.replaceAll("_", " "), ...marks(updated, byId)].join(
            " · ",
          ),
        };
      }
      if (operation === "done") {
        const input = taskSchemas.done.parse(raw);
        if (input.task.startsWith("T-")) {
          const task = project(input.task);
          if (task.kind === "teammate" && !input.for_everyone && input.outcome === "done") {
            value(ack(store, ctx.project, task.id, now));
            return { ok: true, text: `${task.id} "${task.title}" · done on this machine` };
          }
          closeProjectTask(
            projectDir(),
            task.id,
            {
              status: input.outcome,
              ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
              ...(input.note === undefined ? {} : { note: input.note }),
            },
            new Date(now),
          );
          return { ok: true, text: `${task.id} "${task.title}" · ${input.outcome}` };
        }
        const task = work(input.task);
        // One transaction: a close the store refuses (an open subtask) keeps no note either, so
        // a retry after finishing the subtask saves each note once.
        const changed = value(
          writeWork(store, () => {
            for (const text of [input.note, input.evidence])
              if (text) insertNote(store, task.id, text, who, now);
            return applyUpdate(store, task.id, { status: input.outcome }, who, now);
          }),
        );
        return { ok: true, text: `${label(changed)} · ${input.outcome}` };
      }
      if (operation === "note") {
        const input = taskSchemas.note.parse(raw);
        if (input.task.startsWith("T-")) {
          addProjectNote(projectDir(), input.task, input.text, new Date(now));
        } else
          value(
            writeWork(store, () => insertNote(store, work(input.task).id, input.text, who, now)),
          );
        return { ok: true, text: `${input.task} · note saved` };
      }
      if (operation === "get") {
        const input = taskSchemas.get.parse(raw);
        const text = input.task.startsWith("T-")
          ? (() => {
              // A project task's history is its file's git log: every commit that changed it,
              // across its move into `archive/`. `--follow` loses the move with `--reverse`
              // (seen on git 2.53), so the lines are put oldest first here.
              const file = project(input.task).file;
              const body = readFileSync(file, "utf8");
              if (!ctx.checkoutRoot) return body;
              // A branch with no commit yet has no log at all: git's own answer, not its message.
              const head = runGit(
                ctx.checkoutRoot,
                ["rev-parse", "--verify", "--quiet", "HEAD"],
                env,
              );
              if (!head.ok && head.code === 1)
                return `${body.trimEnd()}\n\nHistory: not committed yet.`;
              const log = runGit(
                ctx.checkoutRoot,
                [
                  "log",
                  "--follow",
                  "--date=iso-strict",
                  "--format=%ad %an %h %s",
                  "--",
                  relative(ctx.checkoutRoot, file),
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
        if (input.task.startsWith("T-")) {
          const task = project(input.task);
          if (!ctx.checkoutRoot) throw new Error("Project tasks need a checkout");
          const tracked = runGit(
            ctx.checkoutRoot,
            ["ls-files", "--error-unmatch", "--", relative(ctx.checkoutRoot, task.file)],
            env,
          );
          if (tracked.ok)
            throw new Error("Tracked project task: drop it with task_done outcome dropped");
          // A failed git command is not evidence that a file is untracked. Check the index separately.
          const index = runGit(
            ctx.checkoutRoot,
            ["ls-files", "--", relative(ctx.checkoutRoot, task.file)],
            env,
          );
          if (!index.ok) throw new Error(`Could not read git's index: ${index.err}`);
          if (index.out)
            throw new Error("Tracked project task: drop it with task_done outcome dropped");
          rmSync(task.file);
        } else {
          const result = deleteTask(store, work(input.task).id, who, now);
          if (!result.ok) throw new Error(`${result.why}; drop it instead`);
        }
        return { ok: true, text: `${input.task} · deleted` };
      }
      let selected: WorkTask[];
      let projects: ProjectTask[] = [];
      if (operation === "search") {
        const input = taskSchemas.search.parse(raw);
        selected = searchTasks(store, ctx.project, input.text).filter(
          (t) => input.include_closed || isOpen(t),
        );
        if (ctx.projectTasks.ok)
          projects = projectTasks(input.include_closed).filter(
            (t) =>
              (input.include_closed || t.status === "open") &&
              `${t.title}\n${t.body}`.toLowerCase().includes(input.text.toLowerCase()),
          );
      } else {
        const input = taskSchemas.list.parse(raw);
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
              .filter((p) => p !== null),
          );
          selected = selected.filter(
            (t) =>
              t.kind !== "task" &&
              (input.plan === undefined && ownPlans.size > 1
                ? t.plan !== null && ownPlans.has(t.plan)
                : shown !== null && t.plan === shown),
          );
        } else if (ctx.projectTasks.ok)
          projects = projectTasks(!openOnly).filter(
            (t) =>
              (!openOnly || t.status === "open") &&
              (input.scope === "all" || t.kind !== "teammate" || !acked(t.id)),
          );
      }
      const selectedIds = new Set(selected.map((t) => t.id));
      const byId = new Map(all.map((t) => [t.id, t]));
      const lines: string[] = [];
      const visit = (task: WorkTask, depth: number) => {
        const count = subtreeProgress(all, task.id);
        const progress =
          count.total || task.kind === "phase" ? ` · ${count.closed}/${count.total}` : "";
        const binding =
          task.kind === "phase"
            ? ` · agent ${task.agent ?? "none"} · branch ${task.branch ?? "none"}`
            : "";
        const state = claimState(task, claimLive, who);
        lines.push(
          `${"  ".repeat(depth)}#${task.number} [${stateWords(task, byId)}] ${task.subject}${progress}${binding}${state === "another session" ? " (another session)" : ""}`,
        );
        for (const child of selected.filter((t) => t.parentId === task.id)) visit(child, depth + 1);
      };
      for (const task of selected.filter((t) => !t.parentId || !selectedIds.has(t.parentId)))
        visit(task, 0);
      lines.push(...projects.map(projectLine));
      return { ok: true, text: capped(lines), data: { work: selected, project: projects } };
    } catch (error) {
      return {
        ok: false,
        why: (error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, " "),
      };
    }
  }
  return {
    call,
    close: () => {
      db?.close();
      db = undefined;
    },
  };
}
