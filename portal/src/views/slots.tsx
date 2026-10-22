"use client";

import { FlaskConicalIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useResource } from "@/api/hooks";
import { HISTORY_REFRESH, SLOTS_REFRESH } from "@/api/refresh";
import type { History, OpenBreaker, SlotRow, SlotsData, SlotTarget } from "@/api/types";
import { ActionResultLine, type ActionState, useAction } from "@/components/action-button";
import {
  ChainEditor,
  type ChainItem,
  type TargetMark,
  type TargetStats,
} from "@/components/chain-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModeSwitch, type SlotModeName } from "@/components/mode-switch";
import { SectionCards, StatCard } from "@/components/section-cards";
import { PagePad, ResourceView } from "@/components/states";
import { TonePill } from "@/components/status";
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
import { targetModel, until } from "@/lib/format";

const ROLE_WORDS: Record<string, string> = {
  affordable: "affordable work",
  model: "a Claude model",
  judge: "auto mode's judge",
};

/** The design's words before a change that rewrites the gateway's config for every session. */
const EVERY_SESSION = "This changes every running Claude session, from its next request.";

/** A chain's targets, in order, as one line. */
function chainLine(targets: readonly string[]): string {
  return targets.map(targetModel).join(" → ");
}

/** Two chains the same, target for target. */
function sameChain(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((target, index) => target === b[index]);
}

/** The chain the slot holds: in use while Custom, saved while Claude answers. */
function chainOf(row: SlotRow): SlotTarget[] {
  return row.mode === "custom" ? row.targets : (row.kept?.targets ?? []);
}

/**
 * Why Custom cannot be chosen, in the design's words; null when it can. A slot with no saved
 * chain has nothing to use; the judge uses only targets that passed the force-push test.
 */
function customBlocked(row: SlotRow): null | string {
  if (row.mode === "custom") return null;
  const kept = row.kept?.targets ?? [];
  if (kept.length === 0) return "Custom needs a saved chain: add targets below and save them.";
  if (row.role === "judge" && kept.some((t) => t.from !== "Claude login" && !t.tested)) {
    return "Custom needs every backend target to pass the force-push test: test the chain below, then save it.";
  }
  return null;
}

/** The marks the chain draws: the last test's verdicts, else the judge's recorded proofs. */
function marksOf(row: SlotRow, test: ActionState): Map<string, TargetMark> {
  const marks = new Map<string, TargetMark>();
  if (row.role === "judge") {
    for (const target of chainOf(row)) {
      if (target.from === "Claude login") continue;
      marks.set(
        target.target,
        target.tested
          ? { tone: "ok", words: "passed the force-push test" }
          : { tone: "warn", words: "not tested yet" },
      );
    }
  }
  if (test.phase === "done") {
    for (const result of test.result.results ?? []) {
      marks.set(result.target, {
        detail: result.detail,
        tone: result.verdict === "bad" ? "bad" : "ok",
        words:
          result.verdict === "blocked"
            ? "blocked the test check"
            : result.verdict === "good"
              ? "answered"
              : result.detail,
      });
    }
  }
  return marks;
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

/**
 * One switch of a slot that saves at once (fallback, breaker): asked first, because it changes
 * every running session, then pending, then its result in place.
 */
function SavedSwitch({
  label,
  help,
  checked,
  action,
  slot,
  disabled = false,
}: {
  label: string;
  help: string;
  checked: boolean;
  action: "slot.breaker" | "slot.fallback";
  slot: string;
  disabled?: boolean;
}) {
  const id = useId();
  const { run, state } = useAction(action);
  const [asking, setAsking] = useState(false);
  const sending = state.phase === "sending";
  return (
    <div className="flex flex-col gap-1.5">
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
          onCheckedChange={() => setAsking(true)}
          disabled={disabled || sending}
          aria-describedby={`${id}-help`}
          aria-busy={sending}
        />
      </div>
      <ActionResultLine state={state} onRetry={() => setAsking(true)} />
      <ConfirmDialog
        open={asking}
        title={`Turn ${label.toLowerCase()} ${checked ? "off" : "on"} for ${slot}?`}
        yes={`Turn it ${checked ? "off" : "on"}`}
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          run({ on: !checked, slot });
        }}
      >
        {EVERY_SESSION}
      </ConfirmDialog>
    </div>
  );
}

/** The words a mode change ends with, for the switch's own line. */
function modeDoneWords(slot: string, mode: SlotModeName): string {
  return `${slot} now uses ${mode === "claude" ? "Claude" : "its Custom chain"}. Running sessions switch on their next request.`;
}

