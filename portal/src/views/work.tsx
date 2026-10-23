"use client";

import { GitBranchIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { crewStateOf } from "@/api/adapt";
import { useResource } from "@/api/hooks";
import { CREW_REFRESH } from "@/api/refresh";
import type { CrewEvent, CrewRecord, CrewState, OtherSession, WorkData } from "@/api/types";
import { CopyButton } from "@/components/copy-button";
import { CrewActions } from "@/components/crew-actions";
import { AppLink } from "@/components/router";
import { SectionCards, StatCard } from "@/components/section-cards";
import { Sparkline } from "@/components/sparkline";
import { EmptyState, PagePad, ResourceView } from "@/components/states";
import { type Tone, TonePill } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ago, clockTime, duration, megabytes, slotName, until } from "@/lib/format";

/** The states a crew session is running in: the Overview's count uses the same list. */
const RUNNING: readonly string[] = ["starting", "working", "blocked", "paused", "quiet"];

/** A state's tone; a word a newer kit wrote is shown as itself, in the quiet tone. */
function stateTone(state: string): Tone {
  const known = crewStateOf(state);
  return known === null ? "info" : STATE_TONE[known];
}

const STATE_TONE: Record<CrewState, Tone> = {
  queued: "info",
  starting: "info",
  working: "ok",
  blocked: "warn",
  paused: "warn",
  quiet: "warn",
  done: "ok",
  failed: "bad",
  stopped: "info",
  handoff: "info",
  merged: "ok",
  removed: "info",
};

/** What a paused crew session waits for, in words. */
function waitingWords(record: CrewRecord, now: number): string | null {
  if (record.state === "queued" && record.waitsFor.length > 0) {
    return `Waits for ${record.waitsFor.join(", ")} to merge`;
  }
  const waiting = record.waitingFor;
  if (record.state !== "paused" || waiting === undefined) return null;
  if (waiting.kind === "slot") return `Waits for the ${slotName(waiting.slot)} slot`;
  return waiting.resetsAt === null
    ? `Waits for ${waiting.model}'s limit`
    : `Waits for ${waiting.model}'s limit, resets ${until(waiting.resetsAt, now)}`;
}

/** How long a state has held, to the minute: a newer one is "under a minute". */
function heldFor(since: string, now: number): string {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms)) return "an unknown time";
  return ms < 60_000 ? "under a minute" : duration(Math.round(ms / 60_000) * 60_000);
}

/** What a memory line shows, in words, for a screen reader. */
function memoryLabel(memory: readonly { at: number; mb: number }[]): string {
  const first = memory[0];
  if (first === undefined) return "No memory reading yet";
  const values = memory.map((point) => point.mb);
  return `Memory since ${clockTime(first.at)}: between ${megabytes(Math.min(...values))} and ${megabytes(Math.max(...values))}`;
}

