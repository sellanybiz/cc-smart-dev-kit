/** Release a finished crew's worktree and agent rows without taking its branch or conversation. */
import { existsSync, mkdirSync } from "node:fs";
import { runGit } from "../hooks/git";
import { LockBusyError, withLock } from "../setup/lock";
import { copyWorktreeInclude } from "../worktrees/include";
import { reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { GIT_TIMEOUT_MS } from "./end";
import { RELEASE_STATES } from "./lifecycle";
import { crewRemovalLockDir, runCrewRm } from "./remove";
import { type CrewRecord, readCrew, updateCrew } from "./store";

export type ReleaseResult = { ok: true } | { ok: false; why: string };

/** A restore: whether it made the worktree again, or why it could not. */
export type RestoreResult = { ok: true; remade: boolean } | { ok: false; why: string };

/** The removal's own refusal line starts with this; the reason follows it. */
const REFUSAL_MARK = "crew rm: ";

/**
 * Makes a worktree the kit released (D69) again, at its own path on its kept branch, with its
 * `.worktreeinclude` files, and clears `released`. It holds the record's removal lock and reads
 * the record again inside it, so a release and a resume never cross: one that is releasing it
 * right now makes this refuse, and try again. All or nothing: when the copy or the store write
 * fails, the folder it just made goes again, so the next resume starts from the same place. A
 * folder already at that path is never replaced.
 */
export async function restoreReleasedWorktree(
  record: CrewRecord,
  ctx: CrewContext,
): Promise<RestoreResult> {
  const dir = crewRemovalLockDir(ctx.paths.stateDir, record.repo, record.id);
  let entered = false;
  try {
    mkdirSync(dir, { mode: 0o700, recursive: true });
    return await withLock(
      dir,
      async () => {
        entered = true;
        return await remake(readCrew(ctx.paths.stateDir, record.repo, record.id) ?? record, ctx);
      },
      { waitMs: 0 },
    );
  } catch (error) {
    if (error instanceof LockBusyError && !entered) {
      return {
        ok: false,
        why: `${record.name} is being released or removed right now; try again in a moment`,
      };
    }
    return { ok: false, why: reasonOf(error) };
  }
}

/** The re-make itself; the caller holds the record's removal lock. */
async function remake(record: CrewRecord, ctx: CrewContext): Promise<RestoreResult> {
  if (record.released === undefined) return { ok: true, remade: false };
  if (existsSync(record.worktree))
    return { ok: false, why: `${record.worktree} exists already; inspect it before resuming` };
  const added = runGit(
    record.repo,
    ["worktree", "add", record.worktree, record.branch],
    ctx.env,
    GIT_TIMEOUT_MS,
  );
  if (!added.ok) return { ok: false, why: `worktree could not be made again: ${added.err}` };
  try {
    copyWorktreeInclude(record.repo, record.worktree, ctx.env);
    await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { released: undefined },
      ctx.now(),
    );
    return { ok: true, remade: true };
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
 * Releases a crew session whose session is over (D69): `crew rm`'s own steps — its lock, its
 * checks, its D62 move-aside — judged against the session's own branch, so no merge is needed,
 * and that branch and the conversation stay.
 */
export async function releaseCrewSession(
  record: CrewRecord,
  ctx: CrewContext,
): Promise<ReleaseResult> {
  if (record.released !== undefined) return { ok: true };
  if (!RELEASE_STATES.includes(record.state))
    return { ok: false, why: `${record.name} is not over or stopped` };
  const lines: string[] = [];
  let code: number;
  try {
    code = await runCrewRm(
      record.id,
      {
        ...ctx,
        cwd: record.repo,
        print: (line) => lines.push(line),
        error: (line) => lines.push(line),
      },
      {
        release: true,
        skipParked: true,
        against: { label: record.branch, ref: `refs/heads/${record.branch}` },
      },
    );
  } catch (error) {
    return { ok: false, why: reasonOf(error) };
  }
  if (code === 0) return { ok: true };
  const refusal = lines.find((line) => line.startsWith(REFUSAL_MARK));
  return {
    ok: false,
    why: refusal?.slice(REFUSAL_MARK.length) ?? lines.at(-1) ?? "the release refused",
  };
}
