import { readFileSync, rmSync } from "node:fs";
import { relative } from "node:path";
import { type TaskOperation, taskSchemas } from "./schemas";

export type { TaskOperation } from "./schemas";

import { cliPaths } from "../cli/paths";
import { leadSessions, listLeads, readCrew } from "../crew/store";
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
import { openWorkDb, type WorkDb, workDbFile, writeWork } from "./work/db";
import { historyText } from "./work/history";
import { callerOf, claimLive } from "./work/identity";
import {
  allTasks,
  claimState,
  descendants,
  eventsOf,
  getTask,
  isOpen,
  notesOf,
  searchTasks,
  subtreeProgress,
} from "./work/queries";
import { ack, deleteTask, insertNote, insertTask, updateTask } from "./work/store";
import type { Result, Who, WorkTask } from "./work/types";

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
      const who: Who = caller ?? { sessionId: null, crewId: null, pid: null, procStart: null };
      const cwd = caller?.cwd ?? options.cwd?.() ?? process.cwd();
      const ctx = taskContext(cwd, env);
      if (!ctx.ok) throw new Error(ctx.why);
      const now = options.now?.() ?? Date.now();
      const store = database();
      const all = allTasks(store, ctx.project);
      const phase = who.crewId
        ? all.find((t) => t.kind === "phase" && t.crewId === who.crewId)
        : undefined;
      const lead =
        ctx.repo && who.sessionId
          ? listLeads(stateDir, ctx.repo).records.find(
              (l) => !l.endedAt && leadSessions(l).includes(who.sessionId ?? ""),
            )
          : undefined;
      const crew = ctx.repo && who.crewId ? readCrew(stateDir, ctx.repo, who.crewId) : null;
      const plan = phase?.plan ?? lead?.plan ?? crew?.plan ?? null;
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
      if (operation === "create") {
        const input = taskSchemas.create.parse(raw);
        if (input.kind !== "work") {
          if (input.parent || input.waits_for?.length || input.status)
            throw new Error("Project tasks have no parent, waits-for or work status");
          const branch = ctx.checkoutRoot
            ? runGit(ctx.checkoutRoot, ["branch", "--show-current"], env)
            : null;
          if (!branch?.ok) throw new Error("Could not read the current branch");
          const from =
            input.from ??
            `branch ${branch.out}${crew ? ` · plan ${crew.plan} · phase ${crew.phase}` : ""}`;
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
        const parent = input.parent ? work(input.parent) : phase;
        // Validate every dependency before creating a task; failed creation must not leave a task behind.
        const waits = input.waits_for?.map((r) => work(r).id) ?? [];
        // The task and its waits-for rows go in one transaction: a failed dependency leaves no task.
        const task = value(
          writeWork(store, () => {
            const made = insertTask(
              store,
              {
                project: ctx.project,
                subject: input.subject,
                ...(input.description === undefined ? {} : { description: input.description }),
                ...(input.status === undefined ? {} : { status: input.status }),
                parentId: parent?.id ?? null,
                plan: parent?.plan ?? plan,
                crewId: who.crewId,
              },
              who,
              now,
            );
            for (const id of waits)
              store.sqlite.query("INSERT INTO task_deps VALUES (?,?)").run(made.id, id);
            return made;
          }),
        );
        return { ok: true, text: `${label(task)}${parent ? ` under #${parent.number}` : ""}` };
      }
      if (operation === "update") {
        const input = taskSchemas.update.parse(raw);
        if (input.task.startsWith("T-")) {
          if (
            input.status !== undefined ||
            input.parent !== undefined ||
            input.waits_for_add !== undefined ||
            input.waits_for_remove !== undefined
          )
            throw new Error(
              "Project task status changes only through task_done; project tasks have no parent or waits-for",
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
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.parent === undefined
                ? {}
                : { parentId: input.parent === null ? null : work(input.parent).id }),
              waitsFor: {
                add: (input.waits_for_add ?? []).map((r) => work(r).id),
                remove: (input.waits_for_remove ?? []).map((r) => work(r).id),
              },
            },
            who,
            now,
          ),
        );
        return { ok: true, text: `${label(updated)} · ${updated.status.replaceAll("_", " ")}` };
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
        for (const text of [input.note, input.evidence])
          if (text) value(writeWork(store, () => insertNote(store, task.id, text, who, now)));
        const changed = value(updateTask(store, task.id, { status: input.outcome }, who, now));
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
              const task = work(input.task);
              const notes = notesOf(store, task)
                .map((n) => `${new Date(n.at).toISOString()} ${n.text}`)
                .join("\n");
              // Only the parts that hold something, a blank line between them.
              return [
                `${label(task)} [${task.status.replaceAll("_", " ")}]`,
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
        const openOnly = input.scope !== "all" && input.open_only;
        selected = all.filter((t) => !openOnly || isOpen(t));
        if (input.scope === "mine") {
          const subtree = new Set(
            phase ? [phase.id, ...descendants(store, phase.id).map((t) => t.id)] : [],
          );
          const sessions = new Set(
            lead ? leadSessions(lead) : who.sessionId ? [who.sessionId] : [],
          );
          selected = selected.filter(
            (t) =>
              subtree.has(t.id) ||
              (t.kind === "task" &&
                ((t.createdBy !== null && sessions.has(t.createdBy)) ||
                  (who.pid !== null &&
                    t.claim?.pid === who.pid &&
                    t.claim.procStart === who.procStart))),
          );
          // A terminal without Claude identity owns the tasks made without a session.
          if (!caller)
            selected = all.filter((t) => t.createdBy === null && (!openOnly || isOpen(t)));
        } else if (input.scope === "plan")
          selected = selected.filter((t) => plan !== null && t.plan === plan);
        else if (ctx.projectTasks.ok)
          projects = projectTasks(!openOnly).filter(
            (t) =>
              (!openOnly || t.status === "open") &&
              (input.scope === "all" || t.kind !== "teammate" || !acked(t.id)),
          );
      }
      const selectedIds = new Set(selected.map((t) => t.id));
      const lines: string[] = [];
      const visit = (task: WorkTask, depth: number) => {
        const count = subtreeProgress(all, task.id);
        const progress = count.total ? ` · ${count.closed}/${count.total}` : "";
        const state = claimState(task, claimLive, who);
        lines.push(
          `${"  ".repeat(depth)}#${task.number} [${task.status.replaceAll("_", " ")}] ${task.subject}${progress}${state === "another session" ? " (another session)" : ""}`,
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
