"use client";

import { RotateCwIcon, ServerIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useResource } from "@/api/hooks";
import { HEALTH_REFRESH, HISTORY_REFRESH } from "@/api/refresh";
import type { BackendRow, HealthData, LogLine, PortHolder } from "@/api/types";
import { ActionButton } from "@/components/action-button";
import { CommandLine } from "@/components/copy-button";
import { columnsFor, DataTable, PortalTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { HistoryChart } from "@/components/history-chart";
import { useHistoryState } from "@/components/history-state";
import { METRICS } from "@/components/metrics";
import { RequestsTable } from "@/components/requests-table";
import { SectionCards, StatCard } from "@/components/section-cards";
import { EmptyState, PagePad, ResourceView } from "@/components/states";
import { StatusMark, type Tone, TonePill } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { count, duration, slotName, targetModel, until } from "@/lib/format";
import { rangeOf } from "@/lib/history";

const LEVEL_TONE: Record<LogLine["level"], Tone> = { INFO: "info", WARN: "warn", ERROR: "bad" };

type NumberedLine = LogLine & { n: number };

const column = columnsFor<NumberedLine>();

const LOG_COLUMNS = column.columns([
  column.accessor("time", {
    header: "Time",
    cell: ({ row }) => <span className="font-mono text-xs tabular-nums">{row.original.time}</span>,
    enableHiding: false,
    enableSorting: false,
  }),
  column.accessor("level", {
    header: "Level",
    cell: ({ row }) => (
      <TonePill tone={LEVEL_TONE[row.original.level]}>{row.original.level.toLowerCase()}</TonePill>
    ),
    enableSorting: false,
  }),
  column.accessor("text", {
    header: "Message",
    cell: ({ row }) => (
      <span className="block max-w-3xl whitespace-normal text-pretty">{row.original.text}</span>
    ),
    enableHiding: false,
    enableSorting: false,
  }),
]);

function BackendItem({ backend }: { backend: BackendRow }) {
  const tone: Tone =
    backend.state === "answers" ? "ok" : backend.state === "failed" ? "bad" : "info";
  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <ServerIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {backend.name}
        </span>
        <TonePill tone={tone}>
          {backend.state === "answers"
            ? `answers in ${duration(backend.ms ?? 0)}`
            : backend.state === "failed"
              ? "does not answer"
              : "not listed"}
        </TonePill>
      </div>
      <span className="wrap-any font-mono text-xs text-muted-foreground">{backend.url}</span>
      {backend.why !== null && <span className="text-sm text-bad">{backend.why}</span>}
      {backend.state === "answers" && (
        <span className="text-sm text-muted-foreground">
          {count(backend.models.length)} models listed
        </span>
      )}
    </li>
  );
}

/** The port holder's state, as the card's value and pill: doctor's verdict decides the tone. */
function holderWords(holder: PortHolder): { tone: Tone; pill: string; value: string } {
  if (!holder.check.ok) {
    return holder.state === "start-limit"
      ? { pill: "closed", tone: "bad", value: "Closed by systemd" }
      : { pill: "fix", tone: "bad", value: "Not ready" };
  }
  return holder.state === "open"
    ? { pill: "holds the port", tone: "ok", value: "Ready" }
    : { pill: "set up", tone: "info", value: "Set up" };
}

/**
 * What holds the router's port across restarts: systemd's socket unit, or the Windows task.
 * Its words are doctor's own, and a failure carries doctor's fix to copy.
 */
function PortHolderCard({ holder }: { holder: HealthData["socket"] }) {
  if (holder === null) {
    return (
      <StatCard
        label="Port holder"
        value="None"
        badge={<TonePill tone="info">no service</TonePill>}
        headline="No systemd and no Windows task here"
        detail="So nothing holds the port while the router restarts"
      />
    );
  }
  const words = holderWords(holder);
  return (
    <StatCard
      label={holder.kind === "systemd" ? "Socket unit" : "Windows task"}
      value={words.value}
      badge={<TonePill tone={words.tone}>{words.pill}</TonePill>}
      headline={<span className="font-mono text-xs">{holder.name}</span>}
      detail={
        <span className="flex flex-col items-start gap-2">
          <span className="text-pretty">{holder.check.text}</span>
          {!holder.check.ok && <CommandLine command={holder.check.fix} label="Copy" />}
        </span>
      }
    />
  );
}

