/**
 * The worktree a subagent worked in, from the folder it worked in.
 *
 * Claude Code gives a subagent with `isolation: "worktree"` its own checkout, in Claude
 * Code's own shape: `<main checkout>/.claude/worktrees/agent-<agent_id>`. The review record
 * reads this shape to know that a review agent worked apart from the session, so a record
 * never names a branch that was cut from the base rather than the commit a reviewer read.
 */
export function subagentWorktreeOf(cwd: string, agentId: string | null): string | null {
  if (agentId === null || !/^[0-9a-f]+$/.test(agentId)) return null;
  const found = new RegExp(
    String.raw`^(.*[\\/]\.claude[\\/]worktrees[\\/]agent-${agentId})(?:[\\/]|$)`,
  ).exec(cwd);
  return found?.[1] ?? null;
}
