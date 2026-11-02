"use client";

/**
 * The kit's task list on the portal (D75), read-only: a project's Tasks card (its work tree on
 * this machine and the task files its repository keeps) and a crew page's phase tree. A session
 * changes a task with its task tools, a person with `cc-smart-dev-kit task`; the page only
 * shows them, and reads again when the work store changes (the `tasks` event).
 */

import { InfoIcon, ListChecksIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useId } from "react";
import { useResource } from "@/api/hooks";
import { TASKS_CARD_REFRESH } from "@/api/refresh";
import type {
  CrewPhaseTasks,
  ProjectListRow,
  ProjectTaskFiles,
  ProjectTaskRow,
  ProjectTasksData,
  ProjectWorkTasks,
  WorkTaskNode,
} from "@/api/types";
import { EmptyState } from "@/components/states";
import { TonePill } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { KIT_NAME } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Work tasks: the tree ───────────────────────────────────────────────────────────────

/** Each status's glyph, its colour and its words: the glyph's shape carries it without colour. */
const STATUS: Record<WorkTaskNode["status"], { glyph: string; tone: string; words: string }> = {
  pending: { glyph: "○", tone: "text-muted-foreground", words: "pending" },
  in_progress: { glyph: "◐", tone: "text-primary", words: "in progress" },
  done: { glyph: "✓", tone: "text-ok", words: "done" },
  dropped: { glyph: "–", tone: "text-muted-foreground", words: "dropped" },
};

function closedStatus(status: WorkTaskNode["status"]): boolean {
  return status === "done" || status === "dropped";
}

/** How far a subtree is: a thin bar and `closed/total`. The native meter speaks; the SVG draws. */
function Progress({ closed, total }: { closed: number; total: number }) {
  const share = total === 0 ? 0 : Math.min(1, closed / total);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <meter className="sr-only" min={0} max={total} value={closed}>
        {closed} of {total} closed
      </meter>
      <svg className="h-1.5 w-12" aria-hidden="true" preserveAspectRatio="none">
        <rect width="100%" height="100%" rx="3" className="fill-muted" />
        <rect width={`${share * 100}%`} height="100%" rx="3" className="fill-ok" />
      </svg>
      <span aria-hidden="true">
        {closed}/{total}
      </span>
    </span>
  );
}

function TaskRow({ task }: { task: WorkTaskNode }) {
  const status = STATUS[task.status];
  const closed = closedStatus(task.status);
  return (
    <li>
      <div className="flex items-start gap-2 py-1">
        <span
          className={cn("w-3.5 shrink-0 text-center font-semibold", status.tone)}
          aria-hidden="true"
          title={status.words}
        >
          {status.glyph}
        </span>
        <span className="w-9 shrink-0 font-mono text-xs leading-5 text-muted-foreground tabular-nums">
          {task.ref}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn(
              "min-w-0 text-sm wrap-any",
              closed && "text-muted-foreground",
              task.status === "dropped" && "line-through decoration-muted-foreground/60",
            )}
          >
            <span className="sr-only">{status.words}: </span>
            {task.subject}
          </span>
          {(task.kind !== "task" || task.total > 0) && (
            <span className="flex flex-wrap items-center gap-2">
              {task.kind === "plan" && <Badge variant="outline">plan</Badge>}
              {task.kind === "phase" && <Badge variant="outline">phase {task.phase ?? ""}</Badge>}
              {task.total > 0 && <Progress closed={task.closed} total={task.total} />}
            </span>
          )}
        </div>
      </div>
      {task.children.length > 0 && <TaskList tasks={task.children} nested />}
    </li>
  );
}

function TaskList({
  tasks,
  nested = false,
  label,
}: {
  tasks: WorkTaskNode[];
  nested?: boolean;
  label?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn("flex flex-col", nested && "ml-1.5 border-l border-border pl-4")}
    >
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  );
}

function openCount(tasks: WorkTaskNode[]): number {
  return tasks.reduce(
    (sum, task) => sum + (closedStatus(task.status) ? 0 : 1) + openCount(task.children),
    0,
  );
}

