/**
 * SessionStart and UserPromptSubmit: one line to the person, once in a session, when that
 * session's own model is a Claude Fable model (the owner, 2026-10-16).
 *
 * **Claude never cares which model runs the main session.** A session on Fable is the
 * person's choice, and nothing is said to Claude about it — no `additionalContext`, no
 * error, never a block. The person may not have meant it (Fable uses the plan's limits
 * faster than Opus), so they are told once, through the `systemMessage` output field
 * ("Display a message to the user (all hooks)", `src/hooks/io.ts` and
 * `docs/claude-code-contract.md`).
 *
 * Which model:
 *   - SessionStart: the `model` the input names, when it names one (the schema Claude Code
 *     2.1.300 itself carries has `source` and an optional `model`);
 *   - UserPromptSubmit: the model that last answered in the transcript, then `ANTHROPIC_MODEL`
 *     — `readGuardContext`'s `sessionModel`, the same reading the Agent guard uses for a fork
 *     (`lastClaudeModel`). This catches a `/model` switch to Fable mid-session, once Fable
 *     has answered, and a SessionStart that named no model.
 *
 * The family is read the Agent guard's way (`resolveLaunchModel`: the family name, a full id,
 * a model slot, `ANTHROPIC_DEFAULT_FABLE_MODEL`), so there is no second list of what counts
 * as Fable. Not Fable, or a model that cannot be read: silent.
 *
 * **Once a session**, a mark file in the state folder holds the session's id. A mark that
 * cannot be read or written means the promise cannot be kept, so the hook says nothing: a
 * broken state folder must never become a line on every prompt.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { readGuardContext, resolveLaunchModel } from "./agent-guard";
import { type HookInput, type HookResult, SILENT, stringField, systemMessage } from "./io";
import type { Env } from "./run";
import { isSessionId } from "./session-name";

/** The one line the person sees, once a session. */
export const FABLE_SESSION_MESSAGE =
  "cc-smart-dev-kit: this session runs on Claude Fable, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.";

/** The mark file that says this session was told: one file per session, in the state folder. */
export function fableSessionMark(paths: CliPaths, sessionId: string): string {
  return join(paths.stateDir, `fable-session-${sessionId}`);
}

/**
 * True the first time this session is seen — and false when it was told already, or when the
 * mark cannot be read or written: the line is never said twice, so it is not said at all then.
 */
function firstTime(mark: string): boolean {
  try {
    if (existsSync(mark)) return false;
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, "");
    return true;
  } catch {
    return false;
  }
}

/** One `systemMessage` when this session's own model is Fable, once. Anything else: silent. */
export function fableSession(input: HookInput, env: Env, paths: CliPaths): HookResult {
  const event = stringField(input.hook_event_name);
  const sessionId = input.session_id;
  if (event === null || !isSessionId(sessionId)) return SILENT;
  const mark = fableSessionMark(paths, sessionId);
  // Told already: nothing to read. This hook runs at every prompt, and the model below costs a
  // settings file and the transcript's tail.
  if (existsSync(mark)) return SILENT;
  const context = readGuardContext(paths, input, env);
  const model = event === "SessionStart" ? stringField(input.model) : context.sessionModel;
  if (model === null) return SILENT;
  if (resolveLaunchModel(model, context.config, env).family !== "fable") return SILENT;
  if (!firstTime(mark)) return SILENT;
  return systemMessage(FABLE_SESSION_MESSAGE);
}
