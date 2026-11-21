/**
 * The worktree a subagent worked in, from the folder it worked in.
 *
 * Claude Code gives a subagent with `isolation: "worktree"` its own checkout, in Claude
 * Code's own shape: `<main checkout>/.claude/worktrees/agent-<agent_id>`. The review record
 * reads this shape to know that a review agent worked apart from the session, so a record
 * never names a branch that was cut from the base rather than the commit a reviewer read.
 * The folder and the name's prefix come from `worktrees/paths.ts`, the one home of that shape.
 */
import { SUBAGENT_NAME_PREFIX, WORKTREES_FOLDER_SEGMENTS } from "../worktrees/paths";

/** The folder's segments as regex text: either slash between them, a dot taken literally. */
const FOLDER_PATTERN = WORKTREES_FOLDER_SEGMENTS.map((segment) =>
  segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
).join(String.raw`[\\/]`);

/**
 * The subagent worktree `cwd` is in, whose agent id matches `idPattern` (regex text), or null.
 * The id is matched, never trusted as text: the callers pass a checked id or a hex class.
 */
function subagentWorktreeMatching(cwd: string, idPattern: string): string | null {
  const found = new RegExp(
    String.raw`^(.*[\\/]${FOLDER_PATTERN}[\\/]${SUBAGENT_NAME_PREFIX}${idPattern})(?:[\\/]|$)`,
  ).exec(cwd);
  return found?.[1] ?? null;
}

export function subagentWorktreeOf(cwd: string, agentId: string | null): string | null {
  if (agentId === null || !/^[0-9a-f]+$/.test(agentId)) return null;
  return subagentWorktreeMatching(cwd, agentId);
}

/** The subagent worktree `cwd` is in, by its shape alone: any agent id. Null when it is in none. */
export function subagentWorktreeByShape(cwd: string): string | null {
  return subagentWorktreeMatching(cwd, "[0-9a-f]+");
}