function CannotRead({ title, why }: { title: string; why: string }) {
  return (
    <Alert className="border-bad/40">
      <TriangleAlertIcon className="text-bad" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="wrap-any">{why}</AlertDescription>
    </Alert>
  );
}

function WorkSection({ work }: { work: ProjectWorkTasks }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="font-semibold">
          Work on this machine
        </h3>
        {work.state === "ready" && work.tasks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {openCount(work.tasks)} open · closed ones stay {work.recentDays} days
          </span>
        )}
      </div>
      {work.state === "unreadable" ? (
        <CannotRead
          title="The task list cannot be read"
          why={`${work.why}. ${KIT_NAME} doctor checks the store.`}
        />
      ) : work.state === "none" ? (
        <EmptyState
          title="No work tasks here yet"
          icon={<ListChecksIcon className="size-6 text-muted-foreground" aria-hidden="true" />}
        >
          A session's tasks show here once it makes one, with its task tools or{" "}
          <code className="font-mono">{KIT_NAME} task add</code>. Every worktree of this project
          shares the list.
        </EmptyState>
      ) : work.tasks.length === 0 ? (
        <EmptyState title="Nothing open">
          No work task is open, and none closed in the last {work.recentDays} days.
        </EmptyState>
      ) : (
        <>
          <TaskList tasks={work.tasks} label="Work tasks" />
          {work.more > 0 && (
            <p className="text-xs text-muted-foreground">
              {work.more} more not shown:{" "}
              <code className="font-mono">{KIT_NAME} task list --scope all</code> lists every one.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ── Project task files ─────────────────────────────────────────────────────────────────

/** The kinds in the order a release reads them, each with its group's title. */
const KINDS: { kind: ProjectTaskRow["kind"]; title: string }[] = [
  { kind: "production", title: "Production" },
  { kind: "database", title: "Database" },
  { kind: "teammate", title: "Teammates" },
  { kind: "follow-up", title: "Follow-ups" },
];

const WEIGHT: Record<
  NonNullable<ProjectTaskRow["weight"]>,
  { tone: "bad" | "warn" | "info"; words: string }
> = {
  "blocks-release": { tone: "bad", words: "blocks the release" },
  "after-deploy": { tone: "warn", words: "after the deploy" },
  owner: { tone: "info", words: "the owner's call" },
};

const WHEN: Record<
  NonNullable<ProjectTaskRow["when"]>,
  { tone: "warn" | "info"; words: string }
> = {
  now: { tone: "warn", words: "now" },
  "next-release": { tone: "info", words: "next release" },
  any: { tone: "info", words: "any time" },
};

/** A flag's words; one this page does not know is shown as it is written. */
const FLAG_WORDS: Readonly<Record<string, string>> = {
  "needs-yes": "needs a yes",
  "twice-safe": "safe to run twice",
  "spends-money": "spends money",
  "real-people": "reaches real people",
  destructive: "destructive",
};

function FileRow({ task, staleDays }: { task: ProjectTaskRow; staleDays: number }) {
  return (
    <li className="flex flex-col gap-1.5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 font-medium wrap-any">{task.title}</span>
        <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
      </div>
      {(task.weight !== null || task.when !== null || task.stale || task.flags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {task.weight !== null && (
            <TonePill tone={WEIGHT[task.weight].tone}>{WEIGHT[task.weight].words}</TonePill>
          )}
          {task.when !== null && (
            <TonePill tone={WHEN[task.when].tone}>{WHEN[task.when].words}</TonePill>
          )}
          {task.stale && <TonePill tone="warn">open over {staleDays} days</TonePill>}
          {task.flags.map((flag) => (
            <Badge key={flag} variant="outline" className="text-muted-foreground">
              {FLAG_WORDS[flag] ?? flag}
            </Badge>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        <span className="font-mono wrap-any">{task.file}</span> · written {task.created}
      </p>
    </li>
  );
}

function FilesSection({ files }: { files: ProjectTaskFiles }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="font-semibold">
          Owed by the project
        </h3>
        {files.state === "ready" && (
          <span className="text-xs text-muted-foreground">
            {files.tasks.length} open in <code className="font-mono">{files.dir}</code> ·{" "}
            {files.closed} closed
          </span>
        )}
      </div>
      {files.state === "unavailable" ? (
        <CannotRead title="The task files cannot be read" why={files.why} />
      ) : (
        <>
          {files.broken > 0 && (
            <Alert className="border-warn/40">
              <TriangleAlertIcon className="text-warn" aria-hidden="true" />
              <AlertTitle>
                {files.broken === 1 ? "1 file does not" : `${files.broken} files do not`} read as a
                task
              </AlertTitle>
              <AlertDescription>
                <code className="font-mono">{KIT_NAME} task check</code> names each one and why.
              </AlertDescription>
            </Alert>
          )}
          {files.tasks.length === 0 ? (
            <EmptyState title="Nothing owed">
              No open task file in <code className="font-mono">{files.dir}</code>: nothing waits for
              production, the database or a teammate.
            </EmptyState>
          ) : (
            KINDS.map(({ kind, title }) => {
              const group = files.tasks.filter((task) => task.kind === kind);
              if (group.length === 0) return null;
              return (
                <div key={kind} className="flex flex-col gap-2">
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {title} · {group.length}
                  </h4>
                  <ul className="divide-y rounded-lg border">
                    {group.map((task) => (
                      <FileRow key={task.id} task={task} staleDays={files.staleDays} />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
          <p className="flex items-start gap-1.5 text-xs text-pretty text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Read from the main checkout. A task file still on a branch counts once that branch
              merges; <code className="font-mono">{KIT_NAME} task list --branches</code> lists
              those.
            </span>
          </p>
        </>
      )}
    </section>
  );
}

// ── The cards ──────────────────────────────────────────────────────────────────────────

/** The Tasks card's body once its answer is there: the work tree, then the task files. */
export function TasksBody({ data }: { data: ProjectTasksData }) {
  return (
    <>
      <WorkSection work={data.work} />
      <Separator />
      <FilesSection files={data.files} />
    </>
  );
}

/** A project's Tasks card: what is being worked on, and what the project still owes. */
export function TasksCard({ project }: { project: ProjectListRow }) {
  const tasks = useResource(
    (client) => client.projectTasks(project.id),
    project.id,
    TASKS_CARD_REFRESH,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardDescription className="text-pretty">
          What is being worked on, and what is still owed. Work tasks stay on this machine and every
          worktree shares them; task files live in the repository and travel with their branch. A
          session changes them with its task tools, you with{" "}
          <code className="font-mono">{KIT_NAME} task</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {tasks.status === "loading" ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-3">
            <span className="sr-only">Loading the project's tasks…</span>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-3/5" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : tasks.status === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-sm text-pretty text-bad">
              The project's tasks could not be read: {tasks.message}
            </p>
            <Button variant="outline" size="sm" onClick={tasks.reload}>
              <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : (
          <TasksBody data={tasks.data} />
        )}
      </CardContent>
    </Card>
  );
}

/** A crew page's card: its phase task, how far it is, and every subtask. */
export function PhaseTasksCard({ tasks }: { tasks: CrewPhaseTasks }) {
  const phase = tasks.state === "ready" ? tasks.phase : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardDescription className="text-pretty">
          Its phase task and the subtasks it broke the phase into. It hands back once each is done
          or dropped.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {tasks.state === "unreadable" ? (
          <CannotRead title="The task list cannot be read" why={tasks.why} />
        ) : tasks.state === "none" ? (
          <p className="text-sm text-muted-foreground">
            The kit's task list has no store on this machine yet.
          </p>
        ) : phase === null ? (
          <p className="text-sm text-pretty text-muted-foreground">
            This crew session started before the kit's task list, so it has no phase task.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 font-medium wrap-any">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{phase.ref}</span>
                {phase.subject}
              </span>
              {phase.total > 0 && <Progress closed={phase.closed} total={phase.total} />}
            </div>
            {phase.children.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No subtask yet: its first edit waits until it has one.
              </p>
            ) : (
              <TaskList tasks={phase.children} label="Its subtasks" />
            )}
            {tasks.state === "ready" && tasks.more > 0 && (
              <p className="text-xs text-muted-foreground">{tasks.more} more not shown.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
