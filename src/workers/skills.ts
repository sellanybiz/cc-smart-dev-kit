/**
 * The plugin's own skills for a lead and a worker, as Claude Code names them: `plugin:skill`.
 *
 * **One home for the names.** The worker's brief and its first line tell the worker to work by
 * `/cc-smart-dev-kit:worker` (the skill that says how to build a phase and how to hand it
 * back), and the plugin's monitors arm on the lead's and the worker's skill
 * (`plugin/monitors/monitors.json`).
 */
import { PLUGIN } from "../build-info/names";

/** The skill a worker works by: `/cc-smart-dev-kit:worker`. */
export const WORKER_SKILL = `${PLUGIN}:worker`;

/** The skill a lead works by: `/cc-smart-dev-kit:lead`. */
export const LEAD_SKILL = `${PLUGIN}:lead`;
