"use client";

import { FilterXIcon } from "lucide-react";
import { useId } from "react";
import { useResource } from "@/api/hooks";
import type { HistoryFilter, HistoryKeys, HistoryRange } from "@/api/types";
import type { HistoryState } from "@/components/history-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { slotName, targetModel } from "@/lib/format";
import { HISTORY_RANGES, hasFilter, isRange, sessionLabel } from "@/lib/history";
import { cn } from "@/lib/utils";

/** The range switch every chart uses: a toggle group on a wide page, a select on a narrow one. */
export function RangeSwitch({
  value,
  onChange,
}: {
  value: HistoryRange;
  onChange: (range: HistoryRange) => void;
}) {
  const id = useId();
  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        aria-label="Time range"
        onValueChange={(next) => {
          if (isRange(next)) onChange(next);
        }}
        className="hidden @3xl/main:flex"
      >
        {HISTORY_RANGES.map((range) => (
          <ToggleGroupItem
            key={range.value}
            value={range.value}
            aria-label={range.words}
            className="px-2.5"
          >
            {range.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <label htmlFor={id} className="sr-only">
        Time range
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={value}
        onChange={(event) => {
          if (isRange(event.target.value)) onChange(event.target.value);
        }}
        className="@3xl/main:hidden"
      >
        {HISTORY_RANGES.map((range) => (
          <NativeSelectOption key={range.value} value={range.value}>
            {range.words}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

/**
 * A filter row's select: one value or (empty) all of them, muted while it narrows nothing. The
 * one picker of every filter row (the charts', the Tasks page's, the guard log's). It is never
 * wider than its row, and at most `max-w-72` from the container's xl size up, so one long name
 * cannot push the row's other controls away; a cut name ends in "…" and its title holds all of it.
 */
export function FilterPick({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: null | string;
  options: readonly { value: string; label: string }[];
  onChange: (value: null | string) => void;
}) {
  const id = useId();
  const shown =
    value === null ? all : (options.find((option) => option.value === value)?.label ?? value);
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={value ?? ""}
        title={shown}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className={cn(
          "max-w-full @xl/main:max-w-72 [&>select]:truncate",
          value === null ? "text-muted-foreground" : "font-medium",
        )}
      >
        <NativeSelectOption value="">{all}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

/** A filter row's labelled switch; its words stay on one line beside it. */
export function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 px-1">
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-sm font-normal whitespace-nowrap">
        {label}
      </Label>
    </div>
  );
}

function optionsOf(keys: HistoryKeys | null) {
  return {
    slots: (keys?.slots ?? []).map((slot) => ({ value: slot, label: slotName(slot) })),
    targets: (keys?.targets ?? []).map((target) => ({ value: target, label: targetModel(target) })),
    models: (keys?.models ?? []).map((model) => ({ value: model, label: model })),
    sessions: (keys?.sessions ?? []).map((session) => ({
      value: session.id,
      label: sessionLabel(session),
    })),
  };
}

/**
 * The compact filter bar above a page's charts and tables: the range, then slot, target, model,
 * session and "errors only". Every value lives in the page's address.
 */
export function FilterBar({
  state,
  children,
}: {
  state: HistoryState;
  children?: React.ReactNode;
}) {
  const keys = useResource((client) => client.historyKeys());
  const options = optionsOf(keys.status === "ready" ? keys.data : null);
  const set = (change: Partial<HistoryFilter>) => state.setFilter({ ...state.filter, ...change });
  return (
    <search aria-label="Filters" className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
      <RangeSwitch value={state.range} onChange={state.setRange} />
      <span className="mx-1 hidden h-5 w-px bg-border @3xl/main:block" aria-hidden="true" />
      <FilterPick
        label="Slot"
        all="All slots"
        value={state.filter.slot ?? null}
        options={options.slots}
        onChange={(slot) => set({ slot: slot ?? undefined })}
      />
      <FilterPick
        label="Target"
        all="All targets"
        value={state.filter.target ?? null}
        options={options.targets}
        onChange={(target) => set({ target: target ?? undefined })}
      />
      <FilterPick
        label="Model"
        all="All models"
        value={state.filter.model ?? null}
        options={options.models}
        onChange={(model) => set({ model: model ?? undefined })}
      />
      <FilterPick
        label="Session"
        all="All sessions"
        value={state.filter.session ?? null}
        options={options.sessions}
        onChange={(session) => set({ session: session ?? undefined })}
      />
      <FilterToggle
        label="Errors only"
        checked={state.filter.errorsOnly === true}
        onChange={(errorsOnly) => set({ errorsOnly: errorsOnly ? true : undefined })}
      />
      {hasFilter(state.filter) && (
        <Button variant="ghost" size="sm" onClick={() => state.setFilter({})}>
          <FilterXIcon data-icon="inline-start" aria-hidden="true" />
          Clear filters
        </Button>
      )}
      {children !== undefined && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </search>
  );
}
