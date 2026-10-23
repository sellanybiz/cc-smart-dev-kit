import type { Metric } from "@/components/history-chart";
import { compact, count, duration, percent, usd } from "@/lib/format";
import { tokensOf } from "@/lib/history";

/** What the portal's charts draw of the request history. One home: every chart picks from here. */
export const METRICS = {
  requests: { of: (p) => p.requests, format: (v) => count(v), mode: "sum", whole: true },
  errors: { of: (p) => p.errors, format: (v) => count(v), mode: "sum", whole: true },
  cost: { of: (p) => p.costUsd, format: (v) => usd(v), mode: "sum" },
  tokens: { of: tokensOf, format: (v) => compact(v), mode: "sum" },
  p50: { of: (p) => p.p50Ms, format: (v) => duration(v), mode: "each" },
  p95: { of: (p) => p.p95Ms, format: (v) => duration(v), mode: "each" },
  errorRate: {
    of: (p) => (p.requests === 0 ? 0 : p.errors / p.requests),
    format: (v) => percent(v),
    mode: "each",
  },
} satisfies Record<string, Metric>;
