/**
 * PreToolUse (Edit, Write, NotebookEdit): refuses an edit of a file in the main checkout
 * itself, for a project that keeps the main checkout clean and makes every change in a
 * worktree. Opt-in: cc-smart-dev-kit.json `worktrees.guardMainFolder: true`.
 *
 * An edit in the main checkout of a project that works in worktrees lands on whatever branch
 * the main checkout has, often under another session's feet. The refusal names the way into
 * a worktree, so the session fixes it in one step.
 *
 * WHERE THE FILE IS NAMED
 *   Edit and Write give `file_path`, NotebookEdit `notebook_path` — both absolute.
 *
 * Edits outside the repo, and edits inside a worktree (also one that lives inside the main
 * checkout, under `.claude/worktrees/`), pass. Anything else it cannot work out lets the edit
 * through: a guard that failed on its own bug would stop every edit.
 */
import { isAbsolute, resolve } from "node:path";
import { GUARD_GIT_TIMEOUT_MS, innermostWorktree, isInside, listWorktrees, realPath } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { HookContext } from "./run";

/**
 * The file an edit is about, as an absolute real path (`realPath`: a link on the way to it
 * must not hide which checkout it is in); null when the call names none.
 */
export function editedFile(input: HookInput, cwd: string): string | null {
  const fields = toolInput(input);
  const path = stringField(fields.file_path) ?? stringField(fields.notebook_path);
  if (path === null) return null;
  return realPath(isAbsolute(path) ? resolve(path) : resolve(cwd, path));
}

/** True when `file` is in the main checkout itself: inside it, and in no worktree inside it. */
export function editsMainFolder(file: string, mainCheckout: string, worktrees: string[]): boolean {
  if (!isInside(file, mainCheckout)) return false;
  return innermostWorktree(file, [mainCheckout, ...worktrees]) === mainCheckout;
}

export function mainFolderRefusal(mainCheckout: string): string {
  return [
    `This file is in the main checkout (${mainCheckout}). This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`,
    "Already working in a worktree? Edit the same file under that worktree's folder.",
    "Not in one yet: `EnterWorktree` with the task name as its `name` makes one, or resumes an existing one — use dashes, since a `/` becomes `+`.",
  ].join("\n");
}

export function mainFolderGuard(context: HookContext): HookResult {
  const { project, input, cwd, env } = context;
  if (project.config?.worktrees?.guardMainFolder !== true || project.mainCheckout === null) {
    return SILENT;
  }
  const file = editedFile(input, cwd);
  if (file === null) return SILENT;
  const main = realPath(project.mainCheckout);
  const [, ...worktrees] = listWorktrees(main, env, GUARD_GIT_TIMEOUT_MS);
  if (
    !editsMainFolder(
      file,
      main,
      worktrees.map((worktree) => realPath(worktree.path)),
    )
  ) {
    return SILENT;
  }
  return toolDecision("deny", mainFolderRefusal(main));
}
