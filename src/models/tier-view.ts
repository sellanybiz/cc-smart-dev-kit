/**
 * What each subagent tier runs now, and the effort rule that follows, as the note a session reads
 * (`src/hooks/tier-view.ts` says it at a start and when it changes).
 *
 * The four tiers are the names the Agent tool's `model` accepts (`TIERS`). Each is resolved the
 * way the Agent guard resolves a launch (`resolveLaunchModel`), so this note and the guard read
 * one thing and never two lists. The effort rule per tier is the guard's, from the same
 * constants (`launch-policy.ts`):
 *
 * - an affordable backend answers (`isAffordable`) with the gateway on: it runs at
 *   `AFFORDABLE_EFFORT`;
 * - Claude answers `haiku` or `sonnet`: the effort the task needs, `ALLOWED_EFFORTS` first to
 *   last, `max` included — Claude is not a cheap model, and the owner set no restriction;
 * - the `opus` tier (whatever model answers it): the levels below `OPUS_ASK_EFFORT`; that one
 *   asks the person;
 * - the `fable` tier: asks the person, with a reason line.
 *
 * A name the person's override or a slot answers with a stricter premium Claude model reads as
 * that tier (`sonnet` whose worker chain starts with a Claude Opus id is the `opus` tier).
 */

import { CLAUDE_FAMILIES, type ClaudeFamily, claudeFamily } from "../gateway/targets";
import type { Env } from "../hooks/run";
import {
  AFFORDABLE_EFFORT,
  ALLOWED_EFFORTS,
  type GatewayFacts,
  isAffordable,
  type LaunchModel,
  OPUS_ASK_EFFORT,
  OPUS_FREE_EFFORTS,
  resolveLaunchModel,
} from "./launch-policy";

/** The names the Agent tool's `model` accepts, in the order the note lists them. */
export const TIERS = ["haiku", "sonnet", "opus", "fable"] as const;

/** The first line of the note. */
export const TIER_NOTE_HEADER = "Subagent tiers now (the Agent tool's `model`):";

/** Capitalised, for a Claude model's name. */
function capitalised(family: ClaudeFamily): string {
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}`;
}

/** How the note names the model behind a tier: `Claude Sonnet`, or the backend target. */
function modelName(real: LaunchModel): string {
  if (!real.claude) return `${real.model} (a backend)`;
  // The model that answers, never the tier's name: `real.family` keeps the NAME's family, so a
  // scout slot on a Claude Sonnet id would read as Haiku. With no slot and no override the model
  // is the family name itself (`haiku`).
  const family =
    claudeFamily(real.model) ??
    CLAUDE_FAMILIES.find((one) => one === real.model.toLowerCase()) ??
    null;
  return family === null ? real.model : `Claude ${capitalised(family)}`;
}

/** The effort rule for the model behind a tier. */
function effortRule(real: LaunchModel, gatewayOn: boolean): string {
  if (real.tier === "fable") return "asks the person, with a `Fable reason:` line";
  if (real.tier === "opus") {
    const free = OPUS_FREE_EFFORTS;
    return `${free[0]} to ${free[free.length - 1]}; ${OPUS_ASK_EFFORT} asks the person`;
  }
  if (isAffordable(real) && gatewayOn) return `runs at ${AFFORDABLE_EFFORT}`;
  return `the effort the task needs, ${ALLOWED_EFFORTS[0]} to ${ALLOWED_EFFORTS[ALLOWED_EFFORTS.length - 1]}`;
}

/** The note's line for one tier. */
export function tierLine(tier: (typeof TIERS)[number], gateway: GatewayFacts, env: Env): string {
  const real = resolveLaunchModel(tier, gateway, env);
  return `- ${tier} → ${modelName(real)}: ${effortRule(real, gateway.gatewayOn)}.`;
}

/** The note: a header and one line per tier. */
export function tierNote(gateway: GatewayFacts, env: Env): string {
  return [TIER_NOTE_HEADER, ...TIERS.map((tier) => tierLine(tier, gateway, env))].join("\n");
}
