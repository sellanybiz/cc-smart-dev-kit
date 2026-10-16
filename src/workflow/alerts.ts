/**
 * The alerts settings, as a hook reads them — and the one place that says how a hook reads
 * them at all.
 *
 * The `notify` and `stop-failure` hooks run on many events, and a bug in one must never get
 * in the way of the person's work. So this reader:
 *
 * - **reads once per hook run**, not once per event: one call, the answer handed around;
 * - **never throws**: a project's `cc-smart-dev-kit.json` it cannot read, or a broken personal
 *   `workflow.json`, falls back to the built-in defaults — today's behaviour — and returns
 *   one short line for stderr saying why (`problem`);
 * - resolves the same way everything else does: the project's `workflow.alerts` over the
 *   person's `~/.config/cc-smart-dev-kit/workflow.json` over the built-in default
 *   (`resolveAlerts`).
 */
import type { CliPaths } from "../cli/paths";
import { type CcSmartDevKitConfig, CcSmartDevKitConfigError } from "../project/config";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { defaultAlerts, type ResolvedWorkflow, resolveAlerts } from "./resolve";

type Env = Record<string, string | undefined>;

/** The three alert settings, each with where its value came from. */
export type ResolvedAlerts = ResolvedWorkflow["alerts"];

export interface AlertsHere {
  alerts: ResolvedAlerts;
  /** One stderr line when a file could not be used, and the defaults decided; null when all read. */
  problem: string | null;
}

/** The line a hook writes when a file it needed could not be used. */
function fallbackLine(problems: string[]): string {
  return `cc-smart-dev-kit: the alerts fall back to the built-in defaults (${problems.join("; ")})`;
}

/**
 * The alert settings where `cwd` runs: the project of that folder, if it has one and its
 * file can be read, over the person's own defaults. Never throws. `cwd` null: no folder to
 * resolve from (a hook input that names none).
 */
export function alertsAt(paths: CliPaths, cwd: null | string, env: Env): AlertsHere {
  const problems: string[] = [];
  let project: CcSmartDevKitConfig | null = null;
  if (cwd !== null) {
    try {
      const checkout = locateCheckout(cwd, { env });
      if (checkout !== null) project = loadProjectConfig(checkout).config;
    } catch (error) {
      // A project file that cannot be used (broken, or needing a newer plugin) is worth a
      // line: the person must hear it. A folder that is not in git, or one git too old to
      // read, is simply no project — as silent as it is for every other hook.
      if (error instanceof CcSmartDevKitConfigError) problems.push(error.message);
    }
  }
  try {
    const alerts = resolveAlerts(paths, project);
    return { alerts, problem: problems.length === 0 ? null : fallbackLine(problems) };
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    return { alerts: defaultAlerts(), problem: fallbackLine(problems) };
  }
}
