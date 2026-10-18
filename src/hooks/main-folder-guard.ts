/**
 * PreToolUse (Edit, Write, NotebookEdit, and Serena's edit tools): refuses an edit of a file
 * in the main checkout itself, for a project that keeps the main checkout clean and makes
 * every change in a worktree. Opt-in: cc-smart-dev-kit.json `worktrees.guardMainFolder: true`.
 *
 * An edit in the main checkout of a project that works in worktrees lands on whatever branch
 * the main checkout has, often under another session's feet. The refusal names the way into
 * a worktree, so the session fixes it in one step.
 *
 * WHERE THE FILE IS NAMED
 *   Edit and Write give `file_path`, NotebookEdit `notebook_path` — both absolute. Serena's
 *   edit tools (`replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`,
 *   `replace_content`, `rename_symbol`, `safe_delete_symbol`, `replace_in_files`) give
 *   `relative_path`, relative to SERENA'S ACTIVE PROJECT — which is not the folder the session
 *   works in: Serena starts at the folder the session started in, and moves when a session
 *   points it at its worktree (`mcp__serena__activate_project`). That folder is what
 *   `serena-root.ts` records for the session. Serena's MEMORY tools (`write_memory`,
 *   `rename_memory`, `edit_memory`, `delete_memory`) name no path at all — they write under
 *   the active project folder — so they are placed by that folder the same way
 *   (`SERENA_MEMORY_TOOLS`). With no record Serena is still at the folder the
 *   session started in — `CLAUDE_PROJECT_DIR`, which Claude Code keeps at that folder also
 *   inside a worktree. A record that says "unknown", and no `CLAUDE_PROJECT_DIR` either, means
 *   the file cannot be placed: the guard ASKS rather than letting it through.
 *
 * Edits outside the repo, and edits inside a worktree (also one that lives inside the main
 * checkout, under `.claude/worktrees/`), pass. Anything else it cannot work out lets the edit
 * through: a guard that failed on its own bug would stop every edit. The one exception is a
 * Serena edit it cannot place, above: there "unknown" asks.
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
import { readSerenaRoot, type SerenaRoot } from "./serena-root";

/**
 * Serena's edit tools: the ones whose `relative_path` this guard must place. `replace_in_files`
 * has a default `relative_path` of "" — the whole project — so a call may leave it out.
 */
export const SERENA_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "mcp__serena__replace_symbol_body",
  "mcp__serena__insert_after_symbol",
  "mcp__serena__insert_before_symbol",
  "mcp__serena__replace_content",
  "mcp__serena__rename_symbol",
  "mcp__serena__safe_delete_symbol",
  "mcp__serena__replace_in_files",
  ...["write_memory", "rename_memory", "edit_memory", "delete_memory"].map(
    (tool) => `mcp__serena__${tool}`,
  ),
]);

/**
 * Serena's MEMORY tools (`SERENA_EDIT_TOOLS` includes them): they write
 * `<active project>/.serena/memories/`, and their calls carry a memory NAME, never a file
 * path — so their target is the folder Serena has active, the same folder a Serena edit is
 * placed by. A name starting with `global/` writes to a machine-wide folder instead, which is
 * none of this guard's business. Serena's other memory tools need no entry here: `read_memory`
 * and `list_memories` only read, and `onboarding` (at the pinned commit) returns instructions
 * for writing memories — it writes no file itself.
 */
export const SERENA_MEMORY_TOOLS: ReadonlySet<string> = new Set([
  "mcp__serena__write_memory",
  "mcp__serena__rename_memory",
  "mcp__serena__edit_memory",
  "mcp__serena__delete_memory",
]);

/** The memory-name fields a call carries: `memory_name`, or `old_name`/`new_name` for a rename. */
function memoryNameKeys(tool: string): string[] {
  return tool.endsWith("rename_memory") ? ["old_name", "new_name"] : ["memory_name"];
}

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

/** What a Serena edit came to: its file, or that the file cannot be placed at all. */
export type SerenaEdit = { file: string } | { unplaceable: true };

/**
 * The file a Serena edit is about, resolved against the folder Serena edits. Null when this is
 * not a Serena edit, or the call names no path.
 *
 * `record` is this session's Serena root (`readSerenaRoot`): a folder when the session pointed
 * Serena somewhere, "unknown" when that cannot be read back, undefined when there is no record
 * — and then Serena is still at `projectDir`, the folder the session started in.
 *
 * A MEMORY tool (`SERENA_MEMORY_TOOLS`) names no path at all: its file lives under the active
 * project folder (`.serena/memories/`), so that folder is what comes back. A call whose every
 * memory name starts with `global/` writes to a machine-wide folder instead, and is left alone;
 * the same goes for a call that names no memory at all (it fails in Serena, not here).
 */
