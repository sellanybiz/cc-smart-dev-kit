/**
 * The background clean (D48): finished worktrees clean themselves.
 *
 * WHY
 *   Worktrees pile up (one project had 73). Claude Code removes a subagent's worktree by
 *   itself only when it holds no change at all, and `worktrees --clean` removes the finished
 *   ones only when someone runs it. So after a merge into the base, and when a session
 *   starts, the hooks start THIS in a detached process (`auto-start.ts`), and it runs the
 *   same safe clean: the scan's verdict (`scan.ts`, `verdict.ts`) is the only judge, and
 *   `cleanFinished` (`clean.ts`) is the only remover. Nothing here judges, and nothing here
 *   forces: a worktree a Claude session works in, a running program or container, uncommitted
 *   changes, local files, a commit not on the base, or a replay that could not answer all
 *   stay.
 *
 * WHAT IT DOES
 *   1. Reads the project's `worktrees.autoClean` again (false: stop).
 *   2. Takes the machine-wide lock (`holdCleanLock`). Busy: does nothing at all.
 *   3. A session-start run stops here when the last run was under an hour ago (decided again
 *      under the lock, so sessions that start together clean once).
 *   4. Fetches `origin/<base>`, scans, cleans, and records what it removed and kept in the
 *      state folder (`auto-state.ts`) for the next attended session start to say once.
 *   5. Appends one line to the log. An error is that line too; the run never throws.
 *
 * It runs in `src/entries/worktrees-clean.ts`, started with the repo's main checkout.
 */
import type { CliPaths } from "../cli/paths";
import { samePath } from "../hooks/git";
import type { Env } from "../hooks/run";
import { liveSessions, type SessionRecord } from "../hooks/sessions";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { appendLogLine } from "../update/state";
import {
  type AutoCleanTrigger,
  autoCleanFiles,
  autoCleanLog,
  hourlyDue,
  readRepoRecord,
  recordRun,
  recordStart,
} from "./auto-state";
import { type CleanLock, cleanFinished, holdCleanLock, type KeptWorktree } from "./clean";
import { baseBranch } from "./command";
import { fetchBase, type ScanOptions, scanWorktrees } from "./scan";

export interface AutoCleanDeps {
  env: Env;
  /**
   * The folder of the session that started this clean. A worktree it works in stays, even
   * when Claude Code has not written that session's record yet (a resumed session in a
   * finished worktree, say).
   */
  keep?: string;
  /** The machine-wide lock; a test hands in a busy or a free one. */
  hold?: () => Promise<null | CleanLock>;
  /** The machine's facts for the scan; a test hands in fakes, the default reads this machine. */
  facts?: ScanOptions["facts"];
  now: () => number;
  paths: CliPaths;
}

/** How a run ended, for the entry's exit and the tests. */
export type AutoCleanStatus =
  /** The lock was held by another clean: nothing done. */
  | "busy"
  /** It ran (even when it removed nothing). */
  | "cleaned"
  /** It stopped with an error, which is in the log. */
  | "failed"
  /** The project turned it off, or has no usable file. */
  | "off"
  /** A session-start run within the hour of the last one. */
  | "recent";

/** The running sessions, and the one that started this clean when it has no record yet. */
function sessionsToKeep(deps: AutoCleanDeps, claudeConfigDir: string): SessionRecord[] {
  const running = deps.facts?.sessions ?? liveSessions(claudeConfigDir);
  if (deps.keep === undefined) return running;
  return [
    ...running,
    { cwd: deps.keep, name: "the session that started the clean", pid: 0, sessionId: "starting" },
  ];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One line for the log: what the run removed, forgot, failed at and kept. */
function summary(
  repo: string,
  trigger: AutoCleanTrigger,
  removed: string[],
  forgotten: number,
  failed: KeptWorktree[],
  kept: number,
): string {
  const parts = [
    `${repo} (${trigger}): removed ${String(removed.length)}${removed.length === 0 ? "" : ` (${removed.join(", ")})`}`,
  ];
  if (forgotten > 0) parts.push(`forgot ${String(forgotten)}`);
  // A folder moved aside that git could not then remove: the reason says where it is now.
  if (failed.length > 0) {
    parts.push(
      `could not finish removing ${String(failed.length)} (${failed.map((one) => one.why).join("; ")})`,
    );
  }
  parts.push(`kept ${String(kept)}`);
  return parts.join("; ");
}

/**
 * Cleans the finished worktrees of one repo, safely. `repo` is the main checkout the hook
 * names. Never throws: every failure is a line in the log and `failed`.
 */
export async function runAutoClean(
  repo: string,
  trigger: AutoCleanTrigger,
  deps: AutoCleanDeps,
): Promise<AutoCleanStatus> {
  const { env, paths } = deps;
  const log = (line: string) => {
    try {
      appendLogLine(autoCleanLog(paths.stateDir), line, deps.now());
    } catch {
      // The log is for a person's look; a clean never fails over it.
    }
  };
  let lock: null | CleanLock = null;
  try {
    const checkout = locateCheckout(repo, { env });
    if (checkout === null) {
      log(`${repo} (${trigger}): not a git checkout; nothing done`);
      return "failed";
    }
    const project = loadProjectConfig(checkout);
    if (project.config?.worktrees?.autoClean === false) {
      log(`${repo} (${trigger}): worktrees.autoClean is false; nothing done`);
      return "off";
    }
    const main = project.mainCheckout ?? project.root;
    // The scan and the removals run in the main checkout, as `worktrees --clean` does.
    if (!samePath(main, repo)) {
      log(`${repo} (${trigger}): not the main checkout (${main}); nothing done`);
      return "failed";
    }
    const { base } = baseBranch(checkout, env, main);

    lock = await (deps.hold ?? holdCleanLock)();
    // Busy: another clean is removing worktrees right now. Nothing to add.
    if (lock === null) return "busy";

    const files = autoCleanFiles(paths.stateDir, main);
    const now = deps.now();
    if (trigger === "session" && !hourlyDue(readRepoRecord(files), now)) return "recent";
    // The hourly limit counts from here, so a run that dies does not start again at once.
    recordStart(files, main, now);

    if (!fetchBase(main, base, env)) {
      log(`${main} (${trigger}): could not fetch origin/${base}; judging against the copy here`);
    }
    // No `idleLimit`: the hour git must have left a worktree alone, as the command asks.
    const judged: ScanOptions = {
      base,
      claudeConfigDir: paths.claudeConfigDir,
      env,
      now,
      facts: { ...deps.facts, sessions: sessionsToKeep(deps, paths.claudeConfigDir) },
    };
    const scanned = scanWorktrees(main, judged);
    // The lines the command prints are not kept: the report holds what a person needs.
    const report = cleanFinished(main, scanned, judged, () => undefined);
    recordRun(files, main, { base, kept: report.kept, now, removed: report.removed });
    log(
      summary(
        main,
        trigger,
        report.removed.map((one) => one.name),
        report.forgotten.length,
        report.failed,
        report.kept.length,
      ),
    );
    return "cleaned";
  } catch (error) {
    log(`${repo} (${trigger}): error: ${messageOf(error)}`);
    return "failed";
  } finally {
    lock?.close();
  }
}
