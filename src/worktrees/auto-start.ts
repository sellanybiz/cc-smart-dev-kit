/**
 * The hooks' part of the background clean (D48): decide whether to start it, start it, and
 * say what an earlier run removed. The clean itself is `auto-clean.ts`.
 *
 * Two hooks start it, each with ONE call (`startAutoClean`):
 *   - `after-merge`: a pull request merged into the base (`trigger` "merge");
 *   - `worktree-leftovers`: a session starts (`trigger` "session"), at most once an hour per
 *     repo and never in `claude -p`, where nobody would be told.
 * `worktrees.autoClean: false` in the project's file stops both.
 *
 * A hook must return at once (`.claude/rules/hooks.md` § Timeouts), so this does no git, no
 * scan and no wait: it reads one small state file, and starts the clean as a detached process
 * (`startDetached`, the way the self-update starts its check). Everything slow, every error
 * and every decision about what may go happens in that process, which logs to its own file.
 */
import { basename, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { isAttended } from "../hooks/attended";
import { startDetached } from "../hooks/detached";
import type { HookContext } from "../hooks/run";
import { gitEnv } from "../project/git-env";
import { bunConfigArg, pluginFolderBeside } from "../setup/bun-config";
import {
  type AutoCleanTrigger,
  autoCleanFiles,
  hourlyDue,
  markTold,
  readRepoRecord,
  readTold,
  toldLine,
  untold,
} from "./auto-state";

/** The bundle the detached process runs, beside the hook's own bundle (`src/entries/worktrees-clean.ts`). */
export const AUTO_CLEAN_BUNDLE = "worktrees-clean";

/** Is the clean on for this project? It is, unless `worktrees.autoClean` says `false`. */
export function autoCleanOn(context: Pick<HookContext, "project">): boolean {
  return context.project.config?.worktrees?.autoClean !== false;
}

/**
 * The file the detached process runs: the built bundle beside the running one, or the entry's
 * source when the code runs from source (a test, or `bun src/entries/<hook>.ts`). In a bundle
 * `import.meta.dir` is the `dist/` folder, from source it is this folder.
 */
export function autoCleanEntry(importDir: string): string {
  return basename(importDir) === "dist"
    ? join(importDir, `${AUTO_CLEAN_BUNDLE}.js`)
    : join(importDir, "..", "entries", `${AUTO_CLEAN_BUNDLE}.ts`);
}

/**
 * The detached process's command line: this bun and the clean's bundle with the two flags
 * every run of the plugin's own bundles gets (`src/setup/bun-config.ts`), the repo's main
 * checkout, why it runs, and the folder of the session that started it (the worktree that
 * session works in stays).
 */
export function autoCleanArgv(
  bun: string,
  entry: string,
  pluginDir: string,
  repo: string,
  trigger: AutoCleanTrigger,
  keep: string,
): string[] {
  return [bun, "--no-env-file", bunConfigArg(pluginDir), entry, repo, trigger, keep];
}

/**
 * Starts the background clean for `repo` (its main checkout) when the project, the session
 * and the hour allow it. Returns whether it asked for a start; the clean itself decides again
 * under the machine-wide lock (the hour included), so sessions that start together clean once.
 */
export function startAutoClean(
  context: HookContext,
  repo: string,
  trigger: AutoCleanTrigger,
  importDir: string = import.meta.dir,
): boolean {
  if (!autoCleanOn(context)) return false;
  if (trigger === "session") {
    // `claude -p` runs hooks with nobody to tell, and a short-lived run may be cut off.
    if (!isAttended(context.env)) return false;
    const record = readRepoRecord(autoCleanFiles(context.paths.stateDir, repo));
    if (!hourlyDue(record, Date.now())) return false;
  }
  const argv = autoCleanArgv(
    process.execPath,
    autoCleanEntry(importDir),
    pluginFolderBeside(importDir),
    repo,
    trigger,
    context.cwd,
  );
  // In the home folder, without the git variables of the session's repo: the process names
  // the repo itself. Its stdio is closed, so nothing keeps Claude Code waiting.
  const env = gitEnv(context.env);
  (context.start ?? startDetached)(process.platform, argv, {
    cwd: context.paths.home,
    env,
    onError: (message) => console.error(`${COMMAND} worktrees clean: ${message}`),
  });
  return true;
}

/**
 * The one line a person sees about what a background clean removed since they were last told,
 * or null: only for an attended session, and only for removals not told yet. Marks them told
 * (`markTold`), so the next start of this repo says nothing. A `claude -p` session neither
 * shows nor marks it, so the next interactive one does.
 */
export function takeToldLine(context: HookContext, repo: string): string | null {
  if (!isAttended(context.env)) return null;
  const files = autoCleanFiles(context.paths.stateDir, repo);
  const record = untold(readRepoRecord(files), readTold(files));
  if (record === null) return null;
  try {
    markTold(files, record.seq);
  } catch (error) {
    // Cannot mark it: say nothing now rather than the same line at every start.
    console.error(
      `${COMMAND} worktrees clean: could not mark the removals as told: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  return toldLine(record);
}