export function serenaEditedFile(
  input: HookInput,
  record: SerenaRoot | undefined,
  projectDir: string | null,
): null | SerenaEdit {
  const tool = stringField(input.tool_name);
  if (tool === null || !SERENA_EDIT_TOOLS.has(tool)) return null;
  const fields = toolInput(input);
  let relative: null | string;
  if (SERENA_MEMORY_TOOLS.has(tool)) {
    const named = memoryNameKeys(tool)
      .map((key) => stringField(fields[key]))
      .filter((name): name is string => name !== null && !name.startsWith("global/"));
    if (named.length === 0) return null;
    // The name is not a path: the file is somewhere under the active project folder, and that
    // folder is the whole of what this guard judges.
    relative = "";
  } else {
    relative = stringField(fields.relative_path) ?? (tool.endsWith("replace_in_files") ? "" : null);
    if (relative === null) return null;
  }
  if (record?.kind === "unknown") return { unplaceable: true };
  const root = record?.kind === "path" ? record.path : projectDir;
  if (root === null || !isAbsolute(root)) return { unplaceable: true };
  // The path may be "" (the whole project) or a glob: it still lies under the root, which is
  // all this needs. `realPath` resolves `..` away, so it cannot walk out of the root.
  return { file: realPath(resolve(root, relative)) };
}

/** True when `file` is in the main checkout itself: inside it, and in no worktree inside it. */
export function editsMainFolder(file: string, mainCheckout: string, worktrees: string[]): boolean {
  if (!isInside(file, mainCheckout)) return false;
  return innermostWorktree(file, [mainCheckout, ...worktrees]) === mainCheckout;
}

export function mainFolderRefusal(mainCheckout: string, viaSerena = false): string {
  return [
    `This file is in the main checkout (${mainCheckout}). This project makes every change in a worktree (cc-smart-dev-kit.json \`worktrees.guardMainFolder\`).`,
    viaSerena
      ? "A Serena edit lands in the project Serena has active, and that is the main checkout. Point Serena at your worktree first: `mcp__serena__activate_project` with the worktree's absolute path — then edit through Serena again. Or use Edit/Write with the same file's path under the worktree."
      : "Already working in a worktree? Edit the same file under that worktree's folder.",
    "Not in one yet: EnterWorktree with the task name as its `name` makes one — use dashes, since a `/` becomes `+`.",
  ].join("\n");
}

/** Said when a Serena edit cannot be placed: where Serena points is not known here. */
export function unplaceableSerenaRefusal(): string {
  return [
    "This is a Serena edit, and the folder Serena has active is not known to cc-smart-dev-kit, so it cannot tell whether the file is in the main checkout.",
    "Point Serena at a folder with `mcp__serena__activate_project` and an ABSOLUTE path (your worktree, or this repo's main checkout), then edit through Serena again — or use Edit/Write with the file's absolute path.",
  ].join("\n");
}

/** The folder the session started in, as Claude Code hands it to every hook. */
function startFolder(env: Record<string, string | undefined>): string | null {
  const dir = env["CLAUDE_PROJECT_DIR"];
  return dir !== undefined && dir !== "" && isAbsolute(dir) ? dir : null;
}

/** The guard's decision on one located file. */
function judge(file: string, context: HookContext, viaSerena: boolean): HookResult {
  const { project, env } = context;
  const main = realPath(project.mainCheckout ?? "");
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
  return toolDecision("deny", mainFolderRefusal(main, viaSerena));
}

export function mainFolderGuard(context: HookContext): HookResult {
  const { project, input, cwd, env, paths } = context;
  if (project.config?.worktrees?.guardMainFolder !== true || project.mainCheckout === null) {
    return SILENT;
  }
  const serena = serenaEditedFile(input, readSerenaRoot(paths, input.session_id), startFolder(env));
  if (serena !== null) {
    return "unplaceable" in serena
      ? toolDecision("ask", unplaceableSerenaRefusal())
      : judge(serena.file, context, true);
  }
  const file = editedFile(input, cwd);
  return file === null ? SILENT : judge(file, context, false);
}
