"use client";

import { type ReactNode, useId, useState } from "react";
import type { ActionName } from "@/api/client";
import { ActionResultLine, useAction } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** What every gateway switch costs, said before it changes. */
export const EVERY_SESSION = "This changes every running Claude session, from its next request.";

/**
 * One switch that saves at once (a slot's fallback or breaker, the Overview's gateway
 * switches): asked first, because it changes every running session, then pending, then its
 * result in place. The checked state is always what the server holds: the page reads it again
 * once the action's result comes.
 */
export function SavedSwitch({
  label,
  help,
  checked,
  action,
  body,
  question,
  disabled = false,
}: {
  label: string;
  help: ReactNode;
  checked: boolean;
  action: ActionName;
  /** The action's body for the state the switch moves to. */
  body: (on: boolean) => Record<string, unknown>;
  /** The question the page asks before it moves. */
  question: string;
  disabled?: boolean;
}) {
  const id = useId();
  const { run, state } = useAction(action);
  const [asking, setAsking] = useState(false);
  const sending = state.phase === "sending";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
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
        title={question}
        yes={`Turn it ${checked ? "off" : "on"}`}
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          run(body(!checked));
        }}
      >
        {EVERY_SESSION}
      </ConfirmDialog>
    </div>
  );
}
