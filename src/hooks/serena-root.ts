/**
 * The Serena root keeper (`serena-root`): PreToolUse, PostToolUse and PostToolUseFailure on
 * `mcp__serena__activate_project`, and SessionStart. It exists for one question the
 * main-folder guard cannot answer alone: **which folder does Serena edit?**
 *
 * WHY IT EXISTS
 *   Serena names the file of an edit by `relative_path`, relative to its ACTIVE project. That
 *   project starts as the folder the session started in (Serena is started with
 *   `--project-from-cwd`), and a session moves it with `activate_project` — the plugin starts
 *   Serena with a context that allows exactly that (`single_project: false`), so a session can
 *   point it at its worktree. From then on the folder the session started in is the wrong root:
 *   a worktree edit would be judged as if it were a main-checkout file, and the other way
 *   round. So the folder is written down, per session.
 *
 * WHAT IT RECORDS
 *   - PreToolUse, on an activation that names this repo's main checkout or one of its
 *     worktrees BY ABSOLUTE PATH: "unknown" is written BEFORE the call runs — a call that
 *     fails, or one whose answer never comes back, must not leave the guard trusting an old
 *     folder, and an edit sent alongside the activation must not be judged against it either.
 *     A project NAME is refused (`deny`), and so is any folder outside the repo: every
 *     worktree of a repo shares one project name, so a name cannot say which folder is meant.
 *   - PostToolUse (Claude Code sends it only when the call succeeded): the folder Serena's own
 *     answer names, when it names an existing folder. An answer that cannot be read or names
 *     none leaves "unknown" — where the guard ASKS, never passes.
 *
 *   The record is therefore only ever a folder Serena itself confirmed. Until then the guard
 *   asks the person, which costs one answer and cannot let a main-checkout edit through.
 *   - SessionStart: `startup` clears the record (a new process starts a new Serena, back at
 *     the start folder — "no record" is exactly that), `resume`, `clear` and `fork` write
 *     "unknown" (under those, the same Serena may keep its project while the session knows
 *     nothing about it; refusing costs one activation), `compact` keeps it (same session,
 *     same Serena).
 *
 * THE RECORD IS CC-SMART-DEV-KIT'S OWN STATE
 *   `<stateDir>/serena-root/<session id>.txt`: either an absolute folder, or `unknown`. It
 *   never holds a secret, and `restore` may leave it (a stale record only makes the guard ask
 *   once more).
 *
 * FAILING OPEN, AND FAILING CLOSED
 *   This hook never stops a tool call by accident: a broken input, or a bug, is one line on
 *   stderr and exit 0 (`run.ts`). The one call it refuses is an activation that cannot be
 *   placed (`deny`). Everything else it cannot work out becomes "unknown", and the guard then
 *   ASKS the person about a Serena edit — never lets it through.
 *
 * Opt-in with the guard it serves: `worktrees.guardMainFolder` in cc-smart-dev-kit.json.
 * A project without it is not policed here at all.
 */
import { readFileSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { CliPaths } from "../cli/paths";
import { atomicWrite } from "../setup/write";
import { GUARD_GIT_TIMEOUT_MS, IGNORE_CASE, listWorktrees, samePath } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { HookContext } from "./run";

/** The one tool this hook records. */
export const SERENA_ACTIVATE_TOOL = "mcp__serena__activate_project";

/** The record's folder inside cc-smart-dev-kit's state folder. */
export const SERENA_ROOT_DIR = "serena-root";

/** What a session's record says about Serena's root. */
export type SerenaRoot = { kind: "path"; path: string } | { kind: "unknown" };

/** The content of a record whose root could not be worked out. */
const UNKNOWN = "unknown";

/**
 * The record file of a session, or null for an id that cannot be a file name (nothing is
 * read or written then).
 */
export function serenaRootFile(paths: CliPaths, sessionId: unknown): null | string {
  if (typeof sessionId !== "string" || !/^[\w-]{1,128}$/.test(sessionId)) return null;
  return join(paths.stateDir, SERENA_ROOT_DIR, `${sessionId}.txt`);
}

/**
 * This session's recorded Serena root: undefined when there is no record (Serena is still at
 * the folder the session started in), `unknown` when a record exists but names no absolute
 * path or cannot be read — the guard must not guess then.
 */
export function readSerenaRoot(paths: CliPaths, sessionId: unknown): SerenaRoot | undefined {
  const file = serenaRootFile(paths, sessionId);
  if (file === null) return undefined;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    // No file: no record. Any other failure: a record exists that cannot be read.
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return missing ? undefined : { kind: "unknown" };
  }
  const root = text.trim();
  return root !== UNKNOWN && isAbsolute(root)
    ? { kind: "path", path: resolve(root) }
    : { kind: "unknown" };
}

