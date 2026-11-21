/**
 * Where Claude Code puts its worktrees, and what it calls them: the one home of these names.
 *
 * `claude -w <name>` and a subagent with `isolation: "worktree"` make a checkout at
 * `<repo>/.claude/worktrees/<name>`, on the branch `worktree-<name>`. A subagent's name is
 * `agent-<id>`, so its branch is `worktree-agent-<id>` (`docs/claude-code-contract.md`).
 * Code that builds or matches such a path or branch imports these, and never joins the folder or
 * the branch by hand (`paths.test.ts` fails a file that joins the folder).
 */
import { basename, dirname, join } from "node:path";
import type { ListedWorktree } from "../hooks/git";

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

/**
 * Is `path` a child of the default folder, spelled exactly as `worktreePath` writes it: the shape
 * a plain `claude -w` makes. One outside it comes from a project's own WorktreeCreate hook, or was
 * typed by someone.
 */
export function inDefaultFolder(repoRoot: string, path: string): boolean {
  return path === worktreePath(repoRoot, basename(path));
}

/**
 * The folders worktrees of this repo may be in: the default folder, then the parent of each
 * worktree git lists. `listed` is git's own list, so its first entry is the main checkout, whose
 * parent is no worktrees folder. A project's own WorktreeCreate hook may put worktrees anywhere,
 * so git's list is the source and no setting names the folder.
 */
export function worktreeFolders(repoRoot: string, listed: readonly ListedWorktree[]): string[] {
  const folders = new Set<string>([worktreesFolder(repoRoot)]);
  for (const one of listed.slice(1)) folders.add(dirname(one.path));
  return [...folders];
}

/**
 * The listed worktrees a launch named `name` made: the folder's last part is exactly `name`, or
 * the branch is exactly `worktreeBranch(name)`. Never "contains": `kit-api` and `kit-api-2` are
 * two launches. The main checkout, a folder git finds gone and every subagent's worktree
 * (`SUBAGENT_BRANCH_PREFIX`: a builder may start while a launch waits) are left out.
 */
export function listedNamed(listed: readonly ListedWorktree[], name: string): ListedWorktree[] {
  return listed
    .slice(1)
    .filter(
      (one) =>
        !one.prunable &&
        !(one.branch ?? "").startsWith(SUBAGENT_BRANCH_PREFIX) &&
        (basename(one.path) === name || one.branch === worktreeBranch(name)),
    );
}
