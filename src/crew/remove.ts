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
 *   8. then `claude rm <short id>` — which refuses a worktree that is still there. If it fails,
 *      the record says what is left, and a second run goes straight to this step;
 *   9. last, once `claude rm` let the session go, the record notes when its session ended
 *      (`sessionEndedAt`, kept from a release before): its conversation stays in `/resume` and
 *      leaves on the timeline (`archive.ts`, AR1, D69).
 *
 * A release (D69, `release.ts`) runs the same steps with `release`: judged against the record's
 * own branch, so no merge is needed, and it keeps that branch and the record's state. It marks the
 * record `released` as soon as the worktree is gone, before `claude rm`, so a `claude rm` that fails
 * leaves a record a resume can make the worktree again for, and the watch runs it again. A
 * discard of a released crew session makes its worktree again first.
 *
 * A folder git does not list as a worktree is not ours to delete: it is said, and the command
 * stops there. Nothing is called gone that is not.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tildify } from "../cli/paths";
import { hasChanges, isInside, listWorktrees, runGit, samePath } from "../hooks/git";
import { localFiles } from "../hooks/local-files";
import { LockBusyError, withLock } from "../setup/lock";
import { holdCleanLock } from "../worktrees/clean";
import { copyWorktreeInclude } from "../worktrees/include";
import { containersUsing, mountKeptWhy, programsInside } from "../worktrees/machine-facts";
import {
  deleteBranchOnRef,
  isParkedWorktree,
  machineFactsOf,
  parkedOriginal,
  pruneWorktrees,
  removeWorktree,
  scanWorktrees,
  workOnRef,
} from "../worktrees/scan";
import { finishParked, finishStrays } from "../worktrees/scan-parked";
import { containersWhy, programsWhy } from "../worktrees/verdict";
import { agentRows, rowOf } from "./agents";
import { isRefusal, type Refusal } from "./board";
import type { CrewContext } from "./context";
import {
  archiveCrewDiscard,
  buildCrewDiscardFacts,
  type CrewDiscardFacts,
  completeCrewDiscard,
  pendingDiscardWhy,
  rollbackCrewDiscard,
} from "./discard";
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
import { RELEASE_STATES, validMergeProof } from "./lifecycle";
import {
  appendCrewEvent,
  type CrewRecord,
  crewFilesDir,
  crewSessions,
  listCrew,
  resumeClaimHeld,
  updateCrew,
} from "./store";

/** The line a person reads about a commit count: `1 commit`, `3 commits`. */
function commits(count: number): string {
  return `${String(count)} commit${count === 1 ? "" : "s"}`;
}

/** Discard preflight is repeated after confirmation; unknown machine facts always keep the work. */
function discardBlocker(record: CrewRecord, ctx: CrewContext): string | null {
  try {
    const all = listWorktrees(record.repo, ctx.env);
    const listed = all.find((one) => samePath(one.path, record.worktree));
    if (listed === undefined || samePath(record.worktree, record.repo))
      return "its worktree is not one git lists apart from the main checkout";
    if (
      all.some((one) => !samePath(one.path, record.worktree) && isInside(one.path, record.worktree))
    )
      return "another worktree lives inside it";
    if (listed.locked && !(listed.lockReason ?? "").startsWith(CLAUDE_LOCK_PREFIX))
      return "the worktree has a person's lock";
    const machine = machineFactsOf({
      base: "",
      claudeConfigDir: ctx.paths.claudeConfigDir,
      env: ctx.env,
      ...(ctx.scanFacts === undefined ? {} : { facts: ctx.scanFacts }),
    });
    const mount = mountKeptWhy(record.worktree, machine.mounts);
    if (mount !== null) return mount;
    const leftoverPrograms = programsWithoutOwn(findOwnLeftovers(record, ctx));
    const row = agentRows(ctx);
    const session = row === null ? null : rowOf(row, record);
    const terminalSessionPid =
      session !== null &&
      session.pid !== null &&
      session.state !== null &&
      ["done", "failed", "stopped"].includes(session.state)
        ? session.pid
        : null;
    const programs =
      leftoverPrograms === "unknown" || terminalSessionPid === null
        ? leftoverPrograms
        : leftoverPrograms.filter((program) => program.pid !== terminalSessionPid);
    if (programs === "unknown")
      return "running programs could not be listed; nothing archived or removed";
    const names = programsInside(programs, record.worktree, undefined, ctx.pid);
    if (names.length > 0) return programsWhy(names);
    if (machine.containers === "unknown")
      return "Docker did not answer; nothing archived or removed";
    const containers = containersUsing(record.worktree, machine.containers);
    return containers.length > 0 ? containersWhy(containers) : null;
  } catch (error) {
    return reasonOf(error);
  }
}