function SlotCard({
  row,
  data,
  stats,
  onChanged,
}: {
  row: SlotRow;
  data: SlotsData;
  stats: Map<string, TargetStats>;
  onChanged: () => void;
}) {
  const saved = chainOf(row);
  const savedTargets = saved.map((t) => t.target);
  // The draft, with the chain it was made from: when the server's chain changes under it (a save
  // here, another tab, the command line), the page says so instead of replacing the edit.
  const [draft, setDraft] = useState<null | { base: string; items: ChainItem[] }>(null);
  const changedElsewhere = draft !== null && draft.base !== row.stamp;
  const items: ChainItem[] =
    draft?.items ?? saved.map((t) => ({ restingFor: t.restingFor, target: t.target }));
  const dirty =
    draft !== null &&
    !sameChain(
      items.map((i) => i.target),
      savedTargets,
    );
  const edit = (next: ChainItem[]) =>
    setDraft({ base: draft === null || changedElsewhere ? row.stamp : draft.base, items: next });

  const mode = useAction("slot.mode", (result) => {
    if (result.ok) onChanged();
  });
  const save = useAction("slot.save", (result) => {
    if (result.ok) {
      setDraft(null);
      onChanged();
    }
  });
  const test = useAction("slot.test");
  const [askMode, setAskMode] = useState<null | SlotModeName>(null);
  // The mode the last change asked for: its words say where it went, before the page reads again.
  const [requested, setRequested] = useState<SlotModeName>(row.mode);
  const [askSave, setAskSave] = useState(false);

  const breaker = data.breakers[row.key];
  const judge = row.role === "judge";
  const custom = row.mode === "custom";
  const answering = custom ? row.targets.find((t) => t.restingFor === null) : undefined;
  const pendingMode = mode.state.phase === "sending" ? requested : null;
  const marks = useMemo(() => marksOf(row, test.state), [row, test.state]);
  const modeLine: ActionState =
    mode.state.phase === "done" && mode.state.result.ok
      ? {
          phase: "done",
          result: {
            lines: [modeDoneWords(row.name, requested), ...mode.state.result.lines],
            ok: true,
          },
        }
      : mode.state;

  // A saved chain says so first, in the page's words; the command line's own lines (its checks,
  // the judge test it ran on each target) follow behind Details.
  const saveLine: ActionState =
    save.state.phase === "done" && save.state.result.ok
      ? {
          phase: "done",
          result: {
            lines: [
              `Saved: the ${row.name} chain is in use. Running sessions use it on their next request.`,
              ...save.state.result.lines,
            ],
            ok: true,
          },
        }
      : save.state;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          {row.name}
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {ROLE_WORDS[row.role] ?? row.role}
          </Badge>
        </CardTitle>
        <CardDescription className="max-w-prose text-pretty">{row.info}</CardDescription>
        <CardAction>
          {breaker !== undefined ? (
            <TonePill tone="bad">breaker open</TonePill>
          ) : !custom ? (
            <TonePill tone="info">Claude answers</TonePill>
          ) : answering === undefined ? (
            <TonePill tone="warn">every target rests</TonePill>
          ) : (
            <TonePill tone="ok">{targetModel(answering.target)} answers</TonePill>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 @3xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Who answers</h3>
            <ModeSwitch
              label={`Who answers ${row.name}`}
              value={row.mode}
              pending={pendingMode}
              customBlocked={customBlocked(row)}
              onChoose={(next) => setAskMode(next)}
            />
            <div aria-live="polite">
              {mode.state.phase === "sending" ? (
                <p className="text-sm text-muted-foreground">Switching…</p>
              ) : (
                <ActionResultLine
                  state={modeLine}
                  onRetry={() => setAskMode(custom ? "claude" : "custom")}
                />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              Chain
              {!custom && saved.length > 0 && (
                <span className="ml-2 font-normal text-muted-foreground">
                  Saved, not in use while Claude answers
                </span>
              )}
            </h3>
            <ChainEditor
              items={items}
              models={data.models}
              onChange={edit}
              label={`The ${row.name} chain`}
              stats={stats}
              live={custom}
              marks={marks}
              empty={
                custom
                  ? "No target in the chain."
                  : "No chain saved: Claude answers this slot on your own login. Add targets to make one."
              }
              disabled={save.state.phase === "sending"}
            />
          </div>
          {changedElsewhere && (
            <Alert className="border-warn/40">
              <TriangleAlertIcon className="text-warn" aria-hidden="true" />
              <AlertTitle>This chain changed elsewhere</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>
                  Another tab or the command line saved {row.name}:{" "}
                  {chainLine(savedTargets) || "no chain"}. Your edit is still here.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
                    Load it
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => edit(items)}>
                    Keep mine
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          {judge && (
            <Alert className="border-warn/40">
              <TriangleAlertIcon className="text-warn" aria-hidden="true" />
              <AlertTitle>A judge that is not Claude needs its test first</AlertTitle>
              <AlertDescription>
                Only a target that passed the force-push test judges. A weak judge can let a risky
                command through, and it reads the conversation.
              </AlertDescription>
            </Alert>
          )}
          {breaker !== undefined && <BreakerNote breaker={breaker} />}
        </div>
        <div className="flex flex-col gap-5 @3xl/main:border-l @3xl/main:pl-6">
          <SavedSwitch
            label="Fallback"
            help={
              row.fallback
                ? "On: when a target fails or rests, the next one answers."
                : "Off: only the first target answers; the rest stay saved."
            }
            checked={row.fallback}
            action="slot.fallback"
            slot={row.name}
            disabled={saved.length === 0}
          />
          {judge ? (
            <p className="text-xs text-pretty text-muted-foreground">
              No breaker for the judge: a safety check is never held.
            </p>
          ) : (
            <SavedSwitch
              label="Breaker"
              help="When every target is limited or down, hold requests a while, then ask Claude Code to retry."
              checked={row.breaker}
              action="slot.breaker"
              slot={row.name}
            />
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-3 border-t">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {dirty
              ? "Changed here, not saved yet."
              : custom
                ? "This is the chain in use."
                : saved.length > 0
                  ? "This is the chain saved for later."
                  : "Nothing saved."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0 || test.state.phase === "sending"}
              onClick={() => test.run({ slot: row.name, targets: items.map((i) => i.target) })}
            >
              <FlaskConicalIcon data-icon="inline-start" aria-hidden="true" />
              {test.state.phase === "sending" ? "Testing…" : "Test each target"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={draft === null}
              onClick={() => setDraft(null)}
            >
              Discard
            </Button>
            <Button
              size="sm"
              disabled={!dirty || items.length === 0 || save.state.phase === "sending"}
              onClick={() => setAskSave(true)}
            >
              {save.state.phase === "sending"
                ? "Saving…"
                : custom
                  ? "Save the chain"
                  : "Save and use it"}
            </Button>
          </div>
        </div>
        <ActionResultLine state={test.state} />
        <ActionResultLine state={saveLine} onRetry={() => setAskSave(true)} />
      </CardFooter>
      <ConfirmDialog
        open={askMode !== null}
        title={
          askMode === "claude"
            ? `Let Claude answer ${row.name}?`
            : `Use the saved chain for ${row.name}?`
        }
        yes={askMode === "claude" ? "Switch to Claude" : "Switch to Custom"}
        onCancel={() => setAskMode(null)}
        onYes={() => {
          const next = askMode;
          setAskMode(null);
          if (next === null) return;
          setRequested(next);
          mode.run({ mode: next, slot: row.name });
        }}
      >
        {askMode === "claude"
          ? `Its chain stays saved (${chainLine(savedTargets)}), not in use. ${EVERY_SESSION}`
          : `${chainLine(savedTargets)} answers from the next request${judge ? ", after each backend target passes the force-push test again" : ""}. ${EVERY_SESSION}`}
      </ConfirmDialog>
      <ConfirmDialog
        open={askSave}
        title={`Save the ${row.name} chain?`}
        yes={custom ? "Save the chain" : "Save and use it"}
        onCancel={() => setAskSave(false)}
        onYes={() => {
          setAskSave(false);
          save.run({
            slot: row.name,
            stamp: draft?.base ?? row.stamp,
            targets: items.map((i) => i.target),
          });
        }}
      >
        <span className="block font-mono text-xs text-foreground">
          {chainLine(items.map((i) => i.target))}
        </span>
        <span className="mt-2 block">
          {custom ? "" : `Saving puts it in use: ${row.name} switches to Custom. `}
          {judge
            ? "Each backend target must block the force-push test first; the command line tests them now. "
            : "The command line checks each target first. "}
          {EVERY_SESSION}
        </span>
      </ConfirmDialog>
    </Card>
  );
}

/** Each target's last day, from the request history: success rate, median time and its line. */
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

function SlotsPage({ data, onChanged }: { data: SlotsData; onChanged: () => void }) {
  const history = useResource(
    (client) => client.history({ range: "1d", by: "target" }),
    "1d",
    HISTORY_REFRESH,
  );
  const stats = useMemo(() => statsOf(history.status === "ready" ? history.data : null), [history]);
  const custom = data.slots.filter((row) => row.mode === "custom").length;
  const resting = data.slots
    .flatMap((row) => row.targets)
    .filter((t) => t.restingFor !== null).length;
  const open = Object.keys(data.breakers).length;
  const judge = data.slots.find((row) => row.role === "judge");
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label="Slots on Custom"
          value={`${custom} of ${data.slots.length}`}
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
            judge === undefined || judge.mode === "claude"
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
        {data.backendNotes.map((note) => (
          <Alert key={note} className="border-warn/40">
            <TriangleAlertIcon className="text-warn" aria-hidden="true" />
            <AlertDescription>{note}</AlertDescription>
          </Alert>
        ))}
        {data.switches.warnings.map((warning) => (
          <Alert key={warning} className="border-warn/40">
            <TriangleAlertIcon className="text-warn" aria-hidden="true" />
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ))}
        {data.slots.map((row) => (
          <SlotCard key={row.key} row={row} data={data} stats={stats} onChanged={onChanged} />
        ))}
      </PagePad>
    </>
  );
}

/** Slots: per slot, who answers, the chain editor, its fallback and breaker switches. */
export function SlotsView() {
  const slots = useResource((client) => client.slots(), "", SLOTS_REFRESH);
  return (
    <ResourceView resource={slots} label="the slots">
      {(data) => <SlotsPage data={data} onChanged={slots.refresh} />}
    </ResourceView>
  );
}
