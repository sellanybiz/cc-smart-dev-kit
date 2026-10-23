/**
 * The opus usage guard (D54): a new opus-tier crew session waits while the plan's 5-hour usage
 * window is past `workflow.crew.usagePercent`, unless the gateway's opus slot has a chain in
 * use with its fallback on — then an answer keeps coming from that chain past the window, and
 * the guard has nothing to protect.
 *
 * The window is the one the status line reads; `src/cli/usage-window.ts` is its one home (the
 * state file, and the reader). With no reading stored, or one whose window has reset, the guard
 * **does not hold**: the kit never invents a number. `usageUnreadLine` is the one line that says
 * so, said once by `crew start` and by `crew list`.
 */
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { readUsageWindow } from "../cli/usage-window";
import { fallbackOn, type GatewayConfig, slotMode } from "../gateway/config";
import { familySlotKey } from "../gateway/targets";
import { gatewayFactsOf } from "../hooks/agent-guard";

/** What the guard reads: the window now, and whether the opus slot's chain answers past it. */
export interface UsageFacts {
  /** The 5-hour window's share used now, in percent; null when it cannot be read. */
  percent: null | number;
  /** True when the gateway's opus slot has a chain in use with its fallback on. */
  opusFallback: boolean;
}

/**
 * True when `facts`' opus slot has a chain in use (`slots`) with its fallback on. Pure. A
 * gateway that is off never falls back: its chain is not in use, whatever the file says.
 */
export function opusFallbackOf(facts: {
  config: GatewayConfig | null;
  gatewayOn: boolean;
}): boolean {
  // The slot that answers for opus: the gateway's own table (`familySlotKey`), never a second
  // list here, so the guard and the router can never disagree about which slot that is.
  const slot = familySlotKey("opus");
  if (slot === null || !facts.gatewayOn || facts.config === null) return false;
  return slotMode(facts.config, slot) === "custom" && fallbackOn(facts.config, slot);
}

/** The facts `crew start` and `crew list` read, at one moment. */
export function usageFacts(paths: CliPaths, nowMs: number): UsageFacts {
  return {
    opusFallback: opusFallbackOf(gatewayFactsOf(paths)),
    percent: readUsageWindow(paths, nowMs)?.percent ?? null,
  };
}

/**
 * The one line said when the window cannot be read: the guard does not hold, and says why.
 * It names `setup --statusline`, the command that turns the recording on — `statusline` run by
 * hand has no input and records nothing.
 */
export function usageUnreadLine(): string {
  return `note: the 5-hour usage window cannot be read, so the opus usage guard does not hold: ${COMMAND} setup --statusline records it, and no current reading is stored`;
}
