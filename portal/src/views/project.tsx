"use client";

import {
  ArrowLeftIcon,
  FileTextIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/api/client";
import { useResource } from "@/api/hooks";
import { PROJECT_REFRESH } from "@/api/refresh";
import type {
  ProjectBranchRow,
  ProjectData,
  ProjectInitAnswers,
  ProjectInitPlan,
  ProjectListRow,
} from "@/api/types";
import { ActionResultLine, useAction } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { columnsFor, PortalTable } from "@/components/data-table";
import { NarrowLabel, ProjectStatePills, STACK_ROWS_WHEN_NARROW } from "@/components/project-state";
import { AppLink, useAppQuery, useAppQueryReady } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { SettingsCards } from "@/components/settings-rows";
import { LoadingState, PagePad, ResourceView } from "@/components/states";
import { StatusMark, TonePill } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ago, KIT_NAME } from "@/lib/format";

/** The project's answers: its base, the bases by prefix, the protected branches, the guards. */
function AnswersList({ answers }: { answers: ProjectInitAnswers }) {
  return (
    <div className="grid gap-6 text-sm @3xl/main:grid-cols-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Base branch</dt>
        <dd className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
          <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="wrap-any">{answers.base}</span>
        </dd>
        <dt className="text-muted-foreground">Protected</dt>
        <dd className="wrap-any font-mono text-xs">
          {answers.protectedBranches.join(", ") || "none"}
        </dd>
        {Object.entries(answers.bases).map(([prefix, base]) => (
          <div key={prefix} className="contents">
            <dt className="text-muted-foreground">
              <span className="font-mono text-xs">{prefix}…</span> goes into
            </dt>
            <dd className="wrap-any font-mono text-xs">{base}</dd>
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
    </div>
  );
}

/** One file of the plan: its path, and exactly what will be written (or the lines it changes by). */
function PlanBox({ file, text, caption }: { file: string; text: string; caption: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-medium">
          <FileTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="wrap-any">{file}</span>
        </span>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </figcaption>
      <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap wrap-any">
        {text === "" ? "(nothing)" : text}
      </pre>
    </figure>
  );
}

/** The preview's plan, as the boxes show it: the project's file, then Claude Code's settings. */
function PlanBoxes({ plan, note }: { plan: ProjectInitPlan; note: null | string }) {
  return (
    <div className="flex flex-col gap-4">
      <PlanBox file={plan.file} text={plan.text} caption="Exactly what will be written." />
      <PlanBox
        file={plan.settings.file}
        text={plan.settings.lines.join("\n")}
        caption="The lines this file changes by."
      />
      {plan.localSettings.changed && (
        <PlanBox
          file={plan.localSettings.file}
          text={plan.localSettings.lines.join("\n")}
          caption="The lines your personal settings change by."
        />
      )}
      {note !== null && <p className="text-sm text-pretty text-muted-foreground">{note}</p>}
      {plan.notes.map((line) => (
        <p key={line} className="text-sm text-pretty text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

/** What the preview handed back: the plan, the hash of the files it was made against, its line. */
interface Planned {
  plan: ProjectInitPlan;
  hash: string;
  note: null | string;
}

/**
 * Set a project up from the page: preview the two files with the project's first answers
 * (`project.preview`), show exactly what will be written, ask (`ConfirmDialog`), then write
 * with the preview's hash (`project.write`) — the server refuses a write whose files changed
 * since. The result goes to the page (`onWritten`), so it stays when this card gives way to
 * the project's settings.
 */
function SetUpCard({
  project,
  answers,
  planError,
  focus,
  onWritten,
}: {
  project: ProjectListRow;
  answers: ProjectInitAnswers;
  planError: null | string;
  focus: boolean;
  onWritten: (result: ActionResult) => void;
}) {
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [asking, setAsking] = useState(false);
  const preview = useAction("project.preview", (result) => {
    if (result.ok && result.preview !== undefined && result.filesHash !== undefined) {
      setPlanned({ hash: result.filesHash, note: result.lines[0] ?? null, plan: result.preview });
      preview.clear();
    }
  });
  const write = useAction("project.write", (result) => {
    if (!result.ok) return;
    setPlanned(null);
    onWritten(result);
  });
  const titleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    titleRef.current?.scrollIntoView({ block: "start" });
    titleRef.current?.focus();
  }, [focus]);
  const previewing = preview.state.phase === "sending";
  const writing = write.state.phase === "sending";
  const runPreview = () => preview.run({ answers, project: project.id });
  return (
    <Card>
      <CardHeader>
        <CardTitle ref={titleRef} tabIndex={-1} className="scroll-mt-20 outline-none">
          Set this project up
        </CardTitle>
        <CardDescription>
          Setting up writes two files in the project, a backup first and never a commit: its own
          settings and Claude Code's settings for it. Review them, then commit them with the
          project.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">It starts from these answers</p>
          <AnswersList answers={answers} />
          <p className="text-xs text-pretty text-muted-foreground">
            The same ones <code className="font-mono">{KIT_NAME} project init</code> offers in the
            project's folder. To change one, run that command there.
          </p>
        </div>
        {planError !== null && planned === null && (
          <Alert className="border-warn/40">
            <TriangleAlertIcon className="text-warn" aria-hidden="true" />
            <AlertTitle>The plan could not be made when the page was read</AlertTitle>
            <AlertDescription>{planError}</AlertDescription>
          </Alert>
        )}
        {planned === null ? (
          <div className="flex flex-col items-start gap-1.5">
            <Button size="sm" onClick={runPreview} disabled={previewing} aria-busy={previewing}>
              {previewing && (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              Preview the two files
            </Button>
            <ActionResultLine state={preview.state} onRetry={runPreview} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <PlanBoxes plan={planned.plan} note={planned.note} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => setAsking(true)}
                disabled={writing}
                aria-busy={writing}
              >
                {writing && (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                Write the files
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={writing}
                onClick={() => {
                  setPlanned(null);
                  write.clear();
                }}
              >
                Cancel
              </Button>
            </div>
            <ActionResultLine
              state={write.state}
              onRetry={() => {
                // A refused write (the files changed meanwhile) needs a fresh preview first.
                setPlanned(null);
                write.clear();
                runPreview();
              }}
            />
          </div>
        )}
        <ConfirmDialog
          open={asking}
          title={`Write these files into ${project.name}?`}
          yes="Write the files"
          onCancel={() => setAsking(false)}
          onYes={() => {
            setAsking(false);
            if (planned === null) return;
            write.run({ answers, confirm: true, previewHash: planned.hash, project: project.id });
          }}
        >
          Nothing is committed: the change is yours to review and commit. A backup of each file is
          kept first.
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}

const column = columnsFor<ProjectBranchRow>();

const BRANCH_COLUMNS = column.columns([
  column.accessor("branch", {
    header: "Branch",
    // The cells wrap (the table's cells do not by default): a long branch name or reason makes
    // the row taller, never the table wider.
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
        <span className="wrap-any font-mono text-xs">{row.original.branch}</span>
        {row.original.title !== null && (
          <span className="text-xs text-pretty text-muted-foreground">{row.original.title}</span>
        )}
      </span>
    ),
    enableHiding: false,
  }),
  column.accessor("kind", {
    header: "What",
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1.5">
        {/* The icon stays with its words; only the draft badge may wrap to a line of its own. */}
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {row.original.kind === "pr" ? (
            <>
              <GitPullRequestIcon className="size-3.5" aria-hidden="true" />
              {row.original.number === null ? "Pull request" : `PR #${row.original.number}`}
            </>
          ) : (
            <>
              <GitBranchIcon className="size-3.5" aria-hidden="true" />
              Crew branch
            </>
          )}
        </span>
        {row.original.draft && (
          <Badge variant="outline" className="text-muted-foreground">
            draft
          </Badge>
        )}
      </span>
    ),
  }),
  column.accessor("base", {
    header: "Into",
    cell: ({ row }) => (
      <span className="wrap-any whitespace-normal">
        <NarrowLabel>into</NarrowLabel>
        <span className="font-mono text-xs">{row.original.base ?? "—"}</span>
      </span>
    ),
  }),
  column.accessor((row) => row.verdict.label, {
    id: "verdict",
    header: "Verdict",
    cell: ({ row }) => (
      <span className="flex min-w-48 flex-col items-start gap-1 whitespace-normal">
        <TonePill tone={row.original.verdict.tone}>{row.original.verdict.label}</TonePill>
        {row.original.verdict.reason !== null && (
          <span className="text-xs text-pretty text-muted-foreground">
            {row.original.verdict.reason}
          </span>
        )}
      </span>
    ),
  }),
]);

function Branches({ data }: { data: ProjectData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Merge check</CardTitle>
        <CardDescription>
          The open pull requests and crew branches, with the merge guard's verdict on each: whether
          it would merge by itself. Read {ago(data.checkedAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.branchesNote !== null && (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{data.branchesNote}</AlertDescription>
          </Alert>
        )}
        <div className={STACK_ROWS_WHEN_NARROW}>
          <PortalTable
            rows={data.branches}
            columns={BRANCH_COLUMNS}
            rowKey={(row) => `${row.kind}:${row.branch}`}
            label={`Branches of ${data.project.name}`}
            empty={
              // The note is why a part could not be read: an empty table then only says that
              // nothing was found in the part that could. It wraps on a narrow screen.
              <span className="block whitespace-normal text-pretty">
                {data.branchesNote === null
                  ? "No open pull request and no crew branch."
                  : "Nothing found in what could be read. The note above says what is missing."}
              </span>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectPage({
  data,
  setupAsked,
  refresh,
}: {
  data: ProjectData;
  setupAsked: boolean;
  refresh: () => void;
}) {
  const { project, answers, setup, settings } = data;
  // The write's result lives here: it stays when the set-up card gives way to the settings.
  const [written, setWritten] = useState<ActionResult | null>(null);
  return (
    <>
      <PagePad className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <span className="wrap-any">{project.name}</span>
            {project.current && (
              <Badge variant="secondary" title="The portal was started in this project">
                this folder
              </Badge>
            )}
            {project.source === "added" && (
              <Badge variant="outline" className="text-muted-foreground">
                added
              </Badge>
            )}
          </h2>
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
          badge={<ProjectStatePills project={project} />}
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
          detail={
            project.worktrees === null
              ? "Git could not list them"
              : "A finished one clears itself after its merge"
          }
        />
        <StatCard
          label="Last used"
          value={project.lastUsed === null ? "—" : ago(project.lastUsed)}
          headline="Its newest Claude session"
          detail={
            project.lastUsed === null
              ? "No session record in it yet"
              : "From the session records on this machine"
          }
        />
      </SectionCards>
      <PagePad className="flex flex-col gap-4 md:gap-6">
        {written !== null && (
          <ActionResultLine
            state={{ phase: "done", result: written }}
            className="rounded-lg border p-3"
          />
        )}
        {project.setUp && project.uncommitted === true && (
          <Alert className="border-warn/40">
            <TriangleAlertIcon className="text-warn" aria-hidden="true" />
            <AlertTitle>The project files are not committed yet</AlertTitle>
            <AlertDescription>
              The merge guard reads what is committed: commit them and push before they count.
            </AlertDescription>
          </Alert>
        )}
        {setup.error !== null ? (
          <Alert className="border-bad/40">
            <TriangleAlertIcon className="text-bad" aria-hidden="true" />
            <AlertTitle>This project cannot be read</AlertTitle>
            <AlertDescription>{setup.error}</AlertDescription>
          </Alert>
        ) : answers !== null ? (
          <Card>
            <CardHeader>
              <CardTitle>Branches and guards</CardTitle>
              <CardDescription>
                From the project's own file, as the command line reads it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AnswersList answers={answers} />
            </CardContent>
          </Card>
        ) : setup.answers !== null ? (
          <SetUpCard
            project={project}
            answers={setup.answers}
            planError={setup.planError}
            focus={setupAsked}
            onWritten={(result) => {
              setWritten(result);
              // The stream's `project.write` result reads again too; a page whose stream is
              // reconnecting must not keep showing the set-up card for a written project.
              refresh();
            }}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Set this project up</CardTitle>
              <CardDescription>
                The page has no answers to start from. Run the command in the project's folder.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CopyButton text={`${KIT_NAME} project init`} label="Copy the command" />
            </CardContent>
          </Card>
        )}
        <Branches data={data} />
        {settings !== null && <SettingsCards rows={settings.rows} />}
      </PagePad>
    </>
  );
}

/** A project's page (`/settings/project?id=…`, `&setup=1` opens at its set-up card). */
export function ProjectView() {
  const ready = useAppQueryReady();
  const query = useAppQuery();
  const id = query.get("id");
  const setupAsked = query.get("setup") === "1";
  const project = useResource(
    (client) =>
      id === null
        ? Promise.reject(new Error("No project is named in the address: open one from Settings."))
        : client.project(id),
    `${ready}|${id ?? ""}`,
    PROJECT_REFRESH,
  );
  if (!ready) return <LoadingState label="the project" />;
  return (
    <ResourceView resource={project} label="the project">
      {(data) => <ProjectPage data={data} setupAsked={setupAsked} refresh={project.refresh} />}
    </ResourceView>
  );
}
