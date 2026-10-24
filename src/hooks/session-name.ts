/**
 * SessionStart and UserPromptSubmit: a session names itself once, after its task. Opt-in:
 * cc-smart-dev-kit.json `sessionNames: true`.
 *
 * People and other sessions find a session by its name (ListAgents, SendMessage, /resume,
 * the terminal title). Claude Code's own names (the folder, or a title from the first
 * prompt) say little about the work. The session knows its task, so it names itself:
 *
 * - SessionStart (startup, resume, compact): a note with the session's id and the command
 *   that names it, `cc-smart-dev-kit session-name <id> "<task>"`, which writes the name to a small
 *   file in the system's temp folder.
 * - UserPromptSubmit: when that name differs from the one this hook last set, the answer
 *   carries `sessionTitle` (the same rename as /rename). So a name the person gives with
 *   /rename stays until the session names itself again. While the session has no name,
 *   each prompt carries the note again.
 *
 * Why the title is set at a prompt: a title set at SessionStart reached the transcript and
 * /resume, but not the name ListAgents shows (seen on an older Claude Code; the contract
 * keeps the prompt route). Any failure ends quietly: a name is never worth a prompt.
 *
 * Two things write this record, and one owns a session's title:
 *
 * - a session that names itself after its task (the command above), through `titleToSet`;
 * - a registered lead's name (`LEAD <tag> <plan>`, D26), which `lead-notes` sets with no
 *   setting at the lead's next prompt (`LD1`) — the same `titleToSet`, the same record.
 *
 * So a session that is a recorded lead is left to `lead-notes` here, and a crew session is left to
 * its launch: one title, one owner. A task name never competes with a lead's role name (the name
 * its crew sessions and the message guard address it by), nor with a crew session's name, which
 * its own lead, `crew answer` and the message guard use as its address.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { cleanSessionName } from "../crew/names";
import { crewIdOf } from "../crew/session";
import { readLead } from "../crew/store";
import { addContext, addContextAndTitle, type HookResult, SILENT, stringField } from "./io";
import type { Env, HookContext } from "./run";

/** Claude Code's session ids are UUIDs. Anything else never becomes part of a path. */
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

/** The folder of the name files: `<temp>/cc-smart-dev-kit-session-names`. */
export function namesDir(env: Env): string {
  return join(env.TMPDIR || tmpdir(), "cc-smart-dev-kit-session-names");
}

