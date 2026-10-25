/**
 * SessionStart, PostModelSwitch and Stop: one line to the person, once in a session, when that
 * session's own model is the **`fable` tier** (the owner, 2026-10-16; fixed 2026-10-17).
 *
 * **Claude never cares which model runs the main session.** A session on Fable is the person's
 * choice, and nothing is said to Claude about it — no `additionalContext`, no error, never a
 * block. The person may not have meant it (the tier spends the plan's limits faster than Opus),
 * so they are told once, through the `systemMessage` output field ("Display a message to the
 * user (all hooks)", `src/hooks/io.ts` and `docs/claude-code-contract.md`).
 *
 * Which model, at which event:
 *   - **SessionStart**: the `model` the input names, and nothing else;
 *   - **PostModelSwitch**: `to_model` — the model the session runs AFTER the switch, in Claude
 *     Code's own words ("Resolved model id the session runs after the switch"). So a `/model`
 *     switch to Fable is warned about at the switch itself;
 *   - **Stop**: the model that last answered in the transcript (`sessionModelOf`, the same
 *     reading the Agent guard's fork rule uses), then `ANTHROPIC_MODEL`. At Stop the last
 *     assistant message IS the answer that just finished, so this is the model that really
 *     answered — the catch-all for a Claude Code that fires no PostModelSwitch.
 *
 * **Why not UserPromptSubmit (the bug this fixes, live 2026-10-17).** It read the transcript's
 * last assistant message at every prompt, which is the PREVIOUS answer's model: the hook ran one
 * turn behind. It missed the switch to Fable, and it fired after the person had switched back to
 * Opus — a warning about Fable, said while on Opus. Stop cannot do that: it judges the answer
 * that just ended, and a switch back is a different answer.
 *
 * The tier is read the Agent guard's way (`resolveLaunchModel`: the family name, a Claude id,
 * the fable slot's chain while the gateway is on, `ANTHROPIC_DEFAULT_FABLE_MODEL`), so there is
 * no second list of what counts as Fable — and a `fable` tier a backend answers warns the same,
 * naming the model that answers it. The gateway is the session's own (`sessionGatewayOf`: its
 * `ANTHROPIC_BASE_URL`, a profile's chains), as in the Agent guard — never the machine's file.
 *
 * **What it costs.** A session that was told stops at the mark. A session on anything else pays
 * one `existsSync` and — at Stop — the transcript's tail; the gateway config (the session's
 * address is in its environment) is read only when the model text could be Fable at all
 * (`couldBeFable`). A session nobody watches (`claude -p`) is told nothing and keeps no mark.
 *
 * **Once a session**, the mark is `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.fable`,
 * beside the session's own name files (`namesDir`, one home), so the OS clears it. It is made
 * with `wx`, so two runs that race cannot both speak; EEXIST means this session was told.
 * (The owner's live report, 2026-10-17: the line WAS seen, so `systemMessage` reaches the person
 * on UserPromptSubmit at least; that it reaches them on PostModelSwitch and Stop is not proved
 * live yet — `docs/claude-code-contract.md`.)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { claudeFamily, familyEnv, MODEL_SLOTS, withoutContextSuffix } from "../gateway/targets";
import { type LaunchModel, resolveLaunchModel } from "../models/launch-policy";
import { sessionGatewayOf, sessionModelOf } from "./agent-guard";
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
 * family name, the family's slot key, or the id the person's own override names.
 */
export function couldBeFable(model: string, env: Env): boolean {
  if (claudeFamily(model) === "fable") return true;
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
  // Told already: nothing to read. This hook runs at a start, a switch and every stop.
  if (existsSync(mark)) return SILENT;
  // The model that is CURRENT, per event: a start names it, a switch names the model it moved
  // TO (`to_model`), and a stop is judged by the answer that just finished — the only reading
  // that cannot fire for a model the session has already left.
  let model: null | string;
  if (event === "SessionStart") model = stringField(input.model);
  else if (event === "PostModelSwitch") model = stringField(input.to_model);
  else model = sessionModelOf(input, env);
  if (model === null || !couldBeFable(model, env)) return SILENT;
  // The gateway THIS session runs on (its own `ANTHROPIC_BASE_URL`, a profile's chains), never
  // the machine's file: a project set to `off` is on the login, a profile has its own chains.
  const real = resolveLaunchModel(model, sessionGatewayOf(paths, env), env);
  if (real.tier !== "fable") return SILENT;
  if (!firstTime(mark)) return SILENT;
  return systemMessage(fableSessionMessage(fableSessionModelName(real)));
}
