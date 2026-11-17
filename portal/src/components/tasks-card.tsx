"use client";

import { ArrowRightIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useId } from "react";
import { useResource } from "@/api/hooks";
import { TASKS_REFRESH } from "@/api/refresh";
import type {
  ProjectListRow,
  ProjectTaskFiles,
  ProjectTaskRow,
  ProjectTasksData,
  ProjectTaskTwin,
} from "@/api/types";
import { AppLink } from "@/components/router";
import { EmptyState } from "@/components/states";
import { StatusMark, type Tone, TonePill } from "@/components/status";
import { CannotRead } from "@/components/task-work";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, KIT_NAME } from "@/lib/format";
import {
  deploySectionsOf,
  fileCountsOf,
  filesMatching,
  tasksHref,
  workCountsOf,
} from "@/lib/tasks";

// ── Deploy tasks ───────────────────────────────────────────────────────────────────────

/** Each environment's heading. */
const ENV_TITLE: Record<ProjectTaskRow["env"], string> = { staging: "Staging", prod: "Prod" };

const DEPLOY_WORDS: Record<ProjectTaskRow["deploy"], string> = {
  before: "before the deploy",
  after: "after the deploy",
};

/** Blocking holds the deploy gate; non-blocking is done, or dropped with a reason. */
const TYPE_MARK: Record<ProjectTaskRow["type"], { tone: Tone; words: string }> = {
  blocking: { tone: "bad", words: "blocking" },
  "non-blocking": { tone: "info", words: "non-blocking" },
};

