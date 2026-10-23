"use client";

import { useMemo, useState } from "react";
import { type Resource, useResource } from "@/api/hooks";
import { HISTORY_REFRESH } from "@/api/refresh";
import type { History, HistoryBy, HistoryKeys } from "@/api/types";
import { BarList } from "@/components/bar-list";
import { columnsFor, PortalTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { HistoryChart, seriesLabel } from "@/components/history-chart";
import { type HistoryState, useHistoryState, useSessionNames } from "@/components/history-state";
import { METRICS } from "@/components/metrics";
import { SectionCards, StatCard } from "@/components/section-cards";
import { EmptyState, PagePad } from "@/components/states";
import { TonePill } from "@/components/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { compact, count, percent, usd } from "@/lib/format";
import { HISTORY_BYS, rangeOf } from "@/lib/history";

interface Totals {
  key: string;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function totalsOf(history: History | null): Totals[] {
  return (history?.series ?? [])
    .map((series) => {
      const total: Totals = {
        key: series.key,
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
      };
      for (const point of series.points) {
        total.requests += point.requests;
        total.input += point.inputTokens;
        total.output += point.outputTokens;
        total.cacheRead += point.cacheReadTokens;
        total.cacheWrite += point.cacheWriteTokens;
        total.cost += point.costUsd;
      }
      return total;
    })
    .sort((a, b) => b.cost - a.cost);
}

function sum(rows: Totals[]): Omit<Totals, "key"> {
  return rows.reduce(
    (all, row) => ({
      requests: all.requests + row.requests,
      input: all.input + row.input,
      output: all.output + row.output,
      cacheRead: all.cacheRead + row.cacheRead,
      cacheWrite: all.cacheWrite + row.cacheWrite,
      cost: all.cost + row.cost,
    }),
    { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );
}

function useBreakdown(
  state: HistoryState,
  by: HistoryBy,
): Resource<History> & { reload: () => void } {
  return useResource(
    (client) => client.history({ ...state.filter, range: state.range, by }),
    `${state.key}|${by}`,
    HISTORY_REFRESH,
  );
}

type SessionRow = Totals & { name: string; project: string };

const sessionColumn = columnsFor<SessionRow>();
const SESSION_COLUMNS = sessionColumn.columns([
  sessionColumn.accessor("name", {
    header: "Session",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.key.slice(0, 8)}
        </span>
      </span>
    ),
    enableHiding: false,
  }),
  sessionColumn.accessor("project", { header: "Project" }),
  sessionColumn.accessor("requests", {
    header: "Requests",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{count(row.original.requests)}</span>
    ),
  }),
  sessionColumn.accessor("input", {
    header: "Tokens in",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {compact(row.original.input + row.original.cacheRead + row.original.cacheWrite)}
      </span>
    ),
  }),
  sessionColumn.accessor("output", {
    header: "Tokens out",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{compact(row.original.output)}</span>
    ),
  }),
  sessionColumn.accessor("cost", {
    header: "Est. USD",
    cell: ({ row }) => (
      <span className="block text-right font-medium tabular-nums">{usd(row.original.cost)}</span>
    ),
  }),
]);

