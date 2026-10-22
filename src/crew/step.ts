/**
 * `cc-smart-dev-kit crew step <step> [--note <text>]`: one milestone of a crew session's phase,
 * recorded so the lead hears it without asking (D25). The crew session runs it; the CLI reads HEAD's
 * sha itself, so the crew session never has to name its own commit, and appends **one** event.
 *
 * The steps are the ones a phase goes through (`CREW_STEPS`): a test that fails before the
 * fix and passes after it, the whole suite, the review that starts and ends, the fixes, the
 * commit, the pull request, and the hand-off. A step the crew session does not know is refused, with
 * the list of the ones it does.
 *
 * **Only a crew records steps.** A lead that wants a milestone of its own has no step to
 * record; the refusal says so.
 */
import { existsSync } from "node:fs";
import { runGit } from "../hooks/git";
import { readCrewSelf, reasonOf } from "./caller";
import type { CrewContext } from "./context";
import { appendCrewEvent } from "./store";

/**
 * The milestones a crew records, in the order a phase goes through them. One list, one home:
 * the command refuses a step outside it and the brief names them.
 */
export const CREW_STEPS = [
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

/** One of `CREW_STEPS`, or a word a newer kit wrote, read as itself. */
export type CrewStep = (typeof CREW_STEPS)[number];

/** True when `value` is a step this kit knows. */
export function isCrewStep(value: string): value is CrewStep {
  return (CREW_STEPS as readonly string[]).includes(value);
}

/** How long one git call may take (a `rev-parse`). */
const GIT_TIMEOUT_MS = 15_000;

/**
 * HEAD's sha in the crew session's worktree, or null when it cannot be read (the worktree is gone,
 * or it has no commit yet). The folder the crew session's record names is its own; the folder the
 * command runs in is used when the crew session's worktree is not there.
 */
export function headSha(record: { worktree: string }, ctx: CrewContext): null | string {
  const folders = existsSync(record.worktree) ? [record.worktree, ctx.cwd] : [ctx.cwd];
  for (const folder of folders) {
    const run = runGit(folder, ["rev-parse", "HEAD"], ctx.env, GIT_TIMEOUT_MS);
    if (run.ok && run.out !== "") return run.out;
  }
  return null;
}

/** `crew step`; the exit code. */
export async function runCrewStep(
  step: string,
  note: null | string,
  ctx: CrewContext,
): Promise<number> {
  const self = readCrewSelf(ctx, "crew step");
  if (!self.ok) {
    for (const line of self.lines) ctx.error(line);
    return 1;
  }
  if (!isCrewStep(step)) {
    ctx.error(`crew step: "${step}" is not a step: a step is one of ${CREW_STEPS.join(", ")}`);
    return 2;
  }
  const { record, repo } = self.self;
  const sha = headSha(record, ctx);
  try {
    await appendCrewEvent(
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
        crew: record.id,
      },
      ctx.now(),
    );
  } catch (error) {
    ctx.error(`crew step: the store could not record the step: ${reasonOf(error)}`);
    return 1;
  }
  ctx.print(`step ${step} · ${sha === null ? "no commit yet" : sha.slice(0, 7)}`);
  return 0;
}
