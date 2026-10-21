/**
 * PreToolUse (SendMessage): a session messages only sessions of its own repo.
 *
 * ListAgents lists every Claude session on the machine, whatever project it works in, so a
 * session can message one of another project by mistake. The target is looked up by name in
 * Claude Code's records of the running sessions (`sessions.ts`), which carry the same names
 * ListAgents shows. When every running session of that name works outside this repo (not in
 * the main checkout, not in one of its worktrees), the message is refused, naming its folder.
 *
 * A name with no record (a subagent, a session on another machine) goes through, and so
 * does anything it cannot work out: a guard that failed on its own bug would stop every
 * message. It does not judge what a message says.
 */
import { withoutListRef } from "../workers/names";
import { GUARD_GIT_TIMEOUT_MS, isInside, listWorktrees, realPath } from "./git";
import { type HookResult, SILENT, stringField, toolDecision, toolInput } from "./io";
import type { HookContext } from "./run";
import { liveSessions, type SessionRecord } from "./sessions";

/**
 * The folder the target of a message works in, when that is outside this repo (the message
 * should not go), else null. `to` is a name as ListAgents prints it, maybe with a " [ref]".
 * Two sessions can share a name; one of them inside this repo is enough.
 *
 * Every path here is a real path (`realPath`): a session's `cwd` and git's worktree list are
 * the same place written differently when a link is in the way (`/tmp` on macOS, a symlinked
 * checkout), and comparing the two forms would let a message out of the repo.
 */
export function messageLeavesRepo(
  to: string,
  sessions: SessionRecord[],
  repoFolders: string[],
): string | null {
  const name = withoutListRef(to);
  const named = sessions.filter((session) => session.name === name);
  const outside = named.filter(
    (session) => !repoFolders.some((folder) => isInside(realPath(session.cwd), folder)),
  );
  return named.length > 0 && outside.length === named.length ? (outside[0]?.cwd ?? null) : null;
}

export function otherProjectRefusal(to: string, folder: string): string {
  return [
    `"${to}" works in ${folder}, outside this repo: sessions message only sessions of their own repo.`,
    "ListAgents lists every Claude session on the machine, other projects too.",
  ].join("\n");
}

export function messageGuard(context: HookContext): HookResult {
  const { project, input, env, paths } = context;
  if (project.config === null) return SILENT;
  const to = stringField(toolInput(input).to);
  if (to === null) return SILENT;
  let sessions: SessionRecord[];
  try {
    sessions = liveSessions(paths.claudeConfigDir);
  } catch {
    return SILENT;
  }
  const repo = realPath(project.mainCheckout ?? project.root);
  const folders = listWorktrees(repo, env, GUARD_GIT_TIMEOUT_MS).map((worktree) =>
    realPath(worktree.path),
  );
  const folder = messageLeavesRepo(to, sessions, folders);
  return folder === null ? SILENT : toolDecision("deny", otherProjectRefusal(to, folder));
}
