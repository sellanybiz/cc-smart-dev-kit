/**
 * SubagentStart and SubagentStop: when a review agent finishes on the commit it started on,
 * record the review it was run for.
 *
 * The review record (`src/workflow/reviews.ts`) is what merge-check reads before a merge
 * it would make with no person watching: with `reviewBeforePush` on, the pull request's head
 * commit must be in it (`merge-guard.ts`). A record written by hand is only the writer's
 * word — a session can write one for a commit nobody read — so the record is written by the
 * one thing that knows a review agent really ran: this hook, at the moments Claude Code says
 * the agent starts and is done.
 *
 * **SubagentStop is the end, not the Agent tool's PostToolUse.** On Claude Code 2.1.301 a
 * subagent runs in the background: the tool call returns at launch and the agent's end is
 * told to the session later. A PostToolUse hook would record the commit before the reviewer
 * had read a line. This is a plugin-wired SubagentStop that never touches a worktree — the
 * one kind `.claude/rules/hooks.md` allows from `hooks.json`.
 *
 * **SubagentStart is the beginning:** it notes the commit the folder is on when the review
 * agent starts, and the branch (`symbolic-ref`; none on a detached HEAD), keyed by `agent_id`
 * (`noteReviewStart`). The stop records the review of that START commit, on that branch
 * (`takeReviewStart`) — always the start, never the commit the folder is on at the stop: a
 * commit made while the reviewer read is a fix it never saw. Such commits count as change
 * after the review, as every later fix does, when merge-check asks whether the review
 * still covers the branch's head (`src/workflow/review-cover.ts`, D17). A stop with no start
 * seen (the plugin was updated mid-review) records nothing and says so — except the stop that
 * a block caused (`stop_hook_active`): the first stop took the start and recorded the review,
 * so the second has nothing to record and must not claim otherwise.
 *
 * Which agents count is the workflow's `reviewAgents` (default `["cc-smart-dev-kit:senior-engineer"]`,
 * the plugin's own reviewer), compared by `recordsReview`: a `plugin:name` exactly, a bare
 * name only for an agent with no plugin prefix — so another plugin's `reviewer` never counts.
 * The list read here is the checkout's own; the record keeps the agent that wrote it, and
 * merge-check judges that agent again against the list committed on the pull request's
 * base (`hasReview`), so a list a session edits in its own worktree records nothing it trusts.
 *
 * **Only a run that was a review records** (`isReviewRun`): the agent's brief — the first user
 * entry of its transcript — holds the line `Mode: review` (trailing spaces and tabs allowed),
 * and so does every prompt it was given after the brief: a resume, a message from the session
 * that started it (a `user` entry or a `queued_command` attachment), a task notification, Stop
 * hook feedback, a compaction summary. A workflow agent (a review-split track) is told its brief
 * through Claude Code's workflow harness, which indents every line two spaces: `runPrompts`
 * reads the brief through that wrapper, so the line is at column zero again, and never accepts
 * an indented marker as it stands. Tool results, the meta entries Claude Code writes
 * itself for a skill (one the agent loaded itself too) or a reminder, and the notice that a
 * command or a Monitor the agent itself started has ended (a review that ran its tests that way
 * is still a review), are no prompt (`runPrompts`). So a consult, a review agent
 * resumed for a question, a missing, unreadable or oversized transcript, a review that
 * compacted, and a review that a Stop hook sent back to work all record nothing: the safe
 * side, where merge-check asks.
 * Start tracking still happens at SubagentStart; the stop consumes that start even for a run
 * that records nothing.
 *
 * It records the commit the session's working folder (`cwd`) is on, in the repository's
 * record — one file per repository, the same one every worktree of it shares (`reviews.ts`),
 * and the same one merge-check reads.
 *
 * What it never records, on purpose: an agent that is not on the list; a run whose `cwd` is
 * inside the review agent's own worktree (`.claude/worktrees/agent-<hex>` with its own id as the
 * hex, `inOwnWorktree`: its branch is a fresh one from the base, never the commit under review —
 * another agent's worktree, a builder's the session stands in, records as any folder does); a
 * folder with no commit yet; and a stopped agent that failed —
 * `SubagentStop` is not told, and a review that did not finish is no review, so the guard
 * asks the person.
 *
 * Neither event takes context from this hook: success prints nothing at all. A record that
 * cannot be written, and the stop of a listed review agent that records nothing (its own
 * worktree, a run that was not a review, no commit, no start seen), is one line on stderr with
 * the reason, exit 0 — a subagent must always start and finish
 * (`.claude/rules/hooks-guards.md` § Fail closed). The start never says anything: its stop does.
 */
