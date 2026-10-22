/**
 * The plugin's own skills for a lead and a crew session, as Claude Code names them: `plugin:skill`.
 *
 * **One home for the names.** The crew session's brief and its first line tell the crew session to work by
 * `/cc-smart-dev-kit:crew` (the skill that says how to build a phase and how to hand it
 * back), and the plugin's monitors arm on the lead's and the crew session's skill
 * (`plugin/monitors/monitors.json`).
 */
import { PLUGIN } from "../build-info/names";

/** The skill a crew session works by: `/cc-smart-dev-kit:crew`. */
export const CREW_SKILL = `${PLUGIN}:crew`;

/** The skill a lead works by: `/cc-smart-dev-kit:lead`. */
export const LEAD_SKILL = `${PLUGIN}:lead`;
