"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useMounted } from "@/components/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";

const CONFIG = { value: { label: "Value", color: "var(--color-s1)" } } satisfies ChartConfig;
// The bar reads `--color-s1` straight from the chart's tokens (globals.css): no style element.

/**
 * One measure per bucket, as bars: a single series, so the title names it and no legend is
 * needed. Drawn after mount only (Recharts sizes itself through inline styles).
 */
export function BucketChart({
  title,
  description,
  points,
  format,
  tick,
  label,
  axisFormat,
}: {
  title: string;
  description: string;
  points: { t: number; value: number }[];
  format: (value: number) => string;
  tick: (t: number) => string;
  /** The measure's name in the tooltip. */
  label: string;
  /** How the axis writes a value; the tooltip's `format` when left out. */
  axisFormat?: (value: number) => string;
}) {
  const mounted = useMounted();
  const config = { value: { ...CONFIG.value, label } } satisfies ChartConfig;
  const empty = points.every((point) => point.value === 0);
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <div className="h-[160px] w-full">
          {!mounted ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : empty ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Nothing in this window.
            </div>
          ) : (
            <ChartContainer config={config} className="aspect-auto h-[160px] w-full">
              <BarChart data={points} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <YAxis
                  width={48}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => (axisFormat ?? format)(v)}
                />
                <XAxis
                  dataKey="t"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={40}
                  tickFormatter={(t: number) => tick(t)}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const t = payload?.[0]?.payload?.t;
                        return typeof t === "number" ? tick(t) : "";
                      }}
                      formatter={(value) => (
                        <span className="flex w-full justify-between gap-3">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium tabular-nums">{format(Number(value))}</span>
                        </span>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="value"
                  fill="var(--color-s1)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
