"use client";

import { useState } from "react";
import { useResource } from "@/api/hooks";
import { WORK_REFRESH } from "@/api/refresh";
import type { OtherSession, WorkData } from "@/api/types";
import { CopyButton } from "@/components/copy-button";
import { EmptyState, PagePad, ResourceView } from "@/components/states";
import { type Tone, TonePill } from "@/components/status";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ago } from "@/lib/format";

const SESSION_TONE: Record<OtherSession["state"], Tone> = {
  working: "ok",
  waiting: "warn",
  idle: "info",
  ended: "info",
};

function OtherSessions({
  sessions,
  now,
  note,
}: {
  sessions: OtherSession[];
  now: number;
  note: null | string;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Your sessions</CardTitle>
        <CardDescription>
          Claude sessions of this project from the last two days. A session that still runs is
          answered in its own terminal; resuming one opens a copy.
        </CardDescription>
        {note === null ? null : <p className="text-warn text-sm">{note}</p>}
      </CardHeader>
      {sessions.length === 0 ? (
        <div className="p-6">
          <EmptyState title="No session">Sessions you start yourself show up here.</EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Your sessions">
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
                  <TableCell className="min-w-48 whitespace-normal">
                    {session.name ?? <span className="text-muted-foreground">No name</span>}
                    <span className="block font-mono text-xs wrap-anywhere text-muted-foreground">
                      {session.sessionId}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal wrap-anywhere">
                    {session.project}
                  </TableCell>
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
  return (
    <PagePad className="flex flex-col gap-4 md:gap-6">
      {/* An empty list says why. A store or a folder the server could not read is a warning;
            a folder that is no git project is the portal's normal start, so its line is quiet. */}
      {data.note === null ? null : (
        <p role="status" className="text-warn text-sm">
          {data.note}
        </p>
      )}
      {data.folderNote === null ? null : (
        <p role="status" className="text-muted-foreground text-sm">
          {data.folderNote}
        </p>
      )}
      <OtherSessions sessions={data.others} now={now} note={data.waitsNote} />
    </PagePad>
  );
}

export function WorkView() {
  const work = useResource((client) => client.work(), "", WORK_REFRESH);
  return (
    <ResourceView resource={work} label="the work">
      {(data) => <WorkPage data={data} />}
    </ResourceView>
  );
}
