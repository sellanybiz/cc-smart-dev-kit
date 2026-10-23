"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { type Resource, useResource } from "@/api/hooks";
import { GUARDS_REFRESH } from "@/api/refresh";
import type { ChartHistory, GuardAsk, GuardAsksPage, HistoryRange } from "@/api/types";
import { columnsFor, PortalTable } from "@/components/data-table";
import { RangeSwitch } from "@/components/filter-bar";
import { HistoryChart } from "@/components/history-chart";
import { useSessionNames } from "@/components/history-state";
import { METRICS } from "@/components/metrics";
import { useAppQuery, useSetAppQuery } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { ErrorState, LoadingState, PagePad } from "@/components/states";
import { TonePill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { clockSeconds, count } from "@/lib/format";
import { DEFAULT_RANGE, isRange, rangeOf } from "@/lib/history";
import { cn } from "@/lib/utils";

const column = columnsFor<GuardAsk>();

const COLUMNS = column.columns([
  column.accessor("at", {
    header: "Time",
    cell: ({ row }) => (
      <span className="font-mono text-xs whitespace-nowrap tabular-nums">
        {new Date(row.original.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{" "}
        {clockSeconds(row.original.at)}
      </span>
    ),
    enableHiding: false,
  }),
  column.accessor("hook", {
    header: "Guard",
    cell: ({ row }) => (
      <TonePill tone={row.original.hook === "auto-mode" ? "bad" : "warn"}>
        {row.original.hook}
      </TonePill>
    ),
  }),
  column.accessor("session", {
    header: "Session",
    cell: ({ row }) =>
      row.original.session === "" ? (
        <span className="text-muted-foreground">none named</span>
      ) : (
        <span className="font-mono text-xs">{row.original.session.slice(0, 8)}</span>
      ),
  }),
  column.accessor("tool", { header: "Tool" }),
  column.accessor("reason", {
    header: "What it asked",
    cell: ({ row }) => (
      <span className="block max-w-xl whitespace-normal text-pretty">{row.original.reason}</span>
    ),
    enableHiding: false,
  }),
]);

/** The guard log's asks per guard, in the history's shape, so the history chart draws them. */
function asHistory(page: GuardAsksPage, range: HistoryRange): ChartHistory {
  return {
    range,
    bucketMs: page.buckets.bucketMs,
    series: page.buckets.series.map((series) => ({
      key: series.key,
      points: series.points.map((point) => ({
        t: point.t,
        requests: point.count,
        errors: 0,
        p50Ms: 0,
        p95Ms: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      })),
    })),
  };
}

function Picker({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: null | string;
  options: { value: string; label: string }[];
  onChange: (value: null | string) => void;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <NativeSelectOption value="">{all}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

/** Guard log (D52): what each guard asked or refused, from `guard-asks.jsonl`, already masked. */
export function GuardsView() {
  const query = useAppQuery();
  const setQuery = useSetAppQuery();
  const names = useSessionNames();
  const rangeText = query.get("range");
  const range: HistoryRange = isRange(rangeText) ? rangeText : DEFAULT_RANGE;
  const guard = query.get("guard");
  const session = query.get("session");
  const key = `${range}|${guard ?? ""}|${session ?? ""}`;
  const [paging, setPaging] = useState<{ key: string; cursors: (null | string)[] }>({
    key,
    cursors: [null],
  });
  const cursors = paging.key === key ? paging.cursors : [null];
  const cursor = cursors.at(-1) ?? null;
  const page = useResource(
    (client) =>
      client.guardAsks({
        range,
        cursor,
        ...(guard === null ? {} : { guard }),
        ...(session === null ? {} : { session }),
      }),
    `${key}|${cursor ?? ""}`,
    GUARDS_REFRESH,
  );
  const set = (name: string, value: null | string) => {
    const next = new URLSearchParams(query);
    if (value === null || (name === "range" && value === DEFAULT_RANGE)) next.delete(name);
    else next.set(name, value);
    setQuery(next);
  };
  // The last page this filter showed stays while the next one loads: a page turn keeps the chart
  // and the table in place (no flash), and the pager says it is reading.
  const lastRef = useRef<null | { key: string; data: GuardAsksPage }>(null);
  if (page.status === "ready") lastRef.current = { key, data: page.data };
  const ready =
    page.status === "ready"
      ? page.data
      : page.status === "loading" && lastRef.current?.key === key
        ? lastRef.current.data
        : null;
  const turning = page.status === "loading" && ready !== null;
  const history = useMemo(() => (ready === null ? null : asHistory(ready, range)), [ready, range]);
  // The chart reads the same answer as the table, in the history's shape.
  let chartResource: Resource<ChartHistory> = { status: "loading" };
  if (history !== null) chartResource = { status: "ready", data: history };
  else if (page.status === "error") {
    chartResource = { status: "error", message: page.message, gateway: false, missing: false };
  }
  const totals = useMemo(() => {
    const byGuard = new Map<string, number>();
    for (const series of ready?.buckets.series ?? []) {
      byGuard.set(
        series.key,
        series.points.reduce((sum, point) => sum + point.count, 0),
      );
    }
    return byGuard;
  }, [ready]);
  // Every ask the filters kept in the range: the server's own count, not this page's rows.
  const all = ready?.kept ?? 0;
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const refused = totals.get("auto-mode") ?? 0;
  const words = rangeOf(range).words;

  return (
    <>
      <SectionCards columns={3}>
        <StatCard
          label="Asks and refusals"
          value={ready === null ? "…" : count(all)}
          headline={`In ${words}`}
          detail="Each one a call a guard stopped to ask about"
        />
        <StatCard
          label="Asked most"
          value={top === undefined ? "—" : top[0]}
          badge={top === undefined ? undefined : <TonePill tone="info">{count(top[1])}</TonePill>}
          headline="The guard that stopped you most"
          detail="A guard that asks often may need a project rule"
        />
        <StatCard
          label="Refused by auto mode"
          value={ready === null ? "…" : count(refused)}
          badge={
            refused > 0 ? (
              <TonePill tone="bad">refused</TonePill>
            ) : (
              <TonePill tone="ok">none</TonePill>
            )
          }
          headline="Calls the judge did not let through"
          detail="Nothing ran; the session was told why"
        />
      </SectionCards>
      <search aria-label="Filters" className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
        <RangeSwitch value={range} onChange={(value) => set("range", value)} />
        <span className="mx-1 hidden h-5 w-px bg-border @3xl/main:block" aria-hidden="true" />
        <Picker
          label="Guard"
          all="All guards"
          value={guard}
          options={(ready?.guards ?? []).map((g) => ({ value: g, label: g }))}
          onChange={(value) => set("guard", value)}
        />
        <Picker
          label="Session"
          all="All sessions"
          value={session}
          options={(ready?.sessions ?? []).map((s) => ({
            value: s,
            label: names.get(s) ?? s.slice(0, 8),
          }))}
          onChange={(value) => set("session", value)}
        />
      </search>
      <PagePad className="flex flex-col gap-4 md:gap-6">
        <HistoryChart
          title="Asks per guard"
          description={`How often each guard stopped to ask, in ${words}`}
          history={chartResource}
          by="guard"
          metric={METRICS.requests}
          height={200}
          bars
        />
        {page.status === "error" ? (
          <ErrorState message={page.message} onRetry={page.reload} />
        ) : ready === null ? (
          <LoadingState label="the guard log" />
        ) : (
          <div aria-busy={turning} className={cn(turning && "opacity-60 transition-opacity")}>
            <PortalTable
              rows={ready.rows}
              columns={COLUMNS}
              // Two asks can share a millisecond: the place on the page keeps each key unique.
              rowKey={(row, index) => `${cursor ?? "newest"}-${index}-${row.at}`}
              label="Guard log, newest first"
              empty={`No guard asked anything in ${words}.`}
              pager={
                (ready.rows.length > 0 || cursors.length > 1) && (
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-2">
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                      {turning
                        ? `Reading page ${cursors.length}…`
                        : `Page ${cursors.length}: ${count(ready.rows.length)} of ${count(ready.kept)}, newest first`}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={turning || cursors.length === 1}
                        onClick={() => setPaging({ key, cursors: cursors.slice(0, -1) })}
                      >
                        <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
                        Newer
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={turning || ready.next === null}
                        onClick={() => {
                          const next = ready.next;
                          if (next !== null) setPaging({ key, cursors: [...cursors, next] });
                        }}
                      >
                        Older
                        <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )
              }
            />
          </div>
        )}
      </PagePad>
    </>
  );
}
