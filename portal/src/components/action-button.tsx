"use client";

import { LoaderCircleIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { type ActionName, type ActionResult, portalClient } from "@/api/client";
import { useLiveEvent } from "@/api/hooks";
import { beginRun, ownsProgress } from "@/components/action-runs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How long a success stays in place before the button is plain again. */
export const DONE_SHOWN_MS = 6_000;

/** One action's life on the page: idle, asked, running (with its last line), and its result. */
export type ActionState =
  | { phase: "idle" }
  | { phase: "sending"; line: null | string }
  | { phase: "done"; result: ActionResult };

/** What a result says, as the page shows it: the first line, and the rest behind "Details". */
export function resultWords(result: ActionResult): { first: string; rest: string[] } {
  const [first, ...rest] = result.lines;
  return {
    first: first ?? (result.ok ? "Done." : "It did not work, and said nothing."),
    rest,
  };
}

/**
 * Runs one action of the portal and follows it: while it runs, its newest line from the live
 * stream; when it ends, its result in place (no page reload). A failure, and a success with a
 * warning (`tone: "warn"`), keep their words until the person tries again; a plain success clears
 * itself after `DONE_SHOWN_MS`.
 */
export function useAction(action: ActionName, onDone?: (result: ActionResult) => void) {
  const [state, setState] = useState<ActionState>({ phase: "idle" });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useLiveEvent((message) => {
    if (message.name !== "action" || message.data.action !== action) return;
    const data = message.data;
    // The stream names the action, not the control: with two runs of it going, whose line is it?
    if ("line" in data && ownsProgress(action)) {
      setState((before) =>
        before.phase === "sending" ? { line: data.line, phase: "sending" } : before,
      );
    }
  });
  useEffect(() => {
    // A warning stays, as a failure does, until the person tries again: it must be read.
    if (state.phase !== "done" || !state.result.ok || state.result.tone === "warn") return;
    const timer = window.setTimeout(() => setState({ phase: "idle" }), DONE_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  // The run this control has going, so the action's progress lines can tell whose they are.
  const endRun = useRef<(() => void) | null>(null);
  useEffect(() => () => endRun.current?.(), []);
  const run = useCallback(
    (body: Record<string, unknown>) => {
      setState({ line: null, phase: "sending" });
      endRun.current?.();
      endRun.current = beginRun(action);
      portalClient()
        .act(action, body)
        .then(
          (result) => {
            endRun.current?.();
            setState({ phase: "done", result });
            doneRef.current?.(result);
          },
          (error: unknown) => {
            endRun.current?.();
            setState({
              phase: "done",
              result: {
                lines: [error instanceof Error ? error.message : String(error)],
                ok: false,
              },
            });
          },
        );
    },
    [action],
  );
  const clear = useCallback(() => setState({ phase: "idle" }), []);
  return { clear, run, state };
}

/** The result line under a control: ✓ or ✗, the first line, and the rest on demand. */
export function ActionResultLine({
  state,
  onRetry,
  className,
}: {
  state: ActionState;
  onRetry?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  if (state.phase === "idle") return null;
  if (state.phase === "sending") {
    return (
      <p role="status" className={cn("text-sm text-muted-foreground", className)}>
        {state.line ?? "Working…"}
      </p>
    );
  }
  const { first, rest } = resultWords(state.result);
  const ok = state.result.ok;
  // Done, but with a warning to read: a key saved without its backend accepting it.
  const warn = ok && state.result.tone === "warn";
  return (
    <div role="status" className={cn("flex flex-col gap-1 text-sm", className)}>
      <p className={cn("text-pretty", warn ? "text-warn" : ok ? "text-ok" : "text-bad")}>
        <span aria-hidden="true">{warn ? "! " : ok ? "✓ " : "✗ "}</span>
        {ok ? "" : "Not done: "}
        {first}
      </p>
      {(rest.length > 0 || (!ok && onRetry !== undefined)) && (
        <div className="flex flex-wrap items-center gap-2">
          {rest.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide details" : "Details"}
            </Button>
          )}
          {!ok && onRetry !== undefined && (
            <Button variant="outline" size="sm" className="h-7" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {rest.length > 0 && (
        // The command's own lines, in its order (a line may repeat): one block, as it printed.
        <pre
          id={detailsId}
          hidden={!open}
          className="font-mono text-xs whitespace-pre-wrap text-muted-foreground"
        >
          {rest.join("\n")}
        </pre>
      )}
    </div>
  );
}

/** A question the page asks before the action runs: what changes, and the verb that says yes. */
export interface Confirm {
  title: string;
  body?: ReactNode;
  yes: string;
  tone?: "default" | "destructive";
}

/**
 * A button that runs one of the portal's actions. With `confirm`, it first asks in the page,
 * in words that name the change. Its progress and its result show beside it.
 */
export function ActionButton({
  action,
  body,
  children,
  confirm,
  variant = "default",
  disabled = false,
  onDone,
  icon,
  className,
}: {
  /** Extra classes for the button itself (a long answer wraps instead of overflowing). */
  className?: string;
  disabled?: boolean;
  action: ActionName;
  body: Record<string, unknown>;
  children: ReactNode;
  confirm?: Confirm;
  variant?: "default" | "destructive" | "outline";
  onDone?: (result: ActionResult) => void;
  icon?: ReactNode;
}) {
  const { run, state } = useAction(action, onDone);
  const [asking, setAsking] = useState(false);
  const sending = state.phase === "sending";
  const start = () => (confirm === undefined ? run(body) : setAsking(true));
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <Button
        size="sm"
        variant={variant}
        className={className}
        disabled={disabled || sending}
        aria-busy={sending}
        onClick={start}
      >
        {sending ? (
          <LoaderCircleIcon
            data-icon="inline-start"
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          icon
        )}
        {children}
      </Button>
      <ActionResultLine state={state} onRetry={start} />
      {confirm !== undefined && (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          yes={confirm.yes}
          tone={confirm.tone}
          onCancel={() => setAsking(false)}
          onYes={() => {
            setAsking(false);
            run(body);
          }}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
    </div>
  );
}
