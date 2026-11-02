import type { CliPaths } from "../cli/paths";
import { RETIRED_TASK_TOOLS, TASK_TOOLS_ALLOW_RULE } from "../tasks/words";
import { applyManagedEntries } from "./managed-entries";

export const TASK_ALLOW_PATH = ["permissions", "allow"] as const;
export const TASK_DENY_PATH = ["permissions", "deny"] as const;

/** Runs under setup's lock, using the same entry ownership as auto-mode rules. */
export function applyTaskPermissions(paths: CliPaths, allow: boolean, dryRun: boolean) {
  const deny = applyManagedEntries({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    path: TASK_DENY_PATH,
    source: "kit-tasks",
    entries: RETIRED_TASK_TOOLS,
    dryRun,
  });
  // Leaving trust out must not withdraw a rule approved on an earlier run.
  const trusted = allow
    ? applyManagedEntries({
        file: paths.settingsFile,
        stateDir: paths.stateDir,
        path: TASK_ALLOW_PATH,
        source: "kit-tasks",
        entries: [TASK_TOOLS_ALLOW_RULE],
        dryRun,
      })
    : null;
  return [deny, ...(trusted === null ? [] : [trusted])];
}
