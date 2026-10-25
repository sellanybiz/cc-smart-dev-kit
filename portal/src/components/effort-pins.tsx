"use client";

import { GaugeIcon } from "lucide-react";
import { useId, useState } from "react";
import type { SlotTarget } from "@/api/types";
import { ActionResultLine, type ActionState, useAction } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EVERY_SESSION } from "@/components/saved-switch";
import { TonePill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { targetBackend, targetModel } from "@/lib/format";

/** The select's value for "no pin": the word `gateway effort` takes for it. */
const OFF = "off";

/** What a pin means, and what it costs: the page's words, before any change. */
const PIN_WORDS =
  "A pin wins over whatever effort Claude Code sends. A higher effort is slower and uses more of the subscription's limit.";

/** A level as the select shows it: `none` says what it does. */
function levelWords(level: string): string {
  return level === "none" ? "none (no reasoning)" : level;
}

/** The question before a change, in the design's words: what the command does first. */
function askWords(level: string, judge: boolean): string {
  if (judge) {
    return `The command line runs the force-push test at ${level === OFF ? "the effort Claude Code sends" : level} first; unless the target blocks it, nothing is saved.`;
  }
  return level === OFF
    ? "No test request is needed to take a pin off."
    : `The command line sends one test request at ${level} first; if the backend refuses that level, nothing is saved.`;
}

/** One backend target's pin: what it is now, a level to pick, and the change's own result. */
function EffortRow({
  slot,
  target,
  levels,
  live,
  judge,
  onChanged,
}: {
  slot: string;
  target: SlotTarget;
  levels: readonly string[];
  live: boolean;
  judge: boolean;
  onChanged: () => void;
}) {
  const selectId = useId();
  const model = targetModel(target.target);
  const current = target.effort ?? OFF;
  // The person's pick; null shows what is saved. Nothing is picked for them.
  const [choice, setChoice] = useState<null | string>(null);
  const [asking, setAsking] = useState(false);
  // The level the last change asked for: its words, before the page reads the slots again.
  const [requested, setRequested] = useState(current);
  const set = useAction("slot.effort", (result) => {
    if (!result.ok) return;
    setChoice(null);
    onChanged();
  });
  const picked = choice ?? current;
  const sending = set.state.phase === "sending";
  const line: ActionState =
    set.state.phase === "sending"
      ? {
          line:
            set.state.line ??
            (judge
              ? `Running the force-push test on ${model}…`
              : requested === OFF
                ? `Taking the pin off ${model}…`
                : `Sending one test request at ${requested}…`),
          phase: "sending",
        }
      : set.state.phase === "done" && set.state.result.ok
        ? {
            phase: "done",
            result: {
              ...set.state.result,
              lines: [
                requested === OFF
                  ? `${model} follows Claude Code's effort again.`
                  : `Pinned: ${model} runs at ${requested}, whatever effort Claude Code sends.`,
                ...set.state.result.lines,
              ],
            },
          }
        : set.state;
  return (
    <li className="flex flex-col gap-2 rounded-md border bg-background px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-1 basis-40 flex-col">
          <span className="font-mono text-sm break-all">{model}</span>
          <span className="text-xs text-muted-foreground">{targetBackend(target.target)}</span>
        </span>
        {target.effort === undefined ? (
          <TonePill tone="info">follows Claude Code</TonePill>
        ) : (
          <TonePill tone="ok">pinned: {target.effort}</TonePill>
        )}
        {live && (
          <span className="flex items-center gap-2">
            <label htmlFor={selectId} className="sr-only">
              Effort for {model}
            </label>
            <NativeSelect
              id={selectId}
              size="sm"
              value={picked}
              disabled={sending}
              onChange={(event) => setChoice(event.target.value)}
            >
              <NativeSelectOption value={OFF}>follow Claude Code</NativeSelectOption>
              {levels.map((level) => (
                <NativeSelectOption key={level} value={level}>
                  {levelWords(level)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              disabled={picked === current || sending}
              aria-busy={sending}
              onClick={() => setAsking(true)}
            >
              <GaugeIcon data-icon="inline-start" aria-hidden="true" />
              {sending ? "Testing…" : "Set"}
            </Button>
          </span>
        )}
      </div>
      <div aria-live="polite">
        <ActionResultLine state={line} onRetry={() => setAsking(true)} />
      </div>
      <ConfirmDialog
        open={asking}
        title={
          picked === OFF
            ? `Let ${model} follow Claude Code's effort in ${slot}?`
            : `Pin ${model} to ${picked} in ${slot}?`
        }
        yes={picked === OFF ? "Take the pin off" : `Pin it to ${picked}`}
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          setRequested(picked);
          set.run({ level: picked, slot, target: target.target });
        }}
      >
        <span className="block">{askWords(picked, judge)}</span>
        <span className="mt-2 block">
          {PIN_WORDS} {EVERY_SESSION}
        </span>
      </ConfirmDialog>
    </li>
  );
}

/**
 * A slot's effort pins (D64): each backend target of its chain, pinned to one level or following
 * the effort Claude Code sends. A change runs the command line's own `gateway effort`, which
 * tests the level first; a `claude-…` target takes no pin. While Claude answers the slot, its
 * saved chain's pins show, and a change waits for the chain to be in use.
 */
export function EffortPins({
  slot,
  targets,
  levels,
  live,
  judge,
  onChanged,
}: {
  slot: string;
  targets: readonly SlotTarget[];
  levels: readonly string[];
  /** True while the chain is in use: `gateway effort` pins only a target of that chain. */
  live: boolean;
  judge: boolean;
  onChanged: () => void;
}) {
  if (targets.length === 0) return null;
  const claude = targets.filter((target) => target.from === "Claude login");
  const backend = targets.filter((target) => target.from !== "Claude login");
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Effort</h3>
      <p className="max-w-prose text-xs text-pretty text-muted-foreground">
        {PIN_WORDS}
        {live ? "" : " Switch the slot to Custom to change a pin."}
      </p>
      {backend.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={`Effort of each ${slot} target`}>
          {backend.map((target) => (
            <EffortRow
              key={target.target}
              slot={slot}
              target={target}
              levels={levels}
              live={live}
              judge={judge}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      {claude.length > 0 && (
        <p className="text-xs text-pretty text-muted-foreground">
          <span className="font-mono">{claude.map((target) => target.target).join(", ")}</span>
          {claude.length === 1 ? " follows" : " follow"} Claude Code: a Claude target goes to
          Anthropic with the effort Claude Code sends, so it takes no pin.
        </p>
      )}
    </div>
  );
}
