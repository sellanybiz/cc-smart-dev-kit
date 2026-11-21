/**
 * Where Claude Code puts its worktrees, and what it calls them: the one home of these names.
 *
 * `claude -w <name>` and a subagent with `isolation: "worktree"` make a checkout at
 * `<repo>/.claude/worktrees/<name>`, on the branch `worktree-<name>`. A subagent's name is
 * `agent-<id>`, so its branch is `worktree-agent-<id>` (`docs/claude-code-contract.md`).
 * Code that builds or matches such a path or branch imports these, and never joins the folder or
 * the branch by hand (`paths.test.ts` fails a file that joins the folder).
 */
import { join } from "node:path";

/** The folder's path from a repo's root, one segment each, so a regex can be built from them. */
export const WORKTREES_FOLDER_SEGMENTS: readonly string[] = [".claude", "worktrees"];

/**
 * The folder as git and `.gitignore` write it: slashes on every platform, and a trailing slash
 * for a folder. What `git check-ignore` is asked, and what a repo adds to its `.gitignore`.
 */
export const WORKTREES_GITIGNORE_ENTRY = `${WORKTREES_FOLDER_SEGMENTS.join("/")}/`;

/** The folder that holds the worktrees Claude Code makes for a repo. */
export function worktreesFolder(repoRoot: string): string {
  return join(repoRoot, ...WORKTREES_FOLDER_SEGMENTS);
}

/** The folder of one Claude Code worktree of a repo, from its name. */
export function worktreePath(repoRoot: string, name: string): string {
  return join(worktreesFolder(repoRoot), name);
}

/** The branch Claude Code gives a worktree of this name: `worktree-<name>`. */
export function worktreeBranch(name: string): string {
  return `worktree-${name}`;
}

/** What starts the name of a subagent's worktree: `agent-<id>`. */
export const SUBAGENT_NAME_PREFIX = "agent-";

/**
 * What starts the branch Claude Code gives a subagent's worktree: `worktree-agent-<id>`. The
 * branch stays when the folder goes, so `worktrees --clean` sweeps the ones the base holds.
 */
export const SUBAGENT_BRANCH_PREFIX = worktreeBranch(SUBAGENT_NAME_PREFIX);
