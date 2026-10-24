"use client";

import { FolderGit2Icon, FolderPlusIcon, InfoIcon, LoaderCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import { type Resource, useResource } from "@/api/hooks";
import { SETTINGS_REFRESH } from "@/api/refresh";
import type { ProjectList, ProjectListRow } from "@/api/types";
import { ActionResultLine, useAction } from "@/components/action-button";
import { columnsFor, PortalTable } from "@/components/data-table";
import {
  NarrowLabel,
  ProjectStatePills,
  projectHref,
  STACK_ROWS_WHEN_NARROW,
} from "@/components/project-state";
import { AppLink, useAppQuery, useSetAppQuery } from "@/components/router";
import { SettingsCards } from "@/components/settings-rows";
import { EmptyState, ErrorState, LoadingState, PagePad } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ago, KIT_NAME } from "@/lib/format";

const column = columnsFor<ProjectListRow>();

const PROJECT_COLUMNS = column.columns([
  column.accessor("name", {
    header: "Project",
    // The folder is the name's second line, wrapping anywhere: a long path makes the row
    // taller, never the table wider.
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-1 whitespace-normal">
        <span className="flex flex-wrap items-center gap-1.5">
          <AppLink
            href={projectHref(row.original.id)}
            className="wrap-any font-medium underline-offset-4 hover:underline focus-visible:underline"
          >
            {row.original.name}
          </AppLink>
          {row.original.current && (
            <Badge variant="secondary" title="The portal was started in this project">
              this folder
            </Badge>
          )}
          {row.original.source === "added" && (
            <Badge variant="outline" className="text-muted-foreground">
              added
            </Badge>
          )}
        </span>
        <span className="wrap-any font-mono text-xs text-muted-foreground">
          {row.original.path}
        </span>
      </span>
    ),
    enableHiding: false,
  }),
  column.accessor("setUp", {
    header: "State",
    cell: ({ row }) => <ProjectStatePills project={row.original} />,
  }),
  column.accessor("lastUsed", {
    header: "Last used",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <NarrowLabel>Last used</NarrowLabel>
        {row.original.lastUsed === null ? "—" : ago(row.original.lastUsed)}
      </span>
    ),
  }),
  column.accessor("worktrees", {
    header: "Worktrees",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        <NarrowLabel>Worktrees</NarrowLabel>
        {row.original.worktrees ?? "—"}
      </span>
    ),
  }),
  column.display({
    id: "next",
    header: "Next step",
    cell: ({ row }) =>
      row.original.setUp ? null : (
        <Button asChild variant="outline" size="sm">
          <AppLink
            href={projectHref(row.original.id, true)}
            aria-label={`Set up ${row.original.name}`}
          >
            Set up
          </AppLink>
        </Button>
      ),
  }),
]);

function ThisMachine() {
  const settings = useResource((client) => client.settings(), "", SETTINGS_REFRESH);
  if (settings.status === "loading") return <LoadingState label="the settings" />;
  if (settings.status === "error")
    return <ErrorState message={settings.message} onRetry={settings.reload} />;
  const data = settings.data;
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Alert>
        <InfoIcon aria-hidden="true" />
        <AlertTitle>Your own defaults, for every project on this machine</AlertTitle>
        <AlertDescription>
          A change here is saved at once into your own workflow file, as{" "}
          <code className="font-mono">{KIT_NAME} workflow set</code> saves it. A project's own value
          wins; change it on the project's page, from{" "}
          <AppLink
            href="/settings?tab=projects"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Projects
          </AppLink>
          .
        </AlertDescription>
      </Alert>
      {data.error !== null && (
        <Alert className="border-bad/40">
          <AlertTitle>The settings could not be read</AlertTitle>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      )}
      <SettingsCards rows={data.rows} />
    </div>
  );
}

/**
 * "Add a folder": a git folder's main checkout joins the list (`project.add`). The server
 * says in words why a folder is refused; the result stays in place and the list reads again.
 */
function AddFolder({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const inputId = useId();
  const helpId = useId();
  const { run, state } = useAction("project.add", (result) => {
    if (!result.ok) return;
    setFolder("");
    onAdded();
  });
  const sending = state.phase === "sending";
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FolderPlusIcon data-icon="inline-start" aria-hidden="true" />
        Add a folder
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-1.5 rounded-lg border p-3"
      aria-label="Add a folder"
      onSubmit={(event) => {
        event.preventDefault();
        if (folder.trim() !== "") run({ folder: folder.trim() });
      }}
    >
      <label htmlFor={inputId} className="text-sm font-medium">
        The project's folder
      </label>
      <p id={helpId} className="text-xs text-pretty text-muted-foreground">
        A folder inside a git project. A worktree's folder adds the project it belongs to.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder="/home/user/code/my-app"
          aria-describedby={helpId}
          className="h-8 min-w-0 flex-1 basis-64 font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          disabled={sending}
        />
        <Button type="submit" size="sm" disabled={sending || folder.trim() === ""}>
          {sending && (
            <LoaderCircleIcon
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <ActionResultLine state={state} />
    </form>
  );
}

type ProjectsResource = Resource<ProjectList> & { refresh: () => void; reload: () => void };

function Projects({ projects }: { projects: ProjectsResource }) {
  if (projects.status === "loading") return <LoadingState label="the projects" />;
  if (projects.status === "error")
    return <ErrorState message={projects.message} onRetry={projects.reload} />;
  const { note, rows } = projects.data;
  const setUp = rows.filter((project) => project.setUp).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-pretty text-muted-foreground">
          {rows.length === 0
            ? "Every git project a Claude session worked in, newest first."
            : `${setUp} of ${rows.length} projects are set up, newest use first. Open one to see its settings and its branches.`}
        </p>
        <AddFolder onAdded={projects.refresh} />
      </div>
      {note !== null && (
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{note}</AlertDescription>
        </Alert>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="No project yet"
          icon={<FolderGit2Icon className="size-6 text-muted-foreground" aria-hidden="true" />}
        >
          A git project shows up here once a Claude session has worked in it, or when you add its
          folder.
        </EmptyState>
      ) : (
        <div className={STACK_ROWS_WHEN_NARROW}>
          <PortalTable
            rows={rows}
            columns={PROJECT_COLUMNS}
            rowKey={(row) => row.id}
            label="Projects on this machine"
            empty="No project yet."
          />
        </div>
      )}
    </div>
  );
}

/** Settings: this machine's work flow, and every project's own (`?tab=projects`). */
export function SettingsView() {
  const query = useAppQuery();
  const setQuery = useSetAppQuery();
  const tab = query.get("tab") === "projects" ? "projects" : "machine";
  const projects = useResource((client) => client.projects(), "", SETTINGS_REFRESH);
  const count = projects.status === "ready" ? projects.data.rows.length : 0;
  return (
    <PagePad>
      <Tabs
        value={tab}
        onValueChange={(next) => {
          const nextQuery = new URLSearchParams(query);
          if (next === "projects") nextQuery.set("tab", "projects");
          else nextQuery.delete("tab");
          setQuery(nextQuery);
        }}
        className="gap-4"
      >
        <TabsList
          aria-label="Settings"
          className="**:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1"
        >
          <TabsTrigger value="machine">This machine</TabsTrigger>
          <TabsTrigger value="projects">
            Projects {count > 0 && <Badge variant="secondary">{count}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="machine">
          <ThisMachine />
        </TabsContent>
        <TabsContent value="projects">
          <Projects projects={projects} />
        </TabsContent>
      </Tabs>
    </PagePad>
  );
}
