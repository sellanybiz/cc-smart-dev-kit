"use client";

import { useMemo, useState } from "react";
import { recentOf } from "@/api/adapt";
import { useLiveEvent, useResource } from "@/api/hooks";
import { HISTORY_REFRESH, NEEDS_REFRESH, OVERVIEW_REFRESH } from "@/api/refresh";
import type {
  FallbackRow,
  LimitRow,
  OverviewData,
  PlanWindow,
  RecentRequest,
  SwitchFacts,
} from "@/api/types";
import { BySwitch } from "@/components/by-switch";
import { columnsFor, DataTable, PortalTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { HistoryChart } from "@/components/history-chart";
import { type HistoryState, useHistoryState, useSessionNames } from "@/components/history-state";
import { METRICS } from "@/components/metrics";
import { NeedsList } from "@/components/needs-list";
import { RequestsTable } from "@/components/requests-table";
import { AppLink } from "@/components/router";
import { SavedSwitch } from "@/components/saved-switch";
import { SectionCards, StatCard } from "@/components/section-cards";
import { PagePad, ResourceView } from "@/components/states";
import { TonePill } from "@/components/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  clockTime,
  costWords,
  count,
  duration,
  percent,
  slotName,
  targetModel,
  until,
} from "@/lib/format";
import { rangeOf } from "@/lib/history";

/**
 * The Overview's model-request headline: the count, or the reason there is none. Both numbers
 * of `OverviewRequests` are null for different reasons, and each is said in its own words
 * rather than a number the machine cannot give.
 */
function modelRequestsWords(requests: OverviewData["requests"]): string {
  if (requests.sinceRouterStart !== null) {
    return `${count(requests.sinceRouterStart)} model requests since the router started`;
  }
  return requests.perMinute === null
    ? "The history has logged no request, or cannot be read"
    : "The router does not answer, so nothing is counted from its start";
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
    // Requests the history could not price: the cost above is the priced rows' own (F1).
    let unpriced = 0;
    if (history.status === "ready") {
      for (const series of history.data.series) {
        for (const point of series.points) {
          requests += point.requests;
          errors += point.errors;
          cost += point.costUsd;
          unpriced += point.unpriced;
        }
      }
    }
    return { requests, errors, cost, unpriced };
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
            ? `${costWords(totals.cost, totals.unpriced)} in ${words}, from list prices: never a bill`
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

/**
 * The gateway's three switches, each the same command the CLI runs (`gateway on|off`, the judge
 * slot's mode, the opus and fable slots' mode), asked first, its result in place.
 */
function SwitchesCard({ switches, port }: { switches: SwitchFacts; port: number }) {
  return (
    <PagePad>
      <Card>
        <CardHeader>
          <CardTitle>Switches</CardTitle>
          <CardDescription>
            Each changes every running Claude session from its next request. You confirm first.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-6 @3xl/main:grid-cols-3">
            <SavedSwitch
              label="Gateway"
              help={
                switches.gateway
                  ? `On: Claude Code sends its requests through the router on 127.0.0.1:${port}.`
                  : "Off: Claude Code talks to Anthropic directly, and no slot answers."
              }
              checked={switches.gateway}
              action="switch"
              body={(on) => ({ name: "gateway", on })}
              question={`Turn the gateway ${switches.gateway ? "off" : "on"}?`}
            />
            <SavedSwitch
              label="Your own judge"
              help={
                switches.judgeUntested
                  ? "A target has not passed the force-push test, so the router ignores it."
                  : switches.judge
                    ? "On: your judge judges every auto-mode safety check in Claude's place. A weak judge can let a risky command through, and it reads the conversation."
                    : "Off: Claude judges auto mode's safety checks. It turns on only with a saved, fully force-push-tested chain."
              }
              checked={switches.judge}
              action="switch"
              body={(on) => ({ name: "judge", on })}
              question={`Turn your own judge ${switches.judge ? "off" : "on"}?`}
            />
            <SavedSwitch
              label="opus and fable slots"
              help={
                switches.models
                  ? "On: Opus and Fable requests go to the chains saved on the Slots page."
                  : "Off: Opus and Fable answer themselves."
              }
              checked={switches.models}
              action="switch"
              body={(on) => ({ name: "models", on })}
              question={`Turn the opus and fable slots ${switches.models ? "off" : "on"}?`}
            />
          </div>
          {switches.warnings.map((warning) => (
            <Alert key={warning} className="border-warn/40">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </CardContent>
      </Card>
    </PagePad>
  );
}

/**
 * The plan's 5-hour window, as Claude Code's status line last recorded it, and the newest plan
 * limit the router saw. Nothing else of the plan's usage is written down anywhere.
 */
function PlanCard({
  window,
  limit,
  now,
}: {
  window: null | PlanWindow;
  limit: LimitRow | undefined;
  now: number;
}) {
  return (
    <StatCard
      label="Plan usage, 5-hour window"
      className="@4xl/main:col-span-2 @7xl/main:col-span-1"
      value={window === null ? "—" : percent(window.percent / 100)}
      badge={
        limit !== undefined ? (
          <TonePill tone="warn">limit until {limit.resets ?? "?"}</TonePill>
        ) : window === null ? (
          <TonePill tone="info">no reading</TonePill>
        ) : (
          <TonePill tone="ok">no limit seen</TonePill>
        )
      }
      headline={
        window === null
          ? "The status line has recorded none yet"
          : window.resetsAt === null
            ? "Claude Code named no reset time"
            : `Resets ${until(window.resetsAt, now)}, at ${clockTime(window.resetsAt)}`
      }
      detail={
        limit !== undefined
          ? `${limit.model} ran out of ${limit.claim}`
          : "From the status line; the 7-day windows are written nowhere"
      }
    />
  );
}

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
  const note = needs.status === "ready" ? needs.data.note : null;
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
            note === null ? (
              <p className="py-6 text-sm text-muted-foreground">
                <span className="text-ok" aria-hidden="true">
                  ✓{" "}
                </span>
                Nothing needs you.
              </p>
            ) : null
          }
        />
      )}
      {note !== null && <p className="text-sm text-warn">{note}</p>}
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
  const { health, requests } = data;
  const breakers = Object.entries(health.breakers);
  const restingCount = Object.keys(health.cooling).length;
  const limit = data.limits[0];
  const fallback = data.fallbacks[0];

  return (
    <>
      <SectionCards columns={5}>
        <StatCard
          label="Model requests a minute"
          value={requests.perMinute === null ? "—" : requests.perMinute.toFixed(1)}
          badge={<TonePill tone="info">last 5 min</TonePill>}
          headline={modelRequestsWords(requests)}
          detail={`The router counted ${count(health.requests)} requests in all, pings included; up for ${duration(health.uptimeSec * 1000)}`}
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
        <PlanCard window={data.fiveHour} limit={limit} now={now} />
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
      <SwitchesCard switches={data.switches} port={health.port} />
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

/** Overview: the traffic now, what answers it, the switches, and what needs you. */
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
