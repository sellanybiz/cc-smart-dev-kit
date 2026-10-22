/**
 * Whether the plugin's monitors run on this machine right now (L1a.1 proved it): the host arms
 * them as persistent tasks, and it does not when telemetry is off.
 *
 * **Two places, both read.** The environment of the command (`DISABLE_TELEMETRY`,
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), and the `env` of the user's settings file — the
 * same values Claude Code itself reads, so a person who turned them off in their settings gets
 * the same answer as one who exported them in their shell.
 */
import { readUserJson } from "../setup/user-json";

/** The variables that stop the monitors. */
export const TELEMETRY_OFF_VARIABLES = [
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_TELEMETRY",
] as const;

/** True when a value says "off": the words Claude Code reads as off. */
function isOff(value: string): boolean {
  const text = value.trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

/**
 * True when the monitors do not run here: one of the variables is set, in the environment or in
 * the user's settings' `env`. A settings file that cannot be read counts as "they run": the
 * monitors are the better case, and the lead's fallback is one command away.
 */
export function monitorsRunHere(
  env: Record<string, string | undefined>,
  settingsFile: string,
): boolean {
  for (const name of TELEMETRY_OFF_VARIABLES) {
    const value = env[name];
    if (value !== undefined && isOff(value)) return false;
  }
  let settings: unknown;
  try {
    settings = readUserJson(settingsFile);
  } catch {
    // A settings file that cannot be read says nothing: the monitors may well run.
    return true;
  }
  if (typeof settings !== "object" || settings === null) return true;
  const envBlock = (settings as { env?: unknown }).env;
  if (typeof envBlock !== "object" || envBlock === null) return true;
  const values = envBlock as Record<string, unknown>;
  for (const name of TELEMETRY_OFF_VARIABLES) {
    const value = values[name];
    if (typeof value === "string" && isOff(value)) return false;
  }
  return true;
}
