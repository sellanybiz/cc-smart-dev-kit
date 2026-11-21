import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Each size: the bar's height, and the corner that keeps its ends round at that height. */
const SIZES = {
  default: { className: "h-2.5", rx: 4 },
  sm: { className: "h-1.5", rx: 3 },
} as const;

const TONES = { ok: "fill-ok", primary: "fill-primary" } as const;

interface BarProps {
  value: number;
  max: number;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  /** The bar's width. */
  className?: string;
}

/**
 * The bar alone, hidden from screen readers: for a row whose words already say the number. The
 * fill's width is an SVG attribute, never a `style` attribute, which the page policy forbids.
 */
export function MeterBar({ value, max, size = "default", tone = "primary", className }: BarProps) {
  const share = max === 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const { className: height, rx } = SIZES[size];
  return (
    <svg
      data-slot="meter"
      className={cn(height, className)}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <rect width="100%" height="100%" rx={rx} className="fill-muted" />
      <rect width={`${share * 100}%`} height="100%" rx={rx} className={TONES[tone]} />
    </svg>
  );
}

/**
 * How full something is: a native `<meter>` speaks it to a screen reader, with `children` as its
 * words, and the bar draws it, because a meter's own look cannot be themed.
 */
export function Meter({ children, ...bar }: BarProps & { children: ReactNode }) {
  return (
    <>
      <meter className="sr-only" min={0} max={bar.max} value={bar.value}>
        {children}
      </meter>
      <MeterBar {...bar} />
    </>
  );
}
