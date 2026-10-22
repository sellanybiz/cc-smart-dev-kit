/**
 * PreToolUse (SendMessage): a session messages only sessions of its own repo, and a crew
 * session messages another crew session only with a contract note (D47).
 *
 * **One repo.** ListAgents lists every Claude session on the machine, whatever project it works
 * in, so a session can message one of another project by mistake. The target is looked up by
 * name in Claude Code's records of the running sessions (`sessions.ts`), which carry the same
 * names ListAgents shows. When every running session of that name works outside this repo (not in
 * the main checkout, not in one of its worktrees), the message is refused, naming its folder.
 *
 * **Contract notes only between crew sessions.** A crew session (the environment names its id,
 * `CREW_ENV`) that messages a session the store records as another crew session of this repo
 * sends a contract note or nothing: the first line of the message must carry the tag
 * `[<its phase>] CONTRACT:` or `[<phase>] QUESTION:` that `crew tell` writes
 * (`src/crew/tell-format.ts`). Status, and that a phase is done, go to the lead with
 * `crew report`; the refusal names `crew tell`. A message to or from the lead, and one to or
 * from a session the store does not record, is not judged: the lead talks to its crew as it
 * likes, and a person's own sessions are theirs.
 *
 * A name with no record (a subagent, a session on another machine) goes through, and so
 * does anything it cannot work out: a guard that failed on its own bug would stop every
 * message.
 */
import { COMMAND } from "../build-info/names";
import { withoutListRef } from "../crew/names";
import { crewIdOf } from "../crew/session";
import { type CrewRecord, listCrew, readCrew } from "../crew/store";
import { hasTellTag, tellTag } from "../crew/tell-format";
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

/** The refusal of a crew session's untagged message to another crew session: the tag, and the fix. */
export function untaggedTellRefusal(to: string, from: CrewRecord): string {
  return [
    `"${to}" is a crew session too, and one crew session messages another only with a contract note or a contract question.`,
    `Fix: ${COMMAND} crew tell "${to}" --kind contract "<what changed: file:symbol, commit>", or --kind question "<the ask>"`,
    `It writes the first line the note must carry ("${tellTag(from.phase, "contract")} …"), and records the note for your lead.`,
    `That the phase is done, or how it goes, goes to the lead: ${COMMAND} crew report --status done.`,
  ].join("\n");
}

/**
 * The crew session that sends this message, and the crew session it is for: `{ from, to }` when
 * the message needs the tag and does not carry it, else null.
 *
 * `repo` is the repository's main checkout (every worktree of it shares one store). Nothing is
 * judged when the sender names no crew session, or the store does not record it in this repo,
 * or the target is not a crew session's name: the message is then not between crew sessions.
 */
export function untaggedCrewTell(
  repo: string,
  env: Record<string, string | undefined>,
  to: string,
  message: string,
  stateDir: string,
): null | { from: CrewRecord; to: string } {
  const id = crewIdOf(env);
  if (id === null) return null;
  const from = readCrew(stateDir, repo, id);
  if (from === null) return null;
  const name = withoutListRef(to);
  const target = listCrew(stateDir, repo).records.find(
    (one) => one.name === name && one.id !== from.id,
  );
  if (target === undefined) return null;
  return hasTellTag(message, from.phase) ? null : { from, to: name };
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
  const repo = project.mainCheckout ?? project.root;
  const folders = listWorktrees(realPath(repo), env, GUARD_GIT_TIMEOUT_MS).map((worktree) =>
    realPath(worktree.path),
  );
  const folder = messageLeavesRepo(to, sessions, folders);
  if (folder !== null) return toolDecision("deny", otherProjectRefusal(to, folder));
  // The message stays in this repo: between two of its crew sessions, it must be a contract note.
  const message = stringField(toolInput(input).message) ?? "";
  let tell: null | { from: CrewRecord; to: string };
  try {
    tell = untaggedCrewTell(repo, env, to, message, paths.stateDir);
  } catch {
    // A store that cannot be read says nothing about the two sessions: the message goes through,
    // as every check this guard cannot make does.
    return SILENT;
  }
  return tell === null ? SILENT : toolDecision("deny", untaggedTellRefusal(tell.to, tell.from));
}
