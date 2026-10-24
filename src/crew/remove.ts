/**
 * `crew rm <name|id>`: the end of a finished crew session (D35). `end.ts` holds what it shares with
 * `stop` and `resume`; `board.ts` how a crew session is found.
 *
 * In order, each step only when the one before it was done, and nothing ever forced:
 *   1. a queued crew session (never started) is removed at once: it has nothing to lose;
 *   2. refused while the lead's branch does not hold the work of the crew session's branch (D24: a
 *      crew session commits on its branch and never pushes; the lead merges locally): every commit by
 *      ancestry, or a merge that changes nothing (a squash merge). With the count and where to
 *      merge; when git cannot say, the crew session is kept;
 *   3. refused while its worktree holds changes no one committed, or holds a lock a person took
 *      (the refusal shows its reason and the line that releases it) — before anything is
 *      touched, so a refusal costs nothing;
 *   4. its session is stopped when it still runs (the conversation stays on disk). A stop that
 *      fails does not end the command: the verdict below stops the removal if anything still
 *      works in the worktree;
 *   5. Claude Code's own lock on the worktree is released — it locks the worktree of a session it
 *      started and leaves the lock behind (proved live, L1a.1). The lock is what keeps
 *      `worktrees --clean` and the auto-clean off it, so a refusal after this point locks it
 *      again with the same reason, and says so when that cannot be done;
 *   6. the kit's own finished-worktree verdict judges the worktree (`src/worktrees/scan.ts`, the
 *      one `worktrees --clean` uses) against the lead's branch, not `origin/<base>`: a crew session's
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
import { holdCleanLock } from "../worktrees/clean";
import {
  deleteBranchOnRef,
  isParkedWorktree,
  parkedOriginal,
  pruneWorktrees,
  removeWorktree,
  scanWorktrees,
} from "../worktrees/scan";
import { finishParked, finishStrays } from "../worktrees/scan-parked";
import { isRefusal, type Refusal } from "./board";
import type { CrewContext } from "./context";
import { lastLine } from "./display";
import {
  actOn,
  CLAUDE_LOCK_PREFIX,
  claudeFailure,
  commitsNotOn,
  failure,
  findOwnLeftovers,
  GIT_TIMEOUT_MS,
  leadRef,
  markState,
  mergedIntoBase,
  programsWithoutOwn,
  reasonOf,
  refuse,
  relative,
  sessionUnknown,
  stopOwnLeftovers,
  stopSession,
} from "./end";
import { appendCrewEvent, listCrew } from "./store";

/** The line a person reads about a commit count: `1 commit`, `3 commits`. */
function commits(count: number): string {
  return `${String(count)} commit${count === 1 ? "" : "s"}`;
}

