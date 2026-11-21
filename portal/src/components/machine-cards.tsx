"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type { ActionResult } from "@/api/client";
import { useResource } from "@/api/hooks";
import { UPDATE_REFRESH, WORKTREES_REFRESH } from "@/api/refresh";
import type { WorktreeRow, WorktreesData } from "@/api/types";
import { ActionButton, ActionResultLine } from "@/components/action-button";
import { columnsFor, PortalTable } from "@/components/data-table";
import { HeldMajorActions } from "@/components/held-major";
import { EmptyState } from "@/components/states";
import { StatusMark, TonePill } from "@/components/status";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, duration } from "@/lib/format";

const column = columnsFor<WorktreeRow>();

/** How long a worktree has been idle, to the minute: the verdict counts in minutes, not seconds. */
function idleWords(minutes: null | number): string {
  if (minutes === null) return "not known";
  if (minutes < 1) return "under 1 min";
  return duration(Math.round(minutes) * 60_000);
}

const WORKTREE_COLUMNS = column.columns([
  column.accessor("path", {
    header: "Worktree",
    cell: ({ row }) => (
      <span className="flex max-w-64 flex-col whitespace-normal">
        <span className="font-medium break-all">{row.original.path.split("/").at(-1)}</span>
        <span className="font-mono text-xs break-all text-muted-foreground">
          {row.original.branch ?? "no branch"}
        </span>
      </span>
    ),
    enableHiding: false,
  }),
  column.accessor("project", { header: "Project" }),
  column.accessor("idleMinutes", {
    header: "Idle",
    cell: ({ row }) => (
      <span className="tabular-nums whitespace-nowrap">{idleWords(row.original.idleMinutes)}</span>
    ),
  }),
  column.display({
    id: "verdict",
    header: "Verdict",
    cell: ({ row }) => {
      const verdict = row.original.verdict;
      return verdict.finished ? (
        <span className="flex flex-col items-start gap-1">
          <TonePill tone="ok">finished</TonePill>
          {verdict.note !== null && (
            <span className="text-xs text-muted-foreground">{verdict.note}</span>
          )}
        </span>
      ) : (
        <span className="flex max-w-80 flex-col items-start gap-1 whitespace-normal">
          <TonePill tone={verdict.held ? "info" : "warn"}>
            {verdict.held ? "kept for now" : "kept"}
          </TonePill>
          <span className="text-xs text-pretty text-muted-foreground">{verdict.why}</span>
        </span>
      );
    },
  }),
]);

/**
 * Auto-clean: when it last ran and against which base, and apart from that, the worktrees it
 * removed that no session start has reported yet. That list gathers across runs and carries no
 * time of its own, so it is never shown as what the last run removed.
 */
