/**
 * What each subagent tier runs now, as the note a session reads (`src/hooks/tier-view.ts` says it
 * at a start and when it changes).
 *
 * The four tiers are the names the Agent tool's `model` accepts (`TIERS`). Each is resolved the
 * way the Agent guard resolves a launch (`resolveLaunchModel`), so this note and the guard read
 * one thing and never two lists.
 *
 * The note names the model behind each tier, so Claude can say it when it launches. It gives no
 * effort range per tier (2.2.0, the owner, 2026-11-05): Claude picks the tier and the effort by
 * the job — how hard it is, what a miss costs — never by which model answers a tier
 * (`/cc-smart-dev-kit:subagent-decision`). It keeps the two launches the guard asks about, from
 * the guard's own constants (`launch-policy.ts`), so Claude learns them from the note and not
 * from a refusal: the `opus` tier at `OPUS_ASK_EFFORT`, and any `fable` launch.
 *
 * A name with no premium tier that the person's override or a slot answers with a premium Claude
 * model reads as that tier (`sonnet` whose worker chain starts with a Claude Opus id is the `opus`
 * tier). A premium name keeps its own: `opus` whose slot answers with Claude Fable is the `opus`
 * tier, and its line names the model that answers (`- opus → Claude Fable.`).
 */

import { familyLabel } from "../gateway/targets";
import type { Env } from "../hooks/run";
import {
  answeringFamily,
  type GatewayFacts,
  type LaunchModel,
  OPUS_ASK_EFFORT,
  resolveLaunchModel,
} from "./launch-policy";

/** The names the Agent tool's `model` accepts, in the order the note lists them. */
export const TIERS = ["haiku", "sonnet", "opus", "fable"] as const;

/** The first line of the note. */
export const TIER_NOTE_HEADER = "Subagent tiers now (the Agent tool's `model`):";

/** How the note names the model behind a tier: `Claude Sonnet`, or the backend target. */
function modelName(real: LaunchModel): string {
  if (!real.claude) return `${real.model} (a backend)`;
  // The model that answers, never the tier's name: `real.family` keeps the NAME's family, so a
  // scout slot on a Claude Sonnet id would read as Haiku.
  const family = answeringFamily(real);
  return family === null ? real.model : `Claude ${familyLabel(family)}`;
}

/** The note's last line: how to choose, and the two launches the guard asks about. */
export const TIER_NOTE_FOOTER = `Choose the tier and effort by the job (\`/cc-smart-dev-kit:subagent-decision\`), never by the model behind a tier. \`opus\` at \`${OPUS_ASK_EFFORT}\` and any \`fable\` launch (with a \`Fable reason:\` line) ask the person.`;

/** The note's line for one tier: the tier and the model behind it. */
export function tierLine(tier: (typeof TIERS)[number], gateway: GatewayFacts, env: Env): string {
  const real: LaunchModel = resolveLaunchModel(tier, gateway, env);
  return `- ${tier} → ${modelName(real)}.`;
}

/** The note: a header, one line per tier, and how to choose. */
export function tierNote(gateway: GatewayFacts, env: Env): string {
  return [
    TIER_NOTE_HEADER,
    ...TIERS.map((tier) => tierLine(tier, gateway, env)),
    TIER_NOTE_FOOTER,
  ].join("\n");
}
