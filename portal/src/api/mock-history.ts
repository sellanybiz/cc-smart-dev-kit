/**
 * Mock request history and request log, in the shapes `GET /api/history` and
 * `GET /api/requests` will answer (phase H1). Seeded: the same numbers on every load. Prices
 * are made-up list prices, as the real "estimated" cost will be.
 */

import { rangeOf } from "@/lib/history";
import type {
  History,
  HistoryFilter,
  HistoryKeys,
  HistoryPoint,
  HistoryQuery,
  RequestPage,
  RequestQuery,
  RequestRow,
} from "./types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A small seeded generator (mulberry32): the same numbers on every load. */
export function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slotKey = (slot: string) => `cc-smart-dev-kit-${slot}`;

/** Who answers how often, per slot: the mock's traffic mix, with each target's size and price. */
export const TRAFFIC: {
  slot: string;
  target: string;
  weight: number;
  ms: [number, number];
  /** Tokens a request sends and gets, on average. */
  input: number;
  output: number;
  /** USD per million input and output tokens (cache reads at a tenth). */
  price: [number, number];
}[] = [
  {
    slot: "scout",
    target: "omniroute:glm-5.3-flash",
    weight: 38,
    ms: [600, 2400],
    input: 14_000,
    output: 900,
    price: [0.1, 0.4],
  },
  {
    slot: "scout",
    target: "omniroute:minimax-m3",
    weight: 6,
    ms: [900, 4200],
    input: 14_000,
    output: 900,
    price: [0.3, 1.2],
  },
  {
    slot: "worker",
    target: "omniroute:deepseek-v4.1-flash",
    weight: 26,
    ms: [1500, 9000],
    input: 38_000,
    output: 2_600,
    price: [0.27, 1.1],
  },
  {
    slot: "worker",
    target: "claude-sonnet-5-5",
    weight: 7,
    ms: [1800, 12000],
    input: 40_000,
    output: 2_800,
    price: [3, 15],
  },
  {
    slot: "opus",
    target: "claude-opus-5-5",
    weight: 14,
    ms: [3000, 22000],
    input: 62_000,
    output: 3_600,
    price: [15, 75],
  },
  {
    slot: "opus",
    target: "omniroute:glm-5.3",
    weight: 9,
    ms: [2500, 15000],
    input: 60_000,
    output: 3_400,
    price: [0.6, 2.2],
  },
];

/** The sessions the traffic comes from, and the share each one sends. */
export const SESSIONS: { id: string; name: null | string; project: string; share: number }[] = [
  { id: "9c3a7e5d-lead", name: "LEAD my-app release-1.1.0", project: "my-app", share: 0.34 },
  { id: "a1f04c2e", name: "C my-app B6b live-stream", project: "my-app", share: 0.27 },
  { id: "d9e2f7a4", name: "C my-app C2 skills-agents", project: "my-app", share: 0.18 },
  { id: "e51a9b30", name: "docs-site: fix the nav", project: "docs-site", share: 0.13 },
  { id: "f07c3d12", name: null, project: "api-service", share: 0.08 },
];

const modelOf = (target: string) => {
  const colon = target.indexOf(":");
  return colon === -1 ? target : target.slice(colon + 1);
};

/** One stream of requests: a traffic line from one session. */
interface Unit {
  traffic: (typeof TRAFFIC)[number];
  session: (typeof SESSIONS)[number];
  weight: number;
}

const UNITS: Unit[] = TRAFFIC.flatMap((traffic) =>
  SESSIONS.map((session) => ({ traffic, session, weight: traffic.weight * session.share })),
);

function passes(unit: Unit, filter: HistoryFilter): boolean {
  if (filter.slot !== undefined && slotKey(unit.traffic.slot) !== filter.slot) return false;
  if (filter.target !== undefined && unit.traffic.target !== filter.target) return false;
  if (filter.model !== undefined && modelOf(unit.traffic.target) !== filter.model) return false;
  if (filter.session !== undefined && unit.session.id !== filter.session) return false;
  return true;
}

function keyOf(unit: Unit, by: HistoryQuery["by"]): string {
  switch (by) {
    case "slot":
      return slotKey(unit.traffic.slot);
    case "model":
      return modelOf(unit.traffic.target);
    case "session":
      return unit.session.id;
    default:
      return unit.traffic.target;
  }
}

