"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * The page's own question before a change that restarts or rewrites something: a browser
 * cannot be asked a terminal question, so the page asks, names the exact change, and the
 * action runs only on its verb button (`.claude/rules/portal.md`).
 *
 * A native `<dialog>` opened with `showModal()`: the browser traps the focus, closes it on
 * Escape, and draws the backdrop. It writes no `style` attribute and injects no `<style>`, so
 * the page's strict content policy holds (a Radix dialog injects its scroll lock at runtime).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  yes,
  tone = "default",
  onYes,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** The verb on the button that says yes: "Save the chain", "Stop it". */
  yes: string;
  /** `destructive` draws the verb in the alarm colour (a stop, a removal). */
  tone?: "default" | "destructive";
  onYes: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={children === undefined ? undefined : bodyId}
      onCancel={(event) => {
        // Escape: the browser would close it by itself; the page's state says closed too.
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-base font-semibold text-pretty">
          {title}
        </h2>
        {children !== undefined && (
          <div id={bodyId} className="text-sm text-pretty text-muted-foreground">
            {children}
          </div>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {/* The safe answer has the focus first: Enter never confirms a change by accident.
              Both are plain buttons: a dialog inside a form (a key field's) must never submit it,
              or the form's own submit opens the question again. */}
          <Button type="button" variant="outline" size="sm" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tone === "destructive" ? "destructive" : "default"}
            onClick={onYes}
          >
            {yes}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
