/**
 * The worktree a subagent worked in, from the folder it worked in.
 *
 * Claude Code gives a subagent with `isolation: "worktree"` its own checkout, in Claude
 * Code's own shape: `<main checkout>/.claude/worktrees/agent-<agent_id>`. The review record
 * reads this shape to know that a review agent worked apart from the session, so a record
 * never names a branch that was cut from the base rather than the commit a reviewer read.
 * The folder and the name's prefix come from `worktrees/paths.ts`, the one home of that shape.
 */
import { escapeRegex } from "../regex-escape";
import { SUBAGENT_NAME_PREFIX, WORKTREES_FOLDER_SEGMENTS } from "../worktrees/paths";

/** The folder's segments as regex text: either slash between them. */
const FOLDER_PATTERN = WORKTREES_FOLDER_SEGMENTS.map(escapeRegex).join(String.raw`[\\/]`);

/** The name's prefix as regex text, taken literally like the folder's segments. */
const NAME_PREFIX_PATTERN = escapeRegex(SUBAGENT_NAME_PREFIX);

/** The subagent worktree `cwd` is in, by its shape alone: any agent id. Null when it is in none. */
export function subagentWorktreeByShape(cwd: string): string | null {
  const found = new RegExp(
    String.raw`^(.*[\\/]${FOLDER_PATTERN}[\\/]${NAME_PREFIX_PATTERN}[0-9a-f]+)(?:[\\/]|$)`,
  ).exec(cwd);
  return found?.[1] ?? null;
}
