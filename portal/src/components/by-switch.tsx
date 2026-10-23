"use client";

import type { HistoryBy } from "@/api/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HISTORY_BYS, isBy } from "@/lib/history";

/** What a chart is broken down by: target, slot, model or session (`by=` in the address). */
export function BySwitch({
  value,
  onChange,
  options = HISTORY_BYS.map((by) => by.value),
}: {
  value: HistoryBy;
  onChange: (by: HistoryBy) => void;
  options?: readonly HistoryBy[];
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      aria-label="Break down by"
      onValueChange={(next) => {
        if (isBy(next)) onChange(next);
      }}
    >
      {HISTORY_BYS.filter((by) => options.includes(by.value)).map((by) => (
        <ToggleGroupItem key={by.value} value={by.value} className="px-2.5">
          By {by.label.toLowerCase()}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
