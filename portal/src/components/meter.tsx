import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Each size: the bar's height, and the corner that keeps its ends round at that height. */
const SIZES = {
  default: { className: "h-2.5", rx: 4 },
  sm: { className: "h-1.5", rx: 3 },
} as const;

const TONES = { ok: "fill-ok", primary: "fill-primary" } as const;

/**
 * How full something is, as a bar. A native `<meter>` speaks it to a screen reader, with
 * `children` as its words; an SVG draws it, because a meter's own look cannot be themed. The
 * fill's width is an SVG attribute, never a `style` attribute, which the page policy forbids.
 * `className` sets the bar's width.
 */
export function Meter({
  value,
  max,
  children,
  size = "default",
  tone = "primary",
  className,
}: {
  value: number;
  max: number;
  children: ReactNode;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  const share = max === 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const { className: height, rx } = SIZES[size];
  return (
    <>
      <meter className="sr-only" min={0} max={max} value={value}>
        {children}
      </meter>
      <svg
        data-slot="meter"
        className={cn(height, className)}
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <rect width="100%" height="100%" rx={rx} className="fill-muted" />
        <rect width={`${share * 100}%`} height="100%" rx={rx} className={TONES[tone]} />
      </svg>
    </>
  );
}
