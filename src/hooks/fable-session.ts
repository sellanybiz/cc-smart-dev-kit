/**
 * SessionStart and UserPromptSubmit: one line to the person, once in a session, when that
 * session's own model is the **`fable` tier** (the owner, 2026-10-16).
 *
 * **Claude never cares which model runs the main session.** A session on Fable is the person's
 * choice, and nothing is said to Claude about it — no `additionalContext`, no error, never a
 * block. The person may not have meant it (the tier spends the plan's limits faster than Opus),
 * so they are told once, through the `systemMessage` output field ("Display a message to the
 * user (all hooks)", `src/hooks/io.ts` and `docs/claude-code-contract.md` — **not proved live
 * yet**).
 *
 * Which model:
 *   - SessionStart: the `model` the input names, and nothing else — no fallback there (the
 *     schema Claude Code 2.1.300 itself carries has `source` and an optional `model`);
 *   - UserPromptSubmit: the model that last answered in the transcript, then `ANTHROPIC_MODEL`
 *     (`sessionModelOf`, the same reading the Agent guard's fork rule uses). So a `/model`
 *     switch to Fable is caught once Fable has answered, at the prompt after that answer.
 *
 * The tier is read the Agent guard's way (`resolveLaunchModel`: the family name, a Claude id,
 * a model slot, `ANTHROPIC_DEFAULT_FABLE_MODEL`), so there is no second list of what counts as
 * Fable — and a `fable` tier a backend answers warns the same, naming the model that answers it.
 *
 * **What it costs.** A session that was told stops at the mark. A session on anything else pays
 * one `existsSync` and — at a prompt — the transcript's tail; the gateway config is read only
 * when the model text could be Fable at all (`couldBeFable`), and the settings file never is.
 * A session nobody watches (`claude -p`) is told nothing and keeps no mark.
 *
 * **Once a session**, the mark is `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.fable`,
 * beside the session's own name files (`namesDir`, one home), so the OS clears it. It is made
 * with `wx`, so two runs that race cannot both speak; EEXIST means this session was told.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { MODEL_SLOTS, withoutContextSuffix } from "../gateway/targets";
import {
  familyEnv,
  familyOfModel,
  gatewayConfigOf,
  type LaunchModel,
  resolveLaunchModel,
  sessionModelOf,
} from "./agent-guard";
import { type HookInput, type HookResult, SILENT, stringField, systemMessage } from "./io";
import type { Env } from "./run";
import { isSessionId, namesDir } from "./session-name";

/** The line the person sees, once a session: `named` is how the message calls the model. */
export function fableSessionMessage(named: string): string {
  return `${COMMAND}: this session runs on ${named}, the premium model — it uses your plan's limits faster than Opus. Switch with /model if you did not mean to.`;
}

/**
 * How the line names the model behind the session: Claude Fable when Claude answers, else the
 * tier and the model that does (`the \`fable\` model, openai:gpt-5.5`).
 */
export function fableSessionModelName(real: LaunchModel): string {
  return real.claude ? "Claude Fable" : `the \`fable\` model, ${real.model}`;
}

/** The mark file that says this session was told, beside the session's own name files. */
export function fableSessionMark(env: Env, sessionId: string): string {
  return join(namesDir(env), `${sessionId}.fable`);
}

/**
 * True the first time this session is seen. The mark is created with `wx`, so a run that races
 * another cannot speak as well. False when it is there already (EEXIST) — another run told this
 * session — or when it cannot be made at all: the line is never said twice, so not at all then.
 */
function firstTime(mark: string): boolean {
  try {
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when this text could be the fable tier before any file is read: a Claude Fable id, the
 * family name, the family's model-slot key, or the id the person's own override names.
 */
export function couldBeFable(model: string, env: Env): boolean {
  if (familyOfModel(model) === "fable") return true;
  const override = stringField(env[familyEnv("fable")]);
  if (override !== null && withoutContextSuffix(override.trim()) === model) return true;
  const text = withoutContextSuffix(model.trim());
  return text === "fable" || MODEL_SLOTS[text] === "fable";
}

/** One `systemMessage` when this session's own model is the `fable` tier, once. Else silent. */
export function fableSession(input: HookInput, env: Env, paths: CliPaths): HookResult {
  const event = stringField(input.hook_event_name);
  const sessionId = input.session_id;
  if (event === null || !isSessionId(sessionId)) return SILENT;
  // Nobody watches a `claude -p` session: no line, and no mark either.
  if ((env.CLAUDE_CODE_SESSION_ATTENDED ?? "1") === "0") return SILENT;
  const mark = fableSessionMark(env, sessionId);
  // Told already: nothing to read. This hook runs at every prompt.
  if (existsSync(mark)) return SILENT;
  // A start names the model it runs on and nothing else; at a prompt, the transcript's last
  // answer, then `ANTHROPIC_MODEL` — and only then is anything else read.
  const model = event === "SessionStart" ? stringField(input.model) : sessionModelOf(input, env);
  if (model === null || !couldBeFable(model, env)) return SILENT;
  const real = resolveLaunchModel(model, gatewayConfigOf(paths), env);
  if (real.tier !== "fable") return SILENT;
  if (!firstTime(mark)) return SILENT;
  return systemMessage(fableSessionMessage(fableSessionModelName(real)));
}
