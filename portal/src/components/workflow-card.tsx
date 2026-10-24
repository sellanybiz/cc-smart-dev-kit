"use client";

import { InfoIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { proposeValueText, workflowValueText } from "@/api/adapt";
import { useResource } from "@/api/hooks";
import { PROJECT_REFRESH } from "@/api/refresh";
import type { GhLoginState, ProjectListRow, ProjectWorkflowValue, SettingsRow } from "@/api/types";
import { ActionResultLine, useAction } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CommandLine } from "@/components/copy-button";
import { type Draft, SettingLine, SourceBadge, settingGroups } from "@/components/settings-rows";
import { EmptyState } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KIT_NAME } from "@/lib/format";

/** The project's settings file, as the confirm names it (`CONFIG_PATH`, `src/project/resolve.ts`). */
const CONFIG_FILE = ".claude/cc-smart-dev-kit.json";

/** What the page asks before a proposal: a new value, or the project's value taken out. */
type Asking = null | { unset: false; value: unknown } | { unset: true };

/**
 * One setting of the project. A change asks first, then `project.workflow.propose` runs the
 * command line's own `workflow propose` (D57): a pull request into the base that changes one line
 * of the project's file. The row keeps showing the base's value — it counts once merged — and
 * the result stays in place: the pull request's link, or the refusal in words.
 */
function ProposeRow({ row, project, base }: { row: SettingsRow; project: string; base: string }) {
  const [draft, setDraft] = useState<Draft>(null);
  const [opened, setOpened] = useState<null | string>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const { run, state, clear } = useAction("project.workflow.propose", (result) => {
    // Nothing changes on the base until the pull request is merged: show what it holds.
    setDraft(null);
    if (result.ok && result.url !== undefined) setOpened(result.url);
  });
  const sending = state.phase === "sending";
  const propose = (next: Asking) => {
    setOpened(null);
    setAsking(next);
  };
  const cancel = () => {
    setAsking(null);
    setDraft(null);
    clear();
  };
  const unsetHelpId = useId();
  return (
    <SettingLine
      row={row}
      draft={draft}
      setDraft={setDraft}
      onSave={(value) => propose({ unset: false, value })}
      busy={sending}
      confirm={
        <ConfirmDialog
          open={asking !== null}
          title={
            asking?.unset === true
              ? `Take ${row.label} out of the project?`
              : `Set ${row.label} to ${workflowValueText(asking?.value)} for the project?`
          }
          yes="Open the pull request"
          onCancel={cancel}
          onYes={() => {
            const asked = asking;
            setAsking(null);
            if (asked === null) return;
            run(
              asked.unset
                ? { confirm: true, project, setting: row.key, unset: true }
                : {
                    confirm: true,
                    project,
                    setting: row.key,
                    value: proposeValueText(asked.value),
                  },
            );
          }}
        >
          It opens a pull request into <code className="font-mono">{base}</code> that changes one
          line of the project's settings file, <code className="font-mono">{CONFIG_FILE}</code>
          {asking?.unset === true
            ? ": the project's own value goes, and each person's default applies."
            : "."}{" "}
          It counts once that pull request is merged; until then this card shows the value{" "}
          <code className="font-mono">{base}</code> holds.
        </ConfirmDialog>
      }
    >
      {opened !== null && !sending ? (
        <p role="status" className="text-sm text-pretty text-ok">
          <span aria-hidden="true">✓ </span>
          Pull request opened:{" "}
          <a
            href={opened}
            target="_blank"
            rel="noreferrer"
            className="wrap-any font-medium underline underline-offset-4"
          >
            {opened}
          </a>
          . It counts once it is merged into <code className="font-mono">{base}</code>.
        </p>
      ) : (
        <ActionResultLine state={state} />
      )}
      {row.source === "project" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={row.readOnly || sending}
            aria-describedby={unsetHelpId}
            onClick={() => propose({ unset: true })}
          >
            Use each person's default
          </Button>
          <span id={unsetHelpId} className="sr-only">
            Opens a pull request that takes {row.label} out of the project's file.
          </span>
        </div>
      )}
    </SettingLine>
  );
}

