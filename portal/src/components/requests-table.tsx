"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useResource } from "@/api/hooks";
import type { RequestRow } from "@/api/types";
import { columnsFor, PortalTable } from "@/components/data-table";
import type { HistoryState } from "@/components/history-state";
import { TonePill } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clockSeconds,
  compact,
  duration,
  slotName,
  targetBackend,
  targetModel,
  usd,
} from "@/lib/format";
import { rangeOf } from "@/lib/history";

const column = columnsFor<RequestRow>();

const COLUMNS = column.columns([
  column.accessor("at", {
    header: "Time",
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">{clockSeconds(row.original.at)}</span>
    ),
    enableHiding: false,
  }),
  column.accessor("session", {
    header: "Session",
    cell: ({ row }) =>
      row.original.session === null ? (
        <span className="text-muted-foreground">unknown</span>
      ) : (
        <span className="font-mono text-xs">{row.original.session.slice(0, 8)}</span>
      ),
  }),
  column.accessor("model", {
    header: "Model",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.model}</span>,
  }),
  column.accessor("slot", {
    header: "Slot",
    cell: ({ row }) => (row.original.slot === null ? "none" : slotName(row.original.slot)),
  }),
  column.accessor("target", {
    header: "Target",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-mono text-xs">{targetModel(row.original.target)}</span>
        <span className="text-xs text-muted-foreground">{targetBackend(row.original.target)}</span>
      </span>
    ),
  }),
  column.accessor("status", {
    header: "Status",
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <TonePill
          tone={row.original.status < 400 ? "ok" : row.original.status === 429 ? "warn" : "bad"}
        >
          {row.original.status}
        </TonePill>
        {row.original.next && (
          <Badge variant="outline" className="text-muted-foreground">
            next target
          </Badge>
        )}
      </span>
    ),
  }),
  column.accessor("ms", {
    header: "Took",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{duration(row.original.ms)}</span>
    ),
  }),
  column.display({
    id: "tokens",
    header: "Tokens",
    cell: ({ row }) => {
      const r = row.original;
      return (
        <span
          className="block text-right tabular-nums"
          title={`${r.inputTokens} in, ${r.cacheReadTokens} from the cache, ${r.cacheWriteTokens} into it, ${r.outputTokens} out`}
        >
          {compact(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)} /{" "}
          {compact(r.outputTokens)}
        </span>
      );
    },
  }),
  column.accessor("costUsd", {
    header: "Est. USD",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{usd(row.original.costUsd)}</span>
    ),
  }),
]);

/**
 * The request log, newest first, a page at a time from the server (`GET /api/requests`, its
 * cursor). It reads the page's range and filters, and starts again at the newest when they change.
 */
export function RequestsTable({ state }: { state: HistoryState }) {
  // The cursors walked so far, for this range and filter; a new filter starts at the newest.
  const [paging, setPaging] = useState<{ key: string; cursors: (null | string)[] }>({
    key: state.key,
    cursors: [null],
  });
  const cursors = paging.key === state.key ? paging.cursors : [null];
  const setCursors = (change: (list: (null | string)[]) => (null | string)[]) =>
    setPaging({ key: state.key, cursors: change(cursors) });
  const cursor = cursors.at(-1) ?? null;
  const page = useResource(
    (client) => client.requests({ ...state.filter, range: state.range, cursor }),
    `${state.key}|${cursor ?? ""}`,
  );
  if (page.status === "loading") {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">Loading the requests…</span>
        <Skeleton className="h-8 w-28 self-end" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }
  if (page.status === "error") {
    return (
      <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        {page.gateway
          ? "The gateway is not set up, so there are no requests."
          : `The requests could not load: ${page.message}`}
      </p>
    );
  }
  const pageNumber = cursors.length;
  return (
    <PortalTable
      rows={page.data.rows}
      columns={COLUMNS}
      rowKey={(row) => row.id}
      label="Routed requests"
      empty={`No request in ${rangeOf(state.range).words} matches.`}
      pager={
        page.data.rows.length > 0 && (
          <div className="flex items-center justify-end gap-4 px-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Page {pageNumber}, newest first
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursors((list) => list.slice(0, -1))}
                disabled={pageNumber === 1}
              >
                <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
                Newer
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = page.data.next;
                  if (next !== null) setCursors((list) => [...list, next]);
                }}
                disabled={page.data.next === null}
              >
                Older
                <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )
      }
    />
  );
}