function Breakdown({
  resources,
  names,
}: {
  resources: Record<HistoryBy, Resource<History>>;
  names: Map<string, string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the cost goes</CardTitle>
        <CardDescription>
          Estimated cost and tokens for each slot, target, model and session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="slot" className="gap-4">
          <TabsList aria-label="Break down by">
            {HISTORY_BYS.map((by) => (
              <TabsTrigger key={by.value} value={by.value}>
                {by.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {HISTORY_BYS.map((by) => {
            const resource = resources[by.value];
            const rows = totalsOf(resource.status === "ready" ? resource.data : null);
            return (
              <TabsContent key={by.value} value={by.value}>
                {resource.status === "loading" ? (
                  <Skeleton className="h-40 w-full" />
                ) : rows.length === 0 ? (
                  <EmptyState title="Nothing to count">No request matches the filters.</EmptyState>
                ) : (
                  <BarList
                    label={`Estimated cost by ${by.label.toLowerCase()}`}
                    rows={rows.slice(0, 8).map((row) => ({
                      key: row.key,
                      label: seriesLabel(row.key, by.value, names),
                      value: row.cost,
                      shown: usd(row.cost),
                      note: `${compact(row.input + row.cacheRead + row.cacheWrite + row.output)} tokens`,
                    }))}
                  />
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function sessionRows(history: History | null, keys: HistoryKeys | null): SessionRow[] {
  const known = new Map((keys?.sessions ?? []).map((session) => [session.id, session]));
  return totalsOf(history).map((row) => {
    const session = known.get(row.key);
    return {
      ...row,
      name: session?.name ?? "No name",
      project: session?.project ?? "unknown",
    };
  });
}

/** Usage: tokens and estimated cost, by slot, target, model and session, over time. */
export function UsageView() {
  const state = useHistoryState("target");
  const names = useSessionNames();
  const [metric, setMetric] = useState<"cost" | "tokens">("cost");
  const keys = useResource((client) => client.historyKeys());
  const resources: Record<HistoryBy, Resource<History>> = {
    target: useBreakdown(state, "target"),
    slot: useBreakdown(state, "slot"),
    model: useBreakdown(state, "model"),
    session: useBreakdown(state, "session"),
  };
  const byTarget = resources.target;
  const all = useMemo(
    () => sum(totalsOf(byTarget.status === "ready" ? byTarget.data : null)),
    [byTarget],
  );
  const sessions = sessionRows(
    resources.session.status === "ready" ? resources.session.data : null,
    keys.status === "ready" ? keys.data : null,
  );
  const words = rangeOf(state.range).words;
  const tokensIn = all.input + all.cacheRead + all.cacheWrite;
  const ready = byTarget.status === "ready";
  const value = (text: string) => (ready ? text : "…");
  const topSession = sessions[0];

  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label="Estimated cost"
          value={value(usd(all.cost))}
          badge={<TonePill tone="info">estimated</TonePill>}
          headline={`In ${words}`}
          detail="From list prices: never a bill"
        />
        <StatCard
          label="Tokens in"
          value={value(compact(tokensIn))}
          headline={`${compact(all.cacheRead)} read from the cache`}
          detail={`${compact(all.input)} new, ${compact(all.cacheWrite)} written to the cache`}
        />
        <StatCard
          label="Tokens out"
          value={value(compact(all.output))}
          headline={`Over ${count(all.requests)} requests`}
          detail={
            all.requests === 0
              ? "No request"
              : `${compact(all.output / all.requests)} a request on average`
          }
        />
        <StatCard
          label="Cache share"
          value={value(tokensIn === 0 ? "—" : percent(all.cacheRead / tokensIn))}
          badge={
            tokensIn > 0 && all.cacheRead / tokensIn >= 0.5 ? (
              <TonePill tone="ok">good</TonePill>
            ) : (
              <TonePill tone="info">low</TonePill>
            )
          }
          headline="Of the tokens sent, read from the cache"
          detail="A cache read costs a tenth of a new token"
        />
      </SectionCards>
      <FilterBar state={state} />
      <PagePad className="flex flex-col gap-4 md:gap-6">
        <HistoryChart
          title={metric === "cost" ? "Estimated cost over time" : "Tokens over time"}
          description={`By target, in ${words}${metric === "cost" ? ", from list prices" : ""}`}
          history={byTarget}
          by="target"
          metric={metric === "cost" ? METRICS.cost : METRICS.tokens}
          action={
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={metric}
              aria-label="Measure"
              onValueChange={(next) => {
                if (next === "cost" || next === "tokens") setMetric(next);
              }}
            >
              <ToggleGroupItem value="cost" className="px-3">
                Est. cost
              </ToggleGroupItem>
              <ToggleGroupItem value="tokens" className="px-3">
                Tokens
              </ToggleGroupItem>
            </ToggleGroup>
          }
        />
        <div className="grid gap-4 md:gap-6 @5xl/main:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Breakdown resources={resources} names={names} />
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Top sessions by cost</CardTitle>
              <CardDescription>
                {topSession === undefined
                  ? `No session sent a request in ${words}.`
                  : `${names.get(topSession.key) ?? topSession.key.slice(0, 8)} cost the most: ${usd(topSession.cost)} (estimated).`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PortalTable
                rows={sessions}
                columns={SESSION_COLUMNS}
                rowKey={(row) => row.key}
                label="Top sessions by estimated cost"
                empty="No session matches the filters."
              />
            </CardContent>
          </Card>
        </div>
      </PagePad>
    </>
  );
}
