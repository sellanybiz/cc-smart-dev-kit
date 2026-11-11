"use client";

/**
 * The Tasks tab (D76, `/tasks`): every project's work on this machine as Session › Plan › Phase
 * › Task, and, on its own tab, what each project still owes in its task files. Each level folds
 * (remembered in this browser), the filter bar narrows it, the list shows a page of rows at a
 * time, and a row opens the task in a side panel, where a plan or a task can move to another
 * session. The view lives in the address (`?project=…&status=blocked&session=…&q=…&task=<id>`),
 * so a link opens the tab as it was.
 */

import {
  ChevronRightIcon,
  FilterXIcon,
  FolderGit2Icon,
  ListChecksIcon,
  SearchXIcon,
} from "lucide-react";
import { useId } from "react";
import { useResource } from "@/api/hooks";
import { TASKS_REFRESH } from "@/api/refresh";
import type { TasksData, TasksProjectData, WorkTaskNode } from "@/api/types";
import { AppLink, useAppQuery, useAppQueryReady, useSetAppQuery } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { EmptyState, LoadingState, PagePad, ResourceView } from "@/components/states";
import { TonePill } from "@/components/status";
import { TaskFilters } from "@/components/task-filters";
import { TaskPanel } from "@/components/task-panel";
import { TaskLegend } from "@/components/task-tree";
import { type TreeUi, WorkSection } from "@/components/task-work";
import { FilesSection } from "@/components/tasks-card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFolds } from "@/hooks/use-folds";
import { KIT_NAME } from "@/lib/format";
import {
  filterGroups,
  findTask,
  foldKey,
  isOpen,
  plansOf,
  sessionGroupsOf,
  sessionsOf,
} from "@/lib/task-groups";
import {
  addCounts,
  DEFAULT_FILTER,
  fileCountsOf,
  filesMatching,
  NO_WORK,
  narrowsWork,
  narrowWords,
  queryOfView,
  type TaskView,
  taskViewOf,
  workCountsOf,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** True when a project has work to show: tasks, or a store it cannot read. */
function hasWork(one: TasksProjectData): boolean {
  const { work } = one.tasks;
  return work.state === "unreadable" || (work.state === "ready" && work.tasks.length > 0);
}

/** True when a project has files to show: open ones, broken ones, or a folder it cannot read. */
function hasFiles(one: TasksProjectData): boolean {
  const { files } = one.tasks;
  return files.state === "unavailable" || files.tasks.length > 0 || files.broken > 0;
}

/**
 * True when the whole tab shows the project's card: on the work tab, it has work and, when the
 * filter narrows it, something under the filter; on the files tab, files the search keeps.
 */
function shownOnAll(one: TasksProjectData, view: TaskView): boolean {
  if (view.tab === "files") {
    const { files } = one.tasks;
    if (view.q.trim() === "") return hasFiles(one);
    return files.state === "ready" && filesMatching(files.tasks, view.q).length > 0;
  }
  if (!narrowsWork(view)) return hasWork(one);
  const { work } = one.tasks;
  return (
    work.state === "ready" &&
    filterGroups(sessionGroupsOf(work.tasks, work.sessions), view).length > 0
  );
}

/** True when any project holds work with no session recorded. */
function anyUnplaced(projects: readonly TasksProjectData[]): boolean {
  return projects.some(
    (one) =>
      one.tasks.work.state === "ready" &&
      one.tasks.work.tasks.some((root) => root.session === null),
  );
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
        detail="Every layer counted: plans, phases and tasks"
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

function ProjectCard({
  one,
  view,
  onView,
  ui,
}: {
  one: TasksProjectData;
  view: TaskView;
  onView: (view: TaskView) => void;
  ui: TreeUi;
}) {
  const titleId = useId();
  const bodyId = useId();
  const key = foldKey.project(one.project.id);
  // A search opens every card it finds something in.
  const open = view.q.trim() !== "" || isOpen(ui.folds, key);
  return (
    <Card aria-labelledby={titleId} role="region">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => ui.setFolds([key], open)}
              className="inline-flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ChevronRightIcon
                data-open={open}
                className="size-4 shrink-0 text-muted-foreground transition-transform data-[open=true]:rotate-90 motion-reduce:transition-none"
                aria-hidden="true"
              />
              <FolderGit2Icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="wrap-any">{one.project.name}</span>
            </button>
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
      <CardContent id={bodyId} hidden={!open} className="flex flex-col gap-6">
        {open &&
          (view.tab === "files" ? (
            <FilesSection files={one.tasks.files} q={view.q} />
          ) : (
            <WorkSection
              // A new filter starts the list at its first page again.
              key={JSON.stringify([
                view.status,
                view.nonBlocking,
                view.q,
                view.session,
                view.plan,
                view.live,
              ])}
              projectId={one.project.id}
              work={one.tasks.work}
              filter={view}
              onFilter={(filter) => onView({ ...view, ...filter })}
              ui={ui}
            />
          ))}
      </CardContent>
    </Card>
  );
}

/** What the tab says when no card is left: nothing matches, or nothing is there at all. */
function NothingShown({ view, onView }: { view: TaskView; onView: (view: TaskView) => void }) {
  if (view.tab === "files") {
    return view.q.trim() !== "" ? (
      <EmptyState title="Nothing matches the search">
        <p>No open task file in any project holds “{view.q.trim()}” in its title or id.</p>
      </EmptyState>
    ) : (
      <EmptyState title="Nothing owed in any project">
        A project owes something once its repository has an open task file (
        <code className="font-mono">{KIT_NAME} task add --kind production</code> and the like).
      </EmptyState>
    );
  }
  if (narrowsWork(view)) {
    return (
      <EmptyState title="Nothing matches the filters">
        <p>No {narrowWords(view) || "matching"} task in any project.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => onView({ ...view, ...DEFAULT_FILTER })}
        >
          <FilterXIcon data-icon="inline-start" aria-hidden="true" />
          Clear the filters
        </Button>
      </EmptyState>
    );
  }
  return (
    <EmptyState
      title="No tasks in any project"
      icon={<ListChecksIcon className="size-6 text-muted-foreground" aria-hidden="true" />}
    >
      A session makes a task with its task tools (<code className="font-mono">task_create</code>),
      you with <code className="font-mono">{KIT_NAME} task add</code>.
    </EmptyState>
  );
}