/** What `crew rm` may be given besides the crew session. */
interface CrewRmOptions {
  /** Internal release: judge against its own branch, keep that branch and the conversation. */
  release?: boolean;
  skipParked?: boolean;
  against?: { label: string; ref: string };
  discard?: boolean;
  yes?: boolean;
  expectedDiscardToken?: string;
  /** Called only by the interactive command; automated callers cannot prompt. */
  confirm?: (question: string) => boolean;
}

/**
 * The folder whose lock one crew session's removal holds (RX1): beside its other files, so it goes
 * with them. A person's `crew rm` and the lead's watch both remove a record, and a discard changes
 * the worktree under the watch's feet (its signature moves, so the watch tries again): without the
 * lock the second run finds `discardPending`, takes the first run's work for a crash and rolls it
 * back under the person's process.
 */
export function crewRemovalLockDir(stateDir: string, repo: string, id: string): string {
  return join(crewFilesDir(stateDir, repo, id), "removal");
}

/** A released worktree made again, or why not: the record as stored after it. */
export type RemakeResult =
  | { ok: true; remade: boolean; record: CrewRecord }
  | { ok: false; why: string };

/**
 * Makes a worktree the kit released (D69) again, at its own path on its kept branch, and clears
 * `released`; with `include`, the `.worktreeinclude` files are copied in too (a resume needs them,
 * a discard does not). The caller holds the record's removal lock (`crewRemovalLockDir`), so a
 * release never crosses it. All or nothing: when the copy or the store write fails, the folder it
 * just made goes again. A folder already at that path is never replaced. A record that is not
 * released comes back as it is.
 */
export async function remakeReleasedWorktree(
  record: CrewRecord,
  ctx: CrewContext,
  options: { include: boolean },
): Promise<RemakeResult> {
  if (record.released === undefined) return { ok: true, remade: false, record };
  if (existsSync(record.worktree))
    return { ok: false, why: `${record.worktree} exists already; inspect it first` };
  const added = runGit(
    record.repo,
    ["worktree", "add", record.worktree, record.branch],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!added.ok) return { ok: false, why: `worktree could not be made again: ${added.err}` };
  try {
    if (options.include) copyWorktreeInclude(record.repo, record.worktree, ctx.env);
    const stored = await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { released: undefined },
      ctx.now(),
    );
    return { ok: true, remade: true, record: stored };
  } catch (error) {
    // Nothing but this command wrote into the folder it made a moment ago: it goes whole.
    const undone = runGit(
      record.repo,
      ["worktree", "remove", "--force", record.worktree],
      ctx.env,
      GIT_TIMEOUT_MS,
    );
    return {
      ok: false,
      why: `the worktree's files or the store could not be written (${reasonOf(error)}); ${
        undone.ok
          ? "the worktree was taken back"
          : `remove ${record.worktree} by hand: ${undone.err.trim()}`
      }`,
    };
  }
}

/**
 * `crew rm <name|id>`; the exit code. One removal of a crew session runs at a time: a second one
 * (the watch's after the person's, or two of the person's) refuses at once and changes nothing.
 * A removal that crashed leaves no lock behind (`withLock` judges its holder), so a later run
 * recovers it as before.
 */
export async function runCrewRm(
  ref: string,
  ctx: CrewContext,
  options: CrewRmOptions = {},
): Promise<number> {
  const first = actOn(ref, "rm", ctx);
  if (isRefusal(first)) return refuse(first, ctx);
  const dir = crewRemovalLockDir(ctx.paths.stateDir, first.record.repo, first.record.id);
  let entered = false;
  try {
    mkdirSync(dir, { mode: 0o700, recursive: true });
    return await withLock(
      dir,
      async () => {
        entered = true;
        return await removeCrewSession(ref, ctx, options);
      },
      { waitMs: 0 },
    );
  } catch (error) {
    // Only the lock being held is "busy": a LockBusyError from inside the removal is its own.
    if (error instanceof LockBusyError && !entered) {
      return refuse(
        options.release === true
          ? failure(
              `crew rm: ${first.record.name} is being removed or resumed by another run`,
              "Fix: nothing to do; the watch tries the release again by itself",
            )
          : failure(
              `crew rm: ${first.record.name} is being removed by another run; wait for it to end, then run crew rm again if it is still there`,
            ),
        ctx,
      );
    }
    throw error;
  }
}