/** `crew rm <name|id>`; the exit code. */
export async function runCrewRm(
  ref: string,
  ctx: CrewContext,
  options: { skipParked?: boolean } = {},
): Promise<number> {
  const found = actOn(ref, "rm", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  const { record } = found;
  const { repo } = record;
  const home = ctx.paths.home;
  if (record.state === "removed") {
    return refuse(failure(`crew rm: ${record.name} is removed already`), ctx);
  }
  if (record.state === "queued" && record.shortId === null) {
    const stored = await markState(record, "removed", "removed before it started", ctx);
    ctx.print(`removed ${record.name}; it had not started, so nothing else went`);
    return stored ? 0 : 1;
  }

  // 2. The lead's branch decides whether the work is kept (D24).
  const lead = leadRef(record, ctx);
  if ("why" in lead) return refuse(failure(`crew rm: ${lead.why}`), ctx);
  const mergeStep =
    lead.folder === null
      ? `merge ${record.branch} into ${lead.label}`
      : `git merge ${record.branch}, in ${lead.folder}`;
  const branchThere = runGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${record.branch}`],
    ctx.env,
    GIT_TIMEOUT_MS,
  ).ok;
  if (branchThere) {
    const merged = mergedIntoBase(record, ctx);
    if (merged === "unknown") {
      return refuse(
        failure(
          `crew rm: git could not tell whether the work of ${record.branch} is on ${lead.label} (a conflict, or a git older than 2.38)`,
          `Fix: ${mergeStep} so that it is an ancestor, then run crew rm again`,
        ),
        ctx,
      );
    }
    if (merged === "missing") {
      const count = commitsNotOn(repo, lead, record.branch, ctx.env);
      // 0 commits of its own: the branch is its base, and has nothing to lose. The removal goes on.
      if (count !== 0) {
        const missing = count === null ? "some commits" : commits(count);
        return refuse(
          failure(
            `crew rm: ${record.branch} has ${missing} that ${lead.label} does not have`,
            lead.folder === null
              ? `Fix: the lead must ${mergeStep}, then run crew rm again`
              : `Fix: the lead merges it first (${mergeStep}), then run crew rm again`,
          ),
          ctx,
        );
      }
    }
  }

  // 3. Work no one committed: refused before any side effect.
  if (existsSync(record.worktree) && hasChanges(record.worktree, ctx.env)) {
    return refuse(
      failure(
        `crew rm: ${tildify(record.worktree, home)} has changes that are not committed (or git cannot read it)`,
        "Fix: commit or discard them there, then run crew rm again; it never forces",
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
    return refuse(failure(`crew rm: ${reasonOf(error)}`), ctx);
  }
  const shown = relative(repo, record.worktree);
  const locked = listed?.locked === true;
  if (locked && !(listed?.lockReason ?? "").startsWith(CLAUDE_LOCK_PREFIX)) {
    const why = listed?.lockReason === undefined ? "" : ` (${listed.lockReason})`;
    return refuse(
      failure(
        `crew rm: ${shown} is locked${why}, and not by Claude Code`,
        `Fix: release it yourself if you mean to remove the crew session: git worktree unlock ${record.worktree}; crew rm unlocks only Claude Code's own lock`,
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
  let releasedReason: null | string = null;
  if (listed !== undefined && locked) {
    const unlock = runGit(repo, ["worktree", "unlock", listed.path], ctx.env, GIT_TIMEOUT_MS);
    if (!unlock.ok) {
      return refuse(
        failure(
          `crew rm: ${shown} could not be unlocked: ${unlock.err}`,
          `Fix: git worktree unlock ${record.worktree} by hand, then run crew rm again`,
        ),
        ctx,
      );
    }
    releasedReason = listed.lockReason ?? "";
    ctx.print(`unlocked ${shown}`);
  }

  // The lock is what keeps `worktrees --clean` and the background clean off the worktree. A
  // refusal after it was released must not leave the worktree unlocked: lock it again with the
  // same reason, and say so when that fails. The refusal still stands, and nothing is called gone.
  const refuseKept = (refusal: Refusal): number => {
    if (releasedReason !== null && listed !== undefined) {
      const again = runGit(
        repo,
        ["worktree", "lock", "--reason", releasedReason, listed.path],
        ctx.env,
        GIT_TIMEOUT_MS,
      );
      if (again.ok) {
        ctx.print(`locked ${shown} again, with the same reason`);
      } else {
        ctx.error(
          `note: ${shown} could not be locked again (${lastLine(again.err)}); lock it yourself if you mean to keep it: git worktree lock ${record.worktree}`,
        );
      }
    }
    return refuse(refusal, ctx);
  };

  // 5b. A finished crew session's own leftover programs are not a reason to keep it (D62):
  // the check, the test run its turn left going. Only when every program there is its own —
  // the session is gone or stopped, and each has a readable environment carrying its crew id;
  // an unreadable environment is never proof. One line says what went. A program that is
  // not the session's stays, and the verdict below keeps the worktree with its reason, as before.
  const leftovers = findOwnLeftovers(record, ctx);
  // Judge every other blocker before stopping any owned program.
  const facts = { ...ctx.scanFacts, programs: programsWithoutOwn(leftovers) };

  // 5c. A removal that stopped halfway left a folder at `<path>-removing-<time>` (D62): git
  // lists it there and the record still names the old path, or git lists it no more and half of
  // it stays. Finish them now, under the same safe checks — this record's and any other's — so
  // none is left behind. This record's own, if it stays, refuses the command: the record is about
  // to say removed, and nothing would come back for the folder.
  const finished = options.skipParked
    ? { kept: [], removed: [] }
    : await finishParkedWorktrees(
        repo,
        ctx,
        { label: lead.label, ref: lead.sha },
        (line) => ctx.print(line),
        facts,
      );
  const stuck = finished.kept.find((one) => {
    const original = parkedOriginal(one.path);
    return samePath(one.path, repo) || (original !== null && samePath(original, record.worktree));
  });
  if (stuck !== undefined) {
    return refuseKept(
      failure(
        `crew rm: ${relative(repo, stuck.path)} is kept: ${stuck.why}`,
        "Fix: clear that, then run crew rm again; it never forces",
      ),
    );
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
        ...(facts === undefined ? {} : { facts }),
        idleLimit: 0,
      }).find((one) => one.state !== "main" && samePath(one.listed.path, record.worktree));
    } catch (error) {
      return refuseKept(failure(`crew rm: ${reasonOf(error)}`));
    }
    if (judged === undefined || judged.state === "main") {
      // git lists it and the scan does not: nothing may be called gone that is not.
      return refuseKept(failure(`crew rm: ${shown} is listed by git but could not be judged`));
    }
    if (judged.state === "gone") {
      pruneWorktrees(repo, ctx.env);
      ctx.print(`forgot ${shown} (its folder was already gone)`);
    } else {
      if (!judged.state.finished) {
        return refuseKept(
          failure(
            `crew rm: ${shown} is kept: ${judged.state.why}`,
            "Fix: clear that, then run crew rm again; it never forces",
          ),
        );
      }
      const stopped = await stopOwnLeftovers(record, leftovers, ctx);
      if (stopped.line !== null) ctx.print(stopped.line);
      const removal = removeWorktree(repo, judged.listed, {
        against: { label: lead.label, ref: lead.sha },
        base: lead.label,
        claudeConfigDir: ctx.paths.claudeConfigDir,
        deleteBranch: (_repo, branch) =>
          deleteBranchOnRef(repo, lead.sha, lead.label, branch, ctx.env),
        env: ctx.env,
        ...(facts === undefined ? {} : { facts }),
        idleLimit: 0,
      });
      for (const said of removal.said) ctx.print(said);
      if (removal.status !== "removed") {
        return refuseKept(
          failure(
            `crew rm: ${shown} was not removed`,
            "Fix: clear what holds it (the line above says what), then run crew rm again; it never forces",
          ),
        );
      }
    }
  }
  // A folder git does not list is not a worktree, and is not ours to delete: nothing below may
  // call the worktree gone while it is still there (`claude rm` would refuse it too).
  if (existsSync(record.worktree)) {
    return refuse(
      failure(
        `crew rm: ${shown} is still there, and git does not list it as a worktree`,
        "Fix: remove that folder yourself, then run crew rm again; crew rm never deletes what git does not know",
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
    // A job Claude Code no longer has cannot be removed again: `claude rm` fails on it ("No job
    // matching") however often it runs. When agent view does not list the session at all, it is
    // gone already — the state this step wants — so the record goes too.
    const goneAlready = rm !== null && sessionUnknown(ctx, record);
    if (rm !== null && !goneAlready) {
      // What is left is said as it is: a branch git keeps is not called gone.
      const branchGone = !branchLeft();
      ctx.error(`crew rm: ${rm}`);
      ctx.error(
        `  the worktree is gone already${branchGone ? ", and so is the branch" : ""}; run claude rm ${record.shortId} by hand, then crew rm again`,
      );
      try {
        await appendCrewEvent(
          ctx.paths.stateDir,
          repo,
          {
            lead: record.leadSessionId,
            name: record.name,
            state: record.state,
            text: `the worktree is gone${branchGone ? " and so is the branch" : ""}; ${rm}`,
            type: "step",
            crew: record.id,
          },
          ctx.now(),
        );
      } catch (error) {
        ctx.error(`crew rm: the store could not record it: ${reasonOf(error)}`);
      }
      return 1;
    }
    ctx.print(
      goneAlready
        ? `session ${record.shortId} was gone already`
        : `removed session ${record.shortId}`,
    );
  }
  const stored = await markState(record, "removed", "removed", ctx);
  ctx.print(`removed ${record.name}`);
  return stored ? 0 : 1;
}

/** What a pass over a repository's moved-aside folders came to: the ones that stayed, and why. */
export interface ParkedWorktreesPass {
  kept: Array<{ path: string; why: string }>;
  removed: string[];
}

/**
 * Finishes every removal that stopped halfway in `repo` (D62): the folders a removal moved
 * aside (`<path>-removing-<time>`) and could not then remove. One home for `crew rm` and the
 * lead's watch.
 *
 * Those git still lists are judged against the branch their own crew session was cut from when
 * the store knows it, else against `base` (`origin/<base>`, else the local branch of that name);
 * with no ref at all they stay, because nothing is judged against a guess. Those git no longer
 * lists are judged by what the folder holds (`finishStrays`, `scan-parked.ts`) and need no ref.
 * `facts` replaces the machine's (`ctx.scanFacts`): `crew rm` hands in what is left after it
 * stopped a finished session's own programs. Nothing is said about a folder that stays — the
 * caller reads `kept` — because the next pass judges it again.
 */
export async function finishParkedWorktrees(
  repo: string,
  ctx: CrewContext,
  base: null | { label: string; ref: string },
  say: (line: string) => void,
  facts: CrewContext["scanFacts"] = ctx.scanFacts,
): Promise<ParkedWorktreesPass> {
  const lock = await holdCleanLock();
  if (lock === null)
    return { kept: [{ path: repo, why: "another worktree clean is running" }], removed: [] };
  try {
    const pass: ParkedWorktreesPass = { kept: [], removed: [] };
    const options = {
      claudeConfigDir: ctx.paths.claudeConfigDir,
      env: ctx.env,
      ...(facts === undefined ? {} : { facts }),
      idleLimit: 0,
    };
    let parked: ReturnType<typeof listWorktrees>;
    try {
      parked = listWorktrees(repo, ctx.env).filter((one) => isParkedWorktree(one.path));
    } catch (error) {
      return { kept: [{ path: repo, why: reasonOf(error) }], removed: [] };
    }
    if (parked.length > 0) {
      const records = listCrew(ctx.paths.stateDir, repo).records;
      // One scan per ref: a whole scan is judged against one branch.
      const groups = new Map<string, { label: string; paths: string[]; ref: string }>();
      for (const one of parked) {
        const original = parkedOriginal(one.path) ?? one.path;
        const record = records.find((two) => samePath(two.worktree, original));
        let chosen: null | { label: string; ref: string } = null;
        if (record !== undefined) {
          const lead = leadRef(record, ctx);
          if (!("why" in lead)) chosen = { label: lead.label, ref: lead.sha };
        }
        chosen = chosen ?? base;
        if (chosen === null) continue;
        const group = groups.get(chosen.ref) ?? { label: chosen.label, paths: [], ref: chosen.ref };
        group.paths.push(one.path);
        groups.set(chosen.ref, group);
      }
      for (const group of groups.values()) {
        const done = finishParked(
          repo,
          group.paths,
          { ...options, against: { label: group.label, ref: group.ref }, base: group.label },
          say,
        );
        pass.removed.push(...done.removed);
        pass.kept.push(...done.kept);
      }
    }
    const strays = finishStrays(repo, { ...options, base: base?.label ?? "" }, say);
    pass.removed.push(...strays.removed);
    pass.kept.push(...strays.kept);
    return pass;
  } finally {
    lock.close();
  }
}
