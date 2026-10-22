/**
 * `worker rm <name|id>`: the end of a finished worker (D35). `end.ts` holds what it shares with
 * `stop` and `resume`; `board.ts` how a worker is found.
 *
 * In order, each step only when the one before it was done, and nothing ever forced:
 *   1. a queued worker (never started) is removed at once: it has nothing to lose;
 *   2. refused while the lead's branch does not hold every commit of the worker's branch (D24:
 *      a worker commits on its branch and never pushes; the lead merges locally), with the count
 *      and where to merge;
 *   3. refused while its worktree holds changes no one committed, or holds a lock a person took
 *      (the refusal shows its reason and the line that releases it) — before anything is
 *      touched, so a refusal costs nothing;
 *   4. its session is stopped when it still runs (the conversation stays on disk). A stop that
 *      fails does not end the command: the verdict below stops the removal if anything still
 *      works in the worktree;
 *   5. Claude Code's own lock on the worktree is released — it locks the worktree of a session it
 *      started and leaves the lock behind (proved live, L1a.1);
 *   6. the kit's own finished-worktree verdict judges the worktree (`src/worktrees/scan.ts`, the
 *      one `worktrees --clean` uses) against the lead's branch, not `origin/<base>`: a worker's
 *      work is merged locally and never pushed. A worktree that is not finished is kept, with the
 *      verdict's reason;
 *   7. the worktree is removed, and its branch by the same rule (only when the lead's ref holds
 *      all of it);
 *   8. last, `claude rm <short id>` — which refuses a worktree that is still there. If it fails,
 *      the record says what is left, and a second run goes straight to this step.
 *
 * A folder git does not list as a worktree is not ours to delete: it is said, and the command
 * stops there. Nothing is called gone that is not.
 */
import { existsSync } from "node:fs";
import { tildify } from "../cli/paths";
import { hasChanges, listWorktrees, runGit, samePath } from "../hooks/git";
import {
  deleteBranchOnRef,
  pruneWorktrees,
  removeWorktree,
  scanWorktrees,
} from "../worktrees/scan";
import { isRefusal } from "./board";
import type { WorkerContext } from "./context";
import {
  actOn,
  CLAUDE_LOCK_PREFIX,
  claudeFailure,
  commitsNotOn,
  failure,
  GIT_TIMEOUT_MS,
  type LeadRef,
  leadRef,
  markState,
  reasonOf,
  refuse,
  relative,
  stopSession,
} from "./end";
import { appendWorkerEvent } from "./store";

/**
 * True when the lead's ref holds every commit of `branch`; null when git cannot say (and why).
 * `worker rm` and the watch ask this; `merge-base --is-ancestor` is git's own answer, and the
 * one a merge commit leaves.
 */
function mergedInto(
  repo: string,
  lead: LeadRef,
  branch: string,
  env: WorkerContext["env"],
): { merged: boolean } | { why: string } {
  const run = runGit(
    repo,
    ["merge-base", "--is-ancestor", `refs/heads/${branch}`, lead.sha],
    env,
    GIT_TIMEOUT_MS,
  );
  if (run.ok) return { merged: true };
  if (run.code === 1) return { merged: false };
  return { why: run.err };
}

/** The line a person reads about a commit count: `1 commit`, `3 commits`. */
function commits(count: number): string {
  return `${String(count)} commit${count === 1 ? "" : "s"}`;
}

