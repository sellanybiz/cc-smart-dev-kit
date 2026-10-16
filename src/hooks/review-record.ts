/**
 * SubagentStop: when a review agent finishes, record the review it was run for.
 *
 * The review record (`src/workflow/reviews.ts`) is what the merge guard reads before a merge
 * it would make with no person watching: with `reviewBeforePush` on, the pull request's head
 * commit must be in it (`merge-guard.ts`). A record written by hand is only the writer's
 * word — a session can write one for a commit nobody read — so the record is written by the
 * one thing that knows a review agent really ran: this hook, at the moment Claude Code says
 * the agent is done.
 *
 * **SubagentStop is the event, not the Agent tool's PostToolUse.** On Claude Code 2.1.301 a
 * subagent runs in the background: the tool call returns at launch and the agent's end is
 * told to the session later. A PostToolUse hook would record the commit before the reviewer
 * had read a line. This is a plugin-wired SubagentStop that never touches a worktree — the
 * one kind `.claude/rules/hooks.md` allows from `hooks.json`.
 *
 * Which agents count is the workflow's `reviewAgents` (default `["cc-smart-dev-kit:reviewer"]`,
 * the plugin's own reviewer): a project that runs its own reviewer adds that agent's name. A
 * name is compared the way the Agent guard compares one (`agentKey`): case, `-`/`_`/space and
 * any `plugin:` prefix do not matter, so whichever form `agent_type` carries
 * (`cc-smart-dev-kit:reviewer`, `reviewer`) matches the same list.
 *
 * It records the commit the session's working folder (`cwd`) is on, in the repository's
 * record — one file per repository, the same one every worktree of it shares (`reviews.ts`),
 * and the same one the merge guard reads.
 *
 * What it never records, on purpose: an agent that is not on the list; a run whose `cwd` is
 * inside a subagent's own worktree (`.claude/worktrees/agent-<hex>`, the engine's shape: its
 * branch is a fresh one from the base, never the commit under review); a folder with no
 * commit yet; and a stopped agent that failed — `SubagentStop` is not told, and a review that
 * did not finish is no review, so the guard asks the person.
 *
 * SubagentStop takes no context: success prints nothing at all. A record that cannot be
 * written is one line on stderr, exit 0 — a subagent must always finish
 * (`.claude/rules/hooks.md` § Fail closed).
 */
import type { CcSmartDevKitConfig } from "../project/config";
import { type ResolvedWorkflow, resolveWorkflow } from "../workflow/resolve";
import { recordReview, reviewsFile } from "../workflow/reviews";
import { agentKey } from "./agent-guard";
import { GUARD_GIT_TIMEOUT_MS, runGit } from "./git";
import { type HookResult, SILENT, stringField } from "./io";
import type { Env, HookContext } from "./run";
import { subagentWorktreeOf } from "./worktree-remove";

/** The agent type a stopping subagent names (`agent_type`), or null when it names none. */
export function agentTypeOf(input: { agent_type?: unknown }): string | null {
  return stringField(input.agent_type);
}

/**
 * Is `agent` one of the agent types `agents` lists for recording a review? Compared the way
 * the Agent guard compares a subagent type (`agentKey`): after any `plugin:`, case and
 * `-`/`_`/space alike, so a list naming `reviewer` matches either form Claude Code reports.
 */
export function recordsReview(agent: string, agents: readonly string[]): boolean {
  const key = agentKey(agent);
  return agents.some((name) => agentKey(name) === key);
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

/** The line the person reads when the record could not be written. */
function couldNotWrite(why: string): HookResult {
  return { stderr: `cc-smart-dev-kit review-record: cannot write the record (${why})` };
}

/**
 * True when `cwd` is inside the worktree a subagent worked in. The engine's shape
 * (`.claude/worktrees/agent-<hex>`, `hooks.md`) is checked with the id when the input names
 * one, and by the shape alone when it does not: a record must never name a branch that was
 * cut from the base rather than the commit a reviewer read.
 */
export function inSubagentWorktree(cwd: string, agentId: string | null): boolean {
  if (subagentWorktreeOf(cwd, agentId) !== null) return true;
  return /[\\/]\.claude[\\/]worktrees[\\/]agent-[0-9a-f]+(?:[\\/]|$)/.test(cwd);
}

export function reviewRecord(context: HookContext): HookResult {
  const { project, input, env, cwd, paths } = context;
  // A project that never opted in must not notice the plugin, and has no policy to read.
  const config: CcSmartDevKitConfig | null = project.config;
  if (config === null) return SILENT;
  const agent = agentTypeOf(input);
  if (agent === null) return SILENT;
  if (inSubagentWorktree(cwd, stringField(input.agent_id))) return SILENT;

  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(paths, config);
  } catch (error) {
    // Which agents record a review is unknown, so nothing is recorded (the merge guard asks)
    // and the person hears why: it is their own workflow file that is broken.
    const why = error instanceof Error ? error.message : String(error);
    return {
      stderr: `cc-smart-dev-kit review-record: the workflow settings cannot be read (${why})`,
    };
  }
  if (!recordsReview(agent, resolved.reviewAgents.value)) return SILENT;

  const commit = headCommit(cwd, env);
  // No commit yet: there is nothing a review could be recorded for, and nothing worth saying.
  if (commit === null) return SILENT;

  try {
    recordReview(
      reviewsFile(paths.stateDir, project.mainCheckout ?? project.root),
      commit,
      Date.now(),
    );
  } catch (error) {
    return couldNotWrite(error instanceof Error ? error.message : String(error));
  }
  // SubagentStop carries no context: the record is the whole answer.
  return SILENT;
}