/** The removal itself; the caller holds the record's removal lock. */
async function removeCrewSession(
  ref: string,
  ctx: CrewContext,
  options: CrewRmOptions,
): Promise<number> {
  const found = actOn(ref, "rm", ctx);
  if (isRefusal(found)) return refuse(found, ctx);
  let { record } = found;
  const release = options.release === true;
  // How a fix line ends: the watch tries a release again by itself (D69); a removal is run again.
  const then = release ? "; the watch then releases it by itself" : ", then run crew rm again";
  // Released already (its worktree went, a `claude rm` after it did not): the steps below find no
  // worktree and go straight to `claude rm` again.
  const releasedBefore = record.released !== undefined;
  if (release) {
    if (!RELEASE_STATES.includes(record.state))
      return refuse(failure(`crew rm: ${record.name} is not over or stopped`), ctx);
    if (record.discardPending !== undefined)
      return refuse(failure(`crew rm: ${pendingDiscardWhy(record)}`), ctx);
    if (resumeClaimHeld(record.resumeClaim, ctx.now()))
      return refuse(
        failure(
          `crew rm: a resume of ${record.name} is starting`,
          "Fix: nothing to do; the watch tries the release again once the resume is over",
        ),
        ctx,
      );
  }
  if (record.discardPending !== undefined) {
    try {
      record = await rollbackCrewDiscard(record, ctx);
    } catch (error) {
      return refuse(failure(`crew rm: ${pendingDiscardWhy(record)} (${reasonOf(error)})`), ctx);
    }
  }
  const { repo } = record;
  const home = ctx.paths.home;
  const discard = options.discard === true;
  let preview: CrewDiscardFacts | undefined;
  if (["removed", "discarded"].includes(record.state)) {
    return refuse(failure(`crew rm: ${record.name} is removed already`), ctx);
  }
  if (record.state === "queued" && record.shortId === null) {
    const stored = await markState(record, "removed", "removed before it started", ctx);
    ctx.print(`removed ${record.name}; it had not started, so nothing else went`);
    return stored ? 0 : 1;
  }
  // A released crew session (D69) has no worktree to discard from: it is made again on its kept
  // branch first, under this same lock, so the discard below shows and archives what it always does.
  if (discard && record.released !== undefined) {
    const remade = await remakeReleasedWorktree(record, ctx, { include: false });
    if (!remade.ok) return refuse(failure(`crew rm: ${remade.why}`), ctx);
    record = remade.record;
    ctx.print(`made ${relative(repo, record.worktree)} again on ${record.branch}, to discard it`);
  }

  // 2. The lead's branch decides whether the work is kept (D24). A durable proof holds
  // the immutable lead commit that received exactly this head, even if that branch is gone.
  const proof =
    options.against === undefined && !discard && validMergeProof(record, ctx)
      ? record.mergeProof
      : undefined;
  const lead =
    options.against !== undefined
      ? { folder: null, label: options.against.label, sha: options.against.ref }
      : discard
        ? { folder: null, label: "discard archive", sha: record.archive?.head ?? "HEAD" }
        : proof === undefined
          ? leadRef(record, ctx)
          : { folder: null, label: proof.leadRef, sha: proof.leadCommit };
  if ("why" in lead) return refuse(failure(`crew rm: ${lead.why}`), ctx);
  let removalBase = { label: lead.label, ref: lead.sha };
  const discardRollbackBase = removalBase;
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
  if (branchThere && proof === undefined && !discard) {
    const merged =
      options.against === undefined
        ? mergedIntoBase(record, ctx)
        : workOnRef(repo, removalBase.ref, `refs/heads/${record.branch}`, ctx.env);
    const legacy =
      record.state === "merged" && record.mergeProof === undefined
        ? "merged earlier, but no exact-head proof was recorded; its lead's branch may have been rewritten since. Confirm the work with the lead and merge it again, or use explicit recoverable crew rm --discard"
        : null;
    if (merged === "unknown") {
      return refuse(
        failure(
          `crew rm: ${legacy ?? `git could not tell whether the work of ${record.branch} is on ${lead.label} (a conflict, or a git older than 2.38)`}`,
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
            `crew rm: ${legacy ?? `${record.branch} has ${missing} that ${lead.label} does not have`}`,
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
  if (!discard && existsSync(record.worktree) && hasChanges(record.worktree, ctx.env)) {
    return refuse(
      failure(
        `crew rm: ${tildify(record.worktree, home)} has changes that are not committed (or git cannot read it)`,
        `Fix: commit or discard them there${then}; it never forces`,
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
        `Fix: release it yourself if you mean to remove the crew session: git worktree unlock ${record.worktree}; crew rm unlocks only Claude Code's own lock${release ? then : ""}`,
      ),
      ctx,
    );
  }

  // Discard never bypasses a person's programs or containers. Check these BEFORE stopping,
  // unlocking, changing the index or writing an archive. The ordinary verdict is still run below.
  if (discard && existsSync(record.worktree)) {
    if (listed === undefined)
      return refuse(
        failure("crew rm: discard needs its registered worktree; nothing archived or removed"),
        ctx,
      );
    const blocker = discardBlocker(record, ctx);
    if (blocker !== null) return refuse(failure(`crew rm: ${blocker}`), ctx);
    try {
      preview = buildCrewDiscardFacts(record, ctx);
      if (
        record.archive !== undefined &&
        (preview.head !== record.archive.head ||
          preview.changedFiles.length > 0 ||
          preview.ignoredFiles.length > 0)
      )
        return refuse(
          failure(
            "crew rm: work changed after its archive was made; keep this worktree and recover the existing archive before discarding again",
          ),
          ctx,
        );
      for (const line of preview.lines) ctx.print(line);
      if (
        options.expectedDiscardToken !== undefined &&
        options.expectedDiscardToken !== preview.token
      )
        return refuse(
          failure(
            "crew rm: the work changed since the discard preview; preview and confirm it again",
          ),
          ctx,
        );
      if (!options.yes && (options.confirm === undefined || !options.confirm(preview.question))) {
        ctx.print(
          "Nothing removed. Use crew rm <name|id> --discard --yes to confirm without a terminal.",
        );
        return 1;
      }
      if (buildCrewDiscardFacts(record, ctx).token !== preview.token)
        return refuse(
          failure("crew rm: the work changed since confirmation; preview and confirm it again"),
          ctx,
        );
    } catch (error) {
      return refuse(failure(`crew rm: ${reasonOf(error)}`), ctx);
    }
  }

  if (release && existsSync(record.worktree)) {
    const blocker = discardBlocker(record, ctx);
    const local = blocker === null ? localFiles(record.worktree, record.repo, ctx.env) : [];
    if (blocker !== null || local === null || local.length > 0) {
      return refuse(
        blocker !== null || local === null
          ? failure(
              `crew rm: ${blocker ?? "git could not list the files it does not keep"}`,
              `Fix: clear that${then}`,
            )
          : failure(
              `crew rm: local files git does not keep: ${local.join(", ")}`,
              `Fix: commit them on ${record.branch}, or move them out of ${tildify(record.worktree, home)}${then}`,
            ),
        ctx,
      );
    }
  }

  // 4. Its session goes first, so nothing writes into the worktree while it is judged.
  if (record.shortId !== null && (record.state !== "stopped" || release)) {
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

  if (discard) {
    try {
      if (preview !== undefined && record.archive === undefined) {
        const blocker = discardBlocker(record, ctx);
        if (blocker !== null) return refuse(failure(`crew rm: ${blocker}`), ctx);
        if (buildCrewDiscardFacts(record, ctx).token !== preview.token)
          return refuse(
            failure("crew rm: the work changed since confirmation; preview and confirm it again"),
            ctx,
          );
        const own = findOwnLeftovers(record, ctx);
        const stopped = await stopOwnLeftovers(record, own, ctx);
        if (stopped.line !== null) ctx.print(stopped.line);
        record = await archiveCrewDiscard(record, preview, ctx);
      }
      if (record.archive === undefined)
        return refuse(failure("crew rm: discard has no saved archive"), ctx);
      const archive = runGit(
        repo,
        ["rev-parse", "--verify", record.archive.ref],
        ctx.env,
        GIT_TIMEOUT_MS,
      );
      if (!archive.ok || archive.out !== record.archive.head)
        return refuse(
          failure("crew rm: saved discard archive is missing or changed; nothing removed"),
          ctx,
        );
      if (preview === undefined && branchThere)
        return refuse(
          failure(
            "crew rm: worktree is gone but its branch remains; inspect the saved archive before retrying",
          ),
          ctx,
        );
      removalBase = { label: record.archive.ref, ref: record.archive.head };
      ctx.print(`archived ${record.name} at ${record.archive.ref}`);
    } catch (error) {
      return refuse(failure(`crew rm: ${reasonOf(error)}`), ctx);
    }
  }

  // 5. Claude Code's own lock goes.
  let releasedReason: null | string = null;
  if (listed !== undefined && locked) {
    const unlock = runGit(repo, ["worktree", "unlock", listed.path], ctx.env, GIT_TIMEOUT_MS);
    if (!unlock.ok) {
      if (record.discardPending !== undefined) {
        try {
          record = await rollbackCrewDiscard(record, ctx);
          removalBase = discardRollbackBase;
        } catch (error) {
          ctx.error(`crew rm: ${pendingDiscardWhy(record)} (${reasonOf(error)})`);
        }
      }
      return refuse(
        failure(
          `crew rm: ${shown} could not be unlocked: ${unlock.err}`,
          `Fix: git worktree unlock ${record.worktree} by hand${then}`,
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
  const refuseKept = async (refusal: Refusal): Promise<number> => {
    if (record.discardPending !== undefined) {
      try {
        record = await rollbackCrewDiscard(record, ctx);
        removalBase = discardRollbackBase;
      } catch (error) {
        ctx.error(`crew rm: ${pendingDiscardWhy(record)} (${reasonOf(error)})`);
      }
    }
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
  // A terminal agent row may still expose its own lingering process. Exclude only that exact PID;
  // every other program, including descendants, remains a blocker.
  const rows = discard ? agentRows(ctx) : null;
  const session = rows === null ? null : rowOf(rows, record);
  const terminalSessionPid =
    session !== null &&
    session.pid !== null &&
    session.state !== null &&
    ["done", "failed", "stopped"].includes(session.state)
      ? session.pid
      : null;
  const programs = programsWithoutOwn(leftovers);
  const judgedPrograms =
    discard && programs !== "unknown" && terminalSessionPid !== null
      ? programs.filter((program) => program.pid !== terminalSessionPid)
      : programs;
  // Judge every other blocker before stopping any owned program.
  const facts = { ...ctx.scanFacts, programs: judgedPrograms };

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
        discard ? null : { label: lead.label, ref: lead.sha },
        (line) => ctx.print(line),
        facts,
      );
  const stuck = finished.kept.find((one) => {
    const original = parkedOriginal(one.path);
    return samePath(one.path, repo) || (original !== null && samePath(original, record.worktree));
  });
  if (stuck !== undefined) {
    return await refuseKept(
      failure(
        `crew rm: ${relative(repo, stuck.path)} is kept: ${stuck.why}`,
        `Fix: clear that${then}; it never forces`,
      ),
    );
  }

  // 6. and 7. The kit's own verdict and removal, judged against the lead's branch.
  if (listed !== undefined) {
    let judged: ReturnType<typeof scanWorktrees>[number] | undefined;
    try {
      judged = scanWorktrees(repo, {
        against: removalBase,
        base: lead.label,
        claudeConfigDir: ctx.paths.claudeConfigDir,
        env: ctx.env,
        ...(facts === undefined ? {} : { facts }),
        idleLimit: 0,
      }).find((one) => one.state !== "main" && samePath(one.listed.path, record.worktree));
    } catch (error) {
      return await refuseKept(failure(`crew rm: ${reasonOf(error)}`));
    }
    if (judged === undefined || judged.state === "main") {
      // git lists it and the scan does not: nothing may be called gone that is not.
      return await refuseKept(
        failure(`crew rm: ${shown} is listed by git but could not be judged`),
      );
    }
    if (judged.state === "gone") {
      pruneWorktrees(repo, ctx.env);
      ctx.print(`forgot ${shown} (its folder was already gone)`);
    } else {
      if (!judged.state.finished) {
        return await refuseKept(
          failure(
            `crew rm: ${shown} is kept: ${judged.state.why}`,
            `Fix: clear that${then}; it never forces`,
          ),
        );
      }
      const stopped = await stopOwnLeftovers(record, leftovers, ctx);
      if (stopped.line !== null) ctx.print(stopped.line);
      const removal = removeWorktree(repo, judged.listed, {
        against: removalBase,
        base: lead.label,
        claudeConfigDir: ctx.paths.claudeConfigDir,
        deleteBranch: (_repo, branch) =>
          release
            ? `kept branch ${branch}`
            : deleteBranchOnRef(repo, removalBase.ref, removalBase.label, branch, ctx.env),
        env: ctx.env,
        ...(facts === undefined ? {} : { facts }),
        idleLimit: 0,
      });
      for (const said of removal.said) ctx.print(said);
      if (removal.status !== "removed") {
        return await refuseKept(
          // The watch shows a release's refusal alone, so it carries what the removal said.
          release
            ? failure(
                `crew rm: ${shown} was not removed${removal.said.length > 0 ? `: ${removal.said.join("; ")}` : ""}`,
                `Fix: clear what holds it${then}; it never forces`,
              )
            : failure(
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
    return await refuseKept(
      failure(
        `crew rm: ${shown} is still there, and git does not list it as a worktree`,
        `Fix: remove that folder yourself${then}; crew rm never deletes what git does not know`,
      ),
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
  if (branchLeft() && !release) {
    ctx.print(deleteBranchOnRef(repo, removalBase.ref, removalBase.label, record.branch, ctx.env));
  }
  if (discard && record.discardPending !== undefined && !branchLeft())
    record = await completeCrewDiscard(record, ctx);
  // D69: the worktree is gone and its branch kept, so the record says released now, before
  // `claude rm`: when that fails, a resume can still make the worktree again, and the watch tries
  // `claude rm` again while agent view lists a row of it.
  if (release && record.released === undefined)
    record = await updateCrew(
      ctx.paths.stateDir,
      repo,
      record.id,
      { released: { at: new Date(ctx.now()).toISOString() } },
      ctx.now(),
    );

  // 8. Last, `claude rm`: it refuses a worktree that is still there. Every session the crew
  // session has had goes (`crewSessions`): a resume is a copy with a new id (WF1), and the
  // original stays in `/resume` and agent view until it is removed too.
  const sessions = crewSessions(record);
  let removedAny = false;
  for (const one of sessions) {
    const rm = claudeFailure(ctx, repo, ["rm", one.shortId]);
    // A job Claude Code no longer has cannot be removed again: `claude rm` fails on it ("No job
    // matching") however often it runs. When agent view does not list the session at all, it is
    // gone already — the state this step wants — so the record goes too.
    const goneAlready = rm !== null && sessionUnknown(ctx, record, one.shortId);
    if (rm !== null && !goneAlready) {
      // What is left is said as it is: a branch git keeps is not called gone.
      const branchGone = !branchLeft();
      ctx.error(`crew rm: ${rm}`);
      ctx.error(
        release
          ? `Fix: nothing to do; the worktree is gone, ${record.branch} is kept, and the watch tries claude rm ${one.shortId} again by itself (or run it by hand)`
          : `  the worktree is gone already${branchGone ? ", and so is the branch" : ""}; run claude rm ${one.shortId} by hand, then crew rm again`,
      );
      // A release's retry says nothing new: the record holds its first failure already.
      if (!(release && releasedBefore)) {
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
      }
      return 1;
    }
    if (!goneAlready) removedAny = true;
    ctx.print(
      goneAlready ? `session ${one.shortId} was gone already` : `removed session ${one.shortId}`,
    );
  }
  // D69: the conversations stay in `/resume`; their timeline counts from the first end, which
  // a release before this removal already wrote.
  const endedAt = new Date(ctx.now()).toISOString();
  record = await updateCrew(
    ctx.paths.stateDir,
    repo,
    record.id,
    { sessionEndedAt: record.sessionEndedAt ?? endedAt },
    ctx.now(),
  );
  if (release) {
    // A retry that found every row gone already has nothing new to say.
    if (!releasedBefore || removedAny)
      await appendCrewEvent(
        ctx.paths.stateDir,
        repo,
        {
          lead: record.leadSessionId,
          name: record.name,
          state: record.state,
          text: releasedBefore
            ? `released: its agent-view rows are removed now; branch ${record.branch} kept`
            : `released: worktree and agent-view rows removed; branch ${record.branch} kept`,
          type: "step",
          crew: record.id,
        },
        ctx.now(),
      );
    return 0;
  }
  if (discard) record = await completeCrewDiscard(record, ctx);
  const state = discard ? "discarded" : "removed";
  const stored = await markState(
    record,
    state,
    discard ? `discarded; recover from ${record.archive?.ref}` : "removed",
    ctx,
  );
  ctx.print(`${state} ${record.name}`);
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
  const lock = await (ctx.holdCleanLock ?? holdCleanLock)();
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
          if (!("why" in lead)) {
            const proof = validMergeProof(record, ctx) ? record.mergeProof : undefined;
            chosen = { label: lead.label, ref: proof?.leadCommit ?? lead.sha };
          }
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
