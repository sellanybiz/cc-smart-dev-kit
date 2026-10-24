"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** One option of a `ChoiceSwitch`: its value, its words, and why it cannot be chosen now. */
export interface Choice<T extends string> {
  value: T;
  label: string;
  /** Why it cannot be chosen now; null or absent when it can. */
  blocked?: null | string;
}

/**
 * A choice of two or three named states — Claude or Custom, on, off or default — as native radio
 * buttons drawn as one segmented control, never an on/off toggle: every state is named. The arrow
 * keys move between them, as in any radio group. An option that cannot be chosen stays focusable
 * (`aria-disabled`, its reason through `aria-describedby`), so a screen reader hears why. While a
 * change runs, the option it moves to has a dashed outline and every option is blocked.
 */
export function ChoiceSwitch<T extends string>({
  value,
  options,
  pending = null,
  label,
  onChoose,
  disabled = false,
}: {
  value: T;
  options: readonly Choice<T>[];
  /** The option a change is moving to, while it runs. */
  pending?: null | T;
  /** The group's name, for a screen reader. */
  label: string;
  onChoose: (value: T) => void;
  /** Every option blocked: the form is busy, or nothing can be written here. */
  disabled?: boolean;
}) {
  const name = useId();
  const reasonBase = useId();
  const reasons = options.filter((option) => (option.blocked ?? null) !== null);
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex w-full rounded-lg border bg-muted p-0.5 sm:w-auto sm:self-start">
        {options.map((option) => {
          const checked = value === option.value;
          const isPending = pending === option.value;
          const reason = option.blocked ?? null;
          const blocked = disabled || pending !== null || reason !== null;
          return (
            <label
              key={option.value}
              className={cn(
                "relative flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-center text-sm font-medium transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:flex-none sm:px-4",
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
                aria-describedby={reason === null ? undefined : `${reasonBase}-${option.value}`}
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
      {reasons.map((option) => (
        <p
          key={option.value}
          id={`${reasonBase}-${option.value}`}
          className="text-xs text-pretty text-muted-foreground"
        >
          {option.blocked}
        </p>
      ))}
    </fieldset>
  );
}
