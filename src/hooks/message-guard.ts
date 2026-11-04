/**
 * PreToolUse (SendMessage): a message to a session of another repo goes only with the person's
 * yes.
 *
 * **One repo, unless the person says yes.** ListAgents lists every Claude session on the
 * machine, whatever project it works in, so a session can message one of another project by
 * mistake. The target is looked up by name in Claude Code's records of the running sessions
 * (`sessions.ts`), which carry the same names ListAgents shows. When every running session of
 * that name works outside this repo (not in the main checkout, not in one of its worktrees),
 * the person is asked, and the question names the session and its folder. The person decides
 * each time: a message to another repo can be right (owner, 2026-10-27).
 *
 * **The rule reads nothing from the project's file**: only git's worktree list and Claude
 * Code's session records. So a broken or too new `cc-smart-dev-kit.json` changes nothing: the
 * guard's `onConfigProblem` judges the message the same way, and its question also says why
 * the file cannot be used. A project with no file stays silent, as every plugin hook does.
 *
 * A name with no record (a subagent, a session on another machine) goes through, and so
 * does anything it cannot work out: a guard that failed on its own bug would stop every
 * message.
 */
import { GUARD_GIT_TIMEOUT_MS, isInside, listWorktrees, realPath } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { HookContext } from "./run";
import { liveSessions, type SessionRecord } from "./sessions";

type Env = Record<string, string | undefined>;

/** Claude Code's tool that messages another agent or session: what this guard judges. */
export const SEND_MESSAGE_TOOL = "SendMessage";

/**
 * A name without the ` [ref]` ListAgents prints after it, trimmed: the guard looks a target up
 * by the name this leaves.
 */
function withoutListRef(name: string): string {
  return name.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
}

/**
 * The folder the target of a message works in, when that is outside this repo (the person is
 * asked), else null. `to` is a name as ListAgents prints it, maybe with a " [ref]".
 * Two sessions can share a name; one of them inside this repo is enough.
 *
 * Every path here is a real path (`realPath`): a session's `cwd` and git's worktree list are
 * the same place written differently when a link is in the way (`/tmp` on macOS, a symlinked
 * checkout), and comparing the two forms would let a message out of the repo unasked.
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

/**
 * The folder outside the repo `repo` (its main checkout) that a message to `to` would reach,
 * or null when it stays in the repo or the guard cannot tell. It reads Claude Code's session
 * records and git's worktree list, and nothing of the project's file. Git is asked only when
 * a running session carries the name, with the guard's git limit (`GUARD_GIT_TIMEOUT_MS`).
 */
function otherRepoFolder(to: string, repo: string, env: Env, claudeConfigDir: string) {
  let sessions: SessionRecord[];
  try {
    sessions = liveSessions(claudeConfigDir);
  } catch {
    return null;
  }
  const name = withoutListRef(to);
  if (!sessions.some((session) => session.name === name)) return null;
  const folders = listWorktrees(realPath(repo), env, GUARD_GIT_TIMEOUT_MS).map((worktree) =>
    realPath(worktree.path),
  );
  return messageLeavesRepo(to, sessions, folders);
}

/** The question before a message to a session of another repo: the person decides each time. */
export function otherRepoQuestion(to: string, folder: string): string {
  return [
    `"${to}" works in ${folder}, outside this repo. Send this message to a session of another repo?`,
    "ListAgents lists every Claude session on the machine, other projects too.",
  ].join("\n");
}

/**
 * The other-repo rule's answer: silent when the message stays in this repo, else the person's
 * question. `configProblem` is why the project's file cannot be used, when the frame could not
 * read it: the question then says so on its last line, so the message about the file still
 * reaches the person.
 */
function otherRepoAnswer(
  input: HookInput,
  env: Env,
  repo: string,
  claudeConfigDir: string,
  configProblem: string | null,
): HookResult {
  const to = stringField(toolInput(input).to);
  if (to === null) return SILENT;
  const folder = otherRepoFolder(to, repo, env, claudeConfigDir);
  if (folder === null) return SILENT;
  const question = otherRepoQuestion(to, folder);
  return toolDecision(
    "ask",
    configProblem === null
      ? question
      : `${question}\nThe project's settings file cannot be used, and this rule reads nothing from it: ${configProblem}`,
  );
}

/**
 * The guard's answer when the project's file is broken or too new: the same judgement as
 * `run`, because the other-repo rule reads nothing from the file.
 */
export function messageGuardConfigProblem(
  configProblem: string,
  input: HookInput,
  env: Env,
  repo: string,
  claudeConfigDir: string,
): HookResult {
  return otherRepoAnswer(input, env, repo, claudeConfigDir, configProblem);
}

export function messageGuard(context: HookContext): HookResult {
  const { project, input, env, paths } = context;
  if (project.config === null) return SILENT;
  const repo = project.mainCheckout ?? project.root;
  return otherRepoAnswer(input, env, repo, paths.claudeConfigDir, null);
}
