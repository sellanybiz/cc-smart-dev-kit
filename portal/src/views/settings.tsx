"use client";

import { FolderGit2Icon, InfoIcon } from "lucide-react";
import { useResource } from "@/api/hooks";
import { SETTINGS_REFRESH } from "@/api/refresh";
import type { ProjectListRow } from "@/api/types";
import { columnsFor, PortalTable } from "@/components/data-table";
import { AppLink, useAppQuery, useSetAppQuery } from "@/components/router";
import { SettingsCards } from "@/components/settings-rows";
import { EmptyState, ErrorState, LoadingState, PagePad } from "@/components/states";
import { TonePill } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ago, KIT_NAME } from "@/lib/format";

const column = columnsFor<ProjectListRow>();

const PROJECT_COLUMNS = column.columns([
  column.accessor("name", {
    header: "Project",
    cell: ({ row }) => (
      <AppLink
        href={`/settings/project?id=${encodeURIComponent(row.original.id)}`}
        className="font-medium underline-offset-4 hover:underline focus-visible:underline"
      >
        {row.original.name}
      </AppLink>
    ),
    enableHiding: false,
  }),
  column.accessor("path", {
    header: "Folder",
    cell: ({ row }) => <span className="wrap-any font-mono text-xs">{row.original.path}</span>,
  }),
  column.accessor("setUp", {
    header: "Set up",
    cell: ({ row }) =>
      row.original.setUp ? (
        <TonePill tone="ok">set up</TonePill>
      ) : (
        <TonePill tone="info">not yet</TonePill>
      ),
  }),
  column.accessor("lastUsed", {
    header: "Last used",
    cell: ({ row }) => (row.original.lastUsed === null ? "—" : ago(row.original.lastUsed)),
  }),
  column.accessor("worktrees", {
    header: "Worktrees",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{row.original.worktrees ?? "—"}</span>
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
          A project's own file wins where it sets a value. A change here is a preview until saving
          lands; until then, <code className="font-mono">{KIT_NAME} workflow set</code> changes one.
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

function Projects() {
  const projects = useResource((client) => client.projects());
  if (projects.status === "loading") return <LoadingState label="the projects" />;
  if (projects.status === "error")
    return <ErrorState message={projects.message} onRetry={projects.reload} />;
  if (projects.data.length === 0) {
    return (
      <EmptyState
        title="No project yet"
        icon={<FolderGit2Icon className="size-6 text-muted-foreground" aria-hidden="true" />}
      >
        A git project shows up here once a Claude session has worked in it.
      </EmptyState>
    );
  }
  const setUp = projects.data.filter((project) => project.setUp).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {setUp} of {projects.data.length} projects are set up. Open one to see and change its own
        settings.
      </p>
      <PortalTable
        rows={projects.data}
        columns={PROJECT_COLUMNS}
        rowKey={(row) => row.id}
        label="Projects on this machine"
        empty="No project yet."
      />
    </div>
  );
}

/** Settings: this machine's work flow, and every project's own (`?tab=projects`). */
export function SettingsView() {
  const query = useAppQuery();
  const setQuery = useSetAppQuery();
  const tab = query.get("tab") === "projects" ? "projects" : "machine";
  const projects = useResource((client) => client.projects());
  const count = projects.status === "ready" ? projects.data.length : 0;
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
          <Projects />
        </TabsContent>
      </Tabs>
    </PagePad>
  );
}
