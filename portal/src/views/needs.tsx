"use client";

import { CircleCheckIcon } from "lucide-react";
import { useResource } from "@/api/hooks";
import { NEEDS_REFRESH } from "@/api/refresh";
import type { NeedsData } from "@/api/types";
import { NeedsList } from "@/components/needs-list";
import { SectionCards, StatCard } from "@/components/section-cards";
import { EmptyState, PagePad, ResourceView } from "@/components/states";
import { TonePill } from "@/components/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function NeedsPage({ data }: { data: NeedsData }) {
  const count = (kinds: string[]) => data.items.filter((item) => kinds.includes(item.kind)).length;
  const questions = count(["question"]);
  const prompts = count(["permission"]);
  const machine = count(["doctor", "breaker"]);
  const updates = count(["update"]);
  const tone = (n: number) =>
    n > 0 ? <TonePill tone="warn">{n} open</TonePill> : <TonePill tone="ok">none</TonePill>;
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label="Questions"
          value={questions}
          badge={tone(questions)}
          headline="A crew session asks its lead"
          detail="Answer here; it goes on at once"
        />
        <StatCard
          label="Permission prompts"
          value={prompts}
          badge={tone(prompts)}
          headline="A session waits in its terminal"
          detail="Copy its claude attach command"
        />
        <StatCard
          label="This machine"
          value={machine}
          badge={tone(machine)}
          headline="Doctor failures and open breakers"
          detail="Each with its fix to copy"
        />
        <StatCard
          label="Updates"
          value={updates}
          badge={tone(updates)}
          headline="A major version waits for your yes"
          detail="Minor ones install by themselves"
        />
      </SectionCards>
      <PagePad>
        <Card>
          <CardHeader>
            <CardTitle>Waiting for you, newest first</CardTitle>
            <CardDescription>
              What it is, who it is about, since when, and what to do.
            </CardDescription>
            {data.note === null ? null : <p className="text-warn text-sm">{data.note}</p>}
          </CardHeader>
          <CardContent>
            {/* Always the list: an answer just sent stays in it after its item is gone. */}
            <NeedsList
              items={data.items}
              empty={
                // With the prompts unread, "nothing needs you" is not known: the note says why.
                data.note !== null ? null : (
                  <EmptyState
                    title="Nothing needs you"
                    icon={<CircleCheckIcon className="size-6 text-ok" aria-hidden="true" />}
                  >
                    Questions, prompts, failing checks and held updates show up here the moment they
                    happen.
                  </EmptyState>
                )
              }
            />
          </CardContent>
        </Card>
      </PagePad>
    </>
  );
}

/** Needs you (D52): every question, prompt, failing check, open breaker and held update. */
export function NeedsView() {
  const needs = useResource((client) => client.needs(), "", NEEDS_REFRESH);
  return (
    <ResourceView resource={needs} label="what needs you">
      {(data) => <NeedsPage data={data} />}
    </ResourceView>
  );
}
