"use client";

import { useResource } from "@/api/hooks";
import type { WorktreeRow } from "@/api/types";
import { ActionButton } from "@/components/action-button";
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

const WORKTREE_COLUMNS = column.columns([
  column.accessor("path", {
    header: "Worktree",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium">{row.original.path.split("/").at(-1)}</span>
        <span className="font-mono text-xs text-muted-foreground">
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
      <span className="tabular-nums whitespace-nowrap">
        {duration(row.original.idleMinutes * 60_000)}
      </span>
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

/** Every worktree with its verdict, what auto-clean removed, and "Clean finished now". */
export function WorktreesCard() {
  const worktrees = useResource((client) => client.worktrees());
  const data = worktrees.status === "ready" ? worktrees.data : null;
  const finished = data?.rows.filter((row) => row.verdict.finished).length ?? 0;
  return (
    <Card className="@4xl/main:col-span-2">
      <CardHeader>
        <CardTitle>Worktrees</CardTitle>
        <CardDescription>
          Every worktree of every project. A finished one is cleared by itself after its merge; a
          kept one says why.
        </CardDescription>
        <CardAction>
          {finished > 0 && (
            <ActionButton
              action="worktrees.clean"
              body={{}}
              variant="outline"
              confirm={{
                question: `Remove ${finished} finished worktree${finished === 1 ? "" : "s"} and their branch folders?`,
                yes: "Remove them",
              }}
            >
              Clean finished now ({finished})
            </ActionButton>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
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
            <section className="flex flex-col gap-2 text-sm">
              <h3 className="font-medium">Cleared by auto-clean</h3>
              {worktrees.data.cleaned.length === 0 ? (
                <p className="text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {worktrees.data.cleaned.map((entry) => (
                    <li key={entry.path}>
                      <StatusMark tone="ok">
                        {entry.path.split("/").at(-1)}{" "}
                        <span className="text-muted-foreground">in {entry.project}</span>,{" "}
                        {ago(entry.at)}
                      </StatusMark>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The installed version, the newest, a held major with its why and What's new, and Install. */
export function UpdatesCard() {
  const update = useResource((client) => client.update());
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
        {data.held === null ? (
          !behind && <EmptyState title="Nothing to install">You run the newest version.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p>
              <span className="font-medium">{data.held.version} is a major version.</span> Found{" "}
              {ago(data.held.at)}
              {data.held.from !== null && `, while you ran ${data.held.from}`}.
            </p>
            <HeldMajorActions held={data.held} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
