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
import { projectGatewayState } from "../gateway/project-state";
import { familySlotKey } from "../gateway/targets";
import { sessionGatewayOf } from "../hooks/agent-guard";
import type { GatewayFacts } from "../models/launch-policy";
import type { Checkout } from "../project/resolve";

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

/**
 * The folder whose settings a crew session started by this lead will run on (FX1): the lead's
 * own checkout root. A crew session's worktree is cut from the lead's branch and the session runs
 * in it, and Claude Code reads the **running folder's** own `.claude/settings.json` (proved on
 * 2.1.310: a session in a linked worktree took the worktree's team file, not the main checkout's;
 * `docs/claude-code-contract.md`). So the team file of the lead's branch, which is the lead's
 * folder's, is the one the session will meet. The personal file is the main checkout's either
 * way (`projectGatewayState` reads it for a linked worktree). One home: `crew start`, the queue
 * start, the board's caps and the opus usage guard all read the project's gateway here.
 */
export function crewSettingsFolder(checkout: Checkout): string {
  return checkout.root;
}

/**
 * The gateway a crew session started in `folder` runs on (RV3): the address its project's own
 * settings choose over the machine's — the personal file, then the team file, then the user's
 * (`projectGatewayState`) — read as a session's own address is (`sessionGatewayOf`): off for
 * Anthropic's address or none, the profile's chains for `…/p/<name>`, else the machine's.
 * `crew start` runs outside any session of that project, so its own environment says nothing
 * about it; the user's file alone would miss a project turned on or off (`gateway project`).
 * A settings file that cannot be read stops the chain (`unknown`), which counts as off, as an
 * unreadable user file always did.
 */
export function crewGatewayOf(paths: CliPaths, folder: string): GatewayFacts {
  const { effective } = projectGatewayState(folder, {
    configPath: paths.gatewayConfigFile,
    settingsFile: paths.settingsFile,
  });
  const { config, gatewayOn } = sessionGatewayOf(paths, {
    ANTHROPIC_BASE_URL: effective.url ?? undefined,
  });
  return { config, gatewayOn };
}

/** The facts `crew start` and `crew list` read for the project in `folder`, at one moment. */
export function usageFacts(paths: CliPaths, nowMs: number, folder: string): UsageFacts {
  return {
    opusFallback: opusFallbackOf(crewGatewayOf(paths, folder)),
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
