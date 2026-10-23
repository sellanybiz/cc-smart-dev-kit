"use client";

import { useEffect, useState } from "react";
import { portalClient } from "@/api/client";
import { type Resource, useResource } from "@/api/hooks";
import type { JobEntry, JobStore, JobsData } from "@/api/types";
import { EmptyState } from "@/components/states";
import { StatusMark, TonePill } from "@/components/status";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { duration } from "@/lib/format";

/** The queue: `GET /api/jobs` once, then every `jobs` event the stream sends, with no reload. */
export function useJobs(): Resource<JobsData> {
  const first = useResource((client) => client.jobs());
  const [live, setLive] = useState<JobsData | null>(null);
  useEffect(() => portalClient().onJobs(setLive), []);
  if (live !== null) return { status: "ready", data: live };
  return first;
}

/** The clock, a tick every `everyMs`: for a "for 2 min" that stays true while the page is open. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

const gb = (value: number) => `${value.toLocaleString("en", { maximumFractionDigits: 1 })} GB`;

/** Held against the budget, as a bar: an SVG whose widths are attributes, never styles. */
function BudgetMeter({ store }: { store: JobStore }) {
  const held = store.held.reduce((sum, job) => sum + job.gb, 0);
  const share = store.budgetGb === 0 ? 0 : Math.min(1, held / store.budgetGb);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="font-medium">{gb(held)}</span> held of a {gb(store.budgetGb)} budget
          {store.where !== "machine" && (
            <span className="text-muted-foreground"> in {store.where}</span>
          )}
        </span>
        <span className="text-muted-foreground">{gb(store.freeGb)} free now</span>
      </div>
      {/* The native meter speaks; the SVG draws it (a meter's own look cannot be themed). */}
      <meter className="sr-only" min={0} max={store.budgetGb} value={held}>
        {gb(held)} of {gb(store.budgetGb)}
      </meter>
      <svg className="h-2.5 w-full" aria-hidden="true" preserveAspectRatio="none">
        <rect width="100%" height="100%" rx="4" className="fill-muted" />
        <rect width={`${share * 100}%`} height="100%" rx="4" className="fill-primary" />
      </svg>
      {store.note !== undefined && <p className="text-xs text-muted-foreground">{store.note}</p>}
    </div>
  );
}

function JobRows({
  jobs,
  now,
  waiting,
}: {
  jobs: (JobEntry & { exclusive?: boolean })[];
  now: number;
  waiting: boolean;
}) {
  return (
    <>
      {jobs.map((job, index) => (
        <TableRow key={job.pid}>
          <TableCell>
            <span className="flex items-center gap-2">
              {waiting && (
                <span className="text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
              )}
              {job.kind}
              {job.exclusive === true && <TonePill tone="info">alone</TonePill>}
            </span>
          </TableCell>
          <TableCell className="text-right tabular-nums">{gb(job.gb)}</TableCell>
          <TableCell className="min-w-40 font-mono text-xs whitespace-normal wrap-anywhere">
            {job.command}
          </TableCell>
          <TableCell
            className="max-w-64 font-mono text-xs whitespace-normal wrap-anywhere"
            title={job.folder}
          >
            {job.folder.split("/").slice(-2).join("/")}
          </TableCell>
          <TableCell className="whitespace-normal">{job.user}</TableCell>
          <TableCell className="whitespace-nowrap tabular-nums">
            {job.since === null
              ? "—"
              : `${waiting ? "waits " : "for "}${duration(
                  Math.max(0, Math.round((now - job.since) / 1000) * 1000),
                )}`}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

/**
 * What a heavy job gives way with under load besides memory: the CPU and disk I/O weights its
 * scope gets (systemd's `CPUWeight` and `IOWeight`; a unit that sets none has 100), or why one
 * is not set on this machine.
 */
function Weights({ weights }: { weights: JobsData["weights"] }) {
  const rows: { label: string; weight: JobsData["weights"]["cpu"] }[] = [
    { label: "CPU", weight: weights.cpu },
    { label: "Disk I/O", weight: weights.io },
  ];
  return (
    <ul className="flex flex-col gap-1">
      {rows.map(({ label, weight }) => (
        <li key={label}>
          <StatusMark tone={weight.value === null ? "info" : "ok"}>
            {weight.value === null ? (
              <>
                {label}: no weight is set ({weight.why ?? "the machine does not say why"}).
              </>
            ) : (
              <>
                {label} weight <span className="tabular-nums">{weight.value}</span>
                {weight.value < 100
                  ? ": under load a job gives way to the rest of the machine, which runs at 100."
                  : ", the same as or above the rest of the machine (100)."}
              </>
            )}
          </StatusMark>
        </li>
      ))}
    </ul>
  );
}

/** The Machine page's "Heavy jobs" card: the budget, what runs, and who waits in turn. */
export function HeavyJobsCard() {
  const jobs = useJobs();
  const now = useNow(5_000);
  const data = jobs.status === "ready" ? jobs.data : null;
  const held = data?.stores.reduce((sum, store) => sum + store.held.length, 0) ?? 0;
  const waiting = data?.stores.reduce((sum, store) => sum + store.waiting.length, 0) ?? 0;
  return (
    <Card id="heavy-jobs" className="scroll-mt-20 @4xl/main:col-span-2">
      <CardHeader>
        <CardTitle>Heavy jobs</CardTitle>
        <CardDescription>
          Type checks, builds and test runs share the memory in turn: a job waits until its memory
          is free.
        </CardDescription>
        {data !== null && (
          <CardAction>
            {waiting > 0 ? (
              <TonePill tone="warn">{waiting} waiting</TonePill>
            ) : held > 0 ? (
              <TonePill tone="ok">{held} running</TonePill>
            ) : (
              <TonePill tone="info">idle</TonePill>
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {jobs.status === "loading" ? (
          <Skeleton className="h-32 w-full" />
        ) : jobs.status === "error" ? (
          <p className="text-sm text-bad">The job queue could not be read: {jobs.message}</p>
        ) : (
          jobs.data.stores.map((store) => (
            <div key={store.where} className="flex flex-col gap-4">
              <BudgetMeter store={store} />
              {store.held.length === 0 && store.waiting.length === 0 ? (
                <EmptyState title="Nothing held, nobody waits">
                  A heavy command a session runs shows up here while it holds memory.
                </EmptyState>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table
                    aria-label={`Heavy jobs on ${store.where === "machine" ? "this machine" : store.where}`}
                  >
                    <TableHeader className="bg-muted">
                      <TableRow>
                        <TableHead>Kind</TableHead>
                        <TableHead className="text-right">Memory</TableHead>
                        <TableHead>Command</TableHead>
                        <TableHead>Folder</TableHead>
                        <TableHead>Who</TableHead>
                        <TableHead>Since</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <JobRows jobs={store.held} now={now} waiting={false} />
                      {store.waiting.length > 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={6}
                            className="bg-muted/40 py-1.5 text-xs font-medium text-muted-foreground"
                          >
                            Waiting, in queue order
                          </TableCell>
                        </TableRow>
                      )}
                      <JobRows jobs={store.waiting} now={now} waiting />
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))
        )}
        {data !== null && (
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <p>
              This machine has {gb(data.memoryGb)}; the queue keeps {gb(data.keptGb)} back for
              everything else.
            </p>
            <Weights weights={data.weights} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
