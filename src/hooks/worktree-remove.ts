/**
 * WorktreeRemove and SubagentStop: remove a worktree Claude Code is done with, only when
 * nothing can be lost.
 *
 * Once a WorktreeCreate hook makes the worktrees, Claude Code hands their removal to the
 * WorktreeRemove hook (a session that exits and picks "remove", `ExitWorktree` with
 * "remove"). Its input says only which folder (`worktree_path`); there is no field that
 * says "discard the changes" (seen live). And Claude Code no longer removes a subagent's
 * worktree at all: it keeps every one a hook made, and runs no WorktreeRemove for it.
 *
 * - **WorktreeRemove:** removes the worktree when nothing in it is changed or untracked,
 *   then its branch when every commit on it is also on another branch or a remote. Uncommitted
 *   work: kept, exit 1, and the reason on stderr (Claude Code then says it was not removed).
 *   A folder that is already gone: forgotten (`git worktree prune`), exit 0.
 * - **SubagentStop:** when the subagent worked in a worktree of its own
 *   (`.claude/worktrees/agent-<agent_id>`) and changed nothing (no edit, no commit of its
 *   own), the worktree and its branch go, as Claude Code does without hooks. Anything else
 *   is left alone, and this event always exits 0: it must never stop a subagent.
 */
import { existsSync } from "node:fs";
import {
  hasChanges,
  isInside,
  type ListedWorktree,
  listWorktrees,
  ownCommits,
  runGit,
  samePath,
} from "./git";
import { type HookResult, SILENT, stringField } from "./io";
import type { Env, HookContext } from "./run";

/** Deletes the branch when no commit on it would be lost; says what happened. */
export function deleteBranchIfCopied(repo: string, branch: string, env: Env): string {
  const own = ownCommits(repo, branch, env);
  if (own === null)
    return `kept branch ${branch}: git could not compare it with the other branches`;
  if (own > 0) {
    return `kept branch ${branch}: ${own === 1 ? "1 commit" : `${own} commits`} on it ${own === 1 ? "is" : "are"} on no other branch`;
  }
  const deleted = runGit(repo, ["branch", "-D", branch], env);
  return deleted.ok ? `deleted branch ${branch}` : `kept branch ${branch}: ${deleted.err}`;
}

type Removal = { removed: true; said: string } | { removed: false; why: string };

/**
 * Removes one listed worktree when nothing in it can be lost: not locked, no worktree inside
 * it, nothing changed or untracked. Then its branch, by `deleteBranchIfCopied`.
 */
export function removeWorktree(
  repo: string,
  found: ListedWorktree,
  all: ListedWorktree[],
  env: Env,
): Removal {
  if (found.locked) {
    return {
      removed: false,
      why: `${found.path} is locked (\`git worktree unlock ${found.path}\` once it is safe)`,
    };
  }
  const inner = all.find(
    (other) =>
      other !== found && isInside(other.path, found.path) && !samePath(other.path, found.path),
  );
  if (inner !== undefined) {
    return { removed: false, why: `another worktree lives inside it: ${inner.path}` };
  }
  if (hasChanges(found.path, env)) {
    return {
      removed: false,
      why: `it has uncommitted changes or untracked files. Commit them first, or remove it yourself: git worktree remove --force ${found.path}`,
    };
  }
  const removed = runGit(repo, ["worktree", "remove", found.path], env);
  if (!removed.ok) return { removed: false, why: removed.err };
  const said = [`removed ${found.path}`];
  if (found.branch !== null) said.push(deleteBranchIfCopied(repo, found.branch, env));
  return { removed: true, said: said.join("; ") };
}

export function worktreeRemove(context: HookContext): HookResult {
  const { env, project, input } = context;
  const path = stringField(input.worktree_path);
  if (path === null)
    return { exitCode: 1, stderr: "worktree kept: Claude Code gave no worktree path" };
  const repo = project.mainCheckout ?? project.root;
  const all = listWorktrees(repo, env);
  const [main, ...others] = all;
  if (main !== undefined && samePath(main.path, path)) {
    return { exitCode: 1, stderr: `worktree kept: ${path} is the main checkout` };
  }
  const found = others.find((worktree) => samePath(worktree.path, path));
  if (found === undefined) {
    if (existsSync(path)) {
      return { exitCode: 1, stderr: `worktree kept: ${path} is not a worktree of this repo` };
    }
    return SILENT;
  }
  if (found.prunable || !existsSync(found.path)) {
    runGit(repo, ["worktree", "prune"], env);
    const said = found.branch === null ? "" : `; ${deleteBranchIfCopied(repo, found.branch, env)}`;
    return { stderr: `forgot ${found.path}: its folder was gone${said}` };
  }
  const removal = removeWorktree(repo, found, all, env);
  return removal.removed
    ? { stderr: removal.said }
    : { exitCode: 1, stderr: `worktree kept: ${removal.why}` };
}

/**
 * The worktree a subagent worked in, from its SubagentStop input: the `cwd` inside
 * `.claude/worktrees/agent-<agent_id>`, cut back to that folder. Null for a subagent that
 * worked in its session's own folder.
 */
export function subagentWorktreeOf(cwd: string, agentId: string | null): string | null {
  if (agentId === null || !/^[0-9a-f]+$/.test(agentId)) return null;
  const found = new RegExp(
    String.raw`^(.*[\\/]\.claude[\\/]worktrees[\\/]agent-${agentId})(?:[\\/]|$)`,
  ).exec(cwd);
  return found?.[1] ?? null;
}

export function subagentStop(context: HookContext): HookResult {
  const { env, project, input, cwd } = context;
  const path = subagentWorktreeOf(cwd, stringField(input.agent_id));
  if (path === null) return SILENT;
  const repo = project.mainCheckout ?? project.root;
  const all = listWorktrees(repo, env);
  const found = all.slice(1).find((worktree) => samePath(worktree.path, path));
  if (found === undefined || found.branch === null) return SILENT;
  // Its own commits are work: the worktree stays, so the person can find them.
  if (ownCommits(repo, found.branch, env) !== 0) return SILENT;
  const removal = removeWorktree(repo, found, all, env);
  return removal.removed ? { stderr: removal.said } : SILENT;
}
