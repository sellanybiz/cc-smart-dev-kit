"use client";

import { ArrowLeftIcon, GitBranchIcon, PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useResource } from "@/api/hooks";
import type { CrewDetail, CrewEvent, MergeCheck } from "@/api/types";
import { CopyButton } from "@/components/copy-button";
import { LaterAction } from "@/components/later-action";
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

const RUNNING = ["starting", "working", "blocked", "paused", "quiet"];

const EVENT_TONE: Record<CrewEvent["type"], Tone> = {
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
            <StatusMark tone={EVENT_TONE[event.type]}>
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

function MergeVerdict({ check }: { check: MergeCheck }) {
  const percent =
    check.delta !== null && check.reviewed !== null && check.reviewed.lines > 0
      ? Math.round((check.delta.lines / check.reviewed.lines) * 100)
      : null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <StatusMark tone={check.allowed ? "ok" : "warn"}>
        <span className="font-medium">
          {check.allowed ? "The merge guard allows it" : "The merge guard asks first"}
        </span>
      </StatusMark>
      {check.reason !== null && <p className="text-pretty">{check.reason}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">Reviewed commit</dt>
        <dd className="font-mono text-xs">{check.review ?? "none"}</dd>
        {check.reviewed !== null && (
          <>
            <dt className="text-muted-foreground">Reviewed change</dt>
            <dd className="tabular-nums">
              {count(check.reviewed.lines)} lines in {count(check.reviewed.files)} files
            </dd>
          </>
        )}
        {check.delta !== null && (
          <>
            <dt className="text-muted-foreground">Since the review</dt>
            <dd className="tabular-nums">
              {count(check.delta.lines)} lines in {count(check.delta.files)} files
              {percent !== null && ` (${percent} %)`}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Limit</dt>
        <dd className="tabular-nums">
          {check.limits.lines} lines, {check.limits.files} files or {check.limits.percent} %
        </dd>
      </dl>
    </div>
  );
}

function CrewPage({ data }: { data: CrewDetail }) {
  const { record, report } = data;
  const running = RUNNING.includes(record.state);
  const merged = record.state === "merged";
  const added = data.diff.reduce((sum, file) => sum + file.added, 0);
  const removed = data.diff.reduce((sum, file) => sum + file.removed, 0);
  const widest = Math.max(1, ...data.diff.map((file) => file.added + file.removed));
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
            <span className="font-mono text-xs">{record.branch}</span> from{" "}
            <span className="font-mono text-xs">{record.baseRef}</span>, led by {data.lead.name}
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
          {running ? (
            <LaterAction
              icon={<SquareIcon data-icon="inline-start" aria-hidden="true" />}
              label={`Stop ${record.name}`}
            >
              Stop
            </LaterAction>
          ) : (
            !merged && (
              <LaterAction
                icon={<PlayIcon data-icon="inline-start" aria-hidden="true" />}
                label={`Resume ${record.name}`}
              >
                Resume
              </LaterAction>
            )
          )}
          {merged && (
            <LaterAction
              icon={<Trash2Icon data-icon="inline-start" aria-hidden="true" />}
              label={`Remove ${record.name}`}
            >
              Remove after merge
            </LaterAction>
          )}
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
          headline={`${data.diff.length} files against ${record.baseRef}`}
          detail={
            report !== null && report.outsideBrief.length > 0
              ? `${report.outsideBrief.length} outside its brief`
              : "All inside its brief"
          }
        />
        <StatCard
          label="Review"
          value={report?.review == null ? "None yet" : `${report.review.findings.length} findings`}
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
              : `At effort ${report.review.effort}, commit ${report.review.sha}`
          }
        />
        <StatCard
          label="Memory"
          value={record.memoryMb === null ? "—" : megabytes(record.memoryMb)}
          headline={
            <Sparkline
              values={data.memory.map((point) => point.mb)}
              label="Memory over its last readings"
              width={140}
              height={24}
            />
          }
          detail={record.startedAt == null ? "Not started" : `Started ${ago(record.startedAt)}`}
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
        <Card>
          <CardHeader>
            <CardTitle>Diff against {record.baseRef}</CardTitle>
            <CardDescription>
              {count(added)} lines added and {count(removed)} removed, in {data.diff.length} files.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {data.diff.map((file) => (
                <li
                  key={file.path}
                  className="grid grid-cols-[minmax(0,1fr)_auto_5rem] items-center gap-3"
                >
                  <span className="truncate font-mono text-xs" title={file.path}>
                    {file.path}
                  </span>
                  <span className="text-xs tabular-nums">
                    <span className="text-ok">+{file.added}</span>{" "}
                    <span className="text-bad">−{file.removed}</span>
                  </span>
                  <svg className="h-2 w-full" aria-hidden="true" preserveAspectRatio="none">
                    <rect
                      width={`${(file.added / widest) * 100}%`}
                      height="100%"
                      className="fill-ok"
                    />
                    <rect
                      x={`${(file.added / widest) * 100}%`}
                      width={`${(file.removed / widest) * 100}%`}
                      height="100%"
                      className="fill-bad"
                    />
                  </svg>
                </li>
              ))}
            </ul>
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
                <TonePill tone={data.mergeCheck.allowed ? "ok" : "warn"}>
                  {data.mergeCheck.allowed ? "allowed" : "asks"}
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
  );
  if (!ready) return <LoadingState label="the crew session" />;
  return (
    <ResourceView resource={crew} label="the crew session">
      {(data) => <CrewPage data={data} />}
    </ResourceView>
  );
}
