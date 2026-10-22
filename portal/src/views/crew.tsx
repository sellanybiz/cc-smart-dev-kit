"use client";

import { ArrowLeftIcon, GitBranchIcon } from "lucide-react";
import { useMemo } from "react";
import { useResource } from "@/api/hooks";
import { CREW_REFRESH } from "@/api/refresh";
import type { CrewDetail, CrewEvent, DiffFile, MergeCheck } from "@/api/types";
import { CopyButton } from "@/components/copy-button";
import { CrewActions } from "@/components/crew-actions";
import { columnsFor, PortalTable } from "@/components/data-table";
import { Markdown } from "@/components/markdown";
import { AppLink, useAppQuery, useAppQueryReady } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { Sparkline } from "@/components/sparkline";
import { EmptyState, LoadingState, PagePad, ResourceView } from "@/components/states";
import { StatusMark, type Tone, TonePill } from "@/components/status";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ago, clockTime, count, megabytes, slotName } from "@/lib/format";
import { cn } from "@/lib/utils";

const RUNNING = ["starting", "working", "blocked", "paused", "quiet"];

const EVENT_TONE: Record<string, Tone> = {
  created: "info",
  state: "info",
  step: "ok",
  report: "ok",
  question: "warn",
  tell: "info",
};

function Timeline({ events }: { events: CrewEvent[] }) {
  if (events.length === 0)
    return <EmptyState title="No step yet">Its steps show up here as it works.</EmptyState>;
  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {[...events].reverse().map((event) => (
        <li key={`${event.at}-${event.type}`} className="relative">
          <span
            className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border-2 border-background bg-primary"
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <StatusMark tone={EVENT_TONE[event.type] ?? "info"}>
              <span className="font-medium">{event.text ?? event.type}</span>
            </StatusMark>
            <time dateTime={event.at} className="text-xs text-muted-foreground">
              {clockTime(Date.parse(event.at))}, {ago(event.at)}
            </time>
          </div>
          {event.note != null && (
            <p className="mt-0.5 pl-[1.125rem] text-sm text-pretty text-muted-foreground">
              {event.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

const VERDICT: Record<MergeCheck["kind"], { tone: Tone; pill: string; words: string }> = {
  allowed: { tone: "ok", pill: "allowed", words: "The merge guard lets it merge by itself" },
  refused: { tone: "warn", pill: "asks", words: "The merge guard asks you first" },
  unread: { tone: "bad", pill: "not read", words: "The merge guard could not judge it" },
  late: { tone: "info", pill: "merged", words: "It merged before the guard judged it" },
};

/**
 * How much may change after a review and still be covered by it: the limit, or that percent of
 * the reviewed change, whichever is more. The gate's own rule (`coverRefusal`,
 * `src/workflow/review-cover.ts`), drawn here as a meter; the verdict itself is the server's.
 */
function allowance(limit: number, percent: number, reviewed: number): number {
  return Math.max(limit, Math.floor((reviewed * percent) / 100));
}

/** One count since the review against what the review still covers: the words and a meter. */
function DeltaMeter({ label, used, allowed }: { label: string; used: number; allowed: number }) {
  const over = used > allowed;
  // The meter's scale: the allowance, or the count when it is over (so the bar shows how far).
  const scale = Math.max(1, used, allowed);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("tabular-nums", over && "font-medium text-bad")}>
          {count(used)} of {count(allowed)} {over ? "(over)" : ""}
        </span>
      </div>
      <svg className="h-1.5 w-full rounded-full" aria-hidden="true" preserveAspectRatio="none">
        <rect width="100%" height="100%" className="fill-muted" />
        <rect
          width={`${(Math.min(used, allowed) / scale) * 100}%`}
          height="100%"
          className={over ? "fill-warn" : "fill-ok"}
        />
        {over && (
          <rect
            x={`${(allowed / scale) * 100}%`}
            width={`${((used - allowed) / scale) * 100}%`}
            height="100%"
            className="fill-bad"
          />
        )}
      </svg>
    </div>
  );
}

function MergeVerdict({ check }: { check: MergeCheck }) {
  const verdict = VERDICT[check.kind];
  const { delta, reviewed, limits } = check;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1.5">
        <StatusMark tone={verdict.tone}>
          <span className="font-medium">
            {verdict.words}
            {check.pr !== null && ` (pull request #${check.pr})`}
          </span>
        </StatusMark>
        {check.reason !== null && (
          <p className="pl-[1.125rem] text-pretty text-muted-foreground">{check.reason}</p>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">Reviewed commit</dt>
        <dd className="font-mono text-xs">{check.review ?? "no review recorded"}</dd>
        {reviewed !== null && (
          <>
            <dt className="text-muted-foreground">The review covered</dt>
            <dd className="tabular-nums">
              {count(reviewed.lines)} lines in {count(reviewed.files)} files
            </dd>
          </>
        )}
        {delta !== null && (
          <>
            <dt className="text-muted-foreground">Changed since</dt>
            <dd className="tabular-nums">
              {count(delta.lines)} lines in {count(delta.files)} files
            </dd>
          </>
        )}
        {limits !== null && (
          <>
            <dt className="text-muted-foreground">Fixes allowed</dt>
            <dd className="text-pretty tabular-nums">
              {count(limits.lines)} lines and {count(limits.files)} files, or {limits.percent} % of
              the reviewed change, whichever is more
            </dd>
          </>
        )}
      </dl>
      {delta !== null && reviewed !== null && limits !== null && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <DeltaMeter
            label="Lines since the review"
            used={delta.lines}
            allowed={allowance(limits.lines, limits.percent, reviewed.lines)}
          />
          <DeltaMeter
            label="Files since the review"
            used={delta.files}
            allowed={allowance(limits.files, limits.percent, reviewed.files)}
          />
        </div>
      )}
    </div>
  );
}

const diffColumn = columnsFor<DiffFile>();

/** The diff's columns; `widest` scales every file's bar to the same width. */
function diffColumns(widest: number) {
  return diffColumn.columns([
    diffColumn.accessor("path", {
      header: "File",
      cell: ({ row }) => (
        <span className="block max-w-[28rem] truncate font-mono text-xs" title={row.original.path}>
          {row.original.path}
        </span>
      ),
      enableHiding: false,
    }),
    diffColumn.accessor((file) => file.added ?? -1, {
      id: "added",
      header: "Added",
      cell: ({ row }) =>
        row.original.added === null ? (
          <span className="text-muted-foreground">binary</span>
        ) : (
          <span className="text-ok tabular-nums">+{count(row.original.added)}</span>
        ),
    }),
    diffColumn.accessor((file) => file.removed ?? -1, {
      id: "removed",
      header: "Removed",
      cell: ({ row }) =>
        row.original.removed === null ? (
          <span className="text-muted-foreground">binary</span>
        ) : (
          <span className="text-bad tabular-nums">−{count(row.original.removed)}</span>
        ),
    }),
    diffColumn.display({
      id: "share",
      header: () => <span className="sr-only">Share of the change</span>,
      cell: ({ row }) => {
        const added = row.original.added ?? 0;
        const removed = row.original.removed ?? 0;
        return (
          <svg className="h-2 w-24" aria-hidden="true" preserveAspectRatio="none">
            <rect width={`${(added / widest) * 100}%`} height="100%" className="fill-ok" />
            <rect
              x={`${(added / widest) * 100}%`}
              width={`${(removed / widest) * 100}%`}
              height="100%"
              className="fill-bad"
            />
          </svg>
        );
      },
    }),
  ]);
}

/** The reviews recorded for the branch, newest first, each at its commit. */
function Reviews({ reviews, head }: { reviews: CrewDetail["reviews"]; head: null | string }) {
  if (reviews.length === 0) {
    return (
      <EmptyState title="No review recorded">
        One review per change set, before its first push.
      </EmptyState>
    );
  }
  return (
    <ol className="flex flex-col divide-y text-sm">
      {[...reviews].reverse().map((review) => (
        <li key={`${review.sha}-${review.at}`} className="flex flex-col gap-0.5 py-2.5">
          <span className="flex flex-wrap items-baseline gap-2">
            <code className="font-mono text-xs">{review.sha.slice(0, 7)}</code>
            {head !== null && review.sha.startsWith(head) && (
              <TonePill tone="ok">its reported head</TonePill>
            )}
            <time dateTime={review.at} className="text-xs text-muted-foreground">
              {ago(review.at)}
            </time>
          </span>
          <span className="text-muted-foreground">
            By {review.by.length === 0 ? "an unnamed reviewer" : review.by.join(", ")}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Its memory over time: the line, the peak and how many readings it is drawn from. */
function memoryWords(memory: CrewDetail["memory"]): string {
  if (memory.length === 0) return "Not measured yet";
  const peak = Math.max(...memory.map((point) => point.mb));
  const first = memory[0]?.at ?? 0;
  return `Peak ${megabytes(peak)}, ${memory.length} reading${memory.length === 1 ? "" : "s"} since ${clockTime(first)}`;
}

function CrewPage({ data }: { data: CrewDetail }) {
  const { record, report } = data;
  const running = RUNNING.includes(record.state);
  const merged = record.state === "merged";
  // The server sends the diff in totals (`diffTotals`) and per file; a binary file has no counts.
  const added =
    data.diffTotals?.insertions ?? data.diff.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed =
    data.diffTotals?.deletions ?? data.diff.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  const files = data.diffTotals?.files ?? data.diff.length;
  const diffError = data.diffTotals?.error ?? null;
  const base = record.baseRef === "" ? "its base" : record.baseRef;
  const widest = Math.max(1, ...data.diff.map((file) => (file.added ?? 0) + (file.removed ?? 0)));
  const columns = useMemo(() => diffColumns(widest), [widest]);
  return (
    <>
      <PagePad className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {record.name}
            <TonePill tone={running ? "ok" : merged ? "ok" : "info"}>{record.state}</TonePill>
          </h2>
          <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <GitBranchIcon className="size-3.5" aria-hidden="true" />
            <span className="font-mono text-xs">{record.branch}</span>
            {record.baseRef !== "" && (
              <>
                {" "}
                from <span className="font-mono text-xs">{record.baseRef}</span>
              </>
            )}
            , led by {data.lead.name}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <AppLink href="/work">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Work
            </AppLink>
          </Button>
          {record.shortId !== null && (
            <CopyButton text={`claude attach ${record.shortId}`} label="Copy attach" />
          )}
          <CrewActions crew={record} />
        </div>
      </PagePad>
      <SectionCards columns={4}>
        <StatCard
          label="Model"
          value={<span className="font-mono text-lg">{record.model.resolved}</span>}
          headline={`${record.model.named} → ${record.model.slot === null ? "Claude" : slotName(record.model.slot)}`}
          detail={`${record.kind}, effort ${record.effort}`}
        />
        <StatCard
          label="Changed"
          value={
            <span className="tabular-nums">
              <span className="text-ok">+{count(added)}</span>{" "}
              <span className="text-bad">−{count(removed)}</span>
            </span>
          }
          headline={
            diffError !== null ? "The diff could not be read" : `${files} files against ${base}`
          }
          detail={
            report !== null && report.outsideBrief.length > 0
              ? `${report.outsideBrief.length} outside its brief`
              : "All inside its brief"
          }
        />
        <StatCard
          label="Review"
          value={
            report?.review == null
              ? "None yet"
              : `${report.review.findings.length} finding${report.review.findings.length === 1 ? "" : "s"}`
          }
          badge={
            report?.review == null ? (
              <TonePill tone="info">waits</TonePill>
            ) : (
              <TonePill tone="ok">fixed</TonePill>
            )
          }
          headline={
            report?.review == null
              ? "One review per change set"
              : `${report.review.agent} on ${report.review.model}`
          }
          detail={
            report?.review == null
              ? "Before its first push"
              : `At effort ${report.review.effort}, commit ${report.review.sha.slice(0, 7)}`
          }
        />
        <StatCard
          label="Memory"
          value={record.memoryMb === null ? "—" : megabytes(record.memoryMb)}
          headline={
            <Sparkline
              values={data.memory.map((point) => point.mb)}
              label={`Memory over time: ${memoryWords(data.memory)}`}
              width={160}
              height={24}
            />
          }
          detail={memoryWords(data.memory)}
        />
      </SectionCards>
      <PagePad className="grid gap-4 md:gap-6 @4xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Brief</CardTitle>
            <CardDescription>What the lead asked of it.</CardDescription>
          </CardHeader>
          <CardContent>
            <Markdown>{data.brief}</Markdown>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
            <CardDescription>From the crew store's events, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Timeline events={data.events} />
          </CardContent>
        </Card>
        <Card className="@4xl/main:col-span-2">
          <CardHeader>
            <CardTitle>Diff against {base}</CardTitle>
            <CardDescription>
              {diffError !== null
                ? `It could not be read: ${diffError}.`
                : `${count(added)} lines added and ${count(removed)} removed, in ${files} files.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PortalTable
              rows={data.diff}
              columns={columns}
              rowKey={(file) => file.path}
              label={`Files changed against ${base}`}
              empty={diffError !== null ? "The diff could not be read." : "No file changed yet."}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Merge check</CardTitle>
            <CardDescription>
              Whether the merge guard lets the pull request merge by itself.
            </CardDescription>
            {data.mergeCheck !== null && (
              <CardAction>
                <TonePill tone={VERDICT[data.mergeCheck.kind].tone}>
                  {VERDICT[data.mergeCheck.kind].pill}
                </TonePill>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {data.mergeCheck === null ? (
              <EmptyState title="Nothing to check yet">
                The verdict comes once it has a pull request.
              </EmptyState>
            ) : (
              <MergeVerdict check={data.mergeCheck} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Reviews</CardTitle>
            <CardDescription>
              The second opinions recorded for its branch, newest first.
            </CardDescription>
            <CardAction>
              <TonePill tone={data.reviews.length > 0 ? "ok" : "info"}>
                {data.reviews.length}
              </TonePill>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Reviews reviews={data.reviews} head={report?.branch.sha ?? null} />
          </CardContent>
        </Card>
        <Card className="@4xl/main:col-span-2">
          <CardHeader>
            <CardTitle>Report</CardTitle>
            <CardDescription>Its hand-back to the lead.</CardDescription>
            {report !== null && (
              <CardAction>
                <TonePill
                  tone={
                    report.status === "done" ? "ok" : report.status === "failed" ? "bad" : "warn"
                  }
                >
                  {report.status}
                </TonePill>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {report === null ? (
              <EmptyState title="No report yet">
                A crew session writes its report when it hands back.
              </EmptyState>
            ) : (
              <div className="grid gap-6 text-sm @3xl/main:grid-cols-3">
                <section className="flex flex-col gap-2">
                  <h3 className="font-medium">Tests and checks</h3>
                  <ul className="flex flex-col gap-1.5">
                    {[
                      ...report.tests.targeted,
                      ...(report.tests.full === null ? [] : [report.tests.full]),
                    ].map((run) => (
                      <li key={run.command}>
                        <StatusMark tone={run.ok ? "ok" : "bad"}>
                          <code className="font-mono text-xs">{run.command}</code>:{" "}
                          {count(run.passed)} passed
                          {run.failed > 0 && `, ${count(run.failed)} failed`}
                        </StatusMark>
                      </li>
                    ))}
                    {report.checks.map((check) => (
                      <li key={check.name}>
                        <StatusMark tone={check.ok ? "ok" : "bad"}>
                          {check.name}
                          {check.note !== null && `: ${check.note}`}
                        </StatusMark>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="flex flex-col gap-2">
                  <h3 className="font-medium">Review findings, and their fixes</h3>
                  {report.review === null || report.review.findings.length === 0 ? (
                    <p className="text-muted-foreground">No finding.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {report.review.findings.map((finding) => (
                        <li key={finding.finding}>
                          <p>{finding.finding}</p>
                          <p className="text-muted-foreground">Fixed: {finding.fix}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="flex flex-col gap-2">
                  <h3 className="font-medium">Still open</h3>
                  {report.open.length === 0 && report.needsLead.length === 0 ? (
                    <p className="text-muted-foreground">Nothing.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {report.open.map((line) => (
                        <li key={line}>
                          <StatusMark tone="warn">{line}</StatusMark>
                        </li>
                      ))}
                      {report.needsLead.map((line) => (
                        <li key={line}>
                          <StatusMark tone="info">For the lead: {line}</StatusMark>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </CardContent>
        </Card>
      </PagePad>
    </>
  );
}

/** A crew session's page (`/work/crew?id=…`, D52). */
export function CrewView() {
  const ready = useAppQueryReady();
  const id = useAppQuery().get("id");
  const crew = useResource(
    (client) =>
      id === null
        ? Promise.reject(new Error("No crew session is named in the address: open one from Work."))
        : client.crew(id),
    `${ready}|${id ?? ""}`,
    CREW_REFRESH,
  );
  if (!ready) return <LoadingState label="the crew session" />;
  return (
    <ResourceView resource={crew} label="the crew session">
      {(data) => <CrewPage data={data} />}
    </ResourceView>
  );
}