function readName(file: string): string | null {
  try {
    return existsSync(file) ? cleanSessionName(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

/** Writes a file so a reader never sees half of it. */
function writeAtomic(file: string, text: string): void {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, text);
  renameSync(partial, file);
}

/** The file recording the name the kit last set for a session. */
function appliedFile(env: Env, sessionId: string): string {
  return join(namesDir(env), sessionId);
}

/** The name the kit last set for this session, or null. */
export function readAppliedName(env: Env, sessionId: string): string | null {
  return readName(appliedFile(env, sessionId));
}

/** Records `title` as the name the kit last set for this session. */
function rememberAppliedName(env: Env, sessionId: string, title: string): void {
  mkdirSync(namesDir(env), { recursive: true });
  writeAtomic(appliedFile(env, sessionId), title);
}

/**
 * The title a prompt should set, or null: `wanted` only when the session is not called that
 * already and the kit did not already set it. So a `/rename` the person gives after the kit
 * set the name stays, and a name the kit set is never set twice — even when its record was
 * lost, the session's own title says it. A session already called `wanted` has it recorded as the name the kit owns, so a rename
 * the person makes from there stays. The one rule behind both writers: a session's own task
 * name here, a lead's role name in `lead-notes`.
 */
export function titleToSet(
  env: Env,
  sessionId: string,
  wanted: string,
  current: null | string,
): null | string {
  if (wanted === readAppliedName(env, sessionId)) return null;
  rememberAppliedName(env, sessionId, wanted);
  return wanted === current ? null : wanted;
}

/**
 * `titleToSet`, for a hook whose turn holds more than the title (a crew session's `person`
 * event, a lead's news): the record of the name is written into the temp folder, and that write
 * can fail (a `TMPDIR` that is not a folder, a full disk). A throw there lost the rest of the
 * turn. Here the failure is `problem` — the hook says it on stderr — and no title is set: setting
 * a name the kit cannot remember setting would set it again on every turn and override a
 * `/rename` the person gives later.
 */
export function titleToSetOrProblem(
  env: Env,
  sessionId: string,
  wanted: string,
  current: null | string,
): { problem: null | string; title: null | string } {
  try {
    return { problem: null, title: titleToSet(env, sessionId, wanted, current) };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      problem: `the session name could not be recorded, so it is not set this turn (${why})`,
      title: null,
    };
  }
}

/**
 * True when this session is a lead recorded in the project's repository. A store that cannot
 * be read is no lead: this hook's name is never worth a failed prompt, and `lead-notes` says
 * its own line about a store it cannot read.
 */
function recordedLead(context: HookContext, sessionId: string): boolean {
  try {
    const repo = context.project.mainCheckout ?? context.project.root;
    return readLead(context.paths.stateDir, repo, sessionId) !== null;
  } catch {
    return false;
  }
}

/**
 * A name the state refuses, whatever the arguments are: a failed command (exit 1, one line),
 * never a usage mistake (exit 2 with the help pointer). The rule lives with the refusal, so the
 * command does not have to read the words to know which of the two it has.
 */
export class SessionNameRefused extends Error {
  override name = "SessionNameRefused";
}

/**
 * `cc-smart-dev-kit session-name <id> <name…>`: records the name a session chose. Returns the
 * name kept, or throws with what is wrong. A crew session is refused: `crew start --name` gave
 * it the name its lead, `crew answer` and the message guard address it by, and a task name must
 * never take that address away. That refusal is `SessionNameRefused` — the arguments are well
 * formed and the state is what says no.
 */
export function recordSessionName(sessionId: string, raw: string, env: Env): string {
  if (crewIdOf(env) !== null) {
    throw new SessionNameRefused("a crew session keeps the name its lead gave it");
  }
  if (!isSessionId(sessionId)) throw new Error(`"${sessionId}" is not a session id`);
  const name = cleanSessionName(raw);
  if (name === null) throw new Error("the name is empty");
  mkdirSync(namesDir(env), { recursive: true });
  writeAtomic(join(namesDir(env), `${sessionId}.name`), name);
  return name;
}

/** How a session names itself: told at its start, and with each prompt until it has. */
export function namingNote(sessionId: string, current: string | null): string {
  const command = `${COMMAND} session-name ${sessionId} "<the task, in a few words>"`;
  return current === null
    ? `This session has no name yet. Name it once, as soon as its main task is clear: people and other sessions find it by this name in ListAgents and /resume. Run: ${command}`
    : `This session is named "${current}" after its main task. Keep it; rename it only if the name no longer describes the main task: ${command}`;
}

export function sessionName(context: HookContext): HookResult {
  const { project, input, event, env } = context;
  if (project.config?.sessionNames !== true) return SILENT;
  // A crew session's name is its address: `crew start --name` gave it, and its lead,
  // `crew answer` and the message guard look it up by that name. It is never told to name
  // itself, and a name recorded for it is never set — one title, one owner, as with a lead below.
  if (crewIdOf(env) !== null) return SILENT;
  const sessionId = input.session_id;
  if (!isSessionId(sessionId)) return SILENT;
  // One title, one owner: a recorded lead's name is `lead-notes'` (no setting, LD1).
  if (recordedLead(context, sessionId)) return SILENT;
  const wanted = readName(join(namesDir(env), `${sessionId}.name`));
  const note = namingNote(sessionId, wanted);
  if (event === "SessionStart") return addContext(event, note);
  const title =
    wanted === null ? null : titleToSet(env, sessionId, wanted, stringField(input.session_title));
  if (title !== null) return addContextAndTitle(event, null, title);
  return wanted === null ? addContext(event, note) : SILENT;
}