import type { CcSmartDevKitConfig } from "../project/config";
import { type ResolvedWorkflow, resolveWorkflow } from "../workflow/resolve";
import {
  agentIdKey,
  noteReviewStart,
  recordReview,
  recordsReview,
  reviewStartsFile,
  reviewsFile,
  takeReviewStart,
} from "../workflow/reviews";
import { GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
import { type HookResult, SILENT, stringField } from "./io";
import type { Env, HookContext } from "./run";
import { subagentWorktreeByShape } from "./subagent-worktree";
import { runPrompts } from "./transcript";

/** Only an explicit review brief can write a review record. */
export const REVIEW_MODE_MARKER = "Mode: review";

/** The marker alone on a line; trailing spaces, tabs and a CR are allowed. */
const MARKER_LINE = new RegExp(`^${REVIEW_MODE_MARKER}[ \\t\\r]*$`, "m");

/**
 * True when the transcript shows a review run from start to end: the brief and every later
 * prompt each hold `MARKER_LINE`. False when the transcript cannot be read, is too large, or
 * has no brief.
 */
export function isReviewRun(transcriptPath: string): boolean {
  const prompts = runPrompts(transcriptPath);
  if (prompts === null || prompts.brief === null) return false;
  return [prompts.brief, ...prompts.later].every((text) => MARKER_LINE.test(text));
}

/** The agent type a starting or stopping subagent names (`agent_type`), or null when it names none. */
export function agentTypeOf(input: { agent_type?: unknown }): string | null {
  return stringField(input.agent_type);
}

/** The branch `folder` is on, or null on a detached HEAD (or when git cannot say). */
function headBranch(folder: string, env: Env): string | null {
  const run = runGit(
    folder,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    env,
    GUARD_GIT_TIMEOUT_MS,
  );
  return run.ok && run.out !== "" ? run.out : null;
}

/** The commit `folder` is on, or null when git cannot name one (no commit yet). */
function headCommit(folder: string, env: Env): string | null {
  const run = runGit(
    folder,
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    env,
    GUARD_GIT_TIMEOUT_MS,
  );
  return run.ok && /^[0-9a-f]{40,64}$/.test(run.out) ? run.out : null;
}

/** One line on stderr: what the person reads when no review was recorded for a reason. */
function said(why: string): HookResult {
  return { stderr: `cc-smart-dev-kit review-record: ${why}` };
}

/**
 * True when `cwd` is inside the review agent's own worktree (`isolation: "worktree"`): the
 * innermost `.claude/worktrees/agent-<hex>` it is in names this agent's id. That branch was cut
 * from the base, never the commit a reviewer read. Another agent's worktree is a folder the
 * session works in (a builder's, say), and its commit is the one under review.
 */
export function inOwnWorktree(cwd: string, agentId: string): boolean {
  const folder = subagentWorktreeByShape(cwd);
  if (folder === null) return false;
  const name = folder.split(/[\\/]/).at(-1) ?? "";
  return agentIdKey(name) === agentIdKey(agentId);
}

export async function reviewRecord(context: HookContext): Promise<HookResult> {
  const { project, input, event, env, cwd, paths } = context;
  // A project that never opted in must not notice the plugin, and has no policy to read.
  const config: CcSmartDevKitConfig | null = project.config;
  if (config === null) return SILENT;
  const agent = agentTypeOf(input);
  if (agent === null) return SILENT;
  const agentId = stringField(input.agent_id);

  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(paths, config);
  } catch (error) {
    // Which agents record a review is unknown, so nothing is recorded (merge-check asks)
    // and the person hears why: it is their own workflow file that is broken.
    const why = error instanceof Error ? error.message : String(error);
    return said(`the workflow settings cannot be read (${why})`);
  }
  if (!recordsReview(agent, resolved.reviewAgents.value)) return SILENT;
  // No id: a start cannot be matched to its stop, so neither is worth noting.
  if (agentId === null) return SILENT;

  const repository = project.mainCheckout ?? project.root;
  const isolated = inOwnWorktree(cwd, agentId);
  // The stop a block caused (`subagent-background` blocked the first one, say) follows a stop
  // this hook already answered: that one took the start and recorded the review, or said why
  // not. Saying it again would be noise, and "no start was seen" would be false.
  const notRecorded = (why: string, next = ""): HookResult =>
    input.stop_hook_active === true ? SILENT : said(`${why}, so no review is recorded${next}`);
  try {
    if (event === "SubagentStart") {
      if (isolated) return SILENT;
      const commit = headCommit(cwd, env);
      // No commit yet: there is nothing a review could be recorded for; the stop says so.
      if (commit !== null) {
        await noteReviewStart(
          reviewStartsFile(paths.stateDir, repository),
          agentId,
          commit,
          Date.now(),
          headBranch(cwd, env),
        );
      }
      return SILENT;
    }
    const start = await takeReviewStart(reviewStartsFile(paths.stateDir, repository), agentId);
    if (isolated) {
      return notRecorded(
        "this review agent worked in its own worktree, a branch cut from the base rather than the commit under review",
        ": run the reviewer without isolation",
      );
    }
    const transcript = stringField(input.agent_transcript_path);
    if (transcript === null || !isReviewRun(transcript)) {
      return notRecorded(
        `this run was not a review from start to end (its brief and every later prompt need the line "${REVIEW_MODE_MARKER}"), or its transcript cannot be read`,
      );
    }
    if (headCommit(cwd, env) === null) return notRecorded("the folder has no commit yet");
    if (start === null) {
      return notRecorded("no start was seen for this review agent", ": run the review again");
    }
    // The commit the reviewer started on is the one it read: commits made since are change
    // after the review, which merge-check measures (D17).
    await recordReview(
      reviewsFile(paths.stateDir, repository),
      start.head,
      agent,
      Date.now(),
      start.branch,
    );
  } catch (error) {
    return said(
      `cannot write the record (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  // Neither event carries context from this hook: the record is the whole answer.
  return SILENT;
}
