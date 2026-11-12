/**
 * The background clean (D48): finished worktrees clean themselves.
 *
 * WHY
 *   Worktrees pile up (one project had 73). Claude Code removes a subagent's worktree by
 *   itself only when it holds no change at all, and `worktrees --clean` removes the finished
 *   ones only when someone runs it. So after a merge into the base, and when a session
 *   starts, the hooks start THIS in a detached process (`auto-start.ts`), and it runs the
 *   same safe clean: the scan's verdict (`scan.ts`, `verdict.ts`) is the only judge, and
 *   `cleanWithStrays` (`clean.ts`, over `cleanFinished`) is the only remover. Nothing here judges, and nothing here
 *   forces: a worktree a Claude session works in, a running program or container, uncommitted
 *   changes, local files, a commit not on the base, or a replay that could not answer all
 *   stay.
 *
 * WHAT IT DOES
 *   1. Reads the project's `worktrees.autoClean` again (false: stop).
 *   2. Backs off when git's own lock files are held in the repo (`index.lock`, a ref lock — a
 *      project's after-merge step may hold them): one line in the log, and the next trigger
 *      runs. No sleep, no retry.
 *   3. Takes the machine-wide lock (`holdCleanLock`). Busy: does nothing at all.
 *   4. A session-start run stops here when the last run was under an hour ago (decided again
 *      under the lock, so sessions that start together clean once).
 *   5. Fetches `origin/<base>`, scans, cleans, and records what it removed and kept in the
 *      state folder (`auto-state.ts`) for the next attended session start to say once.
 *   6. Appends one line to the log. An error is that line too; the run never throws.
 *
 * It runs in `src/entries/worktrees-clean.ts`, started with the repo's main checkout.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
import { type CleanLock, cleanWithStrays, holdCleanLock, type KeptWorktree } from "./clean";
import { baseBranch } from "./command";
import { fetchBase, type ScanOptions, scanWorktrees } from "./scan";
import type { StrayPass } from "./scan-parked";

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
  /** Git is writing in the repo right now (a project's own merge step): skipped this round. */
  | "git-busy"
  /** The project turned it off: `worktrees.autoClean` is `false`. */
  | "off"
  /** A session-start run within the hour of the last one. */
  | "recent";

/** The files git itself leaves while it writes: index and ref locks. */
const GIT_LOCKS = ["index.lock", "HEAD.lock", "packed-refs.lock"] as const;

/** A `*.lock` file under `dir` (a ref lock), at any depth, or null. */
function refLockUnder(dir: string, depth = 0): string | null {
  if (depth > 8) return null;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = refLockUnder(join(dir, entry.name), depth + 1);
        if (found !== null) return found;
      } else if (entry.name.endsWith(".lock")) {
        return entry.name;
      }
    }
  } catch {
    // No such folder (a repo with no refs yet), or one this cannot read: no lock seen.
  }
  return null;
}

/**
 * The git lock a repo holds right now, or null: `index.lock`, `HEAD.lock`,
 * `packed-refs.lock`, or a ref lock under `refs/`. A project's own after-merge step (a fetch,
 * a fast-forward, an install) holds these for a moment; the clean must not run git beside it.
 * Read-only: a file's presence is checked with no git call, so no lock is taken.
 */
export function gitLockHeld(gitDir: string): string | null {
  for (const name of GIT_LOCKS) {
    if (existsSync(join(gitDir, name))) return name;
  }
  return refLockUnder(join(gitDir, "refs"));
}

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
  leftovers: StrayPass,
): string {
  const parts = [
    `${repo} (${trigger}): removed ${String(removed.length)}${removed.length === 0 ? "" : ` (${removed.join(", ")})`}`,
  ];
  if (forgotten > 0) parts.push(`forgot ${String(forgotten)}`);
  // Folders a removal moved aside and git no longer lists (D62): removed by what they hold.
  if (leftovers.removed.length > 0) {
    parts.push(
      `finished ${String(leftovers.removed.length)} leftover folder${leftovers.removed.length === 1 ? "" : "s"} (${leftovers.removed.join(", ")})`,
    );
  }
  if (leftovers.kept.length > 0) {
    parts.push(
      `left ${String(leftovers.kept.length)} leftover folder${leftovers.kept.length === 1 ? "" : "s"} (${leftovers.kept.map((one) => `${one.path}: ${one.why}`).join("; ")})`,
    );
  }
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
    // WA1: a project may run its own after-merge step in the main checkout (a fetch, a
    // fast-forward, an install), and it holds git's own lock files while it does. Back off:
    // skip this round with one line, and run at the next trigger — never sleep or retry here.
    // The hourly mark is not written, so the next session start is free to run.
    const held = gitLockHeld(checkout.commonDir);
    if (held !== null) {
      log(`${main} (${trigger}): git is writing here (${held}); skipped this round`);
      return "git-busy";
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
    // The removals, then the folders a removal moved aside that git no longer lists, read
    // before and after and finished by what they hold (`cleanWithStrays`).
    const { report, strays: leftovers } = cleanWithStrays(main, scanned, judged, () => undefined);
    recordRun(files, main, { base, kept: report.kept, now, removed: report.removed });
    log(
      summary(
        main,
        trigger,
        report.removed.map((one) => one.name),
        report.forgotten.length,
        report.failed,
        report.kept.length,
        leftovers,
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
