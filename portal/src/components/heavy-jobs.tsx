"use client";

import { useEffect, useState } from "react";
import { portalClient } from "@/api/client";
import { type Resource, useResource } from "@/api/hooks";
import type { JobEntry, JobStore, JobsData } from "@/api/types";
import { EmptyState } from "@/components/states";
import { TonePill } from "@/components/status";
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
import { duration, KIT_NAME } from "@/lib/format";

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

/** What a job holds: the heavy slot, or a name only (`--exclusive`). The table's Holds column. */
const holdsOf = (job: JobEntry) => (job.slot ? "the heavy slot" : "a name");

const slotsOf = (count: number) => `${count} ${count === 1 ? "slot" : "slots"}`;

/** Slots in use against the slots there are, as a bar: an SVG whose widths are attributes, never styles. */
function SlotMeter({ store }: { store: JobStore }) {
  const share = store.slots === 0 ? 0 : Math.min(1, store.used / store.slots);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="font-medium">{store.used}</span> of {slotsOf(store.slots)} in use
          {store.where !== "machine" && (
            <span className="text-muted-foreground"> in {store.where}</span>
          )}
        </span>
        <span className="text-muted-foreground">
          {slotsOf(Math.max(0, store.slots - store.used))} free now
        </span>
      </div>
      {/* The native meter speaks; the SVG draws it (a meter's own look cannot be themed). */}
      <meter className="sr-only" min={0} max={store.slots} value={store.used}>
        {store.used} of {slotsOf(store.slots)}
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
          <TableCell>{holdsOf(job)}</TableCell>
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

/** Where the job route's value comes from, in the words `job status` uses. */
const ROUTE_SOURCE: Readonly<Record<JobsData["route"]["source"], string>> = {
  default: "the default",
  personal: "your own switches.jobRoute",
  project: "the project's jobs.route",
};

/**
 * Whether a heavy Bash command goes through this queue: the resolved job route (a project's
 * `jobs.route` wins over the person's `switches.jobRoute`, and without either it is off). The
 * portal runs in no project, so the line is what a project that sets none gets.
 */
function RouteLine({ route }: { route: JobsData["route"] }) {
  return (
    <p>
      {route.project === null ? "In a project that sets none" : `In ${route.project}`}, a heavy
      command {route.on ? "waits for a slot in this queue" : "runs raw, outside the queue"} (
      {ROUTE_SOURCE[route.source]}).
      {!route.on && route.source !== "project" && (
        <>
          {" "}
          Turn it on for every project:{" "}
          <code className="font-mono">{KIT_NAME} workflow set switches.jobRoute true</code>.
        </>
      )}
    </p>
  );
}

/** The Machine page's "Heavy jobs" card: the slots, what runs, and who waits in turn. */
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
          Type checks, builds and test runs share one slot: a job waits until it is free.
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
              <SlotMeter store={store} />
              {store.held.length === 0 && store.waiting.length === 0 ? (
                <EmptyState title="Nothing held, nobody waits">
                  A heavy command a session runs shows up here while it holds a slot.
                </EmptyState>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table
                    aria-label={`Heavy jobs on ${store.where === "machine" ? "this machine" : store.where}`}
                  >
                    <TableHeader className="bg-muted">
                      <TableRow>
                        <TableHead>Kind</TableHead>
                        <TableHead>Holds</TableHead>
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
            <RouteLine route={data.route} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