/** Why the controls are off without a gh that can open a pull request, and what to run. */
function GhNote({ gh }: { gh: Exclude<GhLoginState, "in"> }) {
  return (
    <Alert className="border-warn/40">
      <TriangleAlertIcon className="text-warn" aria-hidden="true" />
      <AlertTitle>
        {gh === "missing" ? "gh is not installed" : "gh cannot read this repository"}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <p className="text-pretty">
          A change opens a pull request, so the values are shown and cannot be changed here.{" "}
          {gh === "missing"
            ? "Install GitHub's command line from cli.github.com, then log in:"
            : "It is not logged in, there is no network, or origin is not on GitHub. See which:"}
        </p>
        <CommandLine
          command={gh === "missing" ? "gh auth login" : "gh auth status"}
          label="Copy the command"
        />
        <p className="text-xs text-pretty">The card asks gh again within a minute.</p>
      </AlertDescription>
    </Alert>
  );
}

/** The settings with no row of their own: each value and where it comes from. */
function OtherValues({ values }: { values: ProjectWorkflowValue[] }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 id={titleId} className="font-medium">
          Other settings
        </h3>
        <p className="text-sm text-pretty text-muted-foreground">
          Change one with{" "}
          <code className="font-mono wrap-anywhere">
            {KIT_NAME} workflow propose &lt;setting&gt; &lt;value&gt;
          </code>{" "}
          in the project's folder.
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm @xl/main:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
        {values.map((one) => (
          <div key={one.key} className="contents">
            <dt className="wrap-any font-mono text-xs leading-6">{one.key}</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 pb-2 @xl/main:pb-0">
              <span className="wrap-any">{workflowValueText(one.value)}</span>
              <SourceBadge source={one.source} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * A set-up project's Workflow card (D57): every setting its file can hold, with the value its
 * base commits and where that value comes from, grouped as Settings → This machine groups them.
 * A change becomes a pull request into the base; without a gh that can open one, the values
 * show and the controls are off.
 */
export function WorkflowCard({ project }: { project: ProjectListRow }) {
  const workflow = useResource(
    (client) => client.projectWorkflow(project.id),
    project.id,
    PROJECT_REFRESH,
  );
  const base = workflow.status === "ready" ? workflow.data.base : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow</CardTitle>
        <CardDescription className="text-pretty">
          What happens by itself in this project once a step is finished, as the file committed on{" "}
          {base === null ? "its base branch" : <code className="font-mono">{base}</code>} holds it.
          A change opens a pull request, and counts once that pull request is merged.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {workflow.status === "loading" ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-3">
            <span className="sr-only">Loading the project's workflow…</span>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : workflow.status === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-sm text-pretty text-bad">
              The project's workflow could not be read: {workflow.message}
            </p>
            <Button variant="outline" size="sm" onClick={workflow.reload}>
              <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : (
          <>
            {workflow.data.note !== null && (
              <Alert>
                <InfoIcon aria-hidden="true" />
                <AlertTitle>The settings could not be read</AlertTitle>
                <AlertDescription className="wrap-any">{workflow.data.note}</AlertDescription>
              </Alert>
            )}
            {workflow.data.gh !== "in" &&
              (workflow.data.rows.length > 0 || workflow.data.others.length > 0) && (
                <GhNote gh={workflow.data.gh} />
              )}
            {workflow.data.note === null &&
              workflow.data.rows.length === 0 &&
              workflow.data.others.length === 0 && (
                <EmptyState title="No setting to show">
                  The project's file holds no workflow setting the portal knows.
                </EmptyState>
              )}
            {settingGroups(workflow.data.rows).map((group) => (
              <WorkflowGroup
                key={group.card}
                title={group.title}
                about={group.about}
                rows={group.rows}
                project={project.id}
                base={workflow.data.base ?? ""}
              />
            ))}
            {workflow.data.others.length > 0 && <OtherValues values={workflow.data.others} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One group of the card (Work flow, Alerts, …): its heading and its rows. */
function WorkflowGroup({
  title,
  about,
  rows,
  project,
  base,
}: {
  title: string;
  about: string;
  rows: SettingsRow[];
  project: string;
  base: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col">
      <h3 id={titleId} className="font-medium">
        {title}
      </h3>
      <p className="text-sm text-pretty text-muted-foreground">{about}</p>
      <ul>
        {rows.map((row) => (
          <ProposeRow key={row.id} row={row} project={project} base={base} />
        ))}
      </ul>
    </section>
  );
}
