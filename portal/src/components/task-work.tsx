"use client";

import {
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FilterXIcon,
  ListChecksIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useId, useState } from "react";
import type { ProjectWorkTasks, WorkTaskNode } from "@/api/types";
import { EmptyState } from "@/components/states";
import { SESSION_LEVEL, TaskList, TreeActionsProvider } from "@/components/task-tree";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { KIT_NAME } from "@/lib/format";
import {
  type Folds,
  filterGroups,
  foldKey,
  isOpen,
  PAGE_ROWS,
  pageRows,
  type SessionGroup,
  type ShownGroup,
  sessionGroupsOf,
  sessionLabel,
  taskOpen,
} from "@/lib/task-groups";
import {
  countTasks,
  DEFAULT_FILTER,
  narrowsWork,
  narrowWords,
  type TaskFilter,
  workCountsOf,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** What the page lends the tree: the remembered folds, the open task, and how to open one. */
export interface TreeUi {
  folds: Folds;
  setFolds: (keys: readonly string[], folded: boolean) => void;
  selected: null | string;
  onOpen: (task: WorkTaskNode) => void;
}

/** A static tree: every level at its default, nothing opens. */
export const STATIC_UI: TreeUi = {
  folds: {},
  setFolds: () => {},
  selected: null,
  onOpen: () => {},
};

export function CannotRead({ title, why }: { title: string; why: string }) {
  return (
    <Alert className="border-bad/40">
      <TriangleAlertIcon className="text-bad" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="wrap-any">{why}</AlertDescription>
    </Alert>
  );
}

/** Where a task comes from: the words every empty state ends with. */
function WhereTasksComeFrom() {
  return (
    <>
      A session makes one with its task tools (<code className="font-mono">task_create</code>), you
      with <code className="font-mono">{KIT_NAME} task add</code>. Every worktree of the project
      shares the list.
    </>
  );
}

/** Every fold key of a project's work: each session group, and each task with rows under it. */
function foldKeysOf(projectId: string, groups: readonly SessionGroup[]): string[] {
  const keys: string[] = [];
  const walk = (nodes: readonly WorkTaskNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) keys.push(foldKey.task(node.id));
      walk(node.children);
    }
  };
  for (const group of groups) {
    keys.push(foldKey.session(projectId, group.id));
    walk(group.roots);
  }
  return keys;
}

/** A session's heading: its fold button, its name, whether it runs now, and what it holds. */
function SessionHeading({
  group,
  open,
  controls,
  onFold,
}: {
  group: SessionGroup;
  open: boolean;
  controls: string;
  onFold: (open: boolean) => void;
}) {
  const counts = countTasks(group.roots);
  const plans = group.roots.filter((root) => root.kind === "plan").length;
  const name = sessionLabel(group);
  return (
    <h4 className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={() => onFold(!open)}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ChevronRightIcon
          data-open={open}
          className="size-4 shrink-0 text-muted-foreground transition-transform data-[open=true]:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span className="sr-only">{`${SESSION_LEVEL.words}: `}</span>
        <span className={cn("min-w-0 wrap-any", SESSION_LEVEL.text)}>{name}</span>
      </button>
      {group.session !== null &&
        (group.session.live ? (
          <span className="inline-flex items-center gap-1 text-xs text-ok">
            <span aria-hidden="true">●</span>
            running now
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span aria-hidden="true">○</span>
            not running
          </span>
        ))}
      <span className="text-xs font-normal text-muted-foreground">
        {[
          plans > 0 && (plans === 1 ? "1 plan" : `${plans} plans`),
          `${counts.open} open`,
          counts.blocked > 0 && `${counts.blocked} blocked`,
        ]
          .filter((part) => part !== false)
          .join(" · ")}
      </span>
    </h4>
  );
}

function SessionSection({
  shown,
  open,
  onFold,
}: {
  shown: ShownGroup;
  open: boolean;
  onFold: (open: boolean) => void;
}) {
  const listId = useId();
  return (
    <section
      aria-label={`${SESSION_LEVEL.words} ${sessionLabel(shown.group)}`}
      data-session={shown.group.id}
      className="flex flex-col gap-1"
    >
      <SessionHeading group={shown.group} open={open} controls={listId} onFold={onFold} />
      <div id={listId} hidden={!open}>
        {open && <TaskList tasks={shown.shown} label={`Work of ${sessionLabel(shown.group)}`} />}
      </div>
    </section>
  );
}

/**
 * One project's work tree on the Tasks tab: the sessions, each with its plans and loose tasks,
 * as the filter shows them, folded as the person left them, one page of rows at a time.
 */
