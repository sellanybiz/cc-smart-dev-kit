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
 * `crew report`; the refusal names `crew tell`. **A message to the session's own lead is
 * refused the same way, with the report route**: the lead hears its crew through the store
 * (`crew report`), and `crew tell` matches the lead too (`src/crew/tell.ts`). A message
 * **from** the lead, and one to or from a session the store does not record, is not judged:
 * the lead talks to its crew as it likes, and a person's own sessions are theirs.
 *
 * That crew rule is the guard's **crew part** (`crewMessageAnswer`, `HookSpec.crewLimits`):
 * the frame runs it before `ownHooks` and before the project's file is read, so a project
 * with no `cc-smart-dev-kit.json`, or one whose `ownHooks` names `message-guard`, keeps the
 * refusal. The other-repo rule below stays where it was, and keeps reading the file.
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

/** The refusal of a crew session's message to its own lead: the report route, as `crew tell` says. */
export function leadTellRefusal(to: string): string {
  return [
    `"${to}" is your lead, and a crew session reaches its lead through crew report, not a message.`,
    `Fix: ${COMMAND} crew report --status done, or ${COMMAND} crew report --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>`,
    "The report is recorded for the lead, and its watch wakes the lead on the line.",
  ].join("\n");
}

/**
 * What a crew session's message to another crew session is missing: the tag (`tag`), or — for
 * its own lead — the report route (`lead`).
 */
export type CrewTellProblem =
  | { from: CrewRecord; kind: "lead"; to: string }
  | { from: CrewRecord; kind: "tag"; to: string };

/**
 * The problem with the message the crew session `env` names sends to `to`, or null when there
 * is none.
 *
 * `repo` is the repository's main checkout (every worktree of it shares one store). Nothing is
 * judged when the sender names no crew session, or the store does not record it in this repo,
 * or the target is neither its lead nor a crew session's name: the message is then not between
 * crew sessions. **The lead is matched by name, as `crew tell` matches it**
 * (`src/crew/tell.ts`): it hears its crew through `crew report`, never a raw message.
 */
export function crewTellProblem(
  repo: string,
  env: Record<string, string | undefined>,
  to: string,
  message: string,
  stateDir: string,
): CrewTellProblem | null {
  const id = crewIdOf(env);
  if (id === null) return null;
  const from = readCrew(stateDir, repo, id);
  if (from === null) return null;
  const name = withoutListRef(to);
  if (name === from.leadName) return { from, kind: "lead", to: name };
  const target = listCrew(stateDir, repo).records.find(
    (one) => one.name === name && one.id !== from.id,
  );
  if (target === undefined) return null;
  return hasTellTag(message, from.phase) ? null : { from, kind: "tag", to: name };
}

/**
 * The guard's crew part (D47): a crew session's peer messages carry the `crew tell` tag, and a
 * message to its own lead goes through `crew report`. The frame runs it before `ownHooks` and
 * before the project's file, so no project can lose the rule — one with no
 * `cc-smart-dev-kit.json` included.
 *
 * Not a crew session: silence. A store the guard cannot read says nothing about the two
 * sessions, and the message goes through, as every check a guard cannot make does.
 */
export function crewMessageAnswer(
  input: HookInput,
  env: Record<string, string | undefined>,
  repo: string,
  stateDir: string,
): HookResult {
  if (crewIdOf(env) === null) return SILENT;
  const to = stringField(toolInput(input).to);
  if (to === null) return SILENT;
  const message = stringField(toolInput(input).message) ?? "";
  let problem: CrewTellProblem | null;
  try {
    problem = crewTellProblem(repo, env, to, message, stateDir);
  } catch {
    return SILENT;
  }
  if (problem === null) return SILENT;
  return toolDecision(
    "deny",
    problem.kind === "lead"
      ? leadTellRefusal(problem.to)
      : untaggedTellRefusal(problem.to, problem.from),
  );
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
  // The crew rule between two of this repo's crew sessions is the guard's crew part, answered
  // before the file (`crewMessageAnswer`): the same-repo check here stays the project's.
  return folder === null ? SILENT : toolDecision("deny", otherProjectRefusal(to, folder));
}