/** Write this session's record. Never a user file: cc-smart-dev-kit's own state, mode 0600. */
export function writeSerenaRoot(paths: CliPaths, sessionId: unknown, root: SerenaRoot): void {
  const file = serenaRootFile(paths, sessionId);
  if (file === null) return;
  atomicWrite(file, root.kind === "path" ? root.path : UNKNOWN, 0o600);
}

/** Delete this session's record, if there is one. */
export function clearSerenaRoot(paths: CliPaths, sessionId: unknown): void {
  const file = serenaRootFile(paths, sessionId);
  if (file !== null) rmSync(file, { force: true });
}

/** Every piece of text in a tool's answer: a string, content blocks, or nested objects. */
function textsOf(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (depth > 4 || value === null || typeof value !== "object") return [];
  const parts = Array.isArray(value) ? (value as unknown[]) : Object.values(value);
  return parts.flatMap((part) => textsOf(part, depth + 1));
}

/**
 * The folder Serena says it activated, from its answer to `activate_project` (Serena's
 * `get_project_activation_message`, at the commit pinned in `src/mcp/versions.ts`).
 */
export function activatedRoot(toolResponse: unknown): string | undefined {
  const pattern =
    /^(?:The project with name '[^'\n]*' at (.+) is activated\.|Created and activated a new project with name '[^'\n]*' at (.+)\.)\s*$/m;
  for (const text of textsOf(toolResponse)) {
    const match = pattern.exec(text);
    const root = match?.[1] ?? match?.[2];
    if (root !== undefined) return root.trim();
  }
  return undefined;
}

/** True for an absolute path to a folder that exists. */
function isFolder(path: string): boolean {
  try {
    return isAbsolute(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * May `project` be activated? Only an absolute path to this repo's main checkout or one of
 * its worktrees — never a name (every worktree shares one), never a folder outside the repo.
 * `folders` is the repo's worktree list, main checkout first.
 */
export function activationAllowed(project: unknown, folders: readonly string[]): boolean {
  if (typeof project !== "string" || !isAbsolute(project)) return false;
  const wanted = resolve(project);
  return folders.some((folder) => samePath(wanted, folder, IGNORE_CASE));
}

/** Said when an activation is refused before it runs. */
export const ACTIVATION_REFUSAL =
  "Point Serena only at this repo's main checkout or one of its worktrees, by absolute path — never a project name and never a folder outside the repo: every worktree shares one project name, so a name cannot say which folder is meant.";

/** The activation's `project` argument, when it is a string. */
function requestedProject(input: HookInput): unknown {
  return toolInput(input)["project"];
}

/** The folders an activation may name: the project's main checkout and every one of its worktrees. */
function repoFolders(context: HookContext): string[] {
  const main = context.project.mainCheckout ?? context.project.root;
  const [, ...worktrees] = listWorktrees(main, context.env, GUARD_GIT_TIMEOUT_MS);
  return [main, ...worktrees.map((worktree) => worktree.path)];
}

/**
 * One hook run. SessionStart handles the record's lifecycle; PreToolUse polices an activation
 * and records the folder it names; PostToolUse refines it from Serena's answer.
 */
export function serenaRoot(context: HookContext): HookResult {
  const { input, event, paths, project } = context;
  const sessionId = input.session_id;
  if (project.config?.worktrees?.guardMainFolder !== true) return SILENT;
  if (event === "SessionStart") {
    const source = stringField(input.source);
    if (source === "startup") clearSerenaRoot(paths, sessionId);
    else if (source === "resume" || source === "clear" || source === "fork") {
      writeSerenaRoot(paths, sessionId, { kind: "unknown" });
    }
    return SILENT;
  }
  const tool = stringField(input.tool_name);
  if (tool !== SERENA_ACTIVATE_TOOL) return SILENT;
  if (event === "PostToolUse") {
    const root = activatedRoot(input.tool_response);
    if (root !== undefined && isFolder(root)) {
      writeSerenaRoot(paths, sessionId, { kind: "path", path: resolve(root) });
    }
    // No folder in the answer (or none that exists): the record stays "unknown", and the
    // guard asks about a Serena edit rather than placing it.
    return SILENT;
  }
  if (event !== "PreToolUse") return SILENT;
  const wanted = requestedProject(input);
  if (!activationAllowed(wanted, repoFolders(context))) {
    return toolDecision("deny", ACTIVATION_REFUSAL);
  }
  // Until Serena's own answer names the folder it activated, this session cannot say where
  // its edits land: "unknown" makes the guard ask instead of trusting an old folder.
  writeSerenaRoot(paths, sessionId, { kind: "unknown" });
  return SILENT;
}
