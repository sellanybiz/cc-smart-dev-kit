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
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND } from "../build-info/names";
import { cleanSessionName } from "../workers/names";
import { type HookResult, SILENT } from "./io";
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

/**
 * `cc-smart-dev-kit session-name <id> <name…>`: records the name a session chose. Returns the
 * name kept, or throws with what is wrong.
 */
export function recordSessionName(sessionId: string, raw: string, env: Env): string {
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
  const sessionId = input.session_id;
  if (!isSessionId(sessionId)) return SILENT;
  const dir = namesDir(env);
  const wanted = readName(join(dir, `${sessionId}.name`));
  const note = namingNote(sessionId, wanted);
  if (event === "SessionStart") {
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: note },
      }),
    };
  }
  const appliedFile = join(dir, sessionId);
  const title = wanted !== null && wanted !== readName(appliedFile) ? wanted : null;
  if (title !== null) {
    mkdirSync(dir, { recursive: true });
    writeAtomic(appliedFile, title);
    return {
      stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, sessionTitle: title } }),
    };
  }
  return wanted === null
    ? {
        stdout: JSON.stringify({
          hookSpecificOutput: { hookEventName: event, additionalContext: note },
        }),
      }
    : SILENT;
}
