/**
 * The Serena context cc-smart-dev-kit starts Serena with, and where it is installed.
 *
 * WHY IT EXISTS
 *   Serena starts with `--project-from-cwd`, so its project is the folder the Claude session
 *   STARTED in. Serena's own `claude-code` context sets `single_project: true`, which hides
 *   `activate_project`: Serena could never follow a session that moves into a worktree, and
 *   its searches and edits would stay on the folder the session started in. The plugin ships
 *   that context with `single_project: false`, so `activate_project` is listed and a session
 *   can point Serena at its worktree (upstream: github.com/oraios/serena issue #1109 —
 *   `--project-from-cwd` only resolves at startup).
 *
 * WHERE IT IS INSTALLED
 *   A copy in the plugin's data folder (`<dataDir>/serena/contexts/worktree.yml`), never a
 *   path inside the plugin's version folder: Claude Code deletes an old version folder after
 *   an update, and a Serena registered with a context file that is gone does not start at
 *   all. The copy is a file cc-smart-dev-kit owns whole, so `restore` removes it
 *   (`writeManagedFile` / `removeManagedFile`).
 *
 * MOVING THE SERENA PIN
 *   Serena's own `claude-code.yml` at the pinned commit is the source of this file. After a
 *   pin change: diff the two, carry the changes over, and keep `single_project: false`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { removeManagedFile, writeManagedFile } from "../setup/write";

/** The file, inside the plugin, that holds the context (`plugin/serena/contexts/worktree.yml`). */
export const SERENA_CONTEXT_NAME = "worktree.yml";

/**
 * The plugin's `serena/` folder, found from the folder of the bundle that runs
 * (`import.meta.dir`): `plugin/serena` beside `dist/` on an installed machine, the repo's
 * `plugin/serena` when the bundle runs from `src/entries/`.
 */
export function serenaFolder(bundleDir: string): string {
  const beside = join(bundleDir, "..", "serena");
  return existsSync(beside) ? beside : join(bundleDir, "..", "..", "plugin", "serena");
}

/** The context file shipped with the plugin, from its folder. */
export function serenaContextSource(serena: string): string {
  return join(serena, "contexts", SERENA_CONTEXT_NAME);
}

export interface SerenaInstall {
  /** `+` created, `~` updated, `unchanged` nothing to do, `missing` the plugin has no context file. */
  outcome: "created" | "missing" | "unchanged" | "updated";
  file: string;
}

/**
 * Puts the plugin's context at `target` when it differs. Writes that ONE file, through the
 * managed whole-file path (backup, record, atomic write), and touches nothing else.
 * `dryRun` only reports.
 */
export function installSerenaContext(
  source: string,
  target: string,
  stateDir: string,
  dryRun: boolean,
): SerenaInstall {
  if (!existsSync(source)) return { outcome: "missing", file: target };
  const wanted = readFileSync(source, "utf8");
  const result = writeManagedFile(target, wanted, {
    dryRun,
    kind: "whole-file",
    newFileMode: 0o644,
    stateDir,
  });
  return { outcome: result.outcome, file: target };
}

/** Is the installed copy the plugin's current one? */
export function serenaContextCurrent(source: string, target: string): boolean {
  if (!existsSync(source) || !existsSync(target)) return false;
  return readFileSync(source, "utf8") === readFileSync(target, "utf8");
}

/**
 * Takes the installed copy out — only when it is the plugin's (a file the person edited is
 * theirs and stays). Returns the line to print, or null when there was nothing to do.
 */
export function removeSerenaContext(
  source: string,
  target: string,
  stateDir: string,
  dryRun: boolean,
): null | { file: string; kept: boolean } {
  if (!existsSync(target)) return null;
  if (!serenaContextCurrent(source, target)) return { file: target, kept: true };
  if (!dryRun) removeManagedFile(stateDir, target);
  return { file: target, kept: false };
}

/** Where the installed context lives, for a caller that wants the path. */
export function serenaContextTarget(paths: CliPaths): string {
  return paths.serenaContextFile;
}