/** How busy the machine is at a time of day: quiet at night, busy in working hours. */
function load(at: number, bucketMs: number): number {
  const date = new Date(at);
  const weekend = date.getDay() % 6 === 0 ? 0.35 : 1;
  if (bucketMs >= 6 * 60 * MINUTE) return 0.42 * weekend;
  const hour = date.getHours() + date.getMinutes() / 60;
  return (0.06 + 0.94 * Math.exp(-(((hour - 14) / 4.2) ** 2))) * weekend;
}

function cost(traffic: Unit["traffic"], input: number, output: number, cacheRead: number): number {
  const [inPrice, outPrice] = traffic.price;
  return (input * inPrice + output * outPrice + cacheRead * inPrice * 0.1) / 1_000_000;
}

export function historyFor(now: number, query: HistoryQuery, empty: boolean): History {
  const { bucketMs, spanMs } = rangeOf(query.range);
  const random = seeded(spanMs % 9973);
  const first = Math.floor((now - spanMs) / bucketMs) * bucketMs;
  const byKey = new Map<string, Map<number, HistoryPoint & { msWeight: number }>>();
  if (!empty) {
    for (let t = first; t <= now; t += bucketMs) {
      const busy = load(t, bucketMs);
      for (const unit of UNITS) {
        const noise = 0.7 + 0.6 * random();
        if (!passes(unit, query)) continue;
        const all = Math.round((bucketMs / MINUTE) * 0.0275 * unit.weight * busy * noise);
        const errorShare = unit.traffic.target.startsWith("omniroute:") ? 0.06 : 0.012;
        // A small bucket rounds its expected errors up or down at random, so the rate is not 0.
        const expected = all * errorShare * (0.4 + random());
        const errors = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
        const requests = query.errorsOnly === true ? errors : all;
        if (requests === 0) continue;
        const { input, output, ms } = unit.traffic;
        const fresh = Math.round(requests * input * 0.25);
        const cacheRead = Math.round(requests * input * 0.7);
        const cacheWrite = Math.round(requests * input * 0.05);
        const out = Math.round(requests * output * (0.8 + 0.4 * random()));
        const p50 = Math.round(ms[0] + (ms[1] - ms[0]) * (0.25 + 0.2 * random()));
        const key = keyOf(unit, query.by);
        const points = byKey.get(key) ?? new Map();
        const point = points.get(t) ?? {
          t,
          requests: 0,
          errors: 0,
          p50Ms: 0,
          p95Ms: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          msWeight: 0,
          // The mock prices every unit: nothing here is unpriced.
          unpriced: 0,
        };
        // The bucket's times, weighted by requests: a fair stand-in for the real percentiles.
        point.p50Ms = Math.round(
          (point.p50Ms * point.msWeight + p50 * requests) / (point.msWeight + requests),
        );
        point.p95Ms = Math.max(point.p95Ms, Math.round(p50 * (2.1 + 0.6 * random())));
        point.msWeight += requests;
        point.requests += requests;
        point.errors += errors;
        point.inputTokens += fresh;
        point.outputTokens += out;
        point.cacheReadTokens += cacheRead;
        point.cacheWriteTokens += cacheWrite;
        point.costUsd += cost(unit.traffic, fresh + cacheWrite * 1.25, out, cacheRead);
        points.set(t, point);
        byKey.set(key, points);
      }
    }
  }
  return {
    available: true,
    by: query.by,
    from: now - rangeOf(query.range).spanMs,
    note: null,
    range: query.range,
    // Auto mode's safety checks: they are the router's own count, so the mock stands in with a
    // plausible one (the real one is a file the dev server does not have).
    safetyChecks: empty
      ? { checks: null, days: 0 }
      : { checks: 412, days: Math.min(30, Math.ceil(rangeOf(query.range).spanMs / DAY)) },
    to: now,
    bucketMs,
    series: [...byKey.entries()].map(([key, points]) => ({
      key,
      points: [...points.values()].map(({ msWeight: _, ...point }) => point),
    })),
  };
}

const PAGE = 12;