function CrewRow({
  record,
  step,
  now,
  memory,
}: {
  record: CrewRecord;
  step: CrewEvent | undefined;
  now: number;
  memory: { at: number; mb: number }[];
}) {
  const waiting = waitingWords(record, now);
  const [shown, ...rest] = record.files;
  return (
    <TableRow>
      <TableCell className="min-w-60 align-top whitespace-normal">
        <div className="flex flex-col gap-1">
          <AppLink
            href={`/work/crew?id=${encodeURIComponent(record.id)}`}
            className="font-medium underline-offset-4 hover:underline focus-visible:underline"
          >
            {record.name}
          </AppLink>
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <GitBranchIcon className="size-3" aria-hidden="true" />
            <span className="font-mono">{record.branch}</span>
            {record.pr !== null && <span className="basis-full">pull request #{record.pr}</span>}
          </span>
          <span className="text-xs text-muted-foreground">
            {record.kind}, effort {record.effort}
          </span>
          {shown !== undefined && (
            <span className="text-xs text-muted-foreground">
              Owns <span className="wrap-any font-mono text-foreground">{shown}</span>
              {rest.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="ml-1 underline decoration-dotted underline-offset-4"
                    >
                      and {rest.length} more
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <ul className="font-mono">
                      {rest.map((file) => (
                        <li key={file}>{file}</li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              )}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="w-44 align-top whitespace-normal">
        <div className="flex flex-col items-start gap-1">
          <TonePill tone={stateTone(record.state)}>{record.state}</TonePill>
          {record.stateSince !== undefined && (
            <span className="text-xs text-muted-foreground">
              for {heldFor(record.stateSince, now)}
            </span>
          )}
          {waiting !== null && (
            <span className="text-xs text-pretty text-muted-foreground">{waiting}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs">{record.model.resolved}</span>
          <span className="text-xs text-muted-foreground">
            {record.model.named} →{" "}
            {record.model.slot === null ? "Claude" : slotName(record.model.slot)}
          </span>
        </div>
      </TableCell>
      <TableCell className="min-w-64 align-top whitespace-normal">
        {step === undefined && record.lastLine === null ? (
          <span className="text-muted-foreground">Not started</span>
        ) : (
          <div className="flex flex-col gap-1">
            {step?.text != null && (
              <span>
                {step.text}{" "}
                <span className="text-xs text-muted-foreground">{ago(step.at, now)}</span>
              </span>
            )}
            {record.lastLine !== null && (
              <span className="text-xs text-pretty text-muted-foreground">{record.lastLine}</span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col items-end gap-1">
          <span className="tabular-nums">
            {record.memoryMb === null ? "—" : megabytes(record.memoryMb)}
          </span>
          <Sparkline
            values={memory.map((point) => point.mb)}
            label={memoryLabel(memory)}
            width={72}
            height={20}
          />
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col items-end gap-2">
          {record.shortId !== null && (
            <CopyButton text={`claude attach ${record.shortId}`} label="Attach" />
          )}
          <CrewActions crew={record} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function LeadCard({
  entry,
  now,
  memory,
}: {
  entry: WorkData["leads"][number];
  now: number;
  memory: WorkData["memory"];
}) {
  const { lead, crew, lastStep } = entry;
  const running = crew.filter((record) => RUNNING.includes(record.state)).length;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {lead.name}
        </CardTitle>
        <CardDescription>
          <span className="font-mono text-xs">{lead.plan}</span> in{" "}
          <span className="font-mono text-xs">{lead.cwd}</span>. Started{" "}
          {clockTime(Date.parse(lead.createdAt))}.
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            {running} of {crew.length} running
          </Badge>
        </CardAction>
      </CardHeader>
      {crew.length === 0 ? (
        <div className="p-6">
          <EmptyState title="No crew session yet">
            The lead starts one with <code className="font-mono">crew start</code>.
          </EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label={`Crew sessions of ${lead.name}`}>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Crew session</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Model → slot</TableHead>
                <TableHead>Last step</TableHead>
                <TableHead className="text-right">Memory</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crew.map((record) => (
                <CrewRow
                  key={record.id}
                  record={record}
                  step={lastStep[record.id]}
                  now={now}
                  memory={memory[record.id] ?? []}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

const SESSION_TONE: Record<OtherSession["state"], Tone> = {
  working: "ok",
  waiting: "warn",
  idle: "info",
  ended: "info",
};

function OtherSessions({ sessions, now }: { sessions: OtherSession[]; now: number }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Your other sessions</CardTitle>
        <CardDescription>
          Claude sessions of this project from the last two days that no lead started. A session
          that still runs is answered in its own terminal; resuming one opens a copy.
        </CardDescription>
      </CardHeader>
      {sessions.length === 0 ? (
        <div className="p-6">
          <EmptyState title="No other session">
            Sessions you start yourself show up here.
          </EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Your other sessions">
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last wrote</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.sessionId}>
                  <TableCell>
                    {session.name ?? <span className="text-muted-foreground">No name</span>}
                    <span className="block font-mono text-xs text-muted-foreground">
                      {session.sessionId}
                    </span>
                  </TableCell>
                  <TableCell>{session.project}</TableCell>
                  <TableCell className="font-mono text-xs">{session.branch ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {session.model ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <TonePill tone={SESSION_TONE[session.state]}>
                      {session.state === "waiting" ? "waits for you" : session.state}
                    </TonePill>
                  </TableCell>
                  <TableCell>{ago(session.lastAt, now)}</TableCell>
                  <TableCell className="text-right">
                    {session.state === "ended" || session.state === "idle" ? (
                      <CopyButton text={`claude --resume ${session.sessionId}`} label="Resume" />
                    ) : (
                      <span className="text-xs text-muted-foreground">runs now</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function WorkPage({ data }: { data: WorkData }) {
  const [now] = useState(() => Date.now());
  const crew = data.leads.flatMap((entry) => entry.crew);
  const running = crew.filter((record) => RUNNING.includes(record.state)).length;
  const blocked = crew.filter((record) => record.state === "blocked").length;
  const paused = crew.filter((record) => record.state === "paused").length;
  const queued = crew.filter((record) => record.state === "queued").length;
  const waitingOnYou = data.others.filter((session) => session.state === "waiting").length;
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label="Leads"
          value={data.leads.length}
          headline={`${crew.length} crew session${crew.length === 1 ? "" : "s"} in all`}
          detail={`${queued} queued, waiting for another phase`}
        />
        <StatCard
          label="Crew sessions running"
          value={running}
          badge={
            <TonePill tone={running > 0 ? "ok" : "info"}>
              {running > 0 ? "working" : "none"}
            </TonePill>
          }
          headline="Starting, working, blocked or paused"
          detail="A finished one leaves this list"
        />
        <StatCard
          label="Blocked or paused"
          value={blocked + paused}
          badge={
            blocked + paused > 0 ? (
              <TonePill tone="warn">look</TonePill>
            ) : (
              <TonePill tone="ok">none</TonePill>
            )
          }
          headline={`${blocked} asked its lead, ${paused} wait for a limit`}
          detail="A paused one goes on by itself"
        />
        <StatCard
          label="Your sessions waiting on you"
          value={waitingOnYou}
          badge={
            waitingOnYou > 0 ? (
              <TonePill tone="warn">answer</TonePill>
            ) : (
              <TonePill tone="ok">none</TonePill>
            )
          }
          headline={`${data.others.length} other session${data.others.length === 1 ? "" : "s"} on this machine`}
          detail="Answer it in its own terminal"
        />
      </SectionCards>
      <PagePad className="flex flex-col gap-4 md:gap-6">
        {data.leads.length === 0 ? (
          <EmptyState
            title="No lead runs on this machine"
            icon={<UsersIcon className="size-6 text-muted-foreground" aria-hidden="true" />}
          >
            A lead session splits a plan into phases and starts a crew session for each. Start one
            with <code className="font-mono">crew lead</code> in a Claude session.
          </EmptyState>
        ) : (
          data.leads.map((entry) => (
            <LeadCard key={entry.lead.sessionId} entry={entry} now={now} memory={data.memory} />
          ))
        )}
        <OtherSessions sessions={data.others} now={now} />
      </PagePad>
    </>
  );
}

/** Work (D27): each lead with its crew sessions nested, and the person's other sessions. */
export function WorkView() {
  const work = useResource((client) => client.work(), "", CREW_REFRESH);
  return (
    <ResourceView resource={work} label="the work">
      {(data) => <WorkPage data={data} />}
    </ResourceView>
  );
}
