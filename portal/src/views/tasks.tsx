"use client";

/**
 * The Tasks tab (D76, `/tasks`): every project's work on this machine as Plan › Phase › Task ›
 * Subtask, then what each project still owes in its task files. Read-only: a session changes a
 * task with its task tools, a person with `cc-smart-dev-kit task`. The filters live in the
 * address (`?project=<id>&show=recent&blocked=1&type=non-blocking`), so a link opens the tab as
 * it was, and the project page's card opens it on one project.
 */

import { FilterXIcon, FolderGit2Icon, ListChecksIcon, SearchXIcon } from "lucide-react";
import { useId } from "react";
import { useResource } from "@/api/hooks";
import { TASKS_REFRESH } from "@/api/refresh";
import type { TasksData, TasksProjectData } from "@/api/types";
import { AppLink, useAppQuery, useAppQueryReady, useSetAppQuery } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { EmptyState, LoadingState, PagePad, ResourceView } from "@/components/states";
import { TonePill } from "@/components/status";
import { TaskLegend } from "@/components/task-tree";
import { TasksBody } from "@/components/tasks-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KIT_NAME } from "@/lib/format";
import {
  addCounts,
  fileCountsOf,
  filterTasks,
  isDefaultFilter,
  matchCount,
  NO_WORK,
  narrowsWork,
  narrowWords,
  queryOfView,
  type TaskView,
  taskViewOf,
  workCountsOf,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** True when a project has something the tab shows: work tasks, files owed, or a fault. */
function hasAnything(one: TasksProjectData): boolean {
  const { work, files } = one.tasks;
  return (
    work.state === "unreadable" ||
    (work.state === "ready" && work.tasks.length > 0) ||
    files.state === "unavailable" ||
    files.tasks.length > 0 ||
    files.broken > 0
  );
}

/**
 * True when the whole tab shows the project's card: it has something, and when the filter
 * narrows the work (blocked, non-blocking), something under the filter.
 */
function shownOnAll(one: TasksProjectData, view: TaskView): boolean {
  if (!narrowsWork(view)) return hasAnything(one);
  const { work } = one.tasks;
  return work.state === "ready" && matchCount(filterTasks(work.tasks, view)) > 0;
}

function TasksStats({ projects }: { projects: readonly TasksProjectData[] }) {
  const work = projects.reduce((sum, one) => addCounts(sum, workCountsOf(one.tasks.work)), NO_WORK);
  const files = projects.reduce(
    (sum, one) => {
      const counts = fileCountsOf(one.tasks.files);
      return {
        open: sum.open + counts.open,
        blocksRelease: sum.blocksRelease + counts.blocksRelease,
      };
    },
    { open: 0, blocksRelease: 0 },
  );
  return (
    <SectionCards>
      <StatCard
        label="Open work"
        value={work.open}
        headline={`${work.inProgress} in progress`}
        detail="Every layer counted: phases, tasks and subtasks"
      />
      <StatCard
        label="Blocked"
        value={work.blocked}
        badge={
          work.blocked > 0 ? (
            <TonePill tone="warn">waiting</TonePill>
          ) : (
            <TonePill tone="ok">none</TonePill>
          )
        }
        headline="Waiting for another open task"
        detail="It cannot start or be done until that one closes"
      />
      <StatCard
        label="Non-blocking"
        value={work.nonBlocking}
        headline="Noted work that holds nothing"
        detail="Its parent can be done while it stays open"
      />
      <StatCard
        label={projects.length === 1 ? "Owed by the project" : "Owed by the projects"}
        value={files.open}
        badge={
          files.blocksRelease > 0 ? (
            <TonePill tone="bad">{files.blocksRelease} block the release</TonePill>
          ) : undefined
        }
        headline="Open task files in the repositories"
        detail="Production, database, teammates and follow-ups"
      />
    </SectionCards>
  );
}

function Filters({
  data,
  view,
  onView,
}: {
  data: TasksData;
  view: TaskView;
  onView: (view: TaskView) => void;
}) {
  const projectId = useId();
  const blockedId = useId();
  const typeId = useId();
  return (
    <search aria-label="Filters" className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
      {data.projects.length > 1 && (
        <>
          <label htmlFor={projectId} className="sr-only">
            Project
          </label>
          <NativeSelect
            id={projectId}
            size="sm"
            value={view.project ?? ""}
            onChange={(event) => onView({ ...view, project: event.target.value || null })}
            className={cn(
              "max-w-full",
              view.project === null ? "text-muted-foreground" : "font-medium",
            )}
          >
            <NativeSelectOption value="">All projects</NativeSelectOption>
            {data.projects.map((one) => (
              <NativeSelectOption key={one.project.id} value={one.project.id}>
                {`${one.project.name} · ${workCountsOf(one.tasks.work).open} open`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className="mx-1 hidden h-5 w-px bg-border @3xl/main:block" aria-hidden="true" />
        </>
      )}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view.show}
        aria-label="Which tasks"
        onValueChange={(next) => {
          if (next === "open" || next === "recent") onView({ ...view, show: next });
        }}
      >
        <ToggleGroupItem value="open" aria-label="Open tasks only" className="px-2.5">
          Open
        </ToggleGroupItem>
        <ToggleGroupItem
          value="recent"
          aria-label="Open tasks, and those closed recently"
          className="px-2.5"
        >
          Recent
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="flex items-center gap-2 px-1">
        <Switch
          id={blockedId}
          size="sm"
          checked={view.blocked}
          onCheckedChange={(blocked) => onView({ ...view, blocked })}
        />
        <Label htmlFor={blockedId} className="text-sm font-normal">
          Blocked only
        </Label>
      </div>
      <div className="flex items-center gap-2 px-1">
        <Switch
          id={typeId}
          size="sm"
          checked={view.nonBlocking}
          onCheckedChange={(nonBlocking) => onView({ ...view, nonBlocking })}
        />
        <Label htmlFor={typeId} className="text-sm font-normal">
          Non-blocking only
        </Label>
      </div>
      {!isDefaultFilter(view) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView({ ...view, show: "open", blocked: false, nonBlocking: false })}
        >
          <FilterXIcon data-icon="inline-start" aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </search>
  );
}

function ProjectTasks({
  one,
  view,
  onView,
}: {
  one: TasksProjectData;
  view: TaskView;
  onView: (view: TaskView) => void;
}) {
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId} role="region">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <FolderGit2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="wrap-any">{one.project.name}</span>
            {one.project.current && <TonePill tone="info">the portal's folder</TonePill>}
          </h2>
        </CardTitle>
        <CardDescription className="font-mono text-xs wrap-any">{one.project.path}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <AppLink
              href={`/settings/project?id=${encodeURIComponent(one.project.id)}`}
              aria-label={`Open ${one.project.name}'s project page`}
            >
              Project page
            </AppLink>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <TasksBody
          data={one.tasks}
          filter={view}
          onFilter={(filter) => onView({ ...view, ...filter })}
        />
      </CardContent>
    </Card>
  );
}

/** The tab once its answer is there: the counts, the filters, the key, then each project. */
export function TasksPage({
  data,
  view,
  onView,
}: {
  data: TasksData;
  view: TaskView;
  onView: (view: TaskView) => void;
}) {
  if (data.projects.length === 0) {
    return (
      <PagePad>
        <EmptyState
          title="No projects yet"
          icon={<ListChecksIcon className="size-6 text-muted-foreground" aria-hidden="true" />}
        >
          <p>
            A project shows here once Claude Code has worked in it, or once you add its folder on
            Settings. Its tasks come from a session's task tools (
            <code className="font-mono">task_create</code>) or{" "}
            <code className="font-mono">{KIT_NAME} task add</code>.
          </p>
          {data.note !== null && <p className="mt-2">{data.note}</p>}
          <Button asChild variant="outline" size="sm" className="mt-3">
            <AppLink href="/settings">Open Settings</AppLink>
          </Button>
        </EmptyState>
      </PagePad>
    );
  }
  const picked =
    view.project === null
      ? null
      : (data.projects.find((one) => one.project.id === view.project) ?? null);
  const unknown = view.project !== null && picked === null;
  const scope = picked === null ? data.projects : [picked];
  const shown = picked === null ? scope.filter((one) => shownOnAll(one, view)) : scope;
  const quiet = scope.filter((one) => !shown.includes(one));
  return (
    <>
      <TasksStats projects={scope} />
      <Filters data={data} view={unknown ? { ...view, project: null } : view} onView={onView} />
      <PagePad className="flex flex-col gap-4 md:gap-6">
        {unknown && (
          <Alert>
            <SearchXIcon aria-hidden="true" />
            <AlertTitle>No project on this machine has that id</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>Every project is shown instead. Open it again from its project page.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onView({ ...view, project: null })}
              >
                Show every project
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <TaskLegend />
        {shown.length === 0 &&
          (narrowsWork(view) ? (
            <EmptyState title="Nothing matches the filters">
              <p>No {narrowWords(view)} task in any project.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => onView({ ...view, blocked: false, nonBlocking: false })}
              >
                <FilterXIcon data-icon="inline-start" aria-hidden="true" />
                Clear the filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              title="No tasks in any project"
              icon={<ListChecksIcon className="size-6 text-muted-foreground" aria-hidden="true" />}
            >
              A session makes a task with its task tools (
              <code className="font-mono">task_create</code>), you with{" "}
              <code className="font-mono">{KIT_NAME} task add</code>. A project owes something once
              its repository has a task file.
            </EmptyState>
          ))}
        {shown.map((one) => (
          <ProjectTasks key={one.project.id} one={one} view={view} onView={onView} />
        ))}
        {quiet.length > 0 && (
          <p className="text-sm text-pretty text-muted-foreground">
            {narrowsWork(view)
              ? `Nothing matches in ${quiet.length === 1 ? "1 more project" : `${quiet.length} more projects`}: `
              : `No tasks in ${quiet.length === 1 ? "1 more project" : `${quiet.length} more projects`}: `}
            {quiet.map((one, index) => (
              <span key={one.project.id}>
                {index > 0 && ", "}
                <button
                  type="button"
                  onClick={() => onView({ ...view, project: one.project.id })}
                  aria-label={`Show ${one.project.name} alone`}
                  className="rounded-sm underline underline-offset-4 wrap-any hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {one.project.name}
                </button>
              </span>
            ))}
            .
          </p>
        )}
      </PagePad>
    </>
  );
}

export function TasksView() {
  const ready = useAppQueryReady();
  const query = useAppQuery();
  const setQuery = useSetAppQuery();
  const view = taskViewOf(query);
  const tasks = useResource((client) => client.tasks(), "", TASKS_REFRESH);
  if (!ready) return <LoadingState label="the tasks" />;
  return (
    <ResourceView resource={tasks} label="the tasks">
      {(data) => (
        <TasksPage data={data} view={view} onView={(next) => setQuery(queryOfView(next, query))} />
      )}
    </ResourceView>
  );
}
