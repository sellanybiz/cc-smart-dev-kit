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
 * checkout, under `.claude/worktrees/`), pass, and so does the session's plans folder — the
 * `plansDirectory` setting, where plan mode writes its plan (`plans-folders.ts`). Nothing else
 * under `.claude/` is exempt. Anything it cannot work out lets the call through (a word the
 * shell fills in when the line runs, a program it does not know): a guard that failed on its
 * own bug would stop every call. One thing it asks about instead: a program the line works out
 * when it runs (`$GIT commit`) whose words name a git command that changes the checkout.
 */
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { dialectOfTool } from "../shell/command";
import { type WriteTarget, writeTargets } from "../shell/writes";
import { GUARD_GIT_TIMEOUT_MS, innermostWorktree, isInside, listWorktrees, realPath } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import { plansDirectory } from "./plans-folders";
import { memoizedRealPath, type RealPath } from "./real-path";
import type { HookContext } from "./run";

/**
 * The file an edit is about, as an absolute real path (`realPath`: a link on the way to it
 * must not hide which checkout it is in); null when the call names none.
 */
export function editedFile(
  input: HookInput,
  cwd: string,
  real: RealPath = realPath,
): string | null {
  const fields = toolInput(input);
  const path = stringField(fields.file_path) ?? stringField(fields.notebook_path);
  if (path === null) return null;
  return real(isAbsolute(path) ? resolve(path) : resolve(cwd, path));
}

/** What a call changes, as absolute real paths, and whether a shell command (not an edit) does it. */
export interface WrittenPaths {
  targets: WriteTarget[];
  byCommand: boolean;
}

/** The places a call changes: the edited file, or what a shell command's words write. */
export function writtenPaths(
  input: HookInput,
  cwd: string,
  real: RealPath = realPath,
): WrittenPaths {
  const file = editedFile(input, cwd, real);
  if (file !== null) return { targets: [{ computed: false, path: file }], byCommand: false };
  const command = stringField(toolInput(input).command);
  const dialect = dialectOfTool(input.tool_name);
  if (command === null || dialect === undefined) return { targets: [], byCommand: true };
  const targets = writeTargets(command, cwd, dialect).map(({ computed, path }) => ({
    computed,
    path: real(path),
  }));
  return { targets, byCommand: true };
}

/**
 * True when a failed guard must still ask about this call: an edit, or a shell command that
 * writes somewhere that may be the repo. A write to `/dev/…` or to the temp folder is none of
 * its business (unless the session itself works in the temp folder).
 */
export function mayWriteInRepo(input: HookInput, cwd: string | null): boolean {
  if (cwd === null) return true;
  const { targets, byCommand } = writtenPaths(input, cwd);
  if (!byCommand) return targets.length > 0;
  const temp = realPath(tmpdir());
  const inTemp = isInside(realPath(cwd), temp);
  return targets.some(({ path }) => !isInside(path, "/dev") && (inTemp || !isInside(path, temp)));
}

/** True when `file` is in the main checkout itself: inside it, and in no worktree inside it. */
export function editsMainFolder(file: string, mainCheckout: string, worktrees: string[]): boolean {
  if (!isInside(file, mainCheckout)) return false;
  return innermostWorktree(file, [mainCheckout, ...worktrees]) === mainCheckout;
}

/** The way into a worktree, said once: the refusal here and the session-start nudge both frame it. */
export const ENTER_WORKTREE_PHRASE =
  "`EnterWorktree` with the task's name as its `name` (dashes, not `/`)";

export function mainFolderRefusal(mainCheckout: string, byCommand = false): string {
  return [
    byCommand
      ? `This command writes in the main checkout (${mainCheckout}). This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`
      : `This file is in the main checkout (${mainCheckout}). This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`,
    byCommand
      ? "Already working in a worktree? Run the command in that worktree's folder: `cd` into it first, or give `git -C <worktree>` to a git command."
      : "Already working in a worktree? Edit the same file under that worktree's folder.",
    `Not in one yet: ${ENTER_WORKTREE_PHRASE} makes one, or resumes an existing one.`,
  ].join("\n");
}

/** The question when the program is worked out when the line runs and its words change the checkout. */
function computedGitQuestion(mainCheckout: string): string {
  return [
    `This command runs a program it works out when it runs, and its words name a git command that changes the checkout, in the main checkout (${mainCheckout}). The guard cannot tell what it runs. This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`,
    "Write the command out in full (for example `git commit …`), in a worktree's folder, if you meant it.",
  ].join("\n");
}

export function mainFolderGuard(context: HookContext): HookResult {
  const { project, input, cwd, env } = context;
  if (project.config?.worktrees?.guardMainFolder !== true || project.mainCheckout === null) {
    return SILENT;
  }
  const real = memoizedRealPath();
  const { targets, byCommand } = writtenPaths(input, cwd, real);
  const main = real(project.mainCheckout);
  // Most commands write nothing in the repo: no git call for those.
  const inRepo = targets.filter(({ path }) => isInside(path, main));
  if (inRepo.length === 0) return SILENT;
  const [, ...worktrees] = listWorktrees(main, env, GUARD_GIT_TIMEOUT_MS);
  const linked = worktrees.map((worktree) => real(worktree.path));
  const inMain = inRepo.filter(({ path }) => editsMainFolder(path, main, linked));
  if (inMain.length === 0) return SILENT;
  // Plan mode writes its plan in the plans folder, wherever that is: never refused.
  const plans = plansDirectory(project.root, env);
  const refused = inMain.filter(({ path }) => !isInside(path, plans));
  if (refused.length === 0) return SILENT;
  if (refused.some(({ computed }) => !computed)) {
    return toolDecision("deny", mainFolderRefusal(main, byCommand));
  }
  return toolDecision("ask", computedGitQuestion(main));
}
