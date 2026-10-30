/** Release a finished crew's worktree and agent rows without taking its branch or conversation. */
import { mkdirSync } from "node:fs";
import { LockBusyError, withLock } from "../setup/lock";
import { reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { RELEASE_STATES } from "./lifecycle";
import { crewRemovalLockDir, remakeReleasedWorktree, runCrewRm } from "./remove";
import { type CrewRecord, readCrew } from "./store";

/** A release: done, or why not and the removal's own fix line (null when it gave none). */
export type ReleaseResult = { ok: true } | { ok: false; why: string; fix: null | string };

/** A restore: whether it made the worktree again, or why it could not. */
export type RestoreResult = { ok: true; remade: boolean } | { ok: false; why: string };

/** The removal's own refusal line starts with this; the reason follows it. */
const REFUSAL_MARK = "crew rm: ";

/**
 * A resume's remake of a released worktree (`remakeReleasedWorktree`, with its `.worktreeinclude`
 * files). It takes the record's removal lock and reads the record again inside it, so a release
 * and a resume never cross: one that is releasing it right now makes this refuse, and try again.
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
        const remade = await remakeReleasedWorktree(
          readCrew(ctx.paths.stateDir, record.repo, record.id) ?? record,
          ctx,
          { include: true },
        );
        return remade.ok ? { ok: true, remade: remade.remade } : remade;
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

/**
 * Releases a crew session whose session is over (D69): `crew rm`'s own steps — its lock, its
 * checks, its D62 move-aside — judged against the session's own branch, so no merge is needed,
 * and that branch and the conversation stay. A record released already runs them again: its
 * worktree is gone, so they go straight to the `claude rm` an earlier release could not finish.
 */
export async function releaseCrewSession(
  record: CrewRecord,
  ctx: CrewContext,
): Promise<ReleaseResult> {
  if (!RELEASE_STATES.includes(record.state))
    return { ok: false, why: `${record.name} is not over or stopped`, fix: null };
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
    return { ok: false, why: reasonOf(error), fix: null };
  }
  if (code === 0) return { ok: true };
  const at = lines.findIndex((line) => line.startsWith(REFUSAL_MARK));
  return {
    ok: false,
    why: lines[at]?.slice(REFUSAL_MARK.length) ?? lines.at(-1) ?? "the release refused",
    fix: lines.slice(at + 1).find((line) => line.startsWith("Fix: ")) ?? null,
  };
}
