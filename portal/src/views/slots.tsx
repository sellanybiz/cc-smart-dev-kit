"use client";

import { InfoIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useResource } from "@/api/hooks";
import type { History, OpenBreaker, SlotRow, SlotsData } from "@/api/types";
import { ChainEditor, type ChainItem, type TargetStats } from "@/components/chain-editor";
import { SectionCards, StatCard } from "@/components/section-cards";
import { PagePad, ResourceView } from "@/components/states";
import { StatusMark, TonePill } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { seconds, targetModel, until } from "@/lib/format";

const KIND_WORDS: Record<string, string> = {
  affordable: "affordable work",
  model: "a Claude model",
  judge: "auto mode's judge",
};

function SwitchRow({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-help`} className="text-xs text-pretty text-muted-foreground">
          {help}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={`${id}-help`}
      />
    </div>
  );
}

function BreakerNote({ breaker }: { breaker: OpenBreaker }) {
  return (
    <Alert className="border-bad/40">
      <ShieldAlertIcon className="text-bad" aria-hidden="true" />
      <AlertTitle>The breaker is open: every target is limited or down</AlertTitle>
      <AlertDescription>
        <p>
          {breaker.heldNow} request{breaker.heldNow === 1 ? "" : "s"} wait
          {breaker.heldNow === 1 ? "s" : ""} now, {breaker.held} held since it opened. Claude Code
          retries each one by itself.
        </p>
        <ul className="mt-1">
          {breaker.targets.map((target) => (
            <li key={target.target}>
              <span className="font-mono text-xs">{targetModel(target.target)}</span>:{" "}
              {target.status === null ? "no answer" : `HTTP ${target.status}`}, asked again{" "}
              {until(target.until)}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function SlotCard({
  row,
  data,
  stats,
}: {
  row: SlotRow;
  data: SlotsData;
  stats: Map<string, TargetStats>;
}) {
  const saved: ChainItem[] = row.targets.map((t) => ({
    target: t.target,
    restingFor: t.restingFor,
  }));
  const [chain, setChain] = useState<ChainItem[]>(saved);
  const [fallback, setFallback] = useState(row.fallback);
  const [breakerOn, setBreakerOn] = useState(data.breaker[row.key] ?? row.kind !== "judge");
  const dirty =
    chain.length !== saved.length || chain.some((item, i) => item.target !== saved[i]?.target);
  const breaker = data.breakers[row.key];
  const judge = row.kind === "judge";
  const untested = judge && row.targets.some((t) => !t.tested);
  const answering = chain.find((item) => item.restingFor === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {row.name}
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {KIND_WORDS[row.kind] ?? row.kind}
          </Badge>
        </CardTitle>
        <CardDescription className="max-w-prose text-pretty">{row.info}</CardDescription>
        <CardAction>
          {breaker !== undefined ? (
            <TonePill tone="bad">breaker open</TonePill>
          ) : chain.length === 0 ? (
            <TonePill tone="info">Claude answers</TonePill>
          ) : answering === undefined ? (
            <TonePill tone="warn">every target rests</TonePill>
          ) : (
            <TonePill tone="ok">{targetModel(answering.target)} answers</TonePill>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 @3xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Chain</h3>
          <ChainEditor
            items={chain}
            models={data.models}
            onChange={setChain}
            label={`The ${row.name} chain`}
            stats={stats}
          />
          {judge && (
            <Alert className="border-warn/40">
              <TriangleAlertIcon className="text-warn" aria-hidden="true" />
              <AlertTitle>A judge that is not Claude needs its test first</AlertTitle>
              <AlertDescription>
                {untested
                  ? "A target in this chain has not passed the force-push test, so it judges nothing yet: Claude still judges every check."
                  : "Only a target that passed the force-push test judges. A weak judge can let a risky command through, and it reads the conversation."}
              </AlertDescription>
            </Alert>
          )}
          {breaker !== undefined && <BreakerNote breaker={breaker} />}
        </div>
        <div className="flex flex-col gap-4 @3xl/main:border-l @3xl/main:pl-6">
          <SwitchRow
            label="Fallback"
            help={
              fallback
                ? "When a target fails or rests, the next one answers."
                : "Only the first target answers; the rest stay saved."
            }
            checked={fallback}
            onChange={setFallback}
          />
          <SwitchRow
            label="Breaker"
            help={
              judge
                ? "Off for the judge: a safety check is never held."
                : "When every target is limited or down, hold requests a while, then ask Claude Code to retry."
            }
            checked={breakerOn}
            onChange={setBreakerOn}
            disabled={judge}
          />
          {chain.some((item) => item.restingFor !== null) && (
            <div className="flex flex-col gap-1 text-sm">
              {chain
                .filter((item) => item.restingFor !== null)
                .map((item) => (
                  <StatusMark key={item.target} tone="warn">
                    <span className="font-mono text-xs">{targetModel(item.target)}</span> rests for{" "}
                    {seconds(item.restingFor ?? 0)}
                  </StatusMark>
                ))}
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {dirty ? "Changed here, not saved yet." : "This is the chain in use."}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setChain(saved)}>
            Discard
          </Button>
          <Button size="sm" disabled title="Saving from the portal comes with its actions">
            Save the chain
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

/** Each target's last day: success rate, median time and its line (`GET /api/history`). */
function statsOf(history: History | null): Map<string, TargetStats> {
  const out = new Map<string, TargetStats>();
  for (const series of history?.series ?? []) {
    let requests = 0;
    let errors = 0;
    let weighted = 0;
    for (const point of series.points) {
      requests += point.requests;
      errors += point.errors;
      weighted += point.p50Ms * point.requests;
    }
    out.set(series.key, {
      requests,
      success: requests === 0 ? 1 : 1 - errors / requests,
      p50Ms: requests === 0 ? 0 : weighted / requests,
      line: series.points.map((point) => point.p50Ms),
    });
  }
  return out;
}

function SlotsPage({ data }: { data: SlotsData }) {
  const history = useResource((client) => client.history({ range: "1d", by: "target" }), "1d");
  const stats = useMemo(() => statsOf(history.status === "ready" ? history.data : null), [history]);
  const withChain = data.rows.filter((row) => row.targets.length > 0).length;
  const resting = data.rows
    .flatMap((row) => row.targets)
    .filter((t) => t.restingFor !== null).length;
  const open = Object.keys(data.breakers).length;
  const judge = data.rows.find((row) => row.kind === "judge");
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label="Slots with a chain"
          value={`${withChain} of ${data.rows.length}`}
          headline="The rest answer on your Claude login"
          detail={`${data.models.length} models on the live list`}
        />
        <StatCard
          label="Targets resting"
          value={resting}
          badge={
            resting > 0 ? (
              <TonePill tone="warn">resting</TonePill>
            ) : (
              <TonePill tone="ok">none</TonePill>
            )
          }
          headline="A resting target is skipped"
          detail="Unless it is a chain's last one"
        />
        <StatCard
          label="Open breakers"
          value={open}
          badge={
            open > 0 ? <TonePill tone="bad">holding</TonePill> : <TonePill tone="ok">none</TonePill>
          }
          headline={open > 0 ? "A slot holds its requests" : "Every slot can answer"}
          detail="A held request is retried by Claude Code"
        />
        <StatCard
          label="Auto mode's judge"
          value={
            judge === undefined || judge.targets.length === 0
              ? "Claude"
              : targetModel(judge.targets[0]?.target ?? "")
          }
          badge={
            data.switches.judgeUntested ? (
              <TonePill tone="warn">not tested</TonePill>
            ) : data.switches.judge ? (
              <TonePill tone="ok">tested</TonePill>
            ) : (
              <TonePill tone="info">your login</TonePill>
            )
          }
          headline="It judges every safety check"
          detail="Claude, unless a tested target is set"
        />
      </SectionCards>
      <PagePad className="flex flex-col gap-4 md:gap-6">
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>A preview: this page does not save yet</AlertTitle>
          <AlertDescription>
            Reorder, add and switch freely: nothing reaches the gateway until saving lands. Until
            then, the command line changes a slot: <code className="font-mono">gateway slot</code>.
          </AlertDescription>
        </Alert>
        {data.switches.warnings.map((warning) => (
          <Alert key={warning} className="border-warn/40">
            <TriangleAlertIcon className="text-warn" aria-hidden="true" />
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ))}
        {data.rows.map((row) => (
          <SlotCard key={row.key} row={row} data={data} stats={stats} />
        ))}
      </PagePad>
    </>
  );
}

/** Slots: per slot, the chain editor, the fallback and breaker switches, the judge's line. */
export function SlotsView() {
  const slots = useResource((client) => client.slots());
  return (
    <ResourceView resource={slots} label="the slots">
      {(data) => <SlotsPage data={data} />}
    </ResourceView>
  );
}
