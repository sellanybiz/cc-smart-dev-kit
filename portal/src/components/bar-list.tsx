import { MeterBar } from "@/components/meter";
import { cn } from "@/lib/utils";

/**
 * A ranked list with a bar per row: the label, the bar, the value and its note. The rows share
 * the list's columns (a subgrid), so the widest value sets one width for all of them and every
 * bar starts and ends at the same x. In a narrow card the label takes its own line above the
 * bar: on one line, the label's column would grow first and leave the bar no width.
 */
export function BarList({
  rows,
  label,
}: {
  rows: { key: string; label: string; value: number; shown: string; note?: string }[];
  label: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const hasNotes = rows.some((row) => row.note !== undefined);
  return (
    <div className="@container">
      <ol
        aria-label={label}
        className={cn(
          "grid gap-3 text-sm",
          hasNotes
            ? "grid-cols-[1fr_auto_auto] @md:grid-cols-[minmax(7rem,12rem)_1fr_auto_auto]"
            : "grid-cols-[1fr_auto] @md:grid-cols-[minmax(7rem,12rem)_1fr_auto]",
        )}
      >
        {rows.map((row) => (
          <li key={row.key} className="col-span-full grid grid-cols-subgrid items-center gap-y-1">
            <span className="col-span-full truncate @md:col-span-1" title={row.label}>
              {row.label}
            </span>
            <MeterBar value={row.value} max={max} className="w-full" />
            <span className="text-right tabular-nums">{row.shown}</span>
            {hasNotes && (
              <span className="text-right text-muted-foreground tabular-nums">{row.note}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
