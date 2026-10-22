/**
 * `cc-smart-dev-kit worker step <step> [--note <text>]`: one milestone of a worker's phase,
 * recorded so the lead hears it without asking (D25). The worker runs it; the CLI reads HEAD's
 * sha itself, so the worker never has to name its own commit, and appends **one** event.
 *
 * The steps are the ones a phase goes through (`WORKER_STEPS`): a test that fails before the
 * fix and passes after it, the whole suite, the review that starts and ends, the fixes, the
 * commit, the pull request, and the hand-off. A step the worker does not know is refused, with
 * the list of the ones it does.
 *
 * **Only a worker records steps.** A lead that wants a milestone of its own has no step to
 * record; the refusal says so.
 */
import { existsSync } from "node:fs";
import { runGit } from "../hooks/git";
import { readWorkerSelf, reasonOf } from "./caller";
import type { WorkerContext } from "./context";
import { appendWorkerEvent } from "./store";

/**
 * The milestones a worker records, in the order a phase goes through them. One list, one home:
 * the command refuses a step outside it and the brief names them.
 */
export const WORKER_STEPS = [
  "tests-red",
  "tests-green",
  "suite-green",
  "review-started",
  "review-done",
  "fixes-done",
  "committed",
  "pr-opened",
  "handoff",
] as const;

/** One of `WORKER_STEPS`, or a word a newer kit wrote, read as itself. */
export type WorkerStep = (typeof WORKER_STEPS)[number];

/** True when `value` is a step this kit knows. */
export function isWorkerStep(value: string): value is WorkerStep {
  return (WORKER_STEPS as readonly string[]).includes(value);
}

/** How long one git call may take (a `rev-parse`). */
const GIT_TIMEOUT_MS = 15_000;

/**
 * HEAD's sha in the worker's worktree, or null when it cannot be read (the worktree is gone,
 * or it has no commit yet). The folder the worker's record names is its own; the folder the
 * command runs in is used when the worker's worktree is not there.
 */
export function headSha(record: { worktree: string }, ctx: WorkerContext): null | string {
  const folders = existsSync(record.worktree) ? [record.worktree, ctx.cwd] : [ctx.cwd];
  for (const folder of folders) {
    const run = runGit(folder, ["rev-parse", "HEAD"], ctx.env, GIT_TIMEOUT_MS);
    if (run.ok && run.out !== "") return run.out;
  }
  return null;
}

/** `worker step`; the exit code. */
export async function runWorkerStep(
  step: string,
  note: null | string,
  ctx: WorkerContext,
): Promise<number> {
  const self = readWorkerSelf(ctx, "worker step");
  if (!self.ok) {
    for (const line of self.lines) ctx.error(line);
    return 1;
  }
  if (!isWorkerStep(step)) {
    ctx.error(`worker step: "${step}" is not a step: a step is one of ${WORKER_STEPS.join(", ")}`);
    return 2;
  }
  const { record, repo } = self.self;
  const sha = headSha(record, ctx);
  try {
    await appendWorkerEvent(
      ctx.paths.stateDir,
      repo,
      {
        lead: record.leadSessionId,
        name: record.name,
        note,
        sha,
        state: record.state,
        text: step,
        type: "step",
        worker: record.id,
      },
      ctx.now(),
    );
  } catch (error) {
    ctx.error(`worker step: the store could not record the step: ${reasonOf(error)}`);
    return 1;
  }
  ctx.print(`step ${step} · ${sha === null ? "no commit yet" : sha.slice(0, 7)}`);
  return 0;
}