/**
 * The router does not answer: why, the commands that show its state and its log (on systemd,
 * named from the socket unit the server read), and the restart, asked first in the design's
 * words. `router.restart` runs `gateway setup --yes`, the command line's own.
 */
function RouterDown({ data }: { data: HealthData }) {
  const { router, socket } = data;
  const unit =
    socket !== null && socket.kind === "systemd" ? socket.name.replace(/\.socket$/, "") : null;
  return (
    <PagePad>
      <Alert className="border-bad/40">
        <TriangleAlertIcon className="text-bad" aria-hidden="true" />
        <AlertTitle>The router is not answering</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span className="text-pretty">
            Nothing came back from 127.0.0.1:{router.port} ({router.why ?? "no answer"}). Subagents
            on the affordable slots may fail until it is back.
          </span>
          {unit !== null && (
            <span className="flex flex-col gap-2">
              <CommandLine command={`systemctl --user status ${unit}`} label="Copy" />
              <CommandLine command={`journalctl --user -u ${unit} -f`} label="Copy" />
            </span>
          )}
          <ActionButton
            action="router.restart"
            body={{}}
            icon={<RotateCwIcon data-icon="inline-start" aria-hidden="true" />}
            confirm={{
              title: "Restart the router?",
              body:
                socket !== null && socket.kind === "systemd" && socket.state === "open"
                  ? "A restart lets the answers in flight finish first (up to 120 s). New requests wait in its socket meanwhile; none fails."
                  : "Nothing holds the router's port while it restarts, so a request fails until it answers again.",
              yes: "Restart it",
            }}
          >
            Restart the router
          </ActionButton>
        </AlertDescription>
      </Alert>
    </PagePad>
  );
}

