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
} from "@/api/types";
import { AppLink } from "@/components/router";
import { EmptyState } from "@/components/states";
import { TonePill } from "@/components/status";
import { CannotRead } from "@/components/task-work";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KIT_NAME } from "@/lib/format";
import { fileCountsOf, filesMatching, tasksHref, workCountsOf } from "@/lib/tasks";

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

/**
 * The project's task files on the Tasks tab's Files tab: the open ones by kind, what blocks a
 * release first. `q` keeps the files whose title or id holds the words.
 */
export function FilesSection({ files, q = "" }: { files: ProjectTaskFiles; q?: string }) {
  const titleId = useId();
  const matching = files.state === "ready" ? filesMatching(files.tasks, q) : [];
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
          ) : matching.length === 0 ? (
            <EmptyState title="Nothing matches the search">
              No open task file here holds “{q.trim()}” in its title or id.
            </EmptyState>
          ) : (
            KINDS.map(({ kind, title }) => {
              const group = matching.filter((task) => task.kind === kind);
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
      ? "the task files cannot be read"
      : files.open === 0
        ? "nothing owed"
        : `${files.open} owed${files.blocksRelease > 0 ? `, ${files.blocksRelease} blocking the release` : ""}`;
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
