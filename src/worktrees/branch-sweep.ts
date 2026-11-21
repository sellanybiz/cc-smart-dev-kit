/**
 * The branches of finished builders. A subagent with `isolation: "worktree"` works on a branch
 * Claude Code names `worktree-agent-<id>` (`paths.ts`). `worktrees --clean` removes the folder
 * once the work is safe, and `removeWorktree` deletes the branch with it only when the base holds
 * the work; a branch whose work reached the base later (a squash merge of the lead's plan branch)
 * stays, one per phase, and nothing revisits it. This sweep does, on `--clean` only.
 *
 * It judges and deletes with the same code as every removal (`tryDeleteBranch`: ancestry, replay,
 * cherry-pick, merged pull request), and touches only:
 * - local branches that start with `worktree-agent-`, never a person's own branch;
 * - that no worktree checks out: a running builder's branch is checked out in its folder, and git
 *   would refuse to delete it anyway.
 *
 * A branch whose work the base lacks is kept, and its line says why. When the base cannot be
 * read, every branch is kept and says so: the comparison fails, so nothing is judged merged.
 */
import { listWorktrees, runGit } from "../hooks/git";
import type { Env } from "../hooks/run";
import { SUBAGENT_BRANCH_PREFIX } from "./paths";
import {
  type BranchOutcome,
  baseRefOf,
  branchOutcomeLine,
  judgeBranchOnRef,
  type ScanOptions,
  tryDeleteBranch,
} from "./scan";

/** One builder branch, judged: what happened to it (`delete`) or what `--clean` would do (`list`). */
export interface BuilderBranchLine {
  branch: string;
  /** `deleted`/`goes`: the base holds its work. `kept`: it does not, or git refused. */
  state: "deleted" | "goes" | "kept";
  /** The line a person reads. */
  text: string;
}

const HEADS = "refs/heads/";

/**
 * The local `worktree-agent-*` branches no worktree has checked out, in name order. Empty
 * when git cannot list the branches or the worktrees: with the checked-out set unknown, no
 * branch is proved unused.
 */
export function unusedBuilderBranches(repo: string, env: Env): string[] {
  const listed = runGit(
    repo,
    ["for-each-ref", "--format=%(refname)", `${HEADS}${SUBAGENT_BRANCH_PREFIX}*`],
    env,
  );
  if (!listed.ok) return [];
  let checkedOut: Set<string>;
  try {
    checkedOut = new Set(listWorktrees(repo, env).map((worktree) => worktree.branch ?? ""));
  } catch {
    return [];
  }
  return listed.out
    .split(/\r?\n/)
    .filter((ref) => ref.startsWith(`${HEADS}${SUBAGENT_BRANCH_PREFIX}`))
    .map((ref) => ref.slice(HEADS.length))
    .filter((branch) => !checkedOut.has(branch))
    .sort();
}

function lineOf(branch: string, label: string, outcome: BranchOutcome): BuilderBranchLine {
  return {
    branch,
    state: outcome.kind === "deleted" ? "deleted" : "kept",
    text: branchOutcomeLine(branch, label, outcome),
  };
}

/**
 * Judge every unused builder branch against the base (`baseRefOf`): delete the ones it holds
 * (`mode: "delete"`, `--clean`), or only say which would go (`mode: "list"`, the listing).
 */
export function sweepBuilderBranches(
  repo: string,
  options: Pick<ScanOptions, "against" | "base" | "env">,
  mode: "delete" | "list",
): BuilderBranchLine[] {
  const { label, ref } = baseRefOf(options);
  const { env } = options;
  return unusedBuilderBranches(repo, env).map((branch) => {
    if (mode === "delete")
      return lineOf(branch, label, tryDeleteBranch(repo, ref, label, branch, env));
    const judged = judgeBranchOnRef(repo, ref, label, branch, env);
    return judged.kind === "on-ref"
      ? { branch, state: "goes", text: `branch ${branch}: ${label} holds its work` }
      : lineOf(branch, label, judged);
  });
}
