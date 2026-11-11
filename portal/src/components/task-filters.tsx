"use client";

import { FilterXIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { TaskSession, TasksData } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PlanChoice } from "@/lib/task-groups";
import {
  DEFAULT_FILTER,
  isDefaultFilter,
  NO_PLAN,
  NO_SESSION,
  STATUS_FILTERS,
  type TaskStatusFilter,
  type TaskView,
  workCountsOf,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** How long the search waits after the last key before it narrows the list. */
export const SEARCH_WAIT_MS = 250;

function isStatus(value: string): value is TaskStatusFilter {
  return STATUS_FILTERS.some((one) => one.value === value);
}

/** A select that narrows to one value or (empty) to all, muted while it narrows nothing. */
function Pick({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: null | string;
  options: readonly { value: string; label: string }[];
  onChange: (value: null | string) => void;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className={cn("max-w-full", value === null ? "text-muted-foreground" : "font-medium")}
      >
        <NativeSelectOption value="">{all}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

/** The status choice: a toggle group on a wide page, a select on a narrow one. */
function StatusPick({
  value,
  onChange,
}: {
  value: TaskStatusFilter;
  onChange: (value: TaskStatusFilter) => void;
}) {
  const id = useId();
  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        aria-label="Which tasks"
        onValueChange={(next) => {
          if (isStatus(next)) onChange(next);
        }}
        className="hidden @4xl/main:flex"
      >
        {STATUS_FILTERS.map((one) => (
          <ToggleGroupItem
            key={one.value}
            value={one.value}
            aria-label={one.words}
            className="px-2.5"
          >
            {one.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <label htmlFor={id} className="sr-only">
        Which tasks
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={value}
        onChange={(event) => {
          if (isStatus(event.target.value)) onChange(event.target.value);
        }}
        className="@4xl/main:hidden"
      >
        {STATUS_FILTERS.map((one) => (
          <NativeSelectOption key={one.value} value={one.value}>
            {one.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

/**
 * The search box: what is typed shows at once, and narrows the list once typing pauses
 * (`SEARCH_WAIT_MS`), so a long list is not drawn again on every key.
 */
function Search({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  // The last words this box sent (or took in): the address coming back with them is our own
  // echo, and must not put older words over what was typed since.
  const sent = useRef(value);
  // The latest handler, so a new one from each draw of the page does not restart the wait.
  const send = useRef(onChange);
  send.current = onChange;
  useEffect(() => {
    // Only a change from outside (Clear filters, the browser's back) replaces the box's text.
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [value]);
  useEffect(() => {
    if (text === sent.current) return;
    const timer = window.setTimeout(() => {
      sent.current = text;
      send.current(text);
    }, SEARCH_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <div className="relative w-full @xl/main:w-64">
      <label htmlFor={id} className="sr-only">
        Find a task
      </label>
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        type="search"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        className="h-8 pl-8"
      />
    </div>
  );
}

/** A labelled switch of the bar. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 px-1">
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}

/** A session in the session picker: its name, or its short id, and whether it runs now. */
function sessionChoice(session: TaskSession): { value: string; label: string } {
  const name = session.name ?? `session ${session.id.slice(0, 8)}`;
  return { value: session.id, label: session.live ? `${name} · running` : name };
}

/**
 * The Tasks tab's filter bar, one for both tabs: the project and the search on each; the status,
 * session, plan and switches on the work tab, where they mean something. Every value lives in
 * the page's address.
 */
export function TaskFilters({
  data,
  view,
  sessions,
  plans,
  unplaced,
  onView,
}: {
  data: TasksData;
  view: TaskView;
  sessions: readonly TaskSession[];
  plans: readonly PlanChoice[];
  /** True when some work has no session recorded: the picker offers that choice. */
  unplaced: boolean;
  onView: (view: TaskView) => void;
}) {
  const work = view.tab === "work";
  const narrowed = work ? !isDefaultFilter(view) : view.q.trim() !== "";
  return (
    <search aria-label="Filters" className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
      {data.projects.length > 1 && (
        <Pick
          label="Project"
          all="All projects"
          value={view.project}
          options={data.projects.map((one) => ({
            value: one.project.id,
            label: `${one.project.name} · ${workCountsOf(one.tasks.work).open} open`,
          }))}
          onChange={(project) => onView({ ...view, project })}
        />
      )}
      <Search
        value={view.q}
        placeholder={work ? "Find by title or #number" : "Find by title or id"}
        onChange={(q) => onView({ ...view, q })}
      />
      {work && (
        <>
          <StatusPick value={view.status} onChange={(status) => onView({ ...view, status })} />
          <Pick
            label="Session"
            all="All sessions"
            value={view.session}
            options={[
              ...sessions.map(sessionChoice),
              ...(unplaced ? [{ value: NO_SESSION, label: "No session recorded" }] : []),
            ]}
            onChange={(session) => onView({ ...view, session })}
          />
          <Pick
            label="Plan"
            all="All plans"
            value={view.plan}
            options={[
              ...plans.map((one) => ({
                value: one.slug,
                label: one.subject === one.slug ? one.slug : `${one.subject} (${one.slug})`,
              })),
              { value: NO_PLAN, label: "Not in a plan" },
            ]}
            onChange={(plan) => onView({ ...view, plan })}
          />
          <Toggle
            label="Running sessions only"
            checked={view.live}
            onChange={(live) => onView({ ...view, live })}
          />
          <Toggle
            label="Non-blocking only"
            checked={view.nonBlocking}
            onChange={(nonBlocking) => onView({ ...view, nonBlocking })}
          />
        </>
      )}
      {narrowed && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(work ? { ...view, ...DEFAULT_FILTER } : { ...view, q: "" })}
        >
          <FilterXIcon data-icon="inline-start" aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </search>
  );
}
