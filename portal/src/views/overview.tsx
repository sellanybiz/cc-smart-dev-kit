"use client";

import { useMemo, useState } from "react";
import { recentOf } from "@/api/adapt";
import { useLiveEvent, useResource } from "@/api/hooks";
import { HISTORY_REFRESH, NEEDS_REFRESH, OVERVIEW_REFRESH } from "@/api/refresh";
import type { FallbackRow, LimitRow, OverviewData, RecentRequest } from "@/api/types";
import { BySwitch } from "@/components/by-switch";
import { columnsFor, DataTable, PortalTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { HistoryChart } from "@/components/history-chart";
import { type HistoryState, useHistoryState, useSessionNames } from "@/components/history-state";
import { METRICS } from "@/components/metrics";
import { NeedsList } from "@/components/needs-list";
import { RequestsTable } from "@/components/requests-table";
import { AppLink } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { ResourceView } from "@/components/states";
import { TonePill } from "@/components/status";
import { count, duration, percent, slotName, targetModel, usd } from "@/lib/format";
import { rangeOf } from "@/lib/history";

/** Requests a minute over the last five minutes of the router's list. */
function perMinute(recent: readonly RecentRequest[], now: number): number {
  const since = now - 5 * 60_000;
  return recent.filter((request) => request.at >= since).length / 5;
}

const fallbackColumn = columnsFor<FallbackRow>();
const FALLBACK_COLUMNS = fallbackColumn.columns([
  fallbackColumn.accessor("slot", { header: "Slot", enableHiding: false }),
  fallbackColumn.accessor("model", {
    header: "Resting model",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.model}</span>,
  }),
  fallbackColumn.accessor("target", {
    header: "Answers instead",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{targetModel(row.original.target)}</span>
    ),
  }),
  fallbackColumn.accessor("since", { header: "Since" }),
]);

const limitColumn = columnsFor<LimitRow>();
const LIMIT_COLUMNS = limitColumn.columns([
  limitColumn.accessor("model", {
    header: "Model",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.model}</span>,
    enableHiding: false,
  }),
  limitColumn.accessor("claim", { header: "Window that ran out" }),
  limitColumn.accessor("resets", {
    header: "Resets",
    cell: ({ row }) => row.original.resets ?? "Anthropic named no time",
  }),
]);

function Charts({ state, jobs }: { state: HistoryState; jobs: OverviewData["jobs"] }) {
  const names = useSessionNames();
  const history = useResource(
    (client) => client.history({ ...state.filter, range: state.range, by: state.by }),
    `${state.key}|${state.by}`,
    HISTORY_REFRESH,
  );
  const words = rangeOf(state.range).words;
  const totals = useMemo(() => {
    let requests = 0;
    let errors = 0;
    let cost = 0;
    if (history.status === "ready") {
      for (const series of history.data.series) {
        for (const point of series.points) {
          requests += point.requests;
          errors += point.errors;
          cost += point.costUsd;
        }
      }
    }
    return { requests, errors, cost };
  }, [history]);
  return (
    <div className="grid gap-4 px-4 lg:px-6 @5xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="@5xl/main:col-span-2">
        <HistoryChart
          title="Requests"
          description={
            history.status === "ready"
              ? `${count(totals.requests)} in ${words}, ${totals.requests === 0 ? "none" : percent(totals.errors / totals.requests)} failed`
              : `Every request the router answered in ${words}`
          }
          history={history}
          by={state.by}
          metric={METRICS.requests}
          names={names}
          action={<BySwitch value={state.by} onChange={state.setBy} options={["target", "slot"]} />}
        />
      </div>
      <HistoryChart
        title="Estimated cost"
        description={
          history.status === "ready"
            ? `${usd(totals.cost)} in ${words}, from list prices: never a bill`
            : "From list prices: never a bill"
        }
        history={history}
        by={state.by}
        metric={METRICS.cost}
        names={names}
        height={200}
      />
      <div className="flex flex-col gap-4">
        <JobsTile jobs={jobs} />
        <NeedsPanel />
      </div>
    </div>
  );
}

