"use client";

import { useState } from "react";
import { useResource } from "@/api/hooks";
import type { FlowReport, FlowWindow } from "@/api/types";
import { BarList } from "@/components/bar-list";
import { BucketChart } from "@/components/bucket-chart";
import { SectionCards, StatCard } from "@/components/section-cards";
import { EmptyState, PagePad, ResourceView } from "@/components/states";
import { TonePill } from "@/components/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ago, clockTime, count, duration, percent, shortDuration } from "@/lib/format";

const WINDOWS: readonly { value: FlowWindow; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

function isWindow(value: string): value is FlowWindow {
  return WINDOWS.some((window) => window.value === value);
}

function Measures({ report }: { report: FlowReport }) {
  const t = report.totals;
  const rows: { label: string; value: string }[] = [
    { label: "Questions to you", value: count(t.questions.askUserQuestion) },
    { label: "Plans shown for your yes", value: count(t.questions.exitPlanMode) },
    {
      label: "Work moved to the background",
      value:
        t.background === null
          ? "not recorded"
          : `${count(t.background.count)}, ${duration(t.background.totalMs)}`,
    },
    {
      label: "Idle between turns",
      value:
        t.idle === null
          ? "not recorded"
          : `${count(t.idle.count)} times, ${duration(t.idle.totalMs)}`,
    },
    { label: "Context compactions", value: count(t.compactions.count) },
    {
      label: "Auto mode refusals",
      value: count(Object.values(t.autoModeBlocks).reduce((a, b) => a + b, 0)),
    },
    { label: "Merges", value: count(t.merges.count) },
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-right tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FlowPage({ report, window }: { report: FlowReport; window: FlowWindow }) {
  const [now] = useState(() => Date.now());
  const t = report.totals;
  const prompts = t.prompts;
  const askers = Object.entries(prompts?.byAsker ?? {}).sort((a, b) => b[1].ms - a[1].ms);
  const span = window === "24h" ? "in 24 hours" : "in 7 days";
  const tick = (t: number) =>
    window === "24h"
      ? clockTime(t)
      : new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label="Agent launches"
          value={count(t.agents.launches)}
          headline={`From ${count(t.agents.replies)} replies ${span}`}
          detail={`${count(t.sessions)} session${t.sessions === 1 ? "" : "s"} did work`}
        />
        <StatCard
          label="Launched in parallel"
          value={percent(t.agents.parallelRatio)}
          badge={
            <TonePill tone={t.agents.parallelRatio >= 0.5 ? "ok" : "info"}>
              {count(t.agents.mostAtOnce)} at once at most
            </TonePill>
          }
          headline={`${count(t.agents.launchesParallel)} launches shared a reply`}
          detail="Two or more agents started by one reply"
        />
        <StatCard
          label="Blocked on prompts"
          value={prompts === null ? "—" : duration(prompts.totalMs)}
          badge={
            prompts !== null && prompts.count > 0 ? (
              <TonePill tone="warn">{count(prompts.count)} asks</TonePill>
            ) : undefined
          }
          headline={
            prompts === null
              ? "This Claude Code version records no prompt"
              : `The longest wait was ${duration(prompts.longestMs)}`
          }
          detail="Time a session waited for your answer"
        />
        <StatCard
          label="Waiting on you now"
          value={count(report.open.length)}
          badge={
            report.open.length > 0 ? (
              <TonePill tone="warn">answer</TonePill>
            ) : (
              <TonePill tone="ok">none</TonePill>
            )
          }
          headline={
            report.open[0] === undefined
              ? "No call waits for an answer"
              : `${report.open[0].asker} asks in ${report.open[0].project}`
          }
          detail={
            report.open[0] === undefined
              ? "An ask older than a day is left out"
              : `About ${report.open[0].tool}, ${ago(report.open[0].at, now)}`
          }
        />
      </SectionCards>
      <PagePad className="grid gap-4 @4xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-6">
        <div className="grid gap-4 @4xl/main:col-span-2 @4xl/main:grid-cols-2 md:gap-6">
          <BucketChart
            title="Launches"
            description={`Agents launched per ${report.buckets.bucketMs >= 6 * 3_600_000 ? "6 hours" : "hour"}, ${span}`}
            points={report.buckets.points.map((point) => ({ t: point.t, value: point.launches }))}
            format={count}
            tick={tick}
            label="Launches"
          />
          <BucketChart
            title="Blocked on prompts"
            description={`Time sessions waited for your answer, ${span}`}
            points={report.buckets.points.map((point) => ({ t: point.t, value: point.blockedMs }))}
            format={duration}
            axisFormat={shortDuration}
            tick={tick}
            label="Blocked"
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Top guard asks</CardTitle>
            <CardDescription>
              Who asked you before a call ran, by the time you spent answering.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {askers.length === 0 ? (
              <EmptyState title="Nothing asked you">
                {prompts === null
                  ? "This Claude Code version records no prompt."
                  : `No guard and no Claude Code prompt asked you ${span}.`}
              </EmptyState>
            ) : (
              <BarList
                label="Guard asks by time spent"
                rows={askers.map(([asker, ask]) => ({
                  key: asker,
                  label: asker,
                  value: ask.ms,
                  shown: duration(ask.ms),
                  note: `${count(ask.count)}×`,
                }))}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Other measures</CardTitle>
            <CardDescription>Everything else the report counted {span}.</CardDescription>
          </CardHeader>
          <CardContent>
            <Measures report={report} />
            {report.missing.length > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Not recorded by this Claude Code version: {report.missing.join(", ")}.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="gap-0 overflow-hidden py-0 @4xl/main:col-span-2">
          <CardHeader className="border-b py-4">
            <CardTitle>Sessions</CardTitle>
            <CardDescription>Each session that worked {span}, busiest first.</CardDescription>
          </CardHeader>
          {report.sessions.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No session worked">
                A session you run shows up here within a minute.
              </EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Sessions">
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Launches</TableHead>
                    <TableHead className="text-right">In parallel</TableHead>
                    <TableHead className="text-right">At once</TableHead>
                    <TableHead className="text-right">Waited on you</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...report.sessions]
                    .sort((a, b) => (b.activeMs ?? 0) - (a.activeMs ?? 0))
                    .map((session) => (
                      <TableRow key={session.session}>
                        <TableCell className="font-medium">{session.project}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {session.session.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {session.activeMs === null ? "—" : duration(session.activeMs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count(session.agents.launches)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {percent(session.agents.parallelRatio)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count(session.agents.mostAtOnce)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {session.prompts === null
                            ? "—"
                            : `${duration(session.prompts.totalMs)} (${count(session.prompts.count)})`}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </PagePad>
    </>
  );
}

/** Flow: the flow report for a window (`cc-smart-dev-kit report`, `src/sessions/flow.ts`). */
export function FlowView() {
  const [windowKey, setWindowKey] = useState<FlowWindow>("24h");
  const flow = useResource((client) => client.flow(windowKey), windowKey);
  return (
    <>
      <PagePad className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Read from Claude Code's own transcripts on this machine. Counts and times only.
        </p>
        <ToggleGroup
          type="single"
          variant="outline"
          value={windowKey}
          aria-label="Window"
          onValueChange={(value) => {
            if (isWindow(value)) setWindowKey(value);
          }}
        >
          {WINDOWS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="px-3">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PagePad>
      <ResourceView resource={flow} label="the flow report">
        {(report) => <FlowPage report={report} window={windowKey} />}
      </ResourceView>
    </>
  );
}