/** The linked twin's state: still open, or naming no task, wants a look. */
const TWIN_MARK: Record<ProjectTaskTwin["status"], { tone: Tone; words: string }> = {
  open: { tone: "warn", words: "still open" },
  missing: { tone: "warn", words: "which names no task" },
  done: { tone: "ok", words: "done" },
  dropped: { tone: "info", words: "dropped" },
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
  const type = TYPE_MARK[task.type];
  const twin = task.twin === null ? null : TWIN_MARK[task.twin.status];
  return (
    <li className="flex flex-col gap-1.5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 font-medium wrap-any">{task.title}</span>
        <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TonePill tone="info">{DEPLOY_WORDS[task.deploy]}</TonePill>
        <TonePill tone={type.tone}>{type.words}</TonePill>
        {task.stale && <TonePill tone="warn">open over {staleDays} days</TonePill>}
        {task.flags.map((flag) => (
          <Badge key={flag} variant="outline" className="text-muted-foreground">
            {FLAG_WORDS[flag] ?? flag}
          </Badge>
        ))}
      </div>
      {task.twin !== null && twin !== null && (
        <p className="text-xs text-muted-foreground">
          <StatusMark tone={twin.tone}>
            Paired with <code className="font-mono">{task.twin.id}</code>, {twin.words}
          </StatusMark>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        <span className="font-mono wrap-any">{task.file}</span> · written{" "}
        <time dateTime={task.created} title={task.created}>
          {ago(task.created)}
        </time>
      </p>
    </li>
  );
}

/** What stops the deploy gate or is left unread beside the tasks: each with what to do. */
function LeftOver({ files }: { files: Extract<ProjectTaskFiles, { state: "ready" }> }) {
  const [onlyId] = files.duplicateIds;
  return (
    <>
      {files.duplicateIds.length > 0 && (
        <Alert className="border-warn/40">
          <TriangleAlertIcon className="text-warn" aria-hidden="true" />
          <AlertTitle>
            {files.duplicateIds.length === 1 && onlyId !== undefined ? (
              <>
                Id <code className="font-mono">{onlyId}</code> is claimed by more than one file
              </>
            ) : (
              `${files.duplicateIds.length} ids are each claimed by more than one file`
            )}
          </AlertTitle>
          <AlertDescription>
            {files.duplicateIds.length > 1 && (
              <code className="font-mono wrap-any">{files.duplicateIds.join(", ")}</code>
            )}
            <span>
              Rename the id inside one of them: the deploy gate refuses while it is.{" "}
              <code className="font-mono">{KIT_NAME} task check</code> names the files.
            </span>
          </AlertDescription>
        </Alert>
      )}
      {files.broken > 0 && (
        <Alert className="border-warn/40">
          <TriangleAlertIcon className="text-warn" aria-hidden="true" />
          <AlertTitle>
            {files.broken === 1 ? "1 file does not" : `${files.broken} files do not`} read as a task
          </AlertTitle>
          <AlertDescription>
            <span>
              <code className="font-mono">{KIT_NAME} task check</code> names each one and why. The
              deploy gate refuses while one is there.
            </span>
          </AlertDescription>
        </Alert>
      )}
      {files.old > 0 && (
        <Alert className="border-warn/40">
          <TriangleAlertIcon className="text-warn" aria-hidden="true" />
          <AlertTitle>
            {files.old === 1 ? "1 old task file is" : `${files.old} old task files are`} not read
          </AlertTitle>
          <AlertDescription>
            <span>
              They sit straight in <code className="font-mono">{files.dir}</code>, the layout before
              deploy tasks: recreate each as a deploy task, or delete it.{" "}
              <code className="font-mono">{KIT_NAME} task check</code> names them.
            </span>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

/**
 * The project's deploy tasks on the Tasks tab's Files tab: a section per environment, in the
 * order a release visits them, each task before the deploy then after, blocking first. `q`
 * keeps the tasks whose title or id holds the words.
 */
export function FilesSection({ files, q = "" }: { files: ProjectTaskFiles; q?: string }) {
  const titleId = useId();
  const searching = q.trim() !== "";
  const matching = files.state === "ready" ? filesMatching(files.tasks, q) : [];
  const counts = fileCountsOf(files);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="font-semibold">
          Owed by the project
        </h3>
        {files.state === "ready" && (
          <span className="text-xs text-muted-foreground">
            {counts.open} open, {counts.blocking} blocking in{" "}
            <code className="font-mono">{files.dir}</code> · {files.closed} closed
          </span>
        )}
      </div>
      {files.state === "unavailable" ? (
        <CannotRead title="The deploy tasks cannot be read" why={files.why} />
      ) : (
        <>
          <LeftOver files={files} />
          {files.tasks.length === 0 ? (
            <EmptyState title="No deploy step owed">
              No open deploy task in <code className="font-mono">{files.dir}</code>: nothing waits
              before or after a deploy to {files.envs.join(" or ")}.
            </EmptyState>
          ) : matching.length === 0 ? (
            <EmptyState title="Nothing matches the search">
              No open deploy task here holds “{q.trim()}” in its title or id.
            </EmptyState>
          ) : (
            deploySectionsOf(files.envs, matching).map(({ env, tasks }) => {
              if (searching && tasks.length === 0) return null;
              return (
                <div key={env} className="flex flex-col gap-2">
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {ENV_TITLE[env]} · {tasks.length}
                  </h4>
                  {tasks.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      Nothing owed before or after a {env} deploy.
                    </p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {tasks.map((task) => (
                        // Two files can claim one id: the file is the one unique key.
                        <FileRow key={task.file} task={task} staleDays={files.staleDays} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
          <p className="flex items-start gap-1.5 text-xs text-pretty text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Read from the main checkout. A deploy task still on a branch counts once that branch
              merges; <code className="font-mono">{KIT_NAME} task list --branches</code> lists
              those.
            </span>
          </p>
        </>
      )}
    </section>
  );
}

// ── The project page's card ─────────────────────────────────────────────────────────

/** The project page's line: what is open and owed, counted, and the way to the Tasks tab. */
function TasksSummary({ data }: { data: ProjectTasksData }) {
  if (data.work.state === "unreadable" && data.files.state === "unavailable") {
    return <>The tasks cannot be read: {data.work.why}</>;
  }
  const work = workCountsOf(data.work);
  const files = fileCountsOf(data.files);
  const workWords =
    data.work.state === "unreadable"
      ? "The task list cannot be read"
      : data.work.state === "none"
        ? "No work tasks yet"
        : [
            `${work.open} open`,
            work.inProgress > 0 && `${work.inProgress} in progress`,
            work.blocked > 0 && `${work.blocked} blocked`,
          ]
            .filter((part) => part !== false)
            .join(", ");
  const fileWords =
    data.files.state !== "ready"
      ? "the deploy tasks cannot be read"
      : files.open === 0
        ? "no deploy step owed"
        : `${files.open} deploy ${files.open === 1 ? "task" : "tasks"} open${files.blocking > 0 ? `, ${files.blocking} blocking` : ""}`;
  return (
    <>
      {workWords} · {fileWords}
    </>
  );
}

/** A project's Tasks card: one line that counts its tasks and opens the Tasks tab on it. */
export function TasksCard({ project }: { project: ProjectListRow }) {
  const tasks = useResource((client) => client.projectTasks(project.id), project.id, TASKS_REFRESH);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardDescription aria-live="polite" className="text-pretty">
          {tasks.status === "loading" ? (
            <>
              <span className="sr-only">Reading the project's tasks…</span>
              <Skeleton className="mt-1 h-4 w-48" />
            </>
          ) : tasks.status === "error" ? (
            <>The tasks could not be read: {tasks.message}</>
          ) : (
            <TasksSummary data={tasks.data} />
          )}
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <AppLink href={tasksHref(project.id)} aria-label={`Open ${project.name} in Tasks`}>
              Open in Tasks
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </AppLink>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
