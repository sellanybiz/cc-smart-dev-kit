/**
 * Claude Code's switches that turn updates off. Each of `UPDATE_BLOCKING_VARS` also stops
 * plugin updates, unless `FORCE_AUTOUPDATE_PLUGINS` is set too. Claude Code reads them from
 * its environment and from the `env` of settings.json, so both are read here.
 *
 * The one home of that list: `doctor` reports them, and the background self-update does
 * nothing while one is in force (it honours the person's choice like Claude Code does).
 */

import { readUserJson } from "../setup/user-json";

type Env = Record<string, string | undefined>;

/** Claude Code variables that also stop plugin updates, unless FORCE_AUTOUPDATE_PLUGINS is set. */
export const UPDATE_BLOCKING_VARS = [
  "DISABLE_AUTOUPDATER",
  "DISABLE_UPDATES",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
] as const;
export const FORCE_PLUGIN_UPDATES_VAR = "FORCE_AUTOUPDATE_PLUGINS";

/** True when a variable is set to something other than empty, 0, false, no or off. */
export function isSet(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

/** The `env` object of a settings.json; empty when the file or the object is missing. */
export function settingsEnv(settingsFile: string): Record<string, unknown> {
  try {
    const parsed = readUserJson(settingsFile);
    const env = (parsed as { env?: unknown } | null)?.env;
    return typeof env === "object" && env !== null && !Array.isArray(env)
      ? (env as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** One switch and where it is set. */
export interface OptOut {
  name: string;
  inEnv: boolean;
  inSettings: boolean;
}

/**
 * The switches in force: none when FORCE_AUTOUPDATE_PLUGINS is set (`forced`), else each
 * blocking variable that is set in `env` or in the settings' `env`, in the list's order.
 */
export function updateOptOuts(
  env: Env,
  fromSettings: Record<string, unknown>,
): { blocking: OptOut[]; forced: boolean } {
  const where = (name: string): OptOut => ({
    inEnv: isSet(env[name]),
    inSettings: isSet(fromSettings[name]),
    name,
  });
  const force = where(FORCE_PLUGIN_UPDATES_VAR);
  if (force.inEnv || force.inSettings) return { blocking: [], forced: true };
  const blocking = UPDATE_BLOCKING_VARS.map(where).filter((v) => v.inEnv || v.inSettings);
  return { blocking, forced: false };
}

/** The first switch that keeps the background update off, or null when updates may run. */
export function blockingVar(env: Env, settingsFile: string): null | string {
  return updateOptOuts(env, settingsEnv(settingsFile)).blocking[0]?.name ?? null;
}