function AutoClean({ run }: { run: WorktreesData["autoClean"] }) {
  return (
    <section aria-labelledby="auto-clean-title" className="flex flex-col gap-2 text-sm">
      <h3 id="auto-clean-title" className="font-medium">
        Auto-clean
      </h3>
      {run === null ? (
        <p className="text-muted-foreground">
          Auto-clean has not run in this project yet. It runs after a merge into the base, and at a
          session start at most once an hour.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground">
            Last run{" "}
            <time dateTime={run.lastRunAt} title={run.lastRunAt}>
              {ago(run.lastRunAt)}
            </time>{" "}
            against <span className="font-mono text-xs">{run.base}</span>.
          </p>
          {run.removed.length > 0 && (
            <h4 className="mt-1 text-muted-foreground">Removed, not reported yet:</h4>
          )}
          {run.removed.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {run.removed.map((entry) => (
                <li key={entry.path}>
                  <StatusMark tone="ok">
                    <span className="font-medium">{entry.name}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.branch ?? "no branch"}
                    </span>
                    <span className="text-muted-foreground">: {entry.why}</span>
                  </StatusMark>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Every worktree with its verdict, what auto-clean removed, and "Clean finished now". */
export function WorktreesCard() {
  const worktrees = useResource((client) => client.worktrees(), "", WORKTREES_REFRESH);
  const data = worktrees.status === "ready" ? worktrees.data : null;
  const finished = data?.rows.filter((row) => row.verdict.finished).length ?? 0;
  return (
    <Card className="@4xl/main:col-span-2">
      <CardHeader>
        <CardTitle>Worktrees</CardTitle>
        <CardDescription>
          Every worktree of this project, how long it has been idle, and its verdict. A finished one
          is cleared by itself after its merge; a kept one says why.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Always there (above the list, so a phone keeps the description wide), and its result
            stays in place after the list reads again with nothing finished. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <ActionButton
            action="worktrees.clean"
            body={{ confirm: true }}
            variant="outline"
            disabled={finished === 0}
            confirm={{
              title: `Remove ${finished} finished worktree${finished === 1 ? "" : "s"}?`,
              body: "Each one goes with its branch. A worktree that is not finished is kept, with its reason. Builder branches (worktree-agent-*) that no worktree uses and whose work the base holds are deleted too; one with commits the base lacks is kept.",
              yes: "Remove them",
              tone: "destructive",
            }}
          >
            Clean finished now{finished > 0 && ` (${finished})`}
          </ActionButton>
          {data !== null && finished === 0 && (
            <p className="py-1.5 text-sm text-muted-foreground">Nothing is finished yet.</p>
          )}
        </div>
        {worktrees.status === "loading" ? (
          <Skeleton className="h-48 w-full" />
        ) : worktrees.status === "error" ? (
          <p className="text-sm text-bad">The worktrees could not be read: {worktrees.message}</p>
        ) : (
          <>
            <PortalTable
              rows={worktrees.data.rows}
              columns={WORKTREE_COLUMNS}
              rowKey={(row) => row.path}
              label="Worktrees and their verdicts"
              empty="No worktree besides each project's main checkout."
            />
            <AutoClean run={worktrees.data.autoClean} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The installed version, the newest, a held major with its why and What's new, and Install. */
export function UpdatesCard() {
  const update = useResource((client) => client.update(), "", UPDATE_REFRESH);
  const [install, setInstall] = useState<ActionResult | null>(null);
  if (update.status !== "ready") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
        </CardHeader>
        <CardContent>
          {update.status === "loading" ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <p className="text-sm text-bad">The update state could not be read: {update.message}</p>
          )}
        </CardContent>
      </Card>
    );
  }
  const data = update.data;
  const behind = data.newest !== null && data.newest !== data.installed;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          The kit updates itself; a major version waits for your yes.
        </CardDescription>
        <CardAction>
          {data.hold ? (
            <TonePill tone="info">held by you</TonePill>
          ) : data.held !== null ? (
            <TonePill tone="warn">{data.held.version} waits</TonePill>
          ) : behind ? (
            <TonePill tone="info">update ready</TonePill>
          ) : (
            <TonePill tone="ok">up to date</TonePill>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Installed</dt>
          <dd>{data.installed}</dd>
          <dt className="text-muted-foreground">Newest</dt>
          <dd>{data.newest ?? "the marketplace could not be read"}</dd>
          {data.lastCheck !== null && (
            <>
              <dt className="text-muted-foreground">Last check</dt>
              <dd>
                {ago(data.lastCheck.at)}: {data.lastCheck.detail}
              </dd>
            </>
          )}
        </dl>
        {data.held !== null ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p>
              <span className="font-medium">{data.held.version} is a major version.</span> Found{" "}
              {ago(data.held.at)}
              {data.held.from !== null && `, while you ran ${data.held.from}`}.
            </p>
            <HeldMajorActions held={data.held} onDone={setInstall} />
          </div>
        ) : install !== null ? (
          // The held version is gone after its install: its result stays in place.
          <ActionResultLine state={{ phase: "done", result: install }} />
        ) : behind ? (
          <p className="text-muted-foreground">
            {data.newest} is a minor version: it installs by itself at the next check
            {data.hold ? ", once you lift your hold" : ""}.
          </p>
        ) : (
          <EmptyState title="Nothing to install">You run the newest version.</EmptyState>
        )}
        {/* `update --check`: it reads the newest version the marketplace has, and installs nothing. */}
        <ActionButton
          action="update.check"
          body={{}}
          variant="outline"
          icon={<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />}
        >
          Check now
        </ActionButton>
      </CardContent>
    </Card>
  );
}