export function WorkTree({
  projectId,
  work,
  filter,
  ui,
}: {
  projectId: string;
  work: Extract<ProjectWorkTasks, { state: "ready" }>;
  filter: TaskFilter;
  ui: TreeUi;
}) {
  const [budget, setBudget] = useState(PAGE_ROWS);
  const groups = sessionGroupsOf(work.tasks, work.sessions);
  const shown = filterGroups(groups, filter);
  // Words searched for: every level holding a match opens, whatever was folded.
  const searching = filter.q.trim() !== "";
  const open = (task: WorkTaskNode) => searching || taskOpen(ui.folds, task);
  const groupOpen = (group: SessionGroup) =>
    searching || isOpen(ui.folds, foldKey.session(projectId, group.id));
  const page = pageRows(shown, budget, groupOpen, open);
  const actions = {
    isOpen: open,
    onFold: (task: WorkTaskNode, next: boolean) => ui.setFolds([foldKey.task(task.id)], !next),
    onOpen: ui.onOpen,
    selected: ui.selected,
  };
  const keys = foldKeysOf(projectId, groups);
  return (
    <TreeActionsProvider value={actions}>
      <div className="flex flex-col gap-3">
        {!searching && (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" onClick={() => ui.setFolds(keys, false)}>
              <ChevronsUpDownIcon data-icon="inline-start" aria-hidden="true" />
              Unfold all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => ui.setFolds(keys, true)}>
              <ChevronsDownUpIcon data-icon="inline-start" aria-hidden="true" />
              Fold all
            </Button>
          </div>
        )}
        {page.groups.map((one) => (
          <SessionSection
            key={one.group.id}
            shown={one}
            open={groupOpen(one.group)}
            onFold={(next) => ui.setFolds([foldKey.session(projectId, one.group.id)], !next)}
          />
        ))}
        {page.hidden > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
            <span role="status">
              {page.hidden === 1 ? "1 more row hidden" : `${page.hidden} more rows hidden`}
            </span>
            <Button variant="outline" size="sm" onClick={() => setBudget(budget + PAGE_ROWS)}>
              Show {Math.min(PAGE_ROWS, page.hidden)} more
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setBudget(Number.POSITIVE_INFINITY)}>
              Show all
            </Button>
          </div>
        )}
      </div>
    </TreeActionsProvider>
  );
}

/** One project's work on the Tasks tab: its state, or the tree as the filter shows it. */
export function WorkSection({
  projectId,
  work,
  filter = DEFAULT_FILTER,
  onFilter,
  ui = STATIC_UI,
}: {
  projectId: string;
  work: ProjectWorkTasks;
  filter?: TaskFilter;
  onFilter?: (filter: TaskFilter) => void;
  ui?: TreeUi;
}) {
  const titleId = useId();
  const counts = workCountsOf(work);
  const shown =
    work.state === "ready"
      ? filterGroups(sessionGroupsOf(work.tasks, work.sessions), filter).length
      : 0;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="font-semibold">
          Work on this machine
        </h3>
        {work.state === "ready" && work.tasks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {[
              `${counts.open} open`,
              counts.blocked > 0 && `${counts.blocked} blocked`,
              counts.nonBlocking > 0 && `${counts.nonBlocking} non-blocking`,
              filter.status === "open" ||
              filter.status === "in_progress" ||
              filter.status === "blocked"
                ? "closed ones hidden"
                : `closed ones stay ${work.recentDays} days`,
            ]
              .filter((part) => part !== false)
              .join(" · ")}
          </span>
        )}
      </div>
      {work.state === "ready" && work.sessionsWhy !== null && (
        <p className="text-xs text-pretty text-warn">
          Which sessions run now is unknown: {work.sessionsWhy}
        </p>
      )}
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
          The kit's task list has nothing for this project on this machine. <WhereTasksComeFrom />
        </EmptyState>
      ) : work.tasks.length === 0 ? (
        <EmptyState title="Nothing open">
          No work task is open, and none closed in the last {work.recentDays} days.{" "}
          <WhereTasksComeFrom />
        </EmptyState>
      ) : shown === 0 ? (
        narrowsWork(filter) ? (
          <EmptyState title="Nothing matches the filters">
            <p>No {narrowWords(filter) || "matching"} task here.</p>
            {onFilter !== undefined && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => onFilter(DEFAULT_FILTER)}
              >
                <FilterXIcon data-icon="inline-start" aria-hidden="true" />
                Clear the filters
              </Button>
            )}
          </EmptyState>
        ) : (
          <EmptyState title="Nothing open">
            <p>
              Every task here is closed: All shows those closed in the last {work.recentDays} days.
            </p>
            {onFilter !== undefined && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => onFilter({ ...filter, status: "all" })}
              >
                Show all
              </Button>
            )}
          </EmptyState>
        )
      ) : (
        <>
          <WorkTree projectId={projectId} work={work} filter={filter} ui={ui} />
          {work.more > 0 && (
            <p className="text-xs text-muted-foreground">
              {work.more} more not sent by the server:{" "}
              <code className="font-mono">{KIT_NAME} task list --scope all</code> lists every one.
            </p>
          )}
        </>
      )}
    </section>
  );
}
