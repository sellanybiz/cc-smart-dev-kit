"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
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
  const ready = page.status === "ready" ? page.data : null;
  const history = useMemo(() => (ready === null ? null : asHistory(ready, range)), [ready, range]);
  // The chart reads the same answer as the table, in the history's shape.
  let chartResource: Resource<ChartHistory> = { status: "loading" };
  if (history !== null) chartResource = { status: "ready", data: history };
  else if (page.status === "error") {
    chartResource = { status: "error", message: page.message, gateway: false };
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
  const all = [...totals.values()].reduce((sum, n) => sum + n, 0);
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
        {page.status === "loading" ? (
          <LoadingState label="the guard log" />
        ) : page.status === "error" ? (
          <ErrorState message={page.message} onRetry={page.reload} />
        ) : (
          <PortalTable
            rows={page.data.rows}
            columns={COLUMNS}
            rowKey={(row) => `${row.at}-${row.hook}`}
            label="Guard log, newest first"
            empty={`No guard asked anything in ${words}.`}
            pager={
              page.data.rows.length > 0 && (
                <div className="flex items-center justify-end gap-4 px-2">
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    Page {cursors.length}, newest first
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cursors.length === 1}
                    onClick={() => setPaging({ key, cursors: cursors.slice(0, -1) })}
                  >
                    <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
                    Newer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page.data.next === null}
                    onClick={() => {
                      const next = page.data.next;
                      if (next !== null) setPaging({ key, cursors: [...cursors, next] });
                    }}
                  >
                    Older
                    <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
                  </Button>
                </div>
              )
            }
          />
        )}
      </PagePad>
    </>
  );
}
