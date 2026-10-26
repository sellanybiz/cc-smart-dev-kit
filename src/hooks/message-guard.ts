/**
 * PreToolUse (SendMessage): a message to a session of another repo goes only with the person's
 * yes, and a crew session messages another crew session only with a contract note (D47).
 *
 * **One repo, unless the person says yes.** ListAgents lists every Claude session on the
 * machine, whatever project it works in, so a session can message one of another project by
 * mistake. The target is looked up by name in Claude Code's records of the running sessions
 * (`sessions.ts`), which carry the same names ListAgents shows. When every running session of
 * that name works outside this repo (not in the main checkout, not in one of its worktrees),
 * the person is asked, and the question names the session and its folder. The person decides
 * each time: a message to another repo can be right (owner, 2026-10-27).
 *
 * **That rule reads nothing from the project's file**: only git's worktree list and Claude
 * Code's session records. So a broken or too new `cc-smart-dev-kit.json` changes nothing: the
 * guard's `onConfigProblem` judges the message the same way, and its question also says why
 * the file cannot be used. A project with no file stays silent, as every plugin hook does.
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
 * **A crew session never asks the person**, so its message to another repo is refused, and
 * the refusal names the step that puts the question to its lead (`CREW_QUESTION_STEP`).
 *
 * Both crew rules are the guard's **crew part** (`crewMessageAnswer`, `HookSpec.crewLimits`):
 * the frame runs it before `ownHooks` and before the project's file is read, so a project
 * with no `cc-smart-dev-kit.json`, one whose file is broken or too new, and one whose
 * `ownHooks` names `message-guard` keep the refusals. The guard's `run` and its
 * `onConfigProblem` then leave a crew session alone: its message was judged in full.
 *
 * A name with no record (a subagent, a session on another machine) goes through, and so
 * does anything it cannot work out: a guard that failed on its own bug would stop every
 * message.
 */
import { COMMAND } from "../build-info/names";
import { REPORT_COMMAND, REPORT_DONE_COMMAND } from "../crew/brief";
import { withoutListRef } from "../crew/names";
import { CREW_QUESTION_STEP, crewIdOf } from "../crew/session";
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

type Env = Record<string, string | undefined>;

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

/** The refusal of a crew session's message to another repo: only the person may allow it. */
export function crewOtherRepoRefusal(to: string, folder: string): string {
  return [
    `"${to}" works in ${folder}, outside this repo, and a message there goes only with the person's yes.`,
    CREW_QUESTION_STEP,
  ].join("\n");
}

/**
 * The other-repo rule's answer: silent when the message stays in this repo, a deny for a crew
 * session (`crewOtherRepoRefusal`), else the person's question. `configProblem` is why the
 * project's file cannot be used, when the frame could not read it: the question then says so
 * on its last line, so the message about the file still reaches the person.
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
  if (crewIdOf(env) !== null) return toolDecision("deny", crewOtherRepoRefusal(to, folder));
  const question = otherRepoQuestion(to, folder);
  return toolDecision(
    "ask",
    configProblem === null
      ? question
      : `${question}\nThe project's settings file cannot be used, and this rule reads nothing from it: ${configProblem}`,
  );
}

/** The refusal of a crew session's untagged message to another crew session: the tag, and the fix. */
export function untaggedTellRefusal(to: string, from: CrewRecord): string {
  return [
    `"${to}" is a crew session too, and one crew session messages another only with a contract note or a contract question.`,
    `Fix: ${COMMAND} crew tell "${to}" --kind contract "<what changed: file:symbol, commit>", or --kind question "<the ask>"`,
    `It writes the first line the note must carry ("${tellTag(from.phase, "contract")} …"), and records the note for your lead.`,
    `That the phase is done, or how it goes, goes to the lead: ${REPORT_DONE_COMMAND} (with the JSON part).`,
  ].join("\n");
}

/** The refusal of a crew session's message to its own lead: the report route, as `crew tell` says. */
export function leadTellRefusal(to: string): string {
  return [
    `"${to}" is your lead, and a crew session reaches its lead through crew report, not a message.`,
    `Fix: ${REPORT_DONE_COMMAND} (with the JSON part), or ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>`,
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
  env: Env,
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
 * The guard's crew part (D47): a crew session's peer messages carry the `crew tell` tag, a
 * message to its own lead goes through `crew report`, and a message to another repo is
 * refused with the step to its lead (it never asks the person). The frame runs it before
 * `ownHooks` and before the project's file, so no project can lose the rule — one with no
 * `cc-smart-dev-kit.json`, or a broken or too new one, included.
 *
 * Not a crew session: silence. A store the guard cannot read says nothing about the two
 * sessions, and the message is judged by the other-repo rule alone, as every check a guard
 * cannot make lets the call through.
 */
export function crewMessageAnswer(
  input: HookInput,
  env: Env,
  repo: string,
  stateDir: string,
  claudeConfigDir: string,
): HookResult {
  if (crewIdOf(env) === null) return SILENT;
  const to = stringField(toolInput(input).to);
  if (to === null) return SILENT;
  const message = stringField(toolInput(input).message) ?? "";
  let problem: CrewTellProblem | null;
  try {
    problem = crewTellProblem(repo, env, to, message, stateDir);
  } catch {
    problem = null;
  }
  if (problem !== null) {
    return toolDecision(
      "deny",
      problem.kind === "lead"
        ? leadTellRefusal(problem.to)
        : untaggedTellRefusal(problem.to, problem.from),
    );
  }
  return otherRepoAnswer(input, env, repo, claudeConfigDir, null);
}

/**
 * The guard's answer when the project's file is broken or too new: the same judgement as
 * `run`, because the other-repo rule reads nothing from the file. A crew session was judged
 * in full by the crew part before the file was read, so it gets silence here.
 */
export function messageGuardConfigProblem(
  configProblem: string,
  input: HookInput,
  env: Env,
  repo: string,
  claudeConfigDir: string,
): HookResult {
  if (crewIdOf(env) !== null) return SILENT;
  return otherRepoAnswer(input, env, repo, claudeConfigDir, configProblem);
}

export function messageGuard(context: HookContext): HookResult {
  const { project, input, env, paths } = context;
  if (project.config === null) return SILENT;
  // A crew session's message was judged in full by the crew part (`crewMessageAnswer`),
  // before the file: the other-repo rule is not run a second time.
  if (crewIdOf(env) !== null) return SILENT;
  const repo = project.mainCheckout ?? project.root;
  return otherRepoAnswer(input, env, repo, paths.claudeConfigDir, null);
}