/** The "Needs you" panel: the newest few, each one line, and the way to the whole list. */
/** The heavy-job queue in one line, linking to its card on Machine. */
function JobsTile({ jobs }: { jobs: OverviewData["jobs"] }) {
  const gb = (value: number) => `${value.toLocaleString("en", { maximumFractionDigits: 1 })}`;
  return (
    <AppLink
      href="/machine#heavy-jobs"
      className="flex items-center justify-between gap-3 rounded-xl border bg-card px-6 py-4 text-sm text-card-foreground shadow-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span>
        <span className="font-semibold">Heavy jobs:</span> {gb(jobs.heldGb)} of {gb(jobs.budgetGb)}{" "}
        GB
        {jobs.waiting > 0 ? `, ${jobs.waiting} waiting` : ", nobody waits"}
      </span>
      {jobs.waiting > 0 ? (
        <TonePill tone="warn">queue</TonePill>
      ) : (
        <TonePill tone="ok">free</TonePill>
      )}
    </AppLink>
  );
}

function NeedsPanel() {
  const needs = useResource((client) => client.needs(), "", NEEDS_REFRESH);
  const items = needs.status === "ready" ? needs.data.items : [];
  return (
    <section
      aria-labelledby="needs-title"
      className="flex flex-col gap-1 rounded-xl border bg-card p-6 text-card-foreground shadow-xs"
    >
      <h2 id="needs-title" className="flex items-center gap-2 font-semibold">
        Needs you
        {items.length > 0 && <TonePill tone="warn">{items.length}</TonePill>}
      </h2>
      {needs.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Looking…</p>
      ) : (
        // Always the list, with its own empty state: what it settled stays in place.
        <NeedsList
          compact
          items={[...items].sort((a, b) => Date.parse(b.since) - Date.parse(a.since)).slice(0, 3)}
          empty={
            <p className="py-6 text-sm text-muted-foreground">
              <span className="text-ok" aria-hidden="true">
                ✓{" "}
              </span>
              Nothing needs you.
            </p>
          }
        />
      )}
      <AppLink
        href="/needs"
        className="mt-auto pt-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
      >
        {items.length > 3 ? `All ${items.length}, with their actions` : "Open Needs you"}
      </AppLink>
    </section>
  );
}

/** How many routed requests the page keeps from the stream: the router's own list's length. */
const RECENT_KEPT = 200;

/**
 * The answer with the requests the stream sent since: each `recent` event is one more request
 * in the router's list, so the page counts it without asking the server again.
 */
export function withRecent(data: OverviewData, live: readonly RecentRequest[]): OverviewData {
  const last = data.health.recent.at(-1)?.at ?? 0;
  const fresh = live.filter((request) => request.at > last);
  if (fresh.length === 0) return data;
  return {
    ...data,
    health: {
      ...data.health,
      recent: [...data.health.recent, ...fresh].slice(-RECENT_KEPT),
      requests: data.health.requests + fresh.length,
    },
  };
}

