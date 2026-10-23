/**
 * A small line of values, for a table cell. Pure SVG: its shape is a `points` attribute, never a
 * style, so the content policy needs nothing for it. The label says what it shows, in words.
 */
export function Sparkline({
  values,
  label,
  width = 80,
  height = 24,
}: {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map(
      (value, i) =>
        `${(i * step).toFixed(1)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="overflow-visible text-primary"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
