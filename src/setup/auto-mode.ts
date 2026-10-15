import { resolveProject } from "../project/resolve";
import { applyManagedEntries, type ManagedEntriesResult } from "./managed-entries";

/**
 * The auto-mode block. Claude Code's auto mode reads its `autoMode` settings only from
 * the user's settings (and managed settings, and `--settings`), never from a project's
 * `.claude/settings.json`: a repo could otherwise grant itself trust. So a project that
 * wants auto mode to know its rules lists them in its `.claude/anymodel.json`
 * (`autoMode`), and `setup`, run in that project, copies them into the user's
 * `autoMode.environment`, after the person saw them and said yes. The project owns the
 * wording; anymodel only copies it, and owns each copied entry, never the list.
 */

/** Where the entries go in the user's settings.json. */
export const AUTO_MODE_PATH = ["autoMode", "environment"] as const;
/**
 * Put first when setup creates the list. Without it, a list replaces Claude Code's
 * built-in environment entries instead of adding to them (code.claude.com/docs/en/auto-mode-config).
 */
export const AUTO_MODE_DEFAULTS = "$defaults";

export interface AutoModeSource {
  /** The project's main checkout: one source for all its worktrees. */
  source: string;
  entries: string[];
}

/**
 * The project in `dir` and the auto-mode entries it asks for. Null outside git (no
 * project, nothing to copy). A project with no `autoMode` asks for none: the entries
 * setup copied from it before then go.
 */
export function autoModeSource(dir: string): AutoModeSource | null {
  // No git on this machine: no project can be found, so there is nothing to copy.
  if (Bun.which("git") === null) return null;
  const project = resolveProject(dir);
  if (project === null) return null;
  return {
    source: project.mainCheckout ?? project.root,
    entries: project.config?.autoMode ?? [],
  };
}

/** Adds or removes the project's entries (or, with `dryRun`, only says what would change). */
export function applyAutoMode(
  settingsFile: string,
  stateDir: string,
  wanted: AutoModeSource,
  dryRun: boolean,
): ManagedEntriesResult {
  return applyManagedEntries({
    file: settingsFile,
    stateDir,
    path: AUTO_MODE_PATH,
    source: wanted.source,
    entries: wanted.entries,
    anchor: AUTO_MODE_DEFAULTS,
    dryRun,
  });
}