function OverviewPage({ data }: { data: OverviewData }) {
  // The page's clock, read when it draws: a new request draws it again.
  const now = Date.now();
  const state = useHistoryState("target");
  const { health } = data;
  const rpm = perMinute(health.recent, now);
  const breakers = Object.entries(health.breakers);
  const restingCount = Object.keys(health.cooling).length;
  const fiveHours = data.usage.find((u) => u.window === "5h");
  const sevenDays = data.usage.find((u) => u.window === "7d");
  const limit = data.limits[0];
  const fallback = data.fallbacks[0];

  return (
    <>
      <SectionCards columns={5}>
        <StatCard
          label="Requests a minute"
          value={rpm.toFixed(1)}
          badge={<TonePill tone="info">last 5 min</TonePill>}
          headline={`${count(health.requests)} since the router started`}
          detail={`Up for ${duration(health.uptimeSec * 1000)}`}
        />
        <StatCard
          label="Fallbacks"
          value={count(health.fallbacks)}
          badge={
            fallback !== undefined ? (
              <TonePill tone="warn">{data.fallbacks.length} slot now</TonePill>
            ) : (
              <TonePill tone="ok">none now</TonePill>
            )
          }
          headline={
            fallback === undefined
              ? "Every slot answers from its first target"
              : `${fallback.slot} answers from ${targetModel(fallback.target)}`
          }
          detail={
            fallback === undefined
              ? "A next target answered this many since start"
              : `Since ${fallback.since}, while ${fallback.model} rests`
          }
        />
        <StatCard
          label="Open breakers"
          value={count(breakers.length)}
          badge={
            breakers.length > 0 ? (
              <TonePill tone="bad">holding</TonePill>
            ) : (
              <TonePill tone="ok">none</TonePill>
            )
          }
          headline={
            breakers[0] === undefined
              ? "No slot is out of targets"
              : `${slotName(breakers[0][0])}: every target is limited or down`
          }
          detail={
            breakers[0] === undefined
              ? `${restingCount} target${restingCount === 1 ? "" : "s"} resting`
              : `${breakers[0][1].heldNow} request${breakers[0][1].heldNow === 1 ? "" : "s"} waiting now`
          }
        />
        <StatCard
          label="Claude replies, 5 h and 7 days"
          className="@4xl/main:col-span-2 @7xl/main:col-span-1"
          value={
            <span className="flex items-baseline gap-2">
              {count(fiveHours?.claudeReplies ?? 0)}
              <span className="text-base font-normal text-muted-foreground">
                / {count(sevenDays?.claudeReplies ?? 0)}
              </span>
            </span>
          }
          badge={
            limit === undefined ? (
              <TonePill tone="ok">no limit seen</TonePill>
            ) : (
              <TonePill tone="warn">limit until {limit.resets ?? "?"}</TonePill>
            )
          }
          headline={
            fiveHours !== undefined && fiveHours.claudeReplies > 0
              ? `${percent(fiveHours.premiumReplies / fiveHours.claudeReplies)} of the last 5 h on Opus or Fable`
              : "No Claude reply in the last 5 h"
          }
          detail="Plan percentages are only in Claude Code's status line"
        />
        <StatCard
          label="Crew sessions running"
          value={count(data.crewRunning)}
          badge={
            <AppLink
              href="/work"
              className="text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
            >
              Open Work
            </AppLink>
          }
          headline={
            data.crewRunning === 0 ? "No crew session runs now" : "Working, blocked or paused"
          }
          detail="Queued and finished ones are on Work"
        />
      </SectionCards>
      <FilterBar state={state} />
      <Charts state={state} jobs={data.jobs} />
      <DataTable
        label="Routing"
        tabs={[
          { value: "requests", label: "Requests", content: <RequestsTable state={state} /> },
          {
            value: "fallbacks",
            label: "Fallbacks now",
            badge: data.fallbacks.length,
            content: (
              <PortalTable
                rows={data.fallbacks}
                columns={FALLBACK_COLUMNS}
                rowKey={(row) => row.slot}
                label="Slots answering from a next target"
                empty="Every slot answers from its first target."
              />
            ),
          },
          {
            value: "limits",
            label: "Limits seen",
            badge: data.limits.length,
            content: (
              <PortalTable
                rows={data.limits}
                columns={LIMIT_COLUMNS}
                rowKey={(row) => `${row.model}-${row.claim}`}
                label="Plan limits the router saw"
                empty="The router has seen no plan limit."
              />
            ),
          },
        ]}
      />
    </>
  );
}

/** Overview: the traffic now, what answers it, and what needs you. */
export function OverviewView() {
  const overview = useResource((client) => client.overview(), "", OVERVIEW_REFRESH);
  const [live, setLive] = useState<RecentRequest[]>([]);
  useLiveEvent((message) => {
    if (message.name === "recent") {
      setLive((list) => [...list, recentOf(message.data)].slice(-RECENT_KEPT));
    }
  });
  return (
    <ResourceView resource={overview} label="the overview">
      {(data) => <OverviewPage data={withRecent(data, live)} />}
    </ResourceView>
  );
}
