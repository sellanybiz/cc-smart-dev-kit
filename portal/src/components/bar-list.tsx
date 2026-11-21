import { MeterBar } from "@/components/meter";

/** A ranked list with a bar per row: the label, the bar, the value. */
export function BarList({
  rows,
  label,
}: {
  rows: { key: string; label: string; value: number; shown: string; note?: string }[];
  label: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ol aria-label={label} className="flex flex-col gap-3">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className="truncate" title={row.label}>
            {row.label}
          </span>
          <MeterBar value={row.value} max={max} className="w-full" />
          <span className="text-right tabular-nums">
            {row.shown}
            {row.note !== undefined && (
              <span className="ml-2 text-muted-foreground">{row.note}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
