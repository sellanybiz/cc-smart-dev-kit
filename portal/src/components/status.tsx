"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "bad" | "info";

const GLYPH: Record<Tone, string> = { ok: "✓", warn: "!", bad: "✗", info: "·" };
const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-muted-foreground",
};

/** A meaning colour always comes with its glyph and its words: never colour alone. */
export function StatusMark({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span
        className={cn("w-3 shrink-0 text-center font-semibold", TONE_TEXT[tone])}
        aria-hidden="true"
      >
        {GLYPH[tone]}
      </span>
      <span>{children}</span>
    </span>
  );
}

/** A small pill with a tone: a state word, its glyph and a tinted edge. */
export function TonePill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        tone === "ok" && "border-ok/30 bg-ok/10 text-ok",
        tone === "warn" && "border-warn/30 bg-warn/10 text-warn",
        tone === "bad" && "border-bad/30 bg-bad/10 text-bad",
        tone === "info" && "text-muted-foreground",
      )}
    >
      <span aria-hidden="true">{GLYPH[tone]}</span>
      {children}
    </span>
  );
}

/**
 * True once the page runs in the browser. What sets inline styles through the CSSOM (Recharts,
 * dnd-kit) renders only then, so the exported HTML never holds a `style` attribute.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