/** The tab once its answer is there: the counts, the tabs, the filters, then each project. */
export function TasksPage({
  data,
  view,
  onView,
  onRefresh = () => {},
}: {
  data: TasksData;
  view: TaskView;
  onView: (view: TaskView) => void;
  /** Read the tasks again (after a move). */
  onRefresh?: () => void;
}) {
  const { folds, setFolds } = useFolds();
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
  const ui: TreeUi = {
    folds,
    setFolds,
    selected: view.task,
    onOpen: (task: WorkTaskNode) => onView({ ...view, task: task.id }),
  };
  const shownView = unknown ? { ...view, project: null } : view;
  const work = scope.reduce((sum, one) => addCounts(sum, workCountsOf(one.tasks.work)), NO_WORK);
  const owed = scope.reduce((sum, one) => sum + fileCountsOf(one.tasks.files).open, 0);
  const cards = (
    <PagePad className="flex flex-col gap-4 md:gap-6">
      {unknown && (
        <Alert>
          <SearchXIcon aria-hidden="true" />
          <AlertTitle>No project on this machine has that id</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Every project is shown instead. Open it again from its project page.</span>
            <Button variant="outline" size="sm" onClick={() => onView({ ...view, project: null })}>
              Show every project
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {view.tab === "work" && <TaskLegend />}
      {shown.length === 0 && <NothingShown view={view} onView={onView} />}
      {shown.map((one) => (
        <ProjectCard key={one.project.id} one={one} view={view} onView={onView} ui={ui} />
      ))}
      {quiet.length > 0 && (
        <p className="text-sm text-pretty text-muted-foreground">
          {narrowsWork(view) || view.q.trim() !== ""
            ? `Nothing matches in ${quiet.length === 1 ? "1 more project" : `${quiet.length} more projects`}: `
            : `Nothing here in ${quiet.length === 1 ? "1 more project" : `${quiet.length} more projects`}: `}
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
  );
  return (
    <>
      <TasksStats projects={scope} />
      <Tabs
        value={view.tab}
        onValueChange={(tab) => onView({ ...view, tab: tab === "files" ? "files" : "work" })}
        className="gap-4"
      >
        <div className="px-4 lg:px-6">
          <TabsList aria-label="Work or files">
            <TabsTrigger value="work" className="px-3">
              Work on this machine · {work.open} open
            </TabsTrigger>
            <TabsTrigger value="files" className="px-3">
              Owed by {scope.length === 1 ? "the project" : "the projects"} · {owed}
            </TabsTrigger>
          </TabsList>
        </div>
        <TaskFilters
          data={data}
          view={shownView}
          sessions={sessionsOf(scope)}
          plans={plansOf(scope)}
          unplaced={anyUnplaced(scope)}
          onView={onView}
        />
        <TabsContent value="work" className={cn("text-base")}>
          {view.tab === "work" && cards}
        </TabsContent>
        <TabsContent value="files" className="text-base">
          {view.tab === "files" && cards}
        </TabsContent>
      </Tabs>
      {view.task !== null && (
        <TaskPanel
          key={view.task}
          id={view.task}
          found={findTask(data.projects, view.task)}
          onClose={() => onView({ ...view, task: null })}
          onChanged={onRefresh}
        />
      )}
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
        <TasksPage
          data={data}
          view={view}
          onView={(next) => setQuery(queryOfView(next, query))}
          onRefresh={tasks.refresh}
        />
      )}
    </ResourceView>
  );
}