function HealthPage({ data }: { data: HealthData }) {
  const [now] = useState(() => Date.now());
  const { router, socket } = data;
  // The journal's order is oldest first; the page shows it newest first (`newestFirst`).
  const log = useMemo(() => [...data.log].reverse().map((line, n) => ({ ...line, n })), [data.log]);
  const problems = log.filter((line) => line.level !== "INFO");
  const answering = data.backends.filter((b) => b.state === "answers").length;
  const breakers = Object.entries(data.breakers);
  const state = useHistoryState("target");
  const [percentile, setPercentile] = useState<"p50" | "p95">("p50");
  const byTarget = useResource(
    (client) => client.history({ ...state.filter, range: state.range, by: "target" }),
    `${state.key}|target`,
    HISTORY_REFRESH,
  );
  const words = rangeOf(state.range).words;
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label="Router"
          value={router.up ? "Answers" : "Down"}
          badge={<TonePill tone={router.up ? "ok" : "bad"}>{router.up ? "up" : "down"}</TonePill>}
          headline={
            router.up
              ? `Up for ${duration(router.uptimeSec * 1000)}`
              : (router.why ?? "It does not answer")
          }
          detail={`On 127.0.0.1:${router.port}`}
        />
        <PortHolderCard holder={socket} />
        <StatCard
          label="Backends answering"
          value={`${answering} of ${data.backends.length}`}
          badge={
            answering === data.backends.length ? (
              <TonePill tone="ok">all</TonePill>
            ) : (
              <TonePill tone="bad">{data.backends.length - answering} down</TonePill>
            )
          }
          headline="Each one's model list, asked just now"
          detail="A slot skips a target whose backend fails"
        />
        <StatCard
          label="Warnings and errors"
          value={problems.length}
          badge={
            problems.length > 0 ? (
              <TonePill tone="warn">read</TonePill>
            ) : (
              <TonePill tone="ok">none</TonePill>
            )
          }
          headline={`In the last ${log.length} log lines`}
          detail={`${count(router.fallbacks)} fallbacks, ${count(router.requests)} requests since start`}
        />
      </SectionCards>
      {!router.up && <RouterDown data={data} />}
      <PagePad className="grid gap-4 md:gap-6 @4xl/main:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Backends</CardTitle>
            <CardDescription>
              Where the affordable targets answer from. Keys are never shown.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.backends.length === 0 ? (
              <EmptyState title="No backend is set up">Only your Claude login answers.</EmptyState>
            ) : (
              <ul>
                {data.backends.map((backend) => (
                  <BackendItem key={backend.name} backend={backend} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Resting and held</CardTitle>
            <CardDescription>Targets the router skips for now, and slots it holds.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {router.cooling.length === 0 && breakers.length === 0 ? (
              <EmptyState title="Nothing rests">Every target can answer.</EmptyState>
            ) : (
              <>
                {router.cooling.map(([target, left]) => (
                  <StatusMark key={target} tone="warn">
                    <span className="font-mono text-xs">{targetModel(target)}</span> rests for{" "}
                    {duration(left * 1000)}
                  </StatusMark>
                ))}
                {breakers.map(([slot, breaker]) => (
                  <div key={slot} className="flex flex-col gap-1">
                    <StatusMark tone="bad">
                      The {slotName(slot)} breaker is open: {count(breaker.heldNow)} waiting,{" "}
                      {count(breaker.held)} held
                    </StatusMark>
                    <ul className="pl-[1.125rem] text-muted-foreground">
                      {breaker.targets.map((target) => (
                        <li key={target.target}>
                          <span className="font-mono text-xs">{targetModel(target.target)}</span>{" "}
                          {target.status === null
                            ? "gave no answer"
                            : `answered HTTP ${target.status}`}
                          , asked again {until(target.until, now)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </PagePad>
      <FilterBar state={state} />
      <PagePad className="grid gap-4 md:gap-6 @4xl/main:grid-cols-2">
        <HistoryChart
          title="Latency"
          description={`${percentile === "p50" ? "The median" : "The 95th percentile"} time a request took, per target, in ${words}`}
          history={byTarget}
          by="target"
          metric={percentile === "p50" ? METRICS.p50 : METRICS.p95}
          height={200}
          action={
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={percentile}
              aria-label="Percentile"
              onValueChange={(next) => {
                if (next === "p50" || next === "p95") setPercentile(next);
              }}
            >
              <ToggleGroupItem value="p50" className="px-3">
                p50
              </ToggleGroupItem>
              <ToggleGroupItem value="p95" className="px-3">
                p95
              </ToggleGroupItem>
            </ToggleGroup>
          }
        />
        <HistoryChart
          title="Error rate"
          description={`The share of requests that failed, per target, in ${words}`}
          history={byTarget}
          by="target"
          metric={METRICS.errorRate}
          height={200}
        />
      </PagePad>
      <DataTable
        label="Activity and log"
        tabs={[
          { value: "requests", label: "Requests", content: <RequestsTable state={state} /> },
          {
            value: "log",
            label: "Log",
            content: (
              <PortalTable
                rows={log}
                columns={LOG_COLUMNS}
                rowKey={(row) => String(row.n)}
                label="Router log, newest first"
                empty="The router has written nothing yet."
              />
            ),
          },
          {
            value: "problems",
            label: "Problems",
            badge: problems.length,
            content: (
              <PortalTable
                rows={problems}
                columns={LOG_COLUMNS}
                rowKey={(row) => String(row.n)}
                label="Warnings and errors, newest first"
                empty="No warning and no error."
              />
            ),
          },
        ]}
      />
    </>
  );
}

/** Health: the router, its socket, the backends, the WARN and ERROR lines, the activity feed. */
export function HealthView() {
  const health = useResource((client) => client.health(), "", HEALTH_REFRESH);
  return (
    <ResourceView resource={health} label="the health page">
      {(data) => <HealthPage data={data} />}
    </ResourceView>
  );
}
