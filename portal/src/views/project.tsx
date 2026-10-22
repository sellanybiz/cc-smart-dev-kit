"use client";

import { ArrowLeftIcon, GitBranchIcon, TriangleAlertIcon } from "lucide-react";
import { useResource } from "@/api/hooks";
import { SETTINGS_REFRESH } from "@/api/refresh";
import type { ProjectData } from "@/api/types";
import { CopyButton } from "@/components/copy-button";
import { AppLink, useAppQuery, useAppQueryReady } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { SettingsCards } from "@/components/settings-rows";
import { EmptyState, LoadingState, PagePad, ResourceView } from "@/components/states";
import { StatusMark, TonePill } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ago, KIT_NAME } from "@/lib/format";

function ProjectPage({ data }: { data: ProjectData }) {
  const { project, answers, settings } = data;
  return (
    <>
      <PagePad className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{project.name}</h2>
          <span className="wrap-any font-mono text-xs text-muted-foreground">{project.path}</span>
        </div>
        <Button asChild variant="outline" size="sm">
          <AppLink href="/settings?tab=projects">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Every project
          </AppLink>
        </Button>
      </PagePad>
      <SectionCards columns={3}>
        <StatCard
          label="Set up"
          value={project.setUp ? "Yes" : "Not yet"}
          badge={
            project.setUp ? (
              <TonePill tone="ok">set up</TonePill>
            ) : (
              <TonePill tone="info">not yet</TonePill>
            )
          }
          headline={
            project.setUp ? "It has .claude/cc-smart-dev-kit.json" : "It has no project file yet"
          }
          detail={
            project.setUp ? "Its values win over your defaults" : "Your own defaults apply here"
          }
        />
        <StatCard
          label="Worktrees"
          value={project.worktrees ?? "—"}
          headline="Checkouts beside the main one"
          detail="A finished one clears itself after its merge"
        />
        <StatCard
          label="Last used"
          value={project.lastUsed === null ? "—" : ago(project.lastUsed)}
          headline="Its newest Claude session"
          detail="From the session records on this machine"
        />
      </SectionCards>
      <PagePad className="flex flex-col gap-4 md:gap-6">
        {data.uncommitted && (
          <Alert className="border-warn/40">
            <TriangleAlertIcon className="text-warn" aria-hidden="true" />
            <AlertTitle>The project file is not committed yet</AlertTitle>
            <AlertDescription>
              The review gate reads it from the main branch: commit and push it before it counts.
            </AlertDescription>
          </Alert>
        )}
        {answers === null ? (
          <Card>
            <CardHeader>
              <CardTitle>Set this project up</CardTitle>
              <CardDescription>
                Setting up writes two files, a backup first and never a commit: the project's
                settings and Claude Code's settings for it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-3">
              <EmptyState title="This project has no settings of its own">
                Run it in the project's folder, or set it up here once the portal can write it.
              </EmptyState>
              <CopyButton text={`${KIT_NAME} project init`} label="Copy the command" />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Branches and guards</CardTitle>
              <CardDescription>
                From the project's own file, as the command line reads it.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 text-sm @3xl/main:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Base branch</dt>
                <dd className="flex items-center gap-1.5 font-mono text-xs">
                  <GitBranchIcon className="size-3.5" aria-hidden="true" />
                  {answers.base}
                </dd>
                <dt className="text-muted-foreground">Protected</dt>
                <dd className="font-mono text-xs">
                  {answers.protectedBranches.join(", ") || "none"}
                </dd>
                {Object.entries(answers.bases).map(([prefix, base]) => (
                  <div key={prefix} className="contents">
                    <dt className="text-muted-foreground">
                      <span className="font-mono text-xs">{prefix}…</span> goes into
                    </dt>
                    <dd className="font-mono text-xs">{base}</dd>
                  </div>
                ))}
              </dl>
              <ul className="flex flex-col gap-2">
                <li>
                  <StatusMark tone={answers.guards.guardMainFolder ? "ok" : "info"}>
                    {answers.guards.guardMainFolder
                      ? "Edits in the main checkout are refused"
                      : "Edits in the main checkout are allowed"}
                  </StatusMark>
                </li>
                <li>
                  <StatusMark tone={answers.guards.sessionNames ? "ok" : "info"}>
                    {answers.guards.sessionNames
                      ? "Sessions name themselves after their task"
                      : "Sessions keep Claude Code's names"}
                  </StatusMark>
                </li>
                <li>
                  <StatusMark tone={answers.guards.jobRoute ? "ok" : "info"}>
                    {answers.guards.jobRoute
                      ? "Heavy commands go through the job queue"
                      : "Heavy commands run at once"}
                  </StatusMark>
                </li>
              </ul>
            </CardContent>
          </Card>
        )}
        <SettingsCards rows={settings.rows} />
      </PagePad>
    </>
  );
}

/** A project's page (`/settings/project?id=…`): its settings, its branches, its state. */
export function ProjectView() {
  const ready = useAppQueryReady();
  const id = useAppQuery().get("id");
  const project = useResource(
    (client) =>
      id === null
        ? Promise.reject(new Error("No project is named in the address: open one from Settings."))
        : client.project(id),
    `${ready}|${id ?? ""}`,
    SETTINGS_REFRESH,
  );
  if (!ready) return <LoadingState label="the project" />;
  return (
    <ResourceView resource={project} label="the project">
      {(data) => <ProjectPage data={data} />}
    </ResourceView>
  );
}
