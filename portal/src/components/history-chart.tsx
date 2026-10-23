"use client";

import { type ReactNode, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import type { Resource } from "@/api/hooks";
import type { ChartHistory, HistoryPoint, HistoryRange } from "@/api/types";
import { useMounted } from "@/components/status";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { clockTime, slotName, targetModel } from "@/lib/format";
import { rangeOf } from "@/lib/history";
import {
  coloursFor,
  isSeriesColour,
  type SeriesBy,
  type SeriesColour,
  SWATCH,
} from "@/lib/series-colours";
import { cn } from "@/lib/utils";

/** What a chart draws of each point, and how a bucket of several series adds up. */
export interface Metric {
  /** The value of one point. */
  of: (point: HistoryPoint) => number;
  /** How the axis and the tooltip write a value. */
  format: (value: number) => string;
  /** `sum`: stacked areas that add up. `each`: one line per series, never added. */
  mode: "sum" | "each";
  /** A count of whole things: the axis shows no fractions. */
  whole?: boolean;
  /**
   * What the chart says when every row of the window measures zero — a measure that is zero
   * for a reason other than "no request". Null (the default) keeps "Nothing … matches".
   */
  whenZero?: (totals: { range: HistoryRange; requests: number; unpriced: number }) => null | string;
}

/**
 * What the window holds overall: its requests, and how many of them no price could be given
 * (`HistoryPoint.unpriced`). From the same points the chart draws, so the two never disagree.
 */
export function totalsOf(history: ChartHistory): { requests: number; unpriced: number } {
  let requests = 0;
  let unpriced = 0;
  for (const series of history.series) {
    for (const point of series.points) {
      requests += point.requests;
      unpriced += point.unpriced;
    }
  }
  return { requests, unpriced };
}

type Row = { t: number } & Partial<Record<SeriesColour, number>>;

/** A key as a person reads it. */
export function seriesLabel(key: string, by: SeriesBy, names?: Map<string, string>): string {
  if (by === "slot") return slotName(key);
  if (by === "target") return targetModel(key);
  if (by === "session") return names?.get(key) ?? key.slice(0, 8);
  return key;
}

function rowsOf(history: ChartHistory, colours: Map<string, SeriesColour>, metric: Metric): Row[] {
  const rows = new Map<number, Row>();
  for (const series of history.series) {
    const colour = colours.get(series.key) ?? "other";
    // A line chart draws its coloured series only: "Other" has no meaning for a median.
    if (metric.mode === "each" && colour === "other") continue;
    for (const point of series.points) {
      const row = rows.get(point.t) ?? { t: point.t };
      row[colour] = (row[colour] ?? 0) + metric.of(point);
      rows.set(point.t, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

export function tickFor(range: HistoryRange): (t: number) => string {
  if (rangeOf(range).spanMs <= 24 * 3_600_000) return clockTime;
  return (t) =>
    new Date(t).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(range === "7d" ? { weekday: "short" } : {}),
    });
}

/**
 * dashboard-01's interactive area chart, for any measure of the request history: stacked areas
 * that add up (requests, cost, tokens), or one line per series (latency, error rate). Drawn
 * after mount only: Recharts sizes itself through inline styles, which the exported HTML must
 * not hold. A legend names every series; colour is never the only label.
 */
export function HistoryChart({
  title,
  description,
  history,
  by,
  metric,
  action,
  height = 250,
  names,
  footer,
  bars = false,
}: {
  /** Stacked bars instead of areas: for sparse counts, where an area would draw spikes. */
  bars?: boolean;
  title: string;
  description: ReactNode;
  history: Resource<ChartHistory>;
  by: SeriesBy;
  metric: Metric;
  action?: ReactNode;
  height?: 160 | 200 | 250;
  names?: Map<string, string>;
  footer?: ReactNode;
}) {
  const mounted = useMounted();
  const data = history.status === "ready" ? history.data : null;
  const colours = useMemo(
    () => (data === null ? new Map<string, SeriesColour>() : coloursFor(data, by)),
    [data, by],
  );
  const rows = useMemo(
    () => (data === null ? [] : rowsOf(data, colours, metric)),
    [data, colours, metric],
  );
  const totals = useMemo(() => (data === null ? null : totalsOf(data)), [data]);
  const legend = useMemo(() => {
    const out: { colour: SeriesColour; label: string }[] = [];
    for (const [key, colour] of colours) {
      if (colour !== "other") out.push({ colour, label: seriesLabel(key, by, names) });
    }
    out.sort((a, b) => (a.colour < b.colour ? -1 : 1));
    if (metric.mode === "sum" && [...colours.values()].includes("other")) {
      out.push({ colour: "other", label: "Other" });
    }
    return out;
  }, [colours, by, names, metric.mode]);
  // A line chart cannot fold the rest into "Other" (a median does not add up): say how many
  // series it leaves out, so a missing one is never a silent gap.
  const notDrawn =
    metric.mode === "each"
      ? [...colours.values()].filter((colour) => colour === "other").length
      : 0;
  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        legend.map(({ colour, label }) => [colour, { label, color: `var(--color-${colour})` }]),
      ),
    [legend],
  );
  const empty =
    rows.length === 0 ||
    rows.every((row) => legend.every(({ colour }) => (row[colour] ?? 0) === 0));
  const tick = data === null ? clockTime : tickFor(data.range);
  const heightClass = height === 160 ? "h-[160px]" : height === 200 ? "h-[200px]" : "h-[250px]";
  const stack = [...legend].reverse();

  let body: ReactNode;
  if (history.status === "error") {
    body = (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
        {history.gateway
          ? "The gateway is not set up, so there is no history."
          : `The history could not load: ${history.message}`}
      </div>
    );
  } else if (!mounted || data === null) {
    body = <Skeleton className="h-full w-full rounded-lg" />;
  } else if (empty) {
    // A window whose rows are all zero for a reason of its own (only cost can be): the measure
    // says so rather than "nothing matches", which would be wrong while requests are there.
    const zero =
      totals === null ? null : (metric.whenZero?.({ ...totals, range: data.range }) ?? null);
    body = (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
        {zero ?? `Nothing in ${rangeOf(data.range).words} matches.`}
      </div>
    );
  } else {
    const axes = (
      <>
        <CartesianGrid vertical={false} />
        <YAxis
          width={48}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          allowDecimals={metric.whole !== true}
          tickFormatter={(value: number) => metric.format(value)}
        />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          tickFormatter={tick}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const t = payload?.[0]?.payload?.t;
                return typeof t === "number" ? tick(t) : "";
              }}
              formatter={(value, name) => (
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className={cn(
                        "size-2.5 rounded-[3px]",
                        isSeriesColour(name) ? SWATCH[name] : SWATCH.other,
                      )}
                    />
                    {config[String(name)]?.label}
                  </span>
                  <span className="font-medium text-foreground tabular-nums">
                    {metric.format(Number(value))}
                  </span>
                </span>
              )}
            />
          }
        />
      </>
    );
    body = (
      <ChartContainer config={config} className={cn("aspect-auto w-full", heightClass)}>
        {metric.mode === "sum" && bars ? (
          <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
            {axes}
            {stack.map(({ colour }, index) => (
              <Bar
                key={colour}
                dataKey={colour}
                fill={`var(--color-${colour})`}
                stackId="history"
                radius={index === stack.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : metric.mode === "sum" ? (
          <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
            <defs>
              {legend.map(({ colour }) => (
                <linearGradient key={colour} id={`fill-${colour}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${colour})`} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={`var(--color-${colour})`} stopOpacity={0.06} />
                </linearGradient>
              ))}
            </defs>
            {axes}
            {stack.map(({ colour }) => (
              <Area
                key={colour}
                dataKey={colour}
                type="monotone"
                fill={`url(#fill-${colour})`}
                stroke={`var(--color-${colour})`}
                strokeWidth={2}
                stackId="history"
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
            {axes}
            {legend.map(({ colour }) => (
              <Line
                key={colour}
                dataKey={colour}
                type="monotone"
                stroke={`var(--color-${colour})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {action !== undefined && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6">
        <div className={cn("w-full", heightClass)}>{body}</div>
        {legend.length > 0 && history.status === "ready" && (
          <ul
            aria-label={`${title}: series`}
            className="mt-3 flex flex-wrap gap-x-5 gap-y-1 px-2 text-sm"
          >
            {legend.map(({ colour, label }) => (
              <li key={colour} className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-[3px]", SWATCH[colour])} aria-hidden="true" />
                <span
                  className={cn(
                    by !== "slot" && by !== "session" && colour !== "other" && "font-mono text-xs",
                  )}
                >
                  {label}
                </span>
              </li>
            ))}
            {notDrawn > 0 && (
              <li className="text-muted-foreground">
                and {notDrawn} more, not drawn: filter to one to see it
              </li>
            )}
          </ul>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}
