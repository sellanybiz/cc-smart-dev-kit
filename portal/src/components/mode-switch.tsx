"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export type SlotModeName = "claude" | "custom";

const OPTIONS: readonly { value: SlotModeName; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "custom", label: "Custom" },
];

/**
 * Who answers a slot: Claude, or its Custom chain. Two native radio buttons with both states
 * named, not an on/off toggle (the design's switch); the arrow keys move between them, as in
 * any radio group. Choosing one asks first (the page's dialog), so the checked one is always
 * what the server holds. A Custom that cannot be chosen yet stays focusable (`aria-disabled`,
 * its reason through `aria-describedby`), so a screen reader hears why. While a change runs,
 * the chosen option has a dashed outline and both are blocked.
 */
export function ModeSwitch({
  value,
  pending,
  customBlocked,
  label,
  onChoose,
}: {
  value: SlotModeName;
  /** The mode a change is moving to, while it runs. */
  pending: null | SlotModeName;
  /** Why Custom cannot be chosen now; null when it can. */
  customBlocked: null | string;
  label: string;
  onChoose: (mode: SlotModeName) => void;
}) {
  const name = useId();
  const reasonId = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex w-full rounded-lg border bg-muted p-0.5 sm:w-auto sm:self-start">
        {OPTIONS.map((option) => {
          const checked = value === option.value;
          const isPending = pending === option.value;
          const blocked = pending !== null || (option.value === "custom" && customBlocked !== null);
          return (
            <label
              key={option.value}
              className={cn(
                "relative flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-medium transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:flex-none",
                checked
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                isPending && "border border-dashed border-primary bg-background text-foreground",
                blocked && !checked && "cursor-not-allowed opacity-60 hover:text-muted-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                aria-disabled={blocked || undefined}
                aria-describedby={
                  option.value === "custom" && customBlocked !== null ? reasonId : undefined
                }
                onChange={() => {
                  if (!blocked && !checked) onChoose(option.value);
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {customBlocked !== null && (
        <p id={reasonId} className="text-xs text-pretty text-muted-foreground">
          {customBlocked}
        </p>
      )}
    </fieldset>
  );
}