/** `worker rm <name|id>`; the exit code. */
export async function runWorkerRm(ref: string, ctx: WorkerContext): Promise<number> {
  const found = actOn(ref, "rm", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  const { repo } = record;
  const home = ctx.paths.home;
  if (record.state === "removed") {
    return refuse(failure(`worker rm: ${record.name} is removed already`), ctx);
  }
  if (record.state === "queued" && record.shortId === null) {
    const stored = await markState(record, "removed", "removed before it started", ctx);
    ctx.print(`removed ${record.name}; it had not started, so nothing else went`);
    return stored ? 0 : 1;
  }

  // 2. The lead's branch decides whether the work is kept (D24).
  const lead = leadRef(record, ctx);
  if ("why" in lead) return refuse(failure(`worker rm: ${lead.why}`), ctx);
  const branchThere = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  ).ok;
  if (branchThere) {
    const merged = mergedInto(repo, lead, record.branch, ctx.env);
    if ("why" in merged) {
      return refuse(
        failure(
          `worker rm: git could not compare ${record.branch} with ${lead.label}: ${merged.why}`,
        ),
        ctx,
      );
    }
    if (!merged.merged) {
      const count = commitsNotOn(repo, lead, record.branch, ctx.env);
      const missing = count === null ? "some commits" : commits(count);
      return refuse(
        failure(
          `worker rm: ${record.branch} has ${missing} that ${lead.label} does not have`,
          `Fix: the lead merges it first (git merge ${record.branch}, in ${lead.folder}), then run worker rm again`,
        ),
        ctx,
      );
    }
  }

  // 3. Work no one committed: refused before any side effect.
  if (existsSync(record.worktree) && hasChanges(record.worktree, ctx.env)) {
    return refuse(
      failure(
        `worker rm: ${tildify(record.worktree, home)} has changes that are not committed (or git cannot read it)`,
        "Fix: commit or discard them there, then run worker rm again; it never forces",
      ),
      ctx,
    );
  }

  // A lock a person took refuses the whole command, before anything is touched. Claude Code's
  // own lock is released below.
  let listed: ReturnType<typeof listWorktrees>[number] | undefined;
  try {
    listed = listWorktrees(repo, ctx.env).find((one) => samePath(one.path, record.worktree));
  } catch (error) {
    return refuse(failure(`worker rm: ${reasonOf(error)}`), ctx);
  }
  const shown = relative(repo, record.worktree);
  const locked = listed?.locked === true;
  if (locked && !(listed?.lockReason ?? "").startsWith(CLAUDE_LOCK_PREFIX)) {
    const why = listed?.lockReason === undefined ? "" : ` (${listed.lockReason})`;
    return refuse(
      failure(
        `worker rm: ${shown} is locked${why}, and not by Claude Code`,
        `Fix: release it yourself if you mean to remove the worker: git worktree unlock ${record.worktree}; worker rm unlocks only Claude Code's own lock`,
      ),
      ctx,
    );
  }

  // 4. Its session goes first, so nothing writes into the worktree while it is judged.
  if (record.shortId !== null && record.state !== "stopped") {
    const stopped = await stopSession(record, ctx);
    if (stopped.ok) {
      ctx.print(
        stopped.gone
          ? `session ${record.shortId} was gone already`
          : `stopped session ${record.shortId}`,
      );
    } else {
      ctx.error(
        `note: ${stopped.why}; going on, the check below stops the removal if anything still works in its worktree`,
      );
    }
  }

  // 5. Claude Code's own lock goes.
  if (listed !== undefined && locked) {
    const unlock = runGit(repo, ["worktree", "unlock", listed.path], ctx.env, GIT_TIMEOUT_MS);
    if (!unlock.ok) {
      return refuse(
        failure(
          `worker rm: ${shown} could not be unlocked: ${unlock.err}`,
          `Fix: git worktree unlock ${record.worktree} by hand, then run worker rm again`,
        ),
        ctx,
      );
    }
    ctx.print(`unlocked ${shown}`);
  }

  // 6. and 7. The kit's own verdict and removal, judged against the lead's branch.
  if (listed !== undefined) {
    let judged: ReturnType<typeof scanWorktrees>[number] | undefined;
    try {
      judged = scanWorktrees(repo, {
        against: { label: lead.label, ref: lead.sha },
        base: lead.label,
        claudeConfigDir: ctx.paths.claudeConfigDir,
        env: ctx.env,
        ...(ctx.scanFacts === undefined ? {} : { facts: ctx.scanFacts }),
        idleLimit: 0,
      }).find((one) => one.state !== "main" && samePath(one.listed.path, record.worktree));
    } catch (error) {
      return refuse(failure(`worker rm: ${reasonOf(error)}`), ctx);
    }
    if (judged === undefined || judged.state === "main") {
      // git lists it and the scan does not: nothing may be called gone that is not.
      return refuse(failure(`worker rm: ${shown} is listed by git but could not be judged`), ctx);
    }
    if (judged.state === "gone") {
      pruneWorktrees(repo, ctx.env);
      ctx.print(`forgot ${shown} (its folder was already gone)`);
    } else {
      if (!judged.state.finished) {
        return refuse(
          failure(
            `worker rm: ${shown} is kept: ${judged.state.why}`,
            "Fix: clear that, then run worker rm again; it never forces",
          ),
          ctx,
        );
      }
      const removal = removeWorktree(repo, judged.listed, {
        against: { label: lead.label, ref: lead.sha },
        base: lead.label,
        claudeConfigDir: ctx.paths.claudeConfigDir,
        deleteBranch: (_repo, branch) =>
          deleteBranchOnRef(repo, lead.sha, lead.label, branch, ctx.env),
        env: ctx.env,
        ...(ctx.scanFacts === undefined ? {} : { facts: ctx.scanFacts }),
        idleLimit: 0,
      });
      for (const said of removal.said) ctx.print(said);
      if (removal.status !== "removed") {
        return refuse(
          failure(
            `worker rm: ${shown} was not removed`,
            "Fix: clear what holds it (the line above says what), then run worker rm again; it never forces",
          ),
          ctx,
        );
      }
    }
  }
  // A folder git does not list is not a worktree, and is not ours to delete: nothing below may
  // call the worktree gone while it is still there (`claude rm` would refuse it too).
  if (existsSync(record.worktree)) {
    return refuse(
      failure(
        `worker rm: ${shown} is still there, and git does not list it as a worktree`,
        "Fix: remove that folder yourself, then run worker rm again; worker rm never deletes what git does not know",
      ),
      ctx,
    );
  }
  // The branch outlives a worktree that was gone or forgotten; it goes by the same rule.
  const branchLeft = (): boolean =>
    runGit(
      repo,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}`],
      ctx.env,
      GIT_TIMEOUT_MS,
    ).ok;
  if (branchLeft()) {
    ctx.print(deleteBranchOnRef(repo, lead.sha, lead.label, record.branch, ctx.env));
  }

  // 8. Last, `claude rm`: it refuses a worktree that is still there.
  if (record.shortId !== null) {
    const rm = claudeFailure(ctx, repo, ["rm", record.shortId]);
    if (rm !== null) {
      // What is left is said as it is: a branch git keeps is not called gone.
      const branchGone = !branchLeft();
      ctx.error(`worker rm: ${rm}`);
      ctx.error(
        `  the worktree is gone already${branchGone ? ", and so is the branch" : ""}; run claude rm ${record.shortId} by hand, then worker rm again`,
      );
      try {
        await appendWorkerEvent(
          ctx.paths.stateDir,
          repo,
          {
            lead: record.leadSessionId,
            name: record.name,
            state: record.state,
            text: `the worktree is gone${branchGone ? " and so is the branch" : ""}; ${rm}`,
            type: "step",
            worker: record.id,
          },
          ctx.now(),
        );
      } catch (error) {
        ctx.error(`worker rm: the store could not record it: ${reasonOf(error)}`);
      }
      return 1;
    }
    ctx.print(`removed session ${record.shortId}`);
  }
  const stored = await markState(record, "removed", "removed", ctx);
  ctx.print(`removed ${record.name}`);
  return stored ? 0 : 1;
}
