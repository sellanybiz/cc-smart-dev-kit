/**
 * The flow report, read off the server's event loop.
 *
 * `readFlow` (`src/sessions/flow.ts`) reads every saved session's transcript with synchronous
 * file reads: about 200 ms on a warm cache, and 10 s on a cold one on a machine with gigabytes
 * of transcripts (measured, 2026-10-23). Run in the server, that froze every page, every action
 * and the live stream for as long. So the portal never calls it: it runs the CLI's own
 * `report --json` in a child process (`runCliChildText`, the portal's one spawn in
 * `cli-child.ts`, never `spawnSync`) and reads its answer — the same reader, the same cache in
 * `<stateDir>/flow/`, so the page and the command can never disagree.
 *
 * Requests that ask the same window at once share one child, and an answer stays good for
 * `FLOW_FRESH_MS` from its arrival (`shortCache`, `cli-child.ts`, the one home for the rule):
 * the sidebar's Needs count, the Work page and the Needs page all ask within a moment of each
 * other.
 */

import type { FlowReport, OpenWait } from "../sessions/flow";
import { runCliChildText, shortCache } from "./cli-child";
import type { PortalContext } from "./context";

/** How long the child may take: a cold cache on a big machine took 10 s. */
export const FLOW_CHILD_TIMEOUT_MS = 120_000;

/** How long one answer is reused for the same window. */
export const FLOW_FRESH_MS = 5_000;

/** One hour, in milliseconds: the command takes its window in hours. */
const HOUR_MS = 3_600_000;

/** The report, or why it could not be read, in words a page can show. */
export type FlowRead = { error: string } | { report: FlowReport };

/** One report per window, kept for `FLOW_FRESH_MS` (`shortCache`'s rules). */
const reports = shortCache<number, FlowRead>(FLOW_FRESH_MS);

/** The report over the last `windowMs`, from the CLI's own `report --json` in a child. */
export function readFlowOffLoop(ctx: PortalContext, windowMs: number): Promise<FlowRead> {
  const hours = windowMs / HOUR_MS;
  return reports.read(ctx, hours, () => runReport(ctx, hours));
}

/** The open permission prompts of the last `windowMs` (`openWaits`, off the loop). */
export async function openWaitsOffLoop(
  ctx: PortalContext,
  windowMs: number,
): Promise<{ error: string } | { open: OpenWait[] }> {
  const read = await readFlowOffLoop(ctx, windowMs);
  return "error" in read ? read : { open: read.report.open };
}

async function runReport(ctx: PortalContext, hours: number): Promise<FlowRead> {
  const run = await runCliChildText(ctx, ["report", "--hours", String(hours), "--json"], {
    subject: "the flow report",
    timeoutMs: FLOW_CHILD_TIMEOUT_MS,
  });
  if ("error" in run) return run;
  const report = reportOf(run.output);
  return report === null
    ? { error: "the flow report's answer was not one this portal reads" }
    : { report };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpenWait(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.session === "string" &&
    typeof value.project === "string" &&
    typeof value.at === "number" &&
    typeof value.asker === "string" &&
    typeof value.tool === "string"
  );
}

function isFlowHour(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.t === "number" &&
    typeof value.launches === "number" &&
    typeof value.promptMs === "number"
  );
}

/** The report in the child's output: its shape and the fields the pages read checked, or null. */
function reportOf(output: string): FlowReport | null {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { hours, open, sessions, sinceMs, untilMs } = value as Record<string, unknown>;
  if (typeof sinceMs !== "number" || typeof untilMs !== "number") return null;
  if (!Array.isArray(sessions) || !Array.isArray(open) || !Array.isArray(hours)) return null;
  // The fields the pages draw from each list: a newer CLI that renamed one is refused, never
  // drawn as blanks.
  if (!open.every(isOpenWait) || !hours.every(isFlowHour)) return null;
  return value as FlowReport;
}
