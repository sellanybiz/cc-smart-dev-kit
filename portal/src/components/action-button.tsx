"use client";

import { LoaderCircleIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type PortalAction, portalClient } from "@/api/client";
import { Button } from "@/components/ui/button";

type State =
  | { phase: "idle" }
  | { phase: "asking" }
  | { phase: "sending" }
  | { phase: "done"; ok: boolean; message: string };

/**
 * A button that runs one of the portal's actions (a POST with the page's CSRF value). With
 * `confirm`, it first asks in the page, in words that name the change: a browser cannot be
 * asked a terminal question, and a dialog would lock the page's scroll with a runtime style.
 */
export function ActionButton({
  action,
  body,
  children,
  confirm,
  variant = "default",
  disabled = false,
}: {
  disabled?: boolean;
  action: PortalAction;
  body: Record<string, unknown>;
  children: ReactNode;
  /** The question, and the verb on the button that says yes. */
  confirm?: { question: string; yes: string };
  variant?: "default" | "outline";
}) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const send = () => {
    setState({ phase: "sending" });
    portalClient()
      .act(action, body)
      .then(
        (answer) => setState({ phase: "done", ok: answer.ok, message: answer.message }),
        (error: unknown) =>
          setState({
            phase: "done",
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }),
      );
  };
  if (state.phase === "asking" && confirm !== undefined) {
    return (
      <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
        <legend className="sr-only">{confirm.question}</legend>
        <span className="text-sm" aria-hidden="true">
          {confirm.question}
        </span>
        <Button size="sm" onClick={send}>
          {confirm.yes}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setState({ phase: "idle" })}>
          Cancel
        </Button>
      </fieldset>
    );
  }
  if (state.phase === "done") {
    return (
      <p role="status" className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>
        <span aria-hidden="true">{state.ok ? "✓ " : "✗ "}</span>
        {state.message}
      </p>
    );
  }
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={disabled || state.phase === "sending"}
      onClick={() => (confirm === undefined ? send() : setState({ phase: "asking" }))}
    >
      {state.phase === "sending" && (
        <LoaderCircleIcon
          data-icon="inline-start"
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {children}
    </Button>
  );
}