/** The request log, newest first, one page at a time: the cursor is the next row's index. */
export function requestsFor(now: number, query: RequestQuery, empty: boolean): RequestPage {
  if (empty) return { available: true, cursor: null, note: null, requests: [] };
  const { spanMs } = rangeOf(query.range);
  const start = query.cursor === null ? 0 : Number(query.cursor);
  const random = seeded(42);
  const total = UNITS.reduce((sum, unit) => sum + unit.weight, 0);
  const rows: RequestRow[] = [];
  let at = now - 3_000;
  let index = 0;
  while (at > now - spanMs && rows.length <= PAGE) {
    at -= Math.round((15_000 * (0.2 + 1.6 * random())) / Math.max(0.15, load(at, MINUTE)));
    let pick = random() * total;
    const unit = UNITS.find((u) => {
      pick -= u.weight;
      return pick <= 0;
    });
    const roll = random();
    const timing = random();
    const size = random();
    if (unit === undefined || !passes(unit, query)) continue;
    const failed = roll < (unit.traffic.target.startsWith("omniroute:") ? 0.05 : 0.01);
    if (query.errorsOnly === true && !failed) continue;
    if (index++ < start) continue;
    const { input, output, ms } = unit.traffic;
    const inputTokens = Math.round(input * 0.25 * (0.6 + size));
    const cacheReadTokens = failed ? 0 : Math.round(input * 0.7 * (0.6 + size));
    const outputTokens = failed ? 0 : Math.round(output * (0.5 + size));
    const cacheWriteTokens = failed ? 0 : Math.round(input * 0.05);
    rows.push({
      at,
      session: unit.session.id,
      model: modelOf(unit.traffic.target),
      slot: slotKey(unit.traffic.slot),
      target: unit.traffic.target,
      status: failed ? (unit.traffic.target.startsWith("omniroute:") ? 502 : 529) : 200,
      latencyMs: Math.round(ms[0] + (ms[1] - ms[0]) * timing),
      tokens: {
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
        input: inputTokens,
        output: outputTokens,
      },
      costUsd: cost(
        unit.traffic,
        inputTokens + cacheWriteTokens * 1.25,
        outputTokens,
        cacheReadTokens,
      ),
      held: false,
      nextTarget:
        unit.traffic.target === "omniroute:glm-5.3" ||
        unit.traffic.target === "omniroute:minimax-m3"
          ? "omniroute:deepseek-v4.1-flash"
          : null,
    });
  }
  const more = rows.length > PAGE;
  return {
    available: true,
    cursor: more ? String(start + PAGE) : null,
    note: null,
    requests: rows.slice(0, PAGE),
  };
}

export function historyKeys(empty: boolean): HistoryKeys {
  if (empty) return { slots: [], targets: [], models: [], sessions: [] };
  return {
    slots: [...new Set(TRAFFIC.map((t) => slotKey(t.slot)))],
    targets: TRAFFIC.map((t) => t.target),
    models: [...new Set(TRAFFIC.map((t) => modelOf(t.target)))],
    sessions: SESSIONS.map(({ id, name, project }) => ({ id, name, project })),
  };
}

/** A crew session's memory over the last hours, in the events log's `memoryMb` shape. */
export function memorySeries(
  now: number,
  seed: number,
  base: number,
): { at: number; mb: number }[] {
  const random = seeded(seed);
  const out: { at: number; mb: number }[] = [];
  let mb = base * 0.55;
  for (let i = 24; i >= 0; i--) {
    mb = Math.max(80, mb + (base - mb) * 0.18 + (random() - 0.45) * 40);
    out.push({ at: now - i * 5 * MINUTE, mb: Math.round(mb) });
  }
  return out;
}

/** The flow report's buckets: launches and blocked time per bucket. */
export function flowBuckets(
  now: number,
  spanMs: number,
  bucketMs: number,
  empty: boolean,
): { bucketMs: number; points: { t: number; launches: number; blockedMs: number }[] } {
  const random = seeded(spanMs % 7919);
  const points: { t: number; launches: number; blockedMs: number }[] = [];
  const first = Math.floor((now - spanMs) / bucketMs) * bucketMs;
  for (let t = first; t <= now; t += bucketMs) {
    const busy = empty ? 0 : load(t, Math.min(bucketMs, DAY / 4));
    points.push({
      t,
      launches: Math.round(busy * (bucketMs / (60 * MINUTE)) * 3.4 * (0.5 + random())),
      blockedMs: Math.round(busy * (bucketMs / (60 * MINUTE)) * 95_000 * random()),
    });
  }
  return { bucketMs, points };
}
