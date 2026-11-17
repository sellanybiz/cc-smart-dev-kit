/**
 * PreToolUse (Edit, Write, NotebookEdit, Bash): refuses a change to a file in the main checkout
 * itself, for a project that keeps the main checkout clean and makes every change in a
 * worktree. Opt-in: cc-smart-dev-kit.json `worktrees.guardMainFolder: true`.
 *
 * A change in the main checkout of a project that works in worktrees lands on whatever branch
 * the main checkout has, often under another session's feet. The refusal names the way into
 * a worktree, so the session fixes it in one step.
 *
 * WHERE THE CHANGE IS NAMED
 *   Edit and Write give `file_path`, NotebookEdit `notebook_path` — both absolute. A Bash
 *   command names its writes in its words (`src/shell/writes.ts`): a redirection, `tee`,
 *   `sed -i`, `cp`, `mv`, `rm`, `touch`, `mkdir`, `ln`, and a git command that changes the
 *   work tree or its branch (`checkout`, `commit`, `pull` …), in the folder it runs in.
 *
 * Changes outside the repo, and changes inside a worktree (also one that lives inside the main
 * checkout, under `.claude/worktrees/`), pass, and so does the session's plans folder (plan
 * mode writes its plan there: `plans-folders.ts`). Nothing else under `.claude/` is exempt.
 * Anything it cannot work out lets the call through (a word the shell fills in when the line
 * runs, a program it does not know): a guard that failed on its own bug would stop every call.
 */
import { isAbsolute, resolve } from "node:path";
import { dialectOfTool } from "../shell/command";
import { writeTargets } from "../shell/writes";
import { GUARD_GIT_TIMEOUT_MS, innermostWorktree, isInside, listWorktrees, realPath } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import { plansFolders } from "./plans-folders";
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

/** What a call changes, as absolute real paths, and whether a shell command (not an edit) does it. */
export interface WrittenPaths {
  paths: string[];
  byCommand: boolean;
}

/** The places a call changes: the edited file, or what a shell command's words write. */
export function writtenPaths(input: HookInput, cwd: string): WrittenPaths {
  const file = editedFile(input, cwd);
  if (file !== null) return { paths: [file], byCommand: false };
  const command = stringField(toolInput(input).command);
  const dialect = dialectOfTool(input.tool_name);
  if (command === null || dialect === undefined) return { paths: [], byCommand: true };
  return { paths: writeTargets(command, cwd, dialect).map(realPath), byCommand: true };
}

/** True when `file` is in the main checkout itself: inside it, and in no worktree inside it. */
export function editsMainFolder(file: string, mainCheckout: string, worktrees: string[]): boolean {
  if (!isInside(file, mainCheckout)) return false;
  return innermostWorktree(file, [mainCheckout, ...worktrees]) === mainCheckout;
}

/** The way into a worktree, said once: the refusal here and the session-start nudge both give it. */
export const ENTER_WORKTREE_HINT =
  "Not in one yet: `EnterWorktree` with the task name as its `name` makes one, or resumes an existing one — use dashes, since a `/` becomes `+`.";

export function mainFolderRefusal(mainCheckout: string, byCommand = false): string {
  return [
    byCommand
      ? `This command writes in the main checkout (${mainCheckout}). This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`
      : `This file is in the main checkout (${mainCheckout}). This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`,
    byCommand
      ? "Already working in a worktree? Run the command in that worktree's folder: `cd` into it first, or give `git -C <worktree>` to a git command."
      : "Already working in a worktree? Edit the same file under that worktree's folder.",
    ENTER_WORKTREE_HINT,
  ].join("\n");
}

export function mainFolderGuard(context: HookContext): HookResult {
  const { project, input, cwd, env } = context;
  if (project.config?.worktrees?.guardMainFolder !== true || project.mainCheckout === null) {
    return SILENT;
  }
  const { paths, byCommand } = writtenPaths(input, cwd);
  if (paths.length === 0) return SILENT;
  const main = realPath(project.mainCheckout);
  const [, ...worktrees] = listWorktrees(main, env, GUARD_GIT_TIMEOUT_MS);
  const linked = worktrees.map((worktree) => realPath(worktree.path));
  const inMain = paths.filter((path) => editsMainFolder(path, main, linked));
  if (inMain.length === 0) return SILENT;
  // Plan mode writes its plan in the plans folder, wherever that is: never refused.
  const plans = plansFolders(project.root, env);
  if (inMain.every((path) => plans.some((folder) => isInside(path, folder)))) return SILENT;
  return toolDecision("deny", mainFolderRefusal(main, byCommand));
}
