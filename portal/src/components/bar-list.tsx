/**
 * A ranked list with a bar per row: the label, the bar, the value. The bar is an SVG `<rect>`
 * whose width is an attribute, not a style, so the content policy needs nothing for it.
 */
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
          <span className="truncate">{row.label}</span>
          <svg className="h-2.5 w-full" aria-hidden="true" preserveAspectRatio="none">
            <rect width="100%" height="100%" rx="3" className="fill-muted" />
            <rect
              width={`${(row.value / max) * 100}%`}
              height="100%"
              rx="3"
              className="fill-primary"
            />
          </svg>
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
